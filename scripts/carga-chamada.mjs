/**
 * How many people a call can handle, measured instead of guessed.
 *
 * Creates N real accounts against the production server, puts them in the same
 * room by invite link, sends them all into the same call, and counts how many
 * connections each one could establish. In a mesh, each person should end with
 * N-1 connections; anything below that is the real ceiling of the module.
 *
 * Usage:  node scripts/carga-chamada.mjs [n] [--relay]
 *         --relay forces everything through the relay server, which is the worst
 *         case: it measures TURN instead of the direct path.
 *
 * Measured on August 6, 2026, against production:
 *   3 participants, direct:  6/6 connections
 *   8 participants, direct:  56/56
 *   8 participants, --relay:  56/56
 *
 * The run with --relay only passed after expanding coturn's port range. It was
 * 49160-49260, 101 ports, and the eight-person mesh exhausted it:
 * 'create_relay_ioa_sockets: no available ports', 32% of connections, and the last
 * three people entering with none. It moved to 49152-65535.
 *
 * What this DOES NOT measure: actual bandwidth of each network, latency between
 * different networks, and weak machines. Everything runs on one machine.
 *
 * CROSS-NETWORK TRAVERSAL, August 6: pending, and what was learned is worth more
 * than the test. Running two accounts on a VPS (own public IP) and two on a Mac
 * (behind CGNAT), the VPS ones link to each other 2/2 and the Mac ones are NEVER
 * ADMITTED to the shared room: 4 accounts, one welcome issued, and the request from
 * the other side gets no answer even though there are two members online. Locally,
 * with accounts arriving almost together, admission works every time. The difference
 * is delay: the Mac arrives two or three minutes later.
 *
 * Before blaming the network, note this is not traversal, it is admission, which
 * runs over MLS on the websocket and does not touch WebRTC. It is what would happen
 * to someone who opens the app in the afternoon, long after the room was created.
 *
 * THIS TEST RUNS AGAINST PRODUCTION and creates real accounts. It does not delete
 * anything on its own, and should not start to: on August 6 a cleanup run by hand,
 * right after this test, destroyed the admin record that the channel owner had just
 * published. To clean up, use `scripts/limpar-servidor.mjs`, which forces you to
 * look at what you are destroying first.
 *
 * TRAP that cost three runs: cleaning the database must ALSO delete channel_activity
 * and channel_claims. Without that the channel stays marked as used, no one recreates
 * the room, and all accounts stay asking to join a room that does not exist.
 */
import { chromium } from "playwright"
import { alvo, alvoApp } from "./ambiente.mjs"
import { criarContaEEntrar } from "./conta.mjs"

const N = Number(process.argv[2] ?? 8)
const RELAY = process.argv.includes("--relay")
/** Use the server's shared room instead of creating one and inviting everyone. */
const COMUM = process.argv.includes("--comum")
/** Seconds to measure after everyone enters. Useful to sync machines. */
const MEDIR = Number(process.argv.find((a) => a.startsWith("--medir="))?.split("=")[1] ?? 45)
/** Label to tell which machine each account came from. */
const ONDE = process.argv.find((a) => a.startsWith("--onde="))?.split("=")[1] ?? "local"
/**
 * Which deployment to run against. Production by default, as it always was.
 *
 * It exists because the only possible target was production, and that measures
 * the code already there, never what was just written. Pointing this at a local
 * `dev:web` is the only way to exercise the mesh with real browsers BEFORE you
 * deploy, which is when fixes are still cheap.
 */
const URL_BASE = process.argv.find((a) => a.startsWith("--url="))?.split("=")[1] ?? alvoApp(undefined)
const FRASE = process.env.ORWELL_DIAG_PASSPHRASE ?? "carga-2026"
const SALA = `carga-${Date.now().toString(36)}`

const ARGS = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
]

/** Count connections and their states, inside the page. */
const INSTRUMENTAR = (forcarRelay) => {
  const Orig = window.RTCPeerConnection
  window.__pcs = []
  window.RTCPeerConnection = function (config) {
    const cfg = forcarRelay ? { ...config, iceTransportPolicy: "relay" } : config
    const pc = new Orig(cfg)
    const registo = { estados: [], ligou: false }
    window.__pcs.push(registo)
    pc.addEventListener("connectionstatechange", () => {
      registo.estados.push(pc.connectionState)
      if (pc.connectionState === "connected") registo.ligou = true
    })
    return pc
  }
  window.RTCPeerConnection.prototype = Orig.prototype
}

async function abrir(indice) {
  const ctx = await chromium.launchPersistentContext(`/tmp/orwell-carga/${SALA}-${indice}`, {
    headless: true,
    args: ARGS,
    permissions: ["microphone"],
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.addInitScript(INSTRUMENTAR, RELAY)
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3000)

  await criarContaEEntrar(page, { nome: `${ONDE} ${indice}`, frase: FRASE })
  return { ctx, page, indice }
}

async function entrarNaChamada(page) {
  for (const nome of [/entrar na chamada/i, /chamada/i, /ligar/i]) {
    const botao = page.getByRole("button", { name: nome }).first()
    if (await botao.isVisible().catch(() => false)) {
      await botao.click()
      return true
    }
  }
  return false
}

console.log(`a criar ${N} contas${RELAY ? " (tudo por retransmissao)" : ""}...`)
const clientes = []
for (let i = 0; i < N; i++) {
  clientes.push(await abrir(i))
  process.stdout.write(`  ${i + 1}/${N}\r`)
}
console.log(`\n${N} contas criadas`)

// A room of its own, with a unique name.
//
// The first version of this script put everyone in the host's `geral`, and since
// each account has its own `geral`, the test collided with itself: the invited
// ones ended up each in theirs and measured zero connections.
const anfitriao = clientes[0].page

if (COMUM) {
  /**
   * Wait for the room, not a clock.
   *
   * Someone arriving at a shared room that already exists must ask to join and be
   * admitted by someone already there, and the request retries at intervals that
   * double until two minutes. A fixed 30 s wait gave 0 connections in a test
   * between two machines, not because traversal failed but because this side had
   * not been admitted yet when the script went looking for the room.
   */
  console.log("a usar a sala comum; a esperar que todas sejam admitidas...")
  const limite = Date.now() + 180_000
  for (;;) {
    const dentro = []
    for (const { page } of clientes) {
      const texto = await page.locator("body").innerText()
      dentro.push(/\borwell\b/i.test(texto.split("Entrar com um link")[0] ?? ""))
    }
    const quantas = dentro.filter(Boolean).length
    if (quantas === N) {
      console.log(`  ${N}/${N} admitidas`)
      break
    }
    if (Date.now() > limite) {
      console.log(`  !! so ${quantas}/${N} foram admitidas em 180 s; a continuar assim mesmo`)
      break
    }
    await anfitriao.waitForTimeout(5000)
  }
} else {
await anfitriao.getByRole("button", { name: "Criar canal" }).first().click()
await anfitriao.waitForTimeout(1000)
await anfitriao.getByPlaceholder("geral").first().fill(SALA)
await anfitriao.keyboard.press("Enter")
await anfitriao.waitForTimeout(5000)
console.log(`sala ${SALA} criada`)

async function enderecoDe(page) {
  // The server name can carry a port -- `localhost:8448` -- and the class must accept
  // it. Without the colon, the read address stopped at "localhost", the invite went
  // to a non-existent person, and the invited person never saw the room. Against
  // production we never saw it: `orwell.pt` has no port.
  return page.evaluate(() => document.body.innerText.match(/@[a-z0-9]{20,}:[a-z0-9.:]+/)?.[0] ?? null)
}

const enderecos = []
for (const { page } of clientes) enderecos.push(await enderecoDe(page))
console.log(`enderecos lidos: ${enderecos.filter(Boolean).length}/${N}`)

// The room just created is the active one, and that is where the invite goes.
for (let i = 1; i < N; i++) {
  const quem = enderecos[i]
  if (!quem) continue
  await anfitriao.getByRole("button", { name: /^convidar$/i }).first().click().catch(() => {})
  await anfitriao.waitForTimeout(800)
  const campo = anfitriao.getByPlaceholder("@abc…:servidor").first()
  if (!(await campo.isVisible().catch(() => false))) {
    console.log(`  !! painel de convite nao abriu para ${i}`)
    continue
  }
  await campo.fill(quem)
  await anfitriao.keyboard.press("Enter")
  await anfitriao.waitForTimeout(4000)
  process.stdout.write(`  convidado ${i}/${N - 1}\r`)
}
console.log("\nconvites enviados; a esperar que os convites assentem...")
await anfitriao.waitForTimeout(10_000)
}

// Each one opens the shared room. Without this, the call button belongs to the
// wrong room and creates one call per person, all empty.
let naSala = 0
for (const { page, indice } of clientes) {
  const sala = page.getByText(COMUM ? /^orwell$/i : SALA).first()
  if (await sala.isVisible().catch(() => false)) {
    await sala.click()
    await page.waitForTimeout(1200)
    naSala++
  } else {
    console.log(`  !! ${indice} nao ve a sala`)
  }
}
console.log(`${naSala}/${N} estao na sala partilhada`)

for (const { page } of clientes) {
  await page.getByRole("button", { name: /^chamada$/i }).first().click().catch(() => {})
  await page.waitForTimeout(700)
}
console.log(`todas na chamada; a medir ${MEDIR} s...`)
await clientes[0].page.waitForTimeout(MEDIR * 1000)

console.log(`\n=== resultado com ${N} participantes ===`)
console.log(`cada uma devia ter ${N - 1} ligacoes\n`)
let totalLigadas = 0
for (const { page, indice } of clientes) {
  const pcs = await page.evaluate(() => window.__pcs ?? [])
  const ligadas = pcs.filter((p) => p.ligou).length
  const mortas = pcs.filter((p) => p.estados.includes("failed") || p.estados.includes("closed")).length
  totalLigadas += ligadas
  const painel = await page.locator("body").innerText()
  const conta = painel.match(/(\d+)\s+pessoas?/i)?.[1] ?? "?"
  console.log(
    `  ${ONDE} ${indice}: ${ligadas}/${N - 1} ligadas, ${pcs.length} tentadas, ${mortas} cairam, painel diz "${conta} pessoas"`,
  )
}
const ideal = N * (N - 1)
console.log(`\ntotal: ${totalLigadas}/${ideal} ligacoes (${Math.round((totalLigadas / ideal) * 100)}%)`)

for (const { ctx } of clientes) await ctx.close()

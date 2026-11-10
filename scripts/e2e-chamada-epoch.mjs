/**
 * What happens to a call when the channel changes underneath it.
 *
 * Two questions no unit test answers, because both need real WebRTC and real
 * media flowing:
 *
 *   1. Someone joins the CHANNEL mid-call. This advances the MLS group epoch,
 *      and the SFrame key comes out of that epoch's exporter. If rotation is
 *      wrong, frames keep arriving and stop decrypting: the call stays "connected"
 *      with all faces on screen, and nothing changes. Audio samples must be
 *      measured, because from outside, connection states, ontrack, participant
 *      count, everything looks fine.
 *
 *   2. Someone reloads the page and comes back. They don't send `voice.leave`,
 *      so the other side thinks the connection is still alive for the thirty-odd
 *      seconds ICE takes to admit it is dead. If reconnect fails, the returned
 *      user sees "waiting for someone to join" and the one who stayed shows a
 *      card for someone who is no longer there.
 *
 * Usage:  node scripts/e2e-chamada-epoch.mjs [--url=http://127.0.0.1:5173]
 *
 * Measured 6 August 2026 against a local server with this fix:
 *   3 in call, 6/6 connections, 2 attempted per person (no retries)
 *   fourth joins channel mid-call: audio keeps growing on all 3
 *   reload and return: 6/6 again, old connection replaced
 */
import { chromium } from "playwright"
import { alvoApp, FRASE as FRASE_PADRAO, SERVIDOR } from "./ambiente.mjs"
import { criarContaEEntrar } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
/*
 * The frame counter comes from the SFU proof and lives there because it was born there.
 *
 * Same problem in both places: `totalSamplesReceived` measures nothing on this
 * machine. A headless Chrome has no audio output, nobody pulls the track, and
 * the decoder does not work, the three audio checks in this script read 0 and
 * 480 samples (ten milliseconds) in a twenty-second call where the mesh was
 * solid and audio passed. Counting frames that CROSS the decryption gate does
 * not depend on having speakers.
 */
import { INSTRUMENTAR, LER_SFRAME } from "./sfu-prova-fase2/instrumento.mjs"

/*
 * The address comes from `ambiente.mjs`, not a constant written here.
 *
 * What was here, `http://127.0.0.1:5173`, lost the `/app/` the day the
 * homepage took the domain root (`vite.config.ts` in `@enclave/web` declares
 * `base: "/app/"`). Without it the browser gets the public page HTML instead of
 * the bundle, and the script waits sixty seconds for an account creation screen
 * that never appears. And `alvoApp` brings the production lock, which this script
 * did not have: it creates four accounts and a call.
 */
const URL_BASE = alvoApp(process.argv.find((a) => a.startsWith("--url="))?.split("=")[1])
const FRASE = process.env.ORWELL_DIAG_PASSPHRASE ?? FRASE_PADRAO
const SALA = `epoch-${Date.now().toString(36)}`

const ARGS = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
]

const resultados = []
const verificar = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FALHA"}  ${etiqueta}${detalhe ? ` -- ${detalhe}` : ""}`)
}

/** The state of each mesh connection. Audio is measured elsewhere. */
const MEDIR_AUDIO = async () =>
  await Promise.all(
    (window.__pcs ?? []).map(async (pc) => {
      let amostras = 0
      let ocultadas = 0
      const relatorio = await pc.getStats()
      relatorio.forEach((v) => {
        if (v.type === "inbound-rtp" && v.kind === "audio") {
          amostras += v.totalSamplesReceived ?? 0
          ocultadas += v.concealedSamples ?? 0
        }
      })
      return { estado: pc.connectionState, amostras, ocultadas }
    }),
  )

async function abrir(indice) {
  const ctx = await chromium.launchPersistentContext(`/tmp/orwell-epoch/${SALA}-${indice}`, {
    headless: true,
    args: ARGS,
    permissions: ["microphone"],
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.addInitScript(INSTRUMENTAR, "")
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2500)
  // The server goes explicit: without it the account is born on `localhost:8448`
  // by default from the screen, not on the dev server that is running.
  await criarContaEEntrar(page, { nome: `epoch ${indice}`, frase: FRASE, servidor: SERVIDOR })
  return { ctx, page, indice }
}

/*
 * Addresses are WORDS separated by hyphens, and this script did not know that.
 *
 * `encodeName` writes `@palavra-palavra-…:servidor` since identifiers became human-readable; the expression
 * that was here, `@[a-z0-9]{20,}`, describes the FORMER format and matches nothing. The
 * result was `null` reaching `fill()`, and the script died with "expected
 * string, got object" halfway through a four-browser build: a message that
 * points nowhere near the cause. It broke after the name change, and no one
 * noticed, because a script that does not run does not fail.
 *
 * `carga-chamada.mjs` and `criar-conta.mjs` have the same expression and the same
 * flaw; we do not touch them here because they are out of scope.
 */
const enderecoDe = (page) =>
  page.evaluate(() => document.body.innerText.match(/@[a-z0-9-]{10,}:[a-z0-9.:-]+/)?.[0] ?? null)

async function abrirSala(page) {
  const sala = page.locator(".channel-list .channel-name", { hasText: SALA }).first()
  if (!(await sala.isVisible().catch(() => false))) return false
  await sala.click()
  await page.waitForTimeout(1200)
  return true
}

/**
 * Join the call, which in a CHANNEL means joining the voice room.
 *
 * The "Call" button in the header exists only in direct conversations, "in a
 * channel the call belongs to a voice room, and you join it by clicking it in
 * the list" (`ChatScreen.tsx`). This script clicked that button inside a
 * channel, with the error swallowed by `.catch(() => {})`: nobody joined any
 * call and audio measurements measured connections that did not exist. A channel
 * is born with a voice room named "voice" (`Session.SALAS_INICIAIS`).
 *
 * @returns whether the click succeeded. A silent catch here would repeat the bug.
 */
async function entrarNaChamada(page) {
  const voz = page
    .locator(".room-row button.room")
    .filter({ has: page.locator(".room-name", { hasText: "voz" }) })
    .first()
  if (!(await voz.isVisible({ timeout: 5000 }).catch(() => false))) return false
  await voz.click()
  return true
}

// ------------------------------------------------------------------ montagem

console.log(`a criar 4 contas contra ${URL_BASE}...`)
const clientes = []
for (let i = 0; i < 4; i++) clientes.push(await abrir(i))

const anfitriao = clientes[0].page
await anfitriao.getByRole("button", { name: "Criar canal" }).first().click()
await anfitriao.waitForTimeout(1000)
await anfitriao.getByPlaceholder("geral").first().fill(SALA)
await anfitriao.keyboard.press("Enter")
await anfitriao.waitForTimeout(5000)
console.log(`sala ${SALA} criada`)

// Only three join the channel. The fourth stays out, to join mid-call.
const enderecos = []
for (const { page } of clientes) enderecos.push(await enderecoDe(page))
// The return value is CHECKED. An invite that does not go out leaves the channel
// with one person, and everything measured after that measures emptiness, with
// the cause twelve checks away from where it shows up.
const convites = []
for (const i of [1, 2]) convites.push(await convidar(anfitriao, SALA, enderecos[i]))
verificar("os convites sairam", convites.every(Boolean), `${convites.filter(Boolean).length}/2`)

/*
 * AND THEY ACCEPTED. This was what was missing, and it was everything.
 *
 * Inviting doesn't seat anyone, the invite arrives as a private message and
 * only those who accept join, and the invite box says so in full. This script
 * never accepted anything: the invitees stayed at the door, the channel had one
 * person (`os tres estao na sala -- 1/3`), and the eleven checks that followed
 * measured the void, each with a message about something else.
 */
const aceites = []
for (const i of [1, 2]) aceites.push(await aceitarConvite(clientes[i].page, SALA))
verificar("os convidados ACEITARAM e entraram", aceites.every(Boolean), `${aceites.filter(Boolean).length}/2`)
await anfitriao.waitForTimeout(4000)

let naSala = 0
for (const i of [0, 1, 2]) if (await abrirSala(clientes[i].page)) naSala++
verificar("os tres estao na sala", naSala === 3, `${naSala}/3`)

let emChamada = 0
for (const i of [0, 1, 2]) {
  if (await entrarNaChamada(clientes[i].page)) emChamada++
  await clientes[i].page.waitForTimeout(700)
}
verificar("os tres entraram na sala de voz", emChamada === 3, `${emChamada}/3`)
console.log("os tres em chamada; a assentar 20 s...")
await anfitriao.waitForTimeout(20_000)

const antes = []
for (const i of [0, 1, 2]) antes.push(await clientes[i].page.evaluate(MEDIR_AUDIO))
const ligadas = (medidas) => medidas.filter((m) => m.estado === "connected").length
const totalAntes = antes.reduce((soma, m) => soma + ligadas(m), 0)
verificar("malha de tres fechada", totalAntes === 6, `${totalAntes}/6 ligacoes`)
verificar(
  "cada um tentou exactamente duas ligacoes (sem refazer)",
  antes.every((m) => m.length === 2),
  antes.map((m) => m.length).join(", "),
)
/*
 * AUDIO is measured in frames that DECRYPT, not in samples the browser never
 * produced.
 *
 * This used to run `every()` on empty lists declaring "audio is arriving" with
 * no detail and zero connections measured. Then it began requiring connections;
 * and then we found that the thing required, `totalSamplesReceived`, does not
 * move on this machine, because headless Chrome does not pull the track. A check
 * that cannot pass is as useless as one that cannot fail: it teaches everyone
 * to ignore it.
 *
 * Receivers are counted at the entry and exit of product decryption: `entrada`
 * is what the peer sent, `saida` is what opened. Two people on the other side
 * are two receivers.
 */
/*
 * Count receivers that RECEIVED something, not all of them.
 *
 * The mesh has more `RTCRtpReceiver` objects than people: a renegotiation or
 * a remade connection leaves behind receivers that never saw a frame. Requiring
 * "exactly two" failed with `1064/1064 + 0/0 + 1023/1023 + 0/0`, which is a
 * three-person call working perfectly.
 *
 * And zero rejections are not required: the mesh always has some frames at the
 * front that arrive before the key is installed (measured: 12 in 1076). What is
 * required is that each stream with frames HAS OPENED frames.
 */
const receptoresDe = (registos) => registos.filter((r) => r.papel === "receptor")
const activos = (registos) => receptoresDe(registos).filter((r) => r.entrada > 0)
const totalDecifrado = (registos) => activos(registos).reduce((soma, r) => soma + r.saida, 0)
const comSom = (paginas) =>
  paginas.length > 0 &&
  paginas.every((registos) => {
    const fluxos = activos(registos)
    return fluxos.length >= 2 && fluxos.every((r) => r.saida > 0)
  })
const detalheDeSom = (paginas) =>
  paginas
    .map((registos) => {
      const fluxos = activos(registos)
      return fluxos.length === 0 ? "nenhum" : fluxos.map((r) => `${r.saida}/${r.entrada}`).join("+")
    })
    .join("  ")

const somAntes = []
for (const i of [0, 1, 2]) somAntes.push(await clientes[i].page.evaluate(LER_SFRAME))
verificar("ha audio DECIFRADO a chegar antes da mudanca", comSom(somAntes), detalheDeSom(somAntes))

// -------------------------------------------- 1. epoch changes mid-call

console.log("\na convidar um quarto para o CANAL, com a chamada a decorrer...")
const quartoConvidado = await convidar(anfitriao, SALA, enderecos[3])
const quartoEntrou = quartoConvidado && (await aceitarConvite(clientes[3].page, SALA))
verificar("o quarto entra mesmo no canal, a meio da chamada", quartoEntrou)
await anfitriao.waitForTimeout(20_000)

const depois = []
for (const i of [0, 1, 2]) depois.push(await clientes[i].page.evaluate(MEDIR_AUDIO))

/*
 * And keeps arriving AFTER. "Grew" is the right question: the final count goes
 * up the same way after two silent seconds, but the count before and after an
 * epoch change answers "did key rotation cut the audio?".
 */
const somDepois = []
for (const i of [0, 1, 2]) somDepois.push(await clientes[i].page.evaluate(LER_SFRAME))
const cresceu =
  comSom(somAntes) &&
  comSom(somDepois) &&
  somAntes.every((registos, i) => totalDecifrado(somDepois[i] ?? []) > totalDecifrado(registos))
verificar(
  "o audio continua a DECIFRAR depois de o epoch mudar",
  cresceu,
  somAntes.map((registos, i) => `${totalDecifrado(registos)}->${totalDecifrado(somDepois[i] ?? [])}`).join("  "),
)
const totalDepois = depois.reduce((soma, m) => soma + ligadas(m), 0)
verificar("a malha continua fechada depois da mudanca", totalDepois === 6, `${totalDepois}/6`)

// ------------------------------------------------- 2. recarregar e voltar a entrar

console.log("\no terceiro recarrega a pagina e volta a entrar...")
const quemVolta = clientes[2].page
await quemVolta.reload({ waitUntil: "domcontentloaded" })
await quemVolta.waitForTimeout(6000)
const voltou = await quemVolta
  .getByRole("button", { name: "Configurações" })
  .isVisible()
  .catch(() => false)
verificar("a pagina recarregada volta a abrir a conta", voltou)

await abrirSala(quemVolta)
verificar("quem voltou consegue reentrar na sala de voz", await entrarNaChamada(quemVolta))
console.log("a assentar 25 s...")
await quemVolta.waitForTimeout(25_000)

const regresso = []
for (const i of [0, 1, 2]) regresso.push(await clientes[i].page.evaluate(MEDIR_AUDIO))
const totalRegresso = regresso.reduce((soma, m) => soma + ligadas(m), 0)
verificar("a malha volta a fechar depois do regresso", totalRegresso === 6, `${totalRegresso}/6 ligacoes`)
verificar(
  "quem ficou substituiu a ligacao morta em vez de a manter",
  (regresso[0]?.length ?? 0) === 3 && (regresso[1]?.length ?? 0) === 3,
  `tentativas: ${regresso.map((m) => m.length).join(", ")}`,
)
/*
 * And the audio from the one who returned. The empty `every` here was double,  * no connections, and none in `connected` state, and it passed saying there was
 * audio from the returned user when there was nobody.
 */
const somRegresso = []
for (const i of [0, 1, 2]) somRegresso.push(await clientes[i].page.evaluate(LER_SFRAME))
verificar(
  "ha audio DECIFRADO a chegar de quem voltou",
  /*
   * Growth is only required from THOSE WHO STAYED.
   *
   * The counter lives in the page, and whoever reloaded has a new page: their
   * numbers start over at zero, and requiring them to grow was requiring a page
   * that just was born to have already decrypted more than the one that died.
   * What we require from them is what matters, that they hear again, and that
   * is what `comSom` checks.
   */
  comSom(somRegresso) &&
    [0, 1].every((i) => totalDecifrado(somRegresso[i] ?? []) > totalDecifrado(somDepois[i] ?? [])),
  detalheDeSom(somRegresso),
)

for (const { ctx } of clientes) await ctx.close()

const passou = resultados.filter(Boolean).length
console.log(`\n${passou}/${resultados.length} verificacoes passaram`)
process.exit(passou === resultados.length ? 0 : 1)

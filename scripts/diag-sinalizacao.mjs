/**
 * Who offered to whom, and who waited.
 *
 * `churn-chamada.mjs` says HOW MANY connections closed; this says WHY one did
 * not close. It exists from a report by the owner on August 12: three people on
 * a call, two hear each other, the third stays "calling" forever. The churn
 * reproduced the number (4/6 at start, always the same shape: exactly the link
 * between two of them is missing), but a total does not say whose turn it was
 * to be lost.
 *
 * The rule being tested lives in `call.ts`, in the `voice.join` branch: only
 * the one with the smaller address OFFERS; the larger one renounces to trigger
 * that offer. If one of the two sides never gets to see the other's announcement
 * at the right moment, both wait, and neither knows it is waiting.
 *
 * What this instruments, inside the page not from the screen: each `voice.*`
 * that goes in and out, with the time, plus the final state of each
 * `RTCPeerConnection`. The screen may be delayed; this is not.
 *
 * Usage, ALWAYS against local and with the server database freshly cleared:
 *   node apps/server/dist/main.js            (ENCLAVE_COMMON_ROOM set)
 *   npx vite preview apps/web --port 4175
 *   node scripts/diag-sinalizacao.mjs [n] --url=… --servidor=…
 */
import { chromium } from "playwright"
import { criarContaEEntrar } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const N = Number(process.argv[2] ?? 3)
const URL_BASE = comLingua(process.argv.find((a) => a.startsWith("--url="))?.split("=")[1] ?? "http://127.0.0.1:4175")
const SERVIDOR = process.argv.find((a) => a.startsWith("--servidor="))?.split("=")[1] ?? "localhost:8462"
/** Seconds to wait after everyone enters, before measuring. */
const ESPERA = Number(process.argv.find((a) => a.startsWith("--espera="))?.split("=")[1] ?? 20)
/** Seconds between entries. Zero means everyone at the same time. */
const INTERVALO = Number(process.argv.find((a) => a.startsWith("--intervalo="))?.split("=")[1] ?? 2)

const FRASE = "frase-de-diagnostico-1234"
const CORRIDA = Date.now().toString(36)

/**
 * Catch signaling where it flows: in the WebSocket `send` and in `message`.
 *
 * Do not read from `Session` or any application object, that would force the
 * app to expose things just for this. What to read is the wire, which exists
 * anyway. Payloads go encrypted, so what is caught from outside does not help;
 * what helps is what the application LOGS, and for that it is enough to tap the
 * `RTCPeerConnection` and the `console.debug` calls the app already emits.
 *
 * So instrument what is observable without any encryption: each connection
 * created, which address it belongs to (the order of creation does not give it,  * but the state does), and each transition. It is enough to tell if an offer
 * came to exist on one side.
 */
const INSTRUMENTAR = () => {
  const Orig = window.RTCPeerConnection
  window.__pcs = []
  window.__eventos = []
  const marcar = (o) => window.__eventos.push({ em: Date.now(), ...o })

  window.RTCPeerConnection = function (config) {
    const pc = new Orig(config)
    const id = window.__pcs.length
    window.__pcs.push(pc)
    marcar({ que: "pc-criada", id })

    pc.addEventListener("connectionstatechange", () => marcar({ que: "estado", id, valor: pc.connectionState }))
    pc.addEventListener("iceconnectionstatechange", () => marcar({ que: "ice", id, valor: pc.iceConnectionState }))
    pc.addEventListener("signalingstatechange", () => marcar({ que: "sinal", id, valor: pc.signalingState }))

    const setLocal = pc.setLocalDescription.bind(pc)
    pc.setLocalDescription = (d) => {
      marcar({ que: "local", id, tipo: d?.type ?? "(auto)" })
      return setLocal(d)
    }
    const setRemote = pc.setRemoteDescription.bind(pc)
    pc.setRemoteDescription = (d) => {
      marcar({ que: "remota", id, tipo: d?.type ?? "?" })
      return setRemote(d).catch((erro) => {
        marcar({ que: "remota-falhou", id, tipo: d?.type ?? "?", detalhe: String(erro?.message ?? erro) })
        throw erro
      })
    }
    return pc
  }
  window.RTCPeerConnection.prototype = Orig.prototype

  window.__vivas = () => window.__pcs.filter((pc) => pc.connectionState === "connected").length
  window.__estados = () => window.__pcs.map((pc) => pc.connectionState)
}

const ARGS = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
]

async function abrir(indice) {
  const ctx = await chromium.launchPersistentContext(`/tmp/orwell-diagsinal/${CORRIDA}-${indice}`, {
    headless: true,
    args: ARGS,
    permissions: ["microphone"],
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.addInitScript(INSTRUMENTAR)
  const erros = []
  page.on("console", (m) => {
    if (m.type() === "error" || /voice|call|chamada/i.test(m.text())) erros.push(m.text())
  })
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3000)

  await criarContaEEntrar(page, { nome: `bot ${indice}`, frase: FRASE, servidor: SERVIDOR })

  await page.getByRole("button", { name: "Eu" }).click()
  const address = ((await page.locator(".me-address").first().getAttribute("title")) ?? "").trim()
  await page.keyboard.press("Escape").catch(() => {})

  return { ctx, page, indice, address, erros }
}

async function entrar(bot) {
  await bot.page.keyboard.press("Escape").catch(() => {})
  // Back to Chats, which is where rooms exist: reading the address forced going
  // through the profile, and `Escape` closes the sheet without changing screen.
  await bot.page
    .getByRole("button", { name: "Comunidades" })
    .first()
    .click()
    .catch(() => {})
  const sala = bot.page.locator(".room-row").filter({ hasText: /voz/i }).first()
  try {
    await sala.waitFor({ state: "visible", timeout: 180_000 })
  } catch {
    // Say what IS, not just that what you looked for is not there: an invalid run
    // without this reads as a serious failure, and it cost time twice already.
    const linhas = await bot.page.locator(".room-row").allInnerTexts().catch(() => [])
    const overlay = await bot.page
      .locator(".overlay")
      .first()
      .innerText()
      .catch(() => "")
    console.log(`    salas visíveis: ${linhas.length === 0 ? "(nenhuma)" : linhas.join(" | ")}`)
    if (overlay) console.log(`    modal por cima: "${overlay.replace(/\s+/g, " ").slice(0, 120)}"`)
    await bot.page.screenshot({ path: `/tmp/orwell-diagsinal-bot${bot.indice}.png` }).catch(() => {})
    return false
  }
  await sala.click()
  return true
}

console.log(`${N} bots contra ${URL_BASE} (servidor ${SERVIDOR}), ${INTERVALO}s entre entradas`)
const bots = []
for (let i = 0; i < N; i += 1) {
  process.stdout.write(`  conta ${i + 1}/${N}`)
  bots.push(await abrir(i))
}
console.log("")
for (const bot of bots) console.log(`  bot ${bot.indice}: ${bot.address}`)

// The order of addresses is what decides who offers to whom. Written before
// everything, because it is against it that signaling is read.
const ordenados = [...bots].sort((a, b) => (a.address < b.address ? -1 : 1))
console.log(`  ordem dos endereços: ${ordenados.map((b) => `bot${b.indice}`).join(" < ")}`)
console.log(`  (quem oferece é sempre o da ESQUERDA de cada par)`)

console.log("\na entrar...")
for (const bot of bots) {
  const ok = await entrar(bot)
  console.log(`  bot ${bot.indice}: ${ok ? "entrou" : "NAO ENCONTROU a sala"}`)
  if (!ok) {
    for (const b of bots) await b.ctx.close()
    process.exit(2)
  }
  if (INTERVALO > 0) await bot.page.waitForTimeout(INTERVALO * 1000)
}

await bots[0].page.waitForTimeout(ESPERA * 1000)

console.log("\nestado final de cada ligação:")
let vivasTotais = 0
for (const bot of bots) {
  const estados = await bot.page.evaluate(() => window.__estados())
  const vivas = estados.filter((e) => e === "connected").length
  vivasTotais += vivas
  console.log(`  bot ${bot.indice}: ${vivas}/${N - 1} vivas  [${estados.join(", ")}]`)
}
console.log(`  TOTAL ${vivasTotais}/${N * (N - 1)}`)

console.log("\nsinalização, por bot:")
for (const bot of bots) {
  const eventos = await bot.page.evaluate(() => window.__eventos)
  const t0 = eventos[0]?.em ?? 0
  console.log(`  --- bot ${bot.indice} (${eventos.length} eventos)`)
  for (const e of eventos) {
    const quando = `${String(((e.em - t0) / 1000).toFixed(1)).padStart(6)}s`
    const detalhe = e.detalhe ? ` — ${e.detalhe}` : ""
    console.log(`    ${quando}  pc${e.id ?? "-"}  ${e.que}${e.valor || e.tipo ? `: ${e.valor ?? e.tipo}` : ""}${detalhe}`)
  }
}

for (const bot of bots) {
  if (bot.erros.length > 0) {
    console.log(`\nconsola do bot ${bot.indice}:`)
    for (const linha of bot.erros.slice(0, 12)) console.log(`    ${linha}`)
  }
}

for (const bot of bots) await bot.ctx.close()

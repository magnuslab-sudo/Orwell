/**
 * Does the common room really receive everyone?
 *
 * Create N accounts, leave them all connected at the same time and see which
 * ones end up seeing the room. One creates it (wins server arbitration) and the
 * others request entry; someone online must admit them, so nobody disconnects
 * while waiting.
 */
import { chromium } from "playwright"
import { APP } from "./ambiente.mjs"
import { criarContaEEntrar } from "./conta.mjs"

const N = Number(process.argv[2] ?? 3)
const ESPERA = Number(process.argv[3] ?? 40)
/** Seconds between each account, to replay who arrives late. */
const ATRASO = Number(process.argv.find((a) => a.startsWith("--atraso="))?.split("=")[1] ?? 0)
const FRASE = process.env.ORWELL_DIAG_PASSPHRASE ?? "carga-2026"
const MARCA = Date.now().toString(36)

async function abrir(indice) {
  const ctx = await chromium.launchPersistentContext(`/tmp/orwell-comum/${MARCA}-${indice}`, {
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    permissions: ["microphone"],
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const avisos = []
  page.on("console", (m) => {
    const t = m.text()
    if (m.type() === "error" || /sala comum|admitir|rejoin|claim|chaves|convite/i.test(t)) avisos.push(t.slice(0, 200))
  })
  page.on("pageerror", (e) => avisos.push("PAGEERROR: " + String(e.message).slice(0, 200)))
  // The wire traffic tells the truth: which frames go out, which frames arrive.
  const fio = []
  page.on("websocket", (ws) => {
    ws.on("framesent", ({ payload }) => {
      const t = String(payload).match(/"t":"([^"]+)"/)?.[1]
      if (t && /claim|subscribe|rejoin|send/.test(t)) fio.push(`-> ${t}`)
    })
    ws.on("framereceived", ({ payload }) => {
      const t = String(payload).match(/"t":"([^"]+)"/)?.[1]
      if (t && /claim|rejoin|welcome|event/.test(t)) fio.push(`<- ${t}` + (String(payload).match(/"ouviram":(\d+)/) ? `(ouviram=${String(payload).match(/"ouviram":(\d+)/)[1]})` : ""))
    })
  })
  ctx.__fio = fio
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3000)
  await criarContaEEntrar(page, { nome: `Comum ${indice}`, frase: FRASE })
  return { ctx, page, indice, avisos, fio }
}

console.log(`a criar ${N} contas, todas ligadas ao mesmo tempo...`)
const clientes = []
for (let i = 0; i < N; i++) {
  if (i > 0 && ATRASO > 0) {
    console.log(`  a esperar ${ATRASO}s antes da conta ${i} (simula quem chega tarde)`)
    await clientes[0].page.waitForTimeout(ATRASO * 1000)
  }
  clientes.push(await abrir(i))
  console.log(`  conta ${i} criada`)
}

console.log(`\n${N} contas ligadas. A esperar ${ESPERA}s pelas admissões...`)
for (let s = 10; s <= ESPERA; s += 10) {
  await clientes[0].page.waitForTimeout(10_000)
  let dentro = 0
  for (const { page } of clientes) {
    const texto = await page.locator("body").innerText()
    const lista = texto.split("Entrar com um link")[0] ?? ""
    if (/\borwell\b/i.test(lista)) dentro++
  }
  console.log(`  ${s}s: ${dentro}/${N} veem a sala`)
}

console.log("\n=== o que cada uma vê ===")
for (const { page, indice, avisos, fio } of clientes) {
  const texto = await page.locator("body").innerText()
  const salas = [...new Set(texto.match(/^[a-z0-9!:.\-]{3,40}$/gim) ?? [])].slice(0, 6)
  const lista = texto.split("Entrar com um link")[0] ?? ""
  const tem = /\borwell\b/i.test(lista)
  console.log(`  Comum ${indice}: sala comum ${tem ? "SIM" : "NAO"}  |  ${salas.join(", ").slice(0, 70)}`)
  if (avisos.length) console.log(`      consola: ${avisos.slice(0, 3).join("\n                ")}`)
  console.log(`      fio: ${fio.slice(0, 14).join("  ") || "(nada)"}`)
}

for (const { ctx } of clientes) await ctx.close()

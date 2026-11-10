/**
 * Does the channel name and icon reach the other side?
 *
 * Two accounts in the common room: the first opens properties and changes the
 * name and icon, the second reports what it sees. This is the only test that
 * answers the question, because the path goes through publishing to the group,
 * decoding on the far end, indexing and redrawing, any one of those four can
 * fail silently.
 */
import { chromium } from "playwright"
import { APP } from "./ambiente.mjs"
import { criarContaEEntrar } from "./conta.mjs"

const FRASE = process.env.ORWELL_DIAG_PASSPHRASE ?? "carga-2026"
const MARCA = Date.now().toString(36)
const NOME_NOVO = `Ação & Café ${MARCA.slice(-3)}`
// A 1x1 red PNG, small enough not to mask the problem with a size limit.
const ICONE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

async function abrir(indice) {
  const ctx = await chromium.launchPersistentContext(`/tmp/orwell-props/${MARCA}-${indice}`, {
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    permissions: ["microphone"],
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const erros = []
  page.on("console", (m) => {
    if (m.type() === "error") erros.push(m.text().slice(0, 160))
  })
  page.on("pageerror", (e) => erros.push("PAGEERROR: " + String(e.message).slice(0, 160)))
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3000)
  await criarContaEEntrar(page, { nome: `Props ${indice}`, frase: FRASE })
  return { ctx, page, indice, erros }
}

async function esperarSala(page, limiteSegundos = 120) {
  const limite = Date.now() + limiteSegundos * 1000
  for (;;) {
    const lista = (await page.locator("body").innerText()).split("Entrar com um link")[0] ?? ""
    if (/\borwell\b/i.test(lista)) return true
    if (Date.now() > limite) return false
    await page.waitForTimeout(3000)
  }
}

console.log("a criar duas contas...")
const a = await abrir(0)
console.log("  conta 0 pronta")
const b = await abrir(1)
console.log("  conta 1 pronta")

for (const cliente of [a, b]) {
  const dentro = await esperarSala(cliente.page)
  console.log(`  conta ${cliente.indice} na sala comum: ${dentro ? "sim" : "NAO"}`)
}

// Account 0 changes properties via the right-click menu.
console.log("\na conta 0 vai mudar o nome e o icone...")
// The room button, not the text inside it: the onContextMenu is on the button.
const sala = a.page.locator("button.channel").filter({ hasText: /orwell/i }).first()
await sala.click({ button: "right" })
await a.page.waitForTimeout(800)

const itens = await a.page.getByRole("menuitem").allTextContents()
console.log(`  menu: ${itens.join(" / ") || "(vazio)"}`)
const propriedades = a.page.getByRole("menuitem", { name: /propriedades/i }).first()
if (!(await propriedades.isVisible().catch(() => false))) {
  console.log("!! a entrada 'Propriedades' nao apareceu no menu")
  await a.ctx.close()
  await b.ctx.close()
  process.exit(1)
}
await propriedades.click()
await a.page.waitForTimeout(1200)

const campoNome = a.page.getByLabel(/^nome$/i).first()
await campoNome.fill(NOME_NOVO)

// The icon comes in through the file input, with real bytes.
const ficheiro = a.page.locator('input[type="file"]').first()
await ficheiro.setInputFiles({
  name: "icone.png",
  mimeType: "image/png",
  buffer: Buffer.from(ICONE.split(",")[1], "base64"),
})
await a.page.waitForTimeout(800)

await a.page.getByRole("button", { name: /^guardar$/i }).first().click()
await a.page.waitForTimeout(4000)
console.log(`  guardado: "${NOME_NOVO}" + icone`)

// Account 1 has thirty seconds to see it.
console.log("\na conta 1 esta a ver o quê?")
for (let s = 5; s <= 30; s += 5) {
  await b.page.waitForTimeout(5000)
  const texto = await b.page.locator("body").innerText()
  const lista = texto.split("Entrar com um link")[0] ?? ""
  const temNome = lista.includes(NOME_NOVO)
  const temImagem = await b.page.locator(".room-icon img").count()
  console.log(`  ${s}s: nome novo ${temNome ? "SIM" : "nao"} | imagens de canal no ecra: ${temImagem}`)
}

console.log("\n=== e a conta 0 (quem mudou) ===")
const listaA = (await a.page.locator("body").innerText()).split("Entrar com um link")[0] ?? ""
console.log(`  nome novo: ${listaA.includes(NOME_NOVO) ? "SIM" : "nao"}`)
console.log(`  imagens de canal no ecra: ${await a.page.locator(".room-icon img").count()}`)

for (const cliente of [a, b]) {
  if (cliente.erros.length) console.log(`  erros da conta ${cliente.indice}: ${cliente.erros.slice(0, 3).join(" | ")}`)
}

await a.ctx.close()
await b.ctx.close()

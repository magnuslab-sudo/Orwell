/**
 * The "Who sees this category" sheet at 390 px, in all three choices.
 *
 * One account only: here we do not measure what others see, that is
 * `verificar-visibilidade-categoria.mjs`, we measure if the sheet fits on the
 * narrowest phone this product serves, with the roles list open and the create
 * role form below it, which is the tallest and widest state it knows.
 *
 * What we count: horizontal overflow of the page and the sheet itself, and
 * whether the save button stays reachable. A sheet that only reads by scrolling
 * sideways is a broken sheet, even if nothing is overlapped.
 *
 *   sh scripts/dev-reiniciar-servidor.sh
 *   npm run dev:web
 *   node scripts/medir-visibilidade-categoria.mjs
 */
import { chromium } from "playwright"
import { criarContaEEntrar } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const APP = comLingua(process.env.ORWELL_APP ?? "http://127.0.0.1:5173")
const SERVIDOR = process.env.ORWELL_SERVER ?? "localhost:8452"
const FRASE = "medida-categorias-2026"
const MARCA = Date.now().toString(36)
const CATEGORIA = "Direccao"

const falhas = []
function verificar(descricao, condicao, extra = "") {
  console.log(`  ${condicao ? "ok  " : "FALHA"}  ${descricao}${extra ? `  ${extra}` : ""}`)
  if (!condicao) falhas.push(descricao)
}

/*
  Starts at 1280 and shrinks after.

  The setup, create account, enter room, declare category, is not what we
  measure here, and at 390 px it all goes through a drawer that opens and closes.
  The sheet is what matters, and we measure it with the window already narrow:
  shrinking with it open is exactly what a phone does to it.
*/
const ctx = await chromium.launchPersistentContext(`/tmp/orwell-medida-categorias/${MARCA}`, {
  headless: true,
  viewport: { width: 1280, height: 900 },
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const erros = []
page.on("pageerror", (e) => erros.push(String(e.message).slice(0, 200)))

await page.goto(APP, { waitUntil: "domcontentloaded" })
await criarContaEEntrar(page, { nome: "Ana", frase: FRASE, servidor: SERVIDOR, timeout: 30_000 })

const limite = Date.now() + 90_000
for (;;) {
  if (await page.locator("button.channel").first().isVisible().catch(() => false)) break
  if (Date.now() > limite) {
    console.log("  !! a sala comum nunca apareceu")
    process.exit(1)
  }
  await page.waitForTimeout(2000)
}
await page.locator("button.channel").first().click()
await page.waitForTimeout(2000)

// ------------------------------------------------------------- montar
await page.locator("button.channel").first().click({ button: "right" })
await page.getByRole("menuitem", { name: "Nova categoria" }).first().click()
await page.getByRole("dialog").getByLabel("Nome").fill(CATEGORIA)
await page.getByRole("dialog").getByRole("button", { name: "Criar" }).click()
await page.waitForTimeout(2500)

/** What overflows, and where. */
async function medir(nota) {
  const numeros = await page.evaluate(() => {
    const raiz = document.documentElement
    const folha = document.querySelector(".sheet")
    const guardar = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Guardar")
    const caixa = folha?.getBoundingClientRect()
    return {
      paginaTransborda: raiz.scrollWidth - raiz.clientWidth,
      folhaTransborda: folha ? folha.scrollWidth - folha.clientWidth : -1,
      folhaLargura: caixa ? Math.round(caixa.width) : -1,
      folhaDireita: caixa ? Math.round(caixa.right) : -1,
      janela: window.innerWidth,
      guardarVisivel: guardar ? guardar.getBoundingClientRect().bottom <= window.innerHeight + 1 : false,
    }
  })
  console.log(`\n  ${nota}: ${JSON.stringify(numeros)}`)
  verificar(`${nota} — a pagina nao rola de lado`, numeros.paginaTransborda <= 0)
  verificar(`${nota} — a folha nao rola de lado`, numeros.folhaTransborda <= 0)
  verificar(`${nota} — a folha cabe na janela`, numeros.folhaDireita <= numeros.janela)
  verificar(`${nota} — o botao de guardar esta alcancavel`, numeros.guardarVisivel)
  return numeros
}

await page.locator(".category-name").filter({ hasText: CATEGORIA }).first().click({ button: "right" })
await page.getByRole("menuitem", { name: "Quem vê esta categoria" }).first().click()
await page.getByRole("dialog").waitFor({ timeout: 10_000 })
await page.waitForTimeout(800)

// E agora o telefone.
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(800)

const folha = page.getByRole("dialog")
await medir("todos")

await folha.getByLabel("Só quem administra").check()
await page.waitForTimeout(400)
await medir("so administracao")

await folha.getByLabel("Cargos específicos").check()
await page.waitForTimeout(400)
await medir("papeis, sem nenhum declarado")

// The tallest state the sheet knows: declared roles AND the create form open
// below them.
await folha.getByLabel("Nome do cargo").fill("Guardas com um nome comprido")
await folha.getByRole("button", { name: "Criar cargo" }).click()
await page.waitForTimeout(2500)
await medir("papeis, com um declarado e o formulario aberto")

const nomeCabe = await page.evaluate(() => {
  const rotulos = [...document.querySelectorAll(".sheet label.checkbox")]
  return rotulos.every((r) => r.scrollWidth <= r.clientWidth + 1)
})
verificar("nenhum rotulo da folha esta cortado a meio", nomeCabe)

if (erros.length > 0) {
  console.log("\n  erros de pagina:")
  for (const erro of erros) console.log(`    ${erro}`)
  falhas.push("erros de pagina")
}

console.log(`\n${falhas.length === 0 ? "TUDO OK a 390 px" : `FALHAS (${falhas.length}):`}`)
for (const falha of falhas) console.log(`  - ${falha}`)
await ctx.close()
process.exit(falhas.length === 0 ? 0 : 1)

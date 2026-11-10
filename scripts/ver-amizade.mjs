// Friendship seen both ways from the UI, with two real accounts in two
// browsers, one of them at phone width.
//
//   node scripts/ver-amizade.mjs [url] [server]
import { chromium } from "playwright"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { criarConta } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const URL = comLingua(process.argv[2] ?? "http://127.0.0.1:5183/")
const SERVER = process.argv[3] ?? "localhost:8470"
const FRASE = "frase-de-teste-longa"
const TIRO = process.env.TIRO ?? join(process.cwd(), "capturas")

const results = []
const check = (label, ok, detail = "") => {
  results.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
}

async function conta(nome, viewport) {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), `orwell-${nome}-`)), {
    headless: true,
    viewport,
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [${nome}:console] ${m.text().slice(0, 160)}`)
  })
  page.on("pageerror", (e) => console.log(`  [${nome}:pageerror] ${e.message.slice(0, 160)}`))
  await page.goto(URL, { waitUntil: "domcontentloaded" })

  // Create account: name, color, and the password for this device.
  await page.waitForTimeout(1500)
  await criarConta(page, { nome: `Conta ${nome}`, frase: FRASE, servidor: SERVER })
  await page.waitForTimeout(10_000)
  return { nome, ctx, page }
}

/**
 * The account address, read from the screen itself.
 *
 * On a phone the sidebar starts closed, and that is where the address lives,  * so open it first if needed.
 */
async function enderecoDe(page) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const texto = await page.locator("body").innerText()
    const encontrado = texto.match(/@[a-z-]+:[a-z0-9.:]+/i)
    if (encontrado) return encontrado[0]
    await page.getByRole("button", { name: /painel lateral/i }).first().click().catch(() => {})
    await page.waitForTimeout(1200)
  }
  return null
}

const a = await conta("A", { width: 1280, height: 900 })
const b = await conta("B", { width: 390, height: 844 }) // phone

const enderecoA = await enderecoDe(a.page)
const enderecoB = await enderecoDe(b.page)
console.log(`[A] ${enderecoA}\n[B] ${enderecoB}`)
check("as duas contas arrancaram e mostram endereço", Boolean(enderecoA && enderecoB))

// ---------------------------------------------------------------------------
// A requests friendship from B, writing the address on the chat screen.
// ---------------------------------------------------------------------------
// The add button lives in the Social sidebar.
await a.page.getByRole("button", { name: /^social$/i }).first().click()
await a.page.waitForTimeout(1200)
await a.page.getByRole("button", { name: /adicionar amigo/i }).first().click()
await a.page.waitForTimeout(1000)
const caixa = a.page.locator('input[type="text"], input:not([type])').last()
await caixa.fill(enderecoB)
await a.page.keyboard.press("Enter")
// The notification is a toast and disappears on its own: read it while it is there.
await a.page.waitForTimeout(2500)
const avisoA = await a.page.locator("body").innerText()
check("o pedido saiu e foi anunciado a quem o fez", /pedido enviado/i.test(avisoA), avisoA.split("\n").find((l) => /pedido/i.test(l)) ?? "")
await a.page.waitForTimeout(6000)

// ---------------------------------------------------------------------------
// B responds from the BELL, the new path.
// ---------------------------------------------------------------------------
const sino = b.page.getByRole("button", { name: /notificaç/i }).first()
await sino.click()
await b.page.waitForTimeout(1200)

const painel = b.page.getByRole("dialog", { name: /notificaç/i })
const textoPainel = await painel.innerText().catch(() => "")
check("o pedido aparece no sino com a linguagem de amizade mútua", /quer ser teu amigo/i.test(textoPainel), textoPainel.split("\n")[1] ?? "")

const aceitar = painel.getByRole("button", { name: /^aceitar$/i }).first()
check("o sino oferece Aceitar", (await aceitar.count()) > 0)
const recusar = painel.getByRole("button", { name: /^recusar$/i }).first()
check("e oferece Recusar", (await recusar.count()) > 0)

await b.page.screenshot({ path: join(TIRO, "sino-telemovel.png") })

if (await aceitar.count()) {
  await aceitar.click()
  await b.page.waitForTimeout(8000)
}

const painelDepois = await painel.innerText().catch(() => "")
check(
  "aceite, o sino deixa de oferecer resposta e diz que foi respondido",
  /respondido/i.test(painelDepois) && !/^aceitar$/im.test(painelDepois),
  painelDepois.split("\n").slice(0, 3).join(" / "),
)

// The Friends screen, which reads from the same fold, also doesn't have the request.
await b.page.keyboard.press("Escape")
await b.page.getByRole("button", { name: /amigos|pessoas/i }).first().click().catch(() => {})
await b.page.waitForTimeout(2000)
const amigosB = await b.page.locator("main").innerText()
check("no ecrã de Amigos o pedido também desapareceu", !/quer ser teu amigo/i.test(amigosB))
check("e a outra pessoa está listada como amiga", amigosB.includes(enderecoA.slice(0, 20)), amigosB.split("\n").slice(0, 6).join(" / "))
await b.page.screenshot({ path: join(TIRO, "amigos-telemovel.png") })

// Overflow: the address grew from 16 to ~33 characters.
const transborda = await b.page.evaluate(() => {
  const doc = document.documentElement
  const linhas = [...document.querySelectorAll(".person-row")]
  return {
    paginaHorizontal: doc.scrollWidth > doc.clientWidth + 1,
    linhasLargas: linhas.filter((linha) => linha.scrollWidth > linha.clientWidth + 1).length,
  }
})
check("no telemóvel a página não ganha barra horizontal", !transborda.paginaHorizontal)
check("nem as linhas de pessoa transbordam com endereços de quatro palavras", transborda.linhasLargas === 0)

// ---------------------------------------------------------------------------
// On the other side, A sees the friendship established in both directions.
// ---------------------------------------------------------------------------
await a.page.waitForTimeout(4000)
await a.page.getByRole("button", { name: /amigos|pessoas/i }).first().click().catch(() => {})
await a.page.waitForTimeout(2500)
const amigosA = await a.page.locator("main").innerText()
check("quem pediu também tem a outra pessoa nos Amigos", amigosA.includes(enderecoB.slice(0, 20)), amigosA.split("\n").slice(0, 6).join(" / "))
await a.page.screenshot({ path: join(TIRO, "amigos-desktop.png") })

// The person's menu offers undo, not ask again.
const linha = a.page.locator(".person-row").first()
if (await linha.count()) {
  await linha.click({ button: "right" })
  await a.page.waitForTimeout(800)
  const menu = await a.page.locator('[role="menu"], .context-menu').innerText().catch(() => "")
  check("o menu de um amigo oferece desfazer, não pedir", /desfazer amizade/i.test(menu) && !/pedir amizade/i.test(menu), menu.replace(/\n/g, " / "))
  await a.page.screenshot({ path: join(TIRO, "menu-amigo.png") })
  await a.page.keyboard.press("Escape")
}

await a.ctx.close()
await b.ctx.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} verificações passaram`)
process.exit(failed === 0 ? 0 : 1)

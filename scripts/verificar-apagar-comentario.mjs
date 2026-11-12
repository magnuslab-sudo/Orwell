// Live check: real application, real local server, real MLS.
// Create an account, post, comment, delete the comment, and confirm that it
// does not come back on reload, which is where a screen-only delete reveals itself.
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const WEB = comLingua("http://127.0.0.1:5183/")
const SERVIDOR = "127.0.0.1:8459"
const OUT = process.argv[2] ?? "/tmp/orwell-apagar-comentario"

const resultados = []
const check = (rotulo, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`)
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
const erros = []
page.on("console", (m) => {
  if (m.type() === "error") erros.push(m.text())
})
page.on("pageerror", (e) => erros.push(String(e)))
// An old client could still ask with a native dialog, which a browser with no one watching
// refuses by default. Today's version asks with the "Confirm" button.
page.on("dialog", (d) => void d.accept())

await page.goto(WEB, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(1500)

// ---------------------------------------------------------------- criar conta
await criarConta(page, { nome: "Duarte", frase: "frase-passe-teste", servidor: SERVIDOR })
await page.waitForTimeout(6000)

const chegouAoShell = (await page.locator(".rail-btn").count()) > 0
check("a conta abre e o shell aparece", chegouAoShell)
if (!chegouAoShell) {
  await page.screenshot({ path: `${OUT}-gate.png`, fullPage: true })
  await browser.close()
  process.exit(1)
}

// ------------------------------------------------------- post and comment
await page.getByRole("button", { name: "Feed" }).first().click()
await page.waitForTimeout(500)
await page.getByPlaceholder(/Diz coisas/).fill("a serra ao amanhecer")
await page.getByRole("button", { name: "Publicar" }).click()
await page.waitForTimeout(2500)

await page.getByRole("button", { name: /Comentários|comentário/ }).first().click()
await page.waitForTimeout(300)
await page.getByPlaceholder("Escrever um comentário…").fill("arrependi-me disto")
await page.getByRole("button", { name: "Comentar", exact: true }).click()
await page.waitForTimeout(1800)
check("o comentário aparece", await page.getByText("arrependi-me disto").isVisible())

// ----------------------------------------------------------------- the bin
const caixote = page.getByRole("button", { name: "Apagar o comentário" })
check("o caixote está no meu comentário", (await caixote.count()) === 1)
// It exists in the DOM but is invisible until the line is hovered: it is an action that
// cannot be undone, and a list full of boxes invites mistakes.
const opacidadeEmRepouso = await caixote.first().evaluate((el) => getComputedStyle(el).opacity)
check("em repouso está apagado", opacidadeEmRepouso === "0", `opacidade=${opacidadeEmRepouso}`)
await page.locator(".comment").first().hover()
await page.waitForTimeout(400)
const opacidadeAoApontar = await caixote.first().evaluate((el) => getComputedStyle(el).opacity)
check("aparece ao apontar a linha", opacidadeAoApontar === "1", `opacidade=${opacidadeAoApontar}`)
// Keyboard users have no mouse to reveal it.
await caixote.first().focus()
await page.waitForTimeout(300)
const opacidadeComFoco = await caixote.first().evaluate((el) => getComputedStyle(el).opacity)
check("aparece também com o foco do teclado", opacidadeComFoco === "1", `opacidade=${opacidadeComFoco}`)

await page.screenshot({ path: `${OUT}-antes.png`, fullPage: true })

// ------------------------------------------------------------------- apagar
await caixote.first().click()
// The question is the house's "Confirm" button, not a native dialog: you press the verb.
const pergunta = page.locator('[role="alertdialog"]').first()
if (await pergunta.isVisible({ timeout: 3000 }).catch(() => false)) {
  await pergunta.locator(".prompt-actions button").last().click()
}
await page.waitForTimeout(2000)
check("o comentário desaparece", (await page.getByText("arrependi-me disto").count()) === 0)
check(
  "o botão deixa de o contar",
  (await page.getByRole("button", { name: "Comentários" }).count()) === 1,
  (await page.locator(".vote.wide").first().innerText()).trim(),
)

// The test that separates delete from hide: the redact must be in the vault, or reload
// resurrects the comment from the recorded history.
await page.reload({ waitUntil: "domcontentloaded" })
await page.waitForTimeout(7000)
await page.getByRole("button", { name: "Feed" }).first().click()
await page.waitForTimeout(1200)
await page.getByRole("button", { name: /Comentários|comentário/ }).first().click()
await page.waitForTimeout(600)
check("continua apagado depois de recarregar", (await page.getByText("arrependi-me disto").count()) === 0)
await page.screenshot({ path: `${OUT}-depois.png`, fullPage: true })

// --------------------------------------------------------------------- mobile
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(800)
const largura = await page.evaluate(() => document.documentElement.scrollWidth)
check("no telemóvel a página não anda de lado", largura <= 390, `${largura}px`)
await page.screenshot({ path: `${OUT}-movel.png`, fullPage: true })

check("sem erros na consola", erros.length === 0, erros.slice(0, 3).join(" | "))

await browser.close()
console.log(`\n${resultados.filter(Boolean).length}/${resultados.length}`)
process.exit(resultados.every(Boolean) ? 0 : 1)

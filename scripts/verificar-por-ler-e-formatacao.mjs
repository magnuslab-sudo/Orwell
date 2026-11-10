// Live, with two accounts: jumping to unread, text formatting, and
// attachments in a post.
//
//   node scripts/verificar-por-ler-e-formatacao.mjs [url] [servidor]
import { chromium } from "playwright"
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { criarContaEEntrar } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const URL = comLingua(process.argv[2] ?? "http://127.0.0.1:5199")
const SERVIDOR = process.argv[3] ?? "localhost:8452"

const resultados = []
const check = (rotulo, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`)
}

const browser = await chromium.launch()

async function conta(nome, frase) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(URL, { waitUntil: "networkidle" })
  await criarContaEEntrar(page, { nome, frase, servidor: SERVIDOR, entrada: 40_000 })
  return { context, page }
}

// Both at the same time: the common room is moderated and whoever arrives needs
// someone online to admit them.
const alice = await conta("Alice Marca", "frase-de-teste-alice-2")
const bob = await conta("Bob Marca", "frase-de-teste-bob-2")
for (const quem of [alice, bob]) await quem.page.locator(".chat-composer").waitFor({ timeout: 90_000 })

const escrita = (page) => page.locator(".chat-composer input:not([type=file])").first()
const enviar = async (page, texto) => {
  await escrita(page).fill(texto)
  await page.getByRole("button", { name: "Enviar" }).click()
  await page.waitForTimeout(400)
}

// ------------------------------------------------------- 1. live formatting
await enviar(alice.page, "isto é **mesmo** urgente, e *não* é `código` — vê https://exemplo.pt/a*b*c")
await bob.page.locator(".message-body strong").last().waitFor({ timeout: 40_000 })

const formatado = await bob.page.evaluate(() => {
  const linha = [...document.querySelectorAll(".message-body")].pop()
  return {
    forte: linha?.querySelector("strong")?.textContent ?? null,
    enfase: linha?.querySelector("em")?.textContent ?? null,
    codigo: linha?.querySelector("code")?.textContent ?? null,
    link: linha?.querySelector("a")?.getAttribute("href") ?? null,
    marcadores: (linha?.textContent ?? "").includes("**"),
    html: linha?.innerHTML ?? "",
  }
})
check("o negrito chega desenhado ao outro lado", formatado.forte === "mesmo", String(formatado.forte))
check("o itálico também", formatado.enfase === "não", String(formatado.enfase))
check("e o código", formatado.codigo === "código", String(formatado.codigo))
check("os marcadores não ficam no ecrã", formatado.marcadores === false)
check(
  "o endereço com asteriscos chega inteiro e clicável",
  formatado.link === "https://exemplo.pt/a*b*c",
  String(formatado.link),
)
check("nada de marcação injectada: sem script nem img", !/<script|<img/i.test(formatado.html))

// ------------------------------------------------------- 2. jump to unread
//
// Bob CLOSES the app, Alice writes, and Bob comes back. This is the situation
// the marker exists to solve, and it had to be this one: while a conversation
// is open the product marks it as read at each message that arrives, that is
// what makes the count disappear on the side, and we do not change that. Moving
// to a different view (going to Settings) does NOT close the conversation, so
// it does not help measure this.
//
// `about:blank` is the app CLOSED: the session dies, but the vault and
// `lastRead` stay in storage for this context, exactly as they would in a tab
// that closes. A `reload()` would not work, Bob would still be present while
// Alice writes, and the product marks as read what arrives in an open
// conversation.
await bob.page.goto("about:blank")
await bob.page.waitForTimeout(500)

// Many, on purpose: the jump bar only appears when the marker is OUT OF SIGHT,
// and with half a dozen lines the whole conversation fits on the screen.
for (let i = 1; i <= 30; i++) await enviar(alice.page, `mensagem nova número ${i}`)

// E volta.
await bob.page.goto(URL, { waitUntil: "networkidle" })
// The lock only appears when the vault does not open on its own on this device.
const cadeado = bob.page.locator('input[type="password"]').first()
if (await cadeado.isVisible().catch(() => false)) {
  await cadeado.fill("frase-de-teste-bob-2")
  await cadeado.press("Enter")
}
await bob.page.locator(".chat-composer").waitFor({ timeout: 60_000 })
await bob.page.waitForTimeout(2500)

const marca = await bob.page.evaluate(() => {
  const m = document.querySelector(".timeline-unread-mark")
  const salto = document.querySelector(".timeline-unread-jump")
  return {
    temMarca: m !== null,
    rotulo: m?.textContent ?? null,
    seguinte: m?.nextElementSibling?.textContent ?? null,
    salto: salto?.textContent ?? null,
  }
})
check("a marca do por ler aparece na conversa", marca.temMarca, String(marca.rotulo))
check(
  "e está mesmo acima da primeira mensagem nova",
  (marca.seguinte ?? "").includes("mensagem nova número 1"),
  String(marca.seguinte).slice(0, 60),
)

// The bar only appears when the marker is out of sight. Scrolling to the bottom
// puts it there, which is what happens to someone who returns to a conversation
// with much unread.
await bob.page.evaluate(() => {
  const t = document.querySelector(".timeline")
  if (t) t.scrollTop = t.scrollHeight
})
await bob.page.waitForTimeout(500)
const barra = await bob.page.evaluate(() => document.querySelector(".timeline-unread-jump")?.textContent ?? null)
check("com a marca fora de vista, a barra de salto aparece e diz quantas são", /\d+ mensagens? por ler/.test(barra ?? ""), String(barra))

if (barra) {
  await bob.page.locator(".timeline-unread-jump").click()
  await bob.page.waitForTimeout(900)
  const visivel = await bob.page.evaluate(() => {
    const t = document.querySelector(".timeline")
    const m = document.querySelector(".timeline-unread-mark")
    if (!t || !m) return false
    const ct = t.getBoundingClientRect()
    const cm = m.getBoundingClientRect()
    return cm.top >= ct.top - 4 && cm.bottom <= ct.bottom + 4
  })
  check("carregar na barra leva mesmo à marca", visivel)
  const sumiu = await bob.page.evaluate(() => document.querySelector(".timeline-unread-jump") === null)
  check("e a barra desaparece depois de servir", sumiu)
}

// The marker does NOT move when new messages arrive with the conversation open.
await enviar(alice.page, "mais uma, com o Bob a ver")
await bob.page.waitForTimeout(1200)
const depois = await bob.page.evaluate(
  () => document.querySelector(".timeline-unread-mark")?.nextElementSibling?.textContent ?? null,
)
check(
  "a marca fica onde estava quando chegam mensagens novas",
  (depois ?? "").includes("mensagem nova número 1"),
  String(depois).slice(0, 60),
)

// ------------------------------------------------------- 3. file in a post
const pasta = mkdtempSync(join(tmpdir(), "post-anexos-"))
const pdfBytes = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(Array.from({ length: 2048 }, (_, i) => i % 256))])
const caminhoPdf = join(pasta, "acta da reunião.pdf")
writeFileSync(caminhoPdf, pdfBytes)

// Go to the feed and post with a document attached.
await alice.page.getByRole("button", { name: "Feed" }).first().click()
await alice.page.locator(".composer-actions").waitFor({ timeout: 30_000 })
const clipePost = alice.page.locator('.composer-actions label:has(input[type=file]:not([accept]))').locator("input")
await clipePost.setInputFiles([caminhoPdf])
await alice.page.locator(".composer-files li").first().waitFor({ timeout: 20_000 })
check("a ficha do ficheiro aparece no compositor do feed", true)

await alice.page.locator("textarea").first().fill("fica a acta")
await alice.page.getByRole("button", { name: "Publicar" }).click()
await alice.page.locator(".file-attachment").first().waitFor({ timeout: 30_000 })

const naPublicacao = await alice.page.evaluate(() => {
  const linha = document.querySelector(".file-attachment")
  return {
    nome: linha?.querySelector(".file-name")?.textContent ?? null,
    marca: linha?.querySelector(".file-mark")?.textContent ?? null,
    peso: linha?.querySelector(".file-meta")?.textContent ?? null,
    imagemPartida: document.querySelectorAll(".post-images img").length,
    aberturas: document.querySelectorAll(".file-attachment iframe, .file-attachment object, .file-attachment a").length,
  }
})
check("o documento aparece na publicação como linha", naPublicacao.nome === "acta da reunião.pdf", String(naPublicacao.nome))
check("com o tipo e o peso", naPublicacao.marca === "PDF" && /\d/.test(naPublicacao.peso ?? ""), `${naPublicacao.marca} · ${naPublicacao.peso}`)
check("e sem imagem partida na grelha", naPublicacao.imagemPartida === 0, `${naPublicacao.imagemPartida} imagens`)
check("nada abre o documento por dentro", naPublicacao.aberturas === 0)

// The bytes, compared one by one.
//
// From the side of whoever POSTS, not whoever follows: a post only reaches
// others after a follow relationship, which this setup does not establish. What
// the crossing between accounts proves, that bytes survive encryption and the
// server, is proven in `verificar-anexos.mjs`, with the same keys, the same
// `inline` and the same code: a post and a message differ only in the name of
// the field that carries them.
const espera = alice.page.waitForEvent("download", { timeout: 30_000 })
await alice.page.locator(".file-attachment .file-get").first().click()
const download = await espera
const destino = join(pasta, "recebido.pdf")
await download.saveAs(destino)
const { readFileSync } = await import("node:fs")
const recebido = readFileSync(destino)
check(
  "o documento da publicação grava com os bytes IGUAIS ao original",
  recebido.equals(pdfBytes),
  `${recebido.length} bytes de ${pdfBytes.length}`,
)
check("e com o nome certo", download.suggestedFilename() === "acta da reunião.pdf", download.suggestedFilename())

await browser.close()

const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações passaram`)
process.exit(falhas === 0 ? 0 : 1)

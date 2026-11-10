// Attach files, live, with two accounts against a local server.
//
// What this proves, and what no unit test proves:
//
//  1. A PDF and a ZIP leave one account and reach the other.
//  2. The bytes arrive exactly as they left. Compared one by one, not by size.
//     A matching size with swapped bytes is the exact defect an encrypted
//     attachment can have and no one would spot by eye.
//  3. A file that's too large is rejected before it leaves, with the number
//     shown.
//  4. Images open large in the chat (the bug was a missing `onOpen`).
//  5. The write bar doesn't overflow at 390px with the new box.
//
//   node scripts/verificar-anexos.mjs [url] [servidor]
import { chromium, devices } from "playwright"
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

// ---------------------------------------------------------------- files
//
// Bytes with a known pattern, not text. A base64 encoding error corrupts high
// bytes (above 0x7F) and leaves ASCII alone. So a text file would slip past a
// defect that a real file wouldn't forgive.
const pasta = mkdtempSync(join(tmpdir(), "anexos-"))
const pdfBytes = Buffer.concat([
  Buffer.from("%PDF-1.4\n"),
  Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256)),
  Buffer.from("\n%%EOF\n"),
])
const zipBytes = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from(Array.from({ length: 8192 }, (_, i) => (i * 7) % 256)),
])
const caminhoPdf = join(pasta, "relatório final.pdf")
const caminhoZip = join(pasta, "arquivo.zip")
// Too large on purpose. Above the cap for any message.
const caminhoEnorme = join(pasta, "enorme.zip")
writeFileSync(caminhoPdf, pdfBytes)
writeFileSync(caminhoZip, zipBytes)
writeFileSync(caminhoEnorme, Buffer.alloc(4_000_000, 0xab))

const browser = await chromium.launch()

/** A new account, in its own context: two vaults, two devices. */
async function conta(nome, frase) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(URL, { waitUntil: "networkidle" })
  // The server left the create screen and lives in advanced settings. Whoever needs a different one puts it here, and `criarConta` opens advanced settings on its own.
  await criarContaEEntrar(page, { nome, frase, servidor: SERVIDOR, entrada: 40_000 })
  return { context, page }
}

/**
 * Both accounts at the same time, never one at a time.
 *
 * The shared room is arbitrated. The first account creates it, and whoever arrives
 * next needs an online member to admit them. Closing Alice to open Bob leaves him
 * waiting for someone who no longer exists.
 */
const alice = await conta("Alice Anexos", "frase-de-teste-alice")
const bob = await conta("Bob Anexos", "frase-de-teste-bob")

for (const quem of [alice, bob]) {
  await quem.page.locator(".chat-composer").waitFor({ timeout: 90_000 })
}

const escrita = (page) => page.locator(".chat-composer input[type=text], .chat-composer input:not([type])").first()

// ------------------------------------------------------- 1. enviar o PDF e o ZIP
const clipe = alice.page.locator('.composer-attach:has(input:not([accept]))').locator("input")
await clipe.setInputFiles([caminhoPdf, caminhoZip])
await alice.page.locator(".composer-files li").first().waitFor({ timeout: 20_000 })

const fichas = await alice.page.locator(".composer-files li .file-name").allInnerTexts()
check("as duas fichas aparecem na caixa de escrita", fichas.length === 2, fichas.join(" · "))
const pesos = await alice.page.locator(".composer-files li .file-meta").allInnerTexts()
check("cada ficha diz quanto pesa antes de sair", pesos.every((p) => /\d/.test(p)), pesos.join(" · "))

await escrita(alice.page).fill("vão dois anexos")
await alice.page.getByRole("button", { name: "Enviar" }).click()

// ------------------------------------------------------- 2. they reach the other side
await bob.page.locator(".file-attachment").first().waitFor({ timeout: 40_000 })
const linhas = await bob.page.locator(".file-attachment .file-name").allInnerTexts()
check(
  "os dois ficheiros chegam à outra conta, com o nome",
  linhas.includes("relatório final.pdf") && linhas.includes("arquivo.zip"),
  linhas.join(" · "),
)
const marcas = await bob.page.locator(".file-attachment .file-mark").allInnerTexts()
check("a linha diz o que é", marcas.includes("PDF") && marcas.includes("ZIP"), marcas.join(" · "))

// Nothing opens inside. No viewer, no navigation.
const perigos = await bob.page.evaluate(() =>
  document.querySelectorAll(".file-attachment iframe, .file-attachment object, .file-attachment embed, .file-attachment a").length,
)
check("nada abre o ficheiro por dentro da aplicação", perigos === 0, `${perigos} elementos de abertura`)

// ------------------------------------------------------- 3. the bytes are identical
async function descarregado(nome) {
  const espera = bob.page.waitForEvent("download", { timeout: 30_000 })
  await bob.page
    .locator(".file-attachment", { has: bob.page.locator(`.file-name:text-is("${nome}")`) })
    .locator(".file-get")
    .click()
  const download = await espera
  const destino = join(pasta, `recebido-${download.suggestedFilename()}`)
  await download.saveAs(destino)
  return { destino, sugerido: download.suggestedFilename() }
}

const { readFileSync } = await import("node:fs")
for (const [nome, original] of [
  ["relatório final.pdf", pdfBytes],
  ["arquivo.zip", zipBytes],
]) {
  const { destino, sugerido } = await descarregado(nome)
  const recebido = readFileSync(destino)
  check(
    `${nome}: os bytes chegam IGUAIS ao original`,
    recebido.length === original.length && recebido.equals(original),
    `${recebido.length} bytes de ${original.length}, iguais=${recebido.equals(original)}`,
  )
  check(`${nome}: grava com o nome certo`, sugerido === nome, sugerido)
}

// ------------------------------------------------------- 4. the larger one is rejected
await clipe.setInputFiles([caminhoEnorme])
const aviso = alice.page.locator(".composer-extras .field-note.warn")
await aviso.waitFor({ timeout: 20_000 })
const texto = await aviso.innerText()
check("um ficheiro grande de mais é recusado antes de sair", /não cabe/.test(texto), texto)
check("e a recusa diz o número", /[\d,]+\s*(kB|MB)/.test(texto), texto)
const entrou = await alice.page.locator('.composer-files .file-name:text-is("enorme.zip")').count()
check("o ficheiro recusado NÃO fica agarrado à mensagem", entrou === 0)

// ------------------------------------------------------- 5. clickable image
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)
const caminhoPng = join(pasta, "ponto.png")
writeFileSync(caminhoPng, png)
await alice.page.reload({ waitUntil: "networkidle" })
await alice.page.locator(".chat-composer").waitFor({ timeout: 90_000 })
await alice.page.locator('.composer-attach input[accept*="image"]').setInputFiles([caminhoPng])
await alice.page.locator(".composer-images li").first().waitFor({ timeout: 20_000 })
await alice.page.getByRole("button", { name: "Enviar" }).click()

await bob.page.locator(".message-media .post-images").last().waitFor({ timeout: 40_000 })
const botaoImagem = bob.page.locator(".message-media .image-open").last()
check("a imagem na conversa É um botão", (await botaoImagem.count()) > 0)
if (await botaoImagem.count()) {
  await botaoImagem.click()
  const folha = bob.page.locator('[role="dialog"].lightbox, .lightbox')
  await folha.first().waitFor({ timeout: 10_000 })
  check("e abre a folha com a imagem em grande", (await folha.first().isVisible()) === true)
  await bob.page.keyboard.press("Escape")
}

// ------------------------------------------------------- 6. 390px with no overflow
//
// Shrink an account that is already in the room instead of creating a third one: the common room
// is arbitrated, and a new account needs someone online to admit it, a wait that has nothing to do
// with what we want to measure here.
const pagina = bob.page
await pagina.setViewportSize({ width: 390, height: 800 })
await pagina.waitForTimeout(600)
// On a narrow screen the conversation can be behind the channel list.
if ((await pagina.locator(".chat-composer").isVisible().catch(() => false)) === false) {
  await pagina.locator(".channel-list button, .sidebar button").first().click().catch(() => {})
  await pagina.waitForTimeout(600)
}
await pagina.locator(".chat-composer").waitFor({ timeout: 30_000 })

/**
 * Measure the input line, and measure it in both cases.
 *
 * The conversation that is open is the common room, which has no elbow room. The worst case in the
 * product is a direct conversation, which does, and that is what determines whether the text
 * field still works. Instead of creating a friendship just to measure it, we insert a sibling with
 * the class of the elbow-room button: the layout is calculated by the same CSS and the same
 * engine, so the number is true.
 *
 * Measure also without the new clip, so we can tell the owner how much it cost, which is what
 * they asked.
 */
const medida = await pagina.evaluate(() => {
  const linha = document.querySelector(".composer-line")
  const campoDe = () => Math.round(linha.querySelector("input:not([type=file])").getBoundingClientRect().width)
  const caixas = () =>
    [...linha.children].map((el) => ({
      classe: el.className || el.tagName.toLowerCase(),
      largura: Math.round(el.getBoundingClientRect().width),
    }))

  const grupoComClipe = campoDe()
  const desenho = caixas()

  // With elbow room: the direct conversation, which is the tight case.
  const falsaBuzz = document.createElement("button")
  falsaBuzz.className = "composer-buzz"
  linha.insertBefore(falsaBuzz, linha.lastElementChild)
  const dmComClipe = campoDe()

  // And without the new clip, to know what it cost.
  const clipes = [...linha.querySelectorAll(".composer-attach")]
  const clipeNovo = clipes[1]
  clipeNovo.remove()
  const dmSemClipe = campoDe()
  linha.insertBefore(clipeNovo, clipes[0].nextSibling)
  falsaBuzz.remove()

  return {
    documento: Math.round(document.documentElement.scrollWidth),
    janela: window.innerWidth,
    linha: Math.round(linha.getBoundingClientRect().width),
    grupoComClipe,
    dmComClipe,
    dmSemClipe,
    desenho,
  }
})
console.log("    caixas da linha:", JSON.stringify(medida.desenho))
console.log(`    linha: ${medida.linha}px`)
console.log(`    campo em canal de grupo, com o clipe novo: ${medida.grupoComClipe}px`)
console.log(`    campo em conversa directa, com o clipe novo: ${medida.dmComClipe}px`)
console.log(`    campo em conversa directa, SEM o clipe novo: ${medida.dmSemClipe}px`)
console.log(`    custo do clipe novo: ${medida.dmSemClipe - medida.dmComClipe}px`)
check(
  "a 390px o documento não transborda horizontalmente",
  medida.documento <= medida.janela,
  `documento ${medida.documento}px, janela ${medida.janela}px`,
)
check(
  "nenhuma caixa da linha transborda para fora dela",
  medida.desenho.reduce((soma, c) => soma + c.largura, 0) <= medida.linha,
  `${medida.desenho.reduce((soma, c) => soma + c.largura, 0)}px de caixas em ${medida.linha}px de linha`,
)

await browser.close()

const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações passaram`)
process.exit(falhas === 0 ? 0 : 1)

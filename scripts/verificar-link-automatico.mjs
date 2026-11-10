// Live check: real app, real local server, and a real website from the
// Internet. Type the address and nothing else, the title and thumbnail have to
// arrive on their own, that's the request.
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const WEB = comLingua("http://127.0.0.1:5183/")
const SERVIDOR = "127.0.0.1:8459"
const OUT = process.argv[2] ?? "/tmp/orwell-link-automatico"
// Declares Open Graph with title, description and image, and refuses to be read
// from another origin, which is exactly the case that forces going through the
// server.
const ALVO = "https://developer.mozilla.org/en-US/docs/Web/HTML"

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
  // CORS refusals show in the console by browser design, and it's the normal path
  // here: it's what starts the second try.
  if (m.type() === "error" && !/CORS|Failed to fetch|net::ERR_FAILED/i.test(m.text())) erros.push(m.text())
})
page.on("pageerror", (e) => erros.push(String(e)))

await page.goto(WEB, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(1500)

await criarConta(page, { nome: "Duarte", frase: "frase-passe-teste", servidor: SERVIDOR })
await page.waitForTimeout(6000)
check("a conta abre e o shell aparece", (await page.locator(".rail-btn").count()) > 0)

// ------------------------------------------------------------- escrever o link
await page.getByRole("button", { name: "Feed" }).first().click()
await page.waitForTimeout(500)
await page.getByRole("button", { name: "Adicionar link" }).click()
await page.waitForTimeout(300)
await page.getByPlaceholder("https://…").fill(ALVO)

// And nothing else: nobody clicks the search button.
const campoTitulo = page.getByPlaceholder("Título (opcional)").last()
await page
  .waitForFunction(
    () => {
      const campos = [...document.querySelectorAll(".link-draft input")]
      return campos.some((c) => c.placeholder?.startsWith("Título") && c.value.length > 0)
    },
    undefined,
    { timeout: 25000 },
  )
  .catch(() => {})

const titulo = await campoTitulo.inputValue()
check("o título entra sozinho, sem ninguém carregar em nada", titulo.length > 0, titulo)
check("é o título da página e não o endereço", /HTML/i.test(titulo), titulo)

const temMiniatura = (await page.locator(".link-draft-thumb img").count()) > 0
check("a miniatura entra sozinha", temMiniatura)
if (temMiniatura) {
  const fonte = await page.locator(".link-draft-thumb img").first().getAttribute("src")
  // If it were a URL, anyone reading the post would fetch it from the site, // which is exactly what this path exists to prevent.
  check("a miniatura são bytes e não um endereço para o site", String(fonte).startsWith("data:image/"), String(fonte).slice(0, 32))
  check("a miniatura já vem encolhida ao que cabe numa mensagem", String(fonte).length <= 100_000, `${String(fonte).length} caracteres`)
}

await page.screenshot({ path: `${OUT}-rascunho.png`, fullPage: true })

// ------------------------------------------------------------------- publicar
await page.getByPlaceholder(/Diz coisas/).fill("vale a pena ler isto")
await page.getByRole("button", { name: "Publicar" }).click()
await page.waitForTimeout(3000)
check("o cartão aparece publicado no feed", (await page.locator(".post .link-card").count()) === 1)
check("com o título lá dentro", (await page.locator(".post .link-title").count()) === 1, await page.locator(".post .link-title").first().innerText().catch(() => ""))
await page.screenshot({ path: `${OUT}-publicado.png`, fullPage: true })

// ------------------------------------------------------------------ YouTube
//
// The video doesn't embed: the thumbnail is a link that opens YouTube in a new
// tab. What we measure here is that reading the feed doesn't ask Google for
// anything, and that the card is that link. The click, in the browser and in
// the desktop app, is measured in `e2e-volume-youtube.mjs`.
const pedidosAoGoogle = []
page.on("request", (pedido) => {
  if (/youtube|ytimg|googlevideo|google\.com/i.test(pedido.url())) pedidosAoGoogle.push(pedido.url())
})

await page.getByRole("button", { name: "Adicionar link" }).click()
await page.waitForTimeout(300)
await page.getByPlaceholder("https://…").last().fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
// Wait for the auto-search to finish, not a random number: publishing before
// that would save an empty card and the test would measure nothing.
await page
  .waitForFunction(
    () => {
      const campos = [...document.querySelectorAll(".link-draft input")]
      return campos.some((c) => c.placeholder?.startsWith("Título") && c.value.length > 0)
    },
    undefined,
    { timeout: 25000 },
  )
  .catch(() => {})
await page.getByPlaceholder(/Diz coisas/).fill("um vídeo")
await page.getByRole("button", { name: "Publicar" }).click()
await page.waitForTimeout(3000)

const fachada = page.locator(".link-card.video-facade").first()
check("o vídeo aparece como miniatura e não como leitor já carregado", (await fachada.count()) === 1)
check("a frio não há iframe nenhum na página", (await page.locator("iframe").count()) === 0)
check(
  "nada foi pedido ao Google só por se olhar para o feed",
  pedidosAoGoogle.length === 0,
  pedidosAoGoogle.slice(0, 2).join(" | "),
)
if ((await fachada.count()) === 1) {
  check("o cartão abre o YouTube", String(await fachada.getAttribute("href")).startsWith("https://www.youtube.com/watch?v="))
  const rel = String(await fachada.getAttribute("rel"))
  // `noopener` alone let the Referer through; `noreferrer` alone let
  // `window.opener` through. You need both.
  check("com noopener e noreferrer, os dois", rel.includes("noopener") && rel.includes("noreferrer"), rel)
  check("num separador novo", (await fachada.getAttribute("target")) === "_blank")
  check("com o botão de reprodução por cima da miniatura", (await fachada.locator(".facade-play").count()) === 1)
  // A card without a thumbnail is a grey box, and that's what the card came to
  // prevent. YouTube's page declares Open Graph at byte 691,000, and that's why
  // the thumbnail comes through oEmbed instead of scraping HTML.
  const temImagem = (await fachada.locator(".facade-thumb").count()) === 1
  check("a fachada mostra a miniatura do vídeo, e não uma caixa vazia", temImagem)
  if (temImagem) {
    const fonte = String(await fachada.locator(".facade-thumb").getAttribute("src"))
    check("a miniatura são bytes, e não um endereço do Google", fonte.startsWith("data:image/"), fonte.slice(0, 28))
  }
  check(
    "e o título do vídeo",
    (await fachada.locator(".link-title").count()) === 1,
    await fachada.locator(".link-title").innerText().catch(() => ""),
  )
}
await page.screenshot({ path: `${OUT}-youtube.png`, fullPage: true })

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

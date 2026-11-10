// The interface language, in a real browser.
//
// What tests CAN'T prove: inside jsdom detection doesn't run, on purpose, that's
// the decision that keeps 2728 assertions written against Portuguese text
// passing. The price of that decision is that the entire detection path
// (Chromium's `navigator.languages`, the host's `arrancarLingua()`, the
// `<html lang>`) has not one assertion on it.
//
// This script is that assertion. It serves `apps/web/dist` on its own server
// and opens it four times, with four combinations of browser language, URL, and
// saved choice.
//
//   npm run build -w @enclave/web
//   node scripts/verificar-lingua.mjs
//
// No homeserver: everything it measures is in the first step of account
// creation, which comes before any connection anywhere. It's also the first
// screen a new person sees, so it has to be in the right language most of all:
// someone who opens this and doesn't understand the question closes the window.
import { createReadStream, existsSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, normalize, resolve } from "node:path"
import { chromium } from "playwright"

const DIST = resolve(process.argv[2] ?? "apps/web/dist")

if (!existsSync(join(DIST, "index.html"))) {
  console.error(`Não há nada construído em ${DIST}.`)
  console.error("Corre primeiro:  npm run build -w @enclave/web")
  process.exit(2)
}

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
}

/*
  The `/app/` is part of the URL: the `vite.config.ts` in `@enclave/web`
  declares `base: "/app/"` since the homepage took the domain root. Served at
  the root, the HTML would load and the modules wouldn't, and the symptom would
  be a blank screen with no visible error.
*/
const servidor = createServer((pedido, resposta) => {
  const caminho = decodeURIComponent(new URL(pedido.url, "http://x").pathname).replace(/^\/app\/?/, "/")
  const ficheiro = join(DIST, normalize(caminho === "/" ? "/index.html" : caminho))
  if (!ficheiro.startsWith(DIST) || !existsSync(ficheiro)) {
    resposta.writeHead(404).end("não existe")
    return
  }
  resposta.writeHead(200, { "content-type": TIPOS[extname(ficheiro)] ?? "application/octet-stream" })
  createReadStream(ficheiro).pipe(resposta)
})

await new Promise((pronto) => servidor.listen(0, "127.0.0.1", pronto))
const BASE = `http://127.0.0.1:${servidor.address().port}/app/`

const resultados = []
const check = (rotulo, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${rotulo}${detalhe ? `  ${detalhe}` : ""}`)
}

const browser = await chromium.launch()

/**
 * Opens the app and returns what the account creation screen says.
 *
 * `locale` in context is what makes Chromium announce a different language in
 * `navigator.languages`, which is what the product reads. Here it's legitimate
 *, this script exists to measure detection, while in other scripts it would
 * be the opposite: see the note on `comLingua` in `ambiente.mjs`.
 */
async function abrir({ locale, endereco = BASE, guardada }) {
  const contexto = await browser.newContext({ locale, viewport: { width: 1280, height: 900 } })
  const pagina = await contexto.newPage()
  const erros = []
  pagina.on("pageerror", (e) => erros.push(String(e)))

  if (guardada) {
    // Before any page script: this is what a choice already made in Settings looks
    // like on the next visit.
    await contexto.addInitScript(
      ([chave, valor]) => window.localStorage.setItem(chave, valor),
      ["enclave.lingua", guardada],
    )
  }

  await pagina.goto(endereco, { waitUntil: "networkidle" })
  await pagina.waitForSelector("h1, h2", { timeout: 20_000 })

  const visto = {
    lang: await pagina.evaluate(() => document.documentElement.lang),
    texto: await pagina.evaluate(() => document.body.innerText),
    erros,
  }
  await contexto.close()
  return visto
}

/*
  The two sentences that identify the screen's language.

  The first step of the wizard, not the "Create account" title: that only shows
  in the single-step variant. These two are always in the first render, and
  they're the question and the step counter, the two things someone opening the
  app reads first.
*/
const EM_PORTUGUES = ["Passo 1 de", "Como queres mostrar o teu nome?"]
const EM_INGLES = ["Step 1 of", "How do you want your name shown?"]

const diz = (texto, frases) => frases.every((frase) => texto.includes(frase))
const naoDiz = (texto, frases) => frases.every((frase) => !texto.includes(frase))

// ------------------------------------------------------- 1. browser in English
{
  const { lang, texto, erros } = await abrir({ locale: "en-US" })
  check("browser em inglês: a interface fala inglês", diz(texto, EM_INGLES), `lang=${lang}`)
  check("e não sobra português no ecrã", naoDiz(texto, EM_PORTUGUES))
  check("o <html lang> acompanha", lang === "en", `lang=${lang}`)
  check("sem erros na consola", erros.length === 0, erros.join(" | "))
}

// ---------------------------------------------------- 2. browser in Portuguese
{
  const { lang, texto } = await abrir({ locale: "pt-PT" })
  check("browser em português: a interface fala português", diz(texto, EM_PORTUGUES), `lang=${lang}`)
  check("e não sobra inglês no ecrã", naoDiz(texto, EM_INGLES))
  check("o <html lang> acompanha", lang === "pt", `lang=${lang}`)
}

// ------------------------------- 3. the URL decides, and it locks the tests
{
  const { lang, texto } = await abrir({ locale: "en-US", endereco: `${BASE}?lingua=pt` })
  check("?lingua=pt ganha a um browser inglês", diz(texto, EM_PORTUGUES), `lang=${lang}`)
  check("é esta a tranca que segura os 35 guiões", naoDiz(texto, EM_INGLES))
}

// ---------------------- 4. saved choice wins the system: it's the selector
{
  const { lang, texto } = await abrir({ locale: "pt-PT", guardada: "en" })
  check("a escolha guardada ganha ao sistema", diz(texto, EM_INGLES), `lang=${lang}`)
  check("e o sistema não a desfaz ao recarregar", naoDiz(texto, EM_PORTUGUES))
}

// ------------------------------------ 5. a language that doesn't exist falls back
{
  const { texto } = await abrir({ locale: "de-DE" })
  check("um sistema alemão cai no português, e nunca numa chave em cru", diz(texto, EM_PORTUGUES))
  check("e não mostra chaves", !/\b(gate|settings|sidebar)\.\w+/.test(texto))
}

await browser.close()
servidor.close()

const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} passaram`)
process.exit(falhas === 0 ? 0 : 1)

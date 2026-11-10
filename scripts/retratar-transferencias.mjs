/**
 * The downloads page in both languages, screenshotted at 1440 and 390 px.
 *
 *   cd apps/site && npx vite build && cd ../..
 *   node scripts/retratar-transferencias.mjs            (or: ... site-v3, for another prefix)
 *
 * The page is generated when installers are published and does not live on the site. To
 * see it, this script generates both versions with test installers (made-up names,
 * sizes and checksums, real version and stylesheet) into `apps/site/dist`, in
 * `transferencias/` and `pt/transferencias/`, serves them with `vite preview` and
 * deletes them after. Writes `capturas/transferencias-<en|pt>-<largura>.png`, or
 * `capturas/<prefixo>-<en|pt>-transferencias-<largura>.png` with a prefix
 * (and `-1440-windows.png`, posing as Windows, with the Windows button first) and
 * measures the same as `retratar-site-linguas.mjs`: nothing exceeds width, console
 * clean, `lang` correct, selector visible in footer and absent from top.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { CAMINHOS, paginaDeTransferencias } from "./pagina-de-transferencias.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const SITE = join(RAIZ, "apps/site")
const DIST = join(SITE, "dist")
const PORTA = 8514
const PREFIXO = process.argv[2]

if (!existsSync(join(DIST, "pt/index.html"))) {
  console.error("Falta o site construído. Corre `cd apps/site && npx vite build` primeiro.")
  process.exit(2)
}

const raiz = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8"))
const assets = readdirSync(join(DIST, "assets"))
const folha = assets.find((nome) => nome.endsWith(".css"))
const guiao = assets.find((nome) => /^sistema-[\w-]+\.js$/.test(nome))
const fonteHtml = readFileSync(join(SITE, "index.html"), "utf8")
const simbolo = (id) => {
  const abre = fonteHtml.indexOf(`<symbol id="${id}"`)
  return fonteHtml.slice(abre, fonteHtml.indexOf("</symbol>", abre) + "</symbol>".length)
}
const dados = {
  versao: raiz.version,
  versaoCurta: raiz.version.split(".").slice(0, 2).join("."),
  nomeDaVersao: raiz.nomeDaVersao,
  folha,
  guiao,
  simbolos: ["i-marca", "i-secretaria", "i-browser", "i-escudo"].map(simbolo).join("\n        "),
  ficheiros: [
    { nome: `Orwell-${raiz.version}-macos-universal.dmg`, sistema: "macOS", bytes: 231 * 1024 * 1024, soma: "3f".repeat(32) },
    { nome: `Orwell-${raiz.version}-windows-x64.exe`, sistema: "Windows", bytes: 118 * 1024 * 1024, soma: "a7".repeat(32) },
  ],
}

const pastas = { en: join(DIST, "transferencias"), pt: join(DIST, "pt/transferencias") }
for (const lingua of ["en", "pt"]) {
  if (existsSync(pastas[lingua])) {
    console.error(`Já existe ${pastas[lingua]}; apaga-o antes de retratar.`)
    process.exit(2)
  }
}
for (const lingua of ["en", "pt"]) {
  mkdirSync(pastas[lingua], { recursive: true })
  writeFileSync(join(pastas[lingua], "index.html"), paginaDeTransferencias(lingua, dados))
}

const preview = spawn("npx", ["vite", "preview", "--port", String(PORTA), "--strictPort", "--host", "127.0.0.1"], {
  cwd: SITE,
  stdio: ["ignore", "pipe", "pipe"],
})
const endereco = `http://127.0.0.1:${PORTA}`
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

let falhas = 0
let browser
try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${endereco}/`)).ok) break
    } catch {}
    if (i > 50) throw new Error("O vite preview não arrancou.")
    await new Promise((r) => setTimeout(r, 200))
  }
  browser = await chromium.launch()
  for (const lingua of ["en", "pt"]) {
    // The third run poses as Windows: the Windows button must come first (on Mac and
    // mobile it already is in the markup).
    for (const [largura, windows] of [
      [1440, false],
      [390, false],
      [1440, true],
    ]) {
      const movel = largura === 390
      const contexto = await browser.newContext({
        viewport: { width: largura, height: 900 },
        deviceScaleFactor: 1,
        locale: lingua === "en" ? "en-GB" : "pt-PT",
        ...(movel ? { userAgent: IPHONE, isMobile: true, hasTouch: true } : {}),
        ...(windows ? { userAgent: WINDOWS } : {}),
      })
      if (windows) await contexto.addInitScript(() => Object.defineProperty(navigator, "platform", { get: () => "Win32" }))
      const pagina = await contexto.newPage()
      const erros = []
      pagina.on("console", (m) => {
        if (m.type() === "error" && !m.text().includes("frame-ancestors")) erros.push(m.text())
      })
      pagina.on("pageerror", (e) => erros.push(String(e)))
      await pagina.goto(`${endereco}${CAMINHOS[lingua]}index.html`, { waitUntil: "networkidle" })
      await pagina.evaluate(() => document.fonts.ready)
      const medido = await pagina.evaluate(() => {
        const caixa = document.querySelector(".rodape .linguas")?.getBoundingClientRect()
        // The button that appears first, and the system the script detected.
        const primeiro = [...document.querySelectorAll(".instalador")].sort(
          (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left,
        )[0]
        return {
          sistema: document.documentElement.dataset.sistema ?? "",
          noTopo: !!document.querySelector(".topo .linguas"),
          primeiro: primeiro?.className.replace("instalador ", "") ?? "",
          largo: document.documentElement.scrollWidth,
          lang: document.documentElement.lang,
          selectorVisivel: !!caixa && caixa.width > 0 && caixa.right <= window.innerWidth,
        }
      })
      const langCerta = lingua === "en" ? medido.lang === "en" : medido.lang === "pt-PT"
      const ordemCerta = !["windows", "macos"].includes(medido.sistema) || medido.primeiro === `instalador-${medido.sistema}`
      if (windows && medido.sistema !== "windows") falhas++
      const ok = medido.largo <= largura && erros.length === 0 && langCerta && medido.selectorVisivel && !medido.noTopo && ordemCerta
      if (!ok) falhas++
      console.log(
        `${ok ? "  ok  " : " FALHA"} ${CAMINHOS[lingua]} ${largura} px: scrollWidth ${medido.largo}, lang ${medido.lang}, selector no rodapé ${medido.selectorVisivel ? "à vista" : "ESCONDIDO"}${medido.noTopo ? ", E NO TOPO" : ""}, sistema "${medido.sistema}", primeiro ${medido.primeiro}${erros.length ? `, erros: ${erros.join(" | ")}` : ""}`,
      )
      const fim = `${largura}${windows ? "-windows" : ""}.png`
      const ficheiro = join(RAIZ, PREFIXO ? `capturas/${PREFIXO}-${lingua}-transferencias-${fim}` : `capturas/transferencias-${lingua}-${fim}`)
      await pagina.screenshot({ path: ficheiro, fullPage: true })
      console.log(`       ${ficheiro}`)
      await contexto.close()
    }
  }
} finally {
  await browser?.close()
  preview.kill()
  rmSync(pastas.en, { recursive: true, force: true })
  rmSync(pastas.pt, { recursive: true, force: true })
}
process.exit(falhas ? 1 : 0)

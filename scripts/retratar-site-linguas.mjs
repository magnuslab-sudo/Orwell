/**
 * The site in both languages, screenshotted at 1440 and 390 px.
 *
 *   cd apps/site && npx vite build && cd ../..
 *   node scripts/retratar-site-linguas.mjs            (or: ... site-v3, for another prefix)
 *
 * English at the root and Portuguese in `/pt/` since 3 November 2026. Starts
 * `vite preview` for `apps/site` on its own port (8513) and writes, per language,
 * the landing page, the ambassadors page and both legal pages, full:
 * `capturas/<prefixo>-<en|pt>-<largura>.png` (landing page) and
 * `capturas/<prefixo>-<en|pt>-<página>-<largura>.png`, with prefix `site`
 * by default. At 390 px the browser presents as an iPhone. Measures what can be
 * measured without eyes: nothing exceeds window width, console is clean,
 * `<html lang>` matches the language and the "EN · PT" selector is visible in
 * the footer, not the top (since 3 November 2026, owner request).
 *
 * `vite preview` does not perform Caddyfile redirects: those are tested
 * with Caddy (see `docs/planos/site-ingles-relatorio.md`).
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const SITE = join(RAIZ, "apps/site")
const PORTA = 8513
const PREFIXO = process.argv[2] ?? "site"

if (!existsSync(join(SITE, "dist/pt/index.html"))) {
  console.error("Falta o site construído nas duas línguas. Corre `cd apps/site && npx vite build` primeiro.")
  process.exit(2)
}

const preview = spawn("npx", ["vite", "preview", "--port", String(PORTA), "--strictPort", "--host", "127.0.0.1"], {
  cwd: SITE,
  stdio: ["ignore", "pipe", "pipe"],
})
const endereco = `http://127.0.0.1:${PORTA}`
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${endereco}/`)).ok) break
  } catch {}
  if (i > 50) {
    console.error("O vite preview não arrancou.")
    preview.kill()
    process.exit(2)
  }
  await new Promise((r) => setTimeout(r, 200))
}

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

const PAGINAS = {
  en: [
    ["/", ""],
    ["/ambassadors.html", "ambassadors-"],
    ["/privacy.html", "privacy-"],
    ["/terms.html", "terms-"],
  ],
  pt: [
    ["/pt/", ""],
    ["/pt/embaixadores.html", "embaixadores-"],
    ["/pt/privacidade.html", "privacidade-"],
    ["/pt/termos.html", "termos-"],
  ],
}

let falhas = 0
const browser = await chromium.launch()
try {
  for (const [lingua, paginas] of Object.entries(PAGINAS)) {
    for (const [caminho, nome] of paginas) {
      for (const largura of [1440, 390]) {
        const movel = largura === 390
        const contexto = await browser.newContext({
          viewport: { width: largura, height: 900 },
          deviceScaleFactor: 1,
          locale: lingua === "en" ? "en-GB" : "pt-PT",
          ...(movel ? { userAgent: IPHONE, isMobile: true, hasTouch: true } : {}),
        })
        const pagina = await contexto.newPage()
        const erros = []
        pagina.on("console", (m) => {
          if (m.type() === "error" && !m.text().includes("frame-ancestors")) erros.push(m.text())
        })
        pagina.on("pageerror", (e) => erros.push(String(e)))
        await pagina.goto(endereco + caminho, { waitUntil: "networkidle" })
        await pagina.evaluate(() => document.fonts.ready)
        const medido = await pagina.evaluate(() => {
          const selector = document.querySelector(".rodape .linguas")
          const caixa = selector?.getBoundingClientRect()
          return {
            noTopo: !!document.querySelector(".topo .linguas"),
            largo: document.documentElement.scrollWidth,
            lang: document.documentElement.lang,
            selectorVisivel: !!caixa && caixa.width > 0 && caixa.right <= window.innerWidth,
          }
        })
        const langCerta = lingua === "en" ? medido.lang === "en" : medido.lang === "pt-PT"
        const ok = medido.largo <= largura && erros.length === 0 && langCerta && medido.selectorVisivel && !medido.noTopo
        if (!ok) falhas++
        console.log(
          `${ok ? "  ok  " : " FALHA"} ${caminho} ${largura} px: scrollWidth ${medido.largo}, lang ${medido.lang}, selector no rodapé ${medido.selectorVisivel ? "à vista" : "ESCONDIDO"}${medido.noTopo ? ", E NO TOPO" : ""}${erros.length ? `, erros: ${erros.join(" | ")}` : ""}`,
        )
        const ficheiro = join(RAIZ, `capturas/${PREFIXO}-${lingua}-${nome}${largura}.png`)
        await pagina.screenshot({ path: ficheiro, fullPage: true })
        console.log(`       ${ficheiro}`)
        await contexto.close()
      }
    }
  }
} finally {
  await browser.close()
  preview.kill()
}
process.exit(falhas ? 1 : 0)

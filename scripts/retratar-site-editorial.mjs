/**
 * The landing page and ambassadors page (Portuguese versions, in `/pt/`
 * since 3 November 2026), screenshotted at 1440 and 390 px.
 *
 *   cd apps/site && npx vite build && cd ../..
 *   node scripts/retratar-site-editorial.mjs before     (or: after)
 *
 * Starts `vite preview` for `apps/site` on its own port (8512), captures the
 * full pages at both widths and writes `capturas/site-editorial-<etapa>-<largura>.png`
 * (landing page) and `capturas/site-editorial-embaixadores-<etapa>-<largura>.png`.
 * At 390 px the browser presents as an iPhone, so the main button is what mobile sees;
 * at 1440 px it is Chromium on Mac, and the button is macOS. Also captures at 1440 px
 * with Windows user agent (`-windows`). Measures what can be measured without eyes:
 * nothing exceeds window width and the console is clean. The site connects to nothing,
 * so there is no homeserver.
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const SITE = join(RAIZ, "apps/site")
const PORTA = 8512
const etapa = process.argv[2] ?? "depois"

if (!existsSync(join(SITE, "dist/index.html"))) {
  console.error("Falta o site construído. Corre `cd apps/site && npx vite build` primeiro.")
  process.exit(2)
}

const preview = spawn("npx", ["vite", "preview", "--port", String(PORTA), "--strictPort", "--host", "127.0.0.1"], {
  cwd: SITE,
  stdio: ["ignore", "pipe", "pipe"],
})
const endereco = `http://127.0.0.1:${PORTA}/`
for (let i = 0; ; i++) {
  try {
    if ((await fetch(endereco)).ok) break
  } catch {}
  if (i > 50) {
    console.error("O vite preview não arrancou.")
    preview.kill()
    process.exit(2)
  }
  await new Promise((r) => setTimeout(r, 200))
}

let falhas = 0
const browser = await chromium.launch()
try {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
  const WINDOWS =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
  const casos = [
    { caminho: "pt/", nome: "", largura: 1440 },
    { caminho: "pt/", nome: "-windows", largura: 1440, agente: WINDOWS, soPrimeiroEcra: true },
    { caminho: "pt/", nome: "", largura: 390, agente: IPHONE },
    { caminho: "pt/embaixadores.html", nome: "embaixadores-", largura: 1440 },
    { caminho: "pt/embaixadores.html", nome: "embaixadores-", largura: 390, agente: IPHONE },
  ]
  for (const { caminho, nome, largura, agente, soPrimeiroEcra } of casos) {
    for (const movimento of ["no-preference", "reduce"]) {
      const contexto = await browser.newContext({
        viewport: { width: largura, height: 900 },
        deviceScaleFactor: 1,
        reducedMotion: movimento,
        ...(agente ? { userAgent: agente } : {}),
        ...(agente === IPHONE ? { isMobile: true, hasTouch: true } : {}),
      })
      const pagina = await contexto.newPage()
      const erros = []
      pagina.on("console", (m) => {
        if (m.type() === "error" && !m.text().includes("frame-ancestors")) erros.push(m.text())
      })
      pagina.on("pageerror", (e) => erros.push(String(e)))
      await pagina.goto(endereco + caminho, { waitUntil: "networkidle" })
      await pagina.evaluate(() => document.fonts.ready)
      const largo = await pagina.evaluate(() => document.documentElement.scrollWidth)
      const sistema = await pagina.evaluate(() => document.documentElement.dataset.sistema ?? "nenhum")
      const ok = largo <= largura && erros.length === 0
      if (!ok) falhas++
      console.log(
        `${ok ? "  ok  " : " FALHA"} /${caminho} ${largura} px${nome.startsWith("-") ? ` ${nome.slice(1)}` : ""}, movimento ${movimento}: scrollWidth ${largo}, sistema ${sistema}${erros.length ? `, erros: ${erros.join(" | ")}` : ""}`,
      )
      if (movimento === "no-preference") {
        const ficheiro = nome.startsWith("-")
          ? join(RAIZ, `capturas/site-editorial-${etapa}-${largura}${nome}.png`)
          : join(RAIZ, `capturas/site-editorial-${nome}${etapa}-${largura}.png`)
        await pagina.screenshot({ path: ficheiro, fullPage: !soPrimeiroEcra })
        console.log(`       ${ficheiro}`)
      }
      await contexto.close()
    }
  }
} finally {
  await browser.close()
  preview.kill()
}
process.exit(falhas ? 1 : 0)

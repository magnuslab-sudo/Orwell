/**
 * The card of the person sharing the screen, "A with C" (owner, 2 November 2026),
 * in a real layout engine.
 *
 * The card tests run in jsdom, which does not apply stylesheets and does not
 * know about hovering. This sets up the real `CallChip`, with the real
 * stylesheet, in the room grid (`.call-people`), at 1280 px: the sharer (with
 * the invite), our card sharing (just the seal) and a person not sharing.
 * Checks:
 *
 * - the "LIVE" seal at top left, red, and the eye with the number next to it;
 * - the invite invisible at rest and visible on hover;
 * - clicking the middle of the card opens the share, and the volume slider
 *   keeps receiving clicks on hover (the invite does not cover it);
 * - with reduced motion, the dot keeps pulsing, slower.
 *
 * Captures `capturas/ao-vivo-1280.png` (at rest) and `capturas/ao-vivo-1280-rato.png`.
 *
 *   node scripts/retratar-ao-vivo.mjs
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, "..")
const SAIDA = join(AQUI, ".saida-ao-vivo")
const CAPTURAS = join(RAIZ, "capturas")
const UI = (caminho) => JSON.stringify(join(RAIZ, "packages/ui/src", caminho))

mkdirSync(SAIDA, { recursive: true })
mkdirSync(CAPTURAS, { recursive: true })

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { CallChip } from ${UI("screens/call/CallChip.js")}
import { MarcaDeChamada } from ${UI("components/MarcaDeChamada.js")}
import ${UI("styles.css")}

window.__ver = 0
window.__volume = 0

function Demo() {
  const perfil = (nome) => ({ displayName: nome, donations: [] })
  return (
    <section className="call call-sala" style={{ height: "100vh", padding: 16 }}>
      <div className="call-corpo">
        <div className="call-people">
          <span className="call-person" data-quem="partilha">
            <CallChip label="Kaori" profile={perfil("Kaori")} texto="ligada" presence="active"
              volume={1} onVolume={() => { window.__volume += 1 }} onMenu={() => {}}
              aoVivo={{ aVer: 3, onVer: () => { window.__ver += 1 } }} />
            <span className="call-person-marcas">
              <MarcaDeChamada tipo="ecra" nome="Kaori" className="screen-badge" />
            </span>
          </span>
          <span className="call-person" data-quem="eu">
            <CallChip label="Duarte" profile={perfil("Duarte")} texto="tu" presence="active" proprio aoVivo={{ aVer: 3 }} />
            <span className="call-person-marcas">
              <MarcaDeChamada tipo="ecra" nome="Duarte" className="screen-badge" />
            </span>
          </span>
          <span className="call-person" data-quem="voz">
            <CallChip label="Rui" profile={perfil("Rui")} texto="ligada" presence="active" volume={1} onVolume={() => {}} />
            <span className="call-person-marcas" />
          </span>
        </div>
      </div>
    </section>
  )
}
createRoot(document.getElementById("raiz")).render(<Demo />)
`,
  "utf8",
)

await build({
  entryPoints: [ENTRADA],
  bundle: true,
  outfile: join(SAIDA, "pagina.js"),
  jsx: "automatic",
  loader: { ".css": "css", ".tsx": "tsx", ".ts": "ts", ".json": "json", ".woff2": "file" },
  external: ["@sapphi-red/*"],
  format: "iife",
  logLevel: "error",
})
writeFileSync(
  join(SAIDA, "index.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="pagina.css"><body><div id="raiz"></div><script src="pagina.js"></script></body>`,
  "utf8",
)

const browser = await chromium.launch()
const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? `: ${detalhe}` : ""}`)
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const erros = []
page.on("pageerror", (e) => erros.push(String(e)))
await page.goto(`file://${join(SAIDA, "index.html")}`)
await page.waitForSelector(".ao-vivo-selo", { timeout: 10_000 })
await page.evaluate(() => document.fonts.ready)
await page.mouse.move(1, 1)
await page.waitForTimeout(400)

const medir = () =>
  page.evaluate(() => {
    const caixa = (el) => (el ? JSON.parse(JSON.stringify(el.getBoundingClientRect())) : null)
    const raiz = document.querySelector('[data-quem="partilha"]')
    const selo = raiz.querySelector(".ao-vivo-selo")
    return {
      cartao: caixa(raiz.querySelector(".call-chip")),
      selo: caixa(selo),
      seloCor: getComputedStyle(selo).backgroundColor,
      busy: getComputedStyle(document.documentElement).getPropertyValue("--presence-busy").trim(),
      olho: caixa(raiz.querySelector(".ao-vivo-a-ver")),
      olhoTexto: raiz.querySelector(".ao-vivo-a-ver")?.textContent,
      convite: Number(getComputedStyle(raiz.querySelector(".ao-vivo-convite")).opacity),
      conviteNoNosso: document.querySelector('[data-quem="eu"] .ao-vivo-convite'),
      seloNoNosso: !!document.querySelector('[data-quem="eu"] .ao-vivo-selo'),
      semNada: !document.querySelector('[data-quem="voz"] .ao-vivo-selo'),
      ponto: getComputedStyle(raiz.querySelector(".ao-vivo-ponto")).animationDuration,
      pagina: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })

const repouso = await medir()
check("sem erros na página", erros.length === 0, erros.join(" | "))
check("a página não rola de lado", repouso.pagina <= 0, String(repouso.pagina))
check(
  "o selo fica em cima à esquerda do cartão",
  repouso.selo.left - repouso.cartao.left < 20 && repouso.selo.top - repouso.cartao.top < 20,
  `${Math.round(repouso.selo.left - repouso.cartao.left)} · ${Math.round(repouso.selo.top - repouso.cartao.top)} px`,
)
check("o selo é vermelho cheio (--presence-busy)", repouso.seloCor === "rgb(255, 92, 92)", `${repouso.seloCor} · ${repouso.busy}`)
check("o olho fica ao lado do selo, com o número", repouso.olho.left >= repouso.selo.right && repouso.olhoTexto === "3")
check("em repouso o convite não se vê", repouso.convite === 0, String(repouso.convite))
check("o nosso cartão: selo, sem convite", repouso.seloNoNosso && repouso.conviteNoNosso === null)
check("sem partilha, sem selo", repouso.semNada)
check("o ponto pulsa", repouso.ponto !== "0s", repouso.ponto)
await page.locator('[data-quem="partilha"]').screenshot({ path: join(CAPTURAS, "ao-vivo-1280.png") })
await page.screenshot({ path: join(SAIDA, "sala-1280.png") })

// On hover.
const cartao = page.locator('[data-quem="partilha"] .call-chip')
await cartao.hover()
await page.waitForTimeout(400)
const rato = await medir()
check("com o rato por cima o convite aparece", rato.convite === 1, String(rato.convite))
await page.locator('[data-quem="partilha"]').screenshot({ path: join(CAPTURAS, "ao-vivo-1280-rato.png") })

// The volume slider keeps receiving clicks: Playwright refuses the click if
// another element is on top of it.
await page.click('[data-quem="partilha"] .chip-volume input', { timeout: 2000 })
const depoisDoVolume = await page.evaluate(() => ({ ver: window.__ver }))
check("o volume não abre a partilha, e não está tapado", depoisDoVolume.ver === 0, JSON.stringify(depoisDoVolume))
await page.click('[data-quem="partilha"] .ao-vivo-ver', { timeout: 2000 })
await cartao.click({ position: { x: 30, y: 200 } })
check("o botão e o resto do cartão abrem a partilha", (await page.evaluate(() => window.__ver)) === 2)
await ctx.close()

// Reduced motion: the dot keeps pulsing, slower.
const reduzido = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" })
const p2 = await reduzido.newPage()
await p2.goto(`file://${join(SAIDA, "index.html")}`)
await p2.waitForSelector(".ao-vivo-ponto")
const animacao = await p2.evaluate(() => {
  const estilo = getComputedStyle(document.querySelector(".ao-vivo-ponto"))
  return { duracao: estilo.animationDuration, vezes: estilo.animationIterationCount, nome: estilo.animationName }
})
check(
  "com movimento reduzido o ponto continua a pulsar, mais devagar",
  parseFloat(animacao.duracao) > 1.4 && animacao.vezes === "infinite" && animacao.nome === "ao-vivo-respira",
  JSON.stringify(animacao),
)
await reduzido.close()

await browser.close()
const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`)
process.exit(falhas === 0 ? 0 : 1)

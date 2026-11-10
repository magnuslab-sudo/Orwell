// Empty states, measured in a real layout engine.
//
// Why this exists instead of another test: tests run in jsdom, and jsdom
// DOES NOT APPLY ANY STYLESHEETS. It proves that the right text is on screen;
// it does not know if it is centered in the column or stuck to the top, or if
// the three lines of text fit on a phone without running off the right edge.
//
// And a badly centered empty state is worse than having none: a blank screen
// reads as "still loading", and a paragraph stuck in the top corner reads as a
// bug. It was a flaw in this family, `.empty-state` is born claiming the
// `timeline` area of the grid, and inside the scroller that is ignored, that
// prompted the ruler.
//
// What we measure, in the two widths that matter:
//
//   1. The box is CENTERED in the column, horizontally and vertically.
//   2. It does not run off the right: no horizontal offset.
//   3. The text has real height, a phrase with inherited `font-size: 0` would
//      pass in jsdom and be invisible here.
//   4. The gate, when it exists, is clickable: a button with area.
//
// What it does NOT prove: that the chosen state is the right one. That is
// `vazioDaConversa` and the tree tests, which run fast and can read.
//
//   node scripts/medir-vazios.mjs
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, ".saida-vazios")
mkdirSync(SAIDA, { recursive: true })

const ENTRADA = join(SAIDA, "pagina.tsx")

/**
 * The cases, by the name they have in the product.
 *
 * `conversa-*` mounts the `Timeline` inside the real grid of the chat screen,
 * because that is where the grid area flaw lived. The others mount the screen
 * that holds them, with the same three-column shell as the app.
 */
const CASOS = [
  "conversa-nova",
  "conversa-despejado",
  "conversa-por-abrir",
  "amigos-sem-resultados",
  "fixadas-vazias",
]

writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import "${join(AQUI, "../packages/ui/src/styles.css").replace(/\\/g, "/")}"
import { Timeline } from "${join(AQUI, "../packages/ui/src/screens/chat/Timeline.tsx").replace(/\\/g, "/")}"
import { PinnedPanel } from "${join(AQUI, "../packages/ui/src/screens/chat/PinnedPanel.tsx").replace(/\\/g, "/")}"
import { PeopleScreen } from "${join(AQUI, "../packages/ui/src/screens/people/PeopleScreen.tsx").replace(/\\/g, "/")}"
import { ToastProvider } from "${join(AQUI, "../packages/ui/src/components/Toast.tsx").replace(/\\/g, "/")}"

const caso = new URLSearchParams(location.search).get("caso") ?? "conversa-nova"

const vazio = () => {}
const directorio = new Map([
  ["@eu:s", { displayName: "Eu", donations: [] }],
  ["@ana:s", { displayName: "Ana", donations: [] }],
  ["@zoe:s", { displayName: "Zoé", donations: [] }],
])

/** A Timeline dentro da grelha REAL do ecrã de conversa. Ver \`.main\`. */
function conversa(props) {
  return (
    <main className="main">
      <Timeline
        channel="!sala:s"
        messages={[]}
        pending={[]}
        onRetry={vazio}
        onDiscard={vazio}
        me="@eu:s"
        nameFor={(quem) => directorio.get(quem)?.displayName ?? quem}
        directory={directorio}
        {...props}
      />
    </main>
  )
}

const corpo =
  caso === "conversa-nova"
    ? conversa({})
    : caso === "conversa-despejado"
      ? conversa({ hasStoredHistory: true })
      : caso === "conversa-por-abrir"
        ? conversa({ hasStoredHistory: true, canLoadOlder: true, onLoadOlder: vazio })
        : caso === "amigos-sem-resultados"
          ? (
              <PeopleScreen
                directory={directorio}
                me="@eu:s"
                friends={new Set(["@ana:s", "@zoe:s"])}
                connection="online"
                connectionDetail={null}
              />
            )
          : (
              <main className="main">
                {/* A folha pende de uma âncora posicionada: é \`position:
                    absolute; top: calc(100% + 10px)\`. Sem uma âncora do tamanho
                    do botão real, ela aterrava fora da vista e media-se nada. */}
                <div style={{ position: "relative", width: 32, height: 32, marginLeft: "auto", marginRight: 24, marginTop: 24 }}>
                <PinnedPanel
                  pins={[]}
                  directory={directorio}
                  nameFor={(quem) => directorio.get(quem)?.displayName ?? quem}
                  podeDesafixar={true}
                  corpoDe={() => undefined}
                  onDesafixar={vazio}
                  onClose={vazio}
                />
                </div>
              </main>
            )

createRoot(document.getElementById("raiz")).render(
  <ToastProvider>
    {/* A mesma concha da aplicação. Sem ela o \`.main\` cai na coluna de 60px e
        o que se mediria era outra coisa. Ver \`medir-perfil.mjs\`. */}
    <div className="app">
      <nav className="rail" />
      <aside className="sidebar" />
      {corpo}
    </div>
  </ToastProvider>,
)
`,
  "utf8",
)

await build({
  entryPoints: [ENTRADA],
  bundle: true,
  outfile: join(SAIDA, "pagina.js"),
  jsx: "automatic",
  loader: { ".css": "css", ".tsx": "tsx", ".ts": "ts" },
  format: "iife",
  logLevel: "error",
})

writeFileSync(
  join(SAIDA, "index.html"),
  `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="pagina.css">` +
    `<body><div id="raiz"></div><script src="pagina.js"></script></body>`,
  "utf8",
)

const browser = await chromium.launch()
const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? ` — ${detalhe}` : ""}`)
}

/** The two widths of the home: desktop, and the narrowest phone that counts. */
const LARGURAS = [
  { nome: "largo", largura: 1280, altura: 800 },
  { nome: "telemovel", largura: 390, altura: 844 },
]

for (const caso of CASOS) {
  for (const { nome, largura, altura } of LARGURAS) {
    const ctx = await browser.newContext({ viewport: { width: largura, height: altura } })
    const page = await ctx.newPage()
    const erros = []
    page.on("pageerror", (e) => erros.push(String(e)))
    await page.goto(`file://${join(SAIDA, "index.html")}?caso=${caso}`)
    // A search with no results does not exist before someone searches: without this
    // the script was measuring the full friends list and saying everything was fine.
    if (caso === "amigos-sem-resultados") {
      await page.fill(".people-search", "xyz")
    }
    await page.waitForSelector(".empty-state, .pinned-empty", { timeout: 10_000 })

    const medida = await page.evaluate(() => {
      const caixa = document.querySelector(".empty-state") ?? document.querySelector(".pinned-empty")
      if (!caixa) return null
      const pai = caixa.parentElement
      const c = caixa.getBoundingClientRect()
      const p = pai.getBoundingClientRect()
      /*
        Against the CONTENT box of the parent, not the border box.

        The \`.timeline\` has asymmetric padding on purpose, 16px on top, 8px on
        bottom, and \`margin: auto\` centers within the content, which is correct
        behavior. Measured against the border, perfect center would report 8px
        of deviation and the ruler would reject the stylesheet for being right.
      */
      const estilo = getComputedStyle(pai)
      const pt = parseFloat(estilo.paddingTop) || 0
      const pb = parseFloat(estilo.paddingBottom) || 0
      const pl = parseFloat(estilo.paddingLeft) || 0
      const pr = parseFloat(estilo.paddingRight) || 0

      /*
        And inside the space that SIBLINGS leave, not the whole space.
        
        On the friends screen there is a search box on top, and the empty state
        centers itself in what is left below it, which is what you want, and
        what you see. The ruler without this count accused 47px of offset on a
        well-composed column, and the fix for that false positive would have been
        to push the box up until the ruler was happy: wrecking the screen to
        please the tool.
        */
      // Gap between children is not free space: it is space already spent. Counting
      // it as free gave over 12px on one side and the ruler rejected a `margin:
      // auto` that
      // the browser had resolved identically on both sides.
      const goteira = parseFloat(estilo.rowGap) || 0
      let topoLivre = p.top + pt
      let fundoLivre = p.bottom - pb
      for (const irmao of pai.children) {
        if (irmao === caixa) continue
        const r = irmao.getBoundingClientRect()
        if (r.height === 0) continue
        if (r.bottom <= c.top) topoLivre = Math.max(topoLivre, r.bottom + goteira)
        if (r.top >= c.bottom) fundoLivre = Math.min(fundoLivre, r.top - goteira)
      }
      const titulo = caixa.querySelector("h2")
      const texto = caixa.querySelector("p") ?? caixa
      const botao = caixa.querySelector("button")
      return {
        // Clearance on each side, inside the parent. Centered means equal clearance on both.
        esquerda: c.left - (p.left + pl),
        direita: p.right - pr - c.right,
        acima: c.top - topoLivre,
        abaixo: fundoLivre - c.bottom,
        largura: c.width,
        alturaTitulo: titulo ? titulo.getBoundingClientRect().height : null,
        alturaTexto: texto.getBoundingClientRect().height,
        botao: botao ? botao.getBoundingClientRect() : null,
        // Horizontal offset of the whole page: nothing can run off the right.
        rolaAoLado: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        dentroDoPai: c.right <= p.right + 1 && c.left >= p.left - 1,
      }
    })

    const etiqueta = `${caso} @ ${largura}`
    check(`${etiqueta}: sem erros de página`, erros.length === 0, erros[0] ?? "")

    if (!medida) {
      check(`${etiqueta}: há uma caixa para medir`, false)
    } else {
      // A tolerance of 2px absorbs the sub-pixel rounding of the engine; more than
      // that is already a hand-written margin and not a center.
      if (caso !== "fixadas-vazias") {
        const desvioH = Math.abs(medida.esquerda - medida.direita)
        check(`${etiqueta}: centrado na horizontal`, desvioH <= 2, `folgas ${medida.esquerda.toFixed(1)} / ${medida.direita.toFixed(1)}`)
      }

      // The pinned panel is an anchored sheet and not a column: no center is required
      // there, and what is required is to fit.
      if (caso !== "fixadas-vazias") {
        const desvioV = Math.abs(medida.acima - medida.abaixo)
        check(`${etiqueta}: centrado na vertical`, desvioV <= 2, `folgas ${medida.acima.toFixed(1)} / ${medida.abaixo.toFixed(1)}`)
      }

      check(`${etiqueta}: não sai pela direita`, !medida.rolaAoLado && medida.dentroDoPai)
      check(`${etiqueta}: o texto tem altura`, medida.alturaTexto > 8, `${medida.alturaTexto.toFixed(0)}px`)
      if (medida.alturaTitulo !== null) {
        check(`${etiqueta}: o título tem altura`, medida.alturaTitulo > 8, `${medida.alturaTitulo.toFixed(0)}px`)
      }
      if (medida.botao) {
        // The touch target is 44px, but the home button is shorter by design.
        check(`${etiqueta}: a porta é carregável`, medida.botao.height >= 24 && medida.botao.width >= 48,
          `${medida.botao.width.toFixed(0)}x${medida.botao.height.toFixed(0)}`)
      }
    }

    // Screenshots came out in the middle of the entry animation, with translucent
    // text: an image that reads as "insufficient contrast" when what is happening
    // is a fade at 120ms.
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(SAIDA, `${caso}-${nome}.png`) })
    await ctx.close()
  }
}

await browser.close()
const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} passaram. Capturas em ${SAIDA}`)
process.exit(falhas === 0 ? 0 : 1)

/**
 * The account banner, measured in a real layout engine.
 *
 * OUTDATED since panel P1 (October 28, 2026): a single-line banner gave way to a
 * multi-tier panel, and the tests for "single line only" here below no longer apply.
 * The panel is measured in `scripts/retratar-painel-de-controlo.mjs`.
 *
 * The banner is alternative B ("Discord-style banner") that the owner chose on October 27,
 * 2026. Its tests run in jsdom, which does not apply stylesheets: they say the buttons
 * exist, they do not say whether the banner is a single line, whether a target has the
 * 24 px that WCAG 2.2 requires, or whether a long name pushes the buttons outside the column.
 * This builds the real `CartaoDaConta` in a real `aside.sidebar`, with the real stylesheet,
 * at 1280 px (the 236 px column) and 390 px (the drawer), and checks:
 *
 * - no errors on the page, and nothing goes past the column width;
 * - the banner goes edge to edge of the column, no radius, with a line on top;
 * - a single line: the avatar, name and four buttons fit in the same banner;
 * - the four buttons are equal and have at least 24 px;
 * - the online status is pink, and the state says "Busy · 42 ms" when it fits;
 * - when it does not fit (at 236 px), the latency comes out whole and becomes "Busy", with no
 *   ellipsis, and the number is in the point balloon, which stays inside the column;
 * - with a long name, the name truncates and the buttons stay inside the column;
 * - right-click on the microphone opens the menu, and does not mute.
 *
 * Records a capture of each case in `scripts/.saida-faixa-da-conta/`.
 *
 *   node scripts/medir-faixa-da-conta.mjs
 *
 * Replaces `medir-cartao-da-conta.mjs` and `medir-par-audio.mjs`, which measured the
 * three-tier card and the toggle-and-arrow pair, which no longer exist.
 * Contrast is measured in `CartaoDaConta.contraste.test.ts`, against the light.
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { alvo } from "./ambiente.mjs"

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, ".saida-faixa-da-conta")
const RAIZ = join(AQUI, "..")
const UI = (caminho) => JSON.stringify(join(RAIZ, "packages/ui/src", caminho))

mkdirSync(SAIDA, { recursive: true })

/** The server comes from `ambiente.mjs`: the production name is not written in any script. */
const ENDERECO = `@garbicis-xapsensis-giprete-birmyris:${alvo()}`

/** The worst case for a name: long, accented, and with no place to break. */
const NOME_COMPRIDO = "Maria da Conceição Vasconcelos"

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { CartaoDaConta } from ${UI("screens/profile/CartaoDaConta.js")}
import ${UI("styles.css")}

const p = new URLSearchParams(location.search)
window.__menus = []
window.__alternou = 0

function Demo() {
  return (
    <div className="app">
      <div className="rail" />
      <aside className="sidebar open">
        <div className="sidebar-header">Comunidades</div>
        <div className="sidebar-body" />
        <CartaoDaConta
          profile={{ displayName: p.get("nome") ?? "Duarte", donations: [] }}
          address={${JSON.stringify(ENDERECO)}}
          activity="ocupado"
          ligacao={p.get("ligacao") ?? "online"}
          onActivityMenu={() => {}}
          onEditProfile={() => {}}
          onNotifications={() => {}}
          unreadNotifications={3}
          micMuted={true}
          soundOff={false}
          onToggleMic={() => { window.__alternou += 1 }}
          onToggleSound={() => {}}
          onMicMenu={(at) => window.__menus.push(["mic", at])}
          onSoundMenu={(at) => window.__menus.push(["som", at])}
          onAbrirDefinicoes={() => {}}
          latencia={{ ms: 42, ate: "servidor" }}
          onLatenciaHover={() => {}}
          onSaveStatus={() => {}}
        />
      </aside>
      <main className="main" />
    </div>
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? ` — ${detalhe}` : ""}`)
}

for (const [largura, altura] of [
  [1280, 860],
  [390, 844],
]) {
  for (const caso of ["curto", "comprido"]) {
    const ctx = await browser.newContext({ viewport: { width: largura, height: altura } })
    const page = await ctx.newPage()
    const erros = []
    page.on("pageerror", (e) => erros.push(String(e)))
    const nome = caso === "comprido" ? NOME_COMPRIDO : "Duarte"
    await page.goto(`file://${join(SAIDA, "index.html")}?nome=${encodeURIComponent(nome)}`)
    await page.waitForSelector(".me-faixa", { timeout: 10_000 })
    await page.waitForTimeout(200)

    const m = await page.evaluate(() => {
      const caixa = (el) => el.getBoundingClientRect()
      const coluna = caixa(document.querySelector(".sidebar"))
      const faixaEl = document.querySelector(".me-faixa")
      const faixa = caixa(faixaEl)
      const estilo = getComputedStyle(faixaEl)
      const botoes = [...document.querySelectorAll(".me-accoes button")].map(caixa)
      const avatar = caixa(document.querySelector(".me-avatar"))
      const nomeEl = document.querySelector(".me-name-text")
      const calado = document.querySelector(".me-audio-btn.off")
      return {
        coluna: { left: coluna.left, right: coluna.right, width: coluna.width },
        faixa: { left: faixa.left, right: faixa.right, top: faixa.top, bottom: faixa.bottom, height: faixa.height },
        raio: estilo.borderTopLeftRadius,
        linha: estilo.borderTopWidth + " " + estilo.borderTopStyle,
        margem: estilo.marginLeft + " " + estilo.marginRight + " " + estilo.marginBottom,
        botoes: botoes.map((b) => ({ w: b.width, h: b.height, top: b.top, left: b.left, right: b.right })),
        avatar: { top: avatar.top, bottom: avatar.bottom },
        nomeCorta: nomeEl.scrollWidth > nomeEl.clientWidth,
        estadoCorta: (() => {
          /* The line breaks in two on purpose: what matters is the sum of the
             two pieces side by side. */
          const el = document.querySelector(".me-state")
          const pedacos = [...el.children].reduce((soma, filho) => soma + filho.scrollWidth, 0)
          return { corta: pedacos > el.clientWidth, precisa: pedacos, tem: el.clientWidth }
        })(),
        estado: document.querySelector(".me-state")?.textContent ?? "",
        /* What you see of the line: latency counts if it is on the first line
           (the `.me-state` only has the height of one), not just if it is in the DOM. */
        estadoVisivel: (() => {
          const linha = caixa(document.querySelector(".me-state"))
          const palavraEl = document.querySelector(".me-state-palavra")
          const latenciaEl = document.querySelector(".me-state-latencia")
          const lat = latenciaEl ? caixa(latenciaEl) : null
          const latenciaVe = lat !== null && lat.top >= linha.top - 0.5 && lat.bottom <= linha.bottom + 0.5 && lat.right <= linha.right + 0.5
          return {
            texto: (palavraEl?.textContent ?? "") + (latenciaVe ? latenciaEl.textContent : ""),
            palavraCorta: palavraEl ? palavraEl.scrollWidth > palavraEl.clientWidth : true,
          }
        })(),
        balaoDoPonto: (() => {
          const ponto = document.querySelector(".me-avatar > .dot")
          const r = caixa(ponto)
          const balao = getComputedStyle(ponto, "::after")
          const esquerda = r.left + parseFloat(balao.left)
          return { tip: ponto.getAttribute("data-tip") ?? "", title: ponto.getAttribute("title"), esquerda, direita: esquerda + parseFloat(balao.width) }
        })(),
        corDoCalado: calado ? getComputedStyle(calado).color : null,
        scrollDaColuna: document.querySelector(".sidebar").scrollWidth,
        larguraDaColuna: document.querySelector(".sidebar").clientWidth,
      }
    })

    const id = `${caso}-${largura}`
    check(`${id}: sem erros na página`, erros.length === 0, erros.join(" | "))
    check(
      `${id}: a faixa vai de borda a borda da coluna`,
      Math.abs(m.faixa.left - m.coluna.left) <= 1 && Math.abs(m.faixa.right - m.coluna.right) <= 1,
      `faixa ${m.faixa.left.toFixed(0)}–${m.faixa.right.toFixed(0)}, coluna ${m.coluna.left.toFixed(0)}–${m.coluna.right.toFixed(0)}`,
    )
    check(`${id}: sem raio nem margem, com uma linha por cima`, m.raio === "0px" && m.margem === "0px 0px 0px" && m.linha === "1px solid", `raio ${m.raio}, margem ${m.margem}, linha ${m.linha}`)
    check(`${id}: quatro botões`, m.botoes.length === 4, String(m.botoes.length))
    const iguais = m.botoes.every((b) => b.w === m.botoes[0].w && b.h === m.botoes[0].h)
    check(`${id}: os quatro botões são iguais, e de 24 px ou mais`, iguais && m.botoes.every((b) => b.w >= 24 && b.h >= 24), m.botoes.map((b) => `${b.w}×${b.h}`).join(" "))
    const umaLinha = m.botoes.every((b) => b.top >= m.faixa.top && b.top + b.h <= m.faixa.bottom && Math.abs(b.top - m.botoes[0].top) < 1)
    check(`${id}: uma linha só (o avatar e os botões na mesma faixa)`, umaLinha && m.avatar.top >= m.faixa.top && m.avatar.bottom <= m.faixa.bottom, `faixa ${m.faixa.height.toFixed(0)} px de alto`)
    check(`${id}: os botões ficam dentro da coluna`, m.botoes.every((b) => b.right <= m.coluna.right + 0.5), `último acaba em ${m.botoes.at(-1)?.right.toFixed(1)}, coluna em ${m.coluna.right.toFixed(1)}`)
    check(`${id}: nada passa da largura da coluna`, m.scrollDaColuna <= m.larguraDaColuna, `${m.scrollDaColuna} em ${m.larguraDaColuna}`)
    check(`${id}: o calado é rosa (--rosa, #e070a8)`, m.corDoCalado === "rgb(224, 112, 168)", String(m.corDoCalado))
    if (caso === "comprido") check(`${id}: o nome comprido corta com reticências`, m.nomeCorta)
    check(`${id}: a linha do estado guarda a latência no DOM`, m.estado === "Ocupado · 42 ms", m.estado)
    /*
      The rule (report 1c-2, point A): when the line does not fit, latency
      comes out whole and only the state remains. At 236 px column width it does not fit;
      at 390 px drawer it fits. What is measured is what you see.
    */
    const esperado = largura === 1280 ? "Ocupado" : "Ocupado · 42 ms"
    check(`${id}: vê-se "${esperado}"`, m.estadoVisivel.texto === esperado, `vê-se "${m.estadoVisivel.texto}"`)
    check(`${id}: o estado não corta com reticências`, !m.estadoVisivel.palavraCorta)
    check(`${id}: o balão do ponto diz a latência inteira`, m.balaoDoPonto.tip.includes("42 ms até ao servidor") && m.balaoDoPonto.title === null, m.balaoDoPonto.tip)
    check(
      `${id}: o balão do ponto fica dentro da coluna`,
      m.balaoDoPonto.esquerda >= m.coluna.left && m.balaoDoPonto.direita <= m.coluna.right + 0.5,
      `${m.balaoDoPonto.esquerda.toFixed(0)}–${m.balaoDoPonto.direita.toFixed(0)}, coluna ${m.coluna.left.toFixed(0)}–${m.coluna.right.toFixed(0)}`,
    )
    console.log(`NOTA  ${id}: a linha do estado tem ${m.estadoCorta.tem} px, e a linha inteira precisava de ${m.estadoCorta.precisa}`)

    // The point balloon, in view: the mouse over the point, and the column capture.
    await page.hover(".me-avatar > .dot")
    await page.waitForTimeout(450)
    await page.locator(".sidebar").screenshot({ path: join(SAIDA, `${id}-balao.png`) })
    await page.mouse.move(0, 0)

    // Right-click on the microphone opens its menu, and does not mute.
    await page.click(".me-audio-btn", { button: "right" })
    const depois = await page.evaluate(() => ({ menus: window.__menus, alternou: window.__alternou }))
    check(`${id}: o clique direito no microfone abre o menu, e não silencia`, depois.menus.length === 1 && depois.menus[0][0] === "mic" && depois.alternou === 0, JSON.stringify(depois))

    await page.locator(".me-faixa").screenshot({ path: join(SAIDA, `${id}.png`) })
    await ctx.close()
  }
}

await browser.close()
const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`)
process.exit(falhas === 0 ? 0 : 1)

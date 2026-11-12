// The window selector and the permission sheet, measured with a layout engine.
//
// Why this exists instead of another test: tests of these two screens run in
// jsdom, and jsdom DOES NOT APPLY ANY STYLESHEETS. It says the buttons exist
// and the names are there; it does not know if the thumbnail grid fits on the
// page, if a long name pushes the column out, or if a list of twenty windows
// overflows the card instead of scrolling inside it. Those are calculated
// pixels, and you need a real browser to get them.
//
// It is also the only live check possible for these two screens without a
// graphics session: they only appear inside Electron, in the browser Chrome
// brings its own selector -, and what is mounted here is the same React tree
// with the same stylesheet, outside Electron.
//
// What it does NOT prove, and should be said: that `desktopCapturer` returns
// sources on a real machine, that macOS delivers the capture after permission
// is given, or that restarting the app is even needed. That is machine stuff,
// and you test it on a machine.
//
//   node scripts/medir-selector-de-ecra.mjs
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, ".saida-selector")
const RAIZ = join(AQUI, "..")

mkdirSync(SAIDA, { recursive: true })

/** Twenty windows, the number at which a grid starts to hurt. */
const fontes = [
  { id: "screen:0:0", nome: "Ecrã 1", ecraInteiro: true },
  { id: "screen:1:0", nome: "Ecrã 2 (o de trás, ligado por cabo)", ecraInteiro: true },
  ...Array.from({ length: 18 }, (_, i) => ({
    id: `window:${i}:0`,
    // A short name, a long one, and one with no name: the three cases that break a
    // grid, and the third is what macOS returns for several apps.
    nome: i % 3 === 0 ? "Editor" : i % 3 === 1 ? `Documento sem título ${i} — rascunho de trabalho muito comprido` : "",
    ecraInteiro: false,
  })),
]

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { ScreenPicker } from ${JSON.stringify(join(RAIZ, "packages/ui/src/screens/call/ScreenPicker.js"))}
import { ScreenPermission } from ${JSON.stringify(join(RAIZ, "packages/ui/src/screens/call/ScreenPermission.js"))}
import ${JSON.stringify(join(RAIZ, "packages/ui/src/styles.css"))}

const fontes = ${JSON.stringify(fontes)}.map((f) => ({
  ...f,
  // Uma miniatura verdadeira em vez de um quadrado: o que se está a medir é a
  // caixa, e uma imagem com proporção diferente da caixa é o caso interessante.
  miniatura: f.nome === "" ? "" : "data:image/svg+xml;base64," + btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#2b6cb0"/></svg>',
  ),
}))

const qual = new URLSearchParams(location.search).get("qual")
createRoot(document.getElementById("raiz")).render(
  qual === "permissao" ? (
    <ScreenPermission onAbrirDefinicoes={() => {}} onClose={() => {}} />
  ) : (
    <ScreenPicker fontes={fontes} aCarregar={false} onEscolher={() => {}} onCancelar={() => {}} />
  ),
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

async function medir(qual, largura, altura) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e)))
  await page.goto(`file://${join(SAIDA, "index.html")}?qual=${qual}`)
  await page.waitForSelector(".sheet", { timeout: 10_000 })
  return { ctx, page, erros }
}

// ------------------------------------------------------------ the selector
{
  const { ctx, page, erros } = await medir("selector", 1280, 800)
  check("o selector desenha sem erros de página", erros.length === 0, erros[0] ?? "")

  const medidas = await page.evaluate(() => {
    const folha = document.querySelector(".sheet")
    const corpo = document.querySelector(".sheet-body")
    const linhas = [...document.querySelectorAll(".ecra-fonte")]
    const caixa = folha.getBoundingClientRect()
    return {
      linhas: linhas.length,
      folhaAltura: caixa.height,
      janelaAltura: window.innerHeight,
      corpoRola: corpo.scrollHeight > corpo.clientHeight,
      // The widest line against the useful width of the body: this is what says if a
      // long name pushes the grid out of the card.
      maisLarga: Math.max(...linhas.map((l) => l.getBoundingClientRect().width)),
      corpoLargura: corpo.clientWidth,
      // A line without a thumbnail must still be a box and not a line: without
      // `img`, the name is what gives it height.
      semMiniatura: linhas
        .filter((l) => !l.querySelector("img"))
        .map((l) => Math.round(l.getBoundingClientRect().height)),
      colunas: new Set(linhas.map((l) => Math.round(l.getBoundingClientRect().left))).size,
    }
  })

  check("as vinte fontes estão todas na lista", medidas.linhas === 20, `${medidas.linhas}`)
  check(
    "a folha não passa da janela: rola por dentro em vez de crescer",
    medidas.folhaAltura <= medidas.janelaAltura && medidas.corpoRola,
    `folha ${Math.round(medidas.folhaAltura)}px, janela ${medidas.janelaAltura}px, rola=${medidas.corpoRola}`,
  )
  check(
    "um nome comprido não empurra a grelha para fora do cartão",
    medidas.maisLarga <= medidas.corpoLargura + 1,
    `${Math.round(medidas.maisLarga)}px numa largura útil de ${medidas.corpoLargura}px`,
  )
  check(
    "uma fonte sem miniatura continua a ser uma caixa carregável",
    medidas.semMiniatura.every((h) => h >= 24),
    `alturas: ${medidas.semMiniatura.join(", ")}`,
  )
  check("a grelha usa mais do que uma coluna", medidas.colunas > 1, `${medidas.colunas} colunas`)

  await page.screenshot({ path: join(AQUI, "_saida-selector-de-ecra.png") })
  await ctx.close()
}

// ------------------------------------------- the selector on a narrow screen
{
  const { ctx, page } = await medir("selector", 420, 780)
  const estreito = await page.evaluate(() => {
    const folha = document.querySelector(".sheet")
    return {
      cabe: folha.getBoundingClientRect().width <= window.innerWidth,
      // The page body never scrolls horizontally: that is the rule.
      rolaHorizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      colunas: new Set(
        [...document.querySelectorAll(".ecra-fonte")].map((l) => Math.round(l.getBoundingClientRect().left)),
      ).size,
    }
  })
  check("num ecrã estreito a folha cabe", estreito.cabe)
  check("e a página não ganha barra horizontal", !estreito.rolaHorizontal)
  check("a grelha encolhe para uma ou duas colunas", estreito.colunas <= 2, `${estreito.colunas}`)
  await ctx.close()
}

// ------------------------------------------------------- the macOS sheet
{
  const { ctx, page, erros } = await medir("permissao", 1280, 800)
  check("a folha da permissão desenha sem erros de página", erros.length === 0, erros[0] ?? "")

  const dito = await page.evaluate(() => document.body.innerText)
  check("diz de quem é a permissão", /do sistema e não do Orwell/i.test(dito))
  check("diz onde se dá", /Privacidade e Segurança/i.test(dito))
  check("diz que é preciso fechar e voltar a abrir", /fechar o Orwell e voltar a abri-lo/i.test(dito))

  const botoes = await page.evaluate(() =>
    [...document.querySelectorAll(".sheet-actions button")].map((b) => ({
      texto: b.textContent,
      largura: Math.round(b.getBoundingClientRect().width),
      altura: Math.round(b.getBoundingClientRect().height),
    })),
  )
  check(
    "os dois botões existem e têm corpo",
    botoes.length === 2 && botoes.every((b) => b.largura > 40 && b.altura > 20),
    JSON.stringify(botoes),
  )

  await page.screenshot({ path: join(AQUI, "_saida-permissao-de-ecra.png") })
  await ctx.close()
}

await browser.close()
const falhados = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhados}/${resultados.length}`)
process.exit(falhados === 0 ? 0 : 1)

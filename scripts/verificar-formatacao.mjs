// Text rendering, measured with a real layout engine.
//
// Why this exists instead of another test: tests for this change run in jsdom,
// and jsdom DOESN'T APPLY ANY STYLESHEETS. It can tell you the covered element
// has the right class and that clicking toggles the class; it can't tell you
// whether the text is actually hidden, whether it leaks into a full-page
// selection, whether it shows on hover, or whether the strikethrough is even
// drawn. Those are calculated pixels and a real selection, and you need a
// browser for them.
//
// The assertion that needs this most is about covered text: "really hidden" is
// exactly the kind of thing that passes a jsdom test while being false.
//
// What it DOESN'T prove: that the text isn't in the page's HTML. It is, and it
// has to be, uncovering happens on this device, without fetching anything from
// anywhere. What we measure here is what a PERSON can read: with their eyes,
// with the mouse, and with Ctrl+A followed by Ctrl+C.
//
//   node scripts/verificar-formatacao.mjs
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, ".saida-formatacao")
const RAIZ = join(AQUI, "..")

mkdirSync(SAIDA, { recursive: true })

/**
 * The text it sends to itself on the screen.
 *
 * The poison is there on purpose and in three places: loose, inside the
 * strikethrough and inside the covered text. If any of those three passages
 * interpreted markup, the `<img src=x>` would fetch `x` from the network, and
 * that's the most direct proof there is, because it doesn't depend on me
 * remembering to look for the right tag.
 */
const SEGREDO = "o assassino e o mordomo"
const AMOSTRAS = {
  tudo: "isto e **mesmo** urgente, e *nao* e `codigo`, e aquilo ~~ja nao conta~~",
  coberto: `o fim do filme: ||${SEGREDO}||`,
  cobertoComLink: "||ve https://exemplo.pt hoje||",
  cobertoComNegrito: "||o **fim**||",
  veneno: `<img src="/veneno-solto.png" onerror="alert(1)"> ~~<img src="/veneno-riscado.png">~~ ||<script>alert(2)</script> <img src="/veneno-tapado.png">||`,
  aritmetica: "5 * 4 * 3 = 60, o ficheiro ~/notas.md, e a | b",
}

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { useState } from "react"
import { createRoot } from "react-dom/client"
import { RichText } from ${JSON.stringify(join(RAIZ, "packages/ui/src/components/RichText.js"))}
import { useAtalhosDeFormatacao } from ${JSON.stringify(join(RAIZ, "packages/ui/src/hooks/useAtalhosDeFormatacao.js"))}
import ${JSON.stringify(join(RAIZ, "packages/ui/src/styles.css"))}

const amostras = ${JSON.stringify(AMOSTRAS)}

/**
 * A caixa de escrita, com o mesmo gancho que a barra da conversa e a legenda da
 * publicação usam. O que se mede nela são teclas verdadeiras a chegar de um
 * browser verdadeiro — que é a parte que o jsdom simula e não prova.
 */
function Escrita() {
  const [valor, setValor] = useState("isto e urgente")
  const formatar = useAtalhosDeFormatacao(valor, setValor)
  return (
    <input
      id="escrita"
      value={valor}
      onChange={(e) => setValor(e.target.value)}
      onKeyDown={(e) => { formatar(e) }}
    />
  )
}

createRoot(document.getElementById("raiz")).render(
  <div className="message-body" style={{ padding: 24, width: 620 }}>
    {Object.entries(amostras).map(([nome, texto]) => (
      <p key={nome} id={"amostra-" + nome} style={{ margin: "12px 0" }}>
        <RichText>{texto}</RichText>
      </p>
    ))}
    <Escrita />
  </div>,
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
    `<body style="background:#222429"><div id="raiz"></div><script src="pagina.js"></script></body>`,
  "utf8",
)

const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? ` — ${detalhe}` : ""}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } })
const page = await ctx.newPage()

// Everything the page tries to fetch gets logged. It's the most direct proof
// that nothing turned into HTML: an interpreted `<img src=…>` fetches the image.
const pedidos = []
page.on("request", (r) => pedidos.push(r.url()))
const errosDePagina = []
page.on("pageerror", (e) => errosDePagina.push(String(e)))

await page.goto(`file://${join(SAIDA, "index.html")}`)
await page.waitForSelector(".spoiler", { timeout: 10_000 })

check("a página desenha sem erros", errosDePagina.length === 0, errosDePagina[0] ?? "")

// ------------------------------------------------ 1. nada do texto virou HTML
{
  const dentro = await page.evaluate(() => ({
    imagens: document.querySelectorAll("#raiz img").length,
    guioes: document.querySelectorAll("#raiz script").length,
    molduras: document.querySelectorAll("#raiz iframe, #raiz object, #raiz embed").length,
    // The poison must be readable as TEXT: escaped in HTML and visible on screen.
    lidoComoTexto: (document.getElementById("amostra-veneno")?.textContent ?? "").includes("<script>alert(2)</script>"),
  }))
  check("nenhuma imagem foi criada a partir do texto de ninguém", dentro.imagens === 0, `${dentro.imagens}`)
  check("nenhum guião foi criado a partir do texto de ninguém", dentro.guioes === 0, `${dentro.guioes}`)
  check("nem moldura, nem objecto embebido", dentro.molduras === 0, `${dentro.molduras}`)
  check("e o veneno lê-se como texto, que é o que ele é", dentro.lidoComoTexto)

  const foiBuscar = pedidos.filter((u) => u.includes("veneno"))
  check(
    "a página NÃO foi buscar nada do que o texto mandou ir buscar",
    foiBuscar.length === 0,
    foiBuscar.join(", ") || `${pedidos.length} pedidos, nenhum de veneno`,
  )
}

// ------------------------------------------------ 2. covered text really hides
{
  const tapado = page.locator("#amostra-coberto .spoiler")
  const medida = await tapado.evaluate((no) => {
    const texto = no.querySelector(".spoiler-texto")
    return {
      visibilidade: getComputedStyle(texto).visibility,
      seleccionavel: getComputedStyle(no).userSelect || getComputedStyle(no).webkitUserSelect,
      largura: Math.round(no.getBoundingClientRect().width),
      papel: no.getAttribute("role"),
    }
  })
  check("o texto tapado não é pintado", medida.visibilidade === "hidden", medida.visibilidade)
  check("e não se pode marcar com o rato", medida.seleccionavel === "none", String(medida.seleccionavel))
  check("a mancha tem largura: vê-se que ali há alguma coisa", medida.largura > 40, `${medida.largura}px`)
  check("é um alvo carregável", medida.papel === "button", String(medida.papel))

  // Ctrl+A and Ctrl+C, how a person steals text they shouldn't see.
  const seleccionado = await page.evaluate(() => {
    const sel = window.getSelection()
    sel.removeAllRanges()
    const r = document.createRange()
    r.selectNodeContents(document.body)
    sel.addRange(r)
    const texto = sel.toString()
    sel.removeAllRanges()
    return texto
  })
  check(
    "seleccionar a página inteira NÃO apanha o que está tapado",
    !seleccionado.includes("mordomo"),
    seleccionado.includes("mordomo") ? "O SEGREDO SAIU NA SELECÇÃO" : `${seleccionado.length} caracteres apanhados`,
  )
  check(
    "mas apanha o texto que está à vista, senão não estava a medir nada",
    seleccionado.includes("o fim do filme"),
  )

  // Hover is an accident. It can't uncover.
  await tapado.hover()
  await page.waitForTimeout(250)
  const depoisDoRato = await tapado.evaluate((no) => getComputedStyle(no.querySelector(".spoiler-texto")).visibility)
  check("passar o rato por cima não destapa nada", depoisDoRato === "hidden", depoisDoRato)

  await page.screenshot({ path: join(AQUI, "_saida-formatacao-tapado.png") })

  // And now the click, which is the decision.
  await tapado.click()
  await page.waitForTimeout(200)
  const destapado = await page.evaluate(() => {
    const no = document.querySelector("#amostra-coberto .spoiler")
    const texto = no.querySelector(".spoiler-texto")
    const sel = window.getSelection()
    sel.removeAllRanges()
    const r = document.createRange()
    r.selectNodeContents(document.body)
    sel.addRange(r)
    const apanhado = sel.toString()
    sel.removeAllRanges()
    return {
      visibilidade: getComputedStyle(texto).visibility,
      papel: no.getAttribute("role"),
      apanhado,
    }
  })
  check("carregar destapa", destapado.visibilidade === "visible", destapado.visibilidade)
  check("e destapado deixa de ser um botão", destapado.papel === null, String(destapado.papel))
  check("destapado, já se pode copiar como qualquer texto", destapado.apanhado.includes("mordomo"))

  // Other covered passages on the page stay covered: each one is its own.
  const outrosTapados = await page.evaluate(
    () => document.querySelectorAll(".spoiler:not(.aberto)").length,
  )
  check("os outros cobertos da página continuam tapados", outrosTapados >= 3, `${outrosTapados} ainda tapados`)
}

// ------------------------------------------------ 3. a covered link isn't clickable
{
  const antes = await page.evaluate(() => {
    const no = document.querySelector("#amostra-cobertoComLink .spoiler")
    const link = no.querySelector("a")
    return { temLink: link !== null, pintado: link ? getComputedStyle(link).visibility : null }
  })
  check("um endereço dentro de um coberto não está pintado", antes.pintado === "hidden", String(antes.pintado))

  // An element with `visibility: hidden` doesn't receive clicks and doesn't enter
  // tab order: what's there to act on is the uncover, nothing else.
  const alvo = await page.evaluate(() => {
    const no = document.querySelector("#amostra-cobertoComLink .spoiler")
    const caixa = no.getBoundingClientRect()
    const emCima = document.elementFromPoint(caixa.left + caixa.width / 2, caixa.top + caixa.height / 2)
    return emCima?.className ?? null
  })
  check("o que está por cima do link tapado é a mancha, e não o link", alvo === "spoiler", String(alvo))
}

// ------------------------------------------------ 4. o rasurado desenha o risco
{
  const risco = await page.evaluate(() => {
    const s = document.querySelector("#amostra-tudo s")
    if (!s) return null
    const estilo = getComputedStyle(s)
    return { linha: estilo.textDecorationLine, texto: s.textContent }
  })
  check("o rasurado leva mesmo um risco por cima", risco?.linha === "line-through", JSON.stringify(risco))
  check("e rasura o que devia rasurar", risco?.texto === "ja nao conta", String(risco?.texto))

  const marcadores = await page.evaluate(() => document.getElementById("amostra-tudo").textContent)
  check("nenhum marcador sobra no ecrã", !marcadores.includes("**") && !marcadores.includes("~~"), marcadores)
}

// ------------------------------------------------ 5. arithmetic survives
{
  const dito = await page.evaluate(() => ({
    texto: document.getElementById("amostra-aritmetica").textContent,
    enfases: document.querySelectorAll("#amostra-aritmetica em, #amostra-aritmetica s, #amostra-aritmetica .spoiler")
      .length,
  }))
  check("uma multiplicação, um caminho com til e um cano continuam letras", dito.enfases === 0, `${dito.enfases}`)
  check("e chegam inteiros ao ecrã", dito.texto === AMOSTRAS.aritmetica, dito.texto)
}

// ------------------------------------------------ 6. shortcuts, with real keys
//
// The part only a browser proves: that the combination reaches here (the
// browser doesn't intercept it first), that `preventDefault` stops it from
// doing what it did, and that the selection goes back where it was after React
// redraws the box.
{
  const escrita = page.locator("#escrita")
  const marcar = async (de, ate) => {
    await escrita.evaluate((no, [a, b]) => { no.focus(); no.setSelectionRange(a, b) }, [de, ate])
  }

  await marcar(7, 14)
  await page.keyboard.press("Control+b")
  check(
    "Ctrl+B envolve a selecção com asteriscos",
    (await escrita.inputValue()) === "isto e **urgente**",
    await escrita.inputValue(),
  )

  const seleccaoDepois = await escrita.evaluate((no) => no.value.slice(no.selectionStart, no.selectionEnd))
  check(
    "e a selecção fica sobre as mesmas letras, para o gesto seguinte",
    seleccaoDepois === "urgente",
    JSON.stringify(seleccaoDepois),
  )

  await page.keyboard.press("Control+b")
  check(
    "carregar outra vez desfaz",
    (await escrita.inputValue()) === "isto e urgente",
    await escrita.inputValue(),
  )

  await marcar(7, 14)
  await page.keyboard.press("Control+Shift+X")
  check(
    "Ctrl+Shift+X risca",
    (await escrita.inputValue()) === "isto e ~~urgente~~",
    await escrita.inputValue(),
  )

  await escrita.fill("isto e urgente")
  await marcar(7, 14)
  await page.keyboard.press("Control+Shift+E")
  check(
    "Ctrl+Shift+E tapa",
    (await escrita.inputValue()) === "isto e ||urgente||",
    await escrita.inputValue(),
  )

  // And a key without a command stays a letter.
  await escrita.fill("")
  await escrita.focus()
  await page.keyboard.type("bix")
  check("uma tecla sem comando escreve-se, como sempre", (await escrita.inputValue()) === "bix", await escrita.inputValue())
}

await page.screenshot({ path: join(AQUI, "_saida-formatacao.png") })
await ctx.close()
await browser.close()

const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações passaram`)
process.exit(falhas === 0 ? 0 : 1)

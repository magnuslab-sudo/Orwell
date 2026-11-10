/**
 * Orwell news: from `docs/novidades.json` to a static page.
 *
 * The JSON is the single source of release notes. This script writes TWO files
 * from it, and neither is edited by hand:
 *
 * - `packages/ui/src/novidades/novidades.gen.html`: the entire page, which
 *   opens by itself in a browser (brings the skin tokens copied from `tokens.css`).
 * - `packages/ui/src/novidades/novidades.gen.ts`: the same body (style and
 *   article) as a string, to go into the app bundle. The "anúncios" room of the
 *   official channel shows it (`NotasDeVersao.tsx`). A module and not a `?raw`
 *   from Vite: this way the same import works with web Vite, desktop app Vite,
 *   vitest and `tsc`, without a special loader in each one.
 *
 * The body is identical in both files on purpose: what you see in the room is what
 * you see on the page, letter for letter. The page only adds the document
 * around it and the token values, which inside the app already come from `:root`.
 *
 * No JavaScript on the page: it is text to read, and the text comes from a
 * repository file, escaped here.
 *
 * The title is "Release notes" (was "O que há de novo" until 2/11/2026), and the subtitle says the version (see `subtitulo`).
 *
 * Usage: node scripts/gerar-novidades.mjs
 * `packages/ui/src/novidades/novidades.test.ts` fails if the generated files
 * are not up to date with the JSON.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
export const CAMINHO_DO_JSON = join(RAIZ, "docs/novidades.json")
export const CAMINHO_DA_RAIZ = join(RAIZ, "package.json")
export const CAMINHO_DOS_TOKENS = join(RAIZ, "packages/ui/src/styles/tokens.css")
export const CAMINHO_DO_HTML = join(RAIZ, "packages/ui/src/novidades/novidades.gen.html")
export const CAMINHO_DO_MODULO = join(RAIZ, "packages/ui/src/novidades/novidades.gen.ts")

/* Release notes are always in English, written as a dev writes them (owner's order, 3/11/2026). */
const MESES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** "2026-10-29" → "October 29, 2026". No `Intl`: the result cannot depend on the machine where the script runs, or the "up to date" test would fail on one and pass on another. */
export function dataPorExtenso(iso) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!partes) throw new Error(`Data inválida em docs/novidades.json: "${iso}". Escreve AAAA-MM-DD.`)
  const [, ano, mes, dia] = partes
  const nomeDoMes = MESES[Number(mes) - 1]
  if (!nomeDoMes) throw new Error(`Mês inválido em docs/novidades.json: "${iso}".`)
  return `${nomeDoMes} ${Number(dia)}, ${ano}`
}

const escapar = (texto) =>
  String(texto).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** The entry for this version, or `undefined`. The question publication asks. */
export function entradaDaVersao(novidades, versao) {
  return novidades.find((entrada) => entrada.versao === versao)
}

export function lerNovidades() {
  return JSON.parse(readFileSync(CAMINHO_DO_JSON, "utf8"))
}

/**
 * The subtitle: "Orwell version Arca 1.0". Owner's order from October 29, 2026, in English since 3/11/2026.
 *
 * From the root `package.json` (`nomeDaVersao` and `version`), not from the most recent JSON entry: the subtitle says what version the app IS at, and the root knows that, being the single source of truth for version (the others inherit from it). Bumping the version without running the generator leaves the page out of sync, and the test catches it. Only major and minor, like in the site footer: patch does not matter to readers.
 */
export function subtitulo({ version, nomeDaVersao }) {
  const curta = String(version).split(".").slice(0, 2).join(".")
  return `Orwell version ${nomeDaVersao} ${curta}`
}

export function lerRaiz() {
  return JSON.parse(readFileSync(CAMINHO_DA_RAIZ, "utf8"))
}

/*
  The style of the content. `--accent` not `--acento` in the number: it is the name that the color picker rewrites (`usePrefs.ts`), and so it follows the person's choice. Classes only, never `body` or `:host`: the same text must work on the page alone and inside the app container's shadow. The colors are the skin tokens, and inside the app they inherit from the document (custom properties cross the shadow boundary), so the accent the person chose reaches here without doing anything.
  */
const ESTILO = `
.novidades { font-family: var(--fonte); color: var(--texto); max-width: 680px; margin: 0 auto; padding: 24px 16px 32px; line-height: 1.45; }
.novidades h1 { color: var(--titulo); font-size: 22px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
.novidades .subtitulo { color: var(--apagado); font-size: 13px; margin: 2px 0 20px; }
.novidades .versao { border-top: 1px solid var(--painel-borda); padding: 18px 0 6px; }
.novidades h2 { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 0 10px; font-size: 17px; font-weight: 600; }
.novidades .numero { color: var(--accent); font-variant-numeric: tabular-nums; }
.novidades .data { color: var(--apagado); font-size: 12px; font-weight: 400; }
.novidades .nota { margin: -4px 0 10px; color: var(--secundario); font-size: 13px; }
.novidades ul { list-style: none; margin: 0; padding: 0; }
.novidades li { display: flex; align-items: baseline; gap: 10px; margin: 0 0 8px; font-size: 14px; }
.novidades .tipo { flex: none; width: 172px; white-space: nowrap; font-size: 10.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.novidades .tipo::before { content: ""; display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: currentColor; margin-right: 7px; vertical-align: 1px; }
.novidades .tipo-nova { color: var(--presenca); }
.novidades .tipo-melhoria { color: var(--accent); }
.novidades .tipo-fix { color: var(--rosa); }
@media (max-width: 480px) { .novidades li { flex-direction: column; gap: 2px; } .novidades .tipo { width: auto; } }
`.trim()

/** The three types of note, and the order they appear in within each version. */
export const TIPOS = { nova: "New", melhoria: "Improvement", fix: "Fix" }
const ORDEM = Object.keys(TIPOS)

/** A note is `{ tipo, texto }`, with `tipo` in `TIPOS`. Anything else is refused. */
function validarItem(item, versao) {
  if (!item || typeof item !== "object" || !(item.tipo in TIPOS) || typeof item.texto !== "string" || !item.texto.trim()) {
    throw new Error(`Nota inválida na versão ${versao} de docs/novidades.json. Escreve { "tipo": "nova" | "melhoria" | "fix", "texto": "…" }.`)
  }
  return item
}

/** The content: the style and the article. Most recent first, in JSON order. */
export function gerarMiolo(novidades, raiz) {
  const seccoes = novidades.map((entrada) => {
    const itens = entrada.itens
      .map((item) => validarItem(item, entrada.versao))
      .map((item, i) => ({ item, i }))
      .sort((a, b) => ORDEM.indexOf(a.item.tipo) - ORDEM.indexOf(b.item.tipo) || a.i - b.i)
      .map(({ item }) => `      <li><span class="tipo tipo-${item.tipo}">${TIPOS[item.tipo]}</span><span class="texto">${escapar(item.texto)}</span></li>`)
      .join("\n")
    return [
      `  <section class="versao">`,
      `    <h2><span class="numero">${escapar(entrada.versao)}</span> <time class="data" datetime="${escapar(entrada.data)}">${dataPorExtenso(entrada.data)}</time></h2>`,
      ...(entrada.nota ? [`    <p class="nota">${escapar(entrada.nota)}</p>`] : []),
      `    <ul>`,
      itens,
      `    </ul>`,
      `  </section>`,
    ].join("\n")
  })
  return [
    `<style>\n${ESTILO}\n</style>`,
    `<article class="novidades" lang="en">`,
    `  <h1>Release notes</h1>`,
    `  <p class="subtitulo">${escapar(subtitulo(raiz))}</p>`,
    ...seccoes,
    `</article>`,
  ].join("\n")
}

/**
 * The tokens the content uses, with their values from `tokens.css`, and those they depend on. For the page alone only: in the app they already exist in `:root`.
 */
export function tokensUsados(miolo, tokensCss) {
  const semComentarios = tokensCss.replace(/\/\*[\s\S]*?\*\//g, "")
  const valores = new Map()
  for (const [, nome, valor] of semComentarios.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    // First one wins: the one from `:root`, not one from a variant further down.
    if (!valores.has(nome)) valores.set(nome, valor.replace(/\s+/g, " ").trim())
  }
  const usados = new Set()
  const porVer = [...miolo.matchAll(/var\((--[\w-]+)\)/g)].map((achado) => achado[1])
  while (porVer.length > 0) {
    const nome = porVer.pop()
    if (usados.has(nome)) continue
    const valor = valores.get(nome)
    if (valor === undefined) throw new Error(`O token ${nome} não existe em tokens.css.`)
    usados.add(nome)
    for (const achado of valor.matchAll(/var\((--[\w-]+)\)/g)) porVer.push(achado[1])
  }
  return [...usados].sort().map((nome) => `  ${nome}: ${valores.get(nome)};`).join("\n")
}

const AVISO = "GERADO por scripts/gerar-novidades.mjs a partir de docs/novidades.json. Não editar à mão."

export function gerarPagina(novidades, raiz, tokensCss) {
  const miolo = gerarMiolo(novidades, raiz)
  const corpo = "body { margin: 0; background: var(--fundo); }"
  return `<!doctype html>
<!-- ${AVISO} -->
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Orwell release notes</title>
<style>
:root {
${tokensUsados(miolo + corpo, tokensCss)}
}
${corpo}
</style>
</head>
<body>
${miolo}
</body>
</html>
`
}

export function gerarModulo(novidades, raiz) {
  return `/**
 * ${AVISO}
 *
 * O miolo da página de novidades (estilo e artigo), igual ao de
 * \`novidades.gen.html\`. Mostra-o \`screens/chat/NotasDeVersao.tsx\`.
 */
export const NOVIDADES_HTML = ${JSON.stringify(gerarMiolo(novidades, raiz))}
`
}

/** The two files as they should be now. The test compares against disk. */
export function gerarTudo() {
  const novidades = lerNovidades()
  const raiz = lerRaiz()
  const tokensCss = readFileSync(CAMINHO_DOS_TOKENS, "utf8")
  return { html: gerarPagina(novidades, raiz, tokensCss), modulo: gerarModulo(novidades, raiz) }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { html, modulo } = gerarTudo()
  writeFileSync(CAMINHO_DO_HTML, html)
  writeFileSync(CAMINHO_DO_MODULO, modulo)
  console.log(`Escrevi ${CAMINHO_DO_HTML}\nEscrevi ${CAMINHO_DO_MODULO}`)
}

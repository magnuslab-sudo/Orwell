/**
 * The quotes users see are straight ("), never angular (" ").
 *
 * Owner's order on 3 November 2026: "I don't want these quotes, always these
 * """. Applies to pt and en, in the app, on the site and in release notes.
 * Code comments and internal docs stay as they are: they are not text users read.
 *
 * This module finds angular quotes only where there is user-facing text: inside
 * code literals (strings, templates, regexes, JSX text), outside HTML comments
 * and inside strings in JSON. Tests in `packages/ui` and `apps/site` use it.
 *
 * Also runs standalone for final checking:
 *   node scripts/aspas-angulares.mjs <files...>
 */
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const ts = createRequire(import.meta.url)("typescript")
const ANGULARES = /[«»]/

const LITERAIS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.JsxText,
])

/** Code literals with " or ", like `ficheiro:linha: texto`. */
export function aspasNoCodigo(caminho, fonte = readFileSync(caminho, "utf8")) {
  const tipo = /\.[jt]sx$/.test(caminho) ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(caminho) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const arvore = ts.createSourceFile(caminho, fonte, ts.ScriptTarget.Latest, true, tipo)
  const achados = []
  const visitar = (no) => {
    if (LITERAIS.has(no.kind)) {
      const inicio = no.kind === ts.SyntaxKind.JsxText ? no.pos : no.getStart(arvore)
      const texto = fonte.slice(inicio, no.end)
      if (ANGULARES.test(texto)) {
        const linha = arvore.getLineAndCharacterOfPosition(inicio).line + 1
        achados.push(`${caminho}:${linha}: ${texto.trim()}`)
      }
    }
    ts.forEachChild(no, visitar)
  }
  visitar(arvore)
  return achados
}

/** HTML lines with " or " outside comments. */
export function aspasNoHtml(caminho, fonte = readFileSync(caminho, "utf8")) {
  const semComentarios = fonte.replace(/<!--[\s\S]*?-->/g, (comentario) => comentario.replace(/[^\n]/g, " "))
  return semComentarios
    .split("\n")
    .map((linha, i) => [linha, i + 1])
    .filter(([linha]) => ANGULARES.test(linha))
    .map(([linha, n]) => `${caminho}:${n}: ${linha.trim()}`)
}

/** JSON strings with " or ". Keys "//" are comments. */
export function aspasNoJson(caminho, fonte = readFileSync(caminho, "utf8")) {
  const achados = []
  const visitar = (valor, onde) => {
    if (typeof valor === "string") {
      if (ANGULARES.test(valor)) achados.push(`${caminho}:${onde}: ${valor}`)
    } else if (valor && typeof valor === "object") {
      for (const [chave, dentro] of Object.entries(valor)) if (!chave.startsWith("//")) visitar(dentro, `${onde}.${chave}`)
    }
  }
  visitar(JSON.parse(fonte), "$")
  return achados
}

export function aspasEm(caminho) {
  if (caminho.endsWith(".html")) return aspasNoHtml(caminho)
  if (caminho.endsWith(".json")) return aspasNoJson(caminho)
  return aspasNoCodigo(caminho)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const achados = process.argv.slice(2).flatMap(aspasEm)
  for (const achado of achados) console.log(achado)
  console.log(`${achados.length} aspas angulares no texto do utilizador.`)
  process.exitCode = achados.length > 0 ? 1 : 0
}

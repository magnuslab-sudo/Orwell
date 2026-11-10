import { readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  aspasNoCodigo,
  aspasNoJson,
  // @ts-expect-error plain JavaScript script, no declarations: it also runs
  // alone, with `node scripts/aspas-angulares.mjs`.
} from "../../../scripts/aspas-angulares.mjs"

/**
 * The quotes the user sees are straight, never angled.
 *
 * Owner's order on 3 November 2026: in the text the user sees, in pt and
 * en, quotes are always "", never angled. The change happened once, in
 * all catalogues, error codes and release notes. This test fails the day
 * a new sentence brings them back.
 *
 * It scans the entire `src` code, not just the catalogues: a sentence written
 * straight into a screen is also user text. Only what's inside
 * literals counts; comments stay out. Test files also stay out: their text
 * never reaches anyone.
 */
const src = dirname(fileURLToPath(import.meta.url))
const novidades = join(src, "../../../docs/novidades.json")

function fontes(pasta: string): string[] {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(pasta, entrada.name)
    if (entrada.isDirectory()) return fontes(caminho)
    return /\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name) ? [caminho] : []
  })
}

describe("aspas: só as direitas no texto do utilizador", () => {
  it("os catálogos de línguas não têm aspas angulares", () => {
    expect(aspasNoCodigo(join(src, "linguas/pt.ts"))).toEqual([])
    expect(aspasNoCodigo(join(src, "linguas/en.ts"))).toEqual([])
  })

  it("as mensagens de erro não têm aspas angulares", () => {
    expect(aspasNoCodigo(join(src, "lib/codigosDeErro.ts"))).toEqual([])
  })

  it("nenhum ecrã da interface tem aspas angulares", () => {
    const todos = fontes(src)
    expect(todos.length).toBeGreaterThan(100)
    expect(todos.flatMap((caminho) => aspasNoCodigo(caminho))).toEqual([])
  })

  it("as notas de versão não têm aspas angulares", () => {
    expect(aspasNoJson(novidades)).toEqual([])
  })

  it("o detector vê as angulares numa cadeia e ignora-as num comentário", () => {
    const fonte = ['// Um comentário com «aspas» fica.', 'const a = "Carrega em «Entrar»."', "const b = <p>«Sair»</p>"].join("\n")
    expect(aspasNoCodigo("exemplo.tsx", fonte)).toHaveLength(2)
    expect(aspasNoCodigo("exemplo.tsx", '// só «comentário»\nconst c = "Carrega em \\"Entrar\\"."')).toEqual([])
  })
})

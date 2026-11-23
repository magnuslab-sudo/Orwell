import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The contrast of the site's text, measured in BOTH themes.
 *
 * Same calculation as `packages/ui/src/styles/tokens.contraste.test.ts` (WCAG
 * 2.x, relative luminance), on the tokens the site writes in `src/estilo.css`.
 * It reads them from the sheet, not from a copy: if someone changes a color
 * there, this test says whether the text stays readable.
 *
 * The site follows the system (`prefers-color-scheme`). The dark theme is the
 * first `:root` block; the light theme is the `:root` block inside
 * `@media (prefers-color-scheme: light)`, and it only writes what changes: a
 * token it does not write keeps the dark value, as in the browser.
 *
 * The threshold is 4.5:1 (AA for normal text) on all pairs, including those
 * that appear only in large text: simpler, and it costs the skin nothing.
 */
const folha = readFileSync(fileURLToPath(new URL("../src/estilo.css", import.meta.url)), "utf8")
const blocoEscuro = /(?:^|\n):root\s*\{([\s\S]*?)\n\}/.exec(folha)?.[1] ?? ""
const blocoClaro = /@media \(prefers-color-scheme: light\) \{\s*:root\s*\{([\s\S]*?)\n  \}/.exec(folha)?.[1] ?? ""

/** The tokens a block writes, by name. */
function tokensDe(bloco: string): Map<string, string> {
  const tokens = new Map<string, string>()
  for (const m of bloco.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) tokens.set(m[1] as string, (m[2] as string).trim())
  return tokens
}

const escuro = tokensDe(blocoEscuro)
const claro = new Map([...escuro, ...tokensDe(blocoClaro)])
const TEMAS = [
  { tema: "escuro", tokens: escuro },
  { tema: "claro", tokens: claro },
] as const

type Rgb = readonly [number, number, number]
type Tokens = Map<string, string>

function cor(tokens: Tokens, nome: string): string {
  const valor = tokens.get(nome)
  if (!valor) throw new Error(`${nome} não está nos tokens de estilo.css`)
  return valor
}

function rgba(valor: string): { rgb: Rgb; alfa: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(valor)
  if (hex) {
    const n = Number.parseInt(hex[1] as string, 16)
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alfa: 1 }
  }
  const fn = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(valor)
  if (fn) return { rgb: [Number(fn[1]), Number(fn[2]), Number(fn[3])], alfa: Number(fn[4]) }
  throw new Error(`cor que o teste não sabe ler: ${valor}`)
}

function solida(tokens: Tokens, nome: string): Rgb {
  const { rgb, alfa } = rgba(cor(tokens, nome))
  expect(alfa, `${nome} devia ser sólida`).toBe(1)
  return rgb
}

function luminancia([r, g, b]: Rgb): number {
  const linear = (canal: number): number => {
    const c = canal / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function contraste(a: Rgb, b: Rgb): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number]
  return (claro + 0.05) / (escuro + 0.05)
}

/**
 * The surfaces where text sits: the page, the cards and bands, the raised
 * controls, and the big word behind the screenshot (the links under the main
 * button can end up over it).
 */
const SUPERFICIES = ["--fundo", "--superficie", "--superficie-alta", "--marca-dagua"]

/** The colors the site uses for text, from the loudest to the quietest, and the accent. */
const TEXTOS = ["--titulo", "--texto", "--secundario", "--apagado", "--discreto", "--acento"]

describe("os dois temas", () => {
  it("a folha tem o tema escuro no :root e o claro em prefers-color-scheme: light", () => {
    expect(blocoEscuro).toContain("color-scheme: dark;")
    expect(blocoClaro).toContain("color-scheme: light;")
    // The light theme changes the page: a light block that kept the dark page would be no theme at all.
    expect(luminancia(solida(claro, "--fundo"))).toBeGreaterThan(0.8)
    expect(luminancia(solida(escuro, "--fundo"))).toBeLessThan(0.05)
  })
})

describe.each(TEMAS)("contraste no tema $tema", ({ tokens }) => {
  it.each(TEXTOS)("%s passa 4,5:1 em todas as superfícies", (nome) => {
    const texto = solida(tokens, nome)
    for (const superficie of SUPERFICIES) {
      expect(contraste(texto, solida(tokens, superficie)), `${nome} sobre ${superficie}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each([
    ["--primario-tinta", "--primario"],
    ["--primario-tinta", "--primario-sobre"],
    ["--kofi-texto", "--kofi"],
    ["--kofi-texto", "--kofi-claro"],
  ])("a tinta %s passa 4,5:1 sobre o enchimento %s", (tinta, enchimento) => {
    // The main button and the Ko-fi button, still and under the cursor.
    expect(contraste(solida(tokens, tinta), solida(tokens, enchimento))).toBeGreaterThanOrEqual(4.5)
  })

  it("o botão principal distingue-se da página a 3:1", () => {
    // Pale cyan on a white page was 1.4:1: a main button nobody sees. That is
    // why the light theme fills it with ink (WCAG 1.4.11, non-text contrast).
    expect(contraste(solida(tokens, "--primario"), solida(tokens, "--fundo"))).toBeGreaterThanOrEqual(3)
  })

  it("a risca do aviso distingue-se das superfícies a 3:1", () => {
    for (const superficie of ["--superficie", "--superficie-alta"]) {
      expect(contraste(solida(tokens, "--aviso"), solida(tokens, superficie)), superficie).toBeGreaterThanOrEqual(3)
    }
  })
})

describe("a folha", () => {
  it("nenhum texto fica apagado por opacidade", () => {
    /*
      Opacity blends the text with what is behind it, and the pair measured
      above stops being the pair painted. Quiet text is quiet by its color
      token, which is measured. The sheet has no `opacity` at all.
    */
    const comOpacidade = [...folha.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{[^{}]*\bopacity:\s*([^;]+);/g)].map(
      (m) => `${(m[1] as string).trim()} → ${m[2]}`,
    )
    expect(comOpacidade).toEqual([])
  })

  it("as cores vivem nos dois blocos de tokens e só lá", () => {
    // No rule writes a color by hand: a color written in a rule would be the
    // same in both themes, and measured in neither. The `#000` in the masks is
    // not a color, it is the opacity of the mask.
    expect(blocoEscuro).not.toBe("")
    expect(blocoClaro).not.toBe("")
    const fora = folha.replace(blocoEscuro, "").replace(blocoClaro, "").replace(/\/\*[\s\S]*?\*\//g, "")
    const literais = [...fora.matchAll(/#[0-9a-f]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/gi)].map((m) => m[0])
    expect(literais.filter((l) => l !== "#000")).toEqual([])
  })

  it("o tema claro só escreve tokens que o escuro também tem", () => {
    // A token written only in the light block would be undefined on a dark system.
    const soNoClaro = [...tokensDe(blocoClaro).keys()].filter((nome) => !escuro.has(nome))
    expect(soNoClaro).toEqual([])
  })
})

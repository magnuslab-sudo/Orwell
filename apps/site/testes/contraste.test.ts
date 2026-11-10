import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The contrast of small site text, measured on the midnight skin.
 *
 * Same calculation as `packages/ui/src/hooks/usePrefs.test.ts` (WCAG 2.x,
 * relative luminance), but on the tokens the site writes to `:root` in
 * `src/estilo.css`. Reads them from the sheet, not from a copy: if someone changes a color
 * there, this test says whether small text stays readable.
 *
 * The threshold is 4.5:1 (AA for normal text) on all pairs, including those that appear
 * only in large text: simpler and costs nothing for the skin.
 */
const folha = readFileSync(fileURLToPath(new URL("../src/estilo.css", import.meta.url)), "utf8")
const raiz = /:root\s*\{([\s\S]*?)\n\}/.exec(folha)?.[1] ?? ""

/** The literal tokens in `:root` (those pointing to others are left out). */
const tokens = new Map<string, string>()
for (const m of raiz.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) tokens.set(m[1] as string, (m[2] as string).trim())

type Rgb = readonly [number, number, number]

function cor(nome: string): string {
  const valor = tokens.get(nome)
  if (!valor) throw new Error(`${nome} não está no :root de estilo.css`)
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

/** A color with alpha over a solid one. */
function sobre(cima: string, baixo: Rgb): Rgb {
  const { rgb, alfa } = rgba(cima)
  return [0, 1, 2].map((i) => (rgb[i] as number) * alfa + (baixo[i] as number) * (1 - alfa)) as unknown as Rgb
}

function solida(nome: string): Rgb {
  const { rgb, alfa } = rgba(cor(nome))
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

const fundo = solida("--fundo")
const vidro = sobre(cor("--vidro"), fundo)
const luz = sobre(cor("--luz-indigo"), fundo)

/**
 * The surfaces where small text appears, composed as the browser paints them.
 * The indigo light at the top corner is the brightest part of the background: the top
 * and hero rest on it.
 */
const SUPERFICIES: Record<string, Rgb> = {
  fundo,
  "vidro sobre o fundo": vidro,
  "vidro sobre a luz do canto": sobre(cor("--vidro"), luz),
  "luz do canto, sem vidro": luz,
  "poço sobre o vidro": sobre(cor("--poco"), vidro),
  "superfície alta": solida("--superficie-alta"),
  "vidro-solido": solida("--vidro-solido"),
}

/** The colors the site uses for small text (12 to 14 px, and 10 px on screen). */
const TEXTOS = ["--texto", "--titulo", "--secundario", "--apagado", "--discreto", "--acento", "--indigo", "--ocupado"]

describe("contraste na pele midnight", () => {
  it("o vidro sobre o fundo é o vidro-solido de tokens.css", () => {
    // The same number the app uses as "the composed glass". If it differs,
    // the glass or background changed and the token block needs full review.
    const esperado = solida("--vidro-solido")
    for (const i of [0, 1, 2]) expect(Math.round(vidro[i] as number)).toBe(esperado[i])
  })

  it.each(TEXTOS)("%s passa 4,5:1 em todas as superfícies", (nome) => {
    const texto = solida(nome)
    for (const [superficie, rgb] of Object.entries(SUPERFICIES)) {
      expect(contraste(texto, rgb), `${nome} sobre ${superficie}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(["--indigo", "--acento"])("a tinta escura passa 4,5:1 sobre %s, as duas pontas do primário", (nome) => {
    expect(contraste(solida("--tinta"), solida(nome))).toBeGreaterThanOrEqual(4.5)
  })

  it("a tinta escura passa 4,5:1 sobre os avatares da tela", () => {
    expect(contraste(solida("--tinta"), solida("--ocupado"))).toBeGreaterThanOrEqual(4.5)
  })

  it("nenhum texto fica apagado por opacidade", () => {
    /*
      Opacity blends the text with what is behind it, and the pair measured
      above stops being the pair painted. That is what happened to "Em concreto"
      in the table (55 %), the table labels on mobile (70 %), the "Android and iOS"
      card (72 %) and the footer note (75 %): all four started to fade by color.
      
      Outside `@keyframes` (motion, which stops with `prefers-reduced-motion`),
      only rain has opacity, and rain has no text.
      */
    const semAnimacoes = folha.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
    const comOpacidade = [...semAnimacoes.matchAll(/([^{}]+)\{[^{}]*\bopacity:\s*([^;]+);/g)].map((m) =>
      `${(m[1] as string).replace(/\/\*[\s\S]*?\*\//g, "").trim()} → ${m[2]}`,
    )
    // `opacity: 1` does not fade anything: it is the still state of the pulse and cursor.
    const apagados = comOpacidade.filter((linha) => !linha.endsWith("→ 1"))
    expect(apagados).toEqual([".ceu::after → var(--chuva-opacidade)"])
  })

  it("as cores da pele vivem no :root e só lá", () => {
    // The `tokens.css` rule: no rule writes a skin color by hand. The `#000` on the
    // floor masks is not color, it is the mask opacity.
    const fora = folha.replace(raiz, "").replace(/\/\*[\s\S]*?\*\//g, "")
    const literais = [...fora.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0])
    expect(literais.filter((l) => l !== "#000")).toEqual([])
  })
})

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The presence ring (requested by the owner on October 27, 2026): new colors
 * measured against the surfaces where faces appear.
 *
 * The ring is a graphic signal, not text: the WCAG minimum is 3:1 (1.4.11). The
 * offline gray is left out on purpose, as in `CartaoDaConta.contraste.test.ts`:
 * it is gray because it says signal is absent. Same WCAG math as in
 * `hooks/usePrefs.test.ts`.
 */
const ler = (relativo: string): string => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8")
const semComentarios = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "")
const tokens = semComentarios(ler("../styles/tokens.css"))
const componentes = semComentarios(ler("../styles/components.css"))

type Rgb = readonly [number, number, number]
type Rgba = readonly [number, number, number, number]

/** A token, followed by `var()` until a literal is reached. */
function token(nome: string): string {
  const valor = new RegExp(`${nome}:\\s*([^;]+);`).exec(tokens)?.[1]?.trim()
  if (!valor) throw new Error(`falta ${nome} em tokens.css`)
  const ref = /^var\((--[\w-]+)\)$/.exec(valor)
  return ref ? token(ref[1]!) : valor
}

const rgb = (hex: string): Rgb => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`não é #rrggbb: ${hex}`)
  const v = Number.parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

function rgba(nome: string): Rgba {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(token(nome))
  if (!m) throw new Error(`${nome} não é rgba`)
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as const
}

function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number): number => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const first = luminance(a)
  const second = luminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

const compor = (base: Rgb, [r, g, b, a]: Rgba): Rgb =>
  [base[0] + (r - base[0]) * a, base[1] + (g - base[1]) * a, base[2] + (b - base[2]) * a] as const

/** The distance between two colors, so red is not read as pink. */
const distancia = (a: Rgb, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

const fundo = rgb(token("--fundo"))
const manchas = ["--aurora-azul", "--aurora-violeta", "--aurora-rosa", "--aurora-verde"].map(rgba)
const tintas = ["--painel-tinta", "--painel-claro", "--painel-barra", "--painel-poco"]

/** Where faces are: the solid surfaces, and each panel color on each dawn tint. */
const superficies: Record<string, Rgb> = {
  "--fundo": fundo,
  "--bg-side": rgb(token("--bg-side")),
  "--bg-main": rgb(token("--bg-main")),
  "--bg-raised": rgb(token("--bg-raised")),
  "--bg-hover": rgb(token("--bg-hover")),
  ...Object.fromEntries(
    tintas.flatMap((tinta) => [
      [`${tinta} sobre o fundo`, compor(fundo, rgba(tinta))],
      ...manchas.map((mancha, i) => [`${tinta} sobre a mancha ${i + 1}`, compor(compor(fundo, mancha), rgba(tinta))]),
    ]),
  ),
}

describe("anéis de presença — as regras que estas contas supõem", () => {
  it("cada estado tem a sua cor, e o cinzento é a por omissão", () => {
    expect(componentes).toMatch(/\[data-anel\]\s*\{[^}]*--anel-cor:\s*var\(--presence-offline\)/)
    expect(componentes).toMatch(/\[data-anel="online"\]\s*\{\s*--anel-cor:\s*var\(--presence-online\)/)
    expect(componentes).toMatch(/\[data-anel="ausente"\]\s*\{\s*--anel-cor:\s*var\(--presence-away\)/)
    expect(componentes).toMatch(/\[data-anel="ocupado"\]\s*\{\s*--anel-cor:\s*var\(--presence-busy\)/)
  })

  it("o pulso só anima transform e opacity, e com menos movimento pulsa mais devagar sobre um anel mais grosso", () => {
    const fotogramas = /@keyframes anel-pulsa\s*\{([\s\S]*?)\n\}/.exec(componentes)?.[1] ?? ""
    expect(fotogramas).toMatch(/transform/)
    expect(fotogramas.replace(/transform|opacity|scale|[\d.%{}():;\s]/g, "")).toBe("")
    expect(componentes).toMatch(/animation:\s*anel-pulsa 1\.6s ease-in-out infinite/)
    expect(componentes).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*\[data-anel\]\[data-em-chamada\]\s*\{\s*box-shadow:\s*0 0 0 3px/,
    )
    expect(componentes).toMatch(/\[data-anel\]\[data-em-chamada\]::after\s*\{\s*animation:\s*anel-pulsa-calmo 3\.2s/)
  })
})

describe("anéis de presença — o contraste", () => {
  it.each([
    ["online (--presence-online)", "--presence-online"],
    ["ausente (--presence-away)", "--presence-away"],
    ["ocupado (--presence-busy)", "--presence-busy"],
  ])("o anel %s passa 3:1 sobre todas as superfícies", (_nome, cor) => {
    for (const [onde, superficie] of Object.entries(superficies)) {
      expect(contrast(rgb(token(cor)), superficie), onde).toBeGreaterThanOrEqual(3)
    }
  })

  it('o vermelho de ocupado não é o rosa de "sem ligação", nem o amarelo é o lima de "a religar"', () => {
    expect(distancia(rgb(token("--presence-busy")), rgb(token("--danger")))).toBeGreaterThan(60)
    expect(distancia(rgb(token("--presence-away")), rgb(token("--warning")))).toBeGreaterThan(60)
    expect(distancia(rgb(token("--presence-away")), rgb(token("--presence-busy")))).toBeGreaterThan(60)
  })
})

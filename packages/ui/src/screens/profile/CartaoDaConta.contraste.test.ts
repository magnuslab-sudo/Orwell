import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The account bar (chosen by the owner on October 27 2026): the contrast of
 * what is read on it.
 *
 * Buttons have no border at rest, and the muted microphone is said by pink on a
 * background tinted the same pink: each blend point in the background brings it
 * closer to the design. It is measured here with the same WCAG account as
 * `hooks/usePrefs.test.ts` and `screens/call/barraMinima.test.tsx`, against the
 * bar above the dawn in the worst case: each spot at maximum, without the blur
 * lowering it, and above it the column ink and the bar ink (or the bar ink only).
 */
const ler = (relativo: string): string => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8")
const semComentarios = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "")
const tokens = semComentarios(ler("../../styles/tokens.css"))
const ecras = semComentarios(ler("../../styles/screens.css"))

function token(nome: string): string {
  const valor = new RegExp(`${nome}:\\s*(#[0-9a-f]{6})`, "i").exec(tokens)?.[1]
  if (!valor) throw new Error(`falta ${nome} em tokens.css`)
  return valor
}

type Rgb = readonly [number, number, number]
type Rgba = readonly [number, number, number, number]
const rgb = (hex: string): Rgb => {
  const v = Number.parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

function rgbaDe(nome: string): Rgba {
  const m = new RegExp(`${nome}:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)\\)`).exec(tokens)
  if (!m) throw new Error(`falta ${nome} em tokens.css`)
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as const
}

/** WCAG relative luminance, as in `usePrefs.test.ts`. */
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

/** An `rgba` layer on top of a solid color. */
const compor = (base: Rgb, [r, g, b, a]: Rgba): Rgb =>
  [base[0] + (r - base[0]) * a, base[1] + (g - base[1]) * a, base[2] + (b - base[2]) * a] as const

/** `color-mix(in srgb, cor P%, branco)`, like the focus highlight. */
const misturarComBranco = (cor: Rgb, fraccao: number): Rgb =>
  [cor[0] * fraccao + 255 * (1 - fraccao), cor[1] * fraccao + 255 * (1 - fraccao), cor[2] * fraccao + 255 * (1 - fraccao)] as const

const fundo = rgb(token("--fundo"))
const manchas = ["--aurora-azul", "--aurora-violeta", "--aurora-rosa", "--aurora-verde"].map(rgbaDe)
const tintaDaColuna = rgbaDe("--painel-tinta")
const tintaDaFaixa = rgbaDe("--painel-barra")

/** The surfaces beneath what you read: the banner over each item, with and without the column. */
const faixas: Record<string, Rgb> = {
  "a faixa sobre o fundo": compor(fundo, tintaDaFaixa),
  ...Object.fromEntries(
    manchas.flatMap((mancha, i) => [
      [`a faixa sobre a mancha ${i + 1}`, compor(compor(fundo, mancha), tintaDaFaixa)],
      [`a faixa sobre a coluna e a mancha ${i + 1}`, compor(compor(compor(fundo, mancha), tintaDaColuna), tintaDaFaixa)],
    ]),
  ),
}

const rosa = rgb(token("--rosa"))
/** The background of the focus: `color-mix(in srgb, var(--danger) 12%, transparent)` on top of the banner. */
const calado = (faixa: Rgb): Rgb => compor(faixa, [...rosa, 0.12] as const)

const regra = (seletor: string): string =>
  new RegExp(`(?:^|\\n)${seletor.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`).exec(ecras)?.[1] ?? ""

describe("faixa da conta — as regras que estas contas supõem", () => {
  it("a faixa é a tinta da barra mínima, sem raio nem margem, com uma linha por cima", () => {
    const faixa = regra(".me-faixa")
    expect(faixa).toMatch(/background:\s*var\(--painel-barra\)/)
    expect(faixa).toMatch(/border-top:\s*1px solid var\(--line\)/)
    expect(faixa).not.toMatch(/border-radius|margin/)
  })

  it("o calado é rosa sobre o rosa a 12 %, e o realce mistura 82 % com branco", () => {
    expect(regra(".me-audio-btn.off")).toMatch(/color:\s*var\(--danger\)/)
    expect(regra(".me-audio-btn.off")).toMatch(/color-mix\(in srgb, var\(--danger\) 12%, transparent\)/)
    expect(regra(".me-audio-btn.off:hover")).toMatch(/color-mix\(in srgb, var\(--danger\) 82%, #fff\)/)
    expect(tokens).toMatch(/--danger:\s*var\(--rosa\)/)
  })

  it("o estado usa a cor discreta, que é a mais fraca da faixa", () => {
    expect(regra(".me-state")).toMatch(/color:\s*var\(--text-faint\)/)
    expect(tokens).toMatch(/--text-faint:\s*var\(--discreto\)/)
  })

  it("já não há cartão nem contorno a girar", () => {
    expect(ecras).not.toMatch(/\.me-card\b/)
    expect(ecras).not.toMatch(/giraContornoConta/)
    expect(semComentarios(ler("../../styles/pele.css"))).not.toMatch(/\.me-card\b/)
  })
})

describe("faixa da conta — o contraste", () => {
  it.each(Object.keys(faixas))("o microfone calado passa 4,5:1 sobre %s, em repouso e com o rato", (onde) => {
    const faixa = faixas[onde]!
    expect(contrast(rosa, calado(faixa))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(misturarComBranco(rosa, 0.82), calado(faixa))).toBeGreaterThanOrEqual(4.5)
  })

  it.each([
    ['o estado ("Ocupado · 42 ms", --discreto)', "--discreto"],
    ["os ícones em repouso (--apagado)", "--apagado"],
    ["o nome (--texto)", "--texto"],
  ])("%s passa 4,5:1 sobre todas as faixas", (_nome, cor) => {
    for (const [onde, faixa] of Object.entries(faixas)) {
      expect(contrast(rgb(token(cor)), faixa), onde).toBeGreaterThanOrEqual(4.5)
    }
  })

  /*
    Dots are not text: the minimum WCAG threshold for a graphical signal is 3:1
    (1.4.11). Gray "Invisible" is excluded on purpose: it is gray because it
    means absent, and the word "Invisible" is written next to it.
  */
  it.each([
    ["ligado (--presenca)", "--presenca"],
    ["ocupado (--presence-busy)", "--presence-busy"],
    ["a religar (--warning)", "--warning"],
    ["sem ligação (--rosa)", "--rosa"],
  ])("o ponto %s passa 3:1 sobre todas as faixas", (_nome, cor) => {
    for (const [onde, faixa] of Object.entries(faixas)) {
      expect(contrast(rgb(token(cor)), faixa), onde).toBeGreaterThanOrEqual(3)
    }
  })
})

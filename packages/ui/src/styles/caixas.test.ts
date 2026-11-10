import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The checkmark in the checkbox stays centered in the box, at any scale.
 *
 * jsdom does not render, so the real measurement is pixels, in
 * `scripts/medir-caixas.mjs` (Chromium at 100%, 125%, and 150%, on web and
 * desktop). Here we pin what that measurement proved are the two causes of the
 * checkmark being low on Windows (November 4, 2026):
 *
 * 1. **The checkmark drawing was low.** The polygon ran from 13% to 93% in the
 *    vertical: its center was at 53%, one-third of a CSS pixel below the box
 *    center, always. At 125% and 150% that is already half a screen pixel.
 * 2. **The checkmark was a separate box.** An 11 px `::before`, centered by
 *    grid, rounds to screen pixels on its own, and the outer box rounds on its
 *    own account. At a fractional position (the "Remember session" box is at
 *    y = 412.34) the two roundings went different ways, and the checkmark
 *    jumped up to 1.5 screen pixels. Now the `::before` takes the whole box
 *    and the checkmark is a mask centered inside it: there is one rounding.
 */
const ler = (relativo: string): string => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8")
const folha = ler("./components.css").replace(/\/\*[\s\S]*?\*\//g, "")

function regra(selector: string): string {
  const escapado = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const encontrada = new RegExp(`(^|\\})\\s*${escapado}\\s*\\{([^}]*)\\}`).exec(folha)
  return encontrada?.[2] ?? ""
}

/** The points of the checkmark polygon, as a percentage of the mask box. */
function pontosDoVisto(corpo: string): Array<[number, number]> {
  const svg = /mask:\s*url\("data:image\/svg\+xml,([^"]+)"\)/.exec(corpo)?.[1]
  if (!svg) return []
  const pontos = /points='([^']+)'/.exec(decodeURIComponent(svg))?.[1] ?? ""
  return pontos
    .trim()
    .split(/\s+/)
    .map((par) => par.split(",").map(Number) as [number, number])
}

describe("o visto das caixas de verificação", () => {
  const antes = regra('input[type="checkbox"]::before')

  it("ocupa a caixa inteira, para ser arredondado aos píxeis com ela", () => {
    expect(antes).toMatch(/width:\s*100%/)
    expect(antes).toMatch(/height:\s*100%/)
    expect(antes).not.toMatch(/clip-path/)
  })

  it("é uma máscara centrada, com o tamanho de sempre (11 px)", () => {
    expect(antes).toMatch(/mask:\s*url\([^)]*\)\s*center\s*\/\s*11px\s+11px\s+no-repeat/)
    // The color keeps coming from the variable, not from a literal in the image.
    expect(antes).toMatch(/background:\s*var\(--on-accent\)/)
  })

  it("tem o desenho centrado: o rectângulo que o envolve tem o centro no meio", () => {
    const pontos = pontosDoVisto(antes)
    expect(pontos.length).toBeGreaterThanOrEqual(3)
    const xs = pontos.map(([x]) => x)
    const ys = pontos.map(([, y]) => y)
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(50, 5)
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(50, 5)
  })

  it("a caixa continua sem o padding dos campos de texto (33c6f526)", () => {
    const caixa = regra('input[type="checkbox"]')
    expect(caixa).toMatch(/box-sizing:\s*border-box/)
    expect(caixa).toMatch(/padding:\s*0/)
    expect(caixa).toMatch(/place-items:\s*center/)
  })
})

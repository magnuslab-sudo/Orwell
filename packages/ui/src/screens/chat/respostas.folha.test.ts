/**
 * The reply sheet: the quote on a single line, and the highlight of the original
 * that keeps fading with reduced motion, slower.
 *
 * The second point is house rules (the owner's Windows has animation effects off):
 * an animation that stops reads as a glitch. The search highlight stopped, with
 * `animation: none`, and disappeared all at once. Now it fades slower, overriding
 * the universal rule from `base.css`.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const estilos = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "styles")
const folha = (nome: string): string => readFileSync(join(estilos, nome), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")

describe("o realce do original", () => {
  const screens = folha("screens.css")

  it("com movimento reduzido continua a esvanecer, mais devagar, e por cima da regra universal", () => {
    const bloco = screens.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\.message\.destacada \{([^}]*)\}/)?.[1]
    expect(bloco, "o bloco de movimento reduzido do realce").toBeDefined()
    expect(bloco).not.toContain("animation: none")
    expect(bloco).toMatch(/animation:\s*procura-acende\s+[\d.]+s\s+[^;]*!important/)
    const lento = Number(/procura-acende\s+([\d.]+)s/.exec(bloco ?? "")?.[1])
    const normal = Number(/\.message\.destacada \{[^}]*procura-acende\s+([\d.]+)s/.exec(screens)?.[1])
    expect(normal).toBeGreaterThan(0)
    expect(lento).toBeGreaterThanOrEqual(normal * 2)
  })
})

describe("a citação", () => {
  const screens = folha("screens.css")

  it("o texto do original fica numa linha, cortado com reticências", () => {
    const regra = screens.match(/^\.message-citacao-texto \{([^}]*)\}/m)?.[1] ?? ""
    expect(regra).toMatch(/white-space:\s*nowrap/)
    expect(regra).toMatch(/text-overflow:\s*ellipsis/)
    expect(regra).toMatch(/overflow:\s*hidden/)
  })

  it("a mensagem acompanha o dedo na vertical, e o deslize horizontal é nosso", () => {
    expect(screens).toMatch(/\.message \{[^}]*touch-action:\s*pan-y/)
  })
})

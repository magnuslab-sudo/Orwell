import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The notch margin, read from the sheet.
 *
 * jsdom does not apply CSS and no test in this suite runs on a phone with a
 * notch: what we pin here is the math we catch when reading. The `index.html`
 * of the web app requests `viewport-fit=cover`, and from then on anyone not
 * respecting `env(safe-area-inset-*)` ends up below the clock or the gesture
 * bar. If this sheet disappears from `styles.css`, or loses the root rule,
 * nothing turns red anywhere except here.
 */
const ler = (relativo: string): string => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8")
const semComentarios = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "")

const entrada = semComentarios(ler("../styles.css"))
const folha = semComentarios(ler("./movel.css"))

describe("movel.css", () => {
  it("entra depois das folhas a que acrescenta margem, e antes do fundo", () => {
    const ordem = [...entrada.matchAll(/@import "\.\/styles\/([a-z]+)\.css"/g)].map((m) => m[1])
    expect(ordem).toEqual(["fontes", "tokens", "base", "components", "screens", "overlays", "vozes", "pele", "painel", "paineis", "movel", "fundo"])
  })

  it.each(["top", "right", "bottom", "left"])("a margem de %s vem do aparelho, e vale zero sem entalhe", (lado) => {
    expect(folha).toMatch(new RegExp(`--seguro-[a-z]+:\\s*env\\(safe-area-inset-${lado}, 0px\\)`))
  })

  it("a raiz da aplicação e a do portão ficam dentro do rectângulo seguro", () => {
    const regra = /\.app,\s*\.gate\s*\{([^}]*)\}/.exec(folha)?.[1] ?? ""
    expect(regra.replace(/\s+/g, " ").trim()).toBe(
      "padding: var(--seguro-topo) var(--seguro-direita) var(--seguro-fundo) var(--seguro-esquerda);",
    )
  })

  it("nenhuma regra inventa um número: ou é a margem, ou é o que lá estava mais a margem", () => {
    // On a screen with no notch each declaration must return the original value.
    // A `bottom: 24px` written by hand here would change the desktop without anyone
    // noticing.
    //
    // `+ var(--teclado, 0px)` is the second allowed term, and we allow it for the
    // same reason as the first: with no keyboard open it is zero (no one writes to
    // it outside of `pointer: coarse`, see `useVisualViewport`), and the
    // declaration returns exactly what it already did. What stays forbidden is what
    // always was: a number written by hand.
    const declaracoes = [...folha.matchAll(/^\s*(top|right|bottom|left):\s*([^;]+);/gm)].map((m) => m[2] as string)
    expect(declaracoes.length).toBeGreaterThan(8)
    for (const valor of declaracoes) {
      expect(valor).toMatch(
        /^(var\(--seguro-[a-z]+\)|calc\((var\(--space-\d\)|\d+px) \+ var\(--seguro-[a-z]+\)( \+ var\(--teclado, 0px\))?\))$/,
      )
    }
  })

  it("com o dedo, os campos escrevem a 16 px, que é o que impede o iOS de ampliar a página", () => {
    const bloco = /@media \(pointer: coarse\)\s*\{([\s\S]*?\})\s*\}/.exec(folha)?.[1] ?? ""
    expect(bloco).toMatch(/textarea/)
    expect(bloco).toMatch(/input:not\(/)
    expect(bloco).toMatch(/font-size:\s*16px\s*!important/)
  })

  it("e sem o dedo não toca na letra de campo nenhum", () => {
    const foraDoBloco = folha.replace(/@media \(pointer: coarse\)\s*\{[\s\S]*?\}\s*\}/, "")
    expect(foraDoBloco).not.toMatch(/font-size/)
  })
})

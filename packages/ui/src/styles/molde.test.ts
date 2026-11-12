import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The common template of stylesheets, read from the stylesheet.
 
 * The owner's report (0.7.2): "the invite menu is broken". Four general rules were the source of what showed up in the sheets, and jsdom doesn't apply CSS: this is where we lock down what fixes them. The real measurement (stuck blocks, horizontal scroll, the field with the keyboard open) is in `scripts/retratar-midnight.mjs`.
 */
const ler = (relativo: string): string =>
  readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
const folhas = ["./components.css", "./overlays.css", "./screens.css"].map(ler).join("\n")

/** The declarations of rules whose selector is exactly this one. */
function regra(selector: string): string {
  const escapado = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return [...folhas.matchAll(new RegExp(`(?:^|\\})\\s*${escapado}\\s*\\{([^}]*)\\}`, "g"))]
    .map((m) => m[1])
    .join("\n")
}

describe("o molde das folhas", () => {
  it("um invólucro no corpo da folha (`.sheet-grupo`) tem o mesmo espaço entre blocos", () => {
    const grupo = regra(".sheet-grupo")
    expect(grupo).toMatch(/display:\s*flex/)
    expect(grupo).toMatch(/flex-direction:\s*column/)
    expect(grupo).toMatch(/gap:\s*var\(--space-4\)/)
    expect(regra(".sheet-body")).toMatch(/gap:\s*var\(--space-4\)/)
    // And `hidden` still hides, despite `display: flex`.
    expect(regra(".sheet-grupo[hidden]")).toMatch(/display:\s*none/)
  })

  it("um `<label>` que é botão não herda as maiúsculas do rótulo de campo", () => {
    expect(regra("label")).toMatch(/text-transform:\s*uppercase/)
    const botao = regra("label:is(.ghost, .primary, .action, .chip)")
    expect(botao).toMatch(/text-transform:\s*none/)
    expect(botao).toMatch(/letter-spacing:\s*normal/)
  })

  it("o primário tem tamanho de letra próprio, como o fantasma", () => {
    for (const seletor of [".primary", ".ghost"]) {
      expect(regra(seletor), seletor).toMatch(/font-size:\s*var\(--font-base\)/)
    }
  })

  it("as opções de uma caixa de escolha (`.role-group`) não ficam coladas", () => {
    const grupo = regra(".role-group")
    expect(grupo).toMatch(/gap:\s*var\(--space-3\)/)
    expect(grupo).not.toMatch(/gap:\s*2px/)
  })
})

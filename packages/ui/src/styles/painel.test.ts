/**
 * The control panel at the bottom of the column, design P1 from the owner
 * (28 October 2026), read in the sheet.
 *
 * jsdom doesn't apply CSS: this file pins down what the design agreed on (the
 * faint green call box, green only in the measure, a row of equal 38 px
 * buttons, the ghost hang up that turns red for "busy" on hover). The real
 * geometry (nothing overlaps, nothing leaves the column) is in
 * `scripts/retratar-painel-de-controlo.mjs`.
 *
 * It inherited tests from `pele.lateral.test.ts` (choice A, the morning of the
 * same day): the ghost hang up and green only in the measure remain.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"

const regras = (): string => {
  const meu = expect.getState().testPath
  if (!meu) throw new Error("sem caminho do teste")
  return readFileSync(join(dirname(meu), "painel.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
}
const bloco = (selector: string): string =>
  regras().match(new RegExp("(?:^|\\})\\s*" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}"))?.[1] ?? ""

describe("o painel de controlo (P1)", () => {
  it("é uma coluna de andares, com 14 px de folga e 12 entre andares", () => {
    const painel = bloco(".me-faixa.painel")
    expect(painel).toMatch(/flex-direction:\s*column/)
    expect(painel).toMatch(/padding:\s*14px/)
    expect(painel).toMatch(/gap:\s*12px/)
  })

  it("a cara tem 46 px e o nome 16", () => {
    expect(bloco(".me-faixa.painel .me-avatar > .avatar")).toMatch(/width:\s*46px/)
    expect(bloco(".me-faixa.painel .me-avatar > .avatar")).toMatch(/height:\s*46px/)
    expect(bloco(".me-faixa.painel .me-name")).toMatch(/font-size:\s*16px/)
  })

  it("a caixa da chamada é verde ténue, com raio 12, e o verde forte fica só na medida", () => {
    const caixa = bloco(".call-dock.lateral")
    expect(caixa).toMatch(/border:\s*1px solid rgba\(80, 250, 123, 0\.28\)/)
    expect(caixa).toMatch(/background:\s*rgba\(80, 250, 123, 0\.06\)/)
    expect(caixa).toMatch(/border-radius:\s*12px/)
    expect(caixa).not.toContain("--presenca")
    expect(bloco(".call-dock.lateral .call-dock-texto")).toMatch(/color:\s*var\(--presenca\)/)
    expect(bloco(".call-dock.lateral .call-dock-state")).toMatch(/color:\s*var\(--titulo\)/)
  })

  it("a fila é uma grelha, e as secções com nome são subgrelhas dela", () => {
    expect(bloco(".me-faixa.painel .me-accoes")).toMatch(/display:\s*grid/)
    const seccoes = regras().match(/\.me-faixa\.painel \.me-audio,\s*\.me-faixa\.painel \.me-conta\s*\{([^}]*)\}/)?.[1] ?? ""
    expect(seccoes).toMatch(/grid-template-columns:\s*subgrid/)
  })

  it("os botões são iguais, de 38 px, no poço", () => {
    const botoes = regras().match(/\.me-faixa\.painel \.me-audio-btn,\s*\.me-faixa\.painel \.me-btn\s*\{([^}]*)\}/)?.[1] ?? ""
    expect(botoes).toMatch(/height:\s*38px/)
    expect(botoes).toMatch(/width:\s*100%/)
    expect(botoes).toMatch(/background:\s*var\(--poco\)/)
  })

  it("o calado continua rosa dentro do painel", () => {
    expect(bloco(".me-faixa.painel .me-audio-btn.off")).toMatch(/color:\s*var\(--danger\)/)
  })

  it('sair é um fantasma em repouso e vermelho de "ocupado" ao passar o rato ou com o foco', () => {
    const repouso = bloco(".me-faixa.painel .me-btn.me-sair")
    expect(repouso).not.toContain("--presence-busy")
    const aoPassar =
      regras().match(
        /\.me-faixa\.painel \.me-btn\.me-sair:hover,\s*\.me-faixa\.painel \.me-btn\.me-sair:focus-visible\s*\{([^}]*)\}/,
      )?.[1] ?? ""
    expect(aoPassar).toMatch(/background:\s*var\(--presence-busy\)/)
    expect(aoPassar).toMatch(/color:\s*var\(--on-danger\)/)
  })
})

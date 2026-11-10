import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { strings } from "../../strings.js"
import { SaiuDeBeta } from "./SaiuDeBeta.js"

afterEach(cleanup)

/**
 * The 1.0 cutoff screen. The text is D3 approved by the owner: the test fixes
 * it word for word, so no style revision changes it without decision.
 */
describe('o ecrã "O Orwell saiu de beta"', () => {
  it("diz exactamente o texto aprovado (D3)", () => {
    render(<SaiuDeBeta onCriarContaNova={() => {}} />)
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("O Orwell saiu de beta.")
    expect(
      screen.getByText(
        "Obrigado por testares o Orwell. Mudámos a forma como as conversas são guardadas, para o servidor saber ainda menos. As contas do beta não passam para a versão nova. Lamentamos: tens de criar uma conta nova.",
      ),
    ).toBeTruthy()
  })

  it('tem um botão só, "Criar conta nova"', () => {
    render(<SaiuDeBeta onCriarContaNova={() => {}} />)
    const botoes = screen.getAllByRole("button")
    expect(botoes).toHaveLength(1)
    expect(botoes[0]!.textContent).toBe("Criar conta nova")
  })

  it("não pede palavra-passe, nem campo nenhum, nem oferece exportar", () => {
    const { container } = render(<SaiuDeBeta onCriarContaNova={() => {}} />)
    // 1.0 does not read a beta vault: no field where to type the password.
    expect(container.querySelector("input")).toBeNull()
    expect(container.querySelector("form")).toBeNull()
    expect(document.body.textContent).not.toMatch(/export|palavra-passe/i)
    expect(document.body.textContent).not.toContain(strings.comoFunciona.link)
  })

  it("o clique chama `onCriarContaNova`, uma vez", () => {
    const onCriarContaNova = vi.fn()
    render(<SaiuDeBeta onCriarContaNova={onCriarContaNova} />)
    fireEvent.click(screen.getByRole("button", { name: strings.saiuDeBeta.criarContaNova }))
    expect(onCriarContaNova).toHaveBeenCalledOnce()
  })
})

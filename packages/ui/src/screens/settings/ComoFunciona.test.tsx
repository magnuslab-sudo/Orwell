import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { definirLingua, strings } from "../../strings.js"
import { ComoFunciona, FolhaComoFunciona, IDEIAS } from "./ComoFunciona.js"

afterEach(() => {
  cleanup()
  definirLingua("pt")
})

const cartoes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".como-funciona-cartao")]

describe("Como funciona: seis ideias, um cartão cada", () => {
  it("há seis cartões, pela ordem do plano, cada um com título, frases e desenho", () => {
    render(<ComoFunciona />)
    expect(cartoes().map((cartao) => cartao.dataset.ideia)).toEqual([
      "carteiro",
      "chave",
      "cofre",
      "canal",
      "aparelhos",
      "servidor",
    ])
    for (const [i, cartao] of cartoes().entries()) {
      const ideia = IDEIAS[i]!
      expect(within(cartao).getByRole("heading", { level: 3 }).textContent).toBe(strings.comoFunciona[ideia].titulo)
      expect(cartao.textContent).toContain(strings.comoFunciona[ideia].resumo)
      // The drawing is conveyed to the screen reader by the caption, not by the loose letters.
      expect(within(cartao).getByRole("img").getAttribute("aria-label")).toBe(strings.comoFunciona[ideia].desenho)
    }
  })

  it('o cartão dos aparelhos abre com "Uma conta chega para todos os teus aparelhos."', () => {
    render(<ComoFunciona />)
    const aparelhos = cartoes().find((cartao) => cartao.dataset.ideia === "aparelhos")!
    expect(aparelhos.querySelector("p")?.textContent?.startsWith("Uma conta chega para todos os teus aparelhos.")).toBe(true)
  })

  it('"Ler mais" abre o resto no próprio cartão, e "Ler menos" fecha-o', async () => {
    const pessoa = userEvent.setup()
    render(<ComoFunciona />)
    const primeiro = cartoes()[0]!
    const resto = strings.comoFunciona.carteiro.mais[0]!
    expect(primeiro.textContent).not.toContain(resto)

    const botao = within(primeiro).getByRole("button", { name: strings.comoFunciona.lerMais })
    expect(botao.getAttribute("aria-expanded")).toBe("false")
    await pessoa.click(botao)
    expect(primeiro.textContent).toContain(resto)
    expect(botao.getAttribute("aria-expanded")).toBe("true")
    expect(botao.textContent).toBe(strings.comoFunciona.lerMenos)
    // Only this card opened: the others still have two sentences.
    expect(cartoes()[1]!.textContent).not.toContain(strings.comoFunciona.chave.mais[0]!)

    await pessoa.click(botao)
    expect(primeiro.textContent).not.toContain(resto)
    expect(botao.textContent).toBe(strings.comoFunciona.lerMais)
  })

  it("as setas de cada desenho apontam para a sua ponta, mesmo com a página montada duas vezes", () => {
    render(
      <>
        <ComoFunciona />
        <ComoFunciona />
      </>,
    )
    const ids = [...document.querySelectorAll("marker")].map((marker) => marker.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("em inglês, o texto e os desenhos estão em inglês", () => {
    definirLingua("en")
    render(<ComoFunciona />)
    expect(screen.getByRole("heading", { name: "The server is a postman who cannot read" })).toBeTruthy()
    expect(cartoes()).toHaveLength(6)
    const aparelhos = cartoes().find((cartao) => cartao.dataset.ideia === "aparelhos")!
    expect(aparelhos.textContent).toContain("One account is enough for all your devices.")
    // The letters inside the SVG also changed.
    expect(cartoes()[0]!.querySelector("svg")?.textContent).toContain("sees only the channel address")
    expect(screen.getAllByRole("button", { name: "Read more" })).toHaveLength(6)
  })

  it("na folha, tem título e fecha", async () => {
    const pessoa = userEvent.setup()
    const onClose = vi.fn()
    render(<FolhaComoFunciona onClose={onClose} />)
    const folha = screen.getByRole("dialog", { name: strings.comoFunciona.titulo })
    expect(folha.querySelectorAll(".como-funciona-cartao")).toHaveLength(6)
    await pessoa.click(within(folha).getByRole("button", { name: strings.common.close }))
    expect(onClose).toHaveBeenCalled()
  })
})

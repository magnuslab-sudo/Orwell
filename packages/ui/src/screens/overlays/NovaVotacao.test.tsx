import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { strings } from "../../strings.js"
import { NovaVotacao } from "./NovaVotacao.js"

afterEach(cleanup)

const abrir = (onSubmit = vi.fn().mockResolvedValue(undefined)): typeof onSubmit => {
  render(<NovaVotacao onSubmit={onSubmit} onCancel={() => {}} />)
  return onSubmit
}

const campo = (rotulo: string): HTMLElement => screen.getByLabelText(rotulo)
const botaoCriar = (): HTMLButtonElement =>
  screen.getByRole("button", { name: strings.votacao.confirmar }) as HTMLButtonElement

describe("criar uma votação", () => {
  it("abre com duas opções, porque uma pergunta com uma resposta não é uma pergunta", () => {
    abrir()
    expect(campo(strings.votacao.opcaoLabel(1))).toBeTruthy()
    expect(campo(strings.votacao.opcaoLabel(2))).toBeTruthy()
    expect(screen.queryByLabelText(strings.votacao.opcaoLabel(3))).toBeNull()
  })

  /**
   * The note says the two things the creator must know BEFORE creating, and
   * both are design decisions: votes are visible, and there is no deadline.
   *
   * It lives here and not just in a comment because it makes a backwards
   * promise: it does not promise secrecy, it says there is none. A product
   * that sells privacy cannot leave this unsaid where the person makes
   * the choice.
   */
  it("diz, antes de criar, que os votos são visíveis e que não há prazo", () => {
    abrir()
    expect(screen.getByText(strings.votacao.nota)).toBeTruthy()
  })

  it("o botão só acorda com pergunta e duas opções escritas", async () => {
    const user = userEvent.setup()
    abrir()
    expect(botaoCriar().disabled).toBe(true)

    await user.type(campo(strings.votacao.perguntaLabel), "Qual é o melhor dia?")
    expect(botaoCriar().disabled).toBe(true)

    await user.type(campo(strings.votacao.opcaoLabel(1)), "Segunda")
    // One option keeps not arriving: it is the same limit from the schema, applied
    // here because this is where there is a person to tell.
    expect(botaoCriar().disabled).toBe(true)

    await user.type(campo(strings.votacao.opcaoLabel(2)), "Terça")
    expect(botaoCriar().disabled).toBe(false)
  })

  it("entrega a pergunta e as opções, sem os campos que ficaram em branco", async () => {
    const user = userEvent.setup()
    const onSubmit = abrir()

    await user.type(campo(strings.votacao.perguntaLabel), "  Qual é o melhor dia?  ")
    await user.type(campo(strings.votacao.opcaoLabel(1)), "Segunda")
    await user.type(campo(strings.votacao.opcaoLabel(2)), "Terça")
    await user.click(screen.getByRole("button", { name: strings.votacao.acrescentar }))
    await user.click(botaoCriar())

    expect(onSubmit).toHaveBeenCalledWith({ question: "Qual é o melhor dia?", options: ["Segunda", "Terça"] })
  })

  it("acrescentar dá mais uma opção", async () => {
    const user = userEvent.setup()
    abrir()
    await user.click(screen.getByRole("button", { name: strings.votacao.acrescentar }))
    expect(campo(strings.votacao.opcaoLabel(3))).toBeTruthy()
  })

  it("retirar só aparece acima das duas do princípio", async () => {
    const user = userEvent.setup()
    abrir()
    expect(screen.queryByRole("button", { name: strings.votacao.retirarOpcao(1) })).toBeNull()
    await user.click(screen.getByRole("button", { name: strings.votacao.acrescentar }))
    expect(screen.getByRole("button", { name: strings.votacao.retirarOpcao(3) })).toBeTruthy()
  })

  /**
   * At the cap, the button does not disappear: the phrase explaining why stays.
   * An option that vanishes and comes back on its own makes people doubt what
   * they saw.
   */
  it("no tecto das opções, diz-se o tecto em vez de o botão sumir", async () => {
    const user = userEvent.setup()
    abrir()
    for (let restantes = 8; restantes > 0; restantes -= 1) {
      await user.click(screen.getByRole("button", { name: strings.votacao.acrescentar }))
    }
    expect(screen.queryByRole("button", { name: strings.votacao.acrescentar })).toBeNull()
    expect(screen.getByText(strings.votacao.opcoesCheias(10))).toBeTruthy()
  })
})

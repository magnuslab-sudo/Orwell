import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { strings } from "../strings.js"
import { apurar } from "../lib/votacoes.js"
import { Votacao } from "./Votacao.js"

afterEach(cleanup)

const VOTACAO = { question: "Qual é o melhor dia?", options: ["Segunda", "Terça", "Quarta"] }

const nomes: Record<string, string> = { "@ana:s": "Ana", "@bento:s": "Bento", "@carlos:s": "Carlos" }
const nameFor = (address: string): string => nomes[address] ?? address

function desenhar(escolhas: [string, number][], eu: string | null, onVote?: (opcao: number) => void): void {
  render(
    <Votacao
      votacao={VOTACAO}
      apuramento={apurar(new Map(escolhas), VOTACAO.options.length, eu)}
      nameFor={nameFor}
      {...(onVote ? { onVote } : {})}
    />,
  )
}

/** The row of an option, by the text written there. */
const linhaDe = (opcao: string): HTMLElement => screen.getByText(opcao).closest("li") as HTMLElement

describe("o cartão de uma votação", () => {
  it("mostra a pergunta e todas as opções", () => {
    desenhar([], null, () => {})
    expect(screen.getByRole("heading", { name: VOTACAO.question })).toBeTruthy()
    for (const opcao of VOTACAO.options) expect(screen.getByText(opcao)).toBeTruthy()
  })

  it("sem votos, di-lo por palavras em vez de mostrar zeros e calar", () => {
    desenhar([], null, () => {})
    expect(screen.getByText(strings.votacao.semVotos)).toBeTruthy()
  })

  it("conta os votos por opção, e o total é de pessoas", () => {
    desenhar(
      [
        ["@ana:s", 0],
        ["@bento:s", 0],
        ["@carlos:s", 2],
      ],
      null,
      () => {},
    )
    expect(within(linhaDe("Segunda")).getByText("2")).toBeTruthy()
    expect(within(linhaDe("Quarta")).getByText("1")).toBeTruthy()
    expect(screen.getByText(strings.votacao.total(3))).toBeTruthy()
  })

  /**
   * The core promise of this design, and one that must be on screen, not just in
   * a comment: votes are visible.
   *
   * In an end-to-end encrypted channel, everyone there decrypts everything the
   * channel says. Hiding names from the interface would not make the vote secret:
   * it would make the interface dishonest. So we show them, and we say that we do.
   */
  it("diz que os votos são visíveis, e mostra quem votou em quê", () => {
    desenhar(
      [
        ["@ana:s", 1],
        ["@bento:s", 1],
      ],
      null,
      () => {},
    )
    expect(screen.getByText(strings.votacao.votosVisiveis)).toBeTruthy()
    expect(within(linhaDe("Terça")).getByText(strings.votacao.quemVotou(["Ana", "Bento"]))).toBeTruthy()
  })

  it("com muita gente, corta a lista e diz quantos ficaram de fora", () => {
    const muitos: [string, number][] = Array.from({ length: 6 }, (_, indice) => [`@p${indice}:s`, 0])
    desenhar(muitos, null, () => {})
    // Three names and the rest counted. The title holds the full list, because the
    // promise is that votes can be seen.
    const quem = within(linhaDe("Segunda")).getByText(/e mais 3/)
    expect(quem.getAttribute("title")).toContain("@p5:s")
  })

  it("marca a minha escolha, para não ser preciso lembrar-me dela", () => {
    desenhar([["@ana:s", 2]], "@ana:s", () => {})
    expect(screen.getByRole("button", { name: strings.votacao.retirarVoto("Quarta") }).getAttribute("aria-pressed")).toBe(
      "true",
    )
    expect(screen.getByRole("button", { name: strings.votacao.votarEm("Segunda") }).getAttribute("aria-pressed")).toBe(
      "false",
    )
  })

  it("carregar numa opção vota nela", async () => {
    const user = userEvent.setup()
    const onVote = vi.fn()
    desenhar([], null, onVote)
    await user.click(screen.getByRole("button", { name: strings.votacao.votarEm("Terça") }))
    expect(onVote).toHaveBeenCalledWith(1)
  })

  /**
   * Same gesture as the thumbs on the wall: tapping what is already chosen undoes
   * it. Two different ways to undo the same kind of choice would be two things
   * to learn.
   */
  it("carregar na que já escolhi oferece-se como retirar o voto", async () => {
    const user = userEvent.setup()
    const onVote = vi.fn()
    desenhar([["@ana:s", 1]], "@ana:s", onVote)
    await user.click(screen.getByRole("button", { name: strings.votacao.retirarVoto("Terça") }))
    expect(onVote).toHaveBeenCalledWith(1)
  })

  /**
   * An older host cannot record a vote. The poll still reads, it is the house
   * rule: what you cannot use does not appear, and what you can read keeps reading.
   */
  it("sem quem registe o voto, lê-se e não se vota", () => {
    desenhar([["@ana:s", 0]], null)
    expect(screen.queryAllByRole("button")).toHaveLength(0)
    expect(screen.getByText("Segunda")).toBeTruthy()
    expect(screen.getByText(strings.votacao.total(1))).toBeTruthy()
  })
})

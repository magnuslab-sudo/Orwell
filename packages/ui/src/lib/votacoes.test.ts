import { describe, expect, it } from "vitest"
import type { ChatMessage } from "../types.js"
import { apurar, corpoDaVotacao, votacaoDe, votosDe } from "./votacoes.js"

const ALVO = "votacao-1234"

let proximo = 1
function voto(sender: string, opcao: number | null, at: number, id?: string): ChatMessage {
  return {
    channel: "!sala:s",
    seq: proximo++,
    sender,
    payload: {
      t: "post.reaction",
      id: id ?? `voto-${proximo}`,
      target: ALVO,
      emoji: "",
      at,
      remove: opcao === null,
      vote: opcao ?? 0,
    },
  }
}

/** A permanent thumbs-up: a reaction with no `vote`. */
function polegar(sender: string, emoji: string): ChatMessage {
  return {
    channel: "!sala:s",
    seq: proximo++,
    sender,
    payload: { t: "post.reaction", id: `gosto-${proximo}`, target: ALVO, emoji, at: 1, remove: false },
  }
}

const contar = (messages: ChatMessage[], opcoes = 3, eu: string | null = null): ReturnType<typeof apurar> =>
  apurar(votosDe(messages).get(ALVO), opcoes, eu)

describe("a contagem dos votos", () => {
  it("uma pessoa, um voto", () => {
    const apuramento = contar([voto("@ana:s", 1, 10)])
    expect(apuramento.total).toBe(1)
    expect(apuramento.porOpcao).toEqual([[], ["@ana:s"], []])
  })

  /**
   * The pitfall of this feature, and why the count is a table.
   *
   * Votes arrive as events, and the same event arrives more than once: from
   * the vault and the network, from the initial sync and the resend that makes
   * the vote exist for people who joined later. A counter that summed each
   * arrival would say two where there is one, and no one would notice, because
   * a wrong total has no symptom. It is the same family of bug that made posts
   * appear duplicated.
   */
  it("o mesmo voto dito duas vezes continua a ser um voto", () => {
    const original = voto("@ana:s", 1, 10, "voto-fixo")
    const apuramento = contar([original, { ...original, seq: 99 }])
    expect(apuramento.total).toBe(1)
    expect(apuramento.porOpcao[1]).toEqual(["@ana:s"])
  })

  it("e o mesmo voto dito dez vezes também", () => {
    const original = voto("@ana:s", 2, 10, "voto-fixo")
    const dez = Array.from({ length: 10 }, (_, indice) => ({ ...original, seq: indice }))
    expect(contar(dez).total).toBe(1)
  })

  it("mudar de opção não acrescenta um voto: substitui-o", () => {
    const apuramento = contar([voto("@ana:s", 0, 10), voto("@ana:s", 2, 20)])
    expect(apuramento.total).toBe(1)
    expect(apuramento.porOpcao).toEqual([[], [], ["@ana:s"]])
  })

  /**
   * Fetching history delivers messages out of order. Without the timestamp to
   * decide, someone's choice would change on its own when loading old messages.
   */
  it("o voto mais recente ganha, mesmo chegando por último o mais antigo", () => {
    const apuramento = contar([voto("@ana:s", 2, 20), voto("@ana:s", 0, 10)])
    expect(apuramento.porOpcao[2]).toEqual(["@ana:s"])
    expect(apuramento.porOpcao[0]).toEqual([])
  })

  it("empate de carimbo resolve-se pela ordem do fio, que é a única partilhada", () => {
    const apuramento = contar([voto("@ana:s", 0, 10), voto("@ana:s", 1, 10)])
    expect(apuramento.porOpcao[1]).toEqual(["@ana:s"])
  })

  it("retirar o voto tira a pessoa da contagem", () => {
    const apuramento = contar([voto("@ana:s", 1, 10), voto("@ana:s", null, 20)])
    expect(apuramento.total).toBe(0)
    expect(apuramento.porOpcao).toEqual([[], [], []])
  })

  it("várias pessoas somam-se, e cada uma aparece uma vez", () => {
    const apuramento = contar([voto("@ana:s", 0, 10), voto("@bento:s", 0, 11), voto("@carlos:s", 2, 12)])
    expect(apuramento.total).toBe(3)
    expect(apuramento.porOpcao[0]).toEqual(["@ana:s", "@bento:s"])
    expect(apuramento.porOpcao[2]).toEqual(["@carlos:s"])
  })

  it("a minha escolha é reconhecida, e é a que o cartão desenha carregada", () => {
    expect(contar([voto("@ana:s", 1, 10)], 3, "@ana:s").minha).toBe(1)
    expect(contar([voto("@bento:s", 1, 10)], 3, "@ana:s").minha).toBeNull()
  })

  /**
   * The two counts are disjoint by design.
   *
   * A vote and a thumbs-up share the `t`, see `post.reaction` in the protocol,
   * and the reason there is no new `t`. What they cannot share is the sum:
   * counting a thumbs-up as a vote would put a person in an option they never
   * tapped, and counting a vote as a thumbs-up would show as a like on the feed.
   */
  it("um polegar não é um voto", () => {
    expect(contar([polegar("@ana:s", "👍"), polegar("@bento:s", "👎")]).total).toBe(0)
  })

  it("e um polegar não apaga o voto da mesma pessoa", () => {
    const apuramento = contar([voto("@ana:s", 1, 10), polegar("@ana:s", "👍")])
    expect(apuramento.porOpcao[1]).toEqual(["@ana:s"])
  })

  /**
   * An index outside the options comes from a newer version with more answers,
   * or from an altered client. Discounting it is the only honest act: counting
   * it in any option would put a person defending something they did not choose.
   */
  it("um voto numa opção que esta versão não conhece é descontado", () => {
    const apuramento = contar([voto("@ana:s", 7, 10), voto("@bento:s", 1, 10)], 3)
    expect(apuramento.total).toBe(1)
    expect(apuramento.porOpcao[1]).toEqual(["@bento:s"])
  })

  it("votos de outra votação não entram nesta", () => {
    const doOutroLado: ChatMessage = {
      channel: "!sala:s",
      seq: 500,
      sender: "@ana:s",
      payload: { t: "post.reaction", id: "voto-x", target: "outra-votacao", emoji: "", at: 10, vote: 0 },
    }
    expect(contar([doOutroLado]).total).toBe(0)
  })
})

describe("a votação que uma mensagem leva", () => {
  const mensagem = (poll: unknown): ChatMessage => ({
    channel: "!sala:s",
    seq: 1,
    sender: "@ana:s",
    payload: { t: "message", id: "m-1", sentAt: 1, body: "texto", poll: poll as never },
  })

  it("uma votação com duas opções é desenhável", () => {
    expect(votacaoDe(mensagem({ question: "Dia?", options: ["Seg", "Ter"] }).payload)).toEqual({
      question: "Dia?",
      options: ["Seg", "Ter"],
    })
  })

  /**
   * Fewer than two options is not a vote: it is what remains from a version
   * this client could not read. The caller draws the text, which says the same
   * thing in words, that is why the body carries the vote in full.
   */
  it("uma votação com uma opção só não é desenhável, e a mensagem fica com o texto", () => {
    expect(votacaoDe(mensagem({ question: "Dia?", options: ["Seg"] }).payload)).toBeNull()
    expect(votacaoDe(mensagem({ question: "", options: ["Seg", "Ter"] }).payload)).toBeNull()
    expect(votacaoDe(mensagem(undefined).payload)).toBeNull()
    expect(votacaoDe(mensagem({ question: "Dia?" }).payload)).toBeNull()
  })
})

describe("a votação escrita por extenso", () => {
  it("leva a pergunta e as opções numeradas, para quem não a souber desenhar", () => {
    expect(corpoDaVotacao({ question: "Qual é o melhor dia?", options: ["Segunda", "Terça"] })).toBe(
      "Qual é o melhor dia?\n1. Segunda\n2. Terça",
    )
  })
})

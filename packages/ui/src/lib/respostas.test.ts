import { describe, expect, it } from "vitest"
import type { ChatMessage } from "../types.js"
import { MENCAO_TODOS } from "./mentions.js"
import { citacaoDe, comResposta, indiceDasCitacoes, podeResponder, resumoDoOriginal } from "./respostas.js"

const CANAL = "!lagar:exemplo"
const ANA = "@ana-bela-cara-doce:exemplo"
const BRUNO = "@bruno-alto-pe-leve:exemplo"

function dita(id: string, body: string, extra: Partial<ChatMessage["payload"]> = {}, sender = ANA): ChatMessage {
  return { channel: CANAL, seq: 1, sender, payload: { t: "message", id, sentAt: 1, body, ...extra } }
}

const nomes = (endereco: string): string => (endereco === BRUNO ? "Bruno" : endereco === ANA ? "Ana" : "?")

describe("resumoDoOriginal: o início do original, numa linha", () => {
  it("texto simples sai tal e qual", () => {
    expect(resumoDoOriginal(dita("a", "Olá a todos").payload, nomes)).toEqual({ tipo: "texto", texto: "Olá a todos" })
  })

  it("as quebras de linha e os espaços repetidos viram um espaço só", () => {
    expect(resumoDoOriginal(dita("a", "linha um\n\n  linha   dois").payload, nomes)).toEqual({
      tipo: "texto",
      texto: "linha um linha dois",
    })
  })

  it("uma menção mostra o nome de agora, e não o endereço", () => {
    const original = dita("a", `${BRUNO} vens hoje?`, { mentions: [BRUNO] })
    expect(resumoDoOriginal(original.payload, nomes)).toEqual({ tipo: "texto", texto: "@Bruno vens hoje?" })
  })

  it("a formatação sai, e o texto fica", () => {
    expect(resumoDoOriginal(dita("a", "**forte** e *leve* e ~~riscado~~").payload, nomes)).toEqual({
      tipo: "texto",
      texto: "forte e leve e riscado",
    })
  })

  it("o coberto continua tapado na citação, sem dizer quantas letras tem", () => {
    const resumo = resumoDoOriginal(dita("a", "o fim é ||o mordomo||").payload, nomes)
    expect(resumo.tipo).toBe("texto")
    const texto = resumo.tipo === "texto" ? resumo.texto : ""
    expect(texto).not.toContain("mordomo")
    expect(texto).toBe("o fim é ▒▒▒")
  })

  it("um texto muito comprido é cortado, com reticências", () => {
    const longo = "palavra ".repeat(100)
    const resumo = resumoDoOriginal(dita("a", longo).payload, nomes)
    const texto = resumo.tipo === "texto" ? resumo.texto : ""
    expect(texto.length).toBeLessThanOrEqual(161)
    expect(texto.endsWith("…")).toBe(true)
  })

  it("um original só com imagem diz que é uma imagem", () => {
    const original = dita("a", "", { attachments: [{ mediaType: "image/png", name: "foto.png" } as never] })
    expect(resumoDoOriginal(original.payload, nomes)).toEqual({ tipo: "imagem" })
  })

  it("um original só com ficheiro mostra o nome do ficheiro", () => {
    const original = dita("a", "", { attachments: [{ mediaType: "application/pdf", name: "acta.pdf" } as never] })
    expect(resumoDoOriginal(original.payload, nomes)).toEqual({ tipo: "ficheiro", nome: "acta.pdf" })
  })

  it("com texto e imagem, o texto ganha", () => {
    const original = dita("a", "vê isto", { attachments: [{ mediaType: "image/png", name: "foto.png" } as never] })
    expect(resumoDoOriginal(original.payload, nomes)).toEqual({ tipo: "texto", texto: "vê isto" })
  })
})

describe("citacaoDe: o que a linha de citação mostra", () => {
  it("o original está na conversa: presente, com quem o escreveu", () => {
    const original = dita("o1", "pergunta", {}, BRUNO)
    const indice = indiceDasCitacoes([original], [original])
    const citacao = citacaoDe("o1", indice, false)
    expect(citacao.estado).toBe("presente")
    expect(citacao.estado === "presente" && citacao.original.sender).toBe(BRUNO)
  })

  it("o original foi apagado pelo autor (está na memória, e a dobra tirou-o)", () => {
    const original = dita("o1", "pergunta", {}, BRUNO)
    const lapide: ChatMessage = { channel: CANAL, seq: 2, sender: BRUNO, payload: { t: "redact", target: "o1" } }
    const indice = indiceDasCitacoes([original, lapide], [])
    expect(citacaoDe("o1", indice, false)).toEqual({ estado: "apagada" })
  })

  it("só a lápide ficou na memória: conta como apagada", () => {
    const lapide: ChatMessage = { channel: CANAL, seq: 2, sender: BRUNO, payload: { t: "redact", target: "o1" } }
    expect(citacaoDe("o1", indiceDasCitacoes([lapide], []), true)).toEqual({ estado: "apagada" })
  })

  it("eliminada por moderação conta como apagada", () => {
    const original = dita("o1", "", { moderada: true }, BRUNO)
    expect(citacaoDe("o1", indiceDasCitacoes([original], [original]), false)).toEqual({ estado: "apagada" })
  })

  it("não está na memória e há histórico por carregar: pode-se ir buscar", () => {
    expect(citacaoDe("o1", indiceDasCitacoes([], []), true)).toEqual({ estado: "por-carregar" })
  })

  it("não está na memória e não há mais nada a carregar: não está neste aparelho", () => {
    expect(citacaoDe("o1", indiceDasCitacoes([], []), false)).toEqual({ estado: "ausente" })
  })
})

describe("comResposta: os extras de uma resposta", () => {
  it("leva o identificador do original", () => {
    expect(comResposta({}, { id: "o1", autor: BRUNO, mencionar: false }, ANA)).toEqual({ replyTo: "o1" })
  })

  it("com «@ Mencionar» ligado, o autor do original passa a ser mencionado", () => {
    expect(comResposta({}, { id: "o1", autor: BRUNO, mencionar: true }, ANA)).toEqual({ replyTo: "o1", mentions: [BRUNO] })
  })

  it("não repete quem já foi mencionado no texto", () => {
    const extras = comResposta({ mentions: [BRUNO] }, { id: "o1", autor: BRUNO, mencionar: true }, ANA)
    expect(extras.mentions).toEqual([BRUNO])
  })

  it("mantém as outras menções e o resto dos extras", () => {
    const extras = comResposta({ mentions: [MENCAO_TODOS], links: [] }, { id: "o1", autor: BRUNO, mencionar: true }, ANA)
    expect(extras).toEqual({ links: [], mentions: [MENCAO_TODOS, BRUNO], replyTo: "o1" })
  })

  it("responder a mim próprio nunca me menciona", () => {
    expect(comResposta({}, { id: "o1", autor: ANA, mencionar: true }, ANA)).toEqual({ replyTo: "o1" })
  })

  it("não passa do tecto de menções do protocolo", () => {
    const cheias = Array.from({ length: 64 }, (_, i) => `@p${i}:exemplo`)
    const extras = comResposta({ mentions: cheias }, { id: "o1", autor: BRUNO, mencionar: true }, ANA)
    expect(extras.mentions).toHaveLength(64)
  })

  it("sem resposta, os extras ficam como estavam", () => {
    const extras = { mentions: [BRUNO] }
    expect(comResposta(extras, null, ANA)).toBe(extras)
  })
})

describe("podeResponder: que linhas oferecem «Responder»", () => {
  it("uma mensagem dita, com identificador", () => {
    expect(podeResponder(dita("o1", "olá"))).toBe(true)
  })

  it("sem identificador, não", () => {
    const semId: ChatMessage = { channel: CANAL, seq: 1, sender: ANA, payload: { t: "message", body: "olá" } }
    expect(podeResponder(semId)).toBe(false)
  })

  it("eliminada por moderação, não", () => {
    expect(podeResponder(dita("o1", "", { moderada: true }))).toBe(false)
  })

  it("um pedido de amizade não é uma coisa dita", () => {
    const pedido: ChatMessage = { channel: CANAL, seq: 1, sender: ANA, payload: { t: "friend.request", id: "x" } }
    expect(podeResponder(pedido)).toBe(false)
  })
})

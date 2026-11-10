import { describe, expect, it } from "vitest"
import type { ChatMessage } from "../types.js"
import { dobrar, excerto, procurar, realces } from "./procura.js"

function dita(seq: number, body: string, extra: Record<string, unknown> = {}): ChatMessage {
  return {
    channel: "!canal:s",
    seq,
    sender: "@ana:s",
    payload: { t: "message", id: `id-${seq}`, sentAt: seq * 1000, body, ...extra },
  }
}

/**
 * "água" written the macOS way: an "a" and an accent on top, separate.
 *
 * Reads the same as the precomposed version and is not the same string. Arrives in conversations through
 * copying, from file names and pages, and is the case that forces search to
 * compose before comparing.
 */
const AGUA_DECOMPOSTA = "a\u0301gua"

describe("dobrar", () => {
  it("baixa a caixa e tira os acentos", () => {
    expect(dobrar("Água ORÇAMENTO Ção")).toBe("agua orcamento cao")
  })

  /**
   * The invariant that supports the entire highlight.
   *
   * The positions of the match are measured in the FOLDED text and used to cut the
   * composed text. If the fold changed the length, the highlight fell to the side:
   * half a word painted and the other half not. That is why the fold is by
   * character and always returns the original when the folded version does not fit in
   * the same space.
   */
  it("nunca muda o comprimento do texto", () => {
    // Hangul and combining accent are here by necessity, not by choice:
    // they are the two cases where naive folding (`normalize("NFD")` over the
    // entire string) changes the length. Without them the test suite would pass an
    // implementation that misaligns the highlight.
    for (const texto of ["Água", "İstanbul", "ß ẞ", "😀 olá", "Å", "ﬁcheiro", "한국", AGUA_DECOMPOSTA]) {
      expect(dobrar(texto), JSON.stringify(texto)).toHaveLength(texto.length)
    }
  })
})

describe("procurar", () => {
  it("encontra sem distinguir maiúsculas nem acentos", () => {
    const achados = procurar([dita(1, "O orçamento está pronto")], "ORCAMENTO")
    expect(achados.map((achado) => achado.id)).toEqual(["id-1"])
  })

  /**
   * The same "á" written two ways is the same "á".
   *
   * Without composing before comparing, searching for "água" would not find a message
   * pasted from Finder, and there was nothing on screen that explained why: the two
   * words read exactly the same.
   */
  it("encontra texto colado em forma decomposta", () => {
    const achados = procurar([dita(1, `conta da ${AGUA_DECOMPOSTA}`)], "água")
    expect(achados.map((achado) => achado.id)).toEqual(["id-1"])
  })

  it("devolve as mais recentes à cabeça", () => {
    const achados = procurar([dita(1, "chave velha"), dita(2, "chave nova")], "chave")
    expect(achados.map((achado) => achado.id)).toEqual(["id-2", "id-1"])
  })

  it("termo vazio ou só espaços não procura nada", () => {
    expect(procurar([dita(1, "seja o que for")], "")).toEqual([])
    expect(procurar([dita(1, "seja o que for")], "   ")).toEqual([])
  })

  /**
   * The term is TEXT, never a regular expression.
   *
   * This is the test that separates an `indexOf` implementation from a `RegExp` one. With `new RegExp(termo)` the first case broke (closing parenthesis) and
   * the second found what it should not. With escape but still with
   * `RegExp`, the second passed and left unexplained why the regex engine was
   * doing anything here at all.
   */
  it("trata o termo como texto e não como expressão regular", () => {
    expect(procurar([dita(1, "sorriso :-( triste")], "(").map((achado) => achado.id)).toEqual(["id-1"])
    expect(procurar([dita(1, "aaaa")], "(a+)+")).toEqual([])
    expect(procurar([dita(1, "o preço é 3.50")], "3.50").map((achado) => achado.id)).toEqual(["id-1"])
    expect(procurar([dita(1, "o preço é 3x50")], "3.50")).toEqual([])
  })

  it("uma mensagem corrigida encontra-se pelo que diz agora, não pelo que dizia", () => {
    const messages: ChatMessage[] = [
      dita(1, "encontro na quinta"),
      {
        channel: "!canal:s",
        seq: 2,
        sender: "@ana:s",
        payload: { t: "edit", target: "id-1", body: "encontro na sexta", editedAt: 2000 },
      },
    ]
    expect(procurar(messages, "sexta").map((achado) => achado.id)).toEqual(["id-1"])
    expect(procurar(messages, "quinta")).toEqual([])
  })

  it("uma mensagem apagada deixa de se encontrar", () => {
    const messages: ChatMessage[] = [
      dita(1, "asneira"),
      {
        channel: "!canal:s",
        seq: 2,
        sender: "@ana:s",
        payload: { t: "redact", target: "id-1", redactedAt: 2000 },
      },
    ]
    expect(procurar(messages, "asneira")).toEqual([])
  })

  it("guarda a sala onde foi dita, e a por omissão é a vazia", () => {
    const achados = procurar([dita(1, "na obra"), dita(2, "na obra", { room: "estaleiro" })], "obra")
    expect(achados.map((achado) => achado.room)).toEqual(["estaleiro", ""])
  })

  it("uma publicação do mural não é uma linha da conversa", () => {
    const post: ChatMessage = {
      channel: "!canal:s",
      seq: 1,
      sender: "@ana:s",
      payload: { t: "post", id: "p-1", caption: "obra nova", body: "obra nova", postedAt: 1000 },
    }
    expect(procurar([post], "obra")).toEqual([])
  })
})

describe("realces", () => {
  it("parte o texto em pedaços marcados e por marcar", () => {
    expect(realces("o orçamento do orçamento", "orcamento")).toEqual([
      { texto: "o ", marcado: false },
      { texto: "orçamento", marcado: true },
      { texto: " do ", marcado: false },
      { texto: "orçamento", marcado: true },
    ])
  })

  it("o texto original sai inteiro dos pedaços, seja qual for o termo", () => {
    for (const termo of ["a", "ç", "Água", "", "não existe"]) {
      const texto = "Água: o orçamento não é o pré-açúcar"
      expect(
        realces(texto, termo)
          .map((pedaco) => pedaco.texto)
          .join(""),
      ).toBe(texto)
    }
  })

  /**
   * The highlight falls EXACTLY on the word, not one space to the side.
   *
   * It is the visible consequence of the fold that preserves length. A hangul
   * syllable to the left of the match shifts the naive version by four units, and
   * what was painted was the next piece.
   */
  it("marca a palavra certa mesmo com sílabas largas à esquerda", () => {
    expect(realces("한국 orçamento", "orcamento")).toEqual([
      { texto: "한국 ", marcado: false },
      { texto: "orçamento", marcado: true },
    ])
  })

  it("sem termo devolve o texto inteiro por marcar", () => {
    expect(realces("olá", "")).toEqual([{ texto: "olá", marcado: false }])
  })
})

describe("excerto", () => {
  it("um texto curto sai inteiro", () => {
    expect(excerto("uma linha curta", "linha", 40)).toBe("uma linha curta")
  })

  it("um texto longo abre-se à volta do achado, com reticências dos dois lados", () => {
    const texto = `${"a".repeat(200)} agulha ${"b".repeat(200)}`
    const saida = excerto(texto, "agulha", 20)
    expect(saida).toContain("agulha")
    expect(saida.startsWith("…")).toBe(true)
    expect(saida.endsWith("…")).toBe(true)
    expect(saida.length).toBeLessThan(40)
  })

  it("um achado no princípio não leva reticências à esquerda", () => {
    const saida = excerto(`agulha ${"b".repeat(200)}`, "agulha", 20)
    expect(saida.startsWith("agulha")).toBe(true)
    expect(saida.endsWith("…")).toBe(true)
  })
})

describe("procurar com moderação (fase 3)", () => {
  it("a mensagem eliminada por quem modera não se encontra; sem o poder, encontra-se", () => {
    const lapide: ChatMessage = {
      channel: "!canal:s",
      seq: 2,
      sender: "@bruno:s",
      payload: { t: "redact", id: "r-1", target: "id-1", redactedAt: 2000 },
    }
    const canal = [dita(1, "uma frase feia"), lapide]
    expect(procurar(canal, "feia", { modera: (quem) => quem === "@bruno:s" })).toEqual([])
    expect(procurar(canal, "feia").map((achado) => achado.id)).toEqual(["id-1"])
  })
})

import { moradaDeTeste } from "../../testes/moradas.js"
import { lembrarFichasDosCanais } from "./tipoDoCanal.js"
import { beforeEach, describe, expect, it } from "vitest"
import type { ChatMessage } from "../types.js"
import {
  avancouOCanal,
  chaveDaLidaDaSala,
  contarPorSala,
  entrarNoCanal,
  esquecerLidasPorSala,
  lerLidasPorSala,
  lerSala,
  marcaDaSala,
} from "./porLerPorSala.js"

const DM_ANA = moradaDeTeste("directa ana eu", "s")
// The sheet for each channel (1.0 "Arca", slice 6b): no sheet, a channel is a room.
beforeEach(() => lembrarFichasDosCanais({ [DM_ANA]: { tipo: "directa", par: "@ana:s" } }))

const EU = "@eu:s"
const ANA = "@ana:s"
const C = "!lagar:s"

let seq = 0
function msg(sala: string, sentAt: number, extra: Partial<ChatMessage["payload"]> = {}, sender = ANA): ChatMessage {
  seq += 1
  return { channel: C, seq, sender, payload: { t: "message", body: "olá", sentAt, room: sala, ...extra } } as ChatMessage
}

const salaDe = (_canal: string, etiqueta: string): string => etiqueta

beforeEach(() => {
  localStorage.clear()
  esquecerLidasPorSala()
})

describe("porLerPorSala — a conta por sala", () => {
  it("sem marcas de sala vale a marca do canal, como antes", () => {
    const contas = contarPorSala([msg("a", 5), msg("b", 20), msg("b", 30)], { [C]: 10 }, {}, { canal: null, sala: "" }, EU, salaDe)
    expect(contas.get(C)?.get("a")).toBeUndefined()
    expect(contas.get(C)?.get("b")).toEqual({ todas: 2, mencoes: 0 })
  })

  it("a sala aberta não conta, e as minhas mensagens também não", () => {
    const contas = contarPorSala(
      [msg("a", 20), msg("b", 20), msg("b", 21, {}, EU)],
      {},
      {},
      { canal: C, sala: "a" },
      EU,
      salaDe,
    )
    expect(contas.get(C)?.get("a")).toBeUndefined()
    expect(contas.get(C)?.get("b")?.todas).toBe(1)
  })

  it("a menção conta-se à parte, dentro do total", () => {
    const contas = contarPorSala([msg("b", 20, { mentions: [EU] }), msg("b", 21)], {}, {}, { canal: null, sala: "" }, EU, salaDe)
    expect(contas.get(C)?.get("b")).toEqual({ todas: 2, mencoes: 1 })
  })

  it("conversas privadas e feeds não passam por aqui", () => {
    const privada = { ...msg("", 20), channel: DM_ANA }
    expect(contarPorSala([privada], {}, {}, { canal: null, sala: "" }, EU, salaDe).size).toBe(0)
  })
})

describe("porLerPorSala — a marca do canal deixa de passar por cima das salas", () => {
  it("o que chega à sala B enquanto se lê a sala A fica por ler, mesmo com a marca do canal a avançar", () => {
    entrarNoCanal(C, 10)
    lerSala(C, "a", 100)
    avancouOCanal(C, 100)
    const lastRead = { [C]: 100 }
    const contas = contarPorSala([msg("b", 50)], lastRead, lerLidasPorSala(), { canal: C, sala: "a" }, EU, salaDe)
    expect(contas.get(C)?.get("b")?.todas).toBe(1)
  })

  it("sair do canal e voltar não perde a sala por ler", () => {
    entrarNoCanal(C, 10)
    lerSala(C, "a", 100)
    avancouOCanal(C, 100)
    // Back: the channel mark is the one this device wrote.
    entrarNoCanal(C, 100)
    expect(marcaDaSala(lerLidasPorSala(), { [C]: 100 }, C, "b")).toBe(10)
    expect(marcaDaSala(lerLidasPorSala(), { [C]: 100 }, C, "a")).toBe(100)
  })

  it("ler o canal noutro aparelho apaga as salas daqui também", () => {
    entrarNoCanal(C, 10)
    avancouOCanal(C, 100)
    // The channel mark moved past what this device wrote: it was a sibling.
    expect(marcaDaSala(lerLidasPorSala(), { [C]: 200 }, C, "b")).toBe(200)
    entrarNoCanal(C, 200)
    expect(lerLidasPorSala()[C]).toEqual({ base: 200, fim: 200, salas: {} })
  })

  it("as marcas sobrevivem a um recarregar, e um armazenamento estragado lê-se vazio", () => {
    entrarNoCanal(C, 10)
    lerSala(C, "a", 40)
    expect(JSON.parse(localStorage.getItem("enclave.lidasPorSala")!)[C].salas.a).toBe(40)
    localStorage.setItem("enclave.lidasPorSala", "{lixo")
    expect(lerLidasPorSala()).toEqual({})
  })
})

describe("porLerPorSala — a marca da sala viaja pela conta (fase 1i)", () => {
  it("ler só a sala B noutro aparelho apaga o número dela aqui, e não o da sala C", () => {
    // This device joined the room and read nothing; the channel mark stays at 10.
    entrarNoCanal(C, 10)
    avancouOCanal(C, 10)
    // The phone read room B to 100: the mark arrives through the account's reads.
    const lastRead = { [C]: 10, [chaveDaLidaDaSala(C, "b")!]: 100 }
    const contas = contarPorSala([msg("b", 50), msg("c", 50)], lastRead, lerLidasPorSala(), { canal: null, sala: "" }, EU, salaDe)
    expect(contas.get(C)?.get("b")).toBeUndefined()
    expect(contas.get(C)?.get("c")?.todas).toBe(1)
  })

  it("a marca da conta vale também sem marcas deste aparelho, e a maior ganha", () => {
    const chave = chaveDaLidaDaSala(C, "b")!
    expect(marcaDaSala({}, { [C]: 10, [chave]: 100 }, C, "b")).toBe(100)
    expect(marcaDaSala({}, { [C]: 300, [chave]: 100 }, C, "b")).toBe(300)
  })

  it("uma chave que não cabe em 255 caracteres fica só neste aparelho", () => {
    expect(chaveDaLidaDaSala("!" + "x".repeat(300), "b")).toBeNull()
    expect(chaveDaLidaDaSala(C, "b")).not.toBe(C)
  })
})


import { describe, expect, it } from "vitest"
import { chaveDaSala, salaDaChamadaDe, salaUnicaDaChamadaDe } from "./salaDaChamada.js"
import { PRESENCA_VALIDA_MS } from "./presenca.js"
import { moradaDeTeste } from "../../testes/moradas.js"

const AGORA = 1_800_000_000_000
const CANAL = "!orwell:s"
const OUTRO = "!outro:s"
const DM = moradaDeTeste("directa ana bruno", "s")

const vazio = new Map<string, Map<string, number>>()

describe("salaDaChamadaDe", () => {
  it("aponta a sala onde a chamada está, e não o canal", () => {
    // The bug this closes: entering the channel instead of the room left the person
    // alone in a parallel call, while others spoke elsewhere.
    const voz = new Map([[chaveDaSala(CANAL, "praça"), new Map([["@ana:s", AGORA]])]])
    expect(salaDaChamadaDe(CANAL, false, vazio, voz, AGORA)).toBe("praça")
  })

  it("sem ninguém em sala nenhuma, não manda entrar em lado nenhum", () => {
    expect(salaDaChamadaDe(CANAL, false, vazio, vazio, AGORA)).toBeNull()
  })

  it("ignora as salas de outros canais", () => {
    const voz = new Map([[chaveDaSala(OUTRO, "praça"), new Map([["@ana:s", AGORA]])]])
    expect(salaDaChamadaDe(CANAL, false, vazio, voz, AGORA)).toBeNull()
  })

  it("uma presença caducada não conta: mandaria entrar numa sala já vazia", () => {
    const partiu = AGORA - PRESENCA_VALIDA_MS - 1
    const voz = new Map([[chaveDaSala(CANAL, "praça"), new Map([["@ana:s", partiu]])]])
    expect(salaDaChamadaDe(CANAL, false, vazio, voz, AGORA)).toBeNull()
  })

  it("numa conversa directa a chamada é do canal, e a sala é vazia", () => {
    // No rooms to enter, and `""` is what the core expects.
    const ring = new Map([[DM, new Map([["@ana:s", AGORA]])]])
    expect(salaDaChamadaDe(DM, true, ring, vazio, AGORA)).toBe("")
    expect(salaDaChamadaDe(DM, true, new Map(), vazio, AGORA)).toBeNull()
  })

  it("sem canal aberto não há resposta nenhuma", () => {
    expect(salaDaChamadaDe(null, false, vazio, vazio, AGORA)).toBeNull()
  })
})

/**
 * The strict sister, for navigation.
 *
 * The one above returns the FIRST room with people, because whoever calls it has
 * already decided to enter a call and any room beats the channel. This answers
 * "take me to the room", and with two calls running there is no "the room":
 * picking one would be picking for the reader. Reading the line of any channel in
 * the sidebar (owner report, October 5, 2026, about not seeing who is in the room
 * before entering).
 */
describe("salaUnicaDaChamadaDe", () => {
  it("devolve a sala quando há uma chamada e uma só", () => {
    const voz = new Map([[chaveDaSala(CANAL, "praça"), new Map([["@ana:s", AGORA]])]])
    expect(salaUnicaDaChamadaDe(CANAL, voz, AGORA)).toBe("praça")
  })

  it('e nada quando há duas: não há "a sala"', () => {
    const voz = new Map([
      [chaveDaSala(CANAL, "praça"), new Map([["@ana:s", AGORA]])],
      [chaveDaSala(CANAL, "adega"), new Map([["@bruno:s", AGORA]])],
    ])
    expect(salaUnicaDaChamadaDe(CANAL, voz, AGORA)).toBeNull()
  })

  it("uma sala com entrada no mapa mas sem ninguém vivo não conta como segunda", () => {
    // The contrast that keeps the condition from being too strict: the map stores
    // rooms where people have passed through, and stale presence is not called.
    const partiu = AGORA - PRESENCA_VALIDA_MS - 1
    const voz = new Map([
      [chaveDaSala(CANAL, "praça"), new Map([["@ana:s", AGORA]])],
      [chaveDaSala(CANAL, "adega"), new Map([["@bruno:s", partiu]])],
    ])
    expect(salaUnicaDaChamadaDe(CANAL, voz, AGORA)).toBe("praça")
  })

  it("ignora as salas de outros canais", () => {
    const voz = new Map([
      [chaveDaSala(CANAL, "praça"), new Map([["@ana:s", AGORA]])],
      [chaveDaSala(OUTRO, "adega"), new Map([["@bruno:s", AGORA]])],
    ])
    expect(salaUnicaDaChamadaDe(CANAL, voz, AGORA)).toBe("praça")
  })

  it("sem chamada nenhuma, não leva a lado nenhum", () => {
    expect(salaUnicaDaChamadaDe(CANAL, vazio, AGORA)).toBeNull()
  })
})

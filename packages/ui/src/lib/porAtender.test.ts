import { moradaDeTeste } from "../../testes/moradas.js"
import { lembrarFichasDosCanais } from "./tipoDoCanal.js"
import { beforeEach, describe, expect, it } from "vitest"
import type { ChatMessage } from "../types.js"
import { countUnreads } from "../hooks/useUnreads.js"
import { dirigidaAMim, repartirPorDestino } from "./porAtender.js"

// The sheet for each channel (1.0 "Arca", slice 6b): no sheet, a channel is a room.
beforeEach(() =>
  lembrarFichasDosCanais({
    [DIRECTA]: { tipo: "directa", par: "@ana:casa.pt" },
    [MEU_FEED]: { tipo: "mural", dono: "@eu:casa.pt" },
  }),
)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const CANAL = "!lagar:casa.pt"
const OUTRO = "!adega:casa.pt"
const DIRECTA = moradaDeTeste("directa ana eu", "casa.pt")
const MEU_FEED = moradaDeTeste("mural eu", "casa.pt")

let seq = 0
function dita(
  channel: string,
  sender: string,
  sentAt: number,
  mentions?: string[],
): ChatMessage {
  seq += 1
  return {
    channel,
    seq,
    sender,
    payload: { t: "message", id: `m${seq}`, body: "olá", sentAt, ...(mentions ? { mentions } : {}) },
  }
}

/**
 * The rule of "this is for me", which is the only thing that keeps the badge
 * from always being lit.
 *
 * A channel with thirty people has unread messages all the time. A badge that
 * counted them all would be permanently lit, and a number that never goes away
 * stops being read, it drags the next one down with it. What stays is what was
 * directed at this account: in a direct chat, everything; in a channel, what
 * names it.
 */
describe("dirigidaAMim", () => {
  it("numa conversa directa, toda a mensagem é para mim", () => {
    expect(dirigidaAMim(EU)(dita(DIRECTA, ANA, 10))).toBe(true)
  })

  it("num canal, só a que me nomeia", () => {
    expect(dirigidaAMim(EU)(dita(CANAL, ANA, 10))).toBe(false)
    expect(dirigidaAMim(EU)(dita(CANAL, ANA, 10, [EU]))).toBe(true)
  })

  it("nomear outra pessoa não me nomeia a mim", () => {
    expect(dirigidaAMim(EU)(dita(CANAL, ANA, 10, ["@rui:casa.pt"]))).toBe(false)
  })

  it("sem endereço conhecido não há nada dirigido a ninguém", () => {
    expect(dirigidaAMim(null)(dita(CANAL, ANA, 10, [EU]))).toBe(false)
    // The direct chat isn't ready either: without knowing who I am, "direct to me"
    // means nothing, and a lit badge before the account is loaded would appear and
    // disappear on its own at startup.
    expect(dirigidaAMim(null)(dita(DIRECTA, ANA, 10))).toBe(false)
  })
})

/**
 * The count comes from `countUnreads`, not from a second sum.
 *
 * It is the same function that fills the sidebar numbers: the same guards
 * (not the open channel, not mine, more recent than the mark) and the same
 * mark in `localStorage`. The badge is a SUBSET of what is already on screen,
 * by design, and that is what prevents it from disagreeing with the sidebar.
 */
describe("countUnreads com filtro — o crachá nunca passa o total", () => {
  const fio = [
    dita(CANAL, ANA, 10),
    dita(CANAL, ANA, 20, [EU]),
    dita(OUTRO, ANA, 30),
    dita(DIRECTA, ANA, 40),
  ]

  it("o filtro tira, nunca acrescenta", () => {
    const todas = countUnreads(fio, {}, null, EU)
    const minhas = countUnreads(fio, {}, null, EU, dirigidaAMim(EU))
    for (const [canal, quantas] of minhas) {
      expect(quantas).toBeLessThanOrEqual(todas.get(canal) ?? 0)
    }
    expect(soma(minhas)).toBeLessThanOrEqual(soma(todas))
  })

  it("sem filtro conta tudo, com filtro conta o que é meu", () => {
    expect(soma(countUnreads(fio, {}, null, EU))).toBe(4)
    expect(soma(countUnreads(fio, {}, null, EU, dirigidaAMim(EU)))).toBe(2)
  })

  it("a marca de leitura continua a mandar: o que é anterior a ela não conta", () => {
    const lido = { [CANAL]: 25, [DIRECTA]: 50 }
    expect(soma(countUnreads(fio, lido, null, EU, dirigidaAMim(EU)))).toBe(0)
  })

  it("o canal aberto não conta, nem quando me nomeia", () => {
    expect(soma(countUnreads(fio, {}, CANAL, EU, dirigidaAMim(EU)))).toBe(1)
  })
})

/**
 * Repeated history does not light up the badge.
 *
 * A reconnection redelivers messages that this device already had, with the
 * original timestamp from who wrote them. The read mark erases them: what is
 * before it does not count, no matter how many times it arrives again.
 */
describe("o que volta a chegar", () => {
  it("uma menção antiga reentregue não acende o crachá", () => {
    const antiga = dita(CANAL, ANA, 10, [EU])
    const lido = { [CANAL]: 100 }
    const fio = [antiga, { ...antiga, seq: antiga.seq + 500 }]
    expect(soma(countUnreads(fio, lido, null, EU, dirigidaAMim(EU)))).toBe(0)
  })
})

/**
 * Each destination counts only what it shows, nothing more.
 *
 * Direct conversations moved: they live in Contacts, and the channel bar no
 * longer draws them (see `rooms` in the shell). A badge in Channels that lit
 * up because of a direct conversation would send the person to the wrong
 * destination, and they would find nothing there.
 */
describe("repartirPorDestino", () => {
  it("os canais são os que a barra lateral desenha", () => {
    const contagens = new Map([
      [CANAL, 2],
      [OUTRO, 1],
    ])
    expect(repartirPorDestino(contagens)).toEqual({ canais: 3, contactos: 0 })
  })

  it("as conversas directas contam para Contactos, que é onde vivem", () => {
    const contagens = new Map([
      [CANAL, 2],
      [DIRECTA, 5],
    ])
    expect(repartirPorDestino(contagens)).toEqual({ canais: 2, contactos: 5 })
  })

  it("o feed não é destino de ninguém: é canalização", () => {
    const contagens = new Map([[MEU_FEED, 9]])
    expect(repartirPorDestino(contagens)).toEqual({ canais: 0, contactos: 0 })
  })
})

function soma(contagens: ReadonlyMap<string, number>): number {
  let total = 0
  for (const quantas of contagens.values()) total += quantas
  return total
}

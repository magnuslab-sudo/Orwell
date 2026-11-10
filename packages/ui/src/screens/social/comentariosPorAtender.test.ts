import { moradaDeTeste } from "../../../testes/moradas.js"
import { lembrarFichasDosCanais } from "../../lib/tipoDoCanal.js"
import { beforeEach, describe, expect, it } from "vitest"
import type { ChatMessage } from "../../types.js"
import { feedOf } from "../../lib/format.js"
import { comentariosPorAtender, engagementOf, GOSTO } from "./engagement.js"

// The sheet for each channel (1.0 "Arca", slice 6b): no sheet, a channel is a room.
beforeEach(() =>
  lembrarFichasDosCanais({
    [MEU_FEED]: { tipo: "mural", dono: "@eu:casa.pt" },
    [FEED_DA_ANA]: { tipo: "mural", dono: "@ana:casa.pt" },
  }),
)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const MEU_FEED = moradaDeTeste("mural eu", "casa.pt")
const FEED_DA_ANA = moradaDeTeste("mural ana", "casa.pt")

let seq = 0
function evento(channel: string, sender: string, payload: ChatMessage["payload"]): ChatMessage {
  seq += 1
  return { channel, seq, sender, payload }
}

const publicacao = (channel: string, sender: string, id: string, postedAt: number): ChatMessage =>
  evento(channel, sender, { t: "post", id, postedAt, caption: `publicação ${id}`, media: [], links: [], tags: [] })

const comentario = (channel: string, sender: string, id: string, alvo: string, postedAt: number): ChatMessage =>
  evento(channel, sender, { t: "post.comment", id, target: alvo, body: "e digo eu que", postedAt })

/** What the shell calculates and sends: the folded feed and the likes summed. */
function contar(fio: ChatMessage[], marca: number): number {
  const minhas = feedOf(fio).filter((post) => post.sender === EU)
  return comentariosPorAtender(engagementOf(fio, EU), minhas, EU, marca)
}

/**
 * What the Social badge counts: who replied under what I wrote.
 *
 * New posts from people I follow do not count, and it is the choice that makes
 * the number mean something: a post appears alone, it has nobody waiting for a
 * reply, and in a feed with half a dozen active people the number would never
 * drop to zero. A comment under one of my posts is someone talking to me, and
 * that is something to do.
 */
describe("comentariosPorAtender", () => {
  it("um comentário de outra pessoa numa publicação minha conta", () => {
    const fio = [publicacao(MEU_FEED, EU, "p1", 100), comentario(MEU_FEED, ANA, "c1", "p1", 200)]
    expect(contar(fio, 50)).toBe(1)
  })

  it("os meus próprios comentários não contam: ninguém se responde a si", () => {
    const fio = [
      publicacao(MEU_FEED, EU, "p1", 100),
      comentario(MEU_FEED, EU, "c1", "p1", 200),
      comentario(MEU_FEED, ANA, "c2", "p1", 210),
    ]
    expect(contar(fio, 50)).toBe(1)
  })

  it("comentários em publicações de outras pessoas não são meus para atender", () => {
    const fio = [
      publicacao(FEED_DA_ANA, ANA, "pa", 100),
      comentario(FEED_DA_ANA, "@rui:casa.pt", "c1", "pa", 200),
    ]
    expect(contar(fio, 50)).toBe(0)
  })

  it("um gosto não é um comentário: não pede resposta nenhuma", () => {
    const fio = [
      publicacao(MEU_FEED, EU, "p1", 100),
      evento(MEU_FEED, ANA, { t: "post.reaction", id: "r1", target: "p1", emoji: GOSTO, at: 200 }),
    ]
    expect(contar(fio, 50)).toBe(0)
  })

  it("o que é anterior à marca já foi atendido", () => {
    const fio = [
      publicacao(MEU_FEED, EU, "p1", 100),
      comentario(MEU_FEED, ANA, "c1", "p1", 200),
      comentario(MEU_FEED, ANA, "c2", "p1", 400),
    ]
    expect(contar(fio, 300)).toBe(1)
    // Attending is moving the mark ahead of the last: the number goes to zero.
    expect(contar(fio, 500)).toBe(0)
  })

  it("um comentário que o autor apagou deixa de esperar resposta", () => {
    const fio = [
      publicacao(MEU_FEED, EU, "p1", 100),
      comentario(MEU_FEED, ANA, "c1", "p1", 200),
      evento(MEU_FEED, ANA, { t: "redact", id: "x1", target: "c1", redactedAt: 300 }),
    ]
    // The post card shows zero comments. The badge has to say the same: it comes
    // from the same `engagementOf` and not from a second pass through the thread.
    expect(contar(fio, 50)).toBe(0)
  })
})

/**
 * The rebroadcast trap, which is what separates a true number from a false one.
 *
 * `republishPosts` restates the entire feed **at each new entry into the
 * feed**, whoever arrives does not decrypt anything that was said before
 * joining the group, and the only way to deliver it is to repeat it. Posts
 * come back with the original `id` and `postedAt`.
 *
 * A badge that counted by ARRIVAL ORDER lit up every time someone accepted a
 * friendship request, with a number from conversations months old. It counts by
 * the writer's timestamp, and that is why what arrives again arrives already
 * attended.
 *
 * Comments are not even rebroadcast, it is measured in
 * `apps/server/src/fundador.test.ts`, and it is a known product limitation,  * but the thread on this device has them twice another way: the vault's
 * history plus what came over the network. `engagementOf` unfolds them by
 * `id`, and the badge inherits that by reading from there.
 */
describe("o mural dito outra vez não acende nada", () => {
  it("a reemissão do mural inteiro não inventa comentários por atender", () => {
    const fio = [
      publicacao(MEU_FEED, EU, "p1", 100),
      comentario(MEU_FEED, ANA, "c1", "p1", 200),
    ]
    // Mark ahead of everything: it is attended.
    expect(contar(fio, 300)).toBe(0)

    // Someone enters the feed, and the feed is stated again: same `id`, same
    // `postedAt`, new arrival order.
    const depoisDaEntrada = [...fio, publicacao(MEU_FEED, EU, "p1", 100)]
    expect(contar(depoisDaEntrada, 300)).toBe(0)
  })

  it("o mesmo comentário entregue duas vezes continua a ser um", () => {
    const fio = [
      publicacao(MEU_FEED, EU, "p1", 100),
      comentario(MEU_FEED, ANA, "c1", "p1", 200),
      comentario(MEU_FEED, ANA, "c1", "p1", 200),
    ]
    expect(contar(fio, 50)).toBe(1)
  })
})

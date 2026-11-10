import { describe, expect, it } from "vitest"
import { foldFriendTies, openRequestsOf, friendsOfTies, sentRequestsOf, severedOf, type FriendEvent } from "./friendship.js"

/**
 * The fold decides who gets which keys: a connection that says "friends" makes
 * the core seat that person in our feed on the next connection. So what we test
 * here is not mainly the happy path, it is what MUST NOT happen.
 */

const EU = "@eu:orwell.pt"
const ELA = "@ela:orwell.pt"
const OUTRO = "@outro:orwell.pt"
const DM = "!dm-ela.eu:orwell.pt"
const DM_OUTRO = "!dm-eu.outro:orwell.pt"
const SALA = "!lagar:orwell.pt"

/** In a direct chat you know who you're talking to; in a room you don't. */
const parDoCanal = (channel: string): string | null =>
  channel === DM ? ELA : channel === DM_OUTRO ? OUTRO : null

function evento(
  channel: string,
  sender: string,
  t: string,
  extras: { sentAt?: number; note?: string; withdrawn?: boolean } = {},
): FriendEvent {
  return { channel, sender, payload: { t, ...extras } }
}

describe("a amizade é mútua a partir de uma aceitação", () => {
  it("um pedido e uma aceitação bastam, dos dois lados", () => {
    // From the side of whoever received the request.
    const dela = foldFriendTies(
      [evento(DM, EU, "friend.request", { sentAt: 10 }), evento(DM, ELA, "friend.accept")],
      ELA,
      (c) => (c === DM ? EU : null),
    )
    expect(dela.get(EU)?.link).toBe("amigos")

    // And from the side of whoever asked, with the same events.
    const meus = foldFriendTies(
      [evento(DM, EU, "friend.request", { sentAt: 10 }), evento(DM, ELA, "friend.accept")],
      EU,
      parDoCanal,
    )
    expect(meus.get(ELA)?.link).toBe("amigos")
    expect(friendsOfTies(meus)).toEqual([ELA])
  })

  it("aceitar fecha o pedido: deixa de estar por responder", () => {
    const ties = foldFriendTies(
      [evento(DM, ELA, "friend.request", { sentAt: 10, note: "olá" }), evento(DM, EU, "friend.accept")],
      EU,
      parDoCanal,
    )
    expect(openRequestsOf(ties)).toEqual([])
    expect(ties.get(ELA)?.link).toBe("amigos")
  })

  it("aceitar duas vezes dá o mesmo que aceitar uma", () => {
    const uma = foldFriendTies(
      [evento(DM, ELA, "friend.request", { sentAt: 10 }), evento(DM, EU, "friend.accept")],
      EU,
      parDoCanal,
    )
    const duas = foldFriendTies(
      [
        evento(DM, ELA, "friend.request", { sentAt: 10 }),
        evento(DM, EU, "friend.accept"),
        evento(DM, EU, "friend.accept"),
      ],
      EU,
      parDoCanal,
    )
    expect(duas.get(ELA)?.link).toBe(uma.get(ELA)?.link)
    expect(openRequestsOf(duas)).toEqual([])
  })

  it("um pedido respondido numa sala fecha-se na mesma", () => {
    // Before direct chats, requests traveled wherever there was a path. The
    // response has no single recipient in a room, and it counts for whoever asked
    // there.
    const ties = foldFriendTies(
      [evento(SALA, ELA, "friend.request", { sentAt: 10 }), evento(SALA, EU, "friend.accept")],
      EU,
      parDoCanal,
    )
    expect(ties.get(ELA)?.link).toBe("amigos")
  })
})

describe("pedidos cruzados resolvem-se em amizade", () => {
  it("os dois pedem e ninguém responde: fica cruzado, não duas esperas", () => {
    const ties = foldFriendTies(
      [evento(DM, EU, "friend.request", { sentAt: 10 }), evento(DM, ELA, "friend.request", { sentAt: 11 })],
      EU,
      parDoCanal,
    )
    expect(ties.get(ELA)?.link).toBe("cruzado")
    // And counts as a request waiting for an answer: an accept button is pending.
    expect(openRequestsOf(ties).map((tie) => tie.peer)).toEqual([ELA])
  })

  it("uma aceitação de qualquer dos lados fecha o cruzamento", () => {
    const ties = foldFriendTies(
      [
        evento(DM, EU, "friend.request", { sentAt: 10 }),
        evento(DM, ELA, "friend.request", { sentAt: 11 }),
        evento(DM, EU, "friend.accept"),
      ],
      EU,
      parDoCanal,
    )
    expect(ties.get(ELA)?.link).toBe("amigos")
  })
})

describe("recusar não dá acesso nenhum, em nenhum sentido", () => {
  it("recusar um pedido não faz amizade nem deixa o pedido aberto", () => {
    const ties = foldFriendTies(
      [evento(DM, ELA, "friend.request", { sentAt: 10 }), evento(DM, EU, "friend.decline")],
      EU,
      parDoCanal,
    )
    expect(ties.get(ELA)?.link).toBe("nenhum")
    expect(friendsOfTies(ties)).toEqual([])
    expect(openRequestsOf(ties)).toEqual([])
  })

  it("uma recusa nossa não responde ao nosso próprio pedido", () => {
    // Rejecting her request cannot erase the request we made: if she later comes
    // to accept, friendship forms through that acceptance and not through this.
    const ties = foldFriendTies(
      [
        evento(DM, EU, "friend.request", { sentAt: 9 }),
        evento(DM, ELA, "friend.request", { sentAt: 10 }),
        evento(DM, EU, "friend.decline"),
      ],
      EU,
      parDoCanal,
    )
    expect(ties.get(ELA)?.link).toBe("pedido-enviado")
    expect(friendsOfTies(ties)).toEqual([])
  })

  it("recusar e depois pedir de novo é um pedido novo, não uma amizade", () => {
    const ties = foldFriendTies(
      [
        evento(DM, ELA, "friend.request", { sentAt: 10 }),
        evento(DM, EU, "friend.decline"),
        evento(DM, ELA, "friend.request", { sentAt: 20 }),
      ],
      EU,
      parDoCanal,
    )
    expect(ties.get(ELA)?.link).toBe("pedido-recebido")
    expect(friendsOfTies(ties)).toEqual([])
  })
})

describe("uma aceitação sem pedido não vale um lugar", () => {
  it("um friend.accept que ninguém pediu é ignorado", () => {
    // Without this guard, a message in the feed would count as a seat in our feed:
    // reconciliation reads from here to know who deserves a seat.
    const ties = foldFriendTies([evento(DM, ELA, "friend.accept")], EU, parDoCanal)
    expect(ties.get(ELA)?.link).toBe("nenhum")
    expect(friendsOfTies(ties)).toEqual([])
  })

  it("aceitar não é forma de responder ao nosso próprio pedido", () => {
    const ties = foldFriendTies(
      [evento(DM, EU, "friend.request", { sentAt: 10 }), evento(DM, EU, "friend.accept")],
      EU,
      parDoCanal,
    )
    expect(ties.get(ELA)?.link).toBe("pedido-enviado")
    expect(friendsOfTies(ties)).toEqual([])
  })

  it("uma aceitação depois de uma recusa não ressuscita a amizade", () => {
    const ties = foldFriendTies(
      [
        evento(DM, EU, "friend.request", { sentAt: 10 }),
        evento(DM, ELA, "friend.decline"),
        evento(DM, ELA, "friend.accept"),
      ],
      EU,
      parDoCanal,
    )
    expect(ties.get(ELA)?.link).toBe("nenhum")
    expect(friendsOfTies(ties)).toEqual([])
  })

  it("a ordem que conta é a de chegada, não a que vem escrita no payload", () => {
    // A timestamp is written by whoever sends. If the fold sorted by it, a
    // `friend.accept` dated before a rejection would seat someone who had already
    // been rejected.
    const ties = foldFriendTies(
      [
        evento(DM, EU, "friend.request", { sentAt: 100 }),
        evento(DM, ELA, "friend.decline"),
        evento(DM, ELA, "friend.accept", { sentAt: 1 }),
      ],
      EU,
      parDoCanal,
    )
    expect(friendsOfTies(ties)).toEqual([])
  })
})

describe("desfazer a amizade desfaz a ligação inteira", () => {
  it("desfeita por nós", () => {
    const ties = foldFriendTies(
      [
        evento(DM, ELA, "friend.request", { sentAt: 10 }),
        evento(DM, EU, "friend.accept"),
        evento(DM, EU, "friend.remove"),
      ],
      EU,
      parDoCanal,
    )
    expect(ties.get(ELA)?.link).toBe("nenhum")
    expect(friendsOfTies(ties)).toEqual([])
    expect(severedOf(ties).has(ELA)).toBe(true)
  })

  it("desfeita por eles", () => {
    const ties = foldFriendTies(
      [
        evento(DM, EU, "friend.request", { sentAt: 10 }),
        evento(DM, ELA, "friend.accept"),
        evento(DM, ELA, "friend.remove"),
      ],
      EU,
      parDoCanal,
    )
    expect(friendsOfTies(ties)).toEqual([])
    expect(severedOf(ties).has(ELA)).toBe(true)
  })

  it("desfeita não se refaz sozinha por um pedido antigo", () => {
    // Reconciliation runs at every connection and reads from here. If a pending
    // request survived the cut, it would re-seat the person in the feed without
    // anyone asking.
    const ties = foldFriendTies(
      [
        evento(DM, ELA, "friend.request", { sentAt: 10 }),
        evento(DM, EU, "friend.accept"),
        evento(DM, EU, "friend.remove"),
        evento(DM, ELA, "friend.accept"),
      ],
      EU,
      parDoCanal,
    )
    expect(friendsOfTies(ties)).toEqual([])
  })

  it("depois de desfeita, um pedido novo recomeça do princípio", () => {
    const ties = foldFriendTies(
      [
        evento(DM, ELA, "friend.request", { sentAt: 10 }),
        evento(DM, EU, "friend.accept"),
        evento(DM, EU, "friend.remove"),
        evento(DM, ELA, "friend.request", { sentAt: 30 }),
      ],
      EU,
      parDoCanal,
    )
    expect(ties.get(ELA)?.link).toBe("pedido-recebido")
    expect(ties.get(ELA)?.severed).toBe(false)
    expect(friendsOfTies(ties)).toEqual([])
  })
})

describe("várias pessoas ao mesmo tempo", () => {
  it("cada ligação é sua, e a lista sai da mais recente para a mais antiga", () => {
    const ties = foldFriendTies(
      [
        evento(DM, ELA, "friend.request", { sentAt: 10, note: "do lagar" }),
        evento(DM_OUTRO, OUTRO, "friend.request", { sentAt: 20 }),
        evento(DM_OUTRO, EU, "friend.accept"),
      ],
      EU,
      parDoCanal,
    )
    expect(openRequestsOf(ties).map((tie) => tie.peer)).toEqual([ELA])
    expect(ties.get(ELA)?.note).toBe("do lagar")
    expect(ties.get(ELA)?.channel).toBe(DM)
    expect(friendsOfTies(ties)).toEqual([OUTRO])
  })
})

/**
 * Cancel a request (phase 1 of the friendship plan, 20/10/2026).
 *
 * Cancellation is a `friend.decline` with `withdrawn`, and the only difference
 * from rejection is WHICH request closes: the one whoever sends it made. Neither
 * of the two seats anyone.
 */
describe("cancelar um pedido", () => {
  it("quem pediu cancela, e o pedido fecha dos dois lados", () => {
    const eventos = [evento(DM, EU, "friend.request", { sentAt: 10 }), evento(DM, EU, "friend.decline", { withdrawn: true })]
    const meus = foldFriendTies(eventos, EU, parDoCanal)
    expect(meus.get(ELA)?.link).toBe("nenhum")
    expect(sentRequestsOf(meus)).toEqual([])
    // From her side, with the same events: the request is no longer pending.
    const dela = foldFriendTies(eventos, ELA, (c) => (c === DM ? EU : null))
    expect(dela.get(EU)?.link).toBe("nenhum")
    expect(openRequestsOf(dela)).toEqual([])
    expect(dela.get(EU)?.severed).toBe(false)
  })

  it("um pedido enviado guarda a hora, e os Enviados ordenam-se por ela", () => {
    const ties = foldFriendTies(
      [evento(DM, EU, "friend.request", { sentAt: 10 }), evento(DM_OUTRO, EU, "friend.request", { sentAt: 20 })],
      EU,
      parDoCanal,
    )
    expect(sentRequestsOf(ties).map((tie) => [tie.peer, tie.at])).toEqual([
      [OUTRO, 20],
      [ELA, 10],
    ])
    expect(openRequestsOf(ties)).toEqual([])
  })

  it("cancelar e pedir outra vez abre um pedido novo", () => {
    const eventos = [
      evento(DM, EU, "friend.request", { sentAt: 10 }),
      evento(DM, EU, "friend.decline", { withdrawn: true }),
      evento(DM, EU, "friend.request", { sentAt: 30 }),
    ]
    const meus = foldFriendTies(eventos, EU, parDoCanal)
    expect(meus.get(ELA)?.link).toBe("pedido-enviado")
    expect(meus.get(ELA)?.at).toBe(30)
    const dela = foldFriendTies(eventos, ELA, (c) => (c === DM ? EU : null))
    expect(openRequestsOf(dela).map((tie) => tie.peer)).toEqual([EU])
  })

  it("num pedido cruzado, cancelar o meu deixa o dela por responder", () => {
    const eventos = [
      evento(DM, EU, "friend.request", { sentAt: 10 }),
      evento(DM, ELA, "friend.request", { sentAt: 20, note: "também eu" }),
      evento(DM, EU, "friend.decline", { withdrawn: true }),
    ]
    const meus = foldFriendTies(eventos, EU, parDoCanal)
    expect(meus.get(ELA)?.link).toBe("pedido-recebido")
    expect(meus.get(ELA)?.note).toBe("também eu")
    expect(friendsOfTies(meus)).toEqual([])
    const dela = foldFriendTies(eventos, ELA, (c) => (c === DM ? EU : null))
    expect(dela.get(EU)?.link).toBe("pedido-enviado")
  })

  it("o cancelamento só fecha o pedido de quem o envia: ninguém cancela o pedido de outro", () => {
    // She sends a `withdrawn` without having asked anything: MY request stays open.
    const meus = foldFriendTies(
      [evento(DM, EU, "friend.request", { sentAt: 10 }), evento(DM, ELA, "friend.decline", { withdrawn: true })],
      EU,
      parDoCanal,
    )
    expect(meus.get(ELA)?.link).toBe("pedido-enviado")
  })

  it("um aceite que chega depois do cancelamento não faz amizade", () => {
    // The request no longer exists: accepting has nothing to count against.
    const meus = foldFriendTies(
      [
        evento(DM, EU, "friend.request", { sentAt: 10 }),
        evento(DM, EU, "friend.decline", { withdrawn: true }),
        evento(DM, ELA, "friend.accept"),
      ],
      EU,
      parDoCanal,
    )
    expect(meus.get(ELA)?.link).toBe("nenhum")
    expect(friendsOfTies(meus)).toEqual([])
  })

  it("numa sala, o cancelamento vale para quem lá tem um pedido meu", () => {
    const ties = foldFriendTies(
      [evento(SALA, EU, "friend.request", { sentAt: 10 }), evento(DM, ELA, "friend.request", { sentAt: 5 })],
      EU,
      parDoCanal,
    )
    // OUR request in a room has no recipient: it opens nothing for anyone.
    expect(sentRequestsOf(ties)).toEqual([])
    const cancelado = foldFriendTies(
      [evento(DM, ELA, "friend.request", { sentAt: 5 }), evento(SALA, EU, "friend.decline", { withdrawn: true })],
      EU,
      parDoCanal,
    )
    // And a cancellation in a room does not close HER request, which is on a different channel.
    expect(cancelado.get(ELA)?.link).toBe("pedido-recebido")
  })

  /**
   * The 0.5.x client does not know `withdrawn`: their Zod throws it out and what
   * the fold reads is a plain `friend.decline`. We measure what that costs here,
   * to write down what breaks (see `docs/PENDENTES.md`).
   */
  it("um cliente antigo lê o cancelamento como recusa de um pedido que não fez: no-op", () => {
    const comoOAntigoLe = [evento(DM, EU, "friend.request", { sentAt: 10 }), evento(DM, EU, "friend.decline")]
    const dela = foldFriendTies(comoOAntigoLe, ELA, (c) => (c === DM ? EU : null))
    // For her, my request stays pending: the cancellation is not visible.
    expect(dela.get(EU)?.link).toBe("pedido-recebido")
    // And on my side, with the field, the request is closed: if she accepts, it doesn't count.
    const meus = foldFriendTies(
      [evento(DM, EU, "friend.request", { sentAt: 10 }), evento(DM, EU, "friend.decline", { withdrawn: true }), evento(DM, ELA, "friend.accept")],
      EU,
      parDoCanal,
    )
    expect(meus.get(ELA)?.link).toBe("nenhum")
  })

  it("num cruzado, o cliente antigo lê o cancelamento como recusa do pedido DELE", () => {
    const comoOAntigoLe = [
      evento(DM, EU, "friend.request", { sentAt: 10 }),
      evento(DM, ELA, "friend.request", { sentAt: 20 }),
      evento(DM, EU, "friend.decline"),
    ]
    const dela = foldFriendTies(comoOAntigoLe, ELA, (c) => (c === DM ? EU : null))
    // The cost in full: her request closes, mine stays in her view.
    expect(dela.get(EU)?.link).toBe("pedido-recebido")
  })
})

import { describe, expect, it } from "vitest"
import { acceptedInvitesOf, foldInviteTies, inviteKey, pendingInvitesOf, type InviteEvent } from "./invite.js"
import { INVITE_TTL_MS } from "./payload.js"

/**
 * The fold decides who enters which channel: an invite that says "accept" makes
 * the inviter's device commit an addition, without that person being in front of
 * the screen. So what we test here is not mainly the happy path, it is what
 * must NOT happen.
 */

const EU = "@eu:orwell.pt"
const ELA = "@ela:orwell.pt"
const DM = "!dm-ela.eu:orwell.pt"
const SALA = "!lagar:orwell.pt"
const AGORA = 1_700_000_000_000

/**
 * The direct-message pair for these tests, as the vault provides it. The fold
 * no longer reads the `!dm-ela.eu` form (1.0 "Arca", slice 2): the caller always
 * supplies the pair.
 */
const PAR_DA_DM = (canal: string): readonly [string, string] | null => (canal === DM ? [ELA, EU] : null)

function dobrar(
  eventos: InviteEvent[],
  me: string,
  agora: number,
  parDoCanal: (canal: string) => readonly [string, string] | null = PAR_DA_DM,
): ReturnType<typeof foldInviteTies> {
  return foldInviteTies(eventos, me, agora, parDoCanal)
}

function convite(sender: string, at = AGORA, channel = DM, target = SALA): InviteEvent {
  return {
    channel,
    sender,
    payload: { t: "message", invite: { channel: target, name: "Lagar do Zé", at } },
  }
}

function resposta(sender: string, accepted: boolean, at = AGORA + 1000, channel = DM, target = SALA): InviteEvent {
  return { channel, sender, payload: { t: "message", inviteReply: { channel: target, accepted, at } } }
}

describe("um convite é uma coisa só, com duas entradas", () => {
  it("convidar não mete ninguém em lado nenhum: fica pendente até haver resposta", () => {
    const meus = dobrar([convite(EU)], EU, AGORA)
    expect(meus.get(inviteKey(SALA, ELA))?.state).toBe("pendente")
    // On the other side, same event: the same invite seen in reverse.
    const dela = dobrar([convite(EU)], ELA, AGORA)
    expect(dela.get(inviteKey(SALA, EU))?.state).toBe("pendente")
    expect(pendingInvitesOf(dela).map((tie) => tie.target)).toEqual([SALA])
  })

  it("quem convida não vê o seu próprio convite como um convite por responder", () => {
    expect(pendingInvitesOf(dobrar([convite(EU)], EU, AGORA))).toEqual([])
  })

  it("aceitar deixa um lugar em dívida do lado de quem convidou", () => {
    const eventos = [convite(EU), resposta(ELA, true)]
    const meus = dobrar(eventos, EU, AGORA)
    expect(meus.get(inviteKey(SALA, ELA))?.state).toBe("aceite")
    expect(acceptedInvitesOf(meus).map((tie) => tie.peer)).toEqual([ELA])
    // On the accepter's side nothing is owed: adding them is not their action.
    expect(acceptedInvitesOf(dobrar(eventos, ELA, AGORA))).toEqual([])
  })

  it("recusar fecha o convite e não dá lugar nenhum", () => {
    const meus = dobrar([convite(EU), resposta(ELA, false)], EU, AGORA)
    expect(meus.get(inviteKey(SALA, ELA))?.state).toBe("recusado")
    expect(acceptedInvitesOf(meus)).toEqual([])
    // And on the decliner's side, the invite leaves the list awaiting a reply.
    expect(pendingInvitesOf(dobrar([convite(EU), resposta(ELA, false)], ELA, AGORA))).toEqual([])
  })
})

describe("o que não pode dar lugar", () => {
  it("uma aceitação que ninguém convidou não vale nada", () => {
    // Without this guard, a line in the thread would buy a place: saying yes to an
    // invite that never existed would be enough for the other side to commit the
    // addition.
    const meus = dobrar([resposta(ELA, true)], EU, AGORA)
    expect(meus.size).toBe(0)
    expect(acceptedInvitesOf(meus)).toEqual([])
  })

  it("aceitar não pode ser uma forma de responder ao próprio convite", () => {
    // The inviter saying yes to their own invite would be admitting themselves by
    // proxy, and the fold would say "accept" about someone who never answered
    // anything.
    const meus = dobrar([convite(EU), resposta(EU, true)], EU, AGORA)
    expect(meus.get(inviteKey(SALA, ELA))?.state).toBe("pendente")
  })

  it("uma aceitação para OUTRO canal não abre este", () => {
    const outro = resposta(ELA, true, AGORA + 1, DM, "!outra-sala:orwell.pt")
    const meus = dobrar([convite(EU), outro], EU, AGORA)
    expect(meus.get(inviteKey(SALA, ELA))?.state).toBe("pendente")
  })

  it("uma segunda resposta não desfaz a primeira", () => {
    // Declining and then saying yes would be a decline that opens itself again, and
    // from the inviter's side that is a place given without anyone pressing anything.
    const meus = dobrar([convite(EU), resposta(ELA, false), resposta(ELA, true, AGORA + 2000)], EU, AGORA)
    expect(meus.get(inviteKey(SALA, ELA))?.state).toBe("recusado")
  })

  it("um convite mandado para uma SALA não é um convite a uma pessoa", () => {
    // In a room, something we send has no single recipient, and assigning it to someone
    // would be the fold inventing who was invited.
    const naSala = convite(EU, AGORA, SALA)
    expect(dobrar([naSala], EU, AGORA).size).toBe(0)
  })
})

describe("convidar duas vezes não faz dois convites", () => {
  it("dois convites iguais dobram-se num só", () => {
    const ties = dobrar([convite(EU), convite(EU, AGORA + 5_000)], EU, AGORA + 5_000)
    expect(ties.size).toBe(1)
    // The first one is what stays: it is what was already shown on the other side,
    // and its timestamp is what counts for the deadline.
    expect(ties.get(inviteKey(SALA, ELA))?.at).toBe(AGORA)
  })

  it("mas depois de uma recusa, um convite novo é um convite novo", () => {
    const eventos = [convite(EU), resposta(ELA, false), convite(EU, AGORA + 9_000)]
    const ties = dobrar(eventos, EU, AGORA + 9_000)
    expect(ties.get(inviteKey(SALA, ELA))?.state).toBe("pendente")
    expect(ties.get(inviteKey(SALA, ELA))?.at).toBe(AGORA + 9_000)
  })

  it("e depois de caducar também", () => {
    const tarde = AGORA + INVITE_TTL_MS + 1
    const ties = dobrar([convite(EU), convite(EU, tarde)], EU, tarde)
    expect(ties.get(inviteKey(SALA, ELA))?.state).toBe("pendente")
    expect(ties.get(inviteKey(SALA, ELA))?.at).toBe(tarde)
  })
})

describe("o prazo", () => {
  it("um convite sem resposta caduca, e deixa de aparecer por responder", () => {
    const tarde = AGORA + INVITE_TTL_MS
    const dela = dobrar([convite(EU)], ELA, tarde)
    expect(dela.get(inviteKey(SALA, EU))?.state).toBe("caducado")
    expect(pendingInvitesOf(dela)).toEqual([])
  })

  it("um sim aceite tarde de mais não compra lugar nenhum", () => {
    // What admits is not the yes, it is the commit from the inviter, done without
    // that person present, about a channel that had two weeks to change membership.
    const tarde = AGORA + INVITE_TTL_MS + 1
    const meus = dobrar([convite(EU), resposta(ELA, true, tarde)], EU, tarde)
    expect(meus.get(inviteKey(SALA, ELA))?.state).toBe("caducado")
    expect(acceptedInvitesOf(meus)).toEqual([])
  })

  it("uma recusa é um facto e não caduca", () => {
    // Moving to "expired" would erase an answer that existed, and reopen the door to
    // a new invite as if the first one was never answered.
    const tarde = AGORA + INVITE_TTL_MS + 1
    const meus = dobrar([convite(EU), resposta(ELA, false)], EU, tarde)
    expect(meus.get(inviteKey(SALA, ELA))?.state).toBe("recusado")
  })

  it("mesmo no último instante antes do prazo, o convite continua de pé", () => {
    const quaseTarde = AGORA + INVITE_TTL_MS - 1
    expect(dobrar([convite(EU)], ELA, quaseTarde).get(inviteKey(SALA, EU))?.state).toBe("pendente")
  })
})

describe("mensagens que não são convites", () => {
  it("uma conversa normal não produz convite nenhum", () => {
    const conversa: InviteEvent = { channel: DM, sender: ELA, payload: { t: "message" } }
    expect(dobrar([conversa], EU, AGORA).size).toBe(0)
  })

  it("um payload que não é uma mensagem é ignorado, mesmo trazendo os campos", () => {
    // The loose way the interface stores payloads is not a contract: reading `t`
    // before the fields is what stops a `post` with an `invite` glued to it from
    // earning a place.
    const torto: InviteEvent = {
      channel: DM,
      sender: ELA,
      payload: { t: "post", invite: { channel: SALA, at: AGORA } },
    }
    expect(dobrar([torto], EU, AGORA).size).toBe(0)
  })
})

describe("o par vem de quem chama (1.0 «Arca»)", () => {
  /**
   * With opaque addresses the direct conversation identifier does not say who is
   * there: the peer comes from the vault. These tests use an opaque address on
   * purpose, to prove the fold no longer reads anything from the channel name.
   */
  const OPACA = `!${"a".repeat(40)}:orwell.pt`
  const TERCEIRO = "@terceiro:orwell.pt"
  const doCofre = (canal: string): readonly [string, string] | null => (canal === OPACA ? [ELA, EU] : null)

  it("um convite meu numa conversa opaca é para a outra ponta do par", () => {
    const ties = dobrar([convite(EU, AGORA, OPACA)], EU, AGORA, doCofre)
    expect(ties.get(inviteKey(SALA, ELA))?.state).toBe("pendente")
    // And the receiver's side does not need the peer: the sender is authenticated.
    const dela = dobrar([convite(EU, AGORA, OPACA)], ELA, AGORA, () => null)
    expect(dela.get(inviteKey(SALA, EU))?.state).toBe("pendente")
  })

  it("aceitar numa conversa opaca deixa o lugar em dívida", () => {
    const eventos = [convite(EU, AGORA, OPACA), resposta(ELA, true, AGORA + 1000, OPACA)]
    expect(acceptedInvitesOf(dobrar(eventos, EU, AGORA, doCofre)).map((tie) => tie.peer)).toEqual([ELA])
  })

  it("sem par no cofre, um convite meu não é para ninguém", () => {
    expect(dobrar([convite(EU, AGORA, OPACA)], EU, AGORA, () => null).size).toBe(0)
  })

  it("com o par dado, a forma antiga deixa de ser lida", () => {
    // The caller supplies the pair: the name `!dm-ela.eu` is not enough to invent
    // the other end when the vault says it is not a direct message.
    expect(dobrar([convite(EU)], EU, AGORA, () => null).size).toBe(0)
  })

  it("um par onde eu não estou não dá destinatário", () => {
    const alheio = (): readonly [string, string] => [ELA, TERCEIRO]
    expect(dobrar([convite(EU, AGORA, OPACA)], EU, AGORA, alheio).size).toBe(0)
  })

  it("um par de mim comigo não dá destinatário", () => {
    const comigo = (): readonly [string, string] => [EU, EU]
    expect(dobrar([convite(EU, AGORA, OPACA)], EU, AGORA, comigo).size).toBe(0)
  })
})

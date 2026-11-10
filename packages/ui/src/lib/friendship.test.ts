import { moradaDeTeste } from "../../testes/moradas.js"
import { lembrarFichasDosCanais } from "./tipoDoCanal.js"
import { beforeEach, describe, expect, it } from "vitest"
import type { ChatMessage } from "../types.js"
import { foldFriendTies, type FriendTie } from "@enclave/protocol"
import { dmPeerAddress } from "./format.js"
import { enderecoColado, escritaNaDirecta, friendshipsDe, openRequestFrom, type Friendships } from "./friendship.js"

// The sheet for each channel (1.0 "Arca", slice 6b): no sheet, a channel is a room.
beforeEach(() => lembrarFichasDosCanais({ [DM]: { tipo: "directa", par: "@ana:s" } }))

/**
 * What the core delivers to the bridge: the fold of the protocol over events,
 * in order. Since phase 1d the interface no longer folds; these tests do the
 * core's job here and prove that sorting (`friendshipsDe`) and reads
 * (`openRequestFrom`) respect what the fold decided.
 */
function friendshipsOf(messages: ChatMessage[], me: string | null): Friendships {
  if (!me) return friendshipsDe([])
  return friendshipsDe([...foldFriendTies(messages, me, (channel) => dmPeerAddress(channel, me)).values()])
}

/**
 * The property these tests exist to pin down is not a business rule,
 * it is a structural property: **there are not two lists**.
 *
 * A request appears on the Friends screen and in the notification center, and
 * answering in one must make it disappear from the other. That could be cleanup code,  * and it would fail in the ending nobody thought to test. Here there is no
 * cleanup: both places read this fold, and the fold stops counting the
 * request the instant the response exists. Each test below is a different ending,
 * and all go through the same path.
 */

const EU = "@eu:s"
const ANA = "@ana:s"
const DM = moradaDeTeste("directa ana eu", "s")

function msg(sender: string, payload: ChatMessage["payload"], channel = DM): ChatMessage {
  return { channel, seq: 1, sender, payload }
}

describe("uma fonte de verdade para os pedidos de amizade", () => {
  it("um pedido por responder está aberto, e é o mesmo objecto para os dois ecrãs", () => {
    const estado = friendshipsOf([msg(ANA, { t: "friend.request", sentAt: 100, note: "olá" })], EU)

    expect(estado.open.map((tie) => tie.peer)).toEqual([ANA])
    expect(estado.open[0]?.note).toBe("olá")
    // The bell asks about the person; Friends scan the list. Same source.
    expect(openRequestFrom(estado, ANA)?.channel).toBe(DM)
  })

  it("aceitar fecha-o — e fecha-o em todo o lado ao mesmo tempo", () => {
    const depois = friendshipsOf(
      [msg(ANA, { t: "friend.request", sentAt: 100 }), msg(EU, { t: "friend.accept", acceptedAt: 150 })],
      EU,
    )

    expect(depois.open).toEqual([])
    expect(openRequestFrom(depois, ANA)).toBeNull()
    expect(depois.ties.get(ANA)?.link).toBe("amigos")
  })

  it("recusar fecha-o na mesma, e não faz amizade nenhuma", () => {
    const depois = friendshipsOf(
      [msg(ANA, { t: "friend.request", sentAt: 100 }), msg(EU, { t: "friend.decline" })],
      EU,
    )

    expect(depois.open).toEqual([])
    expect(openRequestFrom(depois, ANA)).toBeNull()
    expect(depois.ties.get(ANA)?.link).toBe("nenhum")
  })

  it("um pedido cruzado conta como pedido por responder, e uma aceitação resolve-o", () => {
    const cruzado = friendshipsOf(
      [msg(EU, { t: "friend.request", sentAt: 90 }), msg(ANA, { t: "friend.request", sentAt: 100 })],
      EU,
    )
    expect(cruzado.open.map((tie) => tie.peer)).toEqual([ANA])
    expect(cruzado.ties.get(ANA)?.link).toBe("cruzado")

    const resolvido = friendshipsOf(
      [
        msg(EU, { t: "friend.request", sentAt: 90 }),
        msg(ANA, { t: "friend.request", sentAt: 100 }),
        msg(EU, { t: "friend.accept", acceptedAt: 110 }),
      ],
      EU,
    )
    expect(resolvido.open).toEqual([])
    expect(resolvido.ties.get(ANA)?.link).toBe("amigos")
  })

  it("aceitar duas vezes é o mesmo que aceitar uma", () => {
    // Two windows open, a click in each. The second acceptance cannot
    // reopen anything or count twice.
    const duas = friendshipsOf(
      [
        msg(ANA, { t: "friend.request", sentAt: 100 }),
        msg(EU, { t: "friend.accept", acceptedAt: 150 }),
        msg(EU, { t: "friend.accept", acceptedAt: 151 }),
      ],
      EU,
    )
    expect(duas.open).toEqual([])
    expect(duas.ties.get(ANA)?.link).toBe("amigos")
  })

  it("os meus próprios pedidos não me aparecem por responder", () => {
    const estado = friendshipsOf([msg(EU, { t: "friend.request", sentAt: 100 })], EU)
    expect(estado.open).toEqual([])
    expect(estado.ties.get(ANA)?.link).toBe("pedido-enviado")
  })

  it("sem endereço não há dobra nenhuma, em vez de uma dobra errada", () => {
    const estado = friendshipsOf([msg(ANA, { t: "friend.request", sentAt: 100 })], null)
    expect(estado.open).toEqual([])
    expect(estado.ties.size).toBe(0)
  })
})

describe("amizades desfeitas", () => {
  const feita = [msg(ANA, { t: "friend.request", sentAt: 100 }), msg(EU, { t: "friend.accept", acceptedAt: 150 })]

  it("desfeita por nós sai do círculo", () => {
    const depois = friendshipsOf([...feita, msg(EU, { t: "friend.remove" })], EU)
    expect(depois.severed.has(ANA)).toBe(true)
    expect(depois.ties.get(ANA)?.link).toBe("nenhum")
  })

  it("desfeita por eles sai do círculo da mesma maneira", () => {
    const depois = friendshipsOf([...feita, msg(ANA, { t: "friend.remove" })], EU)
    expect(depois.severed.has(ANA)).toBe(true)
  })

  it("um pedido novo depois do corte é um pedido novo, e volta a estar aberto", () => {
    const depois = friendshipsOf(
      [...feita, msg(EU, { t: "friend.remove" }), msg(ANA, { t: "friend.request", sentAt: 300 })],
      EU,
    )
    expect(depois.severed.has(ANA)).toBe(false)
    expect(depois.open.map((tie) => tie.peer)).toEqual([ANA])
  })
})

/**
 * The owner rule, measured as a rule and not as a screen.
 *
 * *"It is only after accepted by the request target that it is possible to
 * exchange private messages, not before."* Live, on September 10, 2026,
 * two accounts exchanged messages in both directions with the request unanswered,  * and kept exchanging them after it was declined.
 */
describe("quem pode escrever numa conversa directa", () => {
  const laco = (link: FriendTie["link"], severed = false): FriendTie => ({
    peer: ANA,
    channel: DM,
    link,
    at: 100,
    severed,
  })

  it("amigos escrevem", () => {
    expect(escritaNaDirecta(laco("amigos"), false, false)).toBe("livre")
  })

  it("quem pediu espera, e não escreve entretanto", () => {
    expect(escritaNaDirecta(laco("pedido-enviado"), false, false)).toBe("espera-resposta")
  })

  it("quem recebeu responde primeiro, e também não escreve antes disso", () => {
    // Both sides, not one: a lock on only one side is a conversation where
    // only one person speaks.
    expect(escritaNaDirecta(laco("pedido-recebido"), false, false)).toBe("responde-primeiro")
  })

  it("um pedido cruzado é um pedido por responder, e trata-se como tal", () => {
    expect(escritaNaDirecta(laco("cruzado"), false, false)).toBe("responde-primeiro")
  })

  it("depois de uma recusa não se escreve, que é o caso que ninguém tinha visto", () => {
    // Declining returns the connection to "none". The conversation stays in both lists,
    // and the message box kept working in it.
    expect(escritaNaDirecta(laco("nenhum"), false, false)).toBe("sem-amizade")
  })

  it("sem ligação nenhuma também não, e é o caso de quem abre a conversa pelo menu", () => {
    expect(escritaNaDirecta(undefined, false, false)).toBe("sem-amizade")
  })

  it("em modo comunidade escreve-se sempre: não há pedido nenhum a fazer", () => {
    expect(escritaNaDirecta(undefined, true, false)).toBe("livre")
  })

  it("um amigo antigo continua a escrever, mesmo quando a dobra já não se lembra", () => {
    /*
      The fold's memory is short on purpose: it is made from the messages the
      interface has on hand, and that list is capped. Without this third source,
      a conversation with an old friend locked itself after enough
      messages, the most expensive defect this fix could introduce, because
      it does not show up in any short-flow test.
    */
    expect(escritaNaDirecta(undefined, false, true)).toBe("livre")
  })

  it("mas uma amizade desfeita não é ressuscitada pelos lugares que ainda existem", () => {
    // After cutting, the two cryptographic facts survive for an instant:
    // her feed disappears from here only when her device commits.
    expect(escritaNaDirecta(laco("nenhum", true), false, true)).toBe("sem-amizade")
  })

  it("a comunidade vence tudo o resto, corte incluído", () => {
    // On a server in community mode friendship is not something you ask for,
    // so it is not something you undo either.
    expect(escritaNaDirecta(laco("nenhum", true), true, true)).toBe("livre")
  })
})

describe("os pedidos enviados e o bloqueio", () => {
  it("o nosso pedido sem resposta está em `sent`, com a data, e não em `open`", () => {
    const estado = friendshipsOf([msg(EU, { t: "friend.request", sentAt: 100 })], EU)
    expect(estado.sent.map((tie) => tie.peer)).toEqual([ANA])
    expect(estado.open).toEqual([])
  })

  it("bloqueado tranca a escrita antes de tudo, comunidade incluída", () => {
    const amigos: FriendTie = { peer: ANA, channel: DM, link: "amigos", at: 1, severed: false }
    expect(escritaNaDirecta(amigos, false, true, true)).toBe("bloqueado")
    expect(escritaNaDirecta(undefined, true, false, true)).toBe("bloqueado")
    expect(escritaNaDirecta(amigos, false, true)).toBe("livre")
  })
})

describe("enderecoColado", () => {
  it("aceita o link de amizade e o endereço sozinho", () => {
    expect(enderecoColado("https://orwell.pt/app/amigo#@rui:orwell.pt")).toBe("@rui:orwell.pt")
    expect(enderecoColado("  @rui:orwell.pt  ")).toBe("@rui:orwell.pt")
  })

  it("encontra o link de amizade no meio de uma frase colada", () => {
    expect(enderecoColado("adiciona-me: https://orwell.pt/app/amigo#@rui:orwell.pt obrigado")).toBe("@rui:orwell.pt")
    // The short link from 1.0, alone or in the middle of a sentence.
    expect(enderecoColado("https://orwell.pt/a#rui")).toBe("@rui:orwell.pt")
    expect(enderecoColado("adiciona-me: https://orwell.pt/a#rui obrigado")).toBe("@rui:orwell.pt")
    expect(enderecoColado("olha https://orwell.pt/app/convite#!x:orwell.pt/abc")).toBeNull()
  })

  it("recusa o resto: canais, convites, texto com espaços, vazio", () => {
    expect(enderecoColado("!canal:orwell.pt")).toBeNull()
    expect(enderecoColado("https://orwell.pt/app/convite#!x:orwell.pt/abc")).toBeNull()
    expect(enderecoColado("@rui orwell")).toBeNull()
    expect(enderecoColado("")).toBeNull()
    expect(enderecoColado("rui")).toBeNull()
  })
})

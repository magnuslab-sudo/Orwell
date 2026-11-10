import { lerLigacaoDeAmigo } from "./ligacaoDeAmigo.js"
import { openRequestsOf, parseAddress, sentRequestsOf, severedOf, type FriendTie } from "@enclave/protocol"

/**
 * The state of friendships for the interface, as the core folded it.
 *
 * The interface does NOT fold friendship events. It folded until phase 1d, over
 * the `messages` list it has in view, and that list is capped (`appendBounded`)
 * and receives recovered pages at the front, out of order. In a crossed request
 * the accept arrived live before the other's request: the fold here ignored the
 * accept and stayed at "request-received", alongside the "accept" the core announced.
 * The ties now come from the bridge (`social.friendTies` and `on.amizades`),
 * folded once, by the core, in server order.
 *
 * Here only sorting happens: requests waiting for our answer, sent requests, severed ties.
 */
export interface Friendships {
  /** Requests waiting for our response, newest to oldest. */
  open: FriendTie[]
  /** OUR requests waiting for response, newest to oldest. */
  sent: FriendTie[]
  /** People who were friends and are no longer, by act of one side or the other. */
  severed: Set<string>
  ties: Map<string, FriendTie>
}

/** The ties the bridge gave, sorted for the screens. No fold at all. */
export function friendshipsDe(lista: readonly FriendTie[]): Friendships {
  const ties = new Map(lista.map((tie) => [tie.peer, tie] as const))
  return { open: openRequestsOf(ties), sent: sentRequestsOf(ties), severed: severedOf(ties), ties }
}

/**
 * A person's open request, or nothing.
 *
 * This is how a notification knows if there is still something to answer.
 * An entry in the bell is a record of something that happened and does not change;
 * the buttons are the state, and the state comes from here. That is what makes
 * an already answered request stop offering "accept" without anyone having to go erase it.
 */
export function openRequestFrom(friendships: Friendships | undefined, who: string | undefined): FriendTie | null {
  if (!friendships || !who) return null
  return friendships.open.find((tie) => tie.peer === who) ?? null
}

/**
 * Whether this direct conversation allows writing in it, and why not when it does not.
 *
 * The owner rule, and it is a rule not a preference: *"it is only after accepted
 * by the request target that it is possible to exchange private messages, not
 * before"*. What there was instead: `requestFriend` opens the direct conversation
 * BEFORE the request goes out, the message bar was not gated by anything, and
 * the request card drew itself on top of a message box that worked. Measured live
 * on September 10, 2026: the two accounts exchanged messages in both directions
 * with the request unanswered, and kept exchanging them after it was DECLINED.
 *
 * Both sides, not one. The requester does not write while waiting; the receiver
 * does not write before accepting. A lock on only one side is not a lock: it is
 * a conversation where only one person speaks.
 *
 * **Three sources, by order of trust.**
 *
 * Community first: on a server in community mode everyone is already friends
 * with everyone and there is no request to make, so there is nothing to lock.
 *
 * Then the fold, which is the real state, who asked, who accepted, who declined,
 * who severed.
 *
 * And finally the cryptographic fact. It was born when the fold was on the interface
 * and had short memory (the capped list of `appendBounded`); the fold is now on the core
 * (phase 1d), but the tie may still not have arrived from the bridge on startup,
 * and without this third source an old friend's conversation opened locked. Swapped
 * feed slots do not forget: either this device has the person's feed, or they have
 * a slot in ours. Except when the link was SEVERED, then the slots still exist for an instant,
 * and it is the fold that knows they no longer count.
 *
 * It is not a cryptographic lock and does not claim to be: an altered client sends
 * what it wants, and the other side receives. What this closes is the product,
 * which is where the owner rule lives. The real lock belongs to the protocol, and that is
 * a decision that changes what goes encrypted on the wire.
 */
export type EscritaNaDirecta =
  /** There is friendship: write. */
  | "livre"
  /** We asked, and there is no response yet. */
  | "espera-resposta"
  /** They asked us, and the answer is ours to give. */
  | "responde-primeiro"
  /** There is no request open: there never was, it was declined, or it was severed. */
  | "sem-amizade"
  /**
   * I blocked this person on this device. It comes before everything, community
   * included: the core no longer records what they say, and writing to them was
   * speaking to a conversation this side stopped reading.
   */
  | "bloqueado"

export function escritaNaDirecta(
  tie: FriendTie | undefined,
  naComunidade: boolean,
  lugaresDeFeedTrocados: boolean,
  bloqueado = false,
): EscritaNaDirecta {
  if (bloqueado) return "bloqueado"
  if (naComunidade) return "livre"
  if (tie?.link === "amigos") return "livre"
  if (lugaresDeFeedTrocados && !tie?.severed) return "livre"
  // A crossed request counts as a request waiting for response: accepting is what closes it,
  // from both sides. See `openRequestsOf`.
  if (tie?.link === "pedido-recebido" || tie?.link === "cruzado") return "responde-primeiro"
  if (tie?.link === "pedido-enviado") return "espera-resposta"
  return "sem-amizade"
}

/**
 * An account address someone pasted in the "Find" field.
 *
 * Accepts the forms a person has on hand: the friend link, short
 * (`https://<servidor>/a#id`, from 1.0) or long
 * (`https://<servidor>/app/amigo#@id:servidor`), parsed by `lerLigacaoDeAmigo`,
 * and the address alone. Everything else is null: a channel address (`!`), text
 * with spaces, or an invite link. Nothing here leaves the device.
 */
export function enderecoColado(texto: string): string | null {
  const limpo = texto.trim()
  if (!limpo) return null
  const doLink = lerLigacaoDeAmigo(limpo)
  if (doLink) return doLink.address
  // A link pasted in the middle of a sentence ("add me: https://…"): the first one.
  const noTexto = /https?:\/\/\S+/.exec(limpo)?.[0]
  const doTexto = noTexto ? lerLigacaoDeAmigo(noTexto) : null
  if (doTexto) return doTexto.address
  if (/\s/.test(limpo)) return null
  try {
    return parseAddress(limpo).sigil === "@" ? limpo : null
  } catch {
    return null
  }
}

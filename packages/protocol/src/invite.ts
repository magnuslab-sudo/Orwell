/**
 * The invite by address, folded from the messages that created it.
 *
 * It lives in the protocol for the same reason friendships do: the core needs
 * this fold to know who it owes a place to after reconnect, and the interface
 * needs it to know which invites are still waiting for an answer. Two folds over
 * the same events diverge at the first change, and what diverges here is not a
 * label, it is who enters which channel.
 *
 * The design is the same as for friendships, and it is what the cryptography
 * demands: inviting does not put anyone in any channel. No one enters an MLS
 * group alone, for someone to be admitted, a member must commit the addition
 * and send them a welcome. So the invite is a MESSAGE, accepting is SAYING YES,
 * and admission is an action by the inviter's device, when it comes online. Time
 * passes between accepting and entering, and the interface says so.
 */

import { INVITE_TTL_MS } from "./payload.js"

/** The state of an invite, from the fold's point of view. */
export type InviteState =
  /** Sent, no answer, and still within the deadline. */
  | "pendente"
  /** Said yes. Missing the place, which is a commit from the inviter. */
  | "aceite"
  | "recusado"
  /** No answer and past the deadline. See `INVITE_TTL_MS`. */
  | "caducado"

/**
 * Only what the fold reads from a payload.
 *
 * Written this way, not as the entire `Payload`, for the same reason as
 * `FriendPayloadShape`: the interface stores messages in its own loose form, and
 * reading little is the guarantee that the fold does not come to depend on fields
 * that are not its business.
 */
export interface InvitePayloadShape {
  t: string
  invite?: { channel: string; name?: string | undefined; at: number; sucessao?: string | undefined } | undefined
  inviteReply?: { channel: string; accepted: boolean; at: number } | undefined
}

export interface InviteEvent {
  /** The conversation it traveled through, where the answer goes. */
  channel: string
  /** Whoever sent it, authenticated by MLS, never a field from inside the payload. */
  sender: string
  payload: InvitePayloadShape
}

export interface InviteTie {
  /** The channel you were invited to. */
  target: string
  /** The other person: the inviter, or the invited. */
  peer: string
  /** The direct conversation where the invite lives, and where the answer goes. */
  channel: string
  /** True if I did the inviting. */
  mine: boolean
  state: InviteState
  /** The timestamp of the invite. From the inviter, see `INVITE_TTL_MS`. */
  at: number
  /** The channel name, as the inviter saw it. */
  name?: string | undefined
  /**
   * The invite is for who succeeded this account (phase 8.2, "Merge accounts").
   * A device of the invited account that merged this account accepts it alone.
   */
  sucessao?: string | undefined
}

/** An invite and its answer are the same thing seen from two sides. */
export function isInvitePayload(payload: InvitePayloadShape): boolean {
  return payload.t === "message" && (payload.invite !== undefined || payload.inviteReply !== undefined)
}

/**
 * The key of an invite: the channel it is to, and the person it is for.
 *
 * Exported so whoever reads the fold does not have to guess it, a key written
 * by hand on the outside is a key that disagrees with this one at the first
 * change, and the symptom is an invite that exists and cannot be found. The
 * separator is a byte that does not appear in addresses or channel identifiers,
 * so no pair of different values can give the same key.
 */
export function inviteKey(target: string, peer: string): string {
  return `${target}\u0000${peer}`
}

interface TieState {
  target: string
  peer: string
  channel: string
  mine: boolean
  at: number
  name?: string | undefined
  sucessao?: string | undefined
  answered: "aceite" | "recusado" | null
}

/**
 * Fold invite messages into an invite by (channel, person).
 *
 * `events` comes in ARRIVAL ORDER to this device, and the state comes from there,
 * not from the timestamps in the payloads, the same discipline as
 * `foldFriendTies`, and for the same security reason: timestamps are written by
 * the sender, and a fold that sorted by them would accept an acceptance dated
 * before a decline.
 *
 * The key is the pair (invited channel, person): inviting the same person to the
 * same channel twice gives ONE invite, not two, and thus never two places.
 *
 * `agora` comes as an argument, not from `Date.now()`, so the deadline can be
 * tested without waiting fourteen days.
 *
 * `parDoCanal` tells who the two ends of a direct conversation are, and `null`
 * for everything else. It comes from the caller, and it comes from the vault (the
 * channel entry, `tipoDoCanal.ts` in the core): with opaque addresses the channel
 * identifier no longer says who is there. Mandatory since 1.0 slice 2, which
 * removed the reading of the old form `!dm-a.b` from here.
 */
export function foldInviteTies(
  events: Iterable<InviteEvent>,
  me: string,
  agora: number,
  parDoCanal: ParDoCanal,
): Map<string, InviteTie> {
  const states = new Map<string, TieState>()
  const peerDe = (channel: string): string | null => peerOfDirect(parDoCanal(channel), me)

  for (const event of events) {
    if (!isInvitePayload(event.payload)) continue
    const mine = event.sender === me

    const convite = event.payload.invite
    if (convite) {
      /**
       * The person the invite is addressed to.
       *
       * What arrives has an authenticated sender, and that's them. What we send
       * goes to the other end of the direct conversation, and that's why the
       * invite travels in a direct conversation and not in a room: there's only
       * one recipient, and we know who it is without trusting any field.
       */
      const peer = mine ? peerDe(event.channel) : event.sender
      if (!peer || peer === me) continue
      const id = inviteKey(convite.channel, peer)
      const conhecido = states.get(id)
      // A duplicate invite does not create a second one: it updates the existing one,
      // and only if the previous one is no longer active. A new invite after a
      // refusal is a new invite, it works the same way friendship does.
      if (conhecido && conhecido.answered === null && agora - conhecido.at < INVITE_TTL_MS) continue
      states.set(id, {
        target: convite.channel,
        peer,
        channel: event.channel,
        mine,
        at: convite.at,
        name: convite.name,
        ...(typeof convite.sucessao === "string" ? { sucessao: convite.sucessao } : {}),
        answered: null,
      })
      continue
    }

    const resposta = event.payload.inviteReply
    if (!resposta) continue
    const peer = mine ? peerDe(event.channel) : event.sender
    if (!peer || peer === me) continue
    const tie = states.get(inviteKey(resposta.channel, peer))
    // A response only counts against an invite that exists, and only the person
    // invited can give it. Without this guard, a message in the thread would claim
    // a slot: you could just say "accept" to an invite nobody made and the other
    // side would commit to adding you. It's the same guard that `friend.accept`
    // has, for the same reason.
    if (!tie) continue
    if (tie.mine === mine) continue
    if (tie.answered !== null) continue
    tie.answered = resposta.accepted ? "aceite" : "recusado"
    tie.channel = event.channel
  }

  const ties = new Map<string, InviteTie>()
  for (const [id, state] of states) {
    ties.set(id, {
      target: state.target,
      peer: state.peer,
      channel: state.channel,
      mine: state.mine,
      state: estadoDe(state, agora),
      at: state.at,
      name: state.name,
      ...(state.sucessao !== undefined ? { sucessao: state.sucessao } : {}),
    })
  }
  return ties
}

/**
 * The deadline beats a yes, not a no.
 *
 * A refusal is a fact and stays a fact: moving to "expired" after two weeks
 * would erase a response that happened, and reopen the door to a second invite
 * as if the first was never answered.
 *
 * A yes does not survive the deadline, and this is the hardest call in this
 * file. Someone who accepted on day thirteen and sees the inviter return on day
 * fifteen loses their slot. It's deliberate: what counts is not the yes, it's
 * the commit by whoever invited, made without this person being there, over a
 * channel that had two weeks to change. The state shows it instead of hiding it
 *, "expired" appears on both sides, and inviting again is one click.
 */
function estadoDe(state: TieState, agora: number): InviteState {
  if (state.answered === "recusado") return "recusado"
  if (agora - state.at >= INVITE_TTL_MS) return "caducado"
  return state.answered ?? "pendente"
}

/**
 * The two ends of a direct conversation, in any order. `null` when the
 * channel is not a direct conversation.
 */
export type ParDoCanal = (channel: string) => readonly [string, string] | null

/**
 * The other person in a direct conversation, given the pair.
 *
 * It tells us who we sent an invite to, what arrives has an authenticated
 * sender and doesn't need this. Returning `null` in a room is correct: there
 * we don't have a single recipient, and an invite sent to a room is not an
 * invite to a person. A pair where I'm not in it also returns `null`: the vault
 * would be saying I spoke in a conversation that's not mine, and an invite
 * created from there would be us inventing who was invited.
 */
function peerOfDirect(par: readonly [string, string] | null, me: string): string | null {
  if (!par) return null
  const [a, b] = par
  if (a === b) return null
  if (a === me) return b
  if (b === me) return a
  return null
}

/** The invites made to me that still wait for my answer. */
export function pendingInvitesOf(ties: Map<string, InviteTie>): InviteTie[] {
  return [...ties.values()].filter((tie) => !tie.mine && tie.state === "pendente").sort((a, b) => b.at - a.at)
}

/**
 * The invites I sent that were already accepted: each one is a slot owed.
 *
 * This is the list reconciliation goes through after reconnecting. Someone who
 * accepted can't enter alone, and the inviter may have been offline when the
 * response came, without this, a yes would just stay a yes.
 */
export function acceptedInvitesOf(ties: Map<string, InviteTie>): InviteTie[] {
  return [...ties.values()].filter((tie) => tie.mine && tie.state === "aceite")
}

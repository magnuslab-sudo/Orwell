/**
 * The connection between two accounts, folded from the events that created it.
 *
 * It lives in the protocol, not on each side, for one reason only: the core needs
 * it to know who it owes a place in its feed after reconnecting, and the interface
 * needs it to know which requests are still pending. Two separate folds over the
 * same events diverge at the first change, and what diverges here is not a label,
 * it is who gets which keys.
 *
 * Friendship is mutual by construction: a request, an acceptance, and each side
 * gets a place in the other's feed. What this fold does not do, and cannot do, is
 * grant those places: each one is an MLS Commit signed by the feed owner. Here we
 * only say who is owed them.
 */

/** The state of a connection, from the point of view of whoever folds it. */
export type FriendLink =
  | "nenhum"
  | "pedido-enviado"
  | "pedido-recebido"
  /** Both asked and neither answered: it resolves to friendship, not to waiting. */
  | "cruzado"
  | "amigos"

/**
 * Only what the fold reads from a payload.
 *
 * Written like this, not as the whole `Payload`, because the interface stores
 * messages in its own loose form and would have to convert them just to ask
 * about the state of a friendship. Reading little is also the guarantee that the
 * fold never comes to depend on fields that are none of its business.
 */
export interface FriendPayloadShape {
  t: string
  sentAt?: number | undefined
  note?: string | undefined
  /** In a `friend.decline`: whoever sends it withdraws THEIR request, instead of rejecting the other's. */
  withdrawn?: boolean | undefined
}

export interface FriendEvent {
  channel: string
  /** The sender, authenticated by MLS, never a field from inside the payload. */
  sender: string
  payload: FriendPayloadShape
}

export interface FriendTie {
  peer: string
  /** Where the response goes: the channel this connection last spoke in. */
  channel: string
  link: FriendLink
  /**
   * When the open request was made, so the list can sort by it.
   *
   * The time of whoever asked last, in both directions: a received request stores
   * theirs, a sent one stores ours, and that is what lets "Enviados" sort the same way as
   * "Recebidos".
   *
   * It is for display and nothing else. The state comes from the order of arrival:
   * see the note on `foldFriendTies`.
   */
  at: number
  note?: string | undefined
  /** Ended by one of the two, not by lack of response. */
  severed: boolean
}

/** The four payloads that touch a connection, and no others. */
const FRIEND_PAYLOADS = new Set(["friend.request", "friend.accept", "friend.decline", "friend.remove"])

export function isFriendPayload(payload: { t: string }): boolean {
  return FRIEND_PAYLOADS.has(payload.t)
}

/** The visible state, computed from what we know and not stored separately. */
function linkOf(state: { friends: boolean; mineOpen: boolean; theirsOpen: boolean }): FriendLink {
  if (state.friends) return "amigos"
  if (state.mineOpen && state.theirsOpen) return "cruzado"
  if (state.theirsOpen) return "pedido-recebido"
  if (state.mineOpen) return "pedido-enviado"
  return "nenhum"
}

interface TieState {
  peer: string
  channel: string
  /** This side asked and has not received a response yet. */
  mineOpen: boolean
  /** The other side asked and has not been answered yet. */
  theirsOpen: boolean
  friends: boolean
  severed: boolean
  at: number
  note?: string | undefined
}

/**
 * Folds friendship events into a connection per person.
 *
 * `events` must arrive in ORDER OF ARRIVAL at this device, and the state comes
 * from that order, not from the timestamps inside the payloads. The distinction
 * is about security, not tidiness: timestamps are written by the sender, and a
 * fold that ordered by them would accept a `friend.accept` backdated before a
 * rejection, and this device would then add to its own feed someone who had
 * already been rejected. Arrival order cannot be forged on the other end of
 * the wire.
 *
 * `peerOfChannel` says who is being talked to in a channel, when that is
 * deducible: in a direct conversation it is the other member. Returning `null`
 * is the right answer for a room: there what we send has no single
 * recipient, and it is attributed to whoever has an open request in that same
 * channel, which is the only path through which a request made before direct
 * conversations can still close.
 */
export function foldFriendTies(
  events: Iterable<FriendEvent>,
  me: string,
  peerOfChannel: (channel: string) => string | null,
): Map<string, FriendTie> {
  const states = new Map<string, TieState>()

  const touch = (peer: string, channel: string): TieState => {
    const known = states.get(peer)
    if (known) {
      known.channel = channel
      return known
    }
    const fresh: TieState = {
      peer,
      channel,
      mineOpen: false,
      theirsOpen: false,
      friends: false,
      severed: false,
      at: 0,
    }
    states.set(peer, fresh)
    return fresh
  }

  for (const event of events) {
    if (!isFriendPayload(event.payload)) continue
    const mine = event.sender === me

    /**
     * Who this event concerns.
     *
     * What arrives has an authenticated sender, and that's them. What we send
     * needs the channel to know who it went to: in a direct conversation there
     * is only one, and in a room it applies to whoever has a pending request
     * there.
     */
    const alvos: string[] = []
    if (!mine) {
      alvos.push(event.sender)
    } else {
      const peer = peerOfChannel(event.channel)
      if (peer && peer !== me) alvos.push(peer)
      else if (!peer) {
        // In a room, a cancellation from us applies to whoever has OUR open request
        // there; everything else applies to whoever has THEIR request.
        const retirada = event.payload.t === "friend.decline" && event.payload.withdrawn === true
        for (const state of states.values()) {
          if (state.channel === event.channel && (retirada ? state.mineOpen : state.theirsOpen)) alvos.push(state.peer)
        }
      }
    }

    for (const peer of alvos) {
      if (peer === me) continue
      const tie = touch(peer, event.channel)
      switch (event.payload.t) {
        case "friend.request":
          // A request does not reopen a completed friendship or undo someone else's
          // rejection: it adds one side's intent and nothing more.
          if (tie.friends) break
          tie.severed = false
          if (mine) {
            tie.mineOpen = true
            tie.at = event.payload.sentAt ?? 0
          } else {
            tie.theirsOpen = true
            tie.at = event.payload.sentAt ?? 0
            tie.note = event.payload.note
          }
          break

        case "friend.accept":
          /**
           * An accept only counts against a request from THE OTHER side.
           *
           * Without this guard, a `friend.accept` that nobody requested would
           * put the connection in "friends", and the reconciliation on the next
           * reconnect would add that person to our feed. A sentence on
           * the wire would earn a place in the feed, exactly what
           * the product's core promise forbids. On our side the guard is
           * the same in reverse: accepting cannot be a way to respond to
           * our own request.
           */
          if (mine ? tie.theirsOpen : tie.mineOpen) {
            tie.friends = true
            tie.mineOpen = false
            tie.theirsOpen = false
            tie.severed = false
            tie.note = undefined
          }
          break

        case "friend.decline":
          /**
           * Closes a request and grants no place, in either direction.
           *
           * A REJECTION closes the other's request: ours does not erase our
           * own request, and theirs does not erase what they asked for. A
           * CANCELLATION (`withdrawn`) is the opposite, and only the opposite:
           * whoever sends it closes THEIR request, and the other side's
           * request, if any, remains. In a crossed request, canceling mine
           * leaves me with theirs still waiting, which is what happened.
           *
           * Both directions are read from the authenticated sender, not from a
           * who-wrote-it field: nobody cancels someone else's request, because a `withdrawn`
           * only closes the request of whoever sent it.
           */
          if (event.payload.withdrawn === true) {
            if (mine) {
              tie.mineOpen = false
            } else {
              tie.theirsOpen = false
              tie.note = undefined
            }
          } else if (mine) {
            tie.theirsOpen = false
            tie.note = undefined
          } else {
            tie.mineOpen = false
          }
          break

        case "friend.remove":
          // Ended, and ended on both sides: no friendship, and no request waiting for
          // a response that would bring it back by itself.
          tie.friends = false
          tie.mineOpen = false
          tie.theirsOpen = false
          tie.severed = true
          tie.note = undefined
          break
      }
    }
  }

  const ties = new Map<string, FriendTie>()
  for (const [peer, state] of states) {
    ties.set(peer, {
      peer,
      channel: state.channel,
      link: linkOf(state),
      at: state.at,
      note: state.note,
      severed: state.severed,
    })
  }
  return ties
}

/**
 * The requests still waiting for our response, newest to oldest.
 *
 * A crossed request counts as one awaiting a response: accepting is what
 * closes it, and either side can do that.
 */
export function openRequestsOf(ties: Map<string, FriendTie>): FriendTie[] {
  return [...ties.values()]
    .filter((tie) => tie.link === "pedido-recebido" || tie.link === "cruzado")
    .sort((a, b) => b.at - a.at)
}

/**
 * OUR requests still waiting for a response, newest to oldest. These are the
 * ones that can be canceled.
 *
 * A crossed request does not go here: it is in `openRequestsOf`, because
 * what closes it is accepting, and that is what the interface has to offer.
 */
export function sentRequestsOf(ties: Map<string, FriendTie>): FriendTie[] {
  return [...ties.values()].filter((tie) => tie.link === "pedido-enviado").sort((a, b) => b.at - a.at)
}

/** Who must have a place in our feed for the friendship to be truly mutual. */
export function friendsOfTies(ties: Map<string, FriendTie>): string[] {
  return [...ties.values()].filter((tie) => tie.link === "amigos").map((tie) => tie.peer)
}

/** Who was a friend and stopped being one through an act by either side. */
export function severedOf(ties: Map<string, FriendTie>): Set<string> {
  const cortados = new Set<string>()
  for (const tie of ties.values()) if (tie.severed) cortados.add(tie.peer)
  return cortados
}

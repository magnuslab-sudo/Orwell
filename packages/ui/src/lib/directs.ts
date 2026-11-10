import type { ChatMessage } from "../types.js"
import { dmPeerAddress, isDirect } from "./format.js"

/**
 * The open direct conversations, and what decides which ones to show.
 *
 * They live in Friends, not in the channel list. The separation is not filing: a
 * channel is a group with rooms, categories, roles, and people who join and leave; a
 * direct conversation is a person. Mixing them made the list grow with things of
 * different nature, and forced anyone looking for a person to read them amid structure
 * that has nothing to do with them.
 *
 * **Closing is not deleting, and that is the distinction this file guards.** A
 * conversation leaves the list without losing anything: the MLS group stays up, the
 * history stays in the vault, and the person is still there. It appears again on its
 * own as soon as a message arrives, which makes "closing" a gesture without regret,
 * unlike "forget the channel", which undoes the cryptographic membership and cannot be
 * undone.
 */

/**
 * When each conversation was closed, by channel ID.
 *
 * Since phase 5 this is the account archive (`lib/estadoDaConta.ts`): it lives in the
 * vault and travels through the account channel, and closing a conversation on mobile
 * closes it on desktop. The `enclave.dmClosed` key in `localStorage` stays only for
 * local mode (before the account opens, or a host without state) and for the one-time
 * migration, which deletes it.
 */
export const DM_CLOSED_KEY = "enclave.dmClosed"

export type ClosedDirects = Record<string, number>

/** Tolerant reading: missing key, broken JSON, or garbage all return `{}`. */
export function readClosedDirects(storage: Pick<Storage, "getItem"> = localStorage): ClosedDirects {
  try {
    const raw = storage.getItem(DM_CLOSED_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    const limpo: ClosedDirects = {}
    for (const [channel, at] of Object.entries(parsed)) {
      if (typeof at === "number" && Number.isFinite(at)) limpo[channel] = at
    }
    return limpo
  } catch {
    return {}
  }
}

export function writeClosedDirects(closed: ClosedDirects, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(DM_CLOSED_KEY, JSON.stringify(closed))
  } catch {
    // Storage full or locked. The list stays correct in this session.
  }
}

/** A direct conversation, as the Friends column needs to know it. */
export interface DirectEntry {
  channel: string
  /** The other person. Null only if the channel ID cannot be read. */
  peer: string | null
  /** When the last thing was said there. Zero in a conversation with nothing yet. */
  lastAt: number
  /** The start of the last message, or empty if there is none yet. */
  preview: string
  /** The last message is mine: the line says so, like in any messenger. */
  minha: boolean
  /**
   * The last thing in this conversation was a friend request.
   *
   * A friend request has no body, so no preview: the line puts a label in its place.
   * This comes from here, not the component, for the same reason as the rest of this
   * fold, what decides what the list shows is a pure function that reads without
   * building the app.
   */
  pedido: boolean
}

/** The moment a message says it happened. Sender's clocks. */
function carimbo(message: ChatMessage): number {
  return message.payload.sentAt ?? message.payload.postedAt ?? 0
}

/**
 * The conversations to list, already sorted: the one that spoke last on top.
 *
 * Pure on purpose, what decides if a conversation shows is a rule with three cases
 * that go wrong easily, and a rule like that deserves tests that do not need the app
 * built to read.
 *
 * A conversation shows if: never closed; or closed and got a message after; or is
 * open in front of the person, closing the conversation you are reading would make
 * the line vanish under the cursor, and that reads as a bug, not a choice.
 */
export function listDirects(
  channels: string[],
  messages: ChatMessage[],
  closed: ClosedDirects,
  me: string | null,
  active: string | null,
): DirectEntry[] {
  /*
    One pass through messages, not one per conversation.
    
    The list can have hundreds of messages in memory; walking it per conversation gave
    quadratic cost in a column that redraws on every keystroke typed in chat.
    */
  const ultima = new Map<string, ChatMessage>()
  for (const message of messages) {
    if (!isDirect(message.channel)) continue
    /**
     * The messages, and the friend requests.
     *
     * Only messages counted, and this was the result: a friend request arrived at the
     * direct conversation and the conversation did not rise, gained no preview, and,      * if closed, would not even reappear. A request that arrives somewhere nobody sees
     * is a request that never arrived.
     *
     * The invite to a channel needs no mention here, and that is on purpose: it TRAVELS
     * inside a message, so it comes through this gate like anything else said. See
     * `ChannelInvite` in the protocol.
     */
    if (message.payload.t !== "message" && message.payload.t !== "friend.request") continue
    const conhecida = ultima.get(message.channel)
    if (!conhecida || carimbo(message) >= carimbo(conhecida)) ultima.set(message.channel, message)
  }

  const entradas: DirectEntry[] = []
  for (const channel of channels) {
    if (!isDirect(channel)) continue
    const message = ultima.get(channel)
    const lastAt = message ? carimbo(message) : 0
    const fechadaEm = closed[channel]
    // Closed, and nothing new since. The open conversation is the exception: we do not hide
    // what the person is reading.
    if (fechadaEm !== undefined && lastAt <= fechadaEm && channel !== active) continue
    entradas.push({
      channel,
      peer: peerOf(channel, me),
      lastAt,
      preview: (message?.payload.body ?? "").replace(/\s+/g, " ").trim(),
      minha: message?.sender === me && me !== null,
      pedido: message?.payload.t === "friend.request",
    })
  }

  return entradas.sort((a, b) => b.lastAt - a.lastAt || a.channel.localeCompare(b.channel))
}

/**
 * The other person in a direct conversation.
 *
 * Reimplemented here rather than imported from `format.ts` for one reason only: there
 * the function returns null without `me`, and this list has to know how to draw itself
 * before the account is loaded. The identifier includes both sides; what is not mine
 * is theirs.
 */
function peerOf(channel: string, me: string | null): string | null {
  return dmPeerAddress(channel, me)
}

/**
 * Close a conversation: mark it with the instant it closed.
 *
 * The stamp is the most recent message's, or now if that is later, the same
 * precaution as `markRead`. Without it, a conversation from someone with the clock
 * ahead reappeared the instant after closing, and nobody could close it at all.
 */
export function closeDirect(closed: ClosedDirects, channel: string, messages: ChatMessage[]): ClosedDirects {
  let recente = Date.now()
  for (const message of messages) {
    if (message.channel === channel) recente = Math.max(recente, carimbo(message))
  }
  return { ...closed, [channel]: recente }
}

/** Reopen: the flag goes away, and the conversation counts again like any other. */
export function reopenDirect(closed: ClosedDirects, channel: string): ClosedDirects {
  if (!(channel in closed)) return closed
  const seguinte = { ...closed }
  delete seguinte[channel]
  return seguinte
}

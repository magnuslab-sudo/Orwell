import { useMemo, useState } from "react"
import type { ChatMessage } from "../types.js"
import { marcaDeEntradaDe } from "./useUnreads.js"
import { lerEstadoDaConta } from "../lib/estadoDaConta.js"

/**
 * Where you were in this conversation, frozen at entry.
 *
 * **The problem, and it decides everything else.** `useUnreads` advances the
 * read mark of the ACTIVE channel with each incoming message and the moment
 * the conversation opens-that's what makes the count disappear from the side,
 * and that's right. But a line drawn from that mark never appeared: by the time
 * there was a screen to show it, the mark had already moved past it. **The mark
 * is the point where you WERE, not where you are.**
 *
 * So read the value once, at channel entry, and freeze it. While the
 * conversation is open the line doesn't move, no matter what-not with new
 * messages arriving, not with scrolling, not with the channel marked read
 * behind the scenes. A line that jumped as you scrolled would be useless, which
 * is exactly what it must not be.
 *
 * **Where the value comes from, and why there are TWO sources.**
 *
 * First, and the one that almost always answers: `marcaDeEntradaDe`, which
 * `useUnreads` grabs one step before advancing the mark. It has to come from
 * there because the shell activates the channel long before this screen exists-
 * the advance happens with the conversation still unmounted, and when this line
 * finally draws the stored value has already passed it. **This was exactly the
 * bug, and it only showed up live**: the tests mounted the timeline and count
 * at the same time, and at the same time it works.
 *
 * Second is storage, in case this line draws BEFORE the count has ever run for
 * this channel. Then the stored value is still intact and it's the right one.
 * The two sources say the same thing at different times, which is why the order
 * between them can't break anything.
 *
 * **Why the read happens during RENDER, not in an effect.** An effect on this
 * component runs after its children's effects and before its parent's, and
 * that order is too fragile to depend on. Reading during render is the earliest
 * moment that exists. Calling `setState` during render to sync state with a
 * changed prop is the pattern React documents for this: no effect, no double
 * paint, and no order for anyone to break by accident.
 *
 * The read itself is pure-it writes nothing, just peeks-so doing it during
 * render doesn't have the problem an effect would.
 *
 * **Opening and closing is not reading.** A peek advances the stored mark (that's
 * what the product already decided, and we don't touch it), but it doesn't erase
 * this visit's line: the frozen value is from this visit and lives as long as
 * it does.
 */
export function usePorLer(
  channel: string,
  messages: ChatMessage[],
  me: string | null,
): {
  /** The timestamp of the last read, frozen at entry. Null if never been here. */
  marca: number | null
  /** The key of the first unread message, where the line draws. Null if there isn't one. */
  primeira: string | null
  /** How many are unread in this conversation, from the mark onward. */
  quantas: number
} {
  const [congelado, setCongelado] = useState<{ channel: string; marca: number | null }>(() => ({
    channel,
    marca: marcaDe(channel),
  }))
  // New channel: freeze again, here and now. A `setState` during render makes
  // React draw again right away, with no intermediate commit and no screen flicker.
  // See the comment above.
  if (congelado.channel !== channel) {
    setCongelado({ channel, marca: marcaDe(channel) })
  }
  const marca = congelado.channel === channel ? congelado.marca : null

  return useMemo(() => {
    // Never been here: everything that exists is new, and a line above the very
    // first message marks nothing. See `NADA` below.
    if (marca === null) return NADA

    let primeira: string | null = null
    let quantas = 0
    for (const message of messages) {
      if (message.channel !== channel) continue
      if (message.payload.t !== "message") continue
      // Ours never count: no one goes back to a conversation to read what they just
      // wrote.
      if (me !== null && message.sender === me) continue
      if ((message.payload.sentAt ?? 0) <= marca) continue
      quantas += 1
      primeira ??= chaveDe(message)
    }
    return { marca, primeira, quantas }
  }, [marca, channel, messages, me])
}

/**
 * The mark of this channel: grabbed at entry, or stored if there isn't one yet.
 *
 * Zero counts as "never been here" and returns null: that's what `marcaDeEntrada`
 * stores for a channel that was never read, and a line above the very first
 * message marks nothing.
 */
function marcaDe(channel: string): number | null {
  const entrada = marcaDeEntradaDe(channel)
  if (entrada !== null) return entrada === 0 ? null : entrada
  return lerEstadoDaConta().lidas[channel] ?? null
}

/** The same key the conversation line uses, so the two agree. */
export function chaveDe(message: ChatMessage): string {
  return `${message.channel}:${message.payload.id ?? `${message.payload.t}-${message.seq}`}`
}

/** One instance only, so the caller's `useMemo` doesn't change identity. */
const NADA = { marca: null, primeira: null, quantas: 0 } as const

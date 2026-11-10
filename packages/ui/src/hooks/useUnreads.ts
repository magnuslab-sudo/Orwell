import { useCallback, useEffect, useMemo, useRef } from "react"
import type { ChatMessage } from "../types.js"
import { dirigidaAMim } from "../lib/porAtender.js"
import { marcarLido, useEstadoDaConta, type LastRead } from "../lib/estadoDaConta.js"
import { avancouOCanal, entrarNoCanal } from "../lib/porLerPorSala.js"

/**
 * Unread tracking: one timestamp per channel, against the messages in memory.
 *
 * Deliberately simple and honest. There is no server-side read receipt, the
 * server cannot know what was read, because it cannot know what was written,  * so "unread" here means: messages this device holds, from other people, newer
 * than the last time this channel was open.
 *
 * Each channel's marker lives in the account from phase 5 (`lib/estadoDaConta.ts`): the vault stores it and the account channel carries it to the other devices. Reading a channel on the phone marks it as read on the computer. It used to live in `localStorage`.
 */

export { LAST_READ_KEY, readLastRead, writeLastRead, type LastRead } from "../lib/estadoDaConta.js"

/** The moment a message claims to have happened. Sender clocks, necessarily. */
function stampOf(message: ChatMessage): number {
  return message.payload.sentAt ?? message.payload.postedAt ?? 0
}

/**
 * Each channel's marker AS IT WAS when you entered it.
 *
 * **Why this must live here, not in whoever draws the line.** This hook advances the active channel's marker, that makes the count disappear from the side, and that is correct, and it advances it the moment the channel becomes active. This happens early: the shell picks the channel while the conversation screen has not even been mounted yet. When the timeline appears and wants to know where the person left off, the stored value has already moved past it, and reading the storage from there always gave "nothing to read". That is exactly what happened, and we only saw it live.
 *
 * Here we catch the value ONE STEP BEFORE it is advanced, which is the only place where it still exists.
 *
 * A module-level `Map`, not storage: what this holds is good for THIS visit to the app and should not survive a close, whoever comes back tomorrow gets a new marker, which is the one that was truly saved.
 */
const marcaDeEntrada = new Map<string, number>()

/**
 * Where you left off in this channel, before this visit marked it as read.
 *
 * Null when this channel has not yet been activated during this visit, the caller should then fall back to the stored value, which at that point has not been touched. See `usePorLer`, which does exactly that.
 */
export function marcaDeEntradaDe(channel: string): number | null {
  return marcaDeEntrada.get(channel) ?? null
}

/** For tests only: a new visit starts with no memory of any previous visit. */
export function esquecerMarcasDeEntrada(): void {
  marcaDeEntrada.clear()
}

/** With no filter, count everything that passes the guards. */
const TODAS = (): boolean => true

/**
 * Unread chat messages per channel: not the active one, not our own, newer
 * than the channel's `lastRead`. Pure, so it can be tested as a function.
 *
 * **`conta` is what makes it possible to have two reads without having two counts.** The badges on the rail count only what was directed at this account (see `lib/porAtender.ts`), and the temptation was to add it to the sidebar. Running the filter through here makes that number, by construction, a subset of what the sidebar shows: the guards are the same, the read marker is the same, and opening the channel clears both at the same time because there were never two states.
 */
export function countUnreads(
  messages: ChatMessage[],
  lastRead: LastRead,
  active: string | null,
  me: string | null,
  conta: (message: ChatMessage) => boolean = TODAS,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const message of messages) {
    if (message.payload.t !== "message") continue
    if (message.channel === active) continue
    if (me !== null && message.sender === me) continue
    if (stampOf(message) <= (lastRead[message.channel] ?? 0)) continue
    if (!conta(message)) continue
    counts.set(message.channel, (counts.get(message.channel) ?? 0) + 1)
  }
  return counts
}

/** Reading a channel means: read up to now, or up to its newest message if a
 * sender's clock runs ahead of ours — otherwise that message never clears. */
export function markRead(lastRead: LastRead, channel: string, messages: ChatMessage[]): LastRead {
  let newest = Date.now()
  for (const message of messages) {
    if (message.channel === channel) newest = Math.max(newest, stampOf(message))
  }
  if (lastRead[channel] === newest) return lastRead
  return { ...lastRead, [channel]: newest }
}

export function useUnreads(
  messages: ChatMessage[],
  active: string | null,
  me: string | null,
  /** What is muted: there, `@all` is not directed at anyone (`dirigidaAMim`). */
  silenciados: readonly string[] = [],
): {
  counts: Map<string, number>
  total: number
  /**
   * The same counts, only for what was directed at this account.
   *
   * Comes from here and not from a hook on the side because the material is the same, the thread, the read marker, the open channel, and two sums over the same material diverge at the first change that only one of them receives. See `lib/porAtender.ts` for the rule, and `countUnreads` for the filter.
   */
  dirigidas: Map<string, number>
  /**
   * Where you left off in a channel, for whoever counts things that are not
   * messages.
   *
   * The Social badge counts wall comments, and the wall does not go through
   * `countUnreads`, comments are not `message`. It needs the marker raw, and
   * it must be THIS marker: sharing the timestamp is what makes going to Social
   * clear the number, by the same path that opening a channel clears its own.
   *
   * Absent counts as zero, like in `countUnreads`: in a channel you have never
   * visited, everything in it is new.
   */
  marcaDe: (channel: string) => number
  read: (channel: string) => void
} {
  const lastRead = useEstadoDaConta().lidas

  /**
   * A mirror of the state, so the effect can read it without depending on it.
   *
   * Putting `lastRead` in the dependencies ran the effect because of its own write; without a mirror, it read a value from an earlier render. A reference fixes both things at once.
   */
  const espelho = useRef(lastRead)
  espelho.current = lastRead
  /** The previous channel, to know when the channel CHANGES. */
  const anterior = useRef<string | null>(null)

  // Having a channel open reads it: entering it, and every message that
  // arrives while it is on screen, advance its mark.
  useEffect(() => {
    // Channel changed: save, on both sides of the change, the marker as it is RIGHT NOW, before the line below advances it.
    //
    // From the channel you are leaving, because that is where you were; from the channel you are entering, because that is where you had left off last time. This second value is what the "unread" line draws, and it is the only moment it exists.
    if (anterior.current !== active) {
      const saiu = anterior.current
      anterior.current = active
      if (saiu !== null) marcaDeEntrada.set(saiu, espelho.current[saiu] ?? 0)
      if (active !== null) {
        marcaDeEntrada.set(active, espelho.current[active] ?? 0)
        // The rooms in this channel start here. See `lib/porLerPorSala.ts`: without this, the channel marker would advance over rooms that never open.
        entrarNoCanal(active, espelho.current[active] ?? 0)
      }
    }
    if (!active) return
    const next = markRead(espelho.current, active, messages)
    if (next !== espelho.current) {
      marcarLido(active, next[active]!)
      avancouOCanal(active, next[active]!)
    }
  }, [active, messages])

  const counts = useMemo(() => countUnreads(messages, lastRead, active, me), [messages, lastRead, active, me])
  const total = useMemo(() => [...counts.values()].reduce((sum, count) => sum + count, 0), [counts])
  const dirigidas = useMemo(
    () => countUnreads(messages, lastRead, active, me, dirigidaAMim(me, silenciados)),
    [messages, lastRead, active, me, silenciados],
  )
  const marcaDe = useCallback((channel: string) => lastRead[channel] ?? 0, [lastRead])

  /**
   * Mark a channel as read without opening it.
   *
   * Same marker that opening would write, and so the same path: whoever chooses "mark as read" from the menu is saying exactly what opening and closing would say, without the work of doing it.
   */
  const read = useCallback(
    (channel: string) => {
      const next = markRead(espelho.current, channel, messages)
      if (next !== espelho.current) marcarLido(channel, next[channel]!)
    },
    [messages],
  )

  return { counts, total, dirigidas, marcaDe, read }
}

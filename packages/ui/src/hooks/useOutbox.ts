import { useCallback, useEffect, useReducer, useRef } from "react"
import type { ConnectionState, EnclaveBridge } from "../bridge.js"
import type { ChatMessage, MessageExtras } from "../types.js"
import { strings, traduzirErro } from "../strings.js"
import type { ToastLevel } from "./useToasts.js"
import { motor, type Motor } from "../sons/motor.js"

/**
 * A message of ours that has not been confirmed yet.
 *
 * Every send goes through here first, which is what makes failure survivable:
 * the text lives in this entry, not in the composer, so a rejected send is a
 * visible bubble with a retry — never a silently swallowed draft.
 */
export interface OutboxEntry {
  id: string
  channel: string
  /** The room within the channel. Empty is the default room. */
  room?: string
  body: string
  /**
   * Images and cards that go with the text.
   *
   * Stored HERE and not in the outbox for the same reason as text: a failed
   * send must stay recoverable. Without this, a photo picked, compressed, and
   * rejected by the network would vanish with nothing left to retry, and the
   * person would have to fetch it from disk again.
   */
  extras?: MessageExtras
  at: number
  /**
   * `waiting` is the message typed without connection: it lives here, visible
   * in the conversation, and leaves on its own when the connection returns. Not
   * a failure, so no red warning: the person did their part, and the network
   * is what cannot act yet.
   */
  state: "sending" | "failed" | "waiting"
}

/**
 * Core errors that mean "no path forward", not "rejected". A message hitting
 * one of these waits for connection with no warning.
 */
export const SEM_LIGACAO: ReadonlySet<string> = new Set([
  "no connection to the server",
  "the connection dropped",
  "could not reach the homeserver",
  "the connection was replaced",
])

/**
 * We have messages that have not yet left and closing the page loses them:
 * those waiting for connection and those sending. Failed ones don't count
 * because the person already saw them fail and chose to leave them.
 */
export function haPorSair(entries: readonly OutboxEntry[]): boolean {
  return entries.some((entry) => entry.state !== "failed")
}

export type OutboxAction =
  | { type: "add"; entry: OutboxEntry }
  | { type: "remove"; id: string }
  | { type: "failed"; id: string }
  | { type: "sending"; id: string }
  | { type: "waiting"; id: string }
  | { type: "delivered"; channel: string; body: string }

export function outboxReducer(state: OutboxEntry[], action: OutboxAction): OutboxEntry[] {
  switch (action.type) {
    case "add":
      return [...state, action.entry]
    case "remove":
      return state.filter((entry) => entry.id !== action.id)
    case "failed":
      return state.map((entry) => (entry.id === action.id ? { ...entry, state: "failed" as const } : entry))
    case "sending":
      return state.map((entry) => (entry.id === action.id ? { ...entry, state: "sending" as const } : entry))
    case "waiting":
      return state.map((entry) => (entry.id === action.id ? { ...entry, state: "waiting" as const } : entry))
    case "delivered": {
      /**
       * The session emitted one of our own messages. Its payload id is a UUID
       * the bridge minted after the outbox entry was created, so there is no
       * shared id to correlate on. Dedup is pragmatic instead: drop the oldest
       * entry still "sending" with the same channel and body — entries are
       * appended in send order, so the first match is the oldest.
       */
      const match = state.find(
        (entry) => entry.state === "sending" && entry.channel === action.channel && entry.body === action.body,
      )
      if (!match) return state
      return state.filter((entry) => entry.id !== match.id)
    }
  }
}

/**
 * The outbox: our sends, tracked from submit until the session confirms them.
 *
 * Flow: `send` adds a "sending" entry synchronously, then calls the bridge.
 * The session emits the own message (which the shell appends to the timeline)
 * before the promise resolves, and `noteOwnMessage` removes the entry then;
 * the `.then` removal is a harmless second pass. A rejection marks the entry
 * "failed" and raises an error toast, retrying is safe, because a retry is a
 * brand-new encryption, never a nonce reuse.
 *
 * Without connection, the message never reaches the bridge: it enters as
 * `waiting` and leaves when connection returns, in the order it was typed. A
 * send that fails because the connection dropped mid-send goes back to
 * `waiting`, not `failed`: nobody rejected it, there was just no path forward.
 *
 * **Send sound** (owner request, November 3, 2026). Plays once, when the bridge
 * confirms a message that just left the outbox: only in the `.then` of a
 * `send`, never before or on error. A message with attachments is one send and
 * makes one sound. Does not play on "Retry" or on messages that were waiting
 * for connection: they leave on their own, sometimes many at once, and the
 * person is no longer looking at the outbox. The engine handles the rest:
 * the master switch, the "sent" type switch, volume, "Busy" and delay.
 */
export function useOutbox(
  bridge: EnclaveBridge,
  connection: ConnectionState,
  notify: (detail: string, level?: ToastLevel) => void,
  /** Who plays the send sound. Tests pass their own. */
  motorDoSom: Pick<Motor, "tocar"> = motor,
): {
  entries: OutboxEntry[]
  send: (channel: string, body: string, room?: string, extras?: MessageExtras) => void
  retry: (id: string) => void
  discard: (id: string) => void
  noteOwnMessage: (message: ChatMessage) => void
} {
  const [entries, dispatch] = useReducer(outboxReducer, [])

  // Mirrored into a ref so callbacks registered once (session events, the
  // reconnect effect) always see the current list.
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const connectionRef = useRef(connection)
  connectionRef.current = connection

  const deliver = useCallback(
    (entry: OutboxEntry, daCaixa = false) => {
      void bridge.channels
        .send(entry.channel, entry.body, entry.room, entry.extras)
        .then(() => {
          dispatch({ type: "remove", id: entry.id })
          if (daCaixa) motorDoSom.tocar({ tipo: "enviada" })
        })
        .catch((error: Error) => {
          // By the error, not just the state: the `.catch` runs before the render that
          // changes `connectionRef`, and a drop mid-send would land on `failed` with a
          // red warning.
          if (connectionRef.current !== "online" || SEM_LIGACAO.has(error.message)) {
            dispatch({ type: "waiting", id: entry.id })
            return
          }
          dispatch({ type: "failed", id: entry.id })
          notify(traduzirErro(error), "error")
        })
    },
    [bridge, notify, motorDoSom],
  )

  const send = useCallback(
    (channel: string, body: string, room?: string, extras?: MessageExtras) => {
      const entry: OutboxEntry = {
        id: crypto.randomUUID(),
        channel,
        body,
        ...(room ? { room } : {}),
        ...(extras ? { extras } : {}),
        at: Date.now(),
        state: connectionRef.current === "online" ? "sending" : "waiting",
      }
      // Writer stopped: no wait holds. See the effect below.
      if (bridge.session?.escreve?.() === false) entry.state = "failed"
      dispatch({ type: "add", entry })
      if (entry.state === "sending") deliver(entry, true)
    },
    [deliver, bridge],
  )

  const retry = useCallback(
    (id: string) => {
      const entry = entriesRef.current.find((candidate) => candidate.id === id)
      if (!entry || entry.state !== "failed") return
      dispatch({ type: "sending", id })
      deliver(entry)
    },
    [deliver],
  )

  const discard = useCallback((id: string) => dispatch({ type: "remove", id }), [])

  /**
   * Own messages are the ones the session emits with `seq: -1` — they never
   * round-trip through MLS, so that sentinel is reliable and needs no address.
   */
  const noteOwnMessage = useCallback((message: ChatMessage) => {
    if (message.seq !== -1 || message.payload.t !== "message") return
    dispatch({ type: "delivered", channel: message.channel, body: message.payload.body ?? "" })
  }, [])

  // Coming back online, every failed entry gets one automatic retry. Once per
  // transition: if it fails again it goes back to "failed" with its toast and
  // waits for a human or the next reconnect. Those waiting for connection leave
  // now, in the order they were typed.
  const previousConnection = useRef(connection)
  useEffect(() => {
    const was = previousConnection.current
    previousConnection.current = connection
    if (connection !== "online" || was === "online") return
    for (const entry of entriesRef.current) {
      if (entry.state === "failed") retry(entry.id)
      else if (entry.state === "waiting") {
        dispatch({ type: "sending", id: entry.id })
        deliver(entry)
      }
    }
  }, [connection, retry, deliver])

  /*
    A writer that stopped writing (new version, or another writer got the
    vault) will never send what is waiting: say so, instead of leaving the
    "waiting for connection" mark promising a send that will not come. Read
    on each connection and list change, because the bridge does not notify:
    stopping writing closes the session, and that change brings this back.
  */
  const parada = (): boolean => bridge.session?.escreve?.() === false
  useEffect(() => {
    if (!parada()) return
    const presas = entries.filter((entry) => entry.state === "waiting")
    if (presas.length === 0) return
    for (const entry of presas) dispatch({ type: "failed", id: entry.id })
    notify(strings.connection.separadorParado, "error")
  }, [connection, entries, bridge, notify])

  /*
    The outbox lives in memory only. Closing the tab with a waiting message
    lost it with no warning, and whoever typed on the train thought it was
    saved. The browser asks before closing; that is its choice, not ours.

    Never on a stopped tab: there nobody can save anything, and the reload
    the app itself requests (new version, ownership transferred) would pop
    "Leave site?" on top. Handled at event time, not state, because the
    `reload()` comes right after stopping, with no render in between.
  */
  const porSair = haPorSair(entries) && !parada()
  useEffect(() => {
    if (!porSair) return
    const aoSair = (event: BeforeUnloadEvent): void => {
      if (bridge.session?.escreve?.() === false) return
      event.preventDefault()
    }
    window.addEventListener("beforeunload", aoSair)
    return () => window.removeEventListener("beforeunload", aoSair)
  }, [porSair])

  return { entries, send, retry, discard, noteOwnMessage }
}

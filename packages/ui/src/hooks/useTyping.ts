import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { TYPING_TTL_MS } from "@enclave/protocol"
import type { ConnectionState, EnclaveBridge } from "../bridge.js"

/**
 * Who is typing, while they type.
 *
 * Three choices, each one exists to prevent a concrete bug.
 *
 * **Never stored.** A typing signal is not something that was said. If it went
 * into history like the others, it would take up slots in the 400 each channel
 * has and push real messages out of the vault. So it travels like voice
 * signaling, its own event, cut from the session before it touches disk or
 * the message thread.
 *
 * **Never one event per key.** One encrypted message per keystroke is a flood,
 * and the server, which reads none of what goes there, would see the exact
 * rhythm of typing: pauses, hesitations, speed. That is a behavioral profile
 * handed free to someone who should have none. A periodic signal with a cap
 * that silences it gives the same result without giving the profile.
 *
 * **Dies on its own.** Someone who closes the laptop mid-sentence never sends
 * a "stop". If the end depended on a second message, that person would stay
 * typing forever on everyone else's screen. The signal carries a deadline and
 * whoever sees it lets it expire, without waiting for anything from anyone.
 */

/**
 * The deadline comes from the protocol, where both hosts fetch it to write the
 * `until` field. Reexported for those who only talk to the interface.
 */
export { TYPING_TTL_MS }

/**
 * How long between signals, from the typing side.
 *
 * Four seconds. A typical sentence takes two to eight seconds to type, so most
 * messages produce one signal, two when they are long. At keystroke rate it
 * would be five to ten per second: three orders of magnitude more traffic, and
 * a clock of typing speed handed to the server. The two-second buffer before
 * the deadline is the network margin.
 */
export const TYPING_INTERVAL_MS = 4_000

/**
 * How long a typing burst can keep signaling.
 *
 * Twenty seconds, five signals maximum. After that it goes silent until the
 * sentence is sent or the box empties. Without this cap, a compose box left
 * open with half a sentence in it would emit a signal every four seconds all
 * afternoon: it would stop being "typing" and become a presence beacon, which
 * is precisely what this product does not publish.
 */
export const TYPING_BURST_MS = 20_000

/** How often to sweep for what has expired. */
const VARRIMENTO_MS = 1_000

interface Sinal {
  channel: string
  room: string
  from: string
  until: number
}

function chaveDe(sinal: { channel: string; room: string; from: string }): string {
  // Null byte as separator: it cannot appear in an address or room name, so two
  // different keys never collide in one.
  return [sinal.channel, sinal.room, sinal.from].join("\u0000")
}

export interface Typing {
  /** Who is typing, right now, not counting us. */
  typists: string[]
  /**
   * A key was pressed. Call freely, the cadence is decided here inside, and
   * the vast majority of calls send nothing.
   */
  noteTyping: () => void
  /**
   * The sentence ended (sent, or deleted).
   *
   * Sends nothing: there is no stop message, on purpose, the deadline handles
   * that on the viewing side. What this does is reopen the burst, so the next
   * sentence signals right away instead of waiting for the interval.
   */
  stopTyping: () => void
}

/**
 * The indicator, from both ends: what we receive and what we send.
 *
 * One hook only because they are the same feature and share the same numbers,  * splitting them was a guarantee that one day the deadline and interval would
 * stop lining up and nobody would understand why the indicator was blinking.
 */
export function useTyping(
  bridge: EnclaveBridge,
  channel: string | null,
  room: string,
  me: string | null,
  /** No connection means no encryption and no typing signal. Connected by default. */
  connection: ConnectionState = "online",
): Typing {
  const [sinais, setSinais] = useState<ReadonlyMap<string, Sinal>>(() => new Map())

  /**
   * Who we are, read at event time.
   *
   * The subscription registers once and the address is not yet known at that
   * time, capturing it would close the handler over `null` forever, and our
   * own signal (if it ever came back) would look like a stranger's.
   */
  const euRef = useRef(me)
  euRef.current = me

  useEffect(() => {
    return bridge.on.typing((event) => {
      if (event.from === euRef.current) return
      // A signal that was born expired, timer mismatch on the other end, is not
      // worth keeping: it would be swept on the first cycle anyway.
      if (event.until <= Date.now()) return
      setSinais((atual) => {
        const proximo = new Map(atual)
        proximo.set(chaveDe(event), event)
        return proximo
      })
    })
    // Subscribed once, like all the app's other subscriptions.
  }, [])

  /**
   * Sweep what has expired.
   *
   * Only runs while someone is typing: a permanent timer would wake the app
   * every second forever to do nothing. Returning the map unchanged when nothing
   * changed avoids a pointless render.
   */
  useEffect(() => {
    if (sinais.size === 0) return
    const relogio = setInterval(() => {
      const agora = Date.now()
      setSinais((atual) => {
        const vivos = [...atual].filter(([, sinal]) => sinal.until > agora)
        return vivos.length === atual.size ? atual : new Map(vivos)
      })
    }, VARRIMENTO_MS)
    return () => clearInterval(relogio)
  }, [sinais.size])

  const typists = useMemo(() => {
    if (!channel) return []
    const agora = Date.now()
    return [...sinais.values()]
      .filter((sinal) => sinal.channel === channel && sinal.room === room && sinal.until > agora)
      .map((sinal) => sinal.from)
  }, [sinais, channel, room])

  // ------------------------------------------------------------- a enviar

  /** When the last signal left, and when this burst began. */
  const ultimoEnvio = useRef(0)
  const inicioDaRajada = useRef(0)

  const stopTyping = useCallback(() => {
    ultimoEnvio.current = 0
    inicioDaRajada.current = 0
  }, [])

  // Switching channels or rooms closes the previous burst: a phrase started elsewhere is not the same phrase, and inheriting its limit would silence this one for no reason.
  useEffect(() => stopTyping(), [channel, room, stopTyping])

  const noteTyping = useCallback(() => {
    if (!channel) return
    // A signal that cannot be sent is worth neither the cipher nor the error, and the box is no longer cleared offline (see `Composer`): the guard now lives here.
    if (connection !== "online") return
    const agora = Date.now()
    if (inicioDaRajada.current === 0) inicioDaRajada.current = agora
    if (agora - inicioDaRajada.current > TYPING_BURST_MS) return
    if (agora - ultimoEnvio.current < TYPING_INTERVAL_MS) return
    ultimoEnvio.current = agora
    // A lost signal is not an error to show anyone: the phrase that matters goes another way, and the indicator clears itself.
    void bridge.channels.typing(channel, room || undefined).catch(() => undefined)
  }, [bridge, channel, room, connection])

  return { typists, noteTyping, stopTyping }
}

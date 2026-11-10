import { useCallback, useEffect, useRef, useState } from "react"
import type { EnclaveBridge, PinnedMessage } from "../bridge.js"
import type { ChatMessage } from "../types.js"

/**
 * What is pinned in the open room.
 *
 * **Comes whole from the core, not recalculated here.** That is the difference
 * between this hook and `useRooms`, which reads `channel.meta` from messages in
 * memory to avoid waiting on storage. Here that would be an error with
 * consequences: the pinned list has an authority guard, only the one with the
 * `pin` responsibility counts, and redoing the read on this side would write a
 * second version of that rule in a place where we do not know the sender's
 * roles. A second rule about permissions is one rule too many.
 *
 * What avoids rereading in memory is the core answering already with what just
 * arrived: `pinnedOf` reads the vault AND what waits to be stored. So it is
 * enough to ask again when a `channel.meta` arrives, which is what this hook
 * does, and why it depends on messages without reading them.
 */
export function usePins(
  bridge: EnclaveBridge,
  channel: string | null,
  room: string,
  messages: ChatMessage[],
): { pins: PinnedMessage[]; refresh: () => void } {
  const [pins, setPins] = useState<PinnedMessage[]>([])

  // The bridge by reference, never by dependency. See the note in
  // `useSpaceMeta`: a host that recreates it each render puts this in an endless
  // loop.
  const ponte = useRef(bridge)
  ponte.current = bridge

  /**
   * How many `channel.meta` from this channel have passed through here.
   *
   * It is the trigger, and it is only a number: the content does not matter,    * the core reads it. Counting instead of comparing lists keeps this hook out
   * of the business of deciding what a pin is.
   */
  const carimbo = messages.reduce(
    (conta, message) => (message.channel === channel && message.payload.t === "channel.meta" ? conta + 1 : conta),
    0,
  )

  const refresh = useCallback(() => {
    const lidas = channel ? (ponte.current.channels.pins?.(channel, room) ?? []) : []
    // Only replace when it actually changed: a `setState` with the same content
    // triggers a render anyway, and the top banner flickers for no reason.
    setPins((actual) => (mesmasFixadas(actual, lidas) ? actual : lidas))
  }, [channel, room])

  useEffect(refresh, [refresh, carimbo])

  return { pins, refresh }
}

/** Do two pinned lists say the same thing? By identifier and order. */
function mesmasFixadas(a: readonly PinnedMessage[], b: readonly PinnedMessage[]): boolean {
  return a.length === b.length && a.every((fixada, indice) => fixada.id === b[indice]?.id)
}

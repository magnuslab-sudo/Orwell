import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { EnclaveBridge } from "../bridge.js"
import type { ChatMessage } from "../types.js"

/** The separator key for the channel list: NUL, which no address has. */
const SEPARADOR = "\u0000"

/** How a channel presents itself. */
export interface SpaceMeta {
  name: string
  topic?: string
  icon?: string
  updatedAt?: number
}

/**
 * The name, description, and icon of each channel.
 *
 * Two sources, and both are accurate. The vault knows ALL channels and responds
 * right away, it puts the right name in the sidebar before the connection even
 * opens. Messages in memory know only the open channel, but know it better: a
 * change made now appears without waiting for save.
 *
 * The rule between the two is the same one the vault applies to members: the
 * newer timestamp wins. This is the same design as `useDirectory`, and on
 * purpose, anyone who can read one can read the other.
 *
 * What this does NOT solve, and cannot: who writes. The subject of a profile is
 * the sender, so no one publishes for others; the subject of this is the
 * channel, and today any member writes. It becomes a matter of roles.
 */
export function useSpaceMeta(
  bridge: EnclaveBridge,
  channels: string[],
  messages: ChatMessage[],
): {
  spaceMeta: Map<string, SpaceMeta>
  /** Reread from the vault. Call after publishing, or when switching channels. */
  refresh: () => void
} {
  const [doCofre, setDoCofre] = useState<Map<string, SpaceMeta>>(new Map())
  /*
    The key joins channels by a character that an address does not have (NUL),
    and splits by the SAME. It used to split by a space: with two channels or
    more, the split list was a single nonexistent address, and no names came
    from the vault. Names only appeared when a `space.meta` went live, and after
    reloading you saw the address (seen 3/11/2026 in the portrait script, phase 1
    of 1.1).
    */
  const chave = channels.join(SEPARADOR)

  /**
   * The bridge is read by reference, not by dependency.
   *
   * A host that recreates it on every render, and React does not promise
   * otherwise, would make the effect below run, change the state, and run
   * again, forever. It took a stop for lack of memory to discover, in a test
   * that only built the bridge honestly.
   */
  const ponte = useRef(bridge)
  ponte.current = bridge

  const refresh = useCallback(() => {
    const mapa = new Map<string, SpaceMeta>()
    for (const channel of chave ? chave.split(SEPARADOR) : []) {
      const meta = ponte.current.channels.meta?.(channel)
      if (meta) mapa.set(channel, meta)
    }
    // Only replace when it actually changed. A `setState` with equal content
    // causes a render anyway, and it is the second brake against the loop.
    setDoCofre((actual) => (mesmoConteudo(actual, mapa) ? actual : mapa))
  }, [chave])

  useEffect(refresh, [refresh])

  const spaceMeta = useMemo(() => {
    const mapa = new Map(doCofre)
    for (const message of messages) {
      if (message.payload.t !== "space.meta") continue
      const bruto = message.payload as { name?: unknown; topic?: unknown; icon?: { inline?: unknown }; updatedAt?: unknown }
      if (typeof bruto.name !== "string") continue
      const at = typeof bruto.updatedAt === "number" ? bruto.updatedAt : 0
      const conhecido = mapa.get(message.channel)
      if (conhecido && (conhecido.updatedAt ?? 0) > at) continue
      mapa.set(message.channel, {
        name: bruto.name,
        ...(typeof bruto.topic === "string" ? { topic: bruto.topic } : {}),
        ...(typeof bruto.icon?.inline === "string" ? { icon: bruto.icon.inline } : {}),
        updatedAt: at,
      })
    }
    return mapa
  }, [doCofre, messages])

  return { spaceMeta, refresh }
}

/** Two view maps with the same content? See `refresh`. */
function mesmoConteudo(a: Map<string, SpaceMeta>, b: Map<string, SpaceMeta>): boolean {
  if (a.size !== b.size) return false
  for (const [channel, meta] of a) {
    const outro = b.get(channel)
    if (!outro || outro.name !== meta.name || outro.topic !== meta.topic || outro.icon !== meta.icon) return false
  }
  return true
}

import { useEffect, useState } from "react"
import type { EnclaveBridge } from "../bridge.js"
import { isDirect, isFeed } from "../lib/format.js"

/** Cap on friends to fetch the list for. More than this is wasted work for a filter. */
const AMIGOS_MAX = 200

/**
 * Who the interface knows as "friend of a friend", for the friend request rule
 * (`lib/privacidade.ts`, `pedidoCabe`).
 *
 * Two sides, the only ones the interface can read:
 *  - anyone who shares a group channel with us (members of each channel that is
 *    neither a direct conversation nor a feed);
 *  - anyone in the list that a friend of ours shows (`shownFriendsOf`).
 *
 * Only runs with the "Friends of friends" rule picked (`activo`): the other
 * two rules need no one else, and fetching members from all channels at each
 * startup would be pointless work. Null until first read.
 */
export function useConhecidos(
  bridge: EnclaveBridge,
  canais: readonly string[],
  amigos: readonly string[],
  activo: boolean,
): ReadonlySet<string> | null {
  const [conhecidos, setConhecidos] = useState<ReadonlySet<string> | null>(null)
  // Lists as the key: the effect only reruns when they actually change.
  const chaveDosCanais = canais.filter((canal) => !isDirect(canal) && !isFeed(canal)).join("\n")
  const chaveDosAmigos = amigos.slice(0, AMIGOS_MAX).join("\n")

  useEffect(() => {
    if (!activo) {
      setConhecidos(null)
      return
    }
    let vivo = true
    const deGrupo = chaveDosCanais ? chaveDosCanais.split("\n") : []
    const deAmigos = chaveDosAmigos ? chaveDosAmigos.split("\n") : []
    const ler = bridge.social.shownFriendsOf
    void Promise.all([
      ...deGrupo.map((canal) => bridge.channels.members(canal).catch(() => [] as string[])),
      ...deAmigos.map((amigo) =>
        ler
          ? ler(amigo)
              .then((mostrada) => mostrada?.shown ?? [])
              .catch(() => [] as string[])
          : Promise.resolve([] as string[]),
      ),
    ]).then((listas) => {
      if (vivo) setConhecidos(new Set(listas.flat()))
    })
    return () => {
      vivo = false
    }
  }, [bridge, chaveDosCanais, chaveDosAmigos, activo])

  return conhecidos
}

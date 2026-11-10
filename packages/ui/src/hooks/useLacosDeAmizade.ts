import { useEffect, useState } from "react"
import type { FriendTie } from "@enclave/protocol"
import type { EnclaveBridge } from "../bridge.js"
import { friendshipsDe, type Friendships } from "../lib/friendship.js"

const NENHUNS = friendshipsDe([])

/**
 * The friendship bonds from the vault, for the screens: read once when the
 * session is ready, then on each `on.amizades` event.
 *
 * One layer only, the vault's (phase 1d). The badge, Friends, Pending and the
 * direct message bar all read from here, so they never show a "pending" request
 * next to an "accepted" one.
 */
export function useLacosDeAmizade(bridge: EnclaveBridge, pronto: boolean): Friendships {
  const [friendships, setFriendships] = useState<Friendships>(NENHUNS)

  useEffect(() => {
    if (!pronto) return
    let vivo = true
    // An event that arrives during the first read is newer than it: the read,
    // when it returns, won't apply.
    let eventos = 0
    const aplicar = (lista: readonly FriendTie[]): void => {
      if (vivo) setFriendships(friendshipsDe(lista))
    }
    const desligar = bridge.on.amizades?.(({ ties }) => {
      eventos += 1
      aplicar(ties)
    })
    // A read that fails (vault still opening) retries in 3 s, up to five times,
    // like the blocked list in `useAmizade`. Without this, a failure at startup
    // left the badge and Friends empty until the next event.
    let temporizador: ReturnType<typeof setTimeout> | null = null
    const ler = (tentativa: number): void => {
      const lidosAntes = eventos
      void bridge.social.friendTies?.()
        .then((ties) => {
          if (eventos === lidosAntes) aplicar(ties)
        })
        .catch(() => {
          if (vivo && tentativa < 5) temporizador = setTimeout(() => ler(tentativa + 1), 3000)
        })
    }
    ler(0)
    return () => {
      vivo = false
      if (temporizador) clearTimeout(temporizador)
      desligar?.()
    }
  }, [bridge, pronto])

  return friendships
}

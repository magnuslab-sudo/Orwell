import { foldFriendTies, isFriendPayload, type FriendEvent, type FriendTie } from "@enclave/protocol"
import type { EnclaveBridge } from "../bridge.js"
import { dmPeerAddress } from "../lib/format.js"

/**
 * The role of the core in test bridges: fold friendships.
 *
 * Since phase 1d the UI does not fold friendship events; it reads ties from
 * `social.friendTies` and `on.amizades`. Test bridges emit events through
 * `on.message`, as the core delivers them, and this wrapper does what the core
 * does next: stores them in order, folds them with the same protocol function
 * and alerts through `on.amizades`. Without it, each test bridge would have to
 * write the fold again.
 */
export function comLacosDoNucleo(bridge: EnclaveBridge, me: string): EnclaveBridge {
  const eventos: FriendEvent[] = []
  const ouvintes = new Set<(evento: { ties: FriendTie[] }) => void>()
  const lacos = (): FriendTie[] => [...foldFriendTies(eventos, me, (channel) => dmPeerAddress(channel, me)).values()]
  const ouvirMensagens = bridge.on.message
  return {
    ...bridge,
    social: { ...bridge.social, friendTies: async () => lacos() },
    on: {
      ...bridge.on,
      message: (handler) =>
        ouvirMensagens((message) => {
          handler(message)
          const lida = message as { channel?: string; sender?: string; payload?: { t?: unknown } }
          if (typeof lida.channel !== "string" || typeof lida.sender !== "string") return
          if (typeof lida.payload?.t !== "string" || !isFriendPayload({ t: lida.payload.t })) return
          eventos.push({ channel: lida.channel, sender: lida.sender, payload: lida.payload as FriendEvent["payload"] })
          const ties = lacos()
          for (const ouvinte of ouvintes) ouvinte({ ties })
        }),
      amizades: (handler) => {
        ouvintes.add(handler)
        return () => {
          ouvintes.delete(handler)
        }
      },
    },
  }
}

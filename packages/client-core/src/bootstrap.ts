/**
 * A one-shot bootstrap for a small group of founding accounts on a server.
 *
 * The people in a group already agreed to be friends. Each client seats the
 * others in its own feed once, records that it did, and never does it again.
 *
 * This is deliberately NOT a product feature and deliberately NOT a server
 * mode: no account list is exposed, no posture changes. Every later member
 * uses the ordinary manual path.
 *
 * Empty in this repository: the founding accounts on orwell.pt are already
 * seated, and their addresses are not published. Keys are server names,
 * values are full account addresses.
 */
export const BOOTSTRAP_PEERS: Record<string, string[]> = {}

/** The peers this account should seat, or none when it is not one of them. */
export function bootstrapPeersFor(address: string): string[] {
  const server = address.slice(address.indexOf(":") + 1)
  const group = BOOTSTRAP_PEERS[server] ?? []
  return group.includes(address) ? group.filter((peer) => peer !== address) : []
}

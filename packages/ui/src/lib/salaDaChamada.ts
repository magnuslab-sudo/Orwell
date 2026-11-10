import { presencasVivas } from "./presenca.js"

/**
 * The key of a voice room: channel and room, with a separator that appears in
 * neither. Two voice rooms are two calls.
 *
 * Lives here, not in the shell, so whoever writes the key and whoever reads it use
 * literally the same function. Two copies of the same separator is one copy too many.
 */
export function chaveDaSala(channel: string, room: string): string {
  return `${channel}\u0000${room}`
}

/**
 * What voice room in a channel is running a call.
 *
 * Exists because of a bug with a concrete symptom: the "X is on a call" banner
 * had a button that entered the CHANNEL, not the ROOM. Whoever tapped fell into a
 * parallel, empty call while others kept talking in the voice room. From outside
 * it looked like the app created two rooms: one in the list, one on top.
 *
 * @returns the room, `""` when the call is from the channel (direct chat, no
 * rooms), and `null` when there is no call.
 */
export function salaDaChamadaDe(
  channel: string | null,
  ehDirecta: boolean,
  ringing: ReadonlyMap<string, Map<string, number>>,
  vozPorSala: ReadonlyMap<string, Map<string, number>>,
  agora: number,
): string | null {
  if (!channel) return null
  // In a direct chat there are no rooms to search: either there is a call or there is not.
  if (ehDirecta) return (ringing.get(channel)?.size ?? 0) > 0 ? "" : null

  const prefixo = chaveDaSala(channel, "")
  for (const [chave, quem] of vozPorSala) {
    if (!chave.startsWith(prefixo)) continue
    // Stale presences do not count: they would send someone into a room that already
    // emptied, the same loneliness by another road.
    if (presencasVivas(quem, agora).size > 0) return chave.slice(prefixo.length)
  }
  return null
}

/**
 * The voice room of a channel where there is a call, only when there is one and
 * not more.
 *
 * The strict sister of the one above, and the difference is the whole reason to
 * exist: that one returns the FIRST it finds, because whoever calls it knows they
 * want to enter a call and any room beats the channel. This answers a navigation
 * question: "take me to the room". With two calls running in the same channel
 * there is no "the room": picking one would be picking for the reader.
 *
 * Read from outside the open channel, for the line of any channel in the sidebar.
 *
 * @returns the room, or `null` when there is no call or there is more than one.
 */
export function salaUnicaDaChamadaDe(
  channel: string,
  vozPorSala: ReadonlyMap<string, Map<string, number>>,
  agora: number,
): string | null {
  const prefixo = chaveDaSala(channel, "")
  let achada: string | null = null
  for (const [chave, quem] of vozPorSala) {
    if (!chave.startsWith(prefixo)) continue
    if (presencasVivas(quem, agora).size === 0) continue
    if (achada !== null) return null
    achada = chave.slice(prefixo.length)
  }
  return achada
}

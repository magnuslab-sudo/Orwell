import { entryMediaBytes } from "@enclave/client-core"
import type { ChatMessage } from "../types.js"

/**
 * The same message arriving again live: same channel, same author, same type, same `id`.
 * It is the vault key (`chaveDoEvento`).
 *
 * Happens in a community. A report (S4) arrives before the server event, and the session
 * shows both copies to the interface: first the report, which goes without media bytes
 * on purpose (no card thumbnails and attachments as placeholders), then the server one,
 * with everything. Merging both would show the message twice, one without the video
 * thumbnail, with the same React `key` (report from owner with 1.1.0, "app still has no
 * YouTube thumbnails in communities").
 *
 * Becomes one line, at the spot of the first. Uses the payload with more media bytes;
 * in a tie, what was already there (and the list stays the same). Returns `null` if the
 * message is new: the caller adds it as usual.
 */
export function juntarCopiaAoVivo(current: ChatMessage[], message: ChatMessage): ChatMessage[] | null {
  const id = message.payload.id
  if (typeof id !== "string" || id === "") return null
  const indice = current.findIndex(
    (item) =>
      item.channel === message.channel &&
      item.sender === message.sender &&
      item.payload.t === message.payload.t &&
      item.payload.id === id,
  )
  if (indice < 0) return null
  const guardada = current[indice]!
  // Same list: React does not redraw anything.
  if (bytesDeMedia(message) <= bytesDeMedia(guardada)) return current
  const proxima = [...current]
  proxima[indice] = { ...guardada, seq: message.seq >= 0 ? message.seq : guardada.seq, payload: message.payload }
  return proxima
}

function bytesDeMedia(message: ChatMessage): number {
  return entryMediaBytes({ seq: message.seq, sender: message.sender, at: 0, payload: message.payload as never })
}

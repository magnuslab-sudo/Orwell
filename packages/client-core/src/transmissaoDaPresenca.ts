/**
 * What a person transmits in a voice room, read from the presence announcement
 * (phase 1i, 28/10/2026).
 *
 * The transmission signal (screen, music, both) appeared only in the room we
 * are in, because it comes from media connections there. In other rooms, the
 * sidebar only has the `voice.join` of who is there. That announcement already
 * says both things: `screen: true` while screen sharing is active, and `aTocar`
 * (the name) while music plays. No new field is needed, which only a new client
 * would send: we read what today's clients already send, and an old client that
 * says nothing reads as "not transmitting".
 */
export type Transmissao = "ecra" | "musica" | "ecra+musica"

export function transmissaoDoAnuncio(payload: { t: string } & Record<string, unknown>): Transmissao | undefined {
  if (payload.t !== "voice.join") return undefined
  const ecra = payload["screen"] === true
  const musica = typeof payload["aTocar"] === "string" && payload["aTocar"] !== ""
  if (ecra && musica) return "ecra+musica"
  if (ecra) return "ecra"
  if (musica) return "musica"
  return undefined
}

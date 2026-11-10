/**
 * What is muted, and what that silences (request from the owner 27 October
 * 2026: "any user should be able to mute these notifications").
 *
 * **The keys.** An entire channel, or a direct conversation, is the channel address
 * (`!lagar:casa.pt`). A room is `canal/sala` (`!lagar:casa.pt/vinha`; the default room is
 * `!lagar:casa.pt/`). A channel address has no `/`, so the two forms never mix.
 *
 * **What it silences:** the sound, the system alert, the count in the sidebar, and
 * the count in the row. The row fades, with a crossed-out bell.
 *
 * **What it does not silence:** the mention. As in Discord, being named is being
 * called, and a mention that silence swallows is not a mention. In a muted place,
 * the count that remains is the mention count.
 *
 * Stored in `Prefs.silenciados` (`hooks/usePrefs.ts`), and goes to other devices
 * with other preferences through the account channel (`lib/preferenciasDaConta.ts`, key `interface.silenciados`).
 */

/** Cap on what we store: no one tells this list that a channel left. */
export const SILENCIADOS_MAX = 200

export function chaveDoSilencio(canal: string, sala?: string): string {
  return sala === undefined ? canal : `${canal}/${sala}`
}

/** The whole channel is muted, or this room in it. */
export function estaSilenciado(silenciados: readonly string[], canal: string, sala?: string): boolean {
  if (silenciados.includes(canal)) return true
  return sala !== undefined && silenciados.includes(chaveDoSilencio(canal, sala))
}

/** Mute what is not, and the other way. Return a new list. */
export function alternarSilencio(silenciados: readonly string[], chave: string): string[] {
  return silenciados.includes(chave)
    ? silenciados.filter((outra) => outra !== chave)
    : [...silenciados, chave].slice(-SILENCIADOS_MAX)
}

/**
 * Tolerant read of any value (from disk or account): only text starting with `!`
 * (a channel), short, no duplicates, capped. Everything else is garbage.
 */
export function lerSilenciados(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []
  const vistos = new Set<string>()
  for (const chave of valor) {
    if (typeof chave === "string" && chave.startsWith("!") && chave.length <= 512) vistos.add(chave)
  }
  return [...vistos].slice(-SILENCIADOS_MAX)
}

/**
 * The number a place puts on screen: everything, or just mentions if muted.
 */
export function numeroVisivel(conta: { todas: number; mencoes: number }, silenciado: boolean): number {
  return silenciado ? conta.mencoes : conta.todas
}

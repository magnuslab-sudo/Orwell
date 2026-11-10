import { venceCarimbo } from "./dobras.js"
import type { VaultContents } from "./vault.js"

/**
 * Nicknames per channel (phase 3 of 0.9).
 *
 * A nickname is the name someone has in ONE channel, shown before the account
 * name. Changed by that person or by anyone with `moderar`, and travels as a
 * field in a message (`apelido` in `message`, in the protocol).
 *
 * **Why a separate record, not just the history.** The message that changes the
 * nickname is a conversation, and conversation is capped (400 per channel): in a
 * busy channel, the nickname left the vault in days. The record holds the latest
 * nickname for each person in each channel, like the vault already holds rooms
 * and roles, and does not depend on the cap.
 *
 * **Why it lives here and not in `vault.ts`.** The vault field is declared in
 * this file, by type extension. The vault stores what it is given (`#adopt`
 * spreads what it read), so an old vault opens without it and a vault with it
 * opens in a version that does not know it.
 *
 * **Judged at write.** The caller of `registarApelido` already decided whether
 * the sender could (themselves, or with `moderar`). Judging at read, with
 * current roles, would let a badly placed nickname erase the good one stored
 * before.
 *
 * The stated limit: someone joining the channel later does not receive messages
 * from before (forward secrecy), so they do not see nicknames placed before they
 * joined.
 */

/** The write cap for a nickname. Read accepts 64 (see the protocol). */
export const APELIDO_MAX = 32

export interface RegistoDeApelido {
  /** The nickname. Empty means "no nickname", and is not shown. */
  valor: string
  /** The clock of whoever set it. */
  at: number
  /** Server order, to break ties on equal timestamps. */
  seq: number
  /** Who set it: the person themselves, or someone with moderation rights. */
  por: string
}

/** The field this module adds to the vault. */
interface ComApelidos {
  apelidosDoCanal?: Record<string, Record<string, RegistoDeApelido>>
}

function registo(contents: VaultContents): ComApelidos {
  return contents as VaultContents & ComApelidos
}

/** The nickname a message carries, already trimmed. The vault stores raw payloads. */
export function apelidoDaMensagem(payload: unknown): { subject: string; nick: string; at: number } | null {
  if (!payload || typeof payload !== "object") return null
  const { t, apelido } = payload as { t?: unknown; apelido?: unknown }
  if (t !== "message" || !apelido || typeof apelido !== "object") return null
  const { subject, nick, at } = apelido as Record<string, unknown>
  if (typeof subject !== "string" || subject === "" || typeof nick !== "string") return null
  return { subject, nick: nick.trim().slice(0, 64), at: typeof at === "number" ? at : 0 }
}

/**
 * Write a nickname if it beats what is there. Returns whether it changed.
 *
 * Newer timestamp wins, and server order breaks ties: the rule for all
 * timestamped records (`venceCarimbo`).
 */
export function registarApelido(
  contents: VaultContents,
  channel: string,
  subject: string,
  proposta: RegistoDeApelido,
): boolean {
  const cofre = registo(contents)
  const doCanal = cofre.apelidosDoCanal?.[channel] ?? {}
  if (!venceCarimbo(doCanal[subject], proposta)) return false
  cofre.apelidosDoCanal = { ...(cofre.apelidosDoCanal ?? {}), [channel]: { ...doCanal, [subject]: proposta } }
  return true
}

/**
 * The nicknames for a channel, by address. Only those with text.
 *
 * `pendentes` are those that already arrived and wait for vault write
 * (the session writes in batches). Without them, the UI would read the old
 * nickname until the next message, because the message is what makes it ask
 * again.
 */
export function apelidosDoCanal(
  contents: VaultContents,
  channel: string,
  pendentes: readonly ({ subject: string } & RegistoDeApelido)[] = [],
): Record<string, string> {
  const doCanal: Record<string, RegistoDeApelido> = { ...(registo(contents).apelidosDoCanal?.[channel] ?? {}) }
  for (const { subject, ...proposta } of pendentes) {
    if (venceCarimbo(doCanal[subject], proposta)) doCanal[subject] = proposta
  }
  const saida: Record<string, string> = {}
  for (const [endereco, { valor }] of Object.entries(doCanal)) if (valor !== "") saida[endereco] = valor
  return saida
}

/** Forget the nicknames for a channel when the device leaves the channel. */
export function esquecerApelidos(contents: VaultContents, channel: string): void {
  const cofre = registo(contents)
  if (!cofre.apelidosDoCanal?.[channel]) return
  const { [channel]: _largado, ...resto } = cofre.apelidosDoCanal
  cofre.apelidosDoCanal = resto
}

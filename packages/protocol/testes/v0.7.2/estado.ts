// The estado.ts from 0.7.2, as released (commit 07a2663, packages/protocol/src/estado.ts).
// For compatibility tests only: outside src/, does not enter tsc -b nor dist/.
// Only change: the import of canonical.js points to src/ (the file has not changed since).
// @ts-nocheck
import { z } from "zod"

/**
 * The state of the ACCOUNT that travels between its devices (phase 5, F13).
 *
 * Two paths, same shape:
 *
 * - **Level M, the snapshot.** On pairing, the device that has the account sends the new
 *   device a complete `EstadoDeConta`, encrypted inside the vault (`pair.ts`), after the
 *   certificate. The new device writes it to the vault before the first `connect()`.
 * - **Level L, the deltas.** After that, each change travels as an `estado.*` payload in
 *   the account channel (`canalDaContaDe`), a private MLS group with only the leaves of
 *   its devices.
 *
 * **The merge rule is one: the most recent timestamp per key wins.** Each entry carries its
 * timestamp (`at`), and whoever receives only replaces what it has if the arriving timestamp
 * is GREATER. Reads are the special case where the value IS the timestamp: the largest per
 * channel. This makes each payload an idempotent and commutative operation, and that is why
 * the same payload serves as delta (one key) and full replacement (all): applying twice, or
 * in different orders, gives the same result.
 *
 * **The clocks are the devices' clocks.** Two devices with swapped clocks decide by the one
 * ahead. It is the same tradeoff as the profile (`updatedAt`), and what is at stake here is
 * tidiness, not access.
 *
 * **None of these payloads goes to a channel with other people.** A 0.5.7 client does not
 * know them, rejects them, and five rejected in a row declare the channel deaf. They only
 * flow in the account channel, and in that channel only leaves that announced
 * `CAPACIDADE_ESTADO_DA_CONTA` can enter (see the core, `#cuidarDoCanalDaConta`).
 */

/** What a device announces it can do: be in the account channel. */
export const CAPACIDADE_ESTADO_DA_CONTA = "estado-da-conta"

/**
 * The device that announces itself has the account key (revision of slot 1, I4).
 *
 * It settles one decision only: who creates the account channel. With two
 * devices holding the key, each would create its own group with the same name,
 * and the account would have two account channels forever. The one with the
 * lowest device key among those that announced this capability creates it (see
 * `#cuidarDoCanalDaConta` in the core); the others announce themselves as
 * siblings and enter via Welcome.
 *
 * It grants no power: anyone who lies about it only becomes the one creating
 * the channel, and only a device from the account itself can send the signal
 * (MLS authenticates the leaf).
 */
export const CAPACIDADE_CHAVE_DE_CONTA = "chave-de-conta"

/** The capability list on the wire: short, each one a short name. */
export const CapacidadesDeAparelho = z.array(z.string().min(1).max(32)).max(16)

/**
 * The account's channel identifier: `!self-<id da conta>:<servidor>`.
 *
 * Deterministic, like the feed (`!feed-…`): any device on the account knows the
 * name without being told. Knowing the name grants no access: the server only passes what
 * comes from whoever has write access there, and only devices on the account can have it.
 */
export function canalDaContaDe(accountId: string, servidor: string): string {
  return `!self-${accountId}:${servidor}`
}

/** Is a channel someone's account channel? By shape, and shape alone. */
export function eCanalDaConta(channel: string): boolean {
  return channel.startsWith("!self-")
}

const Timestamp = z.number().int().nonnegative()
const Canal = z.string().min(1).max(255)
const Endereco = z
  .string()
  .max(320)
  .regex(/^@[^\s:@]+:[^\s@]+$/)

/**
 * A preference key: lowercase, digits, `.`, `_` and `-`.
 *
 * Tight on purpose. Preferences are for the interface (theme, color, sounds) and
 * the core does not interpret them; what the core guarantees is that no key is
 * a bag of bytes traveling between devices.
 */
export const CHAVE_DE_PREFERENCIA = /^[a-z][a-z0-9._-]{0,63}$/
/** Cap on a preference value, in characters. */
export const PREFERENCIA_MAX_CARACTERES = 2_000

/** Caps per map. Loose for one person, tight for abuse. */
export const LIDAS_MAX = 2_000
export const ARQUIVO_MAX = 2_000
export const BLOQUEIO_MAX = 2_000
export const PREFERENCIAS_MAX = 200

function comTecto<T extends z.ZodType>(valor: T, chave: z.ZodType<string>, tecto: number) {
  return z.record(chave, valor).refine((mapa) => Object.keys(mapa).length <= tecto, `at most ${tecto} entries`)
}

export const MarcasDeLidas = comTecto(Timestamp, Canal, LIDAS_MAX)
export const MarcasDeArquivo = comTecto(z.object({ arquivado: z.boolean(), at: Timestamp }), Canal, ARQUIVO_MAX)
export const MarcasDeBloqueio = comTecto(z.object({ bloqueado: z.boolean(), at: Timestamp }), Endereco, BLOQUEIO_MAX)
export const MarcasDePreferencias = comTecto(
  z.object({ valor: z.string().max(PREFERENCIA_MAX_CARACTERES), at: Timestamp }),
  z.string().regex(CHAVE_DE_PREFERENCIA),
  PREFERENCIAS_MAX,
)
export const AmigosMostrados = z.object({ shown: z.array(Endereco).max(500), updatedAt: Timestamp })

export type MarcasDeLidas = z.infer<typeof MarcasDeLidas>
export type MarcasDeArquivo = z.infer<typeof MarcasDeArquivo>
export type MarcasDeBloqueio = z.infer<typeof MarcasDeBloqueio>
export type MarcasDePreferencias = z.infer<typeof MarcasDePreferencias>
export type AmigosMostrados = z.infer<typeof AmigosMostrados>

/**
 * The account channel payloads. They enter the union of `payload.ts` by spread.
 *
 * Each one carries a MAP, not a key: a delta is a map of one entry, a full
 * replacement is the entire map. The friend list shown is the exception because
 * it is already a single value, with its own `updatedAt`.
 */
export const PAYLOADS_DE_ESTADO = [
  z.object({ t: z.literal("estado.lidas"), lidas: MarcasDeLidas }),
  z.object({ t: z.literal("estado.arquivo"), arquivo: MarcasDeArquivo }),
  z.object({ t: z.literal("estado.bloqueio"), bloqueio: MarcasDeBloqueio }),
  z.object({ t: z.literal("estado.amigos-mostrados"), shown: AmigosMostrados.shape.shown, updatedAt: Timestamp }),
  z.object({ t: z.literal("estado.preferencias"), preferencias: MarcasDePreferencias }),
] as const

/** The account channel `t`s, for those who need to recognize them without opening them. */
export const TIPOS_DE_ESTADO: ReadonlySet<string> = new Set(PAYLOADS_DE_ESTADO.map((esquema) => esquema.shape.t.value))

/**
 * An entry from the friendships log, as the fold reads it (`#friendEvents`).
 *
 * Only the fields the fold uses, plus the server's `seq`, which is what orders
 * it (see `#porOrdemDoServidor` in the core). `-1` is an act of ours with no echo.
 */
export const EntradaDoLivro = z.object({
  seq: z.number().int().min(-1),
  sender: Endereco,
  t: z.enum(["friend.request", "friend.accept", "friend.decline", "friend.remove"]),
  sentAt: Timestamp.optional(),
  note: z.string().max(280).optional(),
  withdrawn: z.literal(true).optional(),
})
export type EntradaDoLivro = z.infer<typeof EntradaDoLivro>

/** Caps on the log in the snapshot. One channel per friendship; two hundred acts per channel is plenty. */
export const LIVRO_CANAIS_MAX = 2_000
export const LIVRO_ENTRADAS_MAX = 200

/**
 * The pairing snapshot (level M).
 *
 * `amizades` carries the log events per channel, not the already-folded bonds:
 * the new device folds them itself, with the same function and same order, and
 * reaches the same bonds (with each one's channel). Folding on one side and
 * copying the result to the other meant two folds diverging at the first new event.
 */
export const EstadoDeConta = z.object({
  v: z.literal(1),
  amizades: comTecto(z.array(EntradaDoLivro).max(LIVRO_ENTRADAS_MAX), Canal, LIVRO_CANAIS_MAX),
  bloqueio: MarcasDeBloqueio,
  amigosMostrados: AmigosMostrados.optional(),
  arquivo: MarcasDeArquivo,
  lidas: MarcasDeLidas,
  preferencias: MarcasDePreferencias,
})
export type EstadoDeConta = z.infer<typeof EstadoDeConta>

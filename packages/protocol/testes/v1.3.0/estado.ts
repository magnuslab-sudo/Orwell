import { z } from "zod"

/**
 * The account state that moves between its devices (phase 5, F13).
 *
 * Two paths, same shape:
 *
 * - **Level M, the snapshot.** At pairing, the device that owns the account
 *   sends the new device a complete `EstadoDeConta`, encrypted inside the box
 *   (`pair.ts`), after the certificate. The new device writes it to the vault
 *   before the first `connect()`.
 * - **Level L, the deltas.** After that, each change travels as an `estado.*`
 *   payload in the account channel (`moradaDaConta`), a private MLS group with
 *   only the leaves of its devices.
 *
 * **The merge rule is simple: the newest timestamp per key wins.** Each entry
 * carries its timestamp (`at`), and the receiver only replaces what it has if
 * the arriving timestamp is GREATER. Read entries are the special case where
 * the value IS the timestamp: the greatest per channel. This makes each payload
 * an idempotent and commutative operation, and that is why the same payload
 * serves as both a delta (one key) and a full replacement (all keys): applying
 * it twice, or in different orders, gives the same result.
 *
 * **Clocks are the devices' clocks.** Two devices with swapped clocks decide by
 * the one that is ahead. It is the same trade-off as the profile (`updatedAt`),
 * and what matters here is housekeeping, not access.
 *
 * **None of these payloads go to a channel with other people.** A 0.5.7 client
 * does not know them, rejects them, and five rejections in a row mark the
 * channel as deaf to that client. They only flow in the account channel, and
 * only leaves that announced `CAPACIDADE_ESTADO_DA_CONTA` enter that channel
 * (see the core, `#cuidarDoCanalDaConta`).
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

/*
  The account channel identifier was `!self-<id da conta>:<servidor>`
  (`canalDaContaDe`), and came out in 1.0 "Arca", slice 3: it's `moradaDaConta` (ids.ts),
  derived from the account's private key, and the server no longer sees the
  owner. The channel type is in the vault entry (`tipoDoCanal`, type "account").
*/

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

/**
 * What each channel is, as it travels between devices of the same account (1.0
 * "Arca", slice 3). It is the vault record (`fichasDosCanais` in the core).
 *
 * Why it travels: with opaque addresses, a device without the account's private
 * key (a paired device) cannot calculate the address of a direct conversation
 * (it is a DH with the account key), and so does not recognize it when its
 * Welcome arrives. The one with the key recognizes it and tells its siblings
 * through this. Only via the account channel and the pairing snapshot: what
 * someone else says about a channel's type is not accepted.
 */
export const FichaDeCanal = z.object({
  tipo: z.enum(["directa", "mural", "sala", "conta"]),
  par: Endereco.optional(),
  dono: Endereco.optional(),
})
export type FichaDeCanal = z.infer<typeof FichaDeCanal>
export const FICHAS_MAX = 2_000
export const FichasDeCanais = comTecto(FichaDeCanal, Canal, FICHAS_MAX)
export type FichasDeCanais = z.infer<typeof FichasDeCanais>

/**
 * The profile of ANOTHER person, as a device of the account reports it to its
 * siblings (1.0 "Arca", profiles between devices).
 *
 * Why it travels: a profile only reaches those in the channel when the owner
 * publishes it, or those who ask for it while the owner is online (F10). A
 * freshly paired device sees everyone as "No Name" until each person returns.
 * The main device already knows the names: it reports them here.
 *
 * Only what identifies the person in a list: the name, the personal message,
 * the chosen status and the version (`updatedAt`, same as the `profile` payload).
 * Without the portrait: a portrait can be megabytes, and arrives when the person
 * publishes again (see the report `perfis-entre-aparelhos-relatorio.md`). Same
 * caps as the `profile` payload. The chosen status goes loose (narrow name), as
 * in `profile`: a future status does not reject the map.
 */
export const PerfilDeOutraPessoa = z.object({
  displayName: z.string().min(1).max(64),
  statusText: z.string().max(128).optional(),
  activity: z
    .string()
    .regex(/^[a-z][a-z0-9]{1,23}$/)
    .optional(),
  updatedAt: Timestamp.positive(),
})
export type PerfilDeOutraPessoa = z.infer<typeof PerfilDeOutraPessoa>
/**
 * Cap on profiles per payload and in the snapshot. A thousand people covers a
 * real account with plenty of room; above that, the newest ones go (highest
 * `updatedAt`), and the others wait for the person to publish again, as before.
 */
export const PERFIS_MAX = 1_000
export const PerfisDeOutros = comTecto(PerfilDeOutraPessoa, Endereco, PERFIS_MAX)
export type PerfisDeOutros = z.infer<typeof PerfisDeOutros>

/** The mural secret (32 bytes) in base64url without padding: 43 characters. */
export const SegredoDoMural = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "expected 32 bytes in base64url")

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
  /*
    The channel records and the mural secret (slice 3). A device with the account
    key sends them when it recognizes a new channel (a direct, a mural), and as
    the entire state; siblings store them (the first record of each channel stays).
    The secret goes to the sibling that does not yet have it so it can calculate
    its own mural.
  */
  /*
    Profiles of other people travel here, in an OPTIONAL field, not in a new
    `t`. A sibling from before this would reject a `t` it does not know, and five
    rejections in a row would mark the account channel as deaf to it (the rule
    from 1i (c)). This payload it already knows: it throws away the `perfis` field
    (schemas are not `strict()`) and reads a record map, empty or not. The
    `.catch` does the same on the new side: a broken profile map loses itself, and
    does not take the records with it.
  */
  z.object({
    t: z.literal("estado.fichas"),
    fichas: FichasDeCanais,
    segredoDoMural: SegredoDoMural.optional(),
    perfis: PerfisDeOutros.optional().catch(undefined),
  }),
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

/** Cap on the portrait in the snapshot and in the account channel: same as an attachment's `inline`. */
export const PERFIL_RETRATO_MAX_CARACTERES = 4_000_000

/**
 * The account's profile, as each device stores it (phase 1e).
 *
 * It travels in the pairing snapshot, so the new device is born with the main
 * device's name and portrait before publishing anything. After that, each change
 * goes through the account channel as a `profile` payload (the same one that goes
 * to all channels, and that all clients already know: an old sibling reads it and
 * does not reject it). The highest `updatedAt` wins, as in all account state.
 *
 * Same caps as the `profile` payload, so what comes from here fits there.
 */
export const PerfilDaConta = z.object({
  displayName: z.string().max(64),
  statusText: z.string().max(128).optional(),
  bio: z.string().max(1000).optional(),
  email: z.string().max(254).optional(),
  donations: z
    .array(z.object({ kind: z.string().max(24), label: z.string().max(48), value: z.string().max(256) }))
    .max(8),
  avatarDataUrl: z.string().max(PERFIL_RETRATO_MAX_CARACTERES).optional(),
  updatedAt: Timestamp,
})
export type PerfilDaConta = z.infer<typeof PerfilDaConta>

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
  /**
   * The profile of the device that pairs (phase 1e). Optional: an earlier host
   * does not send it, and an earlier guest throws it away without rejecting the
   * rest (the `z.object` drops keys it does not know).
   */
  perfil: PerfilDaConta.optional(),
  /**
   * The opaque addresses (1.0 "Arca", slice 3). The new device does not have the
   * account's private key and so does not calculate them: it receives them here.
   * The records of the channels the account already has, the mural secret (from
   * which its address comes) and the address of the account channel. Optional for
   * the same reason as the profile.
   */
  fichas: FichasDeCanais.optional(),
  segredoDoMural: SegredoDoMural.optional(),
  moradaDaConta: Canal.optional(),
  /**
   * The profiles of other people the host knows, without portraits. The new
   * device stores them in the directory before the first screen, and a profile
   * that arrives later with a higher version wins. Optional for the same reason
   * as the profile; and broken does not take the entire snapshot with it (`.catch`).
   */
  perfis: PerfisDeOutros.optional().catch(undefined),
})
export type EstadoDeConta = z.infer<typeof EstadoDeConta>

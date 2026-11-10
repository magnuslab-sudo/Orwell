import { z } from "zod"
import { CorpoDaDenuncia, IdDaCaixa, ITENS_POR_DENUNCIA_MAX, MOTIVOS, NOTA_MAX, type Motivo } from "./denuncia.js"

/**
 * The ACCOUNT state that moves between its devices (phase 5, F13).
 *
 * Two paths, one shape:
 *
 * - **Level M, the snapshot.** At pairing, the device that holds the account
 *   sends the new device a complete `EstadoDeConta`, encrypted inside the box
 *   (`pair.ts`), after the certificate. The new device writes it to the vault
 *   before the first `connect()`.
 * - **Level L, the deltas.** After that, each change travels as an `estado.*`
 *   payload in the account channel (`moradaDaConta`), a private MLS group with
 *   only the leaves of its devices.
 *
 * **There is one merge rule: the newest timestamp per key wins.** Each entry
 * carries its timestamp (`at`), and the receiver only replaces what it has if
 * the arriving timestamp is GREATER. Read markers are the special case where
 * the value IS the timestamp: the greatest per channel wins. This makes each payload
 * an idempotent and commutative operation, and that is why the same payload
 * serves as both a delta (one key) and a full replacement (all keys): applying
 * it twice, or in different orders, gives the same result.
 *
 * **The clocks are the devices' clocks.** Between two devices with skewed clocks,
 * the one that is ahead wins. It is the same trade-off as the profile (`updatedAt`),
 * and what matters here is housekeeping, not access.
 *
 * **None of these payloads go to a channel with other people.** A 0.5.7 client
 * does not know them and rejects them, and five rejections in a row mark the
 * channel as deaf for that client. They only flow in the account channel, and
 * only leaves that announced `CAPACIDADE_ESTADO_DA_CONTA` enter that channel
 * (see the core, `#cuidarDoCanalDaConta`).
 */

/** What a device announces it can do: be in the account channel. */
export const CAPACIDADE_ESTADO_DA_CONTA = "estado-da-conta"

/**
 * The announcing device holds the account key (wave 1 review, I4).
 *
 * It settles a single decision: who creates the account channel. With two
 * devices holding the key, each would create its own group with the same name,
 * and the account would have two account channels forever. The one with the
 * lowest device key among those that announced this capability creates it (see
 * `#cuidarDoCanalDaConta` in the core); the others announce themselves like the
 * siblings do and join via Welcome.
 *
 * It grants no power: a device that lies about it only becomes the one that creates
 * the channel, and only a device of the account itself can send the signal
 * (MLS authenticates the leaf).
 */
export const CAPACIDADE_CHAVE_DE_CONTA = "chave-de-conta"

/** The capability list on the wire: short, each one a short name. */
export const CapacidadesDeAparelho = z.array(z.string().min(1).max(32)).max(16)

/*
  The account channel identifier was `!self-<id da conta>:<servidor>`
  (`canalDaContaDe`), and was removed in 1.0 "Arca", slice 3: it's now `moradaDaConta` (ids.ts),
  derived from the account's private key, and the server no longer sees the
  owner. The channel type is in the vault entry (`tipoDoCanal`, type "conta").
*/

const Timestamp = z.number().int().nonnegative()
const Canal = z.string().min(1).max(255)
const Endereco = z
  .string()
  .max(320)
  .regex(/^@[^\s:@]+:[^\s@]+$/)

/**
 * A preference key: lowercase letters, digits, `.`, `_` and `-`.
 *
 * Narrow on purpose. Preferences are for the interface (theme, color, sounds) and
 * the core does not interpret them; what the core guarantees is that no key is
 * a bag of bytes traveling between devices.
 */
export const CHAVE_DE_PREFERENCIA = /^[a-z][a-z0-9._-]{0,63}$/
/** The cap on a preference value, in characters. */
export const PREFERENCIA_MAX_CARACTERES = 2_000

/** Caps per map. Generous for one person, tight for abuse. */
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
 * key (a paired device) cannot compute the address of a direct conversation
 * (it is a DH with the account key), and so does not recognize it when its
 * Welcome arrives. The device with the key recognizes it and tells its siblings
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
 * ANOTHER person's profile, as a device of the account passes it on to its
 * siblings (1.0 "Arca", profiles between devices).
 *
 * Why it travels: a profile only reaches those in the channel when the owner
 * publishes it, or those who ask for it while the owner is online (F10). A
 * freshly paired device saw everyone as "Sem nome" until each person came back.
 * The main device already knows the names: it reports them here.
 *
 * Only what identifies the person in a list: the name, the personal message,
 * the chosen status and the version (`updatedAt`, same as the `profile` payload).
 * No picture: a picture can be megabytes, and arrives when the person
 * publishes again (see the write-up `perfis-entre-aparelhos-relatorio.md`). Same
 * caps as the `profile` payload. The chosen status is loosely typed (a narrow name), as
 * in `profile`: a future status does not get the map rejected.
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
 * The cap on profiles per payload and in the snapshot. A thousand people covers a
 * real account with plenty of room; above that, the newest ones go (highest
 * `updatedAt`), and the rest wait for the person to publish again, as before.
 */
export const PERFIS_MAX = 1_000
export const PerfisDeOutros = comTecto(PerfilDeOutraPessoa, Endereco, PERFIS_MAX)
export type PerfisDeOutros = z.infer<typeof PerfisDeOutros>

/** The mural secret (32 bytes) in base64url without padding: 43 characters. */
export const SegredoDoMural = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "expected 32 bytes in base64url")

/**
 * A report received by the founder, already opened and verified on the device
 * that holds the account key, as it travels to siblings via the account channel
 * (reports polish, 4/11/2026). The shape is that of `DenunciaRecebida` in the
 * vault, without the `lida`, which belongs to each device.
 *
 * A paired device does not have the account key and cannot open the sealed copy.
 * Without this, only the first device to read the mailbox would see the report. The
 * server learns nothing: the account channel is an MLS group with only the
 * account's leaves.
 */
const DiaUtc = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const DenunciaDaConta = z.object({
  id: IdDaCaixa,
  canal: z.string().max(300),
  sala: z.string().max(64).optional(),
  dia: DiaUtc,
  motivo: z.custom<Motivo>((valor) => (MOTIVOS as readonly unknown[]).includes(valor), "expected a report reason"),
  nota: z.string().max(NOTA_MAX),
  denunciado: z.string().max(300),
  alvo: CorpoDaDenuncia.shape.alvo,
  itens: z
    .array(
      z.object({
        autor: z.string().max(300),
        dia: z.union([DiaUtc, z.literal("")]),
        hora: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal("")]),
        texto: z.string().max(16_000),
        anexos: z
          .array(
            z.object({
              name: z.string().max(300),
              mediaType: z.string().max(200),
              byteLength: z.number().int().nonnegative().optional(),
            }),
          )
          .max(10),
        verificada: z.boolean(),
        denunciada: z.boolean(),
      }),
    )
    .max(ITENS_POR_DENUNCIA_MAX),
})
export type DenunciaDaConta = z.infer<typeof DenunciaDaConta>
/** Reports per payload. Each can hold 16 messages of 16,000 characters: ten fit comfortably under the send cap. */
export const DENUNCIAS_POR_PAYLOAD_MAX = 10

export type MarcasDeLidas = z.infer<typeof MarcasDeLidas>
export type MarcasDeArquivo = z.infer<typeof MarcasDeArquivo>
export type MarcasDeBloqueio = z.infer<typeof MarcasDeBloqueio>
export type MarcasDePreferencias = z.infer<typeof MarcasDePreferencias>
export type AmigosMostrados = z.infer<typeof AmigosMostrados>

/**
 * The account channel payloads. They join the union in `payload.ts` by spread.
 *
 * Each one carries a MAP, not a key: a delta is a one-entry map, a full
 * replacement is the whole map. The shown friend list is the exception because
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
    key sends them when it recognizes a new channel (a DM, a mural), and in
    the full state; siblings store them (the first record of each channel stays).
    The secret goes to a sibling that lacks it so it can compute
    its own mural.
  */
  /*
    Profiles of other people travel here, in an OPTIONAL field, not in a new
    `t`. An older sibling would reject a `t` it does not know, and five
    rejections in a row would mark the account channel as deaf for it (the rule
    from 1i (c)). This payload it already knows: it drops the `perfis` field
    (schemas are not `strict()`) and reads a record map, empty or not. The
    `.catch` does the same on the new side: a broken profile map is lost on its own,
    without taking the records with it.
  */
  z.object({
    t: z.literal("estado.fichas"),
    fichas: FichasDeCanais,
    segredoDoMural: SegredoDoMural.optional(),
    perfis: PerfisDeOutros.optional().catch(undefined),
    /*
      The reports that the device with the account key opened (reports polish).
      Optional for the same reason as profiles: a 1.3.0 sibling knows this
      payload and drops the field.
    */
    denuncias: z.array(DenunciaDaConta).max(DENUNCIAS_POR_PAYLOAD_MAX).optional().catch(undefined),
  }),
] as const

/** The account channel `t`s, for those who need to recognize them without opening them. */
export const TIPOS_DE_ESTADO: ReadonlySet<string> = new Set(PAYLOADS_DE_ESTADO.map((esquema) => esquema.shape.t.value))

/**
 * An entry from the friendship book, as the fold reads it (`#friendEvents`).
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

/** Caps on the book in the snapshot. One channel per friendship; two hundred acts per channel is plenty. */
export const LIVRO_CANAIS_MAX = 2_000
export const LIVRO_ENTRADAS_MAX = 200

/** The cap on the picture in the snapshot and in the account channel: same as an attachment's `inline`. */
export const PERFIL_RETRATO_MAX_CARACTERES = 4_000_000

/**
 * The account's profile, as each device stores it (phase 1e).
 *
 * It travels in the pairing snapshot, so the new device is born with the main
 * device's name and picture before publishing anything. After that, each change
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
 * `amizades` carries the book's events per channel, not the already-folded ties:
 * the new device folds them itself, with the same function and the same order, and
 * reaches the same ties (with each one's channel). Folding on one side and
 * copying the result to the other would mean two folds diverging at the first new event.
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
   * The profile of the pairing device (phase 1e). Optional: an older host
   * does not send it, and an older guest drops it without rejecting the
   * rest (the `z.object` drops keys it does not know).
   */
  perfil: PerfilDaConta.optional(),
  /**
   * The opaque addresses (1.0 "Arca", slice 3). The new device does not have the
   * account's private key and so cannot compute them: it receives them here.
   * The records of the channels the account already has, the mural secret (from
   * which the mural's address comes) and the account channel's address. Optional for
   * the same reason as the profile.
   */
  fichas: FichasDeCanais.optional(),
  segredoDoMural: SegredoDoMural.optional(),
  moradaDaConta: Canal.optional(),
  /**
   * The profiles of other people the host knows, without pictures. The new
   * device stores them in the directory before the first screen, and a profile
   * that arrives later with a higher version wins. Optional for the same reason
   * as the profile; and if broken, it does not take the whole snapshot with it (`.catch`).
   */
  perfis: PerfisDeOutros.optional().catch(undefined),
})
export type EstadoDeConta = z.infer<typeof EstadoDeConta>

import { ed25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { z } from "zod"
import { fromBase64, toBase64 } from "./canonical.js"

/**
 * Authorship of an event: the signature of the device that wrote it (phase S4
 * of absolute sync, `docs/planos/2026-10-20-sincronia-absoluta.md`, §4.1).
 *
 * **The problem.** MLS authenticates the leaf that SENDS. If I relay Ana's
 * comment, it arrives signed by my leaf and gets my name. So until now, only
 * the author could vouch for their own events.
 *
 * **The design.** Each new event of a relayable type carries an optional
 * field `autoria`: the device key and an Ed25519 signature by it over
 *
 * ```
 * "orwell-autoria-v1" 0 canal 0 autor 0 JSON canónico de { p: forma assinada, m: resumos dos anexos }
 * ```
 *
 * The channel goes into the signature: a relayed event can't move from one
 * channel to another. The author (the address) too: the same device key doesn't speak
 * for another account.
 *
 * **The signed form doesn't carry attachment bytes.** The vault evicts the
 * bytes of old messages (`evictEntryMedia`) and keeps only the name and type; a signature
 * over the bytes would stop verifying on eviction day, and the event could never
 * be relayed again. So each attachment goes into the signed form only with
 * `name` and `mediaType`, and the SHA-256 digest of the whole attachment goes
 * separately, in `m`, which the signature also covers. Whoever receives the bytes
 * later (phase S5) checks them against `m`. Link card thumbnails stay out: they're
 * previews, and eviction removes them too.
 *
 * **Who verifies.** Live, nobody needs to: MLS already authenticates the
 * sender, and authorship is redundant. It only matters in a relay, when the
 * sender isn't the author. The receiver verifies the signature and
 * chain (the account signed this device), and rejects a revoked or
 * out-of-manifest device.
 *
 * **A 0.5.7 client drops the field**, because the schemas are not `strict()`.
 * Tested in `autoria.test.ts`, against the copied schema.
 *
 * **What this costs in deniability.** Authorship makes a payload portable
 * proof of who wrote it. MLS was already not deniable (each message carries
 * the leaf's signature), but the proof needed the group context. This is the
 * owner's decision 1 (§12), approved on 20/10/2026: authorship on everything,
 * messages included.
 */

/** base64url without padding, like `toBase64`. */
const B64 = /^[A-Za-z0-9_-]+$/
/** An Ed25519 key (32 bytes) in base64url: 43 characters. */
export const ChaveEd25519 = z.string().length(43).regex(B64)
/** An Ed25519 signature (64 bytes) in base64url: 86 characters. */
export const AssinaturaEd25519 = z.string().length(86).regex(B64)
/** An SHA-256 digest (32 bytes) in base64url: 43 characters. */
const Resumo256 = z.string().length(43).regex(B64)

/** The maximum number of attachments in a payload: 10 in `attachments` and 10 in `media`. */
export const ANEXOS_COM_RESUMO_MAX = 20

export const Autoria = z.object({
  /** The format version. An unknown version never verifies. */
  v: z.literal(1),
  /** The DEVICE key that signed. */
  ap: ChaveEd25519,
  /** The signature, over `mensagemDaAutoria`. */
  as: AssinaturaEd25519,
  /** The digest of each attachment, in the order of `CHAVES_DE_ANEXOS`. Absent: no attachments. */
  m: z.array(Resumo256).max(ANEXOS_COM_RESUMO_MAX).optional(),
})
export type Autoria = z.infer<typeof Autoria>

/**
 * The types that carry authorship. The relayable ones (§4.3), the channel state
 * with its own log entry and, since 1.1 (decision D1 of
 * `docs/planos/estado-cifrado-plano.md`), the profile: the Welcome snapshot
 * carries member names, and a name without authorship was the inviter's word.
 * Left out: ephemeral events (`typing`, `buzz`, `voice.*`), the friendship and invite
 * book (it controls access, and only what came from the server counts, §7.8), shown
 * friends (they have their own request), and the account channel (it has its own state).
 */
export const TIPOS_COM_AUTORIA = [
  "message",
  "edit",
  "redact",
  "reaction",
  "post",
  "post.comment",
  "post.reaction",
  "room.created",
  "role.define",
  "role.assign",
  "channel.meta",
  "channel.category",
  "space.meta",
  "profile",
] as const
export type TipoComAutoria = (typeof TIPOS_COM_AUTORIA)[number]

const COM_AUTORIA: ReadonlySet<string> = new Set(TIPOS_COM_AUTORIA)

export function levaAutoria(tipo: unknown): tipo is TipoComAutoria {
  return typeof tipo === "string" && COM_AUTORIA.has(tipo)
}

/** The attachment lists with bytes, the same ones the vault evicts (`MEDIA_KEYS`). */
export const CHAVES_DE_ANEXOS = ["attachments", "media"] as const

/**
 * A profile's picture (`avatar`): a single attachment, not a list. It enters
 * the signed form like list attachments (only name and type), with its digest
 * in `m` after the list digests. Only in `profile`: in other types with authorship
 * a field with this name does not exist, and their form does not change.
 */
export const ANEXO_DO_PERFIL = "avatar"

/** Whether this field of this payload is a profile's picture. */
export function eRetratoDoPerfil(payload: Readonly<Record<string, unknown>>, chave: string): boolean {
  return chave === ANEXO_DO_PERFIL && payload["t"] === "profile"
}

/**
 * Tolerant canonical JSON: keys in order, no spaces, `undefined` stripped.
 *
 * Tolerant of decimal numbers (`duration` on an attachment, for example),
 * which `canonicalize` rejects. The number comes out as `JSON.stringify` writes it,
 * which the language spec fixes: it's the same across all engines.
 */
export function canonicoTolerante(valor: unknown): string {
  if (valor === null) return "null"
  switch (typeof valor) {
    case "boolean":
      return valor ? "true" : "false"
    case "number":
      if (!Number.isFinite(valor)) throw new Error("JSON canónico não tem infinitos nem NaN")
      return JSON.stringify(valor)
    case "string":
      return JSON.stringify(valor)
    case "object":
      break
    default:
      throw new Error(`JSON canónico não codifica ${typeof valor}`)
  }
  if (Array.isArray(valor)) return `[${valor.map((item) => (item === undefined ? "null" : canonicoTolerante(item))).join(",")}]`
  const registo = valor as Record<string, unknown>
  const partes: string[] = []
  for (const chave of Object.keys(registo).sort()) {
    const membro = registo[chave]
    if (membro === undefined) continue
    partes.push(`${JSON.stringify(chave)}:${canonicoTolerante(membro)}`)
  }
  return `{${partes.join(",")}}`
}

const texto = (valor: unknown): string => (typeof valor === "string" ? valor : "")

/**
 * The payload as the signature sees it: no `autoria`, each attachment reduced to name and
 * type, and link cards without thumbnail. This form survives vault eviction, and so
 * a relay can still prove it.
 *
 * Receives the payload ALREADY NORMALIZED by the schema (with default values
 * filled in): the signer and verifier must see the same fields.
 */
export function formaAssinada(payload: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const forma: Record<string, unknown> = {}
  for (const [chave, valor] of Object.entries(payload)) {
    if (chave === "autoria" || valor === undefined) continue
    if (eRetratoDoPerfil(payload, chave) && typeof valor === "object" && valor !== null) {
      const anexo = valor as Record<string, unknown>
      forma[chave] = { name: texto(anexo["name"]), mediaType: texto(anexo["mediaType"]) }
    } else if ((CHAVES_DE_ANEXOS as readonly string[]).includes(chave) && Array.isArray(valor)) {
      forma[chave] = valor.map((item) => {
        const anexo = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>
        return { name: texto(anexo["name"]), mediaType: texto(anexo["mediaType"]) }
      })
    } else if (chave === "links" && Array.isArray(valor)) {
      forma[chave] = valor.map((item) => {
        if (typeof item !== "object" || item === null) return item
        const { thumbnail: _miniatura, ...resto } = item as Record<string, unknown>
        return resto
      })
    } else {
      forma[chave] = valor
    }
  }
  return forma
}

/** Whether an attachment still has its bytes (not evicted by the vault). */
function anexoInteiro(item: unknown): boolean {
  return typeof item === "object" && item !== null && (item as Record<string, unknown>)["evicted"] !== true
}

/**
 * The SHA-256 digest of each attachment, in the order of `CHAVES_DE_ANEXOS`.
 *
 * Only for the SIGNER, with the full payload in hand. An evicted attachment
 * has no digest to compute: the relayer uses the `m` that came with the
 * `autoria`.
 */
export function resumosDosAnexos(payload: Readonly<Record<string, unknown>>): string[] {
  const resumos: string[] = []
  for (const chave of CHAVES_DE_ANEXOS) {
    const lista = payload[chave]
    if (!Array.isArray(lista)) continue
    for (const item of lista) {
      if (!anexoInteiro(item)) throw new Error("um anexo despejado não se assina")
      resumos.push(toBase64(sha256(new TextEncoder().encode(canonicoTolerante(item)))))
    }
  }
  const retrato = payload[ANEXO_DO_PERFIL]
  if (payload["t"] === "profile" && typeof retrato === "object" && retrato !== null) {
    if (!anexoInteiro(retrato)) throw new Error("um anexo despejado não se assina")
    resumos.push(toBase64(sha256(new TextEncoder().encode(canonicoTolerante(retrato)))))
  }
  return resumos
}

const CONTEXTO = new TextEncoder().encode("orwell-autoria-v1\0")

/** The bytes the device signs. */
export function mensagemDaAutoria(
  canal: string,
  autor: string,
  payload: Readonly<Record<string, unknown>>,
  anexos: readonly string[],
): Uint8Array {
  const corpo = new TextEncoder().encode(
    `${canal}\0${autor}\0${canonicoTolerante({ p: formaAssinada(payload), m: [...anexos] })}`,
  )
  const mensagem = new Uint8Array(CONTEXTO.length + corpo.length)
  mensagem.set(CONTEXTO, 0)
  mensagem.set(corpo, CONTEXTO.length)
  return mensagem
}

/**
 * Sign a normalized payload. `assinar` is the device's private key behind a function,
 * so this module never sees it.
 */
export function assinarAutoria(opcoes: {
  canal: string
  autor: string
  payload: Readonly<Record<string, unknown>>
  aparelho: Uint8Array
  assinar: (mensagem: Uint8Array) => Uint8Array
}): Autoria {
  const anexos = resumosDosAnexos(opcoes.payload)
  const assinatura = opcoes.assinar(mensagemDaAutoria(opcoes.canal, opcoes.autor, opcoes.payload, anexos))
  return { v: 1, ap: toBase64(opcoes.aparelho), as: toBase64(assinatura), ...(anexos.length > 0 ? { m: anexos } : {}) }
}

export type VeredictoDaAutoria =
  | { ok: true; aparelho: string }
  | { ok: false; razao: "sem-autoria" | "autoria-ilegivel" | "assinatura-invalida" }

/**
 * Verify the authorship of a normalized payload, which carries it in the `autoria` field.
 *
 * Only the signature: the chain (the account signed the device) and the
 * revocation list are up to the caller, who has the manifest and the vault. Returns, never throws.
 */
export function verificarAutoria(canal: string, autor: string, payload: Readonly<Record<string, unknown>>): VeredictoDaAutoria {
  if (payload["autoria"] === undefined) return { ok: false, razao: "sem-autoria" }
  const lida = Autoria.safeParse(payload["autoria"])
  if (!lida.success) return { ok: false, razao: "autoria-ilegivel" }
  const { ap, as, m } = lida.data
  try {
    const mensagem = mensagemDaAutoria(canal, autor, payload, m ?? [])
    if (!ed25519.verify(fromBase64(as), mensagem, fromBase64(ap))) return { ok: false, razao: "assinatura-invalida" }
  } catch {
    return { ok: false, razao: "assinatura-invalida" }
  }
  return { ok: true, aparelho: ap }
}

// ------------------------------------------------------------------ relatos

/**
 * How many items a relay `typing` carries. The frame's cap; senders split by
 * bytes well before this (`relato.ts` in the core).
 */
export const RELATOS_POR_TRAMA_MAX = 256

/**
 * A relayed event: the original payload, with its authorship, and what the relayer
 * knows about it.
 *
 * - `s`: the origin `seq`, as stated by the relayer. Not signed (the author didn't know it
 *   when signing). Only orders the timeline, never gates access (§7.8). -1 when the relayer doesn't know it.
 * - `a`: the author's address. Goes into the signature.
 * - `p`: the payload, with `autoria`. Opaque here: the receiver normalizes it with
 *   the schema before verifying.
 * - `k`, `x`: the chain, for receivers without the author in the tree: the author's ACCOUNT key
 *   and the device certificate (the account signing the device key).
 *   It's public (in the leaf credential and the manifest).
 */
export const ItemRelatado = z.object({
  s: z.number().int().min(-1),
  a: z.string().min(1).max(300),
  p: z.record(z.string(), z.unknown()),
  k: ChaveEd25519.optional(),
  x: AssinaturaEd25519.optional(),
})
export type ItemRelatado = z.infer<typeof ItemRelatado>

/**
 * The `relatos` field of a `typing` with `until: 0` (§4.5): the vehicle for
 * relays, like the device signal in phase 5. All clients know
 * `typing`, none shows it when it is born expired, and a 0.5.7 client drops this field
 * without rejecting the payload.
 *
 * `q`: the request this answers, so the requester can stop waiting.
 */
export const RelatosNoFio = z.object({
  v: z.literal(1),
  q: z.string().max(64).optional(),
  itens: z.array(ItemRelatado).max(RELATOS_POR_TRAMA_MAX),
})
export type RelatosNoFio = z.infer<typeof RelatosNoFio>

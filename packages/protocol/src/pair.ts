import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { hkdf } from "@noble/hashes/hkdf.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { z } from "zod"
import { fromBase64, toBase64 } from "./canonical.js"
import { CapacidadesDeAparelho, EstadoDeConta } from "./estado.js"
import { encodeName } from "./names.js"

/**
 * Pairing a new device to an account that already exists.
 *
 * ## The gesture
 *
 * The device that HAS the account (the computer) generates a secret, opens a box on the
 * server keyed by the secret's hash (`pairId`) and shows the secret in a link and a
 * QR code. The new device (the phone) reads the QR or pastes the link, derives the same
 * `pairId`, joins the box without authenticating, and the two speak via `pair.send`
 * with the server relaying bytes it cannot read.
 *
 * ## What the server learns, and what it doesn't
 *
 * It learns the `pairId`, which is `sha256(segredo)` and does not reveal the secret; it learns that
 * an authenticated account opened a box and that an unauthenticated connection joined;
 * it learns the size and timing of what passes. **Never the secret, never the key
 * `K`, never what goes inside.** Everything that crosses the box is encrypted with
 * `K = HKDF(segredo)`, and the account private key never crosses anything:
 * the phone receives a CERTIFICATE and remains without it forever.
 *
 * ## The SAS, and why the QR code is not enough
 *
 * The QR code and link only save typing 43 characters: **they authenticate nothing**.
 * Whoever sees the QR code (a photo of the screen, the link pasted in a conversation) has the
 * secret, derives `K`, and joins the box before the phone. Likewise,
 * the server, which knows the `pairId` and relays everything, is in position to
 * get in the middle if it ever gets `K`. The defense is the SAS: both screens
 * show six words computed from the `pairId` AND the two device
 * public keys, and the person confirms on BOTH that they are the same. A third party that
 * joined in place of the phone has another key, produces different
 * words on the computer, and the phone in hand shows none (the box only
 * takes two connections). **Without human confirmation, no certificate is issued.**
 */

/** 32 bytes of secret: what is shown in the QR and the link fragment. */
export const PAIR_SECRET_BYTES = 32

/**
 * 22 base64url characters of the hash: 132 bits, plenty to never collide and
 * enough for the server to index. Not the full hash, so the `pairId` fits
 * in a log line and can't be mistaken for a key.
 */
export const PAIR_ID_CHARS = 22

/** The strict format of a `pairId` on the wire. */
export const PAIR_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/

/** Domain of the `K` derivation. Changing this means changing the protocol. */
const PAIR_KDF_INFO = "orwell:pair:v1"

/** Domain of the SAS transcript, separate from the key domain. */
const PAIR_SAS_CONTEXT = "orwell:pair-sas:v1\0"

/**
 * The cap on an encrypted `payload` on the wire, in JSON characters.
 *
 * The largest honest payload is the certificate: address, account key and
 * signature, around 300 base64url characters inside the AEAD. Eight KiB is
 * twenty times that, and it prevents a box from serving as a tunnel for anything
 * else through a server that forwards without reading.
 */
export const PAIR_PAYLOAD_MAX_CHARS = 8 * 1024

const NONCE_BYTES = 24

/**
 * Base64url characters per snapshot part.
 *
 * Four thousand fit comfortably under the 8 KiB cap: the part's JSON adds
 * a few dozen characters, the AEAD 40 bytes, and the base64 of the whole a
 * third more. Base64url and not raw JSON, so no accent or quote grows
 * along the way and breaks the cap.
 */
export const ESTADO_PARTE_CARACTERES = 4_000

/** The cap on parts: 256 times 3 KB of JSON is 768 KB, well above a real account. */
export const ESTADO_PARTES_MAX = 256

/** The base64url characters of the whole snapshot, which is what gets split. */
function caracteresDoEstado(estado: EstadoDeConta): number {
  return Math.ceil((new TextEncoder().encode(JSON.stringify(estado)).length * 4) / 3)
}

/** The `n` most recent entries of a map, by the timestamp that `quando` reads. */
function maisRecentesDe<V>(mapa: Record<string, V>, n: number, quando: (valor: V) => number): Record<string, V> {
  const entradas = Object.entries(mapa)
  if (entradas.length <= n) return mapa
  return Object.fromEntries(entradas.sort((a, b) => quando(b[1]) - quando(a[1])).slice(0, Math.max(0, n)))
}

/**
 * The snapshot trimmed to fit in `ESTADO_PARTES_MAX` parts (M5 of the wave 1
 * review).
 *
 * Before, a snapshot over the cap made `partirEstado` throw, and pairing
 * went on with NO state at all: everything was lost because there was too
 * much. Now the oldest data is cut, in ever deeper steps, until it fits: the
 * friendship book (channels with the oldest event go first, and in each
 * channel only the newest events remain), read markers and archive (oldest
 * markers), and other people's profiles (oldest versions). Blocks, preferences and
 * the shown list are not cut: they are small, and they hurt the most to lose.
 * The profile picture goes last, and only if it still does not fit. What is left out,
 * the account channel brings later, in deltas.
 */
export function cortarEstadoAteCaber(estado: EstadoDeConta): EstadoDeConta {
  const tecto = ESTADO_PARTES_MAX * ESTADO_PARTE_CARACTERES
  let atual = estado
  for (let passo = 0; passo < 32 && caracteresDoEstado(atual) > tecto; passo++) {
    // A fraction of what there is, with room to spare: the size is not linear in the
    // number of entries, and one step that cuts too much costs less than twenty that
    // cut too little.
    const fracao = Math.min(0.9, (tecto / caracteresDoEstado(atual)) * 0.9)
    const ultimoActo = (entradas: readonly { sentAt?: number | undefined; seq: number }[]): number =>
      Math.max(0, ...entradas.map((entrada) => entrada.sentAt ?? 0))
    const canais = Object.keys(atual.amizades).length
    const amizades = Object.fromEntries(
      Object.entries(maisRecentesDe(atual.amizades, Math.floor(canais * fracao), ultimoActo)).map(([canal, entradas]) => [
        canal,
        entradas.slice(-Math.max(1, Math.floor(entradas.length * fracao))),
      ]),
    )
    atual = {
      ...atual,
      amizades,
      lidas: maisRecentesDe(atual.lidas, Math.floor(Object.keys(atual.lidas).length * fracao), (at) => at),
      arquivo: maisRecentesDe(atual.arquivo, Math.floor(Object.keys(atual.arquivo).length * fracao), (marca) => marca.at),
      // Other people's profiles: keep the newest versions. The ones cut
      // arrive when each person publishes again, as before.
      ...(atual.perfis
        ? { perfis: maisRecentesDe(atual.perfis, Math.floor(Object.keys(atual.perfis).length * fracao), (perfil) => perfil.updatedAt) }
        : {}),
    }
  }
  /*
    The picture goes last, and only if it still does not fit (phase 1e). A large
    GIF can exceed the cap on its own, and without this step the whole snapshot
    would not split and the device would join with no state at all. Without the
    picture, the name and the rest of the profile arrive now; the picture arrives
    through the account channel, in the full state that the primary sends when
    the new device joins it.
    */
  if (caracteresDoEstado(atual) > tecto && atual.perfil?.avatarDataUrl !== undefined) {
    const { avatarDataUrl: _foraDoInstantaneo, ...semRetrato } = atual.perfil
    atual = { ...atual, perfil: semRetrato }
  }
  return atual
}

/**
 * Split a snapshot into parts for the box.
 *
 * Validates before splitting: what comes out of here must pass the `EstadoDeConta`
 * on the other side, and a snapshot that does not pass is a bug on this side. Over the
 * cap, it cuts the oldest data until it fits (`cortarEstadoAteCaber`). It only throws if it still
 * does not fit, which takes blocks or preferences beyond any real account.
 */
export function partirEstado(estado: EstadoDeConta): string[] {
  const texto = toBase64(new TextEncoder().encode(JSON.stringify(cortarEstadoAteCaber(EstadoDeConta.parse(estado)))))
  const partes: string[] = []
  for (let at = 0; at < texto.length; at += ESTADO_PARTE_CARACTERES) partes.push(texto.slice(at, at + ESTADO_PARTE_CARACTERES))
  if (partes.length === 0) partes.push("")
  if (partes.length > ESTADO_PARTES_MAX) throw new Error("account state too large to pair", { cause: { partes: partes.length } })
  return partes
}

/**
 * Join the parts. `null` if any is missing or if the result is not a
 * valid snapshot: the caller goes on without state, as with a 0.5.7 host.
 */
export function juntarEstado(partes: readonly (string | undefined)[]): EstadoDeConta | null {
  if (partes.some((parte) => parte === undefined)) return null
  try {
    const bytes = fromBase64(partes.join(""))
    const lido = EstadoDeConta.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)))
    return lido.success ? lido.data : null
  } catch {
    return null
  }
}

/** A new secret. Global `crypto`, as in `names.ts`: runs in the browser and in Node. */
export function gerarSegredoDeEmparelhamento(): Uint8Array {
  const bytes = new Uint8Array(PAIR_SECRET_BYTES)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

/**
 * The box identifier, derived from the secret: `base64url(sha256(segredo))`
 * truncated. Both devices arrive at the same one without exchanging a word, and the
 * server, which only sees this, cannot work back to the secret.
 */
export function pairIdDe(segredo: Uint8Array): string {
  if (segredo.length !== PAIR_SECRET_BYTES) throw new Error("segredo de emparelhamento com tamanho errado")
  return toBase64(sha256(segredo)).slice(0, PAIR_ID_CHARS)
}

/**
 * The box's symmetric key: `HKDF-SHA256(segredo, salt = pairId, info = "orwell:pair:v1")`.
 *
 * The `pairId` goes in as salt so the key stays bound to the box: the same secret
 * in another box (it doesn't happen, but it costs nothing) would give another key.
 */
export function chaveDeEmparelhamento(segredo: Uint8Array, pairId: string): Uint8Array {
  if (segredo.length !== PAIR_SECRET_BYTES) throw new Error("segredo de emparelhamento com tamanho errado")
  if (!PAIR_ID_PATTERN.test(pairId)) throw new Error("pairId com forma errada")
  const codificador = new TextEncoder()
  return hkdf(sha256, segredo, codificador.encode(pairId), codificador.encode(PAIR_KDF_INFO), 32)
}

// ------------------------------------------------------------- the payloads

const Base64 = z.string().regex(/^[A-Za-z0-9_-]*$/, "expected unpadded base64url")

/**
 * What the two devices say to each other, inside the AEAD.
 *
 * - `chave-do-aparelho`: each side sends its device PUBLIC key as soon as
 *   the box has two connections. The SAS is computed from both.
 * - `certificado`: from the computer to the phone, ONLY after the person
 *   confirms the words on both screens. It carries the address, the account
 *   PUBLIC key and the account's signature over the phone's device key. **There
 *   is no field for the account private key, on purpose: there is no way to
 *   write it in this payload.**
 * - `confirmado`: from the phone to the computer when the person confirmed there
 *   that the words are the same. It is what the computer waits for before signing, and it is
 *   why a pairing abandoned halfway leaves nothing behind: without
 *   this payload there is no certificate and no new manifest. Security is still
 *   the computer's SAS (whoever defends the account has the key); this is
 *   housekeeping, not trust.
 * - `pronto`: from the phone to the computer when the vault is written and the
 *   account is connected with KeyPackages published. It is the signal for the computer
 *   to publish the manifest including the phone and add it to the channels.
 * - `recusado`: one side said the words are not the same. The other stops
 *   and says why.
 * - `estado` (phase 5): the snapshot of the account state (`EstadoDeConta`), from
 *   the computer to the phone, AFTER the certificate and in parts, because the
 *   cap on a payload is 8 KiB and the snapshot of an account with many
 *   friendships exceeds it. The certificate says how many parts follow (`estado`); a
 *   0.5.7 host sends neither the field nor the parts, and the guest waits
 *   for nothing. A 0.5.7 guest rejects the `estado` payload (it is `null` to
 *   `decifrarPairPayload`, and `null` reads as "that wasn't my peer") and drops
 *   the certificate field: nothing changes for it.
 *
 * `pronto` carries the new device's capabilities (phase 5): that is how the
 * computer knows, already during pairing, that the phone can join the
 * account channel. A 0.5.7 host drops the field.
 */
export const PairPayload = z.discriminatedUnion("t", [
  z.object({ t: z.literal("chave-do-aparelho"), deviceKey: Base64.length(43) }),
  z.object({
    t: z.literal("certificado"),
    address: z.string().min(3).max(255),
    accountKey: Base64.length(43),
    deviceCert: Base64.length(86),
    /** How many `estado` parts come next. Absent: none (0.5.7 host). */
    estado: z.number().int().min(1).max(ESTADO_PARTES_MAX).optional(),
  }),
  z.object({ t: z.literal("confirmado") }),
  z.object({ t: z.literal("pronto"), capacidades: CapacidadesDeAparelho.optional() }),
  z.object({ t: z.literal("recusado") }),
  z.object({
    t: z.literal("estado"),
    /** The position of this part, from zero. */
    parte: z.number().int().min(0).max(ESTADO_PARTES_MAX - 1),
    /** A piece of the base64url of the snapshot's JSON. */
    dados: Base64.max(ESTADO_PARTE_CARACTERES),
  }),
])
export type PairPayload = z.infer<typeof PairPayload>

/**
 * Encrypt a payload for the box: `base64url(nonce || xchacha20poly1305(K, nonce, aad = pairId))`.
 *
 * Random 24-byte nonce per message, like the vault and attachments: with 192
 * bits of nonce, reuse is not a risk to manage. The `pairId` goes in as
 * associated data so a ciphertext from one box cannot be replayed
 * in another.
 */
export function cifrarPairPayload(chave: Uint8Array, pairId: string, payload: PairPayload): string {
  const nonce = new Uint8Array(NONCE_BYTES)
  globalThis.crypto.getRandomValues(nonce)
  const texto = new TextEncoder().encode(JSON.stringify(payload))
  const cifrado = xchacha20poly1305(chave, nonce, new TextEncoder().encode(pairId)).encrypt(texto)
  const saida = new Uint8Array(NONCE_BYTES + cifrado.length)
  saida.set(nonce, 0)
  saida.set(cifrado, NONCE_BYTES)
  return toBase64(saida)
}

/**
 * The reverse: **returns `null`, never throws**.
 *
 * What arrives over `pair.message` comes from a connection the server did not
 * authenticate and can be anyone with the `pairId`. Garbage, a short nonce,
 * a tag that does not verify, JSON that is not our payload: all of this is
 * `null`, and the caller treats `null` as "that wasn't my peer speaking".
 */
export function decifrarPairPayload(chave: Uint8Array, pairId: string, wire: unknown): PairPayload | null {
  if (typeof wire !== "string" || wire.length > PAIR_PAYLOAD_MAX_CHARS) return null
  let bytes: Uint8Array
  try {
    bytes = fromBase64(wire)
  } catch {
    return null
  }
  if (bytes.length <= NONCE_BYTES) return null
  let texto: Uint8Array
  try {
    texto = xchacha20poly1305(chave, bytes.subarray(0, NONCE_BYTES), new TextEncoder().encode(pairId)).decrypt(
      bytes.subarray(NONCE_BYTES),
    )
  } catch {
    return null
  }
  try {
    const lido = PairPayload.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(texto)))
    return lido.success ? lido.data : null
  } catch {
    return null
  }
}

// ------------------------------------------------------------------ o SAS

/**
 * The transcript that both sides hash:
 * `sha256("orwell:pair-sas:v1\0" || pairId || pubAnfitrião || pubConvidado)`.
 *
 * BOTH keys go in, in this fixed order. If only the guest's key went in,
 * a third party who joined in place of the phone and relayed the computer's
 * key to the phone would get through without the words changing. If only
 * the host's key went in, the reverse. With both, changing either one
 * changes all six words, and that is what the user is comparing. See `pair.test.ts`.
 */
export function transcricaoDoSas(pairId: string, pubAnfitriao: Uint8Array, pubConvidado: Uint8Array): Uint8Array {
  if (pubAnfitriao.length !== 32 || pubConvidado.length !== 32) throw new Error("chave de aparelho com tamanho errado")
  const codificador = new TextEncoder()
  const contexto = codificador.encode(PAIR_SAS_CONTEXT)
  const id = codificador.encode(pairId)
  const mensagem = new Uint8Array(contexto.length + id.length + 64)
  let at = 0
  mensagem.set(contexto, at)
  at += contexto.length
  mensagem.set(id, at)
  at += id.length
  mensagem.set(pubAnfitriao, at)
  at += 32
  mensagem.set(pubConvidado, at)
  return sha256(mensagem)
}

/**
 * The six words: the first 15 bytes of the transcript (120 bits, six
 * words of twenty bits), from the vocabulary in `names.ts`. No new encoding for the
 * words: they use the same syllables as addresses, which the person already knows how to read.
 */
export function palavrasDoSas(pairId: string, pubAnfitriao: Uint8Array, pubConvidado: Uint8Array): string {
  return encodeName(transcricaoDoSas(pairId, pubAnfitriao, pubConvidado).subarray(0, 15), 6)
}

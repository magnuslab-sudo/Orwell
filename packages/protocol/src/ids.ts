import { ed25519, x25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { WORD_BITS, decodeName, encodeName } from "./names.js"

/**
 * The vocabulary is exported here so `index.ts`, which is shared ground, does not
 * have to change. Whoever imports `@enclave/protocol` gets the room name
 * generator through the same path they already got addresses from.
 */
export * from "./names.js"

/**
 * Addressing.
 *
 * Discord gives every account a global, human-chosen username. That is a
 * permanent cross-service identifier: it survives server hops, it is guessable,
 * and it lets an operator (or anyone who scrapes) link the same person across
 * unrelated communities.
 *
 * Enclave never puts a human-chosen name on the wire. An account id is derived
 * from the account's long-term signing key, so the homeserver sees an opaque
 * blob it cannot invert into a person. Display names live *inside* the MLS
 * group, encrypted, visible only to members of that space.
 */

/** `@<accountId>:<homeserver>`: the only user identifier a server ever sees. */
export type UserAddress = string & { readonly __brand: "UserAddress" }
/** `!<spaceId>:<homeserver>`: a "server" in Discord terms; a community. */
export type SpaceAddress = string & { readonly __brand: "SpaceAddress" }
/** Opaque handle for one MLS group. One channel == one group == one address. */
export type ChannelId = string & { readonly __brand: "ChannelId" }
/** DNS name of a homeserver, e.g. `enclave.example`. */
export type ServerName = string & { readonly __brand: "ServerName" }

/** Lowercase Crockford-ish base32 without padding: case-insensitive, no confusables. */
const B32 = "abcdefghijkmnpqrstuvwxyz23456789"

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ""
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(text: string): Uint8Array {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of text.toLowerCase()) {
    const index = B32.indexOf(char)
    if (index < 0) throw new Error(`invalid base32 character: ${char}`)
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

/**
 * A DNS label chain plus an optional port. The chain may be a single label so
 * that `localhost:8448` works for development; real federation needs a name
 * that resolves, which in practice means a dotted FQDN.
 */
const SERVER_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/

export function parseServerName(value: string): ServerName {
  const normalized = value.toLowerCase()
  if (!SERVER_NAME.test(normalized)) throw new Error(`invalid server name: ${value}`)
  return normalized as ServerName
}

/**
 * Words in an account identifier.
 *
 * The number is not cosmetic, and the reason is in `ACCOUNT_ID_BITS` below.
 * Changing it changes every address in existence: an address is the key, not a
 * name kept beside it.
 */
export const ACCOUNT_ID_WORDS = 4

/** Twenty bits per word. The split is in `names.ts` and is a bijection. */
export const ACCOUNT_ID_BITS = ACCOUNT_ID_WORDS * WORD_BITS

/** Eighty bits are exactly ten bytes: the identifier is the hash prefix, no padding. */
const ACCOUNT_ID_BYTES = ACCOUNT_ID_BITS / 8

/**
 * Account identifier = the first 80 bits of the SHA-256 of the signing public
 * key, written as four Latin words.
 *
 * What this hash has to resist is not collision, it is second preimage, and
 * that difference sets the length. Nobody gains by making two of their own keys
 * with the same address; they gain by making a key that lands on someone else's
 * address. There is no PKI behind this (`addressBindingAuthService` accepts
 * any credential whose address matches the hash of the key that signs it), so
 * anyone who pulls off that second preimage speaks inside a room under
 * someone else's name; and since admin lists are kept by address, the address is a
 * capability, not a label.
 *
 * Each attempt at that attack is cheap by nature: the searcher does not do a
 * scalar multiply per candidate, they add the generator point to the previous
 * one and hash again (the trick in any Ed25519 vanity address generator). A
 * modern GPU does about 10^8 candidates per second, and that number never goes
 * down:
 *
 *    60 bits (3 words)  ~1.2×10^18 attempts  ~365 GPU-years
 *    70 bits            ~1.2×10^21            ~3.7×10^5 GPU-years
 *    80 bits (4 words)  ~1.2×10^24            ~3.8×10^8 GPU-years
 *   128 bits            what was here before everything
 *
 * That is why four words, not the three that aesthetics wanted: 365 GPU-years is a
 * few months of rental for someone who really means it, and a project that
 * pays the weight of a post-quantum KEM to defend against adversaries thirty
 * years out cannot leave the only anchor between key and name within reach of
 * an invoice.
 *
 * Writing in Latin changes none of this: `names.ts` is a bijection, proven word
 * by word across the whole space, and a bijection neither loses nor gains a bit.
 * Swapping alphabets is changing clothes; the body is these 80 bits.
 */
export function accountIdFromSigningKey(signingPublicKey: Uint8Array): string {
  return encodeName(sha256(signingPublicKey).subarray(0, ACCOUNT_ID_BYTES), ACCOUNT_ID_WORDS)
}

/** The 80 bits back, for anyone who needs to compare hashes, not text. */
export function accountIdToDigestPrefix(accountId: string): Uint8Array {
  return decodeName(accountId, ACCOUNT_ID_WORDS)
}

export function makeUserAddress(accountId: string, server: ServerName): UserAddress {
  return `@${accountId}:${server}` as UserAddress
}

export function makeSpaceAddress(spaceId: string, server: ServerName): SpaceAddress {
  return `!${spaceId}:${server}` as SpaceAddress
}

export interface ParsedAddress {
  sigil: "@" | "!"
  localPart: string
  server: ServerName
}

export function parseAddress(value: string): ParsedAddress {
  const sigil = value[0]
  if (sigil !== "@" && sigil !== "!") throw new Error(`address must start with @ or !: ${value}`)
  const separator = value.indexOf(":", 1)
  if (separator < 0) throw new Error(`address is missing a homeserver: ${value}`)
  const localPart = value.slice(1, separator)
  if (localPart.length === 0) throw new Error(`address has an empty local part: ${value}`)
  return { sigil, localPart, server: parseServerName(value.slice(separator + 1)) }
}

/** The homeserver responsible for an address. Federation routes on this alone. */
export function serverOf(address: UserAddress | SpaceAddress): ServerName {
  return parseAddress(address).server
}

// ------------------------------------------------------------ moradas opacas

/**
 * Opaque channel addresses (1.0 "Arca", `docs/planos/moradas-opacas-e-corte.md`).
 *
 * Until 0.9, a channel's address told the server things it should not know:
 * `!dm-<a>.<b>` named the two ends of each conversation, `!feed-<id>` the owner of
 * each mural, and a room went to disk with the name someone gave it
 * (`THREAT-MODEL.md`, "The channel id is not opaque"). From here on, all
 * channels have the same form, `!<40 caracteres base32>:<servidor>`, and the form says nothing: what a channel is
 * lives in the vault of whoever is a member.
 *
 * Twenty-five bytes, not the twenty the plan states. The plan asks for both
 * things at once ("twenty bytes" and "40 base32 characters"), and the two do not
 * fit together: twenty bytes in base32 are 32 characters. The form won, because the rest of 1.0
 * is written against it, and we got 200 bits instead of 160, which is
 * more, never less, than the unguessability promise. See the slice 1 write-up.
 *
 * The server part stays, because federation routes by it
 * (`federation.ts`).
 */
export const MORADA_BYTES = 25

/** 200 bits in base32 are exactly 40 characters, with no padding bits at the end. */
export const MORADA_CARACTERES = (MORADA_BYTES * 8) / 5

/*
  Domain tags, one per channel type. Without them, the same 32-byte secret used
  in two places would give the same address in both, and a secret leaked
  in one context would leak in the other. The `-v2` suffix names the channel form
  this replaces; a new derivation gets a new tag, never the same one.
*/
const ETIQUETA_DIRECTA = new TextEncoder().encode("orwell-dm-v2")
const ETIQUETA_MURAL = new TextEncoder().encode("orwell-feed-v2")
const ETIQUETA_CONTA = new TextEncoder().encode("orwell-self-v2")

/** The alphabet of `base32Encode` (no `l` or `o`), with the server validated separately. */
const FORMA_OPACA = /^!([a-kmnp-z2-9]{40}):(.+)$/

function moradaDeBytes(bytes: Uint8Array, servidor: ServerName): ChannelId {
  return `!${base32Encode(bytes.subarray(0, MORADA_BYTES))}:${parseServerName(servidor)}` as ChannelId
}

/** `H(etiqueta ‖ segredo)`, cut to fit the address. Same SHA-256 as account identifiers. */
function moradaDerivada(etiqueta: Uint8Array, segredo: Uint8Array, servidor: ServerName): ChannelId {
  const entrada = new Uint8Array(etiqueta.length + segredo.length)
  entrada.set(etiqueta, 0)
  entrada.set(segredo, etiqueta.length)
  return moradaDeBytes(sha256(entrada), servidor)
}

function exigirTrintaEDois(bytes: Uint8Array, nome: string): void {
  if (bytes.length !== 32) throw new Error(`${nome} must be 32 bytes, got ${bytes.length}`)
}

/**
 * Byte order of the two strings, not `localeCompare`: the order must be the same
 * on every device and in every system language, or the two sides pick different
 * servers and open two conversations.
 */
function compararBytes(a: string, b: string): number {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  const n = Math.min(x.length, y.length)
  for (let i = 0; i < n; i++) {
    const diferenca = (x[i] as number) - (y[i] as number)
    if (diferenca !== 0) return diferenca
  }
  return x.length - y.length
}

/**
 * The server for a direct conversation: the one of the SMALLER address in the
 * pair.
 *
 * Until 0.9 it was the server of whoever opened it (`Session.openDirect`),
 * which across two servers gave two addresses for the same conversation, one
 * from each side. Federation never ran, so it never caught this. Picking by the pair,
 * not by the caller, is what makes both sides reach the same place without
 * coordinating.
 */
export function servidorDaDirecta(enderecoA: string, enderecoB: string): ServerName {
  const menor = compararBytes(enderecoA, enderecoB) <= 0 ? enderecoA : enderecoB
  return parseAddress(menor).server
}

/**
 * The address of a direct conversation: `H("orwell-dm-v2" ‖ DH(A, B))`.
 *
 * Both sides must reach the same address without talking to each other, because
 * that is what stops two conversations for the same pair when both open it at
 * the same time. A Diffie-Hellman agreement does exactly that: each side uses
 * its own private key and the other's public key, and the result is the same.
 * The server has both public keys and neither private key, so it does not
 * compute it.
 *
 * Account keys are Ed25519 (signing) and the agreement is X25519. The
 * conversion is standard (the same as libsodium's
 * `crypto_sign_ed25519_*_to_curve25519`; in `@noble/curves` 2.0.1 it is called
 * `ed25519.utils.toMontgomery` and `toMontgomerySecret`). Using a signing key
 * in a key agreement is the classic caveat, and it matters little here: the agreed
 * secret neither encrypts nor signs anything, it is only hashed into an
 * address.
 *
 * It takes both addresses, not a server, for two reasons. The first is the
 * smaller-address rule for the server, which only holds with the pair in view; a server
 * passed by the caller was the old bug waiting to come back. The second is the
 * anchor between key and address: a public key swapped by mistake would give a
 * valid but wrong address, for a channel where the other side never shows up.
 * Here we check that each key belongs to the address it claims.
 */
export function moradaDirecta(
  chavePrivadaMinha: Uint8Array,
  chavePublicaDoPar: Uint8Array,
  meuEndereco: string,
  enderecoDoPar: string,
): ChannelId {
  exigirTrintaEDois(chavePrivadaMinha, "account private key")
  exigirTrintaEDois(chavePublicaDoPar, "peer public key")
  if (meuEndereco === enderecoDoPar) throw new Error("a direct conversation needs two different accounts")
  const minhaPublica = ed25519.getPublicKey(chavePrivadaMinha)
  if (parseAddress(meuEndereco).localPart !== accountIdFromSigningKey(minhaPublica)) {
    throw new Error("the private key does not belong to my address")
  }
  if (parseAddress(enderecoDoPar).localPart !== accountIdFromSigningKey(chavePublicaDoPar)) {
    throw new Error("the public key does not belong to the peer address")
  }
  const partilhado = x25519.getSharedSecret(
    ed25519.utils.toMontgomerySecret(chavePrivadaMinha),
    ed25519.utils.toMontgomery(chavePublicaDoPar),
  )
  // `@noble/curves` already rejects the all-zero result from a low-order point; we repeat the
  // check here because an address derived from zeros would be the same for every
  // pair that produced it, and this error must not depend on the library version.
  if (partilhado.every((byte) => byte === 0)) throw new Error("degenerate shared secret")
  return moradaDerivada(ETIQUETA_DIRECTA, partilhado, servidorDaDirecta(meuEndereco, enderecoDoPar))
}

/**
 * A mural's address: `H("orwell-feed-v2" ‖ segredo do mural)`.
 *
 * The secret (32 bytes) is generated once by the owner, stored in the vault, and travels
 * encrypted in the profile (`Profile.mural`) to whoever shares a channel with the owner.
 * Those without it do not know the address: this is what keeps the mural to friends and
 * co-members (decision D1 of the plan).
 */
export function moradaDoMural(segredo: Uint8Array, servidor: ServerName): ChannelId {
  exigirTrintaEDois(segredo, "feed secret")
  return moradaDerivada(ETIQUETA_MURAL, segredo, servidor)
}

/**
 * The address of the account's own channel: `H("orwell-self-v2" ‖ chave privada de conta)`.
 *
 * Deterministic for any device that has the account key, and the
 * server no longer sees `self-<id>`. Devices without the key receive the address
 * at pairing (slice 2). The hash does not give back the key: the address can
 * sit on the server's disk without putting the account at risk.
 */
export function moradaDaConta(chavePrivadaDeConta: Uint8Array, servidor: ServerName): ChannelId {
  exigirTrintaEDois(chavePrivadaDeConta, "account private key")
  return moradaDerivada(ETIQUETA_CONTA, chavePrivadaDeConta, servidor)
}

/**
 * The address of a new room: random bytes, with nothing behind them.
 *
 * The room name goes into `room.created` encrypted, like all other state. There
 * is nothing to derive and nothing the two sides need to agree on: whoever
 * creates the room picks the address at random and invites the others to it.
 */
export function moradaDeSala(servidor: ServerName): ChannelId {
  const bytes = new Uint8Array(MORADA_BYTES)
  globalThis.crypto.getRandomValues(bytes)
  return moradaDeBytes(bytes, servidor)
}

/**
 * Whether a channel identifier is in opaque form, and nothing else.
 *
 * Exactly 40 characters from the `base32Encode` alphabet, in lowercase, and a
 * server name that `parseServerName` accepts. Old forms (`!dm-…`, `!feed-…`,
 * `!self-…`, `!forum-…`) always have a hyphen and never pass. This checks the
 * FORM; what the channel is (DM, mural, room, account) is not read from here,
 * it comes from the vault.
 */
export function eMoradaOpaca(canal: string): boolean {
  const partes = FORMA_OPACA.exec(canal)
  if (!partes) return false
  const servidor = partes[2] as string
  // `parseServerName` accepts uppercase and normalizes; an address written by
  // `moradaDeBytes` already comes out normalized, and any other form is not this one.
  if (servidor !== servidor.toLowerCase()) return false
  try {
    parseServerName(servidor)
    return true
  } catch {
    return false
  }
}

/**
 * Whether the server allows a channel with this address to be created (1.0 "Arca"
 * 6a.1).
 *
 * An opaque address, or the common room the server announces in `hello` (empty or
 * `null` when there is none). Everything else is an old form, which no one can
 * create. The rule is the same on both sides: the server blocks creation with
 * it (`#formaFechada` in `gateway.ts`) and the core rejects it before saving the
 * group (`Session.createSpaceChannel`), so they never diverge.
 */
export function podeEstrearCanal(canal: string, salaComum: string | null | undefined): boolean {
  if (eMoradaOpaca(canal)) return true
  return !!salaComum && canal === salaComum
}

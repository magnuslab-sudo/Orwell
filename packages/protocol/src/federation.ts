import { ed25519 } from "@noble/curves/ed25519.js"
import { z } from "zod"
import { canonicalBytes, fromBase64, toBase64 } from "./canonical.js"
import { APARELHOS_POR_CONTA } from "./identity.js"
import { parseServerName, type ServerName } from "./ids.js"
import { DeviceManifestWire } from "./manifest.js"

/**
 * Server-to-server federation.
 *
 * Two properties matter here and they pull in different directions:
 *
 *  1. A receiving server must know which server vouched for a request, so it can
 *     rate-limit and defederate. That is the *origin* signature below.
 *  2. A receiving server must NOT learn which of the origin's users sent a given
 *     message. Discord's model has one operator seeing everything; federating
 *     naively just spreads that to N operators.
 *
 * So the envelope is signed by the origin server, never by the user, and carries
 * no user field. Sender attribution lives inside the MLS ciphertext, where only
 * group members can read it.
 */

export const FEDERATION_PATH = "/_enclave/federation/v1"

export const FederationBody = z.object({
  /** Channel (== MLS group) the payload belongs to. Opaque to both servers. */
  channel: z.string(),
  kind: z.enum(["application", "handshake", "welcome"]),
  ciphertext: z.string(),
  /** Only set for `welcome`, which targets exactly one joining member. */
  recipient: z.string().optional(),
})
export type FederationBody = z.infer<typeof FederationBody>

/**
 * The nonce for everything a server signs (FED-01, external audit at 1.1.0).
 *
 * Ours are 16 bytes drawn in base64url without padding: 22 characters. Between
 * 16 and 64, and only the base64url alphabet. Until now it was `z.string()`
 * with nothing more, and the receiver stored it on disk exactly as it came.
 */
export const NONCE_FEDERADO = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "expected a base64url nonce of 16 to 64 characters")

export const FederationEnvelope = z.object({
  origin: z.string(),
  destination: z.string(),
  /** Unix seconds. Receivers reject anything outside a tight window. */
  issuedAt: z.number().int().positive(),
  /** Random, remembered by the receiver until `issuedAt` ages out. Kills replay. */
  nonce: NONCE_FEDERADO,
  body: FederationBody,
  /** Ed25519 over the canonical form of every field above. */
  signature: z.string(),
  /** Which of the origin's advertised keys signed this. */
  keyId: z.string(),
})
export type FederationEnvelope = z.infer<typeof FederationEnvelope>

/** Widest gap between our clock and theirs that we tolerate, in seconds. */
export const CLOCK_SKEW_SECONDS = 120

export interface SigningKey {
  keyId: string
  privateKey: Uint8Array
}

export function signEnvelope(
  key: SigningKey,
  fields: { origin: ServerName; destination: ServerName; issuedAt: number; nonce: string; body: FederationBody },
): FederationEnvelope {
  const unsigned = {
    origin: fields.origin,
    destination: fields.destination,
    issuedAt: fields.issuedAt,
    nonce: fields.nonce,
    body: fields.body,
  }
  const signature = ed25519.sign(canonicalBytes(unsigned), key.privateKey)
  return { ...unsigned, keyId: key.keyId, signature: toBase64(signature) }
}

export type VerifyFailure = {
  ok: false
  reason: "bad-signature" | "wrong-destination" | "clock-skew" | "replay" | "unknown-key" | "bad-origin"
}

export type VerifyResult = { ok: true; body: FederationBody; origin: ServerName } | VerifyFailure

export interface VerifyOptions {
  /** Our own server name. An envelope addressed elsewhere is not ours to accept. */
  destination: ServerName
  /** Resolve `keyId` to the origin's advertised public key, or undefined. */
  resolveKey: (origin: ServerName, keyId: string) => Uint8Array | undefined
  /**
   * Spend the nonce: store the pair (origin, nonce) and return whether it was new. `false`
   * means it's a replay. Must be ONE atomic operation (on the server, an
   * `INSERT OR IGNORE`), so two concurrent uses cannot both pass.
   *
   * Called ONLY AFTER the signature verifies (FED-01): asking earlier would let
   * someone without the key spend nonces and write to the database.
   */
  spendNonce: (origin: ServerName, nonce: string) => boolean
  nowSeconds: number
}

/** The fields that anything signed by a server carries in its header. */
interface SignedHeader {
  origin: string
  destination: string
  issuedAt: number
  nonce: string
  keyId: string
  signature: string
}

/**
 * The four checks we run on anything a server signs: who it goes to, when it was
 * made, whether the signature verifies, and whether we've seen it before. In
 * this order: the first three do not write anything, and only what a pair
 * genuinely signed reaches the point of spending a nonce (FED-01).
 *
 * Written once and used by two, the delivery envelope and the key package
 * request, because the ceremony is the same and only the body changes. Two
 * copies of this function would be two chances for one to forget the nonce.
 */
function verifySignedHeader(
  header: SignedHeader,
  unsigned: unknown,
  options: VerifyOptions,
): { ok: true; origin: ServerName } | VerifyFailure {
  let origin: ServerName
  let destination: ServerName
  try {
    origin = parseServerName(header.origin)
    destination = parseServerName(header.destination)
  } catch {
    // A server name that is not actually a server name. Rejected here rather than
    // raised as an exception up the route: whoever sends garbage gets a rejection,
    // not a 500 saying we broke.
    return { ok: false, reason: "bad-origin" }
  }

  if (destination !== options.destination) return { ok: false, reason: "wrong-destination" }
  if (Math.abs(options.nowSeconds - header.issuedAt) > CLOCK_SKEW_SECONDS) return { ok: false, reason: "clock-skew" }

  const publicKey = options.resolveKey(origin, header.keyId)
  if (!publicKey) return { ok: false, reason: "unknown-key" }

  let valid = false
  try {
    valid = ed25519.verify(fromBase64(header.signature), canonicalBytes(unsigned), publicKey)
  } catch {
    valid = false
  }
  if (!valid) return { ok: false, reason: "bad-signature" }

  // Only now, with the signature verified. See `VerifyOptions.spendNonce`.
  if (!options.spendNonce(origin, header.nonce)) return { ok: false, reason: "replay" }

  return { ok: true, origin }
}

export function verifyEnvelope(envelope: FederationEnvelope, options: VerifyOptions): VerifyResult {
  const checked = verifySignedHeader(
    envelope,
    {
      origin: envelope.origin,
      destination: envelope.destination,
      issuedAt: envelope.issuedAt,
      nonce: envelope.nonce,
      body: envelope.body,
    },
    options,
  )
  if (!checked.ok) return checked
  return { ok: true, body: envelope.body, origin: checked.origin }
}

/**
 * A key package request, signed by whoever makes it.
 *
 * The route that serves key packages CONSUMES what it serves: each response
 * spends a package that is never delivered again. Deciding who can call it by
 * headers, the `Origin`, or an `X-Enclave-Server`, would let the caller decide:
 * anyone with a `curl` could write the name of a pair on the allowlist and drain
 * their pool, with the victim seeing only invites that never arrive. Even worse
 * on the production server, whose allowlist includes its own name: you just had
 * to claim you were it.
 *
 * A header proves nothing. This proves it: only whoever has the private key of
 * the server that the directory announces can sign, and each request is good once
 * (nonce) and for two minutes (clock).
 */
export const PeerClaim = z.object({
  origin: z.string(),
  destination: z.string(),
  issuedAt: z.number().int().positive(),
  nonce: NONCE_FEDERADO,
  /** The local account of whoever wants the key package. */
  address: z.string(),
  signature: z.string(),
  keyId: z.string(),
  /**
   * The same `bundle`/`devices` as in `keypackage.claim` from the gateway, so an
   * invite to someone on another server can account for all their devices.
   *
   * **Outside the signature, and that is a choice.** The signature covers the
   * five fields above and a pair on 0.2.3 verifies exactly those five: if these
   * went into the signed canonical form, each bundled request to an old server
   * would fail with `bad-signature`, and inviting someone there would stop working
   * altogether instead of degrading to a single package. Outside the signature,
   * the old pair discards them by schema and serves the singular. What the
   * signature proves does not change: whoever made it has the right to spend
   * packages from this account; these fields just say how many, and never more
   * than the devices in their manifest.
   */
  bundle: z.boolean().optional(),
  devices: z.array(z.string()).max(APARELHOS_POR_CONTA).optional(),
})
export type PeerClaim = z.infer<typeof PeerClaim>

export function signPeerClaim(
  key: SigningKey,
  fields: { origin: ServerName; destination: ServerName; issuedAt: number; nonce: string; address: string },
  extra: { bundle?: boolean; devices?: string[] } = {},
): PeerClaim {
  const unsigned = {
    origin: fields.origin,
    destination: fields.destination,
    issuedAt: fields.issuedAt,
    nonce: fields.nonce,
    address: fields.address,
  }
  const signature = ed25519.sign(canonicalBytes(unsigned), key.privateKey)
  return {
    ...unsigned,
    keyId: key.keyId,
    signature: toBase64(signature),
    ...(extra.bundle ? { bundle: true } : {}),
    ...(extra.devices ? { devices: extra.devices } : {}),
  }
}

export type PeerClaimResult = { ok: true; address: string; origin: ServerName } | VerifyFailure

/**
 * The body the `/keypackage` route responds with: the `keypackage.claimed` from
 * the gateway without `t` or `address`. A pair on 0.2.3 sends only `keyPackage`;
 * the other two fields come when the request had `bundle`, with the meaning from
 * there.
 */
export const PeerClaimReply = z.object({
  keyPackage: z.string().nullable(),
  keyPackages: z.array(z.object({ deviceKey: z.string(), keyPackage: z.string() })).max(APARELHOS_POR_CONTA).optional(),
  manifest: DeviceManifestWire.nullable().optional(),
})
export type PeerClaimReply = z.infer<typeof PeerClaimReply>

export function verifyPeerClaim(claim: PeerClaim, options: VerifyOptions): PeerClaimResult {
  const checked = verifySignedHeader(
    claim,
    {
      origin: claim.origin,
      destination: claim.destination,
      issuedAt: claim.issuedAt,
      nonce: claim.nonce,
      address: claim.address,
    },
    options,
  )
  if (!checked.ok) return checked
  return { ok: true, address: claim.address, origin: checked.origin }
}

/** Served at `/_enclave/federation/v1/keys` so peers can verify our envelopes. */
export const ServerKeyDirectory = z.object({
  server: z.string(),
  validUntil: z.number().int().positive(),
  keys: z.record(z.string(), z.object({ key: z.string() })),
})
export type ServerKeyDirectory = z.infer<typeof ServerKeyDirectory>

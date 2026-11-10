import { ed25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"
import {
  accountIdFromSigningKey,
  base32Encode,
  makeUserAddress,
  parseAddress,
  type ServerName,
  type UserAddress,
} from "./ids.js"

/**
 * The long-term account identity.
 *
 * There is no password, no email, no phone number. The private key *is* the
 * account. That removes the recovery flow, and with it the identity-verification
 * data every recovery flow forces a service to collect. Losing the key means
 * losing the account: that trade is the point.
 *
 * **Account and device are two keys, and the distinction is the whole point.**
 * `signingPublicKey` is the ACCOUNT key: the address is the hash of it and
 * nothing else, today and tomorrow. `deviceSigningPublicKey` is the DEVICE key,
 * and it is that one that signs the MLS leaf. The account signs the device key
 * once (`credential`), and that chain is what travels in the leaf's credential.
 *
 * Today there is one device per account and the two keys are born together, so
 * none of this shows. It exists so that it becomes possible to see without
 * changing addresses: adding a second device is signing it another certificate,
 * and the address, which is capability not a label, see `accountIdFromSigningKey`
 *, does not change.
 */
export interface Identity {
  /** ACCOUNT key. The address is the hash of this, and the hash never rotates. */
  readonly signingPublicKey: Uint8Array
  /**
   * The PRIVATE account key, when this device has it.
   *
   * Optional since pairing: a paired device receives the address, the account
   * public key and its device key's certificate, and **never this**. With
   * what it receives it logs into the server (the chain-based login only sends
   * the public key), publishes key packages, signs leaves, reads and writes.
   * What it cannot do is sign manifests, certificates and revocations: that
   * is exactly what we want, because it is what makes revocation possible (a
   * device without the private key cannot put itself back in the manifest). See
   * `identityFromDeviceCert` and `temChaveDeConta`.
   */
  readonly signingPrivateKey?: Uint8Array
  /** DEVICE key. Signs MLS leaves and the login challenge. */
  readonly deviceSigningPublicKey: Uint8Array
  readonly deviceSigningPrivateKey: Uint8Array
  /** The chain ready to go inside the leaf's `basic credential`. */
  readonly credential: DeviceCredential
  readonly accountId: string
  readonly address: UserAddress
}

export interface PublicIdentity {
  readonly signingPublicKey: Uint8Array
  readonly address: UserAddress
}

/** An identity that HAS the account private key: the one that created the account, or imported it. */
export type AccountIdentity = Identity & { readonly signingPrivateKey: Uint8Array }

/**
 * Does this device have the account key?
 *
 * It is the gate to everything the account signs: manifests, certificates,
 * revocations. A paired device answers no, and whoever calls this decides
 * what to do with the no (do not publish, show the phrase, hide the button),
 * instead of discovering the absence in an exception mid-commit.
 */
export function temChaveDeConta(identity: Identity): identity is AccountIdentity {
  return identity.signingPrivateKey !== undefined
}

export function generateIdentity(server: ServerName): AccountIdentity {
  const signingPrivateKey = ed25519.utils.randomSecretKey()
  return identityFromPrivateKey(signingPrivateKey, server)
}

/**
 * Build the identity from the private keys.
 *
 * The device key is a parameter and not a derivation from the account on
 * purpose: deriving it would bring convenience and take away its meaning, two
 * devices with the same account would have the same leaf key, and revoking one
 * would revoke both. Whoever calls passes the one they have stored; whoever
 * has none receives a new one, which is the case on first startup of an
 * account.
 */
export function identityFromPrivateKey(
  signingPrivateKey: Uint8Array,
  server: ServerName,
  deviceSigningPrivateKey: Uint8Array = ed25519.utils.randomSecretKey(),
): AccountIdentity {
  const signingPublicKey = ed25519.getPublicKey(signingPrivateKey)
  const deviceSigningPublicKey = ed25519.getPublicKey(deviceSigningPrivateKey)
  const accountId = accountIdFromSigningKey(signingPublicKey)
  const address = makeUserAddress(accountId, server)
  return {
    signingPrivateKey,
    signingPublicKey,
    deviceSigningPrivateKey,
    deviceSigningPublicKey,
    credential: {
      address,
      accountKey: signingPublicKey,
      deviceKey: deviceSigningPublicKey,
      signature: signDeviceCert(signingPrivateKey, deviceSigningPublicKey, address),
    },
    accountId,
    address,
  }
}

/**
 * A new device key, for a device that does not yet have an account.
 *
 * This is what the phone generates before joining the pairing vault: the
 * public one goes in the SAS and is what the account certifies; the private
 * one stays in its vault and nowhere else. Here, not in the core, because this
 * is where the curve lives.
 */
export function generateDeviceKey(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = ed25519.utils.randomSecretKey()
  return { privateKey, publicKey: ed25519.getPublicKey(privateKey) }
}

/** The public key of a stored device key. */
export function devicePublicKeyOf(deviceSigningPrivateKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(deviceSigningPrivateKey)
}

/**
 * The identity of a PAIRED device: the device key is from this vault, the
 * certificate came from the device that has the account, and the account
 * private key is not here nor is anything minted.
 *
 * **Never mints the certificate** (it cannot: it has nothing to sign it with)
 * and **rejects a chain that does not close**, with `verifyDeviceChain`,
 * before accepting anything. A vault with a certificate from another account,
 * or signed over another device key, does not open as any identity: it is
 * better to throw here, once, on opening, than to present to the server with
 * a chain it refuses on every connection.
 *
 * The server comes from the address, which is part of what the account signed.
 * It is not a parameter because it cannot be: changing it would change what
 * is signed.
 */
export function identityFromDeviceCert(cofre: {
  address: string
  accountKey: Uint8Array
  deviceSigningPrivateKey: Uint8Array
  signature: Uint8Array
}): Identity {
  const deviceSigningPublicKey = ed25519.getPublicKey(cofre.deviceSigningPrivateKey)
  const credential: DeviceCredential = {
    address: cofre.address as UserAddress,
    accountKey: cofre.accountKey,
    deviceKey: deviceSigningPublicKey,
    signature: cofre.signature,
  }
  if (!verifyDeviceChain(credential)) throw new Error("o certificado deste aparelho não fecha com a conta")
  return {
    signingPublicKey: cofre.accountKey,
    deviceSigningPrivateKey: cofre.deviceSigningPrivateKey,
    deviceSigningPublicKey,
    credential,
    accountId: accountIdFromSigningKey(cofre.accountKey),
    address: credential.address,
  }
}

export function toPublicIdentity(identity: Identity): PublicIdentity {
  return { signingPublicKey: identity.signingPublicKey, address: identity.address }
}

/**
 * Sign with the ACCOUNT key, the one that authorizes devices and proves the
 * address.
 *
 * Throws without it. There is no "almost" account signature: a paired device
 * that reaches here is a defect of whoever called without asking
 * `temChaveDeConta`.
 */
export function sign(identity: Identity, message: Uint8Array): Uint8Array {
  if (!temChaveDeConta(identity)) throw new Error("este aparelho não tem a chave da conta")
  return ed25519.sign(message, identity.signingPrivateKey)
}

/**
 * Sign with the DEVICE key.
 *
 * This is the one that answers the server's challenge when the chain travels
 * in `auth.begin`: proving device possession is what login needs, and forcing
 * the account key to be present on every connection would force it to live on
 * all devices, exactly what the separation exists to prevent.
 */
export function signWithDevice(identity: Identity, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, identity.deviceSigningPrivateKey)
}

export function verify(signingPublicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, signingPublicKey)
  } catch {
    return false
  }
}

/**
 * Safety number for out-of-band verification between two members, in the sense
 * of Signal's. Both sides compute it from the same two keys and read it aloud;
 * a mismatch means someone is sitting in the middle. Order-independent so both
 * sides see the same string.
 */
export function safetyNumber(a: Uint8Array, b: Uint8Array): string {
  const [first, second] = compareBytes(a, b) <= 0 ? [a, b] : [b, a]
  const combined = new Uint8Array(first.length + second.length)
  combined.set(first, 0)
  combined.set(second, first.length)

  // Iterated hashing so a brute-force search for a colliding-looking key is
  // expensive rather than instant.
  let digest = sha256(combined)
  for (let i = 0; i < 5200; i++) digest = sha256(digest)

  const encoded = base32Encode(digest.subarray(0, 20))
  return (encoded.match(/.{1,4}/g) ?? []).join(" ")
}

// ------------------------------------------------------- account and device

/** Ed25519: public keys 32 bytes, signatures 64 bytes. Fixed, and so verifiable. */
const KEY_BYTES = 32
const SIGNATURE_BYTES = 64

/**
 * How many devices an account can have at the same time.
 *
 * Four, by owner decision (docs/planos/MULTIDISPOSITIVO.md, August 11, 2026).
 * Signal gives five; here each device is a complete MLS leaf in each person's
 * channel, and a leaf's cost is paid in all commits and all Welcomes in that
 * channel, for everyone there. A computer, a laptop, a phone and a backup is
 * what a person uses; the fifth is almost always a reinstall that nobody
 * remembers.
 *
 * One number here, because it is read in two places that must agree: the
 * server, which does not store more lines than this per account (`registerDevice`),
 * and the device manifest, which does not list more keys than this. Two
 * numbers would be two caps, and the day they diverged was a manifest the
 * server cannot honor.
 */
export const APARELHOS_POR_CONTA = 4

/**
 * The chain proving this device speaks for this account.
 *
 * Three facts and a signature: the address, the account key it derives from,
 * the device key, and the account saying that device is theirs. Validators
 * recompute the hash and check the signature, no certificate authority
 * underneath, just as there was none before.
 */
export interface DeviceCredential {
  readonly address: UserAddress
  readonly accountKey: Uint8Array
  readonly deviceKey: Uint8Array
  /** From the account, about `deviceCertMessage(deviceKey, address)`. */
  readonly signature: Uint8Array
}

/** `orwc`, so a credential for something else does not slip through by accident. */
const CREDENTIAL_MAGIC = Uint8Array.of(0x6f, 0x72, 0x77, 0x63)

/**
 * Version of the credential format.
 *
 * v1 was the address in UTF-8 and nothing else. v2 does not read it or try to:
 * the split between account and device falls in the full-restart window, where
 * there is no old sheet to read, and a reader accepting both would be a reader
 * with two meanings for "who is this", that is how you split an identity in
 * two instead of migrating it.
 */
export const CREDENTIAL_VERSION = 2

/** magic + version + account + device + signature + address length. */
const CREDENTIAL_HEADER_BYTES = CREDENTIAL_MAGIC.length + 1 + KEY_BYTES + KEY_BYTES + SIGNATURE_BYTES + 2

/**
 * What the account signs to certify a device.
 *
 * The context at the head separates domains: without it, a signature collected
 * elsewhere in the protocol, a login challenge, for example, could be
 * replayed here as a certificate. The address goes inside to bind the
 * certificate to the account AND the server: the same device on another server
 * needs another certificate, and that is what we want.
 */
export function deviceCertMessage(deviceKey: Uint8Array, address: string): Uint8Array {
  const context = new TextEncoder().encode("orwell:device-cert:v1\0")
  const addressBytes = new TextEncoder().encode(address)
  const message = new Uint8Array(context.length + deviceKey.length + addressBytes.length)
  message.set(context, 0)
  message.set(deviceKey, context.length)
  message.set(addressBytes, context.length + deviceKey.length)
  return message
}

export function signDeviceCert(
  accountPrivateKey: Uint8Array,
  deviceKey: Uint8Array,
  address: string,
): Uint8Array {
  return ed25519.sign(deviceCertMessage(deviceKey, address), accountPrivateKey)
}

/**
 * The full chain, validated: **returns, never throws**.
 *
 * The caller is deciding whether to admit a leaf in the tree, and the
 * contracted refusal is silence, the leaf does not enter and the session
 * continues. An exception coming out of here would be a failure outside the
 * contract, rising by a path that does not always catch it.
 */
export function verifyDeviceChain(credential: {
  address: string
  accountKey: Uint8Array
  deviceKey: Uint8Array
  signature: Uint8Array
}): boolean {
  // From `decodeDeviceCredential` these checks are always sound, but this is
  // also called with loose bytes from the wire (see `auth.begin` on the gateway),
  // and there a key of the wrong size is what you expect from a broken client.
  // Without them the refusal came from the `verify` `try`, which is far from
  // where the reason becomes clear.
  if (credential.accountKey.length !== KEY_BYTES) return false
  if (credential.deviceKey.length !== KEY_BYTES) return false
  if (credential.signature.length !== SIGNATURE_BYTES) return false

  let parsed
  try {
    parsed = parseAddress(credential.address)
  } catch {
    return false
  }
  // A space (`!`) never signs anything: secrecy is part of the identity, not
  // decoration of the text.
  if (parsed.sigil !== "@") return false
  if (parsed.localPart !== accountIdFromSigningKey(credential.accountKey)) return false

  return verify(credential.accountKey, deviceCertMessage(credential.deviceKey, credential.address), credential.signature)
}

/**
 * Deterministic encoding, because this is compared byte by byte.
 *
 * Fixed-size fields in fixed order, and only one variable field at the end
 * with the length upfront. No JSON and no maps: two encodings of the same
 * credential must give the same bytes, or the same leaf looks like two.
 */
export function encodeDeviceCredential(credential: DeviceCredential): Uint8Array {
  if (credential.accountKey.length !== KEY_BYTES) throw new Error("chave de conta com tamanho errado")
  if (credential.deviceKey.length !== KEY_BYTES) throw new Error("chave de aparelho com tamanho errado")
  if (credential.signature.length !== SIGNATURE_BYTES) throw new Error("assinatura com tamanho errado")

  const address = new TextEncoder().encode(credential.address)
  if (address.length > 0xffff) throw new Error("endereço grande de mais para uma credencial")

  const out = new Uint8Array(CREDENTIAL_HEADER_BYTES + address.length)
  let at = 0
  out.set(CREDENTIAL_MAGIC, at)
  at += CREDENTIAL_MAGIC.length
  out[at++] = CREDENTIAL_VERSION
  out.set(credential.accountKey, at)
  at += KEY_BYTES
  out.set(credential.deviceKey, at)
  at += KEY_BYTES
  out.set(credential.signature, at)
  at += SIGNATURE_BYTES
  out[at++] = (address.length >>> 8) & 0xff
  out[at++] = address.length & 0xff
  out.set(address, at)
  return out
}

/**
 * The reverse, and the same rule: **returns `undefined`, never throws**.
 *
 * The length is checked to the byte. One byte too many at the end is not a
 * field we do not yet know how to read, it is a credential we did not write,  * and accepting it would open the door to two encodings of the same leaf.
 */
export function decodeDeviceCredential(bytes: Uint8Array): DeviceCredential | undefined {
  // Defense in depth, not the guard that refuses: a short buffer already dies at
  // the magic, because `bytes[i]` past the end gives `undefined` and no byte is
  // `undefined`. It stays because that is what makes the reads below obviously
  // safe instead of safe by accident, and whoever removes it will see no test
  // fall, which is reason to leave it be, not reason to delete it.
  if (bytes.length < CREDENTIAL_HEADER_BYTES) return undefined
  for (let i = 0; i < CREDENTIAL_MAGIC.length; i++) {
    if (bytes[i] !== CREDENTIAL_MAGIC[i]) return undefined
  }

  let at = CREDENTIAL_MAGIC.length
  if (bytes[at++] !== CREDENTIAL_VERSION) return undefined

  const accountKey = bytes.subarray(at, at + KEY_BYTES)
  at += KEY_BYTES
  const deviceKey = bytes.subarray(at, at + KEY_BYTES)
  at += KEY_BYTES
  const signature = bytes.subarray(at, at + SIGNATURE_BYTES)
  at += SIGNATURE_BYTES

  const addressLength = ((bytes[at] as number) << 8) | (bytes[at + 1] as number)
  at += 2
  // Equality, not "good enough for the address": with `>=`, the same credential
  // would have infinite encodings, the right one, and the right one with garbage
  // stuck at the back. This is compared byte by byte, and two writes of the same
  // fact would look like two facts.
  if (bytes.length !== at + addressLength) return undefined

  let address
  try {
    address = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(at, at + addressLength))
  } catch {
    return undefined
  }

  return { address: address as UserAddress, accountKey, deviceKey, signature }
}

/**
 * What the account signs to revoke one of its devices, see `device.revoke`.
 *
 * Its own context, because a certificate and a revocation cannot be the same
 * signature read backwards.
 */
export function deviceRevocationMessage(deviceKey: Uint8Array, address: string): Uint8Array {
  const context = new TextEncoder().encode("orwell:device-revoke:v1\0")
  const addressBytes = new TextEncoder().encode(address)
  const message = new Uint8Array(context.length + deviceKey.length + addressBytes.length)
  message.set(context, 0)
  message.set(deviceKey, context.length)
  message.set(addressBytes, context.length + deviceKey.length)
  return message
}

export function signDeviceRevocation(
  accountPrivateKey: Uint8Array,
  deviceKey: Uint8Array,
  address: string,
): Uint8Array {
  return ed25519.sign(deviceRevocationMessage(deviceKey, address), accountPrivateKey)
}

/** Checks the revocation against the ACCOUNT key. Returns, never throws. */
export function verifyDeviceRevocation(
  accountKey: Uint8Array,
  deviceKey: Uint8Array,
  address: string,
  signature: Uint8Array,
): boolean {
  if (accountKey.length !== KEY_BYTES) return false
  if (deviceKey.length !== KEY_BYTES) return false
  if (signature.length !== SIGNATURE_BYTES) return false
  return verify(accountKey, deviceRevocationMessage(deviceKey, address), signature)
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const left = a[i] as number
    const right = b[i] as number
    if (left !== right) return left - right
  }
  return a.length - b.length
}

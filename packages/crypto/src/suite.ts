import { decodeDeviceCredential, EXTENSAO_PERMISSOES, EXTENSAO_RETRATO, verifyDeviceChain } from "@enclave/protocol"
import {
  defaultCapabilities,
  defaultKeyPackageEqualityConfig,
  defaultLifetimeConfig,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  type AuthenticationService,
  type Capabilities,
  type CiphersuiteImpl,
  type CiphersuiteName,
  type ClientConfig,
  type Credential,
  type PaddingConfig,
} from "ts-mls"

/**
 * Ciphersuite choice.
 *
 * X-Wing is a hybrid KEM: X25519 *and* ML-KEM-768, combined so that breaking it
 * requires breaking both. That matters more here than in most applications
 * because of harvest-now-decrypt-later — a community's archive is a standing
 * target, and traffic captured today outlives the classical assumptions it was
 * encrypted under. The cost is bigger key packages and commits; for chat-sized
 * messages that is not a bottleneck.
 *
 * ChaCha20-Poly1305 over AES-GCM: constant-time in software on every platform,
 * with no dependence on AES hardware being present and correctly used.
 */
export const DEFAULT_CIPHERSUITE: CiphersuiteName = "MLS_256_XWING_CHACHA20POLY1305_SHA512_Ed25519"

/**
 * A classical fallback, for peers that cannot do post-quantum yet. Still a
 * perfectly respectable suite — it is what most MLS deployments run today.
 */
export const FALLBACK_CIPHERSUITE: CiphersuiteName = "MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519"

const suiteCache = new Map<CiphersuiteName, Promise<CiphersuiteImpl>>()

export function loadSuite(name: CiphersuiteName = DEFAULT_CIPHERSUITE): Promise<CiphersuiteImpl> {
  let pending = suiteCache.get(name)
  if (!pending) {
    pending = getCiphersuiteImpl(getCiphersuiteFromName(name))
    suiteCache.set(name, pending)
  }
  return pending
}

/**
 * The capabilities of each of our leaves.
 *
 * With `EXTENSAO_RETRATO` in `extensions` since 1.1: this is how the inviter
 * knows this leaf reads the Welcome snapshot (`declaraRetrato` in `group.ts`).
 * Only here, never in `required_capabilities` in the group context: there
 * it would kick out the leaves of 1.0.x clients, which do not declare it.
 */
export function enclaveCapabilities(): Capabilities {
  const base = defaultCapabilities()
  return {
    ...base,
    ciphersuites: [DEFAULT_CIPHERSUITE, FALLBACK_CIPHERSUITE],
    // `EXTENSAO_PERMISSOES` since 1.2: reads the permissions model (see `permissoes.ts`).
    extensions: [
      ...base.extensions.filter((tipo) => tipo !== EXTENSAO_RETRATO && tipo !== EXTENSAO_PERMISSOES),
      EXTENSAO_RETRATO,
      EXTENSAO_PERMISSOES,
    ],
  }
}

/**
 * Pad every application message out to 512 bytes.
 *
 * Ciphertext length leaks. "ok" and a paragraph of dissent are trivially
 * distinguishable to anyone watching the socket, and over a conversation those
 * lengths reconstruct a surprising amount of structure. Fixed-bucket padding
 * costs bandwidth we can afford and removes the signal.
 */
export const enclavePaddingConfig: PaddingConfig = { kind: "padUntilLength", padUntilLength: 512 }

/**
 * Bind the claimed address to the key that signs for it.
 *
 * MLS by itself will happily let a member put any string in their credential.
 * Left unchecked, `@mallory:evil.example` can join a space and present itself as
 * `@alice:enclave.example` to every other member: the transport is encrypted
 * and the impersonation still works.
 *
 * Enclave closes this without a PKI: an account id *is* a hash of its signing
 * key, so any member can recompute it locally and reject a mismatch. There is no
 * certificate authority to trust and no revocation list to fetch.
 *
 * **v2 validates a chain instead of a direct digest.** The leaf stopped being
 * signed by the account key and now is signed by the device key, so the direct
 * digest no longer matches (and must never match again, or the address would depend
 * on the device). Three links are checked:
 *
 *   1. the address is the digest of the account key written in the credential;
 *   2. the account key signed the device key written in the credential;
 *   3. that device key is the one signing this leaf.
 *
 * Without the third link, anyone could copy someone else's credential to their
 * leaf: the first two would still match, and the leaf would belong to whoever wanted it.
 * The root of trust is the same as always (the address is the digest of the key),
 * only now it is the account key.
 *
 * **Nothing here throws.** A credential that is unreadable, truncated, has an extra byte,
 * or has a wrong signature returns `false`, and the leaf is rejected silently.
 */
export const addressBindingAuthService: AuthenticationService = {
  async validateCredential(credential: Credential, signaturePublicKey: Uint8Array): Promise<boolean> {
    if (credential.credentialType !== "basic") return false
    try {
      const chain = decodeDeviceCredential(credential.identity)
      if (!chain) return false
      if (!verifyDeviceChain(chain)) return false
      // Third link: the leaf must be signed by the device that the account certified,
      // not by some other device showing someone else's certificate.
      return equalBytes(chain.deviceKey, signaturePublicKey)
    } catch {
      return false
    }
  },
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * How long to keep old epoch keys around for out-of-order delivery.
 *
 * Every retained key is a key an attacker who seizes the device can still use,
 * so this is a forward-secrecy dial, not a reliability dial. Two epochs and a
 * short generation window absorbs normal reordering without holding history open.
 */
export function enclaveClientConfig(): ClientConfig {
  return {
    paddingConfig: enclavePaddingConfig,
    authService: addressBindingAuthService,
    lifetimeConfig: defaultLifetimeConfig,
    keyPackageEqualityConfig: defaultKeyPackageEqualityConfig,
    keyRetentionConfig: {
      retainKeysForGenerations: 64,
      retainKeysForEpochs: 2,
      maximumForwardRatchetSteps: 512,
    },
  }
}

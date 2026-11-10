import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { ed25519, x25519 } from "@noble/curves/ed25519.js"
import { hkdf } from "@noble/hashes/hkdf.js"
import { sha256 } from "@noble/hashes/sha2.js"

/**
 * The seal on the copy that goes to the owner (`docs/planos/denuncias-design.md`, §6.2).
 *
 * The reporter seals the copy with the owner's ACCOUNT key (Ed25519,
 * converted to X25519 as in `ids.ts`). The seal carries no sender: the key
 * used to seal is ephemeral, generated for this seal and forgotten after. The
 * server stores and delivers it, but doesn't open it; the owner opens it and
 * doesn't know who sent it.
 *
 * - key = HKDF-SHA256(x25519(ephemeral, account), empty salt,
 *   info "orwell-selo-v1\0" || e || contaEd25519, 32)
 * - XChaCha20-Poly1305, 24-byte nonce, AAD "orwell-denuncia-copia-v1\0" + aad
 *
 * The ephemeral and account go into `info`: the seal is locked to this account
 * and this ephemeral, and you can't change one without breaking the key.
 */

const INFO = new TextEncoder().encode("orwell-selo-v1\0")
const ROTULO_DO_AAD = "orwell-denuncia-copia-v1\0"
const BYTES_DO_NONCE = 24
const BYTES_DA_CHAVE = 32

export interface Selado {
  /** The ephemeral X25519 public key. */
  e: Uint8Array
  n: Uint8Array
  c: Uint8Array
}

function chaveDoSelo(partilhado: Uint8Array, efemera: Uint8Array, contaEd25519: Uint8Array): Uint8Array {
  // A secret of zeros would be the same for any pair: the guard in `historico.ts`.
  if (partilhado.every((byte) => byte === 0)) throw new Error("degenerate shared secret")
  const info = new Uint8Array(INFO.length + efemera.length + contaEd25519.length)
  info.set(INFO, 0)
  info.set(efemera, INFO.length)
  info.set(contaEd25519, INFO.length + efemera.length)
  return hkdf(sha256, partilhado, new Uint8Array(0), info, BYTES_DA_CHAVE)
}

const aadDe = (aad: string): Uint8Array => new TextEncoder().encode(ROTULO_DO_AAD + aad)

/**
 * Seal `text` for the account that owns `chavePublicaDeConta` (Ed25519, 32 bytes).
 *
 * @throws if the key is not a valid Ed25519 point.
 */
export function selarParaConta(chavePublicaDeConta: Uint8Array, aad: string, texto: Uint8Array): Selado {
  const privadaEfemera = x25519.utils.randomSecretKey()
  const e = x25519.getPublicKey(privadaEfemera)
  const partilhado = x25519.getSharedSecret(privadaEfemera, ed25519.utils.toMontgomery(chavePublicaDeConta))
  const chave = chaveDoSelo(partilhado, e, chavePublicaDeConta)
  const n = globalThis.crypto.getRandomValues(new Uint8Array(BYTES_DO_NONCE))
  const c = xchacha20poly1305(chave, n, aadDe(aad)).encrypt(texto)
  privadaEfemera.fill(0)
  chave.fill(0)
  return { e, n, c }
}

/**
 * Open a seal with the account private key (Ed25519, 32 bytes). `null` if it is
 * not for this account, if the `aad` is not the seal's, or if any byte changed.
 * Never throws.
 */
export function abrirComConta(chavePrivadaDeConta: Uint8Array, aad: string, selado: Selado): Uint8Array | null {
  if (selado.e.length !== 32 || selado.n.length !== BYTES_DO_NONCE) return null
  try {
    const contaEd25519 = ed25519.getPublicKey(chavePrivadaDeConta)
    const partilhado = x25519.getSharedSecret(ed25519.utils.toMontgomerySecret(chavePrivadaDeConta), selado.e)
    const chave = chaveDoSelo(partilhado, selado.e, contaEd25519)
    try {
      return xchacha20poly1305(chave, selado.n, aadDe(aad)).decrypt(selado.c)
    } finally {
      chave.fill(0)
    }
  } catch {
    return null
  }
}

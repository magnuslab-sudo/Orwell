import { ed25519 } from "@noble/curves/ed25519.js"
import { hkdf } from "@noble/hashes/hkdf.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { fromBase64, toBase64 } from "./canonical.js"

/**
 * The proof of an invite code (1.0 "Arca", slice 2).
 *
 * **The flaw.** Through 0.9.x, `invite.redeem` sent the `codeHash` (the
 * `sha256` of the code), and the server compared it against what it had in the
 * `invites` table. The table stores that same `codeHash`. Anyone with a copy of
 * the database (a stolen backup, a discarded drive) could request entry with it
 * without ever seeing the link, and the member who was online would admit them,
 * because the hash was one they had minted themselves.
 *
 * **The choice.** The code never reaches the server, neither in clear nor as a
 * hash that grants entry. An Ed25519 key pair is derived from the code (HKDF,
 * with domain separation). Whoever creates the invite sends the server only the
 * PUBLIC key (`codeKey`, in `invite.create`); whoever redeems signs the request
 * with the private one (`prova`, in `invite.redeem`). The database stores the
 * public key, and you cannot sign anything with a public key: a copy of the
 * database no longer suffices for entry.
 *
 * This was preferred over an HMAC of the code over a server challenge: to verify
 * an HMAC the server would have to store the HMAC key, and anyone who copied the
 * database would get it. This was preferred to sending the code and having the
 * server compare the hash, because then the server (and its logs) would see the
 * code in clear on each redemption.
 *
 * **What gets signed.** The domain, the `codeHash`, the caller's address, and
 * the `sha256` of the key package. No server challenge, and on purpose: a proof
 * replayed only requests entry again for the SAME account with the SAME key
 * package, and each request spends one use of the invite. A stolen proof does
 * not work for anyone else, because the server checks the address of the link.
 */
const DOMINIO_DA_CHAVE = new TextEncoder().encode("orwell/convite/chave-da-prova/v1")
const DOMINIO_DA_MENSAGEM = "orwell/convite/resgate/v1"

/** The key pair for the proof, derived from the link code (the string as it appears in the URL). */
export function chaveDaProvaDoConvite(codigo: string): { privada: Uint8Array; publica: Uint8Array } {
  const privada = hkdf(sha256, new TextEncoder().encode(codigo), undefined, DOMINIO_DA_CHAVE, 32)
  return { privada, publica: ed25519.getPublicKey(privada) }
}

/** The bytes being signed. See the module comment. */
export function mensagemDaProvaDoConvite(pedido: { codeHash: string; address: string; keyPackage: string }): Uint8Array {
  const pacote = toBase64(sha256(fromBase64(pedido.keyPackage)))
  return new TextEncoder().encode([DOMINIO_DA_MENSAGEM, pedido.codeHash, pedido.address, pacote].join("\n"))
}

/** The proof, in base64url, that goes in `invite.redeem`. */
export function provarCodigoDoConvite(
  codigo: string,
  pedido: { codeHash: string; address: string; keyPackage: string },
): string {
  const { privada } = chaveDaProvaDoConvite(codigo)
  try {
    return toBase64(ed25519.sign(mensagemDaProvaDoConvite(pedido), privada))
  } finally {
    privada.fill(0)
  }
}

/** The server verifies the proof against the public key the creator registered. Never throws. */
export function verificarProvaDoConvite(
  codeKey: string,
  prova: string,
  pedido: { codeHash: string; address: string; keyPackage: string },
): boolean {
  try {
    return ed25519.verify(fromBase64(prova), mensagemDaProvaDoConvite(pedido), fromBase64(codeKey))
  } catch {
    return false
  }
}

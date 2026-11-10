import { chaveDaProvaDoConvite, generateIdentity, parseServerName, provarCodigoDoConvite, toBase64 } from "@enclave/protocol"
import { generateKeyPackages } from "@enclave/crypto"
import { sha256 } from "@noble/hashes/sha2.js"

/**
 * A real MLS key package, made once per test file.
 *
 * Since INV-02 the server checks that the redeem `keyPackage` is an MLS key
 * package (the header) and fits within the limit. Tests that only need to seat
 * someone sent eight zero bytes. The server does not read the credential inside
 * (that is for members), so a package from another account works.
 */
const [PACOTE] = await generateKeyPackages(generateIdentity(parseServerName("localhost")), 1)
if (!PACOTE) throw new Error("sem key package para os testes")
export const PACOTE_DE_TESTE = toBase64(PACOTE.wire)

/**
 * An invite as 1.0 creates it, for tests that build it by hand with raw clients.
 *
 * Since slice 6a an invite without `codeKey` does not redeem, and a redeem
 * without the code proof also does not: the `codeHash` is in the `invites` table,
 * and accepting it alone would let in anyone with a copy of the database. Tests
 * that only needed to seat a second account sent the hash alone; this helper
 * gives them what 1.0 sends, without each file repeating the derivation.
 */
export interface ConviteComProva {
  /** What goes in `invite.create`, besides the channel and the policy. */
  readonly criar: { codeHash: string; codeKey: string }
  /** The entire `invite.redeem` for `address` with this `keyPackage`. */
  resgate(address: string, keyPackage?: string): { t: "invite.redeem"; codeHash: string; keyPackage: string; prova: string }
}

export function conviteComProva(): ConviteComProva {
  const codigo = toBase64(crypto.getRandomValues(new Uint8Array(24)))
  const codeHash = toBase64(sha256(new TextEncoder().encode(codigo)))
  const codeKey = toBase64(chaveDaProvaDoConvite(codigo).publica)
  return {
    criar: { codeHash, codeKey },
    resgate(address, keyPackage = PACOTE_DE_TESTE) {
      return { t: "invite.redeem", codeHash, keyPackage, prova: provarCodigoDoConvite(codigo, { codeHash, address, keyPackage }) }
    },
  }
}

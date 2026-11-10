import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { x25519 } from "@noble/curves/ed25519.js"
import { hkdf } from "@noble/hashes/hkdf.js"
import { sha256 } from "@noble/hashes/sha2.js"

/**
 * History encryption between devices of the same account (1.0 "Arca").
 *
 * History moves from one device to another in ephemeral channel signals
 * (`channel.sinal`). These signals already travel encrypted with a key from the
 * MLS epoch of the account channel (`sinal.ts`), which only the account's devices have.
 * On top of that, the history carries a second encryption, only between the TWO devices
 * that are talking:
 *
 * - the requester generates an ephemeral X25519 pair and states the public part in the request;
 * - the responder generates another and states the public part in the first response;
 * - both arrive at the same key (`chaveDoHistorico`), and no one else.
 *
 * Why the second encryption: the owner's request is "device-to-device encrypted".
 * Another device in the account, or a device that joins the account channel later,
 * does not open what passed between the two. And ephemeral keys live only in memory:
 * after transfer, neither of the two has them.
 *
 * The server sees the size and rhythm of signals. It does not see the content.
 */

const ROTULO = "orwell historico v1"
const BYTES_DO_NONCE = 24

export interface ParDoHistorico {
  publica: Uint8Array
  privada: Uint8Array
}

/** A new X25519 pair, for a transfer session. Memory only. */
export function novoParDoHistorico(): ParDoHistorico {
  const privada = x25519.utils.randomSecretKey()
  return { privada, publica: x25519.getPublicKey(privada) }
}

/**
 * The session key: HKDF-SHA256 over the X25519 secret, with the session as salt
 * and the four public keys in the context (the two device keys and the two
 * ephemeral ones). Both sides write the context in the same order: first the requester,
 * then the responder.
 *
 * @throws "degenerate shared secret": a public key of low order.
 */
export function chaveDoHistorico(
  minhaPrivada: Uint8Array,
  publicaDoOutro: Uint8Array,
  sessao: string,
  contexto: { aparelhoQuePede: Uint8Array; aparelhoQueResponde: Uint8Array; efemeraQuePede: Uint8Array; efemeraQueResponde: Uint8Array },
): Uint8Array {
  const partilhado = x25519.getSharedSecret(minhaPrivada, publicaDoOutro)
  // The same guard as `moradaDaDirecta`: a secret of zeros would be the same
  // for any pair, and cannot depend on the library version.
  if (partilhado.every((byte) => byte === 0)) throw new Error("degenerate shared secret")
  const info = juntar(
    new TextEncoder().encode(`${ROTULO}\0`),
    contexto.aparelhoQuePede,
    contexto.aparelhoQueResponde,
    contexto.efemeraQuePede,
    contexto.efemeraQueResponde,
  )
  return hkdf(sha256, partilhado, new TextEncoder().encode(sessao), info, 32)
}

function juntar(...partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((soma, parte) => soma + parte.length, 0)
  const saida = new Uint8Array(total)
  let em = 0
  for (const parte of partes) {
    saida.set(parte, em)
    em += parte.length
  }
  return saida
}

function dadosAdicionais(sessao: string, rotulo: string): Uint8Array {
  return new TextEncoder().encode(`orwell-historico-bloco-v1\0${sessao}\0${rotulo}`)
}

/**
 * Encrypt a block: `nonce (24) | XChaCha20-Poly1305`. The nonce is random: a block
 * that is requested again comes back with another nonce, and never with the same nonce
 * over different text. The `rotulo` (the request that the block answers) goes into
 * the additional data: a block does not move from one request to another.
 */
export function selarBloco(chave: Uint8Array, sessao: string, rotulo: string, texto: Uint8Array): Uint8Array {
  const nonce = crypto.getRandomValues(new Uint8Array(BYTES_DO_NONCE))
  const cifra = xchacha20poly1305(chave, nonce, dadosAdicionais(sessao, rotulo)).encrypt(texto)
  return juntar(nonce, cifra)
}

/** Open a block. `null` if it does not open: another key, another request, altered bytes. Never throws. */
export function abrirBloco(chave: Uint8Array, sessao: string, rotulo: string, bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < BYTES_DO_NONCE + 16) return null
  try {
    return xchacha20poly1305(chave, bytes.subarray(0, BYTES_DO_NONCE), dadosAdicionais(sessao, rotulo)).decrypt(
      bytes.subarray(BYTES_DO_NONCE),
    )
  } catch {
    return null
  }
}

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { mlsExporter } from "ts-mls"
import { epochOf, type GroupSession } from "./group.js"

/**
 * The key for ephemeral signals on a channel (phase S4 of absolute sync,
 * `docs/planos/2026-10-20-sincronia-absoluta.md`, section 4.5).
 *
 * Digests and anti-entropy requests travel in the `channel.sinal` frame, which
 * the server relays to whoever is connected and does not store. They cannot go through
 * the MLS ratchet: each MLS message uses up one of the sender's generations, and a
 * member who does not receive them must skip them. The cap is 512 skips
 * (`maximumForwardRatchetSteps`); an afternoon of digests would deafen anyone
 * who was offline.
 *
 * That is why the key comes from the MLS epoch exporter, like the SFrame key
 * (`deriveSframeKeyMaterial` in `sframe.ts`), with its own label. It does not
 * use up generations, and only members of the group in this epoch
 * have it, not the server.
 *
 * The key proves the sender is a MEMBER, not WHICH member. That is why the content carries
 * the device signature (see `pedido.ts` in the core), and the
 * receiver checks it against the sender's leaf.
 *
 * A signal from an epoch we no longer have is discarded. It does not count
 * toward deafness: it is not an MLS frame.
 */

const ROTULO_DO_SINAL = "orwell sinal v1"
const BYTES_DA_CHAVE = 32
const BYTES_DO_NONCE = 24
const VERSAO = 1
/** version (1) + epoch (8) + nonce (24). */
const CABECALHO = 1 + 8 + BYTES_DO_NONCE

export interface ChaveDoSinal {
  readonly epoca: bigint
  readonly chave: Uint8Array
}

/**
 * The signal key for this channel in the group's current epoch.
 *
 * The context is the channel name: two channels never share a key, even if an
 * exporter secret repeated.
 */
export async function derivarChaveDoSinal(session: GroupSession, canal: string): Promise<ChaveDoSinal> {
  const chave = await mlsExporter(
    session.state.keySchedule.exporterSecret,
    ROTULO_DO_SINAL,
    new TextEncoder().encode(canal),
    BYTES_DA_CHAVE,
    session.suite,
  )
  return { epoca: epochOf(session), chave }
}

function dadosAdicionais(canal: string, epoca: bigint): Uint8Array {
  const prefixo = new TextEncoder().encode(`orwell-sinal-v1\0${canal}\0`)
  const saida = new Uint8Array(prefixo.length + 8)
  saida.set(prefixo, 0)
  new DataView(saida.buffer).setBigUint64(prefixo.length, epoca, false)
  return saida
}

/**
 * Encrypt a signal: `versão | época (u64) | nonce (24) | XChaCha20-Poly1305`.
 *
 * The epoch is sent in the clear (the server already sees it in MLS frames)
 * so the receiver can pick the key without trying them all. The channel and
 * epoch go into the additional data: a signal cannot be moved to another channel
 * or epoch.
 */
export function selarSinal(chave: ChaveDoSinal, canal: string, texto: Uint8Array, nonce?: Uint8Array): Uint8Array {
  const n = nonce ?? crypto.getRandomValues(new Uint8Array(BYTES_DO_NONCE))
  if (n.length !== BYTES_DO_NONCE) throw new Error("nonce do sinal com tamanho errado")
  const cifra = xchacha20poly1305(chave.chave, n, dadosAdicionais(canal, chave.epoca)).encrypt(texto)
  const saida = new Uint8Array(CABECALHO + cifra.length)
  saida[0] = VERSAO
  new DataView(saida.buffer).setBigUint64(1, chave.epoca, false)
  saida.set(n, 9)
  saida.set(cifra, CABECALHO)
  return saida
}

/** The epoch a signal declares, or `undefined` if it is not a signal of this version. */
export function epocaDoSinal(bytes: Uint8Array): bigint | undefined {
  if (bytes.length < CABECALHO + 16 || bytes[0] !== VERSAO) return undefined
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(1, false)
}

/**
 * Open a signal with the key of the epoch it declares. `null` if it does not
 * open: different epoch, different channel, altered bytes. Never throws.
 */
export function abrirSinal(chave: ChaveDoSinal, canal: string, bytes: Uint8Array): Uint8Array | null {
  const epoca = epocaDoSinal(bytes)
  if (epoca === undefined || epoca !== chave.epoca) return null
  try {
    return xchacha20poly1305(chave.chave, bytes.subarray(9, CABECALHO), dadosAdicionais(canal, epoca)).decrypt(
      bytes.subarray(CABECALHO),
    )
  } catch {
    return null
  }
}

import {
  accountIdFromSigningKey,
  fromBase64,
  JANELA_DO_PEDIDO_MS,
  mensagemDoPedido,
  PedidoAssinado,
  parseAddress,
  verify,
  verifyDeviceChain,
  type ParsedAddress,
  type RotaDaDenuncia,
} from "@enclave/protocol"
import type { Store } from "./store.js"

/**
 * The signed request (`packages/protocol/src/denuncia.ts`), on the server side.
 *
 * Authenticates the report routes without a gateway session: the device signs
 * the request, the chain links the device to the account, and the account is
 * the one the address names. Returns, never throws: the caller turns the reason
 * into an HTTP response.
 */
export type RecusaDoPedido =
  | "malformed"
  | "wrong-homeserver"
  | "key-mismatch"
  | "bad-device-cert"
  | "device-revoked"
  | "bad-signature"
  | "stale-request"
  | "replayed"
  | "wrong-route"

/**
 * The maximum number of nonces in memory. The route caps bound the map per
 * account; this bounds it in total (many accounts, or a badly set cap). When it
 * is full, even after clearing expired ones, a new nonce is refused as a replay.
 */
export const NONCES_MAX = 200_000

/**
 * Nonces already accepted, held in memory.
 *
 * A request only passes the clock if `|agora - emitido| <= janela`, so the
 * same copy can pass it again only within two windows after the
 * first one was accepted. Keeping each nonce for that duration is enough; after that
 * the clock rejects the repeat by itself. Losing this on restart opens, in the worst
 * case, one repeat within that window, and the routes that use it have their own caps.
 *
 * Two operations: `livre` only checks, `consumir` records. Between them runs
 * the route's cap, so a request rejected by the cap does not leave a nonce.
 */
export class NoncesVistos {
  readonly #vistos = new Map<string, number>()
  #ultimaLimpeza = 0

  constructor(
    readonly janelaMs = JANELA_DO_PEDIDO_MS,
    readonly maximo = NONCES_MAX,
  ) {}

  get tamanho(): number {
    return this.#vistos.size
  }

  /** True if the nonce has not been seen and there is room for it. Does not record it. */
  livre(nonce: string, agora = Date.now()): boolean {
    if (agora - this.#ultimaLimpeza >= this.janelaMs) this.limpar(agora)
    const visto = this.#vistos.get(nonce)
    if (visto !== undefined && agora - visto <= 2 * this.janelaMs) return false
    if (visto === undefined && this.#vistos.size >= this.maximo) {
      this.limpar(agora)
      if (this.#vistos.size >= this.maximo) return false
    }
    return true
  }

  /** Records the nonce. False, without recording, if it was already seen or there is no room. */
  consumir(nonce: string, agora = Date.now()): boolean {
    if (!this.livre(nonce, agora)) return false
    this.#vistos.set(nonce, agora)
    return true
  }

  /** `livre` and `consumir` in one step. */
  tentar(nonce: string, agora = Date.now()): boolean {
    return this.consumir(nonce, agora)
  }

  limpar(agora = Date.now()): void {
    this.#ultimaLimpeza = agora
    for (const [nonce, visto] of this.#vistos) if (agora - visto > 2 * this.janelaMs) this.#vistos.delete(nonce)
  }
}

export function verificarPedidoAssinado(
  corpo: unknown,
  rota: RotaDaDenuncia,
  deps: {
    store: Store
    serverName: string
    nonces: NoncesVistos
    agora?: number
    /**
     * The route cap, keyed by the signature's address. Runs after everything else
     * passes and before the nonce is recorded: the request it refuses returns
     * `ok` with `coube: false` and no nonce in memory. With no cap, it fits.
     */
    tecto?: (endereco: string) => boolean
  },
):
  | { ok: true; endereco: string; aparelho: string; corpo: unknown; coube: boolean }
  | { ok: false; razao: RecusaDoPedido } {
  const recusa = (razao: RecusaDoPedido) => ({ ok: false as const, razao })

  // Forma.
  const lido = PedidoAssinado.safeParse(corpo)
  if (!lido.success) return recusa("malformed")
  const pedido = lido.data
  if (pedido.rota !== rota) return recusa("wrong-route")

  // Server.
  let endereco: ParsedAddress
  try {
    endereco = parseAddress(pedido.endereco)
  } catch {
    return recusa("malformed")
  }
  if (endereco.sigil !== "@") return recusa("malformed")
  if (endereco.server !== deps.serverName) return recusa("wrong-homeserver")

  // Key: the address is the digest of the account key.
  const chaveDeConta = fromBase64(pedido.cadeia.k)
  if (accountIdFromSigningKey(chaveDeConta) !== endereco.localPart) return recusa("key-mismatch")

  // Chain: the account signed this device.
  const aparelho = fromBase64(pedido.aparelho)
  if (
    !verifyDeviceChain({
      address: pedido.endereco,
      accountKey: chaveDeConta,
      deviceKey: aparelho,
      signature: fromBase64(pedido.cadeia.x),
    })
  ) {
    return recusa("bad-device-cert")
  }
  // The key stored at first login must be this one. Read-only: the chain is a
  // public certificate (it goes in key packages and the MLS credential), and a
  // copy of it does not let anyone create accounts here. An account that never
  // logged in is also "key-mismatch".
  const guardada = deps.store.signingKeyOf(pedido.endereco)
  if (guardada === undefined || !mesmosBytes(guardada, chaveDeConta)) return recusa("key-mismatch")

  // Revocation.
  if (deps.store.isDeviceRevoked(pedido.endereco, pedido.aparelho)) return recusa("device-revoked")

  // Device signature on the request.
  const { as, v: _v, ...assinado } = pedido
  let mensagem: Uint8Array
  try {
    mensagem = mensagemDoPedido(assinado)
  } catch {
    // `corpo` is z.unknown(): a number like 1e400 in JSON arrives as Infinity, and
    // canonical JSON does not encode it.
    return recusa("malformed")
  }
  if (!verify(aparelho, mensagem, fromBase64(as))) return recusa("bad-signature")

  // Clock.
  const agora = deps.agora ?? Date.now()
  if (Math.abs(agora - pedido.emitido) > JANELA_DO_PEDIDO_MS) return recusa("stale-request")

  // Replay (or a full map, reported the same way), then the cap, and only then
  // the nonce is recorded. All synchronous: between checking and recording no
  // other request runs, and `consumir` checks again anyway.
  if (!deps.nonces.livre(pedido.nonce, agora)) return recusa("replayed")
  const coube = deps.tecto?.(pedido.endereco) ?? true
  if (coube && !deps.nonces.consumir(pedido.nonce, agora)) return recusa("replayed")

  return { ok: true, endereco: pedido.endereco, aparelho: pedido.aparelho, corpo: pedido.corpo, coube }
}

function mesmosBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

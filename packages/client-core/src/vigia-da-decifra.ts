import type { UserAddress } from "@enclave/protocol"

/**
 * What media decryption sees fail, per sender, and what to do about it.
 *
 * **Exists because of the telemetry report of November 2, 2026:** "users
 * sometimes stop hearing others" and "sound comes back if they leave and
 * rejoin the room". A receiver that runs out of the key for the epoch where
 * the sender is already encrypting would drop each of its frames silently and
 * forever: the rule "a frame that doesn't decrypt doesn't pass" is correct,
 * but alone it had no way back, and the log said nothing. Only rejoining would
 * re-derive the key.
 *
 * This doesn't decrypt or store bytes: it counts failures and decides when to alert.
 * It lives in its own file with no dependencies, because it runs in BOTH places
 * where a frame decrypts: in the main thread (insertable streams, Chromium's and
 * the desktop app's path) and inside the worker (`RTCRtpScriptTransform`).
 * A policy written twice is a policy that can diverge.
 */

/**
 * Why a frame didn't decrypt.
 *
 *  - `sem-cabecalho`: the bytes don't carry an SFrame header. Clear media or
 *    garbage; a new key won't fix it.
 *  - `sem-chave`: the frame declares a `keyId` that this person's chain doesn't have.
 *    This is the case that recovers: ask the session for the key again.
 *  - `recusado`: the key for that `keyId` exists and it still didn't decrypt
 *    (tag mismatch, wrong `senderId`, or replay outside the window). A different
 *    fault elsewhere, so logged under a different name.
 */
export type MotivoDaFalha = "sem-cabecalho" | "sem-chave" | "recusado"

export type AvisoDaDecifra =
  /** Ask the session for this person's key again. */
  | { t: "pedir-chave"; address: UserAddress; keyId: number; senderId?: number }
  /** This person hit `falhas` frames in a row without decrypting any. */
  | { t: "parada"; address: UserAddress; motivo: MotivoDaFalha; falhas: number }
  /** Started decrypting again after an outage already logged. */
  | { t: "voltou"; address: UserAddress; falhas: number }

/** The person and the keyframe ID of the sender. No known keyframe (no header), just the person. */
function chaveDoEmissor(address: UserAddress, senderId: number | undefined): string {
  return senderId === undefined ? address : `${address}|${senderId}`
}

export class VigiaDaDecifra {
  /**
   * How many frames in a row without decryption make an outage worth logging.
   *
   * Fifty is roughly one second of Opus voice. Less than that fits within a normal
   * epoch change (frames from the previous key still in flight) and would fill the
   * log with false alarms; more would let a short outage slip through unnoticed.
   */
  static readonly LIMIAR_DA_PARAGEM = 50

  /**
   * The minimum interval between two key requests for the same person.
   *
   * The first frame without a key requests immediately, because that's what brings
   * sound back in milliseconds. The rest wait: at fifty frames per second, one
   * request per frame would be a query to the session (on the desktop app, a call
   * to the main process) per frame. And keep requesting while it fails instead of
   * asking once covers the case where THIS device is behind on the epoch: when it
   * catches the commit, the next request will succeed.
   */
  static readonly INTERVALO_DOS_PEDIDOS_MS = 1000

  /*
   * Per SENDER, which is the person and the keyframe ID (the device). Two devices
   * of the same account in the same call are two senders: counted separately, each
   * frame that decrypted from one was resetting the request clock for the other's,
   * and the keyless device would request at every frame instead of once per second.
   */
  #seguidas = new Map<string, { falhas: number; dita: boolean }>()
  #ultimoPedido = new Map<string, number>()

  constructor(
    private readonly aoAvisar: (aviso: AvisoDaDecifra) => void,
    private readonly agora: () => number = () => Date.now(),
  ) {}

  falhou(address: UserAddress, motivo: MotivoDaFalha, keyId?: number, senderId?: number): void {
    const emissor = chaveDoEmissor(address, senderId)
    const estado = this.#seguidas.get(emissor) ?? { falhas: 0, dita: false }
    estado.falhas++
    this.#seguidas.set(emissor, estado)

    if (motivo === "sem-chave" && keyId !== undefined) {
      const ultimo = this.#ultimoPedido.get(emissor)
      const instante = this.agora()
      if (ultimo === undefined || instante - ultimo >= VigiaDaDecifra.INTERVALO_DOS_PEDIDOS_MS) {
        this.#ultimoPedido.set(emissor, instante)
        this.aoAvisar(senderId === undefined ? { t: "pedir-chave", address, keyId } : { t: "pedir-chave", address, keyId, senderId })
      }
    }

    // Once per outage, not per frame: the log is meant to be readable.
    if (!estado.dita && estado.falhas >= VigiaDaDecifra.LIMIAR_DA_PARAGEM) {
      estado.dita = true
      this.aoAvisar({ t: "parada", address, motivo, falhas: estado.falhas })
    }
  }

  abriu(address: UserAddress, senderId?: number): void {
    const emissor = chaveDoEmissor(address, senderId)
    const estado = this.#seguidas.get(emissor)
    if (!estado) return
    this.#seguidas.delete(emissor)
    // The request clock resets: the next miss requests right away again.
    this.#ultimoPedido.delete(emissor)
    if (estado.dita) this.aoAvisar({ t: "voltou", address, falhas: estado.falhas })
  }
}

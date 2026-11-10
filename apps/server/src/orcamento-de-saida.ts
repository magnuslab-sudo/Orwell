/**
 * The egress budget for the whole server, not for a single call.
 *
 * The caps in `media.ts` are per call (`PARTICIPANTES_POR_AMBITO`,
 * `CAMARAS_POR_AMBITO`, `ECRAS_POR_AMBITO`, `PESSOAS_COM_ECRA`). None of them sees
 * the other calls, and all of them go through the SAME worker and the SAME network card.
 * Measured on 3 November 2026: a worker uses ~400 Mbit/s at 70 % of
 * one core, and the card gave 300 to 745 Mbit/s of egress, shared with
 * magnuslab.pt. When the sum exceeds that, ALL calls degrade, including voice.
 * This counter keeps the sum from getting there.
 *
 * **The count is per consumer, not per stream.** An SFU's egress is
 * `bitrate × espectadores`: a screen share with ten viewers costs 10 × 2.5 Mbit/s.
 * Each active consumer reserves the cap of the producer it consumes; the
 * reservation is released when it pauses or closes.
 *
 * **Two lanes, and voice is never rejected.** Video has its own budget and is
 * rejected when the new request does not fit. Voice counts against a separate
 * reserve that video cannot eat into; when that reserve runs out, it is logged
 * and voice gets in anyway. Voice is cheap (~35 kbit/s per consumer) and
 * a call without voice is not a call.
 *
 * Numbers only: no channel, no account, no address passes through here.
 */

/** The lane of a reservation. */
export type FaixaDeSaida = "video" | "voz"

/** The cost of one voice stream on the wire, in bits per second: Opus at 32 kbit/s CBR with headers. */
export const CUSTO_DA_VOZ_NO_FIO = 35_000

/** The default video budget, in Mbit/s. Below the card's lowest measurement (300). */
export const ORCAMENTO_DE_VIDEO_MBPS = 300

/** The default voice reserve, in Mbit/s: ~1 100 voice consumers. */
export const RESERVA_DA_VOZ_MBPS = 40

export interface LeituraDaFaixa {
  /** Bits por segundo reservados agora. */
  uso: number
  /** The cap of this lane, in bits per second. */
  tecto: number
  /** Quantos consumidores reservam nesta faixa. */
  fluxos: number
}

export interface LeituraDaSaida {
  video: LeituraDaFaixa
  voz: LeituraDaFaixa
}

export class OrcamentoDeSaida {
  readonly #tectos: Record<FaixaDeSaida, number>
  readonly #uso: Record<FaixaDeSaida, number> = { video: 0, voz: 0 }
  readonly #fluxos: Record<FaixaDeSaida, number> = { video: 0, voz: 0 }
  readonly #reservas = new Map<string, { faixa: FaixaDeSaida; bits: number }>()
  readonly #aoPassarDaReservaDaVoz: (leitura: LeituraDaSaida) => void
  /** So the crossing is logged once, not on every voice that joins above it. */
  #vozAcima = false

  /**
   * @param videoBps the video budget, in bits per second.
   * @param reservaDaVozBps the voice reserve, in bits per second.
   * @param aoPassarDaReservaDaVoz called when voice exceeds the reserve. Does not reject anything.
   */
  constructor(videoBps: number, reservaDaVozBps: number, aoPassarDaReservaDaVoz: (leitura: LeituraDaSaida) => void = () => {}) {
    this.#tectos = { video: videoBps, voz: reservaDaVozBps }
    this.#aoPassarDaReservaDaVoz = aoPassarDaReservaDaVoz
  }

  /**
   * Changes the video cap: the cut-off near the monthly quota (`quota-mensal.ts`).
   *
   * Applies only to later admissions. Consumers that already hold a reservation
   * keep it, even above the new cap: the cut-off does not take the picture away
   * from anyone who already has it.
   */
  definirTectoDoVideo(bits: number): void {
    this.#tectos.video = bits
  }

  /** Does one more video fit? Reserves nothing. */
  cabeVideo(bits: number): boolean {
    return this.#uso.video + bits <= this.#tectos.video
  }

  /**
   * Reserves `bits` for `chave`.
   *
   * @returns `false` only when it is video and does not fit; nothing gets
   * reserved. Voice always returns `true`. A key already reserved returns
   * `true` without counting again: this is what lets the first `resume` after
   * `consume` pass without being checked again.
   */
  reservar(chave: string, faixa: FaixaDeSaida, bits: number): boolean {
    if (this.#reservas.has(chave)) return true
    if (faixa === "video" && !this.cabeVideo(bits)) return false
    this.#reservas.set(chave, { faixa, bits })
    this.#uso[faixa] += bits
    this.#fluxos[faixa]++
    if (faixa === "voz" && !this.#vozAcima && this.#uso.voz > this.#tectos.voz) {
      this.#vozAcima = true
      this.#aoPassarDaReservaDaVoz(this.ler())
    }
    return true
  }

  /** Releases the reservation for `chave`. Without one, does nothing: closing twice is normal. */
  libertar(chave: string): void {
    const reserva = this.#reservas.get(chave)
    if (!reserva) return
    this.#reservas.delete(chave)
    this.#uso[reserva.faixa] -= reserva.bits
    this.#fluxos[reserva.faixa]--
    if (reserva.faixa === "voz" && this.#uso.voz <= this.#tectos.voz) this.#vozAcima = false
  }

  /** Does this key hold a reservation? */
  reservado(chave: string): boolean {
    return this.#reservas.has(chave)
  }

  /** Forget everything: the worker died or the engine closed, and the consumers with it. */
  limpar(): void {
    this.#reservas.clear()
    this.#uso.video = this.#uso.voz = 0
    this.#fluxos.video = this.#fluxos.voz = 0
    this.#vozAcima = false
  }

  ler(): LeituraDaSaida {
    return {
      video: { uso: this.#uso.video, tecto: this.#tectos.video, fluxos: this.#fluxos.video },
      voz: { uso: this.#uso.voz, tecto: this.#tectos.voz, fluxos: this.#fluxos.voz },
    }
  }
}

/** Mbit/s to one decimal place, for the log. */
function mbps(bits: number): string {
  return (bits / 1_000_000).toFixed(1)
}

/** The current reading as one log line, with no names. */
export function linhaDaSaida(leitura: LeituraDaSaida): string {
  return (
    `vídeo ${mbps(leitura.video.uso)}/${mbps(leitura.video.tecto)} Mbit/s (${leitura.video.fluxos} consumos), ` +
    `voz ${mbps(leitura.voz.uso)}/${mbps(leitura.voz.tecto)} Mbit/s (${leitura.voz.fluxos} consumos)`
  )
}

/**
 * The outbound budget for the entire server, not for a single call.
 *
 * The caps in `media.ts` are per call (`PARTICIPANTES_POR_AMBITO`,
 * `CAMARAS_POR_AMBITO`, `ECRAS_POR_AMBITO`, `PESSOAS_COM_ECRA`). None of them see
 * other calls, and all pass through the SAME worker and the SAME network card.
 * Measured on 3 November 2026: a worker uses ~400 Mbit/s at 70 % of
 * one core, and the card delivered 300 a 745 Mbit/s outbound, shared with
 * magnuslab.pt. When the sum exceeds that, ALL calls degrade, including voice.
 * This counter prevents the sum from reaching that point.
 *
 * **The budget is per consumer, not per stream.** The output of an SFU is
 * `bitrate × espectadores`: a screen with ten viewers costs 10 × 2,5 Mbit/s.
 * Each active consumer reserves the cap of the producer it consumes; the reserve
 * is released when it pauses or closes.
 *
 * **Two bands, and voice is never rejected.** Video has its own budget and is
 * rejected when the new request does not fit. Voice counts against a separate
 * reserve that video cannot consume; when that reserve runs out, it is logged
 * and voice enters anyway. Voice is cheap (~35 kbit/s per consumer) and
 * a call without voice is not a call.
 *
 * Numbers only: no channel, no account, no address passes through here.
 */

/** A reserve band. */
export type FaixaDeSaida = "video" | "voz"

/** The cost of voice on the wire, in bits per second: Opus at 32 kbit/s CBR with headers. */
export const CUSTO_DA_VOZ_NO_FIO = 35_000

/** The default video budget, in Mbit/s. Below the card's lowest measurement (300). */
export const ORCAMENTO_DE_VIDEO_MBPS = 300

/** The default voice reserve, in Mbit/s: ~1 100 voice consumers. */
export const RESERVA_DA_VOZ_MBPS = 40

export interface LeituraDaFaixa {
  /** Bits por segundo reservados agora. */
  uso: number
  /** The limit of this band, in bits per second. */
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
  /** To report the transition once, not on every voice entering above it. */
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
   * Change the video limit: the cut near the monthly quota (`quota-mensal.ts`).
   *
   * Only applies to admissions after this. Those already reserved keep their
   * reserve, even above the new limit: the cut does not remove the picture
   * from those who already have it.
   */
  definirTectoDoVideo(bits: number): void {
    this.#tectos.video = bits
  }

  /** Does this video fit? Does not reserve anything. */
  cabeVideo(bits: number): boolean {
    return this.#uso.video + bits <= this.#tectos.video
  }

  /**
   * Reserve `bits` for `chave`.
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

  /** Release the reserve for `chave`. No reserve, no action: closing twice is normal. */
  libertar(chave: string): void {
    const reserva = this.#reservas.get(chave)
    if (!reserva) return
    this.#reservas.delete(chave)
    this.#uso[reserva.faixa] -= reserva.bits
    this.#fluxos[reserva.faixa]--
    if (reserva.faixa === "voz" && this.#uso.voz <= this.#tectos.voz) this.#vozAcima = false
  }

  /** Does this key have a reserve? */
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

/** A reading in one log line, without names. */
export function linhaDaSaida(leitura: LeituraDaSaida): string {
  return (
    `vídeo ${mbps(leitura.video.uso)}/${mbps(leitura.video.tecto)} Mbit/s (${leitura.video.fluxos} consumos), ` +
    `voz ${mbps(leitura.voz.uso)}/${mbps(leitura.voz.tecto)} Mbit/s (${leitura.voz.fluxos} consumos)`
  )
}

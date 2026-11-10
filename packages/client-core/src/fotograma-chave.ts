/**
 * When a viewer requests a keyframe (Phase M2, `sfu.keyframe`).
 *
 * Corrupted video (pixelized screen share from November 2, 2026, or a camera
 * that freezes after packet loss) only recovers with a complete keyframe. The
 * browser asks for one itself (PLI) when it sees something is missing; this
 * covers the rest, based on what the receiver measures:
 *
 *  - `freezeCount` going up: the image is frozen on screen;
 *  - `frameDecodeErrors` going up (where the engine tracks it);
 *  - `pliCount` going up with no keyframe decoded in the next sample: the
 *    browser asked, and its request went nowhere;
 *  - a video frame that resumed after decrypt failed (`videoVoltou`): with the
 *    key back, the decoder already lost the chain.
 *
 * **Never in bursts.** At most one request per `INTERVALO_MINIMO_MS` per
 * consumer, the same cap the server enforces. A reason arriving within the
 * interval is not lost: it's due, and fires on the first sample after it,
 * unless a keyframe arrives in the meantime (which was what would be requested).
 *
 * This doesn't read any video or key: only counters from `getStats`.
 */

/** The `inbound-rtp` video counters that count here. Absent = the engine does not have it. */
export interface AmostraDoReceptor {
  congelamentos?: number
  errosDeDescodificacao?: number
  pli?: number
  chaves?: number
}

export type MotivoDoPedido = "congelou" | "erros-de-descodificacao" | "pli-sem-chave" | "decifra-voltou"

export class VigiaDoFotogramaChave {
  /** The same cap as the server (`INTERVALO_DO_FOTOGRAMA_CHAVE_PEDIDO`). */
  static readonly INTERVALO_MINIMO_MS = 1000

  #anterior: Required<AmostraDoReceptor> | null = null
  /** The `pli` rose in the last sample: if this one brings no key, that request failed. */
  #pliPorConfirmar = false
  #devido: MotivoDoPedido | null = null
  #ultimoPedido: number | null = null

  /**
   * A new sample from the receiver.
   *
   * @returns the reason for the request, when to ask NOW; `null` otherwise.
   */
  amostra(amostra: AmostraDoReceptor, agora: number): MotivoDoPedido | null {
    const actual = {
      congelamentos: amostra.congelamentos ?? 0,
      errosDeDescodificacao: amostra.errosDeDescodificacao ?? 0,
      pli: amostra.pli ?? 0,
      chaves: amostra.chaves ?? 0,
    }
    const anterior = this.#anterior
    this.#anterior = actual
    // The first sample is the baseline: counters are from the entire receiver, and a resumed consumer brings history from before the pause.
    if (!anterior) return null

    const chegouChave = actual.chaves > anterior.chaves
    if (chegouChave) {
      // What was due has arrived.
      this.#devido = null
    }

    let motivo: MotivoDoPedido | null = null
    if (actual.congelamentos > anterior.congelamentos) motivo = "congelou"
    else if (actual.errosDeDescodificacao > anterior.errosDeDescodificacao) motivo = "erros-de-descodificacao"
    else if (this.#pliPorConfirmar && !chegouChave) motivo = "pli-sem-chave"
    this.#pliPorConfirmar = actual.pli > anterior.pli && !chegouChave

    if (motivo) this.#devido ??= motivo
    return this.#talvezPedir(agora)
  }

  /** Decryption of a video frame from this person opened again after failing. */
  videoVoltou(agora: number): MotivoDoPedido | null {
    this.#devido ??= "decifra-voltou"
    return this.#talvezPedir(agora)
  }

  #talvezPedir(agora: number): MotivoDoPedido | null {
    const motivo = this.#devido
    if (!motivo) return null
    if (this.#ultimoPedido !== null && agora - this.#ultimoPedido < VigiaDoFotogramaChave.INTERVALO_MINIMO_MS) return null
    this.#ultimoPedido = agora
    this.#devido = null
    return motivo
  }
}

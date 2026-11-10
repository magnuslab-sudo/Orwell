/**
 * Voice level for call cards: the math, no DOM involved.
 *
 * One number, 0 to 1, for everything that responds to voice (the halo, the ring, the
 * card frame, the wave): `--voz`. The `useNivelDeVoz` hook measures it.
 *
 * Owner calibration on October 26, 2026 ("sound coming in without animation").
 * The old scale (−60 to 0 dBFS, squared, and `--voz` threshold at
 * −24 dBFS) only lit with loud speech. This lights at −50 dBFS, peaks
 * at −12 dBFS, and normal speech (−30) sits in the middle. The scale floor rises with
 * room noise, measured in the first 2 s, so the room doesn't light on its own.
 */

/** Where the scale starts in a silent room. */
export const DB_ACENDE = -50

/** Where the scale peaks: loud speech. */
export const DB_MAXIMO = -12

/** Above measured noise, how much is needed to light. */
export const MARGEM_DO_CHAO_DB = 6

/**
 * The scale floor never rises above this, no matter how noisy the room is:
 * normal speech (−30) always lights.
 */
export const INICIO_MAXIMO_DB = -36

/** How long we measure room noise from when the meter starts. */
export const JANELA_DO_CHAO_MS = 2000

/** With `prefers-reduced-motion`, level changes in steps of this fraction. */
export const PASSO_REDUZIDO = 0.1

/**
 * RMS value (0 to 1) to dBFS.
 *
 * Zero is digital silence, and its logarithm is −∞: return −∞ and let the
 * renderer handle it. Do not invent a floor here; that is the scale's decision.
 */
export function dbDeRms(rms: number): number {
  return rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY
}

/**
 * Where the scale starts, given measured room noise (`null` if not measured).
 *
 * Room noise plus margin, between −50 and −36 dBFS.
 */
export function inicioDaEscala(chaoDb: number | null): number {
  if (chaoDb === null || !Number.isFinite(chaoDb)) return DB_ACENDE
  return Math.min(INICIO_MAXIMO_DB, Math.max(DB_ACENDE, chaoDb + MARGEM_DO_CHAO_DB))
}

/**
 * Voice level, 0 to 1: linear in dB from the scale start to −12 dBFS,
 * which is how the ear reads volume. Clipped outside that range.
 */
export function nivelDaVoz(db: number, inicio = DB_ACENDE): number {
  if (!(db > inicio)) return 0
  if (db >= DB_MAXIMO) return 1
  return (db - inicio) / (DB_MAXIMO - inicio)
}

/** Rounds to `PASSO_REDUZIDO` steps: the halo jumps instead of sliding. */
export function emPassos(valor: number): number {
  return Math.round(valor / PASSO_REDUZIDO) * PASSO_REDUZIDO
}

/**
 * Background noise, measured in the first `JANELA_DO_CHAO_MS`.
 *
 * It is the MINIMUM of the smoothed level in that window, not the average: someone
 * entering while already speaking has pauses between words, and room noise shows up
 * there. During the window there is no measurement (`null`), and the scale starts
 * at −50: anyone speaking right away lights right away. Digital silence (−∞) does
 * not count as room noise.
 */
export class ChaoDeRuido {
  #inicio: number
  #minimo = Number.POSITIVE_INFINITY

  constructor(agora: number) {
    this.#inicio = agora
  }

  observar(db: number, agora: number): void {
    if (agora - this.#inicio > JANELA_DO_CHAO_MS) return
    if (Number.isFinite(db) && db < this.#minimo) this.#minimo = db
  }

  valor(agora: number): number | null {
    if (agora - this.#inicio <= JANELA_DO_CHAO_MS) return null
    return Number.isFinite(this.#minimo) ? this.#minimo : null
  }
}

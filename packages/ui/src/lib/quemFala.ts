/**
 * Who is speaking now, as yes or no, for the game overlay.
 *
 * Call cards do not need this: they draw the continuous level (`--voz`, in
 * `hooks/useNivelDeVoz.ts`) and CSS lights the ring from it. The overlay lives
 * in another window, on the other side of IPC, and sending the level at 60 Hz
 * per person would be too much IPC for a shadow. So the decision is made here,
 * on the SAME scale as the cards (`nivelDaVoz`, from `lib/medidorDeDb.ts`),
 * and only crosses over when it changes.
 *
 * Two thresholds and a hold, like a VU meter: lights above `ACENDE`, goes dark
 * only after `SEGURA_MS` below `APAGA`. Without this the ring would flicker
 * with each syllable, and each flicker was an IPC message.
 */

/** On the `nivelDaVoz` scale (0 to 1). 0.12 is quiet speech; room noise stays below. */
export const ACENDE = 0.12
export const APAGA = 0.05
/** How long silent before going dark: pauses between words are shorter. */
export const SEGURA_MS = 350

export function criarDetectorDeFala(): { observar: (nivel: number, agora: number) => boolean } {
  let aFalar = false
  let caladoDesde: number | null = null
  return {
    observar: (nivel, agora) => {
      const valor = Number.isFinite(nivel) ? nivel : 0
      if (valor >= ACENDE) {
        aFalar = true
        caladoDesde = null
      } else if (valor < APAGA && aFalar) {
        caladoDesde ??= agora
        if (agora - caladoDesde > SEGURA_MS) {
          aFalar = false
          caladoDesde = null
        }
      } else if (valor >= APAGA) {
        // Between the thresholds: does not light, but also does not count as silent.
        caladoDesde = null
      }
      return aFalar
    },
  }
}

export function mesmoConjunto(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const item of a) if (!b.has(item)) return false
  return true
}

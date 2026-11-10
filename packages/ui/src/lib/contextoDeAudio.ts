/**
 * An `AudioContext` for the whole page.
 *
 * Browsers limit them per page and cut off around a dozen. A call with eight
 * people, plus the level meter for each card, plus the sound alerts, gets there
 * easily, and what happens next is not a visible error, it is sound that stops
 * coming out.
 *
 * It lived inside `useNivelDeVoz`, private, and came out when a second reader
 * came along: amplification above 100% in `VideoTile`. Two private contexts would
 * be two owners of the same scarce resource, each one unaware of the other.
 */

let contexto: AudioContext | null = null

/**
 * Whoever wants to know when the context pauses or resumes. See `vigiarContextoDeAudio`.
 */
const vigias = new Set<(mudanca: MudancaDoContexto) => void>()

export type MudancaDoContexto =
  /** Left `running` because the system did it; `state` is the browser's word. */
  | { t: "parou"; estado: string }
  /** Went back to `running` after a pause already reported. */
  | { t: "voltou" }

/**
 * Track the context state, and ask it to resume when the system pauses it.
 *
 * Investigated on November 2, 2026 ("I stop hearing others until I exit and re-enter").
 * Normal call sound does NOT come through here: it plays on the media element of each
 * card. What comes through here is sound from someone with volume above 100% (`VideoTile`),
 * and it goes silent for good if the system suspends the context (another sound loss,
 * machine falling asleep, Safari "interrupting") and no one resumes it: the `resume` was
 * only asked when moving the cursor. It is asked here, and logged, so next time we know
 * if it was this.
 */
function vigiar(novo: AudioContext): void {
  let parado = false
  const aoMudar = (): void => {
    const estado = novo.state as string
    if (estado === "running") {
      if (!parado) return
      parado = false
      for (const vigia of vigias) vigia({ t: "voltou" })
      return
    }
    // Closed is end of life, not a pause: nothing to resume.
    if (estado === "closed" || parado) return
    parado = true
    for (const vigia of vigias) vigia({ t: "parou", estado })
    void Promise.resolve(novo.resume?.()).catch(() => {})
  }
  try {
    novo.addEventListener?.("statechange", aoMudar)
  } catch {
    // A context with no events (a double, an old engine) still works.
  }
}

/** Listen to the shared context pauses. Returns how to stop listening. */
export function vigiarContextoDeAudio(ouvinte: (mudanca: MudancaDoContexto) => void): () => void {
  vigias.add(ouvinte)
  return () => {
    vigias.delete(ouvinte)
  }
}

export function obterContextoDeAudio(): AudioContext | null {
  if (contexto) return contexto
  const Construtor =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Construtor) return null
  try {
    contexto = new Construtor()
    vigiar(contexto)
    return contexto
  } catch {
    return null
  }
}

/**
 * Forget the stored context.
 *
 * Exists for tests, which set up a fake Web Audio per file: without this, the
 * first test stores a context from the old double and the following ones measure
 * a graph that is no longer theirs.
 */
export function esquecerContextoDeAudio(): void {
  contexto = null
}

import { useCallback, useEffect, useState } from "react"
import { PREFS_EVENT, readPrefs } from "./usePrefs.js"

/**
 * How loud each person is heard, stored on the device.
 *
 * Lowering someone's volume was a choice that lasted as long as the call panel
 * stayed open on the screen. Switching channels unmounted it, the dock took its
 * place, and the dock never knew these values, and everyone went back to 100%.
 * Going back to the panel remounted it with an empty map. Whoever had lowered
 * someone for any reason heard them at full blast in the next call, or two minutes
 * later on the same screen.
 *
 * Stored locally, in its own key, for the same reason as what is folded in the
 * sidebar: this is a list that grows with the people you talk to, not a
 * appearance choice. Putting it inside `Prefs` would force rewriting the entire
 * record, color, sound, microphone, every time someone dragged a volume slider.
 */

export const VOLUMES_KEY = "enclave.volumes"

/**
 * Cap on what gets stored.
 *
 * No one tells this record when a person stops existing, so without a cap it would
 * grow forever. The latest are what matter: they are the most recently chosen ones.
 * Only deliberate choices enter here, see `writeVolumes`, and two hundred gives
 * plenty of people.
 */
const VOLUMES_MAX = 200

/** No choice, and the factory value: the person as they arrive. */
export const VOLUME_NORMAL = 1

/**
 * The cap on how loud someone can be heard, and why it is 2 and not 1.
 *
 * A media element's `volume` does not go above 1: that is the format limit, not our
 * choice. Someone who arrived quiet arrived quiet and that was it, which is the
 * complaint of September 13, 2026. Above 1 the sound stops going through the element
 * and passes through an audio graph with a limiter; see `VideoTile`. Two is where we
 * stop because what you gain above that gets lost in amplified noise.
 */
export const VOLUME_MAX = 2

/**
 * Tolerant read, like everything else in `localStorage`: no key, broken JSON,
 * or garbage all return the same thing, nobody downloaded, which is the safe
 * state. The alternative would be to start someone silently because of a
 * corrupted record, with nothing on screen to explain it.
 */
export function readVolumes(storage: Pick<Storage, "getItem"> = localStorage): Map<string, number> {
  try {
    const raw = storage.getItem(VOLUMES_KEY)
    if (!raw) return new Map()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Map()
    const lidos = new Map<string, number>()
    for (const entrada of parsed) {
      if (!Array.isArray(entrada) || entrada.length !== 2) continue
      const [endereco, valor] = entrada as [unknown, unknown]
      if (typeof endereco !== "string" || endereco.length === 0) continue
      // Outside 0-2 is garbage: a negative means nothing, and above the cap is a
      // corrupted record asking for amplification that we don't grant.
      if (typeof valor !== "number" || !Number.isFinite(valor) || valor < 0 || valor > VOLUME_MAX) continue
      lidos.set(endereco, valor)
    }
    return new Map([...lidos].slice(-VOLUMES_MAX))
  } catch {
    return new Map()
  }
}

/**
 * Save only what is a CHOICE.
 *
 * Someone at 1 is at factory state, and setting someone back to 100% deletes
 * the entry instead of saving it, the difference between a record that grows
 * with everyone you talk to and one that grows only with everyone you changed.
 */
export function writeVolumes(volumes: Map<string, number>, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    const escolhas = [...volumes].filter(([, valor]) => valor !== VOLUME_NORMAL).slice(-VOLUMES_MAX)
    storage.setItem(VOLUMES_KEY, JSON.stringify(escolhas))
  } catch {
    // Storage full or locked. The choice stays valid for this session, which is
    // all we can save from here.
  }
}

/**
 * The output volume, which multiplies the volume of each person.
 *
 * Read from disk and read again on the notice: moving the slider in Settings
 * while the dock is mounted must be heard at once, not only in the next call.
 * See `PREFS_EVENT`.
 */
export function useVolumeDeSaida(): number {
  const [valor, setValor] = useState(() => readPrefs().outputVolume)
  useEffect(() => {
    const reler = (): void => setValor(readPrefs().outputVolume)
    window.addEventListener(PREFS_EVENT, reler)
    return () => window.removeEventListener(PREFS_EVENT, reler)
  }, [])
  return valor
}

export function useVolumes(): {
  volumes: Map<string, number>
  volumeDe: (endereco: string) => number
  definirVolume: (endereco: string, valor: number) => void
} {
  const [volumes, setVolumes] = useState<Map<string, number>>(readVolumes)

  const definirVolume = useCallback((endereco: string, valor: number) => {
    // Merged against what is ON DISK, not against this copy, for the same reason
    // as `choose` in preferences: the panel and dock both read from this record,
    // and a stale copy here would erase the choice made on the other side.
    const seguinte = new Map(readVolumes())
    seguinte.set(endereco, valor)
    writeVolumes(seguinte)
    setVolumes(seguinte)
  }, [])

  const volumeDe = useCallback((endereco: string) => volumes.get(endereco) ?? VOLUME_NORMAL, [volumes])

  return { volumes, volumeDe, definirVolume }
}

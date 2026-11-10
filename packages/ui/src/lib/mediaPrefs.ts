import type { Prefs } from "../hooks/usePrefs.js"

/**
 * What the interface tells the core about the microphone and camera.
 *
 * **Exists because the bridge REPLACES, not merges.** `applyMediaPrefs` writes
 * the whole record at once, the right design, because "absent" has to be able
 * to mean "no choice", and the consequence is that anyone calling with fewer
 * keys erases the ones they did not send. Three callers were assembling this
 * object by hand and one of them, the startup effect, forgot the chosen
 * microphone and the gain: switching screens was enough to make the choice
 * disappear from the core, and the next call would open the system device while
 * Settings kept showing a choice that no longer held.
 *
 * One function, one place, all keys. Whatever gets added to media prefs goes
 * here and reaches all three paths at once.
 */

/** The keys that travel, written once so the test can demand them all. */
export const CHAVES_DE_MEDIA = [
  "noiseSuppression",
  "echoCancellation",
  "autoGainControl",
  "videoQuality",
  "inputDeviceId",
  "inputGain",
  "filtroDeMicrofone",
  "videoDeviceId",
  "sensibilidadeAutomatica",
  "limiarDoMicrofone",
] as const

export type PrefsDeMedia = Pick<Prefs, (typeof CHAVES_DE_MEDIA)[number]>

export function prefsDeMediaParaONucleo(prefs: Prefs): PrefsDeMedia {
  return {
    noiseSuppression: prefs.noiseSuppression,
    echoCancellation: prefs.echoCancellation,
    autoGainControl: prefs.autoGainControl,
    videoQuality: prefs.videoQuality,
    // Empty travels as empty: the caller decides whether the absence of a choice becomes an
    // `exact` on "". That bridge is the decision, and it must receive the empty choice.
    inputDeviceId: prefs.inputDeviceId,
    inputGain: prefs.inputGain,
    filtroDeMicrofone: prefs.filtroDeMicrofone,
    // The chosen camera (phase 4). Empty means "whatever the system picks", like the
    // microphone. The bridge writes it to `call.videoDeviceId`, and capture requests it
    // with `exact`, with a fallback path if the camera has disappeared.
    videoDeviceId: prefs.videoDeviceId,
    // Microphone sensitivity (2/11/2026). Both always travel: the bridge passes the
    // line to the core only with auto off, and `null` with auto on.
    sensibilidadeAutomatica: prefs.sensibilidadeAutomatica,
    limiarDoMicrofone: prefs.limiarDoMicrofone,
  }
}

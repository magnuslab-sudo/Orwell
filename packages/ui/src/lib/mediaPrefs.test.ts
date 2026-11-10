import { describe, expect, it } from "vitest"
import { DEFAULT_PREFS } from "../hooks/usePrefs.js"
import { CHAVES_DE_MEDIA, prefsDeMediaParaONucleo } from "./mediaPrefs.js"

/**
 * What the interface tells the core about the microphone and camera, in one
 * place.
 *
 * Three callers were assembling this object by hand, the startup effect, the
 * microphone menu, and Settings, and they did not assemble the same thing: the
 * startup one forgot the chosen microphone and the gain. Because the bridge
 * REPLACES the whole record instead of merging, an incomplete call erased what
 * the previous one had set: just switching screens made the microphone choice
 * disappear and the next call would open the system device. Nobody caught the
 * moment it happened, because the screen kept showing the right choice.
 *
 * The guard is on the SHAPE, not the values: "has all these keys, always". A
 * test that only compared values would pass with a missing key, which is
 * exactly the bug.
 */

describe("as preferências de media que vão ao núcleo", () => {
  it("levam sempre todas as chaves, e nenhuma a mais", () => {
    expect(Object.keys(prefsDeMediaParaONucleo(DEFAULT_PREFS)).sort()).toEqual([...CHAVES_DE_MEDIA].sort())
  })

  it("levam o que está guardado, e não um valor de fábrica", () => {
    const guardadas = {
      ...DEFAULT_PREFS,
      noiseSuppression: false,
      echoCancellation: false,
      autoGainControl: false,
      videoQuality: "1080p" as const,
      inputDeviceId: "mic-abc",
      inputGain: 1.5,
      filtroDeMicrofone: false,
      videoDeviceId: "cam-abc",
      sensibilidadeAutomatica: false,
      limiarDoMicrofone: -40,
    }

    expect(prefsDeMediaParaONucleo(guardadas)).toEqual({
      noiseSuppression: false,
      echoCancellation: false,
      autoGainControl: false,
      videoQuality: "1080p",
      inputDeviceId: "mic-abc",
      inputGain: 1.5,
      filtroDeMicrofone: false,
      videoDeviceId: "cam-abc",
      sensibilidadeAutomatica: false,
      limiarDoMicrofone: -40,
    })
  })

  it("e um microfone por escolher viaja como escolha vazia, não como ausência", () => {
    // Absent and empty are the same intent, "whatever the system decides", but
    // only one survives a bridge that replaces the whole record. The bridge
    // decides what to do with empty, and to do that it has to receive it.
    expect(prefsDeMediaParaONucleo({ ...DEFAULT_PREFS, inputDeviceId: "" })).toHaveProperty("inputDeviceId", "")
  })
})

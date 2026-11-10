import { useCallback, useEffect, useState } from "react"

export interface Microfone {
  deviceId: string
  label: string
}

/**
 * Microphones on this device, and the problem that they lack names.
 *
 * `enumerateDevices()` always responds, but only labels devices after someone
 * grants microphone access at least once. Before that, the list shows device
 * IDs with empty `label` fields. A nameless list is worse than no list: it
 * reveals three microphones exist but prevents choosing between them, because
 * there is nothing to tell them apart.
 *
 * So `nomeados` exists as a separate indicator, not inferred from an empty
 * list. The UI shows the list when it loads, and explains what is missing when
 * it does not, never "Microphone 1, Microphone 2".
 *
 * Permission is not requested here, intentionally. Hovering over a button should
 * not trigger the browser microphone access dialog. An app that shows it without
 * being asked teaches people to click "allow" without reading. Permission comes
 * when someone joins a call, where it explains itself naturally, and names become
 * available afterward.
 */
export function useMicrofones(activo: boolean): {
  microfones: Microfone[]
  /** Do devices load by name? See the body of this function. */
  nomeados: boolean
} {
  const [microfones, setMicrofones] = useState<Microfone[]>([])
  const [nomeados, setNomeados] = useState(false)

  const reler = useCallback(() => {
    const media = navigator.mediaDevices
    if (!media?.enumerateDevices) {
      setMicrofones([])
      setNomeados(false)
      return
    }
    void media
      .enumerateDevices()
      .then((todos) => {
        const entradas = todos
          .filter((aparelho) => aparelho.kind === "audioinput")
          // The system default appears duplicated with its own ID on several browsers.
          // It is the same device again, and choosing it by the duplicate ID pins the
          // choice to an alias that changes when the system default changes. The "let
          // the system choose" option already exists in the menu list and does that job.
          .filter((aparelho) => aparelho.deviceId !== "default" && aparelho.deviceId !== "communications")
          .map((aparelho) => ({ deviceId: aparelho.deviceId, label: aparelho.label }))
        setMicrofones(entradas)
        setNomeados(entradas.length > 0 && entradas.every((entrada) => entrada.label.trim().length > 0))
      })
      .catch(() => {
        setMicrofones([])
        setNomeados(false)
      })
  }, [])

  useEffect(() => {
    if (!activo) return
    reler()
    // Headphones plugged in or unplugged while the menu is open: without this,
    // the list kept offering a device that is no longer there and hid the one
    // that just arrived.
    const media = navigator.mediaDevices
    media?.addEventListener?.("devicechange", reler)
    return () => media?.removeEventListener?.("devicechange", reler)
  }, [activo, reler])

  return { microfones, nomeados }
}

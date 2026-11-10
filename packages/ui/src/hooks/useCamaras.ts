import { useCallback, useEffect, useState } from "react"

export interface Camara {
  deviceId: string
  label: string
}

/**
 * This device's cameras, for the Microphone and camera picker.
 *
 * Same design as `useMicrofones`, and for the same reason: the browser only
 * gives the NAME of a device after someone grants camera access once, and a
 * camera list with no names lets you choose nothing. So `nomeadas` is a
 * separate response, and the design shows the phrase of what is missing instead
 * of "Camera 1, Camera 2".
 *
 * Also does not ask for permission: the one asking is "Preview the camera",
 * which is a user gesture. `reler` exists for that gesture: after the camera
 * opens, the names are readable, and the browser does not warn with
 * `devicechange`.
 */
export function useCamaras(activo: boolean): { camaras: Camara[]; nomeadas: boolean; reler: () => void } {
  const [camaras, setCamaras] = useState<Camara[]>([])
  const [nomeadas, setNomeadas] = useState(false)

  const reler = useCallback(() => {
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices
    if (!media?.enumerateDevices) {
      setCamaras([])
      setNomeadas(false)
      return
    }
    void media
      .enumerateDevices()
      .then((todos) => {
        const entradas = todos
          .filter((aparelho) => aparelho.kind === "videoinput")
          .map((aparelho) => ({ deviceId: aparelho.deviceId, label: aparelho.label }))
        setCamaras(entradas)
        setNomeadas(entradas.length > 0 && entradas.every((entrada) => entrada.label.trim().length > 0))
      })
      .catch(() => {
        setCamaras([])
        setNomeadas(false)
      })
  }, [])

  useEffect(() => {
    if (!activo) return
    reler()
    // A USB camera plugged in or unplugged with the screen open.
    const media = navigator.mediaDevices
    media?.addEventListener?.("devicechange", reler)
    return () => media?.removeEventListener?.("devicechange", reler)
  }, [activo, reler])

  return { camaras, nomeadas, reler }
}

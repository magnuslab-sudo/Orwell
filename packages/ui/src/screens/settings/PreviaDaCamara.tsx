import { useEffect, useRef, useState } from "react"
import { Button } from "../../components/Button.js"
import { strings } from "../../strings.js"

/**
 * "Preview the camera", on the Camera card (phase 4).
 *
 * Opens the chosen camera in a small preview inside the card, and closes it when
 * tapped again, when switching cameras, or when leaving settings. Closing means
 * STOPPING the streams: a camera left open after the screen exits leaves the laptop
 * light on, and the user reasonably concludes the app is filming.
 *
 * Does not open during a call: a second capture from the same camera may stop or
 * change the call camera (same care as `microfoneDaChamada` in microphone tests).
 * The preview mirrors like the call image (`video-proprio`).
 */
export function PreviaDaCamara({
  deviceId,
  emChamada,
  aoAbrir,
}: {
  /** Empty is the system camera. */
  deviceId: string
  emChamada: boolean
  /** Camera is open: camera names can now be read. See `useCamaras`. */
  aoAbrir?: () => void
}): React.JSX.Element {
  const [aberta, setAberta] = useState(false)
  const [falhou, setFalhou] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const aoAbrirRef = useRef(aoAbrir)
  aoAbrirRef.current = aoAbrir

  useEffect(() => {
    if (!aberta) return
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices
    if (!media?.getUserMedia) {
      setFalhou(true)
      setAberta(false)
      return
    }
    let vivo = true
    let fluxo: MediaStream | null = null
    void media
      .getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true, audio: false })
      .then((aberto) => {
        // Left before the camera responded: close already, without showing it.
        if (!vivo) {
          for (const faixa of aberto.getTracks()) faixa.stop()
          return
        }
        fluxo = aberto
        setFalhou(false)
        if (video.current) {
          video.current.srcObject = aberto
          void video.current.play().catch(() => {})
        }
        aoAbrirRef.current?.()
      })
      .catch(() => {
        if (!vivo) return
        setFalhou(true)
        setAberta(false)
      })
    return () => {
      vivo = false
      for (const faixa of fluxo?.getTracks() ?? []) faixa.stop()
      if (video.current) video.current.srcObject = null
    }
  }, [aberta, deviceId])

  if (emChamada) return <p className="field-note">{strings.definicoesNovas.previaEmChamada}</p>

  return (
    <div className="choice">
      <Button variant="ghost" onClick={() => setAberta((antes) => !antes)}>
        {aberta ? strings.definicoesNovas.previaFechar : strings.definicoesNovas.previa}
      </Button>
      {aberta && (
        <video
          ref={video}
          className="previa-da-camara video-proprio"
          autoPlay
          playsInline
          muted
          aria-label={strings.definicoesNovas.previa}
        />
      )}
      {falhou && <p className="field-note warn">{strings.definicoesNovas.previaFalhou}</p>}
    </div>
  )
}

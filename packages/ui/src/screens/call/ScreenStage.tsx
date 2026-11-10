import { useEffect, useRef, useState } from "react"
import { EcraInteiroIcon, SairDoEcraInteiroIcon } from "../../icons.js"
import { strings } from "../../strings.js"

/** The `<video>` in Safari on iPhone, which only does full screen in the system player. */
type VideoDoSafari = HTMLVideoElement & { webkitEnterFullscreen?: () => void }

/**
 * How to put this stage in full screen, or `null` if not.
 *
 * The whole stage (image, name, and volume) via the document API, where it
 * exists: all desktop browsers, Android, and the desktop app. On iPhone only
 * the `<video>` goes full screen, in the system player.
 */
function modoDeEcraInteiro(palco: HTMLElement | null, video: HTMLVideoElement | null): "palco" | "video" | null {
  if (palco && document.fullscreenEnabled && typeof palco.requestFullscreen === "function") return "palco"
  if (typeof (video as VideoDoSafari | null)?.webkitEnterFullscreen === "function") return "video"
  return null
}

/**
 * The shared screen, in focus: the full video, uncut, and its AUDIO.
 *
 * `object-fit: contain` (see `.call-palco video`): a screen with text does not
 * crop to fill a box, unlike a face. On top go the sharer's name (bottom left)
 * and stage gestures (top right): "Stop viewing" for the viewer, the count for
 * the sharer.
 *
 * **Screen audio plays HERE, and only here.** It was always a `<video muted>`,
 * and a shared screen with audio arrived silent (October 26, 2026 bug). The
 * audio comes in the same stream as the image (the call puts it there, in the
 * mesh and via SFU), so "Stop viewing", which tears down the stage, stops the
 * audio with the image. The volume is separate, apart from the speaker's voice
 * volume: it is music or system sound, not their voice.
 *
 * OUR screen arrives here with no audio track (see `Call.screenStream`), and
 * that is what keeps us from hearing our own sound twice.
 */
export function ScreenStage({
  stream,
  label,
  children,
}: {
  stream: MediaStream
  label: string
  /** The stage gestures, drawn over the screen. */
  children?: React.ReactNode
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const palco = useRef<HTMLElement>(null)
  /*
    Full screen (requested by owner, 11/2/2026). `emEcraInteiro` follows the
    document, not our button: Escape and the system gesture also exit, and the
    button must tell the truth afterward. `modo` is read after mounting, because
    it needs the elements.
  */
  const [emEcraInteiro, setEmEcraInteiro] = useState(false)
  const [modo, setModo] = useState<"palco" | "video" | null>(null)
  useEffect(() => {
    setModo(modoDeEcraInteiro(palco.current, video.current))
    const mudou = (): void => setEmEcraInteiro(document.fullscreenElement === palco.current && palco.current !== null)
    document.addEventListener("fullscreenchange", mudou)
    return () => document.removeEventListener("fullscreenchange", mudou)
  }, [])
  const alternarEcraInteiro = (): void => {
    if (modo === "video") {
      ;(video.current as VideoDoSafari | null)?.webkitEnterFullscreen?.()
      return
    }
    if (modo !== "palco") return
    if (document.fullscreenElement === palco.current) void document.exitFullscreen?.().catch(() => {})
    else void palco.current?.requestFullscreen().catch(() => {})
  }
  /*
    There is audio ARRIVING, not just a track: in the mesh the audio slot always
    exists between two new clients, and a sharer with no audio leaves a mute
    track there (`muted`, no packets). A volume slider over silence would be a
    lie. Read on every draw, redrawn when a track gains or loses packets.
  */
  const [, redesenhar] = useState(0)
  const faixasDeSom = stream.getAudioTracks()
  const temSom = faixasDeSom.some((faixa) => !faixa.muted)
  const [volume, setVolume] = useState(1)
  /**
   * The browser refused to play with audio without a gesture: the image stays,
   * silent, and audio turns on by itself on the next gesture the user makes on
   * the page.
   *
   * It was a "Turn on screen audio" button, and the owner does not want it
   * (11/2/2026): "audio is also transmitted by default, this doesn't need to be
   * an option". The viewer already tapped to enter and to see, so almost always
   * audio plays right away; this is just the safety net for when it doesn't.
   */
  const [somBloqueado, setSomBloqueado] = useState(false)

  useEffect(() => {
    const mudou = (): void => redesenhar((n) => n + 1)
    for (const faixa of faixasDeSom) {
      faixa.addEventListener?.("mute", mudou)
      faixa.addEventListener?.("unmute", mudou)
    }
    return () => {
      for (const faixa of faixasDeSom) {
        faixa.removeEventListener?.("mute", mudou)
        faixa.removeEventListener?.("unmute", mudou)
      }
    }
  }, [stream, faixasDeSom.map((faixa) => faixa.id).join(",")])

  useEffect(() => {
    const element = video.current
    if (!element || element.srcObject === stream) return
    element.srcObject = stream
    void element.play().catch(() => {
      // A stream torn down partway. Refusal of autoplay with audio is
      // handled in the effect below, which is what removes `muted`.
    })
  }, [stream])

  useEffect(() => {
    const element = video.current
    if (!element) return
    element.volume = volume
    const calado = !temSom || somBloqueado
    if (element.muted === calado) return
    element.muted = calado
    if (calado) return
    // Removing `muted` can make the browser stop the video (autoplay with audio
    // without gesture). In that case it mutes again, to keep the image going, and
    // audio waits for the next gesture on the page (effect below).
    void element.play().catch(() => {
      element.muted = true
      void element.play().catch(() => {})
      setSomBloqueado(true)
    })
  }, [stream, temSom, volume, somBloqueado])

  /*
    Waiting for a gesture: the first touch, click, or key ANYWHERE on the page
    turns on audio. `play()` runs INSIDE the listener, which is the gesture the
    browser asks for; done later, in an effect, the gesture is already over and
    the browser could refuse again. In the capture phase, so a `stopPropagation`
    from another control does not hide it. `aEsperar` prevents a second gesture,
    before React redraws, from calling `play()` twice.
  */
  useEffect(() => {
    if (!somBloqueado || !temSom) return
    let aEsperar = true
    const ligar = (): void => {
      const element = video.current
      if (!aEsperar || !element) return
      aEsperar = false
      element.muted = false
      setSomBloqueado(false)
      void element.play().catch(() => {
        element.muted = true
        void element.play().catch(() => {})
        setSomBloqueado(true)
      })
    }
    const opcoes = { capture: true } as const
    document.addEventListener("pointerdown", ligar, opcoes)
    document.addEventListener("keydown", ligar, opcoes)
    return () => {
      aEsperar = false
      document.removeEventListener("pointerdown", ligar, opcoes)
      document.removeEventListener("keydown", ligar, opcoes)
    }
  }, [somBloqueado, temSom])

  return (
    <section ref={palco} className={emEcraInteiro ? "call-palco em-ecra-inteiro" : "call-palco"} aria-label={label}>
      <video ref={video} autoPlay playsInline muted onDoubleClick={alternarEcraInteiro} />
      <footer className="call-palco-label">
        {label}
        {temSom && (
          <input
            type="range"
            className="call-palco-som"
            min={0}
            max={100}
            step={5}
            value={Math.round(volume * 100)}
            aria-label={strings.call.screenSoundVolume}
            aria-valuetext={`${Math.round(volume * 100)} %`}
            title={strings.call.screenSoundVolume}
            onChange={(evento) => setVolume(Number(evento.currentTarget.value) / 100)}
          />
        )}
      </footer>
      {children && <div className="call-palco-gestos">{children}</div>}
      {modo && (
        <button
          type="button"
          className="call-palco-inteiro"
          aria-label={emEcraInteiro ? strings.call.sairDoEcraInteiro : strings.call.ecraInteiro}
          title={emEcraInteiro ? strings.call.sairDoEcraInteiro : strings.call.ecraInteiro}
          onClick={alternarEcraInteiro}
        >
          {emEcraInteiro ? <SairDoEcraInteiroIcon size={18} /> : <EcraInteiroIcon size={18} />}
        </button>
      )}
    </section>
  )
}

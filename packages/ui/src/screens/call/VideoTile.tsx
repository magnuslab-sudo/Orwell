import { useEffect, useRef } from "react"
import { useNivelDeVoz } from "../../hooks/useNivelDeVoz.js"
import { MarcaDeChamada } from "../../components/MarcaDeChamada.js"
import { obterContextoDeAudio } from "../../lib/contextoDeAudio.js"
import { strings } from "../../strings.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"

/**
 * A participant's video, or their initial when the camera is off.
 *
 * The stream is attached imperatively because `srcObject` is not a serialisable
 * attribute — React cannot set it from JSX.
 */
export function VideoTile({
  stream,
  muted,
  micCalado = false,
  silenciadoPorMim = false,
  mostrarVoz = true,
  label,
  endereco,
  connected,
  estado,
  volume = 1,
  proprio = false,
}: {
  stream: MediaStream | null
  /**
   * Do NOT hear this box, our decision, applied to the `<video>` element.
   *
   * Our own box always has it on (hearing your own microphone is a loop), and
   * others have it when audio is off.
   */
  muted: boolean
  /**
   * This person's microphone is off, THEIR decision, which traveled through
   * the call signaling.
   *
   * Different name from `muted` on purpose, and not for the sake of Portuguese:
   * the two things are opposites and lived one attribute apart. `muted={participant.muted}`
   * compiles, looks right, and mutes the box instead of showing the badge,    * nobody hears the person and nobody understands why.
   */
  micCalado?: boolean
  /** We turned this person's volume to zero. It is not the same as them muting. */
  silenciadoPorMim?: boolean | undefined
  /**
   * This box is VISIBLE, so it is worth measuring their voice.
   *
   * Not a taste for toggles: these boxes exist in two places where nobody sees
   * them. The video strip in the panel stays zero height while nobody turns on
   * a camera (the vast majority of calls), and the dock keeps them in a one-pixel
   * square at 1% opacity just so audio plays. In both cases the meter ran the same,
   * sixty times a second, per person, to draw a ring inside an invisible box.
   *
   * Whoever knows if the box is visible is whoever mounts it, so the answer comes
   * from outside. By default it measures: a box nobody marked is a visible box.
   */
  mostrarVoz?: boolean
  label: string
  /** The account, for the name derived from the address to come out discreet (`NomeDePessoa`). */
  endereco?: string | undefined
  connected: boolean
  /**
   * What to write when `connected` is false, and how much it weighs.
   *
   * It was written here, always `strings.call.connecting`, and it is the twin
   * half of what `CallChip` had: in an SFU call there is no connection to set
   * up with that person, and "connecting..." over their face for ten minutes
   * describes nothing. `lib/estadoDaChamada.ts` decides, and the two boxes say
   * the same thing because they get the same answer.
   *
   * Absent keeps what was here, which is what the dock and our own box still want.
   */
  estado?: { texto: string; tom: "activo" | "aEsperar" | "parado" } | undefined
  volume?: number
  /**
   * It is our own camera. Only it is mirrored ("Mirror my image",
   * `[data-espelho]` in `screens.css`): everyone else's face looks as it is.
   */
  proprio?: boolean
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const caixa = useRef<HTMLDivElement>(null)
  const hasVideo = (stream?.getVideoTracks().length ?? 0) > 0

  /*
    The card responding to audio.

    Write `--voz` on this element, from 0 to 1, and CSS does the rest. It does
    not go through state: see the hook header. With the person's microphone off
    there is nothing to measure, and measuring anyway would draw a pulsing ring
    around someone who is mute.

    `mostrarVoz` is the second reason not to measure, and the one that saves
    most: a box nobody sees has no ring to draw. See the attribute.
  */
  useNivelDeVoz(caixa, micCalado || !mostrarVoz ? null : stream)

  /**
   * Above 100% the audio stops going through the element.
   *
   * The `volume` of a media element has a cap of 1: it is the format cap, and
   * it left quiet arrivals with no fix. From there up the audio goes through an
   * audio graph with a limiter, and the element mutes, but it still holds the
   * stream because on Chromium remote audio only reaches the graph if wired to a
   * media element.
   */
  const amplificado = volume > 1 && !muted

  // Volume is a property of the element, not an attribute, so React cannot set
  // it from JSX. Applied per participant rather than globally: one person on a
  // bad microphone should not force everyone else to be turned down.
  useEffect(() => {
    if (video.current) video.current.volume = amplificado ? 1 : Math.min(1, volume)
  }, [volume, stream, amplificado])

  /**
   * Amplification, on a CLONE and never on the stream that is playing.
   *
   * It is the same rule as the meter (see `useNivelDeVoz`): on Chrome, wiring a
   * Web Audio source to the stream feeding a media element makes the graph take
   * over routing and the element mutes. Here that would be fatal, the path
   * exists precisely so people hear more, not to silence someone.
   */
  useEffect(() => {
    if (!amplificado || !stream) return
    const audio = stream.getAudioTracks()
    if (audio.length === 0) return
    const ctx = obterContextoDeAudio()
    if (!ctx) return

    const clones = audio.map((faixa) => faixa.clone())
    let fonte: MediaStreamAudioSourceNode | null = null
    let ganho: GainNode | null = null
    let limitador: DynamicsCompressorNode | null = null
    try {
      fonte = ctx.createMediaStreamSource(new MediaStream(clones))
      ganho = ctx.createGain()
      ganho.gain.value = volume
      // The same limiter as capture, and for the same reason: amplifying without it
      // trades "quiet" for "loud and distorted".
      limitador = ctx.createDynamicsCompressor()
      limitador.threshold.value = -3
      limitador.knee.value = 0
      limitador.ratio.value = 20
      limitador.attack.value = 0.003
      limitador.release.value = 0.25
      fonte.connect(ganho).connect(limitador).connect(ctx.destination)
      // A suspended context plays nothing, and the gesture that moved the slider
      // is enough to wake it.
      void ctx.resume?.().catch(() => {})
    } catch {
      for (const clone of clones) clone.stop()
      return
    }

    return () => {
      fonte?.disconnect()
      ganho?.disconnect()
      limitador?.disconnect()
      // The clones are ours: without this there is one per person for every time
      // someone moves the slider, all drawing from the same source.
      for (const clone of clones) clone.stop()
    }
  }, [amplificado, volume, stream])

  useEffect(() => {
    const element = video.current
    if (!element || element.srcObject === stream) return
    element.srcObject = stream

    // `autoplay` alone is unreliable when the source is attached after mount:
    // the element is already past the point where the attribute would have
    // fired, so it sits there silently holding a live stream. Asking explicitly
    // is the difference between a call and a picture of one.
    void element.play().catch(() => {
      // Blocked by autoplay policy. Nothing useful to do from here; the browser
      // will allow it after the next interaction with the page.
    })
  }, [stream])

  return (
    <div ref={caixa} className={connected ? "tile" : `tile pending tom-${estado?.tom ?? "aEsperar"}`}>
      {/* Always rendered: audio needs an element even with no picture. Our own
          tile is muted, always — playing our own microphone back is a loop. */}
      {/* Muted when amplified too: the graph takes over, and having both play would
          give the same voice twice, out of sync. */}
      <video
        ref={video}
        autoPlay
        playsInline
        muted={muted || amplificado}
        className={[hasVideo ? "" : "audio-only", proprio ? "video-proprio" : ""].filter(Boolean).join(" ")}
      />
      {!hasVideo && <span className="tile-initial">{label[0]?.toUpperCase() ?? "?"}</span>}
      <footer className="tile-label">
        {/* Next to the name, before it: this is what you search for in a grid of
            faces when nobody answers. An `role="img"` with an accessible name
            because the image is all the information, without it, screen readers
            get just the names and nothing else. */}
        {micCalado && <MarcaDeChamada tipo="calado" nome={label} className="tile-mic-off" size={14} />}
        {silenciadoPorMim && <MarcaDeChamada tipo="silenciado" nome={label} className="tile-silenced" size={14} />}
        <span>
          <NomeDePessoa nome={label} endereco={endereco} />
        </span>
        {!connected && <span className="tile-state">{estado?.texto ?? strings.call.connecting}</span>}
      </footer>
    </div>
  )
}

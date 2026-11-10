import { useEffect, useRef } from "react"
import type { Profile } from "../../bridge.js"
import { Andante } from "../../components/Andante.js"
import { Avatar } from "../../components/Avatar.js"
import { BotaoMais } from "../../components/BotaoMais.js"
import { useToqueLongo } from "../../hooks/useToqueLongo.js"
import { Onda } from "../../components/Onda.js"
import { useNivelDeVoz } from "../../hooks/useNivelDeVoz.js"
import { HeadphonesIcon, MusicaIcon, OlhoCheioIcon, ReproduzirCheioIcon } from "../../icons.js"
import { strings } from "../../strings.js"
import { Visualizador } from "./Visualizador.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"

export function CallChip({
  label,
  endereco,
  profile,
  texto,
  tom = "activo",
  stream = null,
  micCalado = false,
  volume,
  onVolume,
  camara = null,
  dbDaEntrada,
  aTocar = null,
  volumeDaMusica,
  onVolumeDaMusica,
  presence,
  aLigar = false,
  musicaCalada = false,
  onAlternarMusica,
  musica = null,
  proprio = false,
  onMenu,
  aoVivo,
}: {
  label: string
  /** The test, so the name taken from the address comes out discreet (`NomeDePessoa`). Our card does not pass it. */
  endereco?: string | undefined
  profile: Profile | undefined
  /**
   * The person's state, which drives the ring color. Absent means connected: green
   * ring. Connected but establishing: gray ring. The card always knows this, so the
   * ring is never missing.
   */
  presence?: "active" | "away" | "busy" | "idle" | undefined
  /** What displays below the name. Already decided: see `lib/estadoDaChamada.ts`. */
  texto: string
  /**
   * The weight of this state, and why it is a value instead of a computed property.
   *
   * Previously this was `state === strings.call.connecting`: the card's appearance was
   * decided by comparing text to the TRANSLATED STRING. Two bad consequences. Changing
   * the wording changed the appearance silently, and in English the comparison often
   * failed because `strings` in this file is the selected language, but the phrase
   * came from the same source, so they only matched by luck. Worse, there was no way
   * to have two different phrases for two states that render the same: `pending` only
   * recognized one.
   */
  tom?: "activo" | "aEsperar" | "parado" | undefined
  /**
   * This person's voice, so the card can respond to it.
   *
   * This is the card shown in voice-only calls. Video boxes stay hidden at zero
   * height until someone enables their camera, and the ring they drew with the level
   * reached no one. In a row of identical cards, the speaker was indistinguishable
   * from the silent.
   *
   * `null` is valid and common: someone connecting has no stream yet. The card stays
   * at rest, which is the truth.
   */
  stream?: MediaStream | null | undefined
  /**
   * This person has muted their microphone: THEIR choice.
   *
   * Same distinction as `VideoTile`, for the same reason: with the microphone muted
   * there is nothing to measure, and measuring anyway would draw a moving waveform
   * next to someone silent. The muted-mic indicator lives beside the card, in
   * `CallPanel`.
   */
  micCalado?: boolean | undefined
  volume?: number
  onVolume?: (volume: number) => void
  /**
   * This person's camera, when enabled: the card shows the video in place of the
   * avatar.
   *
   * Video only, silent. This person's audio plays in the hidden box of `.call-video`
   * (the `VideoTile`), which is always mounted: this way enabling and disabling the
   * camera does not remount the element that plays their voice.
   */
  camara?: MediaStream | null | undefined
  /**
   * Our input level, in dBFS, measured before the gate. Only on our card. Must be a
   * stable function. See `useNivelDeVoz`.
   */
  dbDaEntrada?: (() => number | null) | undefined
  /**
   * What this person is playing in the call, or nothing. Phase 9.
   *
   * One line below the state, "Playing: …", like the "sharing screen" indicator next
   * to the name: everyone in the room must know where the music comes from.
   */
  aTocar?: string | null | undefined
  /**
   * This person's MUSIC volume, separate from voice. Only when music arrives.
   *
   * Between 0 and 1: music plays in its own `<audio>`, and the element's cap is 1.
   */
  volumeDaMusica?: number | undefined
  onVolumeDaMusica?: ((volume: number) => void) | undefined
  /**
   * The person is in the room by presence, and OUR connection to them is still
   * establishing.
   *
   * Owner request on October 27, 2026: entering a voice room, the faces the sidebar
   * showed would vanish from the panel until media arrived, and the room looked empty.
   * The card stays, faded with a spinning ring: the same progress indicator as opening,
   * and says "they are there, connection pending".
   */
  aLigar?: boolean | undefined
  /**
   * This person's music is muted on this device, and the gesture to mute or unmute it
   * (owner, October 27, 2026). Mutes only music: voice continues. The slider keeps its
   * value, to return to the same level.
   */
  musicaCalada?: boolean | undefined
  onAlternarMusica?: (() => void) | undefined
  /**
   * This person's music track (on the DJ side, the one playing; on the listener side,
   * the one arriving), for the visualizer at the card's bottom. Only renders with
   * `aTocar`: when paused or stopped, no moving background.
   */
  musica?: MediaStream | null | undefined
  /** This is our card: the camera mirrors if the person chose it. See `VideoTile`. */
  proprio?: boolean
  /**
   * This person's menu (Phase 3): right-click, long touch, or "⋯". Missing, the card
   * has no menu. The panel mounts it (`itensDaPessoaNaChamada`).
   */
  onMenu?: ((at: { x: number; y: number }) => void) | undefined
  /**
   * This person is sharing their screen: "A with C", chosen by the owner on November 2,
   * 2026 (`Downloads/Orwell-overlays-ao-vivo/`).
   *
   * - `aVer`: how many are watching (the eye icon next to the badge); `null` when
   *   unknown, and then no number shows.
   * - `onVer`: open the share in full view. With it, the entire card is the gesture,
   *   and on hover (always on a touch screen), the prompt "View broadcast" appears.
   *   Without it (our card, or a screen already being viewed), just the badge.
   */
  aoVivo?: { aVer: number | null; onVer?: (() => void) | undefined } | undefined
}): React.JSX.Element {
  const silenced = volume === 0
  const cartao = useRef<HTMLSpanElement>(null)
  const aoDedo = useToqueLongo()

  /*
    The card responding to sound.

    Writes `--voz` on this `<span>`, between 0 and 1, and CSS does the rest: the
    waveform inside inherits the property, and the thin ring and halo light up with
    it. It does not pass through any React state. See the hook header.

    Our own card measures BEFORE the gate (`dbDaEntrada`): see the hook.
  */
  useNivelDeVoz(cartao, micCalado ? null : stream, { dbDaEntrada })
  const comCamara = camara != null && camara.getVideoTracks().length > 0
  const onVer = aoVivo?.onVer

  return (
    <span
      ref={cartao}
      className={[
        "call-chip",
        tom === "activo" ? "" : `pending tom-${tom}`,
        // The ring turns gray with a crosshatch: muted microphone is shown both by color
        // and by shape.
        micCalado ? "mic-calado" : "",
        aLigar ? "a-ligar" : "",
        aTocar ? "com-rodape" : "",
        aoVivo ? "ao-vivo" : "",
        onVer ? "ao-vivo-convida" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onContextMenu={
        onMenu
          ? (event) => {
              event.preventDefault()
              onMenu({ x: event.clientX, y: event.clientY })
            }
          : undefined
      }
      {...aoDedo(onMenu)}
      onClick={
        onVer
          ? (event) => {
              /*
                The entire card opens the share, except the controls already belonging
                to it: volume, music, "⋯". These respond on their own, and clicking the
                volume slider cannot carry the person moving it to someone else's screen.
                */
              const alvo = event.target as Element
              if (alvo.closest("input, label, button, a") && !alvo.closest(".ao-vivo-ver")) return
              onVer()
            }
          : undefined
      }
    >
      {/* Behind everything: the background that dances with the music (owner, October 27, 2026). */}
      {aTocar && musica && !comCamara && <Visualizador stream={musica} />}
      <span className="call-chip-rosto">
        {comCamara ? (
          <ImagemDaCamara stream={camara} proprio={proprio} />
        ) : (
          <>
            {/* Before the avatar, so the avatar and presence dot stay on top. */}
            <HaloDeVoz />
            {/* In a call everyone is on the call: the ring always pulses. */}
            <Avatar
              profile={profile}
              fallback={label[0] ?? "?"}
              presence={presence ?? (tom === "activo" ? "active" : "idle")}
              emChamada
            />
          </>
        )}
      </span>
      <span className="call-chip-labels">
        <span className="call-chip-name">
          <NomeDePessoa nome={label} endereco={endereco} />
        </span>
        <span className="call-chip-state">{silenced ? strings.call.silenced : texto}</span>
        {aTocar && musicaCalada && <span className="call-chip-musica-calada">{strings.musicaNaChamada.silenciada}</span>}
      </span>

      {/* The track name in the footer, scrolling when it does not fit (owner, October 27,
          2026): a band the width of the card, like a news ticker footer. It is the
          same `Andante` as in the call sidebar card.

          The footer is also the console for the listener (design D1, chosen by the
          owner on October 28, 2026): "audio when streamed should be regulated by the
          listener". The mute button and this person's music slider live INSIDE the
          footer, in a row with the name. Before they were separate, in absolute
          positions in the bottom corner, and the footer covered them. In a flex row
          nothing overlaps: the name gets whatever space is left and scrolls when it
          does not fit.

          Our card does not bring `onVolumeDaMusica` or `onAlternarMusica`: the DJ
          controls output on the "Share audio" sheet, and sees only the track here. */}
      {aTocar && (
        <span className={musicaCalada ? "call-chip-musica calada" : "call-chip-musica"} role="note">
          <MusicaIcon size={12} />
          <Andante className="call-chip-musica-nome" texto={strings.musica.aTocar(aTocar)} />
          {onAlternarMusica && (
            <button
              type="button"
              className="chip-musica-calar"
              aria-pressed={musicaCalada}
              aria-label={musicaCalada ? strings.musicaNaChamada.ouvirDe(label) : strings.musicaNaChamada.silenciarDe(label)}
              title={musicaCalada ? strings.musicaNaChamada.ouvir : strings.musicaNaChamada.silenciar}
              onClick={onAlternarMusica}
            >
              {/* The headphones, solid and crosshatched with the mask: what THIS person hears.
                  The note already sits at the start of the footer, and a second
                  crosshatched note made the crosshatch disappear from the solid head. */}
              <HeadphonesIcon size={14} off={musicaCalada} />
            </button>
          )}
          {/* Next to the button, not in its place: muting does not lose the level. */}
          {onVolumeDaMusica && (
            <label className="chip-volume chip-volume-musica" title={strings.musica.volumeDaMusica(label)}>
              <span className="sr-only">{strings.musica.volumeDaMusica(label)}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volumeDaMusica ?? 1}
                onChange={(event) => onVolumeDaMusica(Number(event.target.value))}
              />
            </label>
          )}
        </span>
      )}

      {/* The waveform sits at the end, next to the volume slider, not stuck to the face.

          This is where this card's audio lives: what we hear from this person, and how
          loud. Pressed against the avatar pushed the name away from the face, which is
          the reading this card exists to show. Who is speaking stays obvious without
          reading anything: the entire card lights up.

          Not drawn for someone muted: a still waveform next to the muted-mic marker
          says the same thing twice, and the second time with a shape that suggests it
          could still move. */}
      {!micCalado && <Onda barras={4} className="call-chip-onda" />}

      {/* Live (A): the badge and viewer count, always visible, in the top corner. */}
      {aoVivo && (
        <span className="ao-vivo-cimo">
          <span className="ao-vivo-selo">
            {strings.call.aoVivo}
            <span className="ao-vivo-ponto" aria-hidden="true" />
          </span>
          {aoVivo.aVer !== null && (
            <span className="ao-vivo-a-ver" role="img" aria-label={strings.call.screenViewers(aoVivo.aVer)}>
              <OlhoCheioIcon size={14} />
              {aoVivo.aVer}
            </span>
          )}
        </span>
      )}

      {/* The prompt (C): darkens and blurs the card, with the button at center. Only
          appears on hover or focus (always on a touch screen); the button is also the
          keyboard door to the same gesture. */}
      {onVer && (
        <span className="ao-vivo-convite">
          <button
            type="button"
            className="ao-vivo-ver"
            aria-label={strings.call.verATransmissaoDe(label)}
            onClick={(event) => {
              event.stopPropagation()
              onVer()
            }}
          >
            <span className="ao-vivo-ver-circulo" aria-hidden="true">
              <ReproduzirCheioIcon size={30} />
            </span>
            <span className="ao-vivo-ver-texto">{strings.call.verATransmissao}</span>
          </button>
        </span>
      )}

      {/* The person's "⋯" menu: the door for those who don't know about right-click. */}
      {onMenu && <BotaoMais className="call-chip-mais" label={strings.call.personMenu(label)} onAbrir={onMenu} />}

      {onVolume && (
        <label className="chip-volume" title={strings.call.volumeOf(label)}>
          <span className="sr-only">{strings.call.volumeOf(label)}</span>
          <input
            type="range"
            min={0}
            /* Up to 200%: the 1 cap is the media element's, and it left newcomers helpless. See
               `VOLUME_MAX`. */
            max={2}
            step={0.05}
            value={volume ?? 1}
            onChange={(event) => onVolume(Number(event.target.value))}
          />
        </label>
      )}
    </span>
  )
}

/**
 * The halo and ring around the avatar (board A3, "Halo", chosen by the owner on
 * October 21, 2026).
 *
 * The halo is ONE layer with the green shadow already painted once, at max size. Per
 * frame only `opacity` and `transform: scale` change, both read from `--voz`: they
 * are the two properties the compositor changes without repainting anything. A shadow
 * whose radius followed voice would repaint per frame, per person on the call.
 *
 * The ring is a 1-px SVG circle that stays always, so the outline does not vanish:
 * subtle when the person is silent, green when they speak, gray crosshatched when
 * muted. SVG because the stroke is geometry, and the browser antialiases it at any
 * scale (the old ring in two-level `box-shadow` was jagged). No `viewBox`: the radius
 * is a percentage of the box and the stroke is in pixels, equal across the three card
 * sizes.
 *
 * Both read properties written by `useNivelDeVoz` on the card: React renders this
 * once and never knows about it again.
 */
function HaloDeVoz(): React.JSX.Element {
  return (
    <>
      <span className="halo-de-voz" aria-hidden="true" />
      {/* Two overlapping rings, and green only changes `opacity`: same rule as the halo,
          so the outline color also asks for no repaint. */}
      <svg className="anel-de-voz repouso" aria-hidden="true" focusable="false">
        <circle cx="50%" cy="50%" r="45.3%" />
      </svg>
      <svg className="anel-de-voz fala" aria-hidden="true" focusable="false">
        <circle cx="50%" cy="50%" r="45.3%" />
      </svg>
    </>
  )
}

/** The camera image, silent: this person's audio plays in another element. */
function ImagemDaCamara({ stream, proprio }: { stream: MediaStream; proprio: boolean }): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const elemento = video.current
    if (!elemento || elemento.srcObject === stream) return
    elemento.srcObject = stream
    void elemento.play().catch(() => {
      // No gesture yet: the element shows the image when the browser allows.
    })
  }, [stream])
  return <video ref={video} className={proprio ? "call-chip-camara video-proprio" : "call-chip-camara"} autoPlay playsInline muted />
}

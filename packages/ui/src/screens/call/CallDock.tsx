import { useMemo, useRef, useState } from "react"
import type { Participant } from "@enclave/client-core"
import { Andante } from "../../components/Andante.js"
import { Onda } from "../../components/Onda.js"
import { HangUpIcon, MicIcon } from "../../icons.js"
import { useNivelDeVoz } from "../../hooks/useNivelDeVoz.js"
import { shortName } from "../../lib/format.js"
import { strings } from "../../strings.js"
import { useVolumeDeSaida, useVolumes } from "../../hooks/useVolumes.js"
import { chaveDoVolumeDaMusica, useMusicasCaladas } from "../../hooks/useMusicaDaChamada.js"
import { MusicaQueChega } from "./PartilharAudio.js"
import { VideoTile } from "./VideoTile.js"

/** Where the dock was left, per tab: convenience, not content. */
export const POSITION_KEY = "enclave.callDockPos"

export function readPosition(): { x: number; y: number } | null {
  try {
    const raw = sessionStorage.getItem(POSITION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { x?: number; y?: number }
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return null
    return clamp({ x: parsed.x, y: parsed.y })
  } catch {
    return null
  }
}

/**
 * The size guaranteed to the view, not the dock size.
 *
 * Height went from 56 to 72 the day the dock got two lines: with the old value,
 * dragging it down left the line showing where it is (the one saying channel and
 * room) below the screen edge. It is the information the dock gained, and so it
 * cannot be cut off.
 *
 * Width went from 240 to 272 for the same reason and with a larger cost: the
 * waveform added 26 pixels on the left, the dock became 260, and what went out
 * of bounds dragging right was the opposite end, the hang up button, which is
 * exactly what you look for first in a dock. Measured in
 * `scripts/medir-voz-visivel.mjs`, which drags the dock to the corner and checks
 * it fits whole; if someone adds more stuff without changing this, that script fails.
 */
const LARGURA_A_SALVO = 272
const ALTURA_A_SALVO = 72

/** Keep the dock reachable: never let it leave the viewport. */
export function clamp(position: { x: number; y: number }): { x: number; y: number } {
  const x = Number.isFinite(position.x) ? position.x : 8
  const y = Number.isFinite(position.y) ? position.y : 8
  return {
    x: Math.min(Math.max(x, 8), Math.max(8, window.innerWidth - LARGURA_A_SALVO)),
    y: Math.min(Math.max(y, 8), Math.max(8, window.innerHeight - ALTURA_A_SALVO)),
  }
}

/**
 * The call, kept alive and audible while you are somewhere else in the app —
 * or whenever you prefer it floating over the full panel.
 *
 * Draggable by its own body (pointer capture, clamped to the viewport, spot
 * remembered per tab). Audio plays through media elements, and elements die
 * with their component — which is how switching tabs used to silence a
 * healthy call. The shell mounts exactly one holder of the media elements at
 * any moment: this dock, or the full CallPanel.
 */
export function CallDock({
  channel,
  channelLabel,
  roomLabel,
  latencia = null,
  aPartilharEcra = false,
  participants,
  localStream,
  nameFor,
  soundOff = false,
  onBack,
  onLeave,
  variante = "flutuante",
  comAudio = true,
}: {
  channel: string
  channelLabel?: string | undefined
  /**
   * The ROOM where the call is happening, by the name given to it.
   *
   * Missing in a direct conversation, which has no rooms: there the dock says only
   * who you are talking to, and inventing a room would lie about the model.
   */
  roomLabel?: string | undefined
  /**
   * The latency, for the side card to say "42 ms" instead of "Connected".
   *
   * Owner request October 27, 2026: the number says you are connected and how well,
   * more than the word said. With no measurement (`null`) the word stays. The
   * floating dock does not show it: it is small and already has the waveform.
   */
  latencia?: { ms: number; ate: "servidor" | "par" } | null | undefined
  /**
   * The screen sharing path, ready and off.
   *
   * **Nothing in the product turns this on**, because screen sharing does not
   * exist yet (Phase 3). It stays here so the day it exists is one line
   * turning it on, not a rewrite of the dock. See `strings.callDock`.
   */
  aPartilharEcra?: boolean | undefined
  participants: Participant[]
  localStream: MediaStream | null
  nameFor: (sender: string) => string
  /**
   * Sound is muted on the identity card.
   *
   * The dock has to know because IT plays sound when the call panel is off screen,
   * which is most of the time the dock exists. Without this, muting sound silenced
   * the panel and the dock kept talking.
   */
  soundOff?: boolean | undefined
  onBack: () => void
  /** The hang up button. Only the floating form draws it: on the side, it is in the panel queue. */
  onLeave: () => void
  /**
   * Where the dock lives.
   *
   * `floating`: the card you drag over everything (phone, Friends, and
   * "Open in window"). `side`: the call box in the middle of the control panel,
   * at the bottom of the side bar, on a wide screen. Without the hang up button:
   * in side form, that button belongs to the panel (`CartaoDaConta`). The shell
   * decides; the two forms never exist at the same time with sound.
   */
  variante?: "flutuante" | "lateral" | undefined
  /**
   * Whether this dock plays sound. False when the call panel is on screen:
   * it plays, and the side card stays gesture only. There is always one
   * sound owner, and only one.
   */
  comAudio?: boolean | undefined
  /**
   * The microphone. The side card no longer draws it (October 27, 2026: the
   * button is in the account band, below). It stays in the type so the shell
   * that still passes it does not break; nothing here reads it.
   */
  micMuted?: boolean | undefined
  onToggleMic?: (() => void) | undefined
}): React.JSX.Element {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(readPosition)
  // Read on mount, which is when the panel just unmounted: it always catches the
  // most recent choice, because the two never are on screen at the same time.
  const { volumeDe } = useVolumes()
  const volumeDeSaida = useVolumeDeSaida()
  /* The dock plays music when the panel is off: it mutes the same one it does. */
  const musicasCaladas = useMusicasCaladas()
  const dragging = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const dock = useRef<HTMLElement | null>(null)

  const connected = participants.filter((participant) => participant.connected).length

  /**
   * The voices that are ARRIVING, together, for the dock to have a waveform.
   *
   * Ours do not count. The dock is what you glance at while somewhere else in
   * the app, and the question you ask it is "is that still alive?" Your own
   * voice always answers yes, even with the call broken on the other side, and
   * a waveform that animates when you look at it does not tell you anything.
   *
   * ⚠️ The list must be STABLE, and that is why the key is made from `id` and
   * not the array. `participants` is rebuilt on every `App` render; with it
   * as a dependency, the meter stopped and cloned tracks several times a second.
   * See the warning in `useNivelDeVoz`.
   */
  const chaveDasVozes = participants.map((participante) => participante.stream?.id ?? "").join("|")
  const vozes = useMemo(
    () => participants.flatMap((participante) => (participante.stream ? [participante.stream] : [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ver a chave acima
    [chaveDasVozes],
  )
  /*
    The level written on the entire dock, not in its own box.

    `--voz` inherits: written here, the waveform inside reads it with no
    intermediary and no extra element in the document. `dock` is the same
    reference that dragging uses, the meter target and the handle are the same card.
  */
  useNivelDeVoz(dock, vozes)

  /**
   * Where this call is: the channel, and the room inside it.
   *
   * Without `channelLabel` it falls back to the shortened identifier, which is
   * what was already shown, ugly but true, and better than a silent dock.
   */
  const canal = channelLabel ?? shortName(channel)
  const onde = roomLabel ? strings.callDock.ondeComSala(canal, roomLabel) : canal

  const onPointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    // Buttons keep their clicks; the dock's body is the drag handle.
    if (event.target instanceof Element && event.target.closest("button")) return
    const box = dock.current?.getBoundingClientRect()
    if (!box) return
    dragging.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - box.left,
      offsetY: event.clientY - box.top,
    }
    // Capture keeps the drag when the pointer outruns the dock; engines
    // without the API (test DOMs) just get a slightly worse drag.
    try {
      dock.current?.setPointerCapture(event.pointerId)
    } catch {
      // Fine without it.
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLElement>): void => {
    const drag = dragging.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPosition(clamp({ x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY }))
  }

  const onPointerUp = (event: React.PointerEvent<HTMLElement>): void => {
    if (dragging.current?.pointerId !== event.pointerId) return
    dragging.current = null
    setPosition((current) => {
      try {
        if (current) sessionStorage.setItem(POSITION_KEY, JSON.stringify(current))
      } catch {
        // Storage refused: the dock simply forgets its spot.
      }
      return current
    })
  }

  /*
    Invisible on purpose: sound only. The panel shows the faces.

    `mostrarVoz={false}` on all: these boxes live in a one-pixel square at
    1% opacity, and the ring the meter drew them was work per person, per frame,
    to paint what no one can see. The voice on this dock is measured once, on
    the entire card.

    Without `comAudio` (the panel is on screen and it plays) there are no boxes:
    two sound owners meant the same voice twice.
  */
  const audio = comAudio ? (
    <div className="call-dock-audio" aria-hidden="true">
      <VideoTile stream={localStream} muted mostrarVoz={false} label="" connected proprio />
      {participants.map((participant) => (
        <VideoTile
          key={participant.address}
          stream={participant.stream}
          muted={soundOff}
          mostrarVoz={false}
          label={nameFor(participant.address)}
          connected={participant.connected}
          /* The volume per person: this dock is the one that PLAYS sound when the panel
             is off screen, and what was chosen there must apply here. */
          volume={volumeDe(participant.address) * volumeDeSaida}
        />
      ))}
      {/* Each person's music (phase 9), with the volume chosen on the panel. */}
      {participants.map((participant) =>
        participant.musica ? (
          <MusicaQueChega
            key={`musica-${participant.address}`}
            stream={participant.musica}
            volume={volumeDe(chaveDoVolumeDaMusica(participant.address)) * volumeDeSaida}
            calado={soundOff || musicasCaladas.calada(participant.address)}
          />
        ) : null,
      )}
    </div>
  ) : null

  /**
   * The call box, on the middle floor of the control panel (wide screen).
   *
   * Since October 28, 2026 (owner's P1 design) the call and account are
   * one piece, the panel at the bottom of the column (`CartaoDaConta`). This box
   * is the middle floor: the dot, the ping and the count on top, "Channel · Room"
   * on the bottom. The whole box is the button to go back to the call. Hang up
   * moved from here to the panel button queue, next to the microphone: the five
   * equal buttons are what make the queue read like a console.
   *
   * It is still the dock (not a copy on the panel) because it is what plays
   * sound when the call panel is off screen, and the dot lights with the voice
   * arriving (`--voz`, written on the `aside`).
   */
  if (variante === "lateral") {
    /*
      The bottom line is just the place: "Channel · Room", and "Sharing screen"
      when this device is sharing. When it does not fit, the line scrolls
      (`Andante`).
    */
    const ondeLateral = [onde, aPartilharEcra ? strings.callDock.aPartilharEcra : null]
      .filter((parte): parte is string => Boolean(parte))
      .join(" · ")
    return (
      <aside ref={dock} className="call-dock lateral" aria-label={strings.callDock.ongoing}>
        <button type="button" className="call-dock-back" aria-label={strings.callDock.back} onClick={onBack}>
          <span className="call-dock-lines">
            <span className="call-dock-state">
              <span className="call-dock-ponto" aria-hidden="true" />
              {/* The ping in place of "Connected" (owner, October 27, 2026). In its own
                  element, so it can break into two lines: bare text in a flex
                  does not shrink, and was cut in the middle of the word. */}
              <span className="call-dock-texto">
                {latencia ? strings.callDock.ping(latencia.ms) : strings.callDock.ligado}
              </span>
              {/* The "·" separate and silent: it is decoration, and the count reads on its own. */}
              <span className="call-dock-separador" aria-hidden="true">
                ·
              </span>
              <span className="call-dock-count">{strings.call.people(connected + 1)}</span>
            </span>
            <Andante className="call-dock-where" texto={ondeLateral} />
          </span>
        </button>
        {audio}
      </aside>
    )
  }

  return (
    <aside
      ref={dock}
      className="call-dock"
      aria-label={strings.callDock.ongoing}
      style={position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* The dot that was here pulsed every 1.8 seconds, by the clock, and always
          said the same thing: that the dock exists. That is already clear from
          the whole card. The waveform says what it did not, that sound is really
          arriving, from someone, now. A still waveform with people talking on
          the other side is the first clue the connection broke, and before this
there was none.
          
          Faded when muted, because when muted you are not hearing anything: the
          waveform keeps moving (people keep talking, and knowing that matters)
          and stops presenting as if it were coming out the speakers. */}
      <Onda barras={5} className={soundOff ? "call-dock-onda sem-som" : "call-dock-onda"} />
      {/* Top to bottom: what is happening, where it is happening, and the way out.
          The whole text block is the back button, it is the gesture you want to
          make when reading the dock, and a one-line target was too small to hit
          with the call going. */}
      <button
        className="call-dock-back"
        data-tip={strings.callDock.back}
        aria-label={strings.callDock.back}
        onClick={onBack}
      >
        <MicIcon size={14} />
        <span className="call-dock-lines">
          <span className="call-dock-state">
            {aPartilharEcra ? strings.callDock.aPartilharEcra : strings.callDock.emChamada}
            <span className="call-dock-count">{strings.call.people(connected + 1)}</span>
          </span>
          <span className="call-dock-where" title={onde}>
            {onde}
          </span>
        </span>
      </button>
      <button
        className="call-btn hangup"
        data-tip={strings.call.leave}
        aria-label={strings.call.leave}
        onClick={onLeave}
      >
        <HangUpIcon size={15} />
      </button>

      {audio}
    </aside>
  )
}

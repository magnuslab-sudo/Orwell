import { useCallback, useState } from "react"
import { Call, type Participant } from "@enclave/client-core"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import {
  CameraIcon,
  ChatIcon,
  CloseIcon,
  HangUpIcon,
  HeadphonesIcon,
  MicIcon,
  MusicaIcon,
  OlhoIcon,
  PalcoIcon,
  PopOutIcon,
  ScreenShareIcon,
} from "../../icons.js"
import { useElapsed } from "../../hooks/useElapsed.js"
import { useEsperaPorFluxo } from "../../hooks/useEsperaPorFluxo.js"
import { useLimiteDeVideo } from "../../hooks/useLimiteDeVideo.js"
import { chaveDoVolumeDaMusica, useMusicaDaChamada, useMusicasCaladas } from "../../hooks/useMusicaDaChamada.js"
import { anfitriaoDoAgente, fontesDeAudioDoAnfitriao } from "../../lib/fontesDeAudio.js"
import { estadoDaPessoa, type AvisoDaChamada, type CaminhoDeMedia } from "../../lib/estadoDaChamada.js"
import { shortName } from "../../lib/format.js"
import { strings } from "../../strings.js"
import { MarcaDeChamada } from "../../components/MarcaDeChamada.js"
import { Vozes } from "../../components/Vozes.js"
import { CallChip } from "./CallChip.js"
import { ContextMenu } from "../overlays/ContextMenu.js"
import { itensDaPessoaEmVoz, itensDaPessoaNaChamada } from "../chat/menuItems.js"
import { useVolumeDeSaida, useVolumes } from "../../hooks/useVolumes.js"
import { ScreenStage } from "./ScreenStage.js"
import { BotaoDoSomDoEcra, SinalDoSomDoEcra, useSomDoEcraProprio } from "./SomDoEcraProprio.js"
import { MusicaQueChega, PartilharAudio, SinalDaMusica } from "./PartilharAudio.js"
import { VideoTile } from "./VideoTile.js"

/**
 * The call window, Discord-style (frames `ChamadaVoz` and
 * `ChamadaEcra`, approved 20 October 2026).
 *
 * Three parts, top to bottom: the header (who, how many, how long,
 * and window controls), the body (the tile grid, or the shared screen in focus
 * with tiles in a row above), and the fixed control bar at the bottom
 * (mic, camera, screen, sound, leave).
 *
 * Two modes, set by the shell:
 *  - `sala`: the open voice room. The call fills the entire main area.
 *  - `faixa`: the call above the conversation (a direct message, or the
 *    open voice room conversation). Same structure, lower.
 *
 * Video boxes (`.call-video`) always mount and hide: they play sound from
 * each person. A live camera shows in the person's tile on the grid.
 */
export function CallPanel({
  call,
  channel,
  participants,
  localStream,
  screenStream = null,
  selfLabel,
  selfProfile,
  nameFor,
  directory,
  micMuted = false,
  soundOff = false,
  onToggleMic,
  onToggleSound,
  onShareScreen,
  cameraOff: cameraOffDeCima,
  onToggleCamera,
  onLeave,
  onPopOut,
  caminho = null,
  aviso = null,
  onDispensarAviso,
  modo = "faixa",
  titulo,
  soPalco = false,
  onSoPalco,
  conversaAberta = false,
  onConversa,
  presenceFor,
  presencaPropria,
  aLigar = [],
  menuDaPessoa,
  semVoz = false,
  avisoAfk = null,
}: {
  call: EnclaveBridge["call"]
  channel: string
  participants: Participant[]
  localStream: MediaStream | null
  /**
   * The screen this account is sharing, or nothing.
   *
   * It comes from outside for the same reason the mic and sound do: the state
   * lives in the call engine, which announces it via the `screen` event, and a
   * `useState` here would be a second copy. Specifically one that ignores the
   * browser button, clicking "Stop sharing" in the bar Chrome puts at the top
   * bypasses every line in this file.
   */
  screenStream?: MediaStream | null | undefined
  selfLabel: string
  selfProfile: Profile
  nameFor: (sender: string) => string
  /**
   * Each person's state and ours, for the ring color on tiles. They come from
   * outside, as in every view: the `App` knows the state. Absent, the tile
   * shows the connection.
   */
  presenceFor?: ((address: string) => "active" | "away" | "busy" | "idle") | undefined
  presencaPropria?: "active" | "away" | "busy" | "idle" | undefined
  directory: Map<string, Profile>
  /**
   * The mic and sound, from outside.
   *
   * They lived here in `useState`, and this change undoes that. The same two
   * buttons now exist on the identity card in the sidebar, used before any call
   * starts; with local state, the panel opened saying "mic on" to someone who
   * muted ten minutes ago, and the next click changed their choice with no
   * warning. The camera stays local on purpose, it only exists while video
   * capture runs, and is not a preference that crosses calls.
   */
  micMuted?: boolean | undefined
  soundOff?: boolean | undefined
  onToggleMic?: (() => void) | undefined
  onToggleSound?: (() => void) | undefined
  /**
   * Who handles the share request, when the host must act first.
   *
   * Missing only on browser: load it and go straight to the engine, which is
   * what this panel always did. In the installed app two things happen first,    * read the macOS permission, and pick the window, and both live in
   * `usePartilhaDeEcra`, mounted in the shell. The panel stays unaware of them:
   * it gets a gesture and calls it.
   *
   * STOPPING the share never goes through here. There is no permission to ask
   * to stop doing something, and the stop path must work even if the host
   * brings nothing from this.
   */
  onShareScreen?: (() => void) | undefined
  /** When they come from above, they decide; without them the panel keeps the camera itself. */
  cameraOff?: boolean | undefined
  onToggleCamera?: (() => void) | undefined
  onLeave: () => void
  /** Convert to the floating, draggable popup — picture-in-picture style. */
  onPopOut?: (() => void) | undefined
  /**
   * The media path for this call. Comes from the shell, which reads it from
   * the core.
   *
   * It does one thing, and that is why this prop exists: in an SFU call,
   * `participant.connected` means "media is arriving" not "is connecting".
   * Without it, the panel wrote "connecting..." below someone in the call ten
   * minutes, whose sound never arrived.
   *
   * `null` speaks as mesh does, which is what this panel always did.
   */
  caminho?: CaminhoDeMedia | undefined
  /**
   * A warning about THIS call, when there is one the person needs to read.
   *
   * None of this showed. The core emitted the diagnosis, it went to the log,
   * and the screen stayed quiet: see `avisoDaChamada`, where the three that now
   * arrive here are, and why the others stay where they are.
   */
  aviso?: AvisoDaChamada | null | undefined
  /** Dismiss the warning. It stays written in the diagnostic log. */
  onDispensarAviso?: (() => void) | undefined
  /**
   * We are in the AFK room (2/11/2026): no voice or text. The voice,
   * screen, music and camera buttons leave the bar, and a line says why.
   * Hang up stays.
   */
  semVoz?: boolean | undefined
  /** "You moved to the AFK room", with the "Back" button. See `lib/relogioAfk.ts`. */
  avisoAfk?: { texto: string; voltar: string; onVoltar: () => void; onFechar: () => void } | null | undefined
  /** `sala` in the open voice room; `faixa` above a conversation. */
  modo?: "sala" | "faixa" | undefined
  /** The room (or conversation) name in the header. Without it, `#canal`. */
  titulo?: string | undefined
  /** "Stage only": the shell hides the rail and bars. */
  soPalco?: boolean | undefined
  onSoPalco?: (() => void) | undefined
  /** "Room chat": show the voice room conversation below the call. */
  conversaAberta?: boolean | undefined
  onConversa?: (() => void) | undefined
  /**
   * Who is in this room by presence (room announcements), with or without
   * connection to us. It is the list the sidebar already draws.
   *
   * Owner request 27 October 2026: "during join stop showing them until the
   * connection is official". `participants` only brings people who already have
   * a connection; those who only announced stayed out of the panel. They enter
   * as "connecting" tiles. When the connection arrives, the person moves to
   * `participants` and the tile is the usual one, in the same list place.
   */
  aLigar?: readonly string[] | undefined
  /**
   * The person menu context, for call tiles (phase 3).
   *
   * Same as someone in a voice room (`itensDaPessoaEmVoz`): the shell knows
   * friendship, powers and rooms, and the panel knows volume. The menu joins
   * both in `itensDaPessoaNaChamada`. Absent, tiles have no menu.
   */
  menuDaPessoa?: ((address: string) => Parameters<typeof itensDaPessoaEmVoz>[0] | null) | undefined
}): React.JSX.Element {
  /** The menu open on a tile: whose, and where. */
  const [menuNoCartao, setMenuNoCartao] = useState<{ address: string; at: { x: number; y: number } } | null>(null)
  const [cameraOffLocal, setCameraOffLocal] = useState(false)
  const cameraOff = cameraOffDeCima ?? cameraOffLocal
  /** No sound, mic is muted by drag. See `escolherAudio`. */
  const muted = micMuted || soundOff
  /**
   * How loud each person sounds, saved on the device, not just this call.
   *
   * It was a `useState` with an empty map, and the note said "for the life of
   * the call". The panel's life was even shorter: switching channels unmounts
   * it, the dock takes its place, and coming back everything was at 100% again.
   * See `useVolumes`.
   */
  const { volumeDe, definirVolume } = useVolumes()
  /* Output volume multiplies each person's: one fixes "this person is quiet",
     the other fixes "everything is quiet". See `useVolumeDeSaida`. */
  const volumeDeSaida = useVolumeDeSaida()
  const elapsed = useElapsed()

  /**
   * Our input level, before the gate, for the halo on our tile.
   *
   * The stream the call gives us already went through the voice chain, and the
   * gate silences low speech: the halo stayed still with sound coming in. The
   * chain measures input first (`call.audio.medir()`). No chain (`-120`, the
   * floor of empty measures), it returns `null` and the tile measures the
   * stream. Stable, because it is a meter dependency.
   *
   * With "Mic sensitivity" on manual, the ring follows the gate (`anelDb`):
   * below the line nothing goes out, and our tile cannot show us speaking when
   * others do not hear us. Closed is -120, and the ring turns off (does not
   * fall to stream: "no chain" means input at -120).
   */
  const audioDaChamada = (call as Partial<typeof call>).audio
  const dbDaEntrada = useCallback((): number | null => {
    const medidas = audioDaChamada?.medir()
    if (medidas === undefined || medidas.entradaDb <= -119) return null
    return medidas.anelDb ?? medidas.entradaDb
  }, [audioDaChamada])
  /* How long each person has been silent. It is what separates "still coming"
     from "this is broken", and without it the state never changed. */
  const esperaDe = useEsperaPorFluxo(participants)

  const hasCamera = (localStream?.getVideoTracks().length ?? 0) > 0
  const showingVideo =
    (hasCamera && !cameraOff) || participants.some((p) => (p.stream?.getVideoTracks().length ?? 0) > 0)
  /**
   * How many people this call has, and it is everyone: the header only counted
   * who we hear.
   *
   * It was `participants.filter(p => p.connected).length + 1`, and in an SFU
   * call that counts who has STREAM arriving. With five tiles drawn and two we
   * hear, the header said "3 people" above five faces, the count contradicting
   * the list, same tile and a glance away. Neither half explained the other.
   *
   * Count who is here: the roster is the source of who belongs (written in
   * `#anunciarPorSfu`), and who does not hear yet has their state written below
   * their own name, which is where that fact belongs.
   */
  const naChamada = participants.length + 1

  /* Those who only announced: outside the pairs (the list that arrives does not
     bring us them). No connection means no stream, volume, or marks to show;
     just the face and state. */
  const soAnunciados = aLigar.filter((quem) => !participants.some((par) => par.address === quem))

  /**
   * Who goes on stage: SOMEONE ELSE's screen before ours.
   *
   * We already have our screen in front of us, at true size. Giving it stage
   * above whoever shared at the same time would waste the only big place to
   * show what the person is looking at anyway, and the mirror inside the mirror
   * that draws. Whoever shares still knows they share by the lit button, the
   * mark next to their name, and the dock.
   */
  const outroAPartilhar = participants.find((participant) => participant.screen)
  /** Our screen sound: the signal above the bar and the mute gesture. */
  const somDoEcra = useSomDoEcraProprio(call)
  /**
   * Our music (phase 9): the player lives with the call, not the panel.
   * The sheet opens from the "Share audio" button, and closing it mutes nothing.
   */
  const musica = useMusicaDaChamada(call)
  /* Music from someone we muted on this device: mutes only the music track. */
  const musicasCaladas = useMusicasCaladas()
  const [folhaDeAudio, setFolhaDeAudio] = useState(false)
  const palco = outroAPartilhar
    ? { stream: outroAPartilhar.screen as MediaStream, label: strings.call.screenOf(nameFor(outroAPartilhar.address)) }
    : screenStream
      ? { stream: screenStream, label: strings.call.screenSelf }
      : null

  /**
   * Screens offered and pending.
   *
   * Owner request 5 October 2026: *when someone shares the screen, others
   * must join the stream only if they want to.* The stage opened by itself
   * and brought 2.5 Mbps with it, no simulcast or layers, so no small version
   * to ask for, and nowhere to refuse.
   *
   * `ecraOferecido` without `screen` is the unanswered offer: the roster says
   * there is a screen, and no stream because no one asked for it. See
   * `Participant`.
   *
   * **No alert sound**, by written plan decision: an offer is something that
   * appears, not something that interrupts.
   */
  const ofertasDeEcra = participants.filter((participant) => participant.ecraOferecido && !participant.screen)

  /** Who is watching OUR screen, and shows only while there is one. */
  const aVerONosso = screenStream ? participants.filter((participant) => participant.aVerONossoEcra).length : null

  /**
   * How many are watching SOMEONE ELSE's screen: the eye on the "LIVE" badge.
   *
   * Counted from each person's roster (`aVer`, what each person said they chose
   * to watch; same fact the log calls `call-ecra-aceite`), and we count
   * ourselves when their screen arrives here. Without changing the server: the
   * SFU knows who consumes what, but does not tell anyone.
   */
  const aVerDe = (address: Participant["address"], aVerEu: boolean): number =>
    participants.filter((outro) => outro.address !== address && (outro.aVer ?? []).includes(address)).length +
    (aVerEu ? 1 : 0)

  /**
   * If the share button shows, and when not, why.
   *
   * The two reasons are physical and different, so they are two sentences. A
   * button that vanishes with no explanation sends anyone looking for it to
   * Settings hunting a switch that does not exist.
   *
   * `podePartilharEcra` reads from the engine and does not store: the answer
   * depends on the live call, and an SFU call has no way to carry the image.
   * See the getter in `call.ts`.
   */
  /*
   * The limit comes from the CALL ENGINE, not the mesh constant.
   *
   * `Call.LIMITE_DE_PARTILHA` is six, and six is the mesh number: the screen
   * goes straight to each person and whoever shares going up is what breaks it.
   * In an SFU call whoever shares sends ONE copy, and the bottleneck moved to
   * server output, a different number and different sentence. Reading the
   * constant here would draw the button off at eleven people who fit.
   */
  const tecto = call.tectoDePartilha
  const porServidor = tecto !== Call.LIMITE_DE_PARTILHA
  const pessoasNaChamada = participants.length + 1
  const cabeNaChamada = pessoasNaChamada <= tecto
  const porqueNaoPartilha = !call.podePartilharEcra
    ? strings.call.shareScreenBySfu
    : !cabeNaChamada
      ? strings.call.shareScreenByPeople(tecto, porServidor)
      : null

  /*
    Only ask when there is image leaving here.
    
    The condition is capture, not the call: in a voice call there is no video
    encoder, and polling `getStats()` every four seconds to hear "nothing" is
    waste in the overwhelming number of calls, which is what this product has.
    */
  const aEnviarImagem = (hasCamera && !cameraOff) || screenStream !== null
  const limiteDeVideo = useLimiteDeVideo(call, aEnviarImagem)

  const ondeEsta = titulo ?? `#${shortName(channel)}`
  const camaraLocal = hasCamera && !cameraOff ? localStream : null

  /** Stage controls: "Stop watching" for watchers, the count for whoever shares. */
  const gestosDoPalco = outroAPartilhar ? (
    <button
      type="button"
      className="call-oferta-ver"
      aria-label={strings.call.screenStopWatchingAria(nameFor(outroAPartilhar.address))}
      onClick={() => {
        void call.recusarEcra(outroAPartilhar.address).catch(() => {})
      }}
    >
      <CloseIcon size={14} />
      {strings.call.screenStopWatching}
    </button>
  ) : aVerONosso !== null ? (
    <span className="call-espectadores">
      <OlhoIcon size={14} />
      {strings.call.screenViewers(aVerONosso)}
    </span>
  ) : null

  return (
    <section className={`call call-${modo}`} aria-label={strings.call.vistaAria(ondeEsta)}>
      <header className="call-head">
        {/* The voices say how many we are, at rest. No label because the sentence next
            to it says so. */}
        <Vozes outros={participants.length} eu rotulo={null} />
        <strong className="call-titulo">{ondeEsta}</strong>
        <span className="call-meta">
          {participants.length === 0 ? strings.call.waiting : strings.call.people(naChamada)}
          <span className="sep">·</span>
          <time>{elapsed}</time>
        </span>

        <div className="call-head-gestos">
          {onConversa && !semVoz && (
            <button type="button" className="call-head-btn" aria-pressed={conversaAberta} onClick={onConversa}>
              <ChatIcon size={14} />
              <span>{strings.call.conversaDaSala}</span>
            </button>
          )}
          {onPopOut && (
            <button type="button" className="call-head-btn" onClick={onPopOut}>
              <PopOutIcon size={14} />
              <span>{strings.call.popOut}</span>
            </button>
          )}
          {onSoPalco && (
            <button type="button" className="call-head-btn" aria-pressed={soPalco} onClick={onSoPalco}>
              <PalcoIcon size={14} />
              <span>{strings.call.soPalco}</span>
            </button>
          )}
        </div>
      </header>

      {/*
        The warning for this call, between the header and the faces.

        Here, not in a toast: these warnings describe a condition that lasts the
        whole call, and a toast passes.
      */}
      {aviso && (
        <p className={aviso.nivel === "grave" ? "call-aviso grave" : "call-aviso"} role="status">
          <span>{aviso.texto}</span>
          {onDispensarAviso && (
            <button
              type="button"
              className="call-aviso-fechar"
              aria-label={strings.call.avisoFechar}
              title={strings.call.avisoFechar}
              onClick={onDispensarAviso}
            >
              ×
            </button>
          )}
        </p>
      )}

      {avisoAfk && (
        <p className="call-aviso call-aviso-afk" role="status">
          <span>{avisoAfk.texto}</span>
          <button type="button" className="call-aviso-accao" onClick={avisoAfk.onVoltar}>
            {avisoAfk.voltar}
          </button>
          <button
            type="button"
            className="call-aviso-fechar"
            aria-label={strings.salaAfk.fechar}
            title={strings.salaAfk.fechar}
            onClick={avisoAfk.onFechar}
          >
            ×
          </button>
        </p>
      )}

      {/*
        Screen offers lived here, one bar per offer, with the "Watch" button.
        They moved to the sharer's tile (owner, 2 November 2026, "A with C"):
        the "LIVE" badge, and clicking the tile opens the share. The "Watch
        broadcast" button inside the tile is the keyboard door.
      */}

      <div className={palco ? "call-corpo com-foco" : "call-corpo"}>
        {/* The grid: one tile per person. With a screen in focus, the same tiles move
            to a row above it. */}
        <div className="call-people" role="group" aria-label={strings.call.pessoasNaChamada}>
          {/* Our branding comes from the same source as the bottom buttons: a single
              source of truth, never a second copy of the same fact. */}
          <span className="call-person">
            <CallChip
              label={selfLabel}
              profile={selfProfile}
              /* Our card says "you", except when there's something about us that only we
                 can know: the resolution going down. */
              texto={limiteDeVideo ? strings.call.videoLimitado(limiteDeVideo.razao, limiteDeVideo.altura) : strings.call.self}
              /* Our voice, measured from capture. `muted` not `micMuted`: muting the sound
                 silences the microphone as a side effect. */
              stream={localStream}
              micCalado={muted}
              camara={camaraLocal}
              dbDaEntrada={dbDaEntrada}
              aTocar={musica.musica?.aTocar ?? null}
              musica={musica.faixa}
              presence={presencaPropria}
              proprio
              /* Our screen: the badge and how many are watching, no invite needed (we see it already). */
              aoVivo={screenStream && aVerONosso !== null ? { aVer: aVerONosso } : undefined}
            />
            <span className="call-person-marcas">
              {muted && <MarcaDeChamada tipo="calado" nome={selfLabel} className="mic-off-badge" />}
              {screenStream && <MarcaDeChamada tipo="ecra" nome={selfLabel} className="screen-badge" />}
            </span>
          </span>

          {participants.map((participant) => (
            <span
              key={participant.address}
              className={
                palco && outroAPartilhar?.address === participant.address ? "call-person em-foco" : "call-person"
              }
            >
              <CallChip
                label={nameFor(participant.address)}
                endereco={participant.address}
                profile={directory.get(participant.address)}
                presence={presenceFor?.(participant.address)}
                /* Four states where there were two. See `lib/estadoDaChamada.ts`. */
                {...estadoDaPessoa({
                  connected: participant.connected,
                  caminho,
                  esperaMs: esperaDe(participant.address),
                })}
                /* The voice coming from this person: it's the green ring on the card that
                   answers "who is speaking". */
                stream={participant.stream}
                micCalado={participant.micMuted}
                volume={volumeDe(participant.address)}
                onVolume={(value) => definirVolume(participant.address, value)}
                /* Only those who joined with a camera: an audio stream can carry an empty
                   video track (the other person's screen transceiver), and showing
                   it would put a black square where their face should be. */
                camara={participant.video ? participant.stream : null}
                /* This person's audio (phase 9): the name, and volume separate from voice. */
                aTocar={participant.aTocar ?? null}
                volumeDaMusica={volumeDe(chaveDoVolumeDaMusica(participant.address))}
                onVolumeDaMusica={
                  participant.musica
                    ? (value) => definirVolume(chaveDoVolumeDaMusica(participant.address), value)
                    : undefined
                }
                musica={participant.musica ?? null}
                musicaCalada={musicasCaladas.calada(participant.address)}
                onAlternarMusica={participant.musica ? () => musicasCaladas.alternar(participant.address) : undefined}
                onMenu={menuDaPessoa ? (at) => setMenuNoCartao({ address: participant.address, at }) : undefined}
                /* Live: the badge while sharing; the invite while we're not watching yet
                   (once the screen arrives, it's already on stage). */
                aoVivo={
                  participant.ecraOferecido || participant.screen
                    ? {
                        aVer: aVerDe(participant.address, participant.screen !== null),
                        onVer: participant.screen
                          ? undefined
                          : () => {
                              void call.aceitarEcra(participant.address).catch(() => {
                                // Reported by the core log. The card keeps inviting.
                              })
                            },
                      }
                    : undefined
                }
              />
              <span className="call-person-marcas">
                {participant.micMuted && (
                  <MarcaDeChamada tipo="calado" nome={nameFor(participant.address)} className="mic-off-badge" />
                )}
                {/* The other silence: this person's volume at zero, muted by us. */}
                {volumeDe(participant.address) === 0 && (
                  <MarcaDeChamada tipo="silenciado" nome={nameFor(participant.address)} className="silenced-badge" />
                )}
                {/* The stage shows ONE screen. With two people sharing, this badge is the
                    only place where the fact appears in full. */}
                {(participant.screen || participant.ecraOferecido) && (
                  <MarcaDeChamada tipo="ecra" nome={nameFor(participant.address)} className="screen-badge" />
                )}
              </span>
            </span>
          ))}
          {soAnunciados.map((quem) => (
            <span key={`a-ligar-${quem}`} className="call-person">
              <CallChip
                label={nameFor(quem)}
                endereco={quem}
                profile={directory.get(quem)}
                presence={presenceFor?.(quem)}
                texto={strings.call.connecting}
                tom="aEsperar"
                aLigar
                onMenu={menuDaPessoa ? (at) => setMenuNoCartao({ address: quem, at }) : undefined}
              />
            </span>
          ))}
        </div>

        {/* This person's menu, open on a card (phase 3). One menu only, with the one
            for the voice room: see `itensDaPessoaNaChamada`. */}
        {menuNoCartao &&
          menuDaPessoa &&
          (() => {
            const contexto = menuDaPessoa(menuNoCartao.address)
            if (!contexto) return null
            const quem = menuNoCartao.address
            return (
              <ContextMenu
                at={menuNoCartao.at}
                onClose={() => setMenuNoCartao(null)}
                items={itensDaPessoaNaChamada({
                  ...contexto,
                  nome: nameFor(quem),
                  volume: volumeDe(quem),
                  definirVolume: (valor) => definirVolume(quem, valor),
                })}
              />
            )
          })()}

        {/* The shared screen, in focus. */}
        {palco && (
          <div className="call-foco">
            <ScreenStage stream={palco.stream} label={palco.label}>
              {gestosDoPalco}
            </ScreenStage>
          </div>
        )}
      </div>

      {/* The audio boxes, always mounted and always hidden. Camera images go to the
          cards above. `muted` always on ours (echo), and `micCalado` per state. */}
      <div className={showingVideo ? "call-video com-imagem" : "call-video hidden"}>
        <VideoTile stream={localStream} muted micCalado={muted} mostrarVoz={false} label={selfLabel} connected proprio />
        {/* `muted` on the element, not `volume={0}`: per-person volume is a choice we
            want to keep intact when sound returns. See `VideoTile`. */}
        {participants.map((participant) => (
          <VideoTile
            key={participant.address}
            stream={participant.stream}
            muted={soundOff}
            micCalado={participant.micMuted}
            mostrarVoz={false}
            label={nameFor(participant.address)}
            endereco={participant.address}
            connected={participant.connected}
            /* The same response this person's card gets. */
            estado={estadoDaPessoa({
              connected: participant.connected,
              caminho,
              esperaMs: esperaDe(participant.address),
            })}
            volume={volumeDe(participant.address) * volumeDeSaida}
            silenciadoPorMim={volumeDe(participant.address) === 0}
          />
        ))}
        {/* Each person's audio, in one element just for them: their own volume. */}
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

      {screenStream && <SinalDoSomDoEcra estado={somDoEcra} />}
      <SinalDaMusica musica={musica.musica} volumeDaEmissao={musica.volumeDaEmissao} />

      {/* The control bar, fixed at the bottom. Buttons show state via `aria-pressed`
          (pressed = on) and describe the gesture via `aria-label`. */}
      <div className="call-controls call-barra" role="toolbar" aria-label={strings.call.controlos}>
        {/* The same states as the identity card: `escolherAudio` up there decides,
            and this panel only displays. */}
        {onToggleMic && !semVoz && (
          <button
            type="button"
            className={muted ? "call-btn off" : "call-btn on"}
            data-tip={soundOff && !micMuted ? strings.call.micBySound : muted ? strings.call.micOn : strings.call.micOff}
            aria-label={strings.call.micAria(muted)}
            aria-pressed={!muted}
            onClick={onToggleMic}
          >
            <MicIcon size={20} off={muted} />
          </button>
        )}

        {/* The order of the "Minimal" bar: microphone, sound, screen, video, hang up. */}
        {onToggleSound && !semVoz && (
          <button
            type="button"
            className={soundOff ? "call-btn off" : "call-btn on"}
            data-tip={soundOff ? strings.call.soundOn : strings.call.soundOff}
            aria-label={strings.call.soundAria(soundOff)}
            aria-pressed={!soundOff}
            onClick={onToggleSound}
          >
            <HeadphonesIcon size={20} off={soundOff} />
          </button>
        )}

        {/* Share the screen. `data-ecra` because this button's position on the bar
            is not fixed: the camera next to it only exists with video capture. */}
        {!porqueNaoPartilha && !semVoz && (
          <button
            type="button"
            data-ecra="1"
            className={screenStream ? "call-btn on" : "call-btn"}
            data-tip={screenStream ? strings.call.stopScreen : strings.call.shareScreen}
            aria-label={strings.call.screenAria(screenStream !== null)}
            aria-pressed={screenStream !== null}
            onClick={() => {
              /* The engine calls the shots, and the screen comes back via `screenStream`. */
              if (screenStream) void call.stopScreenShare()
              else if (onShareScreen) onShareScreen()
              else void call.startScreenShare()
            }}
          >
            <ScreenShareIcon size={20} />
          </button>
        )}
        {screenStream && <BotaoDoSomDoEcra call={call} estado={somDoEcra} />}

        {/* Share audio, next to the screen (phase 9). Opens the sheet; the call reader
            decides who plays and who stops. */}
        {musica.disponivel && !semVoz && (
          <button
            type="button"
            data-musica="1"
            className={musica.musica ? "call-btn on" : "call-btn"}
            data-tip={strings.musica.partilharAudio}
            aria-label={strings.musica.partilharAudioAria(musica.musica !== null)}
            aria-pressed={musica.musica !== null}
            aria-haspopup="dialog"
            onClick={() => setFolhaDeAudio(true)}
          >
            <MusicaIcon size={20} />
          </button>
        )}

        {hasCamera && !semVoz && (
          <button
            type="button"
            className={cameraOff ? "call-btn off" : "call-btn on"}
            data-tip={cameraOff ? strings.call.cameraOn : strings.call.cameraOff}
            aria-label={cameraOff ? strings.call.cameraOn : strings.call.cameraOff}
            aria-pressed={!cameraOff}
            onClick={() => {
              if (onToggleCamera) {
                onToggleCamera()
                return
              }
              const next = !cameraOff
              setCameraOffLocal(next)
              call.setCameraOff(next)
            }}
          >
            <CameraIcon size={20} off={cameraOff} />
          </button>
        )}

        <span className="call-barra-sep" aria-hidden="true" />

        <button
          type="button"
          className="call-btn hangup"
          data-tip={strings.call.leave}
          aria-label={strings.call.leave}
          onClick={onLeave}
        >
          <HangUpIcon size={22} />
        </button>
      </div>

      {/* Why there's no share button. Written where the button would go. */}
      {porqueNaoPartilha && !semVoz && <p className="call-note">{porqueNaoPartilha}</p>}
      {semVoz && <p className="call-note call-note-afk">{strings.salaAfk.semVozNemTexto}</p>}

      {folhaDeAudio && (
        <PartilharAudio
          musica={musica}
          fontes={fontesDeAudioDoAnfitriao(anfitriaoDoAgente(agenteDoBrowser(), eAppDeSecretaria()))}
          secretaria={eAppDeSecretaria()}
          onFechar={() => setFolhaDeAudio(false)}
        />
      )}

    </section>
  )
}

/** The browser user agent, or nothing outside a browser (tests in Node). */
function agenteDoBrowser(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent
}

/** The desktop app is Electron, and Electron says so in the user agent. Display text only. */
function eAppDeSecretaria(): boolean {
  return /Electron\//.test(agenteDoBrowser())
}

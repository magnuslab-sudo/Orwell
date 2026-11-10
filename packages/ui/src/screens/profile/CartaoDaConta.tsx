import { useEffect, useRef, useState } from "react"
import type { Activity, ConnectionState, Profile } from "../../bridge.js"
import { Andante } from "../../components/Andante.js"
import { atributosDoAnel, type EstadoDoAnel } from "../../components/Avatar.js"
import { useToqueLongo } from "../../hooks/useToqueLongo.js"
import { BellIcon, GearIcon, HangUpIcon, HeadphonesIcon, MicIcon } from "../../icons.js"
import { strings } from "../../strings.js"
import { StatusBar } from "./StatusBar.js"

/**
 * The call, for the panel to draw in the middle tier.
 *
 * `caixa` is the dock in side form (`CallDock`, `variante="lateral"`): the ping,
 * the count and the place, and the sound when the call panel is off-screen. It
 * arrives already built from outside because the shell knows about the call; the
 * panel just gives it a spot. `onSair` is the fifth button in the row.
 */
export type ChamadaNoPainel = {
  caixa: React.ReactNode
  onSair: () => void
}

/**
 * The foot of a column: the control panel.
 *
 * **The P1 panel, console in three tiers.** The owner chose it on October 28,
 * 2026, from six options, with this request: the "Connected" banner and the
 * account banner "must be one," with proportion and weight, because "it is
 * practically our control panel." It replaces the Discord-style banner described
 * next, and looks like this:
 *
 * - on top, the 46px face with the dot, the 16px name, and below it the personal
 *   message (scrolling if needed) or, without it, the status;
 * - in the middle, in a call only, the green call box (`chamada.caixa`), which
 *   goes back to the call on click;
 * - at the bottom, a row of identical buttons: microphone, speaker, bell, gear,
 *   and hang up when in a call. Out of a call the row has four.
 *
 * The text that follows is the history of the previous banner, and its rules that
 * stayed (menus without arrows, address hidden, no internal state).
 *
 * It lived inside `ChannelSidebar` forever, and left there the day Friends
 * stopped drawing that bar. That is not cleanup: it is the only place in the app
 * where "how you appear" opens and where the bell lives, and a column that
 * vanishes cannot take the account controls with it. The two columns that exist
 * (channels and conversations) draw this same component, not two copies that
 * diverge at the first fix.
 *
 * **The Discord-style banner.** The owner chose it on October 27, 2026, from
 * twelve options (A through L), in the mockup "Orwell Settings 0.9". It replaces
 * the three-tier card that was here: the microphone and speaker pair with arrows,
 * the identity with the bell and copy, and the status text line. That card had
 * earlier owner decisions (icon instead of word, "the pair is the box"), and this
 * new choice supersedes them. What stays:
 *
 * - a banner without card, without margin and without radius, in the minimal bar
 *   color;
 * - one line only: avatar with the presence dot, name, and below it the status
 *   and latency ("Busy · 42 ms");
 * - four identical buttons on the right: microphone, speaker, bell, gear.
 *
 * Gone: the arrows in audio menus (menus open on right-click and long press in
 * the button itself), "Share your address" (stays in Account, and the friend link
 * and QR in Friends) and the status text line, which shows only while editing
 * (see `aEditarEstado`).
 *
 * **No internal state.** Everything it shows arrives decided from outside,
 * including microphone and speaker: the call panel shows the same two states, and
 * two components with their own memory end up out of sync. The only memory here is
 * screen: whether the status text line is open.
 */
export function CartaoDaConta({
  profile,
  address,
  activity = "online",
  ligacao = "online",
  onActivityMenu,
  onEditProfile,
  onNotifications,
  unreadNotifications = 0,
  avisaDeNotificacao = false,
  micMuted = false,
  soundOff = false,
  onToggleMic,
  onToggleSound,
  onMicMenu,
  onSoundMenu,
  onAbrirDefinicoes,
  latencia = null,
  onLatenciaHover,
  onSaveStatus,
  pedidoDeEstado,
  emChamada = false,
  chamada = null,
}: {
  profile: Profile
  address: string | null
  /** The choice of this device, for the dot and the word below the name. */
  activity?: Activity | undefined
  /**
   * The connection to the server. The presence dot also shows this, since the
   * status bar left the column: green connected, amber reconnecting, pink offline.
   * With a good connection, the dot has the color of the chosen status.
   */
  ligacao?: ConnectionState | undefined
  /** Click on identity: choose how you appear. Without it, opens your profile. */
  onActivityMenu?: ((at: { x: number; y: number }) => void) | undefined
  onEditProfile: () => void
  /** The bell lives with the rest of the account controls, in this same banner. */
  onNotifications?: ((at: { x: number; y: number }) => void) | undefined
  unreadNotifications?: number | undefined
  /**
   * A notification just arrived: this is the class that shakes the bell.
   *
   * It comes decided from outside, and for a reason that is not just taste:
   * there are two of these banners in the app, and the logic calculated in here
   * would make two timers count the same burst separately. See `hooks/useSinoAvisa.ts`.
   */
  avisaDeNotificacao?: boolean | undefined
  /**
   * The microphone and speaker, for the banner to draw.
   *
   * `micMuted` is the person's choice, not the effect: with speaker off the
   * microphone is muted anyway, and it is the drawer that puts the two together.
   */
  micMuted?: boolean | undefined
  soundOff?: boolean | undefined
  /** Without these two, the controls don't draw. A button that leads nowhere
   *  is worse than no button. */
  onToggleMic?: (() => void) | undefined
  onToggleSound?: (() => void) | undefined
  /**
   * The menu for each audio button, on right-click or long press.
   *
   * Optional for the same reason: with no one listening, the button opens no
   * menu and the right-click stays the browser's.
   */
  onMicMenu?: ((at: { x: number; y: number }) => void) | undefined
  onSoundMenu?: ((at: { x: number; y: number }) => void) | undefined
  /** The gear. The same path as the icon bar button (`App.tsx`). */
  onAbrirDefinicoes?: (() => void) | undefined
  /**
   * The round-trip time, for the status line to show it.
   *
   * It comes measured from outside: there are two of these banners in the app,
   * and measuring in here would make two timers beat on the same socket. `null`
   * is an answer: the line says only how you appear, and makes up no number.
   */
  latencia?: { ms: number; ate: "servidor" | "par" } | null | undefined
  /** The mouse entered or left the identity. This is what turns measurement on and off. */
  onLatenciaHover?: ((dentro: boolean) => void) | undefined
  onSaveStatus: (statusText: string) => void
  /** Fires when "Custom..." asks for the status text line in edit mode. */
  pedidoDeEstado?: number | undefined
  /**
   * This account is in a call: the face ring pulses.
   *
   * It comes from outside, like latency: the `App` knows about the call.
   */
  emChamada?: boolean | undefined
  /**
   * The live call, for the middle tier and the hang up button. See
   * `ChamadaNoPainel`. Without it the panel has two tiers and four buttons.
   */
  chamada?: ChamadaNoPainel | null | undefined
}): React.JSX.Element {
  /* The audio menus, with finger down. See `useToqueLongo`. */
  const aoDedo = useToqueLongo()

  /*
    The status text line, only while being edited.

    The "Custom…" option in the status menu is the only way to reach it. At
    rest, the text appears below the name (P1, 28 October 2026), and while
    editing the field takes its place. Only the RISE of `pedidoDeEstado`
    opens it, not the value itself: the banner rebuilds when the target
    changes, and rebuilding is not a request.
  */
  const [aEditarEstado, setAEditarEstado] = useState(false)
  const pedidoVisto = useRef(pedidoDeEstado)
  useEffect(() => {
    if (pedidoDeEstado === pedidoVisto.current) return
    pedidoVisto.current = pedidoDeEstado
    setAEditarEstado(true)
  }, [pedidoDeEstado])

  const ligado = ligacao === "online"

  /*
    The word below the name, and what follows the dot.
    
    With a good connection, the latency when measured ("Busy · 42 ms"). Without
    it, the connection by words ("Online · no connection"): the dot changes
    color, and color alone is not enough for those who cannot distinguish it
    (WCAG 1.4.1).
    
    Latency is separate (`latenciaCurta`) because it is the first to go: in a
    236 px column the line is 59 px and "Busy · 42 ms" needs 87, and "Busy ·…"
    says nothing. When it does not fit, the line shows only the status, and the
    full number is in the dot's tooltip. CSS decides whether it fits
    (`.me-state`), not a measurement in JavaScript: width changes with the name,
    language, and drawer, and the layout already knows the answer.
    */
  const estadoCurto =
    activity === "invisivel"
      ? strings.activity.invisible
      : activity === "ocupado"
        ? strings.activity.busy
        : activity === "ausente"
          ? strings.activity.away
          : strings.activity.online
  const aSeguir = !ligado
    ? ligacao === "offline"
      ? strings.common.connectionOffline
      : ligacao === "connecting"
        ? strings.common.connectionConnecting
        : strings.common.connectionReconnecting
    : null
  const linhaDoEstado = strings.activity.stateLine(estadoCurto, aSeguir)
  /* During a call the ping is in the middle box, in larger text: here it would
     be the same number twice, an inch apart. */
  const latenciaCurta = ligado && latencia && !chamada ? strings.activity.latencyTail(latencia.ms) : null

  /*
    The personal message below the name (P1). With a poor connection, the
    status line always wins: it says "no connection" in words, and that matters
    more than the message. The chosen status stays in the ring, the dot, and the
    dot's tooltip.
  */
  const mensagem = profile.statusText?.trim() ?? ""
  const mostraMensagem = ligado && mensagem !== "" && !aEditarEstado

  /** The long phrase on the dot: how you appear, and how far away you are. */
  const estadoLongo = strings.activity.current(activity)
  const dicaDoPonto = !ligado
    ? `${estadoLongo}. ${aSeguir}`
    : latencia
      ? `${estadoLongo}. ${
          latencia.ate === "par" ? strings.activity.latencyPeer(latencia.ms) : strings.activity.latencyServer(latencia.ms)
        }`
      : estadoLongo

  /*
    The dot's color. Connection comes first: a green "Online" with the socket
    down would have the app saying others see you when they don't. The classes
    come from the house (`components.css`): the amber for reconnecting pulses,
    to avoid confusion with the solid amber of "Busy".
  */
  const classeDoPonto = !ligado
    ? ligacao === "offline"
      ? "dot offline"
      : "dot reconnecting"
    : activity === "invisivel"
      ? "dot invisible"
      : activity === "ocupado"
        ? "dot busy"
        : activity === "ausente"
          ? "dot away"
          : "dot online"

  /*
    The face's ring: same as the other faces (`atributosDoAnel`), by the same
    rule as the dot. With no connection or invisible it is grey, because that is
    how others see you. The dot stays: it also shows connection (reconnecting,
    no connection), which the ring does not.
  */
  const estadoDoAnelProprio: EstadoDoAnel =
    !ligado || activity === "invisivel"
      ? "offline"
      : activity === "ocupado"
        ? "ocupado"
        : activity === "ausente"
          ? "ausente"
          : "online"

  /** The menu for an audio button, anchored to the TOP of the button, like all house menus. */
  const menuNoBotao =
    (abrir: ((at: { x: number; y: number }) => void) | undefined) =>
    (event: React.MouseEvent<HTMLButtonElement>): void => {
      if (!abrir) return
      event.preventDefault()
      const box = event.currentTarget.getBoundingClientRect()
      abrir({ x: box.left, y: box.top })
    }

  const micCalado = micMuted || soundOff

  /*
    How many columns the row has. The buttons live in sections with names (audio,
    account), and sections are `subgrid` of the row: this keeps all five the same
    width without sections ceasing to exist for screen readers. The count is
    done here because each button only renders with whoever responds to it.
    */
  const nAudio = onToggleMic && onToggleSound ? 2 : 0
  const nConta = (onNotifications ? 1 : 0) + (onAbrirDefinicoes ? 1 : 0)
  const colunas = nAudio + nConta + (chamada ? 1 : 0)

  return (
    <div
      className={chamada ? "me-faixa painel em-chamada" : "me-faixa painel"}
      role="group"
      aria-label={strings.sidebar.painelDeControlo}
    >
      <button
        type="button"
        className="me-identity"
        aria-label={strings.activity.title}
        data-tip={strings.activity.title}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          if (onActivityMenu) onActivityMenu({ x: box.left, y: box.top })
          else onEditProfile()
        }}
        /* Measurement starts when the pointer lands and stops when it leaves: measuring
           it continuously would be one frame per second on the socket (or on a
           call, `getStats()` on each pair) for a number nobody is looking at.
           See `useLatencia`. */
        onMouseEnter={() => onLatenciaHover?.(true)}
        onMouseLeave={() => onLatenciaHover?.(false)}
      >
        <span className="me-avatar" {...atributosDoAnel(estadoDoAnelProprio, emChamada)}>
          <span className="avatar">
            {profile.avatarDataUrl ? (
              <img src={profile.avatarDataUrl} alt="" />
            ) : (
              (profile.displayName[0] ?? address?.[1] ?? "?").toUpperCase()
            )}
          </span>
          {/* The tooltip is the house `data-tip`, not the browser `title`: the browser
              `title` is slow, does not show with keyboard, and was why the
              entire latency had to pass through when the line cuts it. The
              `data-tip-side="start"` makes the tooltip grow into the column:
              centered on a dot 40 px from the edge, half of it would stick out. */}
          <span className={classeDoPonto} role="img" aria-label={dicaDoPonto} data-tip={dicaDoPonto} data-tip-side="start" />
        </span>
        <span className="me-labels">
          {/* The name in its own element: `text-overflow` does not truncate text that is
              a direct child of a flex container. See `.me-name`. */}
          <span className="me-name">
            <span className="me-name-text">{profile.displayName || strings.sidebar.pickName}</span>
          </span>
          {mostraMensagem ? (
            <Andante className="me-mensagem" texto={mensagem} />
          ) : (
            <span className="me-state">
              <span className="me-state-palavra">{linhaDoEstado}</span>
              {latenciaCurta && <span className="me-state-latencia">{latenciaCurta}</span>}
            </span>
          )}
        </span>
      </button>

      {/*
        The address, hidden from sight and spoken to screen readers.

        The identity button says "How you appear" and does not say which account
        is active. It lives here, taking no space, in reading order. Outside the
        button on purpose: an `aria-label` replaces content instead of
        accompanying it. The `title` is how diagnostic scripts read the address
        of the account just created (`retratar-amigos`, `verificar-amigos`,
        `medir-destinos`).
      */}
      {address && (
        <span className="me-address" title={address}>
          {address}
        </span>
      )}

      {/* The status text line opens below you, where the message you are editing
          lives, not below the buttons. */}
      {aEditarEstado && (
        <div className="me-estado-escrito">
          <StatusBar value={profile.statusText ?? ""} onSave={onSaveStatus} onFim={() => setAEditarEstado(false)} />
        </div>
      )}

      {chamada?.caixa}

      <div className="me-accoes" style={{ gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))` }}>
        {onToggleMic && onToggleSound && (
          /*
            Two sections with names, and four identical buttons to the eye.

            The `role="group"` with a name makes a screen reader say "Sound and
            microphone, group" before the two switches, instead of six buttons in
            a row with no context.
          */
          <div className="me-audio" role="group" aria-label={strings.sidebar.audioGroup} style={{ gridColumn: `span ${nAudio}` }}>
            {/* The microphone shows what IS, not the choice: with sound off it is silent,
                whether the person chose that or not. The accessible name carries
                the state AND the action; the tooltip carries only the action,
                because the state is already in the design and color. No `title`:
                the `data-tip` is the house tooltip, and two overlapping tooltips
                are worse than none. */}
            <button
              type="button"
              className={micCalado ? "me-audio-btn off" : "me-audio-btn"}
              aria-label={strings.call.micAria(micCalado)}
              data-tip={soundOff && !micMuted ? strings.call.micBySound : micMuted ? strings.call.micOn : strings.call.micOff}
              onClick={onToggleMic}
              /* The menu, by right-click or by menu key (the browser sends the same
                 `contextmenu` to the focused button), and with a finger held
                 down. The long touch swallows the click that follows: opening
                 the menu does not silence. */
              onContextMenu={menuNoBotao(onMicMenu)}
              {...aoDedo(onMicMenu)}
            >
              <MicIcon size={17} off={micCalado} />
            </button>
            <button
              type="button"
              className={soundOff ? "me-audio-btn off" : "me-audio-btn"}
              aria-label={strings.call.soundAria(soundOff)}
              data-tip={soundOff ? strings.call.soundOn : strings.call.soundOff}
              onClick={onToggleSound}
              onContextMenu={menuNoBotao(onSoundMenu)}
              {...aoDedo(onSoundMenu)}
            >
              <HeadphonesIcon size={17} off={soundOff} />
            </button>
          </div>
        )}

        {nConta > 0 && (
        <div className="me-conta" role="group" aria-label={strings.sidebar.accountGroup} style={{ gridColumn: `span ${nConta}` }}>
          {onNotifications && (
            <button
              type="button"
              className={avisaDeNotificacao ? "me-btn me-bell avisa" : "me-btn me-bell"}
              data-tip={strings.notifCenter.title}
              aria-label={strings.notifCenter.bellWithCount(unreadNotifications)}
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect()
                onNotifications({ x: box.left, y: box.top })
              }}
            >
              <BellIcon size={17} />
              {unreadNotifications > 0 && (
                <span className="me-bell-count" aria-hidden="true">
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </span>
              )}
            </button>
          )}
          {onAbrirDefinicoes && (
            <button
              type="button"
              className="me-btn me-definicoes"
              data-tip={strings.sidebar.abrirDefinicoes}
              /* Anchored to the corner when it is the button closest to the column's right
                 edge: a centered tooltip would stick out. On a call the last is
                 hang-up, and this one stays centered. */
              {...(chamada ? {} : { "data-tip-side": "end" })}
              aria-label={strings.sidebar.abrirDefinicoes}
              onClick={onAbrirDefinicoes}
            >
              <GearIcon size={17} />
            </button>
          )}
        </div>
        )}

        {chamada && (
          /* Exit the call: a ghost, turning red "busy" on hover or with focus (choice A,
             28 October 2026, kept in P1). Outside sections: not from account or
             audio, it is from the call. */
          <button
            type="button"
            className="me-btn me-sair"
            data-tip={strings.call.leave}
            data-tip-side="end"
            aria-label={strings.call.leave}
            onClick={chamada.onSair}
          >
            <HangUpIcon size={17} />
          </button>
        )}
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from "react"
import { copiarTexto } from "../../lib/copiar.js"
import type { Participant } from "@enclave/client-core"
import { useBridge } from "../../App.js"
import type { ConnectionState, PinnedMessage, Profile } from "../../bridge.js"
import type { ChatMessage, MessageExtras } from "../../types.js"
import type { OutboxEntry } from "../../hooks/useOutbox.js"
import { useApresentacao } from "../../hooks/usePrefs.js"
import { useBuzz } from "../../hooks/useBuzz.js"
import { useConfirmar } from "../../hooks/useConfirmar.js"
import { useTyping } from "../../hooks/useTyping.js"
import { Button } from "../../components/Button.js"
import { ConnectionBanner } from "../../components/ConnectionBanner.js"
import { EmptyState } from "../../components/EmptyState.js"
import { useToast } from "../../components/Toast.js"
import { CameraIcon, MicIcon, PeopleIcon, PinIcon, SearchIcon } from "../../icons.js"
import type { CargoDoMembro } from "../../lib/agruparMembros.js"
import { connectionLabel, isDirect } from "../../lib/format.js"
import { strings, traduzirErro } from "../../strings.js"
import { RoomIcon } from "../../components/RoomIcon.js"
import { SeloOficial } from "../../components/SeloOficial.js"
import { Vozes } from "../../components/Vozes.js"
import type { AvisoDaChamada, CaminhoDeMedia } from "../../lib/estadoDaChamada.js"
import { CallPanel } from "../call/CallPanel.js"
import { ApresentacaoOficial } from "./ApresentacaoOficial.js"
import { NotasDeVersao } from "./NotasDeVersao.js"
import { ContextMenu } from "../overlays/ContextMenu.js"
import { DenunciarSheet } from "./DenunciarSheet.js"
import { PedidoCard } from "./PedidoCard.js"
import { Composer } from "./Composer.js"
import { EditarMensagem } from "./EditarMensagem.js"
import { MemberPanel } from "./MemberPanel.js"
import { PinnedPanel } from "./PinnedPanel.js"
import { ProcuraPanel } from "./ProcuraPanel.js"
import { Timeline } from "./Timeline.js"
import type { Apuramento } from "../../lib/votacoes.js"
import type { EstadoDaProcura } from "../../hooks/useProcura.js"
import type { Achado } from "../../lib/procura.js"
import { BarraDeSincronia } from "../../components/BarraDeSincronia.js"
import { BarraDoHistorico, useHistoricoDosIrmaos } from "../../components/BarraDoHistorico.js"
import { useSincronia } from "../../hooks/useSincronia.js"
import { podeResponder, type Citacao, type RespostaPendente } from "../../lib/respostas.js"

/** What the shell answers for each line. See `Timeline`. */
export type ChatScreenPedidoDe = (
  message: ChatMessage,
) => { titulo: string; estado: string; aceitar: string; recusar: string; respondivel: boolean } | null

/**
 * The friend request for this conversation, already resolved by the shell.
 *
 * Resolved there rather than here for the usual reason: the state of friendships
 * lives in the shell, and a second read of that state here would be a second
 * source of truth about who holds which keys.
 */
export interface ChatScreenPedidoDeAmizade {
  titulo: string
  estado: string
  aceitar: string
  recusar: string
  /** False on the requester's side: the card shows the state and says nothing. */
  respondivel: boolean
  /** A halfway response: both buttons go out of reach, not just the active one. */
  ocupado: boolean
}

export function ChatScreen({
  active,
  callChannel,
  setCallChannel,
  setCallRoom,
  ringing,
  participants,
  localStream,
  screenStream = null,
  profile,
  address,
  messages,
  pins = [],
  callPopup = false,
  onCallPopup,
  vistaDaChamada,
  tituloDaChamada,
  soPalco = false,
  onSoPalco,
  micMuted = false,
  soundOff = false,
  onToggleMic,
  onToggleSound,
  onShareScreen,
  cameraOff,
  onToggleCamera,
  outbox,
  onSend,
  onRetryEntry,
  onDiscardEntry,
  draft,
  onDraftChange,
  activeRoom = "",
  members,
  membersState,
  onRetryMembers,
  directory,
  nameFor,
  connection,
  connectionDetail,
  onPrompt,
  onConvidar,
  hasStoredHistory,
  canLoadOlder,
  onLoadOlder,
  labelFor,
  iconFor,
  oficial = false,
  notasDeVersao = false,
  primeirosPassos,
  salaDaChamada = null,
  roleFor,
  apelidoDe,
  menuDaPessoaNaChamada,
  presenceFor,
  presenceHint,
  emChamada,
  onOpenProfile,
  onUserMenu,
  pedidoDe,
  pedidoOcupado,
  onPedidoResposta,
  apuramentos,
  onVotar,
  onVotacao,
  pedidoDeAmizade = null,
  escritaTrancada = null,
  directaBloqueada = false,
  onResponderAmizade,
  onPedirAmizade,
  meuNome,
  onSaveStatus,
  procura,
  procuraAberta = false,
  onProcuraAberta,
  onSaltarPara,
  nomeDaSala,
  destacada = null,
  caminhoDeMedia = null,
  presentesNaSala = [],
  avisoDeChamada = null,
  onDispensarAviso,
  salaAfkAberta = false,
  chamadaNaSalaAfk = false,
  avisoAfk = null,
  resposta = null,
  onResponder,
  onAlternarMencao,
  onCancelarResposta,
  citacaoDe,
  onIrParaOriginal,
}: {
  active: string | null
  /**
   * The halfway response in this room, if there is one. Lives in the shell, by
   * channel and room, like a draft. See `lib/respostas.ts`.
   */
  resposta?: RespostaPendente | null | undefined
  /** Start a response to this message. Absent, no line offers it. */
  onResponder?: ((message: ChatMessage) => void) | undefined
  onAlternarMencao?: (() => void) | undefined
  onCancelarResposta?: (() => void) | undefined
  /** The state of the original for each response. See `Timeline`. */
  citacaoDe?: ((id: string) => Citacao) | undefined
  onIrParaOriginal?: ((id: string) => void) | undefined
  /**
   * The open room is the AFK room (2/11/2026): no conversation, no text input,
   * no files. Shown as a line in place of the conversation.
   */
  salaAfkAberta?: boolean | undefined
  /** The call is in the AFK room: the panel removes the voice buttons. */
  chamadaNaSalaAfk?: boolean | undefined
  /** The notice "You moved to the AFK room", with a "Back" button. See `CallPanel`. */
  avisoAfk?: { texto: string; voltar: string; onVoltar: () => void; onFechar: () => void } | null | undefined
  /**
   * Where the call media goes and its status: passed to the panel.
   *
   * The shell knows this because it listens to diagnostics from the core. This
   * screen does not touch them: it carries them like it already carries the
   * microphone and speaker state.
   */
  caminhoDeMedia?: CaminhoDeMedia | undefined
  avisoDeChamada?: AvisoDaChamada | null | undefined
  onDispensarAviso?: (() => void) | undefined
  /**
   * Who is in the call room by presence, with connection or without it (the
   * `naSalaDaChamada` from `App`). The panel draws those without connection yet
   * as "connecting" cards. See `CallPanel`, prop `aLigar`.
   */
  presentesNaSala?: readonly string[] | undefined
  callChannel: string | null
  setCallChannel: (channel: string | null) => void
  /** The room we are in. Without this the shell assumes we are in the default room,
   *  and our face does not show up where we actually are. */
  setCallRoom?: ((room: string) => void) | undefined
  ringing: Map<string, Map<string, number>>
  participants: Participant[]
  localStream: MediaStream | null
  /** The screen this account is sharing. Flows to the panel, which displays it;
   * the dock gets the same fact by another path. See `App`. */
  screenStream?: MediaStream | null | undefined
  profile: Profile
  address: string | null
  messages: ChatMessage[]
  /**
   * What is pinned in the open room, already fetched by the shell.
   *
   * Empty by default, which is what a host with no pins gives: with nothing
   * pinned there is no button in the header and no sheet to open, and the screen
   * behaves exactly as it did before this existed.
   */
  pins?: PinnedMessage[]
  /** The call is floating as a popup; the inline panel steps aside. */
  callPopup?: boolean | undefined
  onCallPopup?: (() => void) | undefined
  /**
   * How the call on this channel shows here, decided by the shell.
   *
   * `sala`: the voice room for the call is open and the call fills the main area
   * (the grid, like Discord). `faixa`: the call sits above the conversation (a
   * direct message). `null`: the call is in another room on this channel, and the
   * sidebar card (or the dock) displays it. Absent reads as `faixa`, which is
   * what this screen has always done.
   */
  vistaDaChamada?: "sala" | "faixa" | null | undefined
  /** The name of the call room for its header. */
  tituloDaChamada?: string | undefined
  /** "Stage only": the shell hides the rail and bars. */
  soPalco?: boolean | undefined
  onSoPalco?: (() => void) | undefined
  /** The microphone and speaker, passed to the call panel. The App holds them,
   *  and the sidebar card reads the same ones. */
  micMuted?: boolean | undefined
  soundOff?: boolean | undefined
  onToggleMic?: (() => void) | undefined
  onToggleSound?: (() => void) | undefined
  /** Passed to the panel: handles the screen share request. The sheet it opens
   *  lives in the shell, which survives navigation. */
  onShareScreen?: (() => void) | undefined
  /** The camera state lives in `App`, so the keyboard shortcut and button touch the same thing. */
  cameraOff?: boolean | undefined
  onToggleCamera?: (() => void) | undefined
  /** Unconfirmed sends for the active channel. */
  outbox: OutboxEntry[]
  onSend: (channel: string, body: string, extras?: MessageExtras) => void
  onRetryEntry: (id: string) => void
  onDiscardEntry: (id: string) => void
  draft: string
  onDraftChange: (text: string) => void
  /**
   * The open room within the channel. Empty is the default room.
   *
   * The typing indicator needs it: the encryption group is the whole channel,
   * so without the room label, typing in one room would show as typing in all.
   */
  activeRoom?: string
  members: string[]
  membersState: "loading" | "error" | "ready"
  onRetryMembers: () => void
  directory: Map<string, Profile>
  nameFor: (sender: string) => string
  connection: ConnectionState
  connectionDetail: string | null
  onPrompt: (prompt: "channel") => void
  /**
   * Open the single invite sheet for THIS conversation.
   *
   * The member list header and footer both call the same thing. Before, one was
   * a prompt and one was a link sheet, each with its own path.
   */
  onConvidar: (modo?: "endereco" | "link") => void
  hasStoredHistory: boolean
  canLoadOlder: boolean
  onLoadOlder: () => void
  /** Display name for a channel: the other person for a DM, else its slug. */
  labelFor: (channel: string) => string
  /** Published icon for the channel, if any. See `space.meta`. */
  iconFor?: ((channel: string) => string | undefined) | undefined
  /**
   * The open channel is the public channel announced by the server.
   *
   * Decided up there, where it knows what the server said in `hello.ok`.
   * See `lib/oficial.ts` for why this is not a published field.
   */
  oficial?: boolean
  /**
   * The open room is the "announcements" room of the public channel: it shows
   * release notes instead of conversation and has no text input.
   *
   * Decided in the shell, which knows the public channel and the room type and
   * name. See `ehSalaDeAnuncios` in `lib/oficial.ts`.
   */
  notasDeVersao?: boolean
  /**
   * The card for someone who just created an account, already built by the shell,
   * which knows how to copy the address and open sheets. See `PrimeirosPassos`.
   */
  primeirosPassos?: React.ReactNode
  /** The bug report room for this channel, if it exists. See `ApresentacaoOficial`. */
  /**
   * The voice ROOM where this channel's call is happening, or `null`.
   *
   * The "in call" banner came in without a tag, that is in the channel and
   * not in the room, and whoever tapped ended up in a parallel empty call
   * while the others talked in the voice room. In a direct conversation it is `""`,
   * which is right: there are no rooms, and the call is of the channel itself.
   */
  salaDaChamada?: string | null | undefined
  /** The role of each person in this channel. See `MemberPanel`. */
  /** Someone's role, color and group, all from the same place. See `MemberPanel`. */
  roleFor?: ((address: string) => CargoDoMembro | null) | undefined
  /** The nickname of each person in this channel (phase 3). See `MemberPanel` and `Timeline`. */
  apelidoDe?: ((address: string) => string | undefined) | undefined
  /** The context for the person menu on call cards (phase 3). See `CallPanel`. */
  menuDaPessoaNaChamada?: React.ComponentProps<typeof CallPanel>["menuDaPessoa"]
  /** Presence per person, live or derived — the shell knows which. */
  presenceFor?: ((address: string) => "active" | "away" | "busy" | "idle") | undefined
  /**
   * Who is in a voice room or call, to make the face ring pulse.
   *
   * A function, like `presenceFor`: the call layer and room map know this, and
   * they live in `App`. Absent means nobody in a call, the ring stays still,
   * which is the reading that commits to nothing.
   */
  emChamada?: ((address: string) => boolean) | undefined
  presenceHint?: string | undefined
  /**
   * Click a person in the list: their profile, which the shell draws.
   *
   * It lives up there not here because a profile shows that person's posts, and
   * this screen only knows the messages of the open channel. The fingerprint
   * check went with it: this click used to open it, now it is a button inside
   * the profile.
   */
  onOpenProfile: (address: string) => void
  /**
   * The card for a pending line in the conversation, a channel invite or a
   * friend request. Resolved by the shell, which holds the state. See `Timeline`.
   */
  pedidoDe?: ChatScreenPedidoDe | undefined
  pedidoOcupado?: string | null | undefined
  onPedidoResposta?: ((message: ChatMessage, aceitar: boolean) => void) | undefined
  /**
   * The poll results for this channel, by the id of the message that holds them.
   *
   * Comes from the shell because a vote is a CHANNEL event and this screen only
   * gets ROOM messages, the same reason amendments are gathered up there. See
   * `App.tsx`.
   */
  apuramentos?: Map<string, Apuramento> | undefined
  /** Vote for an option in a poll on this conversation. */
  onVotar?: ((message: ChatMessage, opcao: number) => void) | undefined
  /** Open the sheet to create a poll. Absent means absent: no entry. */
  onVotacao?: (() => void) | undefined
  /**
   * The friend request to resolve on this conversation, if there is one.
   *
   * Outside the `Timeline` on purpose, and it is why this prop exists: as a
   * conversation line, the card would scroll off screen after the second message,
   * and with it the only way to respond. Here it stays above the conversation
   * while the request is open.
   *
   * **It is the only friend request card in the app while this conversation is
   * open.** The `Timeline` stopped drawing its card when this one arrived; two
   * would give two "Accept" buttons on the same screen.
   */
  pedidoDeAmizade?: ChatScreenPedidoDeAmizade | null | undefined
  onResponderAmizade?: ((aceitar: boolean) => void) | undefined
  /**
   * The reason you cannot type in this conversation, if there is one.
   *
   * A fixed message, not a state: the shell decides whether there is friendship,
   * because that is where friendships live, this screen does not know what a
   * friend request is and does not need to. `null` is the normal case, true for
   * all channels.
   *
   * It exists because the text input was not blocked by anything: the request
   * card drew on top and the box kept working, so people sent direct messages
   * before the request was accepted, and after it was refused. See
   * `escritaNaDirecta`.
   */
  escritaTrancada?: string | null | undefined
  /**
   * The direct message is with someone we blocked. No "Call" or "Video" buttons:
   * to block is not to talk, and a call button next to that message would
   * contradict it.
   */
  directaBloqueada?: boolean
  /**
   * Ask for friendship right there, when the block is because there is no request.
   *
   * The input said "send friend request" with no button: a direct with a non-friend
   * was a dead end. Absent on other blocks, where there is nothing to ask for.
   */
  onPedirAmizade?: (() => void) | undefined
  /**
   * For the composer bar: the name of the writer (`/me`) and the gesture to set
   * a personal status (`/away`, `/estado`). Same as on the account card;
   * we just pass them through here. See `Composer` and `lib/comandosDaBarra.ts`.
   */
  meuNome?: string | undefined
  onSaveStatus?: ((statusText: string) => void) | undefined
  /** Right-click on a member row: the shared person menu, owned by the shell. */
  onUserMenu: (address: string, at: { x: number; y: number }) => void
  /*
   * There used to be a counter that opened the members panel on request from the
   * channel menu, so roles could be managed there. It went away with them: roles
   * now live in properties, and the members panel went back to being just the
   * list of who is here. On a wide screen it stays open and does not need to be
   * asked.
   */

  /**
   * The search for this conversation, the way the shell drives it.
   *
   * It lives up at the top, not here, for the same reason pinned messages do:
   * it needs ALL the messages in the channel, and what reaches this screen is
   * already filtered to the open room. A correction has no room tag and would
   * have been discarded before it could correct anything. And jumping to a
   * result might need to switch rooms and fetch more history from the vault,
   * two gestures only the shell can do. See `useProcura`.
   *
   * Absent means "this host does not have search": without it there is no
   * button in the header, which is the house rule for everything optional.
   */
  procura?: EstadoDaProcura | undefined
  procuraAberta?: boolean | undefined
  onProcuraAberta?: ((aberta: boolean) => void) | undefined
  onSaltarPara?: ((achado: Achado) => void) | undefined
  /** The readable name of a room in this channel. The identifier is not shown. */
  nomeDaSala?: ((room: string) => string) | undefined
  /** The message we just jumped to, so the conversation can highlight it. */
  destacada?: string | null | undefined
}): React.JSX.Element {
  const bridge = useBridge()
  /* The sync state of the open channel (S5): the "Receiving the channel…" bar
     and the marker of the place in the conversation. */
  const sincronia = useSincronia(active)
  // The history coming from a sibling device (1.0 "Arca"): the bar above the conversation.
  const historicoDosIrmaos = useHistoricoDosIrmaos()
  const toast = useToast()
  const confirmar = useConfirmar()
  /** On narrow screens the member column becomes a slide-in panel; this is it,
   * open. Wide screens ignore it — the panel is a plain grid column there and
   * the toggle button is CSS-hidden. Hidden by default when narrow. */
  const [membersOpen, setMembersOpen] = useState(false)
  /**
   * The menu for a message of our own, and the message it belongs to.
   *
   * Both together: the menu opens over a message, and without it the entries
   * don't know what to edit.
   */
  const [menuDaMensagem, setMenuDaMensagem] = useState<{ message: ChatMessage; at: { x: number; y: number } } | null>(
    null,
  )
  /** The message being edited, with the text already in it. */
  const [aEditar, setAEditar] = useState<{ id: string; texto: string } | null>(null)
  /** Someone else's message being reported. See `DenunciarSheet`. */
  const [aDenunciar, setADenunciar] = useState<{ id: string; sender: string } | null>(null)
  /** The sheet of what is pinned in this room, opened by the header button. */
  const [fixadasAbertas, setFixadasAbertas] = useState(false)
  /** The wrapper for the button and the sheet. See `ancora`, in `PinnedPanel`. */
  const ancoraDasFixadas = useRef<HTMLDivElement>(null)
  /** The same, for search. See `ancora`, in `ProcuraPanel`. */
  const ancoraDaProcura = useRef<HTMLDivElement>(null)

  /**
   * Whether this account can pin and unpin in this room.
   *
   * Absent `mayPin` means "cannot": a host that cannot answer this question
   * cannot promise the action. It is the rule of this bridge, the same as
   * `mayInvite` in the people list.
   *
   * The LIST of what is pinned comes from outside and is not read here: it
   * needs all the messages, and what reaches this screen is already filtered
   * to what was said. See `usePins`, in the shell.
   */
  const podeFixar = active !== null && (bridge.channels.mayPin?.(active) ?? false)

  /**
   * Whether this account moderates this channel (phase 3): it can delete other
   * people's messages.
   *
   * Absent means "cannot", by the rule of this bridge. The real guard is in the
   * core (`deleteMessage`), and the other half is in the reader
   * (`dobrarConversa`).
   */
  const podeModerar = active !== null && address !== null && (bridge.channels.mayModerate?.(active, address) ?? false)

  /**
   * The identifiers of what is pinned, for the mark in the corner of each line.
   *
   * A memoized set, not a search through the array per line: the conversation
   * has four hundred messages and the list has up to twenty, and a scan per line
   * would be eight thousand comparisons per render. The identity only changes
   * when the pinned messages change, which is when the lines actually need to be
   * redrawn.
   */
  const idsFixados = useMemo(() => new Set(pins.map((fixada) => fixada.id)), [pins])

  /**
   * The body of the original message, when this account still has it in view.
   *
   * The pinned sheet prefers it to the copy. The copy is truncated, and whoever
   * has the message deserves to read it in full. Returning nothing is the normal
   * case for those who joined the channel later, and the copy exists for that
   * case.
   */
  const corpoFixado = useMemo(() => {
    const porId = new Map<string, string>()
    for (const message of messages) {
      if (message.payload.t !== "message" || message.channel !== active) continue
      if (message.payload.id) porId.set(message.payload.id, message.payload.body ?? "")
    }
    return (id: string): string | undefined => porId.get(id)
  }, [messages, active])

  // The presentation of the shared channel. `oficial` is what makes it eligible;
  // the rest is this device's memory of who has already read it.
  const apresentacao = useApresentacao(active, oficial)

  /**
   * Who is typing, and the signal we send.
   *
   * Lives here and not at the top of the app on purpose: this screen only
   * exists while in a conversation, and leaving it clears the state. That is
   * exactly the right behavior for something ephemeral. None of this ever
   * reaches the vault.
   */
  const { typists, noteTyping, stopTyping } = useTyping(bridge, active, activeRoom, address, connection)

  /** The names, not the addresses: an indicator with `@ana:servidor` does not read well. */
  const typistNames = useMemo(() => typists.map(nameFor), [typists, nameFor])

  /**
   * Who can be mentioned in this conversation: the people in THIS channel.
   *
   * The members, not the entire directory. The choice is what makes a useful
   * suggestion and not a trap: mentioning someone not in the room does not
   * deliver it to them. The message is encrypted for this group, and whoever
   * is not in it cannot open it. Suggesting that person was promising a
   * notification that never arrives, and that is how you reply to something
   * nobody read.
   *
   * We leave ourselves out: mentioning yourself serves no purpose.
   */
  const mencionaveis = useMemo(
    () => members.filter((quem) => quem !== address).map((quem) => ({ address: quem, name: nameFor(quem) })),
    [members, address, nameFor],
  )

  /**
   * Whether this account can mention everyone (`@all`) in the open room. Never
   * in a direct conversation. Absent on the bridge means "cannot".
   */
  const podeMencionarTodos =
    active !== null && !isDirect(active) && (bridge.channels.mayMentionAll?.(active, activeRoom) ?? false)

  /**
   * The nudge, MSN style. Only in direct conversations. The guard lives inside
   * the hook, not just here, so it does not disappear on a reorganization.
   */
  const { buzz, cooldown, shaking, available: buzzAvailable } = useBuzz(bridge, active)

  /** A conversation between two people has no rooms, and it is the only place
   *  where the call belongs to the channel instead of to a voice room. */
  const ehDirecta = active !== null && isDirect(active)

  /**
   * The call for this channel, and how it displays. See `vistaDaChamada`.
   *
   * In the voice room, "Room conversation" opens its conversation below the
   * call: the call becomes a band, and the header and composer bar return.
   * It is per open room, and closes when switching rooms.
   */
  const [conversaNaChamada, setConversaNaChamada] = useState(false)
  useEffect(() => setConversaNaChamada(false), [active, activeRoom])
  const vista = vistaDaChamada === undefined ? "faixa" : vistaDaChamada
  const chamadaAqui = callChannel === active && active !== null && !callPopup && vista !== null
  const naSala = chamadaAqui && vista === "sala" && !conversaNaChamada
  /*
    A message has a menu when it has at least one entry for it: text to copy,
    pin, or edit and delete what is ours. The same three questions the menu
    asks, entry by entry. With none, neither right-click nor "⋯": an empty
    rectangle reads as broken.
  */
  /* Report: only someone else's message, with an id, not deleted, and on a
     host with reports. */
  const podeDenunciar = (message: ChatMessage): boolean =>
    bridge.denuncias !== undefined &&
    address !== null &&
    message.sender !== address &&
    message.payload.moderada !== true &&
    message.payload.id !== undefined
  /*
    Reply only where there is a composer box: release notes, a locked
    conversation, and the AFK room do not allow writing, and the gesture does
    not appear.
    */
  const responderAqui = !notasDeVersao && !escritaTrancada && !salaAfkAberta ? onResponder : undefined
  const temMenu = (message: ChatMessage): boolean =>
    // Deleted by moderation: no text left, nothing to do to it.
    message.payload.moderada !== true &&
    ((message.payload.body ?? "") !== "" ||
      (responderAqui !== undefined && podeResponder(message)) ||
      (podeFixar && message.payload.id !== undefined) ||
      (message.sender === address && (bridge.channels.editMessage || bridge.channels.deleteMessage) !== undefined) ||
      (podeModerar && message.payload.id !== undefined && bridge.channels.deleteMessage !== undefined) ||
      podeDenunciar(message))

  /**
   * The shake lives in the conversation frame, not in the whole window.
   *
   * Shaking the `<body>` would take the sidebar and people list with it. More
   * violent than a nudge, worse for those with motion sensitivity. With
   * `prefers-reduced-motion` on, the CSS swaps the shake for a highlight: the
   * nudge gets through anyway, just does not move.
   */
  return (
    <main className={`${active ? "main with-members" : "main"}${shaking ? " buzzing" : ""}${naSala ? " com-sala" : ""}`}>
      <ConnectionBanner state={connection} detail={connectionDetail} />
      <header className="topbar">
        {active ? (
          <>
            {/* A direct conversation is people, and the form says so: a round marker
                instead of the `@` borrowed from here before. Same rule as the
                sidebar, so the top and the list speak the same language. */}
            <RoomIcon
              channel={active}
              label={labelFor(active)}
              size={26}
              icon={iconFor?.(active)}
              round={isDirect(active)}
              official={oficial}
            />
            <h1>{labelFor(active)}</h1>
            {oficial && <SeloOficial />}
            {/* The lock and "Open" left the header at the owner's request
                (0.8.0). That the shared channel is open is said in the people
                list (`members.openChannel`). The `margin-left: auto` that they
                had, which pushed the buttons right, stays in this space. */}
            <span className="topbar-espaco" aria-hidden="true" />
            {/* Call from here only in a direct conversation.
             *
             * In a channel the call belongs to a VOICE room, and you enter it
             * by clicking on it in the list: a button in the header would open
             * a call for the whole channel, parallel to the rooms and invisible
             * to those inside them. In a direct conversation there are no rooms
             * or where to put them, so the call has to live here. */}
            {ehDirecta && !directaBloqueada && callChannel !== active && (
              <>
                <Button
                  variant="action"
                  onClick={() => {
                    setCallChannel(active)
                    void bridge.call.join(active).catch((error: Error) => {
                      setCallChannel(null)
                      toast(traduzirErro(error), "error")
                    })
                  }}
                >
                  <MicIcon size={16} />
                  {strings.chat.call}
                </Button>
                <Button
                  variant="action"
                  onClick={() => {
                    setCallChannel(active)
                    void bridge.call.join(active, { video: true }).catch((error: Error) => {
                      setCallChannel(null)
                      toast(traduzirErro(error), "error")
                    })
                  }}
                >
                  <CameraIcon size={16} />
                  {strings.chat.video}
                </Button>
              </>
            )}
            {/* What is pinned in this room.
             *
             * Only when there is something pinned, and for everyone. Reading
             * what is at the top does not depend on any responsibility; changing
             * it does. A permanent button that opened an empty list would be a
             * promise left hanging in the header of every conversation. */}
            {pins.length > 0 && (
              <div className="pinned-anchor" ref={ancoraDasFixadas}>
                <Button
                  variant="action"
                  title={strings.chat.pinnedToggle}
                  ariaLabel={strings.chat.pinnedToggle}
                  onClick={() => setFixadasAbertas((aberta) => !aberta)}
                >
                  <PinIcon size={16} />
                  {pins.length}
                </Button>
                {/* Next to the button that opens it, not at the bottom of the screen: it
                    hangs from that button. The wrapper serves both things at
                    once: it gives it the origin point and tells click-outside
                    that the button counts as "inside". */}
                {fixadasAbertas && (
                  <PinnedPanel
                    ancora={ancoraDasFixadas}
                    pins={pins}
                    directory={directory}
                    nameFor={nameFor}
                    podeDesafixar={podeFixar}
                    corpoDe={corpoFixado}
                    onDesafixar={(id) => {
                      void bridge.channels
                        .unpin?.(active, activeRoom, id)
                        .then(() => toast(strings.chat.pinnedUndone, "info"))
                        .catch((error: Error) => toast(traduzirErro(error), "error"))
                    }}
                    onClose={() => setFixadasAbertas(false)}
                  />
                )}
              </div>
            )}
            {/* Search in this conversation.
             *
             * Next to pinned messages, not hidden in a menu: search is the
             * gesture you do most in a chat product after writing, and a gesture
             * you have to search for does not get used. Permanent and for
             * everyone, unlike the pinned button. A pinned sheet with nothing
             * pinned was a promise left hanging; a search with no results is not
             * yet a search, it is the start of one. */}
            {procura && (
              <div className="pinned-anchor" ref={ancoraDaProcura}>
                <Button
                  variant="action"
                  title={strings.chat.searchToggle}
                  ariaLabel={strings.chat.searchToggle}
                  onClick={() => onProcuraAberta?.(!procuraAberta)}
                >
                  <SearchIcon size={16} />
                </Button>
                {procuraAberta && (
                  <ProcuraPanel
                    ancora={ancoraDaProcura}
                    estado={procura}
                    directory={directory}
                    nameFor={nameFor}
                    nomeDaSala={nomeDaSala ?? ((sala) => sala)}
                    salaAberta={activeRoom}
                    presenceFor={presenceFor}
                    emChamada={emChamada}
                    onAbrir={(achado) => onSaltarPara?.(achado)}
                    onClose={() => onProcuraAberta?.(false)}
                  />
                )}
              </div>
            )}
            {/* The nudge was here, between video and invite. It moved to the composer
                bar, next to emojis: it is a gesture you give to the other
                person, not a window you open. */}
            {/* "Invite…" was also here, until October 26, 2026. It left at the owner's
                request: it was the same button the members panel has in the
                footer, in primary, and two equal doors side by side do not
                speak to each other. Whoever invites does so through the members
                panel or the channel menu (`menu.invite`). In a direct
                conversation there is still no door: whoever opened it has all
                the power. */}
            {/* Only visible when the member column has become an overlay. */}
            <button
              type="button"
              className="members-toggle"
              title={strings.chat.membersToggle}
              aria-label={strings.chat.membersToggle}
              aria-expanded={membersOpen}
              onClick={() => setMembersOpen((current) => !current)}
            >
              <PeopleIcon size={18} />
            </button>
          </>
        ) : (
          <h1 className="muted">{strings.chat.noRoom}</h1>
        )}
      </header>

      {/* Somebody else is already talking. Offer the door rather than
          making the user guess that a call is happening. */}
      {active && callChannel !== active && (ringing.get(active)?.size ?? 0) > 0 && (
        <div className="call-invite">
          {/* The same voices from the sidebar, for the band and the channel line to
              say the same thing with the same design. Silent for the screen
              reader: the sentence after says who they are, by name. */}
          <Vozes outros={ringing.get(active)?.size ?? 0} rotulo={null} />
          <span>
            {[...(ringing.get(active)?.keys() ?? [])].map(nameFor).join(", ")}
            {(ringing.get(active)?.size ?? 0) === 1 ? strings.chat.inCallOne : strings.chat.inCallMany}
          </span>
          <Button
            variant="primary"
            onClick={() => {
              setCallChannel(active)
              // In the room where the call is, not in the channel: they are different
              // things, and entering the wrong one is entering alone.
              const sala = salaDaChamada ?? ""
              setCallRoom?.(sala)
              void bridge.call.join(active, { room: sala }).catch((error: Error) => {
                setCallChannel(null)
                toast(traduzirErro(error), "error")
              })
            }}
          >
            {strings.chat.joinCall}
          </Button>
        </div>
      )}

      {chamadaAqui && (
        <CallPanel
          call={bridge.call}
          channel={active}
          participants={participants}
          localStream={localStream}
          screenStream={screenStream}
          selfLabel={profile.displayName || strings.call.selfFallback}
          selfProfile={profile}
          nameFor={nameFor}
          directory={directory}
          presenceFor={presenceFor}
          presencaPropria={address ? presenceFor?.(address) : undefined}
          micMuted={micMuted}
          soundOff={soundOff}
          onToggleMic={onToggleMic}
          onToggleSound={onToggleSound}
          onShareScreen={onShareScreen}
          cameraOff={cameraOff}
          onToggleCamera={onToggleCamera}
          onLeave={() => void bridge.call.leave()}
          onPopOut={onCallPopup}
          modo={naSala ? "sala" : "faixa"}
          {...(tituloDaChamada ? { titulo: tituloDaChamada } : {})}
          {...(vista === "sala"
            ? { conversaAberta: conversaNaChamada, onConversa: () => setConversaNaChamada((aberta) => !aberta) }
            : {})}
          {...(onSoPalco ? { soPalco, onSoPalco } : {})}
          /* The two facts that the core only told the log. See `App`. */
          caminho={caminhoDeMedia}
          aLigar={presentesNaSala.filter((quem) => quem !== address)}
          aviso={avisoDeChamada}
          {...(onDispensarAviso ? { onDispensarAviso } : {})}
          semVoz={chamadaNaSalaAfk}
          avisoAfk={avisoAfk}
          menuDaPessoa={menuDaPessoaNaChamada}
        />
      )}

      {/* The friend request for this conversation, standing alone and outside the scrolling list.
          After the call banner and before the conversation: it is the first place
          to look, and where something that needs a response before reading the rest must be.
          See `pedidoDeAmizade`. */}
      {active && pedidoDeAmizade && (
        <div className="chat-pedido">
          <PedidoCard
            titulo={pedidoDeAmizade.titulo}
            estado={pedidoDeAmizade.estado}
            aceitar={pedidoDeAmizade.aceitar}
            recusar={pedidoDeAmizade.recusar}
            ocupado={pedidoDeAmizade.ocupado}
            {...(pedidoDeAmizade.respondivel && onResponderAmizade
              ? {
                  onAceitar: () => onResponderAmizade(true),
                  onRecusar: () => onResponderAmizade(false),
                }
              : {})}
          />
        </div>
      )}

      {/* The introduction to the common channel, once and only to those who have not yet read it.
          After the call banner and before the conversation: where a person
          looks first without anything blocking what they came here to do. */}
      {/* Onboarding wins over the introduction: someone who just created an
          account needs to know how to reach someone more than where they are.
          The introduction is not marked as read and appears later. */}
      {primeirosPassos}
      {active && !primeirosPassos && apresentacao.visivel && (
        <ApresentacaoOficial onFechar={apresentacao.dispensar} />
      )}

      {active && salaAfkAberta ? (
        /* The AFK room takes no text (the owner, 2/11/2026): no conversation, no
           input box, no files, no reactions. */
        <div className="sala-afk-vazia" role="status">
          {strings.salaAfk.semVozNemTexto}
        </div>
      ) : active ? (
        <>
          {/* `podeMenuAlheio`: pinning almost always means pinning someone ELSE's
              message, that is what pinning means. Without this, the right-click menu
              only opened on ours and the action had nowhere to go. What each entry
              offers is filtered in the menu below: edit and delete stay only on what is ours. */}
          <BarraDeSincronia estado={sincronia.estado} />
          <BarraDoHistorico estado={historicoDosIrmaos} />
          {notasDeVersao ? (
            <NotasDeVersao />
          ) : (
          <Timeline
            channel={active}
            conversa={`${active}|${activeRoom}`}
            lugar={sincronia.lugar}
            /* The same truth in both places: without an input bar, emptiness cannot
               ask to find it below. See `escritaTrancada`. */
            semCaixaDeEscrita={escritaTrancada !== null && escritaTrancada !== undefined}
            fraseDoLugar={!ehDirecta}
            presenceFor={presenceFor}
            emChamada={emChamada}
            messages={messages}
            pending={outbox}
            onRetry={onRetryEntry}
            onDiscard={onDiscardEntry}
            me={address}
            nameFor={nameFor}
            apelidoDe={apelidoDe}
            directory={directory}
            hasStoredHistory={hasStoredHistory}
            canLoadOlder={canLoadOlder}
            onLoadOlder={onLoadOlder}
            typists={typistNames}
            onOpenProfile={onOpenProfile}
            pedidoDe={pedidoDe}
            pedidoOcupado={pedidoOcupado}
            onPedidoResposta={onPedidoResposta}
            apuramentos={apuramentos}
            {...(onVotar ? { onVotar } : {})}
            /*
              The message menu always exists: "Copy text" is for everyone and the
              first entry. The "⋯" that appears on hover opens the same
              menu, so there is one rule for who has it. See `menuDaMensagem`.
            */
            onMessageMenu={(message: ChatMessage, at: { x: number; y: number }) => {
              if (temMenu(message)) setMenuDaMensagem({ message, at })
            }}
            temMenu={temMenu}
            podeMenuAlheio
            fixadas={idsFixados}
            destacada={destacada}
            {...(responderAqui ? { onResponder: responderAqui } : {})}
            citacaoDe={citacaoDe}
            onIrParaOriginal={onIrParaOriginal}
          />
          )}
          <MemberPanel
            channel={active}
            open={membersOpen}
            onClose={() => setMembersOpen(false)}
            members={members}
            state={membersState}
            onRetry={onRetryMembers}
            me={address}
            directory={directory}
            nameFor={nameFor}
            /* The member footer opens on the link: the door that was always there,
               and the address is visible in the header. */
            onInvite={() => onConvidar("link")}
            // Absent means "cannot": an old host cannot answer
            // this question, and promising the door to someone about to refuse it is worse
            // than not showing it. See `podeConvidar` in MemberPanel.
            podeConvidar={!ehDirecta && (bridge.channels.mayInvite?.(active) ?? false)}
            /* The list answers "who can read this", and in the common channel the
               answer is not just the names there. See `MemberPanel`. */
            oficial={oficial}
            onOpenProfile={onOpenProfile}
            onUserMenu={onUserMenu}
            presenceFor={presenceFor}
            presenceHint={presenceHint}
            emChamada={emChamada}
            roleFor={roleFor}
            apelidoDe={apelidoDe}
          />
          {notasDeVersao ? (
            /* Read-only, with the reason in place of the box. See `novidades`
               in strings and `NotasDeVersao`. */
            <div className="chat-escrita-trancada">
              <span role="status">{strings.novidades.soLeitura}</span>
            </div>
          ) : escritaTrancada ? (
            /*
              The locked input bar, in place of the box and not instead of it.
              
              Removing the box from the screen left a hole where people look for it, and
              a hole reads as a defect. Here it stays the same height, with the reason
              written: the only thing someone arriving needs to know.
              
              No box underneath, not a disabled box: a disabled box still
              receives pasted text in some hosts, and above all still invites typing.
              See `escritaNaDirecta`.
              */
            <div className="chat-escrita-trancada">
              <span role="status">{escritaTrancada}</span>
              {onPedirAmizade && (
                <Button variant="primary" onClick={onPedirAmizade}>
                  {strings.userMenu.friend}
                </Button>
              )}
            </div>
          ) : (
          <Composer
            connection={connection}
            value={draft}
            onChange={onDraftChange}
            onTyping={noteTyping}
            mentionable={mencionaveis}
            podeMencionarTodos={podeMencionarTodos}
            directory={directory}
            presenceFor={presenceFor}
            emChamada={emChamada}
            meuNome={meuNome}
            onSaveStatus={onSaveStatus}
            eu={address}
            /* The current name of who wrote the original: the reply stores
               the address, and a name changed since appears already changed. */
            resposta={resposta ? { ...resposta, nome: nameFor(resposta.autor) } : null}
            onAlternarMencao={onAlternarMencao}
            onCancelarResposta={onCancelarResposta}
            // Only if this conversation allows elbow nudges. Without this no button
            // shows up, the guard is still `useBuzz`, and the input bar
            // does not know and does not need to know what a direct conversation is.
            {...(buzzAvailable ? { onBuzz: buzz, buzzCooldown: cooldown } : {})}
            /* Only when the host knows how to record a vote: creating a poll
               where nobody can vote was offering half a feature. */
            {...(onVotacao && bridge.votacoes ? { onVotacao } : {})}
            onSend={(body, extras) => {
              onSend(active, body, extras)
              // The sentence ended. No "stopped typing" signal goes out, the timeout
              // handles that on the other side. This reopens the burst so the
              // next sentence signals again without waiting for the interval.
              stopTyping()
            }}
          />
          )}
        </>
      ) : (
        <EmptyState
          title={strings.chat.emptyTitle}
          body={strings.chat.emptyBody}
          action={{ label: strings.chat.emptyAction, onClick: () => onPrompt("channel") }}
        />
      )}

      {/*
        The menu of a message. Outside `Timeline` and from here down, because a
        menu anchored to the pointer does not belong in the scrolling list: if it lived
        there, it would leave when the conversation scrolls.
        
        It was "for your own message" and no longer is: pinning almost always means
        pinning someone else's message. What stays your own are edit and delete
        entries, and filtering moved here, `Timeline` no longer does it.
        */}
      {menuDaMensagem && active && (
        <ContextMenu
          at={menuDaMensagem.at}
          onClose={() => setMenuDaMensagem(null)}
          items={[
            /* Copy first, for everyone and all messages with text:
               the gesture done most often and the only one that changes nothing. */
            ...((menuDaMensagem.message.payload.body ?? "") !== ""
              ? [
                  {
                    label: strings.chat.copyText,
                    onSelect: () => {
                      void copiarTexto(menuDaMensagem.message.payload.body ?? "")
                        .then(() => toast(strings.chat.textCopied))
                        .catch(() => toast(strings.common.copyFailed, "error"))
                    },
                  },
                ]
              : []),
            /* Reply, right after copy: the other everyday
               gesture, and the phone menu (long press) is this one. */
            ...(responderAqui && podeResponder(menuDaMensagem.message)
              ? [{ label: strings.respostas.responder, onSelect: () => responderAqui(menuDaMensagem.message) }]
              : []),
            ...(podeFixar && menuDaMensagem.message.payload.id
              ? [
                  {
                    separatorBefore: (menuDaMensagem.message.payload.body ?? "") !== "",
                    label: pins.some((fixada) => fixada.id === menuDaMensagem.message.payload.id)
                      ? strings.chat.messageUnpin
                      : strings.chat.messagePin,
                    onSelect: () => {
                      const alvo = menuDaMensagem.message.payload.id
                      if (!alvo) return
                      const fixada = pins.some((entrada) => entrada.id === alvo)
                      const feito = fixada
                        ? bridge.channels.unpin?.(active, activeRoom, alvo)
                        : bridge.channels.pin?.(active, activeRoom, {
                            id: alvo,
                            sender: menuDaMensagem.message.sender,
                            body: menuDaMensagem.message.payload.body ?? "",
                            sentAt: menuDaMensagem.message.payload.sentAt ?? Date.now(),
                          })
                      void feito
                        ?.then(() => toast(fixada ? strings.chat.pinnedUndone : strings.chat.pinnedDone, "info"))
                        .catch((error: Error) => toast(traduzirErro(error), "error"))
                    },
                  },
                ]
              : []),
            /* Edit and delete stay only on what is YOURS. `Timeline`
               no longer does that filtering, it now opens the menu on any message
               so pinning fits, so it must be done here, entry by entry. */
            ...(bridge.channels.editMessage && menuDaMensagem.message.sender === address
              ? [
                  {
                    label: strings.chat.messageEdit,
                    separatorBefore: true,
                    onSelect: () =>
                      setAEditar({
                        id: menuDaMensagem.message.payload.id ?? "",
                        texto: menuDaMensagem.message.payload.body ?? "",
                      }),
                  },
                ]
              : []),
            ...(bridge.channels.deleteMessage && menuDaMensagem.message.sender === address
              ? [
                  {
                    label: strings.chat.messageDelete,
                    destructive: true,
                    onSelect: () => {
                      const alvo = menuDaMensagem.message.payload.id
                      if (!alvo) return
                      void confirmar({
                        titulo: strings.chat.messageDeleteTitle,
                        corpo: strings.chat.messageDeleteConfirm,
                        verbo: strings.chat.messageDelete,
                        destructive: true,
                      })
                        .then(async (sim) => {
                          if (sim) await bridge.channels.deleteMessage?.(active, alvo)
                        })
                        .catch((error: Error) => toast(traduzirErro(error), "error"))
                    },
                  },
                ]
              : []),
            /* Delete someone ELSE's message for moderators (phase 3).
               Same tombstone as the author's "Delete", and the warning tells the whole truth:
               every honest app hides the text, and whoever read it, read it. */
            ...(bridge.channels.deleteMessage &&
            podeModerar &&
            menuDaMensagem.message.sender !== address &&
            menuDaMensagem.message.payload.id
              ? [
                  {
                    label: strings.chat.messageModerate,
                    separatorBefore: true,
                    destructive: true,
                    onSelect: () => {
                      const alvo = menuDaMensagem.message.payload.id
                      if (!alvo) return
                      void confirmar({
                        titulo: strings.chat.messageModerateTitle(nameFor(menuDaMensagem.message.sender)),
                        corpo: strings.chat.messageModerateConfirm,
                        verbo: strings.chat.messageModerate,
                        destructive: true,
                      })
                        .then(async (sim) => {
                          if (sim) await bridge.channels.deleteMessage?.(active, alvo)
                        })
                        .catch((error: Error) => toast(traduzirErro(error), "error"))
                    },
                  },
                ]
              : []),
            /* Report someone else's message, last (Task 7 of
               reports). The sheet shows what leaves the device before sending. */
            ...(podeDenunciar(menuDaMensagem.message) && menuDaMensagem.message.payload.id
              ? [
                  {
                    label: strings.denunciar.menu,
                    separatorBefore: true,
                    onSelect: () => {
                      const id = menuDaMensagem.message.payload.id
                      if (id) setADenunciar({ id, sender: menuDaMensagem.message.sender })
                    },
                  },
                ]
              : []),
          ]}
        />
      )}

      {aDenunciar && active && (
        <DenunciarSheet
          alvo={{ canal: active, pessoa: aDenunciar.sender, mensagem: { id: aDenunciar.id } }}
          nomeDoAlvo={nameFor(aDenunciar.sender)}
          nomeDe={nameFor}
          nomeDoCanal={labelFor(active)}
          nomeDaSala={nomeDaSala}
          onClose={() => setADenunciar(null)}
        />
      )}

      {/*
        The edit dialog. A dialog and not the input bar: the bar holds the draft
        of a sentence to say, and writing over it to correct something else loses
        what was in progress.
      */}
      {aEditar && active && (
        <EditarMensagem
          texto={aEditar.texto}
          onClose={() => setAEditar(null)}
          onGuardar={(texto) => {
            const alvo = aEditar.id
            setAEditar(null)
            void bridge.channels
              .editMessage?.(active, alvo, texto)
              .catch((error: Error) => toast(traduzirErro(error), "error"))
          }}
        />
      )}

      {/* A quiet line of connection state, nothing more: errors go to toasts. */}
      <footer className="statusbar">{connectionLabel(connection)}</footer>
    </main>
  )
}

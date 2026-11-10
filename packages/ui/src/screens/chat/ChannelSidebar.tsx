import { useEffect, useRef, useState } from "react"
import type { Activity, ChannelRoom, ConnectionState, Profile } from "../../bridge.js"
import type { View } from "../../types.js"
import { Button } from "../../components/Button.js"
import { GripIcon, LockIcon, PersonAddIcon, PlusIcon } from "../../icons.js"
import { strings } from "../../strings.js"
import { seccoes, type Seccao } from "../settings/seccoes.js"
import { Avatar } from "../../components/Avatar.js"
import { ChevronIcon, RoomGlyph } from "../../components/SidebarIcons.js"
import { MarcaDeSilencio } from "../../components/MarcaDeSilencio.js"
import { MarcaDeTransmissao, type Transmissao } from "../../components/MarcaDeChamada.js"
import { chaveDoSilencio } from "../../lib/silenciados.js"
import { RoomIcon } from "../../components/RoomIcon.js"
import { SeloOficial } from "../../components/SeloOficial.js"
import { Vozes } from "../../components/Vozes.js"
import { useCollapsed } from "../../hooks/usePrefs.js"
import { useToqueLongo } from "../../hooks/useToqueLongo.js"
import type { RoomGroup } from "../../hooks/useRooms.js"
import { temArvore as temArvoreDeSalas } from "./arvoreDeSalas.js"
import { largaDepois } from "./reordenarCategorias.js"
import { CartaoDaConta, type ChamadaNoPainel } from "../profile/CartaoDaConta.js"
import { isDirect } from "../../lib/format.js"

/**
 * Keys for what is collapsed.
 *
 * Prefixed by type and scoped to the channel: two categories with the same name in different channels collapse separately, which is what you expect. They are opaque-nothing reads them but this file.
 */
const chave = {
  // The `e:` prefix stays as is on purpose: it is a key saved to disk, and swapping it for `c:` would forget what everyone has collapsed today. The function name was the one that was wrong-the tree that collapses is for a CHANNEL.
  canal: (channel: string): string => `e:${channel}`,
  categoria: (channel: string, category: string): string => `c:${channel}/${category}`,
  voz: (channel: string, room: string): string => `v:${channel}/${room}`,
  fechados: (channel: string): string => `f:${channel}`,
}

/**
 * What is being dragged, and what kind it is.
 *
 * Three different things get dragged in the same list: a PERSON, from one voice room to another; a ROOM, to change its order or category; and an entire CATEGORY, which brings its rooms along. If what gets dropped does not say what it is, each target has to guess-and guesses wrong the day someone drops a person on top of a text room. The type travels in the state, and the state decides what each line accepts.
 *
 * A category header receives TWO of these: a room, which goes to the end of it, and another category, which lines up next to it. Two gestures with two different results at the same target, and that is why we tell them apart by type before telling them apart by place.
 *
 * The handle on each one is what separates them for whoever drags: you grab a category by its header, a room by its line, a person by their face. The header is a sibling of the room list, not its parent, so grabbing the first room in a category never grabs the category-unlike the person, who lives inside the room line and needs to stop the bubble by hand.
 */
export interface Arrasto {
  tipo: "pessoa" | "sala" | "categoria"
  id: string
}

/**
 * The collapse button: a triangle, and nothing else.
 *
 * Quiet until you hover, because a list with ten lines does not need ten triangles competing with the names. When collapsed it becomes always visible-otherwise there would be no way to expand it again.
 */
function FoldButton({
  open,
  label,
  onToggle,
}: {
  open: boolean
  label: string
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      className="fold"
      aria-expanded={open}
      aria-label={label}
      title={label}
      onClick={(event) => {
        // The entire line is clickable and expands: collapsing is not expanding.
        event.stopPropagation()
        onToggle()
      }}
    >
      <ChevronIcon size={12} />
    </button>
  )
}

/**
 * A person in a voice room.
 *
 * `presence` is optional: `App` can give each person's state so the face ring gets the right color (busy in red). Without it, the ring is green.
 */
export interface PresenteNaVoz {
  address: string
  name: string
  profile?: Profile | undefined
  presence?: "active" | "away" | "busy" | "idle" | undefined
  /**
   * What this person is transmitting: screen, audio, or both. Takes the transmission indicator next to their face (owner request from October 27, 2026, 23:55). Absent means not transmitting, or not knowing: today you only know in the room we are in (the call participants). In other rooms the `transmite` field is missing from the presence update, which is from the core.
   */
  transmite?: Transmissao | undefined
}

/**
 * A room in the open channel: the line, who is there, and what you can do to them.
 *
 * Lives apart because this is where the hierarchy lives-room, people inside the room, and the gesture of dragging someone from one to another. Written in the middle of the list, this pushed the line past any readable width.
 */
function RoomRow({
  sala,
  activa,
  presentes,
  aberta,
  onToggle,
  onOpen,
  onMenu,
  onPersonMenu,
  mayMove,
  haOutraSalaDeVoz,
  onMovePerson,
  onReorder,
  me,
  arrasto,
  setArrasto,
  alvo,
  setAlvo,
  porLer = 0,
  silencio = null,
}: {
  sala: ChannelRoom
  activa: boolean
  /** Unread messages in this room. The open room always has zero. */
  porLer?: number
  /**
   * `propria`: this room is muted, and shows the bell. `canal`: the whole channel is, and the room just dims (the bell is already on the channel line).
   */
  silencio?: "propria" | "canal" | null
  presentes: PresenteNaVoz[]
  aberta: boolean
  onToggle: () => void
  onOpen: () => void
  onMenu?: ((room: string, at: { x: number; y: number }) => void) | undefined
  onPersonMenu?: ((room: string, address: string, at: { x: number; y: number }) => void) | undefined
  mayMove: boolean
  /** Is there another voice room in this channel? Without one, there is nowhere to move to. */
  haOutraSalaDeVoz: boolean
  onMovePerson?: ((address: string, room: string) => void) | undefined
  /** Drop a room on top of this one. Absent means no one to arrange it. */
  onReorder?: ((arrastado: string, alvo: string) => void) | undefined
  me: string | null
  arrasto: Arrasto | null
  setArrasto: (arrasto: Arrasto | null) => void
  alvo: string | null
  setAlvo: (room: string | null) => void
}): React.JSX.Element {
  const ehVoz = sala.kind === "voice"
  /* The same menus, with a finger down. See `useToqueLongo`. */
  const aoDedo = useToqueLongo()
  // With only one voice room, there is nowhere to move anyone to, and a gesture
  // that leads nowhere is not offered.
  const podeMover = mayMove && haOutraSalaDeVoz && onMovePerson !== undefined
  /**
   * The person being dragged is already IN this room.
   *
   * Moving someone to the room they are already in is not a move: the request
   * goes out, the client on the other end joins the room they were already in,
   * and the result is nothing. The menu never offered that destination, it
   * filters by `salaActual`, but drag-and-drop did, with the line lighting up
   * as if something were happening.
   *
   * We know it here and not from the drag state: who is in this room is what
   * this line already has in front of it, and we don't need the drag to carry
   * data from where it came from.
   */
  const jaEstaCa = arrasto?.tipo === "pessoa" && presentes.some((quem) => quem.address === arrasto.id)
  // Two different things drop here, and the line responds to each in its own way:
  // a person joins the room (only if it's a voice room), a room reorganizes
  // before this one. See `Arrasto`.
  const recebePessoa = ehVoz && podeMover && arrasto?.tipo === "pessoa" && !jaEstaCa
  const recebeSala = onReorder !== undefined && arrasto?.tipo === "sala" && arrasto.id !== sala.room
  const recebe = recebePessoa || recebeSala

  return (
    <li>
      <div
        className={[
          "room-row",
          activa ? "current" : "",
          porLer > 0 ? "unread" : "",
          silencio !== null ? "silenciado" : "",
          // The AFK room (2/11/2026): the same line, faded, with the AFK badge.
          sala.afk ? "sala-afk" : "",
          /**
           * What this drag can do, stated BEFORE pointing at anything.
           *
           * The gesture existed but was invisible: a person would leave a room
           * and the list stayed exactly the same until the cursor hovered over a
           * line. If you didn't know it dropped into voice rooms, there was no
           * way to find out, and most people never discover what they find by
           * accident.
           *
           * Now, the instant someone is picked up, ALL rooms that can receive
           * them light up. The screen responds to the gesture with a map of
           * destinations, which is the difference between a drag you guess at
           * and one you can read. The room where the person already is stays out,
           * because it is not a destination.
           */
          recebePessoa ? "pode-receber" : "",
          // Two different badges for two different gestures: receiving people lights up
          // the whole line, receiving a room draws where it will land. Confusing them was
          // confusing the gestures.
          alvo === sala.room && recebePessoa ? "over" : "",
          alvo === sala.room && recebeSala ? "antes" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onContextMenu={(event) => {
          event.preventDefault()
          onMenu?.(sala.room, { x: event.clientX, y: event.clientY })
        }}
        {...aoDedo(onMenu ? (ponto) => onMenu(sala.room, ponto) : undefined)}
        draggable={onReorder !== undefined}
        onDragStart={(event) => {
          if (onReorder === undefined) return
          // Only the room drags from here. A person drags from their line, which is a
          // child of another element, so the two gestures never start from the same place.
          event.dataTransfer?.setData("text/plain", sala.name)
          setArrasto({ tipo: "sala", id: sala.room })
        }}
        onDragEnd={() => {
          setArrasto(null)
          setAlvo(null)
        }}
        {...(recebe
          ? {
              // The words of the gesture, where the gesture happens.
              title: recebePessoa ? strings.voiceMove.dropTitle(sala.name) : strings.rooms.dropBefore(sala.name),
              // Without this the browser refuses to drop: the default behavior of
              // `dragover` is "nothing drops here".
              onDragOver: (event: React.DragEvent) => {
                event.preventDefault()
                setAlvo(sala.room)
              },
              onDragLeave: () => setAlvo(null),
              onDrop: (event: React.DragEvent) => {
                event.preventDefault()
                const largado = arrasto
                setAlvo(null)
                setArrasto(null)
                if (!largado) return
                if (largado.tipo === "pessoa" && recebePessoa) onMovePerson?.(largado.id, sala.room)
                if (largado.tipo === "sala" && recebeSala) onReorder?.(largado.id, sala.room)
              },
            }
          : {})}
      >
        <button className="room" onClick={onOpen}>
          {/* The circle of a voice room pulses when there are people in it: the
              animation says there is life there, instead of being decorative.
              See `.room-live`. */}
          <span className={ehVoz && presentes.length > 0 ? "room-glyph room-live" : "room-glyph"} aria-hidden="true">
            <RoomGlyph kind={sala.kind} layout={sala.layout} size={14} />
          </span>
          <span className="room-name">{sala.name}</span>
          {sala.afk && (
            <span className="marca-afk" title={strings.salaAfk.marcaTitulo}>
              {strings.salaAfk.marca}
            </span>
          )}
          {silencio === "propria" && <MarcaDeSilencio />}
          {/* How many are inside only shows when faces are hidden, with them
              visible, the number is the same information written twice. It shows
              with the same layout as a channel line, one banner per person: it
              used to be a number in a pill, like category counts, which count
              rooms not people. */}
          {presentes.length > 0 && !aberta && (
            <Vozes
              outros={presentes.filter((quem) => quem.address !== me).length}
              eu={presentes.some((quem) => quem.address === me)}
              rotulo={strings.sidebar.voiceCount(presentes.length)}
            />
          )}
          {/* The number to be read, on the right, like the ones for private
              conversations in Friends (owner request from 27 October 2026). */}
          {porLer > 0 && (
            <span className="badge room-unread" aria-label={strings.sidebar.unreadCount(porLer)}>
              {porLer > 99 ? "99+" : porLer}
            </span>
          )}
        </button>
        {presentes.length > 0 && (
          <FoldButton
            open={aberta}
            label={aberta ? strings.sidebar.collapse(sala.name) : strings.sidebar.expand(sala.name)}
            onToggle={onToggle}
          />
        )}
      </div>

      {presentes.length > 0 && aberta && (
        <ul className="room-voice-members">
          {presentes.map((quem) => {
            // Dragging yourself is joining another room, and for that you click the room.
            // The core refuses it, so we don't offer it here.
            const arrastavel = podeMover && quem.address !== me
            /**
             * The menu opens on ANY person, not just those who can be dragged.
             *
             * It used to depend on `podeMover`, so right-clicking a name in a
             * voice room did nothing for people without the `move`
             * responsibility, not even on their own name. This is the PERSON
             * menu: see profile, copy address, send message. Moving is the
             * addition, and that one still depends on the responsibility. See
             * `itensDaPessoaEmVoz`.
             */
            const temMenu = onPersonMenu !== undefined
            const cara = (
              <>
                {/* No presence ring in rooms: the owner doesn't want it in the community
                    column (27 October 2026). Being in a voice room means being
                    in a call by definition, and the room already says that; the
                    ring was extra noise in a short list. */}
                <Avatar profile={quem.profile} fallback={quem.name[0] ?? "?"} />
                <span className="voice-member-name">{quem.name}</span>
                {quem.transmite && <MarcaDeTransmissao transmite={quem.transmite} />}
                {/**
                 * The drag handle, for users who can drag.
                 *
                 * The row was always draggable but never signaled it: the
                 * `title` only shows after hovering and waiting, and
                 * `cursor: grab` only appears when already over it. Six dots
                 * in the corner tell you it's static.
                 *
                 * `aria-hidden`, and it's deliberate: screen reader users don't
                 * drag anything, and for them the way forward is the menu,
                 * which opens on click and right-click with all destinations
                 * inside and a label at the top. An announced symbol would
                 * promise a gesture to someone who cannot perform it.
                 */}
                {arrastavel && (
                  <span className="voice-member-pega" aria-hidden="true">
                    <GripIcon size={12} />
                  </span>
                )}
              </>
            )
            return (
              <li
                key={quem.address}
                className={arrasto?.id === quem.address ? "a-arrastar" : undefined}
                draggable={arrastavel}
                onDragStart={(event) => {
                  if (!arrastavel) return
                  // The `setData` is what makes this a drag for the browser, Firefox won't
                  // start one without it. The state is what reads it.
                  event.dataTransfer?.setData("text/plain", quem.address)
                  // And it doesn't bubble up to the room line, which is also draggable: grabbing
                  // a person cannot be grabbing the room they are in.
                  event.stopPropagation()
                  setArrasto({ tipo: "pessoa", id: quem.address })
                }}
                onDragEnd={() => {
                  setArrasto(null)
                  setAlvo(null)
                }}
              >
                {temMenu ? (
                  <button
                    className="voice-member"
                    // The words follow what the gesture does: if you cannot drag, you should not
                    // be invited to drag.
                    title={
                      arrastavel ? strings.voiceMove.personTitle(quem.name) : strings.voiceMove.personMenuTitle(quem.name)
                    }
                    onClick={(event) => onPersonMenu(sala.room, quem.address, { x: event.clientX, y: event.clientY })}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      onPersonMenu(sala.room, quem.address, { x: event.clientX, y: event.clientY })
                    }}
                    {...aoDedo((ponto) => onPersonMenu(sala.room, quem.address, ponto))}
                  >
                    {cara}
                  </button>
                ) : (
                  cara
                )}
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

export function ChannelSidebar({
  view,
  rooms,
  aEsperaDeEntrada = [],
  canalOficialPorEntrar,
  labelFor,
  iconFor,
  oficialFor,
  roomGroups,
  activeRoom,
  onSelectRoom,
  voicePresence,
  onRoomMenu,
  onCategoryMenu,
  categoriaRestrita,
  onVoiceMemberMenu,
  mayMove = false,
  onMovePerson,
  onReorderRoom,
  onReorderCategory,
  closedRooms,
  onReopenRoom,
  onRemoveRoom,
  onNewRoom,
  presenceForChannel,
  presenceHint,
  active,
  callChannel,
  ringing,
  nameFor,
  salaDaChamadaEm,
  unreads,
  porLerNaSala,
  silenciado,
  profile,
  address,
  connection,
  open,
  onClose,
  onSelectChannel,
  onChannelMenu,
  onCompose,
  onEditProfile,
  seccaoConfig,
  onSeccaoConfig,
  onActivityMenu,
  activity = "online",
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
  onPrompt,
  onSaveStatus,
  pedidoDeEstado,
  chamada = null,
}: {
  /**
   * The open destination, everything except Friends.
   *
   * Friends stopped drawing this bar: it had the header repeating the word the
   * banner already said and the body literally empty, 236px of frame before
   * reaching the conversations. Who lists the conversations there is
   * `FriendsAside`, which already existed and was already built.
   *
   * Excluded in the TYPE and not just in `App`: it was one more condition in a
   * cascade no one would read again, and the compiler has no way to know the
   * branch is dead. So the day someone passes `"pessoas"` here again is the day
   * the `build` tells them, not the day the empty column reappears on screen.
   */
  view: Exclude<View, "pessoas">
  rooms: string[]
  /**
   * Channels that were requested to join and have not arrived yet: a followed
   * link, or an invite accepted while the inviter was offline. They draw in
   * gray, at the end of the list, with the name the link or invite said.
   */
  aEsperaDeEntrada?: { canal: string; nome: string; nota?: string; onCancelar: () => void }[] | undefined
  /**
   * The "Join the Orwell channel" button, for those not in the default channel
   * (by choice at signup, or because they left). Missing: the server does not
   * announce a default channel, the account is already there, or the host cannot
   * join.
   */
  canalOficialPorEntrar?: { aEntrar: boolean; onEntrar: () => void } | undefined
  /** Display name for a channel: the other person for a DM, else its slug. */
  labelFor: (channel: string) => string
  /** Published icon for the channel, if any. See `space.meta`. */
  iconFor?: ((channel: string) => string | undefined) | undefined
  /**
   * Is this the default channel the server announces? See `lib/oficial.ts`.
   *
   * It arrives from outside, already decided, and is not calculated here: the
   * comparison needs what the server said in `hello.ok`, and a sidebar does not
   * have, and should not have, an opinion on who is authority.
   */
  oficialFor?: ((channel: string) => boolean) | undefined
  /**
   * The rooms in the open channel, grouped by category.
   *
   * Empty, or only with the default room, makes the list behave as it always
   * has. A channel does not need declared rooms to function.
   */
  roomGroups?: RoomGroup[] | undefined
  /** The open room within the channel. Empty is the default room. */
  activeRoom?: string | undefined
  onSelectRoom?: ((room: string) => void) | undefined
  /**
   * Who is in each voice room, with what is needed to draw them.
   *
   * Name and profile, not just address: a list of people in a voice room is
   * read by face and name, which is how you read the same thing in any app
   * people already use.
   */
  voicePresence?: ((room: string) => PresenteNaVoz[]) | undefined
  /** Right-click on a text or voice room. */
  onRoomMenu?: ((room: string, at: { x: number; y: number }) => void) | undefined
  /**
   * Right-click on a category header.
   *
   * The same gesture as for rooms, because it is the gesture people try first
   *, and without it a category could be created and never undone. Missing means
   * no one organizes, so the header opens no menu.
   */
  onCategoryMenu?: ((category: string, at: { x: number; y: number }) => void) | undefined
  /**
   * Does this category show only to some roles?
   *
   * It arrives decided from outside, like `oficialFor`: whoever knows which
   * roles were declared is whoever has the model in front of them, and a sidebar
   * does not need to know how to read category declarations.
   *
   * The badge goes to EVERYONE who sees the category, not just those who
   * administer it. Those with the role learn that they are seeing something not
   * everyone sees, and that is information that changes what you write there.
   * Those who administer learn what they restricted, which was the complaint:
   * without any badge, restricted and open categories were indistinguishable,
   * and the only way to know which was which was to open each one's settings.
   */
  categoriaRestrita?: ((category: string) => boolean) | undefined
  /** Right-click (or click) on someone in a voice room. */
  onVoiceMemberMenu?: ((room: string, address: string, at: { x: number; y: number }) => void) | undefined
  /**
   * Does this account have the responsibility to move people between voice
   * rooms.
   *
   * Without it no one drags: the target is not even draggable, rather than
   * failing after drop. The real refusal lives in the core, hiding the gesture
   * does not stop anyone from calling the bridge, but promising a gesture that
   * will be refused is worse than not offering it.
   */
  mayMove?: boolean
  /**
   * Ask someone to switch voice rooms.
   *
   * **This is a request, not an order.** The receiver is the other person's
   * client, who leaves one call and joins another by their own choice; an
   * altered client ignores it. See `voice.move` in the protocol. The interface
   * tells them where to read it, see `strings.voiceMove`.
   */
  onMovePerson?: ((address: string, room: string) => void) | undefined
  /**
   * Change the order: drop a room on another, or on a category.
   *
   * Convention, like changing the name, you publish the order and clients obey
   * it. Missing means no one organizes, so no room drags.
   */
  onReorderRoom?: ((arrastado: string, alvo: { antesDe: string } | { categoria: string }) => void) | undefined
  /**
   * Change the order of categories, by dropping one on another.
   *
   * **Moves the whole block, rooms included**, and publishes no rooms: they
   * order themselves within their category, so the category moves and takes them
   * with it. See `reordenarCategorias`.
   *
   * Missing means no one organizes, so the header does not drag. Beyond the
   * responsibility, it requires a host that can declare categories: without that
   * the position would have nowhere to live.
   */
  onReorderCategory?: ((arrastada: string, alvo: string) => void) | undefined
  /**
   * Delete a closed room, for good.
   *
   * Only from here, and that is the design: a closed room does not appear in the
   * main list, so this section is the only place it exists, and that is why
   * deletion lives next to "reopen" instead of in the properties. Whoever deletes
   * had to close it first, which makes the gesture a two-step decision and not a
   * careless click.
   */
  onRemoveRoom?: ((room: string) => void) | undefined
  /** The closed rooms in this channel, so they can be brought back. */
  closedRooms?: ChannelRoom[] | undefined
  onReopenRoom?: ((room: string) => void) | undefined
  /** Only those who manage the channel see what organizes the rooms. */
  onNewRoom?: (() => void) | undefined
  /** The other person's presence, for DM rows; null for rooms. */
  presenceForChannel?: ((channel: string) => "active" | "away" | "busy" | "idle" | null) | undefined
  presenceHint?: string | undefined
  active: string | null
  callChannel: string | null
  ringing: Map<string, Map<string, number>>
  /**
   * The name of whoever is in a call, so the channel line can say it.
   *
   * `ringing` brings addresses, and an address does not answer the question
   * "who is in the room?", which was the owner's report on 5 October 2026.
   * Missing leaves the line with the count, which is what it always said.
   */
  nameFor?: ((address: string) => string) | undefined
  /**
   * The voice room where this channel's call is happening, when there is one and
   * only one.
   *
   * It arrives from outside because the answer needs the presence map by room
   * for ALL channels, and this list only knows the open channel. `null` when
   * there is no call or more than one, and in that case the channel line goes
   * nowhere. See `salaUnicaDaChamadaDe`.
   */
  salaDaChamadaEm?: ((channel: string) => string | null) | undefined
  /**
   * Unread messages per channel; missing means read. In the open channel, only
   * counts rooms that are not in focus (see `lib/porLerPorSala.ts`).
   */
  unreads: Map<string, number>
  /** Unread messages in each room of the open channel. Missing means zero. */
  porLerNaSala?: ((room: string) => number) | undefined
  /**
   * Is this key muted? The exact key (`lib/silenciados.ts`): the channel,
   * or `canal/sala`. The counts already arrive with mute applied; this
   * serves to fade the row and put the bell crossed out.
   */
  silenciado?: ((chave: string) => boolean) | undefined
  profile: Profile
  address: string | null
  connection: ConnectionState
  /** On narrow screens the sidebar is an off-canvas drawer; this is it, open.
   * On wide screens the sidebar is a plain grid column and `open` is inert. */
  open: boolean
  onClose: () => void
  onSelectChannel: (channel: string) => void
  onChannelMenu: (channel: string, at: { x: number; y: number }) => void
  onCompose: () => void
  onEditProfile: () => void
  /** The open settings section, and how to change it. See `seccoes()`. */
  seccaoConfig?: Seccao | undefined
  onSeccaoConfig?: ((seccao: Seccao) => void) | undefined
  /** Click on the identity card: choose how you appear. */
  onActivityMenu?: ((at: { x: number; y: number }) => void) | undefined
  /** This device's chosen activity, for the dot beside your own name. */
  activity?: Activity | undefined
  /** The bell lives with the rest of the "you" controls, in this same card. */
  onNotifications?: ((at: { x: number; y: number }) => void) | undefined
  unreadNotifications?: number | undefined
  /** Pass-through only to the card, which is where the bell lives. */
  avisaDeNotificacao?: boolean | undefined
  /**
   * The microphone and speaker state, for the card to draw.
   *
   * They arrive from outside already decided, and the sidebar keeps no copy:
   * the call panel shows the same two states, and two components with their own
   * memory end up disagreeing, a button saying "muted" next to another saying
   * it is not worse than having no button at all.
   *
   * `micMuted` is the user's choice, not the effect: with sound off the
   * microphone is silent anyway, and the drawer combines both.
   */
  micMuted?: boolean | undefined
  soundOff?: boolean | undefined
  /** Without these two, the controls don't draw. A button that leads nowhere
   *  is worse than no button. */
  onToggleMic?: (() => void) | undefined
  onToggleSound?: (() => void) | undefined
  /**
   * The microphone and speaker menus, the settings icon, and round-trip time.
   *
   * Pass-through, like everything the account bar shows: the sidebar decides
   * nothing about them, just passes them to `CartaoDaConta`. See there why
   * the bar has no state.
   */
  onMicMenu?: ((at: { x: number; y: number }) => void) | undefined
  onSoundMenu?: ((at: { x: number; y: number }) => void) | undefined
  onAbrirDefinicoes?: (() => void) | undefined
  latencia?: { ms: number; ate: "servidor" | "par" } | null | undefined
  onLatenciaHover?: ((dentro: boolean) => void) | undefined
  onPrompt: (prompt: "channel" | "amigo" | "link") => void
  onSaveStatus: (statusText: string) => void
  /** Rises when "Custom…" asks for the status line to edit. */
  pedidoDeEstado?: number | undefined
  /**
   * The live call, for the panel at the foot of the column to draw in the
   * middle floor (P1, October 28, 2026). The shell mounts the box (it is the
   * dock, in side form) and decides when: see `App`. Pass-through, like the rest.
   */
  chamada?: ChamadaNoPainel | null | undefined
}): React.JSX.Element {
  const { isCollapsed, toggleCollapsed, mostrar } = useCollapsed()
  /**
   * What is being dragged, and where it is being aimed.
   *
   * In state and not just in `dataTransfer`, for the same reason as in the
   * members panel: `dataTransfer` is what makes the browser treat this as a
   * real drag, but its contents only read on `drop`, during `dragover`, when
   * the target needs to light up, never.
   */
  const [arrasto, setArrasto] = useState<Arrasto | null>(null)
  const [alvo, setAlvo] = useState<string | null>(null)
  /* The same menus, with a finger down. See `useToqueLongo`. */
  const aoDedo = useToqueLongo()
  const aside = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Drawer behaviour, only while open (which only happens on narrow screens):
  // focus moves in, Escape closes, focus returns to the toggle that opened it.
  // Deliberately lighter than Modal — the rail stays reachable, so no trap.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    aside.current
      ?.querySelector<HTMLElement>("button:not([disabled]), [href], input:not([disabled])")
      ?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeRef.current()
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      opener?.focus()
    }
  }, [open])

  return (
    <aside
      ref={aside}
      className={open ? "sidebar open" : "sidebar"}
      role={open ? "dialog" : undefined}
      aria-label={open ? strings.sidebar.drawerLabel : undefined}
    >
      <header className="sidebar-header">
        {/* The `+` lives beside the section it creates in, not floating on the
            rail: what it makes depends on where you are. */}
        <span className="sidebar-titulo">
          <span>
            {view === "perfil"
              ? strings.sidebar.headerProfile
              : view === "chat"
                ? strings.sidebar.headerChat
                : view === "social"
                  ? strings.sidebar.headerSocial
                  : strings.sidebar.headerSettings}
          </span>
        </span>
        {view === "perfil" && (
          <button
            className="header-add"
            title={strings.sidebar.newPost}
            aria-label={strings.sidebar.newPost}
            onClick={onCompose}
          >
            <PlusIcon size={17} />
          </button>
        )}
        {view === "chat" && (
          <button
            className="header-add"
            title={strings.sidebar.createRoom}
            aria-label={strings.sidebar.createRoom}
            onClick={() => onPrompt("channel")}
          >
            <PlusIcon size={17} />
          </button>
        )}
      </header>

      {view === "perfil" ? (
        <div className="sidebar-body">
          {/* Publishing is why this column exists, so it is the first thing you see
              here: primary action, full weight, at the top. The header `+` does
              the same and gets the same design, one action, one symbol, two
              doors. Editing the profile stays where it was, in ghost: that is
              what you do occasionally, not what you come here to do. */}
          <Button variant="primary" className="wide sidebar-primary" onClick={onCompose}>
            <PlusIcon size={17} />
            {strings.sidebar.newPost}
          </Button>
          <Button variant="ghost" className="wide" onClick={onEditProfile}>
            {strings.sidebar.editProfile}
          </Button>
        </div>
      ) : view === "config" ? (
        /**
         * The settings sections live HERE, not inside the panel.
         *
         * The panel had its own menu in its own column, and this column
         * ended up with the "Settings" header and an empty body next to it:
         * two columns for the same thing, one with nothing. This is the column
         * the app already has for navigation, and this is where you navigate.
         *
         * Buttons and not ARIA separators: each section replaces the entire
         * panel, and what this really is is navigation within a screen.
         */
        <div className="sidebar-body">
          <nav className="settings-nav" aria-label={strings.sidebar.headerSettings}>
            {seccoes().map((entrada) => (
              <button
                key={entrada.id}
                type="button"
                className={entrada.id === seccaoConfig ? "settings-nav-item on" : "settings-nav-item"}
                aria-current={entrada.id === seccaoConfig ? "page" : undefined}
                onClick={() => onSeccaoConfig?.(entrada.id)}
              >
                {entrada.label}
              </button>
            ))}
          </nav>
        </div>
      ) : view === "chat" ? (
        <div className="sidebar-body">
          <ul className="channel-list">
            {rooms.map((channel) => {
              const nome = labelFor(channel)
              const ehOficial = oficialFor?.(channel) ?? false
              // Everyone there WITHOUT counting us. With us inside, the map may or may
              // not return our address (depends on whether our own announcement is sent
              // back to us), and that presence is already known from `callChannel`: we
              // remove it to avoid drawing ourselves twice. Outside the call we remove
              // nothing: our address there is another device of ours, and that really is
              // there.
              const dentro = callChannel === channel
              const emChamada = ringing.get(channel)
              const outrosEmChamada =
                (emChamada?.size ?? 0) - (dentro && address !== null && emChamada?.has(address) ? 1 : 0)
              const presence = presenceForChannel?.(channel) ?? null

              /*
                Everyone there, by name.

                The count was already on this line; the names only existed under
                the OPEN channel, so knowing who is in a call meant opening the
                channel first, and that was the owner's report on October 5,
                2026. They go into the voices label, which is both the `title`
                and the accessible name of the icon (see `components/Vozes.tsx`):
                what you see on hover and what you hear are the same information.

                Without us: our presence is already read from the clear banner,
                and `inside` says the rest. The `join(", ")` is the same as the
                call bar in `ChatScreen`.
              */
              const quemEstaNaChamada =
                nameFor && emChamada
                  ? [...emChamada.keys()].filter((quem) => quem !== address).map(nameFor)
                  : []

              /*
                And where the conversation is happening.

                Only when there is ONE room with a call: with two, "the room"
                does not exist and picking one would be picking by whoever reads.
                See `salaUnicaDaChamadaDe`.
              */
              const salaDaChamada = salaDaChamadaEm?.(channel) ?? null

              /*
                The rooms of the open channel, right below it.

                Only from the open channel: showing rooms from all channels at
                the same time would give a list no one reads. And only when there
                is more than the default room, a channel with one conversation
                keeps looking like what it always was, with no headers announcing
                structure that does not exist. (The default room is the one with
                an empty identifier, which `useRooms` always injects; without this
                condition, every open channel would gain a one-line tree just
                saying "general".)
              */
              const grupos = channel === active ? (roomGroups ?? []) : []
              /*
                There is a tree when there is more than the default room, OR when
                there is a declared category, even if empty.

                The second half is new and is what makes "create category" have
                visible effect in a brand new channel: without it the category
                existed, no one saw it, and there was nowhere to drop rooms. A
                target you cannot see is not a target.

                The rule moved house to `arvoreDeSalas.ts` because it is no longer
                just for this list: it decides, on a phone, whether the drawer
                leaves the screen on channel tap. Written twice, it would diverge
                silently.
              */
              const temArvore = temArvoreDeSalas(grupos)
              const arvoreAberta = !isCollapsed(chave.canal(channel))
              /*
                The count on the channel line is the sum of its rooms. In the open
                channel with the tree in view, each room states its own, and the
                sum on the line above would be the same number stated twice;
                collapsed, the tree hides the rooms and the line states it for
                them.
                */
              const porLer = channel === active && temArvore && arvoreAberta ? 0 : (unreads.get(channel) ?? 0)

              return (
                <li key={channel}>
                  <div
                    className={[
                      "channel-row",
                      channel === active ? "current" : "",
                      porLer > 0 ? "unread" : "",
                      silenciado?.(channel) ? "silenciado" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      onSelectChannel(channel)
                      onChannelMenu(channel, { x: event.clientX, y: event.clientY })
                    }}
                    {...aoDedo((ponto) => {
                      onSelectChannel(channel)
                      onChannelMenu(channel, ponto)
                    })}
                  >
                    {/*
                      Tapping the channel goes to the room where the call is,
                      when there is only one.
                      
                      The room tree opens by default, so most of the time this does
                      nothing, and that is how it has to be. The case it serves is
                      someone who collapsed this channel's tree: without this, the
                      line said "3 people in call" and the click led to a channel
                      where that room was hidden.
                      
                      `show` and not `toggleCollapsed`: opening is idempotent,
                      toggling would close the tree for someone who had it open.
                      
                      **And does not enter the call**, on purpose. Entering a voice
                      room is entering its call (see `abrirSala`, in `App.tsx`), and
                      a click on a channel name cannot make anyone speak without
                      asking. What this does is put the room on screen and who is
                      there, which is exactly what was missing for someone who wants
                      to know before entering.
                      */}
                    <button
                      className="channel"
                      onClick={() => {
                        onSelectChannel(channel)
                        if (salaDaChamada !== null) mostrar(chave.canal(channel))
                      }}
                    >
                      {/* The channel badge and, stuck to it, the status of the other end in a
                          direct conversation: the dot belongs to the person, not
                          to the line end, where it would sit against the unread
                          counts saying something else. */}
                      <span className="channel-mark">
                        <RoomIcon
                          channel={channel}
                          label={nome}
                          size={22}
                          icon={iconFor?.(channel)}
                          round={isDirect(channel)}
                          official={ehOficial}
                        />
                        {presence && (
                          <span
                            className={presence === "active" ? "dot online" : presence === "busy" ? "dot busy" : "dot"}
                            role="img"
                            aria-label={presence === "active" ? strings.people.presence : strings.people.presenceIdle}
                            title={presenceHint ?? strings.people.presenceTitle}
                          />
                        )}
                      </span>
                      {/*
                        The name and the badge, in one group.

                        It is the group that stretches to the line end, as the
                        name used to stretch before, and that is what keeps the
                        call label and unread counts stuck to the right. But inside
                        it the name no longer stretches: it stops where the word
                        ends, and the badge sticks to the text instead of going to
                        the line end. With "Orwell" the space was 95px on a wide
                        screen and 139px in a 280-wide drawer, the badge looked
                        like it belonged elsewhere, and the margin CSS tightens
                        never was the problem.

                        The name still truncates with ellipsis: what we removed was
                        the GROW, not the shrink (see `.channel-name` and
                        `.channel-label` in the styles). The title returns it full
                        without opening the channel.
                      */}
                      <span className="channel-label">
                        <span className="channel-name" title={nome}>
                          {nome}
                        </span>
                        {ehOficial && <SeloOficial />}
                        {silenciado?.(channel) && <MarcaDeSilencio />}
                      </span>
                      {/* Who is speaking there, drawn: one bar per person, and ours is clear.
                          It was a pill with text ("in call") or a bare number,
                          same as the unread counts next to it. See `components/Vozes.tsx`. */}
                      {(dentro || outrosEmChamada > 0) && (
                        <Vozes
                          outros={outrosEmChamada}
                          eu={dentro}
                          rotulo={(() => {
                            const frase = dentro
                              ? strings.sidebar.inCallWith(outrosEmChamada)
                              : isDirect(channel)
                                ? strings.sidebar.callingYou(nome)
                                : strings.sidebar.callPeople(outrosEmChamada)
                            // In a direct conversation the phrase already has the person's name, and
                            // is the only one there: adding it would say it twice.
                            if (quemEstaNaChamada.length === 0 || isDirect(channel)) return frase
                            return strings.sidebar.callWho(frase, quemEstaNaChamada.join(", "))
                          })()}
                        />
                      )}
                      {porLer > 0 && (
                        <span className="badge" aria-label={strings.sidebar.unreadCount(porLer)}>
                          {porLer > 99 ? "99+" : porLer}
                        </span>
                      )}
                    </button>
                    {temArvore && (
                      <FoldButton
                        open={arvoreAberta}
                        label={arvoreAberta ? strings.sidebar.collapse(nome) : strings.sidebar.expand(nome)}
                        onToggle={() => toggleCollapsed(chave.canal(channel))}
                      />
                    )}
                  </div>

                  {temArvore && arvoreAberta && (
                    <div className="room-tree">
                      {grupos.map((grupo) => {
                        const categoriaAberta = !isCollapsed(chave.categoria(channel, grupo.category))
                        /*
                          The header receives two drags with different results, so
                          we decide by TYPE before deciding by place: a room goes
                          to the end of this category; a category lines up next to
                          this one.
                        */
                        const recebeSala = onReorderRoom !== undefined && arrasto?.tipo === "sala"
                        const recebeCategoria =
                          onReorderCategory !== undefined &&
                          arrasto?.tipo === "categoria" &&
                          arrasto.id !== grupo.category
                        /*
                          Which side the dragged category lands on. The rule comes
                          from the module that arranges, not a second copy of it:
                          the indicator must draw where it will actually land,
                          otherwise the mark lies about the result of the gesture.
                        */
                        const depois =
                          recebeCategoria &&
                          arrasto !== null &&
                          largaDepois(
                            grupos.map((outro) => outro.category),
                            arrasto.id,
                            grupo.category,
                          )
                        return (
                          <div className="room-group" key={grupo.category || "(sem categoria)"}>
                            {/* No category means no header, and no header means nowhere to collapse,
                                so those rooms always show. There is also nowhere
                                to drag them or drop anything: they are not in a
                                category, they are in no category, and they stay
                                at the head of the list where they always were. */}
                            {grupo.category && (
                              <h3
                                className={[
                                  "room-category",
                                  // Three marks for three results. Receiving a room lights up the header,
                                  // because it goes INSIDE this category; receiving a category draws a line,
                                  // above or below, because it sits NEXT TO. Mixing them would mix the
                                  // gestures.
                                  alvo === grupo.category && recebeSala ? "recebe" : "",
                                  alvo === grupo.category && recebeCategoria ? (depois ? "depois" : "antes") : "",
                                  arrasto?.tipo === "categoria" && arrasto.id === grupo.category ? "a-arrastar" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                onContextMenu={(event) => {
                                  if (!onCategoryMenu) return
                                  event.preventDefault()
                                  onCategoryMenu(grupo.category, { x: event.clientX, y: event.clientY })
                                }}
                                {...aoDedo(
                                  onCategoryMenu ? (ponto) => onCategoryMenu(grupo.category, ponto) : undefined,
                                )}
                                draggable={onReorderCategory !== undefined}
                                onDragStart={(event) => {
                                  if (onReorderCategory === undefined) return
                                  // The `setData` is what makes this a real drag for the browser; the state
                                  // is what says what is being dragged.
                                  event.dataTransfer?.setData("text/plain", grupo.category)
                                  setArrasto({ tipo: "categoria", id: grupo.category })
                                }}
                                onDragEnd={() => {
                                  setArrasto(null)
                                  setAlvo(null)
                                }}
                                {...(recebeSala || recebeCategoria
                                  ? {
                                      // The gesture words, where the gesture happens, and saying which side, which
                                      // is the half you would guess wrong.
                                      title: recebeCategoria
                                        ? depois
                                          ? strings.rooms.dropCategoryAfter(grupo.category)
                                          : strings.rooms.dropCategoryBefore(grupo.category)
                                        : // Dropping a room on the header puts it at the end of that category, and
                                          // is the only way to put it in an empty category.
                                          strings.rooms.dropInCategory(grupo.category),
                                      // Without this the browser refuses the drop: the `dragover` default is
                                      // "nothing drops here".
                                      onDragOver: (event: React.DragEvent) => {
                                        event.preventDefault()
                                        setAlvo(grupo.category)
                                      },
                                      onDragLeave: () => setAlvo(null),
                                      onDrop: (event: React.DragEvent) => {
                                        event.preventDefault()
                                        const largado = arrasto
                                        setAlvo(null)
                                        setArrasto(null)
                                        if (!largado) return
                                        if (largado.tipo === "sala" && recebeSala) {
                                          onReorderRoom?.(largado.id, { categoria: grupo.category })
                                        }
                                        if (largado.tipo === "categoria" && recebeCategoria) {
                                          onReorderCategory?.(largado.id, grupo.category)
                                        }
                                      },
                                    }
                                  : onReorderCategory !== undefined
                                    ? { title: strings.rooms.dragCategory(grupo.category) }
                                    : {})}
                              >
                                <button
                                  className="category-toggle"
                                  aria-expanded={categoriaAberta}
                                  onClick={() => toggleCollapsed(chave.categoria(channel, grupo.category))}
                                >
                                  <ChevronIcon size={11} />
                                  <span className="category-name">{grupo.category}</span>
                                  {/* The lock on restricted categories. It sticks to the name and before the
                                      count: it is a property of the category,
                                      not a number about its rooms. */}
                                  {categoriaRestrita?.(grupo.category) && (
                                    <span
                                      className="category-lock"
                                      role="img"
                                      aria-label={strings.sidebar.categoryRestricted}
                                      title={strings.sidebar.categoryRestricted}
                                    >
                                      <LockIcon size={11} />
                                    </span>
                                  )}
                                  {!categoriaAberta && grupo.rooms.length > 0 && (
                                    <span
                                      className="room-count"
                                      role="img"
                                      aria-label={strings.sidebar.hiddenRooms(grupo.rooms.length)}
                                    >
                                      {grupo.rooms.length}
                                    </span>
                                  )}
                                  {/* Collapsed, the category states unread as the hidden rooms would, summed. */}
                                  {!categoriaAberta &&
                                    (() => {
                                      const soma = grupo.rooms.reduce((total, sala) => total + (porLerNaSala?.(sala.room) ?? 0), 0)
                                      return soma > 0 ? (
                                        <span className="badge room-unread" aria-label={strings.sidebar.unreadCount(soma)}>
                                          {soma > 99 ? "99+" : soma}
                                        </span>
                                      ) : null
                                    })()}
                                </button>
                              </h3>
                            )}
                            {(categoriaAberta || !grupo.category) && (
                              <ul className="room-list">
                                {grupo.rooms.map((sala) => (
                                  <RoomRow
                                    key={sala.room}
                                    sala={sala}
                                    activa={sala.room === (activeRoom ?? "")}
                                    presentes={sala.kind === "voice" ? (voicePresence?.(sala.room) ?? []) : []}
                                    aberta={!isCollapsed(chave.voz(channel, sala.room))}
                                    onToggle={() => toggleCollapsed(chave.voz(channel, sala.room))}
                                    onOpen={() => onSelectRoom?.(sala.room)}
                                    onMenu={onRoomMenu}
                                    onPersonMenu={onVoiceMemberMenu}
                                    mayMove={mayMove}
                                    haOutraSalaDeVoz={
                                      grupos.flatMap((g) => g.rooms).filter((s) => s.kind === "voice").length > 1
                                    }
                                    onMovePerson={onMovePerson}
                                    onReorder={
                                      onReorderRoom
                                        ? (arrastado, destino) => onReorderRoom(arrastado, { antesDe: destino })
                                        : undefined
                                    }
                                    me={address}
                                    arrasto={arrasto}
                                    setArrasto={setArrasto}
                                    alvo={alvo}
                                    setAlvo={setAlvo}
                                    porLer={porLerNaSala?.(sala.room) ?? 0}
                                    silencio={
                                      silenciado?.(chaveDoSilencio(channel, sala.room))
                                        ? "propria"
                                        : silenciado?.(channel)
                                          ? "canal"
                                          : null
                                    }
                                  />
                                ))}
                              </ul>
                            )}
                          </div>
                        )
                      })}
                      {/*
                        The closed rooms, so there is somewhere to bring them back.
                        Closing hides, not deletes, what was said there is still
                        in the vault, and messages that keep arriving keep having a
                        place. Without this list, "hide" would mean "lose" from the
                        next restart on.
                      */}
                      {onReopenRoom && (closedRooms?.length ?? 0) > 0 && (
                        <div className="room-group">
                          <h3 className="room-category">
                            <button
                              className="category-toggle"
                              aria-expanded={!isCollapsed(chave.fechados(channel))}
                              onClick={() => toggleCollapsed(chave.fechados(channel))}
                            >
                              <ChevronIcon size={11} />
                              <span className="category-name">{strings.rooms.closedTitle}</span>
                              <span className="room-count">{closedRooms?.length}</span>
                            </button>
                          </h3>
                          {!isCollapsed(chave.fechados(channel)) && (
                            <ul className="room-list">
                              {closedRooms?.map((sala) => (
                                <li key={sala.room}>
                                  <div className="room-row">
                                    <button
                                      className="room room-closed"
                                      title={strings.rooms.reopenTitle(sala.name)}
                                      onClick={() => onReopenRoom(sala.room)}
                                    >
                                      <span className="room-glyph" aria-hidden="true">
                                        <RoomGlyph kind={sala.kind} layout={sala.layout} size={14} />
                                      </span>
                                      <span className="room-name">{sala.name}</span>
                                      <span className="room-reopen">{strings.rooms.reopen}</span>
                                    </button>
                                    {/* The default room closes but is not deleted: it is where messages without
                                        a room fall, and those from a deleted room.
                                        The real refusal is in the core, this just
                                        does not offer what will be refused. */}
                                    {onRemoveRoom && sala.room !== "" && (
                                      <button
                                        type="button"
                                        className="room-remove"
                                        title={strings.rooms.removeTitle(sala.name)}
                                        aria-label={strings.rooms.removeTitle(sala.name)}
                                        onClick={() => onRemoveRoom(sala.room)}
                                      >
                                        {strings.rooms.remove}
                                      </button>
                                    )}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                      {onNewRoom && (
                        <div className="room-row">
                          <button className="room room-new" onClick={onNewRoom}>
                            <span className="room-glyph" aria-hidden="true">
                              <PlusIcon size={13} />
                            </span>
                            <span className="room-name">{strings.sidebar.newRoom}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
            {/*
              "Awaiting entry": the request left and the channel has not arrived
              yet. No one enters a encrypted group alone, and who admits is a
              device of someone in the channel, which may be off. It was a toast
              and then nothing; now it stays here until Welcome arrives, and
              then the line gives way to the channel.
            */}
            {aEsperaDeEntrada.map((espera) => (
              <li key={`espera:${espera.canal}`}>
                <div className="channel-row a-espera">
                  <span className="channel a-espera-corpo">
                    <span className="channel-mark" aria-hidden="true">
                      <RoomIcon channel={espera.canal} label={espera.nome} size={22} />
                    </span>
                    <span className="a-espera-texto">
                      <span className="channel-name">{espera.nome}</span>
                      <span className="a-espera-nota">{espera.nota ?? strings.sidebar.aEsperaDeEntrada}</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    className="a-espera-cancelar"
                    aria-label={
                      // No name (opaque address and no badge), the button states just the gesture.
                      espera.nome === strings.sidebar.canalDoConvite
                        ? strings.sidebar.cancelarEsperaSemNome
                        : strings.sidebar.cancelarEspera(espera.nome)
                    }
                    onClick={espera.onCancelar}
                  >
                    {strings.sidebar.cancelar}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <Button variant="ghost" className="wide join-link" onClick={() => onPrompt("link")}>
            {strings.sidebar.joinWithLink}
          </Button>
          {canalOficialPorEntrar && (
            <Button
              variant="ghost"
              className="wide join-link"
              disabled={canalOficialPorEntrar.aEntrar}
              onClick={canalOficialPorEntrar.onEntrar}
            >
              {canalOficialPorEntrar.aEntrar ? strings.sidebar.aEntrarNoCanalOficial : strings.sidebar.entrarNoCanalOficial}
            </Button>
          )}
          {rooms.length === 0 && aEsperaDeEntrada.length === 0 && (
            <p className="sidebar-note">
              {strings.sidebar.noRoomsBefore}
              <strong>+</strong>
              {strings.sidebar.noRoomsAfter}
            </p>
          )}
        </div>
      ) : (
        <div className="sidebar-body">
          <Button variant="ghost" className="wide" onClick={() => onPrompt("amigo")}>
            <PersonAddIcon size={16} />
            {strings.sidebar.addFriend}
          </Button>
        </div>
      )}

      {/* The foot of the column (account, call, microphone, speaker, bell, settings)
          lives in `CartaoDaConta`, the control panel: the Friends conversation
          column draws the same panel from when this bar stopped existing there,
          and two copies diverge at the first fix. */}
      <CartaoDaConta
        profile={profile}
        address={address}
        activity={activity}
        ligacao={connection}
        onActivityMenu={onActivityMenu}
        onEditProfile={onEditProfile}
        onNotifications={onNotifications}
        unreadNotifications={unreadNotifications}
        avisaDeNotificacao={avisaDeNotificacao}
        micMuted={micMuted}
        soundOff={soundOff}
        onToggleMic={onToggleMic}
        onToggleSound={onToggleSound}
        onMicMenu={onMicMenu}
        onSoundMenu={onSoundMenu}
        onAbrirDefinicoes={onAbrirDefinicoes}
        latencia={latencia}
        onLatenciaHover={onLatenciaHover}
        onSaveStatus={onSaveStatus}
        pedidoDeEstado={pedidoDeEstado}
        chamada={chamada}
      />
    </aside>
  )
}

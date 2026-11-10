import type { Profile } from "../../bridge.js"
import { MarcaDeSilencio } from "../../components/MarcaDeSilencio.js"
import { Avatar } from "../../components/Avatar.js"
import { CloseIcon } from "../../icons.js"
import type { DirectEntry } from "../../lib/directs.js"
import { useToqueLongo } from "../../hooks/useToqueLongo.js"
import { BotaoMais } from "../../components/BotaoMais.js"
import { strings } from "../../strings.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"

/**
 * The Friends column: open direct chats, and nothing else.
 *
 * The destination next to spaces, not inside them. Direct chats lived mixed
 * with channels in the sidebar, putting two different things in one list.
 * A channel is a group with rooms, categories, and roles; a direct chat is a
 * person. Here they sit next to where friendships are already managed, which
 * is where someone will look for them.
 *
 * **Chats only.** The tabs used to be here and moved to the top band with the
 * requests: a column that is both list and menu must choose what it is, and
 * what we ask of this one is that it reads at a glance so you can jump from
 * chat to chat. See `FriendsBar`.
 *
 * The column stays up while the chat is open next to it: switching chats is
 * one click, not a trip. That's the difference between a list and a menu.
 *
 * **It's the sidebar for this destination, not a list next to another one.**
 * Friends had two columns on the left, and the first was empty: a header
 * repeating the word the band already said, and a body with nothing in it.
 * It's gone, and what it held at the bottom came here: the account card comes
 * in through `footer`.
 */
export function FriendsAside({
  directs,
  active,
  unreads,
  directory,
  nameFor,
  presenceFor,
  presenceHint,
  emChamada,
  aberta = false,
  onOpen,
  onClose,
  onConversaMenu,
  rodape,
  silenciado,
}: {
  directs: DirectEntry[]
  /** The chat open in the panel next to it, if any. */
  active: string | null
  /**
   * Unread, per chat.
   *
   * The same map that fed the sidebar, not a new count: pulling direct chats
   * out of the channels list cannot take their counter away, and two counts of
   * the same thing always diverge.
   */
  unreads: Map<string, number>
  directory: Map<string, Profile>
  nameFor: (address: string) => string
  presenceFor?: ((address: string) => "active" | "away" | "busy" | "idle") | undefined
  presenceHint?: string | undefined
  /**
   * Who is in a voice room or call, to make the face ring pulse.
   *
   * A function, like `presenceFor`: the call layer and room map know this, and
   * they live in `App`. Absent means nobody in a call, the ring stays still,
   * which is the reading that commits to nothing.
   */
  emChamada?: ((address: string) => boolean) | undefined
  /**
   * The drawer is open. Only counts on narrow screens, where this column doesn't
   * fit next to the body and slides over it instead: the same behavior the
   * channels bar and members panel already have, for the same reason.
   */
  aberta?: boolean | undefined
  onOpen: (channel: string) => void
  /** Closing removes the row from the list. It deletes nothing. See `lib/directs.ts`. */
  onClose: (channel: string) => void
  /** Right click on a chat. See `itensDaConversa`. */
  onConversaMenu?: ((channel: string, at: { x: number; y: number }) => void) | undefined
  /**
   * The footer of the column: the account card, sound, identity, bell, copy, status.
   *
   * Passed in as a node, not as a dozen props. This column lists chats and
   * doesn't need to know what an unread notification is or what a muted mic is;
   * `App` knows that and mounts it once for the channels bar. Same trick as
   * `children` on `PeopleDestination`, for the same reason.
   *
   * Absent means no footer at all, and the list fills the whole column.
   */
  rodape?: React.ReactNode | undefined
  /**
   * Is this chat muted? The number already comes with mute applied; this fades
   * the name and puts a crossed-out bell. See `lib/silenciados.ts`.
   */
  silenciado?: ((channel: string) => boolean) | undefined
}): React.JSX.Element {
  return (
    <aside className={aberta ? "people-aside open" : "people-aside"} aria-label={strings.people.asideLabel}>
      <div className="people-directs">
        <h2 className="people-directs-title">{strings.people.directsTitle}</h2>
        {directs.length === 0 ? (
          <p className="people-directs-empty">{strings.people.directsEmpty}</p>
        ) : (
          <ul className="direct-list">
            {directs.map((entrada) => (
              <DirectRow
                key={entrada.channel}
                entrada={entrada}
                activa={entrada.channel === active}
                porLer={unreads.get(entrada.channel) ?? 0}
                silenciada={silenciado?.(entrada.channel) ?? false}
                directory={directory}
                nameFor={nameFor}
                presenceFor={presenceFor}
                presenceHint={presenceHint}
                emChamada={emChamada}
                onOpen={onOpen}
                onClose={onClose}
                onConversaMenu={onConversaMenu}
              />
            ))}
          </ul>
        )}
      </div>
      {rodape}
    </aside>
  )
}

/**
 * A chat in the list: avatar, name, the start of what was said, and unread count.
 *
 * The close button shows on hover and never hides the unread counter. The only
 * thing the row has to tell you from a distance is that something is waiting
 * there, and it cannot be hidden by the button that makes it go away.
 *
 * Keyboard users, or those who don't use a mouse, have no hover: the close
 * button is always reachable by tab, and right-click menu is the second door
 * to the same action and the other three.
 */
function DirectRow({
  entrada,
  activa,
  porLer,
  silenciada,
  directory,
  nameFor,
  presenceFor,
  presenceHint,
  emChamada,
  onOpen,
  onClose,
  onConversaMenu,
}: {
  entrada: DirectEntry
  activa: boolean
  porLer: number
  silenciada: boolean
  directory: Map<string, Profile>
  nameFor: (address: string) => string
  presenceFor?: ((address: string) => "active" | "away" | "busy" | "idle") | undefined
  presenceHint?: string | undefined
  /**
   * Who is in a voice room or call, to make the face ring pulse.
   *
   * A function, like `presenceFor`: the call layer and room map know this, and
   * they live in `App`. Absent means nobody in a call, the ring stays still,
   * which is the reading that commits to nothing.
   */
  emChamada?: ((address: string) => boolean) | undefined
  onOpen: (channel: string) => void
  onClose: (channel: string) => void
  onConversaMenu?: ((channel: string, at: { x: number; y: number }) => void) | undefined
}): React.JSX.Element {
  /* The same menu, with the finger down. See `useToqueLongo`. */
  const aoDedo = useToqueLongo()
  const quem = entrada.peer
  const nome = quem ? nameFor(quem) : strings.profile.noName
  const perfil = quem ? directory.get(quem) : undefined

  /*
    The menu goes on the `li`, not the open button.
    
    The row has two buttons, and the close button occupies the corner where
    the hand hits with the right button. Listening only on the open button,
    right click on the close button fell into the browser menu. The app menu
    appeared almost everywhere on the row and was missing exactly where the
    cursor was.
    */
  const menu = (event: React.MouseEvent): void => {
    if (!onConversaMenu) return
    event.preventDefault()
    onConversaMenu(entrada.channel, { x: event.clientX, y: event.clientY })
  }

  /* Unread reads first: the name comes in full, like in the channels list.
     With a dozen chats this is what saves you hunting for the account on the right. */
  const classes = ["direct-row", activa ? "active" : "", porLer > 0 ? "unread" : "", silenciada ? "silenciado" : ""]
    .filter(Boolean)
    .join(" ")

  return (
    <li
      className={classes}
      onContextMenu={menu}
      {...aoDedo(onConversaMenu ? (ponto) => onConversaMenu(entrada.channel, ponto) : undefined)}
    >
      <button
        type="button"
        className="direct-open"
        aria-current={activa ? "page" : undefined}
        onClick={() => onOpen(entrada.channel)}
      >
        <Avatar
          profile={perfil}
          fallback={nome[0] ?? "?"}
          presence={quem ? presenceFor?.(quem) : undefined}
          presenceTitle={presenceHint}
          emChamada={quem ? emChamada?.(quem) : false}
        />
        <span className="direct-labels">
          <span className="direct-name">
            <NomeDePessoa nome={nome} endereco={quem} />
            {silenciada && <MarcaDeSilencio />}
          </span>
          {/* A friend request has no body, it's an action, not a sentence, and
              the label takes the place of the preview it doesn't have. */}
          {entrada.pedido ? (
            <span className="direct-preview">
              {entrada.minha && <span className="direct-mine">{strings.people.directMine}</span>}
              {strings.people.directFriendRequest}
            </span>
          ) : (
            entrada.preview && (
              <span className="direct-preview">
                {entrada.minha && <span className="direct-mine">{strings.people.directMine}</span>}
                {entrada.preview}
              </span>
            )
          )}
        </span>
        {porLer > 0 && (
          <span className="direct-unread" aria-label={strings.people.directUnread(porLer)}>
            {porLer > 99 ? "99+" : porLer}
          </span>
        )}
      </button>
      {/* The visible "⋯", with the chat menu: the same as what right click opens
          here and in the channels bar. */}
      {onConversaMenu && (
        <BotaoMais label={strings.people.rowMore(nome)} onAbrir={(ponto) => onConversaMenu(entrada.channel, ponto)} />
      )}
      <button
        type="button"
        className="direct-close"
        title={strings.people.directClose}
        aria-label={`${strings.people.directClose} — ${nome}`}
        onClick={() => onClose(entrada.channel)}
      >
        <CloseIcon size={13} />
      </button>
    </li>
  )
}

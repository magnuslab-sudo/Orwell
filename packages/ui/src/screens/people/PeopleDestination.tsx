import { FriendsAside } from "./FriendsAside.js"
import { FriendsBar, type PeopleTab } from "./FriendsBar.js"

/**
 * The Friends destination, assembled: the conversation column, the top bar, and the
 * body.
 *
 * ```
 * ┌──────────┬────────────────────────────────┐
 * │ conversas│ faixa: Amigos · separadores    │
 * │  · Ana   ├────────────────────────────────┤
 * │  · Bruno │ a conversa aberta,             │
 * │  · Célia │ ou a lista de amigos           │
 * ├──────────┤                                │
 * │ a conta  │                                │
 * └──────────┴────────────────────────────────┘
 * ```
 *
 * **Two columns, not three.** There was a sidebar on the left of this one, with the
 * header saying "Friends", the word the bar already says, and an empty body:
 * 236px of framing before reaching conversations, 460 ao total. It left this
 * destination (it still serves the others, where it lists channels), and the account card
 * it held at the bottom moved to the foot of this column. Without it, Friends was the
 * only place in the app without a bell or "how you appear".
 *
 * **The conversation is what occupies the center**, because it is what you are doing. Requests
 * and management live in the bar, which stays on screen with the conversation open.
 *
 * The body comes in as `children` and not as decoration, and that is the reason this
 * file exists: the entire conversation screen passes through it, with its timeline,
 * the input box and attachments, which are from another team and do not need to
 * know they are inside Friends. The alternative was this composition scattered
 * through `App.tsx`, alongside everything else.
 *
 * **On a narrow screen the column becomes a drawer**, with a curtain behind it, like
 * the channel bar and the members panel already do. Three panels with the same
 * behavior and appearance; the alternative was a fourth pattern just for
 * this place.
 */
export function PeopleDestination({
  tab,
  onTab,
  pending,
  amigos,
  aside,
  conversaAberta,
  listaAberta,
  onOpenLista,
  onCloseLista,
  children,
}: {
  tab: PeopleTab
  onTab: (tab: PeopleTab) => void
  pending: number
  /** How many friends there are, for the banner title. */
  amigos?: number | undefined
  /** Everything the column needs to know, `footer` included. See `FriendsAside`. */
  aside: React.ComponentProps<typeof FriendsAside>
  /**
   * There is a conversation in front.
   *
   * It only serves CSS: on a narrow screen, the list and the conversation do not
   * fit side by side. We need to tell the stylesheet which one is in front. An
   * attribute on the element instead of two different trees. The conversation
   * cannot be taken apart and put back together because the window changed size.
   */
  conversaAberta: boolean
  /** The drawer for conversations is open. Does not count on a wide screen. */
  listaAberta: boolean
  onOpenLista: () => void
  onCloseLista: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="people-destination" data-conversa={conversaAberta ? "aberta" : "fechada"}>
      <FriendsAside
        {...aside}
        aberta={listaAberta}
        onOpen={(channel) => {
          aside.onOpen(channel)
          // Picking a conversation is what the drawer is for; it closes with the
          // choice, like the channel bar.
          onCloseLista()
        }}
      />

      {/* The veil, only while the drawer is open. CSS hides it on a wide screen:
          the column is not on top of anything, and there is nothing to go back to. */}
      {listaAberta && <div className="people-scrim" onClick={onCloseLista} />}

      <div className="people-column">
        <FriendsBar
          tab={tab}
          onTab={(nome) => {
            onTab(nome)
            // Switching tabs means requesting the body to show something else. With the
            // drawer open on top, the request would happen behind an opaque panel.
            onCloseLista()
          }}
          pending={pending}
          amigos={amigos}
          // The same flag that `data-conversa` above carries to CSS: whoever is in
          // front decides what the stylesheet shows AND which tab can be active.
          // Without this the banner never knew about the conversation and kept
          // pointing to a body that was no longer hers.
          conversaAberta={conversaAberta}
          temConversas={aside.directs.length > 0}
          onOpenConversas={onOpenLista}
        />
        {children}
      </div>
    </div>
  )
}

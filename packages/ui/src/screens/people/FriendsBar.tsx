import { ChatIcon, LockIcon } from "../../icons.js"
import { strings } from "../../strings.js"

/** The Friends tabs. What the band picks, the body shows. */
export type PeopleTab = "amigos" | "recebidos" | "enviados" | "encontrar"

/**
 * The Facebook order: who's already a friend, what they asked you, what you
 * asked them, and how to find someone. No account search: "Find" is your link
 * and your QR, and someone else's link pasted in.
 */
export const PEOPLE_TABS: PeopleTab[] = ["amigos", "recebidos", "enviados", "encontrar"]

/**
 * The Friends top band: the tabs, the requests, and what the destination says
 * about itself.
 *
 * **This is where you manage, not the body.** Unanswered requests sat in the
 * middle of the screen, pushing the friends list down and, after chats arrived
 * here, the chat itself. They were in the way of everything else. They now live
 * in this band: the counter shows how many are waiting, the tab brings them to
 * the front, and the body stays for what you're doing.
 *
 * Nothing was lost by moving it out. An unanswered request is the only thing
 * on this destination that loses value by not being seen today, and it keeps
 * announcing itself in three places: the counter here, the bell, and system
 * notifications.
 *
 * **The band doesn't disappear when a chat is open**, unlike a friends page
 * that swaps for a chat page. It's the same choice as the call panel: the call
 * bar stays up while you read what's being said, because leaving it to answer
 * a request and coming back is a trip nobody asked for.
 */
export function FriendsBar({
  tab,
  onTab,
  pending,
  amigos,
  conversaAberta = false,
  temConversas,
  onOpenConversas,
}: {
  tab: PeopleTab
  onTab: (tab: PeopleTab) => void
  /**
   * There's a chat in front, so the body is not showing any tab.
   *
   * None stays active while that lasts. Active, the tab said the body showed
   * "Add" while it was showing a chat, caught live. It's the kind of small lie
   * that makes an interface feel broken without knowing where to point.
   */
  conversaAberta?: boolean | undefined
  /** How many requests are waiting for an answer. Zero draws no counter. */
  pending: number
  /** How many friends there are, for the title. Absent, the title has no number. */
  amigos?: number | undefined
  /**
   * There are chats in the column next to it.
   *
   * Only serves the button that opens the drawer on narrow screens: with no
   * chats, opening the drawer would show a message saying it's empty, and that's
   * a trip to read what would fit in one place.
   */
  temConversas: boolean
  /**
   * Open the chat list.
   *
   * Only exists where the column doesn't fit next to the body. On wide screens
   * the list is always in view and this button is hidden by CSS. No JavaScript
   * condition here, which would have to guess the width and guess wrong.
   */
  onOpenConversas: () => void
}): React.JSX.Element {
  return (
    <header className="people-bar">
      {/* The drawer handle comes first: on narrow screens this is how you get back to
          chats, and the first place is what the hand reaches. */}
      {temConversas && (
        <button
          type="button"
          className="people-bar-conversas"
          title={strings.people.backToList}
          aria-label={strings.people.backToList}
          onClick={onOpenConversas}
        >
          <ChatIcon size={16} />
        </button>
      )}

      <h1 className="people-bar-title">
        {amigos === undefined ? strings.people.title : strings.people.titleCount(amigos)}
      </h1>

      <nav className="people-tabs" aria-label={strings.people.tabsLabel}>
        {PEOPLE_TABS.map((nome) => (
          <button
            key={nome}
            type="button"
            // Active is a statement about the body: "this is what you're looking at".
            // With a chat in front, no tab can make that true. So the chat matters here
            // as much as the chosen tab; see `conversaAberta` above. The two props say
            // the same thing, one to the eyes and one to the screen reader, and they
            // change together.
            className={!conversaAberta && tab === nome ? "people-tab active" : "people-tab"}
            aria-current={!conversaAberta && tab === nome ? "page" : undefined}
            onClick={() => onTab(nome)}
          >
            {strings.people.tab[nome]}
            {/* The counter only exists when it counts something: a zero next to
                "Received" is noise taking up space where information should be.
                
                It's also what drives the whole change. Requests moved out of
                the body, and this number ensures no one needs to go look for them. */}
            {nome === "recebidos" && pending > 0 && (
              <span className="people-tab-count" aria-label={strings.people.pendingCount(pending)}>
                {pending > 99 ? "99+" : pending}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* That this list does not live on any server is information about the
          destination, and destination information is what a banner carries. */}
      <span className="sealed" title={strings.people.sealedTitle}>
        <LockIcon size={13} />
        {strings.people.sealed}
      </span>
    </header>
  )
}

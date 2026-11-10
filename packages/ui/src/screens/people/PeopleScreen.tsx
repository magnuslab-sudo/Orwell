import { useContext, useMemo, useState } from "react"
import { copiarTexto } from "../../lib/copiar.js"
import type { ConnectionState, Profile } from "../../bridge.js"
import { Andante } from "../../components/Andante.js"
import { Avatar } from "../../components/Avatar.js"
import { BotaoCopiarId } from "../../components/BotaoCopiarId.js"
import { BotaoMais } from "../../components/BotaoMais.js"
import { Button } from "../../components/Button.js"
import { ConnectionBanner } from "../../components/ConnectionBanner.js"
import { EmptyState } from "../../components/EmptyState.js"
import { LeitorQr } from "../../components/LeitorQr.js"
import { QrCode } from "../../components/QrCode.js"
import { useToast } from "../../components/Toast.js"
import { useToqueLongo } from "../../hooks/useToqueLongo.js"
import type { FriendTie } from "@enclave/protocol"
import { connectionLabel, formatRelative, formatStamp, nomeEmFalta, serverOf } from "../../lib/format.js"
import { enderecoColado } from "../../lib/friendship.js"
import { ligacaoCurtaDeAmigo } from "../../lib/ligacaoDeAmigo.js"
import type { PeopleTab } from "./FriendsBar.js"
import { BridgeContext } from "../../App.js"
import { strings } from "../../strings.js"
import { PedidoCard } from "../chat/PedidoCard.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"

/** One directory entry, flattened for rendering and filtering. */
export interface Person {
  address: string
  profile: Profile
}

/**
 * The people the vault knows, as a filterable list. Pure, so tests hold it
 * still: alphabetical by display name (pt collation), address as tiebreak,
 * and the query matches name, status or address, case-insensitively.
 */
export function filterPeople(
  directory: Map<string, Profile>,
  me: string | null,
  query: string,
  /** Blocked on this device: does not appear in any list. */
  bloqueados?: ReadonlySet<string>,
): Person[] {
  const q = query.trim().toLowerCase()
  return [...directory.entries()]
    .filter(([address]) => address !== me && !bloqueados?.has(address))
    .map(([address, profile]) => ({ address, profile }))
    .filter(
      ({ address, profile }) =>
        !q ||
        profile.displayName.toLowerCase().includes(q) ||
        (profile.statusText ?? "").toLowerCase().includes(q) ||
        address.toLowerCase().includes(q),
    )
    .sort(
      (a, b) =>
        a.profile.displayName.localeCompare(b.profile.displayName, "pt") ||
        a.address.localeCompare(b.address),
    )
}

/**
 * Everyone whose profile this device holds.
 *
 * There is nothing to browse beyond this and no way to search strangers: a
 * profile only exists here because its owner shared a room or a feed with
 * you and it arrived encrypted. The screen says so instead of pretending to
 * be a social graph.
 */
export function PeopleScreen({
  directory,
  me,
  connection,
  connectionDetail,
  requests = [],
  sent = [],
  bloqueados,
  presenceFor,
  presenceHint,
  emChamada,
  friends,
  busy = null,
  tab = "amigos",
  nameFor,
  onAcceptRequest,
  onDeclineRequest,
  onCancelRequest,
  onOpenProfile,
  onUserMenu,
}: {
  directory: Map<string, Profile>
  me: string | null
  connection: ConnectionState
  connectionDetail: string | null
  /**
   * Pending requests, folded by the shell from the events.
   *
   * There is no list here being maintained: a request is in this list while it
   * has no answer, and leaves it when the answer exists. It is the same list
   * that the notification center reads, and that is why accepting it in one
   * place makes it disappear from the other without anyone having programmed
   * that cleanup.
   */
  requests?: FriendTie[] | undefined
  /** Our pending requests (`sentRequestsOf`), for the Sent tab. */
  sent?: FriendTie[] | undefined
  /**
   * Blocked on this device. Does not appear in any tab: not with friends, not
   * with requests, not with sent.
   */
  bloqueados?: ReadonlySet<string> | undefined
  /** Presence per person, live or derived — the shell knows which. */
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
  /** The mutual circle: owners of feed channels this account can read. */
  friends?: ReadonlySet<string> | undefined
  /** Who has an answer in progress: that person's buttons stay still. */
  busy?: string | null | undefined
  /**
   * The selected tab in the column next to this one.
   *
   * The choice lives up there in the wrapper, not here: the column has to draw
   * it highlighted at the same time this panel obeys it, and two states of the
   * same choice diverge at the first distraction.
   */
  tab?: PeopleTab | undefined
  nameFor?: ((sender: string) => string) | undefined
  /** Who: the channel resolves in `useAmizade`. */
  onAcceptRequest?: ((address: string) => void) | undefined
  onDeclineRequest?: ((address: string) => void) | undefined
  /** Remove one of our requests. Without it, Sent lists with no button. */
  onCancelRequest?: ((address: string) => void) | undefined
  /**
   * Open someone's profile from the list.
   *
   * The name is the most clickable thing in a person's row, and it opened
   * nothing: anyone who wanted to see a profile had to discover the right-click
   * menu. This is the left-click path, same as the one in the channel member
   * panel.
   */
  onOpenProfile?: ((address: string) => void) | undefined
  onUserMenu?: ((address: string, at: { x: number; y: number }) => void) | undefined
}): React.JSX.Element {
  /* The same menu, with the finger down. See `useToqueLongo`. */
  const aoDedo = useToqueLongo()
  const [query, setQuery] = useState("")

  const people = useMemo(() => filterPeople(directory, me, query, bloqueados), [directory, me, query, bloqueados])
  const recebidos = useMemo(() => requests.filter((tie) => !bloqueados?.has(tie.peer)), [requests, bloqueados])
  const enviados = useMemo(() => sent.filter((tie) => !bloqueados?.has(tie.peer)), [sent, bloqueados])
  /**
   * Friends only. Non-friends are not listed.
   *
   * There was a second section, "Other people", with everyone the vault knew
   * from sharing a room. It made sense when each person only met a handful of
   * others; it stops making sense when everyone on the server is in the same
   * room, because then "other people" is the entire server and the Friends
   * screen becomes a list of strangers with a wrong title.
   */
  const circle = people.filter(({ address }) => friends?.has(address))
  const known = directory.size - (me !== null && directory.has(me) ? 1 : 0)
  /**
   * Friends regardless of search.
   *
   * `circle` already comes filtered by what is written in the box, so it does
   * not work for deciding what to show when there is nothing: it does not tell
   * apart "you have no friends" from "no friend matches this search". The
   * distinction matters since there is a room where everyone on the server is,
   * which is when having the vault full of profiles and no friends became the
   * normal state of a new account.
   */
  const circleSize = [...directory.keys()].filter(
    (address) => address !== me && friends?.has(address) && !bloqueados?.has(address),
  ).length

  const renderPerson = ({ address, profile }: Person): React.JSX.Element => {
    /**
     * The name, by the same resolver as the rest of the app.
     *
     * This screen wrote the profile name and, if missing, the raw address, and
     * it was the only place that did. When someone's profile did not arrive, and
     * it will not arrive, because a name is something a member told a group and
     * not a record you consult, the entire app shows the first word of the
     * address (`shortAddress`), and this list showed
     * `@garbicis-xapsensis-giprete-birmyris:orwell.pt` in full, breaking the
     * line alignment. It was one of three owner reports about names.
     *
     * `nameFor` is optional because the component is tested without a wrapper.
     * The local resource has to be the SAME as the one from `useDirectory`, the
     * profile in hand, and `nomeEmFalta` (the first word of the address) when
     * there is no name, or there will be two resolvers again and one of them
     * will diverge again. It was "No name" from October 27 to November 4 2026.
     *
     * **`||` and not `??`, and the difference is a line with no name.** The `??`
     * only falls back to the resource when the resolver returns `undefined`; a
     * `nameFor` that returns an EMPTY string, and a name resolver can return
     * one, because a profile can carry a blank `displayName`, would pass the
     * empty to the screen and the line would have no name at all, with the avatar
     * and buttons pointing to nobody.
     */
    const nome = nameFor?.(address) || profile.displayName || nomeEmFalta(address)
    return (
    <li
      key={address}
      className="person-row"
      onContextMenu={(event) => {
        if (!onUserMenu) return
        event.preventDefault()
        onUserMenu(address, { x: event.clientX, y: event.clientY })
      }}
      {...aoDedo(onUserMenu ? (ponto) => onUserMenu(address, ponto) : undefined)}
    >
      <Avatar
        profile={profile}
        fallback={profile.displayName[0] ?? address[1] ?? "?"}
        presence={presenceFor?.(address)}
        presenceTitle={presenceHint}
        emChamada={emChamada?.(address)}
      />
      <div className="person-labels">
        {/* The name opens the profile. A `button` not an `a`: it opens the person's page
            inside the app, through their stack, not a new address. Without
            `onOpenProfile` it becomes text, because a name that looks clickable
            and opens nothing is worse than a name. */}
        {onOpenProfile ? (
          <button type="button" className="person-name person-name-link" onClick={() => onOpenProfile(address)}>
            <NomeDePessoa nome={nome} endereco={address} />
          </button>
        ) : (
          <span className="person-name">
            <NomeDePessoa nome={nome} endereco={address} />
          </span>
        )}
        {/* No plumbing on this screen. A line saying a friendship is "half
            made", or a button asking somebody to repair their own membership,
            is the app admitting it does not converge on its own — which is a
            defect to fix underneath, not a state to report upwards. The
            reconciliation runs on every connect and needs nobody's help. */}
        {/*
          The bottom line is ALWAYS the status, and empty when there is no status.
          
          The address left here on August 19 2026, by the owner's decision. It said
          nothing to anyone, `@garbicis-xapsensis-giprete-birmyris:orwell.pt`
          is long, ugly, and never what you search for in a contact list. It took
          the line that should say how the person is.
          
          Empty not absent: the `&nbsp;` keeps the line height, so a list with
          some contacts with status and others without does not stutter. It is
          still possible to search by address, the filter reads all three
          fields, and the button to copy the id, next to the name, gives it to
          anyone who needs it (the `title` with the address left on October 27
          2026).
          
          When it does not fit, it flows as a news footer (the `Andante`), instead
          of cutting with ellipsis (owner, October 28 2026).
          */}
        {profile.statusText ? (
          <Andante className="person-status" texto={profile.statusText} />
        ) : (
          <span className="person-status">{"\u00A0"}</span>
        )}
      </div>
      {/* The id does not show; it is copied here, next to the name, like in the member
          panel (owner's order on October 27 2026). */}
      <BotaoCopiarId id={address} rotulo={strings.copiarId.de(nome)} />
      {/* A row is the name and the "⋯", same as in the member panel: Message and Copy
          address were two buttons only in this list, and they are in the menu,
          following the app's order. */}
      {onUserMenu && <BotaoMais label={strings.people.rowMore(nome)} onAbrir={(ponto) => onUserMenu(address, ponto)} />}
    </li>
    )
  }

  /*
    No header of its own: the title, the badge and the tabs live in the top bar,
    which stays up when the chat is open and so cannot belong to this screen.
    `sem-cabecalho` closes the grid row the header took, leaving it open put
    46px of nothing between the bar and the list.
  */
  return (
    <main className="main sem-cabecalho">
      <ConnectionBanner state={connection} detail={connectionDetail} />

      <div className="people-scroll">
        {/* Received: the requests made to us, each one on the standard card. The counter
            in the bar says how many are waiting, even with a chat open, so they
            do not need to take up space in the body of others. */}
        {tab === "recebidos" &&
          (recebidos.length === 0 ? (
            // With nothing, it says so: a blank tab is indistinguishable from a bug.
            <EmptyState title={strings.people.noPendingTitle} body={strings.people.noPendingBody} />
          ) : (
            <section className="people-requests">
              <h2>{strings.people.requestsTitle}</h2>
              <ul className="people-list">
                {recebidos.map((request) => {
                  const nome = nameFor?.(request.peer) || directory.get(request.peer)?.displayName || nomeEmFalta(request.peer)
                  return (
                    <li key={`${request.channel}:${request.peer}`} className="person-row request">
                      {/* The same card as in the chat, the bell and the profile page: a label only,
                          and the same two buttons. While acceptance runs, both
                          stay out of reach. */}
                      <PedidoCard
                        className="pedido-em-lista"
                        cara={<Avatar profile={directory.get(request.peer)} fallback={request.peer[1] ?? "?"} />}
                        titulo={strings.people.wantsToBeFriends(nome)}
                        estado={request.note ?? strings.people.requestWaits}
                        aceitar={strings.people.accept}
                        aceitando={strings.people.accepting}
                        recusar={strings.people.decline}
                        /* The address left the text (owner's order on October 27 2026): copy it by
                           this button. */
                        detalhe={<BotaoCopiarId id={request.peer} rotulo={strings.copiarId.de(nome)} />}
                        ocupado={busy === request.peer}
                        onAceitar={() => onAcceptRequest?.(request.peer)}
                        {...(onDeclineRequest ? { onRecusar: () => onDeclineRequest(request.peer) } : {})}
                      />
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}

        {/* Sent: our pending requests, with the date and "Cancel". A rejected request
            is not here: it is in Received, because what closes it is accepting.
            See `sentRequestsOf`. */}
        {tab === "enviados" &&
          (enviados.length === 0 ? (
            <EmptyState title={strings.people.sentEmptyTitle} body={strings.people.sentEmptyBody} />
          ) : (
            <section className="people-section">
              <h2>{strings.people.sentTitle}</h2>
              <ul className="people-list">
                {enviados.map((pedido) => {
                  const nome = nameFor?.(pedido.peer) || directory.get(pedido.peer)?.displayName || nomeEmFalta(pedido.peer)
                  return (
                    <li key={`${pedido.channel}:${pedido.peer}`} className="person-row">
                      <Avatar profile={directory.get(pedido.peer)} fallback={pedido.peer[1] ?? "?"} />
                      <div className="person-labels">
                        {onOpenProfile ? (
                          <button
                            type="button"
                            className="person-name person-name-link"
                            onClick={() => onOpenProfile(pedido.peer)}
                          >
                            <NomeDePessoa nome={nome} endereco={pedido.peer} />
                          </button>
                        ) : (
                          <span className="person-name">
                            <NomeDePessoa nome={nome} endereco={pedido.peer} />
                          </span>
                        )}
                        <span className="person-status">
                          <time title={formatStamp(pedido.at)}>{strings.people.sentAt(formatRelative(pedido.at))}</time>
                        </span>
                      </div>
                      {onCancelRequest && (
                        <Button variant="ghost" disabled={busy === pedido.peer} onClick={() => onCancelRequest(pedido.peer)}>
                          {strings.people.cancelRequest}
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}

        {tab === "encontrar" && (
          <Encontrar me={me} {...(onOpenProfile ? { onAbrir: onOpenProfile } : {})} />
        )}

        {tab === "amigos" && (
          <>
            {/* The search box goes with what there is to search for: this screen lists
                friends, so it is the number of friends that justifies it. Linked
                to `known`, it appeared above a screen with not a single row. */}
            {circleSize > 0 && (
              <input
                className="people-search"
                type="search"
                value={query}
                placeholder={strings.people.searchPlaceholder}
                onChange={(event) => setQuery(event.target.value)}
              />
            )}

            {known === 0 ? (
              <EmptyState title={strings.people.emptyTitle} body={strings.people.emptyBody} />
            ) : circleSize === 0 ? (
              <EmptyState title={strings.people.noFriendsTitle} body={strings.people.noFriendsBody(known)} />
            ) : circle.length === 0 ? (
              // A search with no results is an ANSWER, not the emptiness that fills with an
              // invite. The way out is to undo the search, which is the gesture the person
              // would make next anyway.
              <EmptyState
                title={strings.people.noMatch(query.trim())}
                body={strings.people.noMatchBody(circleSize)}
                action={{ label: strings.people.noMatchAction, onClick: () => setQuery("") }}
              />
            ) : (
              <section className="people-section">
                <h2>{strings.people.friendsTitle}</h2>
                <ul className="people-list">{circle.map(renderPerson)}</ul>
              </section>
            )}
          </>
        )}
      </div>

      <footer className="statusbar">{connectionLabel(connection)}</footer>
    </main>
  )
}

/**
 * The "Find" tab: how to reach someone without account search.
 *
 * My QR code and my friendship link, to show or send, and the field where you
 * paste the other person's link (or address). The link carries the address in
 * the fragment, which never reaches any server. Paste or scan a QR opens that
 * person's profile page, where the "Request friendship" button is.
 */
export function Encontrar({
  me,
  onAbrir,
}: {
  me: string | null
  /** Open the profile page for the scanned address. */
  onAbrir?: ((address: string) => void) | undefined
}): React.JSX.Element {
  const toast = useToast()
  const [colado, setColado] = useState("")
  const [erro, setErro] = useState(false)
  const [aLer, setALer] = useState(false)
  // The short form for 1.0 (`/a#<id>`) in the field, in "Copy" and in the QR
  // code: a smaller QR code scans better, and a link that fits in one line can
  // be checked by eye.
  const link = me ? ligacaoCurtaDeAmigo(serverOf(me), me) : null
  /*
    In the installed app there is no camera outside a call, and the reader would
    only say there is no camera: the paste field stays. `actualizacao` only
    exists on that host (see `InviteSheet`). Read without `useBridge`, which
    throws off a provider: this screen also mounts on its own.
  */
  const naAplicacaoInstalada = useContext(BridgeContext)?.actualizacao !== undefined

  const abrir = (texto: string): boolean => {
    const endereco = enderecoColado(texto)
    if (!endereco) {
      setErro(true)
      return false
    }
    setErro(false)
    setColado("")
    onAbrir?.(endereco)
    return true
  }

  const copiar = (): void => {
    if (!link) return
    void copiarTexto(link)
      .then(() => toast(strings.people.linkCopied))
      .catch(() => toast(strings.common.copyFailed, "error"))
  }

  return (
    <section className="people-find">
      <h2>{strings.people.findTitle}</h2>
      <p className="field-note">{strings.people.findBody}</p>

      {link && (
        <div className="people-find-meu">
          <QrCode texto={link} alt={strings.people.myQrAlt} size={168} />
          <div className="people-find-link">
            <label className="field-note" htmlFor="people-find-meu-link">
              {strings.people.myLink}
            </label>
            <input id="people-find-meu-link" readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
            <Button variant="ghost" type="button" onClick={copiar}>
              {strings.people.copyLink}
            </Button>
          </div>
        </div>
      )}

      <form
        className="people-find-colar"
        onSubmit={(event) => {
          event.preventDefault()
          abrir(colado)
        }}
      >
        <label className="field-note" htmlFor="people-find-colar">
          {strings.people.pasteLabel}
        </label>
        <input
          id="people-find-colar"
          value={colado}
          autoComplete="off"
          spellCheck={false}
          placeholder={strings.people.pastePlaceholder}
          aria-invalid={erro || undefined}
          onChange={(event) => {
            setColado(event.target.value)
            setErro(false)
          }}
        />
        {erro && (
          <p className="field-note warn" role="alert">
            {strings.people.pasteInvalid}
          </p>
        )}
        <div className="people-find-accoes">
          <Button variant="primary" type="submit" disabled={!colado.trim()}>
            {strings.people.pasteOpen}
          </Button>
          {!aLer && !naAplicacaoInstalada && (
            <Button variant="ghost" type="button" onClick={() => setALer(true)}>
              {strings.people.scanQr}
            </Button>
          )}
        </div>
      </form>

      {/* The reader only exists while you read: the camera turns off when you leave. */}
      {aLer && (
        <LeitorQr
          aLer={strings.people.scanning}
          /* Once a QR is read, the camera always stops: a QR that is not a friendship
             link says so in the field, and does not leave the camera stuck
             waiting for another. */
          onLido={(texto) => {
            abrir(texto)
            setALer(false)
          }}
          onCancelar={() => setALer(false)}
        />
      )}
    </section>
  )
}

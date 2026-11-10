import { useEffect, useId, useRef, useState } from "react"
import type { ConnectionState, Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import type { EstadoDaAmizade } from "../../hooks/useAmizade.js"
import { BotaoMais } from "../../components/BotaoMais.js"
import { Button } from "../../components/Button.js"
import { ConnectionBanner } from "../../components/ConnectionBanner.js"
import { BotaoCopiarId } from "../../components/BotaoCopiarId.js"
import { DistintivoDeEmbaixador } from "../../components/DistintivoDeEmbaixador.js"
import { EmptyState } from "../../components/EmptyState.js"
import { SetaParaTrasIcon } from "../../icons.js"
import { connectionLabel, formatStamp, nomeEmFalta } from "../../lib/format.js"
import { strings } from "../../strings.js"
import { PedidoCard } from "../chat/PedidoCard.js"
import { ContextMenu, type MenuItem } from "../overlays/ContextMenu.js"
import { PostDetail } from "../social/PostDetail.js"
import { MemberRoles } from "./MemberRoles.js"
import { PublicacoesDoPerfil } from "./ProfileBody.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"

type Separador = "publicacoes" | "amigos" | "comum"

/**
 * Someone else's profile page: who they are, what they posted, who shows them,
 * and what we have in common. It takes up the entire main area, as on Instagram
 * and Discord.
 *
 * **A page and not a sheet, by owner decision on 21 October 2026:** "each user's
 * profile should be a dedicated page." The sheet fit where we were reading, but
 * had no room for the wall, tabs, or history. The page has all three. The
 * previous place is not lost: the shell hides it underneath without taking it
 * apart, and the arrow, Escape, and the browser back button return it exactly
 * as it was. See `usePilhaDaPessoa`.
 *
 * **We show only what this device already has.** There is no request to the
 * server here, and there cannot be: asking it "who is this address" is exactly
 * the question this application exists so it does not know how to answer. The
 * name, image, and bio came encrypted over a shared channel; the posts came
 * from their feed, encrypted for those who already had a place in the circle.
 * When there is nothing, the page says so instead of appearing empty and
 * pretending the person has nothing.
 *
 * **None of this is editable.** The posts use the same layout as the own
 * profile (`PublicacoesDoPerfil`), and editing there enters through a slot
 * that this page does not have.
 *
 * **An open post is an entry on the stack**, like the page: the shell opens it
 * (`onAbrirPublicacao`), and going back closes it by the same path that closes
 * the page. So the browser button closes the post first.
 */
export function PersonProfile({
  address,
  name,
  profile,
  posts,
  messages,
  me,
  directory,
  nameFor,
  presenca,
  presenceHint,
  roles,
  onMessage,
  onCall,
  amizade,
  onInvite,
  menu,
  bloqueado = false,
  amigosMostrados,
  onOpenAmigo,
  canaisEmComum,
  onAbrirCanal,
  onVerify,
  onAskPosts,
  aberta,
  onAbrirPublicacao,
  onBack,
  connection,
  connectionDetail = null,
}: {
  address: string
  /** Already resolved by the shell: the published name, or the abbreviated address. */
  name: string
  /** Absent when nothing from this person reached this device. */
  profile: Profile | undefined
  posts: ChatMessage[]
  /**
   * The entire thread, so an open post can bring the votes and comments. As in
   * the feed, and for the same reason. See `PostDetail`.
   */
  messages: ChatMessage[]
  /** Who am I: the pressed vote and which comments I can delete. */
  me: string | null
  directory: Map<string, Profile>
  nameFor: (sender: string) => string
  /** The point of presence, by the same rule as the rest of the app. */
  presenca?: "active" | "away" | "busy" | "idle" | undefined
  presenceHint?: string | undefined
  /**
   * This person's roles, and the channel they belong to.
   *
   * **Absent when there is no channel**, and that is the answer to the problem:
   * a profile belongs to no channel, and a role always belongs to one. Opened
   * from the people panel there is the channel in front; opened from the feed
   * there is no channel to speak of. Showing "Moderator" without saying moderator
   * of what would mean the person is one everywhere. Whoever builds the page
   * decides; see `App.tsx`.
   */
  roles?: React.ComponentProps<typeof MemberRoles> | undefined
  onMessage: () => void
  /** Connect to this person. Friends only, as in the person menu. */
  onCall?: (() => void) | undefined
  /**
   * The single friendship button: the state, and the gestures it allows.
   *
   * The same ones as `useAmizade`, which the person menu, the chat card, the
   * notification bell, and Pending also call. Absent means there is no friendship
   * gesture to offer (in community mode, for example).
   */
  amizade?:
    | {
        estado: EstadoDaAmizade
        /** The note from the requester, when the request is theirs. */
        nota?: string | undefined
        ocupado?: boolean | undefined
        /** Resolves `true` when the request went through: only then does the note clear. */
        pedir: (nota?: string) => Promise<boolean> | void
        aceitar: () => void
        recusar: () => void
        desfazer: () => void
        /** Withdraw our request. Absent on a host that cannot do it. */
        cancelar?: (() => void) | undefined
      }
    | undefined
  /**
   * I blocked this person on this device. The page stays with who they are:
   * no Message, no Call, no friendship and no invite, which the core refuses.
   * The "⋯" brings the "Unblock".
   */
  bloqueado?: boolean | undefined
  /**
   * The list of friends this person chose to show, with names already resolved.
   * Null when they do not show it, or when we are not friends (the core only
   * gives it to friends). It never comes crossed with my list: no "mutual
   * friends", by owner decision.
   */
  amigosMostrados?: readonly { address: string; nome: string }[] | null | undefined
  /** Open someone's profile from that list. */
  onOpenAmigo?: ((address: string) => void) | undefined
  /**
   * The channels where we both are, with the name the sidebar gives them.
   * Absent or null: still searching.
   */
  canaisEmComum?: readonly { channel: string; nome: string }[] | null | undefined
  onAbrirCanal?: ((channel: string) => void) | undefined
  /** Opens the invite sheet with this person already written. */
  onInvite?: (() => void) | undefined
  /**
   * The rest of the person menu, in the same order, behind a "⋯".
   *
   * This is what makes this page a superset of the menu: what it offers there
   * (admin, move, expel, block) is also reachable here, by the same functions.
   * It comes from `itensDaPessoa` with `semAccoesDaFolha`, which removes what
   * the page already has as a button.
   */
  menu?: MenuItem[] | undefined
  /** Only when there is a shared channel where the number can be calculated. */
  onVerify?: (() => void) | undefined
  /**
   * Ask this person's device to publish the latest posts again.
   *
   * **Absent when it cannot.** An older host does not bring the port on the
   * bridge (see `pedirPublicacoes` in `bridge.ts`), and a profile opened without
   * this person's feed has nothing to ask for. **And absent also when this
   * device READS this feed:** a click cannot leave anyone out of a working feed.
   * The request makes this person's publishing device respond with `#reseat`,
   * which is an `#unseat` followed by a `#seatInvite`.
   *
   * That guard lives in `App.tsx`, in `feedDaPessoa`, and it goes by the
   * DETECTOR and not the symptom: the feed must be in `deafChannels()`, which is
   * what the core decides by decryption failures. "Having nothing to read" is
   * not "being unable to read". The `#reseat` claims the key package BEFORE the
   * `#unseat` and throws without committing anything when there is none.
   */
  onAskPosts?: (() => void) | undefined
  /** The post open inside the page, if there is one. The stack guards it. */
  aberta: ChatMessage | null
  onAbrirPublicacao: (post: ChatMessage) => void
  /** The arrow and Escape: the top entry on the stack exits. */
  onBack: () => void
  /** The link, as other screens show it: banner at the top, line at the bottom. */
  connection?: ConnectionState | undefined
  connectionDetail?: string | null | undefined
}): React.JSX.Element {
  const titulo = useRef<HTMLHeadingElement | null>(null)
  const notaId = useId()
  const prefixo = useId()
  const [nota, setNota] = useState("")
  const [escolhido, setEscolhido] = useState<Separador | null>(null)
  /** Where the "⋯" menu or the Friends menu is open, and which one. */
  const [menuAberto, setMenuAberto] = useState<{ qual: "mais" | "amizade"; at: { x: number; y: number } } | null>(
    null,
  )

  /*
    No posts and list open: shows friends, what the person has to display.
    In all other cases, shows posts.
  */
  const separador: Separador =
    escolhido ?? (posts.length === 0 && (amigosMostrados?.length ?? 0) > 0 ? "amigos" : "publicacoes")

  /*
    Focus moves to the title on open, and again each time the view changes
    (another person, a post opened, returning from it). The screen reader
    announces the name, and the next Tab starts at the page top, not where
    the click was, which is no longer visible.
  */
  const abertaId = aberta?.payload.id
  useEffect(() => {
    titulo.current?.focus()
  }, [address, abertaId])

  /*
    Escape goes back, like the arrow does. Not when a sheet or menu is on top:
    the key belongs to it, and Modal only closes the topmost one. Also not in
    a text field with content, where the key would erase a comment draft.
  */
  const voltar = useRef(onBack)
  voltar.current = onBack
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key !== "Escape" || evento.defaultPrevented) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return
      const alvo = evento.target
      if ((alvo instanceof HTMLInputElement || alvo instanceof HTMLTextAreaElement) && alvo.value !== "") return
      evento.preventDefault()
      voltar.current()
    }
    document.addEventListener("keydown", aoTeclar)
    return () => document.removeEventListener("keydown", aoTeclar)
  }, [])

  /*
    The "⋯" on the page: Invite and Verify first (they are actions from this
    person that do not fit in a button), then the rest of the person menu, in
    its order.
    */
  const itensDoMais: MenuItem[] = [
    ...(onInvite && !bloqueado ? [{ label: strings.userMenu.inviteToRoom, onSelect: onInvite }] : []),
    ...(onVerify ? [{ label: strings.members.verifyHint(name), onSelect: onVerify }] : []),
    ...(menu ?? []).map((item, indice) =>
      indice === 0 && (onInvite || onVerify) ? { ...item, separatorBefore: true } : item,
    ),
  ]

  const separadores: { id: Separador; rotulo: string; conta?: number | undefined }[] = [
    { id: "publicacoes", rotulo: strings.personProfile.postsTab, conta: posts.length },
    { id: "amigos", rotulo: strings.personProfile.friendsTab, conta: amigosMostrados?.length },
    { id: "comum", rotulo: strings.personProfile.sharedTab, conta: canaisEmComum?.length },
  ]

  /** Arrows move between tabs, as the ARIA tab pattern requires. */
  const aoTeclarNosSeparadores = (evento: React.KeyboardEvent<HTMLDivElement>): void => {
    const passo = evento.key === "ArrowRight" ? 1 : evento.key === "ArrowLeft" ? -1 : 0
    if (passo === 0) return
    evento.preventDefault()
    const actual = separadores.findIndex((item) => item.id === separador)
    const seguinte = separadores[(actual + passo + separadores.length) % separadores.length]
    if (!seguinte) return
    setEscolhido(seguinte.id)
    document.getElementById(`${prefixo}-sep-${seguinte.id}`)?.focus()
  }

  return (
    <main className="main pagina-da-pessoa person-profile" aria-label={strings.personProfile.title(name)}>
      {connection && <ConnectionBanner state={connection} detail={connectionDetail} />}

      {/* The glass header: the arrow and, with a post open, who owns it and when. */}
      <header className="topbar pessoa-topo">
        <button
          type="button"
          className="ghost pessoa-voltar"
          aria-label={aberta ? strings.personProfile.back : strings.personProfile.backFromPage}
          title={aberta ? strings.personProfile.back : strings.personProfile.backFromPage}
          onClick={onBack}
        >
          <SetaParaTrasIcon size={18} />
          {/* The word in view, not just the arrow (owner's request on 27 October
              2026: "I want to go back", and could not find the button). The
              accessible name is the `aria-label`, which starts with this word. */}
          <span aria-hidden="true">{strings.personProfile.backFromPage}</span>
        </button>
        {aberta ? (
          // Who owns it and when: the open post no longer has the person's
          // header above it.
          <h1 ref={titulo} tabIndex={-1}>
            {name} · {formatStamp(aberta.payload.postedAt)}
          </h1>
        ) : (
          // The small name, for anyone who scrolled the header out of view. The
          // screen reader already has it in the `<h1>` below.
          <span className="pessoa-topo-nome" aria-hidden="true">
            <NomeDePessoa nome={name} endereco={address} />
          </span>
        )}
      </header>

      <div className="profile-scroll pessoa-corpo">
        {aberta ? (
          <div className="pessoa-publicacao">
            <PostDetail post={aberta} messages={messages} me={me} directory={directory} nameFor={nameFor} />
          </div>
        ) : (
          <>
            <section className="pessoa-cabeca">
              <span className="profile-avatar pessoa-avatar">
                {profile?.avatarDataUrl ? (
                  <img src={profile.avatarDataUrl} alt="" />
                ) : (
                  (profile?.displayName.trim()[0] ?? address[1] ?? "?").toUpperCase()
                )}
              </span>

              <div className="pessoa-factos">
                {/* The id is not read: copy it with the button next to the name, outside
                    the `<h1>` so the title name stays just the name. */}
                <div className="pessoa-nome-linha">
                  <h1 ref={titulo} tabIndex={-1}>
                    <NomeDePessoa nome={profile?.displayName || name} endereco={address} />
                    <DistintivoDeEmbaixador address={address} />
                  </h1>
                  <BotaoCopiarId id={address} rotulo={strings.copiarId.de(profile?.displayName || name)} />
                </div>
                {presenca && (
                  // The same dot as in lists, and the word next to it.
                  <p className="pessoa-presenca">
                    <span
                      className={`presence-dot pessoa-ponto${presenca === "idle" ? "" : ` ${presenca}`}`}
                      aria-hidden="true"
                      title={presenceHint ?? strings.people.presenceTitle}
                    />
                    <span>
                      {presenca === "active"
                        ? strings.people.presence
                        : presenca === "busy"
                          ? strings.people.presenceBusy
                          : presenca === "away"
                            ? strings.aneis.away
                            : strings.people.presenceIdle}
                    </span>
                  </p>
                )}
                {profile?.statusText && <p className="profile-status">{profile.statusText}</p>}
                {profile?.bio && <p className="profile-bio">{profile.bio}</p>}
                {profile?.email && <p className="profile-contact">{profile.email}</p>}
                {(profile?.donations.length ?? 0) > 0 && (
                  <ul className="pessoa-links">
                    {profile?.donations.map((entrada, indice) => (
                      // Text, never a link: a click would tell a payment service who reads
                      // the posts of whom.
                      <li key={indice}>
                        <span className="donation-kind">{entrada.kind}</span>
                        <span className="donation-label">{entrada.label}</span>
                        <code>{entrada.value}</code>
                      </li>
                    ))}
                  </ul>
                )}
                {!profile && <p className="field-note">{strings.personProfile.unknown}</p>}
              </div>
            </section>

            {/*
              Her request, waiting for a reply, on the usual card: the same as
              in the conversation, in Pending, and in the bell. It sits above
              the buttons because it is the question this page has to ask.
            */}
            {!bloqueado && amizade?.estado === "pedido-recebido" && (
              <PedidoCard
                className="person-profile-pedido"
                titulo={strings.people.wantsToBeFriends(name)}
                estado={amizade.nota ?? strings.people.requestWaits}
                aceitar={strings.people.accept}
                aceitando={strings.people.accepting}
                recusar={strings.people.decline}
                ocupado={amizade.ocupado}
                onAceitar={amizade.aceitar}
                onRecusar={amizade.recusar}
              />
            )}

            {/*
              The actions, in the order of the person menu: communicate,
              relationship, and the rest behind "⋯". If blocked, only the
              status and "⋯" show.
              */}
            <div className="pessoa-accoes">
              {bloqueado ? (
                <span className="person-profile-estado" role="status">
                  {strings.people.blockedState}
                </span>
              ) : (
                <>
                  <Button variant="primary" onClick={onMessage}>
                    {strings.personProfile.message}
                  </Button>
                  {onCall && (
                    <Button variant="ghost" onClick={onCall}>
                      {strings.userMenu.call}
                    </Button>
                  )}
                  {/* The single friendship button. "Request sent" is not a button: there is
                      nothing to do until the other person replies. Accept and
                      decline are on the card above. */}
                  {amizade?.estado === "nenhum" && (
                    <Button
                      variant="ghost"
                      disabled={amizade.ocupado === true}
                      onClick={() => {
                        void Promise.resolve(amizade.pedir(nota)).then((saiu) => {
                          if (saiu) setNota("")
                        })
                      }}
                    >
                      {strings.userMenu.friend}
                    </Button>
                  )}
                  {amizade?.estado === "pedido-enviado" && (
                    <span className="person-profile-estado" role="status">
                      {strings.userMenu.friendPending}
                    </span>
                  )}
                  {amizade?.estado === "pedido-enviado" && amizade.cancelar && (
                    <Button variant="ghost" disabled={amizade.ocupado === true} onClick={amizade.cancelar}>
                      {strings.people.cancelRequest}
                    </Button>
                  )}
                  {amizade?.estado === "amigos" && (
                    <button
                      type="button"
                      className="ghost"
                      aria-haspopup="menu"
                      title={strings.userMenu.friendsMenu(name)}
                      onClick={(event) => {
                        const caixa = event.currentTarget.getBoundingClientRect()
                        setMenuAberto({ qual: "amizade", at: { x: caixa.left, y: caixa.bottom + 4 } })
                      }}
                    >
                      {strings.userMenu.friendsNow}
                    </button>
                  )}
                </>
              )}
              {itensDoMais.length > 0 && (
                <BotaoMais
                  className="pessoa-mais"
                  label={strings.userMenu.more(name)}
                  onAbrir={(at) => setMenuAberto({ qual: "mais", at })}
                />
              )}
            </div>

            {/* The note on the request, only when there is no request yet. It goes
                with it and appears on the card of who receives it. */}
            {!bloqueado && amizade?.estado === "nenhum" && (
              <div className="person-profile-nota">
                <label className="field-note" htmlFor={notaId}>
                  {strings.userMenu.noteLabel}
                </label>
                <input
                  id={notaId}
                  value={nota}
                  maxLength={280}
                  placeholder={strings.userMenu.notePlaceholder}
                  onChange={(event) => setNota(event.target.value)}
                />
              </div>
            )}

            {/* After who the person is: a role is what she does in a place, and
                only reads after you know who you are talking about. */}
            {roles && (
              <div className="pessoa-cargos">
                <MemberRoles {...roles} />
              </div>
            )}

            <div
              className="pessoa-separadores"
              role="tablist"
              aria-label={strings.personProfile.tabsLabel(name)}
              onKeyDown={aoTeclarNosSeparadores}
            >
              {separadores.map((item) => (
                <button
                  key={item.id}
                  id={`${prefixo}-sep-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={item.id === separador}
                  aria-controls={`${prefixo}-painel`}
                  tabIndex={item.id === separador ? 0 : -1}
                  className={item.id === separador ? "pessoa-separador on" : "pessoa-separador"}
                  onClick={() => setEscolhido(item.id)}
                >
                  {item.rotulo}
                  {item.conta !== undefined && <span className="kind-count">{item.conta}</span>}
                </button>
              ))}
            </div>

            <div
              id={`${prefixo}-painel`}
              className="pessoa-painel"
              role="tabpanel"
              aria-labelledby={`${prefixo}-sep-${separador}`}
            >
              {separador === "publicacoes" && (
                <>
                  {/*
                    The sync state of her feed. With posts in view and the
                    feed deaf, a line says there is more that this device does
                    not read, and the button asks for it. Who decides if the
                    button exists is the detector, in the shell. See
                    `onAskPosts`.
                    */}
                  {onAskPosts && posts.length > 0 && !bloqueado && (
                    <div className="pessoa-sincronia" role="status">
                      <span>{strings.personProfile.deafNote(name)}</span>
                      <Button variant="ghost" title={strings.personProfile.askPostsHint(name)} onClick={onAskPosts}>
                        {strings.personProfile.askPosts}
                      </Button>
                    </div>
                  )}
                  {posts.length === 0 ? (
                    <EmptyState
                      title={strings.personProfile.emptyTitle}
                      body={strings.personProfile.emptyBody}
                      action={
                        onAskPosts && !bloqueado
                          ? { label: strings.personProfile.askPosts, onClick: onAskPosts }
                          : undefined
                      }
                    />
                  ) : (
                    <PublicacoesDoPerfil
                      posts={posts}
                      onOpenPost={onAbrirPublicacao}
                      rotulo={strings.personProfile.postsListLabel(name)}
                    />
                  )}
                </>
              )}

              {separador === "amigos" &&
                (amigosMostrados && amigosMostrados.length > 0 ? (
                  <ul className="post-list profile-amigos" aria-label={strings.personProfile.friendsListLabel(name)}>
                    {amigosMostrados.map(({ address: quem, nome }) => (
                      <li key={quem}>
                        {onOpenAmigo ? (
                          <button type="button" className="post-row" title={quem} onClick={() => onOpenAmigo(quem)}>
                            <span className="post-row-labels">
                              <span className="post-row-title">
                                <NomeDePessoa nome={nome || nomeEmFalta(quem)} endereco={quem} />
                              </span>
                            </span>
                          </button>
                        ) : (
                          <span className="post-row" title={quem}>
                            <span className="post-row-labels">
                              <span className="post-row-title">
                                <NomeDePessoa nome={nome || nomeEmFalta(quem)} endereco={quem} />
                              </span>
                            </span>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="pessoa-nota-vazia">
                    {amigosMostrados
                      ? strings.personProfile.friendsEmpty(name)
                      : amizade?.estado === "amigos"
                        ? strings.personProfile.friendsHidden(name)
                        : strings.personProfile.friendsOnlyFriends(name)}
                  </p>
                ))}

              {separador === "comum" &&
                (!canaisEmComum ? (
                  <p className="pessoa-nota-vazia" role="status">
                    {strings.personProfile.sharedLoading}
                  </p>
                ) : canaisEmComum.length === 0 ? (
                  <p className="pessoa-nota-vazia">{strings.personProfile.sharedEmpty}</p>
                ) : (
                  <ul className="post-list pessoa-canais" aria-label={strings.personProfile.sharedListLabel(name)}>
                    {canaisEmComum.map(({ channel, nome }) => (
                      <li key={channel}>
                        {onAbrirCanal ? (
                          <button type="button" className="post-row" onClick={() => onAbrirCanal(channel)}>
                            <span className="post-row-labels">
                              <span className="post-row-title">{nome}</span>
                            </span>
                          </button>
                        ) : (
                          <span className="post-row">
                            <span className="post-row-labels">
                              <span className="post-row-title">{nome}</span>
                            </span>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ))}
            </div>
          </>
        )}
      </div>

      {connection && <footer className="statusbar">{connectionLabel(connection)}</footer>}

      {menuAberto && (
        <ContextMenu
          at={menuAberto.at}
          onClose={() => setMenuAberto(null)}
          items={
            menuAberto.qual === "mais"
              ? itensDoMais
              : amizade
                ? [{ label: strings.people.unfriend, onSelect: amizade.desfazer }]
                : []
          }
        />
      )}
    </main>
  )
}

import { useId, useMemo, useRef, useState } from "react"
import { Avatar } from "../../components/Avatar.js"
import { Button } from "../../components/Button.js"
import { Modal } from "../../components/Modal.js"
import type { Profile } from "../../bridge.js"
import { ArrobaIcon, ChatIcon, CloseIcon, EnvelopeIcon, LockIcon, PersonIcon, TelefoneIcon } from "../../icons.js"
import { formatStamp } from "../../lib/format.js"
import { openRequestFrom, type Friendships } from "../../lib/friendship.js"
import {
  agruparPorDia,
  entraNoFiltro,
  FILTROS_DO_SINO,
  ofertaEntraNoFiltro,
  type FiltroDoSino,
  type GrupoDoDia,
} from "../../lib/linhaDoTempo.js"
import { notificationTextOf, type AppNotification } from "../../lib/notifications.js"
import { chaveDaOferta, type OfertaDeSucessao } from "../../lib/sucessoes.js"
import { PedidoCard } from "../chat/PedidoCard.js"
import { linguaActual, strings } from "../../strings.js"

/**
 * The bell: what happened while you were not looking, each entry a door to the
 * thing itself.
 *
 * Since 3 November 2026 (mockup picked by the owner) it is a window at center,
 * and on mobile a sheet full width: the title, the close, the filters as pills,
 * and the list as a timeline, by days, with one icon per type. Before it was a
 * menu anchored to the rail.
 *
 * It is a `Modal`: focus stays trapped in the window, Esc and clicking outside
 * close it, and focus returns to the bell. Arrow keys move through the list,
 * Home and End go to the ends.
 */
export function NotificationPanel({
  notifications,
  nameFor,
  labelFor,
  directory,
  presenceFor,
  emChamada,
  friendships,
  ofertas = [],
  ofertaOcupada = null,
  onOferta,
  busy = null,
  onAcceptRequest,
  onDeclineRequest,
  onOpen,
  onMarkAllRead,
  onClose,
  falhou = false,
}: {
  /**
   * Where the bell was. No longer used: the window opens at center. Kept so
   * callers do not change, and because where the click was may come to matter
   * again.
   */
  at?: { x: number; y: number } | undefined
  notifications: AppNotification[]
  nameFor: (address: string) => string
  labelFor: (channel: string) => string
  directory: Map<string, Profile>
  /**
   * The state of each person, for the face ring. Absent: faces have no ring,
   * because this screen does not know the state and grey would say "offline".
   */
  presenceFor?: ((address: string) => "active" | "away" | "busy" | "idle") | undefined
  /** Whoever is in a call or a voice room: the ring pulses. */
  emChamada?: ((address: string) => boolean) | undefined
  /**
   * The state of friendships, to answer a request without leaving here.
   *
   * The buttons come from here and never from the bell entry. The entry is the
   * record of something that happened and does not change; if it also carried
   * the state, there would be two lists needing to be kept in sync, and
   * "accepting in one place disappears from the other" would become code that
   * someone has to write and keep right in all outcomes. This way there is
   * nothing to sync: a request answered leaves `friendships.open` and the
   * button goes with it, no matter where it was answered.
   */
  friendships?: Friendships | undefined
  /**
   * The offers from accounts that became others (phase 8.2), above the list:
   * "Add?" and "Invite?", each with "Not now". Like requests, they are state
   * not record: answering removes them from here.
   */
  ofertas?: readonly OfertaDeSucessao[] | undefined
  /** The offer with an answer in progress (`chaveDaOferta`): buttons stay still. */
  ofertaOcupada?: string | null | undefined
  onOferta?: ((oferta: OfertaDeSucessao, sim: boolean) => void) | undefined
  /** Who has an answer in progress: that person's buttons stay still. */
  busy?: string | null | undefined
  /** Who: the channel resolves in `useAmizade`. */
  onAcceptRequest?: ((address: string) => void) | undefined
  onDeclineRequest?: ((address: string) => void) | undefined
  onOpen: (entry: AppNotification) => void
  onMarkAllRead: () => void
  onClose: () => void
  /**
   * Reading what is stored failed, and the list above is not the truth.
   *
   * Without this the panel had two truths for three states: a list, or "Nothing
   * here. Good sign." A failed read fell into the second, and told the person
   * they had no notifications on top of a vault that could have fifty. It is the
   * same rule the people list has followed for a while.
   *
   * `false` by default, which is the normal case and the safe read: a panel
   * that does not know if it failed does not announce a fault.
   */
  falhou?: boolean | undefined
}): React.JSX.Element {
  const titulo = useId()
  const [filtro, setFiltro] = useState<FiltroDoSino>("tudo")
  const lista = useRef<HTMLDivElement>(null)
  const agora = Date.now()

  const visiveis = useMemo(
    () => notifications.filter((entry) => entraNoFiltro(entry.kind, filtro)),
    [notifications, filtro],
  )
  const ofertasVisiveis = ofertas.filter((oferta) => ofertaEntraNoFiltro(oferta, filtro))
  const grupos = agruparPorDia(visiveis, agora)
  const nada = notifications.length === 0 && ofertas.length === 0
  const nadaNoFiltro = visiveis.length === 0 && ofertasVisiveis.length === 0

  /* Arrows move through list rows only: accept and decline buttons stay on Tab,
     as they do everywhere else. */
  const andar = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
    const linhas = [...(lista.current?.querySelectorAll<HTMLElement>(".notif-row[data-linha]") ?? [])]
    if (linhas.length === 0) return
    event.preventDefault()
    const aqui = linhas.indexOf(document.activeElement as HTMLElement)
    const proxima =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? linhas.length - 1
          : event.key === "ArrowDown"
            ? Math.min(linhas.length - 1, aqui + 1)
            : Math.max(0, aqui === -1 ? 0 : aqui - 1)
    linhas[proxima]?.focus()
  }

  return (
    <Modal className="sheet notif-janela" labelledBy={titulo} onClose={onClose}>
      <header className="notif-head">
        <h2 id={titulo}>{strings.notifCenter.title}</h2>
        {notifications.some((entry) => !entry.read) && (
          <Button variant="ghost" onClick={onMarkAllRead}>
            {strings.notifCenter.markAllRead}
          </Button>
        )}
        <button type="button" className="notif-fechar" aria-label={strings.common.close} onClick={onClose}>
          <CloseIcon size={18} />
        </button>
      </header>

      <div className="notif-filtros" role="group" aria-label={strings.notifCenter.filtros}>
        {FILTROS_DO_SINO.map((qual) => (
          <button
            key={qual}
            type="button"
            className={qual === filtro ? "notif-filtro on" : "notif-filtro"}
            aria-pressed={qual === filtro}
            onClick={() => setFiltro(qual)}
          >
            {rotuloDoFiltro(qual)}
          </button>
        ))}
      </div>

      <div className="notif-corpo" ref={lista} onKeyDown={andar}>
        {falhou && (
          /* First, because it contradicts what follows. With a failed read,
             "you are current" and the visible list are both suspects:
             what appears on screen is only what arrived live since the
             app opened. Two sentences, two paragraphs: each one is a whole node,
             which is how a screen reader announces it. */
          <div className="notif-empty notif-falhou" role="status">
            <p>{strings.notifCenter.falhou}</p>
            <p className="notif-falhou-nota">{strings.notifCenter.falhouNota}</p>
          </div>
        )}
        {!falhou && nada ? (
          <p className="notif-empty">{strings.notifCenter.empty}</p>
        ) : !falhou && nadaNoFiltro ? (
          <p className="notif-empty">{strings.notifCenter.filtroVazio}</p>
        ) : falhou && notifications.length === 0 ? null : (
          <>
            {ofertasVisiveis.length > 0 && (
              <ul className="notif-list notif-ofertas">
                {ofertasVisiveis.map((oferta) => {
                  const chave = chaveDaOferta(oferta)
                  const ocupada = ofertaOcupada === chave
                  /*
                    The account is matched by name only if this device already has
                    its profile; otherwise, by address. "No name" tells no one
                    who the request is going to, and the request is the only thing
                    we decide here.
                  */
                  const para = directory.get(oferta.para)?.displayName || oferta.para
                  return (
                    <li key={chave} className="notif-sucessao">
                      <div className="notif-row unread">
                        <Avatar profile={directory.get(oferta.para)} fallback={oferta.para[1] ?? "?"} />
                        <span className="notif-labels">
                          <span className="notif-text">{strings.notifCenter.sucessao(nameFor(oferta.de), para)}</span>
                          <span className="notif-text">
                            {oferta.tipo === "amigo"
                              ? strings.notifCenter.sucessaoAdicionar(para)
                              : strings.notifCenter.sucessaoConvidar(para, labelFor(oferta.canal))}
                          </span>
                        </span>
                      </div>
                      <div className="notif-actions">
                        <Button variant="ghost" disabled={ocupada} onClick={() => onOferta?.(oferta, false)}>
                          {strings.notifCenter.agoraNao}
                        </Button>
                        <Button variant="primary" disabled={ocupada} onClick={() => onOferta?.(oferta, true)}>
                          {oferta.tipo === "amigo" ? strings.notifCenter.adicionar : strings.notifCenter.convidar}
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {grupos.map((grupo) => (
              <section key={grupo.dia} className="notif-dia" aria-labelledby={`${titulo}-${grupo.dia}`}>
                <h3 id={`${titulo}-${grupo.dia}`} className="notif-dia-titulo">
                  {rotuloDoDia(grupo)}
                </h3>
                <ol className="notif-list notif-linha">
                  {grupo.entradas.map((entry) => {
                    // The pending request from this person, if there is one. It is
                    // this join, record on one side and state on the other, that makes
                    // the buttons disappear on their own when the request is answered
                    // elsewhere.
                    const request = entry.kind === "friend-request" ? openRequestFrom(friendships, entry.actor) : null
                    const texto =
                      entry.kind === "friend-request" && !request && entry.actor
                        ? strings.notifCenter.friendRequestClosed(nameFor(entry.actor))
                        : notificationTextOf(entry, nameFor, labelFor)
                    return (
                      <li key={entry.id} className="notif-evento" data-tipo={entry.kind}>
                        <span className="notif-ponto" aria-hidden="true" />
                        <button
                          type="button"
                          data-linha=""
                          className={entry.read ? "notif-row" : "notif-row unread"}
                          onClick={() => onOpen(entry)}
                        >
                          <span className="notif-icone" aria-hidden="true">
                            <IconeDoTipo kind={entry.kind} />
                            {/* A small portrait of the sender in the corner of the icon. */}
                            {entry.actor && (
                              <span className="notif-cara">
                                <Avatar
                                  profile={directory.get(entry.actor)}
                                  fallback={entry.actor[1] ?? "?"}
                                  presence={presenceFor?.(entry.actor)}
                                  emChamada={emChamada?.(entry.actor)}
                                />
                              </span>
                            )}
                          </span>
                          <span className="notif-text">{texto}</span>
                          <time dateTime={new Date(entry.at).toISOString()} title={formatStamp(entry.at)}>
                            {horaDe(entry.at)}
                          </time>
                          {!entry.read && (
                            <span className="notif-dot">
                              <span className="sr-only">{strings.notifCenter.porLer}</span>
                            </span>
                          )}
                        </button>
                        {/* The same request card as the rest of the app, with no title: the
                            line above already says who is requesting. Same two buttons. */}
                        {request && (
                          <div className="notif-actions">
                            <PedidoCard
                              className="pedido-no-sino"
                              aceitar={strings.people.accept}
                              aceitando={strings.people.accepting}
                              recusar={strings.people.decline}
                              ocupado={busy === request.peer}
                              onAceitar={() => onAcceptRequest?.(request.peer)}
                              onRecusar={() => onDeclineRequest?.(request.peer)}
                            />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </section>
            ))}
          </>
        )}
      </div>
    </Modal>
  )
}

function rotuloDoFiltro(filtro: FiltroDoSino): string {
  switch (filtro) {
    case "tudo":
      return strings.notifCenter.filtroTudo
    case "mencoes":
      return strings.notifCenter.filtroMencoes
    case "chamadas":
      return strings.notifCenter.filtroChamadas
    case "convites":
      return strings.notifCenter.filtroConvites
    case "amigos":
      return strings.notifCenter.filtroAmigos
  }
}

const localDaLingua = (): string => (linguaActual() === "en" ? "en-GB" : "pt-PT")

function rotuloDoDia(grupo: GrupoDoDia): string {
  if (grupo.dia === "hoje") return strings.notifCenter.hoje
  if (grupo.dia === "ontem") return strings.notifCenter.ontem
  return new Date(grupo.em).toLocaleDateString(localDaLingua(), { weekday: "long", day: "numeric", month: "long" })
}

function horaDe(at: number): string {
  return new Date(at).toLocaleTimeString(localDaLingua(), { hour: "2-digit", minute: "2-digit" })
}

/** One icon per type: at sign, person, phone, envelope, and the chat bubble. */
function IconeDoTipo({ kind }: { kind: AppNotification["kind"] }): React.JSX.Element {
  switch (kind) {
    case "mention":
      return <ArrobaIcon size={22} />
    case "friend-request":
    case "friend-accept":
      return <PersonIcon size={22} />
    case "missed-call":
      return <TelefoneIcon size={22} />
    case "room-added":
    case "channel-join":
      return <EnvelopeIcon size={22} />
    case "report-copy":
    case "report-decision":
      return <LockIcon size={22} />
    case "dm-new":
    case "dm-message":
      return <ChatIcon size={22} />
  }
}

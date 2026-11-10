import { type Ticket, type TicketLine } from "@enclave/client-core"
import { useMemo, useState } from "react"
import { Button } from "../../components/Button.js"
import { EmptyState } from "../../components/EmptyState.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { useConfirmar } from "../../hooks/useConfirmar.js"
import { strings, traduzirErro } from "../../strings.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"

/**
 * The dedicated screen for a ticket room.
 *
 * **Not the conversation with a different layout.** The conversation shows what
 * was said in order; this shows what still needs DOING, and the order is work
 * order: what still needs someone on it, what is already closed at the bottom.
 * See the `sort` in `ticketsOf`, which decides.
 *
 * **Self-contained on purpose.** It does not import `Timeline`, `Composer`, or
 * text formatting: those are other people's files and are being rewritten
 * nearby. What is lost is written in `docs/PENDENTES.md` (images, mentions, and
 * formatting inside a ticket), and what is gained is this screen not breaking
 * when those change.
 *
 * **Both truths live here, not on a help page.** A ticket looks like a private
 * conversation with the agent, and it is not: everyone in the channel reads it.
 * And the board is what THIS device heard, because what was said before someone
 * had a place in the channel will never be readable to them. Neither is a
 * malfunction, and so neither is written as an error.
 */
export function TicketsScreen({
  tickets,
  linhas,
  me,
  nameFor,
  mayAttend,
  mayDecide,
  aberto,
  onAbrir,
  onNovo,
  onResponder,
  onEstado,
  onAtender,
  onLargar,
  mayModerate = false,
  onEliminar,
}: {
  tickets: Ticket[]
  /** The messages of the open ticket. Empty when the board is in view. */
  linhas: TicketLine[]
  me: string
  nameFor: (address: string) => string
  mayAttend: boolean
  /** Whether this account can change this ticket's state: by taking it, or by opening it. */
  mayDecide: (ticket: string) => boolean
  /** The open ticket, or null for the board. Lives at the top to survive a redraw. */
  aberto: string | null
  onAbrir: (ticket: string | null) => void
  onNovo: (subject: string) => Promise<void>
  onResponder: (ticket: string, body: string) => Promise<void>
  onEstado: (ticket: string, state: "open" | "working" | "closed") => Promise<void>
  onAtender: (ticket: string) => Promise<void>
  onLargar: (ticket: string) => Promise<void>
  /** Whether this account moderates the channel (phase 3): deletes closed tickets. */
  mayModerate?: boolean | undefined
  /** The tombstone of a closed ticket. Absent, the button does not appear. */
  onEliminar?: ((ticket: string) => Promise<void>) | undefined
}): React.JSX.Element {
  const confirmar = useConfirmar()
  const [filtro, setFiltro] = useState<"all" | "open" | "working" | "closed">("all")
  const [assunto, setAssunto] = useState("")
  const [aEscrever, setAEscrever] = useState(false)
  const [resposta, setResposta] = useState("")
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const visiveis = useMemo(
    () => (filtro === "all" ? tickets : tickets.filter((ticket) => ticket.state === filtro)),
    [tickets, filtro],
  )
  const emFoco = aberto === null ? null : (tickets.find((ticket) => ticket.id === aberto) ?? null)

  /** One gesture at a time, and the core error told where you clicked. */
  const fazer = (acto: () => Promise<void>): void => {
    if (ocupado) return
    setOcupado(true)
    setErro(null)
    void acto()
      .catch((causa: Error) => setErro(traduzirErro(causa)))
      .finally(() => setOcupado(false))
  }

  if (emFoco) {
    const ticket = emFoco
    const podeDecidir = mayDecide(ticket.id)
    const meuTurno = ticket.assignee === me
    return (
      <section className="tickets ticket-open" aria-label={ticket.subject || strings.tickets.noSubject}>
        <header className="tickets-header">
          <Button variant="ghost" onClick={() => onAbrir(null)}>
            {strings.tickets.back}
          </Button>
        </header>

        <div className="ticket-head">
          <Etiqueta state={ticket.state} />
          <h2>{ticket.subject || strings.tickets.noSubject}</h2>
          <p className="ticket-meta">
            {ticket.opener ? `${strings.tickets.openedBy(nameFor(ticket.opener))} · ` : ""}
            {ticket.assignee ? strings.tickets.attendedBy(nameFor(ticket.assignee)) : strings.tickets.unattended}
          </p>
          {/* The opening that does not recover, told where it is missing. Without this
              phrase, a ticket with no subject reads as an app defect. */}
          {!ticket.subject && <p className="hint">{strings.tickets.noSubjectHint}</p>}
        </div>

        {/**
         * What cannot be done does not appear, instead of appearing grayed out.
         *
         * It is the house rule for menus, and it applies here for the same
         * reason: a close button shown to someone who cannot close teaches the
         * wrong permissions model. The real refusal lives in the core, this just
         * does not offer a gesture that will be refused.
         */}
        <div className="ticket-actions">
          {mayAttend && ticket.state !== "closed" && !meuTurno && (
            <Button variant="primary" onClick={() => fazer(() => onAtender(ticket.id))} disabled={ocupado}>
              {strings.tickets.take}
            </Button>
          )}
          {mayAttend && meuTurno && (
            <Button variant="ghost" onClick={() => fazer(() => onLargar(ticket.id))} disabled={ocupado}>
              {strings.tickets.release}
            </Button>
          )}
          {podeDecidir && ticket.state !== "closed" && (
            <Button variant="ghost" onClick={() => fazer(() => onEstado(ticket.id, "closed"))} disabled={ocupado}>
              {strings.tickets.close}
            </Button>
          )}
          {podeDecidir && ticket.state === "closed" && (
            <Button variant="ghost" onClick={() => fazer(() => onEstado(ticket.id, "open"))} disabled={ocupado}>
              {strings.tickets.reopen}
            </Button>
          )}
          {/* Only closed, and only whoever moderates (phase 3). Asks first: unlike
              closing, deleting has no undo in the board. */}
          {mayModerate && onEliminar && ticket.state === "closed" && (
            <Button
              variant="ghost"
              onClick={() =>
                fazer(async () => {
                  const sim = await confirmar({
                    titulo: strings.tickets.deleteTitle(ticket.subject || strings.tickets.noSubject),
                    corpo: strings.tickets.deleteConfirm,
                    verbo: strings.tickets.delete,
                    destructive: true,
                  })
                  if (!sim) return
                  await onEliminar(ticket.id)
                  onAbrir(null)
                })
              }
              disabled={ocupado}
            >
              {strings.tickets.delete}
            </Button>
          )}
        </div>

        {erro && (
          <p className="error">
            <TextoDeErro texto={erro} />
          </p>
        )}

        <ol className="ticket-thread">
          {linhas.map((linha) => (
            <li key={linha.id}>
              <span className="ticket-line-who">
                <NomeDePessoa nome={nameFor(linha.sender)} endereco={linha.sender} />
              </span>
              <span className="ticket-line-body">{linha.body}</span>
            </li>
          ))}
        </ol>

        <form
          className="ticket-reply"
          onSubmit={(evento) => {
            evento.preventDefault()
            const limpo = resposta.trim()
            if (!limpo) return
            fazer(async () => {
              await onResponder(ticket.id, limpo)
              setResposta("")
            })
          }}
        >
          <input
            value={resposta}
            onChange={(evento) => setResposta(evento.target.value)}
            maxLength={4000}
            placeholder={strings.tickets.replyPlaceholder}
            aria-label={strings.tickets.replyPlaceholder}
          />
          <Button variant="primary" type="submit" disabled={ocupado || !resposta.trim()}>
            {strings.tickets.send}
          </Button>
        </form>

        <p className="hint">{strings.tickets.note}</p>
      </section>
    )
  }

  return (
    <section className="tickets" aria-label={strings.tickets.title}>
      <header className="tickets-header">
        <h2>{strings.tickets.title}</h2>
        <Button variant="primary" onClick={() => setAEscrever(true)}>
          {strings.tickets.open}
        </Button>
      </header>

      {aEscrever && (
        <form
          className="tickets-new"
          onSubmit={(evento) => {
            // Without this the browser navigates and reloads the page mid-send.
            evento.preventDefault()
            const limpo = assunto.trim()
            if (!limpo) {
              setErro(strings.tickets.subjectRequired)
              return
            }
            fazer(async () => {
              await onNovo(limpo)
              setAssunto("")
              setAEscrever(false)
            })
          }}
        >
          <label>
            {strings.tickets.subjectLabel}
            <input
              value={assunto}
              onChange={(evento) => setAssunto(evento.target.value)}
              maxLength={120}
              placeholder={strings.tickets.subjectPlaceholder}
              autoFocus
            />
          </label>
          <div className="tickets-new-actions">
            <Button variant="ghost" type="button" onClick={() => setAEscrever(false)}>
              {strings.prompts.cancel}
            </Button>
            <Button variant="primary" type="submit" disabled={ocupado || !assunto.trim()}>
              {ocupado ? strings.tickets.creating : strings.tickets.create}
            </Button>
          </div>
        </form>
      )}

      {/* The filter only exists when there is something to filter: in a room with two
          tickets that is four buttons to explain a list you read at a glance. */}
      {tickets.length > 2 && (
        <div className="tickets-filter" role="group" aria-label={strings.tickets.title}>
          {(["all", "open", "working", "closed"] as const).map((qual) => (
            <Button
              key={qual}
              type="button"
              ariaLabel={nomeDoFiltro(qual)}
              variant={filtro === qual ? "primary" : "ghost"}
              onClick={() => setFiltro(qual)}
            >
              {nomeDoFiltro(qual)}
            </Button>
          ))}
        </div>
      )}

      {erro && (
        <p className="error">
          <TextoDeErro texto={erro} />
        </p>
      )}

      {tickets.length === 0 ? (
        <EmptyState
          title={strings.tickets.empty}
          body={strings.tickets.emptyHint}
          action={{ label: strings.tickets.open, onClick: () => setAEscrever(true) }}
        />
      ) : (
        <ul className="tickets-list">
          {visiveis.map((ticket) => (
            <li key={ticket.id}>
              <button className="ticket-row" onClick={() => onAbrir(ticket.id)}>
                <Etiqueta state={ticket.state} />
                <span className="ticket-subject">{ticket.subject || strings.tickets.noSubject}</span>
                <span className="ticket-meta">
                  {ticket.opener ? `${strings.tickets.openedBy(nameFor(ticket.opener))} · ` : ""}
                  {strings.tickets.count(ticket.messages)}
                </span>
                <span className={ticket.assignee ? "ticket-who" : "ticket-who ticket-unattended"}>
                  {ticket.assignee ? strings.tickets.attendedBy(nameFor(ticket.assignee)) : strings.tickets.unattended}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Only the phrase that all members read tickets (owner, 28 October
          2026). The caveat about tickets from before joining is gone. */}
      <footer className="tickets-notes">
        <p className="hint">{strings.tickets.note}</p>
      </footer>
    </section>
  )
}

function nomeDoFiltro(qual: "all" | "open" | "working" | "closed"): string {
  return qual === "all"
    ? strings.tickets.filterAll
    : qual === "open"
      ? strings.tickets.stateOpen
      : qual === "working"
        ? strings.tickets.stateWorking
        : strings.tickets.stateClosed
}

/**
 * The state label.
 *
 * The color says how much attention the ticket needs, not whether it is good or
 * bad: amber for what still has no one on it, green for what already does, and
 * no color for what is closed. A closed ticket recedes, which is the same thing
 * the sort does by sending it to the bottom, said again in color.
 *
 * Never the highlight color that the person chooses: state must read the same
 * in any accent. It is the rule already written in the tokens, next to presence
 * colors, and the reason is the same: with Amber accent, "open" and "in
 * progress" would be the same color.
 *
 * And never color alone: the word is written there, which is what serves
 * color-blind users and screen readers.
 */
function Etiqueta({ state }: { state: "open" | "working" | "closed" }): React.JSX.Element {
  return (
    <span className={`ticket-state ticket-state-${state}`}>
      {state === "open"
        ? strings.tickets.stateOpen
        : state === "working"
          ? strings.tickets.stateWorking
          : strings.tickets.stateClosed}
    </span>
  )
}

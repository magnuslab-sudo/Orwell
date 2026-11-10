import { TICKET_STATES, type TicketState } from "@enclave/protocol"
import { chavesDeOrdem } from "./dobras.js"
import type { StoredChatMessage } from "./vault.js"

/**
 * A ticket, as read from the messages that make it up.
 *
 * **Not a record stored anywhere.** There is no tickets table, not on the server
 * and not in the vault: there are encrypted messages with a mark, and this is what
 * is left when you fold them by order. It is the same choice as post reactions
 * (`post.reaction`), and for the same reason, a shared record would need someone
 * to arbitrate who overwrites whom, and there is no one.
 *
 * The honest consequence, which the interface must show: two devices with
 * different history reach different frames, and neither is wrong.
 */
export interface Ticket {
  id: string
  /** The subject given to it. Empty when the opening is not readable. */
  subject: string
  state: TicketState
  /**
   * Who opened it, by the authenticated MLS sender, never by a field inside.
   * Empty when the opening did not reach this vault.
   */
  opener: string
  /** Who is handling it, or empty. */
  assignee: string
  openedAt: number
  /** The last thing that happened to it: a decision or a reply. */
  updatedAt: number
  /** How many messages it contains, including the opening. */
  messages: number
}

/** What a ticket mark is, after judgment. */
interface Marca {
  id: string
  subject?: string
  state?: string
  assignee?: string
  /** Ticket tombstone (phase 3). See `removed` in `TicketMark`. */
  removed?: boolean
  at: number
}

/**
 * Narrow down what comes from the vault by hand.
 *
 * The vault stores raw payloads on purpose, a vault written by a newer version
 * must open here, so nothing here can be assumed. It is the same cost that
 * `rolesOf` and `roomsOf` already pay, and for the same reason.
 */
function marcaDe(entrada: StoredChatMessage, room: string): Marca | null {
  const payload = entrada.payload as { t: string; room?: unknown; ticket?: unknown }
  if (payload.t !== "message") return null
  // A message without a label belongs to the default room, as everywhere in the
  // app. A ticket in the default room is legitimate: it is what happens when you
  // convert a room to a ticket board after you have already talked in it.
  if ((typeof payload.room === "string" ? payload.room : "") !== room) return null
  const bruto = payload.ticket
  if (!bruto || typeof bruto !== "object") return null
  const marca = bruto as Record<string, unknown>
  if (typeof marca["id"] !== "string" || marca["id"] === "") return null
  return {
    id: marca["id"],
    ...(typeof marca["subject"] === "string" ? { subject: marca["subject"] } : {}),
    ...(typeof marca["state"] === "string" ? { state: marca["state"] } : {}),
    ...(typeof marca["assignee"] === "string" ? { assignee: marca["assignee"] } : {}),
    ...(marca["removed"] === true ? { removed: true } : {}),
    at: typeof marca["at"] === "number" ? marca["at"] : entrada.at,
  }
}

/** The message id, so the same message does not count twice. */
function chaveDaMensagem(entrada: StoredChatMessage): string {
  const id = (entrada.payload as { id?: unknown }).id
  // By sender too, not just by `id`: an `id` repeated by someone else is another
  // message, not a repost of this one. It is the rule that `appendHistory` already
  // applies to posts.
  return `${entrada.sender} ${typeof id === "string" ? id : String(entrada.seq)}`
}

/** One line of a ticket conversation, already in order. */
export interface TicketLine {
  /** The message id, so the React list has a stable key. */
  id: string
  sender: string
  at: number
  body: string
}

/**
 * The messages of a ticket, in order, without duplicates.
 *
 * Lives here and not in the interface because the rule of what BELONGS to a ticket
 * is the same one the frame uses to count it, the room, the mark, and deduplication
 * of reposts. Two copies would diverge, and the symptom would be a frame saying
 * three messages about a conversation that shows two.
 *
 * By timestamp and not by arrival, as in the frame: recovered history brings
 * old messages after new ones.
 */
export function ticketThread(entries: readonly StoredChatMessage[], room: string, ticket: string): TicketLine[] {
  const linhas: { linha: TicketLine; at: number; seq: number }[] = []
  const vistas = new Set<string>()
  // Server order breaks ties on equal timestamps, with our sends having no echo
  // where they were posted (see `dobras.ts`).
  const chaves = chavesDeOrdem(entries)
  for (const [indice, entrada] of entries.entries()) {
    const marca = marcaDe(entrada, room)
    if (!marca || marca.id !== ticket) continue
    const chave = chaveDaMensagem(entrada)
    if (vistas.has(chave)) continue
    vistas.add(chave)
    const corpo = (entrada.payload as { body?: unknown }).body
    linhas.push({
      linha: {
        id: chave,
        sender: entrada.sender,
        at: marca.at,
        body: typeof corpo === "string" ? corpo : "",
      },
      at: marca.at,
      seq: chaves[indice] ?? entrada.seq,
    })
  }
  return linhas.sort((a, b) => a.at - b.at || a.seq - b.seq).map((item) => item.linha)
}

/**
 * The ticket board of a room, folded from the history.
 *
 * `podeAtender` is the only thing this does not know by itself, and that is on purpose:
 * who answers that question is `powersOf`, which lives in the session and knows the
 * channel foundation. Passing it as a question instead of computing it here is what
 * lets this function be pure, and it is what lets the interface fold the same board
 * over messages that have not reached the vault yet.
 *
 * **Where the permission applies, and why here.** The message arrives anyway: an
 * altered client publishes whatever state it wants, and nothing in this layer stops it,  * `atender` is convention, like `convidar` and `renomear` (see `POWERS`).
 * What makes it true is each honest client refusing to COUNT what came from someone
 * who does not have it. That is why the discount lives in the read and not just in the
 * screen that hides the button: hiding a button is not a permission.
 *
 * `podeModerar` is the phase 3 question: who can delete a closed ticket.
 * Absent means no one, so the ticket tombstone does not count, as in a client that
 * does not know about it.
 */
export function ticketsOf(
  entries: readonly StoredChatMessage[],
  room: string,
  podeAtender: (address: string) => boolean,
  podeModerar: (address: string) => boolean = () => false,
): Ticket[] {
  /** The messages of each ticket, without duplicates, in timestamp order. */
  const porTicket = new Map<string, { entrada: StoredChatMessage; marca: Marca; ordem: number }[]>()
  const vistas = new Set<string>()
  // Server order breaks ties on equal timestamps (see `dobras.ts`).
  const chaves = chavesDeOrdem(entries)

  for (const [indice, entrada] of entries.entries()) {
    const marca = marcaDe(entrada, room)
    if (!marca) continue
    const chave = chaveDaMensagem(entrada)
    // A repost says the same message again, with the same id and the same sender.
    // Counting it again would fill the board with conversations that never happened.
    if (vistas.has(chave)) continue
    vistas.add(chave)
    const lista = porTicket.get(marca.id) ?? []
    lista.push({ entrada, marca, ordem: chaves[indice] ?? entrada.seq })
    porTicket.set(marca.id, lista)
  }

  const quadro: Ticket[] = []
  for (const [id, cru] of porTicket) {
    /**
     * By timestamp, not by arrival order.
     *
     * Recovered history brings old messages after new ones: without this,
     * reopening the app would change a ticket state by itself. Server order
     * breaks ties because two equal timestamps happen; our send with no echo
     * counts by the `seq` we saw when it went out, not by -1.
     */
    const lista = [...cru].sort((a, b) => a.marca.at - b.marca.at || a.ordem - b.ordem)

    /**
     * The FIRST opening is the one that counts.
     *
     * An altered client publishes whatever opening it wants, with someone else's
     * ticket id. If the last one won, it would be enough to reopen someone else's
     * ticket to become its owner, and owning it means gaining the right to change
     * its state.
     */
    const abertura = lista.find((item) => item.marca.subject !== undefined)
    const dono = abertura?.entrada.sender ?? ""

    let state: TicketState = "open"
    let assignee = ""
    let eliminado = false
    for (const { entrada, marca } of lista) {
      /*
        Ticket tombstone: only by a moderator, and only on a ticket that is ALREADY
        closed at this point in the order. It absorbs: what comes after (reopening,
        replying) does not bring it back. Close first is the step before this,
        like closing a room before deleting it.
      */
      if (marca.removed === true) {
        if (state === "closed" && podeModerar(entrada.sender)) {
          eliminado = true
          break
        }
        continue
      }
      const atende = podeAtender(entrada.sender)
      /**
       * The opener decides the STATE of what is theirs; naming who handles it
       * requires `atender`. Closing your own report is one thing, handing work to
       * someone else is another.
       *
       * A ticket with no readable opening has no known owner, so no one is
       * privileged: `dono` stays empty, no sender matches it, senders come
       * authenticated by MLS and are never empty, and only who handles it can
       * change it. It is the safe answer, and it is right: the other way would let
       * anyone command a ticket just because the opening did not reach this vault.
       */
      const proprio = entrada.sender === dono
      if (marca.state !== undefined && (atende || proprio)) {
        // A state this version does not know is a state it cannot draw, and the right
        // answer is to stay at the previous one. Making one up from an unknown name was
        // worse than not changing it.
        const conhecido = TICKET_STATES.find((nome) => nome === marca.state)
        if (conhecido) state = conhecido
      }
      if (marca.assignee !== undefined && atende) assignee = marca.assignee
    }

    if (eliminado) continue
    const ultima = lista[lista.length - 1]
    quadro.push({
      id,
      subject: abertura?.marca.subject ?? "",
      state,
      opener: dono,
      assignee,
      openedAt: abertura?.marca.at ?? lista[0]?.marca.at ?? 0,
      updatedAt: ultima?.marca.at ?? 0,
      messages: lista.length,
    })
  }

  /**
   * What needs doing ahead, and within each half the most recent first. It is the
   * order that serves whoever works the list: a closed ticket no longer asks
   * anything of anyone, and an open one that just changed is the one asking most.
   */
  return quadro.sort((a, b) => {
    const fechado = (t: Ticket): number => (t.state === "closed" ? 1 : 0)
    return fechado(a) - fechado(b) || b.updatedAt - a.updatedAt
  })
}

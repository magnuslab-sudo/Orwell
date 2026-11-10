import { strings } from "../../strings.js"
import type { MenuItem } from "../overlays/ContextMenu.js"
import { itemDoSilencio, type Silencio } from "../chat/menuItems.js"

/**
 * The menu for a DIRECT CONVERSATION, from wherever it came: the Friends list or the
 * channel bar. It was two menus, one with "Leave channel" and "Properties" and the
 * other with "Close conversation". The same conversation now has one menu.
 *
 * ```
 * Abrir · Marcar como lida
 * ‖ Ver perfil · Entrar em chamada · Entrar com vídeo (ou Sair da chamada)
 * ‖ Fechar conversa
 * ```
 *
 * Pure and separate from the screen, like all menus in the house: **what you cannot
 * do does not appear grayed out, it does not appear at all**. Here that matters in two
 * entries, and both would be easy to offer by mistake.
 *
 * What this menu does NOT have is as important as what it has: there is no "delete",
 * no "forget", nothing that undoes the encrypted group. The two-person
 * conversation does not erase from one side alone, and even if it could, nobody
 * wants to discover that by hitting the red button in a menu.
 */
export function itensDaConversa(ctx: {
  /** This conversation is the one open next to us: opening it does nothing. */
  ehAberta: boolean
  /** There are unread messages in this conversation. */
  porLer: boolean
  /**
   * The other person, if the channel identifier could be read.
   *
   * Null is rare. A channel with a strange name, or the list drawing itself
   * before the account loads. But without it there is no profile to visit, and
   * an entry that opens nothing is worse than a missing entry.
   */
  pessoa: string | null
  /** This account is in the call for this conversation: the gesture is to leave. */
  emChamada?: boolean | undefined
  /**
   * You can call this person: you are friends, or the server is in community
   * mode. That is the rule of the interface: a call is a private conversation.
   * Leaving an active call is always offered.
   */
  podeChamar?: boolean | undefined
  silencio?: Silencio | undefined
  accoes: {
    abrir: () => void
    marcarLida: () => void
    fechar: () => void
    verPerfil: () => void
    entrarNaChamada: () => void
    entrarComVideo: () => void
    sairDaChamada: () => void
  }
}): MenuItem[] {
  const itens: MenuItem[] = []

  // Opening the conversation that is already open is an entry that produces no
  // visible effect, and an entry like that reads as broken.
  if (!ctx.ehAberta) itens.push({ label: strings.menu.open, onSelect: ctx.accoes.abrir })

  // Only when there is something unread. Same rule as the channel menu.
  if (ctx.porLer) itens.push({ label: strings.menu.markReadDirect, onSelect: ctx.accoes.marcarLida })
  // Same place as in the channel menu.
  if (ctx.silencio) itens.push(itemDoSilencio(ctx.silencio))

  const antesDoBloco = itens.length
  if (ctx.pessoa) itens.push({ label: strings.userMenu.profile, onSelect: ctx.accoes.verPerfil })
  /*
    The call for this conversation: in a direct there are no voice rooms, and the
    call is of the conversation itself. Join with video next to it, because it is
    the same door.
    */
  if (ctx.emChamada) {
    itens.push({ label: strings.menu.leaveCall, destructive: true, onSelect: ctx.accoes.sairDaChamada })
  } else if (ctx.podeChamar) {
    itens.push({ label: strings.menu.joinCall, onSelect: ctx.accoes.entrarNaChamada })
    itens.push({ label: strings.menu.joinVideo, onSelect: ctx.accoes.entrarComVideo })
  }
  const primeiroDoBloco = itens[antesDoBloco]
  if (primeiroDoBloco && antesDoBloco > 0) itens[antesDoBloco] = { ...primeiroDoBloco, separatorBefore: true }

  /**
   * Close, and closing is not deleting. That is the distinction this file must
   * carry all the way through.
   *
   * The conversation leaves the list without losing anything: the MLS group stays
   * standing, the history stays in the vault, the person stays on the other side,
   * and the line comes back by itself as soon as a message arrives. See
   * `lib/directs.ts`.
   *
   * Without `destructive`, and on purpose. Red is the promise that something
   * gets destroyed; here nothing gets destroyed. Painting it red would confirm
   * exactly the fear that the hint next to it exists to ease. The same reasoning
   * left "delete category" without red.
   */
  itens.push({ label: strings.people.directClose, separatorBefore: true, onSelect: ctx.accoes.fechar })

  return itens
}

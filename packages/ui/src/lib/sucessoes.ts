import type { FriendTie } from "@enclave/protocol"
import type { Sucessao } from "../bridge.js"
import { tipoNaInterface } from "./tipoDoCanal.js"

/**
 * The account successions for the screens (phase 8.2, "Merge accounts").
 *
 * The core stores "@secondary became @primary" once per account. Here we decide
 * what that changes on the screen, in two places only:
 *
 * - **Hide.** The secondary no longer exists: it leaves friends, conversations,
 *   and member lists of those who got the warning. The history stays in the
 *   vault, as always; only the account does not show as if it still existed.
 * - **Offer, once.** To those who were friends, "Add?"; to those who can invite
 *   in a channel where they were, "Invite?". It never joins on its own: the
 *   phrase says who signed, and the action is the person's.
 */

/** An offer that the bell shows, with both buttons. */
export type OfertaDeSucessao =
  | { de: string; para: string; tipo: "amigo" }
  | { de: string; para: string; tipo: "canal"; canal: string }

/** The old accounts, to remove from lists. */
export function escondidasPorSucessao(sucessoes: Readonly<Record<string, Sucessao>>): ReadonlySet<string> {
  return new Set(Object.keys(sucessoes))
}

/**
 * What is offered to this account, by the order of accounts and channels.
 *
 * - Nothing to an account that is itself the primary (merged with itself on
 *   another device), or after `*` ("Not now" for everything).
 * - "Add?" if the secondary was a friend, if we have not yet replied, and if
 *   the primary is not already a friend or has a request in flight.
 * - "Invite?" for each channel where the warning arrived and where this account
 *   is still in and can invite. Direct chats and feeds are not channels to
 *   invite into.
 */
export function ofertasDeSucessao(
  sucessoes: Readonly<Record<string, Sucessao>>,
  contexto: {
    eu: string | null
    ties: ReadonlyMap<string, FriendTie>
    canais: readonly string[]
    podeConvidar: (canal: string) => boolean
  },
): OfertaDeSucessao[] {
  const ofertas: OfertaDeSucessao[] = []
  for (const [de, registo] of Object.entries(sucessoes)) {
    if (registo.para === contexto.eu || registo.feitos.includes("*")) continue
    const laco = contexto.ties.get(registo.para)?.link
    const jaLigado = laco === "amigos" || laco === "pedido-enviado" || laco === "cruzado" || laco === "pedido-recebido"
    if (registo.eraAmigo && !registo.feitos.includes("amigo") && !jaLigado) {
      ofertas.push({ de, para: registo.para, tipo: "amigo" })
    }
    for (const canal of registo.canais) {
      // By the card, not by the form (slice 3): you do not invite in a direct chat or a feed.
      if (tipoNaInterface(canal) === "directa" || tipoNaInterface(canal) === "mural") continue
      if (registo.feitos.includes(canal) || !contexto.canais.includes(canal) || !contexto.podeConvidar(canal)) continue
      ofertas.push({ de, para: registo.para, tipo: "canal", canal })
    }
  }
  return ofertas
}

/** The key of an offer, for React and for the button paused while it replies. */
export function chaveDaOferta(oferta: OfertaDeSucessao): string {
  return oferta.tipo === "amigo" ? `${oferta.de}|amigo` : `${oferta.de}|${oferta.canal}`
}

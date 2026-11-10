import type { AppNotification } from "./notifications.js"
import type { OfertaDeSucessao } from "./sucessoes.js"

/**
 * The bell as a timeline (design chosen by the owner on November 3, 2026):
 * filters in pills and groups by day. Rules only, no screen.
 */

export type FiltroDoSino = "tudo" | "mencoes" | "chamadas" | "convites" | "amigos"

/** The order of the pills. */
export const FILTROS_DO_SINO: readonly FiltroDoSino[] = ["tudo", "mencoes", "chamadas", "convites", "amigos"]

/**
 * Where each notification type lives, besides "All".
 *
 * Private messages (`dm-new`, `dm-message`) only show in "All": they are not
 * mentions (nobody wrote anybody's name), nor invites, nor requests. A
 * "Messages" pill would be the list of conversations again.
 *
 * Written as `Record`: a new bell type does not compile until someone decides
 * its filter.
 */
const FILTRO_DO_TIPO: Record<AppNotification["kind"], Exclude<FiltroDoSino, "tudo"> | null> = {
  mention: "mencoes",
  "missed-call": "chamadas",
  "room-added": "convites",
  "channel-join": "convites",
  "friend-request": "amigos",
  "friend-accept": "amigos",
  "dm-new": null,
  "dm-message": null,
  // A report on my channel only shows in "All": not a mention, invite, or friend request.
  "report-copy": null,
  // The decision on a report I made: also only in "All".
  "report-decision": null,
}

export function filtroDoTipo(kind: AppNotification["kind"]): Exclude<FiltroDoSino, "tudo"> | null {
  return FILTRO_DO_TIPO[kind]
}

export function entraNoFiltro(kind: AppNotification["kind"], filtro: FiltroDoSino): boolean {
  return filtro === "tudo" || FILTRO_DO_TIPO[kind] === filtro
}

/** Succession offers: "Add?" is for friends, "Invite?" for invites. */
export function ofertaEntraNoFiltro(oferta: OfertaDeSucessao, filtro: FiltroDoSino): boolean {
  return filtro === "tudo" || (oferta.tipo === "amigo" ? filtro === "amigos" : filtro === "convites")
}

export interface GrupoDoDia {
  /** `today`, `yesterday`, or the day (`YYYY-MM-DD`, local time). */
  dia: "hoje" | "ontem" | string
  /** A moment of the day, to write the date. */
  em: number
  entradas: AppNotification[]
}

function chaveDoDia(at: number): string {
  const data = new Date(at)
  const mes = String(data.getMonth() + 1).padStart(2, "0")
  const dia = String(data.getDate()).padStart(2, "0")
  return `${data.getFullYear()}-${mes}-${dia}`
}

/**
 * The list by days, most recent on top, by the local time of the reader.
 * "Yesterday" is the previous calendar day, not "less than 48 hours ago".
 */
export function agruparPorDia(entradas: readonly AppNotification[], agora: number): GrupoDoDia[] {
  const hoje = chaveDoDia(agora)
  const ontemData = new Date(agora)
  ontemData.setDate(ontemData.getDate() - 1)
  const ontem = chaveDoDia(ontemData.getTime())
  const grupos: GrupoDoDia[] = []
  const porDia = new Map<string, GrupoDoDia>()
  for (const entrada of [...entradas].sort((antes, depois) => depois.at - antes.at)) {
    const chave = chaveDoDia(entrada.at)
    let grupo = porDia.get(chave)
    if (!grupo) {
      grupo = { dia: chave === hoje ? "hoje" : chave === ontem ? "ontem" : chave, em: entrada.at, entradas: [] }
      porDia.set(chave, grupo)
      grupos.push(grupo)
    }
    grupo.entradas.push(entrada)
  }
  return grupos
}

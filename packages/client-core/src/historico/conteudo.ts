import { sha256 } from "@noble/hashes/sha2.js"
import { toBase64 } from "@enclave/protocol"
import { registarApelido, type RegistoDeApelido } from "../apelidos.js"
import { chavesDeOrdem, chaveDoEvento, venceCarimbo } from "../dobras.js"
import { registarFicha, type FichaDoCanal } from "../tipoDoCanal.js"
import {
  aplicarAtribuicao,
  canaisComEntradas,
  entradasDoCanal,
  entryMediaBytes,
  faltaMediaDaEntrada,
  semMediaPesada,
  videoNoCofre,
  type ItemDeMediaDoIrmao,
  type StoredChatMessage,
  type StoredPayload,
  type StoredPeerProfile,
  type VaultContents,
} from "../vault.js"

/**
 * What moves from one device to another on the same account in the device history
 * (1.0 "Arca", 29/10/2026), without network: the inventory, the pages, the
 * media list, and what merges into the receiver's vault.
 *
 * Network and times come from `historico.ts`. This reads and writes `VaultContents`,
 * and nothing else, to prove it without a session.
 */

/** A channel, as the sibling has it. */
export interface CanalNoInventario {
  c: string
  /** How many entries it holds (the conversation and the state log). */
  n: number
  /** The summary of entries (`resumoDoHistorico`). */
  h: string
  /** The timestamp of the newest entry: channels with newer conversation come first. */
  u: number
  /** The channel record (what it is), for whoever doesn't have it yet. */
  f?: FichaDoCanal
  /** The sibling was removed from this channel, and it stores the history: the time it happened. */
  a?: number
  /** The account's first position in this channel (the marker "You joined here"). `null`: from the start. */
  l?: { seq: number; em: number } | null
}

export interface Inventario {
  v: 1
  canais: CanalNoInventario[]
}

/** Channel records that are not entries: rooms and pinned, categories, roles, foundation, description, nicknames. */
export interface RegistosDoCanal {
  salas?: Record<string, StoredPeerProfile>
  categorias?: Record<string, StoredPeerProfile>
  cargos?: Record<string, StoredPeerProfile>
  atribuicoes?: Record<string, string[]>
  atribuicoesAt?: Record<string, { at: number; seq?: number; por?: string }>
  fundador?: { address: string; seq: number; payload?: StoredPayload }
  admins?: string[]
  apresentacao?: StoredPeerProfile
  apelidos?: Record<string, RegistoDeApelido>
}

/** A page of entries from a channel, by sort key, after `since`. */
export interface PaginaDoHistorico {
  c: string
  e: StoredChatMessage[]
  /** The sort key of the page's last entry. `null` if the page is empty. */
  ate: number | null
  /** No more entries exist after this page. */
  fim: boolean
  /** Channel records, only on the first page. */
  r?: RegistosDoCanal
}

/** What heavy media the sibling has. */
export type MediaNoIrmao = { c: string; e: string; b: number } | { v: string; b: number } | { a: string; at: number; b: number }

/** A complete media item, as it goes in the response. */
export type MediaInteira =
  | { c: string; e: string; p: StoredPayload }
  | { v: string; b64: string; at: number }
  | { a: string; perfil: StoredPeerProfile }

/**
 * The numbers. Mutable only for tests to lower them.
 */
export const TECTOS_DO_HISTORICO = {
  /**
   * An attachment up to this size (in base64 characters) goes with the text. Larger
   * ones go at the end, in the background. 48 KB is a small photo or a card
   * thumbnail: the text doesn't wait for them.
   */
  mediaComOTexto: 48 * 1024,
  /** The JSON of a page stays below this before compression (about 3 bytes after compression). */
  bytesPorPagina: 96 * 1024,
  /** And never more than this many entries. */
  entradasPorPagina: 400,
  /** The JSON of a media response stays below this, except the first item (which always goes). */
  bytesPorRespostaDeMedia: 2 * 1024 * 1024,
  /** Items per media request. */
  itensPorPedidoDeMedia: 8,
}

// ------------------------------------------------------------------ o resumo

/**
 * The summary of a channel: SHA-256 of the sorted list of entry identities
 * (the server's `seq`, or `tipo|autor|id` in a send without echo), truncated
 * to 12 bytes. Two devices with the same entries give the same summary,
 * regardless of the order they received them in.
 */
export function resumoDoHistorico(contents: VaultContents, canal: string): string {
  const ids: string[] = []
  for (const entrada of entradasDoCanal(contents, canal)) {
    if (entrada.seq >= 0) ids.push(`s${entrada.seq}`)
    else {
      const chave = chaveDoEvento(entrada)
      if (chave !== null) ids.push(`k${chave}`)
    }
  }
  ids.sort()
  return toBase64(sha256(new TextEncoder().encode(ids.join("\n"))).subarray(0, 12))
}

// ------------------------------------------------------------ who responds

export interface ContextoDoIrmao {
  /** The account's channel: never joins. */
  canalDaConta: string
  /** Whether this device has the channel's group (is a member). */
  temGrupo: (canal: string) => boolean
  /** The account's first position in the channel, as this device knows it. `undefined`: unknown. */
  lugar: (canal: string) => { seq: number; em: number } | null | undefined
}

/** The inventory of this vault: channels with entries, newest conversation first. */
export function inventarioDe(contents: VaultContents, contexto: ContextoDoIrmao): Inventario {
  const canais: CanalNoInventario[] = []
  for (const c of canaisComEntradas(contents)) {
    if (c === contexto.canalDaConta) continue
    const entradas = entradasDoCanal(contents, c)
    if (entradas.length === 0) continue
    const u = entradas.reduce((maior, entrada) => (entrada.at > maior ? entrada.at : maior), 0)
    const ficha = contents.fichasDosCanais?.[c]
    const arquivado = contents.canaisArquivados?.[c]
    const lugar = contexto.lugar(c)
    canais.push({
      c,
      n: entradas.length,
      h: resumoDoHistorico(contents, c),
      u,
      ...(ficha ? { f: ficha } : {}),
      ...(arquivado !== undefined && !contexto.temGrupo(c) ? { a: arquivado } : {}),
      ...(lugar !== undefined ? { l: lugar } : {}),
    })
  }
  canais.sort((a, b) => b.u - a.u)
  return { v: 1, canais }
}

/**
 * A page of the channel after `since` (the sort key of the last entry the
 * requester already has; `null` is the start). Heavy media is dropped (see
 * `TECTOS_DO_HISTORICO.mediaComOTexto`); the first page carries the records.
 *
 * A page never splits a group of entries with the same sort key: the
 * next cursor is "after this key", and the rest of the group would be lost.
 */
export function paginaDe(contents: VaultContents, canal: string, desde: number | null): PaginaDoHistorico {
  const todas = entradasDoCanal(contents, canal)
  const chaves = chavesDeOrdem(todas)
  /*
    By key, not by position: the vault's two lists are not always
    sorted (a report enters at the end with an old `seq`). An entry out
    of order after a page cut had a key below the next cursor,
    and would be lost. Keys are taken before sorting: one from an
    old unsent message without `apos` depends on where it sits.
  */
  const ordenadas = todas
    .map((entrada, indice) => ({ entrada, chave: chaves[indice] ?? -1, indice }))
    .filter(({ chave }) => desde === null || chave > desde)
    .sort((a, b) => a.chave - b.chave || a.indice - b.indice)
  const e: StoredChatMessage[] = []
  let bytes = 0
  let ate: number | null = null
  let corte = 0
  for (; corte < ordenadas.length; corte++) {
    const { entrada, chave } = ordenadas[corte] as (typeof ordenadas)[number]
    const cheia = bytes >= TECTOS_DO_HISTORICO.bytesPorPagina || e.length >= TECTOS_DO_HISTORICO.entradasPorPagina
    if (cheia && chave !== ate) break
    const { payload } = semMediaPesada(entrada.payload, TECTOS_DO_HISTORICO.mediaComOTexto)
    // An unsent message carries the sort key as `apos`: the other side doesn't have
    // the entries ahead of it to deduce it.
    const copia: StoredChatMessage = { ...entrada, payload, ...(entrada.seq < 0 ? { apos: entrada.apos ?? chave } : {}) }
    e.push(copia)
    bytes += JSON.stringify(copia).length
    ate = chave
  }
  return { c: canal, e, ate, fim: corte >= ordenadas.length, ...(desde === null ? { r: registosDe(contents, canal) } : {}) }
}

function registosDe(contents: VaultContents, canal: string): RegistosDoCanal {
  const r: RegistosDoCanal = {}
  const salas = contents.channelRooms[canal]
  if (salas && Object.keys(salas).length > 0) r.salas = salas
  const categorias = contents.channelCategories?.[canal]
  if (categorias && Object.keys(categorias).length > 0) r.categorias = categorias
  const cargos = contents.channelRoles[canal]
  if (cargos && Object.keys(cargos).length > 0) r.cargos = cargos
  const atribuicoes = contents.channelMemberRoles[canal]
  if (atribuicoes && Object.keys(atribuicoes).length > 0) r.atribuicoes = atribuicoes
  const atribuicoesAt = contents.channelMemberRolesAt?.[canal]
  if (atribuicoesAt && Object.keys(atribuicoesAt).length > 0) r.atribuicoesAt = atribuicoesAt
  const fundador = contents.channelFounder[canal]
  if (fundador) r.fundador = fundador
  const admins = contents.channelAdmins[canal]
  if (admins && admins.length > 0) r.admins = admins
  const apresentacao = contents.spaceMeta[canal]
  if (apresentacao) r.apresentacao = apresentacao
  const apelidos = (contents as VaultContents & { apelidosDoCanal?: Record<string, Record<string, RegistoDeApelido>> })
    .apelidosDoCanal?.[canal]
  if (apelidos && Object.keys(apelidos).length > 0) r.apelidos = apelidos
  return r
}

/**
 * What heavy media this vault has: entries with bytes (only those with
 * `id`, which is how the receiver finds them), stored videos, and
 * profiles with avatars. `channels` limits to entries from those channels (resync
 * between already paired siblings); without it, everything.
 */
export function mediaDe(contents: VaultContents, eu: string, canais?: readonly string[]): MediaNoIrmao[] {
  const itens: MediaNoIrmao[] = []
  const so = canais ? new Set(canais) : null
  for (const c of canaisComEntradas(contents)) {
    if (so && !so.has(c)) continue
    for (const entrada of entradasDoCanal(contents, c)) {
      const b = entryMediaBytes(entrada)
      const e = chaveDoEvento(entrada)
      if (b > 0 && e !== null) itens.push({ c, e, b })
    }
  }
  if (!so) {
    for (const [v, video] of Object.entries(contents.videos ?? {})) itens.push({ v, b: video.b64.length })
    for (const [a, perfil] of Object.entries(contents.directory)) {
      if (a === eu || perfil.parcial) continue
      const retrato = retratoDe(perfil.payload)
      if (retrato > 0) itens.push({ a, at: perfil.at, b: retrato })
    }
  }
  return itens
}

/** The characters of an avatar from a stored profile. The profile carries it in `avatar.inline` or in `avatarDataUrl`. */
function retratoDe(payload: StoredPayload): number {
  const avatar = payload["avatar"]
  if (typeof avatar === "object" && avatar !== null && typeof (avatar as Record<string, unknown>)["inline"] === "string") {
    return ((avatar as Record<string, unknown>)["inline"] as string).length
  }
  const url = payload["avatarDataUrl"]
  return typeof url === "string" ? url.length : 0
}

/** The requested items, complete, up to the response byte limit (the first always goes). An item no longer here is left out. */
export function mediaInteiraDe(
  contents: VaultContents,
  eu: string,
  pedidos: readonly ItemDeMediaDoIrmao[],
): { itens: MediaInteira[]; resto: number } {
  const itens: MediaInteira[] = []
  let bytes = 0
  for (let indice = 0; indice < pedidos.length; indice++) {
    const pedido = pedidos[indice] as ItemDeMediaDoIrmao
    let item: MediaInteira | null = null
    if ("c" in pedido) {
      const entrada = entradasDoCanal(contents, pedido.c).find((e) => chaveDoEvento(e) === pedido.e)
      if (entrada && entryMediaBytes(entrada) > 0) item = { c: pedido.c, e: pedido.e, p: entrada.payload }
    } else if ("v" in pedido) {
      const b64 = videoNoCofre(contents, pedido.v)
      const at = contents.videos?.[pedido.v]?.at ?? 0
      if (b64 !== null) item = { v: pedido.v, b64, at }
    } else if (pedido.a !== eu) {
      const perfil = contents.directory[pedido.a]
      if (perfil && !perfil.parcial) item = { a: pedido.a, perfil }
    }
    if (!item) continue
    const tamanho = JSON.stringify(item).length
    // `rest`: requests not served because of the limit, and the requester asks again.
    if (itens.length > 0 && bytes + tamanho > TECTOS_DO_HISTORICO.bytesPorRespostaDeMedia) return { itens, resto: pedidos.length - indice }
    itens.push(item)
    bytes += tamanho
  }
  return { itens, resto: 0 }
}

// ---------------------------------------------------------------- who requests

/** Whether this vault doesn't have the media item the sibling has, and whether it's worth asking for. */
export function faltaAqui(contents: VaultContents, item: MediaNoIrmao): boolean {
  if ("c" in item) return faltaMediaDaEntrada(contents, item.c, item.e, item.b)
  if ("v" in item) return videoNoCofre(contents, item.v) === null
  const aqui = contents.directory[item.a]
  if (!aqui || aqui.parcial || aqui.at < item.at) return true
  return aqui.at === item.at && retratoDe(aqui.payload) === 0
}

/** The caller's request for an item from the sibling's list, without the size. */
export function pedidoDe(item: MediaNoIrmao): ItemDeMediaDoIrmao {
  if ("c" in item) return { c: item.c, e: item.e }
  if ("v" in item) return { v: item.v }
  return { a: item.a }
}

/** The key of an item to find it in the plan's list. */
export function chaveDoItem(item: ItemDeMediaDoIrmao): string {
  if ("c" in item) return `e|${item.c}|${item.e}`
  if ("v" in item) return `v|${item.v}`
  return `a|${item.a}`
}

/**
 * The records of the channel that the sibling had, stored in this vault. Each
 * one follows its record rule (`venceCarimbo`, with the foundation first), as
 * if the events had arrived here. The sibling has already validated the records
 * (the sibling decides what goes where), and the sibling is the account itself.
 */
export function fundirRegistosDoIrmao(contents: VaultContents, canal: string, r: RegistosDoCanal): void {
  const porCarimbo = (
    guardados: Record<string, StoredPeerProfile> | undefined,
    vindos: Record<string, StoredPeerProfile> | undefined,
  ): Record<string, StoredPeerProfile> | undefined => {
    if (!vindos) return guardados
    const juntos = { ...guardados }
    for (const [id, registo] of Object.entries(vindos)) {
      if (!registoValido(registo)) continue
      if (venceCarimbo(juntos[id], registo)) juntos[id] = structuredClone(registo)
    }
    return juntos
  }
  const salas = porCarimbo(contents.channelRooms[canal], r.salas)
  if (salas) contents.channelRooms[canal] = salas
  const categorias = porCarimbo(contents.channelCategories?.[canal], r.categorias)
  if (categorias) contents.channelCategories = { ...contents.channelCategories, [canal]: categorias }
  const cargos = porCarimbo(contents.channelRoles[canal], r.cargos)
  if (cargos) contents.channelRoles[canal] = cargos
  for (const [address, roles] of Object.entries(r.atribuicoes ?? {})) {
    if (!Array.isArray(roles) || !roles.every((role) => typeof role === "string")) continue
    const carimbo = r.atribuicoesAt?.[address]
    aplicarAtribuicao(contents, canal, address, roles, {
      at: typeof carimbo?.at === "number" ? carimbo.at : 0,
      seq: typeof carimbo?.seq === "number" ? carimbo.seq : -1,
      por: typeof carimbo?.por === "string" ? carimbo.por : "",
    })
  }
  if (r.fundador && typeof r.fundador.address === "string" && !contents.channelFounder[canal]) {
    contents.channelFounder[canal] = structuredClone(r.fundador)
  }
  if (Array.isArray(r.admins) && !contents.channelAdmins[canal]) {
    contents.channelAdmins[canal] = r.admins.filter((admin) => typeof admin === "string")
  }
  if (r.apresentacao && registoValido(r.apresentacao) && venceCarimbo(contents.spaceMeta[canal], r.apresentacao)) {
    contents.spaceMeta[canal] = structuredClone(r.apresentacao)
  }
  for (const [subject, apelido] of Object.entries(r.apelidos ?? {})) {
    if (typeof apelido?.valor !== "string" || typeof apelido.at !== "number") continue
    registarApelido(contents, canal, subject, apelido)
  }
}

function registoValido(registo: unknown): registo is StoredPeerProfile {
  if (typeof registo !== "object" || registo === null) return false
  const { at, payload } = registo as Record<string, unknown>
  return typeof at === "number" && typeof payload === "object" && payload !== null && typeof (payload as Record<string, unknown>)["t"] === "string"
}

/** The channel metadata that the sibling reported, if this vault does not have it yet. */
export function fichaDoIrmao(contents: VaultContents, canal: string, ficha: FichaDoCanal | undefined): void {
  if (!ficha || !["directa", "mural", "sala"].includes(ficha.tipo)) return
  registarFicha(contents, canal, ficha)
}

/**
 * An entry as it came from the wire, if it has the shape of a vault entry. The
 * sibling is the account itself, but a faulty vault does not reject the transfer.
 */
export function entradaValida(valor: unknown): valor is StoredChatMessage {
  if (typeof valor !== "object" || valor === null) return false
  const e = valor as Record<string, unknown>
  return (
    typeof e["seq"] === "number" &&
    Number.isSafeInteger(e["seq"]) &&
    typeof e["sender"] === "string" &&
    typeof e["at"] === "number" &&
    typeof e["payload"] === "object" &&
    e["payload"] !== null &&
    typeof (e["payload"] as Record<string, unknown>)["t"] === "string"
  )
}

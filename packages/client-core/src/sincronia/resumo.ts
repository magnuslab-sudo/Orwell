import { sha256 } from "@noble/hashes/sha2.js"
import {
  entradasDoCanal,
  type StoredChatMessage,
  type StoredPayload,
  type StoredPeerProfile,
  type VaultContents,
} from "../vault.js"

/**
 * The summary of a channel, calculated locally and without networking (phase S0
 * of the plan `docs/planos/2026-10-20-sincronia-absoluta.md`, §4.2).
 *
 * It says, in few bytes, what this device has in a channel. It has three levels
 * and only descends when there is a difference:
 *
 * - level 0, by type: count and the first 8 bytes of SHA-256 of ordered keys;
 * - level 1, by bucket: the same pair, for each bucket of a type;
 * - level 2, by item: the key of each item, reduced to 6 bytes of SHA-256.
 *
 * **Measures only.** Nothing here travels or changes the vault. Reads
 * `VaultContents` and nothing else, because phase S0 does not touch `session.ts`
 * or `vault.ts`. What the summary needed and the vault does not store is
 * written in `docs/planos/2026-10-20-sincronia-S0-medidas.md`, in the list for
 * S1 and S4.
 *
 * **Deterministic.** The history order does not enter the result: keys are a
 * set, ordered before the hash, and folds (reactions, tie) order the input by
 * `seq` and timestamp before folding. This is the property that
 * `resumo.test.ts` proves by shuffling.
 */

/** The summary types, in this order. Add at the END: the order is the S4 thread. */
export const TIPOS_DO_RESUMO = [
  "mensagem",
  "edicao",
  "apagamento",
  "reaccao",
  "convite",
  "ticket",
  "publicacao",
  "comentario",
  "gosto",
  "voto",
  "fundador",
  "cargo",
  "atribuicao",
  "letreiro",
  "categoria",
  "sala",
  "fixadas",
  "perfil",
  "amigos-mostrados",
  "laco",
] as const
export type TipoDoResumo = (typeof TIPOS_DO_RESUMO)[number]

/**
 * The types with a window (§4.2): two accounts with different places have
 * different conversations, and both are correct. The wall and state have no
 * window.
 */
export const TIPOS_COM_JANELA: ReadonlySet<TipoDoResumo> = new Set(["mensagem", "edicao", "apagamento", "reaccao"])

/**
 * Whether the time window applies to THIS item. Windowed types, except a tombstone
 * for a wall target (`semJanela`): a tombstone for a post or comment is wall state, and
 * anyone joining after it needs it so the post does not reappear.
 */
export function comJanela(item: Pick<ItemDoResumo, "tipo" | "semJanela">): boolean {
  return TIPOS_COM_JANELA.has(item.tipo) && item.semJanela !== true
}

export interface ItemDoResumo {
  tipo: TipoDoResumo
  balde: string
  chave: string
  /** A tombstone whose target is on the wall: it has no window. See `comJanela`. */
  semJanela?: true
  /**
   * Where the item comes from, for the report (phase S4): the stored payload,
   * who wrote it, and the origin `seq`. Absent in items that are not reported
   * (profiles, shown friends, tie, pinned: they have their own path, or decide
   * access).
   */
  fonte?: FonteDoItem
}

/** What a report needs from an item. References are from the vault: who changes them, clones. */
export interface FonteDoItem {
  autor: string
  seq: number
  apos?: number
  payload: StoredPayload
}

/** Count and the first 8 bytes of SHA-256 of ordered keys, in hex. */
export interface ParDoResumo {
  n: number
  h: string
}

export type ResumoNivel0 = Record<TipoDoResumo, ParDoResumo>

export interface OpcoesDoResumo {
  /**
   * The `seq` of the commit that seated the caller. Only windowed types use it.
   * Missing: no window.
   *
   * An entry of ours with `seq` -1 (send without echo, or old send from a 0.6.0
   * that will never have it) enters by the order mark: `apos + 1 >= desde`. Without
   * `apos`, we don't know where it lands, and the window rule doesn't return what it
   * can't place: it stays out. See `dentroDaJanela`.
   */
  desde?: number
  /**
   * The channel members, for profiles and shown friends. The vault does not
   * store the member list (it lives in MLS state): the caller provides it,
   * usually `session.membersOf(canal)`. Missing: no profiles.
   */
  membros?: readonly string[]
  /**
   * The address of this device. Our own profile is not in `directory`, it is in
   * `profile`. Without this, our profile stays out of the summary and the
   * profile summary always differs from other members.
   */
  proprio?: string
  /**
   * With items that have a tombstone. By default they stay out (the summary says
   * what you see); who receives a report wants the full set, so a deleted item
   * counts as "we already have it".
   */
  comApagados?: boolean
}

/**
 * What anti-entropy stores in the vault and the summary reads (a loose field, like
 * `revokedDevices`; the writer is `pedido.ts`).
 */
export interface CofreDaSincronia {
  sincronia?: {
    /**
     * Per channel, the `seq` of the last commit that added someone. A message
     * before this is not reported: the report goes encrypted to the ENTIRE
     * group, and who joined after it would read what was said before their place
     * (decision 2a). The `l` that the request brings is said by the requester
     * and we do not trust it for this.
     */
    piso?: Record<string, number>
    /** Channels before S4 already got the conservative floor. */
    migrado?: true
    /**
     * Per channel, the targets of tombstones known to be on the wall but not held
     * in the vault: they arrived via telemetry below the window, and only a wall
     * tombstone comes this way. Without this, someone who never had the post would
     * put its tombstone in the window, and their summary would differ from someone
     * who has it. See `itensDoCanal`.
     */
    alvosDoMural?: Record<string, string[]>
    /** Bytes of telemetry sent per channel and per day (`AAAA-MM-DD|canal`). See `#gastarDoDia`. */
    bytesDoDia?: Record<string, number>
    /**
     * Per channel, the FIRST place of this device (S5): the `seq` of the Welcome
     * that seated it and the server time of that commit, in ms. For the UI to
     * mark "You joined here" (§2.5). Only the first: a reseat does not change
     * what is said to the person, because the conversation between the two
     * places stayed in the vault. Who created the channel has no record (they
     * have everything).
     */
    lugares?: Record<string, { seq: number; em: number }>
  }
}

/**
 * The tombstones of a channel, everywhere in the vault and without window: the
 * target and who asked to delete it, and the author of each `id` that the vault
 * knows.
 */
export interface Lapides {
  porAlvo: Map<string, Set<string>>
  autorDe: Map<string, string>
}

export function lapidesDoCanal(contents: VaultContents, canal: string): Lapides {
  const porAlvo = new Map<string, Set<string>>()
  const autorDe = new Map<string, string>()
  for (const entrada of entradasDoCanal(contents, canal)) notarNasLapides(porAlvo, autorDe, entrada.sender, entrada.payload)
  return { porAlvo, autorDe }
}

/** Add an event to the tombstones (who receives a batch of reports keeps appending). */
export function notarLapide(lapides: Lapides, autor: string, payload: StoredPayload): void {
  notarNasLapides(lapides.porAlvo, lapides.autorDe, autor, payload)
}

function notarNasLapides(porAlvo: Map<string, Set<string>>, autorDe: Map<string, string>, autor: string, p: StoredPayload): void {
  if (p.t === "redact") {
    const alvo = p["target"]
    if (typeof alvo !== "string") return
    const quem = porAlvo.get(alvo)
    if (quem) quem.add(autor)
    else porAlvo.set(alvo, new Set([autor]))
    return
  }
  const id = p["id"]
  if (typeof id === "string" && !autorDe.has(id)) autorDe.set(id, autor)
}

/**
 * If this item has a tombstone that counts, under the fold rule (`emendasDe`,
 * `dobrarEnvolvimento`): only the tombstone from the TARGET's author erases it.
 * A tombstone from someone else removes nothing from the screen, and therefore
 * nothing from the summary either.
 *
 * - An item with `id`: erased if its author requested it.
 * - An edit: the target erased by the edit's author (only the author's count).
 * - A reaction: the target erased by the target's author. Without the target in
 *   the vault we do not know who wrote it, so any tombstone for it counts: we err
 *   on the side of erasure.
 * - The tombstone itself: never.
 */
export function itemApagado(lapides: Lapides, tipo: TipoDoResumo, autor: string, p: StoredPayload): boolean {
  if (tipo === "apagamento") return false
  if (tipo === "edicao" || tipo === "reaccao") {
    const alvo = p["target"]
    if (typeof alvo !== "string") return false
    const quem = lapides.porAlvo.get(alvo)
    if (!quem) return false
    if (tipo === "edicao") return quem.has(autor)
    const autorDoAlvo = lapides.autorDe.get(alvo)
    return autorDoAlvo === undefined ? quem.size > 0 : quem.has(autorDoAlvo)
  }
  const id = p["id"]
  return typeof id === "string" && lapides.porAlvo.get(id)?.has(autor) === true
}

const CANAL = "canal"

/** UTC day of the author's timestamp. An invalid timestamp falls into its own bucket. */
function dia(ms: unknown): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "sem-data"
  const data = new Date(ms)
  return Number.isNaN(data.getTime()) ? "sem-data" : data.toISOString().slice(0, 10)
}

const texto = (valor: unknown): string => (typeof valor === "string" ? valor : "")
const numero = (valor: unknown, alternativa: number): number => (typeof valor === "number" ? valor : alternativa)

/**
 * Server order, with our sends (`seq` -1) at the end, by timestamp.
 * Final tiebreaker is the key, so order does not depend on anything local.
 */
function porOrdem(a: StoredChatMessage, b: StoredChatMessage): number {
  const sa = chaveDeOrdem(a)
  const sb = chaveDeOrdem(b)
  if (sa !== sb) return sa < sb ? -1 : 1
  if (a.at !== b.at) return a.at - b.at
  return a.sender < b.sender ? -1 : a.sender > b.sender ? 1 : 0
}

/**
 * Where an entry falls in server order. Our send without echo (`seq` -1)
 * falls right after the highest `seq` we saw when it left (`apos`, phase S1);
 * without `apos`, at the end.
 */
function chaveDeOrdem(entrada: StoredChatMessage): number {
  if (entrada.seq >= 0) return entrada.seq
  return entrada.apos !== undefined && entrada.apos >= -1 ? entrada.apos + 0.5 : Number.POSITIVE_INFINITY
}

/**
 * Whether an entry is inside the window that starts at `desde` (the `seq` of the place).
 *
 * With server `seq`, compare the `seq`. Our send without echo (`seq` -1)
 * uses the order mark: it left after `apos`, so its real `seq` is at least
 * `apos + 1`. Old sends (0.6.0) stay at -1 forever, and keeping them out of
 * the window would give false divergence against those who got them with `seq`.
 * Without `apos` we do not know where it falls, and the place rule does not
 * give what it cannot locate: it stays out.
 */
export function dentroDaJanela(entrada: Pick<StoredChatMessage, "seq" | "apos">, desde: number): boolean {
  if (entrada.seq >= 0) return entrada.seq >= desde
  return entrada.apos !== undefined && entrada.apos + 1 >= desde
}

/**
 * The item of a payload written by `autor`, or nothing if it does not count for
 * the summary. It is the same rule for what is in the vault and for what
 * arrives in a report (phase S4): whoever receives a report asks here if they
 * already have it.
 *
 * `canal` only serves the banner, whose entity is the channel.
 */
export function itemDoPayload(autor: string, p: StoredPayload, canal = ""): ItemDoResumo | null {
  switch (p.t) {
    case "message": {
      const id = texto(p["id"])
      const ticket = p["ticket"] as { id?: unknown } | undefined
      // A ticket act is board state, not chat: bucket by ticket.
      if (ticket && typeof ticket.id === "string") return { tipo: "ticket", balde: ticket.id, chave: `ticket|${autor}|${id}` }
      if (p["invite"] || p["inviteReply"]) return { tipo: "convite", balde: dia(p["sentAt"]), chave: `convite|${autor}|${id}` }
      return { tipo: "mensagem", balde: dia(p["sentAt"]), chave: `mensagem|${autor}|${id}` }
    }
    case "edit":
      return { tipo: "edicao", balde: dia(p["editedAt"]), chave: `edicao|${autor}|${texto(p["id"])}` }
    case "redact":
      return { tipo: "apagamento", balde: dia(p["redactedAt"]), chave: `apagamento|${autor}|${texto(p["id"])}` }
    case "post":
      return { tipo: "publicacao", balde: dia(p["postedAt"]), chave: `publicacao|${autor}|${texto(p["id"])}` }
    case "post.comment":
      return { tipo: "comentario", balde: dia(p["postedAt"]), chave: `comentario|${autor}|${texto(p["id"])}` }
    case "post.reaction": {
      const tipo: TipoDoResumo = typeof p["vote"] === "number" ? "voto" : "gosto"
      return { tipo, balde: dia(p["at"]), chave: `${tipo}|${autor}|${texto(p["id"])}` }
    }
    case "reaction":
      // Only the act that gets posted counts; a `remove` is not an item, it is the absence of it.
      if (p["remove"] === true) return null
      return { tipo: "reaccao", balde: "", chave: `reaccao|${autor}|${texto(p["target"])}|${texto(p["emoji"])}` }
    case "room.created":
      return { tipo: "fundador", balde: CANAL, chave: `fundador|${autor}` }
    case "role.define": {
      const papel = texto(p["role"])
      return { tipo: "cargo", balde: papel, chave: `cargo|${papel}|-|${numero(p["definedAt"], 0)}` }
    }
    case "role.assign": {
      const sujeito = texto(p["subject"])
      const papeis = Array.isArray(p["roles"]) ? (p["roles"] as unknown[]).map(texto) : []
      return { tipo: "atribuicao", balde: sujeito, chave: `atribuicao|${sujeito}|${[...papeis].sort().join(",")}` }
    }
    case "space.meta":
      return { tipo: "letreiro", balde: CANAL, chave: `letreiro|${canal}|-|${numero(p["updatedAt"], 0)}` }
    case "channel.category": {
      const categoria = texto(p["category"])
      return { tipo: "categoria", balde: categoria, chave: `categoria|${categoria}|-|${numero(p["updatedAt"], 0)}` }
    }
    case "channel.meta": {
      const sala = texto(p["room"])
      return { tipo: "sala", balde: sala, chave: `sala|${sala}|-|${numero(p["updatedAt"], 0)}` }
    }
    default:
      return null
  }
}

/** Types that only count through history (the others come from their own records). */
const TIPOS_DO_HISTORICO: ReadonlySet<TipoDoResumo> = new Set([
  "mensagem",
  "edicao",
  "apagamento",
  "convite",
  "ticket",
  "publicacao",
  "comentario",
  "gosto",
  "voto",
])

/** The item of a history entry, with the source. */
function itemDaEntrada(entrada: StoredChatMessage): ItemDoResumo | null {
  const item = itemDoPayload(entrada.sender, entrada.payload)
  if (!item || !TIPOS_DO_HISTORICO.has(item.tipo)) return null
  return { ...item, fonte: fonteDe(entrada) }
}

function fonteDe(entrada: StoredChatMessage): FonteDoItem {
  return {
    autor: entrada.sender,
    seq: entrada.seq,
    ...(entrada.apos !== undefined ? { apos: entrada.apos } : {}),
    payload: entrada.payload,
  }
}

/** The source of a record with timestamp, if the vault knows who wrote it. */
function fonteDoRegisto(guardado: StoredPeerProfile): FonteDoItem | undefined {
  if (guardado.por === undefined) return undefined
  return { autor: guardado.por, seq: guardado.seq ?? -1, payload: guardado.payload }
}

/**
 * All items in a channel, as the summary counts them.
 *
 * Exposed for tests and for the measurement script: it is the list from which
 * the three levels come, and it is what gets compared when two level 0s differ.
 */
export function itensDoCanal(contents: VaultContents, canal: string, opcoes: OpcoesDoResumo = {}): ItemDoResumo[] {
  const itens: ItemDoResumo[] = []
  // The two vault lists (chat and state book, phase S2).
  const historia = entradasDoCanal(contents, canal)
  const desde = opcoes.desde

  /*
    A gravestone on a wall target has no window (see `comJanela`). The target
    is decided by what the vault has: if it has it, by its type; if not, by
    targets that arrived by report below the window (`alvosDoMural`), which
    can only be from the wall. A message cut by the chat cap has no target and
    no mark: it keeps its window, as in those who still have it.
  */
  const tipoDoAlvo = new Map<string, TipoDoResumo>()
  for (const entrada of historia) {
    const id = entrada.payload["id"]
    if (typeof id !== "string" || entrada.payload.t === "redact" || entrada.payload.t === "edit") continue
    const doAlvo = itemDoPayload(entrada.sender, entrada.payload)
    if (doAlvo && !tipoDoAlvo.has(id)) tipoDoAlvo.set(id, doAlvo.tipo)
  }
  const doMural = new Set((contents as CofreDaSincronia).sincronia?.alvosDoMural?.[canal] ?? [])
  const alvoDoMural = (alvo: unknown): boolean => {
    if (typeof alvo !== "string") return false
    const tipo = tipoDoAlvo.get(alvo)
    return tipo !== undefined ? !TIPOS_COM_JANELA.has(tipo) : doMural.has(alvo)
  }

  // Chat, wall and tickets: one item per event with `id`.
  for (const entrada of historia) {
    const bruto = itemDaEntrada(entrada)
    if (!bruto) continue
    const item: ItemDoResumo = bruto.tipo === "apagamento" && alvoDoMural(entrada.payload["target"]) ? { ...bruto, semJanela: true } : bruto
    if (desde !== undefined && comJanela(item) && !dentroDaJanela(entrada, desde)) continue
    itens.push(item)
  }

  // Chat reactions: no `id`, so they fold. The last act of each (author, target, emoji)
  // counts, and only what got posted enters.
  const ordenada = [...historia].sort(porOrdem)
  const reaccoes = new Map<string, StoredChatMessage>()
  const lacos = new Map<string, string>()
  for (const entrada of ordenada) {
    const p = entrada.payload
    if (p.t === "reaction") {
      if (desde !== undefined && !dentroDaJanela(entrada, desde)) continue
      reaccoes.set(`reaccao|${entrada.sender}|${texto(p["target"])}|${texto(p["emoji"])}`, entrada)
    } else if (p.t.startsWith("friend.") && p.t !== "friends.shown") {
      // State book of a direct: the last act of each side, by server order.
      lacos.set(entrada.sender, p.t)
    }
  }
  for (const [chave, entrada] of reaccoes) {
    if (entrada.payload["remove"] !== true) itens.push({ tipo: "reaccao", balde: dia(entrada.at), chave, fonte: fonteDe(entrada) })
  }
  for (const [autor, acto] of lacos) itens.push({ tipo: "laco", balde: autor, chave: `laco|${autor}|${acto}` })

  // State with its own record. The key does not carry the author (stays "-"): a
  // vault before S1 does not store it, and a key that depended on it would give
  // false divergence between those who know it and those who do not. The entity
  // and timestamp of the winning version come to state it.
  const fundador = contents.channelFounder[canal]
  if (fundador) {
    itens.push({
      tipo: "fundador",
      balde: CANAL,
      chave: `fundador|${fundador.address}`,
      ...(fundador.payload ? { fonte: { autor: fundador.address, seq: fundador.seq, payload: fundador.payload } } : {}),
    })
  }

  for (const [papel, guardado] of Object.entries(contents.channelRoles[canal] ?? {})) {
    const carimbo = numero(guardado.payload["definedAt"], guardado.at)
    const fonte = fonteDoRegisto(guardado)
    itens.push({ tipo: "cargo", balde: papel, chave: `cargo|${papel}|-|${carimbo}`, ...(fonte ? { fonte } : {}) })
  }

  // Assignments: the full list per person. The vault does not store the payload,
  // so the key is the content, and the source is the payload redone with the
  // original timestamp (F11), which only the author themselves can sign again.
  // The old administrator list only applies to those the new one does not cover, as in `rolesFor`.
  const atribuicoes = contents.channelMemberRoles[canal] ?? {}
  const carimbos = contents.channelMemberRolesAt?.[canal] ?? {}
  for (const [sujeito, papeis] of Object.entries(atribuicoes)) {
    const carimbo = carimbos[sujeito]
    const fonte: FonteDoItem | undefined =
      carimbo?.por !== undefined
        ? {
            autor: carimbo.por,
            seq: carimbo.seq ?? -1,
            payload: { t: "role.assign", subject: sujeito, roles: [...papeis], assignedAt: carimbo.at },
          }
        : undefined
    itens.push({
      tipo: "atribuicao",
      balde: sujeito,
      chave: `atribuicao|${sujeito}|${[...papeis].sort().join(",")}`,
      ...(fonte ? { fonte } : {}),
    })
  }
  for (const admin of contents.channelAdmins[canal] ?? []) {
    if (atribuicoes[admin]) continue
    itens.push({ tipo: "atribuicao", balde: admin, chave: `atribuicao|${admin}|admin` })
  }

  const letreiro = contents.spaceMeta[canal]
  if (letreiro) {
    const carimbo = numero(letreiro.payload["updatedAt"], letreiro.at)
    // No source: the banner carries the icon embedded, and we do not report an
    // image to state a name. It has the rebroadcast of `republishAuthority`.
    itens.push({ tipo: "letreiro", balde: CANAL, chave: `letreiro|${canal}|-|${carimbo}` })
  }

  for (const [categoria, guardado] of Object.entries(contents.channelCategories[canal] ?? {})) {
    const carimbo = numero(guardado.payload["updatedAt"], guardado.at)
    const fonte = fonteDoRegisto(guardado)
    itens.push({ tipo: "categoria", balde: categoria, chave: `categoria|${categoria}|-|${carimbo}`, ...(fonte ? { fonte } : {}) })
  }

  for (const [sala, guardado] of Object.entries(contents.channelRooms[canal] ?? {})) {
    const carimbo = numero(guardado.payload["updatedAt"], guardado.at)
    const fonte = fonteDoRegisto(guardado)
    itens.push({ tipo: "sala", balde: sala, chave: `sala|${sala}|-|${carimbo}`, ...(fonte ? { fonte } : {}) })
    const fixadas = guardado.payload["pinned"]
    if (Array.isArray(fixadas) && fixadas.length > 0) {
      const ids = fixadas.map((f) => texto((f as { id?: unknown }).id)).sort()
      itens.push({ tipo: "fixadas", balde: sala, chave: `fixadas|${sala}|${ids.join(",")}` })
    }
  }

  // Profiles and friends shown: only of those who are channel members now.
  for (const membro of opcoes.membros ?? []) {
    if (membro === opcoes.proprio) {
      if (contents.profile.displayName) {
        itens.push({ tipo: "perfil", balde: membro, chave: `perfil|${membro}|${contents.profile.updatedAt}` })
      }
    } else {
      const perfil = contents.directory[membro]
      if (perfil) {
        const carimbo = numero(perfil.payload["updatedAt"], perfil.at)
        itens.push({ tipo: "perfil", balde: membro, chave: `perfil|${membro}|${carimbo}` })
      }
    }
    const amigos = contents.shownFriends?.[membro]
    if (amigos) {
      itens.push({ tipo: "amigos-mostrados", balde: membro, chave: `amigos-mostrados|${membro}|${amigos.updatedAt}` })
    }
  }

  /*
    An item with a gravestone does not count (S4): the summary says what you see.
    The gravestone is absorbing and can be earlier than the place of whoever compares
    (chat has a window, wall does not); counting the deleted item would give
    divergence that no report can close, because an item with a gravestone never
    gets reported. Gravestones are searched in the whole vault, outside the window,
    and only those from the target author count (`itemApagado`): it is the fold rule,
    and the summary says what the screen shows.
    */
  if (opcoes.comApagados) return itens
  const lapides = lapidesDoCanal(contents, canal)
  if (lapides.porAlvo.size === 0) return itens
  return itens.filter((item) => !item.fonte || !itemApagado(lapides, item.tipo, item.fonte.autor, item.fonte.payload))
}

const HEX = "0123456789abcdef"
function hex(bytes: Uint8Array, quantos: number): string {
  let saida = ""
  for (let i = 0; i < quantos; i++) {
    const b = bytes[i] ?? 0
    saida += HEX[b >> 4]! + HEX[b & 15]!
  }
  return saida
}

const codificador = new TextEncoder()

/** The pair of a key set: deduplicates, sorts, and summarizes. */
export function parDeChaves(chaves: Iterable<string>): ParDoResumo {
  const unicas = [...new Set(chaves)].sort()
  return { n: unicas.length, h: hex(sha256(codificador.encode(unicas.join("\n"))), 8) }
}

/** Level 0: one pair per type, all types present, even the empty ones. */
export function resumoNivel0(itens: readonly ItemDoResumo[]): ResumoNivel0 {
  const porTipo = new Map<TipoDoResumo, string[]>()
  for (const item of itens) {
    const lista = porTipo.get(item.tipo)
    if (lista) lista.push(item.chave)
    else porTipo.set(item.tipo, [item.chave])
  }
  const resumo = {} as ResumoNivel0
  for (const tipo of TIPOS_DO_RESUMO) resumo[tipo] = parDeChaves(porTipo.get(tipo) ?? [])
  return resumo
}

/** Level 1: one pair per bucket, of a type. */
export function resumoNivel1(itens: readonly ItemDoResumo[], tipo: TipoDoResumo): Record<string, ParDoResumo> {
  const porBalde = new Map<string, string[]>()
  for (const item of itens) {
    if (item.tipo !== tipo) continue
    const lista = porBalde.get(item.balde)
    if (lista) lista.push(item.chave)
    else porBalde.set(item.balde, [item.chave])
  }
  const resumo: Record<string, ParDoResumo> = {}
  for (const balde of [...porBalde.keys()].sort()) resumo[balde] = parDeChaves(porBalde.get(balde) ?? [])
  return resumo
}

/** Level 2: the keys in a bucket, each in 6 bytes of SHA-256, sorted. */
export function resumoNivel2(itens: readonly ItemDoResumo[], tipo: TipoDoResumo, balde: string): string[] {
  const curtas = new Set<string>()
  for (const item of itens) {
    if (item.tipo === tipo && item.balde === balde) curtas.add(chaveCurta(item.chave))
  }
  return [...curtas].sort()
}

/** The key of an item at level 2: the first 6 bytes of SHA-256, in hex (12 characters). */
export function chaveCurta(chave: string): string {
  return hex(sha256(codificador.encode(chave)), 6)
}

// ------------------------------------------------------------- no fio (S4)

/**
 * Level 0 as it travels in a signal: one pair `[n, h]` per type, by
 * `TIPOS_DO_RESUMO` order. Without type names: order is the contract, so a
 * new type only appends at the END. A summary with MORE types than this device
 * knows reads the ones it knows; with fewer, it does not read.
 */
export type Nivel0NoFio = [number, string][]

export function nivel0ParaFio(resumo: ResumoNivel0): Nivel0NoFio {
  return TIPOS_DO_RESUMO.map((tipo) => [resumo[tipo].n, resumo[tipo].h])
}

const HASH_DO_PAR = /^[0-9a-f]{16}$/

/** A validated pair from the stream. */
export function parDoFio(bruto: unknown): ParDoResumo | null {
  if (!Array.isArray(bruto) || bruto.length !== 2) return null
  const [n, h] = bruto as unknown[]
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) return null
  if (typeof h !== "string" || !HASH_DO_PAR.test(h)) return null
  return { n, h }
}

/** Level 0 of a signal, or `null` if it does not read. */
export function nivel0DoFio(bruto: unknown): ResumoNivel0 | null {
  if (!Array.isArray(bruto) || bruto.length < TIPOS_DO_RESUMO.length) return null
  const resumo = {} as ResumoNivel0
  for (const [indice, tipo] of TIPOS_DO_RESUMO.entries()) {
    const par = parDoFio(bruto[indice])
    if (!par) return null
    resumo[tipo] = par
  }
  return resumo
}

/** Whether a short key has the right shape (12 hex characters). */
export function chaveCurtaValida(bruto: unknown): bruto is string {
  return typeof bruto === "string" && /^[0-9a-f]{12}$/.test(bruto)
}

/** Level 0 of a channel, from the vault. */
export function resumoDoCanal(contents: VaultContents, canal: string, opcoes: OpcoesDoResumo = {}): ResumoNivel0 {
  return resumoNivel0(itensDoCanal(contents, canal, opcoes))
}

/** The types in which two level 0s differ, by `TIPOS_DO_RESUMO` order. */
export function tiposDiferentes(a: ResumoNivel0, b: ResumoNivel0): TipoDoResumo[] {
  return TIPOS_DO_RESUMO.filter((tipo) => a[tipo].n !== b[tipo].n || a[tipo].h !== b[tipo].h)
}

/** The buckets in which two level 1s of the same type differ, including those only one has. */
export function baldesDiferentes(a: Record<string, ParDoResumo>, b: Record<string, ParDoResumo>): string[] {
  const todos = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...todos].sort().filter((balde) => a[balde]?.h !== b[balde]?.h || a[balde]?.n !== b[balde]?.n)
}

/**
 * Bytes of level 0 in a compact stream: per type, the count in varint and the
 * 8 bytes of the summary. It is the number that §4.2 estimates at about 240 bytes.
 */
export function bytesDoNivel0(resumo: ResumoNivel0): number {
  let total = 0
  for (const tipo of TIPOS_DO_RESUMO) {
    let n = resumo[tipo].n
    do {
      total++
      n = Math.floor(n / 128)
    } while (n > 0)
    total += 8
  }
  return total
}

/** A payload without attachment, avatar and thumbnail bytes: what the snapshot carries (§5.4). */
function semBytes(payload: StoredPayload): StoredPayload {
  return JSON.parse(
    JSON.stringify(payload, (chave, valor: unknown) => (chave === "inline" || chave === "thumbnail" ? undefined : valor)),
  ) as StoredPayload
}

/**
 * The snapshot of §5.2, in the order of §5.2, with what this device's vault
 * has today. Only to measure size: no authorship or chain (S4), and the
 * founder goes as `room.created` reconstructed, because the vault does not
 * store the original payload.
 */
export function instantaneoDoCanal(
  contents: VaultContents,
  canal: string,
  opcoes: OpcoesDoResumo = {},
): { payloads: StoredPayload[]; bytes: number; porParte: Record<string, { n: number; bytes: number }> } {
  const partes: [string, StoredPayload[]][] = []
  const historia = entradasDoCanal(contents, canal)
  const comT = (...ts: string[]): StoredPayload[] => historia.filter((e) => ts.includes(e.payload.t)).map((e) => e.payload)

  const fundador = contents.channelFounder[canal]
  partes.push(["fundador", fundador ? [{ t: "room.created", name: "", createdAt: 0, autor: fundador.address }] : []])
  partes.push([
    "cargos",
    [
      ...Object.values(contents.channelRoles[canal] ?? {}).map((g) => g.payload),
      ...Object.entries(contents.channelMemberRoles[canal] ?? {}).map(
        ([subject, roles]): StoredPayload => ({ t: "role.assign", subject, roles, assignedAt: 0 }),
      ),
    ],
  ])
  partes.push([
    "letreiro-categorias",
    [
      ...(contents.spaceMeta[canal] ? [contents.spaceMeta[canal].payload] : []),
      ...Object.values(contents.channelCategories[canal] ?? {}).map((g) => g.payload),
    ],
  ])
  partes.push(["salas-fixadas", Object.values(contents.channelRooms[canal] ?? {}).map((g) => g.payload)])
  partes.push(["lapides", comT("redact")])
  partes.push(["publicacoes", comT("post")])
  partes.push(["comentarios-gostos-votos", comT("post.comment", "post.reaction")])
  partes.push(["tickets", historia.filter((e) => e.payload.t === "message" && e.payload["ticket"]).map((e) => e.payload)])
  partes.push([
    "perfis",
    (opcoes.membros ?? [])
      .filter((m) => m !== opcoes.proprio)
      .flatMap((m) => (contents.directory[m] ? [contents.directory[m].payload] : [])),
  ])
  const desde = opcoes.desde ?? -1
  partes.push([
    "mensagens-da-janela",
    historia
      // Only with known `seq` and inside the window: a send without echo does not
      // locate itself, and the place rule (§5.3) does not give what it cannot locate.
      .filter((e) => e.payload.t === "message" && !e.payload["ticket"] && dentroDaJanela(e, desde))
      .map((e) => e.payload),
  ])

  const payloads: StoredPayload[] = []
  const porParte: Record<string, { n: number; bytes: number }> = {}
  let bytes = 0
  for (const [nome, lista] of partes) {
    const limpos = lista.map(semBytes)
    const tamanho = limpos.reduce((soma, p) => soma + codificador.encode(JSON.stringify(p)).length, 0)
    porParte[nome] = { n: limpos.length, bytes: tamanho }
    bytes += tamanho
    payloads.push(...limpos)
  }
  return { payloads, bytes, porParte }
}

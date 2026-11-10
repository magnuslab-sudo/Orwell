import {
  ANEXO_DO_PERFIL,
  assinarAutoria,
  CHAVES_DE_ANEXOS,
  levaAutoria,
  Payload,
  verificarAutoria,
  type ItemRelatado,
  toBase64,
  type RelatosNoFio,
} from "@enclave/protocol"
import type { StoredPayload } from "../vault.js"
import { TECTOS_DA_SINCRONIA } from "./eleicao.js"
import { resumoDoAnexo } from "./instantaneo.js"
import { TIPOS_COM_JANELA, type FonteDoItem, type ItemDoResumo, type TipoDoResumo } from "./resumo.js"

/**
 * The report: what is sent to the requester, and what is accepted from the reporter
 * (phase S4 of absolute sync, `docs/planos/2026-10-20-sincronia-absoluta.md`,
 * section 4.3, section 5.2 and section 7).
 *
 * A report is the original payload, with the author's authorship, and the origin `seq`.
 * It travels in a `typing` with `until: 0` (field `relatos`): all clients know it,
 * none display it, and a 0.5.7 discards the field without losing sync.
 *
 * **Without attachment bytes.** The name and type go (the marker that vault eviction already uses),
 * and authorship ties the digest of each attachment; bytes, on request,
 * come from phase S5 (section 5.4).
 */

/** What this module needs to know about the device reporting. */
export interface QuemRelata {
  address: string
  aparelho: Uint8Array
  assinar: (mensagem: Uint8Array) => Uint8Array
}

/** An attachment without bytes: the marker that `evictEntryMedia` leaves in the vault. */
function semBytes(item: unknown): unknown {
  if (typeof item !== "object" || item === null) return item
  const anexo = item as Record<string, unknown>
  return {
    evicted: true,
    name: typeof anexo["name"] === "string" ? anexo["name"] : "",
    mediaType: typeof anexo["mediaType"] === "string" ? anexo["mediaType"] : "",
  }
}

/** The payload without attachment bytes or thumbnails, ready to report. A copy. */
export function payloadSemBytes(payload: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const copia = structuredClone(payload) as Record<string, unknown>
  for (const chave of CHAVES_DE_ANEXOS) {
    const lista = copia[chave]
    if (Array.isArray(lista)) copia[chave] = lista.map(semBytes)
  }
  const links = copia["links"]
  if (Array.isArray(links)) {
    copia["links"] = links.map((cartao: unknown) => {
      if (typeof cartao !== "object" || cartao === null) return cartao
      const { thumbnail: _miniatura, ...resto } = cartao as Record<string, unknown>
      return resto
    })
  }
  return copia
}

/** An evicted attachment placed as a minimal attachment, just for the schema to accept it. */
function marcadorComoAnexo(item: unknown): unknown {
  if (typeof item !== "object" || item === null || (item as Record<string, unknown>)["evicted"] !== true) return item
  const anexo = item as Record<string, unknown>
  return { name: anexo["name"], mediaType: anexo["mediaType"], byteLength: 0 }
}

/**
 * The payload by the protocol schema, with default values filled in:
 * the form that the author signed. Evicted attachments pass as minimal attachments
 * for the schema to accept them, and become markers again at the end (the signed form
 * only reads the name and type, so it makes no difference).
 *
 * `null` if the schema rejects it: a report with a payload that does not pass is trash.
 */
export function normalizar(payload: Readonly<Record<string, unknown>>): Record<string, unknown> | null {
  const paraOEsquema: Record<string, unknown> = { ...payload }
  const despejados = new Map<string, unknown[]>()
  for (const chave of CHAVES_DE_ANEXOS) {
    const lista = payload[chave]
    if (!Array.isArray(lista)) continue
    despejados.set(chave, lista)
    paraOEsquema[chave] = lista.map(marcadorComoAnexo)
  }
  // A profile picture (phase 1 of 1.1) is a single attachment: the same one, outside lists.
  const retrato = payload[ANEXO_DO_PERFIL]
  const retratoDespejado = payload["t"] === "profile" && ehMarcador(retrato)
  if (retratoDespejado) paraOEsquema[ANEXO_DO_PERFIL] = marcadorComoAnexo(retrato)
  const lido = Payload.safeParse(paraOEsquema)
  if (!lido.success) return null
  const normal = lido.data as Record<string, unknown>
  if (retratoDespejado) normal[ANEXO_DO_PERFIL] = semBytes(retrato)
  for (const [chave, original] of despejados) {
    const lista = normal[chave]
    if (!Array.isArray(lista)) continue
    normal[chave] = lista.map((item, indice) => {
      const antes = original[indice]
      return typeof antes === "object" && antes !== null && (antes as Record<string, unknown>)["evicted"] === true
        ? semBytes(antes)
        : item
    })
  }
  return normal
}

/** If an attachment is the eviction marker (name and type only). */
function ehMarcador(item: unknown): boolean {
  return typeof item === "object" && item !== null && (item as Record<string, unknown>)["evicted"] === true
}

/**
 * The attachments of a normalized payload, verified against the `m` of authorship.
 *
 * The signed form only reads the name and type of each attachment; the rest (bytes
 * of a photo, the thumbnail and digest of a video) are only bound by `m`.
 * Without this check, a reporter could swap the video or photo of someone else's
 * post and the authorship would still be valid. Each attachment that is not
 * a marker must give its `m[i]`, in the order of `CHAVES_DE_ANEXOS`; one that does not
 * becomes a marker (the name and type, which the signature proves). A copy.
 */
export function anexosConferidos(payload: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const m = (payload["autoria"] as { m?: unknown } | undefined)?.m
  const resumos: readonly unknown[] = Array.isArray(m) ? m : []
  const saida: Record<string, unknown> = { ...payload }
  let indice = 0
  for (const chave of CHAVES_DE_ANEXOS) {
    const lista = payload[chave]
    if (!Array.isArray(lista)) continue
    saida[chave] = lista.map((item) => {
      const esperado = resumos[indice++]
      if (ehMarcador(item)) return item
      return typeof esperado === "string" && resumoDoAnexo(item) === esperado ? item : semBytes(item)
    })
  }
  // A profile picture, after the lists, in the order of `resumosDosAnexos`.
  const retrato = payload[ANEXO_DO_PERFIL]
  if (payload["t"] === "profile" && typeof retrato === "object" && retrato !== null && !ehMarcador(retrato)) {
    const esperado = resumos[indice]
    if (!(typeof esperado === "string" && resumoDoAnexo(retrato) === esperado)) saida[ANEXO_DO_PERFIL] = semBytes(retrato)
  }
  return saida
}

/**
 * A vault item ready to report, or `null` if it cannot be.
 *
 * With authorship, it goes as is. Without authorship (written before S4, or by a
 * 0.5.7), only the author themselves can report it again: sign it now, if they still
 * have the attachment bytes (the digest of an evicted attachment can no longer be computed).
 * From someone else and without authorship: it does not report, as before (section 4.1).
 */
export function prepararItem(
  canal: string,
  fonte: FonteDoItem,
  eu: QuemRelata,
  cadeia: { k: string; x: string } | null,
): ItemRelatado | null {
  if (!levaAutoria(fonte.payload.t)) return null
  let payload = fonte.payload as Record<string, unknown>
  if (payload["autoria"] === undefined) {
    if (fonte.autor !== eu.address) return null
    const normal = normalizar(payload)
    if (!normal) return null
    try {
      payload = { ...payload, autoria: assinarAutoria({ canal, autor: eu.address, payload: normal, aparelho: eu.aparelho, assinar: eu.assinar }) }
    } catch {
      // A dumped attachment: its summary is no longer calculated.
      return null
    }
  }
  return {
    s: fonte.seq >= 0 ? fonte.seq : -1,
    a: fonte.autor,
    p: payloadSemBytes(payload),
    ...(cadeia ? { k: cadeia.k, x: cadeia.x } : {}),
  }
}

/**
 * The order of section 5.2: what is sent before what depends on it. Founder before
 * officers (`#mandaEm` asks who has authority), officers before those who hold them,
 * tombstones before public posts, the post before the comment.
 */
const ORDEM_DO_RELATO: Partial<Record<TipoDoResumo, number>> = {
  fundador: 0,
  cargo: 1,
  atribuicao: 2,
  letreiro: 3,
  categoria: 3,
  sala: 4,
  apagamento: 5,
  publicacao: 6,
  comentario: 7,
  gosto: 7,
  voto: 7,
  ticket: 8,
  mensagem: 10,
  edicao: 11,
  reaccao: 11,
}

export function porOrdemDoRelato(a: ItemDoResumo, b: ItemDoResumo): number {
  return (ORDEM_DO_RELATO[a.tipo] ?? 9) - (ORDEM_DO_RELATO[b.tipo] ?? 9)
}

/** Bytes of an item in the thread, as JSON. */
export function bytesDoItem(item: ItemRelatado): number {
  return new TextEncoder().encode(JSON.stringify(item)).length
}

/**
 * Split items into `typing` frames, each with up to
 * `bytesPorTramaDeRelato` of JSON. It is the `partirEstado` of pairing, at
 * report scale: the item is the unit, and an item larger than the frame goes
 * alone (a body has 16,000 characters at most and attachments go without bytes,
 * so it never hits the server cap).
 */
export function partirRelatos(itens: readonly ItemRelatado[], q?: string): RelatosNoFio[] {
  const tramas: ItemRelatado[][] = []
  let corrente: ItemRelatado[] = []
  let bytes = 0
  for (const item of itens) {
    const tamanho = bytesDoItem(item)
    if (corrente.length > 0 && bytes + tamanho > TECTOS_DA_SINCRONIA.bytesPorTramaDeRelato) {
      tramas.push(corrente)
      corrente = []
      bytes = 0
    }
    corrente.push(item)
    bytes += tamanho
    if (corrente.length >= 200) {
      tramas.push(corrente)
      corrente = []
      bytes = 0
    }
  }
  if (corrente.length > 0) tramas.push(corrente)
  return tramas.map((lista, indice) => ({
    v: 1 as const,
    ...(q !== undefined ? { q: `${q}:${indice + 1}/${tramas.length}` } : {}),
    itens: lista,
  }))
}

/** The request is part of a `q` report entry: `id:parte/total`. */
export function lerQ(q: string | undefined): { id: string; parte: number; de: number } | null {
  if (!q) return null
  const casado = /^(.+):(\d+)\/(\d+)$/.exec(q)
  if (!casado) return null
  return { id: casado[1]!, parte: Number(casado[2]), de: Number(casado[3]) }
}

// --------------------------------------------------------------- receive

/**
 * The manifest of an account as the session read it: `lido` says whether the server
 * answered. `manifesto: null` with `lido` means "the account has no manifest" (one device
 * only, or server without bundles); without `lido` means "unknown".
 */
export interface LeituraDoManifesto {
  lido: boolean
  manifesto: { devices: readonly { deviceKey: Uint8Array }[] } | null
}

/**
 * If a device that is NOT in this channel's tree speaks for the account, after the
 * chain closes (section 4.1). Only with manifest read: a relay that silences the
 * `manifest.get` cannot let a revoked device pass just because of the chain, which
 * the account signed once and does not unsign. Without reading, refuse now and
 * ask again in the next pass (the digest stays different, and the request repeats). Without
 * manifest (read), the chain holds, as before.
 */
export function aparelhoPeloManifesto(leitura: LeituraDoManifesto, aparelho: string): boolean {
  if (!leitura.lido) return false
  if (leitura.manifesto === null) return true
  return leitura.manifesto.devices.some((device) => toBase64(device.deviceKey) === aparelho)
}

/** What the receiver needs to ask the rest of the session. */
export interface ContextoDaRecepcao {
  canal: string
  /** The `seq` of the frame that brought the report. A reported item must be earlier than it. */
  seqDaTrama: number
  /** The `seq` of the commit that seated us in this channel (the position rule, section 5.3). */
  lugar: number
  /**
   * The window when the reporter answered (ours, never below the position). A
   * tombstone below it can only be public: the reporter does not give chat tombstones
   * below the window. Absent: the position.
   */
  janela?: number
  /** The keys of items this device already has in this channel, deleted ones included. */
  jaTemos: (chave: string) => boolean
  /** Whether the item has a tombstone that counts in this vault (`itemApagado` in the summary). */
  apagado: (item: ItemDoResumo, autor: string, payload: StoredPayload) => boolean
  /** Remember that the target of this tombstone is on the wall (see `alvosDoMural`). */
  alvoDoMural?: (alvo: string) => void
  /** The key and type that this payload would have in the summary. */
  itemDe: (autor: string, payload: StoredPayload) => ItemDoResumo | null
  /**
   * If the device can speak for this account: the chain, the manifest, and the
   * revoked list. From the session, which holds the tree and the manifest.
   */
  aparelhoConfiavel: (autor: string, aparelho: string, cadeia: { k?: string; x?: string }) => Promise<boolean>
  bloqueado: (autor: string) => boolean
}

export type VeredictoDoRelato =
  | { ok: true; autor: string; seq: number; payload: Record<string, unknown>; item: ItemDoResumo }
  | {
      ok: false
      razao:
        | "tipo"
        | "esquema"
        | "autoria"
        | "aparelho"
        | "bloqueado"
        | "lugar"
        | "servidor-serve"
        | "lapide"
        | "ja-temos"
    }

/**
 * An item reported and checked against all receive rules (§4.5, §5.3, §7).
 *
 * In order from cheapest to most expensive, all required:
 *
 * 1. A type that carries authorship, and a payload the schema accepts.
 * 2. The device signature over the channel, the author, and the payload form. Each
 *    attachment with content must match the `m` from authorship; any mismatch is
 *    recorded as a marker (`anexosConferidos`).
 * 3. The device speaks for the account: it is in the tree under that account, or
 *    the chain closes and the manifest lists it; and it is not revoked.
 * 4. The block filter, as for live.
 * 5. The tombstone is absorptive (§7.6): an item the vault has deleted (itself, or
 *    the target of an edit or reaction) does not re-enter, nor reach the screen.
 * 6. The place rule: a message enters only if its source `seq` is known (never -1)
 *    and not before our place. A tombstone carries no conversation and passes below
 *    the place; below the window, it can only be from the wall, and is remembered
 *    as such (`alvoDoMural`).
 * 7. Nothing reported replaces what the server still serves: the source `seq` must
 *    be before the frame that brought it. An honest report only reports what the
 *    reporter already had when they wrote it.
 * 8. What we already have wins: an item with the same key does not enter. This is
 *    what makes a report that contradicts an MLS-authenticated event lose.
 */
export async function receberItem(item: ItemRelatado, contexto: ContextoDaRecepcao): Promise<VeredictoDoRelato> {
  if (!levaAutoria(item.p["t"])) return { ok: false, razao: "tipo" }
  const normalizado = normalizar(item.p)
  if (!normalizado) return { ok: false, razao: "esquema" }
  const autoria = verificarAutoria(contexto.canal, item.a, normalizado)
  if (!autoria.ok) return { ok: false, razao: "autoria" }
  const normal = anexosConferidos(normalizado)
  const cadeia = { ...(item.k !== undefined ? { k: item.k } : {}), ...(item.x !== undefined ? { x: item.x } : {}) }
  if (!(await contexto.aparelhoConfiavel(item.a, autoria.aparelho, cadeia))) return { ok: false, razao: "aparelho" }
  if (contexto.bloqueado(item.a)) return { ok: false, razao: "bloqueado" }
  const doResumo = contexto.itemDe(item.a, normal as StoredPayload)
  if (!doResumo) return { ok: false, razao: "tipo" }
  if (contexto.apagado(doResumo, item.a, normal as StoredPayload)) return { ok: false, razao: "lapide" }
  const lapide = doResumo.tipo === "apagamento"
  if (!lapide && TIPOS_COM_JANELA.has(doResumo.tipo) && (item.s < 0 || item.s < contexto.lugar)) return { ok: false, razao: "lugar" }
  if (contexto.seqDaTrama >= 0 && item.s >= contexto.seqDaTrama) return { ok: false, razao: "servidor-serve" }
  const alvo = normal["target"]
  if (lapide && typeof alvo === "string" && item.s < (contexto.janela ?? contexto.lugar)) contexto.alvoDoMural?.(alvo)
  if (contexto.jaTemos(doResumo.chave)) return { ok: false, razao: "ja-temos" }
  return { ok: true, autor: item.a, seq: item.s, payload: normal, item: doResumo }
}

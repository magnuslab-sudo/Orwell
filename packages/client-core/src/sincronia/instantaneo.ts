import { sha256 } from "@noble/hashes/sha2.js"
import { CHAVES_DE_ANEXOS, canonicoTolerante, toBase64 } from "@enclave/protocol"
import type { ResumoNivel0, TipoDoResumo } from "./resumo.js"

/**
 * The snapshot for late arrivals, and attachments on request (phase S5 of
 * absolute sync, `docs/planos/2026-10-20-sincronia-absoluta.md`, §5).
 *
 * **Not a new path (§5.1).** The arriving member states their summary, which is
 * empty. On the first summary from another member, instead of descending to levels 1 and 2,
 * they request the ENTIRE type of each state type and the board (`pt` in `pedido.ts`).
 * The elected sheet responds, with reports in the order of §5.2. What remains
 * (window chat, an item without author) follows the normal descent.
 *
 * **The placement rule (§5.3)** doesn't change here: the responder only reports window
 * chat (`#responderTipos` uses the same window as `#responderItens`), and the receiver
 * rejects the one before their placement (`receberItem`). The snapshot requests types
 * without a window, and both guards still run.
 *
 * **Attachments (§5.4).** Reports carry metadata, never bytes. Bytes are
 * requested when the user opens the attachment, one sheet at a time, and arrive in
 * a report with just that entire attachment. The receiver verifies them against the `m`
 * from authorship before showing: `anexoConfere`.
 *
 * This module is pure: decisions and numbers. The network and vault are in
 * `pedido.ts` and the session.
 */

/**
 * The types that the snapshot requests in full, in the order of §5.2.
 *
 * Out: chat (has a window, follows normal descent), the banner (no reportable source:
 * carries the embedded icon, and has rebroadcast from `republishAuthority`),
 * pinned messages (go inside the room), profiles and shown friends (have their own path,
 * `publishProfile` when the group grows), the connection and invites (control access, and
 * only what comes from the server counts).
 */
export const TIPOS_DO_INSTANTANEO: readonly TipoDoResumo[] = [
  "fundador",
  "cargo",
  "atribuicao",
  "categoria",
  "sala",
  "apagamento",
  "publicacao",
  "comentario",
  "gosto",
  "voto",
  "ticket",
]

const DO_INSTANTANEO: ReadonlySet<TipoDoResumo> = new Set(TIPOS_DO_INSTANTANEO)

export function doInstantaneo(tipo: TipoDoResumo): boolean {
  return DO_INSTANTANEO.has(tipo)
}

/** The numbers for attachments on request. Mutable only for tests to lower them. */
export const TECTOS_DOS_ANEXOS = {
  /** Bytes of attachments a device sends per minute (§4.4: 4 MB). */
  bytesPorMinuto: 4 * 1024 * 1024,
  /**
   * Bytes of attachments stored on the server per channel and per day, by the
   * responder. Separate from the 4 MiB of reports: a photo alone would use them up.
   * Sixteen allows four large photos per day per channel; beyond that, the requester
   * waits for the next day or another sheet.
   */
  bytesPorCanalPorDia: 16 * 1024 * 1024,
  /**
   * Bytes of video a responder serves per channel and per day (26/10/2026).
   * A video at the cap (25 MiB) would exceed the 16 MiB of attachments alone. Sixty-four
   * allows two large videos per day per channel.
   */
  bytesDeVideoPorCanalPorDia: 64 * 1024 * 1024,
  /** No response in 30 s, try the next sheet. Longer than the 15 s of a request: bytes are heavy. */
  esperaMs: 30_000,
  /**
   * The window of `bytesPorMinuto`. When a video is requested, the responder waits for it
   * between parts (each part costs 1.4 MB on the wire: two per window), so
   * the delay between parts is `esperaMs` plus this window (`#prazoDe` in `pedido.ts`). It's a
   * silence timeout, not the whole video: it renews with each part, and a 25 MiB video,
   * which takes 13 minutes, arrives without the request timing out midway.
   */
  janelaMs: 60_000,
  /** At most three sheets per attachment, like in a request (§4.4). */
  tentativas: 3,
  /**
   * An attachment that was sent is not sent again to the same channel during this
   * window (`canal|c|i`). Without it, a dishonest member would put sheets serving
   * the same attachment in a loop, up to each one's daily cap. The requester accepts
   * bytes from any frame with their attachment: one send serves all
   * requesters at the same time.
   */
  repeticaoMs: 10 * 60_000,
  /**
   * Bytes of received attachments that the requester keeps in memory. The vault
   * dump removes bytes from an old message right after saving them; without
   * this copy, opening again meant requesting again.
   */
  memoriaBytes: 16 * 1024 * 1024,
}

/** An attachment from a payload, by position in the flat list of `CHAVES_DE_ANEXOS`. */
export interface PosicaoDoAnexo {
  chave: (typeof CHAVES_DE_ANEXOS)[number]
  indice: number
}

/** Where attachment `indice` is (the order from authorship: `attachments` then `media`). */
export function posicaoDoAnexo(payload: Readonly<Record<string, unknown>>, indice: number): PosicaoDoAnexo | null {
  if (!Number.isSafeInteger(indice) || indice < 0) return null
  let resto = indice
  for (const chave of CHAVES_DE_ANEXOS) {
    const lista = payload[chave]
    if (!Array.isArray(lista)) continue
    if (resto < lista.length) return { chave, indice: resto }
    resto -= lista.length
  }
  return null
}

/** The attachment at flat position `indice`, or `undefined`. */
export function anexoEm(payload: Readonly<Record<string, unknown>>, indice: number): unknown {
  const posicao = posicaoDoAnexo(payload, indice)
  if (!posicao) return undefined
  return (payload[posicao.chave] as unknown[])[posicao.indice]
}

/** Whether the attachment has bytes (not the dump marker). */
export function anexoComBytes(anexo: unknown): anexo is Record<string, unknown> {
  if (typeof anexo !== "object" || anexo === null) return false
  const registo = anexo as Record<string, unknown>
  if (registo["evicted"] === true) return false
  return (
    (typeof registo["inline"] === "string" && registo["inline"].length > 0) ||
    (typeof registo["url"] === "string" && registo["url"].startsWith("data:"))
  )
}

/** The summary of an attachment, as authorship calculates it (`resumosDosAnexos` in the protocol). */
export function resumoDoAnexo(anexo: unknown): string {
  return toBase64(sha256(new TextEncoder().encode(canonicoTolerante(anexo))))
}

/**
 * Whether the bytes that arrived are what the author signed. `anexo` is the attachment already
 * NORMALIZED by the schema (the form the author summarized), and `m` the summary from
 * verified authorship.
 */
export function anexoConfere(anexo: unknown, m: string | undefined): boolean {
  if (typeof m !== "string" || !anexoComBytes(anexo)) return false
  return resumoDoAnexo(anexo) === m
}

/** A copy of the payload with attachment `indice` swapped for `anexo`. */
export function comAnexo(payload: Readonly<Record<string, unknown>>, indice: number, anexo: unknown): Record<string, unknown> | null {
  const posicao = posicaoDoAnexo(payload, indice)
  if (!posicao) return null
  const lista = [...(payload[posicao.chave] as unknown[])]
  lista[posicao.indice] = anexo
  return { ...payload, [posicao.chave]: lista }
}

/** Bytes an attachment takes as JSON, for the caps. */
export function bytesDoAnexo(anexo: unknown): number {
  return new TextEncoder().encode(JSON.stringify(anexo)).length
}

// ----------------------------------------------------------- state per channel

/**
 * The sync state of a channel, as the interface shows it (§2.5): without
 * jargon on the outside. `por-comparar`: this device hasn't yet compared the
 * channel with anyone this session.
 */
export type EstadoDaSincronia = "igual" | "a-reparar" | "sem-resposta" | "por-comparar"

/** How much of a type has arrived so far during the snapshot. */
export interface ProgressoDoTipo {
  tipo: TipoDoResumo
  recebidos: number
  esperados: number
}

export interface SincroniaDoCanal {
  channel: string
  estado: EstadoDaSincronia
  /** The snapshot of this channel is arriving (the "Receiving channel..." bar). */
  aReceber: boolean
  /** By type, only the ones still missing or that arrived in this snapshot. Empty outside it. */
  progresso: ProgressoDoTipo[]
  /** The time of the last comparison with another member (a digest sent or heard), or `null`. */
  ultimaComparacao: number | null
}

/**
 * The progress of a snapshot: by type from §5.2, how many items we have and
 * how many the responder's digest shows. Only types with something in them.
 */
export function progressoDoInstantaneo(meu: ResumoNivel0, deles: ResumoNivel0, tipos: readonly TipoDoResumo[]): ProgressoDoTipo[] {
  const saida: ProgressoDoTipo[] = []
  for (const tipo of TIPOS_DO_INSTANTANEO) {
    if (!tipos.includes(tipo)) continue
    const esperados = deles[tipo].n
    if (esperados === 0) continue
    saida.push({ tipo, recebidos: Math.min(meu[tipo].n, esperados), esperados })
  }
  return saida
}

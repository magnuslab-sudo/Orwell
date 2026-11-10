/**
 * Reply to a message, like on Discord.
 *
 * **Only the `replyTo` goes on the wire**, the id of the original, which the
 * protocol has had since 0.5 (`payload.ts`, "Resolved entirely client-side").
 * It goes inside the encrypted payload: the server sees nothing new, not even
 * that the message is a reply.
 *
 * **No summary of the original goes with it.** A summary written by the replier
 * would be text attributed to someone else without their signature: one altered
 * app would be enough to put words in Bruno's mouth that he never said, with
 * his face and name on top. The quote is always read from the original that
 * THIS device has, with the sender authenticated by MLS. When the original is
 * not here, the line says so, and does not make it up.
 *
 * **The mention is a normal mention.** With "Mention" on, the author of the
 * original goes into `mentions`, and the rest of the app (sound, bell, counter)
 * treats it like any other. Old clients too, because `mentions` has existed
 * forever. Off, the reply is a normal message.
 *
 * Pure functions, away from the screen: each rule deserves tests that do not
 * need to mount the app.
 */

import type { MessageExtras } from "@enclave/protocol"
import type { ChatMessage } from "../types.js"
import { eImagem } from "./ficheiros.js"
import { analisarFormatacao, type Pedaco } from "./formatacao.js"
import { MENTION_ADDRESS, MENTIONS_MAX } from "./mentions.js"

/** The reply being written: which message, from whom, and whether it mentions. */
export interface RespostaPendente {
  id: string
  autor: string
  mencionar: boolean
}

/** The reply as the input box draws it: with the author's current name. */
export interface RespostaNaCaixa extends RespostaPendente {
  nome: string
}

/** What the quote line says about the original. */
export type ResumoDoOriginal =
  | { tipo: "texto"; texto: string }
  | { tipo: "imagem" }
  | { tipo: "ficheiro"; nome: string }
  | { tipo: "vazio" }

/**
 * The state of the quote line.
 *
 * - `presente`: the original is in memory on this device.
 * - `apagada`: the author deleted it, or it was removed by moderation.
 * - `por-carregar`: not in memory, and the vault still has history to read.
 * - `ausente`: not on this device (arrived before this device joined, or the
 *   vault already dropped it).
 */
export type Citacao =
  | { estado: "presente"; original: ChatMessage }
  | { estado: "apagada" }
  | { estado: "por-carregar" }
  | { estado: "ausente" }

/** How many characters the quote takes at most. CSS cuts before, on one line. */
const RESUMO_MAX = 160

/** The redacted text stays hidden, without saying how many letters it hides. */
const COBERTO = "▒▒▒"

function textoDe(pedacos: readonly Pedaco[]): string {
  return pedacos
    .map((pedaco) => {
      if (pedaco.tipo === "texto" || pedaco.tipo === "codigo") return pedaco.texto
      if (pedaco.tipo === "spoiler") return COBERTO
      return textoDe(pedaco.filhos)
    })
    .join("")
}

/**
 * The start of the original, for one line.
 *
 * Text beats images and files: it identifies the message. With no text, it says
 * what it brings, like on Discord.
 */
export function resumoDoOriginal(payload: ChatMessage["payload"], nameFor: (endereco: string) => string): ResumoDoOriginal {
  const corpo = payload.body ?? ""
  if (corpo.trim() !== "") {
    const plano = textoDe(analisarFormatacao(corpo))
      .replace(MENTION_ADDRESS, (endereco) => `@${nameFor(endereco)}`)
      .replace(/\s+/g, " ")
      .trim()
    const texto = plano.length > RESUMO_MAX ? `${plano.slice(0, RESUMO_MAX).trimEnd()}…` : plano
    return { tipo: "texto", texto }
  }
  const anexos = payload.attachments ?? []
  if (anexos.some(eImagem)) return { tipo: "imagem" }
  const ficheiro = anexos[0]
  if (ficheiro) return { tipo: "ficheiro", nome: ficheiro.name ?? "" }
  return { tipo: "vazio" }
}

/** What we know about the originals in this channel, to quote quickly by line. */
export interface IndiceDasCitacoes {
  ditas: ReadonlyMap<string, ChatMessage>
  apagadas: ReadonlySet<string>
}

/**
 * The index, built from messages in memory.
 *
 * `cruas` is what arrived (messages and tombstones). `ditas` is the conversation
 * after the fold (`comEmendas`): a message deleted by the author is in cruas and
 * missing from ditas. A tombstone without the original also counts as deleted:
 * the original may have left memory already. The trade-off: a tombstone from
 * someone else for an original this device does not have says "was deleted"
 * instead of "not on this device". In both cases the text does not show, and
 * nothing is made up.
 */
export function indiceDasCitacoes(cruas: readonly ChatMessage[], ditas: readonly ChatMessage[]): IndiceDasCitacoes {
  const porId = new Map<string, ChatMessage>()
  for (const dita of ditas) if (dita.payload.id) porId.set(dita.payload.id, dita)
  const apagadas = new Set<string>()
  for (const crua of cruas) {
    if (crua.payload.t === "redact" && crua.payload.target) apagadas.add(crua.payload.target)
    else if (crua.payload.t === "message" && crua.payload.id && !porId.has(crua.payload.id)) apagadas.add(crua.payload.id)
  }
  return { ditas: porId, apagadas }
}

/** The quote of a reply. `haMaisAntigas`: the vault still has history to read. */
export function citacaoDe(id: string, indice: IndiceDasCitacoes, haMaisAntigas: boolean): Citacao {
  const original = indice.ditas.get(id)
  if (original) return original.payload.moderada === true ? { estado: "apagada" } : { estado: "presente", original }
  if (indice.apagadas.has(id)) return { estado: "apagada" }
  return haMaisAntigas ? { estado: "por-carregar" } : { estado: "ausente" }
}

/**
 * Send extras, with the response included.
 *
 * Adding the author means appending to `mentions`, without duplicates and without
 * exceeding the protocol limit. Replying to yourself is never mentioned: there is
 * no one to notify. Without a reply, return the same extras, uncopied.
 */
export function comResposta(extras: MessageExtras, resposta: RespostaPendente | null, eu: string | null): MessageExtras {
  if (!resposta) return extras
  const mentions = extras.mentions ?? []
  const mencionar =
    resposta.mencionar && resposta.autor !== eu && !mentions.includes(resposta.autor) && mentions.length < MENTIONS_MAX
  return {
    ...extras,
    ...(mencionar ? { mentions: [...mentions, resposta.autor] } : {}),
    replyTo: resposta.id,
  }
}

/** Does this line offer "Reply"? Only what was said, with ID and content. */
export function podeResponder(message: ChatMessage): boolean {
  return message.payload.t === "message" && message.payload.id !== undefined && message.payload.moderada !== true
}

/**
 * The slash commands in the input box: `/me`, `/away`, `/estado`, and the
 * three that do nothing yet (`/nick`, `/topic`, `/kick`).
 *
 * Request from the owner, 28 October 2026: the millennial features of
 * IRC. Pure and without React, so the input only has to decide what to do with the
 * result, and so the rules can be tested without rendering anything.
 *
 * **None of this touches the protocol.** The `/me` does not carry a new field in the
 * message: it goes out as italic text, with the syntax that `formatacao.ts` already
 * reads (`*assim*`). Someone with an old version sees the same italic, or the
 * asterisks, which degrades gracefully. A `me: true` in the payload was a protocol
 * concern and would force all versions to learn how to render it.
 *
 * **Only counts at the start of the message, and only one known name.** A `/home/ana`
 * stuck to text is not a command, and an unknown `/xyz` is not either: both go
 * out as text, exactly as written. Erring on the side of text costs little;
 * swallowing a message because it looks like a command costs the message.
 */

export type NomeDoComando = "me" | "away" | "estado" | "nick" | "topic" | "kick"

export interface Comando {
  nome: NomeDoComando
  /**
   * If it already does something. `/nick`, `/topic` and `/kick` depend on the
   * core (change account name, set channel topic, and kick someone), and for now
   * they just say they will arrive in the next version.
   */
  disponivel: boolean
}

/** In the order they appear in the list: the working ones first. */
export const COMANDOS: readonly Comando[] = [
  { nome: "me", disponivel: true },
  { nome: "away", disponivel: true },
  { nome: "estado", disponivel: true },
  { nome: "nick", disponivel: false },
  { nome: "topic", disponivel: false },
  { nome: "kick", disponivel: false },
]

/** The character limit for the personal message, same as the card field (`StatusBar`). */
export const ESTADO_MAX_CARACTERES = 128

export interface ComandoLido {
  nome: NomeDoComando
  /** What comes after the name, without spaces around it. Can be empty. */
  argumento: string
}

const NOMES = new Set<string>(COMANDOS.map((comando) => comando.nome))

/**
 * The command this message is, or `null` if it is a normal message.
 *
 * The name reads without capitals (`/ME` is also `/me`), because on mobile the
 * first letter often comes out capitalized without the person meaning it.
 */
export function lerComando(texto: string): ComandoLido | null {
  const lido = /^\/([A-Za-z]+)(?:\s+([\s\S]*))?$/.exec(texto.trim())
  if (!lido) return null
  const nome = (lido[1] ?? "").toLowerCase()
  if (!NOMES.has(nome)) return null
  return { nome: nome as NomeDoComando, argumento: (lido[2] ?? "").trim() }
}

/**
 * The commands to suggest while typing the name of one.
 *
 * Only while the text is a slash followed by letters, with no space: after the
 * space the person has already chosen, and the list above what they type only gets
 * in the way.
 */
export function comandosASugerir(texto: string): readonly Comando[] {
  const lido = /^\/([A-Za-z]*)$/.exec(texto)
  if (!lido) return []
  const inicio = (lido[1] ?? "").toLowerCase()
  return COMANDOS.filter((comando) => comando.nome.startsWith(inicio))
}

/**
 * The body of a `/me`: the action in italics, with the writer's name in front
 * when the client knows it.
 *
 * Without a name, only the action shows, like in Discord: the conversation
 * line already says who wrote it.
 *
 * Asterisks inside are replaced with "∗" (U+2217), which looks the same and
 * `formatacao.ts` does not read as a marker. The reader has no backslash escape,
 * and an `*` next to a word would close the italic midway: a `/me grita **muito**`
 * would come out half-right with loose asterisks.
 */
export function corpoDoMe(acao: string, nome?: string): string {
  const frase = nome && nome.trim().length > 0 ? `${nome.trim()} ${acao}` : acao
  return `*${frase.replace(/\*/g, "\u2217")}*`
}

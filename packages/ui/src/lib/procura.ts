import type { ChatMessage } from "../types.js"
import { comEmendas } from "./format.js"

/**
 * Search for text in a channel's messages.
 *
 * **This all happens on this device, and could not happen anywhere else.** The
 * server carries encrypted text and does not read it; an index from its side was
 * exactly the thing this product exists not to have. What is searched is
 * the vault history, already open in memory, and the search is a scan over
 * it. See `useProcura`, which handles what the scan does NOT reach.
 *
 * **No regular expressions, anywhere.** The term comes from a text box,
 * and typing `(` in a text box is something a person does.
 * Passing that to `new RegExp` gives an error to the person searching at best,
 * and at worst gives them a backtracking engine sweeping the entire history starting
 * from a string someone else typed. Escaping the term fixed both
 * and left unexplained what the regex engine was doing here: this is `indexOf` on text, start to finish.
 */

/** A message that matches what was searched for. */
export interface Achado {
  /** The message's identifier, which is how you jump to it. */
  id: string
  sender: string
  /** The clock of who wrote it, for the date in the result line. */
  at: number
  /** The room where it was said. Empty is the default room. */
  room: string
  /** The body as it reads now, with the author's corrections applied. */
  body: string
}

/** A piece of text, and whether the searched term falls inside it. */
export interface PedacoRealcado {
  texto: string
  marcado: boolean
}

/**
 * The form text takes when it enters here: composed.
 *
 * The same "á" is written two ways that read exactly the same on screen: one character alone, or an "a" followed by a combining accent. macOS uses
 * the second in file names, and it arrives in conversations through copying. Without this
 * step, searching for "água" would not find "água" and there was nothing on screen to
 * explain why.
 *
 * Composing is safe for what displays: the two forms are canonically
 * equivalent, so the highlight draws the same glyphs the person
 * typed. That is why the highlight pieces come out this way and not the way they
 * came in.
 */
function compor(texto: string): string {
  return texto.normalize("NFC")
}

/**
 * The text reduced to the form it is compared in: lowercase and without accents.
 *
 * **Always returns text of the SAME length**, and that is the only reason this is
 * a character loop instead of two chained calls. The positions of a match are
 * measured here and used to cut the composed text: `"한국".normalize("NFD")` has
 * six units against the two of the original, and with that the highlight fell
 * four spaces to the side for each syllable to the left of it.
 *
 * When the folded version of a character does not fit in the same space, the
 * original stays. It happens with the Turkish `İ`, whose lowercase is two units; searching
 * for "istanbul" does not find "İstanbul", and that is the right price for a highlight that
 * never misaligns.
 */
export function dobrar(texto: string): string {
  let saida = ""
  // By code point, not by unit: cutting a surrogate pair in half
  // gave half an emoji, and `normalize` on half a pair means nothing.
  for (const caractere of texto) {
    const base = [...caractere.normalize("NFD")][0] ?? caractere
    const baixa = base.toLowerCase()
    saida += baixa.length === caractere.length ? baixa : caractere
  }
  return saida
}

/**
 * Messages containing the term, sorted newest to oldest.
 *
 * Receives the entire channel, with rooms and edits inside it, not the
 * already-filtered list from one room: an edit has no room tag, and filtering
 * by room before this function would discard it before it could correct
 * anything. Same reason `apuramentosDoCanal` counts votes on the channel, not
 * the room.
 *
 * `comEmendas` makes the search match what's on screen: find what the message
 * says now, and deleted text stays hidden. Without it, search would be the
 * only way in the product for deleted text to reappear.
 */
export function procurar(
  messages: readonly ChatMessage[],
  termo: string,
  /** Same as the conversation search: what moderation hid stays hidden. */
  opcoes: Parameters<typeof comEmendas>[1] = {},
): Achado[] {
  const agulha = dobrar(compor(termo.trim()))
  if (agulha === "") return []

  const achados: Achado[] = []
  for (const message of comEmendas([...messages], opcoes)) {
    const body = compor(message.payload.body ?? "")
    if (body === "") continue
    if (!dobrar(body).includes(agulha)) continue
    const id = message.payload.id
    if (id === undefined) continue
    achados.push({
      id,
      sender: message.sender,
      at: message.payload.sentAt ?? 0,
      // The tag the message carries, exactly as written. Converting it to a room
      // name is the UI's job; the UI knows which rooms exist. This does not.
      room: (message.payload as { room?: string }).room ?? "",
      body,
    })
  }
  return achados.sort((a, b) => b.at - a.at)
}

/**
 * Text split into chunks, with those matching the term marked.
 *
 * **Chunks, not markup.** Returning a string with `<mark>` inside would make
 * the designer parse it, and a message from someone else would become markup
 * this product executes. Same decision as `RichText`, for the same reason.
 *
 * Joining the chunks always equals the input composed text: the split happens
 * on that, not the folded version, so the accents and capitals you read are
 * what the person typed.
 */
export function realces(entrada: string, termo: string): PedacoRealcado[] {
  const texto = compor(entrada)
  const agulha = dobrar(compor(termo.trim()))
  if (agulha === "" || texto === "") return [{ texto, marcado: false }]

  const palheiro = dobrar(texto)
  const pedacos: PedacoRealcado[] = []
  let cursor = 0
  for (;;) {
    const onde = palheiro.indexOf(agulha, cursor)
    if (onde < 0) break
    if (onde > cursor) pedacos.push({ texto: texto.slice(cursor, onde), marcado: false })
    pedacos.push({ texto: texto.slice(onde, onde + agulha.length), marcado: true })
    cursor = onde + agulha.length
  }
  if (pedacos.length === 0) return [{ texto, marcado: false }]
  if (cursor < texto.length) pedacos.push({ texto: texto.slice(cursor), marcado: false })
  return pedacos
}

/**
 * Text shortened around the first match.
 *
 * A message can have paragraphs, and a result line has a height: showing it
 * all would push other results off screen and hide exactly what you're
 * comparing. The window opens at the match because that's where the
 * information is; ellipsis on each side means there's more.
 */
export function excerto(entrada: string, termo: string, largura: number): string {
  const texto = compor(entrada)
  if (texto.length <= largura) return texto

  const agulha = dobrar(compor(termo.trim()))
  const onde = agulha === "" ? 0 : dobrar(texto).indexOf(agulha)
  if (onde < 0) return `${texto.slice(0, largura)}…`

  // A third of the window before the match: readers need left context to know
  // what sentence this came from, and right context to continue it.
  const inicio = Math.max(0, onde - Math.floor(largura / 3))
  const fim = Math.min(texto.length, inicio + largura)
  return `${inicio > 0 ? "…" : ""}${texto.slice(inicio, fim)}${fim < texto.length ? "…" : ""}`
}

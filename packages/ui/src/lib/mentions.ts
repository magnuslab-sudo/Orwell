/**
 * Mentions: the display shows the name, the message carries the address.
 *
 * This split is the whole design, and each half exists for a concrete reason.
 *
 * **The wire carries the address, never the name.** A name written in the text ages:
 * anyone who changes their name stays mentioned by the old name forever, and two people
 * who pick the same name stop being distinguishable from each other, including when
 * one picks it ON PURPOSE to impersonate the other. The address is the only thing
 * that cannot be copied.
 *
 * **The screen shows the current name**, read from the directory by address, the
 * moment the message is rendered. A raw address in the middle of a sentence is thirty
 * three Latin characters no one reads.
 *
 * **The text box shows the name while you type** and the swap happens at send time.
 * See `aplicarMencoes`. Writing the address right in the box was putting half a line
 * of Latin for every named person in a field that on a phone has maybe three hundred pixels.
 *
 * **Suggestions come from this device's directory, never from the server.**
 * There is no global account search in this product, you know who you cross paths with,
 * and that is on purpose. Asking the server who matches a prefix would hand it, letter
 * by letter, exactly the social graph that everything else in this product exists to deny it.
 */

import { MENCAO_TODOS } from "@enclave/protocol"

export { MENCAO_TODOS }

/**
 * An account address inside running text.
 *
 * Four Latin words linked by hyphens, then the server, which may carry a port
 * attached (`localhost:8448`), and that is why the second colon group is optional
 * instead of forbidden. Without it, a local server address got cut off mid-way
 * and the mention did not open.
 */
export const MENTION_ADDRESS = /@[a-z]+-[a-z]+-[a-z]+-[a-z]+:[a-z0-9.-]+(?::\d+)?/gi

/** How many suggestions show at once. More than this is a list. */
export const MENTION_LIMIT = 6

/** How many mentions fit in one message. The cap comes from the protocol. */
export const MENTIONS_MAX = 64

export interface MentionCandidate {
  address: string
  name: string
}

/** A mention chosen: what shows in the box, and who it really is. */
export interface MentionPick {
  /** The inserted text, @ included, `@Ana`. */
  token: string
  address: string
}

/**
 * The `@` being typed right now, if there is one.
 *
 * Returns where it starts and what has been typed after. Three rejections, all to
 * keep the menu from opening when no one called it:
 *
 * - **@ glued to text** (`bom@dia`, an email) is not a mention;
 * - **space in the middle** closes the menu, without this, an @ typed mid-morning
 *   left the menu open over the rest of the text until day's end;
 * - **colon** means there is already a full address there, and it needs no suggestion.
 */
export function mencaoEmCurso(texto: string, cursor: number): { inicio: number; procura: string } | null {
  const antes = texto.slice(0, cursor)
  const arroba = antes.lastIndexOf("@")
  if (arroba < 0) return null

  // Glued to a letter or a digit, it is an email or an address, not a mention just starting.
  const anterior = arroba > 0 ? antes[arroba - 1] : ""
  if (anterior && /[\p{L}\p{N}]/u.test(anterior)) return null

  const procura = antes.slice(arroba + 1)
  if (/[\s:]/.test(procura)) return null
  return { inicio: arroba, procura }
}

/** No accents and lowercase: "Inês" must show up to someone typing "ines". */
function dobrar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
}

/**
 * Who matches what is being typed, in order of usefulness.
 *
 * First those who start with what was typed, then those who start with one of the
 * next words in the name, that is how "@ri" finds "Ana Rita", and only then those
 * who have it somewhere in the middle. Order matters more than it seems: with a list
 * of six, whoever is first is who Enter picks.
 *
 * An empty search (@ just typed) returns everyone, which is what Facebook does and
 * what works for choosing without knowing the name by heart.
 */
export function sugerirMencoes(
  candidatos: readonly MentionCandidate[],
  procura: string,
  limite = MENTION_LIMIT,
): MentionCandidate[] {
  const alvo = dobrar(procura)
  const pontuados: { candidato: MentionCandidate; peso: number }[] = []

  for (const candidato of candidatos) {
    const nome = dobrar(candidato.name)
    if (alvo === "") {
      pontuados.push({ candidato, peso: 0 })
      continue
    }
    if (nome.startsWith(alvo)) {
      pontuados.push({ candidato, peso: 0 })
      continue
    }
    if (nome.split(/[\s._-]+/).some((palavra) => palavra.startsWith(alvo))) {
      pontuados.push({ candidato, peso: 1 })
      continue
    }
    if (nome.includes(alvo)) {
      pontuados.push({ candidato, peso: 2 })
      continue
    }
    /**
     * By address, and only by the START of one of its words.
     *
     * Searching loose text inside the address seems more generous and is worse: addresses
     * are four made-up Latin words, and two letters show up inside by accident all the time,  * "ri" is inside "toprico", and Inês would show up suggested to someone typing "@ri"
     * looking for Rita. Three letters minimum, and hitting the start of a word: that way
     * only who was really looked for shows up.
     */
    if (alvo.length >= 3) {
      const palavras = dobrar(candidato.address).replace(/^@/, "").split(/[-:.]/)
      if (palavras.some((palavra) => palavra.startsWith(alvo))) pontuados.push({ candidato, peso: 3 })
    }
  }

  return pontuados
    .sort((a, b) => a.peso - b.peso || a.candidato.name.localeCompare(b.candidato.name, "pt"))
    .slice(0, limite)
    .map((entrada) => entrada.candidato)
}

/**
 * Put the chosen mention in the text, in place of what was being typed.
 *
 * Also return where the cursor lands, because returning just the text put the cursor
 * at the end, and anyone mentioning someone in the middle of already-written text
 * saw the rest of the text jump behind their hands.
 *
 * The space after is not courtesy: without it, the next letter glues to the name and
 * `mencaoEmCurso` opens the menu again over an already-chosen mention.
 */
export function inserirMencao(
  texto: string,
  inicio: number,
  cursor: number,
  candidato: MentionCandidate,
): { texto: string; cursor: number; pick: MentionPick } {
  const token = `@${candidato.name}`
  const antes = texto.slice(0, inicio)
  const depois = texto.slice(cursor)
  // Just one space: if there was one after already, typing another left two.
  const separador = depois.startsWith(" ") ? "" : " "
  const novo = `${antes}${token}${separador}${depois}`
  return {
    texto: novo,
    cursor: inicio + token.length + separador.length,
    pick: { token, address: candidato.address },
  }
}

/**
 * Swap names for addresses at send time.
 *
 * Only mentions whose text is STILL THERE pass through. Anyone who picked a person
 * then deleted the name by hand did not mention them, and notifying them anyway
 * would be the app claiming something not written anywhere.
 *
 * Longest to shortest, on purpose: with "@Ana" and "@Ana Rita" in the same text,
 * swapping the short one first would eat the start of the long one and the second
 * person would stop being mentioned.
 */
export function aplicarMencoes(corpo: string, picks: readonly MentionPick[]): { corpo: string; mentions: string[] } {
  const porTamanho = [...picks].sort((a, b) => b.token.length - a.token.length)
  const enderecos: string[] = []
  let resultado = corpo

  for (const pick of porTamanho) {
    if (!resultado.includes(pick.token)) continue
    resultado = resultado.split(pick.token).join(pick.address)
    if (!enderecos.includes(pick.address)) enderecos.push(pick.address)
  }

  return { corpo: resultado, mentions: enderecos.slice(0, MENTIONS_MAX) }
}

/**
 * Words that mention everyone: `@all`, `@todos`, and `@everyone`.
 * The interface is in Portuguese, and people coming from Discord use the English form.
 * In the thread they all become `MENCAO_TODOS`; the body keeps what was written.
 */
export const PALAVRAS_DE_TODOS = ["all", "todos", "everyone"] as const

/**
 * The suggestion for everyone in the mentions list. The address is the thread text
 * (`MENCAO_TODOS`), which is never an account, and the name is what gets displayed.
 */
export const CANDIDATO_TODOS: MentionCandidate = { address: MENCAO_TODOS, name: "all" }

/**
 * Suggestions with `@all` when the writer has `mencionartodos` here.
 *
 * Always at the end, never at the start. The first item in the list is what Enter
 * selects, and an @ followed by Enter must not accidentally notify the whole channel.
 * `@all` appears when what was written is the start of one of the three words, and
 * with @ alone.
 */
export function sugerirMencoesComTodos(
  candidatos: readonly MentionCandidate[],
  procura: string,
  podeMencionarTodos: boolean,
  limite = MENTION_LIMIT,
): MentionCandidate[] {
  const alvo = dobrar(procura)
  const comTodos = podeMencionarTodos && PALAVRAS_DE_TODOS.some((palavra) => palavra.startsWith(alvo))
  if (!comTodos) return sugerirMencoes(candidatos, procura, limite)
  return [...sugerirMencoes(candidatos, procura, limite - 1), CANDIDATO_TODOS]
}

/** `@all`, `@todos`, or `@everyone` written as a complete word, not joined to another. */
const TODOS_NO_CORPO = /(?:^|[^\p{L}\p{N}_@.-])@(?:all|todos|everyone)(?![\p{L}\p{N}_-])/iu

/**
 * The addresses to send, with the everyone mention only if the writer can use it.
 *
 * `aplicarMencoes` for people. Choosing `@all` from the list does not change the text:
 * the body still shows `@all`, and someone reading an old version reads the word.
 * The body decides, not the choice: `@all` typed manually by someone with permission
 * counts, and `@all` selected then deleted does not count.
 *
 * Without permission, `@all` is plain text and does not mention anyone. The receiver
 * still checks it (`mencoesConferidas`, in the core): this is what this app sends,
 * not a guarantee.
 */
export function aplicarMencoesComTodos(
  corpo: string,
  picks: readonly MentionPick[],
  podeMencionarTodos: boolean,
): { corpo: string; mentions: string[] } {
  const resultado = aplicarMencoes(
    corpo,
    picks.filter((pick) => pick.address !== MENCAO_TODOS),
  )
  if (!podeMencionarTodos || !TODOS_NO_CORPO.test(corpo)) return resultado
  return { corpo: resultado.corpo, mentions: [...resultado.mentions.slice(0, MENTIONS_MAX - 1), MENCAO_TODOS] }
}

/**
 * Was I mentioned in this message?
 *
 * Yes, if the message has my address. Also yes if it has `MENCAO_TODOS`:
 * the core only lets it reach here if the author has `mencionartodos` in that room
 * (`#comMencoesConferidas`), so we do not check again here.
 *
 * `todosCalado`: the message location is muted. Then `@all` does not count, and
 * name mentions still go through as always. See `lib/silenciados.ts`.
 */
export function mencionaMe(mentions: readonly string[] | undefined, me: string | null, todosCalado = false): boolean {
  if (!me || !mentions) return false
  if (mentions.includes(me)) return true
  return !todosCalado && mentions.includes(MENCAO_TODOS)
}

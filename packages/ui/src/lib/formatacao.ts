/**
 * Bold, italic, code, strikethrough, and spoiler within message text.
 *
 * **This returns a tree, never markup.** It is the same rule that `RichText`
 * already followed for links and mentions, and it is written at the top of that
 * file: text is split into pieces and pieces become React elements. An interpreted
 * HTML string would solve this in three lines and open the door that the rest of
 * the product spends time closing. Here there is no string being interpreted,  * there is a list of pieces, each with a type.
 *
 * **None of this touches the protocol.** Formatting lives in the text the person
 * wrote and is interpreted on read. The body stays body, and a client that does not
 * know this shows the asterisks, which degrades gracefully.
 *
 * **The syntax is Markdown, which everyone already writes:**
 *
 *   `**negrito**` · `*itálico*` · `` `código` `` · `~~rasurado~~` · `||coberto||`
 *
 * **The two new markers are TWO characters, and that is not aesthetics.** A `~`
 * alone is in `~/documentos` and in an approximation (`~5 minutos`); a `|` alone is in any
 * table and in any command with a pipe through it. Any one of them counting as
 * syntax would break text that people write every day, which is the same argument
 * for underline, below.
 *
 * **And underline is NOT italic**, unlike Markdown and Discord. It is the most
 * important decision in this file and it is because of links: `exemplo.pt/a_b_c` is a
 * common path, and in a product where links are clickable, making it italic would
 * break it in front of whoever wrote it. Asterisks almost never appear in a link;
 * underscores appear every day. One less syntax is worth more than a broken link.
 *
 * **Links and mentions are PROTECTED zones.** Markers that fall inside do not
 * count, see `zonasProtegidas`. Without that, a `https://a.pt/x*y*z` would have the middle in italic
 * and the link broken. And the opposite had to work too: `**vê https://a.pt**` becomes bold
 * WITH the link inside it clickable, because the protection is about markers,
 * not text.
 */

import { MENTION_ADDRESS } from "./mentions.js"

/**
 * What counts as a web address, in one declaration.
 *
 * Exported as SOURCE not as `RegExp` on purpose: an expression with `g` carries
 * a mutable `lastIndex`, and two parts of the code sharing the same object would
 * end up stepping on each other's search. Each place builds its own from here,
 * and the grammar stays one, `RichText` imports this instead of having a copy.
 *
 * **The backtick is among the excluded characters, and it was not.** A
 * `` `curl https://exemplo.pt` `` made the address swallow the closing backtick;
 * the code block would not close and the command showed up as a link to a place
 * with a backtick at the end. No real address has backticks, and the price of
 * excluding them is zero.
 *
 * **The pipe came through the same door and the same day as the spoiler.** A
 * `||vê https://exemplo.pt||` made the address swallow both closing pipes: the
 * spoiler never closed, and what showed up was a link to a place with two pipes
 * at the end, visible, when it should have been hidden. A bare `|` in an
 * address is invalid by RFC 3986 (anyone who needs it writes `%7C`), so the
 * price is zero again.
 *
 * **The tilde is NOT excluded, and that is the difference that matters.** `~`
 * is a legitimate address character, `exemplo.pt/~alguem` is a timeless personal
 * page, and that is why strikethrough inside an address resolves through the
 * protected zone not grammar. See the test for `a~~b~~c`.
 */
export const ENDERECO_FONTE = String.raw`(?:https?:\/\/|www\.)[^\s<>"')\]}\`|]+`

const ENDERECOS = new RegExp(ENDERECO_FONTE, "gi")

export type Pedaco =
  | { tipo: "texto"; texto: string }
  /** Literal inside: no formatting, no links. That is what "code" means. */
  | { tipo: "codigo"; texto: string }
  | { tipo: "forte"; filhos: Pedaco[] }
  | { tipo: "enfase"; filhos: Pedaco[] }
  | { tipo: "rasurado"; filhos: Pedaco[] }
  /**
   * Hidden until someone taps it. Still has children like the others: an
   * `||o **fim**||` stays bold after it is uncovered, not lose formatting as
   * punishment for being hidden.
   */
  | { tipo: "spoiler"; filhos: Pedaco[] }

/**
 * The ranges of text where a marker does not count.
 *
 * Web addresses and mentions, by the same expressions that draw them. Returned
 * as pairs of indices, not as pieces, because the caller needs to know
 * WHERE they are to jump over them while scanning the rest.
 */
function zonasProtegidas(texto: string): [number, number][] {
  const zonas: [number, number][] = []
  for (const expressao of [ENDERECOS, MENTION_ADDRESS]) {
    expressao.lastIndex = 0
    for (let achado = expressao.exec(texto); achado !== null; achado = expressao.exec(texto)) {
      zonas.push([achado.index, achado.index + achado[0].length])
      // A pattern without `g` never advances and `exec` returned the same match
      // forever. Both have `g`, and this line is insurance against the day
      // someone removes the flag.
      if (!expressao.global) break
    }
    expressao.lastIndex = 0
  }
  return zonas
}

/** Is this index inside an address or a mention? */
function protegido(zonas: [number, number][], indice: number): boolean {
  return zonas.some(([inicio, fim]) => indice >= inicio && indice < fim)
}

function espaco(caractere: string | undefined): boolean {
  return caractere === undefined || /\s/.test(caractere)
}

/**
 * The attachment rule, which is what saves the arithmetic.
 *
 * A marker only OPENS if it is attached to what comes next, and only CLOSES if
 * it is attached to what comes before. It is the Markdown rule, and it exists for
 * a reason you see in an example: `5 * 4 * 3` are two multiplications, and without it
 * the " 4 " in the middle would be italic. Nobody writes `*4*` with spaces inside
 * when they want italic, and everyone writes `5 * 4` when they want to multiply.
 */
function abre(texto: string, indice: number, marcador: string): boolean {
  return !espaco(texto[indice + marcador.length])
}

/**
 * Search for the closing marker, skipping protected zones.
 *
 * Returns the index where it starts, or -1. A marker that only opens stays
 * literal text, never consume the rest of the sentence looking for a pair that does not exist.
 */
function procurarFecho(
  texto: string,
  marcador: string,
  desde: number,
  zonas: [number, number][],
  exigirEncosto: boolean,
): number {
  for (let i = desde; i <= texto.length - marcador.length; i++) {
    if (protegido(zonas, i)) continue
    if (!texto.startsWith(marcador, i)) continue
    // Attached to what comes before, or it closes nothing, and keep
    // searching instead of giving up: `*a * b*` closes at the last one, not the middle one.
    if (exigirEncosto && espaco(texto[i - 1])) continue
    return i
  }
  return -1
}

/** Append text to the last chunk if it is already text. Avoids a list of letters. */
function acrescentarTexto(pedacos: Pedaco[], texto: string): void {
  if (texto === "") return
  const ultimo = pedacos[pedacos.length - 1]
  if (ultimo && ultimo.tipo === "texto") ultimo.texto += texto
  else pedacos.push({ tipo: "texto", texto })
}

/**
 * The text of a message, in chunks with type.
 *
 * Scans left to right and never goes back. Each marker either closes, and
 * then opens a chunk, or does not close, and then it is a letter like the rest. That
 * is the rule that guarantees nothing written disappears from the screen.
 */
export function analisarFormatacao(texto: string): Pedaco[] {
  return analisar(texto, zonasProtegidas(texto), 0, texto.length)
}

function analisar(texto: string, zonas: [number, number][], inicio: number, fim: number): Pedaco[] {
  const pedacos: Pedaco[] = []
  let i = inicio

  while (i < fim) {
    if (protegido(zonas, i)) {
      // Inside an address or mention: copy as-is until it ends. The
      // `RichText` transforms them afterward, and transforms them from the text.
      const zona = zonas.find(([de, ate]) => i >= de && i < ate)
      const ate = Math.min(zona?.[1] ?? i + 1, fim)
      acrescentarTexto(pedacos, texto.slice(i, ate))
      i = ate
      continue
    }

    // Code first: what is between backticks is literal, and literal means
    // the asterisks inside do not count either.
    // The backtick does not require attachment: a command often starts and ends
    // with space, and `` ` ls -la ` `` is something people write.
    if (texto[i] === "`") {
      const fecho = procurarFecho(texto, "`", i + 1, zonas, false)
      if (fecho !== -1 && fecho < fim && fecho > i + 1) {
        pedacos.push({ tipo: "codigo", texto: texto.slice(i + 1, fecho) })
        i = fecho + 1
        continue
      }
    }

    // `**` before `*`: the other way around, bold would read as two empty
    // italics attached.
    if (texto.startsWith("**", i) && abre(texto, i, "**")) {
      const fecho = procurarFecho(texto, "**", i + 2, zonas, true)
      if (fecho !== -1 && fecho + 2 <= fim && fecho > i + 2) {
        pedacos.push({ tipo: "forte", filhos: analisar(texto, zonas, i + 2, fecho) })
        i = fecho + 2
        continue
      }
    }

    if (texto[i] === "*" && abre(texto, i, "*")) {
      const fecho = procurarFecho(texto, "*", i + 1, zonas, true)
      if (fecho !== -1 && fecho < fim && fecho > i + 1) {
        pedacos.push({ tipo: "enfase", filhos: analisar(texto, zonas, i + 1, fecho) })
        i = fecho + 1
        continue
      }
    }

    // Risk and tilde work the same way as asterisks: two characters, one on each side, and nothing happens if they don't close. A lone `~` or `|` never reaches here because we only look at pairs, that's what saves `~/notas` and `a | b`.
    if (texto.startsWith("~~", i) && abre(texto, i, "~~")) {
      const fecho = procurarFecho(texto, "~~", i + 2, zonas, true)
      if (fecho !== -1 && fecho + 2 <= fim && fecho > i + 2) {
        pedacos.push({ tipo: "rasurado", filhos: analisar(texto, zonas, i + 2, fecho) })
        i = fecho + 2
        continue
      }
    }

    if (texto.startsWith("||", i) && abre(texto, i, "||")) {
      const fecho = procurarFecho(texto, "||", i + 2, zonas, true)
      if (fecho !== -1 && fecho + 2 <= fim && fecho > i + 2) {
        pedacos.push({ tipo: "spoiler", filhos: analisar(texto, zonas, i + 2, fecho) })
        i = fecho + 2
        continue
      }
    }

    // Nothing opened: it is a letter. A marker without a pair lands here and
    // draws as-is, which is what whoever wrote `2 * 3` expects to see.
    acrescentarTexto(pedacos, texto[i] ?? "")
    i += 1
  }

  return pedacos
}

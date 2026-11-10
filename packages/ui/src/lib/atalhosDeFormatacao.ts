/**
 * Format with the keyboard over the selection. This is everyone's Cmd+B.
 *
 * **This is NOT an editor.** The text box stays an `input` with text inside,
 * and what these functions do is write the markers for you at both ends of the
 * selection. That is the difference between a shortcut and a rich text field,
 * and the choice is deliberate: a rich field would store styles apart from the
 * text, and then would have to serialize them back to text anyway, because
 * **what goes out on the wire is text and nothing else**. See `formatacao.ts`:
 * formatting lives in markup, not in new protocol fields, and that is how an
 * old client shows asterisks instead of throwing the message away.
 *
 * **The key table and why these:**
 *
 *   `Cmd/Ctrl+B` bold · `Cmd/Ctrl+I` italic
 *   `Cmd/Ctrl+Shift+X` strikethrough · `Cmd/Ctrl+Shift+E` spoiler
 *
 * The first two are the only ones Discord actually has, for strikethrough and
 * spoiler it publishes no shortcut, so there is no habit to respect. The second
 * two were chosen by elimination from the combinations the browser sends us:
 * `Ctrl+Shift+B` is Chrome's bookmarks bar, `Ctrl+Shift+I` and `Ctrl+Shift+J`
 * are the developer tools, `Ctrl+Shift+O` is the bookmarks manager,
 * `Ctrl+Shift+N` is the private window, and `Ctrl+Shift+M` is already the
 * microphone here. Few options left. X strikes and E hides, which is the best
 * mnemonic available.
 *
 * **Discord's `Cmd/Ctrl+U` does not exist here** because underline is not
 * syntax in this product, it is written why in `formatacao.ts`, and it has to
 * do with URLs that carry underscores in the path. A shortcut that put markers
 * the reader does not recognize would promise formatting and deliver
 * punctuation.
 *
 * **The known cost:** on Firefox, `Ctrl+Shift+E` opens the network monitor.
 * This is noted because it is a real loss on that browser and not something you
 * discover later; on others, and in Electron, the combination is free.
 */

/** The four markers that a shortcut can write. */
export type Marcador = "**" | "*" | "~~" | "||"

/**
 * What marker this combination asks for, if any.
 *
 * Separated from the effect so it can be tested without a document, the same
 * split that `accaoDe` in `hooks/useAtalhos.ts` does, and for the same reason:
 * what matters to lock is the table.
 */
export function marcadorDe(event: {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}): Marcador | null {
  // `Ctrl` or `Cmd`: on macOS the second is what the hand does without thinking,
  // and requiring `Ctrl` there would be a shortcut nobody gets right the first
  // time.
  const comando = event.ctrlKey === true || event.metaKey === true
  if (!comando) return null
  // With `Alt` it is not ours. It is the gate to accents on several keyboards and
  // to menus on Windows, and taking it breaks things we should not break.
  if (event.altKey === true) return null

  const shift = event.shiftKey === true
  // With Shift pressed the browser sends the letter in uppercase. Comparing
  // without lowercasing made the shortcut work in theory and never in practice.
  const tecla = event.key.toLowerCase()

  if (!shift && tecla === "b") return "**"
  if (!shift && tecla === "i") return "*"
  if (shift && tecla === "x") return "~~"
  if (shift && tecla === "e") return "||"
  return null
}

/** The text after the shortcut, and where the selection lands. */
export interface Envolvido {
  texto: string
  inicio: number
  fim: number
}

/**
 * Puts, or removes, markers around the selection.
 *
 * **The selection ends on the SAME letters**, and that is not a detail: it is
 * what makes the second Cmd+B undo the first without touching the mouse. A shortcut
 * that moved the selection would force you to reselect it with every gesture, and at that point
 * it was faster to type the asterisks by hand.
 *
 * **Removal is recognized two ways**, because there are two ways a person
 * can get here: with markers outside the selection (the shortcut put them there)
 * or with them inside it (marked with the mouse and caught them). Both mean
 * the same thing, remove this, and treating them differently gave a
 * `****urgente****` to someone who just wanted to undo.
 */
export function envolver(texto: string, inicioBruto: number, fimBruto: number, marcador: Marcador): Envolvido {
  // Dragging the mouse right to left puts the start after the end on some paths.
  // Without this, the `slice` came out empty and the text got cut.
  const inicio = Math.min(inicioBruto, fimBruto)
  const fim = Math.max(inicioBruto, fimBruto)
  const largura = marcador.length

  // ------------------------------------------------------------- remove
  //
  // Markers are outside the selection: `isto é **[urgente]**`.
  if (
    texto.slice(inicio - largura, inicio) === marcador &&
    texto.slice(fim, fim + largura) === marcador &&
    !metadeDeOutro(texto, inicio - largura, fim + largura, marcador)
  ) {
    return {
      texto: texto.slice(0, inicio - largura) + texto.slice(inicio, fim) + texto.slice(fim + largura),
      inicio: inicio - largura,
      fim: fim - largura,
    }
  }

  // And inside it: `isto é [**urgente**]`.
  const dentro = texto.slice(inicio, fim)
  if (
    dentro.length > largura * 2 &&
    dentro.startsWith(marcador) &&
    dentro.endsWith(marcador) &&
    !metadeDeOutro(texto, inicio, fim, marcador)
  ) {
    const limpo = dentro.slice(largura, dentro.length - largura)
    return {
      texto: texto.slice(0, inicio) + limpo + texto.slice(fim),
      inicio,
      fim: inicio + limpo.length,
    }
  }

  // ------------------------------------------------------------- add
  //
  // Without selection, the pair stays open and the cursor inside: it is the
  // gesture of someone who presses Cmd+B BEFORE typing, and types already in
  // bold.
  return {
    texto: texto.slice(0, inicio) + marcador + texto.slice(inicio, fim) + marcador + texto.slice(fim),
    inicio: inicio + largura,
    fim: fim + largura,
  }
}

/**
 * Is this asterisk part of a bold marker?
 *
 * Only italic has this problem, and it is a real one: in `**a**` with "a"
 * selected, the `*` touching each side is half of the bold marker. Removing it
 * left `*a*`, bold undone by a request for italic, which no one asked for.
 */
function metadeDeOutro(texto: string, inicio: number, fim: number, marcador: Marcador): boolean {
  if (marcador !== "*") return false
  return texto[inicio - 1] === "*" || texto[fim] === "*"
}

/**
 * The order of categories in the sidebar when dragging one.
 *
 * **We move the category, not its contents.** Rooms are ordered
 * WITHIN their category, that is what `reordenar.ts` does, and each room's `category`
 * already says which one it belongs to. Changing the category order moves the entire
 * block without touching a single room, and a loop over rooms here would signal
 * that the model was wrong: dozens of encrypted messages rewriting what did not change.
 *
 * Convention, like reordering rooms and renaming: publish the order, and honest
 * clients follow it. It is the same responsibility, `renomear`, that grants
 * all three rights.
 *
 * Pure functions, and outside the screen, for the usual reason: what we decide here is
 * the model, and the model deserves tests that read without building the app.
 */

/** A category statement to publish: the name and its new order. */
export interface Ordenacao {
  category: string
  position: number
}

/** The gap between consecutive categories, as in `reordenar.ts`. */
const PASSO = 100

/**
 * Does dropping `arrastada` on `alvo` place it AFTER the target?
 *
 * **Yes when moving down, no when moving up**, and it is not arbitrary, it is what makes
 * all positions reachable. A room reaches the end of a category by dropping it on
 * that category's header; a category has no header after the last one, and with
 * a "always drop before" rule the last position in the list was unreachable: to put
 * a category there you had to drag all the others above it.
 *
 * Exported because whoever draws the "will land here" mark must draw it on the same
 * side where it actually lands. Two copies of this rule diverging would make the
 * mark lie about the result of the gesture.
 */
export function largaDepois(ordem: readonly string[], arrastada: string, alvo: string): boolean {
  const de = ordem.indexOf(arrastada)
  const para = ordem.indexOf(alvo)
  return de >= 0 && para >= 0 && de < para
}

/**
 * Move `arrastada` to the position of `alvo`, and say what needs to be published.
 *
 * `ordem` is the order VISIBLE today, top to bottom, the same one the sidebar
 * draws. `declaradas` are the categories already published with a position.
 *
 * Loose rooms are left out of this on purpose. They are not in a category:
 * they are in none, their group has no header, and without a header there is
 * no handle and no target. They stay at the head of the list where they have always been,
 * and a statement with an empty name never leaves here, `useRooms` would reject it anyway.
 */
export function largarCategoriaEm(
  ordem: readonly string[],
  declaradas: readonly Ordenacao[],
  arrastada: string,
  alvo: string,
): Ordenacao[] {
  // Loose rooms are not a category; see above.
  const lista = ordem.filter((nome) => nome !== "")
  const de = lista.indexOf(arrastada)
  const para = lista.indexOf(alvo)
  if (de < 0 || para < 0 || arrastada === alvo) return []

  const resto = lista.filter((nome) => nome !== arrastada)
  const j = resto.indexOf(alvo)
  resto.splice(largaDepois(lista, arrastada, alvo) ? j + 1 : j, 0, arrastada)

  return numerar(resto, declaradas)
}

/**
 * Assigns numbers to the requested order and returns only what needs to be published.
 *
 * **An unpublished category always publishes, even if it lands on the same number.**
 * This is the most common case, because old categories were born this way: they exist
 * because they appear in a room's `category` field, and never had their own statement.
 * Without a statement there is nowhere to store the position, and `useRooms` sends
 * unpublished ones to the end of the list, so publishing only the dragged one
 * and leaving the others as they were would move it to the top, no matter where
 * you dropped it. That is why the first drag in an old tree publishes the whole list;
 * the rest publish two or three.
 *
 * As for those already published in the right place, they stay silent: republishing them
 * would be an encrypted message per category on every drag just to say nothing.
 */
function numerar(ordem: readonly string[], declaradas: readonly Ordenacao[]): Ordenacao[] {
  const posicoes = new Map(declaradas.map((entrada) => [entrada.category, entrada.position]))
  const mudancas: Ordenacao[] = []
  ordem.forEach((category, indice) => {
    const position = indice * PASSO
    if (posicoes.get(category) === position) return
    mudancas.push({ category, position })
  })
  return mudancas
}

/**
 * The names of categories whose publication failed.
 *
 * Same reason as in `categorias.ts`: each statement is an independent encrypted
 * message, there is no transaction to invent, and if some fail the list stays half-sorted,  * the ones that did not go through stay on their old number or unpublished, and
 * in that case drop to the end. Retrying the gesture is safe, because each
 * publication says where the category is, not what changed; but to retry you
 * need to know it was left incomplete.
 */
export function asQueFicaramParaTras(
  mudancas: readonly Ordenacao[],
  resultados: readonly PromiseSettledResult<unknown>[],
): string[] {
  return mudancas.filter((_, indice) => resultados[indice]?.status === "rejected").map((m) => m.category)
}

import type { ChannelRoom } from "../../bridge.js"

/**
 * Where each channel ends up after dragging one to another place.
 *
 * Reordering is **convention**, like renaming: you publish the order, and
 * honest clients follow it. There is nothing here that enforces it, and no need
 * to say it again, it is stated in the rename capability, which is the same
 * one that gives you the right to this.
 *
 * Pure function, separate from the screen, because of the trap: `position` is
 * an INTEGER in the protocol. Inserting "between two" with an average gives a
 * half number, which the sender refuses, and the refusal happens at the end,
 * after the gesture, when no one connects it to the drag anymore. So what we do
 * is renumber the destination category with space between channels, and publish
 * only what actually changed.
 */

/** A reorder step to publish: the channel, and where it goes. */
export interface Arrumacao {
  room: string
  category: string
  position: number
}

/** The space between consecutive channels. Large enough that most later drags
 *  do not need renumbering everything. */
const PASSO = 100

/**
 * Drop the `dragged` channel immediately before `target`.
 *
 * The target sets the category: dragging over a channel from another category
 * moves it to that category, which is how you move categories without inventing
 * a second gesture for it.
 */
export function largarAntesDe(salas: ChannelRoom[], arrastado: string, alvo: string): Arrumacao[] {
  const origem = salas.find((sala) => sala.room === arrastado)
  const destino = salas.find((sala) => sala.room === alvo)
  if (!origem || !destino || arrastado === alvo) return []

  const categoria = destino.category
  const naCategoria = salas
    .filter((sala) => sala.category === categoria && sala.room !== arrastado)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))

  const ordem: ChannelRoom[] = []
  for (const sala of naCategoria) {
    if (sala.room === alvo) ordem.push(origem)
    ordem.push(sala)
  }
  return numerar(ordem, categoria, salas)
}

/**
 * Drop the channel at the end of a category, what happens when you drop on
 * its header, and the only way to put it in an empty category.
 */
export function largarNaCategoria(salas: ChannelRoom[], arrastado: string, categoria: string): Arrumacao[] {
  const origem = salas.find((sala) => sala.room === arrastado)
  if (!origem) return []
  if (origem.category === categoria) {
    // Already there: only moves if it is not already last.
    const naCategoria = salas.filter((sala) => sala.category === categoria)
    if (naCategoria.at(-1)?.room === arrastado) return []
  }

  const ordem = [
    ...salas
      .filter((sala) => sala.category === categoria && sala.room !== arrastado)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    origem,
  ]
  return numerar(ordem, categoria, salas)
}

/**
 * Number the requested order and return only what changes.
 *
 * Publishing rooms that were already correct would be one encrypted message per
 * room, and with each drag, noise in the channel to say nothing.
 */
function numerar(ordem: ChannelRoom[], categoria: string, salas: ChannelRoom[]): Arrumacao[] {
  const mudancas: Arrumacao[] = []
  ordem.forEach((sala, indice) => {
    const position = indice * PASSO
    const antes = salas.find((candidata) => candidata.room === sala.room)
    if (antes && antes.position === position && antes.category === categoria) return
    mudancas.push({ room: sala.room, category: categoria, position })
  })
  return mudancas
}

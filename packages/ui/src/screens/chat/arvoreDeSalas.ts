import type { ChannelRoom } from "../../bridge.js"
import type { RoomGroup } from "../../hooks/useRooms.js"
import { SALA_POR_OMISSAO } from "../../hooks/useRooms.js"
import { categoriaVisivel, type QuemVe } from "./categorias.js"

/**
 * Does this channel have a tree of rooms, or is it just a conversation?
 *
 * **This question decides if the drawer leaves the screen on tap.** On a phone
 * the channel bar is a drawer over the chat, and tapping a channel had two
 * possible meanings: "show me the rooms in this channel" or "take me to its
 * chat". Which one depends only on this, a channel with rooms has more to say
 * in the drawer, a channel without rooms already said everything.
 *
 * Two gates to the same question, because it comes from two places with
 * different data:
 *
 * - `temArvore`, about the already built groups: the OPEN channel, and the
 *   sidebar holds the groups.
 * - `canalTemArvore`, about what's in the vault: any channel, and the question
 *   asked at the moment of the tap, before the chosen channel becomes open and
 *   `useRooms` builds its groups.
 *
 * The two answer the same, and there's a test that puts them side by side
 * against the same channels. It's not pedantry: the same rule written in
 * different files, and the only thing that keeps them from diverging silently
 * is that test.
 */

/**
 * Is there more than the default room, or a declared category?
 *
 * The default room alone is not a tree: a channel with just one chat still
 * looks like what it always was, with no headers announcing structure that
 * doesn't exist. A declared category IS a tree even if empty, because that's
 * where rooms land.
 */
export function temArvore(grupos: readonly RoomGroup[]): boolean {
  return grupos.some((grupo) => grupo.category !== "" || grupo.rooms.some((sala) => sala.room !== SALA_POR_OMISSAO))
}

/** A category as the vault gives it: the name, and who sees its rooms. */
export interface CategoriaDoCofre {
  category: string
  /** Empty (or absent) means everyone. See `categoriaVisivel`. */
  roles?: readonly string[] | undefined
}

/**
 * The same question about a channel that isn't open yet, from the vault.
 *
 * Builds the groups in miniature in the same order as `useRooms` builds them,  * declared categories first (empty ones exist), then rooms, then the cutoff for
 * those who can't see the category, and asks them the same question that
 * `temArvore` asks. Only missing is what `useRooms` adds from messages still
 * pending in the vault: a room created a moment ago by someone else. That delay
 * is a moment and the symptom would be the drawer closing on a channel that just
 * got its first room.
 *
 * The default room that `useRooms` injects when the vault doesn't have it is
 * also not missing here, because it doesn't change any answer: it's exactly the
 * room that doesn't count as a tree.
 */
export function canalTemArvore(
  salas: readonly ChannelRoom[],
  categorias: readonly CategoriaDoCofre[],
  quemVe: QuemVe | undefined,
): boolean {
  const papeisDe = new Map<string, readonly string[] | undefined>()
  for (const entrada of categorias) papeisDe.set(entrada.category, entrada.roles)
  // With nobody identified, nothing hides, like in `useRooms`.
  const visivel = (category: string): boolean => !quemVe || categoriaVisivel(papeisDe.get(category), quemVe)

  const porCategoria = new Map<string, ChannelRoom[]>()
  for (const entrada of categorias) porCategoria.set(entrada.category, [])
  for (const sala of salas) {
    const lista = porCategoria.get(sala.category)
    if (lista) lista.push(sala)
    else porCategoria.set(sala.category, [sala])
  }

  for (const [category, lista] of porCategoria) {
    // The default room never hides: see `esconderSePreciso`.
    const visiveis = visivel(category) ? lista : lista.filter((sala) => sala.room === SALA_POR_OMISSAO)
    // A group disappears when it runs out of rooms, except for the declared and
    // visible category, which shows empty because that's where rooms land.
    if (visiveis.length === 0 && !(category !== "" && visivel(category))) continue
    if (category !== "") return true
    if (visiveis.some((sala) => sala.room !== SALA_POR_OMISSAO)) return true
  }
  return false
}

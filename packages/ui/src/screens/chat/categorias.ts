import type { ChannelRoom } from "../../bridge.js"

/**
 * Rename a category, and delete it.
 *
 * **A category is not an entity.** There is nothing stored that you can call a category: it is the name written in the `category` field of each channel, and it exists as long as some channel declares it. That's why there's nothing here like "edit a category", there's rewriting a field in several channels, which is what the operation actually is.
 *
 * Pure functions, and separate from the UI, for the same reason as `reordenar` and `menuItems`: what we decide here is the model, and the model deserves tests that don't need the full app to be readable.
 */

/** What changing category forces you to publish, and what that will cause. */
export interface MudancaDeCategoria {
  /** The channels to republish, already with the new name written in `category`. */
  publicacoes: ChannelRoom[]
  /**
   * Does the destination name already belong to another category?
   *
   * Then the two become one, because two identical labels are the same label. It's not a bug and we don't reject it, the model is working. What we can't do is surprise them, so this comes out of here so whoever triggers it is warned BEFORE.
   */
  funde: boolean
}

/**
 * Rewrite the `category` of channels declaring `de`, changing it to `para`.
 *
 * Empty `para` means delete the category: channels lose the label and become untagged. **Never deletes channels**, the category is the label, channels are the content, and removing the label sets them free instead of taking them along. That's the costly confusion in this gesture, which is why there is no path here that produces fewer channels than what went in.
 */
export function mudarCategoria(salas: ChannelRoom[], de: string, para: string): MudancaDeCategoria {
  const nome = para.trim()
  // Only the ones declaring this category. A channel from another has nothing to do with this, and republishing it would be an encrypted message saying what was already there.
  const afectados = salas.filter((sala) => sala.category === de)
  if (afectados.length === 0 || nome === de) return { publicacoes: [], funde: false }
  return {
    publicacoes: afectados.map((sala) => ({ ...sala, category: nome })),
    // Empty means untagged, and untagged doesn't merge with anything: "no category" is not a category to collide with.
    funde: nome !== "" && salas.some((sala) => sala.category === nome),
  }
}

/**
 * The names of channels that didn't get updated.
 *
 * **This is where a category splits without anyone knowing why.** Changing a category is one publication PER CHANNEL, and there's no transaction to invent: each `channel.meta` is an independent encrypted message, and a channel that didn't receive its update keeps the old name. The list then appears split across two categories, which is indistinguishable from a failure if nobody says so.
 *
 * We try all of them before giving up, stopping at the first failure would also leave the category split, just more split and without even trying what might have worked. The ones left behind are named because that's why people repeat the gesture; and repeating is harmless, since each publication says where the channel is, not what changed.
 */
export function osQueFicaramParaTras(
  publicacoes: ChannelRoom[],
  resultados: readonly PromiseSettledResult<unknown>[],
): string[] {
  return publicacoes.filter((_, indice) => resultados[indice]?.status === "rejected").map((sala) => sala.name)
}

/** Who is looking at the list: the roles they have, and whether they administer the channel. */
export interface QuemVe {
  /** The roles of this account in this channel, by ID. See `rolesFor`. */
  papeis: readonly string[]
  /**
   * Whether this account administers the channel. See `mayEdit` on the bridge.
   *
   * Always sees everything, and it's not courtesy: without this, if someone restricts a category to roles they don't have, they hide it from themselves, and the only way to show it again is the hidden category. Tidying cannot be irreversible.
   */
  administra: boolean
}

/**
 * Are the rooms in this category visible?
 *
 * **This is tidying, not security, and this function is the right place to say so**, because this is where the temptation lives. Anyone in the channel has the keys to ALL its public rooms, the room is not a cryptographic group, it's a label inside the channel's group, so a `false` here doesn't stop anyone from reading: it removes lines from a list. A modified client ignores this and shows everything, and messages keep arriving. See the `roles` field in `channel.category`, and the note the UI shows to whoever chooses.
 *
 * The behavior matches Discord: if you don't have the role you don't see the category OR its rooms. The alternative, you see the category, you can't enter the rooms, changes in one line: instead of removing the group from the list, we'd mark the rooms as closed to clicks. We chose to hide because a list full of locked doors is worse than a short list, and announcing a room's existence to someone who can't use it invites questions about what's in there.
 *
 * Empty `exigidos` is the NORMAL case and the most important one: the vast majority of categories have no restriction, and the ones already published in today's vaults don't bring the field. Empty means everyone, never nobody.
 */
export function categoriaVisivel(exigidos: readonly string[] | undefined, quem: QuemVe): boolean {
  // The normal case first, because it's the case for almost everything.
  if (!exigidos || exigidos.length === 0) return true
  if (quem.administra) return true
  return exigidos.some((papel) => quem.papeis.includes(papel))
}

/**
 * The built-in role, and the only ID the UI writes by hand.
 *
 * It's the `ADMIN_ROLE` from the core. It's never declared, redefined, or deleted, and what matters here is that **`rolesOf` deliberately leaves it out of the channel's role list**: whoever shows roles is who gives them a display name, and a presentation name doesn't belong in the core. It's because it's not in that list that it serves as a marker for "admins only" without colliding with any role someone might create.
 *
 * Copied and not imported because `@enclave/ui` talks to the core through the bridge and doesn't depend on it. If they ever diverge, this is what breaks, and it breaks on the safe side: a category marked with an ID that nobody has stays visible only to admins, which is exactly what it meant to say.
 */
export const PAPEL_ADMINISTRACAO = "admin"

/**
 * The three possible answers to "who sees this category".
 *
 * They're not a new field on the wire: they're three ways to read the SAME role list, which is all `channel.category` carries. The conversion goes both ways in `modoDeVisibilidade` and `papeisDoModo`, and that's where it must be read.
 */
export type ModoDeVisibilidade = "todos" | "administracao" | "papeis"

/**
 * What choice does this role list represent?
 *
 * **The empty list stays "everyone", and nothing here changes that.** What changes is it stops being the absence of a choice and becomes a named choice: whoever opens the UI sees "Everyone" checked, instead of empty boxes and a sentence explaining what that means.
 *
 * `["admin"]` is "admins only", and it's the maximum restriction this model can express: admins always see (see `categoriaVisivel`), so there's no way to hide a category from more people than this. A client that doesn't know this reading reaches the same place by the usual path, the list is not empty, so it restricts; admins pass through `administra`; and whoever has the built-in role passes through `papeis`, because `rolesFor` returns `["admin"]` to whoever has it. It's not a magic value others need to learn: it's the same mechanism with an ID that already existed.
 */
export function modoDeVisibilidade(exigidos: readonly string[] | undefined): ModoDeVisibilidade {
  if (!exigidos || exigidos.length === 0) return "todos"
  if (exigidos.length === 1 && exigidos[0] === PAPEL_ADMINISTRACAO) return "administracao"
  return "papeis"
}

/**
 * The way back: what gets published for each choice.
 *
 * `escolhidos` only counts in the third mode, and comes already in the order of the declared roles, the order of clicking boxes would make two identical choices publish different payloads.
 */
export function papeisDoModo(modo: ModoDeVisibilidade, escolhidos: readonly string[]): string[] {
  if (modo === "todos") return []
  if (modo === "administracao") return [PAPEL_ADMINISTRACAO]
  return [...escolhidos]
}

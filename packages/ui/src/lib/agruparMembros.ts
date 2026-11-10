/**
 * The member list for a channel, organized by role and presence.
 *
 * Pure, and that is why it is here and not inside `MemberPanel`: the rules for who shows
 * where are what you want to assert in a test without mounting a screen. The panel draws
 * what this function says.
 *
 * The template is Discord's, which is what the owner asked for: roles first, in channel
 * order; online members with no role next; and a final block with everyone offline, with no
 * division by role, a role is a responsibility over the channel, and the responsibility of
 * someone offline is not being exercised.
 */

/** The role of a person, as the shell resolves it. See `roleFor`, in `App`. */
export interface CargoDoMembro {
  /** The label of the subtext, which can list multiple roles. */
  label: string
  /** The color of that label, when the role naming it has one. */
  tint?: string | undefined
  /**
   * Where this person enters the list, when online.
   *
   * Comes from the SAME function that gives the label and color, not from a separate
   * function: three separate answers about the same person end up disagreeing, and the
   * first to disagree would be the color of a group the label does not name.
   */
  grupo?: { id: string; nome: string; ordem: number; tint?: string | undefined } | undefined
}

export interface GrupoDeMembros {
  id: string
  titulo: string
  tint?: string | undefined
  /** This is the block for offline members, which renders dimmed. */
  offline: boolean
  membros: string[]
}

export interface ComoAgrupar {
  /** Whether this person counts as present. Busy is present; invisible is not. */
  online: (address: string) => boolean
  cargoDe: (address: string) => CargoDoMembro | null
  /** The display name, which determines the list order. */
  nameFor: (address: string) => string
  titulos: { online: string; offline: string }
}

export function agruparMembros(members: readonly string[], como: ComoAgrupar): GrupoDeMembros[] {
  const porCargo = new Map<string, { ordem: number; titulo: string; tint?: string | undefined; membros: string[] }>()
  const semCargo: string[] = []
  const fora: string[] = []

  for (const membro of members) {
    if (!como.online(membro)) {
      fora.push(membro)
      continue
    }
    const grupo = como.cargoDe(membro)?.grupo
    if (!grupo) {
      semCargo.push(membro)
      continue
    }
    // The first occurrence sets the title and order: the same role must always bring the same
    // ones, and if it does not, the caller is the one lying.
    const existente = porCargo.get(grupo.id)
    if (existente) existente.membros.push(membro)
    else porCargo.set(grupo.id, { ordem: grupo.ordem, titulo: grupo.nome, tint: grupo.tint, membros: [membro] })
  }

  /* By display name, with the address breaking ties: without the tiebreaker, two people with
     the same name would swap places between renders, and a list that moves on its own under
     the cursor is worse than a badly ordered one. */
  const porNome = (a: string, b: string): number =>
    como.nameFor(a).localeCompare(como.nameFor(b), "pt") || a.localeCompare(b)

  const grupos: GrupoDeMembros[] = [...porCargo]
    .sort(([, umGrupo], [, outro]) => umGrupo.ordem - outro.ordem || umGrupo.titulo.localeCompare(outro.titulo, "pt"))
    .map(([id, grupo]) => ({
      id,
      titulo: grupo.titulo,
      ...(grupo.tint ? { tint: grupo.tint } : {}),
      offline: false,
      membros: [...grupo.membros].sort(porNome),
    }))

  // Empty groups do not appear: a header with nothing under it is a question without an answer
  // for the reader.
  if (semCargo.length > 0) {
    grupos.push({ id: "online", titulo: como.titulos.online, offline: false, membros: [...semCargo].sort(porNome) })
  }
  if (fora.length > 0) {
    grupos.push({ id: "offline", titulo: como.titulos.offline, offline: true, membros: [...fora].sort(porNome) })
  }

  return grupos
}

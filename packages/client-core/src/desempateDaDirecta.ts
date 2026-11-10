/**
 * The tiebreaker for a direct chat with two MLS groups (phase 1g, 28/10/2026).
 *
 * Two groups with the same address appear when both sides open the direct chat at the
 * same instant. This function does not read the address: the caller already knows from
 * the vault record (`tipoDoCanal.ts`) that the channel is a direct chat and who the peer is.
 * From 1g onward the server decides the inaugural event and this no longer happens, but pairs
 * already split in production stay this way, and a server without the capability still makes them.
 *
 * When a Welcome arrives for a direct chat we already have, this function decides what to do
 * with it. The rule is the same on both sides, and so both end up in the same group: the group
 * created by the SMALLER address of the pair wins.
 *
 * **Why the old rule failed.** It only broke the tie if the peer never opened anything in our
 * group. But the loser adopts the winner's group and speaks right there: publishes the profile
 * and resays everything already said (`#reenviarDepoisDaCorrida`). If the loser's old Welcome
 * reached the winner AFTER that, the winner saw the peer speaking, no longer broke the tie,
 * and adopted the group the loser had abandoned. Both swapped groups and went deaf to each other,
 * forever. This is the account owner's report for 1d.
 *
 * The distinction that remains is between a race and a real repair (the peer lost state and
 * remade the direct chat). In a repair, everything the peer said in our group comes BEFORE
 * the new Welcome. In a race, the peer speaks in our group AFTER the Welcome they sent, because
 * they already abandoned it.
 */

/** What to do with the Welcome. `null`: not a race, adopt it as usual. */
export type DesempateDaDirecta = "manter-o-nosso" | "adoptar-o-do-vencedor" | null

export interface CorridaDaDirecta {
  eu: string
  par: string
  /** Who created the group we have (leaf 0). */
  criadorDoNosso: string | undefined
  /** Who created the Welcome's group (leaf 0). */
  criadorDoWelcome: string | undefined
  /** The peer is already in the tree of our group. */
  parNoNosso: boolean
  /** The highest `seq` of a message from the peer in our group; `-1` if none. */
  ultimaDoPar: number
  /** The `seq` of the Welcome; `-1` if unknown. */
  seqDoWelcome: number
}

export function desempateDaDirecta(corrida: CorridaDaDirecta): DesempateDaDirecta {
  const { eu, par, criadorDoNosso, criadorDoWelcome } = corrida
  if (!par || par === eu) return null
  // Just the race between the two: each group created by a different side.
  const lados = new Set([eu, par])
  if (!criadorDoNosso || !criadorDoWelcome || criadorDoNosso === criadorDoWelcome) return null
  if (!lados.has(criadorDoNosso) || !lados.has(criadorDoWelcome)) return null
  const vencedor = eu < par ? eu : par

  if (criadorDoWelcome === vencedor) return "adoptar-o-do-vencedor"

  // Our group is the winner's and the Welcome is the loser's. Keep ours
  // if the peer has a place in it: otherwise they would be alone in theirs.
  if (!corrida.parNoNosso) return null
  /*
    A real repair: the peer wrote in our group, and everything before this
    Welcome. They lost state and remade the direct chat; adopt it as usual.

    Count only stored messages, not "we opened something of theirs": the
    profile the loser publishes when adopting our group also opens, and that
    is what made the old rule read a race as a repair.
  */
  const reparacao = corrida.seqDoWelcome >= 0 && corrida.ultimaDoPar >= 0 && corrida.ultimaDoPar < corrida.seqDoWelcome
  if (reparacao) return null
  return "manter-o-nosso"
}

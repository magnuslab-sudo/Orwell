/**
 * The type of each channel, read from the vault and not from the address
 * (1.0 "Arca", slice 2).
 *
 * Until 0.9.x the address said what the channel was: `!dm-a.b` a one-on-one
 * conversation, `!feed-x` someone's feed, `!self-x` the account channel, everything
 * else a room. With opaque addresses (`!<40 base32>:<servidor>`, slice 3) the address says
 * nothing, and what the channel is moves to the vault: `fichasDosCanais`, one entry
 * per channel, with the direct pair and the feed owner.
 *
 * EVERY question "what kind of channel is this?" from the core and UI goes
 * through here (`fichaDoCanal`, `tipoDoCanal`). The entry is created when the channel is
 * born here, or deduced from what the device knows (the direct DH, the feed
 * secret), or arrives from the account itself (the pairing snapshot, the `estado.fichas`).
 */

export type TipoDoCanal = "directa" | "mural" | "sala" | "conta"

/**
 * What the vault stores of each channel.
 *
 * `par`: in a direct, the address of the OTHER person (the vault belongs to one account,
 * and all its devices see the same pair). `dono`: in a feed, the address of who publishes
 * it. In other types there is neither one nor the other.
 */
export interface FichaDoCanal {
  tipo: TipoDoCanal
  par?: string
  dono?: string
}

/** What this function reads from the vault. A closed vault is `null`. */
export interface CofreComFichas {
  fichasDosCanais?: Record<string, FichaDoCanal>
}

/**
 * A channel record: the one from the vault. Without it, it is a room.
 *
 * There is no other source (1.0 "Arca", slice 3). The opaque address says
 * nothing, and the old address format gate (`fichaPelaFormaAntiga`, which read
 * `!dm-`, `!feed-`, and `!self-`) and development vault migration
 * (`migrarFichasDosCanais`) are gone: 1.0 does not read a beta vault, and no
 * channel is created with the old format. A room is the type that gives nothing
 * to anyone: no direct records, no feed owner, no account state.
 */
export function fichaDoCanal(cofre: CofreComFichas | null, channel: string): FichaDoCanal {
  return cofre?.fichasDosCanais?.[channel] ?? { tipo: "sala" }
}

/** Just the type. See `fichaDoCanal`. */
export function tipoDoCanal(cofre: CofreComFichas | null, channel: string): TipoDoCanal {
  return fichaDoCanal(cofre, channel).tipo
}

/**
 * Store the record of a channel in the vault. The first record stays: a channel
 * does not change type, and a late derivation by form does not erase the explicit
 * record that created it. Returns whether it wrote anything.
 */
export function registarFicha(cofre: CofreComFichas, channel: string, ficha: FichaQueChega): boolean {
  const fichas = (cofre.fichasDosCanais ??= {})
  if (fichas[channel]) return false
  // Only the three fields, and only the ones that come: a record read from the wire brings
  // explicit `undefined`, and the vault stores the short form.
  fichas[channel] = { tipo: ficha.tipo, ...(ficha.par ? { par: ficha.par } : {}), ...(ficha.dono ? { dono: ficha.dono } : {}) }
  return true
}

/** A record as it arrives from outside (the wire, the snapshot): optional fields may come `undefined`. */
export interface FichaQueChega {
  tipo: TipoDoCanal
  par?: string | undefined
  dono?: string | undefined
}

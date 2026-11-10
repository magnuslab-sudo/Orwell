import { fichaDoCanal, type FichaDoCanal, type TipoDoCanal } from "@enclave/client-core"

/**
 * The type of each channel in the interface, read from the vault (1.0 "Vault", slice 2).
 *
 * The interface does not open the vault: it asks the bridge for the cards
 * (`channels.fichas`) each time the channel list arrives, and stores them here.
 * All the interface questions "is it a direct chat? a feed?" (`isDirect`,
 * `isFeed`, `dmPeerAddress`, `feedOwnerOf` in `format.ts`) go through these
 * functions, not the address form. A channel with no card (an old bridge, or
 * the list not yet arrived) is a room: the old form gate closed in slice 3.
 *
 * A module record, not a React context, because those who ask are pure functions
 * called in dozens of places (lists, notifications, sounds), and the answer is
 * the same for all.
 */
let fichas: Readonly<Record<string, FichaDoCanal>> = {}

/** The cards the bridge gave. Replaces the previous ones: a dropped channel leaves. */
export function lembrarFichasDosCanais(novas: Readonly<Record<string, FichaDoCanal>> | undefined): void {
  fichas = novas ?? {}
}

/** The card of a channel. */
export function fichaNaInterface(channel: string): FichaDoCanal {
  return fichaDoCanal({ fichasDosCanais: fichas as Record<string, FichaDoCanal> }, channel)
}

/** Type only. */
export function tipoNaInterface(channel: string): TipoDoCanal {
  return fichaNaInterface(channel).tipo
}

/** The feed channel of `owner`, by the cards; `null` if no card says so. */
export function canalDoMuralNaInterface(dono: string): string | null {
  for (const [canal, ficha] of Object.entries(fichas)) if (ficha.tipo === "mural" && ficha.dono === dono) return canal
  return null
}

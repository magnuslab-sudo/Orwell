import { strings } from "../../strings.js"

/**
 * The sections of channel properties (3/11/2026, plan
 * `docs/planos/paridade-discord-plano.md` §5.3).
 *
 * Owner request: channel properties are now arranged in tabs or a side column,
 * like Discord settings. On a wide screen it is the column on the left; on
 * mobile it is the row of tabs on top. See `RoomProperties`.
 *
 * The order is as requested. A section with no content yet (Members, Invites,
 * Moderation, Events) shows a line saying what will go there, only to those who
 * can edit the channel: these sections are for admins, and they should see the
 * new structure early. Read-only users do not see empty sections, and with one
 * section the panel has no column, like before.
 *
 * A function, not a constant: labels read the current language. See the header
 * of `settings/seccoes.ts`.
 */
export const IDS_DAS_SECCOES_DO_CANAL = ["geral", "salas", "cargos", "membros", "convites", "moderacao", "eventos"] as const

export type SeccaoDoCanal = (typeof IDS_DAS_SECCOES_DO_CANAL)[number]

/** What decides which sections appear. Everything comes already decided by the core. */
export interface QuemVeAsSeccoes {
  /** Can edit the channel (`mayEdit`). */
  mayEdit: boolean
  /** Can manage roles, and there is something to manage (`mayManageRoles` and the callbacks). */
  gereCargos: boolean
  /** There is a rooms section mounted (today, the AFK room one). */
  temSalas: boolean
  /** Is the channel founder: Moderation has their reports (`SeccaoDenuncias`). */
  ehFundador: boolean
}

/** The sections this person can see, in order as requested. General is always there. */
export function seccoesVisiveis(quem: QuemVeAsSeccoes): readonly SeccaoDoCanal[] {
  return IDS_DAS_SECCOES_DO_CANAL.filter((id) => {
    switch (id) {
      case "geral":
        return true
      case "salas":
        return quem.mayEdit && quem.temSalas
      case "cargos":
        return quem.gereCargos
      case "moderacao":
        return quem.mayEdit || quem.ehFundador
      default:
        return quem.mayEdit
    }
  })
}

/** The label for each tab, in the current language. */
export function etiquetaDaSeccao(id: SeccaoDoCanal): string {
  return strings.roomProperties.seccoes[id]
}

/** A tab the user requested but cannot see falls back to General. */
export function seccaoDoCanalValida(id: string | undefined, visiveis: readonly SeccaoDoCanal[]): SeccaoDoCanal {
  return (visiveis as readonly string[]).includes(id ?? "") ? (id as SeccaoDoCanal) : "geral"
}

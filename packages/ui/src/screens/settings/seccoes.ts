import { strings } from "../../strings.js"

/**
 * The settings sections, and where they live.
 *
 * In its own file because they are needed in two places: the sidebar draws them,
 * the screen shows the chosen one. Declared in one of them, the other would have
 * to import it, and the sidebar importing from the settings screen is a
 * backwards dependency.
 *
 * Six, and were ten (plan in `docs/planos/definicoes-0-9.md`). Each option lives
 * in one place only: language and "Sign out" in Account, voice handling in Microphone
 * and camera, blocked users in Privacy, export and the button that destroys the
 * account at the end of Devices. Help is at the end: it is where people with a
 * problem go, not in the way of someone changing an option.
 *
 * ## Why this is a FUNCTION
 *
 * It was a constant, and the constant was wrong from the day the interface had
 * more than one language: `strings.settings.appearance` read at the top of a
 * module is read ONCE, when the module loads, and stays with the language at that
 * instant. Changing language redraws the whole app and left these six labels in
 * Portuguese, forever, with nothing to explain it.
 *
 * The rule that comes from here applies to this whole package and is backed by a
 * test: nothing stores a piece of `strings` outside a function. See
 * `strings.captura.test.ts`.
 */
export const IDS_DAS_SECCOES = ["conta", "avisos", "media", "privacidade", "aparelhos", "ajuda"] as const

export type Seccao = (typeof IDS_DAS_SECCOES)[number]

export interface EntradaDeSeccao {
  id: Seccao
  label: string
}

/** The sections, with labels in the language now being shown. */
export function seccoes(): readonly EntradaDeSeccao[] {
  return [
    { id: "conta", label: strings.settings.account },
    { id: "avisos", label: strings.settings.notifications },
    { id: "media", label: strings.settings.media },
    // Blocked users, with "Unblock", and what the app stores.
    { id: "privacidade", label: strings.settings.privacidade },
    // The account's devices and, below, this device: export and delete.
    { id: "aparelhos", label: strings.settings.devices },
    { id: "ajuda", label: strings.settings.ajuda },
  ]
}

/**
 * A section requested by id, or Account.
 *
 * Old ids (`appearance`, `voice`, `diagnostics`...) may still arrive from outside:
 * a script, a saved state, an old test. An id that no longer exists showed an
 * empty panel with no explanation. Falls back to Account, which is the first.
 */
export function seccaoValida(id: string | undefined): Seccao {
  return (IDS_DAS_SECCOES as readonly string[]).includes(id ?? "") ? (id as Seccao) : "conta"
}

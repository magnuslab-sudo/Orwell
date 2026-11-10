/**
 * The setup sequence, as data.
 *
 * Account creation is four irreversible-ish acts in a fixed order. Tracking
 * which ones already succeeded is what makes retry safe: a failure at "connection"
 * must never re-run "vault" or "identity", re-creating the vault would
 * destroy the identity that was just minted.
 */

/**
 * The first screen of Setup (phase 8.1, owner decision on 27 October 2026).
 *
 * "Do you already use Orwell on another device?", before any account question.
 * Creating an account was the main path and pairing sat in a button below
 * the name; people would create a second account on the second device, and one
 * extra account does not join the first (the account is the key). The question
 * only exists where there is somewhere to pair to: without that path, it goes
 * straight to creation, as before.
 */
export type EcraInicial = "outro-aparelho" | "criar"

export function ecraInicial({ podeEmparelhar }: { podeEmparelhar: boolean }): EcraInicial {
  return podeEmparelhar ? "outro-aparelho" : "criar"
}

/*
  Four, not five. There was a fifth step, "room", that no longer did anything:
  the common room became announced by the server and handled in
  `Session.ensureCommonRoom`, where someone decides who creates it. The empty
  step stayed in the screen list, named "Channel", saying it created something
  it did not create.
*/
export const SETUP_STEPS = ["cofre", "identidade", "ligacao", "perfil"] as const

export type SetupStep = (typeof SETUP_STEPS)[number]

export type SetupProgress = Readonly<Record<SetupStep, boolean>>

export const EMPTY_SETUP_PROGRESS: SetupProgress = {
  cofre: false,
  identidade: false,
  ligacao: false,
  perfil: false,
}

/** The step a run (or a retry) should start from. `null` means all done. */
export function firstIncomplete(progress: SetupProgress): SetupStep | null {
  return SETUP_STEPS.find((step) => !progress[step]) ?? null
}

export function markDone(progress: SetupProgress, step: SetupStep): SetupProgress {
  return { ...progress, [step]: true }
}

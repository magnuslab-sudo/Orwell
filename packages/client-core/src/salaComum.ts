/**
 * The account's choice about the shared room (the "Orwell" channel).
 *
 * Request from the owner on November 3, 2026: in sign-up, each person decides whether
 * to enter the shared channel. Until now one entered always, alone, at each connection.
 *
 * A preference, not a new vault field, for the reason in `PREFERENCIA_CONTAS_JUNTADAS`:
 * the choice belongs to the ACCOUNT and must reach all its devices. It travels on the
 * account channel and goes in the pairing snapshot, so a paired device is born with the
 * choice the account already made, before the first `connect()`.
 *
 * **Absent means enter.** Accounts that already exist have no mark, and stay as they were:
 * in the room, and returning to it if they lose it. Only those who said no (at sign-up,
 * or when leaving the channel) stay out, and also stay out of recoveries that used to
 * seat those who had been left at the door.
 */
export const PREFERENCIA_SALA_COMUM = "sala-comum"

/** The value for someone who does not want the shared room. Any other value (or none) means enter. */
export const SALA_COMUM_FORA = "fora"
/** The value for someone who chose to enter. Written when entering later, to override an old "out". */
export const SALA_COMUM_ENTRAR = "entrar"

/** Does the account want to be in the shared room? Read from preferences; no mark means yes. */
export function querSalaComum(preferencias: Readonly<Record<string, string>>): boolean {
  return preferencias[PREFERENCIA_SALA_COMUM] !== SALA_COMUM_FORA
}

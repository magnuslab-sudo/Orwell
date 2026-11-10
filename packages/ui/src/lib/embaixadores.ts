/**
 * Orwell ambassadors: those who brought a community and test it with us.
 *
 * The list lives in CODE, and that is what makes it trustworthy without any
 * signature. The owner fills it in by hand, and it travels with the app they
 * publish: to add a name here you have to publish the app. There is no profile
 * field, no channel metadata, no request to the server to change it. It is the
 * same rule as `lib/oficial.ts`: a badge that each person writes for themselves
 * distinguishes no one.
 *
 * What this means in practice: a new ambassador only shows up to those who
 * update the app. It is the price of not inventing new authority, and it is
 * low, because the list changes rarely.
 *
 * Full addresses (`@nome-xxxx:orwell.pt`), not names. The name you see is
 * chosen by each person and repeats; the address does not.
 */
const LISTA: readonly string[] = [
  // Empty for now. The owner adds an address here per ambassador, and the same name goes
  // into the site tribute zone (`apps/site/src/embaixadores.json`).
]

export const EMBAIXADORES: ReadonlySet<string> = new Set(LISTA)

/**
 * Is this address an ambassador's?
 *
 * Exact equality, nothing more, on purpose. A prefix or a similar name would be a
 * pattern to copy: just create an account with the right name to wear the badge.
 *
 * The list comes as an argument only for tests. The app uses the one above.
 */
export function ehEmbaixador(
  address: string | null | undefined,
  lista: ReadonlySet<string> = EMBAIXADORES,
): boolean {
  if (!address) return false
  return lista.has(address)
}

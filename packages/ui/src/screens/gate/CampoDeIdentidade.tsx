/**
 * The field that names the vault's password in the system keychain.
 *
 * **This is what delivers Face ID, and that's why it's here and not copied across
 * three screens.** iOS Keychain and Android Password Manager only offer to fill what
 * they recognize as a login form, and one signal they look for is an identity field.
 * The three gate screens that mention passwords must give the SAME name: if the one
 * that stores (`Setup`, `Pair`) disagrees with the one that asks for filling
 * (`Unlock`), the manager creates a new entry instead of recognizing the existing one
 *, and from the user's view, Face ID doesn't appear, with no explanation.
 *
 * **It is not the account address, and it is not forgotten.** The address lives INSIDE
 * the vault, and the vault is what the password opens: at the moment this field is
 * drawn, no one knows it. Storing it in plain text outside the vault to have it here
 * was paying with what this application exists to protect.
 *
 * The server for this installation serves better and costs nothing. The vault lives in
 * IndexedDB, which is per ORIGIN: there's exactly one vault per origin, so there's
 * exactly one entry to store, and the origin is already public by definition.
 *
 * Out of reach of mouse, keyboard, and screen readers: it's for the manager, and
 * only for it.
 */

/** The name under which the system password manager stores this vault's password. */
export function identidadeParaOGestor(): string {
  // Outside a browser (the desktop app) there's no host, and the product name stays:
  // stable, and tells no one anything.
  return typeof window !== "undefined" && window.location?.host ? window.location.host : "orwell"
}

export function CampoDeIdentidade(): React.JSX.Element {
  return (
    <input
      className="sr-only"
      type="text"
      name="username"
      autoComplete="username"
      value={identidadeParaOGestor()}
      readOnly
      tabIndex={-1}
      aria-hidden="true"
    />
  )
}

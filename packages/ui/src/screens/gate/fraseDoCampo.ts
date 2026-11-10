/**
 * What the FIELD contains, not what React thinks it contains.
 *
 * **This was born from a production bug, and the bug was the child of something
 * good.** In 0.3.1 we turned the three gate screens into forms that iOS Keychain
 * and Android Manager recognize, `<form>`, an identity field, the password marked
 * as current or new. That was the point, and that is what delivers Face ID.
 *
 * But in inviting the manager to write in the field, the app stopped being just
 * the user writing there. And the three screens decided from REACT STATE, which
 * only follows the field while whoever writes fires the events React listens to.
 * A manager who fills without firing them, native Android Autofill on an installed
 * PWA, and some third-party managers, leaves the field full to the eye and the
 * state empty to the app.
 *
 * In `Unlock` this derived the key from the wrong passphrase and answered
 * "wrong password" to someone with the right one, with the right passphrase
 * visible on screen. That was the owner's complaint on September 30, 2026, and
 * it is reproduced in `scripts/prova-preenchimento-do-gestor.mjs`.
 *
 * In `Setup` and `Emparelhar` the same bug is worse in another way: if someone
 * types the passphrase by hand and then lets the manager fill over it, they
 * create a vault with the OLD passphrase, and have no way to open it, ever,
 * with nothing to explain it.
 *
 * The rule this sets is just one: **the field is what the user sees, and it is
 * what decides.** The field `name` attributes exist for the manager; they also
 * serve this.
 */
export function fraseDoCampo(formulario: HTMLFormElement | null, nome: string, estado: string): string {
  if (!formulario) return estado
  const escrito = new FormData(formulario).get(nome)
  // Absent (the field is not in this step) or a file (does not happen here):
  // keep the state, which is what the user typed in a previous step.
  return typeof escrito === "string" ? escrito : estado
}

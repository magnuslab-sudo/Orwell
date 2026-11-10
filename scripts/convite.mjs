/**
 * Invite and ACCEPT, in one place in the UI.
 *
 * Inviting does not seat anyone, it never did, and the UI spells it out in
 * the invite dialog: *"They get it as a private message. They only join if
 * they accept"*. Half the scripts in this repository only know the first half:
 * `carga-chamada.mjs` invites in bulk and assumes no one accepts; `e2e-chamada-epoch.mjs`
 * invited two and then measured a three-person call as if they were there. The
 * result is not a FAIL that points to the cause, it's a dozen assertions
 * measuring the void, each with a message about something else.
 *
 * Accepting takes THREE steps in the UI, and none of them is the button: switch
 * to Contacts, open the conversation where the invite landed, and only then tap
 * "Join". Written by hand in each script, it survives until a screen changes
 * name, and it did: "Friends" became "Contacts" on August 11, 2026 and broke
 * `ver-convite.mjs`, which nobody has run since.
 *
 * And accepting is not the same as joining. The person who invited you approves
 * it when they see the response; if they are offline, approval waits. So
 * `aceitarConvite` does not return "I tapped the button": it waits for the
 * channel in the sidebar of the person who accepted, which is the proof.
 */

/** Where the invite lives in the conversation. Anchor here, not on the button label. */
const CARTAO = ".pedido-card"

/**
 * What the sidebar shows for a channel: the id without the server.
 *
 * `shortName` in `packages/ui/src/lib/format.ts`. A channel created by the app
 * does not publish a name, so the label is the slug, "Lagar do Zé" gives
 * `lagar-do-ze`.
 */
export const etiquetaDe = (nomeDaSala) => nomeDaSala.toLowerCase().replace(/\s+/g, "-")

/**
 * The label as the sidebar can show it: the slug, or the name with spaces.
 * Since 1.0 "Arca", the community publishes the name as written ("som sfu x"),
 * and the slug (`som-sfu-x`) no longer matches the sidebar text.
 */
export const textoDaEtiqueta = (etiqueta) =>
  new RegExp(etiqueta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/-/g, "[-\\s]"), "i")

/**
 * Invite someone to the channel from the right-click menu.
 *
 * Invite has lived in the channel menu since the sidebar was redesigned. The
 * top button ("Invite" in the chat header) also exists and opens the same
 * dialog; use the menu because it ensures the right channel stays active,  * `bridge.channels.invite` invites to the OPEN channel, not the one you clicked,
 * and the menu's `onSelectChannel` makes them match.
 *
 * @param etiqueta the SLUG of the channel, not the name you wrote when you
 * created it. The sidebar shows `sfu-msvdb7cw` for a channel created as "sfu msvdb7cw"
 * (see `etiquetaDe`), and a `getByText` with the written name matches nothing,  * the invite does not go out, and the caller finds it twelve assertions later.
 * @returns whether the invite was sent. **The caller must check.**
 */
export async function convidar(anfitriao, etiqueta, endereco, { espera = 4000 } = {}) {
  if (!endereco) return false

  const linha = anfitriao
    .locator(".channel-list .channel-row")
    .filter({ has: anfitriao.locator(".channel-name", { hasText: textoDaEtiqueta(etiqueta) }) })
    .first()
  if (!(await linha.isVisible().catch(() => false))) return false
  await linha.click({ button: "right" })

  const item = anfitriao.getByRole("menuitem", { name: "Convidar…" }).first()
  if (!(await item.isVisible({ timeout: 3000 }).catch(() => false))) return false
  await item.click()

  // Since 1.0 "Arca", the dialog opens on "By link"; the address field is
  // behind the "By address" button. In an old dialog the button does not exist.
  const porEndereco = anfitriao.locator("form.convidar").getByRole("button", { name: "Por endereço" }).first()
  if (await porEndereco.isVisible({ timeout: 1500 }).catch(() => false)) await porEndereco.click()

  // The placeholder has the ellipsis U+2026, not three dots. Searching for `@`
  // survives someone swapping the character without knowing this exists.
  const campo = anfitriao.locator('form.convidar input[placeholder*="@"]').first()
  if (!(await campo.isVisible({ timeout: 3000 }).catch(() => false))) return false
  await campo.fill(endereco)
  await anfitriao.keyboard.press("Enter")
  await anfitriao.waitForTimeout(espera)
  return true
}

/**
 * Accept the invite on the side of whoever received it, and confirm they joined.
 *
 * @param etiqueta the channel slug, so we know it actually appeared. See
 * `etiquetaDe`. Without this, the return value would only say there was a click.
 * @returns whether the person is really in the channel.
 */
export async function aceitarConvite(convidado, etiqueta, { espera = 30_000 } = {}) {
  await convidado.getByRole("button", { name: "Amigos", exact: true }).first().click()

  // The conversation where the invite landed: identified by the preview, which is
  // the text the invite itself writes in the message body.
  const conversa = convidado
    .locator(".direct-list li.direct-row button.direct-open")
    .filter({ hasText: "Convido-te para" })
    .first()
  if (!(await conversa.isVisible({ timeout: espera }).catch(() => false))) return false
  await conversa.click()

  /*
   * The button says "Entrar", and there are two others in the product with that
   * exact label: joining a call and joining a voice room. A `getByRole("button",
   * {name: /^entrar$/i}).first()` clicks the first one on the page, which on a
   * page with an active call is not this one. Anchor on the card.
   */
  const entrar = convidado.locator(`${CARTAO} .pedido-accoes button.primary`).first()
  if (!(await entrar.isVisible({ timeout: espera }).catch(() => false))) return false
  await entrar.click()

  // Now the proof, not the toast: the channel in the sidebar of the person who
  // accepted. The toast says "You are already in there" from a guess about who
  // is online; this waits for the channel.
  await convidado.getByRole("button", { name: "Comunidades", exact: true }).first().click()
  const naBarra = convidado.locator(".channel-list .channel-name", { hasText: textoDaEtiqueta(etiqueta) }).first()
  return await naBarra
    .waitFor({ timeout: espera })
    .then(() => true)
    .catch(() => false)
}

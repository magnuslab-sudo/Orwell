/**
 * The pairing link the page opened with, delivered by the HOST.
 *
 * The same design as `StartupInvite`, for the same reason: startup data, not a bridge
 * capability. Who reads and clears the address is the host
 * (`apps/web/src/convite-arranque.ts`), before the first draw; this package never sees
 * the address. The installed app does not pass this: a desktop does not join an account
 * by link, it shows the QR.
 *
 * What arrives here is the full LINK, not the secret apart, on purpose: the mobile
 * screen delivers it to the core as is, and the core reads it (`parsePairLink`). A
 * place that only interprets the link is a place that only gets it wrong.
 */
export interface StartupPairing {
  /** The link read from the address, or what stayed saved in this tab. */
  link: string | null
  /** The page opened with a pairing link that cannot be read. */
  invalid: boolean
  /** Deletes what the host saved. Called when pairing resolves, one way or another. */
  forget: () => void
}

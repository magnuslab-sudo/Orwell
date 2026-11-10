/**
 * iPhone and iPad, including the iPad that presents itself as Mac.
 *
 * Only for what is really iOS: the gate's note about Safari's seven days
 * (`gate.memorizarNotaIos`) and the web bridge's `navigator.storage.persist()`.
 */
export function ehIos(
  nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints"> | undefined = globalThis.navigator,
): boolean {
  if (!nav) return false
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1)
}

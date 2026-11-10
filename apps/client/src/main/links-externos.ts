/**
 * Which links the window passes to the system browser.
 *
 * `setWindowOpenHandler` gets every `target="_blank"` from the interface: links
 * from messages (`RichText`) and, since November 2, 2026, a YouTube video
 * thumbnail. The address came from someone else, and `shell.openExternal`
 * opens what it's given: `file:` runs a file on this machine, a custom scheme
 * wakes another app. Only web URLs pass.
 *
 * No `electron` here, for the reason in `link-preview.ts`: so the rule is
 * tested.
 */
export function podeAbrirFora(url: string): boolean {
  return enderecoParaAbrirFora(url) !== null
}

/**
 * The address to pass to `shell.openExternal`, or `null` if it doesn't open.
 *
 * Returns the address as `new URL()` read it (`href`), not the text from the
 * message: this way the system opens exactly what was verified, with spaces,
 * quotes and backslashes already normalized, not a second parse of the same
 * text by another parser.
 *
 * Rejects credentials in the address: in `https://www.youtube.com@mau.pt/` the
 * host is `mau.pt`, and a link from a message has no reason to bring them.
 */
export function enderecoParaAbrirFora(url: string): string | null {
  let lido: URL
  try {
    lido = new URL(url)
  } catch {
    return null
  }
  if (lido.protocol !== "https:" && lido.protocol !== "http:") return null
  if (lido.username || lido.password || !lido.hostname) return null
  return lido.href
}

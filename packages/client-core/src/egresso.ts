/**
 * What the desktop app can ask from the internet: nothing.
 *
 * It lives here and not in `apps/client/src/main` for one reason only: this is
 * the function that decides if a request leaves someone's machine, and such a
 * decision belongs where the suite checks it.
 *
 * The regime is the opposite of usual: nothing leaves, except what is written
 * down. The renderer security policy already refuses almost everything, but this
 * is belt and suspenders: if a directive is loosened by accident, nothing still
 * leaves. STUN and peer connections do not pass through here; WebRTC has its own
 * transport. What the main process asks (link preview, the server) does not
 * either: it goes through Node's `fetch`, outside the renderer session.
 *
 * **There is no gate for YouTube anymore.** Between August 12 and November 2,
 * 2026 the embedded player opened `youtube-nocookie.com`, `ytimg.com` and
 * `googlevideo.com`. The player is gone (owner request on November 2, 2026: a
 * click on the thumbnail opens the video in the system browser), and the gate
 * went with it. The thumbnail arrives inside the message, in bytes, and needs
 * no network.
 */

/**
 * Can this request leave the machine?
 *
 * Only what is not internet: the development tools and, in development, the
 * local Vite server. In the packaged app there is no development origin and only
 * `devtools://devtools/` passes.
 *
 * The decision is by the ORIGIN read by `new URL()` (scheme, host and port),
 * never by text prefix. Until November 2, 2026 it was
 * `url.startsWith("http://localhost:")`, also in production, and
 * `http://localhost:@exemplo.pt/` would pass: there `localhost:` is the user
 * name and the real host is `exemplo.pt`.
 *
 * @param url the address as Electron delivers it.
 * @param origemDeDesenvolvimento the origin of the Vite server
 *   (`ELECTRON_RENDERER_URL`), only when the app is not packaged. Must be
 *   `http:` on a host from this machine; anything else is ignored.
 */
export function podeSair(url: string, origemDeDesenvolvimento?: string): boolean {
  const alvo = lerEndereco(url)
  if (!alvo || alvo.username || alvo.password) return false
  if (alvo.protocol === "devtools:") return alvo.host === "devtools"
  const dev = origemDeDesenvolvimento ? lerEndereco(origemDeDesenvolvimento) : null
  if (!dev || dev.username || dev.password) return false
  if (dev.protocol !== "http:" || !ANFITRIOES_DESTA_MAQUINA.has(dev.hostname)) return false
  return alvo.origin === dev.origin
}

/** The names of the Vite server that are accepted as development origin. */
const ANFITRIOES_DESTA_MAQUINA = new Set(["localhost", "127.0.0.1", "[::1]"])

/**
 * Read a URL, or `null`.
 *
 * Electron delivers canonical addresses, with no spaces or control characters.
 * `new URL()` trims them silently, so a URL that has them is refused first: it
 * is not what Electron would send.
 */
function lerEndereco(texto: string): URL | null {
  if (/[\s\u0000-\u001f\u007f]/.test(texto)) return null
  try {
    return new URL(texto)
  } catch {
    return null
  }
}

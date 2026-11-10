/**
 * What Chromium permissions the desktop app grants, and when.
 *
 * Two families with different rules:
 *
 * - **Media** (microphone, camera, screen): only during a call, revoked when
 *   the call ends. See `hardenSession` in `index.ts`.
 * - **Clipboard write** (`clipboard-sanitized-write`): always. This is what
 *   copy buttons use (`navigator.clipboard.writeText`): the add device link,
 *   invites, the address. Until October 28, 2026 it fell under the blanket
 *   denial and everyone saw "unable to copy" on the desktop app (owner report
 *   when pairing the browser). Writing is a user gesture and reads nothing.
 *   **Reading** the clipboard (`clipboard-read`) stays denied: the app never
 *   needs to see what users copy elsewhere, and paste happens via keyboard.
 * - `fullscreen`: full screen for screen sharing (owner request, November 2,
 *   2026). Only after a user gesture (Chromium doesn't allow a page to go
 *   fullscreen on its own), reads nothing, and Esc always exits. Without this,
 *   the stage button did nothing on the desktop app.
 */
export const PERMISSOES_DE_MEDIA = new Set(["media", "audioCapture", "videoCapture", "display-capture"])
export const PERMISSOES_SEMPRE = new Set(["clipboard-sanitized-write", "fullscreen"])

export function permissaoConcedida(permissao: string, emChamada: boolean): boolean {
  if (PERMISSOES_SEMPRE.has(permissao)) return true
  return emChamada && PERMISSOES_DE_MEDIA.has(permissao)
}

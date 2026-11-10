/**
 * Copy text to the clipboard, on both hosts.
 *
 * On the desktop app it copies through the main process (`clipboard:write`, the
 * Electron `clipboard`), not through Chromium's `navigator.clipboard`. Chromium's
 * depends on a permission and the window's focus, and in the app failed with
 * "could not copy" on all Copy buttons (owner report on October 28, 2026, when
 * copying the "Add device" link). In the browser it stays with `navigator.clipboard`,
 * which is what exists.
 *
 * Always returns a promise: the caller does `.then` and `.catch` without asking
 * what host it is on.
 */
interface HostComAreaDeTransferencia {
  clipboard?: { write?: (texto: string) => Promise<unknown> }
}

export function copiarTexto(texto: string): Promise<void> {
  const host = (globalThis as { enclaveHost?: HostComAreaDeTransferencia }).enclaveHost
  if (typeof host?.clipboard?.write === "function") return host.clipboard.write(texto).then(() => undefined)
  if (typeof navigator === "undefined" || !navigator.clipboard) return Promise.reject(new Error("clipboard unavailable"))
  return navigator.clipboard.writeText(texto)
}

/**
 * The only script on the site: picks the main button based on the visitor's system.
 *
 * Requested by the owner on November 2, 2026. On Windows the button says "Download
 * for Windows", on Mac "Download for macOS", on mobile "Open in
 * browser". The other paths stay as text links below.
 *
 * Only reads `navigator` and writes an attribute on `<html>`. Makes no requests, stores
 * nothing and reads no cookies. Without this script (blocked, or an unrecognized system)
 * the page shows "Open in browser" and all the links, which is what it showed
 * before. The stylesheet does the rest (`:root[data-sistema]` in `estilo.css`).
 *
 * Since November 3, 2026 it also brings `gaveta.ts`, which opens the drawer that a link
 * points to (`#telemovel`). One file and one `<script>` only, also on the downloads page,
 * where the same attribute puts the visitor's system button first.
 *
 * Since November 3, 2026 it also brings `apoio.ts`, the meter for the "Support" section.
 * It is the only request on the site, and goes to this origin (`/_enclave/apoiar.json`).
 * On a page without the meter it requests nothing.
 */
import "./apoio.js"
import "./gaveta.js"

export type Sistema = "windows" | "macos" | "telemovel"

interface Pistas {
  agente: string
  plataforma: string
  movel?: boolean
  toques: number
}

export function reconhecerSistema({ agente, plataforma, movel, toques }: Pistas): Sistema | undefined {
  // iPad in desktop mode calls itself Mac, and only touch events give it away.
  const ipad = /mac/i.test(plataforma) && toques > 1
  if (movel || ipad || /android|iphone|ipad|ipod|mobile/i.test(agente)) return "telemovel"
  if (/win/i.test(plataforma) || /windows/i.test(agente)) return "windows"
  if (/mac/i.test(plataforma) || /macintosh/i.test(agente)) return "macos"
  return undefined
}

if (typeof navigator !== "undefined" && typeof document !== "undefined") {
  const dados = (navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }).userAgentData
  const sistema = reconhecerSistema({
    agente: navigator.userAgent,
    plataforma: dados?.platform || navigator.platform || "",
    movel: dados?.mobile,
    toques: navigator.maxTouchPoints || 0,
  })
  if (sistema) document.documentElement.dataset.sistema = sistema
}

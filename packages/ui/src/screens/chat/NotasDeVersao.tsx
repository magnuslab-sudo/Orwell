import { useLayoutEffect, useRef } from "react"
import { NOVIDADES_HTML } from "../../novidades/novidades.gen.js"
import { strings } from "../../strings.js"

/**
 * What is new in each version, in the place of the room conversation "announcements"
 * in the official channel. Read-only.
 *
 * ## Why the page loads this way
 *
 * The page is static HTML generated at build time (`scripts/gerar-novidades.mjs`,
 * from `docs/novidades.json`) and goes INSIDE the bundle: nothing is fetched from
 * the site or the network, and it works on the desktop app and offline.
 *
 * To show it, there were two doors, and shadow was chosen (Shadow DOM):
 *
 * - An `iframe srcdoc` with `sandbox` opened a new document inside the app.
 *   Security policies from the web and the desktop app have `frame-src 'none'`.
 *   Whether an `srcdoc` passes those rules depends on the engine, and loosening
 *   them for a text page was the worst deal. A separate document also does not
 *   inherit the color the person chose.
 * - Shadow opens no document and navigates nowhere: it is a container with
 *   isolated styles. The `<style>` inside is inline style, which both policies
 *   already allow (`style-src 'unsafe-inline'`); there is no new `script-src`,
 *   because the page has no JavaScript. The page's rules do not leak to the app,
 *   the app's rules do not enter the page, and theme tokens (custom properties)
 *   cross over, so the accent the person chose gets in here.
 *
 * `innerHTML` here is not the door that `RichText.tsx` closes: that text comes
 * from other people, this one comes from a repository file, escaped by the
 * generator and locked down by the `novidades.test.ts` test.
 */
export function NotasDeVersao() {
  const contentor = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const host = contentor.current
    if (!host) return
    // `shadowRoot ??`: React's strict mode runs the effect twice, and a second
    // `attachShadow` on the same element breaks.
    const sombra = host.shadowRoot ?? host.attachShadow({ mode: "open" })
    sombra.innerHTML = NOVIDADES_HTML
  }, [])

  return <section ref={contentor} className="notas-de-versao" aria-label={strings.novidades.titulo} />
}

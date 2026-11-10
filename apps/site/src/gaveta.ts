/**
 * A link to a drawer opens the drawer.
 *
 * Owner request on 3 November 2026: the mobile section became `<details id="telemovel">`,
 * and the link "On mobile, no store" in the hero must go there AND open it. The browser
 * goes there on its own, but does not open a `<details>` that is itself the target:
 * it only opens those with the target INSIDE.
 *
 * Works for any drawer with `id`: also `/#versus`, which other pages link to.
 * Runs at three moments: on load (arriving at `/#telemovel`), on click of a `#…` link
 * (the address may already be that, then there is no `hashchange`) and on `hashchange`
 * (back and forward buttons).
 *
 * Without this script, the link still takes you there, and the person opens the drawer.
 */

/** Opens the drawer with this `id`, if it is a drawer. Returns whether it opened. */
export function abrirGaveta(id: string, raiz: Pick<Document, "getElementById"> = document): boolean {
  const alvo = id ? raiz.getElementById(id) : null
  if (!alvo || alvo.tagName !== "DETAILS") return false
  ;(alvo as HTMLDetailsElement).open = true
  return true
}

/** The `id` of an address fragment (`#telemovel` gives `telemovel`). */
export function idDoFragmento(fragmento: string): string {
  if (!fragmento.startsWith("#")) return ""
  try {
    return decodeURIComponent(fragmento.slice(1))
  } catch {
    return ""
  }
}

if (typeof document !== "undefined" && typeof location !== "undefined") {
  const peloEndereco = (): void => {
    abrirGaveta(idDoFragmento(location.hash))
  }
  peloEndereco()
  addEventListener("hashchange", peloEndereco)
  // Before the browser scrolls: this way it scrolls to the already open drawer.
  document.addEventListener("click", (evento) => {
    const link = (evento.target as Element | null)?.closest?.('a[href^="#"]')
    if (link) abrirGaveta(idDoFragmento(link.getAttribute("href") ?? ""))
  })
}

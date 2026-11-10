import { useEffect, useState } from "react"

/**
 * The screen is wide: above 840px, where the sidebar is a column not a
 * drawer. It matches the media query breakpoint for sheets (`@media (max-width: 840px)`).
 *
 * Used by the shell to choose who shows the call outside its room: the sidebar
 * card (wide) or the compact floating bar (narrow). Both play audio, and only
 * one can play: so the choice is in JavaScript not CSS, which would hide one
 * without unmounting it.
 *
 * Without `matchMedia` (a test environment, an old engine) the answer is
 * "no", which is the default layout: the floating dock.
 */
export const CONSULTA_DO_ECRA_LARGO = "(min-width: 841px)"

function ler(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia(CONSULTA_DO_ECRA_LARGO).matches
  } catch {
    return false
  }
}

export function useEcraLargo(): boolean {
  const [largo, setLargo] = useState(ler)
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const consulta = window.matchMedia(CONSULTA_DO_ECRA_LARGO)
    const mudou = (): void => setLargo(consulta.matches)
    mudou()
    consulta.addEventListener("change", mudou)
    return () => consulta.removeEventListener("change", mudou)
  }, [])
  return largo
}

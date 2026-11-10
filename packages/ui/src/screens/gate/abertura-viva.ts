/**
 * The opening from start to finish: one lap only, and a fade-out.
 *
 * The splash mounts several times in a row: the one from `index.html`, the one from `main.tsx`, the one from `Unlock` opening and the one from `App`. Each mount is a new element, and a new element starts its animations from zero. Until November 3, 2026 the phase was tuned by a negative delay in the stylesheet (`--abertura-fase`), and the reduced motion block, with its `animation: … !important`, reset that delay to zero: on the owner's Windows the ring jumped each time.
 *
 * Now the phase is tuned by Web Animations: on mount, each `abertura-*` animation gets the `startTime` of the first opening on this page. The clock is the same for all, in any motion mode, and each banner's delay (`--linha`) stays in the stylesheet, over it.
 *
 * And the exit is no longer a cut: when the last splash leaves, a copy of it stays on top of the next screen, fading in `SAIDA_MS`. If the app is ready before the opening is seen for `MINIMO_VISIVEL_MS`, the copy stays until then and the next screen waits below, hidden: a two-frame splash reads as a flicker.
 *
 * None of this runs per frame: one tune on mount, two timers on exit.
 */

/** The fade-out of the exit. */
export const SAIDA_MS = 200

/** The fade-out with reduced motion: the same, slower (owner's rule). */
export const SAIDA_REDUZIDA_MS = 360

/** The minimum time the opening stays on screen, counted from the first time it was seen. */
export const MINIMO_VISIVEL_MS = 600

let montados = 0
let origem: number | null = null
let veu: HTMLElement | null = null
let temporizadores: ReturnType<typeof setTimeout>[] = []

/** The clock for animations: the document's, or the page's where the document does not exist. */
function agora(): number {
  const t = typeof document === "undefined" ? null : document.timeline?.currentTime
  return typeof t === "number" ? t : performance.now()
}

/** The opening animations inside an element, pseudo-element animations included. */
function animacoesDe(raiz: Element): Animation[] {
  if (typeof raiz.getAnimations !== "function") return []
  return raiz
    .getAnimations({ subtree: true })
    .filter((a) => typeof CSSAnimation !== "undefined" && a instanceof CSSAnimation && a.animationName.startsWith("abertura-"))
}

/**
 * When the opening on this page started, on the animation clock.
 *
 * The first time it is asked, it looks for it in the document: on the web it is the splash from `index.html`, which has been running since the first draw. It must be asked before React removes it, and that is why `Splash` asks on draw not on mount. No splash in the document (the desktop app, tests), the opening starts now.
 */
export function origemDaAbertura(): number {
  if (origem !== null) return origem
  const existente = typeof document === "undefined" ? null : document.querySelector(".abertura")
  const inicio = existente ? animacoesDe(existente).find((a) => typeof a.startTime === "number")?.startTime : null
  origem = typeof inicio === "number" ? inicio : agora()
  return origem
}

/** Puts the opening animations of an element on the clock of the first one. */
function acertarFase(raiz: Element): void {
  const inicio = origemDaAbertura()
  for (const animacao of animacoesDe(raiz)) animacao.startTime = inicio
}

function movimentoReduzido(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
}

function arrumarSaida(): void {
  for (const t of temporizadores) clearTimeout(t)
  temporizadores = []
  veu?.remove()
  veu = null
  if (typeof document === "undefined") return
  document.documentElement.classList.remove("abertura-a-segurar", "abertura-a-sair")
  document.documentElement.style.removeProperty("--abertura-saida")
}

/**
 * A splash mounted: it enters the common clock, and cancels a mid-exit.
 *
 * Called in a `useLayoutEffect`, before the draw: the first frame of the new element already comes out in the right phase.
 */
export function aberturaMontou(raiz: Element): void {
  montados += 1
  arrumarSaida()
  acertarFase(raiz)
}

/**
 * A splash screen unmounted. If no other splash takes its place in the same commit,
 * the gate closes.
 *
 * "In the same commit" is the microtask: React unmounts the splash from the gate and
 * mounts the one from `App` in the same pass, and only after that the queue runs.
 */
export function aberturaDesmontou(raiz: Element): void {
  montados -= 1
  // Where Web Animations don't exist (the jsdom in tests), there's no animation to
  // keep going, and a copy of the text left in `body` only confused anyone looking for it.
  if (typeof raiz.getAnimations !== "function") return
  const copia = raiz.cloneNode(true) as HTMLElement
  queueMicrotask(() => {
    if (montados === 0) sair(copia)
  })
}

function sair(copia: HTMLElement): void {
  arrumarSaida()
  copia.classList.add("abertura-veu")
  copia.setAttribute("aria-hidden", "true")
  copia.inert = true
  document.body.append(copia)
  acertarFase(copia)
  veu = copia
  /*
    The next screen is hidden right away, not just when waiting: the copy has no
    background (the background is the body's default), and without this the gate's
    card would show through until the first timer runs.
  */
  const html = document.documentElement
  html.classList.add("abertura-a-segurar")
  const espera = Math.max(0, origemDaAbertura() + MINIMO_VISIVEL_MS - agora())
  const esbate = movimentoReduzido() ? SAIDA_REDUZIDA_MS : SAIDA_MS
  temporizadores.push(
    setTimeout(() => {
      html.style.setProperty("--abertura-saida", `${esbate}ms`)
      html.classList.remove("abertura-a-segurar")
      html.classList.add("abertura-a-sair")
      temporizadores.push(setTimeout(arrumarSaida, esbate))
    }, espera),
  )
}

/** Tests only: the module state resets to a fresh page. */
export function esquecerAbertura(): void {
  arrumarSaida()
  montados = 0
  origem = null
}

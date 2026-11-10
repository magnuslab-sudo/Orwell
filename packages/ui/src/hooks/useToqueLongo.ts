import { useCallback, useEffect, useRef } from "react"

/**
 * Right-click with a finger: holding the finger down opens the same menu.
 *
 * Mobile has no right-click button, and the app has nine context menus that
 * only `contextmenu` opened. Without this, renaming a channel, creating a
 * category, moving someone to a voice room, or deleting a message were
 * impossible gestures with one finger, the actions existed, but the door
 * did not.
 *
 * Three rules, each one exists to prevent a specific bug:
 *
 * **Cancel on movement.** The most important one. The vast majority of fingers
 * that land on a list land to drag it, and a menu that opened mid-swipe made
 * the list impossible to scroll. Half a dozen pixels of movement and the timer
 * stops; the user never knew it existed.
 *
 * **Finger only.** `pointer: coarse`, never a mouse pointer. On a desktop the
 * right button stays the right button, and holding the left button down still
 * does nothing, which is what is expected there.
 *
 * **Swallow the click that follows.** A long press ends in `click`, and without
 * this the menu would open and the click below it would open a profile, or a
 * channel, or a room. The menu appeared and vanished, and looked like a bug.
 *
 * Never call `preventDefault` on `pointerdown`: that is what tells the browser
 * the gesture is ours, and it would break the scroll for the entire list.
 *
 * ## Why the hook returns a factory, not props
 *
 * Of the nine places that open a context menu, six are inside a `.map()`
 *, each channel, each room, each person, each post. A hook called there
 * would be a hook inside a loop, which is illegal and breaks the first time
 * the list changes size. The alternative was to extract six new components
 * from code that was not asked to change.
 *
 * So the hook is called ONCE per component and returns a factory, which is
 * called per row. The gesture state (the timer, the starting point) lives in
 * refs of that component and is shared by all its rows, which is correct:
 * there is one finger, and one finger makes one gesture at a time.
 */

/** Where the finger was, in screen coordinates, the way `contextmenu` provides them. */
export interface Ponto {
  x: number
  y: number
}

/** How long the finger must stay down. */
const ATRASO_MS = 500

/**
 * How far it can move without stopping being a tap.
 *
 * A still finger is never perfectly still, and zero tolerance made long press
 * almost never happen. Ten pixels is less than any intentional swipe and more
 * than hand tremor.
 */
const TOLERANCIA_PX = 10

/** What spreads across the row. Empty when there is no menu to open. */
export interface PropsDeToqueLongo {
  onPointerDown?: (event: React.PointerEvent) => void
  onPointerMove?: (event: React.PointerEvent) => void
  onPointerUp?: () => void
  onPointerCancel?: () => void
  onClickCapture?: (event: React.MouseEvent) => void
}

/** Is this device a finger? Asked at tap time, not at startup. */
function aoDedo(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  )
}

/**
 * The factory for a row's props. `undefined` returns empty props: rows with no
 * menu get no behavior, and stay as they were.
 */
export type FabricaDeToqueLongo = (aoAbrir: ((ponto: Ponto) => void) | undefined) => PropsDeToqueLongo

export function useToqueLongo(): FabricaDeToqueLongo {
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null)
  const partida = useRef<Ponto | null>(null)
  /** The menu opened on this gesture, and the `click` that follows is its own. */
  const abriu = useRef(false)

  const parar = useCallback((): void => {
    if (relogio.current !== null) {
      clearTimeout(relogio.current)
      relogio.current = null
    }
    partida.current = null
  }, [])

  // A timer running on an unmounted component would open a menu over a row
  // that is no longer on screen.
  useEffect(() => parar, [parar])

  const onPointerMove = useCallback(
    (event: React.PointerEvent): void => {
      const inicio = partida.current
      if (!inicio) return
      // Distance squared: the square root adds nothing to a comparison.
      const dx = event.clientX - inicio.x
      const dy = event.clientY - inicio.y
      if (dx * dx + dy * dy > TOLERANCIA_PX * TOLERANCIA_PX) parar()
    },
    [parar],
  )

  const onClickCapture = useCallback((event: React.MouseEvent): void => {
    if (!abriu.current) return
    abriu.current = false
    // At capture, before reaching whoever listens below.
    event.preventDefault()
    event.stopPropagation()
  }, [])

  return useCallback(
    (aoAbrir: ((ponto: Ponto) => void) | undefined): PropsDeToqueLongo => {
      if (!aoAbrir) return {}
      return {
        onPointerDown: (event: React.PointerEvent): void => {
          parar()
          abriu.current = false
          if (event.pointerType === "mouse" || !aoDedo()) return
          const ponto = { x: event.clientX, y: event.clientY }
          partida.current = ponto
          relogio.current = setTimeout(() => {
            relogio.current = null
            partida.current = null
            abriu.current = true
            aoAbrir(ponto)
          }, ATRASO_MS)
        },
        onPointerMove,
        onPointerUp: parar,
        onPointerCancel: parar,
        onClickCapture,
      }
    },
    [parar, onPointerMove, onClickCapture],
  )
}

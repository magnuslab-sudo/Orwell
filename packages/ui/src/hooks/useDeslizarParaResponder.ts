import { useCallback, useRef, useState } from "react"

/**
 * Swipe a message left with your finger to reply to it.
 *
 * This is the gesture on Discord and WhatsApp on mobile. Touch only (touch
 * events): the mouse has no such gesture, and on desktop there is the button
 * and the R key.
 *
 * Three rules, each prevents a bug:
 *
 * - **Horizontal only, decided early.** A finger that moves down more than
 *   `VERTICAL_MAX_PX` before moving sideways is reading the conversation, and
 *   the gesture dies there. Without this, scrolling the conversation with a
 *   slightly crooked finger would open replies on its own.
 * - **Only from `LIMIAR_PX` onward.** A short swipe is hesitation. The message
 *   follows the finger, and only replies if pulled all the way.
 * - **The message snaps back** when released, whether it replied or not. The
 *   displacement is state of this row only: the other four hundred don't redraw.
 *
 * With reduced motion the message still follows the finger: the finger moves
 * it, not an animation.
 */

/** How far to pull left before replying. */
export const LIMIAR_PX = 64
/** How far down the finger can move before the gesture becomes scrolling. */
const VERTICAL_MAX_PX = 30
/** How far left the message follows the finger. */
const DESLOCAMENTO_MAX_PX = 80

export interface PropsDoDeslize {
  onTouchStart?: (event: React.TouchEvent) => void
  onTouchMove?: (event: React.TouchEvent) => void
  onTouchEnd?: (event: React.TouchEvent) => void
  onTouchCancel?: () => void
}

export function useDeslizarParaResponder(aoResponder: (() => void) | undefined): {
  props: PropsDoDeslize
  /** Pixels to the left (negative) while the finger pulls. Zero the rest of the time. */
  deslocamento: number
} {
  const partida = useRef<{ x: number; y: number } | null>(null)
  const horizontal = useRef(false)
  const ultimoDx = useRef(0)
  const [deslocamento, setDeslocamento] = useState(0)

  const largar = useCallback((): void => {
    partida.current = null
    horizontal.current = false
    ultimoDx.current = 0
    setDeslocamento(0)
  }, [])

  if (!aoResponder) return { props: {}, deslocamento: 0 }

  return {
    deslocamento,
    props: {
      onTouchStart: (event) => {
        const toque = event.touches[0]
        if (!toque || event.touches.length > 1) return
        partida.current = { x: toque.clientX, y: toque.clientY }
        horizontal.current = false
        ultimoDx.current = 0
      },
      onTouchMove: (event) => {
        const inicio = partida.current
        const toque = event.touches[0]
        if (!inicio || !toque) return
        const dx = toque.clientX - inicio.x
        const dy = toque.clientY - inicio.y
        if (!horizontal.current) {
          if (Math.abs(dy) > VERTICAL_MAX_PX) {
            largar()
            return
          }
          if (dx < -10 && Math.abs(dx) > Math.abs(dy)) horizontal.current = true
          else return
        }
        ultimoDx.current = dx
        setDeslocamento(Math.max(Math.min(dx, 0), -DESLOCAMENTO_MAX_PX))
      },
      onTouchEnd: () => {
        const responde = horizontal.current && ultimoDx.current <= -LIMIAR_PX
        largar()
        if (responde) aoResponder()
      },
      onTouchCancel: largar,
    },
  }
}

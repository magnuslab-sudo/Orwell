import { useLayoutEffect, useRef, useState } from "react"

/**
 * A line that scrolls when it does not fit, like a news ticker.
 *
 * Requested by the owner on October 27, 2026 for the "Channel · Room" line on
 * the side card: the column is 244 px wide, and "MagnusLab · Friday meeting
 * room" does not fit. Cutting with ellipsis hid the room, which is what
 * matters. Now the text slides left, continuously, with a second copy behind
 * so the wrap has no jump. Only what does not fit scrolls, and what fits stays
 * still. The measure is the first copy against the box, not the whole tape:
 * with the tape folded, it is always bigger than the box.
 *
 * Only `transform`, on the compositor, and no JavaScript per frame: JavaScript
 * measures once per text and width change (`ResizeObserver`).
 *
 * Left `CallDock` on October 27, 2026 to also serve the band name on the
 * broadcasting card and the display on the "Share audio" sheet. The mechanics
 * (`.andante-caixa`, `.andante`, `.andante-fita`) are in `pele.css`; color and
 * size are up to the user.
 */
export function Andante({ className, texto }: { className: string; texto: string }): React.JSX.Element {
  const caixa = useRef<HTMLSpanElement>(null)
  const primeira = useRef<HTMLSpanElement>(null)
  const [anda, setAnda] = useState(false)
  useLayoutEffect(() => {
    const fora = caixa.current
    const dentro = primeira.current
    if (!fora || !dentro) return
    const medir = (): void => setAnda(dentro.scrollWidth > fora.clientWidth + 1)
    medir()
    // A test DOM has no `ResizeObserver` and no widths: measures once and stays still.
    const observador = typeof ResizeObserver === "function" ? new ResizeObserver(medir) : null
    observador?.observe(fora)
    return () => observador?.disconnect()
  }, [texto])
  return (
    <span ref={caixa} className={anda ? `${className} andante-caixa andante` : `${className} andante-caixa`} title={texto}>
      <span className="andante-fita">
        <span ref={primeira}>{texto}</span>
        {anda && <span aria-hidden="true">{texto}</span>}
      </span>
    </span>
  )
}

import { useLayoutEffect, useRef } from "react"
import { useTimeout } from "../../hooks/useTimeout.js"
import { strings } from "../../strings.js"
import { MARCA_CHEIA } from "../../marca.gen.js"
import { LINHA_DA_TARJA } from "./abertura-marcacao.js"
import { aberturaDesmontou, aberturaMontou, origemDaAbertura } from "./abertura-viva.js"

/**
 * When the emergency exit appears: the "Reload" link.
 *
 * Opening and connecting takes one to two seconds on a normal device. Until
 * 21 October 2026 the splash said "This is taking a while" and showed a button
 * at eight seconds. The owner said to remove the phrase: the opening screen
 * does not apologize. Only a discreet link remains, and only after thirty
 * seconds, for an opening truly stuck (a promise that never responds).
 *
 * Reversible: changing this number is enough.
 */
export const SAIDA_DE_EMERGENCIA_MS = 30_000

/**
 * The opening screen: the mark, a spinning ring and "Opening...".
 *
 * The animation is pure CSS (`pele.css`, gate section): the banners of the
 * redrawn O light up top to bottom and the ring spins slowly. No JavaScript
 * runs per frame. With `prefers-reduced-motion` everything still moves, slower:
 * the ring spins and the whole mark pulses opacity.
 *
 * The same screen already comes drawn in `apps/web/index.html` (the markup
 * comes from `abertura-marcacao.ts`), and this takes its place at the same
 * point in the loop: the phase and faded exit are in `abertura-viva.ts`.
 */
export function Splash({
  saida = SAIDA_DE_EMERGENCIA_MS,
  onRecarregar = () => location.reload(),
}: {
  saida?: number
  onRecarregar?: () => void
} = {}): React.JSX.Element {
  const passou = useTimeout(saida)
  const raiz = useRef<HTMLDivElement>(null)
  /*
    The opening origin is read ON DRAW, not on mount: on the first draw the
    splash from `index.html` is still in the document, and it is its clock that
    the following ones inherit. When React mounts it has already removed it.
  */
  origemDaAbertura()
  useLayoutEffect(() => {
    const elemento = raiz.current
    if (!elemento) return
    aberturaMontou(elemento)
    return () => aberturaDesmontou(elemento)
  }, [])
  return (
    <div className="gate" ref={raiz}>
      <div className="abertura">
        <div className="abertura-sinal" aria-hidden="true">
          <span className="abertura-anel" />
          <svg className="abertura-marca" viewBox="0 0 24 24" fill="currentColor" focusable="false">
            {MARCA_CHEIA.map((d) => (
              <path key={d} d={d} style={{ "--linha": LINHA_DA_TARJA.get(d) } as React.CSSProperties} />
            ))}
          </svg>
        </div>
        <p className="abertura-texto">{strings.gate.splashBody}</p>
        {passou && (
          <button type="button" className="gate-link abertura-saida" onClick={onRecarregar}>
            {strings.errors.reload}
          </button>
        )}
      </div>
    </div>
  )
}

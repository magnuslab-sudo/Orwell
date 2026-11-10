import type { ReactNode } from "react"

/**
 * A toggle switch with the label beside it.
 *
 * It is a button with `role="switch"`, not a checkbox. The native checkbox measures 13 px,
 * draws differently on each system, and the checkmark never aligns with the label text;
 * the owner asked for a switch (October 20, 2026). The accessible name is the label text,
 * which is what you see: voice commands say what they read.
 *
 * The click target is the whole line and measures at least 24 px tall (WCAG 2.2, 2.5.8).
 */
export function Interruptor({
  ligado,
  onMudar,
  rotulo,
  disabled = false,
}: {
  ligado: boolean
  onMudar: (ligado: boolean) => void
  rotulo: ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      className="interruptor"
      disabled={disabled}
      onClick={() => onMudar(!ligado)}
    >
      <span className="interruptor-pista" aria-hidden="true">
        <span className="interruptor-botao" />
      </span>
      <span className="interruptor-rotulo">{rotulo}</span>
    </button>
  )
}

import { MoreIcon } from "../icons.js"

/**
 * The "⋯" on a line: opens the same menu as right-click does.
 *
 * It exists because right-click and long-press are not visible. Anyone who does not
 * know they exist would never reach the menu for a message, person or chat, and
 * each line had different buttons for the same person. A line becomes
 * the name and this button, the same everywhere.
 *
 * The menu opens below the button, aligned to its left. The `ContextMenu`
 * pulls back on its own when it does not fit on the screen.
 */
export function BotaoMais({
  label,
  onAbrir,
  className,
}: {
  /** What the screen reader says. Must name whose menu it is. */
  label: string
  onAbrir: (at: { x: number; y: number }) => void
  className?: string | undefined
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={className ? `botao-mais ${className}` : "botao-mais"}
      aria-label={label}
      title={label}
      aria-haspopup="menu"
      onClick={(event) => {
        // Stops the click reaching the line: the line opens something else (the
        // chat, the profile), and the "⋯" only opens the menu.
        event.stopPropagation()
        const caixa = event.currentTarget.getBoundingClientRect()
        onAbrir({ x: caixa.left, y: caixa.bottom + 4 })
      }}
    >
      <MoreIcon size={16} />
    </button>
  )
}

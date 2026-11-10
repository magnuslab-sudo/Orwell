import { OrwellMark } from "../icons.js"

/**
 * The wordmark: the redacted O, then "rwell" in the app's own type.
 *
 * Real text rather than paths, on purpose — it inherits the theme's font and
 * colour, costs nothing to hint at small sizes, and screen readers get the
 * one accessible name ("Orwell") instead of an O-less fragment.
 */
export function OrwellWordmark({ size = 28 }: { size?: number }): React.JSX.Element {
  return (
    <span className="orwell-wordmark" role="img" aria-label="Orwell" style={{ fontSize: size }}>
      <OrwellMark size={Math.round(size * 1.04)} />
      <span aria-hidden="true">rwell</span>
    </span>
  )
}

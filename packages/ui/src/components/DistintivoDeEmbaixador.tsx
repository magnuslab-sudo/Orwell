import { ehEmbaixador } from "../lib/embaixadores.js"
import { strings } from "../strings.js"

/**
 * The ambassador badge: a small star next to the name.
 *
 * It takes the ADDRESS and decides on its own whether to show. Whoever uses it
 * (member panel, person page, message row) does not need to know the rule, and
 * the rule lives in one place only: `lib/embaixadores.ts`.
 *
 * Star not seal: the seal is for the common channel (`SeloOficial.tsx`), and
 * two similar symbols for two different things confuse. The color is indigo
 * not `--accent`, for the same reason.
 *
 * The accessible name and `title` live in the `<span>`; the `<svg>` is
 * `aria-hidden`, so screen reader users hear the phrase once, not twice.
 */
const ESTRELA = "M12 2.6l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8Z"

export function DistintivoDeEmbaixador({ address }: { address: string | null | undefined }): React.JSX.Element | null {
  if (!ehEmbaixador(address)) return null
  return (
    <span className="distintivo-embaixador" role="img" aria-label={strings.embaixador.selo} title={strings.embaixador.selo}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={ESTRELA} fill="currentColor" />
      </svg>
    </span>
  )
}

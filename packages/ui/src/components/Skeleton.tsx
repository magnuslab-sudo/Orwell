/**
 * A quiet placeholder block for content that is still loading.
 *
 * Deliberately shimmer-less: a slow opacity pulse on `--bg-raised`, and none at
 * all under `prefers-reduced-motion`. Purely decorative, so it is hidden from
 * assistive tech — the surrounding component says "loading" in words.
 */
export function Skeleton({ className }: { className?: string }): React.JSX.Element {
  return <span className={className ? `skeleton ${className}` : "skeleton"} aria-hidden="true" />
}

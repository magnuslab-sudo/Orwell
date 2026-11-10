/** How close to the bottom still counts as "reading the latest". */
export const NEAR_BOTTOM_PX = 80

/**
 * Whether a scroll container is close enough to its bottom that new content
 * should pull the view down. Pure so the threshold logic is testable without a
 * DOM: pass any object with the three scroll metrics.
 */
export function isNearBottom(
  el: { scrollTop: number; clientHeight: number; scrollHeight: number },
  threshold: number = NEAR_BOTTOM_PX,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
}

/** Smooth scrolling is a courtesy, not a requirement — and never an imposition. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    // No matchMedia (test DOMs, ancient hosts): the safe answer is "reduce".
    return true
  }
}

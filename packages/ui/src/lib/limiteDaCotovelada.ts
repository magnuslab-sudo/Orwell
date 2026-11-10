/**
 * The cap on buzzing: one per minute, per conversation.
 *
 * Request from the coordinator when turning on buzzing (October 28, 2026). The
 * protocol already has an interval (`BUZZ_INTERVAL_MS`, five seconds), and that
 * protects the server and receiver from a burst. Five seconds do not protect
 * someone's afternoon: twelve buzzes per minute is still a cheap way to bug
 * someone. One minute is the interval of someone who really wants attention,
 * not someone poking for fun.
 *
 * Lives on the sender's side, in the interface, and so is tighter than the
 * protocol's, never looser: an old client still respects the five seconds, and
 * the receiver still refuses anything faster.
 *
 * **Per conversation, with memory.** Switching conversations does not carry
 * over the wait from the previous one (someone else is on the other end), but
 * going back to a conversation finds its wait where it left off. Before,
 * leaving and coming back reset the clock, and the interval could be worked
 * around with two clicks.
 */
export const COTOVELADA_INTERVALO_MS = 60_000

/**
 * The seconds left until the next buzz in this conversation. Zero is free.
 * Rounded up: "1 s" until the last moment, never "0 s" with the button still
 * closed.
 */
export function segundosQueFaltam(ultimoEnvio: number | undefined, agora: number): number {
  if (ultimoEnvio === undefined) return 0
  const falta = COTOVELADA_INTERVALO_MS - (agora - ultimoEnvio)
  return falta > 0 ? Math.ceil(falta / 1000) : 0
}

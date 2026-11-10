import { useEffect, useRef, useState } from "react"

/**
 * The bell that moves when a notification arrives.
 *
 * The sound already existed and already played; what was missing was the other sense.
 * Someone looking at the side of the screen where the chat happens does not notice a
 * number changing in a corner, and someone with sound off would not notice anything at all.
 *
 * **In one place only, and it is the bell.** The rail and the notification center could
 * also shake, and that is precisely why they do not: three things moving for the same
 * notification is a party, not a warning. The bell is the only one always in sight, the
 * center is closed almost always, and the rail talks about unread channels, which is a
 * different count and a different matter. And it is where the number appears: movement
 * and information in the same place saves the person from searching.
 *
 * **The trigger is the number going up, not the event.** This works for all types,
 * including ones that land in the list without going through `pushNotification` (private
 * messages are one), and cannot diverge from what the badge shows: it is literally the
 * same count. Reading, marking as read, or deleting make the number go down, and down
 * is never an event.
 *
 * **First read is the starting line, not news.** The record comes from the vault on
 * unlock, and without this opening the app with twelve unread would ring the bell as
 * if the twelve had just arrived.
 */

/**
 * How long the warning stays on screen.
 *
 * Measured against what already exists in the product: the elbow nudge moves for 820 ms
 * and is the longest motion in the app, the button echo lasts 620 ms. A notification is
 * worth less than a nudge, and this happens dozens of times per session, where the nudge
 * happens once or twice.
 */
export const SINO_AVISO_MS = 520

/**
 * Two notifications in a row are one event, not two.
 *
 * Same lesson as `THROTTLE_MS` and `ROSTER_SETTLE_MS`: a resync after going offline
 * brings all the mail at once, and without this the bell rang once per entry, twenty
 * trembles of half a second stacked, which is a flickering fault, not a warning. One and
 * a half seconds groups the torrent without hiding two genuinely separate notifications.
 */
export const SINO_JUNTA_MS = 1500

/**
 * @param porLer the bell badge, as drawn.
 * @param silenciado do not request attention now. See the call in `App`: it is "Busy"
 * or the notification center open, in both cases the information arrives the same way
 * (the number goes up), what does not happen is the warning.
 */
export function useSinoAvisa(porLer: number, silenciado: boolean): boolean {
  const [avisa, setAvisa] = useState(false)
  /** What we have already seen. `null` is we have not seen anything yet. */
  const anterior = useRef<number | null>(null)
  const ultimoAviso = useRef(0)

  useEffect(() => {
    const antes = anterior.current
    anterior.current = porLer
    // The starting line: what was there when we arrived has not arrived now.
    if (antes === null) return
    if (porLer <= antes) return
    // Silent is not deferred: nothing gets stored for the moment when the person
    // leaves "Busy" or closes the hub. It follows the same rule as the audio engine.
    if (silenciado) return
    const agora = Date.now()
    if (agora - ultimoAviso.current < SINO_JUNTA_MS) return
    ultimoAviso.current = agora
    setAvisa(true)
  }, [porLer, silenciado])

  // Remove itself. The class must leave the element for the animation to run
  // again: a CSS animation does not restart while the class is there, and without
  // this the bell would ring once and stay silent for the rest of the session.
  useEffect(() => {
    if (!avisa) return
    const fim = setTimeout(() => setAvisa(false), SINO_AVISO_MS)
    return () => clearTimeout(fim)
  }, [avisa])

  return avisa
}

import { useCallback, useEffect, useRef, useState } from "react"
import { BUZZ_MAX_AGE_MS } from "@enclave/protocol"
import type { EnclaveBridge } from "../bridge.js"
import { isDirect } from "../lib/format.js"
import { COTOVELADA_INTERVALO_MS, segundosQueFaltam } from "../lib/limiteDaCotovelada.js"
import { playSound } from "../lib/sounds.js"

/**
 * The nudge, the MSN Messenger nudge.
 *
 * Shakes the other person's window and plays a sound. It is not a
 * notification: it is a tap on the shoulder of someone distracted, and it
 * matters precisely because it is physical. It was one of the few things from
 * MSN that nobody copied and everyone remembers.
 *
 * **Direct conversations only.** A nudge to thirty people is not a nudge, it
 * is an alarm, and in a group channel it would be the cheapest tool the app
 * has to ruin everyone's afternoon. The guard is in here, not just in the
 * button design: a rule that lives in appearance is a rule the first refactor
 * throws away.
 *
 * **Never recorded.** Same trap as the typing signal, and worse: a buzz in
 * history gets replayed on backfill, and whoever opened the conversation
 * tomorrow would get all today's nudges at once, each one shaking the screen.
 * The cut is at the session, before the vault.
 *
 * **Never steals focus.** This sets a CSS class and plays a sound, and nothing
 * else: no `window.focus()`, no `element.focus()`, nothing to bring the app to
 * the front. Someone typing in another window keeps typing in another window,  * and that is what separates a nudge from a hijack.
 *
 * **Movement is optional; the message is not.** With `prefers-reduced-motion`
 * on the buzz still arrives, and CSS swaps the shake for a highlight. Shaking
 * a screen is literally what that preference exists to stop, and some people
 * get real motion sickness from it.
 *
 * **Silences with the rest.** The sound goes through the common engine, which
 * already respects the mute button, volume, and "Busy". Someone working can
 * mute the noise without losing the message, the highlight and its message
 * still arrive. A buzz that ignored "Busy" would be the only voice in the app
 * with the right to break an explicit choice by the user, and there is nothing
 * in it to justify that privilege.
 */

/** How long the shake shows on screen. A jolt, not an earthquake. */
const SHAKE_MS = 820

export interface Buzz {
  /** Send the nudge. No effect while the cooldown is running. */
  buzz: () => void
  /** Seconds left before we can try again. Zero means free. */
  cooldown: number
  /** A nudge just came in: this is the class that shakes the screen. */
  shaking: boolean
  /** Whether this conversation allows nudges at all. False on group channels. */
  available: boolean
}

/**
 * Both ends of the buzz, in a portable hook.
 *
 * Takes the bridge and channel, and nothing else, on purpose. Direct
 * conversations will move to the Friends page, and what carries over from here
 * to there is this file and the button, with no glue left behind.
 */
export function useBuzz(bridge: EnclaveBridge, channel: string | null): Buzz {
  const [cooldown, setCooldown] = useState(0)
  const [shaking, setShaking] = useState(false)
  /**
   * The last nudge given in each conversation. Per conversation, not just one:
   * coming back to a conversation finds its wait where it was left. See
   * `lib/limiteDaCotovelada.ts`.
   */
  const ultimosEnvios = useRef(new Map<string, number>())
  const available = channel !== null && isDirect(channel)

  /** The open channel, read at the time of the event and not closed on subscribe. */
  const canalRef = useRef(channel)
  canalRef.current = channel

  useEffect(() => {
    return bridge.on.buzz((event) => {
      // A nudge from another conversation does not shake this one. It still arrives
      // as an unread message, the usual way; what it does not do is shake the screen
      // of someone reading something else.
      if (event.channel !== canalRef.current) return
      // An old tap is not felt. Defense against a replay that slipped past the
      // session cut, cheap, and the cost of not having it was the screen shaking
      // by itself when opening the app.
      if (Math.abs(Date.now() - event.at) > BUZZ_MAX_AGE_MS) return
      // The engine decides whether to play it: respects the mute button, the volume, and "Busy".
      playSound("buzz")
      setShaking(true)
    })
    // Subscribed once, like all the app's other subscriptions.
  }, [])

  // Clear the shake on its own. Restarted on each new nudge, so two in a row
  // give two jolts, not one cut short.
  useEffect(() => {
    if (!shaking) return
    const fim = setTimeout(() => setShaking(false), SHAKE_MS)
    return () => clearTimeout(fim)
  }, [shaking])

  /**
   * The visible countdown. In MSN the button locked and you could see it was
   * locked; a button that does not work and does not explain looks broken.
   *
   * The timer is tied to "waiting is ongoing" and never to the number of
   * seconds. Tied to the number, the countdown froze: two steps in a row often
   * compute the SAME second, writing the same value to state does not rerun the
   * effect, and the clock died there, at "5s", forever, with the button closed
   * until you switched conversations.
   */
  const aEsperar = cooldown > 0
  useEffect(() => {
    if (!aEsperar) return
    const relogio = setInterval(() => {
      const canal = canalRef.current
      setCooldown(canal === null ? 0 : segundosQueFaltam(ultimosEnvios.current.get(canal), Date.now()))
    }, 250)
    return () => clearInterval(relogio)
  }, [aEsperar])

  // Switching conversations does not inherit the wait from the previous one: the
  // cooldown protects the person on the other end, and on the other end is now
  // someone else. But the new conversation might have its own, from a nudge sent
  // less than a minute ago.
  useEffect(() => {
    setCooldown(channel === null ? 0 : segundosQueFaltam(ultimosEnvios.current.get(channel), Date.now()))
    setShaking(false)
  }, [channel])

  const buzz = useCallback(() => {
    if (!channel || !isDirect(channel)) return
    const agora = Date.now()
    if (segundosQueFaltam(ultimosEnvios.current.get(channel), agora) > 0) return
    ultimosEnvios.current.set(channel, agora)
    setCooldown(Math.ceil(COTOVELADA_INTERVALO_MS / 1000))
    // The shake is the echo of what you just did, on both sides, like in MSN. Not
    // sound: there is never sound for your own action (see `sons/motor.ts`). The
    // shake comes so whoever pressed it knows it worked.
    setShaking(true)
    // A lost nudge is not an error to put on anyone's screen.
    void bridge.channels.buzz(channel).catch(() => undefined)
  }, [bridge, channel])

  return { buzz, cooldown, shaking, available }
}

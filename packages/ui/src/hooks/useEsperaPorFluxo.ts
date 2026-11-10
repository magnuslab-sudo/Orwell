import { useEffect, useRef, useState } from "react"
import type { Participant } from "@enclave/client-core"
import { PACIENCIA_MS } from "../lib/estadoDaChamada.js"

/**
 * How long each person in this call has been without audio arriving.
 *
 * Exists to answer the one question "connecting…" never answered: **is this
 * still on the way, or is it broken?** A status with no timeout doesn't tell
 * the two apart, and that's what the screen had, same text after one second
 * and after ten minutes.
 *
 * **Per person, never the age of the call.** They are different things and the
 * second is easy to code: just read the `useElapsed` that's already there. It
 * would be wrong both ways. Someone joining at minute ten would inherit ten
 * minutes of waiting and look broken before they had a chance; someone who was
 * connected and drops at minute ten would never restart counting.
 *
 * **The clock only runs while someone is waiting.** A permanent `setInterval`
 * in a four-person call where everyone hears each other is one redraw per
 * second to always say the same thing. With no one waiting, there's no interval
 * at all.
 *
 * The timestamp lives in a `ref` not state: writing it in `useState` during
 * render would be a cycle, writing it in an effect would delay everyone's count
 * by a frame. What needs to trigger a render is the PASSING of the timeout, and
 * that's the `agora` below.
 */
export function useEsperaPorFluxo(participants: Participant[]): (address: string) => number {
  /** Address → when this person stopped getting audio. Cleared when they get it back. */
  const desde = useRef(new Map<string, number>())
  const [agora, setAgora] = useState(() => Date.now())

  const relogio = Date.now()
  const aEsperar = new Set<string>()
  for (const pessoa of participants) {
    if (pessoa.connected) {
      // Got audio: the wait is over, and the next one starts from zero. Without this
      // line, someone who connects, drops and returns would keep the count from last
      // time and look broken the instant they returned.
      desde.current.delete(pessoa.address)
      continue
    }
    aEsperar.add(pessoa.address)
    if (!desde.current.has(pessoa.address)) desde.current.set(pessoa.address, relogio)
  }
  // Someone who left the call doesn't leave a timestamp behind: coming back in is
  // a new wait, and a map that only grows is a leak in a call with churn.
  for (const address of desde.current.keys()) {
    if (!aEsperar.has(address)) desde.current.delete(address)
  }

  useEffect(() => {
    if (aEsperar.size === 0) return
    /*
      One second, not the full timeout.
      
      A single `setTimeout(PACIENCIA_MS)` would work for the text to change, and
      it's fragile for the usual reason: a laptop that sleeps doesn't run the
      timer and wakes up with the clock ahead. Every second, the count is made
      from the machine clock and the timeout passing is seen either way.
      */
    const timer = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [aEsperar.size === 0])

  return (address: string): number => {
    const inicio = desde.current.get(address)
    if (inicio === undefined) return 0
    // `Math.max(agora, relogio)`: `agora` is from the last tick and `relogio` is
    // from this render. A render triggered by something else (someone muting the
    // mic) brings the right count without waiting for the next tick.
    return Math.max(0, Math.max(agora, relogio) - inicio)
  }
}

/** The timeout, reexported so whoever draws doesn't need to know two modules. */
export { PACIENCIA_MS }

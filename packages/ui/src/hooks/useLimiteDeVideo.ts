import { useEffect, useRef, useState } from "react"
import type { LimiteDeVideo } from "@enclave/client-core"
import type { EnclaveBridge } from "../bridge.js"

type MotorDeChamada = EnclaveBridge["call"]

/**
 * How many seconds between reads. See the effect comment below.
 */
const INTERVALO_MS = 4_000

/**
 * The image coming out of here is being cut off, and why.
 *
 * **Unlike `useLatencia`, this measures without anyone looking**, and that's
 * why both exist. Latency is a number to check: someone wants to know so they
 * hover the status dot, and measuring outside that was pointless work. A
 * dropping resolution is the opposite, it's precisely what no one will look
 * for, because no one suspects it. Someone on a bad network appears to others
 * at 360p and concludes the product is bad. If this only measured while the
 * mouse was over it, it would never tell anyone who needs to hear.
 *
 * **Every four seconds, and chained not `setInterval`.** Chained for the same
 * reason `useLatencia` writes: measurement is async, and a fixed interval
 * stacks requests on a slow network, which is exactly the network where this
 * will run. Four seconds because what we measure is slow: the browser's
 * congestion control takes seconds to decide to drop, and a tighter poll would
 * pay `getStats()` on each peer to see the same state again.
 *
 * **Only while the call is live.** Outside a call there's no sender, and the
 * question has no one to ask.
 */
export function useLimiteDeVideo(call: MotorDeChamada, aEnviarImagem: boolean): LimiteDeVideo | null {
  const [limite, setLimite] = useState<LimiteDeVideo | null>(null)

  // The engine by reference not by dependency, like the bridge in `useLatencia`:
  // a host that recreates it each render would remount the timer each time, and
  // the generous interval would turn into one measurement per render.
  const motor = useRef(call)
  motor.current = call

  useEffect(() => {
    if (!aEnviarImagem) {
      // Clean up on exit, and don't leave the last warning hanging: a camera that
      // turns off doesn't leave behind a warning about image that's no longer being sent.
      setLimite(null)
      return
    }

    let vivo = true
    let temporizador: ReturnType<typeof setTimeout> | undefined

    const medir = async (): Promise<void> => {
      const lido = motor.current.active ? await motor.current.medirLimiteDeVideo().catch(() => null) : null
      if (!vivo) return
      setLimite(lido)
      if (vivo) temporizador = setTimeout(() => void medir(), INTERVALO_MS)
    }

    void medir()
    return () => {
      vivo = false
      if (temporizador) clearTimeout(temporizador)
    }
  }, [aEnviarImagem])

  return limite
}

import { useCallback, useEffect, useRef, useState } from "react"
import type { EnclaveBridge } from "../bridge.js"

/**
 * The round-trip time, measured only while someone is looking at it.
 *
 * Measuring all the time would cost without helping: outside a call it's one
 * extra frame on the socket every second, inside a call it's `getStats()` on
 * each pair, in a room with eight people that's real work, repeated to feed a
 * number nobody asked for. Here we measure only from when the mouse lands on
 * the status dot, and stop when it leaves.
 *
 * The first measurement comes right away, then every two seconds. The system
 * tooltip takes about a second to appear, so in practice the number is there
 * when someone reads it, and keeps refreshing while the mouse stays.
 *
 * `null` is an answer and renders as absence: offline, no response in time, or
 * a browser that doesn't give the stat. Never a zero.
 */
export function useLatencia(bridge: EnclaveBridge): {
  /** The last measurement in ms, and where it came from. `null` until there's one. */
  latencia: { ms: number; ate: "servidor" | "par" } | null
  /** The mouse entered the status dot. */
  comecar: () => void
  /** E saiu. */
  parar: () => void
} {
  const [latencia, setLatencia] = useState<{ ms: number; ate: "servidor" | "par" } | null>(null)
  const [aMedir, setAMedir] = useState(false)

  /**
   * The bridge by reference not by dependency, like in `useSpaceMeta`.
   *
   * A host that recreates it each render would unmount and remount the timer
   * each time, and the generous interval it exists for would turn into one
   * measurement per render.
   */
  const ponte = useRef(bridge)
  ponte.current = bridge

  const comecar = useCallback(() => setAMedir(true), [])
  const parar = useCallback(() => setAMedir(false), [])

  useEffect(() => {
    if (!aMedir) return
    let vivo = true
    let temporizador: ReturnType<typeof setTimeout> | undefined

    const medir = async (): Promise<void> => {
      /**
       * Inside a call measure to the peer, outside it measure to the server.
       *
       * This way and not the other: someone in a call wants to know the distance
       * to who they hear, and the server at that point only served to introduce
       * them. If the call doesn't have a measurement yet, the connection
       * settling, or a browser without the stat, fall back to the server,
       * which is true and says something else, labeled as such.
       */
      const activa = ponte.current.call.active
      const doPar = activa ? await ponte.current.call.measureLatency().catch(() => null) : null
      if (!vivo) return
      if (doPar !== null) {
        setLatencia({ ms: doPar, ate: "par" })
      } else {
        /*
          In an SFU call there's no peer: there's one connection, to the server,
          and media crosses it. Measure THAT before falling back to socket ping,
          because they are different, the socket is TCP and media is the ICE
          path, and on a network that pushes media to TURN the two numbers split.
          The label is "server" both times, and it's true both times; what
          changes is which of the two paths to the server we measured.
        */
        const doSfu = activa ? await ponte.current.call.medirLatenciaAoSfu().catch(() => null) : null
        if (!vivo) return
        if (doSfu !== null) {
          setLatencia({ ms: doSfu, ate: "servidor" })
        } else {
          const doServidor = (await ponte.current.session.latency?.().catch(() => null)) ?? null
          if (!vivo) return
          setLatencia(doServidor === null ? null : { ms: doServidor, ate: "servidor" })
        }
      }
      // Chained not `setInterval`: the measurement is async, and a fixed interval
      // stacks requests on a slow network, which is exactly the network where
      // someone is looking at this.
      if (vivo) temporizador = setTimeout(() => void medir(), 2_000)
    }

    void medir()
    return () => {
      vivo = false
      if (temporizador) clearTimeout(temporizador)
    }
  }, [aMedir])

  return { latencia, comecar, parar }
}

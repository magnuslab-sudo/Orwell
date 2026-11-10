import { useEffect, useRef } from "react"

/**
 * Actions that count as activity: key, mouse and touch.
 *
 * `pointermove` is here on purpose. Someone reading a long conversation without
 * typing moves the mouse and wheel, and closing the vault mid-read would punish them
 * for being there.
 */
export const GESTOS_DE_USO = ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"] as const

/**
 * "Lock on its own": closes the vault after `minutes` without use.
 *
 * **One timer only, not one per gesture.** A `pointermove` fires dozens of
 * times per second; restarting a `setTimeout` on each one was work for nothing.
 * The gesture just writes the time (`ultimo`), and the timer, when it wakes,
 * measures what passed: if it hasn't hit the limit, it sleeps the rest.
 *
 * **Never during a call.** On a voice call alone no one touches the keyboard
 * for an hour, and closing the vault would boot them from the conversation. End
 * of call counts as use: time starts counting from there.
 *
 * **After the laptop sleeps.** The `setTimeout` doesn't run while the machine
 * sleeps and wakes late. Because it measures by time, not by ticks, it wakes
 * and locks right away. And the tab that becomes visible again checks at once,
 * so the vault doesn't stay open until the next tick.
 *
 * `aoBloquear` is the same path as "Sign out" (see `App.tsx`).
 */
export function useBloqueioAutomatico({
  minutos,
  activo,
  emChamada,
  aoBloquear,
}: {
  /** 0 means "Never". */
  minutos: number
  /** Only when the vault is open: at the gate there is nothing to close. */
  activo: boolean
  emChamada: boolean
  aoBloquear: () => void
}): void {
  const aoBloquearRef = useRef(aoBloquear)
  aoBloquearRef.current = aoBloquear
  const emChamadaRef = useRef(emChamada)
  emChamadaRef.current = emChamada
  const ultimo = useRef(Date.now())

  // Joining and leaving a call are both use. Without this, someone hanging up
  // after an hour of voice chat would see the vault lock the instant after.
  useEffect(() => {
    ultimo.current = Date.now()
  }, [emChamada])

  useEffect(() => {
    if (!activo || minutos <= 0 || typeof window === "undefined") return
    const limite = minutos * 60_000
    ultimo.current = Date.now()
    let temporizador: ReturnType<typeof setTimeout> | null = null
    let fechado = false

    const marcar = (): void => {
      ultimo.current = Date.now()
    }
    const agendar = (ms: number): void => {
      if (temporizador) clearTimeout(temporizador)
      temporizador = setTimeout(verificar, Math.max(1000, ms))
    }
    function verificar(): void {
      if (fechado) return
      if (emChamadaRef.current) {
        marcar()
        agendar(limite)
        return
      }
      const passou = Date.now() - ultimo.current
      if (passou >= limite) {
        fechado = true
        aoBloquearRef.current()
        return
      }
      agendar(limite - passou)
    }
    const aoVoltar = (): void => {
      if (document.visibilityState === "visible") verificar()
    }

    agendar(limite)
    for (const gesto of GESTOS_DE_USO) window.addEventListener(gesto, marcar, { capture: true, passive: true })
    document.addEventListener("visibilitychange", aoVoltar)
    return () => {
      fechado = true
      if (temporizador) clearTimeout(temporizador)
      for (const gesto of GESTOS_DE_USO) window.removeEventListener(gesto, marcar, { capture: true })
      document.removeEventListener("visibilitychange", aoVoltar)
    }
  }, [activo, minutos])
}

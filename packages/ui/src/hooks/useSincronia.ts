import { useEffect, useState } from "react"
import { useBridge } from "../App.js"
import type { SincroniaDoCanal } from "../bridge.js"

/**
 * A channel sync, for the chat and the wall (S5): the state (the "Receiving channel…" bar)
 * and this device's first position (the "You entered here" marker).
 *
 * Reads once on channel change and then follows the `sincronia` event from the bridge.
 * Without `sincronia` on the bridge (a host from another version), returns nothing, and
 * the interface shows neither the bar nor the marker.
 */
export function useSincronia(channel: string | null): {
  estado: SincroniaDoCanal | undefined
  lugar: { seq: number; em: number } | null
} {
  const bridge = useBridge()
  const [estado, setEstado] = useState<SincroniaDoCanal | undefined>(undefined)
  const [lugar, setLugar] = useState<{ seq: number; em: number } | null>(null)

  useEffect(() => {
    setEstado(undefined)
    setLugar(null)
    const sincronia = bridge.sincronia
    if (!channel || !sincronia) return
    let vivo = true
    const lerLugar = (): void => {
      void sincronia
        .lugarEm(channel)
        .then((valor) => {
          if (vivo) setLugar(valor)
        })
        .catch(() => {})
    }
    lerLugar()
    void sincronia
      .estado()
      .then((lista) => {
        if (vivo) setEstado((agora) => agora ?? lista.find((e) => e.channel === channel))
      })
      .catch(() => {})
    const largar = bridge.on.sincronia?.((novo) => {
      if (novo.channel !== channel) return
      setEstado(novo)
      // Position is saved when Welcome opens; the first channel state comes right after.
      lerLugar()
    })
    return () => {
      vivo = false
      largar?.()
    }
  }, [bridge, channel])

  return { estado, lugar }
}

import { useEffect, useState } from "react"
import type { EnclaveBridge, Sucessao } from "../bridge.js"

const NENHUMAS: Readonly<Record<string, Sucessao>> = {}

/**
 * The account lineages from the core (phase 8.2): read once when the session is
 * ready, and then on each `on.sucessoes`. The same pattern as `useLacosDeAmizade`.
 * A host without the capability gives the empty map, and nothing changes on
 * screen.
 */
export function useSucessoes(bridge: EnclaveBridge, pronto: boolean): Readonly<Record<string, Sucessao>> {
  const [sucessoes, setSucessoes] = useState<Readonly<Record<string, Sucessao>>>(NENHUMAS)

  useEffect(() => {
    if (!pronto) return
    let vivo = true
    let eventos = 0
    const desligar = bridge.on.sucessoes?.(({ sucessoes: mapa }) => {
      eventos += 1
      if (vivo) setSucessoes(mapa)
    })
    const lidosAntes = eventos
    void bridge.social
      .sucessoes?.()
      .then((mapa) => {
        if (vivo && eventos === lidosAntes) setSucessoes(mapa)
      })
      .catch(() => {})
    return () => {
      vivo = false
      desligar?.()
    }
  }, [bridge, pronto])

  return sucessoes
}

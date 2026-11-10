import { useCallback, useEffect, useRef, useState } from "react"
import type { TipoDeAvisoDeAmigo } from "../lib/amigosOnline.js"
import { AVISO_DO_AMIGO_MS } from "../lib/notifications.js"

/**
 * An MSN-style card: "Ana is online", "Ana joined the Lounge voice room".
 *
 * It comes already resolved by the caller: the message, the avatar and the place. With
 * "Show content" off, the caller sends a discrete message and neither avatar nor place
 * (see `avisarAmigo` in `App.tsx`). Nothing here decides about privacy.
 */
export interface AvisoDeAmigo {
  tipo: TipoDeAvisoDeAmigo
  /** The full message, bold: this is also what the screen reader reads. */
  texto: string
  /** The gray line below, when there is a place: the community name. */
  onde?: string | undefined
  /** The avatar (`avatarDataUrl`). Without it, the initials. */
  cara?: string | undefined
  /** One or two letters. Empty in quiet mode: a person icon shows instead. */
  iniciais: string
  /** The button: "Open chat", "Join", "View", "Open". */
  rotulo: string
  fazer: () => void
}

export interface AvisoNaPilha extends AvisoDeAmigo {
  id: number
  /** The timer is stopped: the mouse or focus is on the card. */
  parado: boolean
}

/**
 * Each card's timer, like the one on notifications (`useToasts`): store what
 * REMAINS, to stop and resume with the right time.
 */
interface Relogio {
  restante: number
  desde: number
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * The stack of friend cards. Each card has its own 2 s timer
 * (`AVISO_DO_AMIGO_MS`, owner's order 2 November 2026), even those not visible:
 * "+N" counts who arrived, and anyone who arrived more than 2 s ago is no longer arriving.
 */
export function useAvisosDeAmigos(): {
  avisos: AvisoNaPilha[]
  empurrar: (aviso: AvisoDeAmigo) => void
  fechar: (id: number) => void
  pausar: (id: number) => void
  retomar: (id: number) => void
} {
  const [avisos, setAvisos] = useState<AvisoNaPilha[]>([])
  const contador = useRef(0)
  const relogios = useRef<Map<number, Relogio>>(new Map())

  const fechar = useCallback((id: number) => {
    const relogio = relogios.current.get(id)
    if (relogio?.timer) clearTimeout(relogio.timer)
    relogios.current.delete(id)
    setAvisos((actuais) => actuais.filter((aviso) => aviso.id !== id))
  }, [])

  const armar = useCallback(
    (id: number, relogio: Relogio) => {
      relogio.desde = Date.now()
      relogio.timer = setTimeout(() => fechar(id), relogio.restante)
    },
    [fechar],
  )

  const empurrar = useCallback(
    (aviso: AvisoDeAmigo) => {
      const id = ++contador.current
      const relogio: Relogio = { restante: AVISO_DO_AMIGO_MS, desde: 0, timer: null }
      relogios.current.set(id, relogio)
      setAvisos((actuais) => [...actuais, { ...aviso, id, parado: false }])
      armar(id, relogio)
    },
    [armar],
  )

  const marcar = (id: number, parado: boolean): void =>
    setAvisos((actuais) => actuais.map((aviso) => (aviso.id === id ? { ...aviso, parado } : aviso)))

  const pausar = useCallback((id: number) => {
    const relogio = relogios.current.get(id)
    if (!relogio?.timer) return
    clearTimeout(relogio.timer)
    relogio.timer = null
    relogio.restante = Math.max(0, relogio.restante - (Date.now() - relogio.desde))
    marcar(id, true)
  }, [])

  const retomar = useCallback(
    (id: number) => {
      const relogio = relogios.current.get(id)
      if (!relogio || relogio.timer) return
      armar(id, relogio)
      marcar(id, false)
    },
    [armar],
  )

  useEffect(() => {
    const pendentes = relogios.current
    return () => {
      for (const relogio of pendentes.values()) if (relogio.timer) clearTimeout(relogio.timer)
    }
  }, [])

  return { avisos, empurrar, fechar, pausar, retomar }
}

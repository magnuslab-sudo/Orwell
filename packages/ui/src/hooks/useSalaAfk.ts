import { useCallback, useEffect, useRef } from "react"
import type { EnclaveBridge } from "../bridge.js"
import { RelogioAfk, type MudancaAfk } from "../lib/relogioAfk.js"

/**
 * The AFK timer for a room tied to this device's call (2/11/2026).
 *
 * The full logic lives in `lib/relogioAfk.ts`; this only gives the state on each
 * render and returns the "press to speak" gesture, which restarts the countdown.
 * The caller moves (`aoMover`): the shell can change rooms, this cannot.
 */
export function useSalaAfk({
  bridge,
  callChannel,
  callRoom,
  privada,
  silenciado,
  aPartilharEcra,
  aEmitirMusica,
  aoMover,
}: {
  bridge: EnclaveBridge
  callChannel: string | null
  callRoom: string
  privada: boolean
  /** Microphone muted or everything muted, by choice (user preferences). */
  silenciado: boolean
  aPartilharEcra: boolean
  aEmitirMusica: boolean
  aoMover: (mudanca: MudancaAfk) => void
}): { actividade: () => void; salaAfk: { room: string; minutos: number } | null } {
  const aoMoverRef = useRef(aoMover)
  aoMoverRef.current = aoMover
  const relogio = useRef<RelogioAfk | null>(null)
  relogio.current ??= new RelogioAfk((mudanca) => aoMoverRef.current(mudanca))

  // Read on each render: the room list comes from the core and changes without the caller knowing.
  const marcada = callChannel && !privada ? bridge.channels.rooms?.(callChannel)?.find((sala) => sala.afk) : undefined
  const salaAfk = marcada?.afk ? { room: marcada.room, minutos: marcada.afk.minutos } : null
  const chaveDaSalaAfk = salaAfk ? `${salaAfk.room}\n${salaAfk.minutos}` : ""

  useEffect(() => {
    relogio.current?.actualizar({
      canal: callChannel,
      sala: callRoom,
      privada,
      salaAfk,
      silenciadoPorGesto: silenciado,
      aPartilharEcra,
      aEmitirMusica,
    })
    // `salaAfk` comes in by key: it is a new object on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callChannel, callRoom, privada, chaveDaSalaAfk, silenciado, aPartilharEcra, aEmitirMusica])

  useEffect(() => () => relogio.current?.parar(), [])

  const actividade = useCallback(() => relogio.current?.actividade(), [])
  return { actividade, salaAfk }
}

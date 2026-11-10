import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, renderHook } from "@testing-library/react"
import { useBloqueioAutomatico } from "./useBloqueioAutomatico.js"

/**
 * "Lock alone" (phase 4 of 0.9 settings): the vault closes after the chosen time
 * with no key, mouse or touch, and never during a call.
 */

afterEach(cleanup)
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const MIN = 60_000

function montar(props: { minutos: number; activo?: boolean; emChamada?: boolean }) {
  const aoBloquear = vi.fn()
  const vista = renderHook(
    (p: { minutos: number; activo: boolean; emChamada: boolean }) =>
      useBloqueioAutomatico({ ...p, aoBloquear }),
    { initialProps: { activo: true, emChamada: false, ...props } },
  )
  return { aoBloquear, ...vista }
}

describe("useBloqueioAutomatico", () => {
  it("fecha ao fim do tempo sem uso, uma vez só", () => {
    const { aoBloquear } = montar({ minutos: 15 })
    vi.advanceTimersByTime(15 * MIN - 1000)
    expect(aoBloquear).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    expect(aoBloquear).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60 * MIN)
    expect(aoBloquear).toHaveBeenCalledTimes(1)
  })

  it("uma tecla, o rato ou um toque recomeçam a contagem", () => {
    const { aoBloquear } = montar({ minutos: 15 })
    vi.advanceTimersByTime(10 * MIN)
    window.dispatchEvent(new Event("keydown"))
    vi.advanceTimersByTime(10 * MIN)
    window.dispatchEvent(new Event("pointermove"))
    vi.advanceTimersByTime(10 * MIN)
    window.dispatchEvent(new Event("touchstart"))
    vi.advanceTimersByTime(14 * MIN)
    expect(aoBloquear).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2 * MIN)
    expect(aoBloquear).toHaveBeenCalledTimes(1)
  })

  it('"Nunca" não fecha nada', () => {
    const { aoBloquear } = montar({ minutos: 0 })
    vi.advanceTimersByTime(24 * 60 * MIN)
    expect(aoBloquear).not.toHaveBeenCalled()
  })

  it("com o cofre fechado (no portão) não conta", () => {
    const { aoBloquear } = montar({ minutos: 15, activo: false })
    vi.advanceTimersByTime(60 * MIN)
    expect(aoBloquear).not.toHaveBeenCalled()
  })

  it("não fecha durante uma chamada, e o fim da chamada conta como uso", () => {
    const { aoBloquear, rerender } = montar({ minutos: 15, emChamada: true })
    vi.advanceTimersByTime(90 * MIN)
    expect(aoBloquear).not.toHaveBeenCalled()
    rerender({ minutos: 15, activo: true, emChamada: false })
    vi.advanceTimersByTime(14 * MIN)
    expect(aoBloquear).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2 * MIN)
    expect(aoBloquear).toHaveBeenCalledTimes(1)
  })

  it("ao voltar ao separador depois do tempo, fecha logo", () => {
    const { aoBloquear } = montar({ minutos: 15 })
    // The device went to sleep: the clock moved but the timer did not.
    vi.setSystemTime(Date.now() + 20 * MIN)
    document.dispatchEvent(new Event("visibilitychange"))
    expect(aoBloquear).toHaveBeenCalledTimes(1)
  })
})

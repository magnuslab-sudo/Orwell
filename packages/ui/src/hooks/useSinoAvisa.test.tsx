import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { useSinoAvisa, SINO_AVISO_MS, SINO_JUNTA_MS } from "./useSinoAvisa.js"

/**
 * The bell, proven by the four things that can break it.
 *
 * **Animating what you have already seen** makes the app ring the bell on every startup,
 * for mail that was already there. **Flashing in a torrent** turns a resync after going
 * offline into a trembling fault. **Not clearing** leaves the class on the element, and
 * a CSS animation with the class stuck cannot run again, the bell rings once and stays
 * silent for the rest of the session. **Ignoring "Busy"** gives this warning a privilege
 * that no other voice in the app has.
 */

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

/** The throttle clock is `Date.now`, and the timers are fake: they move together. */
function avancar(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe("o sino que avisa", () => {
  it("balança quando o número sobe", () => {
    const { result, rerender } = renderHook(({ porLer }) => useSinoAvisa(porLer, false), {
      initialProps: { porLer: 0 },
    })
    expect(result.current).toBe(false)
    rerender({ porLer: 1 })
    expect(result.current).toBe(true)
  })

  /** Reloading the page is not the entire mailbox arriving at once. */
  it("o que já lá estava ao abrir não é notícia", () => {
    const { result } = renderHook(() => useSinoAvisa(12, false))
    expect(result.current).toBe(false)
  })

  it("ler, marcar como lido ou apagar não balança nada", () => {
    const { result, rerender } = renderHook(({ porLer }) => useSinoAvisa(porLer, false), {
      initialProps: { porLer: 3 },
    })
    rerender({ porLer: 1 })
    expect(result.current).toBe(false)
    rerender({ porLer: 0 })
    expect(result.current).toBe(false)
  })

  it("apaga-se sozinho, para poder voltar a correr", () => {
    const { result, rerender } = renderHook(({ porLer }) => useSinoAvisa(porLer, false), {
      initialProps: { porLer: 0 },
    })
    rerender({ porLer: 1 })
    expect(result.current).toBe(true)
    avancar(SINO_AVISO_MS + 10)
    expect(result.current).toBe(false)
    // And the next one, already outside the group, swings again.
    avancar(SINO_JUNTA_MS)
    rerender({ porLer: 2 })
    expect(result.current).toBe(true)
  })

  /** Twenty notifications from one sync are one event, not twenty. */
  it("uma catadupa é um aviso só", () => {
    const { result, rerender } = renderHook(({ porLer }) => useSinoAvisa(porLer, false), {
      initialProps: { porLer: 0 },
    })
    rerender({ porLer: 1 })
    expect(result.current).toBe(true)
    avancar(SINO_AVISO_MS + 10)
    expect(result.current).toBe(false)
    // The nineteen that follow, all inside the grouping window.
    for (let numero = 2; numero <= 20; numero += 1) {
      rerender({ porLer: numero })
      expect(result.current).toBe(false)
    }
  })

  it('com "Ocupado" ou com o centro aberto, o número sobe e o sino fica quieto', () => {
    const { result, rerender } = renderHook(({ porLer }) => useSinoAvisa(porLer, true), {
      initialProps: { porLer: 0 },
    })
    rerender({ porLer: 1 })
    expect(result.current).toBe(false)
  })

  it("e o que se calou não fica guardado para quando se voltar", () => {
    const { result, rerender } = renderHook(
      ({ porLer, silenciado }) => useSinoAvisa(porLer, silenciado),
      { initialProps: { porLer: 0, silenciado: true } },
    )
    rerender({ porLer: 1, silenciado: true })
    expect(result.current).toBe(false)
    // Leaving "Busy" does not ring the bell for an old notification.
    rerender({ porLer: 1, silenciado: false })
    expect(result.current).toBe(false)
  })
})

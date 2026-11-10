import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { TYPING_TTL_MS } from "@enclave/protocol"
import type { EnclaveBridge } from "../bridge.js"
import { useTyping, TYPING_BURST_MS, TYPING_INTERVAL_MS } from "./useTyping.js"

/**
 * The typing indicator, proven by the three things that can break it.
 *
 * **One event per key** floods the message thread with encrypted signals and
 * gives the server, which reads none of it, the exact rhythm of typing.
 * **A signal with no deadline** leaves someone who closed the laptop mid-sentence
 * eternally "typing" on everyone else's screen. **A signal with no room** makes
 * someone appear typing in every room of the channel when they are typing in
 * one. All three are handled here.
 */

type Ouvinte = (event: { channel: string; from: string; room: string; until: number }) => void

function ponte(): { bridge: EnclaveBridge; typing: ReturnType<typeof vi.fn>; emitir: Ouvinte } {
  const typing = vi.fn(async () => ({ ok: true }))
  const ouvintes = new Set<Ouvinte>()
  const bridge = {
    channels: { typing },
    on: {
      typing: (handler: Ouvinte) => {
        ouvintes.add(handler)
        return () => ouvintes.delete(handler)
      },
    },
  } as unknown as EnclaveBridge
  const emitir: Ouvinte = (event) => {
    for (const ouvinte of ouvintes) ouvinte(event)
  }
  return { bridge, typing, emitir }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe("a enviar o sinal", () => {
  it("vinte teclas seguidas produzem UM sinal, não vinte", () => {
    // The bug this prevents: one encrypted message per keystroke is a flood,
    // and the traffic pattern reveals to the server the typing speed.
    const { bridge, typing } = ponte()
    const { result } = renderHook(() => useTyping(bridge, "!geral:s", "", "@eu:s"))

    act(() => {
      for (let tecla = 0; tecla < 20; tecla++) result.current.noteTyping()
    })
    expect(typing).toHaveBeenCalledTimes(1)
    expect(typing).toHaveBeenCalledWith("!geral:s", undefined)
  })

  it("passado o intervalo, uma tecla nova renova o sinal", () => {
    const { bridge, typing } = ponte()
    const { result } = renderHook(() => useTyping(bridge, "!geral:s", "", "@eu:s"))

    act(() => result.current.noteTyping())
    act(() => vi.advanceTimersByTime(TYPING_INTERVAL_MS + 1))
    act(() => result.current.noteTyping())
    expect(typing).toHaveBeenCalledTimes(2)
  })

  it("a renovação chega antes de o prazo anterior expirar", () => {
    // Without this buffer the indicator would blink off and on at every cycle,
    // which is the difference between an indicator and a blinker.
    expect(TYPING_INTERVAL_MS).toBeLessThan(TYPING_TTL_MS)
  })

  it("passado o tecto da rajada, cala-se — mesmo com a pessoa a escrever", () => {
    // An open box with half a sentence sitting there would emit a signal every
    // four seconds all afternoon: it would stop saying "typing" and become a
    // presence beacon.
    const { bridge, typing } = ponte()
    const { result } = renderHook(() => useTyping(bridge, "!geral:s", "", "@eu:s"))

    act(() => result.current.noteTyping())
    const enviados = () => typing.mock.calls.length

    // Writing without stopping for much longer than the cap.
    for (let passo = 0; passo < 30; passo++) {
      act(() => vi.advanceTimersByTime(TYPING_INTERVAL_MS + 1))
      act(() => result.current.noteTyping())
    }
    // The cap, which is what the test calls itself.
    expect(enviados()).toBeLessThanOrEqual(Math.ceil(TYPING_BURST_MS / TYPING_INTERVAL_MS) + 1)
    // ...and the floor, which was missing. A limit on top alone is satisfied by
    // a hook that sends ONE signal and never again, or none: "silence" was proven
    // by an indicator that never spoke. The burst must last as long as it says
    // before going silent.
    expect(enviados()).toBeGreaterThanOrEqual(Math.floor(TYPING_BURST_MS / TYPING_INTERVAL_MS))
  })

  it("enviar a mensagem reabre a rajada, e a frase seguinte volta a sinalizar já", () => {
    const { bridge, typing } = ponte()
    const { result } = renderHook(() => useTyping(bridge, "!geral:s", "", "@eu:s"))

    act(() => result.current.noteTyping())
    expect(typing).toHaveBeenCalledTimes(1)
    // Without the reset, the next key waited for the entire interval.
    act(() => result.current.stopTyping())
    act(() => result.current.noteTyping())
    expect(typing).toHaveBeenCalledTimes(2)
  })

  it("não há mensagem de fim: parar de escrever não envia nada", () => {
    // The deadline is what clears the indicator on the other end. A stop message
    // would be more traffic to say what silence already says, and never reach
    // someone who closed the laptop, which is exactly the case that matters.
    const { bridge, typing } = ponte()
    const { result } = renderHook(() => useTyping(bridge, "!geral:s", "", "@eu:s"))
    act(() => result.current.noteTyping())
    act(() => result.current.stopTyping())
    expect(typing).toHaveBeenCalledTimes(1)
  })

  it("sem canal aberto não sai sinal nenhum", () => {
    const { bridge, typing } = ponte()
    const { result } = renderHook(() => useTyping(bridge, null, "", "@eu:s"))
    act(() => result.current.noteTyping())
    expect(typing).not.toHaveBeenCalled()
  })

  it("a sala viaja com o sinal", () => {
    const { bridge, typing } = ponte()
    const { result } = renderHook(() => useTyping(bridge, "!geral:s", "anúncios", "@eu:s"))
    act(() => result.current.noteTyping())
    expect(typing).toHaveBeenCalledWith("!geral:s", "anúncios")
  })
})

describe("a receber o sinal", () => {
  it("mostra quem está a escrever neste canal e nesta sala", () => {
    const { bridge, emitir } = ponte()
    const { result } = renderHook(() => useTyping(bridge, "!geral:s", "", "@eu:s"))

    act(() => emitir({ channel: "!geral:s", from: "@ana:s", room: "", until: Date.now() + TYPING_TTL_MS }))
    expect(result.current.typists).toEqual(["@ana:s"])
  })

  it("apaga-se sozinho quando o prazo passa, sem ninguém dizer que parou", () => {
    // The bug: someone who closes the laptop mid-sentence never sends a stop. If
    // the indicator waited for it, it would stay on forever.
    const { bridge, emitir } = ponte()
    const { result } = renderHook(() => useTyping(bridge, "!geral:s", "", "@eu:s"))

    act(() => emitir({ channel: "!geral:s", from: "@ana:s", room: "", until: Date.now() + TYPING_TTL_MS }))
    expect(result.current.typists).toHaveLength(1)

    act(() => vi.advanceTimersByTime(TYPING_TTL_MS + 1_500))
    expect(result.current.typists).toEqual([])
  })

  it("uma sala não mostra quem escreve noutra do mesmo canal", () => {
    // The crypto group is the whole channel: everyone gets everyone's signal, and
    // the room tag is what separates the conversations.
    const { bridge, emitir } = ponte()
    const { result } = renderHook(() => useTyping(bridge, "!geral:s", "anúncios", "@eu:s"))

    act(() => emitir({ channel: "!geral:s", from: "@ana:s", room: "", until: Date.now() + TYPING_TTL_MS }))
    expect(result.current.typists).toEqual([])

    act(() => emitir({ channel: "!geral:s", from: "@rui:s", room: "anúncios", until: Date.now() + TYPING_TTL_MS }))
    expect(result.current.typists).toEqual(["@rui:s"])
  })

  it("um canal não mostra quem escreve noutro", () => {
    const { bridge, emitir } = ponte()
    const { result } = renderHook(() => useTyping(bridge, "!geral:s", "", "@eu:s"))
    act(() => emitir({ channel: "!outro:s", from: "@ana:s", room: "", until: Date.now() + TYPING_TTL_MS }))
    expect(result.current.typists).toEqual([])
  })

  it("nunca nos mostra a nós próprios", () => {
    const { bridge, emitir } = ponte()
    const { result } = renderHook(() => useTyping(bridge, "!geral:s", "", "@eu:s"))
    act(() => emitir({ channel: "!geral:s", from: "@eu:s", room: "", until: Date.now() + TYPING_TTL_MS }))
    expect(result.current.typists).toEqual([])
  })

  it("um sinal que já nasce expirado é deitado fora", () => {
    // Timer mismatch on the other end. Keeping it would light the indicator for
    // one sweep cycle for nothing.
    const { bridge, emitir } = ponte()
    const { result } = renderHook(() => useTyping(bridge, "!geral:s", "", "@eu:s"))
    act(() => emitir({ channel: "!geral:s", from: "@ana:s", room: "", until: Date.now() - 1 }))
    expect(result.current.typists).toEqual([])
  })

  it("duas pessoas ao mesmo tempo aparecem as duas", () => {
    const { bridge, emitir } = ponte()
    const { result } = renderHook(() => useTyping(bridge, "!geral:s", "", "@eu:s"))
    act(() => {
      emitir({ channel: "!geral:s", from: "@ana:s", room: "", until: Date.now() + TYPING_TTL_MS })
      emitir({ channel: "!geral:s", from: "@rui:s", room: "", until: Date.now() + TYPING_TTL_MS })
    })
    expect(result.current.typists.sort()).toEqual(["@ana:s", "@rui:s"])
  })

  it("um sinal renovado da mesma pessoa não a duplica", () => {
    const { bridge, emitir } = ponte()
    const { result } = renderHook(() => useTyping(bridge, "!geral:s", "", "@eu:s"))
    act(() => emitir({ channel: "!geral:s", from: "@ana:s", room: "", until: Date.now() + TYPING_TTL_MS }))
    act(() => vi.advanceTimersByTime(TYPING_INTERVAL_MS))
    act(() => emitir({ channel: "!geral:s", from: "@ana:s", room: "", until: Date.now() + TYPING_TTL_MS }))
    expect(result.current.typists).toEqual(["@ana:s"])
  })
})

describe("useTyping: sem ligação não sai sinal", () => {
  it('offline, escrever não cifra nem manda o "a escrever"; ligada, manda', () => {
    const { bridge, typing } = ponte()
    const { result, rerender } = renderHook(
      ({ ligacao }: { ligacao: "online" | "reconnecting" }) => useTyping(bridge, "!sala:s", "", "@eu:s", ligacao),
      { initialProps: { ligacao: "reconnecting" as "online" | "reconnecting" } },
    )
    act(() => result.current.noteTyping())
    expect(typing).not.toHaveBeenCalled()
    rerender({ ligacao: "online" })
    act(() => result.current.noteTyping())
    expect(typing).toHaveBeenCalledOnce()
  })
})

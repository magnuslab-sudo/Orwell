import { moradaDeTeste } from "../../testes/moradas.js"
import { lembrarFichasDosCanais } from "../lib/tipoDoCanal.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { BUZZ_MAX_AGE_MS } from "@enclave/protocol"
import type { EnclaveBridge } from "../bridge.js"
import { COTOVELADA_INTERVALO_MS } from "../lib/limiteDaCotovelada.js"
import { useBuzz } from "./useBuzz.js"

const DM_XYZ = moradaDeTeste("directa xyz", "s")
const DM_OUTRA = moradaDeTeste("directa outra", "s")
// The sheet for each channel (1.0 "Arca", slice 6b): no sheet, a channel is a room.
beforeEach(() =>
  lembrarFichasDosCanais({
    [DM]: { tipo: "directa" },
    [DM_XYZ]: { tipo: "directa" },
    [DM_OUTRA]: { tipo: "directa" },
  }),
)

/**
 * The nudge, proven by what can wreck it.
 *
 * **In a group channel** it stops being a nudge and turns into an alarm for
 * thirty people. **No cooldown** brings it back to MSN, the cheapest way to
 * bother someone. **Replayed from history**, it shakes the screen of whoever
 * opens the app, once for each buzz yesterday. And **if it stole focus**, it
 * yanked the cursor from someone typing in another window.
 */

const DM = moradaDeTeste("directa abc", "s")
const ESPACO = "!geral:s"

type Ouvinte = (event: { channel: string; from: string; at: number }) => void

function ponte(): { bridge: EnclaveBridge; buzz: ReturnType<typeof vi.fn>; emitir: Ouvinte } {
  const buzz = vi.fn(async () => ({ ok: true }))
  const ouvintes = new Set<Ouvinte>()
  const bridge = {
    channels: { buzz },
    on: {
      buzz: (handler: Ouvinte) => {
        ouvintes.add(handler)
        return () => ouvintes.delete(handler)
      },
    },
  } as unknown as EnclaveBridge
  const emitir: Ouvinte = (event) => {
    for (const ouvinte of ouvintes) ouvinte(event)
  }
  return { bridge, buzz, emitir }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe("onde a cotovelada existe", () => {
  it("está disponível numa conversa directa", () => {
    const { bridge } = ponte()
    const { result } = renderHook(() => useBuzz(bridge, DM))
    expect(result.current.available).toBe(true)
  })

  it("não existe num canal de grupo, nem quando não há canal aberto", () => {
    const { bridge } = ponte()
    const { result } = renderHook(() => useBuzz(bridge, ESPACO))
    expect(result.current.available).toBe(false)

    const semCanal = renderHook(() => useBuzz(bridge, null))
    expect(semCanal.result.current.available).toBe(false)
  })

  it("a guarda vive no hook e não só no desenho do botão", () => {
    // A rule that exists only in appearance is a rule the first refactor throws
    // away. Here, calling `buzz` on a group channel sends nothing, even if
    // someone draws the button where they shouldn't.
    const { bridge, buzz } = ponte()
    const { result } = renderHook(() => useBuzz(bridge, ESPACO))
    act(() => result.current.buzz())
    expect(buzz).not.toHaveBeenCalled()
  })
})

describe("o intervalo de um minuto, por conversa", () => {
  it("a primeira passa, a segunda imediata não", () => {
    const { bridge, buzz } = ponte()
    const { result } = renderHook(() => useBuzz(bridge, DM))

    act(() => result.current.buzz())
    expect(buzz).toHaveBeenCalledTimes(1)
    // With WHO, not just how many times: the argument is who gets the nudge.
    expect(buzz).toHaveBeenCalledWith(DM)
    act(() => result.current.buzz())
    act(() => result.current.buzz())
    expect(buzz).toHaveBeenCalledTimes(1)
  })

  it("aos cinco segundos do protocolo ainda não passa: o limite é de um minuto", () => {
    const { bridge, buzz } = ponte()
    const { result } = renderHook(() => useBuzz(bridge, DM))

    act(() => result.current.buzz())
    act(() => vi.advanceTimersByTime(5_001))
    act(() => result.current.buzz())
    expect(buzz).toHaveBeenCalledTimes(1)
  })

  it("passado o minuto, volta a passar", () => {
    const { bridge, buzz } = ponte()
    const { result } = renderHook(() => useBuzz(bridge, DM))

    act(() => result.current.buzz())
    act(() => vi.advanceTimersByTime(COTOVELADA_INTERVALO_MS + 1))
    act(() => result.current.buzz())
    expect(buzz).toHaveBeenCalledTimes(2)
  })

  it("o tempo que falta está à vista, e chega a zero sozinho", () => {
    // In MSN the button locked and you could see it was locked. A button that
    // stops working without saying why looks broken.
    const { bridge } = ponte()
    const { result } = renderHook(() => useBuzz(bridge, DM))

    act(() => result.current.buzz())
    expect(result.current.cooldown).toBe(COTOVELADA_INTERVALO_MS / 1000)

    act(() => vi.advanceTimersByTime(3_000))
    expect(result.current.cooldown).toBeLessThan(COTOVELADA_INTERVALO_MS / 1000)
    expect(result.current.cooldown).toBeGreaterThan(0)

    act(() => vi.advanceTimersByTime(COTOVELADA_INTERVALO_MS))
    expect(result.current.cooldown).toBe(0)
  })

  it("mudar de conversa não herda a espera da anterior", () => {
    // The cooldown protects the person on the other end, and on the other end is
    // now someone else.
    const { bridge, buzz } = ponte()
    const { result, rerender } = renderHook(({ canal }) => useBuzz(bridge, canal), {
      initialProps: { canal: DM },
    })

    act(() => result.current.buzz())
    expect(result.current.cooldown).toBeGreaterThan(0)

    rerender({ canal: DM_XYZ })
    expect(result.current.cooldown).toBe(0)
    act(() => result.current.buzz())
    expect(buzz).toHaveBeenCalledTimes(2)
    // And the second went to the NEW conversation.
    //
    // Counting calls wasn't enough, and this test is exactly where it fails: the
    // bug it says it guards against is the channel trapped in an old closure, and
    // an old closure sends the second nudge to the previous person, two calls at
    // once, both green, and someone shaken by mistake.
    expect(buzz).toHaveBeenLastCalledWith(DM_XYZ)
  })

  it("voltar a uma conversa encontra a espera dela onde ficou", () => {
    // Before, leaving and coming back reset the clock, and the limit could be
    // worked around with two clicks on the sidebar.
    const { bridge, buzz } = ponte()
    const { result, rerender } = renderHook(({ canal }) => useBuzz(bridge, canal), {
      initialProps: { canal: DM },
    })

    act(() => result.current.buzz())
    rerender({ canal: DM_XYZ })
    act(() => vi.advanceTimersByTime(10_000))
    rerender({ canal: DM })
    expect(result.current.cooldown).toBe(50)
    act(() => result.current.buzz())
    expect(buzz).toHaveBeenCalledTimes(1)
  })
})

describe("a receber a cotovelada", () => {
  it("uma cotovelada abana o ecrã, e o abanão acaba sozinho", () => {
    const { bridge, emitir } = ponte()
    const { result } = renderHook(() => useBuzz(bridge, DM))

    act(() => emitir({ channel: DM, from: "@ana:s", at: Date.now() }))
    expect(result.current.shaking).toBe(true)

    act(() => vi.advanceTimersByTime(2_000))
    expect(result.current.shaking).toBe(false)
  })

  it("uma cotovelada de outra conversa não abana esta", () => {
    const { bridge, emitir } = ponte()
    const { result } = renderHook(() => useBuzz(bridge, DM))
    act(() => emitir({ channel: DM_OUTRA, from: "@ana:s", at: Date.now() }))
    expect(result.current.shaking).toBe(false)
  })

  it("uma cotovelada velha não se sente", () => {
    // Defense against a replay that slipped past the session cut: without it,
    // opening the app would shake the screen with yesterday's buzzes.
    const { bridge, emitir } = ponte()
    const { result } = renderHook(() => useBuzz(bridge, DM))
    act(() => emitir({ channel: DM, from: "@ana:s", at: Date.now() - BUZZ_MAX_AGE_MS - 1 }))
    expect(result.current.shaking).toBe(false)
  })

  it("dar uma cotovelada abana também o nosso ecrã, como no MSN", () => {
    // The opposite was here once, on the grounds that punishing who gave the
    // nudge would be odd and the sound alone would serve as echo. The grounds were
    // sound and the reference was wrong: in MSN the buzz shook both windows, and
    // that is what this imitates. Whoever hit the button saw the screen still and
    // rightly concluded it hadn't worked.
    //
    // The shake is 6px fading, not an earthquake, see the comment on
    // `.main.buzzing`. And anyone with reduced motion still gets the highlight
    // instead of the movement, on both sides.
    const { bridge } = ponte()
    const { result } = renderHook(() => useBuzz(bridge, DM))
    act(() => result.current.buzz())
    expect(result.current.shaking).toBe(true)

    act(() => vi.advanceTimersByTime(2_000))
    expect(result.current.shaking).toBe(false)
  })

  it("uma cotovelada recusada pelo intervalo não abana nada", () => {
    // The guard stays the same: if the button is closed, there is no gesture, and
    // without a gesture there is no echo to give.
    const { bridge } = ponte()
    const { result } = renderHook(() => useBuzz(bridge, DM))
    act(() => result.current.buzz())
    act(() => vi.advanceTimersByTime(2_000))
    expect(result.current.shaking).toBe(false)

    act(() => result.current.buzz())
    expect(result.current.shaking).toBe(false)
  })

  it("não rouba o foco a ninguém", () => {
    // A nudge that brought the app to the front would yank the cursor from
    // someone typing in another window, and then it stops being a nudge.
    const { bridge, emitir } = ponte()
    const caixa = document.createElement("input")
    document.body.append(caixa)
    caixa.focus()
    const focoAntes = document.activeElement

    renderHook(() => useBuzz(bridge, DM))
    act(() => emitir({ channel: DM, from: "@ana:s", at: Date.now() }))

    expect(document.activeElement).toBe(focoAntes)
    caixa.remove()
  })
})

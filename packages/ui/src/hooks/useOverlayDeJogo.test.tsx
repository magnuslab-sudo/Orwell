import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import type { EnclaveBridge, ResumoParaAOverlay } from "../bridge.js"
import { montarWebAudioFalso, vozFalsa } from "./vozFalsa.js"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function ponteFalsa() {
  const estados: (ResumoParaAOverlay | null)[] = []
  const caras: Record<string, string | null>[] = []
  const preferencias: unknown[] = []
  const ponte: NonNullable<EnclaveBridge["overlay"]> = {
    estado: (resumo) => estados.push(resumo),
    caras: (lote) => caras.push(lote),
    preferencias: (p) => preferencias.push(p),
    alternar: vi.fn(),
    repor: vi.fn(),
  }
  return { ponte, estados, caras, preferencias }
}

const textos = { entrou: "entrou na sala", saiu: "saiu da sala" }

describe("o resumo da sala, para a overlay", () => {
  it("a nossa cara primeiro, e quem está silenciado não fala", async () => {
    const { montarResumo } = await import("./useOverlayDeJogo.js")
    const resumo = montarResumo({
      sala: "Sala de jogo",
      entrada: 1,
      eu: { id: "eu", nome: "Eu" },
      outros: [
        { id: "ana", nome: "Ana", stream: null, micCalado: false },
        { id: "rui", nome: "Rui", stream: null, micCalado: true },
        { id: "eu", nome: "Eu outra vez", stream: null, micCalado: false },
      ],
      falam: new Set(["eu", "ana", "rui"]),
      micMuted: false,
      soundOff: true,
    })
    expect(resumo).toEqual({
      sala: "Sala de jogo",
      entrada: 1,
      pessoas: [
        { id: "eu", nome: "Eu", aFalar: false, micCalado: true, somDesligado: true },
        { id: "ana", nome: "Ana", aFalar: true, micCalado: false, somDesligado: false },
        { id: "rui", nome: "Rui", aFalar: false, micCalado: true, somDesligado: false },
      ],
    })
  })
})

describe("useOverlayDeJogo", () => {
  let audio: ReturnType<typeof montarWebAudioFalso> | null = null
  beforeEach(() => {
    audio = montarWebAudioFalso()
  })
  afterEach(() => {
    audio?.desmontar()
  })

  const base = (ponte: NonNullable<EnclaveBridge["overlay"]>) => ({
    ponte,
    sala: { chave: "!canal/voz", nome: "Sala de jogo" } as { chave: string; nome: string } | null,
    eu: { id: "eu", nome: "Eu" },
    outros: [] as { id: string; nome: string; stream: MediaStream | null; micCalado: boolean; cara?: string }[],
    micMuted: false,
    soundOff: false,
    dbDaEntrada: () => null,
    ligada: true,
    opacidade: 0.6,
    textos,
    reduzir: async (cara: string) => `${cara}#64`,
  })

  it("manda as preferências e o resumo, e só quando mudam", async () => {
    const { useOverlayDeJogo } = await import("./useOverlayDeJogo.js")
    const { ponte, estados, preferencias } = ponteFalsa()
    const { rerender } = renderHook((props) => useOverlayDeJogo(props), { initialProps: base(ponte) })
    expect(preferencias).toEqual([{ ligada: true, opacidade: 0.6, textos }])
    expect(estados).toHaveLength(1)
    expect(estados[0]?.sala).toBe("Sala de jogo")
    rerender(base(ponte))
    expect(estados).toHaveLength(1)
    rerender({ ...base(ponte), micMuted: true })
    expect(estados).toHaveLength(2)
    expect(estados[1]?.pessoas[0]?.micCalado).toBe(true)
  })

  it("sair da sala manda `null` uma vez; quem nunca entrou não manda nada", async () => {
    const { useOverlayDeJogo } = await import("./useOverlayDeJogo.js")
    const { ponte, estados } = ponteFalsa()
    const { rerender } = renderHook((props) => useOverlayDeJogo(props), {
      initialProps: { ...base(ponte), sala: null as { chave: string; nome: string } | null },
    })
    expect(estados).toEqual([])
    rerender(base(ponte))
    rerender({ ...base(ponte), sala: null })
    rerender({ ...base(ponte), sala: null })
    expect(estados.at(-1)).toBeNull()
    expect(estados.filter((estado) => estado === null)).toHaveLength(1)
  })

  it("desligada nas Definições, não manda resumo nem mede ninguém", async () => {
    const { useOverlayDeJogo } = await import("./useOverlayDeJogo.js")
    const { ponte, estados, preferencias } = ponteFalsa()
    renderHook(() => useOverlayDeJogo({ ...base(ponte), ligada: false }))
    expect(estados).toEqual([])
    expect(preferencias).toEqual([{ ligada: false, opacidade: 0.6, textos }])
  })

  it("outra sala, mesmo com o mesmo nome, é outra entrada", async () => {
    const { useOverlayDeJogo } = await import("./useOverlayDeJogo.js")
    const { ponte, estados } = ponteFalsa()
    const { rerender } = renderHook((props) => useOverlayDeJogo(props), { initialProps: base(ponte) })
    rerender({ ...base(ponte), sala: { chave: "!outro/voz", nome: "Sala de jogo" } })
    expect(estados[1]!.entrada).toBeGreaterThan(estados[0]!.entrada)
  })

  it("as caras vão reduzidas, à parte, uma vez por pessoa; sem cara vai `null`", async () => {
    const { useOverlayDeJogo } = await import("./useOverlayDeJogo.js")
    const { ponte, caras } = ponteFalsa()
    const props = {
      ...base(ponte),
      outros: [{ id: "ana", nome: "Ana", stream: null, micCalado: false, cara: "data:image/png;base64,AAAA" }],
    }
    const { rerender } = renderHook((p) => useOverlayDeJogo(p), { initialProps: props })
    await act(async () => {
      await Promise.resolve()
    })
    expect(caras).toContainEqual({ eu: null })
    expect(caras).toContainEqual({ ana: "data:image/png;base64,AAAA#64" })
    const antes = caras.length
    rerender({ ...props })
    await act(async () => {
      await Promise.resolve()
    })
    expect(caras).toHaveLength(antes)
  })

  it("quem fala acende, e apaga depois de uma pausa: medido sem quadros, com a janela atrás do jogo", async () => {
    vi.useFakeTimers()
    const { useOverlayDeJogo } = await import("./useOverlayDeJogo.js")
    const { ponte, estados } = ponteFalsa()
    const ana = vozFalsa("ana-overlay", 0)
    renderHook(() =>
      useOverlayDeJogo({ ...base(ponte), outros: [{ id: "ana", nome: "Ana", stream: ana.stream, micCalado: false }] }),
    )
    const falaAna = (): boolean | undefined => estados.at(-1)?.pessoas.find((p) => p.id === "ana")?.aFalar
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(falaAna()).toBe(false)
    act(() => {
      ana.falar(60)
      vi.advanceTimersByTime(300)
    })
    expect(falaAna()).toBe(true)
    act(() => {
      ana.falar(0)
      vi.advanceTimersByTime(1000)
    })
    expect(falaAna()).toBe(false)
  })
})

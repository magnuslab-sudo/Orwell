import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import type { EnclaveBridge, EstadoDosAtalhosGlobais } from "../bridge.js"
import { ATALHOS_POR_OMISSAO } from "../lib/atalhosDeVoz.js"
import { useAtalhosGlobais } from "./useAtalhosGlobais.js"

afterEach(cleanup)

const vazio: EstadoDosAtalhosGlobais = { globais: [], soComAJanela: [], ocupados: [], faltaAcessibilidade: [] }

function ponte(resposta: Partial<EstadoDosAtalhosGlobais> = { globais: ["microfone", "som"] }) {
  let ouvinte: ((accao: "microfone" | "som" | "overlay") => void) | null = null
  const definir = vi.fn(async (pedido: unknown) => (pedido === null ? vazio : { ...vazio, ...resposta }))
  const p: NonNullable<EnclaveBridge["atalhosGlobais"]> = {
    definir,
    suspender: vi.fn(async () => ({ ok: true })),
    abrirAcessibilidade: vi.fn(async () => ({ ok: true })),
    aoAccionar: (handler) => {
      ouvinte = handler
      return () => {
        ouvinte = null
      }
    },
  }
  return { p, definir, carregar: (accao: "microfone" | "som" | "overlay") => ouvinte?.(accao) }
}

async function esperar(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe("os atalhos globais, do lado da interface", () => {
  it("fora de uma chamada não pede nada ao principal", () => {
    const { p, definir } = ponte()
    renderHook(() =>
      useAtalhosGlobais({ ponte: p, emChamada: false, mapa: ATALHOS_POR_OMISSAO, accoes: { microfone: vi.fn(), som: vi.fn() } }),
    )
    expect(definir).not.toHaveBeenCalled()
  })

  it("regista ao entrar na chamada, liberta ao sair, e diz o que ficou global", async () => {
    const { p, definir } = ponte()
    const aoRegistar = vi.fn()
    const { result, rerender } = renderHook(
      ({ emChamada }) =>
        useAtalhosGlobais({
          ponte: p,
          emChamada,
          mapa: { ...ATALHOS_POR_OMISSAO, som: "F13" },
          accoes: { microfone: vi.fn(), som: vi.fn() },
          aoRegistar,
        }),
      { initialProps: { emChamada: true } },
    )
    await esperar()
    expect(definir).toHaveBeenLastCalledWith({ microfone: "Mod+Shift+M", som: "F13" })
    expect([...result.current()]).toEqual(["microfone", "som"])
    expect(aoRegistar).toHaveBeenCalledTimes(1)

    rerender({ emChamada: false })
    await esperar()
    expect(definir).toHaveBeenLastCalledWith(null)
    expect(result.current().size).toBe(0)
    expect(aoRegistar).toHaveBeenCalledTimes(1)
  })

  it("um atalho mudado a meio da chamada pede outra vez", async () => {
    const { p, definir } = ponte()
    const { rerender } = renderHook(
      ({ som }) =>
        useAtalhosGlobais({ ponte: p, emChamada: true, mapa: { ...ATALHOS_POR_OMISSAO, som }, accoes: { microfone: vi.fn(), som: vi.fn() } }),
      { initialProps: { som: "F13" as string | null } },
    )
    await esperar()
    rerender({ som: "F14" })
    await esperar()
    expect(definir).toHaveBeenLastCalledWith({ microfone: "Mod+Shift+M", som: "F14" })
  })

  it("a tecla carregada com a app escondida chama o comando", () => {
    const { p, carregar } = ponte()
    const microfone = vi.fn()
    const som = vi.fn()
    renderHook(() => useAtalhosGlobais({ ponte: p, emChamada: true, mapa: ATALHOS_POR_OMISSAO, accoes: { microfone, som } }))
    carregar("som")
    expect(som).toHaveBeenCalledTimes(1)
    expect(microfone).not.toHaveBeenCalled()
  })

  it("com a overlay de jogo, o atalho dela vai no pedido e a tecla chama-a", async () => {
    const { p, definir, carregar } = ponte({ globais: ["microfone", "som", "overlay"] })
    const overlay = vi.fn()
    const { result } = renderHook(() =>
      useAtalhosGlobais({ ponte: p, emChamada: true, mapa: ATALHOS_POR_OMISSAO, accoes: { microfone: vi.fn(), som: vi.fn(), overlay } }),
    )
    await esperar()
    expect(definir).toHaveBeenLastCalledWith({ microfone: "Mod+Shift+M", som: "Mod+Shift+D", overlay: "Alt+Shift+O" })
    expect(result.current().has("overlay")).toBe(true)
    carregar("overlay")
    expect(overlay).toHaveBeenCalledTimes(1)
  })

  it("sem overlay (o browser, ou a overlay desligada), o atalho dela não se pede e a tecla não faz nada", async () => {
    const { p, definir, carregar } = ponte()
    renderHook(() =>
      useAtalhosGlobais({ ponte: p, emChamada: true, mapa: ATALHOS_POR_OMISSAO, accoes: { microfone: vi.fn(), som: vi.fn() } }),
    )
    await esperar()
    expect(definir).toHaveBeenLastCalledWith({ microfone: "Mod+Shift+M", som: "Mod+Shift+D" })
    expect(() => carregar("overlay")).not.toThrow()
  })

  it('um envelope de erro do principal vale "nada global": a janela à frente trata de tudo', async () => {
    const { p } = ponte()
    p.definir = vi.fn(async () => ({ ok: false, chave: "x" }) as unknown as EstadoDosAtalhosGlobais)
    const { result } = renderHook(() =>
      useAtalhosGlobais({ ponte: p, emChamada: true, mapa: ATALHOS_POR_OMISSAO, accoes: { microfone: vi.fn(), som: vi.fn() } }),
    )
    await esperar()
    expect(result.current().size).toBe(0)
  })

  it("ao fechar a sessão a meio da chamada, larga a tecla", async () => {
    const { p, definir } = ponte()
    const { unmount } = renderHook(() =>
      useAtalhosGlobais({ ponte: p, emChamada: true, mapa: ATALHOS_POR_OMISSAO, accoes: { microfone: vi.fn(), som: vi.fn() } }),
    )
    await esperar()
    unmount()
    expect(definir).toHaveBeenLastCalledWith(null)
  })

  it("no browser não há ponte, e nada acontece", () => {
    const { result } = renderHook(() =>
      useAtalhosGlobais({ ponte: undefined, emChamada: true, mapa: ATALHOS_POR_OMISSAO, accoes: { microfone: vi.fn(), som: vi.fn() } }),
    )
    expect(result.current().size).toBe(0)
  })
})

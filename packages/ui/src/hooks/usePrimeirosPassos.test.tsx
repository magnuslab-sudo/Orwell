import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { impressaoDoEndereco, marcarPrimeirosPassos, PRIMEIROS_PASSOS_KEY, usePrimeirosPassos } from "./usePrimeirosPassos.js"

beforeEach(() => localStorage.clear())
afterEach(cleanup)

const EU = "@eu:s"

describe("usePrimeirosPassos", () => {
  it("só aparece à conta que o portão acabou de criar", async () => {
    await marcarPrimeirosPassos(EU)
    const minha = renderHook(() => usePrimeirosPassos(EU, false, true))
    await waitFor(() => expect(minha.result.current.visivel).toBe(true))
    // Another account (unlocked or imported) does not see it.
    const outra = renderHook(() => usePrimeirosPassos("@outra:s", false, true))
    await act(async () => {
      await Promise.resolve()
    })
    expect(outra.result.current.visivel).toBe(false)
  })

  it("o disco guarda uma impressão do endereço, nunca o endereço", async () => {
    await marcarPrimeirosPassos(EU)
    const guardado = localStorage.getItem(PRIMEIROS_PASSOS_KEY)
    expect(guardado).toBe(await impressaoDoEndereco(EU))
    expect(guardado).toHaveLength(16)
    expect(guardado).not.toContain("eu")
  })

  it("sem marca não aparece: quem desbloqueia uma conta antiga já sabe o caminho", () => {
    expect(renderHook(() => usePrimeirosPassos(EU, false, true)).result.current.visivel).toBe(false)
  })

  it("fechar apaga a marca de vez", async () => {
    await marcarPrimeirosPassos(EU)
    const { result } = renderHook(() => usePrimeirosPassos(EU, false, true))
    await waitFor(() => expect(result.current.visivel).toBe(true))
    act(() => result.current.fechar())
    expect(result.current.visivel).toBe(false)
    expect(localStorage.getItem(PRIMEIROS_PASSOS_KEY)).toBeNull()
  })

  it("o primeiro amigo ou canal tira o cartão, e esquece-o quando o juízo é de fiar", async () => {
    await marcarPrimeirosPassos(EU)
    const impressao = await impressaoDoEndereco(EU)
    const { result, rerender } = renderHook(
      ({ temAlguem, podeEsquecer }: { temAlguem: boolean; podeEsquecer: boolean }) =>
        usePrimeirosPassos(EU, temAlguem, podeEsquecer),
      { initialProps: { temAlguem: true, podeEsquecer: false } },
    )
    await act(async () => {
      await Promise.resolve()
    })
    // Hidden, but the mark stays: the common room has not been announced yet.
    expect(result.current.visivel).toBe(false)
    expect(localStorage.getItem(PRIMEIROS_PASSOS_KEY)).toBe(impressao)

    rerender({ temAlguem: false, podeEsquecer: true })
    await waitFor(() => expect(result.current.visivel).toBe(true))

    rerender({ temAlguem: true, podeEsquecer: true })
    expect(result.current.visivel).toBe(false)
    expect(localStorage.getItem(PRIMEIROS_PASSOS_KEY)).toBeNull()
  })
})

describe("usePrimeirosPassos fora de contexto seguro", () => {
  it("sem `crypto.subtle`, marcar não lança e o cartão simplesmente não aparece", async () => {
    const digest = vi.spyOn(crypto.subtle, "digest").mockRejectedValue(new Error("not a secure context"))
    await expect(marcarPrimeirosPassos(EU)).resolves.toBeUndefined()
    const { result } = renderHook(() => usePrimeirosPassos(EU, false, true))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.visivel).toBe(false)
    digest.mockRestore()
  })
})

import { afterEach, describe, expect, it, vi } from "vitest"
import { copiarTexto } from "./copiar.js"

afterEach(() => {
  delete (globalThis as { enclaveHost?: unknown }).enclaveHost
  vi.unstubAllGlobals()
})

describe("copiarTexto", () => {
  it("na app de secretária copia pelo processo principal, sem tocar no navigator.clipboard", async () => {
    const write = vi.fn(async () => ({ ok: true }))
    ;(globalThis as { enclaveHost?: unknown }).enclaveHost = { clipboard: { write } }
    const writeText = vi.fn(async () => {})
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    await copiarTexto("https://orwell.pt/app/emparelhar#x")
    expect(write).toHaveBeenCalledWith("https://orwell.pt/app/emparelhar#x")
    expect(writeText).not.toHaveBeenCalled()
  })

  it("no browser usa o navigator.clipboard", async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    await copiarTexto("abc")
    expect(writeText).toHaveBeenCalledWith("abc")
  })

  it('sem área de transferência nenhuma, rejeita (quem chama diz "não foi possível copiar")', async () => {
    vi.stubGlobal("navigator", {})
    await expect(copiarTexto("abc")).rejects.toThrow()
  })
})

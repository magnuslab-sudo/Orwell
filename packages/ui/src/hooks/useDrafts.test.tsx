import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { useDrafts, withDraft } from "./useDrafts.js"

afterEach(cleanup)

describe("withDraft", () => {
  it("escreve sem mutar o mapa original", () => {
    const original = new Map([["!a:s", "olá"]])
    const next = withDraft(original, "!b:s", "adeus")
    expect(next.get("!a:s")).toBe("olá")
    expect(next.get("!b:s")).toBe("adeus")
    expect(original.has("!b:s")).toBe(false)
  })

  it("texto vazio limpa a entrada em vez de guardar lixo", () => {
    const next = withDraft(new Map([["!a:s", "olá"]]), "!a:s", "")
    expect(next.has("!a:s")).toBe(false)
  })
})

describe("useDrafts", () => {
  it("cada canal mantém o seu rascunho ao trocar", () => {
    const { result } = renderHook(() => useDrafts())

    act(() => result.current.setDraft("!a:s", "meia frase"))
    act(() => result.current.setDraft("!b:s", "outra coisa"))

    expect(result.current.draftFor("!a:s")).toBe("meia frase")
    expect(result.current.draftFor("!b:s")).toBe("outra coisa")
    expect(result.current.draftFor("!c:s")).toBe("")
    expect(result.current.draftFor(null)).toBe("")
  })

  it("limpar um canal não toca nos outros", () => {
    const { result } = renderHook(() => useDrafts())
    act(() => result.current.setDraft("!a:s", "meia frase"))
    act(() => result.current.setDraft("!b:s", "fica"))
    act(() => result.current.setDraft("!a:s", ""))
    expect(result.current.draftFor("!a:s")).toBe("")
    expect(result.current.draftFor("!b:s")).toBe("fica")
  })
})

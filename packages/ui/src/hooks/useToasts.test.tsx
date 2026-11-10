import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { ACTION_TOAST_MS, INFO_TOAST_MS, MAX_TOASTS, toastsReducer, useToasts, type Toast } from "./useToasts.js"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("toastsReducer", () => {
  it("empilha e retira pelo id", () => {
    const first: Toast = { id: 1, detail: "um", level: "info" }
    const second: Toast = { id: 2, detail: "dois", level: "error" }
    let state = toastsReducer([], { type: "push", toast: first })
    state = toastsReducer(state, { type: "push", toast: second })
    expect(state).toEqual([first, second])
    state = toastsReducer(state, { type: "dismiss", id: 1 })
    expect(state).toEqual([second])
  })

  it("ignora um dismiss de id desconhecido", () => {
    const only: Toast = { id: 7, detail: "fica", level: "error" }
    expect(toastsReducer([only], { type: "dismiss", id: 3 })).toEqual([only])
  })

  it("nunca deixa a pilha passar do limite: sai o info mais antigo", () => {
    let state: Toast[] = []
    for (let index = 1; index <= MAX_TOASTS + 2; index++) {
      state = toastsReducer(state, { type: "push", toast: { id: index, detail: `${index}`, level: "info" } })
    }
    expect(state).toHaveLength(MAX_TOASTS)
    // The newest survive; the oldest are the ones that go.
    expect(state.map((toast) => toast.id)).toEqual([3, 4, 5])
  })

  it("um erro não é despejado por causa de um info novo", () => {
    // Errors are the ones that still need somebody: an info toast arriving
    // must never be what removes them from the screen.
    let state: Toast[] = [
      { id: 1, detail: "falhou", level: "error" },
      { id: 2, detail: "a", level: "info" },
      { id: 3, detail: "b", level: "info" },
    ]
    state = toastsReducer(state, { type: "push", toast: { id: 4, detail: "c", level: "info" } })
    expect(state.map((toast) => toast.id)).toEqual([1, 3, 4])
  })
})

describe("useToasts", () => {
  it("um toast info desaparece sozinho ao fim de ~5s", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useToasts())

    act(() => result.current.push("endereço copiado"))
    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0]?.level).toBe("info")

    act(() => vi.advanceTimersByTime(INFO_TOAST_MS - 1))
    expect(result.current.toasts).toHaveLength(1)

    act(() => vi.advanceTimersByTime(1))
    expect(result.current.toasts).toHaveLength(0)
  })

  it("um toast com acção e duração própria sai nesse tempo, e não nos 10 s", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useToasts())

    act(() => result.current.push("A Ana está online.", "info", { rotulo: "Abrir a conversa", fazer: () => {}, duracaoMs: 2000 }))
    expect(result.current.toasts).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1999))
    expect(result.current.toasts).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.toasts).toHaveLength(0)
    expect(ACTION_TOAST_MS).toBeGreaterThan(2000)
  })

  it("um toast de erro persiste até ser fechado à mão", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useToasts())

    act(() => result.current.push("algo falhou", "error"))
    act(() => vi.advanceTimersByTime(60_000))
    expect(result.current.toasts).toHaveLength(1)

    const id = result.current.toasts[0]?.id as number
    act(() => result.current.dismiss(id))
    expect(result.current.toasts).toHaveLength(0)
  })

  it("cada toast recebe um id novo", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useToasts())

    act(() => {
      result.current.push("primeiro", "error")
      result.current.push("segundo", "error")
    })
    const ids = result.current.toasts.map((toast) => toast.id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe("useToasts: o aviso com caminho de volta", () => {
  it("leva a acção e fica o dobro do tempo, para dar para lá chegar", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useToasts())
    const fazer = vi.fn()
    act(() => result.current.push("sala fechada", "info", { rotulo: "Mostrar de novo", fazer }))
    expect(result.current.toasts[0]?.accao?.rotulo).toBe("Mostrar de novo")

    act(() => vi.advanceTimersByTime(INFO_TOAST_MS + 100))
    expect(result.current.toasts).toHaveLength(1)
    act(() => vi.advanceTimersByTime(ACTION_TOAST_MS - INFO_TOAST_MS))
    expect(result.current.toasts).toHaveLength(0)
    expect(fazer).not.toHaveBeenCalled()
  })
})

describe("useToasts: o relógio pára enquanto alguém está no aviso (WCAG 2.2.1)", () => {
  it("parado não sai; retomado sai com o tempo que faltava, e não com o tempo todo", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useToasts())
    act(() => result.current.push("sala fechada", "info", { rotulo: "Mostrar de novo", fazer: vi.fn() }))
    const id = result.current.toasts[0]!.id

    act(() => vi.advanceTimersByTime(8000))
    act(() => result.current.pausar(id))
    // A minute with the cursor over it: it stays.
    act(() => vi.advanceTimersByTime(60_000))
    expect(result.current.toasts).toHaveLength(1)

    act(() => result.current.retomar(id))
    act(() => vi.advanceTimersByTime(1900))
    expect(result.current.toasts).toHaveLength(1)
    act(() => vi.advanceTimersByTime(200))
    expect(result.current.toasts).toHaveLength(0)
  })

  it("pausar duas vezes e retomar um erro não fazem nada de estranho", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useToasts())
    act(() => result.current.push("falhou", "error"))
    const erro = result.current.toasts[0]!.id
    act(() => {
      result.current.pausar(erro)
      result.current.retomar(erro)
    })
    act(() => vi.advanceTimersByTime(60_000))
    // The error still has no clock.
    expect(result.current.toasts).toHaveLength(1)

    act(() => result.current.push("info"))
    const info = result.current.toasts[1]!.id
    act(() => {
      result.current.pausar(info)
      result.current.pausar(info)
      result.current.retomar(info)
      result.current.retomar(info)
    })
    act(() => vi.advanceTimersByTime(INFO_TOAST_MS + 10))
    expect(result.current.toasts.map((t) => t.id)).toEqual([erro])
  })
})

describe("useToasts: um aviso que deixou de ser verdade sai (1.3.6)", () => {
  it("dispensarTexto tira os avisos com esse texto, e só esses", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useToasts())
    act(() => {
      result.current.push("pedido enviado")
      result.current.push("outra coisa", "error")
    })
    act(() => result.current.dispensarTexto("pedido enviado"))
    expect(result.current.toasts.map((toast) => toast.detail)).toEqual(["outra coisa"])
    // The timer of the removed alert dies too: it does not touch the stack again.
    act(() => vi.advanceTimersByTime(INFO_TOAST_MS + 10))
    expect(result.current.toasts.map((toast) => toast.detail)).toEqual(["outra coisa"])
  })
})

import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useEffect } from "react"
import { ACTION_TOAST_MS } from "../hooks/useToasts.js"
import { ToastHost, ToastProvider, useToast } from "./Toast.js"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("ToastHost", () => {
  it("é uma região polite; um erro é um alerta com botão Fechar", async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    const { container } = render(
      <ToastHost
        toasts={[
          { id: 1, detail: "endereço copiado", level: "info" },
          { id: 2, detail: "algo falhou", level: "error" },
        ]}
        onDismiss={onDismiss}
      />,
    )

    expect(container.querySelector(".toast-stack")?.getAttribute("aria-live")).toBe("polite")

    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("algo falhou")

    // Only the error carries a dismiss control; info toasts leave on their own.
    const dismiss = screen.getByLabelText("Fechar")
    await user.click(dismiss)
    expect(onDismiss).toHaveBeenCalledWith(2)
  })
})

describe("ToastHost: o aviso com acção", () => {
  it("mostra o botão da acção; carregar fecha o aviso e faz o gesto uma vez", async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    const fazer = vi.fn()
    render(
      <ToastHost
        toasts={[{ id: 3, detail: "Categoria apagada.", level: "info", accao: { rotulo: "Desfazer", fazer } }]}
        onDismiss={onDismiss}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Desfazer" }))
    expect(onDismiss).toHaveBeenCalledWith(3)
    expect(fazer).toHaveBeenCalledOnce()
  })

  it("e pode fechar-se sem desfazer nada", async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    const fazer = vi.fn()
    render(
      <ToastHost
        toasts={[{ id: 4, detail: "Conversa fechada.", level: "info", accao: { rotulo: "Reabrir", fazer } }]}
        onDismiss={onDismiss}
      />,
    )
    await user.click(screen.getByLabelText("Fechar"))
    expect(onDismiss).toHaveBeenCalledWith(4)
    expect(fazer).not.toHaveBeenCalled()
  })
})

describe("ToastHost: o aviso com acção não sai de baixo de quem o está a usar", () => {
  /** A page that raises an alert with action on mount. */
  function Pagina(): null {
    const push = useToast()
    useEffect(() => push("Sala fechada.", "info", { rotulo: "Mostrar de novo", fazer: () => {} }), [push])
    return null
  }

  it("com o rato em cima fica; ao sair, conta o resto e vai-se", () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <Pagina />
      </ToastProvider>,
    )
    const aviso = screen.getByText("Sala fechada.").closest(".toast")!
    fireEvent.mouseEnter(aviso)
    act(() => vi.advanceTimersByTime(ACTION_TOAST_MS * 3))
    expect(screen.queryByText("Sala fechada.")).not.toBeNull()

    fireEvent.mouseLeave(aviso)
    act(() => vi.advanceTimersByTime(ACTION_TOAST_MS + 10))
    expect(screen.queryByText("Sala fechada.")).toBeNull()
  })

  it('com o foco no botão fica, e passar do botão ao "×" não conta como sair', () => {
    vi.useFakeTimers()
    // The window has focus: jsdom says it doesn't, and a `blur` with the window out doesn't count.
    vi.spyOn(document, "hasFocus").mockReturnValue(true)
    render(
      <ToastProvider>
        <Pagina />
      </ToastProvider>,
    )
    const accao = screen.getByRole("button", { name: "Mostrar de novo" })
    const fechar = screen.getByLabelText("Fechar")
    act(() => accao.focus())
    act(() => vi.advanceTimersByTime(ACTION_TOAST_MS * 2))
    act(() => fechar.focus())
    act(() => vi.advanceTimersByTime(ACTION_TOAST_MS * 2))
    expect(screen.queryByText("Sala fechada.")).not.toBeNull()

    // The mouse enters and focus leaves: it stays put, because the mouse is still there.
    const aviso = fechar.closest(".toast")!
    fireEvent.mouseEnter(aviso)
    act(() => fechar.blur())
    act(() => vi.advanceTimersByTime(ACTION_TOAST_MS * 2))
    expect(screen.queryByText("Sala fechada.")).not.toBeNull()

    fireEvent.mouseLeave(aviso)
    act(() => vi.advanceTimersByTime(ACTION_TOAST_MS + 10))
    expect(screen.queryByText("Sala fechada.")).toBeNull()
    vi.restoreAllMocks()
  })
})

describe("ToastHost: a janela a perder o foco não conta como sair do aviso", () => {
  function Pagina(): null {
    const push = useToast()
    useEffect(() => push("Sala fechada.", "info", { rotulo: "Mostrar de novo", fazer: () => {} }), [push])
    return null
  }

  it("com o foco no botão e a janela a sair, o aviso fica", () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <Pagina />
      </ToastProvider>,
    )
    const accao = screen.getByRole("button", { name: "Mostrar de novo" })
    act(() => accao.focus())
    const temFoco = vi.spyOn(document, "hasFocus").mockReturnValue(false)
    fireEvent.blur(accao, { relatedTarget: null })
    act(() => vi.advanceTimersByTime(ACTION_TOAST_MS * 3))
    expect(screen.queryByText("Sala fechada.")).not.toBeNull()
    temFoco.mockRestore()
  })
})

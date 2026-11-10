import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { strings } from "../strings.js"
import { Confirmar } from "./Confirmar.js"

afterEach(cleanup)

/**
 * The confirmation dialog that replaced `window.confirm`.
 *
 * It fixes what the native version didn't do: the verb on the button, red only
 * when destructive, focus on Cancel, Escape cancels, and the `alertdialog` role
 * with title and body linked so the screen reader announces them together.
 */
function montar(destructive = false): { onConfirmar: ReturnType<typeof vi.fn>; onCancelar: ReturnType<typeof vi.fn> } {
  const onConfirmar = vi.fn()
  const onCancelar = vi.fn()
  render(
    <Confirmar
      titulo='Eliminar "Direcção"?'
      corpo="O canal acaba. As mensagens não são apagadas."
      verbo="Eliminar canal"
      destructive={destructive}
      onConfirmar={onConfirmar}
      onCancelar={onCancelar}
    />,
  )
  return { onConfirmar, onCancelar }
}

describe("Confirmar", () => {
  it("é um alertdialog com nome e descrição", () => {
    montar()
    const dialogo = screen.getByRole("alertdialog", { name: 'Eliminar "Direcção"?' })
    expect(dialogo.getAttribute("aria-modal")).toBe("true")
    const descrito = dialogo.getAttribute("aria-describedby")
    expect(descrito).toBeTruthy()
    expect(document.getElementById(descrito as string)?.textContent).toContain("não são apagadas")
  })

  it('o botão diz o verbo, e nunca "OK"', () => {
    montar()
    expect(screen.getByRole("button", { name: "Eliminar canal" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^ok$/i })).toBeNull()
    expect(screen.getByRole("button", { name: strings.confirmar.cancelar })).toBeTruthy()
  })

  it("o foco começa no Cancelar: um Enter distraído não destrói nada", () => {
    montar(true)
    expect(document.activeElement).toBe(screen.getByRole("button", { name: strings.confirmar.cancelar }))
  })

  it("vermelho só no irreversível", () => {
    montar(true)
    expect(screen.getByRole("button", { name: "Eliminar canal" }).className).toContain("danger")
    cleanup()
    montar(false)
    const verbo = screen.getByRole("button", { name: "Eliminar canal" })
    expect(verbo.className).toContain("primary")
    expect(verbo.className).not.toContain("danger")
  })

  it("o verbo confirma, o Cancelar cancela", async () => {
    const user = userEvent.setup()
    const { onConfirmar, onCancelar } = montar()
    await user.click(screen.getByRole("button", { name: "Eliminar canal" }))
    expect(onConfirmar).toHaveBeenCalledOnce()
    expect(onCancelar).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: strings.confirmar.cancelar }))
    expect(onCancelar).toHaveBeenCalledOnce()
  })

  it("Escape cancela, e não confirma", async () => {
    const user = userEvent.setup()
    const { onConfirmar, onCancelar } = montar(true)
    await user.keyboard("{Escape}")
    expect(onCancelar).toHaveBeenCalledOnce()
    expect(onConfirmar).not.toHaveBeenCalled()
  })

  it("usa-se só com o teclado: Tab chega ao verbo e Enter confirma", async () => {
    const user = userEvent.setup()
    const { onConfirmar } = montar(true)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Eliminar canal" }))
    await user.keyboard("{Enter}")
    expect(onConfirmar).toHaveBeenCalledOnce()
  })

  it("sem corpo, não aponta para descrição nenhuma", () => {
    render(<Confirmar titulo="Apagar?" verbo="Apagar" onConfirmar={() => {}} onCancelar={() => {}} />)
    expect(screen.getByRole("alertdialog").hasAttribute("aria-describedby")).toBe(false)
  })
})

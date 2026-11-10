import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Button } from "./Button.js"

afterEach(cleanup)

describe("Button", () => {
  it("usa a variante como classe, verbatim", () => {
    render(<Button variant="primary">Guardar</Button>)
    expect(screen.getByRole("button").className).toBe("primary")
  })

  it("acrescenta modificadores à classe da variante", () => {
    render(
      <Button variant="ghost" className="wide join-link">
        Entrar
      </Button>,
    )
    expect(screen.getByRole("button").className).toBe("ghost wide join-link")
  })

  it("dispara onClick", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button variant="action" onClick={onClick}>
        Chamada
      </Button>,
    )
    await user.click(screen.getByRole("button"))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("respeita disabled", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button variant="primary" disabled onClick={onClick}>
        Enviar
      </Button>,
    )
    const button = screen.getByRole("button") as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await user.click(button).catch(() => {
      // user-event refuses to click disabled elements; the assertion below is
      // the part that matters.
    })
    expect(onClick).not.toHaveBeenCalled()
  })

  it("expõe title e aria-label", () => {
    render(<Button variant="ghost" title="Remover" ariaLabel="Remover">×</Button>)
    const button = screen.getByRole("button")
    expect(button.getAttribute("title")).toBe("Remover")
    expect(button.getAttribute("aria-label")).toBe("Remover")
  })
})

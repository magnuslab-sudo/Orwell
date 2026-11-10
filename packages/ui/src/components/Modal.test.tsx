import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { Modal } from "./Modal.js"

afterEach(cleanup)

function Harness({ confirmDiscard }: { confirmDiscard?: () => boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>abrir</button>
      {open && (
        <Modal
          className="sheet"
          labelledBy="modal-title"
          onClose={() => setOpen(false)}
          {...(confirmDiscard ? { confirmDiscard } : {})}
        >
          <h2 id="modal-title">Título</h2>
          <input placeholder="campo" />
          <button onClick={() => setOpen(false)}>Fechar</button>
        </Modal>
      )}
    </>
  )
}

describe("Modal", () => {
  it("abre como diálogo com o foco lá dentro", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText("abrir"))

    const dialog = screen.getByRole("dialog")
    expect(dialog.getAttribute("aria-modal")).toBe("true")
    expect(dialog.getAttribute("aria-labelledby")).toBe("modal-title")
    expect(document.activeElement).toBe(screen.getByPlaceholderText("campo"))
  })

  it("prende o Tab dentro do diálogo, nos dois sentidos", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText("abrir"))

    const field = screen.getByPlaceholderText("campo")
    const close = screen.getByText("Fechar")

    expect(document.activeElement).toBe(field)
    await user.tab()
    expect(document.activeElement).toBe(close)
    await user.tab() // wraps forward, past the "abrir" button outside
    expect(document.activeElement).toBe(field)
    await user.tab({ shift: true }) // wraps backward
    expect(document.activeElement).toBe(close)
  })

  it("fecha com Escape e devolve o foco a quem o abriu", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByText("abrir")
    await user.click(opener)
    expect(screen.getByRole("dialog")).toBeTruthy()

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it("fecha com um clique no fundo", async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness />)
    await user.click(screen.getByText("abrir"))

    const overlay = container.querySelector(".overlay")
    expect(overlay).toBeTruthy()
    fireEvent.mouseDown(overlay as Element)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("não fecha um clique dentro do cartão", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText("abrir"))

    fireEvent.mouseDown(screen.getByRole("dialog"))
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("respeita confirmDiscard: false bloqueia Escape e clique fora", async () => {
    const user = userEvent.setup()
    const confirmDiscard = vi.fn(() => false)
    const { container } = render(<Harness confirmDiscard={confirmDiscard} />)
    await user.click(screen.getByText("abrir"))

    await user.keyboard("{Escape}")
    expect(screen.getByRole("dialog")).toBeTruthy()
    fireEvent.mouseDown(container.querySelector(".overlay") as Element)
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(confirmDiscard).toHaveBeenCalledTimes(2)
  })

  it("respeita confirmDiscard: true deixa fechar", async () => {
    const user = userEvent.setup()
    render(<Harness confirmDiscard={() => true} />)
    await user.click(screen.getByText("abrir"))

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

/**
 * A key, a sheet.
 *
 * Each dialog listens for Escape on the DOCUMENT, and two listeners on the same
 * node both fire: `stopPropagation` does not block a sibling, and the one below
 * would close at the same time as the one on top. This was noted in the other
 * person's profile sheet as the reason never to stack sheets, and the reason
 * disappeared when a photo started opening large on top of an open post.
 *
 * Only the top one responds. The one below stays where it was, which is where
 * the person wants to return.
 */
describe("Modal empilhado", () => {
  function Empilhado({ aoFecharDeBaixo }: { aoFecharDeBaixo: () => void }): React.JSX.Element {
    const [cima, setCima] = useState(false)
    return (
      <Modal className="sheet" labelledBy="baixo-title" onClose={aoFecharDeBaixo}>
        <h2 id="baixo-title">De baixo</h2>
        <button onClick={() => setCima(true)}>abrir de cima</button>
        {cima && (
          <Modal className="lightbox" labelledBy="cima-title" onClose={() => setCima(false)}>
            <h2 id="cima-title">De cima</h2>
            <button onClick={() => setCima(false)}>fechar de cima</button>
            <button>segundo de cima</button>
          </Modal>
        )}
      </Modal>
    )
  }

  it("Escape fecha só o de cima; o de baixo fica", async () => {
    const user = userEvent.setup()
    const aoFecharDeBaixo = vi.fn()
    render(<Empilhado aoFecharDeBaixo={aoFecharDeBaixo} />)

    await user.click(screen.getByText("abrir de cima"))
    expect(screen.getByText("De cima")).toBeTruthy()

    await user.keyboard("{Escape}")

    expect(screen.queryByText("De cima")).toBeNull()
    expect(screen.getByText("De baixo")).toBeTruthy()
    expect(aoFecharDeBaixo).not.toHaveBeenCalled()
  })

  it("o Tab circula só no de cima: chega ao segundo botão e não volta ao de baixo", async () => {
    const user = userEvent.setup()
    render(<Empilhado aoFecharDeBaixo={vi.fn()} />)

    await user.click(screen.getByText("abrir de cima"))
    // Focus opens on the first button of the top one; Tab has to go to the second
    // and then back to the first, never falling into the buttons below.
    expect(document.activeElement).toBe(screen.getByText("fechar de cima"))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText("segundo de cima"))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText("fechar de cima"))
  })

  it("fechado o de cima, o Escape volta a ser do de baixo", async () => {
    const user = userEvent.setup()
    const aoFecharDeBaixo = vi.fn()
    render(<Empilhado aoFecharDeBaixo={aoFecharDeBaixo} />)

    await user.click(screen.getByText("abrir de cima"))
    await user.click(screen.getByText("fechar de cima"))
    await user.keyboard("{Escape}")

    expect(aoFecharDeBaixo).toHaveBeenCalledTimes(1)
  })
})

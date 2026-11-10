import { afterEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ContextMenu, type MenuItem } from "./ContextMenu.js"

afterEach(cleanup)

/**
 * The menu as it really lives: the parent unmounts it on onClose. The
 * regression this guards against — closing on the item's own mousedown, which
 * unmounted the button before its click could fire — only shows up under
 * exactly this harness; a menu that stays mounted would pass a naive test.
 */
function Harness({ items, onClosed }: { items: MenuItem[]; onClosed?: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  if (!open) return <p>fechado</p>
  return (
    <ContextMenu
      at={{ x: 10, y: 10 }}
      items={items}
      onClose={() => {
        setOpen(false)
        onClosed?.()
      }}
    />
  )
}

describe("ContextMenu", () => {
  it("clicar num item executa a acção e fecha o menu", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Harness items={[{ label: "Esquecer sala", onSelect, destructive: true }]} />)

    await user.click(screen.getByRole("menuitem", { name: "Esquecer sala" }))

    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.getByText("fechado")).toBeTruthy()
  })

  /**
   * `pointerdown`, not `mousedown`.
   *
   * Since the menu opens with a finger (long press), the dismiss cannot depend
   * on the COMPATIBILITY events the browser synthesizes after `touchend`: the
   * target of those is the line where the finger landed, outside the menu, and
   * the finger lifting dismissed the menu that just opened. It flickered and
   * vanished. `pointerdown` works the same for mouse and finger.
   */
  it("um pointerdown fora do menu fecha sem executar nada", () => {
    const onSelect = vi.fn()
    const onClosed = vi.fn()
    render(<Harness items={[{ label: "Abrir", onSelect }]} onClosed={onClosed} />)

    fireEvent.pointerDown(document.body)

    expect(onClosed).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("e um pointerdown DENTRO do menu não o fecha: o item tem de poder ser carregado", () => {
    const onClosed = vi.fn()
    render(<Harness items={[{ label: "Abrir", onSelect: () => {} }]} onClosed={onClosed} />)

    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Abrir" }))

    expect(onClosed).not.toHaveBeenCalled()
  })

  it("Escape fecha o menu", () => {
    const onClosed = vi.fn()
    render(<Harness items={[{ label: "Abrir", onSelect: () => {} }]} onClosed={onClosed} />)
    fireEvent.keyDown(window, { key: "Escape" })
    expect(onClosed).toHaveBeenCalledOnce()
  })

  describe("uma entrada com barra (o volume de uma pessoa na chamada)", () => {
    const barra = (aoMudar = vi.fn(), onSelect = vi.fn()): MenuItem[] => [
      { label: "Ver perfil", onSelect: () => {} },
      {
        label: "Volume",
        onSelect,
        deslizante: {
          valor: 100,
          min: 0,
          max: 200,
          passo: 5,
          normal: 100,
          aoMudar,
          ariaLabel: "Volume de Ana",
          textoDoValor: (valor) => `${valor} %`,
          textoRepor: "100 %",
          ariaRepor: "Repor 100 %",
        },
      },
    ]

    it("desenha um cursor com o nome da pessoa e o valor em % ao lado", () => {
      render(<Harness items={barra()} />)
      const cursor = screen.getByRole("slider", { name: "Volume de Ana" })
      expect(cursor.getAttribute("min")).toBe("0")
      expect(cursor.getAttribute("max")).toBe("200")
      expect(cursor.getAttribute("step")).toBe("5")
      expect(cursor.getAttribute("aria-valuetext")).toBe("100 %")
      expect(screen.getByText("100 %", { selector: "output" })).toBeTruthy()
    })

    it("o som muda enquanto se arrasta, e o menu não fecha", () => {
      const aoMudar = vi.fn()
      const onClosed = vi.fn()
      render(<Harness items={barra(aoMudar)} onClosed={onClosed} />)
      const cursor = screen.getByRole("slider", { name: "Volume de Ana" })

      fireEvent.pointerDown(cursor)
      fireEvent.input(cursor, { target: { value: "135" } })
      expect(aoMudar).toHaveBeenLastCalledWith(135)
      fireEvent.input(cursor, { target: { value: "160" } })
      expect(aoMudar).toHaveBeenLastCalledWith(160)
      expect(screen.getByText("160 %", { selector: "output" })).toBeTruthy()
      expect(onClosed).not.toHaveBeenCalled()
    })

    it("duplo clique no cursor repõe o normal, sem fechar o menu", () => {
      const aoMudar = vi.fn()
      const onClosed = vi.fn()
      render(<Harness items={barra(aoMudar)} onClosed={onClosed} />)
      const cursor = screen.getByRole("slider", { name: "Volume de Ana" })
      fireEvent.input(cursor, { target: { value: "40" } })
      fireEvent.doubleClick(cursor)
      expect(aoMudar).toHaveBeenLastCalledWith(100)
      expect(onClosed).not.toHaveBeenCalled()
    })

    it('o botão "100 %" repõe o normal pelo gesto da entrada, sem fechar o menu', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      const onClosed = vi.fn()
      render(<Harness items={barra(vi.fn(), onSelect)} onClosed={onClosed} />)
      await user.click(screen.getByRole("button", { name: "Repor 100 %" }))
      expect(onSelect).toHaveBeenCalledOnce()
      expect(onClosed).not.toHaveBeenCalled()
    })

    it("as setas de cima e de baixo levam o foco ao cursor, como a uma entrada", () => {
      render(<Harness items={barra()} />)
      const menu = screen.getByRole("menu")
      expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Ver perfil" }))
      fireEvent.keyDown(menu, { key: "ArrowDown" })
      expect(document.activeElement).toBe(screen.getByRole("slider", { name: "Volume de Ana" }))
      fireEvent.keyDown(menu, { key: "ArrowDown" })
      expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Ver perfil" }))
    })
  })
})

/**
 * The cascade (2/11/2026): "Move to" opens a second menu with the rooms, on the
 * right on desktop and as a sheet on mobile.
 */
describe("ContextMenu — a escada", () => {
  const larguraOriginal = window.innerWidth
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: larguraOriginal })
  })

  const comEscada = (mover = vi.fn()): MenuItem[] => [
    { label: "Ver perfil", onSelect: () => {} },
    {
      label: "Mover para",
      onSelect: () => {},
      submenu: [
        { label: "Estúdio", section: "Produção", onSelect: () => mover("estudio") },
        { label: "Régie", onSelect: () => mover("regie") },
      ],
    },
  ]

  it("as salas não estão no menu da pessoa: só a entrada que as abre", () => {
    render(<Harness items={comEscada()} />)
    expect(screen.queryByRole("menuitem", { name: "Estúdio" })).toBeNull()
    const entrada = screen.getByRole("menuitem", { name: /Mover para/ })
    expect(entrada.getAttribute("aria-haspopup")).toBe("menu")
    expect(entrada.getAttribute("aria-expanded")).toBe("false")
  })

  it("clicar abre a escada, com os letreiros das categorias, e escolher uma sala move e fecha tudo", async () => {
    const user = userEvent.setup()
    const mover = vi.fn()
    render(<Harness items={comEscada(mover)} />)
    await user.click(screen.getByRole("menuitem", { name: /Mover para/ }))

    expect(screen.getByRole("menu", { name: "Mover para" })).toBeTruthy()
    expect(screen.getByText("Produção")).toBeTruthy()
    // A click inside the cascade does not count as a click outside the menu.
    await user.click(screen.getByRole("menuitem", { name: "Régie" }))
    expect(mover).toHaveBeenCalledWith("regie")
    expect(screen.getByText("fechado")).toBeTruthy()
  })

  it("seta direita abre e leva o foco para a primeira sala; seta esquerda fecha e devolve o foco", () => {
    render(<Harness items={comEscada()} />)
    const entrada = screen.getByRole("menuitem", { name: /Mover para/ })
    entrada.focus()
    fireEvent.keyDown(entrada, { key: "ArrowRight" })
    const primeira = screen.getByRole("menuitem", { name: "Estúdio" })
    expect(document.activeElement).toBe(primeira)

    fireEvent.keyDown(primeira, { key: "ArrowDown" })
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Régie" }))

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowLeft" })
    expect(screen.queryByRole("menuitem", { name: "Estúdio" })).toBeNull()
    expect(document.activeElement).toBe(entrada)
    expect(entrada.getAttribute("aria-expanded")).toBe("false")
  })

  it('no telemóvel abre como folha, com "Voltar" à cabeça, no lugar do menu', async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 })
    const user = userEvent.setup()
    render(<Harness items={comEscada()} />)
    await user.click(screen.getByRole("menuitem", { name: /Mover para/ }))

    const folha = screen.getByRole("menu", { name: "Mover para" })
    expect(folha.className).toContain("context-folha")
    expect(screen.queryByRole("menuitem", { name: "Ver perfil" })).toBeNull()

    await user.click(screen.getByRole("menuitem", { name: /Voltar/ }))
    expect(screen.getByRole("menuitem", { name: "Ver perfil" })).toBeTruthy()
    expect(screen.queryByRole("menuitem", { name: "Estúdio" })).toBeNull()
  })
})

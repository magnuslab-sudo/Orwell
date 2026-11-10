import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useToqueLongo, type Ponto } from "./useToqueLongo.js"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/**
 * The long press, and the three things it cannot do.
 *
 * Opening the menu is the easy part. What this file pins are the three ways to
 * break it, each one a bug you see on a phone and never on a desktop:
 *
 * 1. **Cannot break scrolling.** A finger that lands on a list lands almost
 *    always to scroll it. If the menu opened mid-scroll, the list would stop
 *    scrolling.
 * 2. **Cannot exist with a mouse.** On a desktop the right button is the right
 *    button, and holding the left button does nothing.
 * 3. **Cannot swallow the next click.** A long press ends in `click`, and that
 *    click would open underneath whatever the row opens, the menu appeared and
 *    disappeared.
 */
function Linha({ aoAbrir }: { aoAbrir?: ((ponto: Ponto) => void) | undefined }): React.JSX.Element {
  const aoDedo = useToqueLongo()
  return (
    <button type="button" data-testid="linha" onClick={() => cliqueSpy()} {...aoDedo(aoAbrir)}>
      linha
    </button>
  )
}

/** The click underneath: what the row would do if the menu had not stopped it. */
let cliqueSpy: ReturnType<typeof vi.fn>

/** Says whether this device is (or is not) a touch device. jsdom does not have `matchMedia`. */
function fingirDedo(coarse: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("pointer: coarse") ? coarse : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
}

/**
 * A real pointer event, with coordinates and kind.
 *
 * By hand because jsdom does not have `PointerEvent`: `fireEvent.pointerDown`
 * falls into a generic `Event` and loses the `clientX` and `pointerType` along
 * the way, which is exactly what this hook reads. A `MouseEvent` with the name
 * of the pointer event carries the coordinates, and the kind goes on top.
 */
function ponteiro(alvo: HTMLElement, tipo: string, ponto?: { clientX: number; clientY: number }, pointerType = "touch"): void {
  const evento = new MouseEvent(tipo, { bubbles: true, cancelable: true, ...ponto })
  Object.defineProperty(evento, "pointerType", { value: pointerType })
  fireEvent(alvo, evento)
}

/** Land the finger, wait, and see. The time is fake: 500 ms without waiting 500 ms. */
function pousar(alvo: HTMLElement, ponto = { clientX: 30, clientY: 40 }, pointerType = "touch"): void {
  ponteiro(alvo, "pointerdown", ponto, pointerType)
}

function esperar(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  cliqueSpy = vi.fn()
  vi.useFakeTimers()
  fingirDedo(true)
})

describe("o toque longo abre o menu", () => {
  it("meio segundo com o dedo pousado abre o menu, no ponto onde o dedo está", () => {
    const abrir = vi.fn()
    render(<Linha aoAbrir={abrir} />)
    const linha = screen.getByTestId("linha")

    pousar(linha, { clientX: 120, clientY: 250 })
    esperar(499)
    expect(abrir).not.toHaveBeenCalled()

    esperar(1)
    expect(abrir).toHaveBeenCalledWith({ x: 120, y: 250 })
  })

  it("levantar o dedo antes do tempo não abre nada", () => {
    const abrir = vi.fn()
    render(<Linha aoAbrir={abrir} />)
    const linha = screen.getByTestId("linha")

    pousar(linha)
    esperar(300)
    ponteiro(linha, "pointerup")
    esperar(500)

    expect(abrir).not.toHaveBeenCalled()
  })
})

describe("o toque longo não estraga o deslize", () => {
  it("um dedo que se mexe cancela o relógio: a lista percorre-se", () => {
    const abrir = vi.fn()
    render(<Linha aoAbrir={abrir} />)
    const linha = screen.getByTestId("linha")

    pousar(linha, { clientX: 100, clientY: 400 })
    esperar(200)
    // A genuine slip: forty pixels up.
    ponteiro(linha, "pointermove", { clientX: 100, clientY: 360 })
    esperar(1000)

    expect(abrir).not.toHaveBeenCalled()
  })

  it("mas o tremor de uma mão não cancela nada", () => {
    const abrir = vi.fn()
    render(<Linha aoAbrir={abrir} />)
    const linha = screen.getByTestId("linha")

    pousar(linha, { clientX: 100, clientY: 400 })
    ponteiro(linha, "pointermove", { clientX: 103, clientY: 402 })
    esperar(500)

    expect(abrir).toHaveBeenCalledWith({ x: 100, y: 400 })
  })

  it("e o cancelamento do browser (que é o que um scroll dispara) também pára o relógio", () => {
    const abrir = vi.fn()
    render(<Linha aoAbrir={abrir} />)
    const linha = screen.getByTestId("linha")

    pousar(linha)
    esperar(200)
    ponteiro(linha, "pointercancel")
    esperar(1000)

    expect(abrir).not.toHaveBeenCalled()
  })
})

describe("o toque longo não existe em secretária", () => {
  it("com rato, manter o botão pousado não abre nada", () => {
    const abrir = vi.fn()
    render(<Linha aoAbrir={abrir} />)
    const linha = screen.getByTestId("linha")

    pousar(linha, { clientX: 30, clientY: 40 }, "mouse")
    esperar(1000)

    expect(abrir).not.toHaveBeenCalled()
  })

  it("num aparelho sem dedo (pointer: fine), nem sequer com um ponteiro de toque", () => {
    fingirDedo(false)
    const abrir = vi.fn()
    render(<Linha aoAbrir={abrir} />)
    const linha = screen.getByTestId("linha")

    pousar(linha)
    esperar(1000)

    expect(abrir).not.toHaveBeenCalled()
  })
})

describe("o clique que vem a seguir ao toque longo", () => {
  it("é engolido: o menu abre e a linha por baixo não faz nada", () => {
    const abrir = vi.fn()
    render(<Linha aoAbrir={abrir} />)
    const linha = screen.getByTestId("linha")

    pousar(linha)
    esperar(500)
    ponteiro(linha, "pointerup")
    fireEvent.click(linha)

    expect(abrir).toHaveBeenCalledTimes(1)
    expect(cliqueSpy).not.toHaveBeenCalled()
  })

  it("e um toque curto continua a ser um clique normal", () => {
    const abrir = vi.fn()
    render(<Linha aoAbrir={abrir} />)
    const linha = screen.getByTestId("linha")

    pousar(linha)
    esperar(100)
    ponteiro(linha, "pointerup")
    fireEvent.click(linha)

    expect(abrir).not.toHaveBeenCalled()
    expect(cliqueSpy).toHaveBeenCalledTimes(1)
  })

  it("e o clique seguinte ao clique engolido passa: engole-se um, e só um", () => {
    const abrir = vi.fn()
    render(<Linha aoAbrir={abrir} />)
    const linha = screen.getByTestId("linha")

    pousar(linha)
    esperar(500)
    ponteiro(linha, "pointerup")
    fireEvent.click(linha)
    fireEvent.click(linha)

    expect(cliqueSpy).toHaveBeenCalledTimes(1)
  })
})

describe("sem menu para abrir", () => {
  it("a linha não ganha comportamento nenhum", () => {
    render(<Linha />)
    const linha = screen.getByTestId("linha")

    pousar(linha)
    esperar(1000)
    ponteiro(linha, "pointerup")
    fireEvent.click(linha)

    // The click flows as it always has: nothing was added to this line.
    expect(cliqueSpy).toHaveBeenCalledTimes(1)
  })
})

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act, cleanup, render } from "@testing-library/react"
import { useVisualViewport } from "./useVisualViewport.js"

afterEach(() => {
  cleanup()
  document.documentElement.style.removeProperty("--teclado")
  delete (window as { visualViewport?: unknown }).visualViewport
})

/**
 * The virtual keyboard, measured.
 *
 * What plugs in here is the account and three closed gates: touch only, only where `visualViewport` exists, and nothing left behind on exit. The sheet does the rest (`movel.css`, `--teclado`), and whoever tests the result for real is the mobile script, jsdom has no keyboard to open.
 */
interface JanelaFalsa {
  height: number
  offsetTop: number
  /** The page zoom level. 1 is normal; two fingers put it above that. */
  scale: number
  addEventListener: (nome: string, ouvinte: () => void) => void
  removeEventListener: (nome: string, ouvinte: () => void) => void
  /** Fire the `resize` event, like the browser does when the keyboard enters or leaves. */
  mexer: (altura: number, deslocamento?: number, ampliacao?: number) => void
  /** How many listeners are still hanging. Zero after unmount. */
  ouvintes: number
}

function janelaFalsa(alturaInicial: number): JanelaFalsa {
  const ouvintes = new Set<() => void>()
  const falsa: JanelaFalsa = {
    height: alturaInicial,
    offsetTop: 0,
    scale: 1,
    addEventListener: (_nome, ouvinte) => void ouvintes.add(ouvinte),
    removeEventListener: (_nome, ouvinte) => void ouvintes.delete(ouvinte),
    mexer: (altura, deslocamento = 0, ampliacao = 1) => {
      falsa.height = altura
      falsa.offsetTop = deslocamento
      falsa.scale = ampliacao
      act(() => {
        for (const ouvinte of ouvintes) ouvinte()
      })
    },
    get ouvintes(): number {
      // Two events per mount (`resize` and `scroll`), but they share the SAME listener.
      return ouvintes.size
    },
  }
  return falsa
}

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

function Aplicacao(): React.JSX.Element {
  useVisualViewport()
  return <div />
}

/** What the sheet will read. Empty when the variable never existed. */
function teclado(): string {
  return document.documentElement.style.getPropertyValue("--teclado")
}

beforeEach(() => {
  fingirDedo(true)
  Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: 844 })
})

describe("com o dedo, a altura do teclado vai para a folha", () => {
  it("sem teclado é zero, e com teclado é o que ele tapa", () => {
    const janela = janelaFalsa(844)
    ;(window as { visualViewport?: unknown }).visualViewport = janela
    render(<Aplicacao />)

    expect(teclado()).toBe("0px")

    // The iPhone keyboard, around 336px on an 844-pixel screen.
    janela.mexer(508)
    expect(teclado()).toBe("336px")

    janela.mexer(844)
    expect(teclado()).toBe("0px")
  })

  it("o deslocamento da janela conta: é o que o iOS faz para levantar o campo focado", () => {
    const janela = janelaFalsa(844)
    ;(window as { visualViewport?: unknown }).visualViewport = janela
    render(<Aplicacao />)

    // Without counting `offsetTop`, this calculation gave 336 and the bar rose too far.
    janela.mexer(508, 100)
    expect(teclado()).toBe("236px")
  })

  it("nunca é negativo: uma janela maior do que a página não levanta nada", () => {
    const janela = janelaFalsa(900)
    ;(window as { visualViewport?: unknown }).visualViewport = janela
    render(<Aplicacao />)

    expect(teclado()).toBe("0px")
  })
})

/**
 * Zoom is not opening the keyboard, and the calculation cannot tell the two apart.
 *
 * With two fingers at 2x, `visualViewport` shrinks to exactly half, just like a
 * keyboard would: on an 844-pixel screen the calculation announced 420 px of
 * keyboard that does not exist, the app opened that margin at the bottom and the
 * dock rose with it. Zoom is accessibility and cannot be blocked, what we do is
 * silence the measurement while the page is zoomed.
 */
describe("com a página ampliada, a medida cala-se", () => {
  it("dois dedos a 2x não inventam um teclado", () => {
    const janela = janelaFalsa(844)
    ;(window as { visualViewport?: unknown }).visualViewport = janela
    render(<Aplicacao />)

    janela.mexer(422, 0, 2)
    expect(teclado()).toBe("0px")
  })

  it("e ao voltar a 1x a medida volta a valer", () => {
    const janela = janelaFalsa(844)
    ;(window as { visualViewport?: unknown }).visualViewport = janela
    render(<Aplicacao />)

    janela.mexer(422, 0, 2)
    expect(teclado()).toBe("0px")

    janela.mexer(508, 0, 1)
    expect(teclado()).toBe("336px")
  })

  it("uma ampliação mínima (arredondamento do motor) não conta como ampliação", () => {
    const janela = janelaFalsa(844)
    ;(window as { visualViewport?: unknown }).visualViewport = janela
    render(<Aplicacao />)

    janela.mexer(508, 0, 1.005)
    expect(teclado()).toBe("336px")
  })
})

describe("e fora do telemóvel não faz nada", () => {
  it("com rato, a variável nem chega a existir", () => {
    fingirDedo(false)
    const janela = janelaFalsa(508)
    ;(window as { visualViewport?: unknown }).visualViewport = janela
    render(<Aplicacao />)

    expect(teclado()).toBe("")
    expect(janela.ouvintes).toBe(0)
  })

  it("num motor sem visualViewport também não, e sem rebentar", () => {
    delete (window as { visualViewport?: unknown }).visualViewport
    render(<Aplicacao />)

    expect(teclado()).toBe("")
  })
})

describe("ao sair não fica nada para trás", () => {
  it("os ouvintes saem e a variável é apagada", () => {
    const janela = janelaFalsa(508)
    ;(window as { visualViewport?: unknown }).visualViewport = janela
    const { unmount } = render(<Aplicacao />)

    expect(teclado()).toBe("336px")
    expect(janela.ouvintes).toBe(1)

    unmount()

    // Without this, the app was left with a margin the size of a keyboard that no longer exists.
    expect(teclado()).toBe("")
    expect(janela.ouvintes).toBe(0)
  })
})

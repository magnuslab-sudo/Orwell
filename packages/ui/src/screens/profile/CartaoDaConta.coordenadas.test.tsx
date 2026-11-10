import { describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach } from "vitest"
import { CartaoDaConta } from "./CartaoDaConta.js"
import { ToastContext } from "../../components/Toast.js"
import { strings } from "../../strings.js"

afterEach(cleanup)

/**
 * Where the `y` coordinate comes from when a card menu opens.
 *
 * The banner sits at the bottom of the column, and the four menu buttons
 * were passing `window.innerHeight - box.top`-a distance from the BOTTOM. The
 * `ContextMenu` reads `y` from the TOP. In a 900px window with the card at 800,
 * that gave 108: the menu appeared way up top, far from the button that opened
 * it, and the formula was copied in all four places.
 *
 * No need to calculate menu offset here-the `ContextMenu` already pulls back
 * when it doesn't fit below, and that logic should live in one place.
 *
 * The test catches it: with the old formula `y` came out larger than the window
 * height minus the button top, and the assertion fails.
 */
function alturaDaJanela(px: number): void {
  Object.defineProperty(window, "innerHeight", { value: px, configurable: true, writable: true })
}

/** A button flush against the bottom, where this card lives. */
function fingirCaixa(elemento: Element, topo: number): void {
  elemento.getBoundingClientRect = () =>
    ({ left: 60, top: topo, right: 92, bottom: topo + 28, width: 32, height: 28, x: 60, y: topo }) as DOMRect
}

/** The banner mounts inside the shell, which provides the notification context. */
function comToast(no: React.JSX.Element): React.JSX.Element {
  return <ToastContext.Provider value={() => {}}>{no}</ToastContext.Provider>
}

const base = {
  profile: { displayName: "Ana", donations: [] },
  address: "@milsinda-odreto-viddyvox-pofletum:orwell.pt",
  micMuted: false,
  soundOff: false,
  onToggleMic: (): void => {},
  onToggleSound: (): void => {},
  onEditProfile: (): void => {},
  onSaveStatus: (): void => {},
}

describe("CartaoDaConta — de onde se conta o menu", () => {
  // From the banner, the menu opens on right-click in the button itself, and
  // anchors to the button box, not the cursor: it opens in the same spot every time.
  it("o menu do microfone abre no topo do botão, e não a contar do fundo", () => {
    alturaDaJanela(900)
    const onMicMenu = vi.fn()
    render(comToast(<CartaoDaConta {...base} onMicMenu={onMicMenu} />))

    const mic = screen.getByLabelText(strings.call.micAria(false))
    fingirCaixa(mic, 800)
    fireEvent.contextMenu(mic)

    expect(onMicMenu).toHaveBeenCalledWith({ x: 60, y: 800 })
  })

  it("o menu do som conta do mesmo sítio: a fórmula estava copiada nos quatro", () => {
    alturaDaJanela(900)
    const onSoundMenu = vi.fn()
    render(comToast(<CartaoDaConta {...base} onSoundMenu={onSoundMenu} />))

    const som = screen.getByLabelText(strings.call.soundAria(false))
    fingirCaixa(som, 812)
    fireEvent.contextMenu(som)

    expect(onSoundMenu).toHaveBeenCalledWith({ x: 60, y: 812 })
  })
})

/**
 * The status menu, which positions opposite to the others-and that's why it got
 * left out.
 *
 * All the buttons in this banner send the button TOP, which is what
 * `ContextMenu` reads. Three of them use `ContextMenu`; `ActivityMenu` does
 * not, and positioned itself by `bottom`. Result: the fix straightened three
 * menus and threw the fourth to the top of the window.
 *
 * The convention is now one-`y` is always the button top-and the conversion to
 * distance from the bottom lives inside `ActivityMenu`, the only one that needs
 * it. This test locks down this side: what leaves here is the top, like its
 * siblings.
 */
describe("CartaoDaConta — o menu do estado", () => {
  it("manda o topo do botão, como os outros três", () => {
    alturaDaJanela(900)
    const onActivityMenu = vi.fn()
    render(comToast(<CartaoDaConta {...base} onActivityMenu={onActivityMenu} />))

    const alvo = screen.getByRole("button", { name: new RegExp(strings.activity.title, "i") })
    fingirCaixa(alvo, 780)
    fireEvent.click(alvo)

    expect(onActivityMenu).toHaveBeenCalledWith({ x: 60, y: 780 })
  })
})

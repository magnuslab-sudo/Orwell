import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { CallChip } from "./CallChip.js"

/**
 * The visualizer at the bottom of the broadcaster's card (owner, October 27, 2026).
 * jsdom does not render or have sound: measured when the canvas exists. Rendering
 * and fps are measured in the browser, in `scripts/medir-chamada-23h.mjs`.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const musica = { id: "m", getAudioTracks: () => [], getTracks: () => [] } as unknown as MediaStream

function cartao(aTocar: string | null, fluxo: MediaStream | null = musica): React.JSX.Element {
  return <CallChip label="Ana" profile={undefined} texto="ligada" aTocar={aTocar} musica={fluxo} />
}

describe("CallChip — o visualizador de quem transmite", () => {
  it("existe só a tocar, e sai quando a música pára", () => {
    const { container, rerender } = render(cartao("Fado"))
    expect(container.querySelector("[data-visualizador] canvas")).toBeTruthy()
    rerender(cartao(null))
    expect(container.querySelector("[data-visualizador]")).toBeNull()
  })

  it("sem faixa (um cliente antigo), nem canvas nem nada", () => {
    const { container } = render(cartao("Fado", null))
    expect(container.querySelector("[data-visualizador]")).toBeNull()
  })

  it("com movimento reduzido as manchas desenham na mesma, mais suaves", () => {
    // Until October 28, 2026 it held a fixed gradient, and on Windows with animations
    // disabled the owner saw the DJ's card frozen.
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: consulta.includes("reduce"),
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    const { container } = render(cartao("Fado"))
    const fundo = container.querySelector("[data-visualizador]")
    expect(fundo?.classList.contains("suave")).toBe(true)
    expect(fundo?.querySelector("canvas")).toBeTruthy()
  })
})

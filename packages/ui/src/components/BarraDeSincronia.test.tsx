import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { BridgeContext } from "../App.js"
import type { EnclaveBridge, SincroniaDoCanal } from "../bridge.js"
import { useSincronia } from "../hooks/useSincronia.js"
import { strings } from "../strings.js"
import { BarraDeSincronia } from "./BarraDeSincronia.js"

/** The "Receiving channel…" bar (S5, §2.5): shows while the channel arrives, and disappears on its own. */

afterEach(cleanup)

const CANAL = "!lagar:s"

const aReceber: SincroniaDoCanal = {
  channel: CANAL,
  estado: "a-reparar",
  aReceber: true,
  progresso: [
    { tipo: "publicacao", recebidos: 12, esperados: 30 },
    { tipo: "comentario", recebidos: 40, esperados: 40 },
  ],
  ultimaComparacao: 1,
}
const igual: SincroniaDoCanal = { channel: CANAL, estado: "igual", aReceber: false, progresso: [], ultimaComparacao: 2 }

describe("BarraDeSincronia", () => {
  it("diz que está a receber, e o que ainda falta por tipo", () => {
    render(<BarraDeSincronia estado={aReceber} />)
    const barra = screen.getByRole("status")
    expect(barra.textContent).toContain(strings.sincronia.aReceber)
    expect(barra.textContent).toContain(strings.sincronia.parte("Publicações", 12, 30))
    // What has already arrived in full does not repeat.
    expect(barra.textContent).not.toContain("Comentários")
    const progresso = barra.querySelector("progress")!
    expect(progresso.getAttribute("max")).toBe("70")
    expect(progresso.getAttribute("value")).toBe("52")
  })

  it("não aparece fora do instantâneo", () => {
    render(<BarraDeSincronia estado={igual} />)
    expect(screen.queryByRole("status")).toBeNull()
    render(<BarraDeSincronia estado={undefined} />)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("some sozinha quando a ponte diz que o canal chegou", async () => {
    let avisar: ((estado: SincroniaDoCanal) => void) | null = null
    const bridge = {
      sincronia: { estado: async () => [aReceber], lugarEm: async () => ({ seq: 5, em: 1 }) },
      on: {
        sincronia: (handler: (estado: SincroniaDoCanal) => void) => {
          avisar = handler
          return () => {
            avisar = null
          }
        },
      },
    } as unknown as EnclaveBridge
    function Ecra(): React.JSX.Element {
      const { estado } = useSincronia(CANAL)
      return <BarraDeSincronia estado={estado} />
    }
    render(
      <BridgeContext.Provider value={bridge}>
        <Ecra />
      </BridgeContext.Provider>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole("status").textContent).toContain(strings.sincronia.aReceber)
    // An event from another channel does not affect this bar.
    await act(async () => avisar!({ ...igual, channel: "!outro:s" }))
    expect(screen.getByRole("status")).toBeTruthy()
    await act(async () => avisar!(igual))
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("sem a sincronia na ponte (um anfitrião antigo), não há barra", async () => {
    function Ecra(): React.JSX.Element {
      const { estado } = useSincronia(CANAL)
      return <BarraDeSincronia estado={estado} />
    }
    render(
      <BridgeContext.Provider value={{ on: {} } as unknown as EnclaveBridge}>
        <Ecra />
      </BridgeContext.Provider>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByRole("status")).toBeNull()
  })
})

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, waitFor } from "@testing-library/react"
import type { AvisoDeActualizacao, EnclaveBridge } from "../bridge.js"

/** The "Update available" sound arrives with the notification card (phase 4), and only with it. */

const tocar = vi.fn()
vi.mock("../sons/motor.js", () => ({ tocarSomDeActualizacao: () => tocar() }))
const { useAvisoDeVersao } = await import("./useAvisoDeVersao.js")

afterEach(() => {
  cleanup()
  tocar.mockClear()
})

function Casca({ aviso }: { aviso: AvisoDeActualizacao | null }): React.JSX.Element {
  const bridge = {
    actualizacao: { verificar: async () => aviso, dispensar: async () => ({ ok: true }), abrir: async () => ({ ok: true }) },
  } as unknown as EnclaveBridge
  const { aviso: mostrado } = useAvisoDeVersao(bridge, true)
  return <span data-testid="estado">{mostrado ? "aviso" : "nada"}</span>
}

describe("useAvisoDeVersao e o som", () => {
  it("versão nova: toca uma vez", async () => {
    const { getByTestId } = render(<Casca aviso={{ instalada: "0.9.1", disponivel: "0.9.2", nome: "Ponte" }} />)
    await waitFor(() => expect(getByTestId("estado").textContent).toBe("aviso"))
    expect(tocar).toHaveBeenCalledTimes(1)
  })

  it("tudo em dia: não toca", async () => {
    render(<Casca aviso={null} />)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(tocar).not.toHaveBeenCalled()
  })
})

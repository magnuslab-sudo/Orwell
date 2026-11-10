import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { Encontrar } from "./PeopleScreen.js"

/*
  The real QR reader asks for the camera. Here it's a button that "reads" the
  text you give it, and reports that it's mounted: that's what we measure.
*/
vi.mock("../../components/LeitorQr.js", () => ({
  LeitorQr: ({ onLido, aLer }: { onLido: (texto: string) => void; aLer?: string }) => (
    <div data-testid="leitor">
      <span>{aLer}</span>
      <button type="button" onClick={() => onLido("isto não é um link")}>
        ler-lixo
      </button>
    </div>
  ),
}))

afterEach(cleanup)

function montar(bridge: EnclaveBridge | null = null, onAbrir = vi.fn()): ReturnType<typeof vi.fn> {
  const arvore = (
    <ToastProvider>
      <Encontrar me="@me:s" onAbrir={onAbrir} />
    </ToastProvider>
  )
  render(bridge ? <BridgeContext.Provider value={bridge}>{arvore}</BridgeContext.Provider> : arvore)
  return onAbrir
}

describe("Encontrar — o leitor de QR", () => {
  it("um QR que não é link de amizade pára a câmara e diz porquê", async () => {
    const user = userEvent.setup()
    const onAbrir = montar()
    await user.click(screen.getByRole("button", { name: strings.people.scanQr }))
    expect(screen.getByTestId("leitor")).toBeTruthy()
    // The text for "Find", not for pairing.
    expect(screen.getByText(strings.people.scanning)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "ler-lixo" }))
    expect(screen.queryByTestId("leitor")).toBeNull()
    expect(screen.getByRole("alert").textContent).toBe(strings.people.pasteInvalid)
    expect(onAbrir).not.toHaveBeenCalled()
  })

  it('na aplicação instalada não há "Ler QR": só o campo de colar', () => {
    montar({ actualizacao: {} } as unknown as EnclaveBridge)
    expect(screen.queryByRole("button", { name: strings.people.scanQr })).toBeNull()
    expect(screen.getByLabelText(strings.people.pasteLabel)).toBeTruthy()
  })
})

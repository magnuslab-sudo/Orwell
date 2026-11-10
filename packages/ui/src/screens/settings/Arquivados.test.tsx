import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { ConfirmarProvider } from "../../hooks/useConfirmar.js"
import { strings } from "../../strings.js"
import { Arquivados } from "./Arquivados.js"

afterEach(cleanup)

const LAGAR = "!lagar:s"

function montar(archived: EnclaveBridge["channels"]["archived"]): { forget: ReturnType<typeof vi.fn> } {
  const forget = vi.fn(async () => ({ ok: true }))
  const bridge = {
    channels: {
      ...(archived ? { archived } : {}),
      forget,
      history: async () => [
        { seq: 1, sender: "@ana:s", at: 1, payload: { t: "message", body: "até amanhã", sentAt: 1 } },
        { seq: 2, sender: "@ana:s", at: 2, payload: { t: "friend.request", sentAt: 2 } },
      ],
    },
  } as unknown as EnclaveBridge
  render(
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <ConfirmarProvider>
          <Arquivados />
        </ConfirmarProvider>
      </ToastProvider>
    </BridgeContext.Provider>,
  )
  return { forget }
}

describe("Arquivados", () => {
  it("sem ponte que saiba, diz que não há nada", async () => {
    montar(undefined)
    expect(await screen.findByText(strings.arquivados.vazio)).toBeTruthy()
  })

  it("mostra o histórico só para ler, com o texto e sem o resto", async () => {
    const user = userEvent.setup()
    montar(async () => [{ channel: LAGAR, archivedAt: 1 }])
    await user.click(await screen.findByRole("button", { name: strings.arquivados.ver }))
    expect(await screen.findByText("até amanhã")).toBeTruthy()
    // No write box: a channel you left is not writable.
    expect(document.querySelector(".arquivados textarea, .arquivados input")).toBeNull()
  })

  it('apagar pergunta antes, e só com "Apagar" esquece o canal', async () => {
    const user = userEvent.setup()
    const { forget } = montar(async () => [{ channel: LAGAR, archivedAt: 1 }])
    await user.click(await screen.findByRole("button", { name: strings.arquivados.apagar }))
    const pergunta = await screen.findByRole("alertdialog")
    expect(forget).not.toHaveBeenCalled()
    await user.click(
      [...pergunta.querySelectorAll("button")].find((b) => b.textContent === strings.arquivados.apagar) as HTMLElement,
    )
    await vi.waitFor(() => expect(forget).toHaveBeenCalledWith(LAGAR))
    expect(await screen.findByText(strings.arquivados.vazio)).toBeTruthy()
  })
})

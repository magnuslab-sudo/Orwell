import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { SettingsScreen } from "./SettingsScreen.js"

/**
 * Delete the account when leaving channels fails.
 *
 * **The defect, reported by the owner:** "I deleted an account and it stays
 * visible in the channel". Deleting wiped the local vault and nothing else,  * the leaf stayed in the MLS tree of each channel. The fix leaves all channels
 * first, and that part is network: it can fail for no connection or the server
 * refusing.
 *
 * **The decision, and this is what these tests pin down:** when leaving fails,
 * the account is NOT deleted. This screen is the only place where a person
 * learns that, and the news cannot pass in a five-second toast: it stays on
 * screen, and the button becomes an invitation to try again.
 */

/** The refusal as the engine writes it, already in Portuguese: passes untouched
 * through `translateError`, which only translates what it knows. */
const RECUSA =
  "Não foi possível sair de 1 canal, por isso a conta não foi apagada: continuarias visível lá dentro. Verifica a ligação e tenta outra vez."

function renderComDestroy(destroy: () => Promise<{ ok: boolean }>): void {
  const bridge = { vault: { destroy } } as unknown as EnclaveBridge
  render(
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <SettingsScreen
          address="@me:casa.pt"
          connection="online"
          connectionDetail={null}
          onLock={() => {}}
          micMuted={false}
          soundOff={false}
          onToggleMic={() => {}}
          onToggleSound={() => {}}
          seccao="aparelhos"
        />
      </ToastProvider>
    </BridgeContext.Provider>,
  )
}

/** Open the confirmation sheet, write the password and press the button. */
async function pedirParaApagar(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: strings.settings.destroyAction }))
  await user.type(screen.getByLabelText(strings.settings.destroyConfirmLabel), strings.settings.destroyConfirmWord)
  await user.click(screen.getByRole("button", { name: strings.settings.destroyConfirm }))
}

let recarregou = 0

beforeEach(() => {
  recarregou = 0
  localStorage.clear()
  // A deleted account ends in a page reload, which jsdom does not implement.
  // Replacing it is what lets us verify what matters: that on failure it does NOT
  // happen.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload: () => (recarregou += 1) },
  })
})

afterEach(cleanup)

describe("apagar a conta avisa que sai primeiro dos canais", () => {
  it("diz o que vai acontecer antes de acontecer", async () => {
    const user = userEvent.setup()
    renderComDestroy(async () => ({ ok: true }))

    await user.click(screen.getByRole("button", { name: strings.settings.destroyAction }))

    // Without this, leaving channels was an invisible step: the person had no idea
    // that deleting the account depends on having network, or why.
    expect(screen.getByText(strings.settings.destroySteps)).toBeTruthy()
  })
})

describe("quando a saída falha, a conta fica de pé e o ecrã diz porquê", () => {
  it("mostra a razão, oferece tentar outra vez, e não recarrega nada", async () => {
    const user = userEvent.setup()
    const destroy = vi.fn(async () => {
      throw new Error(RECUSA)
    })
    renderComDestroy(destroy)

    await pedirParaApagar(user)

    // The reason stays on screen, and is announced: a screen reader user must hear
    // it, because what it says is that the account was NOT deleted.
    const aviso = await screen.findByRole("alert")
    expect(aviso.textContent).toBe(`Erro 900\nAconteceu um erro que a app não conhece.\n${RECUSA}`)
    // And the button stops promising what it did not do.
    expect(screen.queryByRole("button", { name: strings.settings.destroyConfirm })).toBeNull()
    expect(screen.getByRole("button", { name: strings.settings.destroyRetry })).toBeTruthy()
    expect(recarregou).toBe(0)
  })

  it("tentar outra vez volta mesmo a tentar, e a segunda vez pode correr bem", async () => {
    const user = userEvent.setup()
    let tentativas = 0
    const destroy = vi.fn(async () => {
      tentativas += 1
      if (tentativas === 1) throw new Error(RECUSA)
      return { ok: true }
    })
    renderComDestroy(destroy)

    await pedirParaApagar(user)
    await screen.findByRole("alert")

    // The written password stays written: forcing a rewrite on each network failure
    // was punishing the person for the server not responding.
    await user.click(screen.getByRole("button", { name: strings.settings.destroyRetry }))

    await waitFor(() => expect(recarregou).toBe(1))
    expect(tentativas).toBe(2)
  })

  it("com tudo a correr bem não há aviso nenhum, e a página recarrega", async () => {
    const user = userEvent.setup()
    renderComDestroy(async () => ({ ok: true }))

    await pedirParaApagar(user)

    await waitFor(() => expect(recarregou).toBe(1))
    expect(screen.queryByRole("alert")).toBeNull()
  })
})

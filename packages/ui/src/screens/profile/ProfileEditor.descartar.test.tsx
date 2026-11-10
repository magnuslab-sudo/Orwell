import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { ConfirmarProvider } from "../../hooks/useConfirmar.js"
import { strings } from "../../strings.js"
import { ProfileEditor } from "./ProfileEditor.js"

afterEach(cleanup)

/**
 * Leaving the sheet with unsaved changes asks with the home `Confirm`.
 *
 * It was a `window.confirm`, synchronous, inside the `Modal` guard. The guard
 * now accepts a promise, and that is what connects here: Escape with changes
 * opens the question, Cancel leaves the sheet where it was, Discard closes it.
 * Without changes, Escape closes right away, no question.
 */
function montar(): { onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn()
  const inicial: Profile = { displayName: "Ana", donations: [], updatedAt: 1 }
  render(
    <BridgeContext.Provider value={{} as EnclaveBridge}>
      <ConfirmarProvider>
        <ProfileEditor initial={inicial} address="@ana:casa.pt" onSaved={vi.fn()} onClose={onClose} />
      </ConfirmarProvider>
    </BridgeContext.Provider>,
  )
  return { onClose }
}

describe("ProfileEditor: descartar alterações", () => {
  it("sem alterações, Escape fecha sem perguntar", () => {
    const { onClose } = montar()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("com alterações, pergunta; Cancelar fica, Descartar fecha", async () => {
    const { onClose } = montar()
    fireEvent.change(screen.getByLabelText(strings.profileEditor.name), { target: { value: "Ana Maria" } })

    fireEvent.keyDown(document, { key: "Escape" })
    let pergunta = await screen.findByRole("alertdialog", { name: strings.profileEditor.discard })
    fireEvent.click(within(pergunta).getByRole("button", { name: strings.confirmar.cancelar }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(onClose).not.toHaveBeenCalled()
    // The sheet stays open, with what was written.
    expect((screen.getByLabelText(strings.profileEditor.name) as HTMLInputElement).value).toBe("Ana Maria")

    fireEvent.keyDown(document, { key: "Escape" })
    pergunta = await screen.findByRole("alertdialog", { name: strings.profileEditor.discard })
    fireEvent.click(within(pergunta).getByRole("button", { name: strings.confirmar.descartar }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })
})

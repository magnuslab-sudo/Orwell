import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { ConfirmarProvider } from "../../hooks/useConfirmar.js"
import { strings } from "../../strings.js"
import { en } from "../../linguas/en.js"
import { pt } from "../../linguas/pt.js"
import { ProfileEditor } from "./ProfileEditor.js"

/**
 * "Bio", not "About you" (requested by the owner on October 27, 2026).
 *
 * Bio already existed, separate from status; what changes is the name and the
 * sentence that tells the difference between the two.
 */
afterEach(cleanup)

describe("ProfileEditor: a biografia", () => {
  it('chama-se "Biografia" / "Bio" e diz a diferença para o estado', () => {
    expect(pt.profileEditor.bio).toBe("Biografia")
    expect(en.profileEditor?.bio).toBe("Bio")
    expect(pt.profileEditor.bioNote).toBe("Quem és, em poucas linhas. O estado é o que estás a fazer agora.")
  })

  it("o campo tem o rótulo, o que já lá estava, e a frase de ajuda por baixo", () => {
    const inicial: Profile = { displayName: "Ana", donations: [], bio: "faz fotografia", statusText: "por aí", updatedAt: 1 }
    render(
      <BridgeContext.Provider value={{} as EnclaveBridge}>
        <ConfirmarProvider>
          <ProfileEditor initial={inicial} address="@ana:casa.pt" onSaved={vi.fn()} onClose={vi.fn()} />
        </ConfirmarProvider>
      </BridgeContext.Provider>,
    )
    const campo = screen.getByLabelText(strings.profileEditor.bio) as HTMLTextAreaElement
    expect(campo.value).toBe("faz fotografia")
    expect(screen.getByText(strings.profileEditor.bioNote)).toBeTruthy()
  })
})

/**
 * "Status is not edited in the profile, it is edited in the card" (owner's
 * order on October 27, 2026). The field goes away; the text that was already
 * there is not lost.
 */
describe("ProfileEditor: sem o campo do estado", () => {
  it('não desenha o campo "Estado", e gravar guarda o estado que já lá estava', async () => {
    const inicial: Profile = { displayName: "Ana", donations: [], bio: "faz fotografia", statusText: "por aí", updatedAt: 1 }
    const set = vi.fn().mockResolvedValue(undefined)
    render(
      <BridgeContext.Provider value={{ profile: { set }, social: {} } as unknown as EnclaveBridge}>
        <ConfirmarProvider>
          <ProfileEditor initial={inicial} address="@ana:casa.pt" onSaved={vi.fn()} onClose={vi.fn()} />
        </ConfirmarProvider>
      </BridgeContext.Provider>,
    )
    expect(screen.queryByLabelText("Estado")).toBeNull()
    expect(screen.queryByDisplayValue("por aí")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: strings.profileEditor.save }))
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1))
    expect(set.mock.calls[0]?.[0]).toMatchObject({ statusText: "por aí", bio: "faz fotografia" })
  })
})

describe("ProfileEditor: o id no rodapé", () => {
  it('não se lê; fica o botão "Copiar o teu id"', () => {
    render(
      <BridgeContext.Provider value={{ social: {} } as unknown as EnclaveBridge}>
        <ConfirmarProvider>
          <ProfileEditor initial={{ displayName: "Ana", donations: [] }} address="@ana:casa.pt" onSaved={vi.fn()} onClose={vi.fn()} />
        </ConfirmarProvider>
      </BridgeContext.Provider>,
    )
    expect(document.body.textContent).not.toContain("@ana:casa.pt")
    expect(screen.getByRole("button", { name: strings.copiarId.proprio })).toBeTruthy()
  })
})

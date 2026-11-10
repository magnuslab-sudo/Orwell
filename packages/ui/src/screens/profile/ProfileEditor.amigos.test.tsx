import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { ConfirmarProvider } from "../../hooks/useConfirmar.js"
import { strings } from "../../strings.js"
import { ProfileEditor } from "./ProfileEditor.js"

afterEach(cleanup)

/**
 * "Show my friends list to my friends": off by default, chosen per person,
 * and saved with `setShownFriends` only when it changes.
 */
const AMIGOS = [
  { address: "@rui:s", nome: "Rui" },
  { address: "@zoe:s", nome: "Zoé" },
]

function montar(mostrada: string[] | null = null, falhaALista = false) {
  const social = {
    shownFriendsOf: vi.fn(async () => (mostrada ? { shown: mostrada, updatedAt: 1 } : null)),
    setShownFriends: vi.fn(async () => {
      if (falhaALista) throw new Error("your feed has people who are not friends")
      return { ok: true }
    }),
  }
  const profile = { set: vi.fn(async () => ({ ok: true })) }
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const inicial: Profile = { displayName: "Ana", donations: [] }
  render(
    <BridgeContext.Provider value={{ social, profile } as unknown as EnclaveBridge}>
      <ConfirmarProvider>
        <ProfileEditor initial={inicial} address="@ana:s" onSaved={onSaved} onClose={onClose} amigos={AMIGOS} />
      </ConfirmarProvider>
    </BridgeContext.Provider>,
  )
  return { social, profile, onClose, onSaved }
}

describe("ProfileEditor: a lista de amigos no perfil", () => {
  it("vem desligado, e sem escolha por pessoa à vista", async () => {
    const { social } = montar()
    await waitFor(() => expect(social.shownFriendsOf).toHaveBeenCalledWith("@ana:s"))
    const interruptor = await screen.findByRole("switch", { name: strings.profileEditor.showFriends })
    await waitFor(() => expect((interruptor as HTMLButtonElement).disabled).toBe(false))
    expect(interruptor.getAttribute("aria-checked")).toBe("false")
    expect(screen.queryByRole("list", { name: strings.profileEditor.showFriendsWho })).toBeNull()
  })

  it("ligar escolhe todos; desligar um tira-o; guardar manda a lista escolhida", async () => {
    const user = userEvent.setup()
    const { social, profile, onClose } = montar()
    const interruptor = await screen.findByRole("switch", { name: strings.profileEditor.showFriends })
    await waitFor(() => expect((interruptor as HTMLButtonElement).disabled).toBe(false))
    await user.click(interruptor)
    const lista = screen.getByRole("list", { name: strings.profileEditor.showFriendsWho })
    await user.click(within(lista).getByRole("switch", { name: "Zoé" }))
    await user.click(screen.getByRole("button", { name: strings.profileEditor.save }))
    await waitFor(() => expect(social.setShownFriends).toHaveBeenCalledWith(["@rui:s"]))
    expect(profile.set).toHaveBeenCalled()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it("sem mudança na lista, guardar não manda lista nenhuma", async () => {
    const user = userEvent.setup()
    const { social, profile } = montar(["@rui:s"])
    const interruptor = await screen.findByRole("switch", { name: strings.profileEditor.showFriends })
    await waitFor(() => expect(interruptor.getAttribute("aria-checked")).toBe("true"))
    await user.click(screen.getByRole("button", { name: strings.profileEditor.save }))
    await waitFor(() => expect(profile.set).toHaveBeenCalled())
    expect(social.setShownFriends).not.toHaveBeenCalled()
  })
})

describe("ProfileEditor: a lista que falha e a ordem", () => {
  it("a lista falha (607): o perfil fica gravado, o erro aparece, e a folha não fecha", async () => {
    const user = userEvent.setup()
    const { onSaved, onClose } = montar(null, true)
    const interruptor = await screen.findByRole("switch", { name: strings.profileEditor.showFriends })
    await waitFor(() => expect((interruptor as HTMLButtonElement).disabled).toBe(false))
    await user.click(interruptor)
    await user.click(screen.getByRole("button", { name: strings.profileEditor.save }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(await screen.findByText(/não são amigas/)).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("a mesma lista por outra ordem não é mudança", async () => {
    const user = userEvent.setup()
    const { social, profile } = montar(["@zoe:s", "@rui:s"])
    const interruptor = await screen.findByRole("switch", { name: strings.profileEditor.showFriends })
    await waitFor(() => expect(interruptor.getAttribute("aria-checked")).toBe("true"))
    const lista = screen.getByRole("list", { name: strings.profileEditor.showFriendsWho })
    // Turning Rui off and back on puts him at the end: same list, different order.
    await user.click(within(lista).getByRole("switch", { name: "Rui" }))
    await user.click(within(lista).getByRole("switch", { name: "Rui" }))
    await user.click(screen.getByRole("button", { name: strings.profileEditor.save }))
    await waitFor(() => expect(profile.set).toHaveBeenCalled())
    expect(social.setShownFriends).not.toHaveBeenCalled()
  })
})

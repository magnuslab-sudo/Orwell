import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "../../bridge.js"
import { BridgeContext } from "../../App.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { en } from "../../linguas/en.js"
import { pt } from "../../linguas/pt.js"
import { ProfileScreen, type CanalFundado } from "./ProfileScreen.js"

afterEach(cleanup)

/**
 * "Channels I founded", on your own profile (owner's request, October 27, 2026).
 * Another person's profile does not show it: `PersonProfile` does not receive
 * the list, and `ProfileBody` only draws it through the slot that you fill.
 */
function mount(extra: { canaisFundados?: readonly CanalFundado[]; onAbrirCanal?: (canal: string) => void } = {}): void {
  render(
    <BridgeContext.Provider value={{ social: {} } as unknown as EnclaveBridge}>
      <ToastProvider>
        <ProfileScreen
          profile={{ displayName: "Eu", donations: [] }}
          address="@me:s"
          posts={[]}
          messages={[]}
          directory={new Map()}
          nameFor={(sender) => sender}
          onCompose={() => {}}
          onEdit={() => {}}
          connection="online"
          connectionDetail={null}
          {...extra}
        />
      </ToastProvider>
    </BridgeContext.Provider>,
  )
}

describe("ProfileScreen: Canais que fundei", () => {
  it("as palavras, nas duas línguas", () => {
    expect(pt.profile.foundedTitle).toBe("Canais que fundei")
    expect(pt.profile.foundedEmpty).toBe("Ainda não fundaste nenhum canal.")
    expect(en.profile?.foundedTitle).toBe("Channels I founded")
  })

  it("lista cada canal com o ícone e o nome, e um clique abre-o", async () => {
    const user = userEvent.setup()
    const onAbrirCanal = vi.fn()
    mount({
      canaisFundados: [
        { canal: "!fotos:s", nome: "Fotografia" },
        { canal: "!livros:s", nome: "Livros", icone: "data:image/png;base64,AAAA" },
      ],
      onAbrirCanal,
    })
    const seccao = screen.getByRole("region", { name: strings.profile.foundedTitle })
    const botoes = within(seccao).getAllByRole("button")
    expect(botoes.map((botao) => botao.textContent)).toEqual(["FFotografia", "Livros"])
    expect(seccao.querySelectorAll(".room-icon")).toHaveLength(2)
    await user.click(within(seccao).getByRole("button", { name: strings.profile.foundedOpen("Livros") }))
    expect(onAbrirCanal).toHaveBeenCalledWith("!livros:s")
  })

  it("vazia, diz que está vazia", () => {
    mount({ canaisFundados: [], onAbrirCanal: vi.fn() })
    const seccao = screen.getByRole("region", { name: strings.profile.foundedTitle })
    expect(within(seccao).getByText(strings.profile.foundedEmpty)).toBeTruthy()
    expect(within(seccao).queryByRole("button")).toBeNull()
  })

  it("sem a lista (uma ponte sem `founder`), a secção não se desenha", () => {
    mount()
    expect(screen.queryByText(strings.profile.foundedTitle)).toBeNull()
  })
})

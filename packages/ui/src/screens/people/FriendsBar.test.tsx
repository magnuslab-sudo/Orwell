import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { strings } from "../../strings.js"
import { FriendsBar, PEOPLE_TABS } from "./FriendsBar.js"

afterEach(cleanup)

function mount(over: Partial<React.ComponentProps<typeof FriendsBar>> = {}): {
  onTab: ReturnType<typeof vi.fn>
  onOpenConversas: ReturnType<typeof vi.fn>
  container: HTMLElement
} {
  const onTab = vi.fn()
  const onOpenConversas = vi.fn()
  const { container } = render(
    <FriendsBar
      tab="amigos"
      onTab={onTab}
      pending={0}
      temConversas={true}
      onOpenConversas={onOpenConversas}
      {...over}
    />,
  )
  return { onTab, onOpenConversas, container }
}

describe("a faixa superior de Amigos", () => {
  it("tem os quatro separadores, e diz qual está aceso", () => {
    mount({ tab: "recebidos" })
    for (const nome of PEOPLE_TABS) {
      expect(screen.getByRole("button", { name: new RegExp(strings.people.tab[nome]) })).toBeTruthy()
    }
    expect(screen.getByRole("button", { current: "page" }).textContent).toContain(strings.people.tab.recebidos)
  })

  it("escolher um separador devolve-o", async () => {
    const user = userEvent.setup()
    const { onTab } = mount()
    await user.click(screen.getByRole("button", { name: strings.people.tab.encontrar }))
    expect(onTab).toHaveBeenCalledExactlyOnceWith("encontrar")
  })

  /**
   * The counter is what holds the whole change together.
   *
   * Requests left the body of the screen, where they stacked on top of
   * everything else. They can only leave because this number tells you how many
   * are waiting without going to look, and because it stays in view even with
   * a chat open.
   */
  it("conta os pedidos à espera, e diz por palavras quantos são", () => {
    mount({ pending: 2 })
    expect(screen.getByText("2")).toBeTruthy()
    expect(screen.getByLabelText(strings.people.pendingCount(2))).toBeTruthy()
  })

  it("um pedido só fala no singular", () => {
    mount({ pending: 1 })
    expect(screen.getByLabelText(strings.people.pendingCount(1))).toBeTruthy()
    expect(strings.people.pendingCount(1)).toContain("1 pedido à espera")
  })

  it("zero não desenha contador nenhum: um zero é ruído a ocupar o lugar de uma informação", () => {
    const { container } = render(
      <FriendsBar tab="amigos" onTab={vi.fn()} pending={0} temConversas={true} onOpenConversas={vi.fn()} />,
    )
    expect(container.querySelector(".people-tab-count")).toBeNull()
  })

  it("acima de 99 o contador não estica a faixa", () => {
    mount({ pending: 140 })
    expect(screen.getByText("99+")).toBeTruthy()
  })

  it("o contador vive só em Recebidos: Enviados não pede nada a ninguém", () => {
    const { container } = mount({ pending: 3 })
    const contadores = container.querySelectorAll(".people-tab-count")
    expect(contadores.length).toBe(1)
    expect(contadores[0]?.closest("button")?.textContent).toContain(strings.people.tab.recebidos)
  })

  it("o título diz quantos amigos há", () => {
    mount({ amigos: 4 })
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(strings.people.titleCount(4))
    expect(strings.people.titleCount(4)).toBe("Amigos (4)")
  })

  it("diz que a lista não vive em servidor nenhum", () => {
    mount()
    expect(screen.getByTitle(strings.people.sealedTitle)).toBeTruthy()
  })
})

/**
 * The active tab is a statement about the screen body, and with a chat in front
 * the body is no longer the tab's.
 *
 * The `conversaAberta` prop was declared and documented but never used: "Add"
 * stayed active over an open chat. These two tests are what was missing so the
 * bug cannot come back. `PeopleDestination` can stop delivering the flag, but
 * the band cannot ignore it anymore.
 */
describe("o separador aceso e a conversa à frente", () => {
  it("com uma conversa aberta nenhum separador fica aceso: diria que o corpo mostra o que não mostra", () => {
    const { container } = mount({ tab: "encontrar", conversaAberta: true })
    expect(container.querySelectorAll(".people-tab").length).toBe(PEOPLE_TABS.length)
    expect(container.querySelector(".people-tab.active")).toBeNull()
    // The screen reader hears what the eyes see, not the other way around.
    expect(screen.queryByRole("button", { current: "page" })).toBeNull()
  })

  it("fechada a conversa, o separador escolhido acende — aos olhos e ao leitor de ecrã", () => {
    const { container } = mount({ tab: "encontrar", conversaAberta: false })
    const acesos = container.querySelectorAll(".people-tab.active")
    expect(acesos.length).toBe(1)
    expect(acesos[0]?.textContent).toContain(strings.people.tab.encontrar)
    expect(screen.getByRole("button", { current: "page" }).textContent).toContain(
      strings.people.tab.encontrar,
    )
  })
})

describe("a pega das conversas", () => {
  it("abre a lista, e existe só quando há lista para abrir", async () => {
    const user = userEvent.setup()
    const { onOpenConversas } = mount()
    await user.click(screen.getByRole("button", { name: strings.people.backToList }))
    expect(onOpenConversas).toHaveBeenCalledOnce()
  })

  it("sem conversas não há pega: abriria uma gaveta sobre uma frase a dizer que está vazia", () => {
    mount({ temConversas: false })
    expect(screen.queryByRole("button", { name: strings.people.backToList })).toBeNull()
  })
})

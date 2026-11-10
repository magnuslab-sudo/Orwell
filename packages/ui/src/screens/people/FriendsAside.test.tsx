import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Profile } from "../../bridge.js"
import type { DirectEntry } from "../../lib/directs.js"
import { strings } from "../../strings.js"
import { FriendsAside } from "./FriendsAside.js"
import { moradaDeTeste } from "../../../testes/moradas.js"

afterEach(cleanup)

const ANA = "@ana:s"
const CONVERSA_DA_ANA = moradaDeTeste("directa me ana", "s")
const CONVERSA_DO_BRUNO = moradaDeTeste("directa me bruno", "s")

const directory = new Map<string, Profile>([[ANA, { displayName: "Ana", donations: [] }]])

function entrada(over: Partial<DirectEntry> = {}): DirectEntry {
  return {
    channel: CONVERSA_DA_ANA,
    peer: ANA,
    lastAt: 10,
    preview: "até amanhã",
    minha: false,
    pedido: false,
    ...over,
  }
}

function mount(over: Partial<React.ComponentProps<typeof FriendsAside>> = {}): {
  onOpen: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
  onConversaMenu: ReturnType<typeof vi.fn>
} {
  const onOpen = vi.fn()
  const onClose = vi.fn()
  const onConversaMenu = vi.fn()
  render(
    <FriendsAside
      directs={[entrada()]}
      active={null}
      unreads={new Map()}
      directory={directory}
      nameFor={(address) => (address === ANA ? "Ana" : address)}
      onOpen={onOpen}
      onClose={onClose}
      onConversaMenu={onConversaMenu}
      {...over}
    />,
  )
  return { onOpen, onClose, onConversaMenu }
}

describe("a coluna das conversas", () => {
  it("lista a pessoa e o começo do que se disse", () => {
    mount()
    expect(screen.getByText("Ana")).toBeTruthy()
    expect(screen.getByText("até amanhã")).toBeTruthy()
  })

  it("não tem separadores: esses vivem na faixa superior", () => {
    // A column that is both list and menu must choose what it is. What we ask
    // of this one is that it reads at a glance, so you can jump from chat to chat.
    mount()
    expect(screen.queryByRole("navigation", { name: strings.people.tabsLabel })).toBeNull()
    for (const rotulo of Object.values(strings.people.tab)) {
      expect(screen.queryByRole("button", { name: rotulo })).toBeNull()
    }
  })

  it("abrir devolve o canal, e a conversa aberta diz que o é", async () => {
    const user = userEvent.setup()
    const { onOpen } = mount({ active: CONVERSA_DA_ANA })
    const linha = screen.getByRole("button", { current: "page" })
    await user.click(linha)
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(CONVERSA_DA_ANA)
  })

  it("fechar devolve o canal, e é um caminho à parte de abrir", async () => {
    const user = userEvent.setup()
    const { onOpen, onClose } = mount()
    await user.click(screen.getByRole("button", { name: `${strings.people.directClose} — Ana` }))
    expect(onClose).toHaveBeenCalledExactlyOnceWith(CONVERSA_DA_ANA)
    // Closing cannot open the chat you're dismissing.
    expect(onOpen).not.toHaveBeenCalled()
  })

  it("não tem nota fixa sobre fechar: quem o diz é o aviso, ao fechar (App)", () => {
    mount()
    expect(document.querySelector(".people-directs-hint")).toBeNull()
    cleanup()
    mount({ directs: [] })
    expect(screen.getByText(strings.people.directsEmpty)).toBeTruthy()
  })

  it("por ler mostra a conta, e nunca a esconde por baixo do botão de fechar", () => {
    const { container } = render(
      <FriendsAside
        directs={[entrada()]}
        active={null}
        unreads={new Map([[CONVERSA_DA_ANA, 3]])}
        directory={directory}
        nameFor={() => "Ana"}
        onOpen={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(strings.people.directUnread(3))).toBeTruthy()
    // The account lives INSIDE the drawer handle; the close button is its sibling
    // and cannot cover it. See the note in the CSS for `.direct-close`.
    expect(container.querySelector(".direct-open .direct-unread")).toBeTruthy()
    expect(container.querySelector(".direct-row.unread")).toBeTruthy()
  })

  it("acima de 99 por ler a conta não estica a coluna", () => {
    render(
      <FriendsAside
        directs={[entrada()]}
        active={null}
        unreads={new Map([[CONVERSA_DA_ANA, 250]])}
        directory={directory}
        nameFor={() => "Ana"}
        onOpen={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText("99+")).toBeTruthy()
  })

  it("sem outra pessoa reconhecível, a linha desenha-se pelo canal em vez de rebentar", () => {
    mount({ directs: [entrada({ peer: null, preview: "" })] })
    // "Unnamed", not a piece of the identifier (IDs have not been shown since
    // October 27, 2026): a line drawn instead of a blank screen. Happens with an
    // identifier that cannot be read, or before the account loads.
    expect(screen.getByText(strings.profile.noName)).toBeTruthy()
  })
})

/**
 * The footer of the column.
 *
 * This column became the Friends sidebar, and inherited the account card with
 * it: the channels bar no longer draws there, and the bell and "how you appear"
 * live nowhere else in the app. Passed in as a node so the column doesn't need
 * to know what an unread notification is.
 */
describe("a coluna das conversas — o pé", () => {
  it("o rodapé desenha-se depois da lista, e dentro da coluna", () => {
    const { container } = render(
      <FriendsAside
        directs={[entrada()]}
        active={null}
        unreads={new Map()}
        directory={directory}
        nameFor={() => "Ana"}
        onOpen={vi.fn()}
        onClose={vi.fn()}
        rodape={<div className="cartao-de-teste" />}
      />,
    )
    const coluna = container.querySelector(".people-aside")
    expect(coluna?.querySelector(".cartao-de-teste")).toBeTruthy()
    // After the list, not before: it's a footer, and the list fills what's left.
    const lista = coluna?.querySelector(".people-directs")
    expect(lista?.nextElementSibling?.classList.contains("cartao-de-teste")).toBe(true)
  })

  it("sem rodapé a coluna continua a ser a lista, e mais nada", () => {
    // Absent means no footer at all, never an empty box taking up the bottom.
    const { container } = render(
      <FriendsAside
        directs={[entrada()]}
        active={null}
        unreads={new Map()}
        directory={directory}
        nameFor={() => "Ana"}
        onOpen={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(container.querySelector(".people-aside")?.children).toHaveLength(1)
  })
})

describe("o menu de botão direito de uma conversa", () => {
  it("dá o canal e a posição do cursor", async () => {
    const user = userEvent.setup()
    const { onConversaMenu } = mount()
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Ana") })
    expect(onConversaMenu).toHaveBeenCalledOnce()
    expect(onConversaMenu.mock.calls[0]?.[0]).toBe(CONVERSA_DA_ANA)
    expect(onConversaMenu.mock.calls[0]?.[1]).toMatchObject({ x: expect.any(Number), y: expect.any(Number) })
  })

  /**
   * The menu listens on the ROW, not the drawer handle.
   *
   * The row has two buttons, and the close button occupies the corner where
   * the hand hits with the right button. Listening only on the handle, right
   * click on the close button fell into the browser menu. The app menu appeared
   * almost everywhere on the row and was missing exactly where the cursor was.
   */
  it("também abre com o cursor sobre o botão de fechar", async () => {
    const user = userEvent.setup()
    const { onConversaMenu } = mount()
    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: `${strings.people.directClose} — Ana` }),
    })
    expect(onConversaMenu).toHaveBeenCalledExactlyOnceWith(CONVERSA_DA_ANA, {
      x: expect.any(Number),
      y: expect.any(Number),
    })
  })

  it("sem quem o escute, o botão direito não é interceptado", async () => {
    const user = userEvent.setup()
    render(
      <FriendsAside
        directs={[entrada()]}
        active={null}
        unreads={new Map()}
        directory={directory}
        nameFor={() => "Ana"}
        onOpen={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    // There's nothing to assert beyond not breaking: with no one handling the menu,
    // the gesture stays the browser's.
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Ana") })
    expect(screen.getByText("Ana")).toBeTruthy()
  })
})

describe("a gaveta, em ecrã estreito", () => {
  it("fechada por omissão, e aberta quando se pede", () => {
    const { container } = render(
      <FriendsAside
        directs={[entrada()]}
        active={null}
        unreads={new Map()}
        directory={directory}
        nameFor={() => "Ana"}
        onOpen={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(container.querySelector(".people-aside.open")).toBeNull()
    cleanup()
    mount({ aberta: true })
    expect(document.querySelector(".people-aside.open")).toBeTruthy()
  })

  it("com duas conversas, cada uma abre a sua", async () => {
    const user = userEvent.setup()
    const { onOpen } = mount({
      directs: [entrada(), entrada({ channel: CONVERSA_DO_BRUNO, peer: "@bruno:s", preview: "vemo-nos" })],
    })
    await user.click(screen.getByText("vemo-nos"))
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(CONVERSA_DO_BRUNO)
  })
})

/** The avatar ring for each chat: color by state, pulsing only on call. */
describe("FriendsAside — o anel de presença", () => {
  it("parado sem chamada, a pulsar com ela, na cor do estado", () => {
    mount({ presenceFor: () => "busy" })
    const parado = document.querySelector<HTMLElement>(".direct-list [data-anel]")!
    expect(parado.dataset["anel"]).toBe("ocupado")
    expect(parado.hasAttribute("data-em-chamada")).toBe(false)
    cleanup()

    mount({ presenceFor: () => "active", emChamada: (address) => address === ANA })
    const aPulsar = document.querySelector<HTMLElement>(".direct-list [data-anel]")!
    expect(aPulsar.dataset["anel"]).toBe("online")
    expect(aPulsar.hasAttribute("data-em-chamada")).toBe(true)
  })
})

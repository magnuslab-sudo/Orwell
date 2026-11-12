import { moradaDeTeste } from "../../../testes/moradas.js"
import { lembrarFichasDosCanais } from "../../lib/tipoDoCanal.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ChannelRoom, Profile } from "../../bridge.js"
import { ToastContext } from "../../components/Toast.js"
import { readCollapsed } from "../../hooks/usePrefs.js"
import type { RoomGroup } from "../../hooks/useRooms.js"
import { strings } from "../../strings.js"
import { seccoes } from "../settings/seccoes.js"
import { ChannelSidebar } from "./ChannelSidebar.js"

const DM_9B21 = moradaDeTeste("directa 9b21", "s")
const DM_ANA = moradaDeTeste("directa ana", "s")
// The sheet for each channel (1.0 "Arca", slice 6b): no sheet, a channel is a room.
beforeEach(() => lembrarFichasDosCanais({ [DM_9B21]: { tipo: "directa" }, [DM_ANA]: { tipo: "directa" } }))

afterEach(cleanup)
beforeEach(() => localStorage.clear())

const noop = (): void => {}

function sidebar(overrides: Partial<React.ComponentProps<typeof ChannelSidebar>>): React.JSX.Element {
  return (
    <ToastContext.Provider value={noop}>
      <ChannelSidebar
        view="chat"
        rooms={["!geral:s"]}
        labelFor={(channel) => channel.replace(/^!/, "").split(":")[0] ?? channel}
        active="!geral:s"
        callChannel={null}
        ringing={new Map()}
        unreads={new Map()}
        profile={{ displayName: "Eu", donations: [] } as unknown as Profile}
        address="@abc:s"
        connection="online"
        open={false}
        onClose={noop}
        onSelectChannel={noop}
        onChannelMenu={noop}
        onCompose={noop}
        onEditProfile={noop}
        onPrompt={noop}
        onSaveStatus={noop}
        {...overrides}
      />
    </ToastContext.Provider>
  )
}

describe("ChannelSidebar como gaveta (ecrãs estreitos)", () => {
  it("fechada é uma coluna normal, sem semântica de diálogo", () => {
    const { container } = render(sidebar({ open: false }))
    const aside = container.querySelector("aside.sidebar")
    expect(aside).toBeTruthy()
    expect(aside?.classList.contains("open")).toBe(false)
    expect(aside?.getAttribute("role")).toBeNull()
  })

  it("abrir e fechar alterna a classe e a semântica de diálogo", () => {
    const { container, rerender } = render(sidebar({ open: false }))
    rerender(sidebar({ open: true }))
    const aside = container.querySelector("aside.sidebar")
    expect(aside?.classList.contains("open")).toBe(true)
    expect(aside?.getAttribute("role")).toBe("dialog")
    expect(aside?.getAttribute("aria-label")).toBe(strings.sidebar.drawerLabel)

    rerender(sidebar({ open: false }))
    expect(aside?.classList.contains("open")).toBe(false)
    expect(aside?.getAttribute("role")).toBeNull()
  })

  it("aberta, Escape chama onClose; fechada, não", () => {
    const onClose = vi.fn()
    const { rerender } = render(sidebar({ open: false, onClose }))
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).not.toHaveBeenCalled()

    rerender(sidebar({ open: true, onClose }))
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("aberta, o foco entra na gaveta", () => {
    const { container, rerender } = render(sidebar({ open: false }))
    rerender(sidebar({ open: true }))
    const aside = container.querySelector("aside.sidebar")
    expect(aside?.contains(document.activeElement)).toBe(true)
  })

  it("escolher uma sala continua a funcionar dentro da gaveta", async () => {
    const user = userEvent.setup()
    const onSelectChannel = vi.fn()
    const { getByText } = render(sidebar({ open: true, onSelectChannel }))
    await user.click(getByText("geral"))
    expect(onSelectChannel).toHaveBeenCalledWith("!geral:s")
  })
})

/* ------------------------------------------------- the list with lots of stuff */

/**
 * A populated tree, not two channels.
 *
 * What looks fine with two looks different with ten: categories, text and voice channels, long and accented names. This is what the design is judged against, and this is what the tests below set up.
 */
function sala(over: Partial<ChannelRoom> & { room: string; name: string }): ChannelRoom {
  return { category: "", kind: "text", position: 0, ...over }
}

function arvore(): RoomGroup[] {
  return [
    { category: "", rooms: [sala({ room: "", name: "geral", position: -1 })] },
    {
      category: "Início",
      rooms: [
        sala({ room: "r1", name: "avisos", category: "Início" }),
        sala({ room: "r2", name: "apresentações", category: "Início", position: 1 }),
      ],
    },
    {
      category: "Produção — vídeo e fotografia",
      rooms: [
        sala({ room: "r3", name: "combinações-de-cor-e-tipografia", category: "Produção — vídeo e fotografia" }),
        sala({ room: "v1", name: "Estúdio", category: "Produção — vídeo e fotografia", kind: "voice", position: 1 }),
        // Two voice rooms, not one: with just one there's nowhere to move anyone, and half of what we test here is the gesture of moving.
        sala({ room: "v2", name: "Régie", category: "Produção — vídeo e fotografia", kind: "voice", position: 2 }),
      ],
    },
  ]
}

const presentes = [
  { address: "@ana:s", name: "Ana Rita" },
  { address: "@bru:s", name: "Bruno" },
]

function povoada(overrides: Partial<React.ComponentProps<typeof ChannelSidebar>> = {}): React.JSX.Element {
  return sidebar({
    roomGroups: arvore(),
    activeRoom: "",
    onSelectRoom: noop,
    voicePresence: (room) => (room === "v1" ? presentes : []),
    ...overrides,
  })
}

describe("ChannelSidebar com a lista povoada", () => {
  it("desenha categorias, canais de texto e canais de voz", () => {
    const { getByText } = render(povoada())
    expect(getByText("Início")).toBeTruthy()
    expect(getByText("avisos")).toBeTruthy()
    expect(getByText("Estúdio")).toBeTruthy()
  })

  it("um canal só com a sala por omissão não ganha árvore nenhuma", () => {
    const { container } = render(
      povoada({ roomGroups: [{ category: "", rooms: [sala({ room: "", name: "geral", position: -1 })] }] }),
    )
    expect(container.querySelector(".room-tree")).toBeNull()
  })

  it("minimizar uma categoria esconde as salas e diz quantas lá ficaram", async () => {
    const user = userEvent.setup()
    const { container, getByRole, queryByText } = render(povoada())
    expect(queryByText("avisos")).toBeTruthy()

    await user.click(getByRole("button", { name: "Início" }))
    expect(queryByText("avisos")).toBeNull()
    expect(queryByText("apresentações")).toBeNull()
    // Minimizing can't give the impression that something was lost.
    expect(container.querySelector(".category-toggle .room-count")?.textContent).toBe("2")

    await user.click(getByRole("button", { name: /salas escondidas/ }))
    expect(queryByText("avisos")).toBeTruthy()
  })

  it("minimizar o canal esconde a árvore inteira, e o triângulo fica à vista", async () => {
    const user = userEvent.setup()
    const { container, getByLabelText, queryByText } = render(povoada())

    await user.click(getByLabelText(strings.sidebar.collapse("geral")))
    expect(container.querySelector(".room-tree")).toBeNull()
    expect(queryByText("avisos")).toBeNull()

    const triangulo = getByLabelText(strings.sidebar.expand("geral"))
    expect(triangulo.getAttribute("aria-expanded")).toBe("false")
    await user.click(triangulo)
    expect(container.querySelector(".room-tree")).toBeTruthy()
  })

  it("o que se minimiza sobrevive a fechar e reabrir a aplicação", async () => {
    const user = userEvent.setup()
    const primeira = render(povoada())
    await user.click(primeira.getByRole("button", { name: "Início" }))
    expect(readCollapsed().size).toBe(1)

    cleanup()
    const segunda = render(povoada())
    expect(segunda.queryByText("avisos")).toBeNull()
  })

  it("clicar no triângulo dobra e mais nada: não abre o canal nem a sala", async () => {
    const user = userEvent.setup()
    const onSelectChannel = vi.fn()
    const onSelectRoom = vi.fn()
    const { getByLabelText } = render(povoada({ onSelectChannel, onSelectRoom }))

    await user.click(getByLabelText(strings.sidebar.collapse("geral")))
    expect(onSelectChannel).not.toHaveBeenCalled()
    expect(onSelectRoom).not.toHaveBeenCalled()
  })
})

/**
 * Navigate to a category menu.
 *
 * The owner noticed it: a category was created and then left alone. The menu
 * was not hidden-it did not exist. The gesture mirrors channels, because that
 * is what users try first.
 */
describe("ChannelSidebar — o menu de uma categoria", () => {
  function cabecalho(container: HTMLElement, nome: string): HTMLElement {
    return [...container.querySelectorAll(".room-category")].find((h) =>
      h.textContent?.includes(nome),
    ) as HTMLElement
  }

  it("o botão direito no cabeçalho abre o menu daquela categoria", () => {
    const onCategoryMenu = vi.fn()
    const { container } = render(povoada({ onCategoryMenu }))
    fireEvent.contextMenu(cabecalho(container, "Início"), { clientX: 12, clientY: 34 })
    expect(onCategoryMenu).toHaveBeenCalledWith("Início", { x: 12, y: 34 })
  })

  it("sem quem organize, o cabeçalho não abre menu nenhum", () => {
    // The host does not pass the function when it lacks the permission, and the
    // browser menu does not appear either: `preventDefault` only happens if there
    // is a menu to show.
    const { container } = render(povoada())
    const evento = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
    cabecalho(container, "Início").dispatchEvent(evento)
    expect(evento.defaultPrevented).toBe(false)
  })

  it("a secção dos fechados não é uma categoria, e não abre o menu de categoria", () => {
    // It looks the same-`.room-category`-but it is not a field name: renaming or
    // deleting it would mean nothing.
    const onCategoryMenu = vi.fn()
    const { container } = render(
      povoada({
        onCategoryMenu,
        onReopenRoom: noop,
        closedRooms: [sala({ room: "velho", name: "campanha de 2024" })],
      }),
    )
    fireEvent.contextMenu(cabecalho(container, strings.rooms.closedTitle))
    expect(onCategoryMenu).not.toHaveBeenCalled()
  })
})

/**
 * The lock, and the question it answers: which ones did I restrict?
 *
 * Without any indicator, a restricted category and an open one looked the same,
 * and the only way to tell was to open each one.
 */
describe("ChannelSidebar — as categorias restritas trazem cadeado", () => {
  function cabecalho(container: HTMLElement, nome: string): HTMLElement {
    return [...container.querySelectorAll(".room-category")].find((h) => h.textContent?.includes(nome)) as HTMLElement
  }

  it("a categoria com papéis declarados tem cadeado; a aberta não", () => {
    const { container } = render(povoada({ categoriaRestrita: (nome) => nome === "Início" }))

    expect(cabecalho(container, "Início").querySelector(".category-lock")).toBeTruthy()
    expect(cabecalho(container, "Produção").querySelector(".category-lock")).toBeNull()
  })

  it("o cadeado diz o que quer dizer a quem ouve o ecrã", () => {
    const { getAllByLabelText } = render(povoada({ categoriaRestrita: () => true }))
    // Two categories with names, two locks, the same phrase in both-the one that
    // does not promise a closed door, because none closes here.
    const cadeados = getAllByLabelText(strings.sidebar.categoryRestricted)
    expect(cadeados.length).toBe(2)
    expect(cadeados[0]?.getAttribute("title")).toBe(strings.sidebar.categoryRestricted)
  })

  it("sem quem saiba responder à pergunta, não aparece cadeado nenhum", () => {
    // A host that does not pass the function behaves as it always has.
    const { container } = render(povoada())
    expect(container.querySelector(".category-lock")).toBeNull()
  })
})

describe("ChannelSidebar — quem está nos canais de voz", () => {
  it("com a lista aberta mostra cara e nome, sem repetir a conta", () => {
    const { container, getByText } = render(povoada())
    expect(getByText("Ana Rita")).toBeTruthy()
    expect(getByText("Bruno")).toBeTruthy()
    expect(container.querySelectorAll(".room-voice-members .message-avatar")).toHaveLength(2)
    // With faces showing, the number would be the same information written twice.
    expect(container.querySelector(".room-list .room-count")).toBeNull()
  })

  it("minimizada, as caras saem e fica o número de quem lá está", async () => {
    const user = userEvent.setup()
    const { container, getByLabelText, queryByText } = render(povoada())

    await user.click(getByLabelText(strings.sidebar.collapse("Estúdio")))
    expect(queryByText("Ana Rita")).toBeNull()
    expect(container.querySelector(".room-voice-members")).toBeNull()
    // It is no longer a number in a badge: the voices are drawn, one banner per
    // person, and the number goes in the label for those who cannot see the drawing.
    expect(container.querySelector(".room-list .room-count")).toBeNull()
    const vozes = container.querySelector(".room-list .vozes")
    expect(vozes?.getAttribute("aria-label")).toBe(strings.sidebar.voiceCount(2))
    expect(vozes?.querySelectorAll("rect")).toHaveLength(2)
  })

  it("uma sala de voz vazia não tem nada para dobrar", () => {
    const { container } = render(povoada({ voicePresence: () => [] }))
    expect(container.querySelector(".room-row .fold")).toBeNull()
  })
})

/* ------------------------------------- move someone between voice rooms */

/**
 * The scaffold: voice room, people inside, and the gesture to move them.
 *
 * What these tests fix, beyond the gesture itself, is the rule that runs through
 * it: whoever lacks the permission to move does not drag and sees no menu.
 * Offering a gesture that will be rejected is a promise unfulfilled-and the
 * real refusal lives in the core, which trusts no screen.
 */
describe("ChannelSidebar — mover pessoas entre salas de voz", () => {
  function comVoz(overrides: Partial<React.ComponentProps<typeof ChannelSidebar>> = {}): React.JSX.Element {
    return povoada({ mayMove: true, onMovePerson: noop, onVoiceMemberMenu: noop, ...overrides })
  }

  it("sem a responsabilidade de mover, ninguém se arrasta nem tem menu", () => {
    const { container } = render(povoada())
    expect(container.querySelector('.room-voice-members li[draggable="true"]')).toBeNull()
    expect(container.querySelector(".voice-member")).toBeNull()
  })

  it("com a responsabilidade, cada pessoa é uma alça e uma porta para o menu", () => {
    const { container } = render(comVoz())
    expect(container.querySelectorAll('.room-voice-members li[draggable="true"]')).toHaveLength(2)
    expect(container.querySelectorAll(".voice-member")).toHaveLength(2)
  })

  it("a própria conta não se arrasta: mudar de sala é entrar nela", () => {
    const { container } = render(comVoz({ address: "@ana:s" }))
    const linhas = container.querySelectorAll(".room-voice-members li")
    expect(linhas[0]?.getAttribute("draggable")).toBe("false")
    expect(linhas[1]?.getAttribute("draggable")).toBe("true")
  })

  /** The list row whose text contains this. */
  function linhaDaSala(container: HTMLElement, nome: string): HTMLElement {
    return [...container.querySelectorAll(".room-row")].find((linha) =>
      linha.textContent?.includes(nome),
    ) as HTMLElement
  }

  it("largar alguém noutra sala de voz pede a mudança para essa sala", () => {
    const onMovePerson = vi.fn()
    const { container } = render(comVoz({ onMovePerson }))
    const pessoa = container.querySelectorAll('.room-voice-members li[draggable="true"]')[0] as HTMLElement
    fireEvent.dragStart(pessoa, { dataTransfer: { setData: noop } })

    /*
      The Régie, not the Studio.

      This test dropped Ana on the Studio, which is the room where she IS: it
      proved the drop logic works, with a destination that does nothing in the
      app. The real gesture is to take her to another room, and that is what
      we measure here.
    */
    const regie = linhaDaSala(container, "Régie")
    fireEvent.dragOver(regie)
    expect(regie.classList.contains("over")).toBe(true)
    fireEvent.drop(regie)

    expect(onMovePerson).toHaveBeenCalledWith("@ana:s", "v2")
  })

  /**
   * Where this person can go, shown at the moment they are lifted.
   *
   * The gesture existed but was invisible: the list stayed exactly the same
   * until the cursor landed on a row, and anyone who did not know that thing
   * could be dropped in voice rooms had no way to discover it. Marking all
   * destinations on lift is the map appearing with the gesture.
   */
  it("levantar alguém marca as salas que o podem receber, e só essas", () => {
    const { container } = render(comVoz())
    const marcadas = (): string[] =>
      [...container.querySelectorAll(".room-row.pode-receber")].map(
        (linha) => linha.querySelector(".room-name")?.textContent ?? "",
      )

    // At rest, nothing is marked: this is a response to a gesture, not decoration.
    expect(marcadas()).toEqual([])

    const pessoa = container.querySelectorAll('.room-voice-members li[draggable="true"]')[0] as HTMLElement
    fireEvent.dragStart(pessoa, { dataTransfer: { setData: noop } })

    // The Régie, not the Studio (where they already are), nor the text rooms.
    expect(marcadas()).toEqual(["Régie"])

    fireEvent.dragEnd(pessoa)
    expect(marcadas()).toEqual([])
  })

  it("a sala onde a pessoa já está não é destino: não acende nem aceita", () => {
    /*
      Moving someone to the room where they already are is not a move-the
      request goes out, the other client ends up where they already were, and
      nothing happens. The menu never offered that destination; dragging did,
      with the row lighting up as if something would happen.
    */
    const onMovePerson = vi.fn()
    const { container } = render(comVoz({ onMovePerson }))
    const pessoa = container.querySelectorAll('.room-voice-members li[draggable="true"]')[0] as HTMLElement
    fireEvent.dragStart(pessoa, { dataTransfer: { setData: noop } })

    const estudio = linhaDaSala(container, "Estúdio")
    fireEvent.dragOver(estudio)
    expect(estudio.classList.contains("over")).toBe(false)
    fireEvent.drop(estudio)

    expect(onMovePerson).not.toHaveBeenCalled()
  })

  it("quem se pode levantar mostra a pega; quem não se pode, não", () => {
    // The handle was invisible at rest: only the `title` required hovering and
    // waiting. Six dots at the end of the row say it without touching it.
    const { container } = render(comVoz({ address: "@ana:s" }))
    const linhas = [...container.querySelectorAll(".room-voice-members li")]

    // The first one is the account itself: switching rooms means joining it, and it doesn't drag.
    expect(linhas[0]?.querySelector(".voice-member-pega")).toBeNull()
    expect(linhas[1]?.querySelector(".voice-member-pega")).toBeTruthy()
  })

  it("sem a responsabilidade de mover não há pega nenhuma a prometer o gesto", () => {
    const { container } = render(povoada({ onVoiceMemberMenu: noop }))
    expect(container.querySelector(".voice-member-pega")).toBeNull()
  })

  it("uma sala de texto não recebe gente: não se acende nem aceita", () => {
    const onMovePerson = vi.fn()
    const { container } = render(comVoz({ onMovePerson }))
    const pessoa = container.querySelectorAll('.room-voice-members li[draggable="true"]')[0] as HTMLElement
    fireEvent.dragStart(pessoa, { dataTransfer: { setData: noop } })

    const salaDeTexto = [...container.querySelectorAll(".room-row")].find((linha) =>
      linha.textContent?.includes("avisos"),
    ) as HTMLElement
    fireEvent.dragOver(salaDeTexto)
    expect(salaDeTexto.classList.contains("over")).toBe(false)
    fireEvent.drop(salaDeTexto)

    expect(onMovePerson).not.toHaveBeenCalled()
  })

  it("com uma sala de voz só não há para onde mover — mas o menu da pessoa fica", () => {
    /*
      The handle disappears: there is no destination, and a drag that leads
      nowhere is not offered.

      The menu does NOT disappear, and that is the fix. It relied on this, and
      that is why right-clicking a name in a voice room did nothing in almost
      every channel-the ones with just one voice room. It is the PERSON menu:
      view profile, copy address, send a message. What decides what appears
      there is `itensDaPessoaEmVoz`, and that is where destinations fall when
      there are none.
    */
    const umaSo = arvore().map((grupo) => ({
      ...grupo,
      rooms: grupo.rooms.filter((quarto) => quarto.room !== "v2"),
    }))
    const { container } = render(comVoz({ roomGroups: umaSo }))
    expect(container.querySelector('.room-voice-members li[draggable="true"]')).toBeNull()
    expect(container.querySelector(".voice-member")).toBeTruthy()
  })

  it("quem não pode mover ninguém tem menu na mesma, e não tem alça", () => {
    // The `move` permission decides the DRAG, not the right to look at a person.
    // Without this split, right-click was silent for almost everyone in a channel.
    const onVoiceMemberMenu = vi.fn()
    const { container } = render(comVoz({ mayMove: false, onVoiceMemberMenu }))
    expect(container.querySelector('.room-voice-members li[draggable="true"]')).toBeNull()
    expect(container.querySelector(".voice-member")).toBeTruthy()
  })

  it("sobre o próprio nome também há menu, e não há alça", () => {
    // Dragging yourself is entering another room, and you do that by clicking it.
    // Viewing your own profile or copying your own address is not.
    const { container, getByText } = render(comVoz({ address: "@ana:s" }))
    const linhas = [...container.querySelectorAll(".room-voice-members li")]
    const minha = linhas.find((linha) => linha.textContent?.includes("Ana Rita")) as HTMLElement
    expect(minha.getAttribute("draggable")).not.toBe("true")
    expect(getByText("Ana Rita").closest(".voice-member")).toBeTruthy()
  })

  it("clicar numa pessoa abre o menu dela, com a sala onde está", async () => {
    const user = userEvent.setup()
    const onVoiceMemberMenu = vi.fn()
    const { getByText } = render(comVoz({ onVoiceMemberMenu }))
    await user.click(getByText("Ana Rita"))
    expect(onVoiceMemberMenu).toHaveBeenCalledWith("v1", "@ana:s", expect.anything())
  })
})

/* ------------------------------------------------- arrange channels in list */

/**
 * Two drags in the same list.
 *
 * A person changes voice rooms; a channel changes order. It is the same gesture
 * from the browser's view, and so what you drop has to say what it is-otherwise
 * the day someone drops a person on a text channel ends up publishing a new order.
 */
describe("ChannelSidebar — arrumar canais", () => {
  function comOrdem(overrides: Partial<React.ComponentProps<typeof ChannelSidebar>> = {}): React.JSX.Element {
    return povoada({ onReorderRoom: noop, ...overrides })
  }

  function linha(container: HTMLElement, nome: string): HTMLElement {
    return [...container.querySelectorAll(".room-row")].find((r) => r.textContent?.includes(nome)) as HTMLElement
  }

  it("sem quem arrume, nenhum canal se arrasta", () => {
    const { container } = render(povoada())
    expect(container.querySelector('.room-row[draggable="true"]')).toBeNull()
  })

  it("largar um canal em cima de outro pede a ordem nova", () => {
    const onReorderRoom = vi.fn()
    const { container } = render(comOrdem({ onReorderRoom }))
    const arrastado = linha(container, "apresentações")
    fireEvent.dragStart(arrastado, { dataTransfer: { setData: noop } })

    const alvo = linha(container, "avisos")
    fireEvent.dragOver(alvo)
    // The marker for receiving a CHANNEL is not the marker for receiving a person.
    expect(alvo.classList.contains("antes")).toBe(true)
    expect(alvo.classList.contains("over")).toBe(false)
    fireEvent.drop(alvo)

    expect(onReorderRoom).toHaveBeenCalledWith("r2", { antesDe: "r1" })
  })

  it("largar um canal em cima de uma categoria põe-no lá dentro", () => {
    const onReorderRoom = vi.fn()
    const { container } = render(comOrdem({ onReorderRoom }))
    fireEvent.dragStart(linha(container, "avisos"), { dataTransfer: { setData: noop } })

    const categoria = [...container.querySelectorAll(".room-category")].find((h) =>
      h.textContent?.includes("Produção"),
    ) as HTMLElement
    fireEvent.dragOver(categoria)
    fireEvent.drop(categoria)

    expect(onReorderRoom).toHaveBeenCalledWith("r1", { categoria: "Produção — vídeo e fotografia" })
  })

  it("uma pessoa arrastada nunca é lida como um canal", () => {
    const onReorderRoom = vi.fn()
    const onMovePerson = vi.fn()
    const { container } = render(
      comOrdem({ onReorderRoom, onMovePerson, mayMove: true, onVoiceMemberMenu: noop }),
    )
    const pessoa = container.querySelectorAll('.room-voice-members li[draggable="true"]')[0] as HTMLElement
    fireEvent.dragStart(pessoa, { dataTransfer: { setData: noop } })

    // On a text channel, a person is nobody: they do not light up, do not reorder,
    // and do not move.
    const texto = linha(container, "avisos")
    fireEvent.dragOver(texto)
    expect(texto.classList.contains("antes")).toBe(false)
    expect(texto.classList.contains("over")).toBe(false)
    fireEvent.drop(texto)
    expect(onReorderRoom).not.toHaveBeenCalled()
    expect(onMovePerson).not.toHaveBeenCalled()
  })

  it("um canal arrastado para cima de uma sala de voz é ordem, e não uma pessoa a entrar", () => {
    const onReorderRoom = vi.fn()
    const onMovePerson = vi.fn()
    const { container } = render(
      comOrdem({ onReorderRoom, onMovePerson, mayMove: true, onVoiceMemberMenu: noop }),
    )
    fireEvent.dragStart(linha(container, "avisos"), { dataTransfer: { setData: noop } })
    const voz = linha(container, "Estúdio")
    fireEvent.dragOver(voz)
    expect(voz.classList.contains("antes")).toBe(true)
    fireEvent.drop(voz)
    expect(onMovePerson).not.toHaveBeenCalled()
    expect(onReorderRoom).toHaveBeenCalledWith("r1", { antesDe: "v1" })
  })
})

describe("ChannelSidebar — canais fechados", () => {
  const fechados = [{ room: "velho", name: "arquivo-2024", category: "", kind: "text" as const, position: 0 }]

  it("sem quem os reabra, nem se mostram", () => {
    const { queryByText } = render(povoada({ closedRooms: fechados }))
    expect(queryByText("arquivo-2024")).toBeNull()
  })

  it("a quem administra, aparecem com o caminho de volta", async () => {
    const user = userEvent.setup()
    const onReopenRoom = vi.fn()
    const { getByText } = render(povoada({ closedRooms: fechados, onReopenRoom }))
    expect(getByText(strings.rooms.closedTitle)).toBeTruthy()
    await user.click(getByText("arquivo-2024"))
    expect(onReopenRoom).toHaveBeenCalledWith("velho")
  })
})

describe("ChannelSidebar — a acção principal do perfil", () => {
  it("publicar é a primeira coisa da coluna, e é a única a cheio", () => {
    const { container } = render(sidebar({ view: "perfil" }))
    const botoes = [...container.querySelectorAll(".sidebar-body button")]
    expect(botoes[0]?.textContent).toContain(strings.sidebar.newPost)
    expect(botoes[0]?.classList.contains("primary")).toBe(true)
    // Editing the profile is something you do once in a while, not why you came
    // here: it stays second and subtle.
    expect(botoes[1]?.textContent).toContain(strings.sidebar.editProfile)
    expect(botoes[1]?.classList.contains("ghost")).toBe(true)
  })

  // "people" left the list because it left the component: Friends stopped
  // drawing this bar, and the `view` type no longer accepts it.
  it("as notas que explicavam o funcionamento saíram de todas as colunas", () => {
    for (const view of ["perfil", "config", "social"] as const) {
      const { container } = render(sidebar({ view }))
      expect(container.querySelector(".sidebar-note")).toBeNull()
      cleanup()
    }
  })
})

describe("ChannelSidebar — símbolos", () => {
  it("uma conversa directa não usa o @: a marca é redonda, como a de uma pessoa", () => {
    const { container } = render(
      povoada({ rooms: [DM_9B21, "!geral:s"], labelFor: (c) => (c === DM_9B21 ? "Cristina" : "geral") }),
    )
    const marcas = container.querySelectorAll<HTMLElement>(".channel-mark .room-icon")
    expect(marcas[0]?.style.borderRadius).toBe("50%")
    expect(marcas[1]?.style.borderRadius).toBe("")
    expect(container.querySelector(".channel-list")?.textContent).not.toContain("@")
  })

  it("um canal de texto não leva cardinal nenhum: leva um ícone desenhado", () => {
    const { container } = render(povoada())
    const linhaDeTexto = [...container.querySelectorAll(".room-row")].find((linha) =>
      linha.textContent?.includes("avisos"),
    )
    expect(linhaDeTexto?.textContent).not.toContain("#")
    expect(linhaDeTexto?.querySelector(".room-glyph svg")).toBeTruthy()
  })

  it("a sala de voz com gente lá dentro é a única que pisca", () => {
    const { container } = render(povoada())
    const vivas = container.querySelectorAll(".room-glyph.room-live")
    expect(vivas).toHaveLength(1)
    const linhaViva = [...container.querySelectorAll(".room-row")].find((linha) =>
      linha.textContent?.includes("Estúdio"),
    )
    expect(linhaViva?.querySelector(".room-glyph.room-live")).toBeTruthy()
  })

  it("o nome que não cabe corta com reticências, mas fica inteiro no título", () => {
    const nome = "Produção Audiovisual do Alto Alentejo"
    const { container } = render(povoada({ labelFor: () => nome }))
    expect(container.querySelector(".channel-name")?.getAttribute("title")).toBe(nome)
  })

  /**
   * The name has to be its own element.
   *
   * `text-overflow` does not cut text that is a direct child of a flex
   * container, and `.me-name` is flex because of the status marker. With the
   * name loose inside, a long name would not get ellipsis-it pushed the marker
   * out of the column, where `overflow: hidden` erased it, and the person could
   * not see how they appear to others. jsdom does not compute layout, so what
   * we anchor here is the structure that the cut depends on.
   */
  it("o nosso nome vive num elemento só dele, para poder cortar sem levar a marca de estado atrás", () => {
    const { container } = render(
      povoada({ profile: { displayName: "Duarte Bivar de Sousa Nepomuceno", donations: [] } as unknown as Profile }),
    )
    const nome = container.querySelector(".me-name")
    expect(nome?.querySelector(".me-name-text")?.textContent).toBe("Duarte Bivar de Sousa Nepomuceno")
    // Since the banner, the status marker lives in the avatar corner and not
    // beside the name: a long name can no longer push it out.
    expect(nome?.querySelector(".dot")).toBeNull()
    expect(container.querySelector(".me-avatar > .dot")).toBeTruthy()
  })

  /**
   * The address left the view, not the document.
   *
   * Here was anchored the `<bdi>` that straightened the `@` in `direction: rtl`
   * where the address would cut the head instead of the tail. All that work
   * served to show better something that should not be there, and by order of
   * the owner it is gone: what you read on the second line of the card is how
   * it appears.
   *
   * What remains to anchor is what the address still has to do without showing.
   * jsdom does not know if it is hidden-it does not apply stylesheets-and that
   * part is measured in `scripts/medir-faixa-da-conta.mjs`; here we check the
   * text and the `title`, which are how the screen reader and diagnostic scripts
   * reach it.
   */
  it("o endereço continua inteiro no documento, texto e title, para quem não o vê", () => {
    const { container } = render(povoada({ address: "@milsinda-odreto-viddyvox-pofletum:orwell.pt" }))
    const endereco = container.querySelector(".me-address")
    expect(endereco?.textContent).toBe("@milsinda-odreto-viddyvox-pofletum:orwell.pt")
    expect(endereco?.getAttribute("title")).toBe("@milsinda-odreto-viddyvox-pofletum:orwell.pt")
  })

  it("e o que a segunda linha do cartão diz é como se aparece, não o endereço", () => {
    const { container } = render(povoada({ address: "@milsinda-odreto-viddyvox-pofletum:orwell.pt" }))
    expect(container.querySelector(".me-state")?.textContent).toBe(strings.activity.online)
    expect(container.querySelector(".me-state")?.textContent).not.toContain("milsinda")
  })
})

/**
 * The third drag in the same list.
 *
 * People were already dragged between voice rooms and rooms between categories.
 * The CATEGORY itself is left, and what these tests anchor is mostly what it
 * cannot be confused with: grabbing the header is not grabbing the first room,
 * and dropping a category on a room does not rearrange anything.
 *
 * The drag direction is anchored here too, because it is what the marker
 * promises before you drop: down goes AFTER the target, up goes BEFORE.
 */
describe("ChannelSidebar — arrumar categorias", () => {
  function cabecalho(container: HTMLElement, nome: string): HTMLElement {
    return [...container.querySelectorAll(".room-category")].find((h) =>
      h.textContent?.includes(nome),
    ) as HTMLElement
  }

  function linha(container: HTMLElement, nome: string): HTMLElement {
    return [...container.querySelectorAll(".room-row")].find((r) => r.textContent?.includes(nome)) as HTMLElement
  }

  it("sem quem arrume, nenhum cabeçalho se arrasta", () => {
    const { container } = render(povoada({ onReorderRoom: noop }))
    expect(container.querySelector('.room-category[draggable="true"]')).toBeNull()
  })

  it("a descer, a categoria fica depois do alvo", () => {
    const onReorderCategory = vi.fn()
    const { container } = render(povoada({ onReorderCategory }))
    fireEvent.dragStart(cabecalho(container, "Início"), { dataTransfer: { setData: noop } })

    const alvo = cabecalho(container, "Produção")
    fireEvent.dragOver(alvo)
    // The line goes underneath, which is where it really lands.
    expect(alvo.classList.contains("depois")).toBe(true)
    expect(alvo.classList.contains("antes")).toBe(false)
    fireEvent.drop(alvo)

    expect(onReorderCategory).toHaveBeenCalledWith("Início", "Produção — vídeo e fotografia")
  })

  it("a subir, a categoria fica antes do alvo", () => {
    const onReorderCategory = vi.fn()
    const { container } = render(povoada({ onReorderCategory }))
    fireEvent.dragStart(cabecalho(container, "Produção"), { dataTransfer: { setData: noop } })

    const alvo = cabecalho(container, "Início")
    fireEvent.dragOver(alvo)
    expect(alvo.classList.contains("antes")).toBe(true)
    expect(alvo.classList.contains("depois")).toBe(false)
    fireEvent.drop(alvo)

    expect(onReorderCategory).toHaveBeenCalledWith("Produção — vídeo e fotografia", "Início")
  })

  it("pegar na primeira sala de uma categoria não é pegar na categoria", () => {
    // The trap the design avoids: the header is a sibling of the room list, not
    // its parent, so dragging a room never bubbles to the category-unlike a
    // person, who lives inside the room row.
    const onReorderCategory = vi.fn()
    const onReorderRoom = vi.fn()
    const { container } = render(povoada({ onReorderCategory, onReorderRoom }))
    // "alerts" is the first room in "Home".
    fireEvent.dragStart(linha(container, "avisos"), { dataTransfer: { setData: noop } })

    const alvo = cabecalho(container, "Produção")
    fireEvent.dragOver(alvo)
    // It lights up as if it received a ROOM, and draws no line.
    expect(alvo.classList.contains("recebe")).toBe(true)
    expect(alvo.classList.contains("antes")).toBe(false)
    expect(alvo.classList.contains("depois")).toBe(false)
    fireEvent.drop(alvo)

    expect(onReorderRoom).toHaveBeenCalledWith("r1", { categoria: "Produção — vídeo e fotografia" })
    expect(onReorderCategory).not.toHaveBeenCalled()
  })

  it("uma categoria arrastada nunca é lida como uma sala nem como uma pessoa", () => {
    const onReorderCategory = vi.fn()
    const onReorderRoom = vi.fn()
    const onMovePerson = vi.fn()
    const { container } = render(
      povoada({ onReorderCategory, onReorderRoom, onMovePerson, mayMove: true, onVoiceMemberMenu: noop }),
    )
    fireEvent.dragStart(cabecalho(container, "Início"), { dataTransfer: { setData: noop } })

    // On a text room and on a voice one: it does not light up, does not rearrange,
    // and does not move anyone.
    for (const nome of ["avisos", "Estúdio"]) {
      const sobre = linha(container, nome)
      fireEvent.dragOver(sobre)
      expect(sobre.classList.contains("antes")).toBe(false)
      expect(sobre.classList.contains("over")).toBe(false)
      fireEvent.drop(sobre)
    }
    expect(onReorderRoom).not.toHaveBeenCalled()
    expect(onMovePerson).not.toHaveBeenCalled()
    expect(onReorderCategory).not.toHaveBeenCalled()
  })

  it("uma categoria não se recebe a si própria", () => {
    const onReorderCategory = vi.fn()
    const { container } = render(povoada({ onReorderCategory }))
    const propria = cabecalho(container, "Início")
    fireEvent.dragStart(propria, { dataTransfer: { setData: noop } })

    fireEvent.dragOver(propria)
    expect(propria.classList.contains("antes")).toBe(false)
    expect(propria.classList.contains("depois")).toBe(false)
    // And you see it is the one in the air.
    expect(propria.classList.contains("a-arrastar")).toBe(true)
    fireEvent.drop(propria)
    expect(onReorderCategory).not.toHaveBeenCalled()
  })

  it("as salas soltas não têm cabeçalho, logo não se arrastam nem recebem", () => {
    // They are not in a category-they are in none. They stay at the head of the
    // list, and no drag takes them from there.
    const { container } = render(povoada({ onReorderCategory: noop }))
    const arrastaveis = [...container.querySelectorAll('.room-category[draggable="true"]')]
    expect(arrastaveis.map((h) => h.textContent?.trim())).toEqual(["Início", "Produção — vídeo e fotografia"])
  })

  it("a secção dos fechados tem a mesma cara mas não é uma categoria", () => {
    const { container } = render(
      povoada({
        onReorderCategory: noop,
        onReopenRoom: noop,
        closedRooms: [sala({ room: "r9", name: "antigo" })],
      }),
    )
    expect(cabecalho(container, strings.rooms.closedTitle).getAttribute("draggable")).toBeNull()
  })
})

describe("ChannelSidebar — o microfone e o som na faixa da conta", () => {
  /** The card with both controls wired. It does not draw without both hands. */
  const comAudio = (
    overrides: Partial<React.ComponentProps<typeof ChannelSidebar>> = {},
  ): React.JSX.Element => sidebar({ onToggleMic: noop, onToggleSound: noop, ...overrides })

  it("sem quem os trate, os controlos não se desenham", () => {
    const { container } = render(sidebar({}))
    expect(container.querySelector(".me-audio")).toBeNull()
  })

  it("são dois, e são ícone desenhado sem palavra ao lado", () => {
    const { container } = render(comAudio())
    const botoes = [...container.querySelectorAll(".me-audio-btn")]
    expect(botoes).toHaveLength(2)
    // Icons and never borrowed characters: one `svg` in each.
    expect(botoes.every((botao) => botao.querySelector("svg"))).toBe(true)
    // No text inside the button, per owner request. The text it held was not lost-it moved to the accessible name and the help tooltip, and the two tests below lock it in place.
    expect(botoes.every((botao) => (botao.textContent ?? "").trim() === "")).toBe(true)
  })

  it("o painel: a identidade primeiro, a fila dos quatro botões a seguir", () => {
    // Panel P1, chosen by the owner on October 28, 2026 (before that, the banner matched Discord's on October 27). The microphone and volume stay in the queue, not on their own line above identity.
    const { container } = render(comAudio({ onNotifications: noop, onAbrirDefinicoes: noop }))
    const faixa = container.querySelector(".me-faixa.painel")
    expect(faixa?.firstElementChild?.classList.contains("me-identity")).toBe(true)
    expect(faixa?.querySelector(".me-accoes > .me-audio")).toBeTruthy()
    expect(faixa?.querySelector(".me-accoes > .me-conta")).toBeTruthy()
    expect(faixa?.querySelectorAll(".me-accoes button")).toHaveLength(4)
  })

  it("a chamada que a concha passa entra no painel, entre ti e a fila, com o sair", () => {
    const sair = vi.fn()
    const { container } = render(
      comAudio({
        onNotifications: noop,
        onAbrirDefinicoes: noop,
        chamada: { caixa: <aside className="call-dock lateral" />, onSair: sair },
      }),
    )
    const faixa = container.querySelector(".me-faixa.painel")!
    const andares = [...faixa.children].filter((filho) => !filho.classList.contains("me-address"))
    expect(andares.map((andar) => andar.className)).toEqual(["me-identity", "call-dock lateral", "me-accoes"])
    // Outside the panel, no standalone "Connected" banner remains.
    expect(container.querySelectorAll(".call-dock")).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: strings.call.leave }))
    expect(sair).toHaveBeenCalledOnce()
  })

  it("calado é outro ícone e outra cor, nunca o mesmo mais apagado", () => {
    const { container } = render(comAudio({ micMuted: true }))
    const mic = container.querySelector(".me-audio-btn")
    expect(mic?.classList.contains("off")).toBe(true)
    // No text to toggle the state, so the alert lives in the icon and the color-and the icon is what gets tested here, because the color lives in CSS, not the DOM. The icon must change: one more stroke inside the same `svg`.
    const semBarra = render(comAudio()).container.querySelector(".me-audio-btn svg")
    expect(mic?.querySelectorAll("svg *").length).toBeGreaterThan(semBarra?.querySelectorAll("*").length ?? 0)
    // No transparency acting as state.
    expect((mic as HTMLElement | null)?.style.opacity).toBe("")
  })

  it("sem som, o microfone lê-se calado mesmo sem ninguém lhe ter mexido", () => {
    const { container } = render(comAudio({ micMuted: false, soundOff: true }))
    const [mic, som] = [...container.querySelectorAll(".me-audio-btn")]
    expect(mic?.classList.contains("off")).toBe(true)
    expect(som?.classList.contains("off")).toBe(true)
    // And explain why, instead of making people guess.
    expect(mic?.getAttribute("data-tip")).toBe(strings.call.micBySound)
  })

  it("cada clique chama a mão certa, e o cartão não decide nada por si", () => {
    const onToggleMic = vi.fn()
    const onToggleSound = vi.fn()
    const { container } = render(comAudio({ onToggleMic, onToggleSound }))
    const [mic, som] = [...container.querySelectorAll<HTMLElement>(".me-audio-btn")]
    fireEvent.click(mic!)
    expect(onToggleMic).toHaveBeenCalledTimes(1)
    expect(onToggleSound).not.toHaveBeenCalled()
    fireEvent.click(som!)
    expect(onToggleSound).toHaveBeenCalledTimes(1)
    // Nothing changed on screen: the caller is above, and they are the one who sends back the state.
    expect(mic?.classList.contains("off")).toBe(false)
  })

  /**
   * The accessible name carries the state; the tooltip carries only the action.
   *
   * Not an oversight-a deliberate call. Both sentences were the same for one iteration, and "Muted. Turn on microphone." draws a 180px tooltip in a 236px column-it spilled past the 390px bar. The state already speaks three times to anyone watching: the bar on the icon, the color, and the background. The one who sees none of those three is the one who hears the screen, and that is who the `aria-label` answers to.
   */
  it("o nome acessível diz o estado E a acção, e o balão diz a acção", () => {
    const { container } = render(comAudio({ micMuted: true }))
    const mic = container.querySelector(".me-audio-btn")
    expect(mic?.getAttribute("aria-label")).toBe(strings.call.micAria(true))
    expect(mic?.getAttribute("data-tip")).toBe(strings.call.micOn)
  })

  /**
   * One tooltip, not two.
   *
   * `title` and `data-tip` each draw a tooltip: the system's native one and this app's. Put on the same button, hovering opened both layered on top of each other. `data-tip` stays, and this test prevents the other from coming back.
   */
  it("os interruptores não têm `title` a competir com o balão da casa", () => {
    const { container } = render(comAudio())
    for (const botao of container.querySelectorAll(".me-audio-btn")) {
      expect(botao.hasAttribute("title")).toBe(false)
      expect(botao.getAttribute("data-tip")).toBeTruthy()
      expect(botao.getAttribute("aria-label")).toBeTruthy()
    }
  })

  it("sem setas: o clique direito em cada ícone abre o menu que lhe pertence", () => {
    const onMicMenu = vi.fn()
    const onSoundMenu = vi.fn()
    const { container } = render(comAudio({ onMicMenu, onSoundMenu }))
    expect(container.querySelector(".me-audio-seta")).toBeNull()
    const [mic, som] = [...container.querySelectorAll<HTMLElement>(".me-audio-btn")]
    fireEvent.contextMenu(mic!)
    expect(onMicMenu).toHaveBeenCalledTimes(1)
    expect(onSoundMenu).not.toHaveBeenCalled()
    fireEvent.contextMenu(som!)
    expect(onSoundMenu).toHaveBeenCalledTimes(1)
  })

  it("sem quem responda ao menu, o clique direito fica o do browser", () => {
    // House rule: what you cannot do, you do not intercept.
    const { container } = render(comAudio())
    const evento = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
    fireEvent(container.querySelector(".me-audio-btn")!, evento)
    expect(evento.defaultPrevented).toBe(false)
  })

  it("a roda dentada chega à faixa, e abre as definições", () => {
    const onAbrirDefinicoes = vi.fn()
    render(comAudio({ onAbrirDefinicoes }))
    fireEvent.click(screen.getByRole("button", { name: strings.sidebar.abrirDefinicoes }))
    expect(onAbrirDefinicoes).toHaveBeenCalledTimes(1)
  })

  it('a ligação chega ao ponto: sem ligação, é o ponto "offline"', () => {
    const { container } = render(comAudio({ connection: "offline" }))
    expect(container.querySelector(".me-avatar > .dot")?.classList.contains("offline")).toBe(true)
  })

  it("em qualquer dos quatro estados, a palavra escrita está no nome acessível", () => {
    // WCAG 2.5.3: voice command users ask for the button by the word they READ. An accessible name written better but not containing it is a button that does not respond to someone who sees it. Already failed once, with "Microphone muted".
    for (const [micMuted, soundOff] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ] as const) {
      const { container } = render(comAudio({ micMuted, soundOff }))
      for (const botao of container.querySelectorAll(".me-audio-btn")) {
        const escrito = botao.querySelector("span")?.textContent ?? ""
        expect(botao.getAttribute("aria-label")).toContain(escrito)
      }
      cleanup()
    }
  })

  it("os controlos não se misturam com o nome: a identidade é um botão, os quatro outros", () => {
    const { container } = render(comAudio({ micMuted: true, soundOff: true }))
    expect(container.querySelector(".me-identity .me-audio")).toBeNull()
    expect(container.querySelector(".me-audio .me-name")).toBeNull()
    // The correction for the longer name stands: the text in its own element.
    expect(container.querySelector(".me-name > .me-name-text")).toBeTruthy()
    expect(container.querySelector(".me-avatar > .dot")).toBeTruthy()
  })
})

/**
 * The badge belongs to the NAME, not the end of the line.
 *
 * The complaint was that the badge appeared far from the channel it belongs to. The margin was right-2px, measured-and the real problem was different: with `.channel-name` stretching, the badge got pushed to the end of the LINE and ended up 95px from the text on a wide screen and 139px away in a 280px drawer. They now live in a group that stretches, instead of the name stretching.
 *
 * Real geometry is not measured here-JSDOM has no layout, and that is why `scripts/medir-destinos.mjs` exists. What these tests keep is the only part the DOM knows: who is whose sibling. Moving the badge back to the line, next to the unread counts, becomes possible again-but not without leaving a mark.
 */
describe("ChannelSidebar — o selo oficial fica agarrado ao nome", () => {
  const oficial = { rooms: ["!casa:s"], labelFor: () => "Orwell", oficialFor: () => true }

  it("o selo é irmão do nome, dentro do grupo que estica", () => {
    const { container } = render(povoada(oficial))
    const grupo = container.querySelector(".channel .channel-label")
    expect(grupo).toBeTruthy()
    // Order matters: name first, badge right after.
    expect(grupo?.children[0]?.classList.contains("channel-name")).toBe(true)
    expect(grupo?.children[1]?.classList.contains("selo-oficial")).toBe(true)
  })

  it("o selo não é filho directo da linha, onde ia parar ao fim dela", () => {
    const { container } = render(povoada(oficial))
    const linha = container.querySelector(".channel")
    const soltos = [...(linha?.children ?? [])].filter((no) => no.classList.contains("selo-oficial"))
    expect(soltos).toHaveLength(0)
  })

  it("sem oficialidade não há selo nenhum, e o nome fica onde estava", () => {
    const { container } = render(povoada({ ...oficial, oficialFor: () => false }))
    expect(container.querySelector(".selo-oficial")).toBeNull()
    expect(container.querySelector(".channel-label .channel-name")?.textContent).toBe("Orwell")
  })
})

/**
 * The settings sections, in the place they moved to.
 *
 * The settings panel had its own menu in its own column, and that column ended up with the "Settings" header and an EMPTY body next to it: two columns for the same thing, one of them with nothing. The menu moved here, which is the column the app already has for navigation.
 */
describe("ChannelSidebar — configurações", () => {
  it("mostra as secções, e não uma coluna vazia", () => {
    render(sidebar({ view: "config", seccaoConfig: "conta" }))

    for (const entrada of seccoes()) {
      expect(screen.getByRole("button", { name: entrada.label })).toBeTruthy()
    }
  })

  it("a secção aberta diz que é a actual, e as outras não", () => {
    render(sidebar({ view: "config", seccaoConfig: "ajuda" }))

    expect(screen.getByRole("button", { name: strings.settings.ajuda }).getAttribute("aria-current")).toBe("page")
    expect(screen.getByRole("button", { name: strings.settings.account }).getAttribute("aria-current")).toBeNull()
  })

  it("escolher uma secção avisa quem manda no estado", () => {
    // State lives in App, which reads it in both places. This column draws and notifies; it does not decide.
    const escolher = vi.fn()
    render(sidebar({ view: "config", seccaoConfig: "conta", onSeccaoConfig: escolher }))

    fireEvent.click(screen.getByRole("button", { name: strings.settings.privacidade }))
    expect(escolher).toHaveBeenCalledWith("privacidade")
  })

  it("nos outros ecrãs não aparece secção nenhuma", () => {
    render(sidebar({ view: "chat" }))
    expect(screen.queryByRole("button", { name: strings.settings.ajuda })).toBeNull()
  })
})

/**
 * The "in call" pill became an icon (`components/Vozes.tsx`).
 *
 * What we store here is what the channel line decides: HOW MANY voices, whether ours is among them, and what text goes with the icon. The checks are about the shape of what came out (an `img` with a name, multiple banners) not `toContain(strings.x)`, which with the missing key compares to `undefined` and passes. The expected phrases are written out in full for the same reason.
 */
describe("ChannelSidebar — quem está em chamada, desenhado", () => {
  const agora = Date.now()
  const gente = (...quem: string[]): Map<string, number> => new Map(quem.map((q) => [q, agora]))

  it("uma chamada em que não estamos: uma tarja por pessoa, e a frase conta-as", () => {
    const { container } = render(sidebar({ ringing: new Map([["!geral:s", gente("@a:s", "@b:s", "@c:s")]]) }))
    const vozes = container.querySelector(".channel .vozes")
    expect(vozes?.getAttribute("role")).toBe("img")
    expect(vozes?.getAttribute("aria-label")).toBe("3 pessoas em chamada")
    expect(vozes?.getAttribute("title")).toBe("3 pessoas em chamada")
    expect(vozes?.querySelectorAll("rect")).toHaveLength(3)
    expect(vozes?.querySelector(".vozes-minha")).toBeNull()
  })

  it("connosco lá dentro: a nossa tarja à frente, e o mapa com o nosso endereço não nos desenha duas vezes", () => {
    const comigo = new Map([["!geral:s", gente("@abc:s", "@a:s", "@b:s")]])
    const semMim = new Map([["!geral:s", gente("@a:s", "@b:s")]])
    for (const ringing of [comigo, semMim]) {
      const { container, unmount } = render(sidebar({ callChannel: "!geral:s", ringing }))
      const vozes = container.querySelector(".channel .vozes")
      expect(vozes?.getAttribute("aria-label")).toBe("Em chamada: tu e mais 2 pessoas")
      expect(vozes?.querySelectorAll("rect")).toHaveLength(3)
      expect(vozes?.querySelectorAll(".vozes-minha")).toHaveLength(1)
      expect(vozes?.querySelector("rect")?.getAttribute("class")).toBe("vozes-minha")
      unmount()
    }
  })

  it("sozinhos lá dentro, a nossa voz chama", () => {
    const { container } = render(sidebar({ callChannel: "!geral:s" }))
    const vozes = container.querySelector(".channel .vozes")
    expect(vozes?.classList.contains("vozes-chama")).toBe(true)
    expect(vozes?.getAttribute("aria-label")).toBe("Em chamada: só tu")
    expect(vozes?.querySelectorAll(".vozes-minha")).toHaveLength(1)
  })

  it("numa conversa directa, uma chamada sem nós é alguém a chamar-nos, e diz quem", () => {
    const { container } = render(
      sidebar({
        rooms: [DM_ANA],
        labelFor: () => "Ana Bivar",
        ringing: new Map([[DM_ANA, gente("@ana:s")]]),
      }),
    )
    const vozes = container.querySelector(".channel .vozes")
    expect(vozes?.classList.contains("vozes-chama")).toBe(true)
    expect(vozes?.getAttribute("aria-label")).toBe("Ana Bivar está a chamar-te")
  })

  it("o nosso outro aparelho numa chamada em que ESTE não está conta como gente", () => {
    const { container } = render(sidebar({ ringing: new Map([["!geral:s", gente("@abc:s", "@a:s")]]) }))
    expect(container.querySelector(".channel .vozes")?.getAttribute("aria-label")).toBe("2 pessoas em chamada")
  })

  it("sem chamada não há desenho nenhum", () => {
    const { container } = render(sidebar({}))
    expect(container.querySelector(".vozes")).toBeNull()
  })

  it("as contas por ler continuam à direita das vozes, que é do que o CSS depende", () => {
    const { container } = render(
      sidebar({ callChannel: "!geral:s", unreads: new Map([["!geral:s", 12]]), active: null }),
    )
    const vozes = container.querySelector(".channel .vozes")
    expect(vozes?.nextElementSibling?.classList.contains("badge")).toBe(true)
  })

  it("a pílula foi-se: nem a classe, nem o texto à vista na linha", () => {
    const { container } = render(
      sidebar({ callChannel: "!geral:s", ringing: new Map([["!geral:s", gente("@a:s")]]) }),
    )
    expect(container.querySelector(".live")).toBeNull()
    expect(container.querySelector(".channel")?.textContent).not.toMatch(/chamada/i)
  })

  it("nenhum símbolo da barra lateral fica sem nome", () => {
    const { container } = render(
      sidebar({
        rooms: ["!geral:s", DM_ANA, "!outra:s"],
        callChannel: "!geral:s",
        ringing: new Map([
          [DM_ANA, gente("@ana:s")],
          ["!outra:s", gente("@a:s", "@b:s", "@c:s", "@d:s", "@e:s", "@f:s", "@g:s")],
        ]),
      }),
    )
    const simbolos = container.querySelectorAll('[role="img"]')
    expect(simbolos.length).toBeGreaterThanOrEqual(3)
    for (const simbolo of simbolos) {
      const nome = simbolo.getAttribute("aria-label") ?? ""
      expect(nome.trim(), simbolo.outerHTML.slice(0, 80)).not.toBe("")
      expect(nome).not.toMatch(/undefined|NaN/)
    }
  })
})

/**
 * Who is in the call, before the channel opens.
 *
 * Owner report from October 5, 2026: **some people do not see who is in the room before they enter.** The count was already on this line; the names only existed inside the OPEN channel (`voicePresence`, which is from the active channel), so knowing WHO is in a call meant opening it first.
 *
 * They go to the voices label, which at the same time is the `title` and accessible name of the icon: what you see on hover and what you hear are the same information.
 */
describe("ChannelSidebar — os nomes de quem está em chamada", () => {
  const agora = Date.now()
  const gente = (...quem: string[]): Map<string, number> => new Map(quem.map((q) => [q, agora]))
  const nomes: Record<string, string> = { "@a:s": "Ana Rita", "@b:s": "Bruno", "@abc:s": "Eu" }
  const nameFor = (quem: string): string => nomes[quem] ?? quem

  it("a contagem passa a dizer quem são, no título e no nome acessível", () => {
    const { container } = render(
      sidebar({ ringing: new Map([["!geral:s", gente("@a:s", "@b:s")]]), nameFor }),
    )
    const vozes = container.querySelector(".channel .vozes")
    expect(vozes?.getAttribute("title")).toBe("2 pessoas em chamada: Ana Rita, Bruno")
    expect(vozes?.getAttribute("aria-label")).toBe("2 pessoas em chamada: Ana Rita, Bruno")
  })

  it("e nunca nos nomeia a nós: a nossa presença lê-se na tarja clara", () => {
    const { container } = render(
      sidebar({
        callChannel: "!geral:s",
        ringing: new Map([["!geral:s", gente("@abc:s", "@a:s")]]),
        nameFor,
      }),
    )
    const vozes = container.querySelector(".channel .vozes")
    expect(vozes?.getAttribute("title")).toBe("Em chamada: tu e mais 1 pessoa: Ana Rita")
    expect(vozes?.getAttribute("title")).not.toContain("Eu")
  })

  it("numa conversa directa não repete o nome que a frase já diz", () => {
    const { container } = render(
      sidebar({
        rooms: [DM_ANA],
        labelFor: () => "Ana Rita",
        ringing: new Map([[DM_ANA, gente("@a:s")]]),
        nameFor,
      }),
    )
    expect(container.querySelector(".channel .vozes")?.getAttribute("title")).toBe("Ana Rita está a chamar-te")
  })

  it("sem `nameFor` a linha fica com a contagem, como sempre esteve", () => {
    // A host that does not pass the function cannot lose the information it already gave: this is what keeps the addition additive.
    const { container } = render(sidebar({ ringing: new Map([["!geral:s", gente("@a:s", "@b:s")]]) }))
    expect(container.querySelector(".channel .vozes")?.getAttribute("title")).toBe("2 pessoas em chamada")
  })
})

/**
 * And the line leads to the room where the conversation is, when there is only one.
 *
 * The room tree opens by default, so most of the time this does nothing. The case it serves is someone who collapsed the tree for this channel: the line said "3 people in call" and clicking led to a channel where those three people's room was hidden.
 *
 * **Does not enter the call**, on purpose: entering a voice room is entering its call, and a click on a channel name cannot put anyone on the air without them asking for it.
 */
describe("ChannelSidebar — a linha do canal leva à sala da chamada", () => {
  const agora = Date.now()
  const comChamada = new Map([["!geral:s", new Map([["@a:s", agora]])]])

  it("abre a árvore dobrada do canal onde há uma chamada", async () => {
    const user = userEvent.setup()
    // The tree for this channel collapsed before anything is touched-the state where the bug shows.
    localStorage.setItem("enclave.collapsed", JSON.stringify(["e:!geral:s"]))

    const { container } = render(
      povoada({ ringing: comChamada, salaDaChamadaEm: () => "v1", onSelectRoom: noop }),
    )
    expect(readCollapsed().has("e:!geral:s")).toBe(true)

    // By `.channel`, not by name: the default room is called "general" like the channel, and a name search catches both.
    await user.click(container.querySelector("button.channel") as HTMLElement)
    expect(readCollapsed().has("e:!geral:s")).toBe(false)
  })

  it("sem chamada, ou com duas, não desdobra nada", async () => {
    const user = userEvent.setup()
    for (const salaDaChamadaEm of [undefined, () => null]) {
      localStorage.setItem("enclave.collapsed", JSON.stringify(["e:!geral:s"]))
      const { container, unmount } = render(
        povoada({ ringing: comChamada, onSelectRoom: noop, ...(salaDaChamadaEm ? { salaDaChamadaEm } : {}) }),
      )
      await user.click(container.querySelector("button.channel") as HTMLElement)
      // It stays collapsed: whoever collapsed the tree did so, and opening it for no reason undoes their choice.
      expect(readCollapsed().has("e:!geral:s")).toBe(true)
      unmount()
    }
  })

  it("e nunca entra na chamada: a sala não se abre sozinha", async () => {
    const user = userEvent.setup()
    const abriuSala = vi.fn()
    const { container } = render(
      povoada({ ringing: comChamada, salaDaChamadaEm: () => "v1", onSelectRoom: abriuSala }),
    )

    await user.click(container.querySelector("button.channel") as HTMLElement)
    expect(abriuSala).not.toHaveBeenCalled()
  })
})

describe("ChannelSidebar: à espera de entrada", () => {
  it('uma linha a cinzento por canal pedido, com o nome, a nota e "Cancelar"', async () => {
    const user = userEvent.setup()
    const onCancelar = vi.fn()
    render(sidebar({ aEsperaDeEntrada: [{ canal: "!clube:s", nome: "Clube", onCancelar }] }))
    expect(screen.getByText("Clube")).toBeTruthy()
    expect(screen.getByText(strings.sidebar.aEsperaDeEntrada)).toBeTruthy()
    // Opens nothing: there is no channel to open yet.
    expect(screen.getByText("Clube").closest("button")).toBeNull()
    await user.click(screen.getByRole("button", { name: strings.sidebar.cancelarEspera("Clube") }))
    expect(onCancelar).toHaveBeenCalledOnce()
  })

  it("com uma linha à espera, a lista vazia já não diz para criar um canal", () => {
    render(sidebar({ rooms: [], active: null, aEsperaDeEntrada: [{ canal: "!clube:s", nome: "Clube", onCancelar: noop }] }))
    expect(screen.queryByText(strings.sidebar.noRoomsBefore, { exact: false })).toBeNull()
  })
})

describe("ChannelSidebar: à espera, quando chegou outro canal", () => {
  it("a nota da linha diz que o canal que chegou tem outro nome", () => {
    render(
      sidebar({
        aEsperaDeEntrada: [{ canal: "!clube:s", nome: "Clube", nota: strings.sidebar.chegouOutroNome, onCancelar: noop }],
      }),
    )
    expect(screen.getByText(strings.sidebar.chegouOutroNome)).toBeTruthy()
    expect(screen.queryByText(strings.sidebar.aEsperaDeEntrada)).toBeNull()
  })
})

/**
 * No presence ring on voice room faces (owner order, October 27, 2026, evening): the room already says they are in a call, and in a short list the ring was noise. The ring stays on the member panel and in the cards.
 */
describe("ChannelSidebar — as caras das salas de voz não levam anel", () => {
  it("nenhuma cara da sala tem anel nem pulsa, com ou sem estado de fora", () => {
    const { container } = render(
      povoada({ voicePresence: (room) => (room === "v1" ? [{ ...presentes[0]!, presence: "busy" as const }] : []) }),
    )
    expect(container.querySelectorAll(".room-voice-members .message-avatar, .room-voice-members .avatar").length).toBeGreaterThan(0)
    expect(container.querySelectorAll(".room-voice-members [data-anel]")).toHaveLength(0)
    expect(container.querySelectorAll(".room-voice-members [data-em-chamada]")).toHaveLength(0)
  })
})

/**
 * The unread count in each room (owner request from October 27, 2026). Each room shows its own on the right; the collapsed category and collapsed channel show the sum of the rooms they hide.
 */
describe("ChannelSidebar — o número por ler em cada sala", () => {
  const porLer: Record<string, number> = { r1: 2, r3: 5 }
  const porLerNaSala = (room: string): number => porLer[room] ?? 0

  function linhaDaSala(container: HTMLElement, nome: string): HTMLElement {
    return [...container.querySelectorAll<HTMLElement>(".room-row")].find(
      (linha) => linha.querySelector(".room-name")?.textContent === nome,
    )!
  }

  it("cada sala com mensagens por ler mostra o número, e as outras nada", () => {
    const { container } = render(povoada({ porLerNaSala, unreads: new Map([["!geral:s", 7]]) }))
    expect(linhaDaSala(container, "avisos").querySelector(".room-unread")?.textContent).toBe("2")
    expect(linhaDaSala(container, "avisos").classList.contains("unread")).toBe(true)
    expect(linhaDaSala(container, "combinações-de-cor-e-tipografia").querySelector(".room-unread")?.textContent).toBe("5")
    expect(linhaDaSala(container, "apresentações").querySelector(".room-unread")).toBeNull()
    expect(screen.getByLabelText(strings.sidebar.unreadCount(2))).toBeTruthy()
    // With the tree visible, the channel line does not repeat the sum.
    expect(container.querySelector(".channel-row .badge")).toBeNull()
  })

  it("dobrar o canal põe a soma na linha dele", async () => {
    const user = userEvent.setup()
    const { container } = render(povoada({ porLerNaSala, unreads: new Map([["!geral:s", 7]]) }))
    await user.click(screen.getByRole("button", { name: strings.sidebar.collapse("geral") }))
    expect(container.querySelector(".channel-row .badge")?.textContent).toBe("7")
  })

  it("dobrar uma categoria põe a soma das salas dela no cabeçalho", async () => {
    const user = userEvent.setup()
    const { container } = render(povoada({ porLerNaSala }))
    await user.click(screen.getByRole("button", { name: /Produção/ }))
    const cabecalho = [...container.querySelectorAll(".category-toggle")].find((botao) =>
      botao.textContent?.includes("Produção"),
    )!
    expect(cabecalho.querySelector(".room-unread")?.textContent).toBe("5")
  })

  it("um canal que não está aberto mostra a soma na linha", () => {
    const { container } = render(
      sidebar({ rooms: ["!geral:s", "!adega:s"], unreads: new Map([["!adega:s", 3]]) }),
    )
    const linha = [...container.querySelectorAll(".channel-row")].find((row) => row.textContent?.includes("adega"))!
    expect(linha.querySelector(".badge")?.textContent).toBe("3")
  })
})

describe("ChannelSidebar — o que está silenciado", () => {
  it("o canal silenciado esbate e leva o sino; as salas dele esbatem sem sino", () => {
    const { container } = render(povoada({ silenciado: (chave) => chave === "!geral:s" }))
    const canal = container.querySelector(".channel-row")!
    expect(canal.classList.contains("silenciado")).toBe(true)
    expect(canal.querySelector(".marca-silencio")?.getAttribute("aria-label")).toBe(strings.silencio.marca)
    const salas = [...container.querySelectorAll(".room-row")]
    expect(salas.every((linha) => linha.classList.contains("silenciado"))).toBe(true)
    expect(container.querySelectorAll(".room-row .marca-silencio")).toHaveLength(0)
  })

  it("uma sala silenciada leva o sino sozinha", () => {
    const { container } = render(povoada({ silenciado: (chave) => chave === "!geral:s/r1" }))
    expect(container.querySelector(".channel-row")?.classList.contains("silenciado")).toBe(false)
    const avisos = [...container.querySelectorAll(".room-row")].find(
      (linha) => linha.querySelector(".room-name")?.textContent === "avisos",
    )!
    expect(avisos.classList.contains("silenciado")).toBe(true)
    expect(avisos.querySelector(".marca-silencio")).toBeTruthy()
    expect(container.querySelectorAll(".room-row .marca-silencio")).toHaveLength(1)
  })
})

describe("ChannelSidebar — o sinal de transmissão nas salas de voz", () => {
  it("ao lado da cara de quem partilha o ecrã ou toca música, com o `title` certo", () => {
    render(
      povoada({
        voicePresence: (room) =>
          room === "v1"
            ? [
                { address: "@ana:s", name: "Ana Rita", transmite: "ecra" as const },
                { address: "@bru:s", name: "Bruno", transmite: "ecra+musica" as const },
                { address: "@cid:s", name: "Cidália" },
              ]
            : [],
      }),
    )
    expect(screen.getByRole("img", { name: strings.transmissao.ecra }).getAttribute("title")).toBe(
      strings.transmissao.ecra,
    )
    expect(screen.getByRole("img", { name: strings.transmissao.ambos })).toBeTruthy()
    expect(screen.queryByRole("img", { name: strings.transmissao.musica })).toBeNull()
    expect(document.querySelectorAll(".room-voice-members .marca-transmissao")).toHaveLength(2)
  })
})

describe('ChannelSidebar: "Entrar no canal Orwell" (3/11/2026)', () => {
  it("sem canal comum por entrar, não há botão", () => {
    render(sidebar({}))
    expect(screen.queryByRole("button", { name: strings.sidebar.entrarNoCanalOficial })).toBeNull()
  })

  it('aparece ao lado de "Entrar com um link", também com a lista vazia, e entra ao clicar', async () => {
    const onEntrar = vi.fn()
    render(sidebar({ rooms: [], active: null, canalOficialPorEntrar: { aEntrar: false, onEntrar } }))
    expect(screen.getByRole("button", { name: strings.sidebar.joinWithLink })).toBeTruthy()
    await userEvent.setup().click(screen.getByRole("button", { name: strings.sidebar.entrarNoCanalOficial }))
    expect(onEntrar).toHaveBeenCalledTimes(1)
  })

  it("a entrar, diz que está a entrar e não deixa carregar outra vez", () => {
    render(sidebar({ canalOficialPorEntrar: { aEntrar: true, onEntrar: noop } }))
    const botao = screen.getByRole("button", { name: strings.sidebar.aEntrarNoCanalOficial }) as HTMLButtonElement
    expect(botao.disabled).toBe(true)
  })
})

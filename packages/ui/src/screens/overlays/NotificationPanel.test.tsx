import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ChatMessage } from "../../types.js"
import { foldFriendTies } from "@enclave/protocol"
import { dmPeerAddress } from "../../lib/format.js"
import { friendshipsDe, type Friendships } from "../../lib/friendship.js"
import type { AppNotification } from "../../lib/notifications.js"
import { strings } from "../../strings.js"
import { NotificationPanel } from "./NotificationPanel.js"
import { moradaDeTeste } from "../../../testes/moradas.js"

/** The core's role: folding the events that the bridge delivers ready (phase 1d). */
function friendshipsOf(messages: ChatMessage[], me: string): Friendships {
  return friendshipsDe([...foldFriendTies(messages, me, (channel) => dmPeerAddress(channel, me)).values()])
}

/**
 * Accept from the bell, and the demand that comes with it: accepting in one
 * place must vanish from the other.
 *
 * What is proven here is that this is not cleanup code. The bell's input is
 * always the same, it is the record of something that happened, and those do
 * not change, and what changes is the fold of events. The buttons come from
 * the fold, so they disappear when the request is answered, no matter where it
 * was answered.
 */

afterEach(cleanup)

const EU = "@eu:s"
const ANA = "@ana:s"
const DM = moradaDeTeste("directa ana eu", "s")

const PEDIDO: AppNotification = {
  id: "freq:1",
  kind: "friend-request",
  at: 100,
  actor: ANA,
  channel: DM,
  read: false,
}

function msg(sender: string, payload: ChatMessage["payload"]): ChatMessage {
  return { channel: DM, seq: 1, sender, payload }
}

function painel(messages: ChatMessage[], handlers: Partial<Parameters<typeof NotificationPanel>[0]> = {}) {
  return render(
    <NotificationPanel
      at={{ x: 0, y: 0 }}
      notifications={[PEDIDO]}
      nameFor={(address) => (address === ANA ? "Ana" : address)}
      labelFor={(channel) => channel}
      directory={new Map()}
      friendships={friendshipsOf(messages, EU)}
      onOpen={vi.fn()}
      onMarkAllRead={vi.fn()}
      onClose={vi.fn()}
      {...handlers}
    />,
  )
}

describe("responder a um pedido de amizade a partir do sino", () => {
  const pedidoDaAna = [msg(ANA, { t: "friend.request", sentAt: 100 })]

  it("um pedido por responder traz os dois botões, e Aceitar devolve quem pediu", async () => {
    const user = userEvent.setup()
    const onAcceptRequest = vi.fn()
    painel(pedidoDaAna, { onAcceptRequest })

    expect(screen.getByText(strings.people.wantsToBeFriends("Ana"))).toBeTruthy()
    await user.click(screen.getByRole("button", { name: strings.people.accept }))
    // Who: the channel resolves in `useAmizade`, the same in all doors.
    expect(onAcceptRequest).toHaveBeenCalledExactlyOnceWith(ANA)
  })

  it("Recusar é um caminho à parte, e não passa pelo de aceitar", async () => {
    const user = userEvent.setup()
    const onAcceptRequest = vi.fn()
    const onDeclineRequest = vi.fn()
    painel(pedidoDaAna, { onAcceptRequest, onDeclineRequest })

    await user.click(screen.getByRole("button", { name: strings.people.decline }))
    expect(onDeclineRequest).toHaveBeenCalledExactlyOnceWith(ANA)
    expect(onAcceptRequest).not.toHaveBeenCalled()
  })

  it("aceite noutro sítio, a entrada fica e os botões vão-se", () => {
    // The same notification, word for word. What changed was the fold, and that
    // is all that has to change for the bell to stop offering a response that was
    // already given. There is no cleanup running here.
    painel([...pedidoDaAna, msg(EU, { t: "friend.accept", acceptedAt: 150 })])

    expect(screen.queryByRole("button", { name: strings.people.accept })).toBeNull()
    expect(screen.queryByRole("button", { name: strings.people.decline })).toBeNull()
    expect(screen.getByText(strings.notifCenter.friendRequestClosed("Ana"))).toBeTruthy()
  })

  it("recusado noutro sítio, o mesmo", () => {
    painel([...pedidoDaAna, msg(EU, { t: "friend.decline" })])
    expect(screen.queryByRole("button", { name: strings.people.accept })).toBeNull()
    expect(screen.getByText(strings.notifCenter.friendRequestClosed("Ana"))).toBeTruthy()
  })

  it("resolvido por pedido cruzado, o mesmo — e este é o desfecho que ninguém programaria", () => {
    // Both asked and the friendship happened without going through either of these
    // buttons. A manually maintained list would keep offering "accept" for a
    // request that no longer exists.
    painel([
      msg(EU, { t: "friend.request", sentAt: 90 }),
      ...pedidoDaAna,
      msg(EU, { t: "friend.accept", acceptedAt: 110 }),
    ])
    expect(screen.queryByRole("button", { name: strings.people.accept })).toBeNull()
  })

  it("enquanto a resposta está a meio, os dois botões ficam parados", async () => {
    const user = userEvent.setup()
    const onAcceptRequest = vi.fn()
    const onDeclineRequest = vi.fn()
    painel(pedidoDaAna, { busy: ANA, onAcceptRequest, onDeclineRequest })

    await user.click(screen.getByRole("button", { name: strings.people.accepting }))
    await user.click(screen.getByRole("button", { name: strings.people.decline }))
    expect(onAcceptRequest).not.toHaveBeenCalled()
    expect(onDeclineRequest).not.toHaveBeenCalled()
  })

  it("as outras notificações não ganham botões nenhuns", () => {
    render(
      <NotificationPanel
        at={{ x: 0, y: 0 }}
        notifications={[{ id: "dm:1", kind: "dm-message", at: 100, actor: ANA, channel: DM, read: true }]}
        nameFor={() => "Ana"}
        labelFor={(channel) => channel}
        directory={new Map()}
        friendships={friendshipsOf(pedidoDaAna, EU)}
        onOpen={vi.fn()}
        onMarkAllRead={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByRole("button", { name: strings.people.accept })).toBeNull()
  })
})

/**
 * Three truths where there were two: a failed read is not empty.
 *
 * The notification list lives in the vault and is read once per unlock. If that
 * read fails, the shell does the right thing inside, logs it, and DOES NOT
 * mark the list as loaded, so it never writes the empty over what is stored,  * and said nothing. The bell opened with "Nothing here. Good sign." on top of a
 * vault that could have fifty entries.
 *
 * The rule this restores is the same one `MemberPanel` has followed for a
 * while, and it is written in its header: loading, failed, and empty are three
 * different things, and the second dressed as the third is the worst of the
 * three.
 */
describe("o sino distingue vazio de ilegível", () => {
  it("uma leitura falhada é dita, e não se disfarça de bom sinal", () => {
    painel([], { notifications: [], falhou: true })
    expect(screen.getByText(strings.notifCenter.falhou)).toBeTruthy()
    expect(screen.queryByText(strings.notifCenter.empty)).toBeNull()
  })

  it("e diz também que nada se perdeu, porque nada se perdeu", () => {
    // Without this line, "could not read" reads as "went away". What is in the
    // vault is still there: what failed was opening it.
    painel([], { notifications: [], falhou: true })
    expect(screen.getByText(strings.notifCenter.falhouNota)).toBeTruthy()
  })

  it("com a leitura boa e nada guardado, continua a ser bom sinal", () => {
    painel([], { notifications: [] })
    expect(screen.getByText(strings.notifCenter.empty)).toBeTruthy()
    expect(screen.queryByText(strings.notifCenter.falhou)).toBeNull()
  })

  it("e a lista que se viu ao vivo não tapa o aviso", () => {
    // The case that tricks you: the vault read failed, but notifications came
    // live after the app opened. The panel shows a list with three entries and the
    // person concludes that is all. They are just today's.
    painel([], { notifications: [PEDIDO], falhou: true })
    expect(screen.getByText(strings.notifCenter.falhou)).toBeTruthy()
  })

  it("sem ninguém dizer nada, não se anuncia avaria: a leitura segura é o silêncio", () => {
    painel([], { notifications: [] })
    expect(screen.queryByText(strings.notifCenter.falhou)).toBeNull()
  })
})

describe("NotificationPanel — o anel de quem fez", () => {
  it("sem `presenceFor`, sem anel; com ele, a cor do estado e o pulso", () => {
    const sem = painel([])
    expect(sem.container.querySelector("[data-anel]")).toBeNull()
    sem.unmount()

    const com = painel([], { presenceFor: () => "idle", emChamada: (quem) => quem === ANA })
    const anel = com.container.querySelector<HTMLElement>("[data-anel]")!
    expect(anel.dataset["anel"]).toBe("offline")
    expect(anel.hasAttribute("data-em-chamada")).toBe(true)
  })
})

describe("as ofertas de uma conta que passou a ser outra (fase 8.2)", () => {
  const DORA = "@dora:s"
  const montarOfertas = (directory: Map<string, { displayName: string; donations: never[] }>, onOferta = vi.fn()) => {
    render(
      <NotificationPanel
        at={{ x: 0, y: 0 }}
        notifications={[]}
        nameFor={(quem) => (quem === ANA ? "Ana" : "Sem nome")}
        labelFor={() => "lagar"}
        directory={directory as never}
        ofertas={[{ de: ANA, para: DORA, tipo: "amigo" }]}
        onOferta={onOferta}
        onOpen={() => {}}
        onMarkAllRead={() => {}}
        onClose={() => {}}
      />,
    )
    return onOferta
  }

  it('sem o perfil da principal, di-la pelo endereço, e nunca por "Sem nome"', () => {
    montarOfertas(new Map())
    expect(screen.getByText(strings.notifCenter.sucessao("Ana", DORA))).toBeTruthy()
    expect(screen.getByText(strings.notifCenter.sucessaoAdicionar(DORA))).toBeTruthy()
    expect(screen.queryByText(/Sem nome/)).toBeNull()
  })

  it("com o perfil, pelo nome; e o toque vai a quem chama", async () => {
    const onOferta = montarOfertas(new Map([[DORA, { displayName: "Dora", donations: [] }]]))
    expect(screen.getByText(strings.notifCenter.sucessaoAdicionar("Dora"))).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: strings.notifCenter.adicionar }))
    expect(onOferta).toHaveBeenCalledWith({ de: ANA, para: DORA, tipo: "amigo" }, true)
  })
})

/*
  The timeline (mockup picked by the owner on 3 November 2026): a window at
  center, filters as pills, groups by day, one icon per type.
*/
describe("o sino como linha do tempo", () => {
  const HOJE = new Date(2026, 10, 3, 14, 32).getTime()
  const LAGAR = "!lagar:s"
  const entradas: AppNotification[] = [
    { id: "m", kind: "mention", at: HOJE, actor: ANA, channel: LAGAR, read: false },
    { id: "a", kind: "friend-accept", at: HOJE - 47 * 60_000, actor: ANA, read: true },
    { id: "c", kind: "missed-call", at: HOJE - 2 * 3_600_000, actor: ANA, channel: DM, read: false },
    { id: "r", kind: "room-added", at: new Date(2026, 10, 2, 11, 7).getTime(), channel: LAGAR, read: true },
    { id: "d", kind: "dm-message", at: new Date(2026, 9, 28, 9, 0).getTime(), actor: ANA, channel: DM, read: true },
  ]

  function linhaDoTempo(handlers: Partial<Parameters<typeof NotificationPanel>[0]> = {}) {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(HOJE + 60_000)
    const props = {
      notifications: entradas,
      nameFor: () => "Ana",
      labelFor: () => "lagar",
      directory: new Map(),
      onOpen: vi.fn(),
      onMarkAllRead: vi.fn(),
      onClose: vi.fn(),
      ...handlers,
    }
    const montado = render(<NotificationPanel {...props} />)
    vi.useRealTimers()
    return { ...montado, props }
  }

  const textos = (): string[] =>
    [...document.querySelectorAll(".notif-row[data-linha] .notif-text")].map((n) => n.textContent ?? "")

  it('é uma janela com o título "Notificações", o fechar, e as cinco pílulas', async () => {
    const { props } = linhaDoTempo()
    expect(screen.getByRole("dialog", { name: strings.notifCenter.title })).toBeTruthy()
    const filtros = screen.getByRole("group", { name: strings.notifCenter.filtros })
    expect([...filtros.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      strings.notifCenter.filtroTudo,
      strings.notifCenter.filtroMencoes,
      strings.notifCenter.filtroChamadas,
      strings.notifCenter.filtroConvites,
      strings.notifCenter.filtroAmigos,
    ])
    expect(screen.getByRole("button", { name: strings.notifCenter.filtroTudo }).getAttribute("aria-pressed")).toBe("true")
    await userEvent.click(screen.getByRole("button", { name: strings.common.close }))
    expect(props.onClose).toHaveBeenCalled()
  })

  it("agrupa por Hoje, Ontem e a data, o mais recente em cima", () => {
    linhaDoTempo()
    const dias = [...document.querySelectorAll(".notif-dia-titulo")].map((n) => n.textContent)
    expect(dias.slice(0, 2)).toEqual([strings.notifCenter.hoje, strings.notifCenter.ontem])
    expect(dias).toHaveLength(3)
    expect(textos()[0]).toBe(strings.notifCenter.mention("Ana", "lagar"))
    // The time on the right.
    expect(document.querySelector(".notif-row time")?.textContent).toBe("14:32")
  })

  it('os filtros: Menções, Chamadas, Convites, Amigos; e "Tudo" leva também as mensagens privadas', async () => {
    linhaDoTempo()
    expect(textos()).toHaveLength(5)
    await userEvent.click(screen.getByRole("button", { name: strings.notifCenter.filtroMencoes }))
    expect(textos()).toEqual([strings.notifCenter.mention("Ana", "lagar")])
    await userEvent.click(screen.getByRole("button", { name: strings.notifCenter.filtroChamadas }))
    expect(textos()).toEqual([strings.notifCenter.chamadaPerdida("Ana")])
    expect(document.querySelector(".notif-evento")?.getAttribute("data-tipo")).toBe("missed-call")
    await userEvent.click(screen.getByRole("button", { name: strings.notifCenter.filtroConvites }))
    expect(textos()).toEqual([strings.notifCenter.roomAdded("lagar")])
    await userEvent.click(screen.getByRole("button", { name: strings.notifCenter.filtroAmigos }))
    expect(textos()).toEqual([strings.notifCenter.friendAccept("Ana")])
  })

  it('um filtro sem nada diz "Nada aqui."; tudo vazio diz "Estás em dia."', async () => {
    linhaDoTempo({ notifications: [entradas[0] as AppNotification] })
    await userEvent.click(screen.getByRole("button", { name: strings.notifCenter.filtroChamadas }))
    expect(screen.getByText(strings.notifCenter.filtroVazio)).toBeTruthy()
    cleanup()
    linhaDoTempo({ notifications: [] })
    expect(screen.getByText("Estás em dia.")).toBeTruthy()
  })

  it("clicar abre o sítio certo: a entrada vai a quem chama", async () => {
    const { props } = linhaDoTempo()
    await userEvent.click(screen.getByText(strings.notifCenter.chamadaPerdida("Ana")))
    expect(props.onOpen).toHaveBeenCalledWith(entradas[2])
  })

  it("um ícone por tipo, e o ponto da linha do tempo em cada acontecimento", () => {
    linhaDoTempo()
    const eventos = [...document.querySelectorAll(".notif-evento")]
    expect(eventos.every((evento) => evento.querySelector(".notif-ponto") && evento.querySelector(".notif-icone svg"))).toBe(
      true,
    )
  })

  it("teclado: o foco começa na janela, as setas andam pela lista, Home e End vão às pontas", async () => {
    linhaDoTempo()
    const janela = screen.getByRole("dialog")
    expect(janela.contains(document.activeElement)).toBe(true)
    const linhas = [...document.querySelectorAll<HTMLElement>(".notif-row[data-linha]")]
    linhas[0]?.focus()
    await userEvent.keyboard("{ArrowDown}")
    expect(document.activeElement).toBe(linhas[1])
    await userEvent.keyboard("{End}")
    expect(document.activeElement).toBe(linhas[linhas.length - 1])
    await userEvent.keyboard("{ArrowUp}")
    expect(document.activeElement).toBe(linhas[linhas.length - 2])
    await userEvent.keyboard("{Home}")
    expect(document.activeElement).toBe(linhas[0])
  })

  it("Esc fecha, e o Tab não sai da janela", async () => {
    const { props } = linhaDoTempo()
    const janela = screen.getByRole("dialog")
    for (let vez = 0; vez < 20; vez += 1) {
      await userEvent.tab()
      expect(janela.contains(document.activeElement)).toBe(true)
    }
    await userEvent.keyboard("{Escape}")
    expect(props.onClose).toHaveBeenCalled()
  })

  it("o leitor de ecrã: cada dia é uma secção com nome, e o por ler diz-se", () => {
    linhaDoTempo()
    expect(screen.getByRole("region", { name: strings.notifCenter.hoje })).toBeTruthy()
    expect(screen.getAllByText(strings.notifCenter.porLer).length).toBe(2)
  })

  it("movimento reduzido, à folha: a janela esvanece em vez de subir, e não pára", () => {
    const AQUI = dirname(fileURLToPath(import.meta.url))
    const ecras = readFileSync(join(AQUI, "../../styles/screens.css"), "utf8")
    const base = readFileSync(join(AQUI, "../../styles/base.css"), "utf8")
    const reduzido = ecras.split("@media (prefers-reduced-motion: reduce)").slice(1).join("\n")
    expect(reduzido).toMatch(/\.sheet\.notif-janela\s*\{\s*animation-name:\s*notif-esvanece/)
    const blocoBase = base.slice(base.indexOf("@media (prefers-reduced-motion: reduce)"))
    expect(blocoBase).toMatch(/\.sheet\.notif-janela\s*\{\s*animation-duration:\s*320ms\s*!important/)
  })
})

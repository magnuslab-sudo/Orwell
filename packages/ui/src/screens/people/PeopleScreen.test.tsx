import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Profile } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { shortAddress } from "../../lib/format.js"
import { strings } from "../../strings.js"
import { filterPeople, PeopleScreen } from "./PeopleScreen.js"
import { moradaDeTeste } from "../../../testes/moradas.js"

const DM_A_B = moradaDeTeste("directa a b", "s")
const DM_ME_ZOE = moradaDeTeste("directa me zoe", "s")

afterEach(cleanup)

function profile(displayName: string, statusText?: string): Profile {
  return { displayName, donations: [], ...(statusText ? { statusText } : {}) }
}

const directory = new Map<string, Profile>([
  ["@me:s", profile("Eu")],
  ["@zoe:s", profile("Zoé", "a pintar")],
  ["@ana:s", profile("Ana")],
])

/**
 * The screen lists friends and no one else, so tests must say who they are.
 * Before they did not need to: there was a second section, "Other people", that
 * caught everyone the vault knew, and a missing `friends` went unnoticed.
 */
const AMIGOS = new Set(["@zoe:s", "@ana:s"])

/**
 * The `nameFor` as the wrapper gives it, not as the test would.
 *
 * It was `(sender) => (sender === "@ana:s" ? "Ana" : sender)`, which returned
 * the raw address to everyone else. And while the screen had its own resource
 * that went unnoticed, because person rows did not read the `nameFor`. Then
 * they did, and the lie of the double appeared. This is what `useDirectory`
 * does: the published name, or the first word of the address.
 */
const nomeDoDirectorio =
  (dir: Map<string, Profile> = directory) =>
  (sender: string): string =>
    dir.get(sender)?.displayName || shortAddress(sender)

function mount(dir = directory, friends = AMIGOS): void {
  render(
    <ToastProvider>
      <PeopleScreen directory={dir} me="@me:s" friends={friends} connection="online" connectionDetail={null} />
    </ToastProvider>,
  )
}

describe("filterPeople", () => {
  it("exclui o próprio e ordena por nome", () => {
    expect(filterPeople(directory, "@me:s", "").map((p) => p.profile.displayName)).toEqual(["Ana", "Zoé"])
  })

  it("procura por nome, estado ou endereço, sem caixa", () => {
    expect(filterPeople(directory, "@me:s", "ZOÉ").map((p) => p.address)).toEqual(["@zoe:s"])
    expect(filterPeople(directory, "@me:s", "pintar").map((p) => p.address)).toEqual(["@zoe:s"])
    expect(filterPeople(directory, "@me:s", "@ana").map((p) => p.address)).toEqual(["@ana:s"])
    expect(filterPeople(directory, "@me:s", "ninguém")).toEqual([])
  })
})

describe("PeopleScreen", () => {
  it("lista quem o cofre conhece, sem o próprio", () => {
    mount()
    expect(screen.getByText("Ana")).toBeTruthy()
    expect(screen.getByText("Zoé")).toBeTruthy()
    expect(screen.getByText("a pintar")).toBeTruthy()
    expect(screen.queryByText("Eu")).toBeNull()
  })

  it("a pesquisa filtra localmente e o vazio de pesquisa diz o termo", async () => {
    const user = userEvent.setup()
    mount()

    await user.type(screen.getByPlaceholderText(strings.people.searchPlaceholder), "zo")
    expect(screen.getByText("Zoé")).toBeTruthy()
    expect(screen.queryByText("Ana")).toBeNull()

    await user.clear(screen.getByPlaceholderText(strings.people.searchPlaceholder))
    await user.type(screen.getByPlaceholderText(strings.people.searchPlaceholder), "xyz")
    expect(screen.getByText(strings.people.noMatch("xyz"))).toBeTruthy()
  })

  /**
   * A search with no results is an answer, and this screen used to show it at
   * the bottom as the lesson for someone who knows no one yet. That was the
   * account discovery pattern, for someone who just wanted to know if Manuel was
   * in the list.
   */
  it("a procura sem resultados responde, e não dá a lição de quem não conhece ninguém", async () => {
    const user = userEvent.setup()
    mount()

    await user.type(screen.getByPlaceholderText(strings.people.searchPlaceholder), "xyz")

    // Says where it looked, which is what makes the zero mean something.
    expect(screen.getByText(strings.people.noMatchBody(2))).toBeTruthy()
    // And not the text for someone who has an empty list.
    expect(screen.queryByText(strings.people.emptyBody)).toBeNull()
  })

  it("e a saída da procura é desfazê-la: a lista volta inteira", async () => {
    const user = userEvent.setup()
    mount()

    await user.type(screen.getByPlaceholderText(strings.people.searchPlaceholder), "xyz")
    expect(screen.queryByText("Ana")).toBeNull()

    await user.click(screen.getByText(strings.people.noMatchAction))

    expect(screen.getByText("Ana")).toBeTruthy()
    expect(screen.getByText("Zoé")).toBeTruthy()
    expect(screen.queryByText(strings.people.noMatch("xyz"))).toBeNull()
  })

  /**
   * A row is the name and the "…", like in the members panel.
   *
   * This list used to have two buttons just for itself: Message and Copy address.
   * The members panel had none. The same person had different rows depending on
   * where you were. Both gestures are now in the person's menu, in the order the
   * whole app follows, and the "…" opens that menu.
   */
  it('o "⋯" da linha abre o menu da pessoa, e não há botões só desta lista', async () => {
    const user = userEvent.setup()
    const onUserMenu = vi.fn()
    render(
      <ToastProvider>
        <PeopleScreen
          directory={directory}
          me="@me:s"
          friends={AMIGOS}
          connection="online"
          connectionDetail={null}
          onUserMenu={onUserMenu}
        />
      </ToastProvider>,
    )
    await user.click(screen.getByRole("button", { name: strings.people.rowMore("Ana") }))
    expect(onUserMenu).toHaveBeenCalledOnce()
    expect(onUserMenu.mock.calls[0]?.[0]).toBe("@ana:s")
    expect(screen.queryByRole("button", { name: `${strings.people.copyAddress} — Ana` })).toBeNull()
  })

  it("sem ninguém, o vazio é honesto e sem campo de pesquisa", () => {
    mount(new Map([["@me:s", profile("Eu")]]))
    expect(screen.getByText(strings.people.emptyTitle)).toBeTruthy()
    expect(screen.queryByPlaceholderText(strings.people.searchPlaceholder)).toBeNull()
  })
})

describe("PeopleScreen — pedidos de amizade e presença", () => {
  const PEDIDO_DA_ANA = {
    peer: "@ana:s",
    channel: DM_A_B,
    link: "pedido-recebido" as const,
    at: 100,
    severed: false,
  }

  it("um pedido aberto aparece em Recebidos e Aceitar devolve quem pediu", async () => {
    const user = userEvent.setup()
    const onAcceptRequest = vi.fn()
    render(
      <ToastProvider>
        <PeopleScreen
          directory={directory}
          me="@me:s"
          friends={AMIGOS}
          connection="online"
          connectionDetail={null}
          requests={[PEDIDO_DA_ANA]}
          tab="recebidos"
          nameFor={nomeDoDirectorio()}
          onAcceptRequest={onAcceptRequest}
        />
      </ToastProvider>,
    )

    expect(screen.getByText(strings.people.wantsToBeFriends("Ana"))).toBeTruthy()
    await user.click(screen.getByRole("button", { name: strings.people.accept }))
    // Who: the channel resolves in `useAmizade`, the same in all doors.
    expect(onAcceptRequest).toHaveBeenCalledExactlyOnceWith("@ana:s")
  })

  /**
   * Requests left the body, and this proves it.
   *
   * They used to be stacked at the top of "Everyone", above the friends list.
   * And since conversations landed in this destination, above the conversation
   * itself. The owner asked for them in the top banner: who counts them now is
   * the tab counter, and the body stays for what you are doing.
   *
   * Nothing was lost. A request still announces itself in three places: the
   * counter in the banner, the bell, and system notifications. The counter stays
   * in sight even with a conversation open, which is more time in front of
   * whoever is reading than this block ever was.
   */
  it("os pedidos NÃO ocupam o corpo de Amigos: vivem no separador que é deles", () => {
    const props = {
      directory,
      me: "@me:s",
      friends: AMIGOS,
      connection: "online" as const,
      connectionDetail: null,
      requests: [PEDIDO_DA_ANA],
      nameFor: nomeDoDirectorio(),
    }

    const { unmount } = render(
      <ToastProvider>
        <PeopleScreen {...props} tab="amigos" />
      </ToastProvider>,
    )
    expect(screen.queryByText(strings.people.wantsToBeFriends("Ana"))).toBeNull()
    expect(screen.queryByRole("button", { name: strings.people.accept })).toBeNull()
    // The friends list is still what "Friends" shows.
    expect(screen.getByText("Zoé")).toBeTruthy()
    unmount()

    render(
      <ToastProvider>
        <PeopleScreen {...props} tab="recebidos" />
      </ToastProvider>,
    )
    expect(screen.getByText(strings.people.wantsToBeFriends("Ana"))).toBeTruthy()
  })

  it("Recusar devolve quem pediu, e é um caminho à parte de aceitar", async () => {
    const user = userEvent.setup()
    const onAcceptRequest = vi.fn()
    const onDeclineRequest = vi.fn()
    render(
      <ToastProvider>
        <PeopleScreen
          directory={directory}
          me="@me:s"
          friends={AMIGOS}
          connection="online"
          connectionDetail={null}
          requests={[PEDIDO_DA_ANA]}
          tab="recebidos"
          nameFor={nomeDoDirectorio()}
          onAcceptRequest={onAcceptRequest}
          onDeclineRequest={onDeclineRequest}
        />
      </ToastProvider>,
    )

    await user.click(screen.getByRole("button", { name: strings.people.decline }))
    expect(onDeclineRequest).toHaveBeenCalledExactlyOnceWith("@ana:s")
    // Declining cannot grant access, and the path that would is this one.
    expect(onAcceptRequest).not.toHaveBeenCalled()
  })

  /**
   * The id is not shown, neither in the list nor in requests: you copy it.
   *
   * Order from the owner on October 27, 2026: "I do not want ids exposed". In a
   * request the address was how you knew who was knocking, and it still is: it
   * is one click away, on the button next to the name.
   */
  it('o id não aparece em texto; cada linha tem o botão "Copiar id de <nome>"', () => {
    const ENDERECO = "@milsinda-odreto-viddyvox-pofletum:orwell.pt"
    const props = {
      directory: new Map([[ENDERECO, { displayName: "Milsinda", donations: [] }]]),
      me: "@me:s",
      friends: new Set([ENDERECO]),
      connection: "online" as const,
      connectionDetail: null,
      requests: [{ ...PEDIDO_DA_ANA, peer: ENDERECO }],
      nameFor: () => "Milsinda",
    }

    for (const tab of ["amigos", "recebidos"] as const) {
      const { container, unmount } = render(
        <ToastProvider>
          <PeopleScreen {...props} tab={tab} />
        </ToastProvider>,
      )
      expect(container.textContent).not.toContain(ENDERECO)
      expect(container.querySelector(`[title="${ENDERECO}"]`)).toBeNull()
      expect(screen.getByRole("button", { name: strings.copiarId.de("Milsinda") })).toBeTruthy()
      unmount()
    }
  })

  it("enquanto a resposta não estiver dada, os dois botões ficam parados", async () => {
    // Accepting is an MLS commit and takes time. Without this, a second click,
    // or a click on "decline" in the middle of accepting, would start two
    // responses to the same request.
    const user = userEvent.setup()
    const onAcceptRequest = vi.fn()
    const onDeclineRequest = vi.fn()
    render(
      <ToastProvider>
        <PeopleScreen
          directory={directory}
          me="@me:s"
          friends={AMIGOS}
          connection="online"
          connectionDetail={null}
          requests={[PEDIDO_DA_ANA]}
          tab="recebidos"
          busy="@ana:s"
          nameFor={nomeDoDirectorio()}
          onAcceptRequest={onAcceptRequest}
          onDeclineRequest={onDeclineRequest}
        />
      </ToastProvider>,
    )

    expect(screen.getByRole("button", { name: strings.people.accepting })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: strings.people.accepting }))
    await user.click(screen.getByRole("button", { name: strings.people.decline }))
    expect(onAcceptRequest).not.toHaveBeenCalled()
    expect(onDeclineRequest).not.toHaveBeenCalled()
  })

  it("actividade recente acende o ponto verde; silêncio fica cinzento", () => {
    render(
      <ToastProvider>
        <PeopleScreen
          directory={directory}
          me="@me:s"
          friends={AMIGOS}
          connection="online"
          connectionDetail={null}
          presenceFor={(address) => (address === "@zoe:s" ? "active" : "idle")}
        />
      </ToastProvider>,
    )
    expect(screen.getAllByRole("img", { name: strings.people.presence })).toHaveLength(1)
    expect(screen.getAllByRole("img", { name: strings.people.presenceIdle })).toHaveLength(1)
  })

})

/**
 * What shows for someone who has no profile yet.
 *
 * Report from the owner on October 5, 2026, after a call with other people:
 * "there are usernames that appear as an address". This screen was the only
 * place in the app that wrote the FULL address in place of the name. The others
 * use `nameFor`, whose fallback is the first word of the address. A profile that
 * did not arrive is the normal state, not a failure: a name is something a member
 * told the group, encrypted, and may not have reached the reader.
 *
 * Built WITHOUT `nameFor` on purpose: it is the path of the local fallback,
 * which must say what the resolver above does. The gate that keeps the raw
 * address from coming back to any interface file is in `nomes.test.ts`.
 */
describe("PeopleScreen — quem ainda não tem nome", () => {
  const SEM_NOME = "@garbicis-xapsensis-giprete-birmyris:orwell.pt"

  /*
    Until November 4, 2026 this said "No name". It changed by order of the owner:
    with the wave of Reddit accounts the common channel was a column of identical
    "No name" entries. Now it is the first word of the address, subtle
    (`PersonName`), and never the full address.
  */
  it("diz a primeira palavra do endereço, discreta, e nunca o endereço inteiro", () => {
    render(
      <ToastProvider>
        <PeopleScreen
          directory={new Map([[SEM_NOME, profile("")]])}
          me="@me:s"
          friends={new Set([SEM_NOME])}
          connection="online"
          connectionDetail={null}
        />
      </ToastProvider>,
    )

    const nome = screen.getByText("Garbicis")
    expect(nome.classList.contains("nome-do-endereco")).toBe(true)
    expect(nome.getAttribute("title")).toBe(strings.profile.nomeDoEndereco)
    expect(screen.queryByText(SEM_NOME)).toBeNull()
    expect(screen.queryByText(strings.profile.noName)).toBeNull()
    // The full id is still within reach for anyone who wants it: in the copy button,
    // next to the name (order from the owner on October 27, 2026).
    expect(screen.getByRole("button", { name: strings.copiarId.de("Garbicis") })).toBeTruthy()
  })

  it('e o "⋯" da linha chama-lhe o mesmo que a linha', () => {
    render(
      <ToastProvider>
        <PeopleScreen
          directory={new Map([[SEM_NOME, profile("")]])}
          me="@me:s"
          friends={new Set([SEM_NOME])}
          connection="online"
          connectionDetail={null}
          onUserMenu={vi.fn()}
        />
      </ToastProvider>,
    )

    // An `aria-label` with the full address in it is the same defect for someone
    // listening to the screen instead of seeing it.
    expect(screen.getByRole("button", { name: strings.people.rowMore("Garbicis") })).toBeTruthy()
  })

  it("com `nameFor`, é ele que manda: um ecrã, um resolvedor", () => {
    render(
      <ToastProvider>
        <PeopleScreen
          directory={new Map([[SEM_NOME, profile("")]])}
          me="@me:s"
          friends={new Set([SEM_NOME])}
          connection="online"
          connectionDetail={null}
          nameFor={() => "Milsinda"}
        />
      </ToastProvider>,
    )

    expect(screen.getByText("Milsinda")).toBeTruthy()
    expect(screen.queryByText("garbicis")).toBeNull()
  })
})

describe("PeopleScreen — só amigos", () => {
  it("não lista quem o cofre conhece mas não é amigo", () => {
    // Sharing a room puts the profile in the vault. It does not make a friend, and
    // the Friends list cannot say yes.
    mount(directory, new Set(["@ana:s"]))
    expect(screen.getByText("Ana")).toBeTruthy()
    expect(screen.queryByText("Zoé")).toBeNull()
  })

  it("com gente conhecida e nenhum amigo, diz porquê em vez de ficar em branco", () => {
    // The normal state of any new account since the common room exists: the vault
    // fills with the profile of everyone on the server and none of those people are
    // friends. Without this, the screen would have a search field and empty space
    // below, nothing said, nothing to do, and the impression of a bug.
    mount(directory, new Set())
    expect(screen.getByText(strings.people.noFriendsTitle)).toBeTruthy()
    expect(screen.getByText(strings.people.noFriendsBody(2))).toBeTruthy()
    // A search field over nothing is noise.
    expect(screen.queryByPlaceholderText(strings.people.searchPlaceholder)).toBeNull()
  })
})

describe("PeopleScreen — Enviados, Encontrar e bloqueados", () => {
  const ENVIADO = { peer: "@zoe:s", channel: DM_ME_ZOE, link: "pedido-enviado" as const, at: Date.now() - 60_000, severed: false }
  const base = {
    directory,
    me: "@me:s",
    friends: AMIGOS,
    connection: "online" as const,
    connectionDetail: null,
    nameFor: nomeDoDirectorio(),
  }

  it('Enviados lista o nosso pedido com a data, e "Cancelar pedido" devolve quem', async () => {
    const user = userEvent.setup()
    const onCancelRequest = vi.fn()
    render(
      <ToastProvider>
        <PeopleScreen {...base} sent={[ENVIADO]} tab="enviados" onCancelRequest={onCancelRequest} />
      </ToastProvider>,
    )
    expect(screen.getByText("Zoé")).toBeTruthy()
    expect(document.querySelector(".person-status time")?.textContent).toMatch(/^Enviado /)
    await user.click(screen.getByRole("button", { name: strings.people.cancelRequest }))
    expect(onCancelRequest).toHaveBeenCalledExactlyOnceWith("@zoe:s")
  })

  it("Enviados vazio diz que não há nada à espera", () => {
    render(
      <ToastProvider>
        <PeopleScreen {...base} tab="enviados" />
      </ToastProvider>,
    )
    expect(screen.getByText(strings.people.sentEmptyTitle)).toBeTruthy()
  })

  it("Encontrar mostra o meu QR e o meu link de amizade", () => {
    render(
      <ToastProvider>
        <PeopleScreen {...base} tab="encontrar" />
      </ToastProvider>,
    )
    expect(screen.getByRole("img", { name: strings.people.myQrAlt })).toBeTruthy()
    const link = screen.getByLabelText(strings.people.myLink) as HTMLInputElement
    // The short form for 1.0 (`/a#<id>`): the server is the one from the connection.
    expect(link.value).toBe("https://s/a#me")
    expect(screen.getByRole("button", { name: strings.people.copyLink })).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.people.scanQr })).toBeTruthy()
  })

  it("colar um link de amizade ou um endereço abre o perfil dessa pessoa", async () => {
    const user = userEvent.setup()
    const onOpenProfile = vi.fn()
    render(
      <ToastProvider>
        <PeopleScreen {...base} tab="encontrar" onOpenProfile={onOpenProfile} />
      </ToastProvider>,
    )
    const campo = screen.getByLabelText(strings.people.pasteLabel)
    await user.type(campo, "https://orwell.pt/app/amigo#@rui:orwell.pt")
    await user.click(screen.getByRole("button", { name: strings.people.pasteOpen }))
    expect(onOpenProfile).toHaveBeenLastCalledWith("@rui:orwell.pt")

    await user.type(campo, "@ana:s")
    await user.click(screen.getByRole("button", { name: strings.people.pasteOpen }))
    expect(onOpenProfile).toHaveBeenLastCalledWith("@ana:s")

    // And the short form, stuck before or after the redirect.
    await user.type(campo, "https://orwell.pt/a#rui")
    await user.click(screen.getByRole("button", { name: strings.people.pasteOpen }))
    expect(onOpenProfile).toHaveBeenLastCalledWith("@rui:orwell.pt")
    await user.type(campo, "https://orwell.pt/app/a#lia")
    await user.click(screen.getByRole("button", { name: strings.people.pasteOpen }))
    expect(onOpenProfile).toHaveBeenLastCalledWith("@lia:orwell.pt")
  })

  it("o que não é link nem endereço diz-se, e não abre nada", async () => {
    const user = userEvent.setup()
    const onOpenProfile = vi.fn()
    render(
      <ToastProvider>
        <PeopleScreen {...base} tab="encontrar" onOpenProfile={onOpenProfile} />
      </ToastProvider>,
    )
    await user.type(screen.getByLabelText(strings.people.pasteLabel), "!canal:s")
    await user.click(screen.getByRole("button", { name: strings.people.pasteOpen }))
    expect(screen.getByRole("alert").textContent).toBe(strings.people.pasteInvalid)
    expect(onOpenProfile).not.toHaveBeenCalled()
  })

  it("quem está bloqueado não aparece em separador nenhum", () => {
    const bloqueados = new Set(["@zoe:s"])
    const { unmount } = render(
      <ToastProvider>
        <PeopleScreen {...base} bloqueados={bloqueados} tab="amigos" />
      </ToastProvider>,
    )
    expect(screen.queryByText("Zoé")).toBeNull()
    expect(screen.getByText("Ana")).toBeTruthy()
    unmount()
    render(
      <ToastProvider>
        <PeopleScreen {...base} bloqueados={bloqueados} sent={[ENVIADO]} tab="enviados" />
      </ToastProvider>,
    )
    expect(screen.queryByText("Zoé")).toBeNull()
    expect(screen.getByText(strings.people.sentEmptyTitle)).toBeTruthy()
  })

  it("filterPeople tira os bloqueados", () => {
    expect(filterPeople(directory, "@me:s", "", new Set(["@ana:s"])).map((p) => p.address)).toEqual(["@zoe:s"])
  })
})

/**
 * The personal message, when it does not fit, flows as a footer (the `Andante`)
 * instead of cutting with ellipsis (owner, October 28 2026). Without a message,
 * the `&nbsp;` always holds the line height.
 */
describe("PeopleScreen — a mensagem pessoal que não cabe", () => {
  it("num DOM sem larguras, uma cópia só; sem larguras que cheguem, duas, e anda", () => {
    mount()
    const daZoe = [...document.querySelectorAll(".person-status")].find((e) => e.textContent?.includes("a pintar"))!
    expect(daZoe.querySelectorAll(".andante-fita > span")).toHaveLength(1)
    expect(daZoe.classList.contains("andante")).toBe(false)
    // Ana has no message: the space that holds the line, without the banner.
    const vazios = [...document.querySelectorAll(".person-status")].filter((e) => e.textContent === " ")
    expect(vazios.length).toBeGreaterThan(0)
    expect(vazios[0]?.querySelector(".andante-fita")).toBeNull()
    cleanup()

    const largo = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(400)
    const estreito = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(120)
    try {
      mount()
      const anda = [...document.querySelectorAll(".person-status")].find((e) => e.textContent?.includes("a pintar"))!
      expect(anda.classList.contains("andante")).toBe(true)
      expect(anda.querySelectorAll(".andante-fita > span")).toHaveLength(2)
    } finally {
      largo.mockRestore()
      estreito.mockRestore()
    }
  })
})

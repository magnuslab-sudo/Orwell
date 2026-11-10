import { afterEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { BridgeContext } from "../../App.js"
import { Modal } from "../../components/Modal.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { PersonProfile } from "./PersonProfile.js"
import { moradaDeTeste } from "../../../testes/moradas.js"

const MURAL_ANA = moradaDeTeste("mural ana", "s")

afterEach(cleanup)

const ana: Profile = { displayName: "Ana", donations: [], bio: "faz fotografia", statusText: "por aí" }

const socialMock = {
  react: vi.fn().mockResolvedValue({ ok: true }),
  comment: vi.fn().mockResolvedValue({ ok: true }),
  removeComment: vi.fn().mockResolvedValue({ ok: true }),
}
const bridge = { social: socialMock } as unknown as EnclaveBridge

function post(id: string, payload: Partial<ChatMessage["payload"]>): ChatMessage {
  return { channel: MURAL_ANA, seq: 1, sender: "@ana:s", payload: { t: "post", id, postedAt: 1, ...payload } }
}

type Props = React.ComponentProps<typeof PersonProfile>

/**
 * The page with the stack at small scale: the open post lives here, as it
 * does in the shell. Going back with an open post closes it; without one, calls
 * the `onBack` of the test harness.
 */
function Pagina({ onBack, ...props }: Omit<Props, "aberta" | "onAbrirPublicacao">): React.JSX.Element {
  const [aberta, setAberta] = useState<ChatMessage | null>(null)
  return (
    <PersonProfile
      {...props}
      aberta={aberta}
      onAbrirPublicacao={setAberta}
      onBack={() => (aberta ? setAberta(null) : onBack())}
    />
  )
}

function mount(overrides: Partial<Omit<Props, "aberta" | "onAbrirPublicacao">> = {}): void {
  render(
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <Pagina
          address="@ana:s"
          name="Ana"
          profile={ana}
          posts={[]}
          /* The entire thread. Without votes or comments it is the same as posts;
             whoever measures them passes it to the part. */
          messages={overrides.posts ?? []}
          me="@me:s"
          directory={new Map()}
          nameFor={(sender) => (sender === "@ana:s" ? "Ana" : sender)}
          onMessage={() => {}}
          onBack={() => {}}
          {...overrides}
        />
      </ToastProvider>
    </BridgeContext.Provider>,
  )
}

const separador = (nome: string): HTMLElement => screen.getByRole("tab", { name: new RegExp(nome) })

describe("PersonProfile — uma página e não uma folha", () => {
  it("é uma região principal com o nome da pessoa, e não um diálogo", () => {
    mount()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.getByRole("main", { name: strings.personProfile.title("Ana") })).toBeTruthy()
    expect(screen.getByRole("heading", { level: 1, name: "Ana" })).toBeTruthy()
  })

  it("o foco vai para o título ao abrir", () => {
    mount()
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Ana" }))
  })

  it("a seta do cabeçalho volta", async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    mount({ onBack })
    await user.click(screen.getByRole("button", { name: strings.personProfile.backFromPage }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it("o Escape volta, mas não quando há uma folha ou um menu por cima", async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    mount({ onBack, menu: [{ label: strings.social.copyAuthor, onSelect: () => {} }] })
    await user.keyboard("{Escape}")
    expect(onBack).toHaveBeenCalledOnce()

    // With the "⋯" open, Escape closes the menu and the page stays.
    await user.click(screen.getByRole("button", { name: strings.userMenu.more("Ana") }))
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("menu")).toBeNull()
    expect(onBack).toHaveBeenCalledOnce()
  })

  it("com uma folha da casa aberta por cima, o Escape é da folha", async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    const fecharFolha = vi.fn()
    mount({ onBack })
    render(
      <Modal className="sheet" labelledBy="t" onClose={fecharFolha}>
        <h2 id="t">folha</h2>
      </Modal>,
    )
    await user.keyboard("{Escape}")
    expect(fecharFolha).toHaveBeenCalledOnce()
    expect(onBack).not.toHaveBeenCalled()
  })

  it("três separadores, numa lista de separadores com nome, e as setas andam entre eles", async () => {
    const user = userEvent.setup()
    mount()
    const lista = screen.getByRole("tablist", { name: strings.personProfile.tabsLabel("Ana") })
    expect(within(lista).getAllByRole("tab").map((tab) => tab.textContent?.replace(/\d+$/, ""))).toEqual([
      strings.personProfile.postsTab,
      strings.personProfile.friendsTab,
      strings.personProfile.sharedTab,
    ])
    separador(strings.personProfile.postsTab).focus()
    await user.keyboard("{ArrowRight}")
    expect(separador(strings.personProfile.friendsTab).getAttribute("aria-selected")).toBe("true")
    expect(document.activeElement).toBe(separador(strings.personProfile.friendsTab))
    await user.keyboard("{ArrowLeft}{ArrowLeft}")
    expect(separador(strings.personProfile.sharedTab).getAttribute("aria-selected")).toBe("true")
  })
})

describe("PersonProfile — o que se sabe da pessoa", () => {
  it("mostra o nome, o estado, a biografia e a presença; o id não se lê, copia-se", async () => {
    // After `setup`: it is the one that sets up the fake clipboard.
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, "writeText")
    mount({ presenca: "busy" })
    expect(screen.getByText("faz fotografia")).toBeTruthy()
    expect(screen.getByText("por aí")).toBeTruthy()
    expect(screen.getByText(strings.people.presenceBusy)).toBeTruthy()
    // "I do not want the ids exposed" (owner order on 27 October 2026).
    expect(document.body.textContent).not.toContain("@ana:s")
    const copiar = screen.getByRole("button", { name: strings.copiarId.de("Ana") })
    expect(copiar.getAttribute("title")).toBe(strings.copiarId.de("Ana"))
    await user.click(copiar)
    expect(writeText).toHaveBeenCalledWith("@ana:s")
    expect(await screen.findByText(strings.copiarId.copiado)).toBeTruthy()
  })

  it("os links dela vêem-se em texto, nunca em link", () => {
    mount({ profile: { ...ana, donations: [{ kind: "IBAN", label: "a horta", value: "PT50 0000" }] } })
    expect(screen.getByText("PT50 0000").tagName).toBe("CODE")
    expect(document.querySelector(".pessoa-links a")).toBeNull()
  })

  it("as publicações da pessoa aparecem em lista, como no perfil próprio, com a conta no separador", () => {
    mount({ posts: [post("p1", { title: "Serra de São Mamede" }), post("p2", { caption: "só palavras" })] })

    // The same layout: one line per post, with the name it has.
    expect(screen.getByRole("button", { name: /Serra de São Mamede/ })?.classList.contains("post-row")).toBe(true)
    expect(separador(strings.personProfile.postsTab).textContent).toContain("2")
    expect(document.querySelectorAll(".post-list").length).toBe(1)
  })

  it("clicar numa publicação abre-a na mesma página, e volta-se de lá", async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    mount({ onBack, posts: [post("p1", { title: "Serra de São Mamede", caption: "fomos lá acima" })] })

    await user.click(screen.getByRole("button", { name: /Serra de São Mamede/ }))
    expect(screen.getByText("fomos lá acima")).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()

    await user.click(screen.getByRole("button", { name: strings.personProfile.back }))
    expect(screen.getByRole("button", { name: /Serra de São Mamede/ })).toBeTruthy()
    // The arrow closed the post, not the page.
    expect(onBack).not.toHaveBeenCalled()
  })
})

/**
 * The difference that cannot be blurred.
 *
 * The own profile screen has editing; this one cannot have any path to it.
 * Posts use the same layout, and the edit button enters through a slot that
 * this page does not have.
 */
describe("PersonProfile — nada é editável", () => {
  it("não há botão de editar em lado nenhum, nem com publicações abertas", async () => {
    const user = userEvent.setup()
    mount({ posts: [post("p1", { title: "Serra de São Mamede" })] })

    expect(screen.queryByText(strings.profile.editProfile)).toBeNull()
    await user.click(screen.getByRole("button", { name: /Serra de São Mamede/ }))
    expect(screen.queryByText(strings.profile.editProfile)).toBeNull()
  })

  it("o vazio não oferece 'Nova publicação': não há nada a publicar em casa alheia", () => {
    mount({ posts: [] })
    expect(screen.queryByText(strings.profile.newPost)).toBeNull()
  })
})

/**
 * We show only what this device already has.
 *
 * There is no way to fetch from the server the profile of someone we have never
 * crossed paths with, and there should not be. Missing data is what it is; we
 * do not show it as though the person has nothing.
 */
describe("PersonProfile — o que este dispositivo não sabe", () => {
  it("sem perfil chegado, di-lo e explica que não há a quem perguntar", () => {
    mount({ profile: undefined, name: strings.profile.noName })

    expect(screen.getByText(strings.personProfile.unknown)).toBeTruthy()
    // What we really know is the id, and that gets copied: it does not get read.
    expect(screen.getByRole("button", { name: strings.copiarId.de(strings.profile.noName) })).toBeTruthy()
    expect(document.body.textContent).not.toContain("@ana:s")
  })

  it("com perfil chegado, a nota não aparece", () => {
    mount()
    expect(screen.queryByText(strings.personProfile.unknown)).toBeNull()
  })

  it("sem publicações, o vazio diz o que fazer a seguir", () => {
    mount({ posts: [] })

    expect(screen.getByText(strings.personProfile.emptyTitle)).toBeTruthy()
    const corpo = screen.getByText(strings.personProfile.emptyBody).textContent ?? ""
    // The empty state points to the button that requests the posts, by the name it has.
    expect(corpo).toContain(strings.personProfile.askPosts)
  })
})

describe("PersonProfile — o que se faz a seguir", () => {
  it("Mensagem está sempre, e é o primário", async () => {
    const user = userEvent.setup()
    const onMessage = vi.fn()
    mount({ onMessage })
    const botao = screen.getByRole("button", { name: strings.personProfile.message })
    expect(botao.classList.contains("primary")).toBe(true)
    await user.click(botao)
    expect(onMessage).toHaveBeenCalledOnce()
  })

  it('Verificar e Convidar vivem no "⋯", e só quando há quem os dê', async () => {
    const user = userEvent.setup()
    const onVerify = vi.fn()
    const onInvite = vi.fn()
    mount()
    // Without a channel there is no security number to calculate, and without gestures there is no "⋯".
    expect(screen.queryByRole("button", { name: strings.userMenu.more("Ana") })).toBeNull()

    cleanup()
    mount({ onVerify, onInvite })
    await user.click(screen.getByRole("button", { name: strings.userMenu.more("Ana") }))
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      strings.userMenu.inviteToRoom,
      strings.members.verifyHint("Ana"),
    ])
    await user.click(screen.getByRole("menuitem", { name: strings.members.verifyHint("Ana") }))
    expect(onVerify).toHaveBeenCalledOnce()
    await user.click(screen.getByRole("button", { name: strings.userMenu.more("Ana") }))
    await user.click(screen.getByRole("menuitem", { name: strings.userMenu.inviteToRoom }))
    expect(onInvite).toHaveBeenCalledOnce()
  })
})

/**
 * A post from someone else can also be voted on and commented.
 *
 * It is the same `PostDetail` from the own profile, and the reason it is here
 * again is that the two screens could diverge without anything warning.
 */
describe("PersonProfile — a publicação aberta traz gostos e comentários", () => {
  const publicacao = post("p1", { title: "Serra de São Mamede", caption: "fomos lá acima" })

  const voto = (id: string, quem: string, emoji: string): ChatMessage => ({
    channel: MURAL_ANA,
    seq: 2,
    sender: quem,
    payload: { t: "post.reaction", id, target: "p1", emoji, at: 10 },
  })

  const comentario = (id: string, quem: string, body: string): ChatMessage => ({
    channel: MURAL_ANA,
    seq: 3,
    sender: quem,
    payload: { t: "post.comment", id, target: "p1", body, postedAt: 20 },
  })

  it("os polegares e os comentários da pessoa vêem-se na página dela", async () => {
    const user = userEvent.setup()
    mount({
      posts: [publicacao],
      messages: [publicacao, voto("r1", "@rui:s", "👍"), comentario("c1", "@ana:s", "estava frio")],
    })

    await user.click(screen.getByRole("button", { name: /Serra de São Mamede/ }))
    const pagina = screen.getByRole("main")
    expect(within(pagina).getByRole("button", { name: strings.social.like }).textContent).toContain("1")

    await user.click(within(pagina).getByRole("button", { name: strings.social.commentsToggle(1) }))
    expect(within(pagina).getByText("estava frio")).toBeTruthy()
  })

  it("voltar ao perfil recolhe os polegares com a publicação", async () => {
    const user = userEvent.setup()
    mount({ posts: [publicacao], messages: [publicacao] })

    await user.click(screen.getByRole("button", { name: /Serra de São Mamede/ }))
    expect(document.querySelector(".post-engagement")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: strings.personProfile.back }))
    expect(document.querySelector(".post-engagement")).toBeNull()
    expect(screen.getByRole("button", { name: /Serra de São Mamede/ })).toBeTruthy()
  })
})

describe("PersonProfile — a fotografia abre-se em grande", () => {
  const FOTO = "data:image/png;base64,AAAA"
  const OUTRA = "data:image/png;base64,BBBB"
  const comFoto = post("p1", {
    caption: "a serra ao fim da tarde",
    media: [{ inline: FOTO, name: "cabeco.png", mediaType: "image/png" }],
  })
  const comDuas = post("p2", {
    caption: "a serra de manhã",
    media: [
      { inline: FOTO, name: "cabeco.png", mediaType: "image/png" },
      { inline: OUTRA, name: "azinheira.png", mediaType: "image/png" },
    ],
  })

  const emPalco = (): string | null | undefined =>
    document.querySelector(".post-open-palco img")?.getAttribute("src")

  it("a fotografia toma o palco, e as palavras ficam ao lado", async () => {
    const user = userEvent.setup()
    mount({ posts: [comFoto], messages: [comFoto] })

    await user.click(screen.getByRole("button", { name: /a serra ao fim da tarde/ }))

    const lado = document.querySelector<HTMLElement>(".post-open-lado")
    expect(document.querySelector(".post-open-palco")).toBeTruthy()
    expect(lado).toBeTruthy()
    expect(emPalco()).toBe(FOTO)
    if (lado) expect(within(lado).getByText("a serra ao fim da tarde")).toBeTruthy()
  })

  it("e passa-se de uma fotografia para a outra", async () => {
    const user = userEvent.setup()
    mount({ posts: [comDuas], messages: [comDuas] })

    await user.click(screen.getByRole("button", { name: /a serra de manhã/ }))
    await user.click(screen.getByRole("button", { name: strings.social.imageNext }))

    expect(emPalco()).toBe(OUTRA)
  })

  it("Escape fecha a ampliação e deixa a publicação onde estava", async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    mount({ posts: [comFoto], messages: [comFoto], onBack })

    await user.click(screen.getByRole("button", { name: /a serra ao fim da tarde/ }))
    await user.click(screen.getByRole("button", { name: "cabeco.png" }))
    expect(document.querySelector(".lightbox img")?.getAttribute("src")).toBe(FOTO)
    await user.keyboard("{Escape}")

    expect(document.querySelector(".lightbox")).toBeNull()
    // The expansion was a dialog: the key belonged to it, and the post stays.
    expect(emPalco()).toBe(FOTO)
    expect(onBack).not.toHaveBeenCalled()
  })
})

/**
 * The button that requests the posts again.
 *
 * The button appears only when there is someone to ask (the detector decides,
 * in the shell: see `feedDaPessoa` in `App.tsx`), and the tooltip says what
 * this brings and what it does NOT bring.
 */
describe("PersonProfile — o estado de sincronia do feed dela", () => {
  it("sem nada a pedir, não há botão: o que não dá não aparece", () => {
    mount()
    expect(screen.queryByRole("button", { name: strings.personProfile.askPosts })).toBeNull()
  })

  it('sem publicações, o marcador vazio traz "Pedir as publicações"', async () => {
    const user = userEvent.setup()
    const onAskPosts = vi.fn()
    mount({ onAskPosts })
    expect(screen.getByText(strings.personProfile.emptyTitle)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: strings.personProfile.askPosts }))
    expect(onAskPosts).toHaveBeenCalledOnce()
  })

  it("com publicações à vista e o feed surdo, a linha diz porquê, e a dica promete só as últimas 30", () => {
    mount({ onAskPosts: () => {}, posts: [post("p1", { body: "uma publicação" })] })
    expect(screen.getByText(strings.personProfile.deafNote("Ana"))).toBeTruthy()
    const dica = screen.getByRole("button", { name: strings.personProfile.askPosts }).getAttribute("title") ?? ""
    expect(dica).toContain("30")
    expect(dica).toBe(strings.personProfile.askPostsHint("Ana"))
  })
})

/** The single friendship button, and the page as a superset of the person menu. */
describe("PersonProfile — a amizade num botão só", () => {
  function amizade(
    estado: "amigos" | "pedido-enviado" | "pedido-recebido" | "nenhum",
    over: Partial<NonNullable<Props["amizade"]>> = {},
  ): NonNullable<Props["amizade"]> {
    return { estado, pedir: vi.fn(), aceitar: vi.fn(), recusar: vi.fn(), desfazer: vi.fn(), ...over }
  }

  it('sem pedido, "Pedir amizade" leva a nota escrita, e a nota limpa-se depois', async () => {
    const user = userEvent.setup()
    const pedir = vi.fn(async () => true)
    mount({ amizade: amizade("nenhum", { pedir }) })
    await user.type(screen.getByLabelText(strings.userMenu.noteLabel), "sou do lagar")
    await user.click(screen.getByRole("button", { name: strings.userMenu.friend }))
    expect(pedir).toHaveBeenCalledExactlyOnceWith("sou do lagar")
    await vi.waitFor(() =>
      expect((screen.getByLabelText(strings.userMenu.noteLabel) as HTMLInputElement).value).toBe(""),
    )
  })

  it("o Escape num campo com texto não sai da página", async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    mount({ onBack, amizade: amizade("nenhum") })
    await user.type(screen.getByLabelText(strings.userMenu.noteLabel), "sou do lagar")
    await user.keyboard("{Escape}")
    expect(onBack).not.toHaveBeenCalled()
  })

  it('com o nosso pedido à espera, diz "Pedido enviado" e não é botão', () => {
    mount({ amizade: amizade("pedido-enviado") })
    expect(screen.getByText(strings.userMenu.friendPending)).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.userMenu.friendPending })).toBeNull()
    expect(screen.queryByRole("button", { name: strings.userMenu.friend })).toBeNull()
    expect(screen.queryByLabelText(strings.userMenu.noteLabel)).toBeNull()
  })

  it("com o pedido dela à espera, o cartão de sempre com Aceitar e Recusar", async () => {
    const user = userEvent.setup()
    const aceitar = vi.fn()
    const recusar = vi.fn()
    mount({ amizade: amizade("pedido-recebido", { aceitar, recusar, nota: "do lagar" }) })
    const cartao = screen.getByText(strings.people.wantsToBeFriends("Ana")).closest(".pedido-card") as HTMLElement
    expect(within(cartao).getByText("do lagar")).toBeTruthy()
    await user.click(within(cartao).getByRole("button", { name: strings.people.accept }))
    await user.click(within(cartao).getByRole("button", { name: strings.people.decline }))
    expect(aceitar).toHaveBeenCalledOnce()
    expect(recusar).toHaveBeenCalledOnce()
  })

  it('amigos: "Amigos" abre um menu com "Desfazer amizade"', async () => {
    const user = userEvent.setup()
    const desfazer = vi.fn()
    mount({ amizade: amizade("amigos", { desfazer }) })
    const amigos = screen.getByRole("button", { name: strings.userMenu.friendsNow })
    expect(amigos.getAttribute("title")).toBe(strings.userMenu.friendsMenu("Ana"))
    await user.click(amigos)
    await user.click(screen.getByRole("menuitem", { name: strings.people.unfriend }))
    expect(desfazer).toHaveBeenCalledOnce()
  })

  it("Chamada aparece só quando há quem a dê", async () => {
    const user = userEvent.setup()
    const onCall = vi.fn()
    mount({ onCall })
    await user.click(screen.getByRole("button", { name: strings.userMenu.call }))
    expect(onCall).toHaveBeenCalledOnce()
    cleanup()
    mount()
    expect(screen.queryByRole("button", { name: strings.userMenu.call })).toBeNull()
  })

  it('o "⋯" abre o resto do menu da pessoa, pela mesma ordem', async () => {
    const user = userEvent.setup()
    const expulsar = vi.fn()
    mount({
      menu: [
        { label: strings.social.copyAuthor, onSelect: () => {} },
        { label: strings.userMenu.expel, destructive: true, separatorBefore: true, onSelect: expulsar },
      ],
    })
    await user.click(screen.getByRole("button", { name: strings.userMenu.more("Ana") }))
    const itens = screen.getAllByRole("menuitem").map((item) => item.textContent)
    expect(itens).toEqual([strings.social.copyAuthor, strings.userMenu.expel])
    await user.click(screen.getByRole("menuitem", { name: strings.userMenu.expel }))
    expect(expulsar).toHaveBeenCalledOnce()
  })
})

describe("PersonProfile — cancelar, bloqueio, amigos e canais em comum", () => {
  const gestos = {
    pedir: vi.fn(),
    aceitar: vi.fn(),
    recusar: vi.fn(),
    desfazer: vi.fn(),
  }

  it('com o pedido enviado, "Cancelar pedido" chama o cancelar', async () => {
    const user = userEvent.setup()
    const cancelar = vi.fn()
    mount({ amizade: { estado: "pedido-enviado", ...gestos, cancelar } })
    expect(screen.getByRole("status").textContent).toBe(strings.userMenu.friendPending)
    await user.click(screen.getByRole("button", { name: strings.people.cancelRequest }))
    expect(cancelar).toHaveBeenCalledOnce()
  })

  it("bloqueada, a página não oferece Mensagem nem amizade, e diz que está bloqueada", () => {
    mount({ bloqueado: true, amizade: { estado: "nenhum", ...gestos } })
    expect(screen.queryByRole("button", { name: strings.personProfile.message })).toBeNull()
    expect(screen.queryByRole("button", { name: strings.userMenu.friend })).toBeNull()
    expect(screen.getByRole("status").textContent).toBe(strings.people.blockedState)
  })

  it("a lista que a pessoa mostra está no separador Amigos, sem realce de ninguém", async () => {
    const user = userEvent.setup()
    const onOpenAmigo = vi.fn()
    mount({
      posts: [post("p1", { caption: "só palavras" })],
      amigosMostrados: [
        { address: "@rui:s", nome: "Rui" },
        { address: "@me:s", nome: "Eu" },
      ],
      onOpenAmigo,
    })
    await user.click(separador(strings.personProfile.friendsTab))
    const lista = screen.getByRole("list", { name: strings.personProfile.friendsListLabel("Ana") })
    expect(within(lista).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Rui", "Eu"])
    // No shared channels: no line bears a mark of "also your friend".
    expect(lista.querySelector(".on, .comum, mark")).toBeNull()
    await user.click(within(lista).getByRole("button", { name: "Rui" }))
    expect(onOpenAmigo).toHaveBeenCalledWith("@rui:s")
  })

  it("sem publicações e com lista, o separador Amigos abre sozinho", () => {
    mount({ amigosMostrados: [{ address: "@rui:s", nome: "Rui" }] })
    expect(separador(strings.personProfile.friendsTab).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByText("Rui")).toBeTruthy()
  })

  it("sem lista mostrada, o separador Amigos diz porquê", async () => {
    const user = userEvent.setup()
    mount({ amigosMostrados: null, amizade: { estado: "amigos", ...gestos } })
    await user.click(separador(strings.personProfile.friendsTab))
    expect(screen.getByText(strings.personProfile.friendsHidden("Ana"))).toBeTruthy()
    cleanup()
    mount({ amigosMostrados: null, amizade: { estado: "nenhum", ...gestos } })
    await user.click(separador(strings.personProfile.friendsTab))
    expect(screen.getByText(strings.personProfile.friendsOnlyFriends("Ana"))).toBeTruthy()
  })

  it("Em comum lista os canais partilhados, e abrir um leva lá", async () => {
    const user = userEvent.setup()
    const onAbrirCanal = vi.fn()
    mount({ canaisEmComum: [{ channel: "!lagar:s", nome: "Lagar" }], onAbrirCanal })
    await user.click(separador(strings.personProfile.sharedTab))
    const lista = screen.getByRole("list", { name: strings.personProfile.sharedListLabel("Ana") })
    await user.click(within(lista).getByRole("button", { name: "Lagar" }))
    expect(onAbrirCanal).toHaveBeenCalledWith("!lagar:s")
  })

  it("Em comum diz quando está a procurar e quando não há nenhum", async () => {
    const user = userEvent.setup()
    mount({ canaisEmComum: null })
    await user.click(separador(strings.personProfile.sharedTab))
    expect(screen.getByText(strings.personProfile.sharedLoading)).toBeTruthy()
    cleanup()
    mount({ canaisEmComum: [] })
    await user.click(separador(strings.personProfile.sharedTab))
    expect(screen.getByText(strings.personProfile.sharedEmpty)).toBeTruthy()
  })
})

/**
 * "When I tap someone's image in a room I go straight to their profile, I want
 * to come back" (owner, 27 October 2026). The button already existed, just with
 * the arrow.
 */
describe('PersonProfile — "Voltar" à vista', () => {
  it('a barra de cima tem a seta E a palavra "Voltar", com o mesmo nome acessível', () => {
    mount()
    const voltar = screen.getByRole("button", { name: strings.personProfile.backFromPage })
    expect(voltar.classList.contains("pessoa-voltar")).toBe(true)
    expect(voltar.closest(".pessoa-topo")).not.toBeNull()
    expect(voltar.textContent).toBe(strings.personProfile.backFromPage)
    expect(voltar.querySelector("svg")).not.toBeNull()
  })

  it('com uma publicação aberta diz "Voltar" à vista, e o nome acessível diz para onde', async () => {
    const user = userEvent.setup()
    mount({ posts: [post("p1", { title: "Serra de São Mamede" })] })
    await user.click(screen.getByRole("button", { name: /Serra de São Mamede/ }))
    const voltar = screen.getByRole("button", { name: strings.personProfile.back })
    expect(voltar.textContent).toBe(strings.personProfile.backFromPage)
    // The accessible name starts with the word you see (WCAG 2.5.3).
    expect(strings.personProfile.back.startsWith(strings.personProfile.backFromPage)).toBe(true)
  })
})

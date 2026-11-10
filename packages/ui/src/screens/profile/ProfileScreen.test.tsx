import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { BridgeContext } from "../../App.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { ProfileScreen } from "./ProfileScreen.js"
import { moradaDeTeste } from "../../../testes/moradas.js"

const MURAL_ME = moradaDeTeste("mural me", "s")

afterEach(cleanup)

const socialMock = {
  react: vi.fn().mockResolvedValue({ ok: true }),
  comment: vi.fn().mockResolvedValue({ ok: true }),
  removeComment: vi.fn().mockResolvedValue({ ok: true }),
}
const bridge = { social: socialMock } as unknown as EnclaveBridge

function post(id: string, payload: Partial<ChatMessage["payload"]>): ChatMessage {
  return { channel: MURAL_ME, seq: 1, sender: "@me:s", payload: { t: "post", id, postedAt: 1, ...payload } }
}

/**
 * `messages` is the entire thread and `posts` are only publications. By default they are
 * the same thing, a profile with no votes or comments, and whoever is counting thumbs
 * passes the thread to the part.
 */
function mount(posts: ChatMessage[], messages: ChatMessage[] = posts): void {
  render(
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <ProfileScreen
          profile={{ displayName: "Eu", donations: [] }}
          address="@me:s"
          posts={posts}
          messages={messages}
          directory={new Map()}
          nameFor={(sender) => (sender === "@ana:s" ? "Ana" : sender)}
          onCompose={() => {}}
          onEdit={() => {}}
          connection="online"
          connectionDetail={null}
        />
      </ToastProvider>
    </BridgeContext.Provider>,
  )
}

describe("ProfileScreen — publicações por tipo", () => {
  const posts = [
    post("p1", { media: [{ inline: "data:image/png;base64,AAAA" }] }),
    post("p2", { caption: "só palavras" }),
    post("p3", { caption: "outro texto" }),
    post("p4", { links: [{ url: "https://x.pt", kind: "link" }], caption: "com link" }),
  ]

  it("os separadores contam por tipo e o primeiro com conteúdo abre por omissão", () => {
    mount(posts)
    const fotos = screen.getByRole("tab", { name: `${strings.profile.kindPhotos} 1` })
    expect(fotos.getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("tab", { name: `${strings.profile.kindText} 2` })).toBeTruthy()
    expect(screen.getByRole("tab", { name: `${strings.profile.kindLinks} 1` })).toBeTruthy()
  })

  it("mudar de separador filtra a grelha", async () => {
    const user = userEvent.setup()
    mount(posts)

    await user.click(screen.getByRole("tab", { name: `${strings.profile.kindText} 2` }))
    expect(screen.getByText("só palavras")).toBeTruthy()
    expect(screen.getByText("outro texto")).toBeTruthy()
    expect(screen.queryByText("com link")).toBeNull()

    await user.click(screen.getByRole("tab", { name: `${strings.profile.kindLinks} 1` }))
    expect(screen.getByText("com link")).toBeTruthy()
    expect(screen.queryByText("só palavras")).toBeNull()
  })

  it("sem publicações não há separadores, só o vazio", () => {
    mount([])
    expect(screen.queryByRole("tab")).toBeNull()
    expect(screen.getByText(strings.profile.emptyTitle)).toBeTruthy()
  })
})

/**
 * Each presentation for what it is used for.
 *
 * The grid gave a square to ALL publications, and text ones ended up being one word
 * cut in the middle pretending to be a photo. Everything switched to list, and there
 * photos became 56px thumbnails next to a date.
 *
 * The answer is not one of the two: it is both, chosen by content. Sections of text,
 * links and files stay in list, which is what these tests lock in; the photos section
 * goes to grid, right after.
 */
describe("ProfileScreen — o que não é fotografia fica em lista", () => {
  it("cada publicação é uma linha com o título que lhe foi dado", async () => {
    const user = userEvent.setup()
    mount([post("p1", { title: "Serra de São Mamede", caption: "fomos lá acima" })])

    const linha = screen.getByRole("button", { name: /Serra de São Mamede/ })
    expect(linha.classList.contains("post-row")).toBe(true)
    // And not the grid, which is what this replaced.
    expect(document.querySelector(".post-grid")).toBeNull()

    await user.click(linha)
    const folha = screen.getByRole("dialog")
    // The name appears once only: the section header is the time, and the title comes
    // inside the body, where the publication starts.
    expect(within(folha).getAllByRole("heading", { name: "Serra de São Mamede" })).toHaveLength(1)
    expect(within(folha).getByText("fomos lá acima")).toBeTruthy()
  })

  it("sem título, a linha mostra o princípio da publicação", () => {
    const caption =
      "uma legenda comprida que passa dos oitenta caracteres para se ver onde é que ela acaba por ser cortada"
    mount([post("p1", { caption })])

    const linha = screen.getByRole("button", { name: /uma legenda comprida/ })
    const nome = linha.querySelector(".post-row-title")?.textContent ?? ""
    expect(nome.endsWith("…")).toBe(true)
    expect(nome.length).toBeLessThan(caption.length)
  })

  it("a miniatura de uma publicação de link vem de dentro da mensagem", () => {
    // Never from the site: the thumbnail traveled encrypted with the publication, and that
    // is why opening the profile does not tell anyone it was opened.
    mount([
      post("p1", {
        caption: "com link",
        links: [{ url: "https://x.pt", kind: "link", thumbnail: "data:image/png;base64,BBBB" }],
      }),
    ])
    expect(document.querySelector(".post-row-thumb")?.getAttribute("src")).toBe("data:image/png;base64,BBBB")
  })

  it("um ficheiro sem imagem nenhuma continua a ser uma linha", () => {
    // The file section exists precisely for this: a PDF is not a photo, and a square
    // tells it nothing. It reads by name, in list.
    mount([post("p1", { caption: "o contrato", media: [{ name: "contrato.pdf", mediaType: "application/pdf" }] })])

    expect(screen.getByRole("button", { name: /o contrato/ }).classList.contains("post-row")).toBe(true)
    expect(document.querySelector(".post-grid")).toBeNull()
  })
})

/**
 * And the photos in grid, which is the half that was missing.
 *
 * In a list, a photo is a 56px thumbnail next to a date: the presentation is hiding
 * exactly what the publication is. These tests lock in that the photos section, and
 * only it, draws as squares.
 */
describe("ProfileScreen — as fotografias em mosaico", () => {
  it("uma publicação com imagem é um quadrado, e não uma linha", () => {
    mount([post("p1", { caption: "a serra", media: [{ inline: "data:image/png;base64,AAAA", mediaType: "image/png" }] })])

    expect(document.querySelector(".post-grid")).toBeTruthy()
    expect(document.querySelector(".post-tile")).toBeTruthy()
    // And the list does not show at the same time: each section has its own presentation.
    expect(document.querySelector(".post-list")).toBeNull()
    expect(document.querySelector(".post-tile > img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA")
  })

  it("uma imagem despejada do cofre deixa o quadrado com o nome, e não um buraco", () => {
    // The archive drops bytes to stay small, and the publication still exists. This is
    // what the list test protected; it protects it here, because this is where a
    // publication with an image now goes.
    mount([post("p1", { caption: "tinha foto", media: [{ evicted: true, name: "praia.png" }] })])

    expect(document.querySelector(".post-grid")).toBeTruthy()
    expect(document.querySelector(".post-tile-sem-imagem")?.textContent).toContain("tinha foto")
  })

  it("a contagem só aparece a partir da segunda fotografia", () => {
    // A "1" on top of each square would be noise on all normal publications, which have
    // just one image.
    const uma = [{ inline: "data:image/png;base64,AAAA", mediaType: "image/png" }]
    mount([post("p1", { caption: "uma só", media: uma })])
    expect(document.querySelector(".post-tile-contagem")).toBeNull()

    cleanup()
    mount([post("p2", { caption: "três", media: [...uma, ...uma, ...uma] })])
    expect(document.querySelector(".post-tile-contagem")?.textContent).toBe("3")
  })
})

/**
 * The publication opened in the profile brings what it received.
 *
 * The profile opened a publication and showed only its body: the caption, the photos,
 * the links. The likes it already had and the comments already there were left out,
 * and there was no place to write one, the same publication seen in the feed had all
 * three things.
 *
 * What these tests lock in is what the PERSON sees after tapping the row: the correct
 * counts, the thumb they themselves tapped highlighted, and the words of whoever
 * commented. Counting bridge calls proved nothing, the bug was precisely that the call
 * existed and the button did not.
 */
describe("ProfileScreen — a publicação aberta traz gostos e comentários", () => {
  /** A vote from someone else on this publication. The author is the sender. */
  const voto = (id: string, quem: string, emoji: string, at = 10): ChatMessage => ({
    channel: MURAL_ME,
    seq: 2,
    sender: quem,
    payload: { t: "post.reaction", id, target: "p1", emoji, at },
  })

  const comentario = (id: string, quem: string, body: string): ChatMessage => ({
    channel: MURAL_ME,
    seq: 3,
    sender: quem,
    payload: { t: "post.comment", id, target: "p1", body, postedAt: 20 },
  })

  const publicacao = post("p1", { title: "Serra de São Mamede", caption: "fomos lá acima" })

  async function abrir(messages: ChatMessage[]): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup()
    mount([publicacao], [publicacao, ...messages])
    await user.click(screen.getByRole("button", { name: /Serra de São Mamede/ }))
    return user
  }

  it("os polegares aparecem com as contagens que o fio dá", async () => {
    await abrir([voto("r1", "@ana:s", "👍"), voto("r2", "@rui:s", "👍"), voto("r3", "@zeca:s", "👎")])

    const folha = screen.getByRole("dialog")
    // What shows on the button, not how many times someone called a function.
    expect(within(folha).getByRole("button", { name: strings.social.like }).textContent).toContain("2")
    expect(within(folha).getByRole("button", { name: strings.social.dislike }).textContent).toContain("1")
  })

  it("o meu voto vem destacado, e o botão passa a oferecer retirá-lo", async () => {
    await abrir([voto("r1", "@me:s", "👍")])

    const folha = screen.getByRole("dialog")
    const meu = within(folha).getByRole("button", { name: strings.social.likeUndo })
    expect(meu.getAttribute("aria-pressed")).toBe("true")
    // And the other thumb stays untapped.
    expect(within(folha).getByRole("button", { name: strings.social.dislike }).getAttribute("aria-pressed")).toBe(
      "false",
    )
  })

  it("os comentários que já lá estavam lêem-se, com o nome de quem os escreveu", async () => {
    const user = await abrir([comentario("c1", "@ana:s", "que vista")])

    const folha = screen.getByRole("dialog")
    // Closed by default: the button says how many there are, and it opens when tapped.
    expect(within(folha).getByRole("button", { name: strings.social.commentsToggle(1) })).toBeTruthy()
    expect(within(folha).queryByText("que vista")).toBeNull()

    await user.click(within(folha).getByRole("button", { name: strings.social.commentsToggle(1) }))
    expect(within(folha).getByText("que vista")).toBeTruthy()
    expect(within(folha).getByText("Ana")).toBeTruthy()
  })

  it("sem comentários, a caixa aberta di-lo em vez de aparecer vazia", async () => {
    const user = await abrir([])

    const folha = screen.getByRole("dialog")
    await user.click(within(folha).getByRole("button", { name: strings.social.commentsToggle(0) }))
    expect(within(folha).getByText(strings.social.commentsEmpty)).toBeTruthy()
  })

  it("o caixote só aparece nos meus comentários", async () => {
    const user = await abrir([comentario("c1", "@ana:s", "que vista"), comentario("c2", "@me:s", "e ainda com sol")])

    const folha = screen.getByRole("dialog")
    await user.click(within(folha).getByRole("button", { name: strings.social.commentsToggle(2) }))

    const linhas = [...folha.querySelectorAll(".comment")]
    const meu = linhas.find((linha) => linha.textContent?.includes("e ainda com sol"))
    const dela = linhas.find((linha) => linha.textContent?.includes("que vista"))
    expect(meu?.querySelector(".comment-delete")).toBeTruthy()
    // On someone else's would be promising an action that any client refuses.
    expect(dela?.querySelector(".comment-delete")).toBeNull()
  })

  it("escrever um comentário limpa a caixa, e ele lê-se quando volta pelo fio", async () => {
    const user = userEvent.setup()
    mount([publicacao], [publicacao])
    await user.click(screen.getByRole("button", { name: /Serra de São Mamede/ }))

    const folha = screen.getByRole("dialog")
    await user.click(within(folha).getByRole("button", { name: strings.social.commentsToggle(0) }))
    const caixa = within(folha).getByPlaceholderText(strings.social.commentPlaceholder)
    await user.type(caixa, "e ainda por cima com sol")
    await user.click(within(folha).getByRole("button", { name: strings.social.commentSend }))

    expect((caixa as HTMLInputElement).value).toBe("")

    // The shell is what returns the message to the thread; here the same thing is done by hand,
    // which is what tells "tapped the button" from "the person now sees what they wrote".
    cleanup()
    mount([publicacao], [publicacao, comentario("c9", "@me:s", "e ainda por cima com sol")])
    await user.click(screen.getByRole("button", { name: /Serra de São Mamede/ }))
    const outra = screen.getByRole("dialog")
    await user.click(within(outra).getByRole("button", { name: strings.social.commentsToggle(1) }))
    expect(within(outra).getByText("e ainda por cima com sol")).toBeTruthy()
  })

  it("uma publicação sem votos nem comentários mostra zeros, e não nada", async () => {
    await abrir([])

    const folha = screen.getByRole("dialog")
    expect(within(folha).getByRole("button", { name: strings.social.like }).textContent).toContain("0")
    expect(within(folha).getByRole("button", { name: strings.social.dislike }).textContent).toContain("0")
  })
})

/**
 * The photo publication opens with the photo on stage, not the text.
 *
 * Two complaints from the owner, months apart, at the same place.
 *
 * The first: in the profile, tapping a publication gave no way to see the photo large;
 * in the feed it did. The image was there, the `<img>` drew and measured 203px, and
 * it did not open: the feed passed an `onOpenImage` to the publication body and kept
 * an enlargement sheet, and the profile passed neither. A dead image looks like an image.
 *
 * The second, and it is true AFTER the first is fixed: "publications in profile (photos)
 * are only opening the text". It opened a 460px card with the title on top, the caption
 * next, and the photos shrunk to two thumbnails below the words. It opened large on the
 * second tap, and even then the text was in charge.
 *
 * These tests lock in what the person sees and what happens when they tap, not that a
 * function was called. **Pixels are measured elsewhere**: jsdom does not apply any
 * stylesheets and would say a zero-by-zero photo is there. What measures the area,
 * the position and who is next to whom is `scripts/medir-perfil.mjs`, in a real layout
 * engine.
 */
describe("ProfileScreen — a fotografia é que manda na publicação aberta", () => {
  const FOTO = "data:image/png;base64,AAAA"
  const OUTRA = "data:image/png;base64,BBBB"
  const comFoto = post("p1", {
    caption: "a serra",
    media: [
      { inline: FOTO, name: "cabeco.png", mediaType: "image/png" },
      { inline: OUTRA, name: "azinheira.png", mediaType: "image/png" },
    ],
  })

  /** The photo that is on stage now. One at a time, always. */
  const emPalco = (): string | null | undefined =>
    document.querySelector(".post-open-palco img")?.getAttribute("src")

  async function abrirPublicacao(qual = comFoto): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup()
    mount([qual])
    await user.click(screen.getByRole("button", { name: new RegExp(qual.payload.caption ?? "") }))
    return user
  }

  it("a fotografia vem primeiro, e as palavras a seguir", async () => {
    await abrirPublicacao()

    const palco = document.querySelector<HTMLElement>(".post-open-palco")
    const lado = document.querySelector<HTMLElement>(".post-open-lado")
    expect(palco).toBeTruthy()
    expect(lado).toBeTruthy()
    if (!palco || !lado) return
    // First in reading order: it is what a screen reader goes through and it is what
    // a phone stacks. That on a wide screen this sits side by side is a matter of
    // pixels, measured in the script.
    const ladoVemDepois = palco.compareDocumentPosition(lado) & Node.DOCUMENT_POSITION_FOLLOWING
    expect(ladoVemDepois).toBeTruthy()
    // The caption and title stay on the words side, not on top of the image.
    expect(within(lado).getByText("a serra")).toBeTruthy()
  })

  it("uma fotografia de cada vez, e passa-se à seguinte", async () => {
    const user = await abrirPublicacao()

    expect(document.querySelectorAll(".post-open-palco img")).toHaveLength(1)
    expect(emPalco()).toBe(FOTO)

    await user.click(screen.getByRole("button", { name: strings.social.imageNext }))

    expect(emPalco()).toBe(OUTRA)
    expect(document.querySelectorAll(".post-open-palco img")).toHaveLength(1)
  })

  it("dá a volta: da última salta-se para a primeira", async () => {
    const user = await abrirPublicacao()

    // Stopping at the end forces going all the way back to review the one that mattered.
    // With two photos, one arrow is enough and more.
    await user.click(screen.getByRole("button", { name: strings.social.imagePrev }))
    expect(emPalco()).toBe(OUTRA)
  })

  it("os pontos saltam directamente para a fotografia que se quer", async () => {
    const user = await abrirPublicacao()

    await user.click(screen.getByRole("button", { name: strings.social.imageGo(2) }))

    expect(emPalco()).toBe(OUTRA)
    // And the dot says which one, to those who see and to those who listen.
    const pontos = [...document.querySelectorAll(".carrossel-pontos .ponto")]
    expect(pontos[1]?.getAttribute("aria-current")).toBe("true")
    expect(pontos[0]?.getAttribute("aria-current")).toBe("false")
  })

  it("com uma fotografia só não há setas nem pontos", async () => {
    // An arrow that shows with nowhere to go promises a second photo that does not exist.
    await abrirPublicacao(post("p2", { caption: "sozinha", media: [{ inline: FOTO, name: "cabeco.png", mediaType: "image/png" }] }))

    expect(screen.queryByRole("button", { name: strings.social.imageNext })).toBeNull()
    expect(screen.queryByRole("button", { name: strings.social.imagePrev })).toBeNull()
    expect(document.querySelectorAll(".carrossel-pontos .ponto")).toHaveLength(0)
    expect(emPalco()).toBe(FOTO)
  })

  it("a fotografia em palco continua a abrir-se do tamanho do ecrã", async () => {
    const user = await abrirPublicacao()

    // The name by which the photo announces itself is its own, it is the image's `alt`
    // that names the button, as in the feed. "View larger" is the mouse hint.
    const botao = within(screen.getByRole("dialog")).getByRole("button", { name: "cabeco.png" })
    expect(botao.getAttribute("title")).toBe(strings.social.viewImage)

    await user.click(botao)

    // What the person sees: the photo on top of everything, with the same bytes already
    // on stage. Nothing fetched anything from anywhere.
    expect(document.querySelector(".lightbox img")?.getAttribute("src")).toBe(FOTO)
  })

  it("amplia a que está em palco, e não a primeira", async () => {
    const user = await abrirPublicacao()

    await user.click(screen.getByRole("button", { name: strings.social.imageNext }))
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "azinheira.png" }))

    expect(document.querySelector(".lightbox img")?.getAttribute("src")).toBe(OUTRA)
  })

  it("fechar a ampliação devolve a publicação, e não fecha o perfil atrás dela", async () => {
    const user = await abrirPublicacao()

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "cabeco.png" }))
    expect(document.querySelector(".lightbox")).toBeTruthy()

    await user.keyboard("{Escape}")

    // One key, one sheet. The publication stays open below, this was the bug that the
    // other person's profile sheet already noted: two stacked sheets both listen to Escape
    // on the document.
    expect(document.querySelector(".lightbox")).toBeNull()
    expect(emPalco()).toBe(FOTO)
    expect(screen.getByText("a serra")).toBeTruthy()
  })

  it("os comentários já estão abertos, sem se carregar em nada", async () => {
    const user = userEvent.setup()
    const comentado = {
      channel: MURAL_ME,
      seq: 2,
      sender: "@ana:s",
      payload: { t: "post.comment", id: "c1", target: "p1", postedAt: 2, body: "que tarde" },
    } as unknown as ChatMessage
    mount([comFoto], [comFoto, comentado])

    await user.click(screen.getByRole("button", { name: /a serra/ }))

    // The column next to the photo exists for them: closing them was saving space for
    // nothing. In the feed they stay closed, there are thirty publications.
    expect(screen.getByText("que tarde")).toBeTruthy()
  })

  it("uma publicação de texto abre sem palco de fotografia nenhum", async () => {
    // The other half of the choice: the stage is for content that justifies it. Giving it
    // to a word publication was opening empty space next to the words.
    const user = userEvent.setup()
    mount([post("p9", { caption: "só palavras aqui" })])
    await user.click(screen.getByRole("button", { name: /só palavras aqui/ }))

    expect(document.querySelector(".post-open")).toBeNull()
    // The publication opens anyway, and says what it has to say. (The same text shows in
    // the list row behind the sheet: that is why the question is asked inside the dialog.)
    expect(within(screen.getByRole("dialog")).getByText("só palavras aqui")).toBeTruthy()
  })

  it("uma imagem despejada do cofre não ganha botão nenhum", async () => {
    // Without bytes there is nothing to enlarge, and a button that opened empty
    // was worse than no button. It is the same rule as the feed grid.
    const user = userEvent.setup()
    mount([post("p1", { caption: "tinha foto", media: [{ evicted: true, name: "praia.png" }] })])
    await user.click(screen.getByRole("button", { name: /tinha foto/ }))

    const folha = screen.getByRole("dialog")
    expect(within(folha).queryByRole("button", { name: "praia.png" })).toBeNull()
    expect(folha.querySelector(".image-open")).toBeNull()
    expect(within(folha).getByText(strings.common.mediaEvicted)).toBeTruthy()
  })
})

/** "I don't want ids exposed" (owner order, October 27, 2026). */
describe("ProfileScreen — o id não se lê", () => {
  it("o endereço sai do texto; copia-se pelo botão ao lado do nome", async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, "writeText")
    mount([])
    expect(document.body.textContent).not.toContain("@me:s")
    const linha = document.querySelector(".profile-name-row") as HTMLElement
    await user.click(within(linha).getByRole("button", { name: strings.copiarId.de("Eu") }))
    expect(writeText).toHaveBeenCalledWith("@me:s")
  })
})

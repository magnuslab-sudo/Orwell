import { afterEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "../../bridge.js"
import type { ChatMessage, SocialDraft } from "../../types.js"
import { BridgeContext } from "../../App.js"
import { ToastProvider } from "../../components/Toast.js"
import { ConfirmarProvider } from "../../hooks/useConfirmar.js"
import { strings } from "../../strings.js"
import { Social } from "./Social.js"
import { moradaDeTeste } from "../../../testes/moradas.js"

afterEach(cleanup)

const socialMock = {
  post: vi.fn().mockResolvedValue({ ok: true }),
  edit: vi.fn().mockResolvedValue({ ok: true }),
  remove: vi.fn().mockResolvedValue({ ok: true }),
  react: vi.fn().mockResolvedValue({ ok: true }),
  comment: vi.fn().mockResolvedValue({ ok: true }),
  removeComment: vi.fn().mockResolvedValue({ ok: true }),
}

/** Vote. Exists in the schema so votes can be created and cast. */
const votacoesMock = { votar: vi.fn().mockResolvedValue({ ok: true }) }

const bridge = { social: socialMock, votacoes: votacoesMock } as unknown as EnclaveBridge

/** The wall of the publisher: an opaque fixed address per person. */
const muralDe = (sender: string): string => moradaDeTeste(`mural ${sender}`, "s")
const MURAL_DA_ANA = muralDe("@ana:s")

function post(id: string, sender: string, payload: Partial<ChatMessage["payload"]>): ChatMessage {
  return {
    channel: muralDe(sender),
    seq: 1,
    sender,
    payload: { t: "post", id, postedAt: Date.now() - 5 * 60_000, ...payload },
  }
}

/** Social is controlled from the shell; the harness plays that role. */
function Harness({
  feed,
  circleSize = 0,
  messages = [],
  onOpenProfile,
  rascunho,
}: {
  feed: ChatMessage[]
  circleSize?: number
  /** The entire thread, where likes and comments come from. */
  messages?: ChatMessage[]
  onOpenProfile?: ((address: string, channel: string) => void) | undefined
  /** A draft already started, for cases that need the full post. */
  rascunho?: SocialDraft
}): React.JSX.Element {
  const [draft, setDraft] = useState<SocialDraft>(rascunho ?? { caption: "", images: [], links: [] })
  return (
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <ConfirmarProvider>
          <Social
            circleSize={circleSize}
            feed={feed}
            messages={messages.length > 0 ? messages : feed}
            me="@me:s"
            connection="online"
            connectionDetail={null}
            nameFor={(sender) => (sender === "@ana:s" ? "Ana" : sender)}
            directory={new Map()}
            draft={draft}
            onDraft={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            onOpenProfile={onOpenProfile}
          />
        </ConfirmarProvider>
      </ToastProvider>
    </BridgeContext.Provider>
  )
}

describe("Social — filtro por tag", () => {
  const feed = [
    post("1", "@ana:s", { caption: "post dos gatos", tags: ["gatos"] }),
    post("2", "@ana:s", { caption: "post dos cães", tags: ["cães"] }),
  ]

  it("clicar numa #tag filtra o feed e mostra o chip; o chip limpa", async () => {
    const user = userEvent.setup()
    render(<Harness feed={feed} />)

    expect(screen.getByText("post dos gatos")).toBeTruthy()
    expect(screen.getByText("post dos cães")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "#gatos" }))

    expect(screen.getByText("post dos gatos")).toBeTruthy()
    expect(screen.queryByText("post dos cães")).toBeNull()

    const chip = screen.getByRole("button", { name: strings.social.filterChip("gatos") })
    expect(chip.getAttribute("aria-pressed")).toBeNull() // The chip is not a tag toggle.
    expect(screen.getByRole("button", { name: "#gatos" }).getAttribute("aria-pressed")).toBe("true")

    await user.click(chip)
    expect(screen.getByText("post dos cães")).toBeTruthy()
  })

  it("filtro sem resultados diz que a tag ainda não deu em nada", async () => {
    const user = userEvent.setup()
    render(<Harness feed={[post("1", "@ana:s", { caption: "só isto", tags: ["única"] })]} />)

    // Click the tag to turn it on; click again to turn it off.
    await user.click(screen.getByRole("button", { name: "#única" }))
    expect(screen.getByText("só isto")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "#única" }))
    expect(screen.queryByRole("button", { name: strings.social.filterChip("única") })).toBeNull()
  })
})

/**
 * Click the publisher's name to open their profile.
 *
 * We used to copy the address. Reading a post and wanting to know who posted it
 * are the same curiosity; copying an address is a task, and tasks live in the
 * right-click menu, which still has "Copy address" there.
 */
describe("Social — abrir o perfil do autor", () => {
  it("clicar no nome pede o perfil, com o feed por onde se lá chegou", async () => {
    const user = userEvent.setup()
    const onOpenProfile = vi.fn()
    render(<Harness feed={[post("1", "@ana:s", { caption: "olá" })]} onOpenProfile={onOpenProfile} />)

    await user.click(screen.getByRole("button", { name: "Ana" }))

    // The channel comes along because it is Ana's feed, shared by both: the security
    // number is calculated there, and without a channel there is no number.
    expect(onOpenProfile).toHaveBeenCalledExactlyOnceWith("@ana:s", MURAL_DA_ANA)
  })

  it("clicar já não copia nada — isso ficou no menu do botão direito", async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, "writeText")
    render(<Harness feed={[post("1", "@ana:s", { caption: "olá" })]} onOpenProfile={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "Ana" }))

    expect(writeText).not.toHaveBeenCalled()
  })
})

describe("Social — lightbox", () => {
  it("clicar numa imagem abre-a em grande; fechar devolve o feed", async () => {
    const user = userEvent.setup()
    render(
      <Harness
        feed={[
          post("1", "@ana:s", {
            caption: "com foto",
            media: [{ inline: "data:image/png;base64,AAAA", name: "praia.png", mediaType: "image/png" }],
          }),
        ]}
      />,
    )

    await user.click(screen.getByRole("button", { name: "praia.png" }))
    const dialog = screen.getByRole("dialog")
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA")

    await user.click(screen.getByRole("button", { name: strings.common.close }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("Social — pré-visualização de tags", () => {
  it("escrever #tags na legenda mostra as pílulas por baixo", async () => {
    const user = userEvent.setup()
    render(<Harness feed={[]} />)

    const textarea = screen.getByPlaceholderText(strings.social.placeholder)
    await user.type(textarea, "amanhã há #praia e #sol")

    expect(screen.getByText("#praia")).toBeTruthy()
    expect(screen.getByText("#sol")).toBeTruthy()
  })
})

/**
 * A vote is a message to the feed of whoever posted.
 *
 * It is not a counter someone increments: it is an encrypted message that goes
 * to the group where the post exists, and the number on screen comes from adding
 * them up. That is why the channel must be the poster's own-sending to our own
 * feed would leave the vote where nobody sees it.
 */
describe("Social — gostos e não gostos", () => {
  const publicacao = post("p1", "@ana:s", { caption: "olá" })

  it("carregar no polegar envia o voto para o feed de quem publicou", async () => {
    const user = userEvent.setup()
    socialMock.react.mockClear()
    render(<Harness feed={[publicacao]} />)

    await user.click(screen.getByRole("button", { name: strings.social.like }))
    expect(socialMock.react).toHaveBeenCalledExactlyOnceWith(MURAL_DA_ANA, "p1", "👍", false)
  })

  it("o voto desta conta aparece carregado, e volta a carregar retira-o", async () => {
    const user = userEvent.setup()
    socialMock.react.mockClear()
    const meuVoto: ChatMessage = {
      channel: MURAL_DA_ANA,
      seq: 2,
      sender: "@me:s",
      payload: { t: "post.reaction", id: "r1", target: "p1", emoji: "👍", at: Date.now() },
    }
    render(<Harness feed={[publicacao]} messages={[publicacao, meuVoto]} />)

    const gosto = screen.getByRole("button", { name: strings.social.likeUndo })
    expect(gosto.getAttribute("aria-pressed")).toBe("true")

    await user.click(gosto)
    expect(socialMock.react).toHaveBeenCalledExactlyOnceWith(MURAL_DA_ANA, "p1", "👍", true)
  })

  it("as contagens dizem quantas pessoas votaram em cada sentido", () => {
    const votos: ChatMessage[] = [
      { channel: MURAL_DA_ANA, seq: 2, sender: "@bru:s", payload: { t: "post.reaction", id: "r1", target: "p1", emoji: "👍", at: 1 } },
      { channel: MURAL_DA_ANA, seq: 3, sender: "@cla:s", payload: { t: "post.reaction", id: "r2", target: "p1", emoji: "👍", at: 1 } },
      { channel: MURAL_DA_ANA, seq: 4, sender: "@dora:s", payload: { t: "post.reaction", id: "r3", target: "p1", emoji: "👎", at: 1 } },
    ]
    render(<Harness feed={[publicacao]} messages={[publicacao, ...votos]} />)

    expect(screen.getByRole("button", { name: strings.social.like }).textContent).toContain("2")
    expect(screen.getByRole("button", { name: strings.social.dislike }).textContent).toContain("1")
  })
})

describe("Social — comentários", () => {
  const publicacao = post("p1", "@ana:s", { caption: "olá" })
  const comentario: ChatMessage = {
    channel: MURAL_DA_ANA,
    seq: 2,
    sender: "@ana:s",
    payload: { t: "post.comment", id: "c1", target: "p1", body: "e o link é este: https://exemplo.pt", postedAt: 1 },
  }

  it("a caixa abre-se do botão, mostra quem comentou e envia o comentário", async () => {
    const user = userEvent.setup()
    socialMock.comment.mockClear()
    render(<Harness feed={[publicacao]} messages={[publicacao, comentario]} />)

    // Collapsed by default: a feed with every box open is a wall.
    expect(screen.queryByPlaceholderText(strings.social.commentPlaceholder)).toBeNull()

    await user.click(screen.getByRole("button", { name: strings.social.commentsToggle(1) }))
    // The name inside the comment, not the publisher's name at the top.
    const lista = document.querySelector(".comment-list") as HTMLElement
    expect(within(lista).getByText("Ana")).toBeTruthy()
    // The text goes through RichText, so the address becomes clickable.
    expect(screen.getByRole("link", { name: "https://exemplo.pt" })).toBeTruthy()

    await user.type(screen.getByPlaceholderText(strings.social.commentPlaceholder), "concordo")
    await user.click(screen.getByRole("button", { name: strings.social.commentSend }))

    expect(socialMock.comment).toHaveBeenCalledExactlyOnceWith(MURAL_DA_ANA, "p1", "concordo")
  })

  it("sem comentários, a caixa diz que não há em vez de ficar em branco", async () => {
    const user = userEvent.setup()
    render(<Harness feed={[publicacao]} />)

    await user.click(screen.getByRole("button", { name: strings.social.commentsToggle(0) }))
    expect(screen.getByText(strings.social.commentsEmpty)).toBeTruthy()
  })

  it("um comentário vazio não sai", async () => {
    const user = userEvent.setup()
    socialMock.comment.mockClear()
    render(<Harness feed={[publicacao]} />)

    await user.click(screen.getByRole("button", { name: strings.social.commentsToggle(0) }))
    await user.type(screen.getByPlaceholderText(strings.social.commentPlaceholder), "   ")
    expect(screen.getByRole("button", { name: strings.social.commentSend }).hasAttribute("disabled")).toBe(true)
    expect(socialMock.comment).not.toHaveBeenCalled()
  })

  it("o caixote só aparece nos meus comentários", async () => {
    // Showing it on others' screens meant promising an action that any honest client
    // refuses: the request goes out, and nobody obeys it.
    const user = userEvent.setup()
    const meu: ChatMessage = {
      channel: MURAL_DA_ANA,
      seq: 3,
      sender: "@me:s",
      payload: { t: "post.comment", id: "c2", target: "p1", body: "eu também", postedAt: 2 },
    }
    render(<Harness feed={[publicacao]} messages={[publicacao, comentario, meu]} />)

    await user.click(screen.getByRole("button", { name: strings.social.commentsToggle(2) }))
    expect(screen.getAllByRole("button", { name: strings.social.commentDelete })).toHaveLength(1)
  })

  it("apagar um comentário meu vai para o feed onde ele está, e não para o meu", async () => {
    // The post belongs to Ana, so the comment lives in her feed. Sending the request
    // to our own feed means talking to a room where nobody has the comment-the button
    // looked like it worked and deleted nothing for anyone.
    const user = userEvent.setup()
    socialMock.removeComment.mockClear()
    const meu: ChatMessage = {
      channel: MURAL_DA_ANA,
      seq: 3,
      sender: "@me:s",
      payload: { t: "post.comment", id: "c2", target: "p1", body: "arrependi-me", postedAt: 2 },
    }
    render(<Harness feed={[publicacao]} messages={[publicacao, meu]} />)

    await user.click(screen.getByRole("button", { name: strings.social.commentsToggle(1) }))
    await user.click(screen.getByRole("button", { name: strings.social.commentDelete }))
    // Nothing goes out before the "yes".
    expect(socialMock.removeComment).not.toHaveBeenCalled()
    const pergunta = await screen.findByRole("alertdialog", { name: strings.social.commentDeleteTitle })
    await user.click(within(pergunta).getByRole("button", { name: strings.social.deleteAction }))

    expect(socialMock.removeComment).toHaveBeenCalledExactlyOnceWith(MURAL_DA_ANA, "c2")
  })

  it("recusar a confirmação não apaga nada", async () => {
    const user = userEvent.setup()
    socialMock.removeComment.mockClear()
    const meu: ChatMessage = {
      channel: MURAL_DA_ANA,
      seq: 3,
      sender: "@me:s",
      payload: { t: "post.comment", id: "c2", target: "p1", body: "fica", postedAt: 2 },
    }
    render(<Harness feed={[publicacao]} messages={[publicacao, meu]} />)

    await user.click(screen.getByRole("button", { name: strings.social.commentsToggle(1) }))
    await user.click(screen.getByRole("button", { name: strings.social.commentDelete }))
    const pergunta = await screen.findByRole("alertdialog", { name: strings.social.commentDeleteTitle })
    await user.click(within(pergunta).getByRole("button", { name: strings.confirmar.cancelar }))

    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(socialMock.removeComment).not.toHaveBeenCalled()
  })

  it("um comentário apagado deixa de contar no botão", async () => {
    // The number on the button comes from the same sum as the list: if redact did not
    // reach it, the button said "1 comment" and the list opened empty.
    const user = userEvent.setup()
    const meu: ChatMessage = {
      channel: MURAL_DA_ANA,
      seq: 3,
      sender: "@me:s",
      payload: { t: "post.comment", id: "c2", target: "p1", body: "apagado", postedAt: 2 },
    }
    const apagar: ChatMessage = {
      channel: MURAL_DA_ANA,
      seq: 4,
      sender: "@me:s",
      payload: { t: "redact", id: "x1", target: "c2", redactedAt: 3 },
    }
    render(<Harness feed={[publicacao]} messages={[publicacao, meu, apagar]} />)

    expect(screen.getByRole("button", { name: strings.social.commentsToggle(0) })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: strings.social.commentsToggle(0) }))
    expect(screen.getByText(strings.social.commentsEmpty)).toBeTruthy()
  })
})

describe("Social — título da publicação", () => {
  it("o título escrito no compositor viaja com a publicação", async () => {
    const user = userEvent.setup()
    socialMock.post.mockClear()
    render(<Harness feed={[]} />)

    await user.type(screen.getByPlaceholderText(strings.social.titlePlaceholder), "Serra de São Mamede")
    await user.type(screen.getByPlaceholderText(strings.social.placeholder), "fomos lá acima")
    await user.click(screen.getByRole("button", { name: strings.social.publish }))

    expect(socialMock.post).toHaveBeenCalledExactlyOnceWith(
      "fomos lá acima",
      [],
      expect.objectContaining({ title: "Serra de São Mamede" }),
    )
  })

  it("sem título, nada de título vai no envio", async () => {
    // An empty title is the absence of a title, not a blank title.
    const user = userEvent.setup()
    socialMock.post.mockClear()
    render(<Harness feed={[]} />)

    await user.type(screen.getByPlaceholderText(strings.social.placeholder), "só a legenda")
    await user.click(screen.getByRole("button", { name: strings.social.publish }))

    expect(socialMock.post.mock.calls[0]?.[2]).not.toHaveProperty("title")
  })

  it("uma publicação com título mostra-o por cima da legenda", () => {
    render(<Harness feed={[post("p1", "@ana:s", { title: "Um título", caption: "e a legenda" })]} />)
    expect(screen.getByRole("heading", { name: "Um título" })).toBeTruthy()
  })
})

describe("Social — feed vazio", () => {
  it("sem posts, o vazio é honesto e sem botão fantasma", () => {
    render(<Harness feed={[]} />)
    expect(screen.getByText(strings.social.emptyTitle)).toBeTruthy()
    expect(screen.getByText(strings.social.emptyBody)).toBeTruthy()
  })
})

describe("Social — editar e apagar publicações", () => {
  it('"…" → Editar pré-preenche a legenda e Guardar envia a edição', async () => {
    const user = userEvent.setup()
    socialMock.edit.mockClear()
    render(<Harness feed={[post("p1", "@me:s", { caption: "legenda antiga" })]} />)

    await user.click(screen.getByRole("button", { name: strings.social.postMenu }))
    await user.click(screen.getByRole("menuitem", { name: strings.social.edit }))

    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>(strings.social.placeholder)
    expect(textarea.value).toBe("legenda antiga")
    expect(screen.getByText(strings.social.editingChip)).toBeTruthy()

    await user.clear(textarea)
    await user.type(textarea, "legenda nova")
    await user.click(screen.getByRole("button", { name: strings.social.save }))

    expect(socialMock.edit).toHaveBeenCalledExactlyOnceWith("p1", "legenda nova")
  })

  it("Cancelar restaura o rascunho que estava a meio", async () => {
    const user = userEvent.setup()
    render(<Harness feed={[post("p1", "@me:s", { caption: "publicada" })]} />)

    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>(strings.social.placeholder)
    await user.type(textarea, "rascunho a meio")
    await user.click(screen.getByRole("button", { name: strings.social.postMenu }))
    await user.click(screen.getByRole("menuitem", { name: strings.social.edit }))
    expect(textarea.value).toBe("publicada")

    await user.click(screen.getByRole("button", { name: strings.social.editCancel }))
    expect(textarea.value).toBe("rascunho a meio")
  })

  it("Apagar pede confirmação honesta e envia o pedido de remoção", async () => {
    const user = userEvent.setup()
    socialMock.remove.mockClear()
    render(<Harness feed={[post("p1", "@me:s", { caption: "vai desaparecer" })]} />)

    await user.click(screen.getByRole("button", { name: strings.social.postMenu }))
    await user.click(screen.getByRole("menuitem", { name: strings.social.deleteAction }))

    // The honest question: the title, the body that says what does NOT happen, and the verb.
    const pergunta = await screen.findByRole("alertdialog", { name: strings.social.deleteTitle })
    expect(pergunta.textContent).toContain(strings.social.deleteConfirm)
    expect(socialMock.remove).not.toHaveBeenCalled()
    await user.click(within(pergunta).getByRole("button", { name: strings.social.deleteAction }))
    expect(socialMock.remove).toHaveBeenCalledExactlyOnceWith("p1")
  })

  it("posts dos outros só oferecem copiar: editar e apagar são de quem publicou", async () => {
    // The post menu follows the message menu: Copy text | Edit · Delete.
    const user = userEvent.setup()
    render(<Harness feed={[post("p1", "@ana:s", { caption: "alheia" })]} />)
    await user.click(screen.getByRole("button", { name: strings.social.postMenu }))
    expect(screen.getByRole("menuitem", { name: strings.chat.copyText })).toBeTruthy()
    expect(screen.queryByRole("menuitem", { name: strings.social.edit })).toBeNull()
    expect(screen.queryByRole("menuitem", { name: strings.social.deleteAction })).toBeNull()
  })

  it("um post alheio sem legenda não tem menu nenhum", () => {
    render(<Harness feed={[post("p1", "@ana:s", { caption: "" })]} />)
    expect(screen.queryByRole("button", { name: strings.social.postMenu })).toBeNull()
  })

  it("uma publicação editada declara-o, com a data", () => {
    const editedAt = new Date(2026, 7, 4, 10, 0).getTime()
    render(<Harness feed={[post("p1", "@ana:s", { caption: "corrigida", editedAt })]} />)
    expect(screen.getByText(strings.social.edited("04/08/26"))).toBeTruthy()
  })
})

/**
 * The empty state must say which of the two empties it is.
 *
 * Nobody in the circle and nothing to read is one thing; having three people's
 * feeds on this device and still seeing nothing is another-and the second has a
 * legitimate cause (persistent secrecy: what was posted before this device had
 * keys does not open) and a concrete fix (post again). A silent empty state made
 * the second look like a bug.
 */
describe("Social — o vazio explica-se", () => {
  it("sem ninguém no círculo, convida a publicar", () => {
    render(<Harness feed={[]} />)
    expect(screen.getByText(strings.social.emptyTitle)).toBeTruthy()
  })

  it("com feeds no dispositivo e nada legível, explica o sigilo persistente", () => {
    render(<Harness feed={[]} circleSize={2} />)
    expect(screen.getByText(strings.social.emptyCircleTitle)).toBeTruthy()
    expect(screen.getByText(strings.social.emptyCircleBody(2))).toBeTruthy()
    // And never the silent empty, which is what was being shown.
    expect(screen.queryByText(strings.social.emptyTitle)).toBeNull()
  })

  it("havendo publicações, não há vazio nenhum", () => {
    render(<Harness feed={[post("1", "@ana:s", { caption: "olá" })]} circleSize={2} />)
    expect(screen.queryByText(strings.social.emptyCircleTitle)).toBeNull()
    expect(screen.queryByText(strings.social.emptyTitle)).toBeNull()
  })
})
/**
 * Paste images into the post-writing box.
 *
 * The same three guarantees as the conversation box, because the gesture is the
 * same and the policy is literally the same function-`lib/colar.ts`. What changes
 * is the destination: here the image enters the post draft, compressed with the
 * post budget.
 *
 * The performance of pasting and compression is measured in
 * `scripts/medir-colar-e-comprimir.mjs`.
 */
describe("Social — colar imagens", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0, 0, 0, 0])

  function imagem(nome: string, bytes: Uint8Array = PNG, tipo = "image/png"): File {
    return new File([bytes as BlobPart], nome, { type: tipo })
  }

  /** An image with real bytes: the re-wrapping of pasting does not store fake sizes. */
  function imagemPesada(nome: string, bytes: number): File {
    const conteudo = new Uint8Array(bytes)
    conteudo.set(PNG.slice(0, 8))
    return new File([conteudo as BlobPart], nome, { type: "image/png" })
  }

  function areaDeTransferencia(texto: string, ficheiros: File[]): DataTransfer {
    return {
      types: [...(texto ? ["text/plain"] : []), ...ficheiros.map((f) => f.type)],
      getData: (tipo: string) => (tipo === "text/plain" ? texto : ""),
      items: ficheiros.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
      files: ficheiros,
    } as unknown as DataTransfer
  }

  const caixa = (): HTMLTextAreaElement =>
    screen.getByPlaceholderText(strings.social.placeholder) as HTMLTextAreaElement

  /** Pastes, and returns whether the browser stayed free to paste its own way. */
  function colar(texto: string, ficheiros: File[] = []): boolean {
    return fireEvent.paste(caixa(), { clipboardData: areaDeTransferencia(texto, ficheiros) })
  }

  it("colar texto não é travado, e não põe imagem nenhuma no rascunho", async () => {
    render(<Harness feed={[]} />)
    expect(colar("uma frase colada")).toBe(true)
    await Promise.resolve()
    expect(document.querySelector(".draft-images")).toBeNull()
  })

  it("colar uma imagem põe-na no rascunho, com pré-visualização", async () => {
    render(<Harness feed={[]} />)
    expect(colar("", [imagem("captura.png")])).toBe(false)
    await vi.waitFor(() => expect(document.querySelectorAll(".draft-image img")).toHaveLength(1))
    const miniatura = document.querySelector(".draft-image img") as HTMLImageElement
    expect(miniatura.src.startsWith("data:image/png")).toBe(true)
  })

  it("a imagem colada é publicada com as outras, em `media`", async () => {
    const user = userEvent.setup()
    socialMock.post.mockClear()
    render(<Harness feed={[]} />)
    colar("", [imagem("captura.png")])
    await vi.waitFor(() => expect(document.querySelectorAll(".draft-image img")).toHaveLength(1))
    await user.click(screen.getByText(strings.social.publish))
    expect(socialMock.post).toHaveBeenCalledWith(
      "",
      [],
      expect.objectContaining({
        media: [expect.objectContaining({ inline: expect.stringContaining("data:image/png") })],
      }),
    )
  })

  it("o que se diz imagem e não é fica de fora, e a caixa diz porquê", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')
    render(<Harness feed={[]} />)
    expect(colar("", [imagem("truque.png", svg)])).toBe(false)
    expect(await screen.findByText(strings.common.pasteNotImage)).toBeTruthy()
    expect(document.querySelector(".draft-images")).toBeNull()
  })

  it("uma imagem que não se consegue encolher é recusada com uma frase", async () => {
    // Before this stage, refusal was at the gate and by a round number: anything over
    // three megabytes got "that image is a monster" without ever being compressed. Now
    // only what the compressor could not fix gets refused-and the message is its fault,
    // not this screen's.
    render(<Harness feed={[]} />)
    colar("", [imagemPesada("gigante.png", 500_000)])
    await vi.waitFor(() => {
      const nota = document.querySelector(".field-note.warn")
      expect(nota?.textContent ?? "").toMatch(/imagens?/i)
      expect((nota?.textContent ?? "").length).toBeGreaterThan(20)
    })
    expect(document.querySelector(".draft-images")).toBeNull()
  })

  it("numa publicação que já não leva mais nada, a imagem colada é recusada aqui", async () => {
    // The other cap, and the one that matters for real: the bytes going to the feed. A
    // post with attachments that already spent the budget cannot accept another image-
    // and discovering it at send time costs the whole connection, because the server
    // measures the frame and closes it above twelve megabytes.
    //
    // The weight goes in the `dataUrl` of a file, not the caption: the screen draws
    // the name and size, not the string, so the test does not put eight million
    // characters inside a DOM element just to prove an account.
    const enorme = {
      dataUrl: `data:application/pdf;base64,${"A".repeat(9_000_000)}`,
      name: "dossiê.pdf",
      mediaType: "application/pdf",
      bytes: 6_750_000,
    }
    render(<Harness feed={[]} rascunho={{ caption: "", images: [], files: [enorme], links: [] }} />)
    colar("", [imagem("captura.png")])
    expect(await screen.findByText(strings.social.imagesNoRoom)).toBeTruthy()
    expect(document.querySelector(".draft-images")).toBeNull()
  })

  it("a quinta imagem é recusada em voz alta, e não deitada fora em silêncio", async () => {
    render(<Harness feed={[]} />)
    for (const [posicao, nome] of ["a.png", "b.png", "c.png", "d.png"].entries()) {
      colar("", [imagem(nome)])
      // Wait for EACH one: pasting four in a row on the same draft left the last three
      // counting on a state that did not exist yet.
      await vi.waitFor(() => expect(document.querySelectorAll(".draft-image img")).toHaveLength(posicao + 1))
    }
    colar("", [imagem("e.png")])
    expect(await screen.findByText(strings.social.imagesFull(4))).toBeTruthy()
    expect(document.querySelectorAll(".draft-image img")).toHaveLength(4)
  })
})

/**
 * A poll on the wall: posted, read, and voted.
 *
 * The caption of a poll IS the poll written out in full-it is what a client that
 * does not know how to draw it shows-and whoever draws it does not read it twice.
 */
describe("Social — votações", () => {
  const PERGUNTA = "Qual é o melhor dia?"
  const LEGENDA = `${PERGUNTA}\n1. Segunda\n2. Terça`

  const votacao = (id: string): ChatMessage =>
    post(id, "@ana:s", { caption: LEGENDA, poll: { question: PERGUNTA, options: ["Segunda", "Terça"] } })

  const votoDe = (sender: string, alvo: string, opcao: number): ChatMessage => ({
    channel: MURAL_DA_ANA,
    seq: 30,
    sender,
    payload: { t: "post.reaction", id: `voto-${sender}`, target: alvo, emoji: "", at: 10, vote: opcao },
  })

  it("desenha o cartão, e não repete a legenda que ele já diz", () => {
    render(<Harness feed={[votacao("p1")]} />)
    expect(screen.getByRole("heading", { name: PERGUNTA })).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.votacao.votarEm("Segunda") })).toBeTruthy()
    expect(document.body.textContent).not.toContain("1. Segunda")
  })

  it("conta os votos que vieram no fio, e diz quem votou", () => {
    const publicada = votacao("p1")
    render(<Harness feed={[publicada]} messages={[publicada, votoDe("@ana:s", "p1", 1)]} />)
    expect(screen.getByText(strings.votacao.total(1))).toBeTruthy()
    // The name under the option, not the author in the header: it is what makes the
    // claim that votes are visible come true.
    const linha = screen.getByText("Terça").closest("li") as HTMLElement
    expect(within(linha).getByText("Ana")).toBeTruthy()
  })

  it("carregar numa opção manda o voto para o feed de quem publicou", async () => {
    const user = userEvent.setup()
    const publicada = votacao("p1")
    render(<Harness feed={[publicada]} />)
    await user.click(screen.getByRole("button", { name: strings.votacao.votarEm("Terça") }))
    expect(votacoesMock.votar).toHaveBeenCalledWith(publicada.channel, "p1", 1, false)
  })

  it("e carregar na que já escolhi retira o voto", async () => {
    const user = userEvent.setup()
    const publicada = votacao("p1")
    render(<Harness feed={[publicada]} messages={[publicada, votoDe("@me:s", "p1", 0)]} />)
    await user.click(screen.getByRole("button", { name: strings.votacao.retirarVoto("Segunda") }))
    expect(votacoesMock.votar).toHaveBeenCalledWith(publicada.channel, "p1", 0, true)
  })

  /**
   * Post a poll: the caption goes written out in full and the structure goes
   * alongside. Without the caption, anyone who cannot draw polls sees an
   * empty post.
   */
  /*
    HIDDEN on August 18, 2026: see `MOSTRAR_VOTACOES`. Suspended, not deleted,     here we confirm creation came back whole the day it returns. The rest of the
    block still runs: a poll that already exists draws itself and takes votes the
    same, and that was not turned off.
    */
  it.skip("publicar uma votação leva a pergunta na legenda e a estrutura ao lado", async () => {
    const user = userEvent.setup()
    render(<Harness feed={[]} />)

    await user.click(screen.getByRole("button", { name: strings.votacao.criar }))
    await user.type(screen.getByLabelText(strings.votacao.perguntaLabel), PERGUNTA)
    await user.type(screen.getByLabelText(strings.votacao.opcaoLabel(1)), "Segunda")
    await user.type(screen.getByLabelText(strings.votacao.opcaoLabel(2)), "Terça")
    await user.click(screen.getByRole("button", { name: strings.votacao.confirmar }))

    expect(socialMock.post).toHaveBeenCalledWith(LEGENDA, [], {
      poll: { question: PERGUNTA, options: ["Segunda", "Terça"] },
    })
  })
})

describe("Social — o que se escreve enquanto a publicação sai", () => {
  it("a publicação que acaba não apaga o texto da seguinte", async () => {
    let acabar: (valor: { ok: boolean }) => void = () => {}
    socialMock.post.mockImplementationOnce(() => new Promise((resolver) => (acabar = resolver)))
    render(<Harness feed={[]} rascunho={{ caption: "a primeira", images: [], links: [] }} />)
    const caixa = screen.getByPlaceholderText(strings.social.placeholder) as HTMLTextAreaElement
    fireEvent.click(screen.getByRole("button", { name: strings.social.publish }))
    // Still leaving: the person starts the next one.
    fireEvent.change(caixa, { target: { value: "a segunda, a meio" } })
    await act(async () => {
      acabar({ ok: true })
      await Promise.resolve()
    })
    expect(caixa.value).toBe("a segunda, a meio")
  })

  it("sem nada escrito pelo meio, limpa o que foi publicado", async () => {
    render(<Harness feed={[]} rascunho={{ caption: "só esta", title: "Título", images: [], links: [] }} />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.social.publish }))
      await Promise.resolve()
    })
    expect((screen.getByPlaceholderText(strings.social.placeholder) as HTMLTextAreaElement).value).toBe("")
    expect((screen.getByPlaceholderText(strings.social.titlePlaceholder) as HTMLInputElement).value).toBe("")
  })
})

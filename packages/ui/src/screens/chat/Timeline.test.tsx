import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render as baseRender, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { strings } from "../../strings.js"
import { ToastProvider } from "../../components/Toast.js"
import { LAST_READ_KEY } from "../../hooks/useUnreads.js"
import { MessageRow, Timeline } from "./Timeline.js"

/** MessageRow carries a copy action that toasts, so every render needs the
 * provider. Wrapped here once instead of in each call. */
const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
  baseRender(ui, { wrapper: ToastProvider })

afterEach(cleanup)

const noop = (): void => {}

function messageOf(seq: number, body: string): ChatMessage {
  return {
    channel: "!sala:s",
    seq,
    sender: "@abc:s",
    payload: { t: "message", id: `id-${seq}`, sentAt: seq, body },
  }
}

function timeline(overrides: Partial<React.ComponentProps<typeof Timeline>>): React.JSX.Element {
  return (
    <Timeline
      channel="!sala:s"
      messages={[]}
      pending={[]}
      onRetry={noop}
      onDiscard={noop}
      me={null}
      nameFor={(sender) => sender}
      directory={new Map<string, Profile>()}
      {...overrides}
    />
  )
}

describe("Timeline", () => {
  /**
   * The line that announced the end of stored history was removed by order of
   * the owner: it explained the model, and at this stage the product does not
   * explain how it works.
   *
   * What is proven here is its absence, so it does not come back by mistake,    * and that what it accompanied was not lost with it: the button to load older
   * messages still appears and still works.
   */
  it("não anuncia onde o histórico guardado acaba", () => {
    render(timeline({ messages: [messageOf(1, "olá")], hasStoredHistory: true }))
    expect(screen.queryByText("As mensagens anteriores não estão guardadas neste aparelho.")).toBeNull()
  })

  it("'Carregar mais antigas' continua a aparecer e a chamar onLoadOlder", async () => {
    const user = userEvent.setup()
    const onLoadOlder = vi.fn()
    render(
      timeline({
        messages: [messageOf(1, "olá")],
        hasStoredHistory: true,
        canLoadOlder: true,
        onLoadOlder,
      }),
    )

    const button = screen.getByText(strings.chat.loadOlder)

    await user.click(button)
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
  })
})

/**
 * A room with not a single row has three causes, and what is proven here is that
 * the person READS a different one for each. The chain that chooses between them
 * is proven separately, in `vazioDaConversa.test.ts`; this is the other half,  * that the choice actually reaches the screen, with the right button beside it.
 */
describe("a conversa vazia diz PORQUE é que está vazia", () => {
  it("num canal novo neste aparelho, convida a escrever", () => {
    render(timeline({ messages: [] }))

    expect(screen.getByText(strings.chat.timelineEmpty)).toBeTruthy()
    expect(screen.getByText(strings.chat.timelineEmptyBody)).toBeTruthy()
    // Nothing here is to fetch: there is no more stored to go get.
    expect(screen.queryByText(strings.chat.loadOlder)).toBeNull()
  })

  it("com histórico guardado e nada por abrir, tira a culpa do caminho", () => {
    render(timeline({ messages: [], hasStoredHistory: true }))

    expect(screen.getByText(strings.chat.timelineKeptTitle)).toBeTruthy()
    // The phrase this product could not leave unsaid.
    expect(screen.getByText(strings.chat.timelineKeptBody).textContent).toContain("Não apagaste nada")
    // And it does not repeat the prompt to write the first: it would not be the first.
    expect(screen.queryByText(strings.chat.timelineEmpty)).toBeNull()
  })

  it("havendo mais para abrir, a porta é abrir e não escrever", async () => {
    const user = userEvent.setup()
    const onLoadOlder = vi.fn()
    render(timeline({ messages: [], hasStoredHistory: true, canLoadOlder: true, onLoadOlder }))

    expect(screen.getByText(strings.chat.timelineOlderTitle)).toBeTruthy()
    expect(screen.queryByText(strings.chat.timelineKeptTitle)).toBeNull()

    // One button only, not two saying the same thing in different places on screen.
    const botoes = screen.getAllByText(strings.chat.loadOlder)
    expect(botoes).toHaveLength(1)

    await user.click(botoes[0] as HTMLElement)
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
  })

  it("uma mensagem por enviar já não é uma sala vazia", () => {
    render(
      timeline({
        messages: [],
        pending: [{ id: "p1", channel: "!sala:s", body: "vai a caminho", state: "sending", at: 1 }],
      }),
    )

    expect(screen.queryByText(strings.chat.timelineEmpty)).toBeNull()
    expect(screen.getByText("vai a caminho")).toBeTruthy()
  })

  it("uma mensagem escrita sem ligação diz que está à espera, e descarta-se", async () => {
    const user = userEvent.setup()
    const onDiscard = vi.fn()
    render(
      timeline({
        messages: [],
        pending: [{ id: "w1", channel: "!sala:s", body: "escrita no comboio", state: "waiting", at: 1 }],
        onDiscard,
      }),
    )
    expect(screen.getByText("escrita no comboio")).toBeTruthy()
    // In words and by margin mark, for the reader and the listener.
    expect(screen.getByText(strings.chat.aEsperaDeLigacaoNota)).toBeTruthy()
    expect(screen.getByRole("img", { name: strings.chat.aEsperaDeLigacao })).toBeTruthy()
    // Waiting is not failing: there is no "Retry", which would have nowhere to go.
    expect(screen.queryByRole("button", { name: strings.common.retry })).toBeNull()
    await user.click(screen.getByRole("button", { name: strings.chat.discard }))
    expect(onDiscard).toHaveBeenCalledWith("w1")
  })
})

/**
 * The face and name of the author open that person's page.
 *
 * The name is the button for keyboard and screen reader; the face does the same
 * for mouse and touch, and sits outside the Tab order so it does not say the
 * same thing twice.
 */
describe("Timeline — abrir a página de quem escreveu", () => {
  it("o nome e a cara abrem a página do remetente", async () => {
    const user = userEvent.setup()
    const onOpenProfile = vi.fn()
    render(timeline({ messages: [messageOf(1, "olá")], nameFor: () => "Alice", onOpenProfile }))

    await user.click(screen.getByRole("button", { name: "Alice" }))
    expect(onOpenProfile).toHaveBeenLastCalledWith("@abc:s")

    const cara = document.querySelector<HTMLButtonElement>(".message-avatar-botao")
    expect(cara?.tabIndex).toBe(-1)
    expect(cara?.getAttribute("aria-hidden")).toBe("true")
    await user.click(cara as HTMLButtonElement)
    expect(onOpenProfile).toHaveBeenCalledTimes(2)
  })

  it("sem quem abra a página, o nome continua texto", () => {
    render(<MessageRow message={messageOf(1, "olá")} grouped={false} authorName="Alice" profile={undefined} />)
    expect(screen.queryByRole("button", { name: "Alice" })).toBeNull()
    expect(document.querySelector(".message-avatar-botao")).toBeNull()
  })
})

describe("MessageRow (memoizada)", () => {
  it("renderiza autor, corpo e hora numa linha não agrupada", () => {
    render(
      <MessageRow message={messageOf(1, "olá mundo")} grouped={false} authorName="Alice" profile={undefined} />,
    )
    expect(screen.getByText("Alice")).toBeTruthy()
    expect(screen.getByText("olá mundo")).toBeTruthy()
    expect(document.querySelector(".message-body time")).toBeTruthy()
  })

  it("agrupada omite o cabeçalho mas mantém o corpo", () => {
    render(<MessageRow message={messageOf(2, "segunda linha")} grouped authorName="Alice" profile={undefined} />)
    expect(screen.queryByText("Alice")).toBeNull()
    expect(screen.getByText("segunda linha")).toBeTruthy()
  })

  it("o memo não impede novas mensagens de aparecer na Timeline", () => {
    const { rerender } = render(timeline({ messages: [messageOf(1, "primeira")] }))
    expect(screen.getByText("primeira")).toBeTruthy()

    rerender(timeline({ messages: [messageOf(1, "primeira"), messageOf(2, "segunda")] }))
    expect(screen.getByText("primeira")).toBeTruthy()
    expect(screen.getByText("segunda")).toBeTruthy()
  })
})

/**
 * Images and link cards came INSIDE the encrypted message.
 *
 * What these assertions keep is the promise: nothing drawn here goes out asking
 * anything from a third-party server. An image with a `src` pointing outward,
 * or a card that fetched the thumbnail from the site, would hand the link owner
 * the IP address of whoever opened the conversation, without anyone having clicked.
 */
describe("MessageRow — imagens e cartões de link", () => {
  const imagemEmbutida = "data:image/webp;base64,AAAA"

  it("desenha a imagem a partir dos bytes que já cá estão", () => {
    const message: ChatMessage = {
      channel: "!sala:s",
      seq: 1,
      sender: "@abc:s",
      payload: {
        t: "message",
        id: "id-1",
        sentAt: 1,
        body: "olha isto",
        attachments: [{ inline: imagemEmbutida, name: "foto.webp", mediaType: "image/webp" }],
      },
    }
    render(<MessageRow message={message} grouped={false} authorName="Alice" profile={undefined} />)
    const img = screen.getByAltText("foto.webp") as HTMLImageElement
    expect(img.getAttribute("src")).toBe(imagemEmbutida)
  })

  it("nenhuma imagem de mensagem aponta para fora deste aparelho", () => {
    const message: ChatMessage = {
      channel: "!sala:s",
      seq: 1,
      sender: "@abc:s",
      payload: {
        t: "message",
        id: "id-1",
        sentAt: 1,
        body: "",
        attachments: [{ inline: imagemEmbutida, name: "foto.webp", mediaType: "image/webp" }],
        links: [{ url: "https://exemplo.pt/artigo", kind: "link", title: "Artigo", thumbnail: imagemEmbutida }],
      },
    }
    render(<MessageRow message={message} grouped={false} authorName="Alice" profile={undefined} />)
    for (const img of [...document.querySelectorAll("img")]) {
      expect(img.getAttribute("src")?.startsWith("data:")).toBe(true)
    }
  })

  it("o cartão de link mostra o que o remetente gravou, e não um endereço a resolver", () => {
    const message: ChatMessage = {
      channel: "!sala:s",
      seq: 1,
      sender: "@abc:s",
      payload: {
        t: "message",
        id: "id-1",
        sentAt: 1,
        body: "https://exemplo.pt/artigo vale a pena",
        links: [{ url: "https://exemplo.pt/artigo", kind: "link", title: "Um artigo", siteName: "Exemplo" }],
      },
    }
    render(<MessageRow message={message} grouped={false} authorName="Alice" profile={undefined} />)
    expect(screen.getByText("Um artigo")).toBeTruthy()
    expect(screen.getByText("Exemplo")).toBeTruthy()
  })

  it("uma mensagem só com imagem não desenha um parágrafo vazio", () => {
    const message: ChatMessage = {
      channel: "!sala:s",
      seq: 1,
      sender: "@abc:s",
      payload: {
        t: "message",
        id: "id-1",
        sentAt: 1,
        body: "",
        attachments: [{ inline: imagemEmbutida, name: "foto.webp", mediaType: "image/webp" }],
      },
    }
    render(<MessageRow message={message} grouped={false} authorName="Alice" profile={undefined} />)
    expect(document.querySelector(".message-body p")).toBeNull()
  })

  it("o endereço no corpo continua clicável, com noopener e noreferrer", () => {
    // Half the requirement, and the one that already existed: links are clickable
    // by text partition, never by interpreted markup. `noreferrer` because where
    // the person came from is this product, and the site has nothing to do with it.
    render(<MessageRow message={messageOf(1, "vê https://exemplo.pt")} grouped={false} authorName="A" profile={undefined} />)
    const link = screen.getByRole("link")
    expect(link.getAttribute("href")).toBe("https://exemplo.pt")
    expect(link.getAttribute("rel")).toBe("noopener noreferrer")
  })
})

describe("Timeline — quem está a escrever", () => {
  it("mostra a linha só quando há alguém a escrever", () => {
    const { rerender } = render(timeline({ messages: [messageOf(1, "olá")] }))
    expect(document.querySelector(".timeline-typing")).toBeNull()

    rerender(timeline({ messages: [messageOf(1, "olá")], typists: ["Ana"] }))
    expect(screen.getByText(strings.chat.typing(["Ana"]))).toBeTruthy()
  })

  it("a linha não é uma mensagem: fica fora da lista de mensagens", () => {
    // If it were drawn as a conversation row, the next step was someone recording it, // and then it took up places that belong to what was said.
    render(timeline({ messages: [messageOf(1, "olá")], typists: ["Ana"] }))
    expect(document.querySelectorAll("article.message")).toHaveLength(1)
  })

  it("acima de três pessoas conta-as em vez de as nomear", () => {
    render(timeline({ typists: ["Ana", "Rui", "Zé", "Luís"] }))
    expect(screen.getByText("4 pessoas estão a escrever…")).toBeTruthy()
  })
})

/**
 * Attachments that are not images, on the reader's side.
 *
 * Two rules to keep, and both are for safety, not appearance: **nothing opens
 * inside**, no `iframe`, no embedded viewer, and the only action is save, and
 * **the sender's name is never treated as truth**.
 */
describe("MessageRow — ficheiros", () => {
  const pdf = `data:application/pdf;base64,${btoa("%PDF-1.4 fingido")}`

  function comAnexos(anexos: NonNullable<ChatMessage["payload"]["attachments"]>): ChatMessage {
    return {
      channel: "!sala:s",
      seq: 1,
      sender: "@abc:s",
      payload: { t: "message", id: "id-1", sentAt: 1, body: "vai isto", attachments: anexos },
    }
  }

  it("desenha uma linha com o nome, a extensão e o peso dos bytes que cá estão", () => {
    render(
      <MessageRow
        message={comAnexos([{ inline: pdf, name: "contrato.pdf", mediaType: "application/pdf" }])}
        grouped={false}
        authorName="Alice"
        profile={undefined}
      />,
    )
    expect(screen.getByText("contrato.pdf")).toBeTruthy()
    expect(screen.getByText("PDF")).toBeTruthy()
    // The size comes from the base64 we have in hand, not from the declared
    // `byteLength`, which is metadata from the sender like the name.
    expect(screen.getByText("16 B")).toBeTruthy()
  })

  it("não desenha nada que abra o ficheiro por dentro", () => {
    render(
      <MessageRow
        message={comAnexos([{ inline: pdf, name: "contrato.pdf", mediaType: "application/pdf" }])}
        grouped={false}
        authorName="Alice"
        profile={undefined}
      />,
    )
    // No viewer, no object, no navigation: the only way out is the save button. A
    // file that opens by itself in an encrypted product is the door everything else
    // spends its time closing.
    expect(document.querySelector("iframe")).toBeNull()
    expect(document.querySelector("object")).toBeNull()
    expect(document.querySelector("embed")).toBeNull()
    expect(document.querySelector(".file-attachment a")).toBeNull()
    expect(screen.getByLabelText(strings.chat.fileDownloadOf("contrato.pdf"))).toBeTruthy()
  })

  it("o nome do remetente é desinfectado antes de chegar ao ecrã", () => {
    render(
      <MessageRow
        // Path and text reversal mark in the same name: both tricks at once. What you
        // read has to be what it is.
        message={comAnexos([{ inline: pdf, name: "../../etc/relatorio‮fdp.exe", mediaType: "application/pdf" }])}
        grouped={false}
        authorName="Alice"
        profile={undefined}
      />,
    )
    expect(screen.getByText("relatoriofdp.exe")).toBeTruthy()
    expect(screen.queryByText(/\.\.\//)).toBeNull()
  })

  it("um documento despejado do cofre diz o que era, e não oferece botão", () => {
    // The vault stores `{ evicted, name, mediaType }` and discards `kind` and
    // `byteLength`, proven in `vault.anexos.test.ts`. This line degrades to that:
    // name and type survive, bytes do not.
    render(
      <MessageRow
        message={comAnexos([{ evicted: true, name: "contrato.pdf", mediaType: "application/pdf" }])}
        grouped={false}
        authorName="Alice"
        profile={undefined}
      />,
    )
    expect(screen.getByText("contrato.pdf")).toBeTruthy()
    expect(screen.getByText(strings.common.fileEvicted)).toBeTruthy()
    // Showing empty state was worse than not offering it.
    expect(screen.queryByLabelText(strings.chat.fileDownloadOf("contrato.pdf"))).toBeNull()
  })

  it("imagens e ficheiros na mesma mensagem vão cada um para o seu sítio", () => {
    render(
      <MessageRow
        message={comAnexos([
          { inline: "data:image/webp;base64,AAAA", name: "foto.webp", mediaType: "image/webp" },
          { inline: pdf, name: "contrato.pdf", mediaType: "application/pdf" },
        ])}
        grouped={false}
        authorName="Alice"
        profile={undefined}
      />,
    )
    // Image in the grid, PDF in the list. Without separation, `PostImages` would
    // draw a broken `<img src="data:application/pdf">`.
    expect(document.querySelectorAll(".post-images img")).toHaveLength(1)
    expect(document.querySelectorAll(".file-attachment")).toHaveLength(1)
  })

  it("uma imagem despejada continua a ir para a grelha, e não para os ficheiros", () => {
    // The trap that decided to split by `mediaType`: the vault discards `kind`, so
    // splitting by it would move this to the file list the day it aged out.
    render(
      <MessageRow
        message={comAnexos([{ evicted: true, name: "foto.webp", mediaType: "image/webp" }])}
        grouped={false}
        authorName="Alice"
        profile={undefined}
      />,
    )
    expect(document.querySelector(".media-evicted")).toBeTruthy()
    expect(document.querySelector(".file-attachment")).toBeNull()
  })
})

/**
 * Open an image full size in the conversation.
 *
 * The bug was this: `PostImages` only makes a button when given an `onOpen`,
 * the feed provided it and the conversation did not. Images rendered and
 * nothing more.
 */
describe("Timeline — abrir a imagem", () => {
  const imagem = "data:image/webp;base64,AAAA"

  function comImagem(anexo: Record<string, unknown>): ChatMessage {
    return {
      channel: "!sala:s",
      seq: 1,
      sender: "@abc:s",
      payload: { t: "message", id: "id-1", sentAt: 1, body: "", attachments: [anexo] },
    } as ChatMessage
  }

  it("a imagem é um botão, e abre a folha com a imagem em grande", async () => {
    const user = userEvent.setup()
    render(timeline({ messages: [comImagem({ inline: imagem, name: "foto.webp", mediaType: "image/webp" })] }))

    await user.click(screen.getByTitle(strings.social.viewImage))

    const folha = screen.getByRole("dialog")
    expect(folha).toBeTruthy()
    // Same sheet as the feed, same bytes: nothing fetches the image from elsewhere
    // to show it larger.
    expect((folha.querySelector("img") as HTMLImageElement).getAttribute("src")).toBe(imagem)
  })

  it("uma imagem despejada NÃO vira botão", () => {
    // Opening what no longer exists is worse than not offering it.
    render(timeline({ messages: [comImagem({ evicted: true, name: "foto.webp", mediaType: "image/webp" })] }))
    expect(screen.queryByTitle(strings.social.viewImage)).toBeNull()
    expect(document.querySelector(".media-evicted")).toBeTruthy()
  })
})

/**
 * The marker for where you stopped reading.
 *
 * What gets stored here is its POSITION in the conversation. That it does not
 * jump when new messages arrive is `usePorLer`, proven there.
 */
describe("Timeline — a marca do por ler", () => {
  const outro = (seq: number, sentAt: number): ChatMessage => ({
    channel: "!sala:s",
    seq,
    sender: "@outro:s",
    payload: { t: "message", id: `id-${seq}`, sentAt, body: `m${seq}` },
  })

  afterEach(() => localStorage.clear())

  it("desenha a marca imediatamente acima da primeira por ler", () => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ "!sala:s": 150 }))
    render(timeline({ messages: [outro(1, 100), outro(2, 200), outro(3, 300)], me: "@eu:s" }))

    const marca = document.querySelector(".timeline-unread-mark")
    expect(marca).toBeTruthy()
    // "Immediately above" means this in DOM: sibling elements in order, and the
    // next sibling is the first unread message.
    const seguinte = marca?.nextElementSibling
    expect(seguinte?.classList.contains("message")).toBe(true)
    expect(seguinte?.textContent).toContain("m2")
  })

  it("sem nada por ler não aparece marca nenhuma nem barra nenhuma", () => {
    // House rule: what you can't use doesn't appear.
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ "!sala:s": 500 }))
    render(timeline({ messages: [outro(1, 100), outro(2, 200)], me: "@eu:s" }))
    expect(document.querySelector(".timeline-unread-mark")).toBeNull()
    expect(document.querySelector(".timeline-unread-jump")).toBeNull()
  })

  it("numa conversa onde nunca se esteve não há marca", () => {
    render(timeline({ messages: [outro(1, 100), outro(2, 200)], me: "@eu:s" }))
    expect(document.querySelector(".timeline-unread-mark")).toBeNull()
  })

  it("as nossas próprias mensagens nunca abrem a marca", () => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ "!sala:s": 150 }))
    const minha: ChatMessage = {
      channel: "!sala:s",
      seq: 2,
      sender: "@eu:s",
      payload: { t: "message", id: "id-2", sentAt: 200, body: "minha" },
    }
    render(timeline({ messages: [outro(1, 100), minha, outro(3, 300)], me: "@eu:s" }))
    const seguinte = document.querySelector(".timeline-unread-mark")?.nextElementSibling
    // Nobody returns to a conversation to read what they just wrote.
    expect(seguinte?.textContent).toContain("m3")
  })
})

/**
 * A poll in the conversation, as seen by those in it.
 *
 * What we prove here is what the person SEES, and the easiest thing to break
 * without noticing: the message body carries the poll written out in full, it
 * saves it on a client that cannot render it, and those who can render it
 * cannot read it twice.
 */
describe("Timeline — votações", () => {
  const PERGUNTA = "Qual é o melhor dia?"
  const CORPO = `${PERGUNTA}\n1. Segunda\n2. Terça`

  function votacao(opcoes: string[]): ChatMessage {
    return {
      channel: "!sala:s",
      seq: 7,
      sender: "@ana:s",
      payload: {
        t: "message",
        id: "votacao-1",
        sentAt: 7,
        body: CORPO,
        poll: { question: PERGUNTA, options: opcoes },
      },
    }
  }

  it("desenha o cartão, e não repete o texto que ele já diz", () => {
    render(timeline({ messages: [votacao(["Segunda", "Terça"])], onVotar: noop }))
    expect(screen.getByRole("heading", { name: PERGUNTA })).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.votacao.votarEm("Segunda") })).toBeTruthy()
    // The full text does not appear: those who render the poll read it once, and
    // the numbered options in the text do not repeat below it.
    expect(document.body.textContent).not.toContain("1. Segunda")
  })

  /**
   * A poll this version cannot render, from a newer client with a form the
   * schema discarded. What remains is the text, and the text says everything: it
   * travels for this reason.
   */
  it("uma votação que não é desenhável deixa o texto no lugar dela", () => {
    render(timeline({ messages: [votacao(["Segunda"])], onVotar: noop }))
    expect(screen.queryByRole("heading", { name: PERGUNTA })).toBeNull()
    // The text is what traveled, line breaks and all: those who read it learn what
    // is being asked and what the answers are, and respond in words.
    expect(document.body.textContent).toContain(PERGUNTA)
    expect(document.body.textContent).toContain("1. Segunda")
    expect(document.body.textContent).toContain("2. Terça")
  })

  it("carregar numa opção vota nela, e diz qual é a mensagem", async () => {
    const user = userEvent.setup()
    const onVotar = vi.fn()
    const mensagem = votacao(["Segunda", "Terça"])
    render(timeline({ messages: [mensagem], onVotar }))
    await user.click(screen.getByRole("button", { name: strings.votacao.votarEm("Terça") }))
    expect(onVotar).toHaveBeenCalledWith(mensagem, 1)
  })

  it("mostra a contagem que a concha apurou, com os nomes de quem votou", () => {
    const mensagem = votacao(["Segunda", "Terça"])
    render(
      timeline({
        messages: [mensagem],
        onVotar: noop,
        nameFor: (sender) => (sender === "@bento:s" ? "Bento" : sender),
        apuramentos: new Map([["votacao-1", { porOpcao: [["@bento:s"], []], total: 1, minha: null }]]),
      }),
    )
    expect(screen.getByText(strings.votacao.total(1))).toBeTruthy()
    expect(screen.getByText("Bento")).toBeTruthy()
  })

  /** Without someone recording the vote, the poll reads but does not vote. */
  it("sem `onVotar` não há por onde votar, e a votação continua a ler-se", () => {
    render(timeline({ messages: [votacao(["Segunda", "Terça"])] }))
    expect(screen.getByRole("heading", { name: PERGUNTA })).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.votacao.votarEm("Segunda") })).toBeNull()
  })

  /**
   * The pinned marker in the message corner.
   *
   * Three things and three tests because they fail for different reasons: that
   * the marker appears on the RIGHT line, that it does not appear on others, and
   * that without any list it does not appear anywhere, the state of a host who
   * cannot answer about pinned messages.
   */
  describe("a marca de fixada", () => {
    it("põe o alfinete na mensagem que está fixada", () => {
      render(timeline({ messages: [messageOf(1, "olá")], fixadas: new Set(["id-1"]) }))
      expect(screen.getByRole("img", { name: strings.chat.pinnedMark })).toBeTruthy()
    })

    it("não a põe nas que não estão", () => {
      render(
        timeline({
          messages: [messageOf(1, "fixada"), messageOf(2, "solta")],
          fixadas: new Set(["id-1"]),
        }),
      )
      expect(screen.getAllByRole("img", { name: strings.chat.pinnedMark })).toHaveLength(1)
    })

    it("sem lista de fixadas não marca nada", () => {
      render(timeline({ messages: [messageOf(1, "olá")] }))
      expect(screen.queryByRole("img", { name: strings.chat.pinnedMark })).toBeNull()
    })
  })
})

/**
 * Empty state cannot point to a box that is not there.
 *
 * The conversation for a pending friend request has no write bar (see
 * `escritaNaDirecta`), and the empty screen still said "the text box is down
 * here. The first message is yours." Measured live on September 10, 2026: the
 * same conversation said at the same time that you could not write and where
 * the box to do it was.
 */
describe("a conversa vazia, quando não há onde escrever", () => {
  it("manda procurar a caixa quando ela existe", () => {
    render(timeline({ messages: [], pending: [] }))
    expect(screen.getByText(strings.chat.timelineEmptyBody)).toBeTruthy()
    expect(screen.queryByText(strings.chat.timelineEmptyLocked)).toBeNull()
  })

  it("e cala-se sobre ela quando não existe", () => {
    render(timeline({ messages: [], pending: [], semCaixaDeEscrita: true }))
    expect(screen.getByText(strings.chat.timelineEmptyLocked)).toBeTruthy()
    expect(screen.queryByText(strings.chat.timelineEmptyBody)).toBeNull()
  })

  /*
    * And form preservation, which survives a rewritten sentence: whatever the
    * text, neither state can tell you about the other.
  */
  it("as duas frases nunca aparecem juntas", () => {
    for (const semCaixaDeEscrita of [true, false]) {
      cleanup()
      render(timeline({ messages: [], pending: [], semCaixaDeEscrita }))
      const ambas =
        screen.queryByText(strings.chat.timelineEmptyBody) !== null &&
        screen.queryByText(strings.chat.timelineEmptyLocked) !== null
      expect(ambas, `com semCaixaDeEscrita=${semCaixaDeEscrita}`).toBe(false)
    }
  })
})

/**
 * The ring in the timeline (the risk of item 10 in the ring report): without
 * `presenceFor` faces grayed out, and the conversation seemed to say everyone
 * was offline.
 */
describe("Timeline — o anel de quem escreveu", () => {
  it("sem `presenceFor`, a cara fica sem anel", () => {
    const { container } = render(timeline({ messages: [messageOf(1, "olá")] }))
    expect(container.querySelector(".message .avatar-wrap")).not.toBeNull()
    expect(container.querySelector(".message [data-anel]")).toBeNull()
  })

  it("com `presenceFor` e `emChamada`, a cor do estado e o pulso", () => {
    const { container } = render(
      timeline({ messages: [messageOf(1, "olá")], presenceFor: () => "busy", emChamada: () => true }),
    )
    const anel = container.querySelector<HTMLElement>(".message [data-anel]")!
    expect(anel.dataset["anel"]).toBe("ocupado")
    expect(anel.hasAttribute("data-em-chamada")).toBe(true)
  })

  it("uma linha agrupada não tem cara, e não pergunta pelo estado", () => {
    const presenceFor = vi.fn(() => "active" as const)
    render(timeline({ messages: [messageOf(1, "olá"), messageOf(2, "outra vez")], presenceFor }))
    expect(presenceFor).toHaveBeenCalledTimes(1)
  })
})

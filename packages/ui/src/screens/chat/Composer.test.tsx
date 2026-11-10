import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { StrictMode, useState } from "react"
import { Composer } from "./Composer.js"
import type { ConnectionState, EnclaveBridge } from "../../bridge.js"
import { BridgeContext } from "../../App.js"
import { readPrefs } from "../../hooks/usePrefs.js"
import { strings } from "../../strings.js"

beforeEach(() => localStorage.clear())
afterEach(cleanup)

/**
 * The host that brings link previews: the main process in
 * Electron, the homeserver on web.
 *
 * Refuse by default. No test in this file asks for a preview, what lives
 * here is that it is NOT requested on its own, and a mock that resolved
 * would hide exactly the defect we want to catch.
 */
const hostPreview = vi.fn<(url: string) => Promise<{ title?: string; image?: string }>>()
hostPreview.mockRejectedValue(new Error("o hospedeiro não conseguiu"))
const bridge = { social: { linkPreview: hostPreview } } as unknown as EnclaveBridge

/**
 * Text is controlled up there, just like on the conversations screen.
 *
 * Inside `StrictMode`, which is how both hosts build the app for real.
 * Not being careful: StrictMode calls state updaters twice and
 * discards the first result, and that is exactly where a bug in saving
 * recent items hid, unnoticed without it.
 */
function Harness({
  connection = "online",
  initial = "",
  onSend = vi.fn(),
  onTyping,
  mentionable,
  onBuzz,
  buzzCooldown,
  onVotacao,
  meuNome,
  onSaveStatus,
}: {
  connection?: ConnectionState
  initial?: string
  onSend?: (body: string, extras?: unknown) => void
  onTyping?: () => void
  mentionable?: { address: string; name: string }[]
  onBuzz?: () => void
  buzzCooldown?: number
  onVotacao?: () => void
  meuNome?: string
  onSaveStatus?: (statusText: string) => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  return (
    <StrictMode>
      <BridgeContext.Provider value={bridge}>
        <Composer
          connection={connection}
          value={value}
          onChange={setValue}
          onSend={onSend}
          {...(onTyping ? { onTyping } : {})}
          {...(mentionable ? { mentionable } : {})}
          {...(onBuzz ? { onBuzz } : {})}
          {...(buzzCooldown !== undefined ? { buzzCooldown } : {})}
          {...(onVotacao ? { onVotacao } : {})}
          {...(meuNome ? { meuNome } : {})}
          {...(onSaveStatus ? { onSaveStatus } : {})}
        />
      </BridgeContext.Provider>
    </StrictMode>
  )
}

function box(): HTMLInputElement {
  return screen.getByPlaceholderText(strings.chat.composerPlaceholder) as HTMLInputElement
}

/** Opens the picker and returns the home of the emoji requested. */
async function pick(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  await user.click(screen.getByLabelText(strings.emoji.open))
  await user.type(screen.getByLabelText(strings.emoji.searchLabel), name)
  await user.click(within(screen.getByRole("group")).getAllByRole("button")[0] as HTMLElement)
}

describe("Composer", () => {
  it("uma mensagem acima de 2000 caracteres não sai: o contador avisa e o botão apaga-se", () => {
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    // `fireEvent` not `user.type`: typing 2001 letters one by one takes time.
    fireEvent.change(box(), { target: { value: "a".repeat(1900) } })
    expect(screen.getByText("100").classList.contains("passou")).toBe(false)
    fireEvent.change(box(), { target: { value: "a".repeat(2001) } })
    expect(screen.getByText("-1").classList.contains("passou")).toBe(true)
    expect((screen.getByText(strings.chat.send).closest("button") as HTMLButtonElement).disabled).toBe(true)
    fireEvent.submit(box().closest("form")!)
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByText(strings.chat.messageTooLong(2000))).toBeTruthy()
    // Still comes out at the cap.
    fireEvent.change(box(), { target: { value: "a".repeat(2000) } })
    expect(screen.getByText("0")).toBeTruthy()
    fireEvent.submit(box().closest("form")!)
    expect(onSend).toHaveBeenCalledWith("a".repeat(2000))
  })

  it("envia o texto sem espaços à volta e limpa a caixa", async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    await user.type(box(), "  olá  ")
    await user.click(screen.getByText(strings.chat.send))
    expect(onSend).toHaveBeenCalledWith("olá")
    expect(box().value).toBe("")
  })

  it("sem ligação escreve-se e envia-se na mesma: a caixa diz que a mensagem sai depois", async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Harness connection="offline" onSend={onSend} />)
    const field = screen.getByPlaceholderText(strings.connection.composerEspera) as HTMLInputElement
    expect(field.disabled).toBe(false)
    expect((screen.getByLabelText(strings.emoji.open) as HTMLButtonElement).disabled).toBe(false)
    await user.type(field, "escrita no comboio")
    await user.click(screen.getByText(strings.chat.send))
    // The box delivers to outbox as always; outbox decides whether to wait.
    expect(onSend).toHaveBeenCalledWith("escrita no comboio")
    expect(field.value).toBe("")
  })

  it('sem ligação, o "+" diz porque não junta imagens nem ficheiros, em vez de abrir o menu', async () => {
    const user = userEvent.setup()
    render(<Harness connection="offline" />)
    expect(screen.queryByText(strings.connection.anexosOffline)).toBeNull()
    await user.click(screen.getByLabelText(strings.chat.moreActions))
    expect(screen.queryByRole("menu")).toBeNull()
    expect(screen.getByText(strings.connection.anexosOffline)).toBeTruthy()
  })

  it("abre o selector pelo botão da caixa de escrita", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.queryByRole("dialog")).toBeNull()
    await user.click(screen.getByLabelText(strings.emoji.open))
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("acrescenta o emoji ao fim de uma caixa por tocar", async () => {
    const user = userEvent.setup()
    render(<Harness initial="bom dia" />)
    await pick(user, "girassol")
    expect(box().value).toBe("bom dia🌻")
  })

  it("mete o emoji onde o cursor estava, e não no fim", async () => {
    const user = userEvent.setup()
    render(<Harness initial="ola mundo" />)
    box().setSelectionRange(3, 3)
    await pick(user, "girassol")
    expect(box().value).toBe("ola🌻 mundo")
  })

  it("substitui o texto que estivesse seleccionado", async () => {
    const user = userEvent.setup()
    render(<Harness initial="ola mundo" />)
    box().setSelectionRange(0, 3)
    await pick(user, "girassol")
    expect(box().value).toBe("🌻 mundo")
  })

  it("fecha o selector e devolve o cursor à escrita", async () => {
    const user = userEvent.setup()
    render(<Harness initial="ola" />)
    await pick(user, "girassol")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(box())
    // After the emoji, not at the end of text that might come next.
    expect(box().selectionStart).toBe("ola🌻".length)
  })

  /**
   * Picking closes the selector in the same batch of updates where it saves the
   * recent. While saving lived inside a state updater, React threw it away with
   * the component and the just-used emoji did not show the next time, a thing
   * you only saw when opening the panel again.
   */
  it("guarda o recente apesar de escolher fechar o selector", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await pick(user, "girassol")
    expect(readPrefs().emojiRecents).toEqual(["🌻"])

    await user.click(screen.getByLabelText(strings.emoji.open))
    expect(screen.getByRole("group").getAttribute("aria-label")).toBe(strings.emoji.recents)
  })

  it("deixa escrever logo a seguir ao emoji", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await pick(user, "girassol")
    await user.keyboard("!")
    expect(box().value).toBe("🌻!")
  })
})

describe("Composer — o sinal de escrita", () => {
  it("avisa a cada tecla, e é o hook que decide o que sai para o fio", async () => {
    // The box does no cadence on purpose: the decision to send (or not) lives
    // in one place, with the numbers explained, see `useTyping.ts`.
    const user = userEvent.setup()
    const onTyping = vi.fn()
    render(<Harness onTyping={onTyping} />)
    await user.type(box(), "olá")
    expect(onTyping).toHaveBeenCalledTimes(3)
  })

  it("offline não avisa: um sinal que não pode sair não vale o erro", async () => {
    const onTyping = vi.fn()
    render(<Harness connection="offline" onTyping={onTyping} />)
    expect(onTyping).not.toHaveBeenCalled()
  })
})

describe("Composer — pré-visualização de link", () => {
  it("um endereço no texto oferece pré-visualizar, sem ir buscar nada sozinho", async () => {
    // Fetching on its own would mean typing an address already tells the device
    // to talk to the site, before there is a message, and even if the sentence
    // is deleted after. The click is consent.
    const user = userEvent.setup()
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    hostPreview.mockClear()
    render(<Harness />)
    await user.type(box(), "vê https://exemplo.pt")
    expect(screen.getByText(strings.chat.linkPreviewAsk)).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
    // And not the host either: the fetch moved to be done by it, and the rule
    // of only fetching after someone clicks still holds.
    expect(hostPreview).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it("texto sem endereço não mostra tira nenhuma", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), "só palavras")
    expect(screen.queryByText(strings.chat.linkPreviewAsk)).toBeNull()
  })

  it("um vídeo do YouTube segue reproduzível sem ninguém pedir pré-visualização", async () => {
    // The owner's request. Without `links` in the message, the reader gets a line
    // of text: the card MUST exist when Enter is pressed, not just
    // when the preview comes from the host, which may not come at all.
    const user = userEvent.setup()
    const onSend = vi.fn()
    hostPreview.mockClear()
    render(<Harness onSend={onSend} />)
    await user.type(box(), "olha isto https://www.youtube.com/watch?v=aqz-KE-bpKQ")
    await user.type(box(), "{Enter}")

    expect(onSend).toHaveBeenCalledWith(
      "olha isto https://www.youtube.com/watch?v=aqz-KE-bpKQ",
      expect.objectContaining({
        links: [{ url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", kind: "video" }],
      }),
    )
  })

  it("dispensar a tira não apaga o link do texto", async () => {
    // The address still goes and stays clickable on the other side. What was
    // cut was the card.
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), "https://exemplo.pt")
    await user.click(screen.getByLabelText(strings.chat.linkPreviewDrop))
    expect(screen.queryByText(strings.chat.linkPreviewAsk)).toBeNull()
    expect(box().value).toBe("https://exemplo.pt")
  })
})

/**
 * The three gestures that are not typing live in a menu, not in the input bar.
 *
 * At 390px the bar broke with emojis, image, clip, buzz, and the input box.
 * Of three measured layouts, the owner chose this one on August 12, 2026: keep
 * the box wide and put the rarest action one click away. File fields stay in
 * the form, hidden, and the menu opens them.
 */
const campoDeImagens = (): HTMLInputElement =>
  document.querySelector('input[type="file"][accept*="image"]') as HTMLInputElement

const campoDeFicheiros = (): HTMLInputElement =>
  [...document.querySelectorAll('input[type="file"]')].find(
    (campo) => !campo.getAttribute("accept"),
  ) as HTMLInputElement

/** Opens the menu from the `+`, where you reach attachments and buzz. */
async function abrirMais(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTitle(strings.chat.moreActions))
}

describe("Composer — imagens", () => {
  it("juntar imagem vive no menu, e o campo fecha-se quando não há ligação", async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness />)
    await abrirMais(user)
    expect(screen.getByRole("menuitem", { name: strings.chat.imageAdd })).toBeTruthy()
    unmount()

    render(<Harness connection="offline" />)
    expect(campoDeImagens().disabled).toBe(true)
  })

  it("sem texto nem imagens, o botão de enviar está fechado", () => {
    render(<Harness />)
    expect((screen.getByText(strings.chat.send) as HTMLButtonElement).disabled).toBe(true)
  })

  it("envia com um argumento só quando não há nada agarrado", async () => {
    // Nothing downstream, neither the outbox nor the hosts, needs to learn a
    // new way for the most common case, which is plain text.
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    await user.type(box(), "olá")
    await user.click(screen.getByText(strings.chat.send))
    expect(onSend).toHaveBeenCalledWith("olá")
  })
})

/**
 * Attach files that are not images.
 *
 * What these tests guard is rejection more than acceptance: an attachment that
 * fits the schema may be too large for the frame the server reads, and finding
 * that out at send time costs the whole connection. The limit lives in
 * `@enclave/client-core`, `anexos.ts`, measured against the real cipher; here
 * we check that the input box queries it BEFORE accepting anything.
 */
describe("Composer — ficheiros", () => {
  /** A file of the requested size, without wasting memory faking the bytes. */
  function ficheiro(nome: string, bytes: number, tipo = "application/pdf"): File {
    const file = new File(["x"], nome, { type: tipo })
    // `File` doesn't let you write `size`, and writing actual bytes to test a
    // three-megabyte cap would waste three megabytes per test.
    Object.defineProperty(file, "size", { value: bytes })
    return file
  }

  const clipe = (): HTMLInputElement => campoDeFicheiros()

  it("a entrada existe a seguir à da imagem, e o campo fecha-se sem ligação", async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness />)
    await abrirMais(user)
    const entradas = screen.getAllByRole("menuitem").map((item) => item.textContent ?? "")
    // Image first: it is the everyday gesture.
    expect(entradas[0]).toContain(strings.chat.imageAdd)
    expect(entradas[1]).toContain(strings.chat.fileAdd)
    unmount()

    render(<Harness connection="offline" />)
    expect(clipe().disabled).toBe(true)
  })

  it("a entrada diz o tecto antes de alguém escolher seja o que for", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await abrirMais(user)
    // We do not need to guard the exact number, just that there is one. An option
    // that only says the limit after you exceed it forces you to guess.
    expect(screen.getByRole("menuitem", { name: new RegExp(`${strings.chat.fileAdd} \\(máx\\. [\\d,]+ MB\\)`) })).toBeTruthy()
  })

  it("aceita um PDF e mostra o nome, a extensão e o peso", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.upload(clipe(), ficheiro("relatório.pdf", 240_000))
    // `find` not `get`: the file is read by a `FileReader`, whose callback is a
    // macrotask. With `get`, this test passed alone and failed with the machine
    // busy, the worst way a test can fail.
    expect(await screen.findByText("relatório.pdf")).toBeTruthy()
    expect(screen.getByText("PDF")).toBeTruthy()
    expect(screen.getByText("240 kB")).toBeTruthy()
  })

  it("um ficheiro grande de mais é recusado, e a recusa diz o número", async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    // Four megabytes: exceeds the cap of any message, even empty.
    await user.upload(clipe(), ficheiro("enorme.zip", 4_000_000, "application/zip"))
    const aviso = screen.getByText(new RegExp("enorme.zip não cabe"))
    expect(aviso).toBeTruthy()
    // The number must be there: without it, the person tries again blind.
    expect(aviso.textContent).toMatch(/[\d,]+ MB/)
    // And it did not enter: rejected BEFORE it left, which is the point.
    expect(screen.queryByText("enorme.zip")).toBeNull()
  })

  it("o nome do remetente nunca é um caminho, nem na própria caixa de escrita", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.upload(clipe(), ficheiro("../../.ssh/authorized_keys", 1000, "text/plain"))
    expect(await screen.findByText("authorized_keys")).toBeTruthy()
    expect(screen.queryByText("../../.ssh/authorized_keys")).toBeNull()
  })

  it("um ficheiro sozinho é uma mensagem legítima, e sai em `files`", async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    expect((screen.getByText(strings.chat.send) as HTMLButtonElement).disabled).toBe(true)
    await user.upload(clipe(), ficheiro("contrato.pdf", 1000))
    await screen.findByText("contrato.pdf")
    expect((screen.getByText(strings.chat.send) as HTMLButtonElement).disabled).toBe(false)

    await user.click(screen.getByText(strings.chat.send))
    expect(onSend).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        // `files` not `images`: the field that takes a PDF cannot be called images, // see `OutgoingFile` in the protocol.
        files: [expect.objectContaining({ name: "contrato.pdf", mediaType: "application/pdf" })],
      }),
    )
  })

  it("tirar a ficha tira o ficheiro", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.upload(clipe(), ficheiro("engano.zip", 1000, "application/zip"))
    await user.click(await screen.findByLabelText(strings.chat.fileDrop("engano.zip")))
    expect(screen.queryByText("engano.zip")).toBeNull()
  })
})

/**
 * Paste images into the input box.
 *
 * What these tests guard, in order of importance:
 *
 * 1. **Pasting text still pastes text.** This is the regression worth more than
 *    the whole feature: a box that swallows a pasted sentence because it was
 *    looking for images is worse than a box that cannot paste images.
 * 2. **The pasted image goes through the SAME path as the button**, same
 *    compressor, same preview, same `images` in the outgoing message.
 * 3. **A rejection says why**, in Portuguese, and never happens in silence.
 *
 * The `paste` here is built by hand, because jsdom has no clipboard and no
 * real `ClipboardEvent`. Real pasting, `Cmd+V` in a real Chrome, with a real
 * image inside, is measured in `scripts/medir-colar-e-comprimir.mjs`, and
 * that is where we prove the browser delivers what this mock fakes.
 */
describe("Composer — colar imagens", () => {
  /** The eight bytes that say PNG, and some random rest. */
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0, 0, 0, 0])

  function imagem(nome: string, bytes: Uint8Array = PNG, tipo = "image/png"): File {
    return new File([bytes as BlobPart], nome, { type: tipo })
  }

  /**
   * An image with real bytes, not faked size.
   *
   * The file block fakes `size` with a `defineProperty` and saves memory. Here
   * it does not work: pasting rewraps the file in a new `File`, that is how it
   * gets the type the BYTES said, and a faked size does not survive the rewrap.
   * Half a megabyte is enough to exceed the conversation budget (400 KB) and
   * cheap to write.
   */
  function imagemPesada(nome: string, bytes: number): File {
    const conteudo = new Uint8Array(bytes)
    conteudo.set(PNG.slice(0, 8))
    return new File([conteudo as BlobPart], nome, { type: "image/png" })
  }

  /** The clipboard as the browser delivers it to a `paste`. */
  function areaDeTransferencia(texto: string, ficheiros: File[]): DataTransfer {
    return {
      types: [...(texto ? ["text/plain"] : []), ...ficheiros.map((f) => f.type)],
      getData: (tipo: string) => (tipo === "text/plain" ? texto : ""),
      items: ficheiros.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
      files: ficheiros,
    } as unknown as DataTransfer
  }

  /** Pastes, and returns whether the browser stayed free to paste its own way. */
  function colar(texto: string, ficheiros: File[] = []): boolean {
    return fireEvent.paste(box(), { clipboardData: areaDeTransferencia(texto, ficheiros) })
  }

  it("colar texto não é travado, e não faz aparecer imagem nenhuma", async () => {
    render(<Harness />)
    // `true` means nobody called `preventDefault`: the browser will paste the
    // text as it always has. It is the only way to assert it in jsdom, which does
    // not paste anything on its own.
    expect(colar("uma frase colada")).toBe(true)
    await Promise.resolve()
    expect(document.querySelector(".composer-images")).toBeNull()
  })

  it("uma tabela copiada do Excel cola o texto, e não a fotografia das células", async () => {
    // Excel and Word put both on the clipboard. When you copy a table you want
    // the table.
    render(<Harness />)
    expect(colar("Nome\tValor", [imagem("celulas.png")])).toBe(true)
    await Promise.resolve()
    expect(document.querySelector(".composer-images")).toBeNull()
  })

  it("colar uma imagem põe-na na mensagem, com pré-visualização", async () => {
    render(<Harness />)
    expect(colar("", [imagem("captura.png")])).toBe(false)
    const miniatura = (await screen.findByAltText("captura.png")) as HTMLImageElement
    expect(miniatura.src.startsWith("data:image/png")).toBe(true)
    // And it has the button to remove it, like any image chosen by the button.
    expect(screen.getByLabelText(strings.chat.imageDrop("captura.png"))).toBeTruthy()
  })

  it("a imagem colada sai na mensagem como as outras, em `images`", async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    colar("", [imagem("captura.png")])
    await screen.findByAltText("captura.png")
    await user.click(screen.getByText(strings.chat.send))
    expect(onSend).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        images: [expect.objectContaining({ name: "captura.png", mediaType: "image/png" })],
      }),
    )
  })

  it("uma captura de ecrã chega sem nome e leva um com a extensão certa", async () => {
    render(<Harness />)
    colar("", [imagem("")])
    const miniatura = (await screen.findByRole("img")) as HTMLImageElement
    expect(miniatura.alt).toMatch(/\.png$/)
  })

  it("o que se diz imagem e não é fica de fora, e a caixa diz porquê", async () => {
    // An SVG declared `image/png`: the type is from the sender, the bytes are not.
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')
    render(<Harness />)
    expect(colar("", [imagem("truque.png", svg)])).toBe(false)
    expect(await screen.findByText(strings.common.pasteNotImage)).toBeTruthy()
    expect(document.querySelector(".composer-images")).toBeNull()
  })

  it("uma imagem grande de mais é recusada com uma frase, e não em silêncio", async () => {
    // No decoder, the case in jsdom and any engine without `createImageBitmap`, // the compressor shrinks nothing and rejects what does not fit. What we guard
    // here is not the text of the rejection: it is that IT APPEARS. A paste that
    // does nothing and says nothing is the worst outcome.
    render(<Harness />)
    colar("", [imagemPesada("gigante.png", 500_000)])
    await vi.waitFor(() => {
      const nota = document.querySelector(".field-note.warn")
      // A full sentence about the image, not a code or nothing.
      expect(nota?.textContent ?? "").toMatch(/imagens?/i)
      expect((nota?.textContent ?? "").length).toBeGreaterThan(20)
    })
    expect(document.querySelector(".composer-images")).toBeNull()
  })

  it("colar não estraga o texto que já lá estava", async () => {
    // The `preventDefault` blocks the browser; it cannot block anything else. The
    // text half-written stays half-written, and the send carries both.
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    await user.type(box(), "olha isto")
    colar("", [imagem("captura.png")])
    await screen.findByAltText("captura.png")
    expect(box().value).toBe("olha isto")
    await user.click(screen.getByText(strings.chat.send))
    expect(onSend).toHaveBeenCalledWith("olha isto", expect.objectContaining({ images: expect.any(Array) }))
  })
})

/**
 * The buzz button in the input bar.
 *
 * It moved here from the header, and the move brought a trap that did not
 * exist there: inside here is a `<form>`, and a button with no `type` inside a
 * form SUBMITS it. The sweep in `botoesEmFormulario.test.ts` does not catch
 * this, it reads file by file, and the `<form>` is in Composer while the
 * button is in BuzzButton. This test is what fills that gap.
 */
/*
  Was HIDDEN from August 18 to October 28, 2026, by the owner's choice, with
  this block in `describe.skip`. It came back (`MOSTRAR_COTOVELADA` in
  `Composer.tsx`), and here we confirm it came back whole: without submitting
  the form, without sending the half-written message, and with the wait time in
  the label. The one-per-minute cap lives in `useBuzz` (see `useBuzz.test.tsx`).
*/
describe("Composer — a cotovelada", () => {
  const entradaDaCotovelada = (): HTMLElement =>
    screen.getByRole("menuitem", { name: new RegExp(strings.chat.buzz) })

  it("não existe quando a conversa não a admite", async () => {
    // In a group channel the screen above does not deliver any `onBuzz`: thirty
    // buzzes at once are not a buzz, they are an alarm.
    const user = userEvent.setup()
    render(<Harness />)
    await abrirMais(user)
    expect(screen.queryByRole("menuitem", { name: new RegExp(strings.chat.buzz) })).toBeNull()
  })

  it("aparece no menu quando a conversa a admite, depois dos anexos", async () => {
    const user = userEvent.setup()
    render(<Harness onBuzz={vi.fn()} />)
    await abrirMais(user)
    const entradas = screen.getAllByRole("menuitem").map((item) => item.textContent ?? "")
    expect(entradas.at(-1)).toContain(strings.chat.buzz)
  })

  it("dá a cotovelada SEM enviar a mensagem que estava escrita", async () => {
    // The trap stays the same with the menu in front: what comes out here cannot
    // submit the form and send the half-written text. It is also why the menu
    // lives OUTSIDE the <form>.
    const user = userEvent.setup()
    const onSend = vi.fn()
    const onBuzz = vi.fn()
    render(<Harness onSend={onSend} onBuzz={onBuzz} initial="frase a meio" />)
    await abrirMais(user)
    await user.click(entradaDaCotovelada())
    expect(onBuzz).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
    expect(box().value).toBe("frase a meio")
  })

  it("enquanto o intervalo corre, a entrada diz quantos segundos faltam", async () => {
    /*
      The input does not disappear during the wait, and that is a choice: an
      option that vanishes and returns on its own makes the person doubt what
      they saw. It says the time, and `useBuzz` still refuses if it is not time
      yet, the guard lives there and never here.
    */
    const user = userEvent.setup()
    render(<Harness onBuzz={vi.fn()} buzzCooldown={5} />)
    await abrirMais(user)
    expect(entradaDaCotovelada().textContent).toContain("5")
  })

  it("os botões da linha são ícones desenhados, sem um símbolo à vista", () => {
    render(<Harness onBuzz={vi.fn()} />)
    const linha = document.querySelector(".composer-line") as HTMLElement
    // Two left in the bar after attachments and buzz moved to the menu. The rule
    // is the same for both that stayed.
    const botoes = [screen.getByLabelText(strings.emoji.open), screen.getByTitle(strings.chat.moreActions)]
    for (const botao of botoes) {
      expect(linha.contains(botao)).toBe(true)
      expect(botao.querySelector("svg")).toBeTruthy()
      // Only the hidden label; no emoji, no loose glyph.
      expect(botao.textContent ?? "").not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
    }
  })
})

/**
 * Mention someone: the name on screen, the address in the message.
 *
 * The keyboard is the part that usually gets painful, and that is what we
 * guard here. A menu that opens over the input box steals the arrow keys and
 * Enter, and the two known ways to break this are swallowing the text on Escape
 * and sending the message mid-choice.
 */
describe("menções na caixa de escrita", () => {
  const ANA = { address: "@milsinda-odreto-viddyvox-pofletum:orwell.pt", name: "Ana" }
  const RITA = { address: "@sactynsis-peldenda-horriro-xethoga:orwell.pt", name: "Ana Rita" }
  const PESSOAS = [ANA, RITA]

  const caixa = (): HTMLElement => screen.getByPlaceholderText(strings.chat.composerPlaceholder)

  it("a arroba abre as sugestões de quem está na sala", async () => {
    const user = userEvent.setup()
    render(<Harness mentionable={PESSOAS} />)
    await user.type(caixa(), "olá @an")
    expect(screen.getByRole("listbox")).toBeTruthy()
    // By accessible name: the face next to it is hidden from listeners, and that
    // name, not the loose text of the element, is what a blind person hears.
    expect(screen.getAllByRole("option")).toHaveLength(2)
    expect(screen.getByRole("option", { name: "Ana" })).toBeTruthy()
    expect(screen.getByRole("option", { name: "Ana Rita" })).toBeTruthy()
  })

  it("escolher põe o NOME na caixa, não o endereço", async () => {
    // Half a line of Latin per mentioned person, in a field that on a phone has
    // maybe three hundred pixels, was what there was room to write the address
    // here.
    const user = userEvent.setup()
    render(<Harness mentionable={PESSOAS} />)
    await user.type(caixa(), "olá @an")
    await user.click(screen.getByRole("option", { name: "Ana" }))
    expect((caixa() as HTMLInputElement).value).toBe("olá @Ana ")
  })

  it("no envio, o nome vira endereço e a lista de menções acompanha", async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<Harness mentionable={PESSOAS} onSend={onSend} />)
    await user.type(caixa(), "@an")
    await user.click(screen.getByRole("option", { name: "Ana" }))
    await user.type(caixa(), "bom dia")
    await user.click(screen.getByRole("button", { name: strings.chat.send }))
    expect(onSend).toHaveBeenCalledWith(`${ANA.address} bom dia`, expect.objectContaining({ mentions: [ANA.address] }))
  })

  it("Escape fecha o menu E NÃO APAGA O QUE ESTAVA ESCRITO", async () => {
    // The worst trade possible: press Escape to get the menu out of the way and
    // lose the half-written text beneath it.
    const user = userEvent.setup()
    render(<Harness mentionable={PESSOAS} />)
    await user.type(caixa(), "olá @an")
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("listbox")).toBeNull()
    expect((caixa() as HTMLInputElement).value).toBe("olá @an")
  })

  it("Enter com o menu aberto escolhe, e não envia", async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<Harness mentionable={PESSOAS} onSend={onSend} />)
    await user.type(caixa(), "olá @an")
    await user.keyboard("{Enter}")
    expect(onSend).not.toHaveBeenCalled()
    expect((caixa() as HTMLInputElement).value).toBe("olá @Ana ")
  })

  it("as setas andam na lista, e o Enter leva o que está escolhido", async () => {
    const user = userEvent.setup()
    render(<Harness mentionable={PESSOAS} />)
    await user.type(caixa(), "@an")
    await user.keyboard("{ArrowDown}")
    await user.keyboard("{Enter}")
    expect((caixa() as HTMLInputElement).value).toBe("@Ana Rita ")
  })

  it("depois de escolher, o Enter volta a enviar", async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<Harness mentionable={PESSOAS} onSend={onSend} />)
    await user.type(caixa(), "@an")
    await user.keyboard("{Enter}")
    await user.keyboard("{Enter}")
    expect(onSend).toHaveBeenCalledWith(ANA.address, expect.objectContaining({ mentions: [ANA.address] }))
  })

  it("uma mensagem sem menções nenhumas continua a ser enviada como sempre foi", async () => {
    // With no attachments or mentions it is called with one argument only: nothing
    // downstream needs to learn a new way.
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<Harness mentionable={PESSOAS} onSend={onSend} />)
    await user.type(caixa(), "bom dia")
    await user.click(screen.getByRole("button", { name: strings.chat.send }))
    expect(onSend).toHaveBeenCalledWith("bom dia")
  })

  it("quem foi escolhido e depois apagado à mão não é mencionado", async () => {
    // Notifying someone who is no longer written anywhere would be the app
    // reporting something that did not happen.
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<Harness mentionable={PESSOAS} onSend={onSend} />)
    await user.type(caixa(), "@an")
    await user.click(screen.getByRole("option", { name: "Ana" }))
    await user.clear(caixa())
    await user.type(caixa(), "mudei de ideias")
    await user.click(screen.getByRole("button", { name: strings.chat.send }))
    expect(onSend).toHaveBeenCalledWith("mudei de ideias")
  })

  it("sem ninguém para mencionar, a arroba é só uma arroba", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(caixa(), "olá @an")
    expect(screen.queryByRole("listbox")).toBeNull()
  })
})

/**
 * The poll, in the `+` menu, next to the other non-typing gestures.
 *
 * The box does not build the poll or send it: it says someone asked for one.
 * The shell builds it, because it knows the channel and the room.
 */
describe("Composer — votações", () => {
  /*
    HIDDEN on August 18, 2026: see `MOSTRAR_VOTACOES`. Suspended, not deleted,     here we confirm creation came back whole the day it returns. The rest of the
    block still runs: a poll that already exists draws itself and takes votes the
    same, and that was not turned off.
    */
  it.skip("a entrada aparece no menu quando há por onde criar uma", async () => {
    const user = userEvent.setup()
    const onVotacao = vi.fn()
    render(<Harness onVotacao={onVotacao} />)
    await abrirMais(user)
    await user.click(screen.getByText(strings.votacao.criar))
    expect(onVotacao).toHaveBeenCalled()
  })

  /** Without a receiver there is no entry: what cannot be used does not appear. */
  it("e não aparece quando não há", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await abrirMais(user)
    expect(screen.queryByText(strings.votacao.criar)).toBeNull()
  })
})

describe("Composer: um separador que já não escreve", () => {
  function comPonte(escreve: (() => boolean) | undefined, connection: ConnectionState = "online"): void {
    const ponte = {
      social: { linkPreview: hostPreview },
      session: escreve ? { escreve } : {},
    } as unknown as EnclaveBridge
    render(
      <BridgeContext.Provider value={ponte}>
        <Composer connection={connection} value="" onChange={() => {}} onSend={vi.fn()} />
      </BridgeContext.Provider>,
    )
  }

  it("com `escreve` a dizer que não, a caixa fecha e diz para recarregar", () => {
    comPonte(() => false, "reconnecting")
    const caixa = screen.getByPlaceholderText(strings.connection.separadorParado) as HTMLInputElement
    expect(caixa.disabled).toBe(true)
    expect(screen.getByText(strings.connection.separadorParado, { selector: "p" })).toBeTruthy()
    expect((screen.getByText(strings.chat.send) as HTMLButtonElement).disabled).toBe(true)
  })

  it("sem a pergunta na ponte, ou a dizer que sim, escreve-se como sempre", () => {
    comPonte(undefined, "reconnecting")
    expect((screen.getByPlaceholderText(strings.connection.composerEspera) as HTMLInputElement).disabled).toBe(false)
    cleanup()
    comPonte(() => true)
    expect((screen.getByPlaceholderText(strings.chat.composerPlaceholder) as HTMLInputElement).disabled).toBe(false)
  })
})

/**
 * Slash commands, IRC-style (owner request from 28 October 2026).
 *
 * How they work: `/me` sends as TEXT in italics with the name in front, and
 * nothing else (the protocol doesn't know a command ran); `/away` and
 * `/estado` call the same `onSaveStatus` from the account card and send no
 * message; the three that depend on the core say they arrive in the next
 * release and also send nothing; and the list shows when you type `/`, using
 * the mention keyboard.
 */
describe("Composer — comandos com barra", () => {
  const lista = (): HTMLElement => screen.getByRole("listbox", { name: strings.barra.lista })

  it("/me envia a acção em itálico, com o nome de quem escreve à frente", async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Harness onSend={onSend} meuNome="Duarte" />)
    await user.type(box(), "/me acena ao grupo{Enter}")
    expect(onSend).toHaveBeenCalledWith("*Duarte acena ao grupo*")
    expect(box().value).toBe("")
  })

  it("/me sem nome sai só com a acção, e /me vazio não envia nada", async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    await user.type(box(), "/me acena{Enter}")
    expect(onSend).toHaveBeenCalledWith("*acena*")

    fireEvent.change(box(), { target: { value: "/me" } })
    fireEvent.submit(box().closest("form")!)
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(screen.getByText(strings.barra.meVazio)).toBeTruthy()
  })

  it("/away põe a mensagem pessoal pelo onSaveStatus, e não envia mensagem", async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    const onSaveStatus = vi.fn()
    render(<Harness onSend={onSend} onSaveStatus={onSaveStatus} />)
    await user.type(box(), "/away fui almoçar{Enter}")
    expect(onSaveStatus).toHaveBeenCalledWith("fui almoçar")
    expect(onSend).not.toHaveBeenCalled()
    expect(box().value).toBe("")
    expect(screen.getByText(strings.barra.estadoPosto)).toBeTruthy()
  })

  it("/estado sem texto apaga a mensagem pessoal, como o /away do IRC", () => {
    const onSaveStatus = vi.fn()
    render(<Harness onSaveStatus={onSaveStatus} />)
    fireEvent.change(box(), { target: { value: "/estado" } })
    fireEvent.submit(box().closest("form")!)
    expect(onSaveStatus).toHaveBeenCalledWith("")
    expect(screen.getByText(strings.barra.estadoApagado)).toBeTruthy()
  })

  it("/away acima de 128 caracteres não muda nada, e diz o tecto", () => {
    const onSaveStatus = vi.fn()
    render(<Harness onSaveStatus={onSaveStatus} />)
    fireEvent.change(box(), { target: { value: `/away ${"a".repeat(129)}` } })
    fireEvent.submit(box().closest("form")!)
    expect(onSaveStatus).not.toHaveBeenCalled()
    expect(screen.getByText(strings.barra.estadoLongo(128))).toBeTruthy()
  })

  it("sem onSaveStatus, /away diz onde se muda e não envia o comando como texto", () => {
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    fireEvent.change(box(), { target: { value: "/away fui almoçar" } })
    fireEvent.submit(box().closest("form")!)
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByText(strings.barra.estadoIndisponivel)).toBeTruthy()
    // The text stays, so the person does not lose it.
    expect(box().value).toBe("/away fui almoçar")
  })

  it("/nick, /topic e /kick dizem que chegam na próxima versão, e não enviam nada", () => {
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    for (const nome of ["nick", "topic", "kick"]) {
      fireEvent.change(box(), { target: { value: `/${nome} ana` } })
      fireEvent.submit(box().closest("form")!)
      expect(screen.getByText(strings.barra.naProximaVersao(`/${nome}`))).toBeTruthy()
    }
    expect(onSend).not.toHaveBeenCalled()
  })

  it("um caminho ou um comando desconhecido sai como texto, tal como foi escrito", async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    await user.type(box(), "/home/ana/notas.txt{Enter}")
    expect(onSend).toHaveBeenLastCalledWith("/home/ana/notas.txt")
  })

  it("escrever / abre a lista dos seis, com a descrição de cada um", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), "/")
    const opcoes = within(lista()).getAllByRole("option")
    expect(opcoes.map((opcao) => opcao.textContent)).toEqual([
      `/me${strings.barra.descricao.me}`,
      `/away${strings.barra.descricao.away}`,
      `/estado${strings.barra.descricao.estado}`,
      `/nick${strings.barra.descricao.nick}`,
      `/topic${strings.barra.descricao.topic}`,
      `/kick${strings.barra.descricao.kick}`,
    ])
    expect(box().getAttribute("role")).toBe("combobox")
  })

  it("a lista filtra, as setas andam, e Enter escolhe sem enviar", async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    await user.type(box(), "/a")
    expect(within(lista()).getAllByRole("option")).toHaveLength(1)

    fireEvent.change(box(), { target: { value: "/" } })
    await user.keyboard("{ArrowDown}{Enter}")
    expect(box().value).toBe("/away ")
    expect(onSend).not.toHaveBeenCalled()
    // After the space the list closes: the person already chose.
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("um clique na lista escolhe o comando", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), "/")
    fireEvent.mouseDown(within(lista()).getAllByRole("option")[0] as HTMLElement)
    expect(box().value).toBe("/me ")
  })

  it("Escape fecha a lista sem mexer no texto", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), "/m")
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(box().value).toBe("/m")
  })
})

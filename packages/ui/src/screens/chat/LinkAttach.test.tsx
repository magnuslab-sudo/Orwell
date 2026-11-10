import { afterEach, describe, expect, it, vi } from "vitest"
import { useEffect, useState } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { EnclaveBridge, LinkCard } from "../../bridge.js"
import { BridgeContext } from "../../App.js"
import { strings } from "../../strings.js"
import { LinkAttach } from "./LinkAttach.js"

afterEach(() => {
  cleanup()
  hostPreview.mockReset()
  hostPreview.mockRejectedValue(new Error("o hospedeiro não conseguiu"))
})

/**
 * The host that brings the previews: the main process in Electron, the
 * homeserver on the web. Refuses by default, so each test can say what it wants.
 */
const hostPreview = vi.fn<(url: string) => Promise<{ title?: string; image?: string }>>()
hostPreview.mockRejectedValue(new Error("o hospedeiro não conseguiu"))
const bridge = { social: { linkPreview: hostPreview } } as unknown as EnclaveBridge

const VIDEO = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
/** A 1×1 PNG, which is what the host returns after fetching it. */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

/**
 * The support mimics the input box, and is not decoration: the `Composer`
 * throws away the card whenever the address changes, and that rule makes an
 * address grow (`&t=42` written next) look like a new address.
 */
function Harness({ url, registo }: { url: string; registo?: (card: LinkCard | null) => void }): React.JSX.Element {
  const [card, setCard] = useState<LinkCard | null>(null)
  useEffect(() => {
    setCard((atual) => (atual && atual.url === url ? atual : null))
  }, [url])
  return (
    <BridgeContext.Provider value={bridge}>
      <LinkAttach
        url={url}
        card={card}
        onChange={(proximo) => {
          registo?.(proximo)
          setCard(proximo)
        }}
        onDismiss={() => setCard(null)}
      />
    </BridgeContext.Provider>
  )
}

describe("LinkAttach — um vídeo do YouTube não espera por botão nenhum", () => {
  it("o cartão nasce com o endereço, antes de haver um único pedido", async () => {
    // This is what makes the video arrive playable on the other side even for
    // someone who pastes the link and presses Enter the next instant: without the
    // card there are no `links` in the message, and without `links` the reader gets
    // text and nothing else.
    const mudancas: (LinkCard | null)[] = []
    render(<Harness url={VIDEO} registo={(c) => mudancas.push(c)} />)

    expect(mudancas[0]).toEqual({ url: VIDEO, kind: "video" })
    // And it is born BEFORE talking to the host: the wait is theirs, not the card's.
    expect(hostPreview).not.toHaveBeenCalled()
  })

  it("o título e a miniatura entram sozinhos, sem ninguém carregar em nada", async () => {
    // The owner's request: "YouTube video and link previews should preview
    // automatically".
    hostPreview.mockResolvedValue({ title: "Big Buck Bunny", image: PNG })
    render(<Harness url={VIDEO} />)

    expect(await screen.findByText("Big Buck Bunny", {}, { timeout: 4000 })).toBeTruthy()
    expect(hostPreview).toHaveBeenCalledWith(VIDEO)
    // And no button is left asking for what was already done.
    expect(screen.queryByText(strings.chat.linkPreviewAsk)).toBeNull()
  })

  it("a miniatura que entra são bytes, e nunca um endereço do Google", async () => {
    // The facade draws itself without talking to anyone because the pixels travel
    // inside the encrypted message. A `src` to `i.ytimg.com` would put the request
    // coming out of the browser of WHOEVER READS, without anyone having pressed
    // anything.
    hostPreview.mockResolvedValue({ title: "Big Buck Bunny", image: PNG })
    const { container } = render(<Harness url={VIDEO} />)

    await screen.findByText("Big Buck Bunny", {}, { timeout: 4000 })
    const miniatura = await waitFor(
      () => {
        const alvo = container.querySelector(".facade-thumb")
        if (!alvo) throw new Error("ainda sem miniatura")
        return alvo
      },
      { timeout: 4000 },
    )
    expect(miniatura.getAttribute("src")?.startsWith("data:image/")).toBe(true)
    for (const elemento of container.querySelectorAll("img, iframe")) {
      expect(elemento.getAttribute("src")?.startsWith("data:")).toBe(true)
    }
  })

  it("o mesmo vídeo não se vai buscar duas vezes quando o endereço cresce", async () => {
    // `?t=42` written next is the same video. Without this, each key after the
    // identifier was another request to Google, and the card that had already
    // arrived would vanish with it.
    hostPreview.mockResolvedValue({ title: "Big Buck Bunny" })
    const { rerender } = render(<Harness url={VIDEO} />)
    await screen.findByText("Big Buck Bunny", {}, { timeout: 4000 })

    rerender(<Harness url={`${VIDEO}&t=42`} />)
    expect(await screen.findByText("Big Buck Bunny", {}, { timeout: 4000 })).toBeTruthy()
    expect(hostPreview).toHaveBeenCalledTimes(1)
  })

  it("um vídeo que falhou não se volta a tentar a cada tecla", async () => {
    // Without a saved thumbnail there is nothing to stop the second fetch, and it
    // is the worst combination: the host is down, and even so it takes a request
    // for each letter written after the identifier.
    const { rerender } = render(<Harness url={VIDEO} />)
    await waitFor(() => expect(hostPreview).toHaveBeenCalledTimes(1), { timeout: 4000 })

    rerender(<Harness url={`${VIDEO}&t=42`} />)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(hostPreview).toHaveBeenCalledTimes(1)
  })

  it("uma busca automática que falha deixa o vídeo reproduzível e não interrompe ninguém", async () => {
    // Whoever asked for nothing does not get a warning or fields to fill. And
    // the card stays: a video without a title still has somewhere to tap.
    const mudancas: (LinkCard | null)[] = []
    render(<Harness url={VIDEO} registo={(c) => mudancas.push(c)} />)

    await waitFor(() => expect(hostPreview).toHaveBeenCalled(), { timeout: 4000 })
    await waitFor(() => expect(screen.queryByText(strings.linkCard.fetching)).toBeNull(), { timeout: 4000 })

    expect(mudancas.at(-1)).toEqual({ url: VIDEO, kind: "video" })
    expect(screen.queryByText(strings.linkCard.fetchFailed)).toBeNull()
    expect(document.querySelector(".link-attach-manual")).toBeNull()
  })
})

describe("LinkAttach — o resto dos links continua a esperar pelo clique", () => {
  it("um endereço que não é do YouTube não manda buscar nada sozinho", async () => {
    // The automatic is for a known and fixed target, YouTube's oEmbed and
    // thumbnail. For any other site, writing the address would make the host hit
    // it before there is a message, and even if the sentence is deleted after. There
    // the tap is still consent.
    render(<Harness url="https://exemplo.pt/artigo" />)
    expect(screen.getByText(strings.chat.linkPreviewAsk)).toBeTruthy()

    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(hostPreview).not.toHaveBeenCalled()
  })

  it("um domínio que só se parece com o YouTube não conta como YouTube", async () => {
    // The address decides, and comparison is by equality: `youtube.com`
    // is contained in `youtube.com.exemplo.pt`.
    render(<Harness url="https://youtube.com.exemplo.pt/watch?v=aqz-KE-bpKQ" />)
    expect(screen.getByText(strings.chat.linkPreviewAsk)).toBeTruthy()

    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(hostPreview).not.toHaveBeenCalled()
  })
})

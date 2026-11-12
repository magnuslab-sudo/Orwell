import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { LinkCard } from "../../bridge.js"
import { strings } from "../../strings.js"
import { LinkPreview } from "./LinkPreview.js"

afterEach(cleanup)

const video: LinkCard = {
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  kind: "video",
  title: "Um vídeo qualquer",
  siteName: "Um canal",
  thumbnail: "data:image/png;base64,AAAA",
}

/** The entire card while it is idle, it is the one that gets the click. */
function fachada(container: HTMLElement): HTMLElement {
  const alvo = container.querySelector(".video-facade")
  if (!alvo) throw new Error("a fachada do vídeo não foi desenhada")
  return alvo as HTMLElement
}

describe("LinkPreview — um vídeo do YouTube", () => {
  it("a frio não há leitor nenhum: só a miniatura que veio dentro da mensagem", () => {
    // This is the assertion that matters. Without it, opening a chat with ten
    // videos means ten requests to Google made by someone who only glanced over them.
    const { container } = render(<LinkPreview link={video} />)
    expect(container.querySelector("iframe")).toBeNull()

    const miniatura = container.querySelector(".facade-thumb")
    expect(miniatura?.getAttribute("src")).toBe("data:image/png;base64,AAAA")
  })

  it("nada no cartão parado aponta para fora da mensagem", () => {
    // Neither the thumbnail nor the icon fetches anything from the network: the only remote address is the `href`, which is only followed if someone clicks it.
    const { container } = render(<LinkPreview link={video} />)
    for (const elemento of container.querySelectorAll("img, iframe, source, video")) {
      const src = elemento.getAttribute("src") ?? ""
      expect(src.startsWith("data:") || src === "").toBe(true)
    }
  })

  /*
    Owner request on November 2, 2026: "show YouTube thumbnails visually, but when
    the user clicks the thumbnail it opens a new window or tab with the link".
    The embedded player is gone; the thumbnail is just a link.
  */
  it("o clique na miniatura abre o vídeo numa aba nova, e nunca dentro da app", () => {
    const { container } = render(<LinkPreview link={video} />)
    const alvo = fachada(container)
    expect(alvo.tagName).toBe("A")
    expect(alvo.getAttribute("href")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    expect(alvo.getAttribute("target")).toBe("_blank")
    // `noreferrer` kills the Referer; `noopener` cuts `window.opener`.
    expect(alvo.getAttribute("rel")).toBe("noopener noreferrer")

    // A simple click follows the link: nothing stops it to play here inside.
    const seguiu = fireEvent.click(alvo)
    expect(seguiu).toBe(true)
    expect(container.querySelector("iframe")).toBeNull()
  })

  it("com ⌘, ctrl ou o botão do meio também é só o link", () => {
    const { container } = render(<LinkPreview link={video} />)
    expect(fireEvent.click(fachada(container), { metaKey: true })).toBe(true)
    expect(fireEvent.click(fachada(container), { ctrlKey: true })).toBe(true)
    expect(container.querySelector("iframe")).toBeNull()
  })

  it('mostra a miniatura, o sinal de "play" e o título', () => {
    const { container } = render(<LinkPreview link={video} />)
    const alvo = fachada(container)
    expect(alvo.querySelector(".facade-thumb")).not.toBeNull()
    expect(alvo.querySelector(".facade-play svg")).not.toBeNull()
    expect(alvo.querySelector(".link-title")?.textContent).toBe("Um vídeo qualquer")
    // Says what the click does: opens outside, on YouTube.
    expect(alvo.getAttribute("title")).toBe(strings.linkCard.openVideo)
  })

  it("um vídeo sem miniatura continua a ter onde carregar", () => {
    const { thumbnail: _semMiniatura, ...semThumb } = video
    const { container } = render(<LinkPreview link={semThumb} />)
    expect(container.querySelector(".facade-blank")).not.toBeNull()
    expect(fachada(container).getAttribute("href")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    fireEvent.click(fachada(container))
    expect(container.querySelector("iframe")).toBeNull()
  })

  it("o endereço é que decide, e nunca o `kind` que quem publica escolhe", () => {
    // `kind: "video"` on any website does not render as a YouTube video.
    const { container } = render(
      <LinkPreview link={{ url: "https://youtube.com.exemplo.pt/watch?v=dQw4w9WgXcQ", kind: "video" }} />,
    )
    expect(container.querySelector(".video-facade")).toBeNull()
    expect(container.querySelector("iframe")).toBeNull()
  })
})

describe("LinkPreview — o resto dos links", () => {
  it("um link normal continua a ser um cartão de texto, sem `iframe`", () => {
    const { container } = render(
      <LinkPreview link={{ url: "https://exemplo.pt/artigo", kind: "link", title: "Um artigo" }} />,
    )
    expect(container.querySelector("iframe")).toBeNull()
    expect(screen.getByText("Um artigo")).toBeTruthy()
    expect(screen.getByText("https://exemplo.pt/artigo")).toBeTruthy()
  })
})

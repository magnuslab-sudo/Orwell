import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ChatMessage } from "../../types.js"
import { PostBody } from "./PostBody.js"

afterEach(cleanup)

const payload: ChatMessage["payload"] = {
  t: "post",
  id: "p1",
  caption: "uma legenda qualquer",
  media: [{ inline: "data:image/png;base64,AAAA", name: "foto.png", mediaType: "image/png" }],
  links: [{ url: "https://exemplo.pt/artigo", kind: "link", title: "Um artigo" }],
  tags: ["gatos", "sofá"],
}

describe("PostBody", () => {
  it("rende legenda, imagens, links e tags do mesmo payload", () => {
    render(<PostBody payload={payload} />)
    expect(screen.getByText("uma legenda qualquer")).toBeTruthy()
    expect(screen.getByAltText("foto.png")).toBeTruthy()
    expect(screen.getByText("Um artigo")).toBeTruthy()
    expect(screen.getByText("https://exemplo.pt/artigo")).toBeTruthy()
    expect(screen.getByText("#gatos")).toBeTruthy()
    expect(screen.getByText("#sofá")).toBeTruthy()
  })

  it("sem onTagClick as tags são texto, não botões", () => {
    render(<PostBody payload={payload} />)
    expect(screen.queryByRole("button", { name: "#gatos" })).toBeNull()
  })

  it("com onTagClick as tags são botões e a activa fica aria-pressed", async () => {
    const user = userEvent.setup()
    const onTagClick = vi.fn()
    render(<PostBody payload={payload} activeTag="sofá" onTagClick={onTagClick} />)

    const gatos = screen.getByRole("button", { name: "#gatos" })
    const sofa = screen.getByRole("button", { name: "#sofá" })
    expect(gatos.getAttribute("aria-pressed")).toBe("false")
    expect(sofa.getAttribute("aria-pressed")).toBe("true")

    await user.click(gatos)
    expect(onTagClick).toHaveBeenCalledExactlyOnceWith("gatos")
  })

  it("com onOpenImage a imagem passa a botão que devolve o item", async () => {
    const user = userEvent.setup()
    const onOpenImage = vi.fn()
    render(<PostBody payload={payload} onOpenImage={onOpenImage} />)

    await user.click(screen.getByRole("button", { name: "foto.png" }))
    expect(onOpenImage).toHaveBeenCalledExactlyOnceWith(payload.media?.[0])
  })

  it("payload só de texto rende só o texto", () => {
    const { container } = render(<PostBody payload={{ t: "post", id: "p2", caption: "só palavras" }} />)
    expect(screen.getByText("só palavras")).toBeTruthy()
    expect(container.querySelector(".post-images")).toBeNull()
    expect(container.querySelector(".tags")).toBeNull()
  })
})

/**
 * File attachments in a post.
 *
 * Same rules as chat, and on purpose it is the same component: a second
 * implementation for the feed would be the copy left behind the day we add a
 * check. Here it matters more, a post stays in the vault of everyone who follows.
 */
describe("PostBody — ficheiros", () => {
  const pdf = `data:application/pdf;base64,${btoa("%PDF fingido")}`

  const comMedia = (media: NonNullable<ChatMessage["payload"]["media"]>): ChatMessage["payload"] => ({
    t: "post",
    id: "pf",
    caption: "o contrato",
    media,
  })

  it("um documento numa publicação desenha-se como linha, não como imagem partida", () => {
    const { container } = render(<PostBody payload={comMedia([{ inline: pdf, name: "contrato.pdf", mediaType: "application/pdf" }])} />)
    expect(screen.getByText("contrato.pdf")).toBeTruthy()
    expect(screen.getByText("PDF")).toBeTruthy()
    // Without the separation, `PostImages` would render an `<img src="data:application/pdf">`.
    expect(container.querySelector(".post-images img")).toBeNull()
    expect(container.querySelector(".file-attachment")).toBeTruthy()
  })

  it("nada abre o documento por dentro, aqui como na conversa", () => {
    const { container } = render(<PostBody payload={comMedia([{ inline: pdf, name: "contrato.pdf", mediaType: "application/pdf" }])} />)
    expect(container.querySelector("iframe")).toBeNull()
    expect(container.querySelector("object")).toBeNull()
    expect(container.querySelector(".file-attachment a")).toBeNull()
  })

  it("o nome do remetente é desinfectado também no feed", () => {
    render(<PostBody payload={comMedia([{ inline: pdf, name: "../../etc/passwd", mediaType: "application/pdf" }])} />)
    expect(screen.getByText("passwd")).toBeTruthy()
    expect(screen.queryByText("../../etc/passwd")).toBeNull()
  })

  it("uma imagem e um documento vão cada um para o seu sítio", () => {
    const { container } = render(
      <PostBody
        payload={comMedia([
          { inline: "data:image/webp;base64,AAAA", name: "foto.webp", mediaType: "image/webp" },
          { inline: pdf, name: "contrato.pdf", mediaType: "application/pdf" },
        ])}
      />,
    )
    expect(container.querySelectorAll(".post-images img")).toHaveLength(1)
    expect(container.querySelectorAll(".file-attachment")).toHaveLength(1)
  })

  it("um documento despejado do cofre degrada com honestidade", () => {
    // The name and type survive, the bytes do not, and without bytes there is no button.
    const { container } = render(<PostBody payload={comMedia([{ evicted: true, name: "contrato.pdf", mediaType: "application/pdf" }])} />)
    expect(screen.getByText("contrato.pdf")).toBeTruthy()
    expect(container.querySelector(".file-attachment.gone")).toBeTruthy()
    expect(container.querySelector(".file-get")).toBeNull()
  })
})

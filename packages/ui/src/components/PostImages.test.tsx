import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { strings } from "../strings.js"
import { PostImages } from "./PostImages.js"

afterEach(cleanup)

describe("PostImages", () => {
  it("media com bytes rende como imagem", () => {
    render(<PostImages media={[{ inline: "data:image/png;base64,AAAA", name: "foto.png", mediaType: "image/png" }]} />)
    expect(screen.getByAltText("foto.png")).toBeTruthy()
    expect(screen.queryByText(strings.common.mediaEvicted)).toBeNull()
  })

  it("media evicted rende o placeholder honesto, não uma imagem partida", () => {
    render(<PostImages media={[{ evicted: true, name: "foto.png", mediaType: "image/png" }]} />)
    expect(screen.getByText(strings.common.mediaEvicted)).toBeTruthy()
    expect(document.querySelector("img")).toBeNull()
  })

  it("mistura: a imagem viva fica, a antiga vira placeholder", () => {
    render(
      <PostImages
        media={[
          { inline: "data:image/png;base64,AAAA", name: "nova.png", mediaType: "image/png" },
          { evicted: true, name: "antiga.png", mediaType: "image/png" },
        ]}
      />,
    )
    expect(screen.getByAltText("nova.png")).toBeTruthy()
    expect(screen.getByText(strings.common.mediaEvicted)).toBeTruthy()
  })

  it("sem media não rende nada", () => {
    const { container } = render(<PostImages media={[]} />)
    expect(container.firstChild).toBeNull()
  })
})

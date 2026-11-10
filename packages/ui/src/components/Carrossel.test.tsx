import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { MediaItem } from "../types.js"
import { strings } from "../strings.js"
import { Carrossel } from "./Carrossel.js"

afterEach(cleanup)

const A: MediaItem = { inline: "data:image/png;base64,AAAA", name: "cabeco.png", mediaType: "image/png" }
const B: MediaItem = { inline: "data:image/png;base64,BBBB", name: "azinheira.png", mediaType: "image/png" }
const C: MediaItem = { inline: "data:image/png;base64,CCCC", name: "ribeira.png", mediaType: "image/png" }

/** Which photo is on stage now. One at a time, always. */
const emPalco = (): string | null | undefined => document.querySelector(".carrossel-palco img")?.getAttribute("src")

/**
 * The carousel of a post: one photo at a time, and three ways to
 * move to the next.
 *
 * What we do NOT test here is the layout-jsdom applies no stylesheets,
 * and a zero-by-zero photo would be there. That it is large, that it sits next to the
 * text on a wide screen and above it on a phone, and that a finger drags it:
 * that is `scripts/medir-perfil.mjs`, in a real layout engine.
 */
describe("Carrossel", () => {
  it("sem fotografias não desenha nada", () => {
    const { container } = render(<Carrossel media={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it("com uma fotografia mostra-a, e mais nada", () => {
    render(<Carrossel media={[A]} />)

    expect(screen.getByAltText("cabeco.png")).toBeTruthy()
    // Arrows and dots with nowhere to go promise a second photo that
    // does not exist.
    expect(screen.queryByRole("button", { name: strings.social.imageNext })).toBeNull()
    expect(screen.queryByRole("button", { name: strings.social.imagePrev })).toBeNull()
    expect(document.querySelectorAll(".carrossel-pontos .ponto")).toHaveLength(0)
  })

  it("com várias mostra uma de cada vez, e as setas passam", async () => {
    const user = userEvent.setup()
    render(<Carrossel media={[A, B, C]} />)

    expect(document.querySelectorAll(".carrossel-palco img")).toHaveLength(1)
    expect(emPalco()).toBe(A.inline)

    await user.click(screen.getByRole("button", { name: strings.social.imageNext }))
    expect(emPalco()).toBe(B.inline)

    await user.click(screen.getByRole("button", { name: strings.social.imagePrev }))
    expect(emPalco()).toBe(A.inline)
  })

  it("dá a volta nas duas pontas", async () => {
    const user = userEvent.setup()
    render(<Carrossel media={[A, B, C]} />)

    // Stopping at the end forces you to scroll all the way back to review the one
    // that mattered.
    await user.click(screen.getByRole("button", { name: strings.social.imagePrev }))
    expect(emPalco()).toBe(C.inline)

    await user.click(screen.getByRole("button", { name: strings.social.imageNext }))
    expect(emPalco()).toBe(A.inline)
  })

  it("as setas do teclado passam de fotografia", async () => {
    const user = userEvent.setup()
    render(<Carrossel media={[A, B]} />)

    // With focus on one of the arrows: that is where a mouse-free keyboard user
    // arrives, and that is where keys must work.
    screen.getByRole("button", { name: strings.social.imageNext }).focus()
    await user.keyboard("{ArrowRight}")
    expect(emPalco()).toBe(B.inline)

    await user.keyboard("{ArrowLeft}")
    expect(emPalco()).toBe(A.inline)
  })

  it("os pontos saltam para a fotografia escolhida e dizem em qual vamos", async () => {
    const user = userEvent.setup()
    render(<Carrossel media={[A, B, C]} />)

    await user.click(screen.getByRole("button", { name: strings.social.imageGo(3) }))

    expect(emPalco()).toBe(C.inline)
    const pontos = [...document.querySelectorAll(".carrossel-pontos .ponto")]
    expect(pontos.map((p) => p.getAttribute("aria-current"))).toEqual(["false", "false", "true"])
    // And spelled out, for those who do not see the dots.
    expect(screen.getByText(strings.social.imageAt(3, 3))).toBeTruthy()
  })

  it("a fotografia é um botão que a abre, e entrega a que está em palco", async () => {
    const user = userEvent.setup()
    const abrir = vi.fn()
    render(<Carrossel media={[A, B]} onOpen={abrir} />)

    await user.click(screen.getByRole("button", { name: strings.social.imageNext }))
    await user.click(screen.getByRole("button", { name: "azinheira.png" }))

    // The entire `MediaItem`, not an index: bytes travel from one sheet to
    // the other without anyone fetching from anywhere.
    expect(abrir).toHaveBeenCalledWith(B)
  })

  it("um arrasto passa de fotografia e NÃO abre a ampliação", async () => {
    const user = userEvent.setup()
    const abrir = vi.fn()
    render(<Carrossel media={[A, B]} onOpen={abrir} />)
    // The finger lands on the PHOTO, which is where it actually lands: the stage
    // only wraps it. That is how the end-of-drag click reaches the button.
    const foto = screen.getByAltText("cabeco.png")

    await user.pointer([
      { keys: "[MouseLeft>]", target: foto, coords: { clientX: 300, clientY: 100 } },
      { target: foto, coords: { clientX: 120, clientY: 100 } },
      { keys: "[/MouseLeft]", target: foto, coords: { clientX: 120, clientY: 100 } },
    ])

    expect(emPalco()).toBe(B.inline)
    // The browser fires a click after a mouse drag. Without a guard,
    // each photo change ended with the image full on the screen.
    expect(abrir).not.toHaveBeenCalled()
  })

  it("e o teclado abre a fotografia mesmo logo a seguir a um arrasto", async () => {
    /*
      On a touch screen the drag does not generate a click, and the guard flag
      stayed raised. The next activation was swallowed-and if it was
      an Enter, a mouse-free user clicked once for nothing.
    */
    const user = userEvent.setup()
    const abrir = vi.fn()
    render(<Carrossel media={[A, B]} onOpen={abrir} />)
    // The finger lands on the PHOTO, which is where it actually lands: the stage
    // only wraps it. That is how the end-of-drag click reaches the button.
    const foto = screen.getByAltText("cabeco.png")

    await user.pointer([
      { keys: "[MouseLeft>]", target: foto, coords: { clientX: 300, clientY: 100 } },
      { target: foto, coords: { clientX: 120, clientY: 100 } },
      { keys: "[/MouseLeft]", target: foto, coords: { clientX: 120, clientY: 100 } },
    ])

    screen.getByRole("button", { name: "azinheira.png" }).focus()
    await user.keyboard("{Enter}")

    expect(abrir).toHaveBeenCalledWith(B)
  })

  it("sem `onOpen` a fotografia não finge ser botão", () => {
    render(<Carrossel media={[A]} />)

    expect(screen.getByAltText("cabeco.png")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "cabeco.png" })).toBeNull()
  })

  it("uma fotografia despejada do cofre diz o que era, e não vira botão", () => {
    // Without bytes there is nothing to enlarge, and a button that opened empty
    // was worse than no button. It is the same rule as the feed grid.
    render(<Carrossel media={[{ evicted: true, name: "praia.png", mediaType: "image/png" }]} onOpen={vi.fn()} />)

    expect(screen.getByText(strings.common.mediaEvicted)).toBeTruthy()
    expect(document.querySelector(".carrossel-palco img")).toBeNull()
    expect(document.querySelector(".image-open")).toBeNull()
  })
})

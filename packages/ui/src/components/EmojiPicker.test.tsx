import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { EmojiPicker } from "./EmojiPicker.js"
import { PREFS_KEY, readPrefs } from "../hooks/usePrefs.js"
import { strings } from "../strings.js"

beforeEach(() => localStorage.clear())
afterEach(cleanup)

function open(onPick = vi.fn(), onClose = vi.fn()): { onPick: typeof onPick; onClose: typeof onClose } {
  render(<EmojiPicker onPick={onPick} onClose={onClose} />)
  return { onPick, onClose }
}

/** Grid cells, in the order they appear. */
function cells(): HTMLElement[] {
  return within(screen.getByRole("group")).getAllByRole("button")
}

describe("EmojiPicker", () => {
  it("abre como diálogo com o foco na pesquisa", () => {
    open()
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true")
    expect(document.activeElement).toBe(screen.getByLabelText(strings.emoji.searchLabel))
  })

  it("mostra a primeira categoria quando não há recentes", () => {
    open()
    expect(screen.getByRole("group").getAttribute("aria-label")).toBe("Rostos")
    expect(cells().length).toBeGreaterThan(20)
  })

  it("filtra pela pesquisa, sem exigir acentos", async () => {
    const user = userEvent.setup()
    open()
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "girassol")
    const found = cells()
    expect(found.length).toBe(1)
    expect(found[0]?.textContent).toBe("🌻")
  })

  it("diz quando não encontra nada", async () => {
    const user = userEvent.setup()
    open()
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "zzzzq")
    expect(screen.getByText(strings.emoji.noResults)).toBeTruthy()
  })

  it("entrega o emoji escolhido e fecha", async () => {
    const user = userEvent.setup()
    const { onPick, onClose } = open()
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "girassol")
    await user.click(cells()[0] as HTMLElement)
    expect(onPick).toHaveBeenCalledWith("🌻")
    expect(onClose).toHaveBeenCalled()
  })

  it("guarda o que foi usado, do mais recente para o mais antigo", async () => {
    const user = userEvent.setup()
    open()
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "girassol")
    await user.click(cells()[0] as HTMLElement)
    expect(readPrefs().emojiRecents).toEqual(["🌻"])

    cleanup()
    open()
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "café")
    await user.click(cells()[0] as HTMLElement)
    expect(readPrefs().emojiRecents).toEqual(["☕", "🌻"])
  })

  it("promove um emoji repetido em vez de o duplicar", async () => {
    const user = userEvent.setup()
    localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, emojiRecents: ["☕", "🌻"] }))
    open()
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "girassol")
    await user.click(cells()[0] as HTMLElement)
    expect(readPrefs().emojiRecents).toEqual(["🌻", "☕"])
  })

  it("abre nos recentes quando já os há", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, emojiRecents: ["🌻", "☕"] }))
    open()
    expect(screen.getByRole("group").getAttribute("aria-label")).toBe(strings.emoji.recents)
    expect(cells().map((cell) => cell.textContent)).toEqual(["🌻", "☕"])
  })

  it("mostra um recente que o catálogo já não conheça, em vez de o perder", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, emojiRecents: ["🫥"] }))
    open()
    expect(cells().map((cell) => cell.textContent)).toEqual(["🫥"])
  })

  it("ignora recentes que não sejam emojis credíveis", () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ chosen: true, emojiRecents: ["🌻", 7, "", "uma frase inteira que não é um emoji"] }),
    )
    open()
    expect(cells().map((cell) => cell.textContent)).toEqual(["🌻"])
  })

  // Keys always go to the focused element: the grid is a <div>, and clicking it
  // would move focus to the card, which is what `user.type` does.
  it("anda pela grelha com as setas, em linha e em coluna", async () => {
    const user = userEvent.setup()
    open()
    const found = cells()

    await user.keyboard("{ArrowDown}") // From search to grid.
    expect(document.activeElement).toBe(found[0])

    await user.keyboard("{ArrowRight}")
    expect(document.activeElement).toBe(found[1])

    // One row below is eight cells, the same as the stylesheet draws.
    await user.keyboard("{ArrowDown}")
    expect(document.activeElement).toBe(found[9])

    await user.keyboard("{ArrowUp}")
    expect(document.activeElement).toBe(found[1])

    await user.keyboard("{End}")
    expect(document.activeElement).toBe(found[found.length - 1])

    await user.keyboard("{Home}")
    expect(document.activeElement).toBe(found[0])
  })

  it("pára nos extremos em vez de dar a volta", async () => {
    const user = userEvent.setup()
    open()
    const found = cells()

    await user.keyboard("{ArrowDown}")
    await user.keyboard("{ArrowLeft}")
    expect(document.activeElement).toBe(found[0])

    await user.keyboard("{End}")
    await user.keyboard("{ArrowRight}")
    expect(document.activeElement).toBe(found[found.length - 1])
  })

  it("deixa só uma casa alcançável pelo Tab", () => {
    open()
    const tabbable = cells().filter((cell) => cell.getAttribute("tabindex") === "0")
    expect(tabbable.length).toBe(1)
  })

  it("escolhe o primeiro resultado com Enter na pesquisa", async () => {
    const user = userEvent.setup()
    const { onPick } = open()
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "girassol{Enter}")
    expect(onPick).toHaveBeenCalledWith("🌻")
  })

  it("troca de categoria e larga a pesquisa a meio", async () => {
    const user = userEvent.setup()
    open()
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "girassol")
    await user.click(screen.getByLabelText("Comida e bebida"))
    expect(screen.getByRole("group").getAttribute("aria-label")).toBe("Comida e bebida")
    expect((screen.getByLabelText(strings.emoji.searchLabel) as HTMLInputElement).value).toBe("")
  })

  it("fecha com Escape e pelo botão, sem escolher nada", async () => {
    const user = userEvent.setup()
    const { onPick, onClose } = open()
    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalled()

    await user.click(screen.getByText(strings.emoji.close))
    expect(onPick).not.toHaveBeenCalled()
  })
})

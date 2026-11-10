import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { strings } from "../../strings.js"
import { NewRoom } from "./NewRoom.js"

afterEach(cleanup)

/**
 * Create a room, now that there are three things to choose from and only two
 * types.
 *
 * What is tied up here is the distinction that the form hides on purpose:
 * whoever creates chooses ONE thing, and what comes out is two, the type, which
 * says where things travel, and the layout, which says how to read them. A
 * ticket room is a TEXT room with its own layout, and if it ever leaves here as
 * a new type, clients that do not know it discard the entire `channel.meta` and
 * lose with it the tombstone that erases the room.
 */
function folha(onSubmit: (next: Record<string, unknown>) => Promise<void>): React.JSX.Element {
  return <NewRoom onSubmit={onSubmit as never} onCancel={() => {}} />
}

describe("escolher o que a sala é", () => {
  it("uma sala de tickets sai como sala de texto, com a disposição ao lado", async () => {
    const dito: Record<string, unknown>[] = []
    render(folha(async (next) => void dito.push(next)))

    await userEvent.type(screen.getByPlaceholderText(strings.newRoom.namePlaceholder), "Apoio")
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.kindTickets }))
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.create }))

    expect(dito).toHaveLength(1)
    expect(dito[0]).toMatchObject({ name: "Apoio", kind: "text", layout: "tickets" })
  })

  it("o identificador de uma sala de tickets é o de um fórum, e é para ficar", async () => {
    // The prefix says the TYPE and never changes; the layout changes. A `tickets-`
    // in the identifier would be a lie the day someone turned the room back to
    // normal chat.
    const dito: Record<string, unknown>[] = []
    render(folha(async (next) => void dito.push(next)))

    await userEvent.type(screen.getByPlaceholderText(strings.newRoom.namePlaceholder), "Apoio")
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.kindTickets }))
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.create }))

    expect(dito[0]?.["room"]).toMatch(/^forum-/)
  })

  it("uma sala de texto continua a sair sem disposição nenhuma", async () => {
    // Absence is absence: a default layout would write into every room a choice
    // that nobody made.
    const dito: Record<string, unknown>[] = []
    render(folha(async (next) => void dito.push(next)))

    await userEvent.type(screen.getByPlaceholderText(strings.newRoom.namePlaceholder), "conversa")
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.create }))

    expect(dito[0]).toMatchObject({ kind: "text" })
    expect(dito[0]).not.toHaveProperty("layout")
  })

  it("uma sala de voz continua a sair como voz, e sem disposição", async () => {
    const dito: Record<string, unknown>[] = []
    render(folha(async (next) => void dito.push(next)))

    await userEvent.type(screen.getByPlaceholderText(strings.newRoom.namePlaceholder), "voz")
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.kindVoice }))
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.create }))

    expect(dito[0]).toMatchObject({ kind: "voice" })
    expect(dito[0]?.["room"]).toMatch(/^contio-/)
    expect(dito[0]).not.toHaveProperty("layout")
  })

  it("trocar de ideias depois de escolher tickets devolve uma sala de texto simples", async () => {
    const dito: Record<string, unknown>[] = []
    render(folha(async (next) => void dito.push(next)))

    await userEvent.type(screen.getByPlaceholderText(strings.newRoom.namePlaceholder), "conversa")
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.kindTickets }))
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.kindText }))
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.create }))

    expect(dito[0]).not.toHaveProperty("layout")
  })

  it("cada botão de tipo é anunciado pelo seu nome, e não pelo dos irmãos", async () => {
    /**
     * The `Field` puts label and control inside the same `<label>`, which works
     * for one control and not for three: without its own name, the first button
     * inherited the entire label text and was announced as "Type Voice Tickets".
     * Someone who cannot see the screen had no way to pick the first room type.
     * It was already like this with two buttons; the third just made it visible.
     */
    render(folha(async () => {}))
    for (const nome of [strings.newRoom.kindText, strings.newRoom.kindVoice, strings.newRoom.kindTickets]) {
      expect(screen.getByRole("button", { name: nome })).toBeTruthy()
    }
  })

  it("a ressalva dos tickets só aparece depois de os tickets serem escolhidos", async () => {
    // Showing it always taught people to ignore the two caveats on this sheet.
    render(folha(async () => {}))
    expect(screen.queryByText(strings.newRoom.ticketsNote)).toBeNull()

    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.kindTickets }))
    expect(screen.getByText(strings.newRoom.ticketsNote)).toBeTruthy()
  })
})

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { strings } from "../../strings.js"
import { NewRoom } from "./NewRoom.js"
import { SeccaoSalaAfk } from "./SeccaoSalaAfk.js"

afterEach(cleanup)

/** The AFK room on the panel (2/11/2026): create it marked, and choose the channel's. */

describe("criar uma sala AFK", () => {
  it("a opção só aparece numa sala de voz", async () => {
    render(<NewRoom onSubmit={async () => {}} onCancel={() => {}} minutosAfk={15} />)
    expect(screen.queryByRole("switch", { name: strings.newRoom.afkLabel })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.kindVoice }))
    expect(screen.getByRole("switch", { name: strings.newRoom.afkLabel })).toBeTruthy()
  })

  it("marcada, a sala de voz sai com o tempo do canal", async () => {
    const dito: Record<string, unknown>[] = []
    render(<NewRoom onSubmit={async (next) => void dito.push(next)} onCancel={() => {}} minutosAfk={30} />)
    await userEvent.type(screen.getByPlaceholderText(strings.newRoom.namePlaceholder), "AFK")
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.kindVoice }))
    await userEvent.click(screen.getByRole("switch", { name: strings.newRoom.afkLabel }))
    expect(screen.getByText(strings.newRoom.afkNote)).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.create }))
    expect(dito[0]).toMatchObject({ name: "AFK", kind: "voice", afk: { minutos: 30 } })
  })

  it("sem a opção ligada, a sala de voz sai sem marca", async () => {
    const dito: Record<string, unknown>[] = []
    render(<NewRoom onSubmit={async (next) => void dito.push(next)} onCancel={() => {}} minutosAfk={15} />)
    await userEvent.type(screen.getByPlaceholderText(strings.newRoom.namePlaceholder), "Voz")
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.kindVoice }))
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.create }))
    expect(dito[0]).not.toHaveProperty("afk")
  })

  it("quem não pode editar o canal não vê a opção", async () => {
    render(<NewRoom onSubmit={async () => {}} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.kindVoice }))
    expect(screen.queryByRole("switch", { name: strings.newRoom.afkLabel })).toBeNull()
  })

  it("mudar para texto depois de marcar não manda a marca", async () => {
    const dito: Record<string, unknown>[] = []
    render(<NewRoom onSubmit={async (next) => void dito.push(next)} onCancel={() => {}} minutosAfk={15} />)
    await userEvent.type(screen.getByPlaceholderText(strings.newRoom.namePlaceholder), "X")
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.kindVoice }))
    await userEvent.click(screen.getByRole("switch", { name: strings.newRoom.afkLabel }))
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.kindText }))
    await userEvent.click(screen.getByRole("button", { name: strings.newRoom.create }))
    expect(dito[0]).toMatchObject({ kind: "text" })
    expect(dito[0]).not.toHaveProperty("afk")
  })
})

const salas = [
  { room: "contio-geral", name: "Geral", category: "", kind: "voice" as const, position: 0 },
  { room: "contio-afk", name: "Dormir", category: "", kind: "voice" as const, position: 1 },
]

describe("escolher a sala AFK do canal", () => {
  it("escolher uma sala e o tempo, e guardar", async () => {
    const onGuardar = vi.fn(async () => {})
    render(<SeccaoSalaAfk salasDeVoz={salas} actual={null} onGuardar={onGuardar} />)
    const [sala, tempo] = screen.getAllByRole("combobox") as HTMLSelectElement[]
    expect(tempo!.disabled).toBe(true)
    await userEvent.selectOptions(sala!, "contio-afk")
    await userEvent.selectOptions(tempo!, "60")
    await userEvent.click(screen.getByRole("button", { name: strings.salaAfk.guardar }))
    expect(onGuardar).toHaveBeenCalledWith("contio-afk", 60)
  })

  it("os tempos são 5, 15, 30 e 60 minutos, 15 por omissão", () => {
    render(<SeccaoSalaAfk salasDeVoz={salas} actual={null} onGuardar={async () => {}} />)
    const tempo = screen.getAllByRole("combobox")[1] as HTMLSelectElement
    expect([...tempo.options].map((opcao) => opcao.value)).toEqual(["5", "15", "30", "60"])
    expect(tempo.value).toBe("15")
  })

  it('"Nenhuma" desmarca a de agora', async () => {
    const onGuardar = vi.fn(async () => {})
    render(<SeccaoSalaAfk salasDeVoz={salas} actual={{ room: "contio-afk", minutos: 30 }} onGuardar={onGuardar} />)
    await userEvent.selectOptions(screen.getAllByRole("combobox")[0]!, "")
    await userEvent.click(screen.getByRole("button", { name: strings.salaAfk.guardar }))
    expect(onGuardar).toHaveBeenCalledWith(null, 30)
  })

  it("sem mudanças, guardar fica desligado", () => {
    render(<SeccaoSalaAfk salasDeVoz={salas} actual={{ room: "contio-afk", minutos: 30 }} onGuardar={async () => {}} />)
    expect((screen.getByRole("button", { name: strings.salaAfk.guardar }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("um canal sem salas de voz diz o que fazer", () => {
    render(<SeccaoSalaAfk salasDeVoz={[]} actual={null} onGuardar={async () => {}} />)
    expect(screen.getByText(strings.salaAfk.semSalasDeVoz)).toBeTruthy()
  })
})

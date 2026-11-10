import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"

/**
 * Delete a category, with real accounts.
 *
 * Report from the owner in 0.8.0: "deleting a category does not delete it, even as
 * administrator". Here we prove half the core: the tombstone (`removed: true`)
 * from an administrator who is NOT the founder reaches everyone and beats the
 * stored declaration, and the category leaves `categoriesOf` in all three vaults.
 * Also after the founder republishes the channel authority, which resends the
 * categories with the original timestamp.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  await servidor?.fechar()
})

async function contas(...nomes: string[]): Promise<ContaDeTeste[]> {
  const novas = await contasDeTeste(servidor, nomes)
  abertas.push(...novas)
  return novas
}

const temCategoria = (conta: ContaDeTeste, canal: string, nome: string): boolean =>
  conta.session.categoriesOf(canal).some((entrada) => entrada.category === nome)

describe("apagar uma categoria", () => {
  it("um administrador que não é o fundador apaga uma categoria vazia, e ela sai de todos", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])

    await ana!.session.assignRoles(canal, bruno!.address, ["admin"])
    await ate(() => bruno!.session.mayEditChannel(canal), "o Bruno passa a administrar")

    await bruno!.session.upsertCategory(canal, { category: "Arquivo", position: 1 })
    for (const conta of [ana!, bruno!, carla!]) {
      await ate(() => temCategoria(conta, canal, "Arquivo"), `a categoria chega a ${conta.address}`)
    }

    await bruno!.session.upsertCategory(canal, { category: "Arquivo", position: 1, removed: true })
    for (const conta of [ana!, bruno!, carla!]) {
      await ate(() => !temCategoria(conta, canal, "Arquivo"), `a categoria sai de ${conta.address}`)
    }

    // The authority republished by the founder carries the categories he has, and the
    // deleted one is no longer there: nothing brings it back.
    await ana!.session.republishAuthority(canal)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    for (const conta of [ana!, bruno!, carla!]) expect(temCategoria(conta, canal, "Arquivo")).toBe(false)
  }, 120_000)

  it("uma lápide vence a declaração mesmo quando o relógio de quem apaga está atrasado", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ana!.session.upsertCategory(canal, { category: "Arquivo" })
    await ate(() => temCategoria(bruno!, canal, "Arquivo"), "a categoria chega ao Bruno")

    // The tombstone timestamp comes from `#carimboSeguinte`, which never goes
    // below the stored timestamp: a clock one hour behind cannot beat it.
    const agora = Date.now
    Date.now = () => agora() - 3_600_000
    try {
      await ana!.session.upsertCategory(canal, { category: "Arquivo", removed: true })
    } finally {
      Date.now = agora
    }
    await ate(() => !temCategoria(ana!, canal, "Arquivo") && !temCategoria(bruno!, canal, "Arquivo"), "a categoria sai dos dois")
  }, 120_000)
})

/**
 * Phase 1f: deleted categories that come back (report from the founder of the Orwell channel,
 * 27 October 2026: "I delete categories and they keep coming back").
 *
 * A category exists by declaration OR by rooms with that name written. Delete rewrites
 * the rooms that the deleter SEES, and puts the tombstone in the declaration.
 * The three scenarios of the plan, with real accounts and server.
 */
const salaEm = (conta: ContaDeTeste, canal: string, room: string): { category: string } | undefined =>
  conta.session.roomsOf(canal).find((sala) => sala.room === room)

/** The category appears in the tree for who sees it: declared, or named by a room. */
const categoriaVisivel = (conta: ContaDeTeste, canal: string, nome: string): boolean =>
  temCategoria(conta, canal, nome) || conta.session.roomsOf(canal).some((sala) => sala.category === nome)

describe("fase 1f: uma categoria apagada não volta", () => {
  it("(1) uma sala de outro administrador que quem apaga não reescreveu não traz a categoria de volta", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ana!.session.assignRoles(canal, bruno!.address, ["admin"])
    await ate(() => bruno!.session.mayEditChannel(canal), "o Bruno passa a administrar")
    await ana!.session.upsertCategory(canal, { category: "Arquivo", position: 1 })
    await ate(() => temCategoria(bruno!, canal, "Arquivo"), "a categoria chega ao Bruno")

    // Bruno creates a room in the category. It is the room Ana did not have when
    // she deleted: so Ana publishes only the tombstone, without rewriting the room.
    await bruno!.session.upsertRoom(canal, { room: "sala-do-bruno", name: "Sala do Bruno", category: "Arquivo" })
    await ate(() => salaEm(ana!, canal, "sala-do-bruno") !== undefined, "a sala do Bruno chega à Ana")
    await ana!.session.upsertCategory(canal, { category: "Arquivo", position: 1, removed: true })

    for (const conta of [ana!, bruno!]) {
      await ate(() => !temCategoria(conta, canal, "Arquivo"), `a lápide chega a ${conta.nome}`)
      // The room stays, without a category: the tombstone is newer than it.
      expect(salaEm(conta, canal, "sala-do-bruno")?.category).toBe("")
      expect(categoriaVisivel(conta, canal, "Arquivo")).toBe(false)
    }
  }, 120_000)

  it("(1b) uma sala que nomeia a categoria DEPOIS da lápide mantém-na: é uma categoria nova", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ana!.session.upsertCategory(canal, { category: "Arquivo", position: 1 })
    await ana!.session.upsertCategory(canal, { category: "Arquivo", position: 1, removed: true })
    await ate(() => bruno!.session.categoriesOf(canal).length === 0, "a lápide chega ao Bruno")
    await new Promise((resolve) => setTimeout(resolve, 5))
    await ana!.session.upsertRoom(canal, { room: "nova", name: "Nova", category: "Arquivo" })
    await ate(() => salaEm(bruno!, canal, "nova")?.category === "Arquivo", "a sala nova chega com a categoria")
  }, 120_000)

  it("(2) reordenar as categorias depois da lápide não a republica", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ana!.session.assignRoles(canal, bruno!.address, ["admin"])
    await ate(() => bruno!.session.mayEditChannel(canal), "o Bruno passa a administrar")
    await ana!.session.upsertCategory(canal, { category: "Arquivo", position: 1 })
    await ana!.session.upsertCategory(canal, { category: "Geral", position: 2 })
    await ate(() => temCategoria(bruno!, canal, "Arquivo") && temCategoria(bruno!, canal, "Geral"), "as duas chegam ao Bruno")

    await ana!.session.upsertCategory(canal, { category: "Arquivo", position: 1, removed: true })
    await ate(() => !temCategoria(bruno!, canal, "Arquivo"), "a lápide chega ao Bruno")

    // Bruno drags categories: the sidebar republishes the list with new positions
    // (`arrumarCategoria`), and his list still showed the deleted one when a room
    // named it. The reorder gesture says `reordenar`.
    await bruno!.session.upsertCategory(canal, { category: "Arquivo", position: 3, reordenar: true } as Parameters<
      NonNullable<typeof bruno>["session"]["upsertCategory"]
    >[1])
    await bruno!.session.upsertCategory(canal, { category: "Geral", position: 1, reordenar: true } as Parameters<
      NonNullable<typeof bruno>["session"]["upsertCategory"]
    >[1])
    await ate(() => ana!.session.categoriesOf(canal).find((c) => c.category === "Geral")?.position === 1, "a ordem nova chega à Ana")
    for (const conta of [ana!, bruno!]) expect(temCategoria(conta, canal, "Arquivo")).toBe(false)
  }, 120_000)

  it("(3) o arranque de outro administrador, que republica as salas do cofre, não traz a categoria de volta", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ana!.session.assignRoles(canal, bruno!.address, ["admin"])
    await ate(() => bruno!.session.mayEditChannel(canal), "o Bruno passa a administrar")
    await ana!.session.upsertCategory(canal, { category: "Arquivo", position: 1 })
    await bruno!.session.upsertRoom(canal, { room: "sala-do-bruno", name: "Sala do Bruno", category: "Arquivo" })
    await ate(() => salaEm(ana!, canal, "sala-do-bruno") !== undefined, "a sala do Bruno chega à Ana")
    await ana!.session.upsertCategory(canal, { category: "Arquivo", position: 1, removed: true })
    await ate(() => !temCategoria(bruno!, canal, "Arquivo"), "a lápide chega ao Bruno")

    // Bruno closes and reopens the app: on startup, he republishes the channel
    // authority and rooms with the original timestamp.
    bruno!.session.disconnect()
    await bruno!.session.connect()
    await bruno!.session.republishRooms(canal)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    for (const conta of [ana!, bruno!]) expect(categoriaVisivel(conta, canal, "Arquivo")).toBe(false)
  }, 120_000)

  it("(3b) a sala comum não nasce com categorias, nem ao voltar a arrancar", async () => {
    // A server just for this test: the common room is created by the first account that connects.
    const proprio = await levantarServidor()
    const [ana] = await contasDeTeste(proprio, ["Ana"])
    try {
      await ate(() => ana!.session.channels.includes(proprio.sala), "a Ana cria a sala comum")
      await ate(() => ana!.session.roomsOf(proprio.sala).length >= 3, "as salas da sala comum chegam ao cofre")
      const semCategorias = (): boolean =>
        ana!.session.categoriesOf(proprio.sala).length === 0 &&
        ana!.session.roomsOf(proprio.sala).every((sala) => sala.category === "")
      expect(semCategorias()).toBe(true)
      ana!.session.disconnect()
      await ana!.session.connect()
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect(semCategorias()).toBe(true)
    } finally {
      desligarContas([ana!])
      await proprio.fechar()
    }
  }, 120_000)
})


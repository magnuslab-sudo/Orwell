import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  type ContaDeTeste,
  type ServidorDeTeste,
  levantarServidor,
} from "../testes/cliente-de-teste.js"

/**
 * The order of roles (4/11/2026), with accounting and production server: who
 * orders (the founder and `admin`), what travels (the signed `rank`, and the
 * `position` matching for clients 1.1.x), and what each member reads after commit.
 *
 * Ana founds. Dário has `admin`. Bruno manages roles by delegation. Carla is a member.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterEach(() => desligarContas(abertas.splice(0)))
afterAll(async () => {
  await servidor?.fechar()
})

const ordem = (conta: ContaDeTeste, canal: string): string[] => conta.session.rolesOf(canal).map((papel) => papel.role)
/** The order as a client 1.1.x reads it: only the `position`, with name as tiebreaker. */
const ordemAntiga = (conta: ContaDeTeste, canal: string): string[] =>
  [...conta.session.rolesOf(canal)].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)).map((papel) => papel.role)

describe("a ordem dos cargos entre clientes", () => {
  it("a fundadora reordena; todos lêem a ordem nova, pelo rank e pela position; um cargo novo nasce no fundo", async () => {
    const [ana, bruno, carla] = (await contas("Ana", "Bruno", "Carla")) as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
    const canal = await canalComTodos(servidor, ana, [bruno, carla])
    for (const [role, name] of [["chefe", "Chefe"], ["guia", "Guia"], ["porteiro", "Porteiro"]] as const) {
      await ana.session.defineRole(canal, { role, name, powers: [] })
    }
    for (const conta of [bruno, carla]) {
      await ate(() => conta.session.rolesOf(canal).length === 3, `${conta.nome} tem os três cargos`)
    }
    // No sorting: by birth order, each one at the end.
    for (const conta of [ana, bruno, carla]) expect(ordem(conta, canal)).toEqual(["chefe", "guia", "porteiro"])

    await ana.session.reorderRoles(canal, ["porteiro", "chefe", "guia"])
    // One `role.define` per role that changes place: waits for the last one.
    for (const conta of [bruno, carla]) {
      await ate(() => conta.session.rolesOf(canal).map((papel) => papel.rank).join() === "3,2,1", `${conta.nome} lê a ordem nova`)
    }
    for (const conta of [ana, bruno, carla]) {
      expect(ordem(conta, canal)).toEqual(["porteiro", "chefe", "guia"])
      // A 1.1.x client, which only knows position, reads the same order.
      expect(ordemAntiga(conta, canal)).toEqual(["porteiro", "chefe", "guia"])
      expect(conta.session.rolesOf(canal).map((papel) => papel.rank)).toEqual([3, 2, 1])
    }

    await ana.session.defineRole(canal, { role: "novo", name: "Novo", powers: [] })
    for (const conta of [bruno, carla]) await ate(() => conta.session.rolesOf(canal).length === 4, `${conta.nome} tem o cargo novo`)
    for (const conta of [ana, bruno, carla]) {
      expect(ordem(conta, canal)).toEqual(["porteiro", "chefe", "guia", "novo"])
      expect(ordemAntiga(conta, canal)).toEqual(["porteiro", "chefe", "guia", "novo"])
    }

    // Renaming does not move it.
    await ana.session.defineRole(canal, { role: "chefe", name: "Chefia", powers: [] })
    await ate(() => carla.session.rolesOf(canal).some((papel) => papel.name === "Chefia"), "a Carla lê o nome novo")
    expect(ordem(carla, canal)).toEqual(["porteiro", "chefe", "guia", "novo"])
  }, 180_000)

  it("quem tem admin reordena; quem gere por delegação e quem não tem cargo são recusados", async () => {
    const [ana, dario, bruno, carla] = (await contas("Ana", "Dário", "Bruno", "Carla")) as [ContaDeTeste, ContaDeTeste, ContaDeTeste, ContaDeTeste]
    const canal = await canalComTodos(servidor, ana, [dario, bruno, carla])
    await ana.session.defineRole(canal, { role: "chefe", name: "Chefe", powers: ["gerircargos"], rank: 5 })
    await ana.session.defineRole(canal, { role: "porteiro", name: "Porteiro", powers: [], rank: 1 })
    await ana.session.assignRoles(canal, dario.address, ["admin"])
    await ana.session.assignRoles(canal, bruno.address, ["chefe"])
    for (const conta of [dario, bruno, carla]) {
      await ate(() => conta.session.rolesFor(canal, bruno.address).includes("chefe"), `${conta.nome} sabe que o Bruno é chefe`)
      await ate(() => conta.session.rolesFor(canal, dario.address).includes("admin"), `${conta.nome} sabe que o Dário é admin`)
    }

    // No escalation: Bruno does not move the Gate above the Chief, nor does Carla change the order.
    await expect(bruno.session.reorderRoles(canal, ["porteiro", "chefe"])).rejects.toThrow("only an administrator may manage roles")
    await expect(carla.session.reorderRoles(canal, ["porteiro", "chefe"])).rejects.toThrow("only an administrator may manage roles")

    await dario.session.reorderRoles(canal, ["porteiro", "chefe"])
    for (const conta of [ana, bruno, carla]) {
      await ate(() => ordem(conta, canal).join() === "porteiro,chefe", `${conta.nome} lê a ordem do Dário`)
    }
  }, 180_000)
})

async function contas(...nomes: string[]): Promise<ContaDeTeste[]> {
  const novas = await contasDeTeste(servidor, nomes)
  abertas.push(...novas)
  return novas
}

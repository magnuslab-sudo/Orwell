import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { CARGO_TODOS } from "@enclave/protocol"
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
 * The 1.2 permission model (§4 of the parity plan), with real accounts and
 * server: per-room overrides for `mover`, role delegation with hierarchy and
 * no escalation (on both the sender and the receiver side), the delegation gate,
 * and the merge with the old writer.
 *
 * Ana founds. Bruno has roles. Carla and Dario are members.
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

async function contas(...nomes: string[]): Promise<ContaDeTeste[]> {
  const novas = await contasDeTeste(servidor, nomes)
  abertas.push(...novas)
  return novas
}

function movimentos(conta: ContaDeTeste): { from: string; payload: Record<string, unknown> }[] {
  const vistos: { from: string; payload: Record<string, unknown> }[] = []
  conta.session.on("voice", (evento) => {
    if (evento.payload.t === "voice.move") vistos.push({ from: evento.from, payload: evento.payload as never })
  })
  return vistos
}

describe("mover por sala: um cargo com mover numa sala e sem mover noutra", () => {
  it("o Bruno move na Arena e no Pátio, é recusado no Estúdio; o Dário é recusado em todas", async () => {
    const [ana, bruno, carla, dario] = (await contas("Ana", "Bruno", "Carla", "Dário")) as [ContaDeTeste, ContaDeTeste, ContaDeTeste, ContaDeTeste]
    const canal = await canalComTodos(servidor, ana, [bruno, carla, dario])
    for (const [room, name] of [["arena", "Arena"], ["patio", "Pátio"], ["estudio", "Estúdio"]] as const) {
      await ana.session.upsertRoom(canal, { room, name, kind: "voice" })
    }
    await ana.session.defineRole(canal, { role: "guia", name: "Guia", powers: ["mover"] })
    await ana.session.assignRoles(canal, bruno.address, ["guia"])
    await ana.session.setSobreposicoes(canal, { sala: "estudio" }, [{ role: "guia", allow: [], deny: ["mover"] }])
    for (const conta of [bruno, carla, dario]) {
      await ate(() => conta.session.rolesFor(canal, bruno.address).includes("guia"), `${conta.nome} sabe que o Bruno é guia`)
      await ate(() => conta.session.sobreposicoesDe(canal, { sala: "estudio" }).length === 1, `${conta.nome} tem a sobreposição do Estúdio`)
    }

    // What each one can do, read the same by everyone.
    for (const conta of [ana, bruno, carla, dario]) {
      expect(conta.session.permissoesEm(canal, bruno.address, "patio")).toContain("mover")
      expect(conta.session.permissoesEm(canal, bruno.address, "estudio")).not.toContain("mover")
      expect(conta.session.permissoesEm(canal, dario.address, "patio")).not.toContain("mover")
    }
    expect(bruno.session.mayMoveIn(canal, "arena", "patio")).toBe(true)
    expect(bruno.session.mayMoveIn(canal, "arena", "estudio")).toBe(false)
    expect(bruno.session.mayMoveIn(canal, "estudio", "patio")).toBe(false)

    // Sender side: Bruno moves from Arena to Pátio; his session refuses a move to Estúdio.
    const daCarla = movimentos(carla)
    await bruno.session.moveVoice(canal, carla.address, "patio", "arena")
    await expect(bruno.session.moveVoice(canal, carla.address, "estudio", "patio")).rejects.toThrow("you may not move people in this channel")
    await expect(dario.session.moveVoice(canal, carla.address, "patio", "arena")).rejects.toThrow("you may not move people in this channel")
    await expect(dario.session.moveVoice(canal, carla.address, "estudio", "arena")).rejects.toThrow("you may not move people in this channel")

    // Receiver side: the same requests sent by hand (a modified client) are dropped in Carla's session.
    await bruno.session.send(canal, { t: "voice.move", subject: carla.address, room: "estudio", de: "patio", at: Date.now() })
    await bruno.session.send(canal, { t: "voice.move", subject: carla.address, room: "arena", de: "estudio", at: Date.now() })
    await dario.session.send(canal, { t: "voice.move", subject: carla.address, room: "patio", at: Date.now() })
    // The marker: a legitimate request from the founder, sent later.
    await ana.session.moveVoice(canal, carla.address, "estudio", "patio")
    await ate(() => daCarla.some((m) => m.from === ana.address), "o pedido da Ana chega à Carla", 30_000)
    expect(daCarla.map((m) => [m.from, m.payload["room"]])).toEqual([
      [bruno.address, "patio"],
      [ana.address, "estudio"],
    ])
  }, 180_000)
})

describe("a delegação de cargos, com a hierarquia e sem escalada", () => {
  async function canalDelegado(): Promise<{ canal: string; ana: ContaDeTeste; bruno: ContaDeTeste; carla: ContaDeTeste }> {
    const [ana, bruno, carla] = (await contas("Ana", "Bruno", "Carla")) as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
    const canal = await canalComTodos(servidor, ana, [bruno, carla])
    await ana.session.defineRole(canal, { role: "chefe", name: "Chefe", powers: ["gerircargos", "convidar", "mover"], rank: 5 })
    await ana.session.defineRole(canal, { role: "porteiro", name: "Porteiro", powers: ["convidar"], rank: 1 })
    await ana.session.defineRole(canal, { role: "cofre", name: "Cofre", powers: ["expulsar"], rank: 2 })
    await ana.session.defineRole(canal, { role: "alto", name: "Alto", powers: [], rank: 9 })
    await ana.session.assignRoles(canal, bruno.address, ["chefe"])
    for (const conta of [bruno, carla]) {
      await ate(() => conta.session.rolesFor(canal, bruno.address).includes("chefe"), `${conta.nome} sabe que o Bruno é chefe`)
      await ate(() => conta.session.rolesOf(canal).length === 4, `${conta.nome} tem os quatro cargos`)
    }
    await ate(() => bruno.session.delegacaoDeCargos(canal), "o portão da delegação abre para o Bruno", 30_000)
    return { canal, ana, bruno, carla }
  }

  it("o Bruno dá e tira o porteiro; todos o vêem", async () => {
    const { canal, ana, bruno, carla } = await canalDelegado()
    expect(bruno.session.mayManageRoles(canal)).toBe(true)
    expect(bruno.session.mayManageRole(canal, "porteiro")).toBe(true)
    expect(bruno.session.mayManageRole(canal, "cofre")).toBe(false)
    expect(bruno.session.mayManageRole(canal, "alto")).toBe(false)
    await bruno.session.assignRoles(canal, carla.address, ["porteiro"])
    for (const conta of [ana, carla]) {
      await ate(() => conta.session.rolesFor(canal, carla.address).includes("porteiro"), `${conta.nome} vê a Carla porteira`)
    }
    await bruno.session.assignRoles(canal, carla.address, [])
    await ate(() => ana.session.rolesFor(canal, carla.address).length === 0, "a Ana vê a Carla sem cargo")
  }, 180_000)

  it("escalada recusada do lado de quem envia: dar o que não tem, subir acima de si, mexer no admin ou na fundadora", async () => {
    const { canal, ana, bruno, carla } = await canalDelegado()
    const recusa = "only an administrator may manage roles"
    await expect(bruno.session.assignRoles(canal, carla.address, ["cofre"])).rejects.toThrow(recusa)
    await expect(bruno.session.assignRoles(canal, carla.address, ["alto"])).rejects.toThrow(recusa)
    await expect(bruno.session.assignRoles(canal, carla.address, ["admin"])).rejects.toThrow(recusa)
    await expect(bruno.session.assignRoles(canal, carla.address, ["chefe"])).rejects.toThrow(recusa)
    await expect(bruno.session.assignRoles(canal, ana.address, ["porteiro"])).rejects.toThrow()
    await expect(bruno.session.defineRole(canal, { role: "porteiro", name: "Porteiro", powers: ["convidar", "expulsar"], rank: 1 })).rejects.toThrow(recusa)
    await expect(bruno.session.defineRole(canal, { role: "porteiro", name: "Porteiro", powers: ["convidar"], rank: 7 })).rejects.toThrow(recusa)
    await expect(bruno.session.defineRole(canal, { role: "admin", name: "Meu", powers: [] })).rejects.toThrow(recusa)
    await expect(bruno.session.deleteRole(canal, "cofre")).rejects.toThrow(recusa)
    // What is within his reach goes through: a new role below his, with only what he has.
    await bruno.session.defineRole(canal, { role: "guia", name: "Guia", powers: ["mover"], rank: 3 })
    await ate(() => ana.session.rolesOf(canal).some((papel) => papel.role === "guia"), "a Ana vê o cargo novo do Bruno")
  }, 180_000)

  it("escalada recusada do lado de quem recebe: o mesmo, à mão, cai em todos os cofres", async () => {
    const { canal, ana, bruno, carla } = await canalDelegado()
    const agora = Date.now()
    await bruno.session.send(canal, { t: "role.assign", subject: carla.address, roles: ["cofre"], assignedAt: agora })
    await bruno.session.send(canal, { t: "role.assign", subject: bruno.address, roles: ["chefe", "admin"], assignedAt: agora })
    await bruno.session.send(canal, {
      t: "role.define",
      role: "porteiro",
      name: "Porteiro",
      powers: ["convidar", "expulsar"],
      position: 0,
      rank: 1,
      removed: false,
      definedAt: agora + 60_000,
    })
    await bruno.session.send(canal, { t: "role.define", role: "alto", name: "Meu", powers: [], position: 0, rank: 1, removed: false, definedAt: agora + 60_000 })
    await bruno.session.send(canal, { t: "role.define", role: CARGO_TODOS, name: "todos", powers: ["expulsar"], position: 0, rank: 0, removed: false, definedAt: agora })
    // The marker: a legitimate action by Bruno, sent later.
    await bruno.session.assignRoles(canal, carla.address, ["porteiro"])
    for (const conta of [ana, carla]) {
      await ate(() => conta.session.rolesFor(canal, carla.address).includes("porteiro"), `${conta.nome} recebe a marca`)
      expect(conta.session.rolesFor(canal, carla.address)).toEqual(["porteiro"])
      expect(conta.session.rolesFor(canal, bruno.address)).toEqual(["chefe"])
      expect(conta.session.rolesOf(canal).find((papel) => papel.role === "porteiro")?.powers).toEqual(["convidar"])
      expect(conta.session.rolesOf(canal).find((papel) => papel.role === "alto")?.name).toBe("Alto")
      expect(conta.session.todosOf(canal).definido).toBe(false)
      expect(conta.session.permissoesEm(canal, carla.address)).not.toContain("expulsar")
    }
  }, 180_000)

  it("o portão fechado: se uma folha não disse que lê o modelo, o Bruno não oferece nem envia", async () => {
    const { canal, bruno, carla } = await canalDelegado()
    // Forget that Carla's device said it: that is what Bruno would see with a 1.1.0 client in the channel.
    await bruno.vault.update((contents) => {
      const doCanal = { ...(contents.conhecemPermissoes?.[canal] ?? {}) }
      for (const chave of Object.keys(doCanal)) delete doCanal[chave]
      contents.conhecemPermissoes = { ...contents.conhecemPermissoes, [canal]: doCanal }
    })
    expect(bruno.session.delegacaoDeCargos(canal)).toBe(false)
    expect(bruno.session.mayManageRoles(canal)).toBe(false)
    expect(bruno.session.mayManageRole(canal, "porteiro")).toBe(false)
    await expect(bruno.session.assignRoles(canal, carla.address, ["porteiro"])).rejects.toThrow("only an administrator may manage roles")
  }, 180_000)
})

describe("a migração dos cargos que já existem (§4.4)", () => {
  it("um cargo gravado por uma versão antiga continua a fazer tudo o que fazia, sem reescrita", async () => {
    const [ana, bruno, carla] = (await contas("Ana", "Bruno", "Carla")) as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
    const canal = await canalComTodos(servidor, ana, [bruno, carla])
    // How a 1.1.0 writes it: no `rank`, just the eight old powers.
    await ana.session.send(canal, { t: "role.define", role: "arrumador", name: "Arrumador", powers: ["renomear", "mover", "moderar"], position: 0, removed: false, definedAt: Date.now() })
    await ana.session.send(canal, { t: "role.assign", subject: bruno.address, roles: ["arrumador"], assignedAt: Date.now() })
    await ate(() => bruno.session.rolesFor(canal, bruno.address).includes("arrumador"), "o Bruno tem o cargo")
    const papel = bruno.session.rolesOf(canal).find((p) => p.role === "arrumador")
    // The editor sees the same role, with the same permissions, and rank at zero.
    expect(papel).toMatchObject({ name: "Arrumador", powers: ["renomear", "mover", "moderar"], rank: 0 })
    // And it can still do what it did before: manage rooms, disconnect from calls, nicknames.
    expect(bruno.session.permissoesEm(canal, bruno.address)).toEqual(
      expect.arrayContaining(["renomear", "mover", "moderar", "gerirsalas", "desligar", "apelidos"]),
    )
    expect(bruno.session.permissoesEm(canal, bruno.address)).not.toContain("gerircargos")
    await bruno.session.upsertRoom(canal, { room: "palco", name: "Palco", kind: "voice" })
    await ate(() => carla.session.roomsOf(canal).some((sala) => sala.room === "palco"), "a Carla vê a sala do Bruno")
    await bruno.session.disconnectVoice(canal, carla.address)
    // Anyone without a role still has none of this.
    await expect(carla.session.upsertRoom(canal, { room: "x", name: "X" })).rejects.toThrow("only an administrator may edit this channel")
    expect(bruno.vault.contents.channelRoles[canal]?.["arrumador"]?.payload).not.toHaveProperty("rank")
  }, 120_000)
})

describe("compatibilidade com o escritor antigo (1.0.x e 1.1.0)", () => {
  it("a republicação de um administrador antigo (sem rank, sem os poderes novos) não apaga nada a ninguém", async () => {
    const [ana, bruno] = (await contas("Ana", "Bruno")) as [ContaDeTeste, ContaDeTeste]
    const canal = await canalComTodos(servidor, ana, [bruno])
    await ana.session.defineRole(canal, { role: "chefe", name: "Chefe", powers: ["gerircargos", "mover"], rank: 4 })
    await ate(() => bruno.session.rolesOf(canal).some((papel) => papel.role === "chefe"), "o Bruno tem o chefe")
    const definedAt = (bruno.vault.contents.channelRoles[canal]?.["chefe"]?.at ?? 0) as number
    // What a 1.1.0 sends in `republishAuthority`: the original date, its eight powers, no rank.
    await ana.session.send(canal, { t: "role.define", role: "chefe", name: "Chefe", powers: ["mover"], position: 0, removed: false, definedAt })
    // And a real edit from a 1.1.0: the name changes, the rest stays.
    await ana.session.send(canal, { t: "role.define", role: "chefe", name: "Chefia", powers: ["mover", "convidar"], position: 0, removed: false, definedAt: definedAt + 10 })
    await ate(() => bruno.session.rolesOf(canal).some((papel) => papel.name === "Chefia"), "o Bruno lê o nome novo")
    const chefe = bruno.session.rolesOf(canal).find((papel) => papel.role === "chefe")
    expect(chefe).toMatchObject({ name: "Chefia", rank: 4 })
    expect(chefe?.powers).toEqual(["convidar", "mover", "gerircargos"])
  }, 120_000)

  it("uma sala republicada sem perms mantém as sobreposições; perms de quem não pode caem e o resto da sala passa", async () => {
    const [ana, bruno, carla] = (await contas("Ana", "Bruno", "Carla")) as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
    const canal = await canalComTodos(servidor, ana, [bruno, carla])
    await ana.session.upsertRoom(canal, { room: "estudio", name: "Estúdio", kind: "voice" })
    await ana.session.setSobreposicoes(canal, { sala: "estudio" }, [{ role: CARGO_TODOS, allow: [], deny: ["ligar"] }])
    await ate(() => bruno.session.sobreposicoesDe(canal, { sala: "estudio" }).length === 1, "o Bruno tem a sobreposição")
    // A 1.1.0 (or a room from before) renames the room: the field is not sent.
    await ana.session.upsertRoom(canal, { room: "estudio", name: "Estúdio 2", kind: "voice" })
    // Carla (no role) tries to clear the overrides with a hand-built room.
    await carla.session.send(canal, {
      t: "channel.meta",
      room: "estudio",
      name: "Estúdio 3",
      category: "",
      kind: "voice",
      position: 0,
      closed: false,
      removed: false,
      perms: [],
      updatedAt: Date.now() + 60_000,
    })
    await ate(() => bruno.session.roomsOf(canal).some((sala) => sala.name === "Estúdio 3"), "o Bruno lê o nome da Carla")
    expect(bruno.session.sobreposicoesDe(canal, { sala: "estudio" })).toEqual([{ role: CARGO_TODOS, allow: [], deny: ["ligar"] }])
    expect(bruno.session.permissoesEm(canal, carla.address, "estudio")).not.toContain("ligar")
  }, 120_000)
})

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { SALA_DA_PERGUNTA } from "@enclave/protocol"
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
 * Voice and role moderation (owner request, 2/11/2026), with real accounts and
 * server.
 *
 * Ana founds the channel and gives Bruno a role with only `mover`. Carla has no
 * role. We measure what each SESSION lets through to the call (the `voice` event),
 * not what left on the wire: the sender is authenticated in the receiver's
 * session, and that is where we decide whether they have authority.
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

/** The `voice.move` that this account's session delivers to the call. */
function movimentos(conta: ContaDeTeste): { from: string; payload: Record<string, unknown> }[] {
  const vistos: { from: string; payload: Record<string, unknown> }[] = []
  conta.session.on("voice", (evento) => {
    if (evento.payload.t === "voice.move") vistos.push({ from: evento.from, payload: evento.payload as never })
  })
  return vistos
}

async function canalModerado(): Promise<{ canal: string; ana: ContaDeTeste; bruno: ContaDeTeste; carla: ContaDeTeste }> {
  const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
  const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])
  await ana!.session.defineRole(canal, { role: "moderacao", name: "Moderação", powers: ["mover"] })
  await ana!.session.assignRoles(canal, bruno!.address, ["moderacao"])
  for (const conta of [ana!, bruno!, carla!]) {
    await ate(() => conta.session.powersOf(canal, bruno!.address).includes("mover"), `${conta.nome} sabe que o Bruno move`)
  }
  return { canal, ana: ana!, bruno: bruno!, carla: carla! }
}

describe("mover alguém de sala de voz, de ponta a ponta", () => {
  it("o pedido do moderador chega à chamada da Carla, sem passar por ela", async () => {
    const { canal, bruno, carla } = await canalModerado()
    const daCarla = movimentos(carla)
    await bruno.session.moveVoice(canal, carla.address, "estudio")
    await ate(() => daCarla.length > 0, "o pedido chega à Carla")
    expect(daCarla[0]).toMatchObject({ from: bruno.address, payload: { subject: carla.address, room: "estudio" } })
  }, 120_000)

  it("quem não tem «mover» não move ninguém: a sessão de quem recebe deita o pedido fora", async () => {
    const { canal, ana, bruno, carla } = await canalModerado()
    const doBruno = movimentos(bruno)
    // A modified client sends it anyway, bypassing the `moveVoice` guard.
    await carla.session.send(canal, { t: "voice.move", subject: bruno.address, room: "estudio", at: Date.now() })
    // And right after a legitimate request from the founder, which serves as a marker: when
    // this arrives, Carla's (sent before, on the same channel) has already been read.
    await ana.session.moveVoice(canal, bruno.address, "balcao")
    await ate(() => doBruno.length > 0, "o pedido da Ana chega ao Bruno")
    expect(doBruno.map((m) => m.from)).toEqual([ana.address])
  }, 120_000)

  it("um cargo criado antes de alguém entrar vale para quem entra depois", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ana!.session.defineRole(canal, { role: "moderacao", name: "Moderação", powers: ["mover"] })
    await ana!.session.assignRoles(canal, bruno!.address, ["moderacao"])
    await ate(() => bruno!.session.may(canal, "mover"), "o Bruno sabe que move")
    // Carla joins later: the role was published in an epoch she does not read.
    await ana!.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra no canal", 30_000)
    await ate(() => carla!.session.powersOf(canal, bruno!.address).includes("mover"), "a Carla sabe que o Bruno move", 30_000)
    const daCarla = movimentos(carla!)
    await bruno!.session.moveVoice(canal, carla!.address, "estudio")
    await ate(() => daCarla.length > 0, "o pedido do Bruno chega à Carla")
  }, 120_000)

  it("«Desligar da chamada»: o moderador tira a Carla da chamada, e a Carla não o faz a ninguém", async () => {
    const { canal, bruno, carla } = await canalModerado()
    const daCarla = movimentos(carla)
    await bruno.session.disconnectVoice(canal, carla.address)
    await ate(() => daCarla.length > 0, "o pedido chega à Carla")
    expect(daCarla[0]?.payload).toMatchObject({ subject: carla.address, room: SALA_DA_PERGUNTA, desligar: true })
    await expect(carla.session.disconnectVoice(canal, bruno.address)).rejects.toThrow("you may not move people in this channel")
    await expect(bruno.session.disconnectVoice(canal, bruno.address)).rejects.toThrow("to leave the call, leave it")
  }, 120_000)
})

describe("o nome do cargo de administrador", () => {
  it("a fundadora muda o nome e a cor, todos lêem o nome novo, e o cargo continua a dar tudo", async () => {
    const { canal, ana, bruno, carla } = await canalModerado()
    await ana.session.assignRole(canal, bruno.address, true)
    await ate(() => carla.session.rolesFor(canal, bruno.address).includes("admin"), "a Carla sabe que o Bruno administra")

    // The powers in the request do not matter: the built-in role always has everything.
    await ana.session.defineRole(canal, { role: "admin", name: "Guardiões", powers: [], colour: "ambar" })
    for (const conta of [ana, bruno, carla]) {
      await ate(() => conta.session.adminRole(canal)?.name === "Guardiões", `${conta.nome} lê o nome novo`)
      expect(conta.session.adminRole(canal)).toEqual({ name: "Guardiões", colour: "ambar" })
      expect(conta.session.powersOf(canal, bruno.address)).toContain("expulsar")
      // And it does not show as another role in the list: it stays the built-in one.
      expect(conta.session.rolesOf(canal).map((papel) => papel.role)).not.toContain("admin")
    }

    // Someone who does not manage roles cannot rename it, neither in the sender-side guard...
    await expect(carla.session.defineRole(canal, { role: "admin", name: "Eu", powers: [] })).rejects.toThrow(
      "only an administrator may manage roles",
    )
    // ...nor in the receiver-side one.
    await carla.session.send(canal, {
      t: "role.define",
      role: "admin",
      name: "Forjado",
      powers: [],
      position: 0,
      removed: false,
      definedAt: Date.now() + 60_000,
    })
    await ana.session.defineRole(canal, { role: "moderacao", name: "Moderação 2", powers: ["mover"] })
    await ate(() => bruno.session.rolesOf(canal).some((papel) => papel.name === "Moderação 2"), "a marca chega ao Bruno")
    expect(bruno.session.adminRole(canal)?.name).toBe("Guardiões")

    // And it still cannot be deleted.
    await expect(ana.session.deleteRole(canal, "admin")).rejects.toThrow("the admin role is built in")
  }, 120_000)
})

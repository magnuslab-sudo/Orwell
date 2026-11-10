import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { dobrarConversa } from "@enclave/client-core"
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
 * The "moderate" capability (phase 3 of 0.9), with real accounts and server.
 *
 * Ana founds the channel and creates a "Moderation" role with only `moderate`,
 * giving it to Bruno. Carla has no role. We measure what each VAULT reads, never
 * what passed on the wire: a tombstone that leaves and nobody honors is
 * indistinguishable, from the sender's side, from one that was picked up.
 *
 * The server doesn't change: all this travels encrypted inside the MLS group, like
 * any message.
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

const mensagem = (id: string, body: string, extra: Record<string, unknown> = {}): never =>
  ({ t: "message", id, body, sentAt: Date.now(), attachments: [], ...extra }) as never

/** Ana's channel with Bruno moderating and Carla with no role. */
async function canalModerado(): Promise<{ canal: string; ana: ContaDeTeste; bruno: ContaDeTeste; carla: ContaDeTeste }> {
  const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
  const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])
  await ana!.session.defineRole(canal, { role: "moderacao", name: "Moderação", powers: ["moderar"] })
  await ana!.session.assignRoles(canal, bruno!.address, ["moderacao"])
  for (const conta of [ana!, bruno!, carla!]) {
    await ate(() => conta.session.mayModerate(canal, bruno!.address), `${conta.nome} sabe que o Bruno modera`)
  }
  return { canal, ana: ana!, bruno: bruno!, carla: carla! }
}

/** The conversation as each app displays it: with the moderation its vault knows about. */
const conversaDe = (conta: ContaDeTeste, canal: string): Record<string, unknown>[] =>
  dobrarConversa(conta.session.history(canal), { modera: (quem) => conta.session.mayModerate(canal, quem) }).map(
    (entrada) => entrada.payload as Record<string, unknown>,
  )

describe("moderar, de ponta a ponta", () => {
  it("quem modera elimina a mensagem da Carla: em todos os cofres a linha fica, sem texto", async () => {
    const { canal, ana, bruno, carla } = await canalModerado()
    await carla.session.send(canal, mensagem("m-carla-1", "uma frase feia"))
    for (const conta of [ana, bruno]) {
      await ate(() => conversaDe(conta, canal).some((p) => p["id"] === "m-carla-1"), `a frase chega a ${conta.nome}`)
    }

    await bruno.session.deleteMessage(canal, "m-carla-1")
    for (const conta of [ana, bruno, carla]) {
      await ate(
        () => conversaDe(conta, canal).find((p) => p["id"] === "m-carla-1")?.["moderada"] === true,
        `a lápide do Bruno vale em ${conta.nome}`,
      )
      expect(conversaDe(conta, canal).find((p) => p["id"] === "m-carla-1")?.["body"]).toBe("")
    }
  }, 120_000)

  it("sem o poder, o núcleo recusa eliminar a mensagem de outra pessoa", async () => {
    const { canal, ana, carla } = await canalModerado()
    await ana.session.send(canal, mensagem("m-ana-001", "olá a todos"))
    await ate(() => conversaDe(carla, canal).some((p) => p["id"] === "m-ana-001"), "a frase chega à Carla")
    await expect(carla.session.deleteMessage(canal, "m-ana-001")).rejects.toThrow(
      "only the author or a moderator may delete this message",
    )
  }, 120_000)

  it("apelidos: o próprio muda o seu, quem modera muda o dos outros, e o resto não conta", async () => {
    const { canal, ana, bruno, carla } = await canalModerado()

    await carla.session.setNickname(canal, carla.address, "Carlinha")
    for (const conta of [ana, bruno, carla]) {
      await ate(() => conta.session.nicknamesOf(canal)[carla.address] === "Carlinha", `o apelido chega a ${conta.nome}`)
    }

    await bruno.session.setNickname(canal, carla.address, "Carla M.")
    for (const conta of [ana, bruno, carla]) {
      await ate(() => conta.session.nicknamesOf(canal)[carla.address] === "Carla M.", `o apelido do Bruno vale em ${conta.nome}`)
    }

    // The guard of the sender.
    await expect(carla.session.setNickname(canal, ana.address, "Chefe")).rejects.toThrow("you may not moderate in this channel")

    // And that of the receiver: a modified client sends it anyway, and nobody records it.
    await carla.session.send(
      canal,
      mensagem("m-forjada", "Mudou o apelido de Ana.", { apelido: { subject: ana.address, nick: "Chefe", at: Date.now() } }),
    )
    for (const conta of [ana, bruno]) {
      await ate(() => conversaDe(conta, canal).some((p) => p["id"] === "m-forjada"), `a mensagem forjada chega a ${conta.nome}`)
      expect(conta.session.nicknamesOf(canal)[ana.address]).toBeUndefined()
    }
  }, 120_000)

  it("tickets: quem modera elimina um ticket fechado, e ele sai do quadro de todos", async () => {
    const { canal, ana, bruno, carla } = await canalModerado()
    const sala = "forum"
    const ticket = await carla.session.openTicket(canal, sala, "A porta não fecha")
    await ate(() => bruno.session.ticketsOf(canal, sala).some((t) => t.id === ticket), "o ticket chega ao Bruno")

    // Once open, it doesn't delete.
    await expect(bruno.session.deleteTicket(canal, sala, ticket)).rejects.toThrow("only a closed ticket can be deleted")

    await carla.session.setTicketState(canal, sala, ticket, "closed")
    await ate(() => bruno.session.ticketsOf(canal, sala).find((t) => t.id === ticket)?.state === "closed", "fechado no Bruno")

    await bruno.session.deleteTicket(canal, sala, ticket)
    for (const conta of [ana, bruno, carla]) {
      await ate(() => !conta.session.ticketsOf(canal, sala).some((t) => t.id === ticket), `o ticket sai do quadro de ${conta.nome}`)
    }
  }, 120_000)
})

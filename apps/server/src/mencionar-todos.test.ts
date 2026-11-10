import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { MENCAO_TODOS, POWERS } from "@enclave/protocol"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  type ContaDeTeste,
  levantarServidor,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"

/**
 * `@all` (item #10 of the parity plan): the `mencionartodos` permission, with
 * real accounts and a real server, checked on both sides.
 *
 * Ana founds. Bruno is an administrator. Dário has the "Anúncios" role, with
 * the permission, except in the "Recados" room, where an override removes it. Carla
 * is a member with no role.
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

interface Vista {
  from: string
  body: string
  mentions: string[]
}

/** Messages from OTHERS that the session delivers to the interface (the `message` event). */
function mensagens(conta: ContaDeTeste, canal: string): Vista[] {
  const vistas: Vista[] = []
  conta.session.on("message", (evento) => {
    if (evento.channel !== canal || evento.payload.t !== "message" || evento.sender === conta.address) return
    const payload = evento.payload as { body: string; mentions?: string[] }
    vistas.push({ from: evento.sender, body: payload.body, mentions: [...(payload.mentions ?? [])] })
  })
  return vistas
}

/** The payload as stored in the vault: the signed one, never rewritten. */
function guardada(conta: ContaDeTeste, canal: string, body: string): { mentions?: string[] } | undefined {
  const cofre = (conta.session as unknown as { vault: { contents: { history: Record<string, { payload: Record<string, unknown> }[]> } } }).vault
  return cofre.contents.history[canal]?.find((entrada) => entrada.payload["body"] === body)?.payload as
    | { mentions?: string[] }
    | undefined
}

async function mensagem(conta: ContaDeTeste, canal: string, body: string, room?: string): Promise<void> {
  await conta.session.send(canal, {
    t: "message",
    body,
    sentAt: Date.now(),
    id: crypto.randomUUID(),
    ...(room ? { room } : {}),
    attachments: [],
    links: [],
    mentions: [MENCAO_TODOS],
  })
}

async function montar(): Promise<{ canal: string; ana: ContaDeTeste; bruno: ContaDeTeste; carla: ContaDeTeste; dario: ContaDeTeste }> {
  const [ana, bruno, carla, dario] = (await contasDeTeste(servidor, ["Ana", "Bruno", "Carla", "Dário"])) as [
    ContaDeTeste,
    ContaDeTeste,
    ContaDeTeste,
    ContaDeTeste,
  ]
  abertas.push(ana, bruno, carla, dario)
  const canal = await canalComTodos(servidor, ana, [bruno, carla, dario])
  await ana.session.upsertRoom(canal, { room: "recados", name: "Recados", kind: "text" })
  await ana.session.assignRole(canal, bruno.address, true)
  await ana.session.defineRole(canal, { role: "anuncios", name: "Anúncios", powers: ["mencionartodos"], rank: 1 })
  await ana.session.assignRoles(canal, dario.address, ["anuncios"])
  await ana.session.setSobreposicoes(canal, { sala: "recados" }, [{ role: "anuncios", allow: [], deny: ["mencionartodos"] }])
  for (const conta of [ana, bruno, carla, dario]) {
    await ate(() => conta.session.rolesFor(canal, dario.address).includes("anuncios"), `${conta.nome} sabe que o Dário faz anúncios`)
    await ate(() => conta.session.rolesFor(canal, bruno.address).includes("admin"), `${conta.nome} sabe que o Bruno é administrador`)
    await ate(() => conta.session.sobreposicoesDe(canal, { sala: "recados" }).length === 1, `${conta.nome} tem a sobreposição dos Recados`)
  }
  return { canal, ana, bruno, carla, dario }
}

describe("@all: a permissão mencionartodos, conferida por quem envia e por quem recebe", () => {
  it("a fundadora, o administrador e o cargo com a permissão mencionam todos; toda a gente não, por omissão", async () => {
    const { canal, ana, bruno, carla, dario } = await montar()
    for (const conta of [ana, bruno, carla, dario]) {
      expect(conta.session.permissoesEm(canal, ana.address, "")).toContain("mencionartodos")
      expect(conta.session.permissoesEm(canal, bruno.address, "")).toContain("mencionartodos")
      expect(conta.session.permissoesEm(canal, dario.address, "")).toContain("mencionartodos")
      expect(conta.session.permissoesEm(canal, dario.address, "recados")).not.toContain("mencionartodos")
      expect(conta.session.permissoesEm(canal, carla.address, "")).not.toContain("mencionartodos")
    }
    expect(carla.session.may(canal, "mencionartodos", "")).toBe(false)
    expect(bruno.session.may(canal, "mencionartodos", "recados")).toBe(true)

    const daCarla = mensagens(carla, canal)
    const doBruno = mensagens(bruno, canal)
    await mensagem(ana, canal, "@all reunião às 9")
    await mensagem(bruno, canal, "@all a sala mudou")
    await mensagem(dario, canal, "@todos novidades")
    await ate(() => daCarla.length === 3, "a Carla recebe as três", 30_000)
    await ate(() => doBruno.length === 2, "o Bruno recebe as duas dos outros", 30_000)
    for (const vista of daCarla) expect(vista.mentions).toEqual([MENCAO_TODOS])
    for (const vista of doBruno) expect(vista.mentions).toEqual([MENCAO_TODOS])
    // And the history, which is what the interface counts from after reopening.
    const historia = carla.session.history(canal).filter((entrada) => entrada.payload.t === "message")
    expect(historia.map((entrada) => (entrada.payload as { mentions?: string[] }).mentions)).toEqual([
      [MENCAO_TODOS],
      [MENCAO_TODOS],
      [MENCAO_TODOS],
    ])
  }, 180_000)

  it("quem envia sem a permissão não põe @all no fio: a mensagem vai, como texto normal", async () => {
    const { canal, ana, carla } = await montar()
    const daAna = mensagens(ana, canal)
    await mensagem(carla, canal, "@all olá a todos")
    await ate(() => daAna.length === 1, "a Ana recebe a mensagem da Carla", 30_000)
    expect(daAna[0]).toEqual({ from: carla.address, body: "@all olá a todos", mentions: [] })
    // Ana didn't remove it: it arrived like this. Her vault holds what came over the wire.
    await ate(() => guardada(ana, canal, "@all olá a todos") !== undefined, "a Ana guarda a mensagem")
    expect(guardada(ana, canal, "@all olá a todos")?.mentions).toEqual([])
  }, 180_000)

  it("uma app alterada envia @all sem a permissão: chega, mas não conta como menção para ninguém", async () => {
    const { canal, ana, bruno, carla, dario } = await montar()
    // Carla with a modified app: her session thinks it can do anything.
    ;(carla.session as unknown as { permissoesEm: () => string[] }).permissoesEm = () => [...POWERS]
    const vistas = [ana, bruno, dario].map((conta) => mensagens(conta, canal))
    await mensagem(carla, canal, "@all spam")
    for (const [indice, lista] of vistas.entries()) {
      await ate(() => lista.length === 1, `a conta ${indice} recebe a mensagem`, 30_000)
      expect(lista[0]).toEqual({ from: carla.address, body: "@all spam", mentions: [] })
    }
    // The vault keeps what arrived, signed, with the mention: it is the delivery that drops it.
    await ate(() => guardada(ana, canal, "@all spam") !== undefined, "a Ana guarda a mensagem")
    expect(guardada(ana, canal, "@all spam")?.mentions).toEqual([MENCAO_TODOS])
    expect(
      ana.session
        .history(canal)
        .filter((entrada) => entrada.payload.t === "message")
        .map((entrada) => (entrada.payload as { mentions?: string[] }).mentions),
    ).toEqual([[]])
  }, 180_000)

  it("a sobreposição por sala: o Dário menciona todos na sala geral, e nos Recados não", async () => {
    const { canal, carla, dario } = await montar()
    // Dário with a modified app, so the refusal comes from the receiver.
    ;(dario.session as unknown as { permissoesEm: () => string[] }).permissoesEm = () => [...POWERS]
    const daCarla = mensagens(carla, canal)
    await mensagem(dario, canal, "@all na geral")
    await mensagem(dario, canal, "@all nos recados", "recados")
    await ate(() => daCarla.length === 2, "a Carla recebe as duas", 30_000)
    expect(daCarla.map((vista) => [vista.body, vista.mentions])).toEqual([
      ["@all na geral", [MENCAO_TODOS]],
      ["@all nos recados", []],
    ])
  }, 180_000)
})

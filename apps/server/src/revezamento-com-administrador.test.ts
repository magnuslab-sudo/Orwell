import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Session } from "@enclave/client-core"
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
 * Bursts of rooms on the Orwell channel (3/11/2026).
 *
 * Owner log (1.1.0), one entry in `!984` at 20:58: 83 `role.assign`, 40
 * `channel.meta` and 12 `channel.category` in 14 s, with 10 rooms and 3
 * categories. The rooms arrived four times, from four senders. The admin first
 * sends the founding, the roles and each assignment (one per member with a role,
 * 80 in `!984`, each taking the group's turn and a vault write), and only
 * then the categories and the rooms. Members without a role step in
 * (`#revezarSalas`) if they hear no rooms within 2 to 6 s, and in that window
 * they only heard assignments: they all spoke, with whatever vault they had,
 * sometimes stale.
 *
 * Here the admin is slow to reach the rooms (as with 80 assignments ahead),
 * and the member without a role must not speak over him.
 */

const abertas: ContaDeTeste[] = []
const servidores: ServidorDeTeste[] = []
let servidor: ServidorDeTeste
let revezamento = Session.REVEZAMENTO_DAS_SALAS_MS

beforeAll(() => {
  revezamento = Session.REVEZAMENTO_DAS_SALAS_MS
  Session.REVEZAMENTO_DAS_SALAS_MS = { de: 300, ate: 600 }
})

/** One server per case: the common room is born in each one, without inheriting the previous one's founder. */
beforeEach(async () => {
  servidor = await levantarServidor()
  servidores.push(servidor)
}, 60_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  Session.REVEZAMENTO_DAS_SALAS_MS = revezamento
  for (const aberto of servidores.splice(0)) await aberto.fechar()
})

/** How many rooms and categories this account sends from now on. */
function contarSalasQueSaem(conta: ContaDeTeste, canal: string): () => number {
  let quantas = 0
  const enviar = conta.session.send.bind(conta.session)
  conta.session.send = (async (destino: string, payload: { t?: string }) => {
    if (destino === canal && (payload.t === "channel.meta" || payload.t === "channel.category")) quantas++
    return enviar(destino, payload as Parameters<typeof enviar>[1])
  }) as typeof conta.session.send
  // Rooms and categories go out in a batch (`sendBatch`, slow-after-join): they are counted there too.
  const emLote = conta.session.sendBatch.bind(conta.session)
  conta.session.sendBatch = (async (destino: string, payloads: { t?: string }[]) => {
    if (destino === canal) quantas += payloads.filter((p) => p.t === "channel.meta" || p.t === "channel.category").length
    return emLote(destino, payloads as Parameters<typeof emLote>[1])
  }) as typeof conta.session.sendBatch
  return () => quantas
}

/** The admin takes `ms` to reach the categories and rooms, as if behind dozens of assignments. */
function salasAtrasadas(conta: ContaDeTeste, canal: string, ms: number | "nunca"): void {
  const enviar = conta.session.send.bind(conta.session)
  conta.session.send = (async (destino: string, payload: { t?: string }) => {
    if (destino === canal && (payload.t === "channel.meta" || payload.t === "channel.category")) {
      if (ms === "nunca") return
      await new Promise((resolve) => setTimeout(resolve, ms))
    }
    return enviar(destino, payload as Parameters<typeof enviar>[1])
  }) as typeof conta.session.send
  const emLote = conta.session.sendBatch.bind(conta.session)
  conta.session.sendBatch = (async (destino: string, payloads: { t?: string }[]) => {
    if (destino === canal && payloads.some((p) => p.t === "channel.meta" || p.t === "channel.category")) {
      if (ms === "nunca") return
      await new Promise((resolve) => setTimeout(resolve, ms))
    }
    return emLote(destino, payloads as Parameters<typeof emLote>[1])
  }) as typeof conta.session.sendBatch
}

/** Ana founds and arranges the common room (one category, one room); Bruno joins, with no role. */
async function salaComumComAnaEBruno(): Promise<{ ana: ContaDeTeste; bruno: ContaDeTeste; comum: string }> {
  const [ana, bruno] = (await contasDeTeste(servidor, ["Ana", "Bruno"])) as [ContaDeTeste, ContaDeTeste]
  abertas.push(ana, bruno)
  const comum = servidor.sala
  await ana.session.ensureCommonRoom()
  await ate(() => ana.session.channels.includes(comum), "a Ana está na sala comum")
  if (!ana.session.founderOf(comum)) await ana.session.claimFounder(comum)
  await ate(() => ana.session.founderOf(comum) === ana.address, "a Ana funda a sala comum")
  await ana.session.upsertCategory(comum, { category: "Adega", position: 1 })
  await ana.session.upsertRoom(comum, { room: "prensa", name: "prensa", category: "Adega" })
  await bruno.session.ensureCommonRoom()
  await ate(() => bruno.session.roomsOf(comum).some((sala) => sala.name === "prensa"), "a sala chega ao Bruno", 30_000)
  await ate(() => bruno.session.founderOf(comum) === ana.address, "o Bruno sabe quem manda", 30_000)
  expect(bruno.session.mayEditChannel(comum)).toBe(false)
  await ate(() => servidor.enclave.store.hasGroupInfo(comum), "o cartão está no servidor", 30_000)
  return { ana, bruno, comum }
}

describe("o revezamento das salas com o administrador ligado", () => {
  /*
    In the common room, as in `!984`: whoever joins through the card does not get
    a portrait, and the cascade of whoever arranges it runs in full. The case
    with no admin connected (the member without a role HAS to send the rooms) is in
    `salas-sem-administrador.test.ts`, and stays green.
  */
  it("um membro sem cargo não repete as salas enquanto quem arruma o canal as está a dizer", async () => {
    const { ana, bruno, comum } = await salaComumComAnaEBruno()
    salasAtrasadas(ana, comum, 1_500)
    const doBruno = contarSalasQueSaem(bruno, comum)
    const [carla] = await contasDeTeste(servidor, ["Carla"])
    abertas.push(carla!)
    carla!.session.antiEntropiaLigada = false
    await carla!.session.ensureCommonRoom()
    await ate(() => carla!.session.channels.includes(comum), "a Carla entra pelo cartão", 30_000)
    await ate(() => carla!.session.roomsOf(comum).some((sala) => sala.name === "prensa"), "a sala chega à Carla, pela Ana", 30_000)
    // The fallback already had its turn (300 to 600 ms) long before this.
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    expect(doBruno()).toBe(0)
  }, 120_000)

  it("se a cascata de quem arruma começa e as salas não chegam, o membro sem cargo di-las na mesma", async () => {
    const antes = Session.REVEZAMENTO_ATRAS_DE_QUEM_ARRUMA_MS
    Session.REVEZAMENTO_ATRAS_DE_QUEM_ARRUMA_MS = 1_500
    try {
      const { ana, bruno, comum } = await salaComumComAnaEBruno()
      salasAtrasadas(ana, comum, "nunca")
      const doBruno = contarSalasQueSaem(bruno, comum)
      const [carla] = await contasDeTeste(servidor, ["Carla"])
      abertas.push(carla!)
      carla!.session.antiEntropiaLigada = false
      await carla!.session.ensureCommonRoom()
      await ate(() => carla!.session.channels.includes(comum), "a Carla entra pelo cartão", 30_000)
      await ate(() => carla!.session.roomsOf(comum).some((sala) => sala.name === "prensa"), "a sala chega à Carla, pelo Bruno", 30_000)
      expect(doBruno()).toBeGreaterThan(0)
    } finally {
      Session.REVEZAMENTO_ATRAS_DE_QUEM_ARRUMA_MS = antes
    }
  }, 120_000)
})

import { afterAll, afterEach, describe, expect, it } from "vitest"
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
 * Rooms reach newcomers without an admin online.
 *
 * Reported by the owner on 2/11/2026 (1.0.6): "users on mobile are not seeing the
 * community rooms". Whoever joins a channel cannot decrypt the `channel.meta` of each
 * room: it was encrypted in an earlier epoch (forward secrecy). Two paths give them the
 * rooms: republishing by whoever arranges the channel (`republishRooms`, only with `renomear`)
 * and anti-entropy reports (S4), which any member sends with the original authorship.
 *
 * The second fails sometimes. Measured here, with the admin offline and one member
 * online: in 24 runs, two stalls over 30 s, one over 2.5 min with only "avarias", no
 * "prensa" and no idea who founded the room. With the first path tied to the admin,
 * nothing repairs it. In the common room, whoever joins on mobile almost always joins
 * this way: from the page, at any hour, with no admin online.
 *
 * The common room cases disable anti-entropy on the existing members and on the newcomer.
 * This is the bad case, made deterministic: rooms must still arrive, and authority
 * does not change hands.
 */

const abertas: ContaDeTeste[] = []
const servidores: ServidorDeTeste[] = []

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  for (const servidor of servidores.splice(0)) await servidor.fechar()
})

/** One server per case: the common room is born here, without inheriting members from another case. */
async function servidorDoCaso(): Promise<ServidorDeTeste> {
  const servidor = await levantarServidor()
  servidores.push(servidor)
  return servidor
}

async function duasContas(servidor: ServidorDeTeste): Promise<[ContaDeTeste, ContaDeTeste]> {
  const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
  abertas.push(ana!, bruno!)
  return [ana!, bruno!]
}

/**
 * Carla is created ONLY when she is needed. A connected account joins the common room
 * on its own at the end of the handshake: created early, it would join while Ana was
 * still online.
 */
async function carlaChega(servidor: ServidorDeTeste, antes?: (carla: ContaDeTeste) => void): Promise<ContaDeTeste> {
  const [carla] = await contasDeTeste(servidor, ["Carla"])
  abertas.push(carla!)
  antes?.(carla!)
  return carla!
}

const nomesDasSalas = (conta: ContaDeTeste, canal: string): string[] => conta.session.roomsOf(canal).map((sala) => sala.name)

/**
 * Ana starts the common room, becomes founder and arranges it; Bruno joins and learns
 * who is in charge. Returns the common room address.
 */
async function salaComumArrumada(servidor: ServidorDeTeste, ana: ContaDeTeste, bruno: ContaDeTeste): Promise<string> {
  const comum = servidor.sala
  await ana.session.ensureCommonRoom()
  await ate(() => ana.session.channels.includes(comum), "a Ana está na sala comum")
  // Whoever starts the common room becomes founder; it claims the room only if that failed.
  if (!ana.session.founderOf(comum)) await ana.session.claimFounder(comum)
  await ate(() => ana.session.founderOf(comum) === ana.address, "a Ana funda a sala comum")
  await ana.session.upsertCategory(comum, { category: "Adega", position: 1 })
  await ana.session.upsertRoom(comum, { room: "prensa", name: "prensa", category: "Adega" })

  await bruno.session.ensureCommonRoom()
  await ate(() => bruno.session.channels.includes(comum), "o Bruno entra na sala comum", 30_000)
  await ate(() => nomesDasSalas(bruno, comum).includes("prensa"), "a sala chega ao Bruno", 30_000)
  await ate(() => bruno.session.founderOf(comum) === ana.address, "o Bruno sabe quem manda", 30_000)
  expect(bruno.session.mayEditChannel(comum)).toBe(false)
  // The gate is set before Ana leaves (see `sala-comum-sem-ninguem.test.ts`).
  await ate(() => servidor.enclave.store.hasGroupInfo(comum), "o cartão está no servidor", 30_000)
  return comum
}

async function esperarAsSalas(carla: ContaDeTeste, comum: string, rotulo: string): Promise<void> {
  await ate(() => nomesDasSalas(carla, comum).includes("prensa"), rotulo, 30_000)
  expect(carla.session.roomsOf(comum).find((sala) => sala.room === "prensa")?.category).toBe("Adega")
  await ate(() => carla.session.categoriesOf(comum).some((c) => c.category === "Adega"), "a categoria chega à Carla")
}

/** How many rooms and categories this account sends from now on, counted on the way out of the session. */
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

describe("as salas sem administrador ligado", () => {
  it("um membro senta outro, sem administrador ligado, e as salas chegam", async () => {
    const servidor = await servidorDoCaso()
    const [ana, bruno] = await duasContas(servidor)
    const canal = await canalComTodos(servidor, ana, [bruno])

    await ana.session.upsertCategory(canal, { category: "Adega", position: 1 })
    await ana.session.upsertRoom(canal, { room: "prensa", name: "prensa", category: "Adega" })
    await ate(() => nomesDasSalas(bruno, canal).includes("prensa"), "a sala chega ao Bruno")
    expect(bruno.session.mayEditChannel(canal)).toBe(false)

    ana.session.disconnect()
    const carla = await carlaChega(servidor)
    await bruno.session.seat(canal, carla.address)
    await ate(() => carla.session.channels.includes(canal), "a Carla entra no canal")
    await esperarAsSalas(carla, canal, "a sala chega à Carla, sem a Ana")
    expect(carla.session.founderOf(canal)).not.toBe(bruno.address)
  }, 120_000)

  it("na sala comum, quem entra pelo cartão recebe as salas de um membro sem cargo, mesmo sem relatos", async () => {
    const servidor = await servidorDoCaso()
    const [ana, bruno] = await duasContas(servidor)
    const comum = await salaComumArrumada(servidor, ana, bruno)

    ana.session.disconnect()
    bruno.session.antiEntropiaLigada = false
    const doBruno = contarSalasQueSaem(bruno, comum)
    const carla = await carlaChega(servidor, (c) => (c.session.antiEntropiaLigada = false))

    await carla.session.ensureCommonRoom()
    await ate(() => carla.session.channels.includes(comum), "a Carla entra sozinha, pelo cartão", 30_000)
    await esperarAsSalas(carla, comum, "a sala chega à Carla pelo Bruno")
    expect(doBruno()).toBeGreaterThan(0)

    // Authority does not pass through someone who lacks it: Bruno does not
    // republish someone else's founding, and becomes owner in nobody's eyes.
    expect(carla.session.founderOf(comum)).not.toBe(bruno.address)
    expect(bruno.session.founderOf(comum)).toBe(ana.address)
  }, 120_000)

  it("na sala comum, quem entra com a casa vazia recebe as salas do primeiro membro sem cargo que se liga", async () => {
    const servidor = await servidorDoCaso()
    const [ana, bruno] = await duasContas(servidor)
    const comum = await salaComumArrumada(servidor, ana, bruno)

    // The house is empty: it is the small hours, and it is the newcomer's phone.
    ana.session.disconnect()
    bruno.session.disconnect()
    bruno.session.antiEntropiaLigada = false
    const carla = await carlaChega(servidor, (c) => (c.session.antiEntropiaLigada = false))
    await carla.session.ensureCommonRoom()
    await ate(() => carla.session.channels.includes(comum), "a Carla entra sozinha", 30_000)

    // Bruno, who is not an admin, connects. Ana stays offline.
    await bruno.session.connect()
    await esperarAsSalas(carla, comum, "a sala chega à Carla pelo Bruno, quando ele se liga")
    expect(carla.session.founderOf(comum)).not.toBe(bruno.address)
  }, 120_000)

  it("entra por link, admitido por um membro sem cargo, com o administrador desligado e sem relatos nem revezamento: salas e fundador em menos de 1 s", async () => {
    const servidor = await servidorDoCaso()
    const [ana, bruno] = await duasContas(servidor)
    const canal = await canalComTodos(servidor, ana, [bruno])
    await ana.session.upsertCategory(canal, { category: "Adega", position: 1 })
    await ana.session.upsertRoom(canal, { room: "prensa", name: "prensa", category: "Adega" })
    // Bruno only invites: he does not arrange the channel or manage roles, so his cascade carries nothing.
    await ana.session.defineRole(canal, { role: "porteiro", name: "Porteiro", powers: ["convidar"] })
    await ana.session.assignRoles(canal, bruno.address, ["porteiro"])
    await ate(() => bruno.session.rolesFor(canal, bruno.address).includes("porteiro") && nomesDasSalas(bruno, canal).includes("prensa"), "o Bruno é porteiro e tem as salas")
    expect(bruno.session.mayEditChannel(canal)).toBe(false)
    const link = await bruno.session.createInvite(canal)

    ana.session.disconnect()
    bruno.session.antiEntropiaLigada = false
    const revezamento = Session.REVEZAMENTO_DAS_SALAS_MS
    Session.REVEZAMENTO_DAS_SALAS_MS = { de: 2_000_000_000, ate: 2_000_000_000 }
    try {
      const carla = await carlaChega(servidor, (c) => (c.session.antiEntropiaLigada = false))
      await carla.session.redeemInvite(link)
      await ate(() => carla.session.channels.includes(canal), "a Carla entra pelo link")
      const entrou = Date.now()
      const espera = await ate(
        () => nomesDasSalas(carla, canal).includes("prensa") && carla.session.founderOf(canal) === ana.address,
        "as salas e o fundador chegam à Carla, pelo retrato do Welcome",
        1_000,
        10,
      )
      expect(Date.now() - entrou).toBeLessThan(1_000)
      expect(espera).toBeLessThan(1_000)
      expect(carla.session.categoriesOf(canal).map((c) => c.category)).toContain("Adega")
      expect(carla.session.rolesFor(canal, bruno.address)).toEqual(["porteiro"])
    } finally {
      Session.REVEZAMENTO_DAS_SALAS_MS = revezamento
    }
  }, 120_000)

  it("com o administrador ligado, os membros não repetem as salas: ele já as disse", async () => {
    const servidor = await servidorDoCaso()
    const [ana, bruno] = await duasContas(servidor)
    const comum = await salaComumArrumada(servidor, ana, bruno)

    const doBruno = contarSalasQueSaem(bruno, comum)
    const carla = await carlaChega(servidor)
    await carla.session.ensureCommonRoom()
    await ate(() => carla.session.channels.includes(comum), "a Carla entra", 30_000)
    await esperarAsSalas(carla, comum, "a sala chega à Carla")
    // Bruno's fallback waits at most `REVEZAMENTO_DAS_SALAS_MS.ate`, plus margin.
    await new Promise((resolve) => setTimeout(resolve, Session.REVEZAMENTO_DAS_SALAS_MS.ate + 2_000))
    expect(doBruno()).toBe(0)
  }, 120_000)
})

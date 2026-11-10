import { fromBase64, generateIdentity, moradaDeSala, toBase64, type Payload } from "@enclave/protocol"
import { addMembers, createChannel, generateKeyPackages, joinChannelExternally, publishableGroupInfo } from "@enclave/crypto"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  ate,
  Cliente,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"
import { conviteComProva } from "../testes/convite-com-prova.js"
import { Gateway } from "./gateway.js"

/**
 * INV-01 (external audit of 1.1.0, addendum of 3/11/2026): a redeemed invite
 * gave a permanent seat on the server before MLS admission.
 *
 * `invite.redeem` did `connection.channels.add` and `store.subscribe` right after
 * consuming the use, before any member accepted or sent the Welcome. Whoever held
 * the connection received the live ciphertext, could read the history and write
 * to the channel, even if no one admitted them. In the common room, `channel.groupinfo.take`
 * gave a seat in memory that the following `channel.subscribe` wrote to disk,
 * with no commit.
 *
 * Redemption is now a PENDING REQUEST: the server delivers it to the members and
 * waits. The seat comes only from proof of admission: for an invite, the Welcome
 * addressed to this account, sent by someone with a seat in the channel (the proof
 * that `#isSeated` already accepted, and that the client uses on join); in the
 * common room, this connection's external commit, accepted as the epoch's commit.
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

/** An opaque application frame: the server does not read it. */
const cifra = (): string => toBase64(crypto.getRandomValues(new Uint8Array(64)))

/** A real MLS key package from the account, as the client sends it in redemption. */
async function pacoteDe(identidade: ReturnType<typeof generateIdentity>): Promise<Awaited<ReturnType<typeof generateKeyPackages>>[number]> {
  const [pacote] = await generateKeyPackages(identidade, 1)
  if (!pacote) throw new Error("sem key package")
  return pacote
}

/** The first publication of a private channel by `dono`, with a real MLS group and a frame inside. */
async function canalPrivado(dono: Cliente, idDono: ReturnType<typeof generateIdentity>): Promise<{ canal: string; grupo: Awaited<ReturnType<typeof createChannel>> }> {
  const canal = moradaDeSala(servidor.casa)
  const grupo = await createChannel(idDono, canal)
  dono.enviar({ t: "channel.subscribe", channels: [canal] })
  dono.enviar({ t: "channel.send", channel: canal, kind: "application", ciphertext: cifra() })
  await dono.proximoDe("channel.event")
  return { canal, grupo }
}

/** Did this client get a Welcome for this channel? Only the Welcome: nothing else should reach it. */
async function welcomeDe(cliente: Cliente, canal: string): Promise<boolean> {
  for (let i = 0; i < 10; i++) {
    const frame = await cliente.proximoDe("channel.event")
    if (frame.channel === canal && frame.kind === "welcome") return true
  }
  return false
}

const paginas = (frames: { t: string }[]): unknown[] => frames.filter((f) => f.t === "channel.backfill.page")

describe("INV-01: o resgate de um convite é um pedido, e não um lugar", () => {
  it("quem resgata e nunca é admitido não lê, não ouve e não escreve no canal", async () => {
    const idDono = generateIdentity(servidor.casa)
    const idIntruso = generateIdentity(servidor.casa)
    const dono = await Cliente.ligar(servidor.url, idDono)
    const { canal } = await canalPrivado(dono, idDono)

    const convite = conviteComProva()
    dono.enviar({ t: "invite.create", channel: canal, ...convite.criar, expiresAt: null, maxUses: null })
    await dono.proximoDe("invite.created")

    const intruso = await Cliente.ligar(servidor.url, idIntruso)
    intruso.enviar(convite.resgate(idIntruso.address, toBase64((await pacoteDe(idIntruso)).wire)))
    // The request reaches the members, which is the server's job.
    expect((await dono.proximoDe("invite.request")).address).toBe(idIntruso.address)

    // No one admits. The intruder tries to subscribe, read and write.
    intruso.enviar({ t: "channel.subscribe", channels: [canal] })
    intruso.enviar({ t: "channel.backfill", channel: canal, limit: 50 })
    intruso.enviar({ t: "channel.send", channel: canal, kind: "application", ciphertext: cifra(), ref: "lixo" })
    const doIntruso = await intruso.ateAoPong()
    expect(paginas(doIntruso)).toEqual([])
    expect(doIntruso).toContainEqual(expect.objectContaining({ t: "channel.rejected", channel: canal, reason: "no-seat" }))

    // The ciphertext the owner sends next does not reach them live.
    dono.enviar({ t: "channel.send", channel: canal, kind: "application", ciphertext: cifra() })
    await dono.proximoDe("channel.event")
    expect((await intruso.ateAoPong()).filter((f) => f.t === "channel.event")).toEqual([])

    // Nor on a new socket: nothing was written to disk.
    intruso.fechar()
    const outra = await Cliente.ligar(servidor.url, idIntruso)
    outra.enviar({ t: "channel.backfill", channel: canal, limit: 50 })
    expect(paginas(await outra.ateAoPong())).toEqual([])
    expect(servidor.enclave.store.isSubscribed(canal, idIntruso.address)).toBe(false)
    outra.fechar()
    dono.fechar()
  })

  it("o Welcome dirigido de um membro é a prova: a partir dele, quem resgatou subscreve e lê", async () => {
    const idDono = generateIdentity(servidor.casa)
    const idConvidado = generateIdentity(servidor.casa)
    const dono = await Cliente.ligar(servidor.url, idDono)
    const { canal, grupo } = await canalPrivado(dono, idDono)

    const convite = conviteComProva()
    dono.enviar({ t: "invite.create", channel: canal, ...convite.criar, expiresAt: null, maxUses: 1 })
    await dono.proximoDe("invite.created")

    const convidado = await Cliente.ligar(servidor.url, idConvidado)
    const pacote = await pacoteDe(idConvidado)
    convidado.enviar(convite.resgate(idConvidado.address, toBase64(pacote.wire)))
    const pedido = await dono.proximoDe("invite.request")

    // The owner admits with real MLS: the commit, and the addressed Welcome.
    const admissao = await addMembers(grupo, [pacote.publicPackage])
    expect(pedido.keyPackage).toBe(toBase64(pacote.wire))
    dono.enviar({ t: "channel.send", channel: canal, kind: "handshake", ciphertext: toBase64(admissao.commit) })
    await dono.proximoDe("channel.event")
    if (!admissao.welcome) throw new Error("sem Welcome")
    dono.enviar({ t: "channel.send", channel: canal, kind: "welcome", ciphertext: toBase64(admissao.welcome), recipient: idConvidado.address })

    // The Welcome reaches them without a subscription, and the seat comes with it.
    expect(await welcomeDe(convidado, canal)).toBe(true)
    convidado.enviar({ t: "channel.subscribe", channels: [canal] })
    convidado.enviar({ t: "channel.backfill", channel: canal, limit: 50 })
    expect(paginas(await convidado.ateAoPong())).toHaveLength(1)
    expect(servidor.enclave.store.isSubscribed(canal, idConvidado.address)).toBe(true)
    convidado.fechar()
    dono.fechar()
  })
})

describe("INV-01: na sala comum, levantar o cartão não é entrar", () => {
  /**
   * A server just for the test, with the common room founded by a client with
   * real MLS and the card posted. The card is single use: each test gets its own.
   */
  async function salaComCartao(): Promise<{ srv: ServidorDeTeste; fundador: Cliente }> {
    const srv = await levantarServidor()
    const idFundador = generateIdentity(srv.casa)
    const fundador = await Cliente.ligar(srv.url, idFundador)
    fundador.enviar({ t: "channel.subscribe", channels: [srv.sala] })
    fundador.enviar({ t: "channel.send", channel: srv.sala, kind: "application", ciphertext: cifra() })
    await fundador.proximoDe("channel.event")
    const grupo = await createChannel(idFundador, srv.sala)
    fundador.enviar({ t: "channel.groupinfo.put", channel: srv.sala, info: toBase64(await publishableGroupInfo(grupo)) })
    await fundador.ateAoPong()
    expect(srv.enclave.store.hasGroupInfo(srv.sala)).toBe(true)
    return { srv, fundador }
  }

  it("quem levanta o cartão e não faz o commit não subscreve, não lê e não escreve", async () => {
    const { srv, fundador } = await salaComCartao()
    const sala = srv.sala
    const idIntruso = generateIdentity(srv.casa)
    const intruso = await Cliente.ligar(srv.url, idIntruso)
    intruso.enviar({ t: "channel.groupinfo.take", channel: sala })
    expect((await intruso.proximoDe("channel.groupinfo")).info).toBeDefined()

    intruso.enviar({ t: "channel.subscribe", channels: [sala] })
    intruso.enviar({ t: "channel.backfill", channel: sala, limit: 50 })
    intruso.enviar({ t: "channel.send", channel: sala, kind: "application", ciphertext: cifra(), ref: "lixo" })
    const frames = await intruso.ateAoPong()
    expect(paginas(frames)).toEqual([])
    expect(frames).toContainEqual(expect.objectContaining({ t: "channel.rejected", channel: sala, reason: "no-seat" }))

    intruso.fechar()
    const outra = await Cliente.ligar(srv.url, idIntruso)
    outra.enviar({ t: "channel.backfill", channel: sala, limit: 50 })
    expect(paginas(await outra.ateAoPong())).toEqual([])
    expect(srv.enclave.store.isSubscribed(sala, idIntruso.address)).toBe(false)
    outra.fechar()
    fundador.fechar()
    await srv.fechar()
  })

  it("o lugar temporário caduca: o commit externo depois do prazo já não entra", async () => {
    const { srv, fundador } = await salaComCartao()
    const sala = srv.sala
    const idQuemChega = generateIdentity(srv.casa)
    const quemChega = await Cliente.ligar(srv.url, idQuemChega)
    const prazo = Gateway.LUGAR_TEMPORARIO_MS
    Gateway.LUGAR_TEMPORARIO_MS = 50
    try {
      quemChega.enviar({ t: "channel.groupinfo.take", channel: sala })
      const cartao = await quemChega.proximoDe("channel.groupinfo")
      if (!cartao.info) throw new Error("sem cartão")
      const pacote = await pacoteDe(idQuemChega)
      const externa = await joinChannelExternally(sala, fromBase64(cartao.info), pacote.publicPackage, pacote.privatePackage)
      await new Promise((resolve) => setTimeout(resolve, 120))
      quemChega.enviar({ t: "channel.send", channel: sala, kind: "handshake", ciphertext: toBase64(externa.commit), ref: "tarde" })
      expect(await quemChega.ateAoPong()).toContainEqual(expect.objectContaining({ t: "channel.rejected", reason: "no-seat" }))
      expect(srv.enclave.store.isSubscribed(sala, idQuemChega.address)).toBe(false)
    } finally {
      Gateway.LUGAR_TEMPORARIO_MS = prazo
    }
    quemChega.fechar()
    fundador.fechar()
    await srv.fechar()
  }, 60_000)

  it("o commit externo aceite é a prova: o eco chega, e a subscrição fica", async () => {
    const { srv, fundador } = await salaComCartao()
    const sala = srv.sala
    const idQuemChega = generateIdentity(srv.casa)
    const quemChega = await Cliente.ligar(srv.url, idQuemChega)
    quemChega.enviar({ t: "channel.groupinfo.take", channel: sala })
    const cartao = await quemChega.proximoDe("channel.groupinfo")
    if (!cartao.info) throw new Error("sem cartão")
    const pacote = await pacoteDe(idQuemChega)
    const externa = await joinChannelExternally(sala, fromBase64(cartao.info), pacote.publicPackage, pacote.privatePackage)
    quemChega.enviar({ t: "channel.send", channel: sala, kind: "handshake", ciphertext: toBase64(externa.commit), ref: "entrada" })
    expect((await quemChega.proximoDe("channel.event")).ref).toBe("entrada")

    quemChega.enviar({ t: "channel.subscribe", channels: [sala] })
    quemChega.enviar({ t: "channel.backfill", channel: sala, limit: 50 })
    expect(paginas(await quemChega.ateAoPong())).toHaveLength(1)
    expect(srv.enclave.store.isSubscribed(sala, idQuemChega.address)).toBe(true)
    // And posts the next card, which is what clients do right after.
    quemChega.enviar({ t: "channel.groupinfo.put", channel: sala, info: toBase64(await publishableGroupInfo(externa.session)) })
    await quemChega.ateAoPong()
    expect(srv.enclave.store.hasGroupInfo(sala)).toBe(true)
    quemChega.fechar()
    fundador.fechar()
    await srv.fechar()
  }, 60_000)
})

function mensagem(corpo: string): Payload {
  return { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: corpo, attachments: [], links: [], mentions: [] } as unknown as Payload
}
const leu = (conta: ContaDeTeste, canal: string, corpo: string): boolean =>
  conta.session.history(canal).some((entrada) => entrada.payload["body"] === corpo)

describe("INV-01: os clientes de hoje continuam a entrar (sessões a sério)", () => {
  /*
    One server per test: sessions join the common room on their own when they
    connect, and those from one test left the next test's room waiting for
    someone who had already left.
  */
  let real: ServidorDeTeste
  beforeEach(async () => {
    real = await levantarServidor()
  }, 30_000)
  afterEach(async () => {
    desligarContas(abertas.splice(0))
    await real?.fechar()
  })

  it("por convite: a Bia resgata a ligação da Ana, é admitida, e lê e escreve no canal", async () => {
    const [ana, bia] = (await contasDeTeste(real, ["Ana", "Bia"])) as [ContaDeTeste, ContaDeTeste]
    abertas.push(ana, bia)
    const canal = moradaDeSala(real.casa)
    await ana.session.createSpaceChannel(canal)
    const { longa } = await ana.session.criarConvite(canal)
    await bia.session.redeemInvite(longa)
    await ate(() => bia.session.channels.includes(canal), "a Bia entra no canal", 60_000)
    await ate(() => real.enclave.store.isSubscribed(canal, bia.address), "a subscrição da Bia fica em disco")

    await ana.session.send(canal, mensagem("olá, Bia"))
    await ate(() => leu(bia, canal, "olá, Bia"), "a Bia lê a Ana", 30_000)
    await bia.session.send(canal, mensagem("olá, Ana"))
    await ate(() => leu(ana, canal, "olá, Ana"), "a Ana lê a Bia", 30_000)
  }, 120_000)

  it("pela sala comum: o Rui entra pelo cartão que a Ana deixou, e os dois lêem-se", async () => {
    const [ana] = (await contasDeTeste(real, ["Ana"])) as [ContaDeTeste]
    abertas.push(ana)
    const comum = real.sala
    await ana.session.ensureCommonRoom()
    await ate(() => ana.session.channels.includes(comum), "a Ana está na sala comum", 60_000)
    await ate(() => real.enclave.store.hasGroupInfo(comum), "o cartão está no servidor", 30_000)

    const [rui] = (await contasDeTeste(real, ["Rui"])) as [ContaDeTeste]
    abertas.push(rui)
    await rui.session.ensureCommonRoom()
    await ate(() => rui.session.channels.includes(comum), "o Rui entra na sala comum", 60_000)
    await ate(() => real.enclave.store.isSubscribed(comum, rui.address), "a subscrição do Rui fica em disco")
    // By the card, not by a member: there is no Welcome for Rui.
    expect(real.enclave.store.hasWelcomeFor(comum, rui.address)).toBe(false)

    await ana.session.send(comum, mensagem("bem-vindo, Rui"))
    await ate(() => leu(rui, comum, "bem-vindo, Rui"), "o Rui lê a Ana", 30_000)
    await rui.session.send(comum, mensagem("obrigado, Ana"))
    await ate(() => leu(ana, comum, "obrigado, Ana"), "a Ana lê o Rui", 30_000)
  }, 120_000)
})

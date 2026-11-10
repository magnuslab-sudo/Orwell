import {
  fromBase64,
  generateIdentity,
  parseServerName,
  sign,
  toBase64,
  type ClientFrame,
  type ServerFrame,
  PROTOCOL_VERSION,
  moradaDeSala,
} from "@enclave/protocol"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocket } from "ws"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { conviteComProva } from "../testes/convite-com-prova.js"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"

/**
 * FOUR in a call over SFU, not two.
 *
 * The SFU path was never exercised above two participants: the proofs in
 * `scripts/sfu-prova-fase2/` and `-fase3/` run with a pair, and
 * `scripts/carga-chamada.mjs` measured eight when it was still mesh. The
 * production report (three hearing each other, the fourth forever "connecting"
 * to them) falls exactly in that gap, and the first question to settle is whether
 * the SERVER introduces the fourth to the three.
 *
 * What is measured here is the gateway boundary, nothing more: whoever joins
 * gets the list of who is already there, and whoever produces is announced to
 * ALL the others.
 */

let HOME: ReturnType<typeof parseServerName>
let enclave: Enclave
let dataDir: string
let gatewayUrl: string

class TestClient {
  #socket: WebSocket
  #queue: ServerFrame[] = []
  #waiters: ((frame: ServerFrame) => void)[] = []
  #todos: ServerFrame[] = []

  private constructor(socket: WebSocket) {
    this.#socket = socket
    socket.on("message", (raw: Buffer) => {
      const frame = JSON.parse(raw.toString("utf8")) as ServerFrame
      this.#todos.push(frame)
      const waiter = this.#waiters.shift()
      if (waiter) waiter(frame)
      else this.#queue.push(frame)
    })
  }

  static async connect(url: string): Promise<TestClient> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve())
      socket.once("error", reject)
    })
    return new TestClient(socket)
  }

  send(frame: ClientFrame): void {
    this.#socket.send(JSON.stringify(frame))
  }

  next(): Promise<ServerFrame> {
    const queued = this.#queue.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve) => {
      this.#waiters.push(resolve)
      setTimeout(() => resolve({ t: "error", code: "timeout", message: "no frame", fatal: false }), 4000)
    })
  }

  async nextOf<K extends ServerFrame["t"]>(kind: K): Promise<Extract<ServerFrame, { t: K }>> {
    for (let i = 0; i < 20; i++) {
      const frame = await this.next()
      if (frame.t === kind) return frame as Extract<ServerFrame, { t: K }>
      if (frame.t === "error" && frame.code === "timeout") break
    }
    throw new Error(`never received a ${kind} frame`)
  }

  async sync(): Promise<void> {
    this.send({ t: "ping" })
    await this.nextOf("pong")
  }

  get recebidos(): ServerFrame[] {
    return [...this.#todos]
  }

  close(): void {
    this.#socket.close()
  }
}

async function portoLivre(): Promise<number> {
  const { createSocket } = await import("node:dgram")
  const socket = createSocket("udp4")
  await new Promise<void>((pronto) => socket.bind(0, "127.0.0.1", pronto))
  const porto = socket.address().port
  await new Promise<void>((pronto) => socket.close(() => pronto()))
  return porto
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-sfu4-"))
  const config: ServerConfig = {
    serverName: parseServerName("localhost"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    dataDir,
    databasePath: join(dataDir, "test.sqlite"),
    sfuPort: await portoLivre(),
    sfuAnnouncedIp: "",
    retentionDays: 30,
    allowlist: [],
    turnUrls: [],
    turnSecret: "",
    turnTtl: 600,
    communityMode: false,
    commonRoom: "",
  }
  enclave = await buildServer(config)
  await enclave.app.listen({ host: config.bindHost, port: 0 })
  const port = (enclave.app.server.address() as { port: number }).port
  HOME = parseServerName(`localhost:${port}`)
  config.serverName = HOME
  gatewayUrl = `ws://127.0.0.1:${port}/_enclave/gateway`
})

afterAll(async () => {
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

async function entrar(): Promise<{ client: TestClient; address: string }> {
  const client = await TestClient.connect(gatewayUrl)
  const identity = generateIdentity(HOME)
  // With `commit-after-echo`, like today's clients: without it the server does not
  // accept the Welcome with which the host seats the others (see `sentarPorConvite`).
  client.send({ t: "hello", version: PROTOCOL_VERSION, capabilities: ["commit-after-echo"] })
  await client.nextOf("hello.ok")
  client.send({ t: "auth.begin", address: identity.address, signingKey: toBase64(identity.signingPublicKey) })
  const challenge = await client.nextOf("auth.challenge")
  client.send({ t: "auth.finish", signature: toBase64(sign(identity, fromBase64(challenge.nonce))) })
  await client.nextOf("auth.ok")
  return { client, address: identity.address }
}

// A new opaque address: the 1.0 server no longer creates `!<nome>`.
const novoCanal = (): string => moradaDeSala(HOME)
const ambitoDe = (nome: string): string => createHash("sha256").update(nome).digest("base64url")

async function sentarPorConvite(host: TestClient, guest: { client: TestClient; address: string }, channel: string): Promise<void> {
  // With the code proof, as 1.0 redeems (slice 6a): the hash alone does not get in.
  const convite = conviteComProva()
  host.send({ t: "invite.create", channel, ...convite.criar, expiresAt: null, maxUses: 1 })
  await host.nextOf("invite.created")
  guest.client.send(convite.resgate(guest.address))
  await host.nextOf("invite.request")
  // Redemption is a request, not a seat (INV-01): the seat comes from the
  // targeted Welcome from someone already there, which is what a member sends
  // when admitting.
  host.send({ t: "channel.send", channel, kind: "welcome", ciphertext: toBase64(crypto.getRandomValues(new Uint8Array(64))), recipient: guest.address })
  await guest.client.nextOf("channel.event")
  guest.client.send({ t: "channel.subscribe", channels: [channel] })
  await guest.client.sync()
}

const VOZ = {
  codecs: [
    {
      mimeType: "audio/opus",
      payloadType: 100,
      clockRate: 48000,
      channels: 2,
      parameters: { usedtx: 1 },
      rtcpFeedback: [],
    },
  ],
  headerExtensions: [],
  encodings: [{ ssrc: 0 }],
  rtcp: { cname: "teste" },
}

/** The capabilities the client claims to have, for the router's `canConsume` to match. */
const CAPACIDADES = {
  codecs: [
    {
      kind: "audio",
      mimeType: "audio/opus",
      preferredPayloadType: 100,
      clockRate: 48000,
      channels: 2,
      rtcpFeedback: [],
      parameters: {},
    },
  ],
  headerExtensions: [],
}

describe("uma chamada de voz a QUATRO, pelo gateway", () => {
  it("o quarto a entrar é apresentado aos TRÊS que já lá estavam", async () => {
    const gente = [await entrar(), await entrar(), await entrar(), await entrar()]
    const anfitriao = gente[0]!
    const convidados = gente.slice(1)
    const canal = novoCanal()
    const escopo = ambitoDe("voz")

    anfitriao.client.send({ t: "channel.subscribe", channels: [canal] })
    await anfitriao.client.sync()
    for (const quem of convidados) {
      await sentarPorConvite(anfitriao.client, quem, canal)
      quem.client.send({ t: "channel.subscribe", channels: [canal] })
      await quem.client.sync()
    }

    // The first three set up the entire call: they join, bring up both
    // transports, and put voice on the air. This is the state the owner described (three
    // hearing each other) before the fourth arrives.
    const transportes = new Map<string, { envio: string; recepcao: string }>()
    const produtores = new Map<string, string>()

    const montar = async (quem: (typeof gente)[number], ssrc: number): Promise<void> => {
      quem.client.send({ t: "sfu.scope.join", channel: canal, scope: escopo })
      const entrada = await quem.client.nextOf("sfu.scope.joined")

      quem.client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "envio" })
      const envio = await quem.client.nextOf("sfu.transport.created")
      quem.client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "recepcao" })
      const recepcao = await quem.client.nextOf("sfu.transport.created")
      transportes.set(quem.address, { envio: envio.transport, recepcao: recepcao.transport })

      quem.client.send({
        t: "sfu.produce",
        transport: envio.transport,
        kind: "audio",
        rtpParameters: { ...VOZ, encodings: [{ ssrc }] },
        fonte: "microfone",
      })
      const produzido = await quem.client.nextOf("sfu.produced")
      produtores.set(quem.address, produzido.producer)

      // And it consumes whoever was already there, which is what `entrar` in `MotorSfu`
      // does with the list that `scope.joined` brought.
      for (const outro of entrada.producers) {
        quem.client.send({
          t: "sfu.consume",
          transport: recepcao.transport,
          producer: outro.id,
          rtpCapabilities: CAPACIDADES,
        })
        await quem.client.nextOf("sfu.consumed")
      }
    }

    for (const [indice, quem] of gente.slice(0, 3).entries()) await montar(quem, 100_000 + indice)

    // The fourth. The question is two-fold: does he see the three, and do the three see him?
    const quarto = gente[3]!
    quarto.client.send({ t: "sfu.scope.join", channel: canal, scope: escopo })
    const entradaDoQuarto = await quarto.client.nextOf("sfu.scope.joined")

    expect(entradaDoQuarto.producers).toHaveLength(3)
    expect(new Set(entradaDoQuarto.producers.map((cada) => cada.address))).toEqual(
      new Set(gente.slice(0, 3).map((cada) => cada.address)),
    )

    quarto.client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "envio" })
    const envioDoQuarto = await quarto.client.nextOf("sfu.transport.created")
    quarto.client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "recepcao" })
    const recepcaoDoQuarto = await quarto.client.nextOf("sfu.transport.created")

    quarto.client.send({
      t: "sfu.produce",
      transport: envioDoQuarto.transport,
      kind: "audio",
      rtpParameters: { ...VOZ, encodings: [{ ssrc: 100_003 }] },
      fonte: "microfone",
    })
    const produzidoPeloQuarto = await quarto.client.nextOf("sfu.produced")

    // The three must receive the announcement, and must be able to consume it. This is
    // where "connecting" starts or not: no consumer means no flow, and no flow means the
    // card keeps saying the person is connecting forever.
    for (const quem of gente.slice(0, 3)) {
      // The full log, not the queue: the announcements from the second and third
      // are still waiting to be consumed, and a `nextOf` would deliver the first one.
      await quem.client.sync()
      const anuncio = quem.client.recebidos.find(
        (frame) => frame.t === "sfu.producer.new" && frame.producer === produzidoPeloQuarto.producer,
      )
      expect(anuncio, `${quem.address} não soube do fluxo do quarto`).toBeDefined()
      expect(anuncio && "address" in anuncio ? anuncio.address : null).toBe(quarto.address)

      quem.client.send({
        t: "sfu.consume",
        transport: transportes.get(quem.address)!.recepcao,
        producer: produzidoPeloQuarto.producer,
        rtpCapabilities: CAPACIDADES,
      })
      const consumido = await quem.client.nextOf("sfu.consumed")
      expect(consumido.producer).toBe(produzidoPeloQuarto.producer)
    }

    // And the fourth consumes all three.
    for (const outro of entradaDoQuarto.producers) {
      quarto.client.send({
        t: "sfu.consume",
        transport: recepcaoDoQuarto.transport,
        producer: outro.id,
        rtpCapabilities: CAPACIDADES,
      })
      const consumido = await quarto.client.nextOf("sfu.consumed")
      expect(consumido.producer).toBe(outro.id)
    }

    for (const quem of gente) quem.client.close()
  }, 60_000)

  /**
   * Rejoin the same call, which is what `#join` in `call.ts` does on its own.
   *
   * Joining a call while already in one starts by leaving the previous one, and the
   * leave does not wait for any response: `sfuSairDoAmbito` sends the frame and moves on.
   * Both frames leave through the same socket an instant apart, and the
   * gateway dispatches each frame with a `void this.#dispatch(...)`, with no queue
   * between them.
   *
   * What this measures is the end state: after both, this connection MUST be in the
   * call. Missing it is the costliest failure at this layer, because nobody can see
   * it: a connection outside the scope still produces (the engine does not
   * check that list), but its `sfu.producer.new` is announced to nobody and no
   * announcement from the others reaches it. It stays "connecting" for everyone and
   * everyone stays "connecting" for it.
   */
  it("sair e voltar a entrar no mesmo âmbito, sem esperar pela saída, deixa a ligação DENTRO", async () => {
    const dono = await entrar()
    const par = await entrar()
    const canal = novoCanal()
    const escopo = ambitoDe("voz")

    dono.client.send({ t: "channel.subscribe", channels: [canal] })
    await dono.client.sync()
    await sentarPorConvite(dono.client, par, canal)
    par.client.send({ t: "channel.subscribe", channels: [canal] })
    await par.client.sync()

    for (const quem of [dono, par]) {
      quem.client.send({ t: "sfu.scope.join", channel: canal, scope: escopo })
      await quem.client.nextOf("sfu.scope.joined")
    }

    // The rejoin, as the client does it: the leave and the join in a burst.
    par.client.send({ t: "sfu.scope.leave", channel: canal, scope: escopo })
    par.client.send({ t: "sfu.scope.join", channel: canal, scope: escopo })
    await par.client.nextOf("sfu.scope.joined")
    await par.client.sync()

    // And proof that it really is inside: a transport can only be created in a call
    // it joined, and a flow from the other only reaches a connection that is in it.
    par.client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "envio", ref: "r1" })
    const transporte = await par.client.nextOf("sfu.transport.created")
    expect(transporte.transport).toBeTruthy()

    dono.client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "envio" })
    const doDono = await dono.client.nextOf("sfu.transport.created")
    dono.client.send({
      t: "sfu.produce",
      transport: doDono.transport,
      kind: "audio",
      rtpParameters: { ...VOZ, encodings: [{ ssrc: 200_001 }] },
      fonte: "microfone",
    })
    const produzido = await dono.client.nextOf("sfu.produced")

    await par.client.sync()
    const anuncio = par.client.recebidos.find(
      (frame) => frame.t === "sfu.producer.new" && frame.producer === produzido.producer,
    )
    expect(anuncio, "quem reentrou não soube do fluxo de quem já lá estava").toBeDefined()

    dono.client.close()
    par.client.close()
  }, 60_000)
})

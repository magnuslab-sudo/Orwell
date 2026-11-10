import {
  fromBase64,
  generateIdentity,
  parseServerName,
  sign,
  toBase64,
  type ClientFrame,
  type ServerFrame,
  CAPACIDADE_SFU,
  CAPACIDADE_SFU_FOTOGRAMA_CHAVE,
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
import { Gateway } from "./gateway.js"

/**
 * The `sfu.*` frames end-to-end, against a real gateway and worker.
 *
 * The suite exists separate from `gateway.test.ts` for a practical reason: this is the
 * only test server that spins up a media subprocess, and it is not worth imposing it on
 * the hundreds of tests that do not touch it.
 *
 * **What is being proven here is not mediasoup**, that is `media.test.ts`.
 * It is the sentence in the plan that says who decides: "who admits is still the gateway
 * and the MLS tree; the SFU has NO model of its own for membership. Nobody produces or
 * consumes in a scope that `#mayReach` would not grant them access to." An SFU that
 * decided on its own who enters would be a second membership list alongside the MLS
 * tree, and divergence between the two is the kind of fault this product cannot have,  * it is the documented reason why LiveKit was rejected.
 *
 * Real round-trip, not hand-assembled format: frames leave through a socket, cross the
 * gateway's Zod, the `#mayReach`, the motor, and come back.
 */

let HOME: ReturnType<typeof parseServerName>
let enclave: Enclave
let dataDir: string
let gatewayUrl: string

class TestClient {
  #socket: WebSocket
  #queue: ServerFrame[] = []
  #waiters: ((frame: ServerFrame) => void)[] = []

  /**
   * Everything that ever arrived, apart from the queue.
   *
   * The queue is consumed, and `nextOf` DISCARDS up to ten frames looking for what it
   * wants. A test that claims "this did not arrive" by looking at the queue is claiming
   * "this did not arrive, or it arrived and was thrown away looking for the pong", which
   * is not the same thing. It cost an uncaught mutation: with the announcement going to
   * everyone, the test stayed green because `sync()` had consumed the evidence.
   */
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
    for (let i = 0; i < 10; i++) {
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

  /** Everything that arrived from the start, consumed or not. See `#todos`. */
  get recebidos(): ServerFrame[] {
    return [...this.#todos]
  }

  close(): void {
    this.#socket.close()
  }
}

/**
 * A free UDP port, requested from the system and returned.
 *
 * You cannot use `sfuPort: 0` here, and the reason is the design itself: **zero
 * means "no SFU"**, and `app.ts` does not even spin up the motor. This is how this suite
 * failed on the first run, with nine tests saying `no-sfu`, the configuration working
 * exactly as written.
 *
 * So a real port remains, but chosen by the system instead of fixed by hand: a fixed
 * number here would bring back the EADDRINUSE that `bindPort: 0` in `gateway.test.ts`
 * already documents, made worse because the worker is a subprocess that does not die
 * with the suite that forgot it.
 */
async function portoLivre(): Promise<number> {
  const { createSocket } = await import("node:dgram")
  const socket = createSocket("udp4")
  await new Promise<void>((pronto) => socket.bind(0, "127.0.0.1", pronto))
  const porto = socket.address().port
  await new Promise<void>((pronto) => socket.close(() => pronto()))
  return porto
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-sfu-"))
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

/** A group channel, opaque address, that nobody has created yet. */
const novoCanal = (): string => moradaDeSala(HOME)

/**
 * The scope summary, as the client will calculate it.
 *
 * Forty-three base64url characters, the schema requires the exact form of a SHA-256,
 * so that a room name cannot travel here by accident.
 */
const ambitoDe = (nome: string): string => createHash("sha256").update(nome).digest("base64url")

async function sentarPorConvite(host: TestClient, guest: { client: TestClient; address: string }, channel: string): Promise<void> {
  // With the code proof, like 1.0 redeems (slice 6a): the hash alone does not work.
  const convite = conviteComProva()
  host.send({ t: "invite.create", channel, ...convite.criar, expiresAt: null, maxUses: 1 })
  await host.nextOf("invite.created")
  guest.client.send(convite.resgate(guest.address))
  await host.nextOf("invite.request")
  // Redemption is a request, not a seat (INV-01): the seat comes from the
  // directed Welcome from someone already there, which is what a member sends
  // when admitting.
  host.send({ t: "channel.send", channel, kind: "welcome", ciphertext: toBase64(crypto.getRandomValues(new Uint8Array(64))), recipient: guest.address })
  await guest.client.nextOf("channel.event")
  guest.client.send({ t: "channel.subscribe", channels: [channel] })
  await guest.client.sync()
}

describe("a capacidade", () => {
  /**
   * Announcing a capability is a PROMISE.
   *
   * The client who hears it stops building the mesh and starts negotiating with an SFU;
   * if there is no worker on the other side, nobody connects to nobody and the failure
   * shows up in the call, far from the line that lied. Here there is a worker, so the
   * promise is true, the only circumstance under which it can go out.
   */
  it("aparece no hello.ok quando há motor de pé", async () => {
    const client = await TestClient.connect(gatewayUrl)
    client.send({ t: "hello", version: PROTOCOL_VERSION })
    const hello = await client.nextOf("hello.ok")
    expect(hello.capabilities).toContain(CAPACIDADE_SFU)
    client.close()
  })
})

describe("quem admite é o gateway", () => {
  /**
   * **The central test of this phase.**
   *
   * An authenticated account that was never admitted to the channel asks to join its
   * call. The media motor has no way to know it does not belong there, it does not
   * know what a channel is. Who tells it no is `#mayReach`, the same guard that protects
   * the history and the live cipher, and that is what keeps the SFU from being a second
   * gate into a private channel.
   */
  it("recusa a chamada de um canal onde a conta não tem lugar", async () => {
    const dono = await entrar()
    const canal = novoCanal()
    // The owner creates the channel, which now has an owner and is no longer virgin.
    dono.client.send({ t: "channel.subscribe", channels: [canal] })
    await dono.client.sync()
    dono.client.send({ t: "channel.send", channel: canal, kind: "application", ciphertext: "b2lh" })
    await dono.client.nextOf("channel.event")

    const estranho = await entrar()
    estranho.client.send({ t: "sfu.scope.join", channel: canal, scope: ambitoDe("geral") })
    const recusa = await estranho.client.nextOf("sfu.error")
    expect(recusa.code).toBe("sem-lugar")

    dono.client.close()
    estranho.client.close()
  })

  it("deixa entrar quem tem lugar, e diz-lhe com o que a chamada fala", async () => {
    const dono = await entrar()
    const canal = novoCanal()
    dono.client.send({ t: "channel.subscribe", channels: [canal] })
    await dono.client.sync()

    dono.client.send({ t: "sfu.scope.join", channel: canal, scope: ambitoDe("geral"), ref: "r1" })
    const entrada = await dono.client.nextOf("sfu.scope.joined")
    expect(entrada.ref).toBe("r1")
    expect(entrada.producers).toEqual([])
    // The router capabilities are what the client's `device.load()` needs.
    const capacidades = entrada.rtpCapabilities as { codecs?: { mimeType: string }[] }
    expect(capacidades.codecs?.some((codec) => codec.mimeType.toLowerCase() === "audio/opus")).toBe(true)

    dono.client.close()
  })

  it("recusa um transporte a quem não entrou na chamada", async () => {
    const dono = await entrar()
    const canal = novoCanal()
    dono.client.send({ t: "channel.subscribe", channels: [canal] })
    await dono.client.sync()

    dono.client.send({ t: "sfu.transport.create", channel: canal, scope: ambitoDe("geral"), direction: "envio" })
    const recusa = await dono.client.nextOf("sfu.error")
    expect(recusa.code).toBe("fora-da-chamada")

    dono.client.close()
  })

  it("dá um transporte a quem entrou, com candidatos ICE", async () => {
    const dono = await entrar()
    const canal = novoCanal()
    dono.client.send({ t: "channel.subscribe", channels: [canal] })
    await dono.client.sync()
    dono.client.send({ t: "sfu.scope.join", channel: canal, scope: ambitoDe("geral") })
    await dono.client.nextOf("sfu.scope.joined")

    dono.client.send({ t: "sfu.transport.create", channel: canal, scope: ambitoDe("geral"), direction: "envio", ref: "t1" })
    const criado = await dono.client.nextOf("sfu.transport.created")
    expect(criado.ref).toBe("t1")
    expect(criado.direction).toBe("envio")
    expect(criado.transport).toBeTruthy()
    expect((criado.iceCandidates as unknown[]).length).toBeGreaterThan(0)

    dono.client.close()
  })
})

describe("a separação entre canais", () => {
  /**
   * **The scope is chosen by the client, so it cannot be the key.**
   *
   * Two people on DIFFERENT channels send exactly the same scope digest.
   * If the router key were just the digest, both would land on the same
   * router and hear each other-one would join a call on a channel where it was
   * never admitted, without forging anything and without breaking any encryption.
   * The key is the PAIR `(canal, âmbito)`, and that is what this test measures: the
   * stream of one does not appear to the other.
   */
  it("não junta dois canais que mandem o mesmo âmbito", async () => {
    const primeiro = await entrar()
    const segundo = await entrar()
    const canalA = novoCanal()
    const canalB = novoCanal()
    const mesmoAmbito = ambitoDe("geral")

    primeiro.client.send({ t: "channel.subscribe", channels: [canalA] })
    segundo.client.send({ t: "channel.subscribe", channels: [canalB] })
    await primeiro.client.sync()
    await segundo.client.sync()

    primeiro.client.send({ t: "sfu.scope.join", channel: canalA, scope: mesmoAmbito })
    await primeiro.client.nextOf("sfu.scope.joined")

    // **The first MUST produce**, otherwise this test measures nothing: an empty producer
    // list is what you see both in two separate calls and in one call where nobody spoke.
    // This is how it passed with the router key reduced to scope, the `scope-without-channel`
    // mutation caught it.
    primeiro.client.send({ t: "sfu.transport.create", channel: canalA, scope: mesmoAmbito, direction: "envio" })
    const transporte = await primeiro.client.nextOf("sfu.transport.created")
    primeiro.client.send({
      t: "sfu.produce",
      transport: transporte.transport,
      kind: "audio",
      rtpParameters: {
        codecs: [
          { mimeType: "audio/opus", payloadType: 100, clockRate: 48000, channels: 2, parameters: {}, rtcpFeedback: [] },
        ],
        headerExtensions: [],
        encodings: [{ ssrc: 515151 }],
        rtcp: { cname: "teste" },
      },
    })
    await primeiro.client.nextOf("sfu.produced")

    segundo.client.send({ t: "sfu.scope.join", channel: canalB, scope: mesmoAmbito })
    const entradaB = await segundo.client.nextOf("sfu.scope.joined")

    // The second joins an EMPTY call, even though the first is already there speaking with
    // the same scope: they are different calls because the channels are different.
    expect(entradaB.producers).toEqual([])
    // And does not hear any announcement of anything happening in the other channel's call.
    await segundo.client.sync()
    expect(segundo.client.recebidos.some((frame) => frame.t === "sfu.producer.new")).toBe(false)

    primeiro.client.close()
    segundo.client.close()
  })

  /** And within the SAME channel, two rooms are still two calls. */
  it("não junta duas salas do mesmo canal", async () => {
    const dono = await entrar()
    const canal = novoCanal()
    dono.client.send({ t: "channel.subscribe", channels: [canal] })
    await dono.client.sync()

    dono.client.send({ t: "sfu.scope.join", channel: canal, scope: ambitoDe("sala-1") })
    const primeira = await dono.client.nextOf("sfu.scope.joined")
    dono.client.send({ t: "sfu.scope.join", channel: canal, scope: ambitoDe("sala-2") })
    const segunda = await dono.client.nextOf("sfu.scope.joined")

    expect(primeira.scope).not.toBe(segunda.scope)
    expect(segunda.producers).toEqual([])

    dono.client.close()
  })
})

describe("os anúncios", () => {
  /**
   * Whoever is already in the call learns that someone started speaking; whoever is not,
   * does not. The announcement carries the ADDRESS, not the MLS leaf index, because the
   * server does not read the tree and will never know the index, matching address to
   * leaf is the client's job, because they have the encrypted roster.
   */
  it("diz aos outros da chamada que há fluxo novo, e só a esses", async () => {
    const dono = await entrar()
    const par = await entrar()
    const defora = await entrar()
    const canal = novoCanal()
    const escopo = ambitoDe("geral")

    dono.client.send({ t: "channel.subscribe", channels: [canal] })
    await dono.client.sync()
    await sentarPorConvite(dono.client, par, canal)
    par.client.send({ t: "channel.subscribe", channels: [canal] })
    await par.client.sync()

    for (const quem of [dono, par]) {
      quem.client.send({ t: "sfu.scope.join", channel: canal, scope: escopo })
      await quem.client.nextOf("sfu.scope.joined")
    }

    dono.client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "envio" })
    const transporte = await dono.client.nextOf("sfu.transport.created")

    dono.client.send({
      t: "sfu.produce",
      transport: transporte.transport,
      kind: "audio",
      rtpParameters: {
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
        encodings: [{ ssrc: 424242 }],
        rtcp: { cname: "teste" },
      },
    })
    const produzido = await dono.client.nextOf("sfu.produced")

    const anuncio = await par.client.nextOf("sfu.producer.new")
    expect(anuncio.producer).toBe(produzido.producer)
    expect(anuncio.address).toBe(dono.address)
    expect(anuncio.channel).toBe(canal)

    // Whoever is not in the call heard nothing. The `sync` just gives the server a chance
    // to have sent something; proof is the full log, which `nextOf` does not consume.
    await defora.client.sync()
    expect(defora.client.recebidos.some((frame) => frame.t === "sfu.producer.new")).toBe(false)

    dono.client.close()
    par.client.close()
    defora.client.close()
  })

  /**
   * The NORMAL path out of a call is the socket dropping, not a `sfu.scope.leave`,    * a closed tab sends no frame. If `#drop` did not release the media, the others would
   * see the person in the call forever and the worker would keep their transports.
   */
  it("diz que o fluxo acabou quando a ligação cai", async () => {
    const dono = await entrar()
    const par = await entrar()
    const canal = novoCanal()
    const escopo = ambitoDe("geral")

    dono.client.send({ t: "channel.subscribe", channels: [canal] })
    await dono.client.sync()
    await sentarPorConvite(dono.client, par, canal)
    par.client.send({ t: "channel.subscribe", channels: [canal] })
    await par.client.sync()

    for (const quem of [dono, par]) {
      quem.client.send({ t: "sfu.scope.join", channel: canal, scope: escopo })
      await quem.client.nextOf("sfu.scope.joined")
    }

    dono.client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "envio" })
    const transporte = await dono.client.nextOf("sfu.transport.created")
    dono.client.send({
      t: "sfu.produce",
      transport: transporte.transport,
      kind: "audio",
      rtpParameters: {
        codecs: [
          { mimeType: "audio/opus", payloadType: 100, clockRate: 48000, channels: 2, parameters: {}, rtcpFeedback: [] },
        ],
        headerExtensions: [],
        encodings: [{ ssrc: 434343 }],
        rtcp: { cname: "teste" },
      },
    })
    const produzido = await dono.client.nextOf("sfu.produced")
    await par.client.nextOf("sfu.producer.new")

    dono.client.close()

    const fim = await par.client.nextOf("sfu.producer.closed")
    expect(fim.producer).toBe(produzido.producer)
    expect(fim.channel).toBe(canal)

    par.client.close()
  })
})

/**
 * The video, on the gateway side: the source passing through, and the producer dying.
 *
 * `media.test.ts` measures the motor; this measures the entire journey through the
 * socket. The two halves that only show up here are the ECHO, the source someone
 * declares reaching the others, and `sfu.produce.close`, which exists only because
 * stopping sharing is not the same as leaving the call.
 */
describe("o vídeo pelo gateway", () => {
  const ECRA = {
    codecs: [{ mimeType: "video/VP8", payloadType: 101, clockRate: 90000, parameters: {}, rtcpFeedback: [] }],
    headerExtensions: [],
    encodings: [{ ssrc: 515151 }],
    rtcp: { cname: "teste" },
  }

  /** Two accounts in the same channel, both in the same call. */
  async function doisNaChamada(): Promise<{
    dono: Awaited<ReturnType<typeof entrar>>
    par: Awaited<ReturnType<typeof entrar>>
    canal: string
    escopo: string
  }> {
    const dono = await entrar()
    const par = await entrar()
    const canal = novoCanal()
    const escopo = ambitoDe("geral")

    dono.client.send({ t: "channel.subscribe", channels: [canal] })
    await dono.client.sync()
    await sentarPorConvite(dono.client, par, canal)
    par.client.send({ t: "channel.subscribe", channels: [canal] })
    await par.client.sync()

    for (const quem of [dono, par]) {
      quem.client.send({ t: "sfu.scope.join", channel: canal, scope: escopo })
      await quem.client.nextOf("sfu.scope.joined")
    }
    return { dono, par, canal, escopo }
  }

  it("diz aos outros que o fluxo novo é um ECRÃ, e não uma câmara", async () => {
    /*
     * Without this word the other side has two indistinguishable `kind: "video"`, and
     * picks wrong half the time: someone's screen inside a 190-by-128 card with edges
     * cropped, where the tab bar and the editor's side panel live, or their face
     * full screen.
     */
    const { dono, par, escopo, canal } = await doisNaChamada()
    dono.client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "envio" })
    const transporte = await dono.client.nextOf("sfu.transport.created")

    dono.client.send({ t: "sfu.produce", transport: transporte.transport, kind: "video", rtpParameters: ECRA, fonte: "ecra" })
    await dono.client.nextOf("sfu.produced")

    const anuncio = await par.client.nextOf("sfu.producer.new")
    expect(anuncio.kind).toBe("video")
    expect(anuncio.fonte).toBe("ecra")

    dono.client.close()
    par.client.close()
  })

  it("dá a fonte também a quem chega DEPOIS, no `scope.joined`", async () => {
    // The two paths where a flow learns about itself must say the same thing. This one
    // serves whoever joins a call already running, and it was what was missing the day
    // someone discovered that nobody knew who was there.
    const { dono, par, escopo, canal } = await doisNaChamada()
    dono.client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "envio" })
    const transporte = await dono.client.nextOf("sfu.transport.created")
    dono.client.send({ t: "sfu.produce", transport: transporte.transport, kind: "video", rtpParameters: ECRA, fonte: "ecra" })
    const produzido = await dono.client.nextOf("sfu.produced")

    // The pair exits and rejoins: the shortest way to be "the late arrival" without
    // spinning up a third account.
    par.client.send({ t: "sfu.scope.leave", channel: canal, scope: escopo })
    par.client.send({ t: "sfu.scope.join", channel: canal, scope: escopo })
    const entrada = await par.client.nextOf("sfu.scope.joined")
    expect(entrada.producers).toEqual([
      { id: produzido.producer, kind: "video", address: dono.address, fonte: "ecra" },
    ])

    dono.client.close()
    par.client.close()
  })

  it("chama microfone ao que vem sem fonte, que é o que um cliente da Fase 2 manda", async () => {
    const { dono, par, escopo, canal } = await doisNaChamada()
    dono.client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "envio" })
    const transporte = await dono.client.nextOf("sfu.transport.created")
    dono.client.send({
      t: "sfu.produce",
      transport: transporte.transport,
      kind: "audio",
      rtpParameters: {
        codecs: [
          { mimeType: "audio/opus", payloadType: 100, clockRate: 48000, channels: 2, parameters: {}, rtcpFeedback: [] },
        ],
        headerExtensions: [],
        encodings: [{ ssrc: 525252 }],
        rtcp: { cname: "teste" },
      },
    })
    await dono.client.nextOf("sfu.produced")

    const anuncio = await par.client.nextOf("sfu.producer.new")
    expect(anuncio.fonte).toBe("microfone")

    dono.client.close()
    par.client.close()
  })

  it("fecha um produtor sem desfazer a chamada, e diz aos outros", async () => {
    /*
     * Stop sharing. Without this path, the client would close their producer and the
     * server would keep announcing to newcomers a flow that no longer exists, without
     * ever telling whoever was watching that it ended, the last frame frozen on
     * everyone's screen, forever.
     */
    const { dono, par, escopo, canal } = await doisNaChamada()
    dono.client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "envio" })
    const transporte = await dono.client.nextOf("sfu.transport.created")
    dono.client.send({ t: "sfu.produce", transport: transporte.transport, kind: "video", rtpParameters: ECRA, fonte: "ecra" })
    const produzido = await dono.client.nextOf("sfu.produced")
    await par.client.nextOf("sfu.producer.new")

    dono.client.send({ t: "sfu.produce.close", producer: produzido.producer, ref: "f1" })
    const resposta = await dono.client.nextOf("sfu.produce.closed")
    expect(resposta.producer).toBe(produzido.producer)
    expect(resposta.ref).toBe("f1")

    const fim = await par.client.nextOf("sfu.producer.closed")
    expect(fim.producer).toBe(produzido.producer)
    expect(fim.channel).toBe(canal)

    // And the call stays up: the transport serves again, the difference between this
    // and a `scope.leave`.
    dono.client.send({ t: "sfu.produce", transport: transporte.transport, kind: "video", rtpParameters: ECRA, fonte: "ecra" })
    expect((await dono.client.nextOf("sfu.produced")).producer).toBeTruthy()

    dono.client.close()
    par.client.close()
  })

  it("fechar a imagem do ecrã fecha o som dele, e anuncia os dois", async () => {
    // The sound from the orphaned screen: without this, whoever stopped sharing through
    // a client that only closed the image would leave the sound going out to everyone.
    const { dono, par, escopo, canal } = await doisNaChamada()
    dono.client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "envio" })
    const transporte = await dono.client.nextOf("sfu.transport.created")
    dono.client.send({ t: "sfu.produce", transport: transporte.transport, kind: "video", rtpParameters: ECRA, fonte: "ecra" })
    const imagem = await dono.client.nextOf("sfu.produced")
    await par.client.nextOf("sfu.producer.new")
    dono.client.send({
      t: "sfu.produce",
      transport: transporte.transport,
      kind: "audio",
      rtpParameters: {
        codecs: [
          { mimeType: "audio/opus", payloadType: 100, clockRate: 48000, channels: 2, parameters: {}, rtcpFeedback: [] },
        ],
        headerExtensions: [],
        encodings: [{ ssrc: 535353 }],
        rtcp: { cname: "teste" },
      },
      fonte: "ecra",
    })
    const som = await dono.client.nextOf("sfu.produced")
    await par.client.nextOf("sfu.producer.new")

    dono.client.send({ t: "sfu.produce.close", producer: imagem.producer })
    await dono.client.nextOf("sfu.produce.closed")

    const primeiro = await par.client.nextOf("sfu.producer.closed")
    const segundo = await par.client.nextOf("sfu.producer.closed")
    expect([primeiro.producer, segundo.producer]).toEqual([som.producer, imagem.producer])

    dono.client.close()
    par.client.close()
  })

  it("recusa fechar o fluxo de outra pessoa, e não o fecha", async () => {
    const { dono, par, escopo, canal } = await doisNaChamada()
    dono.client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "envio" })
    const transporte = await dono.client.nextOf("sfu.transport.created")
    dono.client.send({ t: "sfu.produce", transport: transporte.transport, kind: "video", rtpParameters: ECRA, fonte: "ecra" })
    const produzido = await dono.client.nextOf("sfu.produced")
    await par.client.nextOf("sfu.producer.new")

    par.client.send({ t: "sfu.produce.close", producer: produzido.producer })
    const recusa = await par.client.nextOf("sfu.error")
    expect(recusa.code).toBe("produtor-desconhecido")

    // The half that matters: the owner keeps sharing. A rejection that closed it anyway
    // would be worse than not rejecting at all.
    await dono.client.sync()
    expect(dono.client.recebidos.some((frame) => frame.t === "sfu.producer.closed")).toBe(false)

    dono.client.close()
    par.client.close()
  })
})

/**
 * Pause and resume a flow, through the gateway and with all three guards.
 *
 * Both frames had the same gap, which is why the suite measures BOTH: measuring just
 * `sfu.pause` would hide half a symmetry. `media.test.ts` already proves what mediasoup
 * does with a consumer; what is missing is the crossing, gateway Zod, `#mayReach`, rate
 * limit per account, transport owner, which is where the questions that cost third
 * parties money live.
 *
 * What each guard prevents, stated once:
 *
 * - **Without an account**, anyone could mute or unmute the flow of whoever is in a call,
 *   just by guessing two identifiers.
 * - **With the transport of ANOTHER connection**, an authenticated member could mute the
 *   screen another member is watching, or reopen at 2.5 Mbps a tap they just closed,  *   their account, the server's bandwidth.
 * - **Without a rate limit**, an automated client runs `pause`/`resume` at socket speed,
 *   and each round is work for the media subprocess.
 */
describe("pausar e retomar um fluxo", () => {
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
    encodings: [{ ssrc: 717171 }],
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

  /**
   * A real consumer: the owner produces voice, the pair consumes it.
   *
   * Built through the whole wire on purpose. An invented consumer ID would never reach
   * the motor's `pause`, it would stop at the gate before, and all the questions in
   * this suite are about what happens to a consumer that EXISTS.
   */
  async function comConsumidor(): Promise<{
    dono: Awaited<ReturnType<typeof entrar>>
    par: Awaited<ReturnType<typeof entrar>>
    canal: string
    escopo: string
    /** The transport for receiving the peer, which owns the consumer. */
    recepcao: string
    consumidor: string
  }> {
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

    dono.client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "envio" })
    const envio = await dono.client.nextOf("sfu.transport.created")
    dono.client.send({
      t: "sfu.produce",
      transport: envio.transport,
      kind: "audio",
      rtpParameters: VOZ,
      fonte: "microfone",
    })
    const produzido = await dono.client.nextOf("sfu.produced")

    par.client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "recepcao" })
    const recepcao = await par.client.nextOf("sfu.transport.created")
    par.client.send({
      t: "sfu.consume",
      transport: recepcao.transport,
      producer: produzido.producer,
      rtpCapabilities: CAPACIDADES,
    })
    const consumido = await par.client.nextOf("sfu.consumed")

    return { dono, par, canal, escopo, recepcao: recepcao.transport, consumidor: consumido.consumer }
  }

  it("retoma e pausa o consumidor de quem o tem, com a etiqueta de volta", async () => {
    const { dono, par, recepcao, consumidor } = await comConsumidor()

    // The standard pattern: the consumer starts paused, and without it nothing calls at all. See `sfu.resume` in the protocol.
    par.client.send({ t: "sfu.resume", transport: recepcao, consumer: consumidor, ref: "r1" })
    const retomado = await par.client.nextOf("sfu.resumed")
    expect(retomado.consumer).toBe(consumidor)
    expect(retomado.ref).toBe("r1")

    // And the symmetric operation, which is what makes "Stop viewing" save server bandwidth.
    par.client.send({ t: "sfu.pause", transport: recepcao, consumer: consumidor, ref: "p1" })
    const pausado = await par.client.nextOf("sfu.paused")
    expect(pausado.consumer).toBe(consumidor)
    expect(pausado.ref).toBe("p1")

    // And the next "View" is a `resume` on the SAME object without consuming again: that is the second benefit of pausing instead of closing.
    par.client.send({ t: "sfu.resume", transport: recepcao, consumer: consumidor, ref: "r2" })
    expect((await par.client.nextOf("sfu.resumed")).ref).toBe("r2")

    dono.client.close()
    par.client.close()
  }, 30_000)

  it("recusa os dois a quem não tem conta, e é fatal", async () => {
    /*
      The gateway's common guard, enforced in these two frames because it is where
      its absence cost: `sfu.pause` and `sfu.resume` name an object by
      identifier, not a channel. Without a count there is no `#mayReach` running nor
      owner to compare, guessing two identifiers silenced or reopened someone else's
      stream.
    */
    for (const frame of ["sfu.pause", "sfu.resume"] as const) {
      const client = await TestClient.connect(gatewayUrl)
      client.send({ t: "hello", version: PROTOCOL_VERSION })
      await client.nextOf("hello.ok")

      client.send({ t: frame, transport: "t-qualquer", consumer: "c-qualquer" })
      const erro = await client.nextOf("error")
      expect(erro.code, frame).toBe("unauthenticated")
      expect(erro.fatal, frame).toBe(true)

      client.close()
    }
  }, 30_000)

  it("recusa os dois sobre o transporte de OUTRA ligação, e não lhe toca", async () => {
    /*
      The second lock in `media.ts`, seen from the thread.

      The transport owner is whoever created it, and the engine compares it to the
      caller, see `#meuTransporte`. Without that comparison, an authenticated member
      of the same call could silence the stream another is hearing using its identifier,
      or reopen it at 2.5 Mbps on its own quota.

      And it measures the half that matters: the consumer keeps serving the owner
      after the refusal. A refusal that touched the object anyway was worse than
      refusing nothing.
    */
    const { dono, par, recepcao, consumidor } = await comConsumidor()

    for (const frame of ["sfu.pause", "sfu.resume"] as const) {
      dono.client.send({ t: frame, transport: recepcao, consumer: consumidor })
      const recusa = await dono.client.nextOf("sfu.error")
      expect(recusa.code, frame).toBe("transporte-desconhecido")
    }

    // The consumer owner keeps asking it to resume and pause freely.
    par.client.send({ t: "sfu.resume", transport: recepcao, consumer: consumidor, ref: "meu" })
    expect((await par.client.nextOf("sfu.resumed")).ref).toBe("meu")

    dono.client.close()
    par.client.close()
  }, 30_000)

  it("para no tecto dos frames de media por minuto, os dois", async () => {
    /*
      The cap is per ACCOUNT and per minute, and it is the same bucket for all
      `sfu.*` frames, that is why each half of this test takes a new account, or
      the first would exhaust the cap of the second.

      The order of the guards is what `#sfu` has written: first the engine, then
      the cap. Here the engine is running, so what we measure is the cap, and what
      proves it is the cap and not something else is the REFUSAL CODE changing
      exactly as the number crosses the threshold.
    */
    for (const frame of ["sfu.pause", "sfu.resume"] as const) {
      const quem = await entrar()
      const pedidos = Gateway.SFU_POR_MINUTO + 10

      for (let i = 0; i < pedidos; i++) {
        quem.client.send({ t: frame, transport: "t-que-nao-existe", consumer: "c-que-nao-existe" })
      }

      /*
        We count the `sfu.error` frames, not the frames that arrived.

        Each request gets exactly one response, but the gateway also sends on its own
        , a `keypackage.low` goes out right after `auth.ok`, and that runs at the
        instant we take a snapshot of what arrived. Counting the TOTAL would depend on
        that race, and one race out of so many would fail on a frame that has nothing
        to do with the question.

        And we wait for them instead of draining by luck: `nextOf` skips up to
        ten frames looking for what it wants, and with three hundred in the queue it
        would measure something else.
      */
      const recusas = (): Extract<ServerFrame, { t: "sfu.error" }>[] =>
        quem.client.recebidos.filter((cada): cada is Extract<ServerFrame, { t: "sfu.error" }> => cada.t === "sfu.error")
      const limite = Date.now() + 25_000
      while (recusas().length < pedidos && Date.now() < limite) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }

      // The first three hundred reached the engine and died at the owner lock; the next ten never got there.
      const codigos = recusas().map((cada) => cada.code)
      expect(codigos, frame).toHaveLength(pedidos)
      expect(codigos.filter((cada) => cada === "transporte-desconhecido"), frame).toHaveLength(
        Gateway.SFU_POR_MINUTO,
      )
      expect(codigos.filter((cada) => cada === "demasiados-pedidos"), frame).toHaveLength(10)
      // And the path is this one and no other: the cap comes AFTER the engine, so none of these could have been refused for lack of SFU.
      expect(codigos, frame).not.toContain("sem-sfu")

      quem.client.close()
    }
  }, 60_000)
})

describe("o esquema", () => {
  /**
   * The scope shape is fixed, and it is the only defense against the obvious mistake.
   *
   * With a `max(64)`, a client that sent the room name in plain text would pass
   * validation and the server would store the name in a map without anyone noticing.
   * Requiring the exact shape of a SHA-256 makes that impossible by accident, and
   * the refusal is the usual non-fatal `bad-frame`, because a malformed frame is not
   * a reason to tear down someone's text.
   */
  it("recusa um âmbito que não seja um resumo", async () => {
    const dono = await entrar()
    const canal = novoCanal()
    dono.client.send({ t: "channel.subscribe", channels: [canal] })
    await dono.client.sync()

    dono.client.send({ t: "sfu.scope.join", channel: canal, scope: "geral" } as unknown as ClientFrame)
    const erro = await dono.client.nextOf("error")
    expect(erro.code).toBe("bad-frame")
    expect(erro.fatal).toBe(false)

    dono.client.close()
  })
})

/**
 * Phase M2: `sfu.keyframe`, through the entire thread.
 *
 * The engine already proves the cap and owner (`media.fotograma-chave-pedido.test.ts`).
 * Here we prove the path: the capacity in `hello.ok`, the owner's request
 * reaching the engine, and that nothing answers: not to the owner (a request gets no
 * confirmation), and not to whoever uses the transport from another connection
 * (no `sfu.error` either).
 */
describe("o fotograma-chave a pedido (sfu.keyframe)", () => {
  const VIDEO = {
    codecs: [{ mimeType: "video/VP8", payloadType: 101, clockRate: 90000, parameters: {}, rtcpFeedback: [] }],
    headerExtensions: [],
    encodings: [{ ssrc: 818181 }],
    rtcp: { cname: "teste" },
  }
  const CAPACIDADES_DE_VIDEO = {
    codecs: [{ kind: "video", mimeType: "video/VP8", preferredPayloadType: 101, clockRate: 90000, rtcpFeedback: [], parameters: {} }],
    headerExtensions: [],
  }

  it("anuncia-se no hello.ok com o SFU", async () => {
    const client = await TestClient.connect(gatewayUrl)
    client.send({ t: "hello", version: PROTOCOL_VERSION })
    const hello = await client.nextOf("hello.ok")
    expect(hello.capabilities).toContain(CAPACIDADE_SFU_FOTOGRAMA_CHAVE)
    client.close()
  })

  it("o pedido do dono chega ao motor, sem resposta; o de outra ligação não chega a nada", async () => {
    const motor = enclave.media!
    const dono = await entrar()
    const par = await entrar()
    const canal = novoCanal()
    const escopo = ambitoDe("ecra")
    dono.client.send({ t: "channel.subscribe", channels: [canal] })
    await dono.client.sync()
    await sentarPorConvite(dono.client, par, canal)
    par.client.send({ t: "channel.subscribe", channels: [canal] })
    await par.client.sync()
    for (const quem of [dono, par]) {
      quem.client.send({ t: "sfu.scope.join", channel: canal, scope: escopo })
      await quem.client.nextOf("sfu.scope.joined")
    }
    dono.client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "envio" })
    const envio = await dono.client.nextOf("sfu.transport.created")
    dono.client.send({ t: "sfu.produce", transport: envio.transport, kind: "video", rtpParameters: VIDEO, fonte: "ecra" })
    const produzido = await dono.client.nextOf("sfu.produced")
    par.client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "recepcao" })
    const recepcao = await par.client.nextOf("sfu.transport.created")
    par.client.send({ t: "sfu.consume", transport: recepcao.transport, producer: produzido.producer, rtpCapabilities: CAPACIDADES_DE_VIDEO })
    const consumido = await par.client.nextOf("sfu.consumed")
    par.client.send({ t: "sfu.resume", transport: recepcao.transport, consumer: consumido.consumer, ref: "r1" })
    await par.client.nextOf("sfu.resumed")

    const antes = motor.chavesPedidasPorQuemVe
    const recebidosAntes = par.client.recebidos.length
    // A burst: one goes through, the cap cuts the rest, and nobody answers.
    for (let i = 0; i < 5; i++) par.client.send({ t: "sfu.keyframe", transport: recepcao.transport, consumer: consumido.consumer })
    await par.client.sync()
    expect(motor.chavesPedidasPorQuemVe - antes).toBe(1)
    expect(par.client.recebidos.slice(recebidosAntes).map((f) => f.t)).toEqual(["pong"])

    // The screen owner asking through the peer's receive: transport from another connection.
    const doDono = dono.client.recebidos.length
    dono.client.send({ t: "sfu.keyframe", transport: recepcao.transport, consumer: consumido.consumer })
    await dono.client.sync()
    expect(motor.chavesPedidasPorQuemVe - antes).toBe(1)
    expect(dono.client.recebidos.slice(doDono).map((f) => f.t)).toEqual(["pong"])

    dono.client.close()
    par.client.close()
  }, 30_000)

  it("sem conta é recusado, e é fatal, como todo o sfu.*", async () => {
    const client = await TestClient.connect(gatewayUrl)
    client.send({ t: "hello", version: PROTOCOL_VERSION })
    await client.nextOf("hello.ok")
    client.send({ t: "sfu.keyframe", transport: "t-qualquer", consumer: "c-qualquer" })
    const erro = await client.nextOf("error")
    expect(erro.code).toBe("unauthenticated")
    expect(erro.fatal).toBe(true)
    client.close()
  }, 30_000)
})

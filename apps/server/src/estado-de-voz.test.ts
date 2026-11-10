import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { Call, Session, Vault, type VaultBackend } from "@enclave/client-core"
import { moradaDeSala, parseServerName, type Payload, type ServerName, type UserAddress } from "@enclave/protocol"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"

/**
 * The state that already exists, for whoever arrives later.
 *
 * Reproduces the owner's report from 18 August 2026: *"when they join, they
 * don't see me in a call either"* and *"no call shows up: users join as if
 * everything were empty"*.
 *
 * Someone in a voice room announces it once, in a `voice.join`, and that
 * announcement only reaches those already listening. Whoever joins the channel
 * afterwards never heard it, and unlike name or roles, nobody repeats it.
 */

let enclave: Enclave
let dataDir: string
let PORT = 0
let HOME: ServerName

class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

interface Peer {
  session: Session
  address: string
  /** Voice signals this device heard, which is what the sidebar draws. */
  voz: { channel: string; from: string; payload: Payload }[]
}

async function peer(nome: string): Promise<Peer> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe-de-teste")
  const session = new Session(vault)
  const identity = await session.createIdentity(`localhost:${PORT}`)
  const voz: Peer["voz"] = []
  session.on("voice", (event) => {
    voz.push({ channel: event.channel, from: event.from, payload: event.payload })
  })
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  return { session, address: identity.address, voz }
}

async function until(predicate: () => boolean, label: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`esgotou o tempo à espera de: ${label}`)
}

/**
 * Join a voice room with the call engine for real.
 *
 * Node has no WebRTC, so the two objects the join touches are faked, as in
 * `call.test.ts`, for the same reason. Everything else is the product: the real
 * `Call`, the real `Session`, the real server, and MLS encrypting each
 * announcement. No signaling line is written by hand.
 *
 * **The link between session and call lives here, and that is a known weakness:**
 * a bridge that forgot it would still pass this test. What covers it is the two
 * sister tests, `apps/web/src/bridge.presenca.test.ts` and
 * `apps/client/src/renderer/bridge.presenca.test.ts`, one per bridge, each
 * failing on its own if the line is missing there.
 */
function ligarMotorDeChamada(quem: Peer): Call {
  const call = new Call({
    get selfAddress(): UserAddress {
      return quem.session.identity.address
    },
    sendSignal: (channel: string, payload: Payload) => quem.session.send(channel, payload).then(() => undefined),
    mediaKey: (channel: string, address: UserAddress) => quem.session.mediaKey(channel, address),
    reservarContadorSframe: (channel: string, keyId: number) => quem.session.reservarContadorSframe(channel, keyId),
  })
  // The same two lines both bridges have, and that is what this test runs through.
  quem.session.on("voice", (event) => {
    void call.handleSignal(event.channel, event.from, event.payload).catch(() => {})
  })
  quem.session.on("presence", (event) => {
    if (event.online) call.reafirmarPresenca()
  })
  quem.session.on("epoch", (event) => {
    void call.rekey(event.channel).catch(() => {})
  })
  return call
}

/** Who this device thinks is in voice rooms, based on what it heard. */
function quemEstaEmVoz(quem: Peer, channel: string): Map<string, string> {
  const salas = new Map<string, string>()
  for (const sinal of quem.voz) {
    if (sinal.channel !== channel) continue
    if (sinal.payload.t === "voice.join") salas.set(sinal.from, sinal.payload.room ?? "")
    else if (sinal.payload.t === "voice.leave") salas.delete(sinal.from)
  }
  return salas
}

/**
 * The WebRTC that Node does not have, faked as in `call.test.ts`.
 *
 * Complete enough for an offer and answer to traverse the real server and a
 * connection to reach "connected", **and this is not a test convenience; it is what
 * makes the test rig measure the right thing.** See `assentarChamada`.
 */
class LigacaoFingida {
  static instancias: LigacaoFingida[] = []
  localDescription: { type: string; sdp: string } | null = null
  remoteDescription: { type: string; sdp: string } | null = null
  connectionState = "new"
  onicecandidate: ((evento: unknown) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  ontrack: ((evento: unknown) => void) | null = null

  constructor() {
    LigacaoFingida.instancias.push(this)
  }
  addTrack(): unknown {
    return {}
  }
  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: "offer", sdp: "v=0\r\no=- fingida\r\n" }
  }
  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: "answer", sdp: "v=0\r\no=- fingida\r\n" }
  }
  async setLocalDescription(d: { type: string; sdp: string }): Promise<void> {
    this.localDescription = d
  }
  async setRemoteDescription(d: { type: string; sdp: string }): Promise<void> {
    this.remoteDescription = d
  }
  async addIceCandidate(): Promise<void> {}
  close(): void {}
  ligou(): void {
    this.connectionState = "connected"
    this.onconnectionstatechange?.()
  }
}

function fingirWebRTC(): void {
  const faixa = { kind: "audio", enabled: true, stop: () => {} }
  vi.stubGlobal("RTCPeerConnection", LigacaoFingida)
  vi.stubGlobal("RTCRtpSender", class {})
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () =>
        ({
          getTracks: () => [faixa],
          getAudioTracks: () => [faixa],
          getVideoTracks: () => [],
        }) as unknown as MediaStream,
    },
  })
}

/**
 * Move the call to the state where the test rig stops lying.
 *
 * **This is the trap of this hunt, and it matters more than the test itself.**
 * The `#comecarAnuncio` in `call.ts` repeats `voice.join` every five seconds
 * while there is NO peer, and stops at the first one. With one person alone in a
 * voice room, that repeater covers any reaffirmation gap and makes the test pass
 * on its own: measured with the fix disabled, both tests below stayed green and
 * only got five seconds slower.
 *
 * The product lives on the other side of that condition: with two people in the
 * call the repeater is silent, and with SFU it never even starts. You need to
 * push the call there to measure anything at all.
 */
function assentarChamada(): void {
  for (const ligacao of LigacaoFingida.instancias) ligacao.ligou()
}

beforeAll(async () => {
  fingirWebRTC()
  dataDir = mkdtempSync(join(tmpdir(), "enclave-voz-"))
  const config: ServerConfig = {
    serverName: parseServerName("localhost"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    dataDir,
    databasePath: join(dataDir, "test.sqlite"),
    sfuPort: 0,
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
  PORT = (enclave.app.server.address() as { port: number }).port
  HOME = parseServerName(`localhost:${PORT}`)
  config.serverName = HOME
}, 30_000)

afterAll(async () => {
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe("quem chega e o que já lá estava", () => {
  it("quem entra no canal fica a saber quem já está na sala de voz", async () => {
    const a = await peer("Alice")
    const b = await peer("Bruno")
    const c = await peer("Carla")
    const canal = moradaDeSala(HOME)

    await a.session.createSpaceChannel(canal)
    await a.session.seat(canal, b.address)
    await until(() => b.session.channels.includes(canal), "B entra no canal")

    // A and B join the voice room and the call settles. The contrast that gives
    // meaning to the rest: the mechanism works for whoever witnesses the join.
    const chamadaDeA = ligarMotorDeChamada(a)
    const chamadaDeB = ligarMotorDeChamada(b)
    await chamadaDeA.join(canal, { room: "tasca" })
    await until(() => quemEstaEmVoz(b, canal).get(a.address) === "tasca", "B vê A na sala de voz")
    await chamadaDeB.join(canal, { room: "tasca" })
    await until(() => quemEstaEmVoz(a, canal).get(b.address) === "tasca", "A vê B na sala de voz")
    await until(() => LigacaoFingida.instancias.length >= 2, "as duas ligações nascem")
    assentarChamada()

    // Now Carla arrives in the channel where the call is already under way.
    await a.session.seat(canal, c.address)
    await until(() => c.session.channels.includes(canal), "C entra no canal")

    // What the user sees: the voice room with whoever is inside. Both of them, not
    // one: the people in a call are everyone who is there.
    await until(
      () => quemEstaEmVoz(c, canal).get(a.address) === "tasca" && quemEstaEmVoz(c, canal).get(b.address) === "tasca",
      "C vê A e B na sala de voz onde já estavam quando ela chegou",
    )
    expect([...quemEstaEmVoz(c, canal).keys()].sort()).toEqual([a.address, b.address].sort())

    await chamadaDeA.leave()
    await chamadaDeB.leave()
    a.session.disconnect()
    b.session.disconnect()
    c.session.disconnect()
  }, 60_000)

  /**
   * And the most common case of all, which joining the channel does not
   * cover: **opening the app**.
   *
   * Someone already a member does not move the epoch when they return. If
   * reaffirmation depended only on the group growing, this would stay empty,
   * and this is the owner's report: *"users join as if everything were empty"*.
   * Whoever joins a channel joins once; whoever opens the app opens it every day.
   *
   * The voice list lives in memory on the viewer's side, and nothing seeds it:
   * a new connection starts knowing nothing about a call already in progress.
   */
  it("quem volta a abrir a aplicação fica a saber quem está na sala de voz", async () => {
    const a = await peer("Alice")
    const b = await peer("Bruno")
    const c = await peer("Carla")
    const canal = moradaDeSala(HOME)

    await a.session.createSpaceChannel(canal)
    await a.session.seat(canal, b.address)
    await until(() => b.session.channels.includes(canal), "B entra no canal")
    await a.session.seat(canal, c.address)
    await until(() => c.session.channels.includes(canal), "C entra no canal")

    // A and C in the voice room, call settled. B is a channel member and only
    // watching, which is the state of almost everyone almost all the time.
    const chamadaDeA = ligarMotorDeChamada(a)
    const chamadaDeC = ligarMotorDeChamada(c)
    await chamadaDeA.join(canal, { room: "tasca" })
    await chamadaDeC.join(canal, { room: "tasca" })
    await until(() => quemEstaEmVoz(b, canal).size === 2, "B vê os dois na sala de voz")
    await until(() => LigacaoFingida.instancias.length >= 2, "as duas ligações nascem")
    assentarChamada()

    // B closes the app and comes back. Nobody left the call, and the epoch did
    // not move: returning is not joining.
    b.session.disconnect()
    b.voz.length = 0
    await new Promise((resolve) => setTimeout(resolve, 500))
    await b.session.connect()

    await until(
      () => quemEstaEmVoz(b, canal).size === 2,
      "B volta a ver a sala de voz cheia depois de reabrir a aplicação",
    )
    expect([...quemEstaEmVoz(b, canal).keys()].sort()).toEqual([a.address, c.address].sort())

    await chamadaDeA.leave()
    await chamadaDeC.leave()
    a.session.disconnect()
    b.session.disconnect()
    c.session.disconnect()
  }, 60_000)
})

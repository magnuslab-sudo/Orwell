import {
  fromBase64,
  generateIdentity,
  identityFromPrivateKey,
  parseServerName,
  PROTOCOL_VERSION,
  signWithDevice,
  toBase64,
  type ClientFrame,
  type ServerFrame,
} from "@enclave/protocol"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocket } from "ws"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"

/**
 * Device ownership: which copy of it speaks for the account.
 *
 * Importing an account file copies the device that exported it, with the same
 * key. Measured on October 27, 2026 (`scripts/e2e-exportar-importar.mjs`):
 * the old copy continued to speak and read after import, and the two broke the
 * channel for each other. What we measure here, with real connections: the
 * copy that takes ownership closes the other connected one; the old copy does
 * not rejoin; the new one rejoins with the generation it received; and a client
 * that does not know about ownership can still join while no one has taken it.
 */

let HOME: ReturnType<typeof parseServerName>
let enclave: Enclave
let dataDir: string
let gatewayUrl: string

class TestClient {
  #socket: WebSocket
  #queue: ServerFrame[] = []
  #waiters: ((frame: ServerFrame) => void)[] = []
  fechado = false
  readonly #fechou: Promise<void>

  private constructor(socket: WebSocket) {
    this.#socket = socket
    socket.on("message", (raw: Buffer) => {
      const frame = JSON.parse(raw.toString("utf8")) as ServerFrame
      const waiter = this.#waiters.shift()
      if (waiter) waiter(frame)
      else this.#queue.push(frame)
    })
    this.#fechou = new Promise((resolve) =>
      socket.once("close", () => {
        this.fechado = true
        resolve()
      }),
    )
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

  esperarFecho(): Promise<void> {
    return this.#fechou
  }

  close(): void {
    this.#socket.close()
  }
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-posse-"))
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
  const port = (enclave.app.server.address() as { port: number }).port
  HOME = parseServerName(`localhost:${port}`)
  config.serverName = HOME
  gatewayUrl = `ws://127.0.0.1:${port}/_enclave/gateway`
})

afterAll(async () => {
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

type Identidade = ReturnType<typeof generateIdentity>

/** Join with the chain: this is how every client has joined since August 11. */
async function entrar(
  identity: Identidade,
  posse: { posse?: number; assumirPosse?: string } = {},
): Promise<{ client: TestClient; resposta: ServerFrame }> {
  const client = await TestClient.connect(gatewayUrl)
  client.send({ t: "hello", version: PROTOCOL_VERSION, capabilities: ["commit-after-echo"] })
  await client.nextOf("hello.ok")
  client.send({
    t: "auth.begin",
    address: identity.address,
    signingKey: toBase64(identity.deviceSigningPublicKey),
    accountKey: toBase64(identity.signingPublicKey),
    deviceCert: toBase64(identity.credential.signature),
  })
  const challenge = await client.next()
  if (challenge.t !== "auth.challenge") return { client, resposta: challenge }
  client.send({ t: "auth.finish", signature: toBase64(signWithDevice(identity, fromBase64(challenge.nonce))), ...posse })
  return { client, resposta: await client.next() }
}

const MARCA_A = "marca-da-importacao-a"
const MARCA_B = "marca-da-importacao-b"

describe("gateway: a posse de um aparelho importado", () => {
  it("sem importação nenhuma, a geração é zero e o cliente que não a conhece entra", async () => {
    const ana = generateIdentity(HOME)
    const a = await entrar(ana)
    expect(a.resposta).toMatchObject({ t: "auth.ok", posse: 0 })
    a.client.close()
  })

  it("a cópia importada assume a posse: a cópia antiga ligada sai já, com device-revoked", async () => {
    const ana = generateIdentity(HOME)
    const antiga = await entrar(ana)
    expect(antiga.resposta.t).toBe("auth.ok")

    const nova = await entrar(ana, { assumirPosse: MARCA_A })
    expect(nova.resposta).toMatchObject({ t: "auth.ok", posse: 1 })
    expect(await antiga.client.nextOf("error")).toMatchObject({ code: "device-revoked", fatal: true })
    await antiga.client.esperarFecho()
    expect(antiga.client.fechado).toBe(true)

    // The new one stays connected and is served.
    await nova.client.sync()
    expect(nova.client.fechado).toBe(false)
    nova.client.close()
  })

  it("a cópia antiga não volta a entrar, nem sem posse nem com a geração anterior", async () => {
    const ana = generateIdentity(HOME)
    const nova = await entrar(ana, { assumirPosse: MARCA_A })
    expect(nova.resposta).toMatchObject({ t: "auth.ok", posse: 1 })
    nova.client.close()

    for (const posse of [{}, { posse: 0 }]) {
      const antiga = await entrar(ana, posse)
      expect(antiga.resposta).toMatchObject({ t: "error", code: "device-revoked", fatal: true })
      await antiga.client.esperarFecho()
    }
    // And the new one rejoins with the generation it received.
    const deVolta = await entrar(ana, { posse: 1 })
    expect(deVolta.resposta).toMatchObject({ t: "auth.ok", posse: 1 })
    deVolta.client.close()
  })

  it("importar outra vez sobe outra vez, e a primeira cópia importada passa a ser a antiga", async () => {
    const ana = generateIdentity(HOME)
    expect((await entrar(ana, { assumirPosse: MARCA_A })).resposta).toMatchObject({ posse: 1 })
    const segunda = await entrar(ana, { assumirPosse: MARCA_B })
    expect(segunda.resposta).toMatchObject({ t: "auth.ok", posse: 2 })
    segunda.client.close()
    expect((await entrar(ana, { posse: 1 })).resposta).toMatchObject({ t: "error", code: "device-revoked" })
  })

  it("duas ligações da MESMA cópia importada não se fecham uma à outra", async () => {
    // A `connect` that overlaps another (Session.connect) opens two connections,
    // and both claim ownership with the same mark. Measured in the desktop app
    // on 10/27: without the mark, the second closed the first and login failed
    // with Error 203.
    const ana = generateIdentity(HOME)
    const primeira = await entrar(ana, { assumirPosse: MARCA_A })
    const segunda = await entrar(ana, { assumirPosse: MARCA_A })
    expect(primeira.resposta).toMatchObject({ t: "auth.ok", posse: 1 })
    expect(segunda.resposta).toMatchObject({ t: "auth.ok", posse: 1 })
    await primeira.client.sync()
    expect(primeira.client.fechado).toBe(false)
    primeira.client.close()
    segunda.client.close()
  })

  it("a posse é por aparelho: outro aparelho da mesma conta não é tocado", async () => {
    const computador = generateIdentity(HOME)
    const telemovel = identityFromPrivateKey(computador.signingPrivateKey, HOME)
    const tel = await entrar(telemovel)
    expect(tel.resposta.t).toBe("auth.ok")
    const importado = await entrar(computador, { assumirPosse: MARCA_A })
    expect(importado.resposta).toMatchObject({ t: "auth.ok", posse: 1 })
    await tel.client.sync()
    expect(tel.client.fechado).toBe(false)
    tel.client.close()
    importado.client.close()
  })
})

import {
  FEDERATION_PATH,
  fromBase64,
  generateIdentity,
  parseServerName,
  PeerClaim,
  PROTOCOL_VERSION,
  sign,
  signDeviceManifest,
  toBase64,
  type ClientFrame,
  type ServerFrame,
} from "@enclave/protocol"
import type { z } from "zod"
import { ed25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocket } from "ws"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"

/**
 * The requester side in key package federation: a client here invites someone
 * who lives on another server, the gateway calls `claimRemote`, and what the
 * peer answers reaches the client via `keypackage.claimed`.
 *
 * The peer is a fake `fetch`: federation never ran between two real servers,
 * and what is proven here is the translation, both ways. A 0.2.3 peer answers
 * with just `keyPackage`; a new peer answers with the bundle; a peer that
 * answers garbage counts as no answer. And the request that goes out carries
 * `bundle`/`devices` when the client asked for them, and does not when it did
 * not.
 */

const NOS = parseServerName("casa.example")
const PAR = parseServerName("par.example")

let enclave: Enclave
let dataDir: string
let gatewayUrl: string
let pedidos: PeerClaim[] = []
let resposta: () => { status: number; body: unknown } = () => ({ status: 200, body: { keyPackage: null } })

/**
 * A frame as it comes from the client, BEFORE the server schema: fields with
 * default values (`replace`, `bundle`, …) may be missing, and the server fills
 * them in. `ClientFrame` is the type after the schema.
 */
type FrameDoCliente = z.input<typeof ClientFrame>

class TestClient {
  #socket: WebSocket
  #queue: ServerFrame[] = []
  #waiters: ((frame: ServerFrame) => void)[] = []
  private constructor(socket: WebSocket) {
    this.#socket = socket
    socket.on("message", (raw: Buffer) => {
      const frame = JSON.parse(raw.toString("utf8")) as ServerFrame
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
  send(frame: FrameDoCliente): void {
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
  close(): void {
    this.#socket.close()
  }
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-claim-remoto-"))
  const config: ServerConfig = {
    serverName: NOS,
    bindHost: "127.0.0.1",
    bindPort: 0,
    dataDir,
    databasePath: join(dataDir, "test.sqlite"),
    sfuPort: 0,
    sfuAnnouncedIp: "",
    retentionDays: 30,
    allowlist: [PAR],
    turnUrls: [],
    turnSecret: "",
    turnTtl: 600,
    communityMode: false,
    commonRoom: "",
  }
  enclave = await buildServer(config)
  await enclave.app.listen({ host: config.bindHost, port: 0 })
  const port = (enclave.app.server.address() as { port: number }).port
  gatewayUrl = `ws://127.0.0.1:${port}/_enclave/gateway`

  pedidos = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`https://${PAR}${FEDERATION_PATH}/keypackage`)
      const corpo = PeerClaim.parse(JSON.parse(init?.body as string))
      pedidos.push(corpo)
      const { status, body } = resposta()
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
    }),
  )
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

async function login(client: TestClient): Promise<void> {
  const identity = generateIdentity(NOS)
  client.send({ t: "hello", version: PROTOCOL_VERSION, capabilities: ["commit-after-echo"] })
  await client.nextOf("hello.ok")
  client.send({ t: "auth.begin", address: identity.address, signingKey: toBase64(identity.signingPublicKey) })
  const challenge = await client.nextOf("auth.challenge")
  client.send({ t: "auth.finish", signature: toBase64(sign(identity, fromBase64(challenge.nonce))) })
  await client.nextOf("auth.ok")
}

const REMOTA = generateIdentity(PAR)
const A = ed25519.getPublicKey(sha256(Uint8Array.from([1])))
const B = ed25519.getPublicKey(sha256(Uint8Array.from([2])))
const manifestoRemoto = signDeviceManifest(REMOTA.signingPrivateKey, {
  address: REMOTA.address,
  version: 1,
  devices: [
    { deviceKey: A, addedAt: 1 },
    { deviceKey: B, addedAt: 2 },
  ],
  signedAt: 1,
})

describe("claim de key package de uma conta de outro servidor", () => {
  it("sem bundle: o pedido ao par não leva bundle, e a resposta singular do par (0.2.3) chega ao cliente tal como veio", async () => {
    resposta = () => ({ status: 200, body: { keyPackage: "cGFjb3Rl" } })
    const client = await TestClient.connect(gatewayUrl)
    await login(client)
    client.send({ t: "keypackage.claim", address: REMOTA.address })
    const claimed = await client.nextOf("keypackage.claimed")
    expect(claimed).toStrictEqual({ t: "keypackage.claimed", address: REMOTA.address, keyPackage: "cGFjb3Rl" })
    expect(pedidos).toHaveLength(1)
    expect("bundle" in (pedidos[0] as object)).toBe(false)
    expect("devices" in (pedidos[0] as object)).toBe(false)
    expect(pedidos[0]?.origin).toBe(NOS)
    expect(pedidos[0]?.destination).toBe(PAR)
    expect(pedidos[0]?.address).toBe(REMOTA.address)
    client.close()
  })

  it("com bundle contra um par 0.2.3 (só singular): o cliente recebe bundle vazio e manifesto null", async () => {
    resposta = () => ({ status: 200, body: { keyPackage: "cGFjb3Rl" } })
    const client = await TestClient.connect(gatewayUrl)
    await login(client)
    client.send({ t: "keypackage.claim", address: REMOTA.address, bundle: true })
    const claimed = await client.nextOf("keypackage.claimed")
    expect(claimed).toStrictEqual({ t: "keypackage.claimed", address: REMOTA.address, keyPackage: "cGFjb3Rl", keyPackages: [], manifest: null })
    expect(pedidos[0]?.bundle).toBe(true)
    client.close()
  })

  it("com bundle e devices contra um par novo: o pedido leva os dois, e o bundle e o manifesto do par chegam ao cliente", async () => {
    resposta = () => ({
      status: 200,
      body: {
        keyPackage: "cGFjb3RlQQ",
        keyPackages: [
          { deviceKey: toBase64(A), keyPackage: "cGFjb3RlQQ" },
          { deviceKey: toBase64(B), keyPackage: "cGFjb3RlQg" },
        ],
        manifest: manifestoRemoto,
      },
    })
    const client = await TestClient.connect(gatewayUrl)
    await login(client)
    client.send({ t: "keypackage.claim", address: REMOTA.address, bundle: true, devices: [toBase64(B)] })
    const claimed = await client.nextOf("keypackage.claimed")
    expect(claimed.keyPackages).toHaveLength(2)
    expect(claimed.manifest).toStrictEqual(manifestoRemoto)
    expect(claimed.keyPackage).toBe("cGFjb3RlQQ")
    expect(pedidos[0]?.bundle).toBe(true)
    expect(pedidos[0]?.devices).toStrictEqual([toBase64(B)])
    client.close()
  })

  it("um par que responde lixo, ou 403, não respondeu: null para o cliente, e a resposta chega na mesma", async () => {
    resposta = () => ({ status: 200, body: { keyPackage: 42 } })
    const client = await TestClient.connect(gatewayUrl)
    await login(client)
    client.send({ t: "keypackage.claim", address: REMOTA.address, bundle: true })
    expect(await client.nextOf("keypackage.claimed")).toStrictEqual({ t: "keypackage.claimed", address: REMOTA.address, keyPackage: null })

    resposta = () => ({ status: 403, body: { error: "not-federated" } })
    client.send({ t: "keypackage.claim", address: REMOTA.address })
    expect(await client.nextOf("keypackage.claimed")).toStrictEqual({ t: "keypackage.claimed", address: REMOTA.address, keyPackage: null })
    client.close()
  })

  it("um bundle com mais aparelhos do que uma conta pode ter é lixo pelo molde", async () => {
    resposta = () => ({
      status: 200,
      body: {
        keyPackage: "cGFjb3Rl",
        keyPackages: Array.from({ length: 5 }, (_, i) => ({ deviceKey: toBase64(ed25519.getPublicKey(sha256(Uint8Array.from([10 + i])))), keyPackage: "cGFjb3Rl" })),
        manifest: null,
      },
    })
    const client = await TestClient.connect(gatewayUrl)
    await login(client)
    client.send({ t: "keypackage.claim", address: REMOTA.address, bundle: true })
    expect(await client.nextOf("keypackage.claimed")).toStrictEqual({ t: "keypackage.claimed", address: REMOTA.address, keyPackage: null })
    client.close()
  })
})

import {
  CAPACIDADE_REVOGACAO,
  fromBase64,
  generateIdentity,
  identityFromPrivateKey,
  parseServerName,
  PROTOCOL_VERSION,
  signDeviceManifest,
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
 * Revoking devices, on the server side, with real connections.
 *
 * The account removes a device by publishing the next manifest without it. What
 * the server does with that, and what we measure here: the revoked device that
 * is connected leaves right away (`device-revoked`, fatal); it cannot come back;
 * its packets waiting are gone; and no account manifest puts it back. What
 * CANNOT happen, and we also measure: the paired device that is not yet in the
 * manifest (the phone before `ready`) stays able to enter.
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
  dataDir = mkdtempSync(join(tmpdir(), "enclave-revogacao-"))
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

/** Join with the chain: it is how every client since August 11 joins. */
async function entrar(identity: Identidade): Promise<{ client: TestClient; resposta: ServerFrame }> {
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
  client.send({ t: "auth.finish", signature: toBase64(signWithDevice(identity, fromBase64(challenge.nonce))) })
  return { client, resposta: await client.next() }
}

function manifesto(conta: Identidade, version: number, aparelhos: Identidade[]) {
  return signDeviceManifest(conta.signingPrivateKey, {
    address: conta.address,
    version,
    devices: aparelhos.map((a, i) => ({ deviceKey: a.deviceSigningPublicKey, addedAt: i })),
    signedAt: version,
  })
}

/** Publish, revoking `revogar` (the `revoke` list); without it, this is what 0.5.7 sends. */
async function publicar(client: TestClient, wire: ReturnType<typeof manifesto>, revogar?: Identidade[]) {
  client.send({
    t: "manifest.publish",
    manifest: wire,
    ...(revogar ? { revoke: revogar.map((a) => toBase64(a.deviceSigningPublicKey)) } : {}),
  })
  return client.nextOf("manifest.published")
}

/** Three devices of the same account: the laptop (with the key), the phone, and a third one to pair. */
function conta(): { computador: Identidade; telemovel: Identidade; novo: Identidade } {
  const computador = generateIdentity(HOME)
  return {
    computador,
    telemovel: identityFromPrivateKey(computador.signingPrivateKey, HOME),
    novo: identityFromPrivateKey(computador.signingPrivateKey, HOME),
  }
}

describe("gateway: revogar um aparelho", () => {
  it("hello.ok anuncia a capacidade", async () => {
    const client = await TestClient.connect(gatewayUrl)
    client.send({ t: "hello", version: PROTOCOL_VERSION })
    expect((await client.nextOf("hello.ok")).capabilities).toContain(CAPACIDADE_REVOGACAO)
    client.close()
  })

  it("o revogado que está ligado sai já, com device-revoked, e o que revoga fica", async () => {
    const { computador, telemovel } = conta()
    const a = await entrar(computador)
    expect(a.resposta.t).toBe("auth.ok")
    const b = await entrar(telemovel)
    expect(b.resposta.t).toBe("auth.ok")
    expect((await publicar(a.client, manifesto(computador, 1, [computador, telemovel]))).ok).toBe(true)

    expect(await publicar(a.client, manifesto(computador, 2, [computador]), [telemovel])).toMatchObject({ ok: true, version: 2 })
    expect(await b.client.nextOf("error")).toMatchObject({ code: "device-revoked", fatal: true })
    await b.client.esperarFecho()
    expect(b.client.fechado).toBe(true)

    // Who was revoked stays connected and served.
    await a.client.sync()
    expect(a.client.fechado).toBe(false)
    a.client.close()
  })

  it("o revogado não volta a entrar: recusado antes do desafio", async () => {
    const { computador, telemovel } = conta()
    const a = await entrar(computador)
    expect((await publicar(a.client, manifesto(computador, 1, [computador, telemovel]))).ok).toBe(true)
    expect((await publicar(a.client, manifesto(computador, 2, [computador]), [telemovel])).ok).toBe(true)

    const b = await entrar(telemovel)
    expect(b.resposta).toMatchObject({ t: "error", code: "device-revoked", fatal: true })
    await b.client.esperarFecho()
    // And did not get logged as a seen device.
    const vistos = enclave.store.devicesOf(computador.address).map((k) => toBase64(k))
    expect(vistos).not.toContain(toBase64(telemovel.deviceSigningPublicKey))
    a.client.close()
  })

  it("os pacotes do revogado saem do bundle: quem convida já não os recebe", async () => {
    const { computador, telemovel } = conta()
    const a = await entrar(computador)
    const b = await entrar(telemovel)
    expect((await publicar(a.client, manifesto(computador, 1, [computador, telemovel]))).ok).toBe(true)
    a.client.send({ t: "keypackage.publish", packages: [toBase64(new Uint8Array([1]))], replace: false })
    b.client.send({
      t: "keypackage.publish",
      packages: [toBase64(new Uint8Array([2])), toBase64(new Uint8Array([3]))],
      replace: false,
    })
    await a.client.sync()
    await b.client.sync()
    expect(enclave.store.availableKeyPackages(computador.address, telemovel.deviceSigningPublicKey)).toBe(2)

    expect((await publicar(a.client, manifesto(computador, 2, [computador]), [telemovel])).ok).toBe(true)
    expect(enclave.store.availableKeyPackages(computador.address, telemovel.deviceSigningPublicKey)).toBe(0)

    const terceiro = await entrar(generateIdentity(HOME))
    terceiro.client.send({ t: "keypackage.claim", address: computador.address, bundle: true })
    const claimed = await terceiro.client.nextOf("keypackage.claimed")
    expect(claimed.keyPackages?.map((p) => p.deviceKey)).toEqual([toBase64(computador.deviceSigningPublicKey)])
    a.client.close()
    terceiro.client.close()
  })

  it("nenhum manifesto da conta o volta a pôr: revoked-device, e o guardado fica", async () => {
    const { computador, telemovel } = conta()
    const a = await entrar(computador)
    expect((await publicar(a.client, manifesto(computador, 1, [computador, telemovel]))).ok).toBe(true)
    expect((await publicar(a.client, manifesto(computador, 2, [computador]), [telemovel])).ok).toBe(true)
    expect(await publicar(a.client, manifesto(computador, 3, [computador, telemovel]))).toMatchObject({
      ok: false,
      reason: "revoked-device",
    })
    expect(enclave.store.deviceManifestOf(computador.address)?.version).toBe(2)
    a.client.close()
  })

  it("um 0.5.7 corta o telemóvel pelo tecto (sem `revoke`): o telemóvel continua ligado e volta a entrar (I2)", async () => {
    const { computador, telemovel } = conta()
    const a = await entrar(computador)
    const b = await entrar(telemovel)
    expect((await publicar(a.client, manifesto(computador, 1, [computador, telemovel]))).ok).toBe(true)
    expect(await publicar(a.client, manifesto(computador, 2, [computador]))).toMatchObject({ ok: true, version: 2 })
    // It was not closed: the pong arrives, not a device-revoked.
    await b.client.sync()
    expect(b.client.fechado).toBe(false)
    expect(enclave.store.isDeviceRevoked(computador.address, telemovel.deviceSigningPublicKey)).toBe(false)
    b.client.close()
    await b.client.esperarFecho()
    // A new connection comes in, and the next manifest can put it back.
    const outraVez = await entrar(telemovel)
    expect(outraVez.resposta.t).toBe("auth.ok")
    expect((await publicar(a.client, manifesto(computador, 3, [computador, telemovel]))).ok).toBe(true)
    a.client.close()
    outraVez.client.close()
  })

  it("um aparelho que ainda não está no manifesto entra (o emparelhado antes do pronto)", async () => {
    const { computador, telemovel, novo } = conta()
    const a = await entrar(computador)
    expect((await publicar(a.client, manifesto(computador, 1, [computador, telemovel]))).ok).toBe(true)
    expect((await publicar(a.client, manifesto(computador, 2, [computador]), [telemovel])).ok).toBe(true)
    const c = await entrar(novo)
    expect(c.resposta.t).toBe("auth.ok")
    // And adding it later is not refused.
    expect((await publicar(a.client, manifesto(computador, 3, [computador, novo]))).ok).toBe(true)
    a.client.close()
    c.client.close()
  })

  it("uma trama de pacotes de uma ligação revogada a meio fecha-a, e não publica nada", async () => {
    const { computador, telemovel } = conta()
    const a = await entrar(computador)
    const b = await entrar(telemovel)
    expect((await publicar(a.client, manifesto(computador, 1, [computador, telemovel]))).ok).toBe(true)
    // Direct revoke in the vault, without going through the gate: it is the frame
    // that arrives between the manifest and the connection close.
    enclave.store.putDeviceManifest(manifesto(computador, 2, [computador]), [toBase64(telemovel.deviceSigningPublicKey)])
    b.client.send({ t: "keypackage.publish", packages: [toBase64(new Uint8Array([9]))], replace: false })
    expect(await b.client.nextOf("error")).toMatchObject({ code: "device-revoked" })
    await b.client.esperarFecho()
    expect(enclave.store.availableKeyPackages(computador.address, telemovel.deviceSigningPublicKey)).toBe(0)
    a.client.close()
  })

  it("e o mesmo para um claim", async () => {
    const { computador, telemovel } = conta()
    const a = await entrar(computador)
    const b = await entrar(telemovel)
    expect((await publicar(a.client, manifesto(computador, 1, [computador, telemovel]))).ok).toBe(true)
    enclave.store.putDeviceManifest(manifesto(computador, 2, [computador]), [toBase64(telemovel.deviceSigningPublicKey)])
    b.client.send({ t: "keypackage.claim", address: computador.address, bundle: true })
    expect(await b.client.nextOf("error")).toMatchObject({ code: "device-revoked" })
    await b.client.esperarFecho()
    a.client.close()
  })
})

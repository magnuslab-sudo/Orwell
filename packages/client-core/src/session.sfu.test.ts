import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The gate to SFU passage, seen from the client side.
 *
 * The deployment rule is server first, client second, same as the device chain
 * restart, and it only works if the new client is indistinguishable from the
 * old one while the server says nothing. That is what these tests measure, and
 * it is not a formality: a client that assumes SFU because its version knows how
 * will negotiate with a port that does not exist, and what the person sees is a
 * call that never connects against the same server that worked yesterday.
 *
 * The least obvious case is the third one, and it is what forces this to be a
 * getter and not a stored flag: a server can GO BACKWARDS. A production rollback,
 * an old container coming up, a media worker that died, and the next connection
 * must close the gate on its own, without anyone remembering to close it by hand.
 */

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

interface Sent {
  t: string
  [key: string]: unknown
}

class FakeSocket {
  static last: FakeSocket | null = null
  /** What the current server says it can do. */
  static capacidades: string[] = []

  readyState = 0
  readonly sent: Sent[] = []
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    FakeSocket.last = this
    setTimeout(() => {
      this.readyState = 1
      this.#fire("open", {})
    }, 0)
  }

  addEventListener(kind: string, handler: (event: unknown) => void, options?: { once?: boolean }): void {
    const wrapped = options?.once
      ? (event: unknown): void => {
          this.removeEventListener(kind, wrapped)
          handler(event)
        }
      : handler
    this.#listeners.set(kind, [...(this.#listeners.get(kind) ?? []), wrapped])
  }

  removeEventListener(kind: string, handler: (event: unknown) => void): void {
    this.#listeners.set(kind, (this.#listeners.get(kind) ?? []).filter((item) => item !== handler))
  }

  send(raw: string): void {
    const frame = JSON.parse(raw) as Sent
    this.sent.push(frame)
    for (const reply of resposta(frame) ?? []) {
      setTimeout(() => this.#fire("message", { data: JSON.stringify(reply) }), 0)
    }
  }

  close(): void {
    this.readyState = 3
    this.#fire("close", {})
  }

  #fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

/** A healthy server that announces exactly what `FakeSocket.capacidades` says. */
function resposta(frame: Sent): unknown[] | undefined {
  if (frame.t === "hello") return [{ t: "hello.ok", version: 1, capabilities: FakeSocket.capacidades }]
  if (frame.t === "auth.begin") return [{ t: "auth.challenge", nonce: "AAAA" }]
  if (frame.t === "auth.finish") return [{ t: "auth.ok", address: "@x:localhost" }]
  return undefined
}

async function sessao(): Promise<Session> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  await session.createIdentity("localhost:8448")
  return session
}

async function assentar(vezes = 40): Promise<void> {
  for (let index = 0; index < vezes; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  FakeSocket.capacidades = ["mls", "federation", "voice-sframe", "presence"]
  FakeSocket.last = null
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

describe("o portão da capacidade sfu", () => {
  it("contra um servidor que não a anuncia, fica fechado — e o resto funciona como sempre", async () => {
    const session = await sessao()
    await session.connect()
    await assentar()

    // This is the server in production today. A new client against it
    // must behave exactly like the old client: mesh.
    expect(session.suportaSfu).toBe(false)
    // And the connection is a normal connection, there is no degradation along
    // the way, which is the other half of the promise.
    expect(session.connection).toBe("online")
    expect(session.serverCapabilities).toContain("presence")

    session.disconnect()
  }, 60_000)

  it("um servidor que nunca ouviu falar de capacidades também não abre nada", async () => {
    // The empty list is what the oldest servers in this repo send.
    // "Did not say" must read as "does not have", never as "maybe".
    FakeSocket.capacidades = []
    const session = await sessao()
    await session.connect()
    await assentar()

    expect(session.suportaSfu).toBe(false)
    expect(session.connection).toBe("online")

    session.disconnect()
  }, 60_000)

  it("com a capacidade anunciada, abre", async () => {
    FakeSocket.capacidades = ["mls", "presence", "sfu"]
    const session = await sessao()
    await session.connect()
    await assentar()

    expect(session.suportaSfu).toBe(true)

    session.disconnect()
  }, 60_000)

  it("e uma reversão do servidor volta a fechá-lo, sem ninguém lhe mexer", async () => {
    FakeSocket.capacidades = ["mls", "presence", "sfu"]
    const session = await sessao()
    await session.connect()
    await assentar()
    expect(session.suportaSfu).toBe(true)

    // The old container comes back up. The client is the same, the vault is the
    // same, and the only thing that changed is on the other end of the wire.
    session.disconnect()
    await assentar(5)
    FakeSocket.capacidades = ["mls", "presence"]
    await session.connect()
    await assentar()

    expect(session.suportaSfu).toBe(false)

    session.disconnect()
  }, 60_000)
})

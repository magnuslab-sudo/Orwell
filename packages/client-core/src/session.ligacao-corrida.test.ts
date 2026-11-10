import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * `connect()` racing with backoff (phase 4 review, 20/10/2026).
 *
 * Three failures with the same result, the good socket closed by the wrong party:
 *  - the backoff timer, scheduled before a "Connect now", fired
 *    after and opened a new connection over the good one;
 *  - two `connect()` in the same tick: the second closed the first while CONNECTING,
 *    that fired `error`, and the first's `catch` erased the second's socket
 *    and scheduled a reconnection;
 *  - the reconnection replaced an already open socket.
 *
 * The WebSocket is fake and obedient: it opens when the test says, and closing it while
 * CONNECTING fires `error` and then `close`, like in a browser.
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
  static todos: FakeSocket[] = []
  /** Opens on its own on the next tick, or stays CONNECTING until `abrir()`/`falhar()`. */
  static abreSozinho = true
  /** Opens but does not respond to anything: stays stuck on the handshake. */
  static mudo = false

  readonly mudo = FakeSocket.mudo

  readyState = 0
  fechadoPorQuem: "teste" | "sessao" | null = null
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    FakeSocket.todos.push(this)
    if (FakeSocket.abreSozinho) setTimeout(() => this.abrir(), 0)
  }

  abrir(): void {
    if (this.readyState !== 0) return
    this.readyState = 1
    this.#fire("open", {})
  }

  /** The server does not respond: `error` before opening, and no `close` (as `connect` expects). */
  falhar(): void {
    if (this.readyState !== 0) return
    this.readyState = 3
    this.#fire("error", {})
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
    if (this.readyState !== 1) throw new Error("InvalidStateError")
    const frame = JSON.parse(raw) as Sent
    if (this.mudo) return
    const respostas: unknown[] =
      frame.t === "hello"
        ? [{ t: "hello.ok", version: 1, capabilities: [], retentionDays: 30 }]
        : frame.t === "auth.begin"
          ? [{ t: "auth.challenge", nonce: "AAAA" }]
          : frame.t === "auth.finish"
            ? [{ t: "auth.ok", address: "@x:localhost:8448" }]
            : []
    for (const resposta of respostas) setTimeout(() => this.#fire("message", { data: JSON.stringify(resposta) }), 0)
  }

  close(): void {
    const estava = this.readyState
    if (estava === 3) return
    this.fechadoPorQuem ??= "sessao"
    this.readyState = 3
    // Closing while CONNECTING is an error in a browser, and arrives as `error` first.
    if (estava === 0) this.#fire("error", {})
    this.#fire("close", {})
  }

  #fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

async function assentar(vezes = 40): Promise<void> {
  for (let i = 0; i < vezes; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}
const esperar = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let abertas: Session[] = []

async function sessao(): Promise<Session> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  await session.createIdentity("localhost:8448")
  return session
}

beforeEach(() => {
  FakeSocket.todos = []
  FakeSocket.abreSozinho = true
  FakeSocket.mudo = false
  abertas = []
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  for (const session of abertas) session.disconnect()
  abertas = []
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

describe("connect() em corrida", () => {
  it("dois connect() seguidos: o segundo fica com a ligação, e nada a fecha depois", async () => {
    const session = await sessao()
    FakeSocket.abreSozinho = false
    // The error caught already, so the rejection does not sit orphaned while waiting.
    const primeiro = session.connect().then(
      () => null,
      (erro: unknown) => erro,
    )
    const segundo = session.connect()
    // Both sockets are born after each one's `restore`.
    for (let volta = 0; volta < 200 && FakeSocket.todos.length < 2; volta++) await assentar(1)
    expect(FakeSocket.todos).toHaveLength(2)
    const [a, b] = FakeSocket.todos
    // The first was closed while CONNECTING by the second, and fired `error`.
    expect(a?.readyState).toBe(3)
    expect(String(await primeiro)).toContain("the connection was replaced")
    b?.abrir()
    await segundo
    await assentar(80)
    expect(session.connection).toBe("online")
    // More time than the first backoff (500 to 1000 ms): no reconnection
    // scheduled by the first opens a third socket or closes the second.
    await esperar(1_300)
    expect(FakeSocket.todos).toHaveLength(2)
    expect(b?.readyState).toBe(1)
  })

  it("um temporizador de recuo pendente não dispara depois de um connect() de fora", async () => {
    const session = await sessao()
    FakeSocket.abreSozinho = false
    const falhado = session.connect().then(
      () => null,
      (erro: unknown) => erro,
    )
    for (let volta = 0; volta < 200 && FakeSocket.todos.length < 1; volta++) await assentar(1)
    FakeSocket.todos[0]?.falhar()
    expect(String(await falhado)).toContain("could not reach the homeserver")
    expect(session.connection).toBe("reconnecting")
    // The backoff is scheduled. "Connect now":
    FakeSocket.abreSozinho = true
    await session.connect()
    await assentar(80)
    expect(session.connection).toBe("online")
    const bom = FakeSocket.todos[1]
    await esperar(1_300)
    expect(FakeSocket.todos).toHaveLength(2)
    expect(bom?.readyState).toBe(1)
  })

  it('substituído a meio do handshake, o socket velho sai calado: sem "reconnecting" nem handshake-failed', async () => {
    const session = await sessao()
    const estados: string[] = []
    const falhas: string[] = []
    session.on("connection", (evento) => estados.push(evento.state))
    session.on("status", (evento) => {
      if (evento.code === "handshake-failed") falhas.push(evento.detail)
    })
    // A opens and stays on the handshake, waiting for a `hello.ok` that never comes.
    FakeSocket.mudo = true
    const velho = session.connect().then(
      () => null,
      (erro: unknown) => erro,
    )
    for (let volta = 0; volta < 200 && FakeSocket.todos[0]?.readyState !== 1; volta++) await assentar(1)
    await assentar(5)
    expect(FakeSocket.todos[0]?.readyState).toBe(1)
    // «Ligar agora»: B responde.
    FakeSocket.mudo = false
    const desde = estados.length
    await session.connect()
    await velho
    await assentar(80)
    expect(session.connection).toBe("online")
    expect(estados.slice(desde)).not.toContain("reconnecting")
    expect(falhas).toEqual([])
    await esperar(1_300)
    expect(FakeSocket.todos).toHaveLength(2)
    expect(FakeSocket.todos[1]?.readyState).toBe(1)
  })

  it("sem escrita, connect() recusa, e escreve() di-lo", async () => {
    const session = await sessao()
    expect(session.escreve()).toBe(true)
    session.pararDeEscrever()
    expect(session.escreve()).toBe(false)
    await expect(session.connect()).rejects.toThrow("this tab no longer writes")
    expect(FakeSocket.todos).toHaveLength(0)
  })
})

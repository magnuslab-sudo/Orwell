import { moradaDeTeste } from "../testes/moradas.js"
import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The socket dies and comes back. What does the session subscribe to again?
 *
 * The complaint this chases: *"the app was open, I sent a message, it shows
 * on mine, not on theirs"*. One way this happens without any error is a
 * channel falling out of subscription after a reconnect, the app keeps
 * showing it in the sidebar, the server stops sending it live, and
 * neither side has any way to know.
 *
 * The question is literal and measurable: **is the list that goes in
 * `channel.subscribe` on the new connection equal to the list the session
 * says it has?** `session.channels` reads the in-memory map; `restore()` reads
 * the vault. Wherever the two diverge, there's a silent channel.
 */

class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  escritas = 0
  /** Refuse writes, like a full IndexedDB. See `flush`. */
  cheio = false

  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.escritas += 1
    if (this.cheio) throw new Error("QuotaExceededError")
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
  static get last(): FakeSocket | undefined {
    return FakeSocket.todos[FakeSocket.todos.length - 1]
  }

  readyState = 0
  readonly sent: Sent[] = []
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    FakeSocket.todos.push(this)
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
    if (this.readyState !== 1) throw new Error("socket fechado")
    const frame = JSON.parse(raw) as Sent
    this.sent.push(frame)
    for (const reply of resposta(frame) ?? []) {
      setTimeout(() => this.#fire("message", { data: JSON.stringify(reply) }), 0)
    }
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.#fire("close", {})
  }

  #fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

function resposta(frame: Sent): unknown[] | undefined {
  if (frame.t === "hello") return [{ t: "hello.ok", version: 1, capabilities: [] }]
  if (frame.t === "auth.begin") return [{ t: "auth.challenge", nonce: "AAAA" }]
  if (frame.t === "auth.finish") return [{ t: "auth.ok", address: "@x:localhost:8448" }]
  if (frame.t === "channel.backfill") {
    return [{ t: "channel.backfill.page", channel: frame.channel, more: false, events: [] }]
  }
  return undefined
}

const GERAL = moradaDeTeste("geral")
const FOTOS = moradaDeTeste("fotos")

let abertas: Session[] = []

async function assentar(vezes = 60): Promise<void> {
  for (let i = 0; i < vezes; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Wait for a NEW connection, with the backoff from `#scheduleReconnect` in between. */
async function esperarLigacaoNova(quantasHavia: number): Promise<FakeSocket> {
  for (let i = 0; i < 80; i++) {
    if (FakeSocket.todos.length > quantasHavia) {
      await assentar(80)
      const nova = FakeSocket.last
      if (nova) return nova
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("a sessão nunca voltou a ligar-se")
}

function canaisSubscritos(socket: FakeSocket): string[] {
  return socket.sent
    .filter((frame) => frame.t === "channel.subscribe")
    .flatMap((frame) => frame.channels as string[])
}

async function sessaoComDoisCanais(): Promise<{ session: Session; backend: MemoryBackend }> {
  const backend = new MemoryBackend()
  const vault = new Vault(backend)
  await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  await session.createIdentity("localhost:8448")
  await session.connect()
  await assentar(30)
  await session.createSpaceChannel(GERAL)
  await session.createSpaceChannel(FOTOS)
  await session.flush()
  await assentar(30)
  return { session, backend }
}

beforeEach(() => {
  FakeSocket.todos = []
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  for (const session of abertas) session.disconnect()
  abertas = []
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

describe("reconexão: o que volta a ser subscrito", () => {
  it("uma ligação que cai e volta subscreve tudo o que a sessão diz ter", async () => {
    const { session } = await sessaoComDoisCanais()
    const antes = FakeSocket.todos.length

    FakeSocket.last?.close()
    const nova = await esperarLigacaoNova(antes)

    expect(canaisSubscritos(nova).sort()).toEqual([...session.channels].sort())
  }, 120_000)

  it("nem um canal criado com o cofre a recusar gravações, que é onde eu esperava encontrar o buraco", async () => {
    const { session, backend } = await sessaoComDoisCanais()

    /*
      Where I looked, and why it wasn't there, it's worth written down more than
      suspicion, because suspicion comes back.

      `restore()` builds the list for `channel.subscribe` from the vault;
      `session.channels` (what the sidebar shows) comes from the in-memory map.
      If the two diverged, there was a visible silent channel, with no warning.
      Diverging requires `#groups` to have a channel that `contents.groups` doesn't
      have, and can't, for two reasons worth not undoing without replacing this
      measurement:

      1. The only two places that write to `#groups` are `#persistGroup` and
         `restore()`, and every path that CREATES a channel (`createSpaceChannel`,
         `#acceptWelcome`) calls `flush()` before subscribing.
      2. `Vault.update` alters `contents` in memory BEFORE trying to save.
         A full vault, the realistic failure, and it's stated that way in the
         `flush` `catch`, loses the disk and doesn't lose the `contents`.

      So a full vault here separates nothing: it's the worst case I could build
      and the channel stays subscribed.
    */
    backend.cheio = true
    const NOVO = moradaDeTeste("novo")
    await session.createSpaceChannel(NOVO).catch(() => {})
    await assentar(10)

    expect(session.channels).toContain(NOVO)

    const antes = FakeSocket.todos.length
    FakeSocket.last?.close()
    const nova = await esperarLigacaoNova(antes)

    // If it ever falls out, nothing arrives and the sidebar keeps showing it.
    // It's the failure that gives no signal, and this test is what catches it.
    expect(canaisSubscritos(nova)).toContain(NOVO)
  }, 120_000)
})

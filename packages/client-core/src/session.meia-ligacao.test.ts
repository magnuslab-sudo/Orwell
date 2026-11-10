import { moradaDeTeste } from "../testes/moradas.js"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The half-open connection (1.3.6): the socket says it is open, and nothing
 * gets through.
 *
 * The complaint: on the phone "it does not sync" and "I cannot send direct
 * messages". The system suspends the page, the network changes underneath
 * (Wi-Fi to mobile data), and the socket stays `OPEN` without ever firing
 * `close`. The app said "connected" and whatever was written went nowhere.
 *
 * What this measures: with the socket silent in both directions and NO
 * `close`, the check detects the death, the connection stops calling itself
 * "online", it connects again, and the new connection asks again for what was
 * missed. And a send made during the check does not go out to the dead socket:
 * it waits and fails as "no connection", which is what makes the interface
 * queue the message.
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
  static get last(): FakeSocket | undefined {
    return FakeSocket.todos[FakeSocket.todos.length - 1]
  }

  readyState = 0
  /** Silent: accepts what it is sent and neither answers nor closes. The half-open connection. */
  mudo = false
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
    if (this.mudo) return
    for (const reply of resposta(frame) ?? []) {
      setTimeout(() => {
        if (!this.mudo) this.#fire("message", { data: JSON.stringify(reply) })
      }, 0)
    }
  }

  /** A half-open socket does not say it closed: `close()` fires nothing. */
  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    if (!this.mudo) this.#fire("close", {})
  }

  #fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

function resposta(frame: Sent): unknown[] | undefined {
  if (frame.t === "hello") return [{ t: "hello.ok", version: 1, capabilities: [] }]
  if (frame.t === "auth.begin") return [{ t: "auth.challenge", nonce: "AAAA" }]
  if (frame.t === "auth.finish") return [{ t: "auth.ok", address: "@x:localhost:8448" }]
  if (frame.t === "ping") return [{ t: "pong" }]
  if (frame.t === "channel.backfill") {
    return [{ t: "channel.backfill.page", channel: frame.channel, more: false, events: [] }]
  }
  return undefined
}

const GERAL = moradaDeTeste("geral")

let abertas: Session[] = []

async function assentar(vezes = 60): Promise<void> {
  for (let i = 0; i < vezes; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

async function esperar(condicao: () => boolean, ms = 10_000): Promise<void> {
  const ate = Date.now() + ms
  while (!condicao()) {
    if (Date.now() > ate) throw new Error("a condição nunca chegou")
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function sessaoLigada(): Promise<Session> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  await session.createIdentity("localhost:8448")
  await session.connect()
  await assentar(30)
  await session.createSpaceChannel(GERAL)
  await session.flush()
  await assentar(30)
  return session
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

describe("a ligação meio aberta", () => {
  it("uma ligação viva responde ao ping, e fica como estava", async () => {
    const session = await sessaoLigada()
    const antes = FakeSocket.todos.length
    expect(await session.verificarLigacao(500)).toBe(true)
    expect(session.connection).toBe("online")
    expect(FakeSocket.todos.length).toBe(antes)
  }, 60_000)

  it("um socket mudo nos dois sentidos, sem close: dá pela morte, deixa de dizer online, e liga outra vez", async () => {
    const session = await sessaoLigada()
    const morto = FakeSocket.last!
    const antes = FakeSocket.todos.length
    const estados: string[] = []
    session.on("connection", ({ state }) => estados.push(state))

    morto.mudo = true
    // Without the check, nothing changes: that is the fault. The state stays "online".
    await assentar(20)
    expect(session.connection).toBe("online")

    expect(await session.verificarLigacao(200)).toBe(false)
    // Right after the death, the state is no longer "online".
    expect(estados[0]).not.toBe("online")
    expect(morto.readyState).toBe(3)

    // And it connects again, without waiting for the full backoff.
    await esperar(() => FakeSocket.todos.length > antes && session.connection === "online")
    const nova = FakeSocket.last!
    expect(nova).not.toBe(morto)
    // The new connection asks again for what was missed: it subscribes and recovers the channel.
    await esperar(() => nova.sent.some((frame) => frame.t === "channel.backfill" && frame.channel === GERAL))
    expect(nova.sent.some((frame) => frame.t === "channel.subscribe")).toBe(true)
  }, 60_000)

  it("um envio feito durante a verificação não sai para o socket morto: falha como sem ligação", async () => {
    const session = await sessaoLigada()
    const morto = FakeSocket.last!
    morto.mudo = true
    const enviadasAntes = morto.sent.length

    const verificacao = session.verificarLigacao(200)
    const envio = session.send(GERAL, { t: "message", id: "mensagem-1", sentAt: 1, body: "olá", attachments: [], links: [], mentions: [] })

    expect(await verificacao).toBe(false)
    await expect(envio).rejects.toThrow("the connection dropped")
    // Only the ping went to the dead socket.
    expect(morto.sent.slice(enviadasAntes).map((frame) => frame.t)).toEqual(["ping"])
  }, 60_000)

  it("e com a ligação viva, o envio feito durante a verificação espera e sai", async () => {
    const session = await sessaoLigada()
    const vivo = FakeSocket.last!
    const verificacao = session.verificarLigacao(500)
    const envio = session.send(GERAL, { t: "message", id: "mensagem-2", sentAt: 1, body: "olá", attachments: [], links: [], mentions: [] })
    expect(await verificacao).toBe(true)
    await envio
    expect(vivo.sent.map((frame) => frame.t)).toContain("channel.send")
  }, 60_000)

  it("um envio depois de um silêncio longo verifica a ligação antes de sair", async () => {
    // The iPhone does not always say the page came back (no `visibilitychange` on
    // unlocking an installed app). The socket's silence says the rest.
    const antes = Session.SILENCIO_ANTES_DE_VERIFICAR_MS
    try {
      const session = await sessaoLigada()
      const morto = FakeSocket.last!
      morto.mudo = true
      const enviadasAntes = morto.sent.length
      Session.SILENCIO_ANTES_DE_VERIFICAR_MS = 0
      Session.PRAZO_DA_VERIFICACAO_MS = 200
      const envio = session.send(GERAL, { t: "message", id: "mensagem-3", sentAt: 1, body: "olá", attachments: [], links: [], mentions: [] })
      await expect(envio).rejects.toThrow("the connection dropped")
      expect(morto.sent.slice(enviadasAntes).map((frame) => frame.t)).toEqual(["ping"])
      await esperar(() => FakeSocket.last !== morto && session.connection === "online")
    } finally {
      Session.SILENCIO_ANTES_DE_VERIFICAR_MS = antes
      Session.PRAZO_DA_VERIFICACAO_MS = 5_000
    }
  }, 60_000)

  it("sem ligação não há nada a verificar: responde false sem mandar nada", async () => {
    const session = await sessaoLigada()
    session.disconnect()
    expect(await session.verificarLigacao(200)).toBe(false)
  }, 60_000)
})

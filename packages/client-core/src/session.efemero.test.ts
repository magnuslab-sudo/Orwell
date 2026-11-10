import { moradaDeTeste } from "../testes/moradas.js"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * What is ephemeral is not a thing said.
 *
 * The write signal and the nudge cross the same encrypted group as messages, and
 * that is why they need an explicit cut: without it they enter the conversation
 * thread like anything else that leaves the group. The failure gives no error.
 * It gives a conversation with "is typing" recorded inside, and a nudge from
 * yesterday shaking the screen of whoever opens the app today.
 *
 * **This file connects the session to a fake socket on purpose.** The temptation
 * is to test this offline, where `send` encrypts and saves without needing the
 * network; but offline the send breaks BEFORE the line that emits the event, and
 * a test that way still passes with the cut removed. It proves nothing. With the
 * connection up, `send` reaches the end, and what you observe is what the
 * interface would receive.
 *
 * The second reason the cut exists is cost, and you do not see that in a short
 * test: the history has 400 slots per channel and backfill comes from it. An
 * active conversation produces write signals by the hundreds.
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

interface Frame {
  t: string
  [key: string]: unknown
}

/** A server that accepts the handshake and swallows everything else without complaint. */
class FakeSocket {
  static last: FakeSocket | null = null

  readyState = 0
  readonly sent: Frame[] = []
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    FakeSocket.last = this
    setTimeout(() => {
      this.readyState = 1
      this.fire("open", {})
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
    this.#listeners.set(
      kind,
      (this.#listeners.get(kind) ?? []).filter((item) => item !== handler),
    )
  }

  send(raw: string): void {
    const frame = JSON.parse(raw) as Frame
    this.sent.push(frame)
    if (frame.t === "hello") {
      this.answer({ t: "hello.ok", version: 1, capabilities: [] })
    } else if (frame.t === "auth.begin") {
      this.answer({ t: "auth.challenge", nonce: "AAAA" })
    } else if (frame.t === "auth.finish") {
      this.answer({ t: "auth.ok", address: "@x:localhost" })
    }
  }

  answer(frame: unknown): void {
    setTimeout(() => this.fire("message", { data: JSON.stringify(frame) }), 0)
  }

  close(): void {
    this.readyState = 3
    this.fire("close", {})
  }

  fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

async function settle(times = 60): Promise<void> {
  for (let index = 0; index < times; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const CANAL = moradaDeTeste("sala")

/** Session connected, with vault and MLS group for real. */
async function sessaoLigada(): Promise<Session> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  await session.createIdentity("localhost:8448")
  await session.connect()
  await settle()
  await session.createSpaceChannel(CANAL).catch(() => {})
  await settle()
  return session
}

beforeEach(() => {
  FakeSocket.last = null
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

/** The frames the session put on the wire for this channel. */
function enviados(): Frame[] {
  return (FakeSocket.last?.sent ?? []).filter((frame) => frame.t === "channel.send")
}

describe("o sinal de escrita e a cotovelada, do lado de quem os envia", () => {
  it("saem para o fio como qualquer outra coisa — o corte não é deixar de os enviar", async () => {
    // Guard against the wrong fix: muting the send killed the feature instead of
    // keeping it out of history.
    const session = await sessaoLigada()
    // Creating the channel already put frames on the wire; we count the difference, not the total.
    const antes = enviados().length
    await session.send(CANAL, { t: "typing", until: Date.now() + 6_000 })
    await session.send(CANAL, { t: "buzz", at: Date.now() })
    await settle()

    expect(enviados().length - antes).toBe(2)
  }, 60_000)

  it("mas não entram na nossa própria linha de conversa", async () => {
    // This is the cut doing its job. Without it, our own write signal showed up as
    // a message on the screen of the one who wrote it. Every four seconds, at each phrase.
    const session = await sessaoLigada()
    const vistos: string[] = []
    session.on("message", (event) => vistos.push(event.payload.t))

    await session.send(CANAL, { t: "typing", until: Date.now() + 6_000 })
    await session.send(CANAL, { t: "buzz", at: Date.now() })
    await settle()

    expect(vistos).toEqual([])
  }, 60_000)

  it("e uma mensagem a sério continua a entrar, no meio delas", async () => {
    // The counterpoint that makes the test above valuable: without it, a `send` broken
    // from top to bottom would pass it with flying colors.
    const session = await sessaoLigada()
    const vistos: string[] = []
    session.on("message", (event) => vistos.push(event.payload.t))

    await session.send(CANAL, { t: "typing", until: Date.now() + 6_000 })
    await session.send(CANAL, {
      t: "message",
      id: crypto.randomUUID(),
      sentAt: Date.now(),
      body: "isto é uma coisa dita",
      attachments: [],
      links: [],
      mentions: [],
    })
    await session.send(CANAL, { t: "buzz", at: Date.now() })
    await settle()

    expect(vistos).toEqual(["message"])
  }, 60_000)

  it("nem deixam rasto no cofre, que é de onde o backfill sai", async () => {
    const session = await sessaoLigada()

    for (let index = 0; index < 20; index++) {
      await session.send(CANAL, { t: "typing", until: Date.now() + 6_000 })
      await session.send(CANAL, { t: "buzz", at: Date.now() })
    }
    await settle()

    expect(session.history(CANAL)).toEqual([])
  }, 120_000)
})

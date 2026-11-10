import type { FichaDoCanal } from "./tipoDoCanal.js"
import { darFicha, moradaNova } from "../testes/moradas.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The common room, on the client side.
 *
 * Three distinct things, and the first is what matters: the client drops the
 * guard that prevents someone from being seated in a channel where they never
 * were, and drops it for an identifier told to them BY THE SERVER. The rest is
 * the path enduring the real world, who arrives before the room exists, who
 * loses the vault, who requests and has no one to admit them.
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

type Reply = (frame: Sent) => unknown[] | undefined

class FakeSocket {
  static last: FakeSocket | null = null
  static reply: Reply = () => undefined

  readyState = 0
  readonly sent: Sent[] = []
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
    this.#listeners.set(kind, (this.#listeners.get(kind) ?? []).filter((item) => item !== handler))
  }

  send(raw: string): void {
    const frame = JSON.parse(raw) as Sent
    this.sent.push(frame)
    const replies = FakeSocket.reply(frame)
    for (const reply of replies ?? []) {
      setTimeout(() => this.fire("message", { data: JSON.stringify(reply) }), 0)
    }
  }

  /** A frame that the server sends on its own initiative. */
  deliver(frame: unknown): void {
    this.fire("message", { data: JSON.stringify(frame) })
  }

  close(): void {
    this.readyState = 3
    this.fire("close", {})
  }

  fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

const SALA = moradaNova()

/** The healthy handshake, with the common room announced. */
function respostaBase(sala: string | undefined): Reply {
  return (frame) => {
    if (frame.t === "hello") {
      return [{ t: "hello.ok", version: 1, capabilities: [], ...(sala ? { commonRoom: sala } : {}) }]
    }
    if (frame.t === "auth.begin") return [{ t: "auth.challenge", nonce: "AAAA" }]
    if (frame.t === "auth.finish") return [{ t: "auth.ok", address: "@x:localhost" }]
    return undefined
  }
}

async function sessaoLigada(
  sala: string | undefined,
  extra: Reply = () => undefined,
  ficha: FichaDoCanal = { tipo: "sala" },
): Promise<Session> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  await session.createIdentity("localhost:8448")
  // The slot of the announced channel, before it is born (the first slot).
  if (sala) darFicha(vault.contents, sala, ficha)
  const base = respostaBase(sala)
  FakeSocket.reply = (frame) => base(frame) ?? extra(frame)
  await session.connect()
  await settle()
  return session
}

async function settle(times = 60): Promise<void> {
  for (let index = 0; index < times; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

function enviados(kind: string): Sent[] {
  return (FakeSocket.last?.sent ?? []).filter((frame) => frame.t === kind)
}

beforeEach(() => {
  FakeSocket.reply = respostaBase(undefined)
  FakeSocket.last = null
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

describe("a guarda que a sala comum relaxa", () => {
  it("não é relaxada para um canal privado que o servidor resolva chamar de sala comum", async () => {
    // The scenario: the server (or whoever takes its gateway) announces as common
    // room the private conversation between two people. The address is opaque, but
    // the server knows it: he routes the channel. Then it takes only a disposable
    // account sending a request to re-enter that channel for the first honest
    // member seated in there, forever.
    const dm = moradaNova()
    const session = await sessaoLigada(dm, undefined, { tipo: "directa" })
    await session.createSpaceChannel(dm).catch(() => {})
    await settle()

    const antes = enviados("keypackage.claim").length
    FakeSocket.last?.deliver({ t: "channel.rejoin", channel: dm, address: "@intruso:localhost:8448" })
    await settle()

    // `invite` starts by claiming a key package from the person. None came out:
    // no one was seated.
    expect(enviados("keypackage.claim").length).toBe(antes)
    session.disconnect()
  }, 60_000)

  it("também não para o feed de outra pessoa", async () => {
    const feed = moradaNova()
    const session = await sessaoLigada(feed, undefined, { tipo: "mural", dono: "@vitima:localhost:8448" })
    await session.createSpaceChannel(feed).catch(() => {})
    await settle()

    const antes = enviados("keypackage.claim").length
    FakeSocket.last?.deliver({ t: "channel.rejoin", channel: feed, address: "@intruso:localhost:8448" })
    await settle()

    expect(enviados("keypackage.claim").length).toBe(antes)
    session.disconnect()
  }, 60_000)

  it("continua relaxada para uma sala comum a sério", async () => {
    const session = await sessaoLigada(SALA)
    await session.createSpaceChannel(SALA).catch(() => {})
    await settle()

    const antes = enviados("keypackage.claim").length
    FakeSocket.last?.deliver({ t: "channel.rejoin", channel: SALA, address: "@recemchegado:localhost:8448" })
    await settle()

    expect(enviados("keypackage.claim").length).toBeGreaterThan(antes)
    session.disconnect()
  }, 60_000)
})

describe("entrar na sala comum", () => {
  it("não recria o grupo quando a sala já existe, mesmo sendo nosso o direito de a criar", async () => {
    // The real case: whoever created the room lost the group state, reinstalled the
    // browser, imported the account, or hit "restart rooms". The server still says
    // creation is his job, because the claim was recorded. Creating again makes a
    // new MLS group with the same identifier: everyone who was there goes deaf,
    // with no error anywhere, which is exactly the collision this room came to solve.
    const session = await sessaoLigada(SALA, (frame) =>
      frame.t === "channel.claim"
        ? [{ t: "channel.claim.result", channel: SALA, owner: "@x:localhost", mine: true, empty: false }]
        : undefined,
    )

    expect(session.channels).not.toContain(SALA)
    expect(enviados("channel.rejoin.request").some((frame) => frame.channel === SALA)).toBe(true)
    session.disconnect()
  }, 60_000)

  it("cria o grupo quando a sala ainda não existe", async () => {
    const session = await sessaoLigada(SALA, (frame) =>
      frame.t === "channel.claim"
        ? [{ t: "channel.claim.result", channel: SALA, owner: "@x:localhost", mine: true, empty: true }]
        : undefined,
    )

    expect(session.channels).toContain(SALA)
    session.disconnect()
  }, 60_000)

  it("insiste no pedido de entrada enquanto ninguém o admitir", async () => {
    // The request is a frame and nothing else: the server does not keep it, and
    // only reaches who is subscribed at the exact instant it passes. Whoever arrives
    // at the same time as the creator, the normal case when a group of people
    // opens the app at the same hour, requests before there is anyone to answer,
    // and stayed silent until the next connection. With no one online, it stayed
    // forever.
    vi.useFakeTimers()
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const session = new Session(vault)
    await session.createIdentity("localhost:8448")
    const base = respostaBase(SALA)
    FakeSocket.reply = (frame) =>
      base(frame) ??
      (frame.t === "channel.claim"
        ? [{ t: "channel.claim.result", channel: SALA, owner: "@outro:localhost", mine: false, empty: false }]
        : undefined)

    const ligar = session.connect()
    await vi.advanceTimersByTimeAsync(50)
    await ligar
    await vi.advanceTimersByTimeAsync(50)

    expect(enviados("channel.rejoin.request").length).toBe(1)
    await vi.advanceTimersByTimeAsync(Session.REJOIN_RETRY_MS * 3)
    expect(enviados("channel.rejoin.request").length).toBeGreaterThan(1)

    session.disconnect()
  }, 60_000)
})

/**
 * The card is one-time use, and the server deletes it when delivering it.
 *
 * Whoever picks it up and does not enter leaves the room without a door, and
 * persistence repeats the move at 15 s, at 30 s, at 60 s and from then on every
 * two minutes. An application open with no keys to enter was deleting the door
 * the moment it appeared, for everyone.
 */
describe("o cartão de uso único não se gasta em vão", () => {
  it("não é levantado por quem não tem chaves com que entrar", async () => {
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const session = new Session(vault)
    await session.createIdentity("localhost:8448")

    /*
      A vault with no key packages. It is not a lab hypothesis: handshake
      recovery sits inside a `try` that swallows the failure on purpose, a full
      vault or a refused recording cannot bring down the connection, and what
      follows next is exactly this.
    */
    session.topUpKeyPackages = async () => {}

    FakeSocket.reply = (frame) => {
      if (frame.t === "hello") {
        return [{ t: "hello.ok", version: 1, capabilities: ["common-room-groupinfo"], commonRoom: SALA }]
      }
      if (frame.t === "auth.begin") return [{ t: "auth.challenge", nonce: "AAAA" }]
      if (frame.t === "auth.finish") return [{ t: "auth.ok", address: "@x:localhost" }]
      if (frame.t === "channel.claim") {
        return [{ t: "channel.claim.result", channel: SALA, owner: "@outro:localhost", mine: false, empty: false }]
      }
      return undefined
    }

    await session.connect()
    await settle()

    // The door stays where it was, for whoever has what it takes to use it.
    expect(enviados("channel.groupinfo.take")).toHaveLength(0)
    // And the lower path runs the same: place is requested from members.
    expect(enviados("channel.rejoin.request").length).toBeGreaterThan(0)

    session.disconnect()
  }, 60_000)
})

/**
 * The choice of account (owner request, 3/11/2026): at signup, each person
 * decides if they enter the common channel. With no choice, one enters, as
 * before: this is the case for all accounts that already exist.
 */
describe("a sala comum é uma escolha da conta", () => {
  /** The room already exists and belongs to someone else: whoever arrives requests a place. */
  const deOutro: Reply = (frame) =>
    frame.t === "channel.claim"
      ? [{ t: "channel.claim.result", channel: SALA, owner: "@outro:localhost", mine: false, empty: false }]
      : undefined

  /** The room does not exist yet and it is our job to create it: entry is immediate. */
  const nossa: Reply = (frame) =>
    frame.t === "channel.claim"
      ? [{ t: "channel.claim.result", channel: SALA, owner: "@x:localhost", mine: true, empty: true }]
      : undefined

  /** Echo each send, like the server: it is the receipt that `leaveChannel` expects. */
  let seq = 0
  const comEco =
    (resto: Reply): Reply =>
    (frame) => {
      if (frame.t === "channel.send") {
        return [
          {
            t: "channel.event",
            channel: frame.channel,
            seq: seq++,
            kind: frame.kind,
            ciphertext: frame.ciphertext,
            receivedAtMinute: 0,
            ref: frame.ref,
          },
        ]
      }
      return resto(frame)
    }

  async function sessaoAntesDeLigar(): Promise<{ session: Session; vault: Vault }> {
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const session = new Session(vault)
    await session.createIdentity("localhost:8448")
    darFicha(vault.contents, SALA, { tipo: "sala" })
    return { session, vault }
  }

  it("sem escolha feita, a conta quer a sala (as contas que já existem)", async () => {
    const { session } = await sessaoAntesDeLigar()
    expect(session.querSalaComum()).toBe(true)
  })

  it("quem disse que não, não pede lugar, nem ao ligar, nem pela insistência, nem ao voltar a ligar", async () => {
    vi.useFakeTimers()
    const { session } = await sessaoAntesDeLigar()
    await session.escolherSalaComum(false)
    expect(session.querSalaComum()).toBe(false)

    const base = respostaBase(SALA)
    FakeSocket.reply = (frame) => base(frame) ?? deOutro(frame)
    const ligar = session.connect()
    await vi.advanceTimersByTimeAsync(50)
    await ligar
    await vi.advanceTimersByTimeAsync(Session.REJOIN_RETRY_CEILING_MS * 3)

    expect(enviados("channel.claim")).toHaveLength(0)
    expect(enviados("channel.rejoin.request")).toHaveLength(0)
    expect(enviados("channel.groupinfo.take")).toHaveLength(0)
    expect(session.channels).not.toContain(SALA)

    // Reload and open again is a new connection: the choice is in the vault.
    session.disconnect()
    const outra = session.connect()
    await vi.advanceTimersByTimeAsync(50)
    await outra
    await vi.advanceTimersByTimeAsync(Session.REJOIN_RETRY_CEILING_MS)
    expect(enviados("channel.claim")).toHaveLength(0)
    expect(enviados("channel.rejoin.request")).toHaveLength(0)
    session.disconnect()
  }, 60_000)

  it("a escolha fica no cofre", async () => {
    const { session, vault } = await sessaoAntesDeLigar()
    await session.escolherSalaComum(false)
    expect(vault.contents.preferencias?.["sala-comum"]?.valor).toBe("fora")
  })

  it("sem escolha, a conta entra como antes", async () => {
    const session = await sessaoLigada(SALA, deOutro)
    expect(enviados("channel.claim").length).toBeGreaterThan(0)
    expect(enviados("channel.rejoin.request").length).toBeGreaterThan(0)
    session.disconnect()
  }, 60_000)

  it("quem ficou de fora entra mais tarde pela escolha", async () => {
    const { session } = await sessaoAntesDeLigar()
    await session.escolherSalaComum(false)
    const base = respostaBase(SALA)
    FakeSocket.reply = (frame) => base(frame) ?? nossa(frame)
    await session.connect()
    await settle()
    expect(session.channels).not.toContain(SALA)

    await session.escolherSalaComum(true)
    await settle()
    expect(session.querSalaComum()).toBe(true)
    expect(session.channels).toContain(SALA)
    session.disconnect()
  }, 60_000)

  it("sair do canal comum fica dito: a ligação seguinte não volta a entrar", async () => {
    const session = await sessaoLigada(SALA, comEco(nossa))
    expect(session.channels).toContain(SALA)

    await session.leaveChannel(SALA)
    expect(session.channels).not.toContain(SALA)
    expect(session.querSalaComum()).toBe(false)

    // Before this, it was here that the account re-entered by itself.
    session.disconnect()
    await session.connect()
    await settle()
    expect(enviados("channel.claim")).toHaveLength(0)
    expect(session.channels).not.toContain(SALA)
    session.disconnect()
  }, 60_000)

  it("sair de outro canal não mexe na escolha", async () => {
    const outro = moradaNova()
    const session = await sessaoLigada(SALA, comEco(nossa))
    darFicha(session.vault.contents, outro, { tipo: "sala" })
    await session.createSpaceChannel(outro)
    await settle()
    await session.leaveChannel(outro)
    expect(session.querSalaComum()).toBe(true)
    session.disconnect()
  }, 60_000)
})

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
 * missed.
 *
 * And what 1.3.7 adds, because 1.3.6 in production doubled the reconnections:
 * a late `pong` (6 to 12 s) tears nothing down, any frame proves the socket is
 * alive, no send waits for the check, and an SFU join is not cut by it.
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
  /** How long the `pong` takes (the server answers in order, behind slow work). */
  atrasoDoPong = 0
  /** How long `sfu.scope.joined` takes. */
  atrasoDoSfu = 0
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
    const atraso = frame.t === "ping" ? this.atrasoDoPong : frame.t === "sfu.scope.join" ? this.atrasoDoSfu : 0
    for (const reply of resposta(frame) ?? []) {
      setTimeout(() => this.entregar(reply), atraso)
    }
  }

  /** A server frame, if the socket still carries anything. */
  entregar(trama: unknown): void {
    if (!this.mudo && this.readyState === 1) this.#fire("message", { data: JSON.stringify(trama) })
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
  if (frame.t === "sfu.scope.join") return [{ t: "sfu.scope.joined", ref: frame.ref, rtpCapabilities: {}, producers: [] }]
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

const MENSAGEM = (id: string) => ({ t: "message" as const, id, sentAt: 1, body: "olá", attachments: [], links: [], mentions: [] })

/** The original values, restored after each test that shrinks them. */
const ORIGEM = {
  prazo: Session.PRAZO_DA_VERIFICACAO_MS,
  antesDoPing: Session.SILENCIO_ANTES_DO_PING_MS,
  antesDeVerificar: Session.SILENCIO_ANTES_DE_VERIFICAR_MS,
  ausencia: Session.AUSENCIA_QUE_RELIGA_MS,
}
afterEach(() => {
  Session.PRAZO_DA_VERIFICACAO_MS = ORIGEM.prazo
  Session.SILENCIO_ANTES_DO_PING_MS = ORIGEM.antesDoPing
  Session.SILENCIO_ANTES_DE_VERIFICAR_MS = ORIGEM.antesDeVerificar
  Session.AUSENCIA_QUE_RELIGA_MS = ORIGEM.ausencia
})

describe("a ligação meio aberta", () => {
  it("os prazos de produção: 15 s de espera, 5 s de silêncio antes do ping, 60 s antes de um envio verificar", () => {
    expect(Session.PRAZO_DA_VERIFICACAO_MS).toBe(15_000)
    expect(Session.SILENCIO_ANTES_DO_PING_MS).toBe(5_000)
    expect(Session.SILENCIO_ANTES_DE_VERIFICAR_MS).toBe(60_000)
  })

  it("uma ligação viva responde ao ping, e fica como estava", async () => {
    const session = await sessaoLigada()
    const antes = FakeSocket.todos.length
    expect(await session.verificarLigacao({ silencioMinimoMs: 0, prazoMs: 500 })).toBe(true)
    expect(session.connection).toBe("online")
    expect(FakeSocket.todos.length).toBe(antes)
  }, 60_000)

  it("com uma trama recente, nem pergunta: true sem mandar ping", async () => {
    const session = await sessaoLigada()
    const socket = FakeSocket.last!
    const enviadas = socket.sent.length
    expect(await session.verificarLigacao()).toBe(true)
    expect(socket.sent.length).toBe(enviadas)
  }, 60_000)

  it("um socket mudo nos dois sentidos, sem close: dá pela morte, deixa de dizer online, e liga outra vez", async () => {
    const session = await sessaoLigada()
    const morto = FakeSocket.last!
    const antes = FakeSocket.todos.length
    const estados: string[] = []
    session.on("connection", ({ state }) => estados.push(state))

    morto.mudo = true
    await assentar(20)
    expect(session.connection).toBe("online")

    expect(await session.verificarLigacao({ silencioMinimoMs: 0, prazoMs: 200 })).toBe(false)
    expect(estados[0]).not.toBe("online")
    expect(morto.readyState).toBe(3)

    await esperar(() => FakeSocket.todos.length > antes && session.connection === "online")
    const nova = FakeSocket.last!
    expect(nova).not.toBe(morto)
    await esperar(() => nova.sent.some((frame) => frame.t === "channel.backfill" && frame.channel === GERAL))
    expect(nova.sent.some((frame) => frame.t === "channel.subscribe")).toBe(true)
  }, 60_000)

  it("um pong atrasado 8 s, com outras tramas a passar: não liga outra vez", async () => {
    const session = await sessaoLigada()
    const vivo = FakeSocket.last!
    vivo.atrasoDoPong = 8_000
    const antes = FakeSocket.todos.length
    // The server keeps delivering: one presence per second.
    const fluxo = setInterval(() => vivo.entregar({ t: "presence", address: "@y:localhost:8448", online: true }), 1_000)
    try {
      const partiu = Date.now()
      expect(await session.verificarLigacao({ silencioMinimoMs: 0 })).toBe(true)
      // The first frame answered, long before the pong.
      expect(Date.now() - partiu).toBeLessThan(2_500)
      await new Promise((resolve) => setTimeout(resolve, 8_500))
      expect(session.connection).toBe("online")
      expect(FakeSocket.todos.length).toBe(antes)
      expect(vivo.readyState).toBe(1)
    } finally {
      clearInterval(fluxo)
    }
  }, 60_000)

  it("um pong atrasado 12 s, sem mais nada: chega dentro do prazo, e não liga outra vez", async () => {
    const session = await sessaoLigada()
    const vivo = FakeSocket.last!
    vivo.atrasoDoPong = 12_000
    const antes = FakeSocket.todos.length
    const partiu = Date.now()
    expect(await session.verificarLigacao({ silencioMinimoMs: 0 })).toBe(true)
    const demorou = Date.now() - partiu
    expect(demorou).toBeGreaterThanOrEqual(11_900)
    expect(demorou).toBeLessThan(14_000)
    expect(session.connection).toBe("online")
    expect(FakeSocket.todos.length).toBe(antes)
  }, 60_000)

  it("um socket morto a sério liga outra vez dentro do prazo de 15 s", async () => {
    const session = await sessaoLigada()
    const morto = FakeSocket.last!
    morto.mudo = true
    const partiu = Date.now()
    expect(await session.verificarLigacao({ silencioMinimoMs: 0 })).toBe(false)
    const demorou = Date.now() - partiu
    expect(demorou).toBeGreaterThanOrEqual(14_900)
    expect(demorou).toBeLessThan(16_000)
    await esperar(() => FakeSocket.last !== morto && session.connection === "online")
  }, 60_000)

  it("um envio durante a verificação sai já: não espera por ela (medido)", async () => {
    const session = await sessaoLigada()
    const socket = FakeSocket.last!
    // The worst case of 1.3.6: the socket silent, the check waiting.
    socket.mudo = true
    const verificacao = session.verificarLigacao({ silencioMinimoMs: 0, prazoMs: 3_000 })
    const partiu = Date.now()
    const envio = session.send(GERAL, MENSAGEM("mensagem-1")).catch(() => undefined)
    await esperar(() => socket.sent.some((frame) => frame.t === "channel.send"), 2_000)
    const latencia = Date.now() - partiu
    expect(latencia).toBeLessThan(500)
    expect(await verificacao).toBe(false)
    await envio
  }, 60_000)

  it("um envio depois de um silêncio longo sai já, e lança a verificação ao lado", async () => {
    Session.SILENCIO_ANTES_DE_VERIFICAR_MS = 0
    const session = await sessaoLigada()
    const socket = FakeSocket.last!
    const enviadas = socket.sent.length
    const partiu = Date.now()
    await session.send(GERAL, MENSAGEM("mensagem-3"))
    expect(Date.now() - partiu).toBeLessThan(500)
    const tipos = socket.sent.slice(enviadas).map((frame) => frame.t)
    expect(tipos).toContain("channel.send")
    expect(tipos).toContain("ping")
  }, 60_000)

  it("uma entrada no SFU não é cortada pela verificação, com o pong atrasado 8 s", async () => {
    const session = await sessaoLigada()
    const socket = FakeSocket.last!
    socket.atrasoDoPong = 8_000
    socket.atrasoDoSfu = 6_000
    const antes = FakeSocket.todos.length
    const entrada = session.sfuEntrarNoAmbito(GERAL, "voz")
    const verificacao = session.verificarLigacao({ silencioMinimoMs: 0 })
    await expect(entrada).resolves.toMatchObject({ producers: [] })
    expect(await verificacao).toBe(true)
    expect(FakeSocket.todos.length).toBe(antes)
    expect(session.connection).toBe("online")
  }, 60_000)

  it("o que se escreveu para o socket morto, sem eco, sai outra vez pela ligação nova", async () => {
    const session = await sessaoLigada()
    const morto = FakeSocket.last!
    morto.mudo = true
    await session.send(GERAL, MENSAGEM("mensagem-perdida"))
    expect(morto.sent.some((frame) => frame.t === "channel.send")).toBe(true)
    expect(await session.verificarLigacao({ silencioMinimoMs: 0, prazoMs: 200 })).toBe(false)
    await esperar(() => FakeSocket.last !== morto && session.connection === "online")
    await esperar(() => FakeSocket.last!.sent.some((frame) => frame.t === "channel.send"))
  }, 60_000)

  it("sem ligação não há nada a verificar: responde false sem mandar nada", async () => {
    const session = await sessaoLigada()
    session.disconnect()
    expect(await session.verificarLigacao({ prazoMs: 200 })).toBe(false)
  }, 60_000)
})

describe("a volta ao primeiro plano (retomar)", () => {
  it("com tramas durante a ausência: não faz nada", async () => {
    const session = await sessaoLigada()
    const socket = FakeSocket.last!
    const enviadas = socket.sent.length
    expect(session.retomar({ escondidaMs: 60_000, suspende: true })).toBe("nada")
    expect(socket.sent.length).toBe(enviadas)
  }, 60_000)

  it("sem uma trama durante uma ausência longa, num telemóvel: liga outra vez já, sem ping, e recupera", async () => {
    Session.AUSENCIA_QUE_RELIGA_MS = 300
    const session = await sessaoLigada()
    const morto = FakeSocket.last!
    morto.mudo = true
    await new Promise((resolve) => setTimeout(resolve, 400))
    const enviadas = morto.sent.length
    expect(session.retomar({ escondidaMs: 400, suspende: true })).toBe("religar")
    expect(morto.sent.length).toBe(enviadas)
    expect(session.connection).not.toBe("online")
    await esperar(() => FakeSocket.last !== morto && session.connection === "online")
    await esperar(() => FakeSocket.last!.sent.some((frame) => frame.t === "channel.backfill" && frame.channel === GERAL))
  }, 60_000)

  it("no computador, ou com a ausência curta: só verifica", async () => {
    Session.AUSENCIA_QUE_RELIGA_MS = 300
    const session = await sessaoLigada()
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(session.retomar({ escondidaMs: 400, suspende: false })).toBe("verificar")
    expect(session.retomar({ escondidaMs: 100, suspende: true })).toBe("verificar")
    expect(session.connection).toBe("online")
  }, 60_000)

  it("com uma chamada, não religa: verifica, e a chamada fica", async () => {
    Session.AUSENCIA_QUE_RELIGA_MS = 300
    const session = await sessaoLigada()
    await session.sfuEntrarNoAmbito(GERAL, "voz")
    const antes = FakeSocket.todos.length
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(session.retomar({ escondidaMs: 400, suspende: true })).toBe("verificar")
    expect(await session.verificarLigacao({ silencioMinimoMs: 0, prazoMs: 500 })).toBe(true)
    expect(FakeSocket.todos.length).toBe(antes)
  }, 60_000)

  it("sem ligação: liga já", async () => {
    const session = await sessaoLigada()
    const morto = FakeSocket.last!
    morto.close()
    await esperar(() => session.connection !== "online")
    expect(session.retomar()).toBe("ligar")
    await esperar(() => session.connection === "online")
  }, 60_000)
})

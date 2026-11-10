import { moradaDeTeste } from "../testes/moradas.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The AFK room, on the core side (2/11/2026): mark, the rule of one per
 * channel, who can, and what reaches whoever enters after. The fake socket
 * and the linked session are from `session.tickets.test.ts`.
 */

vi.setConfig({ testTimeout: 60_000 })
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
    this.#listeners.set(
      kind,
      (this.#listeners.get(kind) ?? []).filter((item) => item !== handler),
    )
  }

  send(raw: string): void {
    const frame = JSON.parse(raw) as Sent
    this.sent.push(frame)
    const replies = FakeSocket.reply(frame)
    for (const reply of replies ?? []) {
      setTimeout(() => this.fire("message", { data: JSON.stringify(reply) }), 0)
    }
  }

  close(): void {
    this.readyState = 3
    this.fire("close", {})
  }

  fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

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

async function settle(times = 60): Promise<void> {
  for (let index = 0; index < times; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * A session LINKED to the fake socket, with a channel of this account.
 *
 * Linked, and not offline like in the neighboring files, because here what is
 * measured is what goes out: an unlinked session breaks in `#send` AFTER it
 * already recorded the message in history, and a test that swallowed that
 * rejection would claim "nothing went out" about a path that records and fails.
 * The refusals that this file catches must happen BEFORE that, and that is what
 * we want to see.
 */
async function sessaoCom(channel: string): Promise<{ session: Session; vault: Vault }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  await session.createIdentity("localhost:8448")
  await session.connect()
  await settle()
  await session.createSpaceChannel(channel)
  return { session, vault }
}

/** Pass the foundation to someone else, which is how you test who does NOT command. */
async function fundadoPor(vault: Vault, channel: string, address: string): Promise<void> {
  await vault.update((contents) => {
    contents.channelFounder[channel] = { address, seq: 0 }
  })
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


const CANAL = moradaDeTeste("casa")
const VOZ = "contio-geral-aaaa"
const AFK = "contio-afk-bbbb"
const OUTRA = "contio-outra-cccc"

async function comAdministrador(): Promise<{ session: Session; vault: Vault }> {
  const pronta = await sessaoCom(CANAL)
  await fundadoPor(pronta.vault, CANAL, pronta.session.identity.address)
  await pronta.session.upsertRoom(CANAL, { room: VOZ, name: "Geral", kind: "voice" })
  return pronta
}

const afkDe = (session: Session): { room: string; minutos: number }[] =>
  session
    .roomsOf(CANAL)
    .filter((sala) => sala.afk)
    .map((sala) => ({ room: sala.room, minutos: sala.afk!.minutos }))

describe("marcar a sala AFK", () => {
  it("uma sala de voz marcada aparece com o tempo, e as outras sem nada", async () => {
    const { session } = await comAdministrador()
    await session.upsertRoom(CANAL, { room: AFK, name: "AFK", kind: "voice", afk: { minutos: 15 } })
    expect(afkDe(session)).toEqual([{ room: AFK, minutos: 15 }])
    expect(session.salaAfk(CANAL)).toEqual({ room: AFK, minutos: 15 })
    expect(session.roomsOf(CANAL).find((sala) => sala.room === VOZ)?.afk).toBeUndefined()
  })

  it("um canal sem sala AFK não tem nenhuma", async () => {
    const { session } = await comAdministrador()
    expect(session.salaAfk(CANAL)).toBeNull()
  })

  it("no máximo uma por canal: marcar outra desmarca a primeira", async () => {
    const { session } = await comAdministrador()
    await session.upsertRoom(CANAL, { room: AFK, name: "AFK", kind: "voice", afk: { minutos: 15 } })
    await session.upsertRoom(CANAL, { room: OUTRA, name: "Dormir", kind: "voice", afk: { minutos: 30 } })
    expect(afkDe(session)).toEqual([{ room: OUTRA, minutos: 30 }])
    // And the first one was indeed republished without the mark, not just hidden.
    const guardada = (await Promise.resolve(
      (session as unknown as { vault: Vault }).vault.contents.channelRooms[CANAL]?.[AFK]?.payload,
    )) as { afk?: unknown; name?: unknown }
    expect(guardada.name).toBe("AFK")
    expect(guardada.afk).toBeUndefined()
  })

  it("republicar a sala sem a marca desmarca-a", async () => {
    const { session } = await comAdministrador()
    await session.upsertRoom(CANAL, { room: AFK, name: "AFK", kind: "voice", afk: { minutos: 15 } })
    await session.upsertRoom(CANAL, { room: AFK, name: "AFK", kind: "voice" })
    expect(session.salaAfk(CANAL)).toBeNull()
  })

  it("mudar o tempo é republicar a mesma sala com outro tempo", async () => {
    const { session } = await comAdministrador()
    await session.upsertRoom(CANAL, { room: AFK, name: "AFK", kind: "voice", afk: { minutos: 15 } })
    await session.upsertRoom(CANAL, { room: AFK, name: "AFK", kind: "voice", afk: { minutos: 60 } })
    expect(session.salaAfk(CANAL)).toEqual({ room: AFK, minutos: 60 })
  })

  it("uma sala fechada deixa de ser a sala AFK", async () => {
    const { session } = await comAdministrador()
    await session.upsertRoom(CANAL, { room: AFK, name: "AFK", kind: "voice", afk: { minutos: 15 } })
    await session.upsertRoom(CANAL, { room: AFK, name: "AFK", kind: "voice", closed: true })
    expect(session.salaAfk(CANAL)).toBeNull()
  })

  it("duas marcadas (dois administradores ao mesmo tempo): vence a mais recente, igual em todo o lado", async () => {
    const { session, vault } = await comAdministrador()
    await vault.update((contents) => {
      const salas = (contents.channelRooms[CANAL] ??= {})
      const meta = (room: string, minutos: number) => ({
        t: "channel.meta",
        room,
        name: room,
        category: "",
        kind: "voice",
        position: 0,
        closed: false,
        removed: false,
        afk: { minutos },
        updatedAt: 1,
      })
      salas[AFK] = { seq: 10, at: 1_000, payload: meta(AFK, 5) } as never
      salas[OUTRA] = { seq: 11, at: 2_000, payload: meta(OUTRA, 60) } as never
    })
    expect(session.salaAfk(CANAL)).toEqual({ room: OUTRA, minutos: 60 })
    expect(afkDe(session)).toEqual([{ room: OUTRA, minutos: 60 }])
  })
})

describe("as recusas do núcleo", () => {
  it("uma sala de texto não pode ser a sala AFK, e nada sai", async () => {
    const { session } = await comAdministrador()
    await expect(
      session.upsertRoom(CANAL, { room: "forum-x", name: "Texto", kind: "text", afk: { minutos: 15 } }),
    ).rejects.toThrow("only a voice room can be the afk room")
    expect(session.roomsOf(CANAL).some((sala) => sala.room === "forum-x")).toBe(false)
  })

  it("quem não administra o canal não marca nada", async () => {
    const { session, vault } = await sessaoCom(CANAL)
    await fundadoPor(vault, CANAL, "@outra:localhost:8448")
    await expect(
      session.upsertRoom(CANAL, { room: AFK, name: "AFK", kind: "voice", afk: { minutos: 15 } }),
    ).rejects.toThrow("only an administrator may edit this channel")
    expect(session.salaAfk(CANAL)).toBeNull()
  })

  it("um tempo fora do esquema é recusado antes de sair", async () => {
    const { session } = await comAdministrador()
    await expect(
      session.upsertRoom(CANAL, { room: AFK, name: "AFK", kind: "voice", afk: { minutos: 0 } }),
    ).rejects.toThrow()
    expect(session.salaAfk(CANAL)).toBeNull()
  })

  it("uma marca AFK numa sala de TEXTO vinda da rede não conta", async () => {
    const { session, vault } = await comAdministrador()
    await vault.update((contents) => {
      ;(contents.channelRooms[CANAL] ??= {})["forum-y"] = {
        seq: 12,
        at: 3_000,
        payload: { t: "channel.meta", room: "forum-y", name: "y", category: "", kind: "text", position: 0, closed: false, removed: false, afk: { minutos: 5 }, updatedAt: 3 },
      } as never
    })
    expect(session.salaAfk(CANAL)).toBeNull()
  })
})

describe("a sala AFK chega a quem entra depois", () => {
  it("`republishRooms` diz a marca outra vez", async () => {
    const { session } = await comAdministrador()
    await session.upsertRoom(CANAL, { room: AFK, name: "AFK", kind: "voice", afk: { minutos: 30 } })
    const ditas: Record<string, unknown>[] = []
    session.on("message", (evento) => {
      if (evento.payload.t === "channel.meta") ditas.push(evento.payload as unknown as Record<string, unknown>)
    })
    await session.republishRooms(CANAL)
    expect(ditas.find((payload) => payload["room"] === AFK)).toMatchObject({ kind: "voice", afk: { minutos: 30 } })
    expect(ditas.find((payload) => payload["room"] === VOZ)).not.toHaveProperty("afk")
  })

  it("fixar uma mensagem na sala AFK não lhe tira a marca", async () => {
    const { session } = await comAdministrador()
    await session.upsertRoom(CANAL, { room: AFK, name: "AFK", kind: "voice", afk: { minutos: 15 } })
    await session.pinMessage(CANAL, AFK, { id: "m-1234567890", sender: session.identity.address, body: "olá", sentAt: 5 })
    expect(session.salaAfk(CANAL)).toEqual({ room: AFK, minutos: 15 })
  })
})

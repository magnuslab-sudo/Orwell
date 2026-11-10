import { moradaDeTeste } from "../testes/moradas.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The ticket room, on the core side: who opens, who decides, and what reaches whoever comes in later.
 *
 * What these tests pin down is mostly the boundary. `atender` is a convention, like `convidar` and `renomear`, an altered client publishes whatever state it likes and nothing in this layer stops it. What you can prove, and it is what we prove here, are the two honest halves: that OUR client refuses to publish what is not valid, and that our client does not COUNT what another published without owning it. Hiding a button is neither of the two.
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

const SALA = "forum-apoio-xxxx"

describe("abrir um ticket", () => {
  it("qualquer pessoa do canal abre um, e ele aparece no quadro", async () => {
    // The whole point of a ticket room: whoever complains is not in charge.
    const channel = moradaDeTeste("apoio")
    const { session, vault } = await sessaoCom(channel)
    await fundadoPor(vault, channel, "@outra:localhost:8448")
    expect(session.may(channel, "atender")).toBe(false)

    const id = await session.openTicket(channel, SALA, "Impressora avariada")
    const quadro = session.ticketsOf(channel, SALA)
    expect(quadro).toHaveLength(1)
    expect(quadro[0]).toMatchObject({
      id,
      subject: "Impressora avariada",
      state: "open",
      opener: session.identity.address,
      assignee: "",
    })
  })

  it("o corpo da mensagem diz o que aconteceu, para quem não conhecer o campo", async () => {
    // It is literally all an old client sees. If this message empties, a ticket room read by an older version becomes a column of blank messages.
    const channel = moradaDeTeste("apoio")
    const { session } = await sessaoCom(channel)
    await session.openTicket(channel, SALA, "Impressora avariada")
    const dito = session.history(channel).at(-1)
    expect(dito?.payload["body"]).toBe("Abriu um ticket: Impressora avariada")
  })

  it("um ticket sem assunto é recusado, e não sai nada", async () => {
    const channel = moradaDeTeste("apoio")
    const { session } = await sessaoCom(channel)
    const antes = session.history(channel).length
    await expect(session.openTicket(channel, SALA, "   ")).rejects.toThrow("the ticket needs a subject")
    expect(session.history(channel).length).toBe(antes)
  })
})

describe("quem pode decidir o estado de um ticket", () => {
  it("quem tem atender fecha o ticket de outra pessoa", async () => {
    const channel = moradaDeTeste("apoio")
    const { session, vault } = await sessaoCom(channel)
    await fundadoPor(vault, channel, session.identity.address)
    expect(session.may(channel, "atender")).toBe(true)

    const id = await session.openTicket(channel, SALA, "Impressora avariada")
    await session.setTicketState(channel, SALA, id, "closed")
    expect(session.ticketsOf(channel, SALA)[0]).toMatchObject({ state: "closed" })
  })

  it("quem NÃO tem atender e não o abriu é RECUSADO pelo núcleo, e nada sai", async () => {
    // The half a hidden button never proves. The bridge is callable by any client: the rejection must be here.
    const channel = moradaDeTeste("apoio")
    const { session, vault } = await sessaoCom(channel)
    await fundadoPor(vault, channel, "@outra:localhost:8448")

    // A ticket that is not ours: the opening came from someone else, on the thread.
    await vault.update((contents) => {
      contents.history[channel] = [
        {
          seq: 1,
          sender: "@outra:localhost:8448",
          at: 10,
          payload: {
            t: "message",
            room: SALA,
            id: "m1",
            sentAt: 10,
            body: "Abriu um ticket: Impressora avariada",
            ticket: { id: "t1", subject: "Impressora avariada", state: "open", at: 10 },
          },
        },
      ]
    })

    expect(session.may(channel, "atender")).toBe(false)
    expect(session.mayDecideTicket(channel, SALA, "t1")).toBe(false)
    const antes = session.history(channel).length
    await expect(session.setTicketState(channel, SALA, "t1", "closed")).rejects.toThrow("only an attendant or the author may change the ticket")
    expect(session.history(channel).length).toBe(antes)
    expect(session.ticketsOf(channel, SALA)[0]).toMatchObject({ state: "open" })
  })

  it("quem abriu fecha o seu próprio ticket sem ter atender", async () => {
    const channel = moradaDeTeste("apoio")
    const { session, vault } = await sessaoCom(channel)
    await fundadoPor(vault, channel, "@outra:localhost:8448")
    expect(session.may(channel, "atender")).toBe(false)

    const id = await session.openTicket(channel, SALA, "Impressora avariada")
    expect(session.mayDecideTicket(channel, SALA, id)).toBe(true)
    await session.setTicketState(channel, SALA, id, "closed")
    expect(session.ticketsOf(channel, SALA)[0]).toMatchObject({ state: "closed" })
  })

  it("um estado que este núcleo não conhece não se publica", async () => {
    // Publishing it was asking everyone to strike it from the reading.
    const channel = moradaDeTeste("apoio")
    const { session, vault } = await sessaoCom(channel)
    await fundadoPor(vault, channel, session.identity.address)
    const id = await session.openTicket(channel, SALA, "Impressora avariada")
    const antes = session.history(channel).length
    await expect(
      session.setTicketState(channel, SALA, id, "aguardapecas" as "open"),
    ).rejects.toThrow(/unknown ticket state/)
    expect(session.history(channel).length).toBe(antes)
  })
})

describe("tomar e largar um ticket", () => {
  it("quem tem atender toma o ticket, e o quadro passa a dizer quem o atende", async () => {
    const channel = moradaDeTeste("apoio")
    const { session, vault } = await sessaoCom(channel)
    await fundadoPor(vault, channel, session.identity.address)
    const id = await session.openTicket(channel, SALA, "Impressora avariada")

    await session.takeTicket(channel, SALA, id)
    expect(session.ticketsOf(channel, SALA)[0]).toMatchObject({
      assignee: session.identity.address,
      state: "working",
    })

    await session.releaseTicket(channel, SALA, id)
    expect(session.ticketsOf(channel, SALA)[0]).toMatchObject({ assignee: "" })
  })

  it("quem NÃO tem atender não toma o ticket, nem o seu próprio", async () => {
    // There is no exception here for whoever opened it, and it is deliberate: closing your own complaint is one thing, taking work for yourself on someone else's ticket board is another.
    const channel = moradaDeTeste("apoio")
    const { session, vault } = await sessaoCom(channel)
    await fundadoPor(vault, channel, "@outra:localhost:8448")
    const id = await session.openTicket(channel, SALA, "Impressora avariada")
    const antes = session.history(channel).length

    await expect(session.takeTicket(channel, SALA, id)).rejects.toThrow("you may not attend tickets in this channel")
    await expect(session.releaseTicket(channel, SALA, id)).rejects.toThrow("you may not attend tickets in this channel")
    expect(session.history(channel).length).toBe(antes)
    expect(session.ticketsOf(channel, SALA)[0]).toMatchObject({ assignee: "" })
  })
})

/**
 * The lesson from this session, applied where it applies.
 *
 * Everything this product knows about itself is said once, encrypted, and whoever comes in after will never open that event. A ticket room is state, and for that reason it must be REEMITTED, and the reemission that already exists had to learn to carry the layout, or the room would arrive for newcomers as a text room and stay that way forever.
 */
describe("a sala de tickets chega a quem entra depois", () => {
  it("`roomsOf` devolve a disposição publicada", async () => {
    const channel = moradaDeTeste("apoio")
    const { session, vault } = await sessaoCom(channel)
    await fundadoPor(vault, channel, session.identity.address)
    await session.upsertRoom(channel, { room: SALA, name: "Apoio", kind: "text", layout: "tickets" })
    expect(session.roomsOf(channel).find((sala) => sala.room === SALA)).toMatchObject({
      name: "Apoio",
      kind: "text",
      layout: "tickets",
    })
  })

  it("uma sala sem disposição não ganha nenhuma", async () => {
    // Absence is absence: a default value would write here a choice that nobody made in every room that already exists.
    const channel = moradaDeTeste("apoio")
    const { session, vault } = await sessaoCom(channel)
    await fundadoPor(vault, channel, session.identity.address)
    await session.upsertRoom(channel, { room: "forum-conversa-yyyy", name: "conversa", kind: "text" })
    const sala = session.roomsOf(channel).find((entrada) => entrada.room === "forum-conversa-yyyy")
    expect(sala).toMatchObject({ name: "conversa" })
    expect(sala?.layout).toBeUndefined()
  })

  it("`republishRooms` volta a dizer a disposição, e não só o nome", async () => {
    // Without this, whoever enters sees a text room where others see a ticket board, and nothing will ever fix it, because the original `channel.meta` was encrypted in an epoch they will never have.
    const channel = moradaDeTeste("apoio")
    const { session, vault } = await sessaoCom(channel)
    await fundadoPor(vault, channel, session.identity.address)
    await session.upsertRoom(channel, { room: SALA, name: "Apoio", kind: "text", layout: "tickets" })

    /**
     * What GOES OUT, not what is saved: a `channel.meta` does not enter the history (it goes to `channelRooms`), and what matters here is exactly what is said again to whoever just arrived. The session emits each of its own sends, and that is what you hear.
     */
    const ditas: Record<string, unknown>[] = []
    session.on("message", (evento) => {
      if (evento.payload.t === "channel.meta") ditas.push(evento.payload as unknown as Record<string, unknown>)
    })

    await session.republishRooms(channel)

    const republicada = ditas.find((payload) => payload["room"] === SALA)
    expect(republicada).toMatchObject({ name: "Apoio", kind: "text", layout: "tickets" })
  })
})

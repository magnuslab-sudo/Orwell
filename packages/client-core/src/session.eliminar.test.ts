import type { FichaDoCanal } from "./tipoDoCanal.js"
import { darFicha, moradaNova } from "../testes/moradas.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * Deleting a channel: who can, what does not get deleted, and what happens next.
 *
 * What these tests pin down is mostly the boundary: deletion publishes a tombstone
 * that honest clients honor, and does NOT erase anyone's messages. They are
 * encrypted in each person's vault and there is no way to reach them. So what we
 * verify on the side of whoever deletes is what is verifiable: that the tombstone
 * leaves, and that the channel vanishes from this device the way it would vanish
 * from any other that receives it.
 */

/**
 * The time the other files in this package give to each test, here all at once.
 *
 * No test in this file runs in less than two seconds. Creating an account is real
 * cryptography, and that is what you are paying for. That is against the five
 * second default of vitest. On its own it always passes; inside `npm test`, with
 * the other suites fighting for the machine, it would throw a random test past
 * the limit. An `npm test` that turns red on a different test each time is worse
 * than useless: it teaches you not to trust the red.
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

/** A session offline, with a channel founded by this account. */
async function sessaoCom(
  channel: string,
  ficha: (eu: string) => FichaDoCanal = () => ({ tipo: "sala" }),
): Promise<{ session: Session; vault: Vault }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  const { address } = await session.createIdentity("localhost:8448")
  // The record before the channel is born: the first one stays, and without it is a room.
  darFicha(vault.contents, channel, ficha(address))
  // Offline: the group is saved, and `channel.subscribe` is what breaks.
  await session.createSpaceChannel(channel).catch(() => {})
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

describe("quem pode eliminar um canal", () => {
  it("quem o fundou pode", async () => {
    const channel = moradaNova()
    const { session, vault } = await sessaoCom(channel)
    /**
     * The foundation, saved. And that is what this test's name always said.
     *
     * Offline, `createSpaceChannel` never reaches publishing `room.created`: the
     * `channel.subscribe` breaks first. This test passed anyway, because a channel
     * without recorded foundation gave everything to everyone. In other words, it
     * passed for the wrong reason, and would have passed the same for an account
     * that founded no channel. `delete` stopped being granted without knowing who
     * founded, and now the setup has to say what the test tests.
     */
    await fundadoPor(vault, channel, session.identity.address)
    expect(session.mayDeleteChannel(channel)).toBe(true)
  })

  it("num canal sem fundação registada, ninguém o elimina — nem quem lá está desde sempre", async () => {
    // The flip side of the one above, and the decision it locks in: deleting publishes the tombstone
    // and each honest client drops the channel and erases what they had in it. There is no gesture
    // that undoes it, so we don't grant it to someone we can't verify is in charge. The way out is
    // `claimFounder`, which is a deliberate and visible act.
    const channel = moradaNova()
    const { session } = await sessaoCom(channel)
    expect(session.founderOf(channel)).toBeNull()
    expect(session.mayDeleteChannel(channel)).toBe(false)
    await expect(session.deleteChannel(channel)).rejects.toThrow("you may not delete this channel")
    expect(session.channels).toContain(channel)
  })

  it("um membro sem a responsabilidade não pode, e o núcleo recusa mesmo que o ecrã ofereça", async () => {
    // Real refusal lives here: the menu hides what you can't do, but a tampered client has no menu
    // to stop it from calling this.
    const channel = moradaNova()
    const { session, vault } = await sessaoCom(channel)
    await fundadoPor(vault, channel, "@outra:localhost:8448")

    expect(session.mayDeleteChannel(channel)).toBe(false)
    await expect(session.deleteChannel(channel)).rejects.toThrow("you may not delete this channel")
    // And the channel stays where it was: a refusal that dropped the group would be worse than the
    // gesture that refused.
    expect(session.channels).toContain(channel)
  })

  it("a responsabilidade `eliminar`, dada por um papel, chega — é o 'ou permissão atribuída'", async () => {
    const channel = moradaNova()
    const { session, vault } = await sessaoCom(channel)
    const eu = session.identity.address
    await fundadoPor(vault, channel, "@outra:localhost:8448")
    await vault.update((contents) => {
      contents.channelRoles[channel] = {
        coveiro: {
          at: 1,
          payload: { t: "role.define", role: "coveiro", name: "Coveiro", powers: ["eliminar"], position: 0, definedAt: 1 },
        },
      }
      contents.channelMemberRoles[channel] = { [eu]: ["coveiro"] }
    })

    expect(session.mayDeleteChannel(channel)).toBe(true)
  })

  it("um papel com as outras responsabilidades não elimina: eliminar não vem agarrado a arrumar", async () => {
    const channel = moradaNova()
    const { session, vault } = await sessaoCom(channel)
    const eu = session.identity.address
    await fundadoPor(vault, channel, "@outra:localhost:8448")
    await vault.update((contents) => {
      contents.channelRoles[channel] = {
        arrumador: {
          at: 1,
          payload: {
            t: "role.define",
            role: "arrumador",
            name: "Arrumador",
            powers: ["convidar", "renomear", "mover", "expulsar"],
            position: 0,
            definedAt: 1,
          },
        },
      }
      contents.channelMemberRoles[channel] = { [eu]: ["arrumador"] }
    })

    expect(session.mayDeleteChannel(channel)).toBe(false)
  })
})

describe("o que não se elimina", () => {
  it("o canal do próprio feed, nem por quem o fundou", async () => {
    // Same reason we could never forget: posts live there, and tearing it down would break them
    // silently. Having all the power does not change that.
    const feed = moradaNova()
    const { session } = await sessaoCom(feed, (eu) => ({ tipo: "mural", dono: eu }))
    expect(session.mayDeleteChannel(feed)).toBe(false)
    await expect(session.deleteChannel(feed)).rejects.toThrow("a feed channel cannot be deleted")
  })

  it("uma conversa entre duas pessoas: não há ali administração nenhuma para exercer", async () => {
    const dm = moradaNova()
    const { session } = await sessaoCom(dm, () => ({ tipo: "directa" }))
    expect(session.mayDeleteChannel(dm)).toBe(false)
    // The reason, not just the refusal. `sessaoCom()` returns a DISCONNECTED session, and the test
    // three blocks below proves that `deleteChannel` offline rejects due to no connection: a bare
    // `rejects.toThrow()` here would be happy with that refusal, which has nothing to do with being
    // a conversation between two people. Any rejection is not the right rejection.
    await expect(session.deleteChannel(dm)).rejects.toThrow("a direct conversation cannot be deleted")
  })

  it("a sala comum do servidor, porque o servidor a repõe na ligação seguinte", async () => {
    // Deleting it was a gesture that undid itself: `ensureCommonRoom` walks back in as soon as the
    // connection opens, and the person sees the channel come back with no explanation. The server
    // decides whether it exists.
    const sala = moradaNova()
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const session = new Session(vault)
    await session.createIdentity("localhost:8448")
    FakeSocket.reply = respostaBase(sala)
    await session.connect()
    await settle()
    await session.createSpaceChannel(sala).catch(() => {})

    expect(session.commonRoom).toBe(sala)
    expect(session.mayDeleteChannel(sala)).toBe(false)
    session.disconnect()
  }, 60_000)
})

describe("eliminar, consumado", () => {
  it("publica a lápide e larga o canal deste aparelho", async () => {
    const sala = moradaNova()
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const session = new Session(vault)
    await session.createIdentity("localhost:8448")
    FakeSocket.reply = respostaBase(undefined)
    await session.connect()
    await settle()
    await session.createSpaceChannel(sala)
    await settle()

    const antes = (FakeSocket.last?.sent ?? []).filter((frame) => frame.t === "channel.send").length
    await session.deleteChannel(sala)

    // Something encrypted went out, and the channel stopped existing here.
    expect((FakeSocket.last?.sent ?? []).filter((frame) => frame.t === "channel.send").length).toBeGreaterThan(antes)
    expect(session.channels).not.toContain(sala)
    expect(vault.contents.groups[sala]).toBeUndefined()
    session.disconnect()
  }, 60_000)

  it("sem ligação não larga nada: uma lápide que não sai deixava o canal vivo para os outros", async () => {
    // The case that falls out of view: offline, forgetting is harmless and deleting is not. Dropping
    // it here would leave the person without the channel AND without having deleted anything-everyone
    // stayed inside, with no one able to delete it again if they were the only one with that power.
    const sala = moradaNova()
    const { session, vault } = await sessaoCom(sala)
    await expect(session.deleteChannel(sala)).rejects.toThrow()
    expect(session.channels).toContain(sala)
    expect(vault.contents.groups[sala]).toBeTruthy()
  })
})

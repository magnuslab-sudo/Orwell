import { moradaDeTeste } from "../testes/moradas.js"
import type { Payload } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The handshake, against a scripted server and a LOADED account.
 *
 * Every suite in this repository until now built a fresh account with one
 * channel and no history, which is precisely the shape of account that never
 * hit any of the bugs people actually reported. What breaks in the field is a
 * device that has been used: several channels, a stored catch-up anchor, a
 * relay handing back a page with something unreadable in it, a vault whose
 * writes start failing. So this fixture starts from a vault that already has
 * a life, and drives `connect()` against a fake socket.
 *
 * The fake is deliberately dumb — it replays whatever the script says for each
 * frame kind — because the point is not to re-test the server. The point is
 * what the CLIENT does when the answers are inconvenient.
 */

class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  /** Set to make every subsequent write fail, like a full IndexedDB quota. */
  failWrites = false
  /**
   * The words with which writes refuse.
   *
   * By default, the raw name that IndexedDB throws. The browser bridge
   * classifies it before delivering it to the core (see
   * `apps/web/vault-backend.ts`), and that already-classified phrase,    * "vault storage is full", is what the core uses to decide whether to
   * interrupt someone. A test down below swaps it for exactly that; the others
   * keep the raw one, which is the other side of the same decision.
   */
  mensagemDeFalha = "QuotaExceededError"
  writes = 0
  /** How many writes were actually REFUSED. See usage, below. */
  recusadas = 0

  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.writes += 1
    if (this.failWrites) {
      this.recusadas += 1
      throw new Error(this.mensagemDeFalha)
    }
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

/** Frames the script may return for a given request kind. */
type Reply = (frame: Sent) => unknown[] | undefined

class FakeSocket {
  static last: FakeSocket | null = null
  static reply: Reply = () => undefined
  /** Fail the connection before it ever opens, like a homeserver that is down. */
  static failToOpen = false

  readyState = 0
  readonly sent: Sent[] = []
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    FakeSocket.last = this
    // The real WebSocket resolves asynchronously; so does this.
    setTimeout(() => {
      if (FakeSocket.failToOpen) {
        this.#fire("error", {})
        return
      }
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
    const replies = FakeSocket.reply(frame)
    for (const reply of replies ?? []) {
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

/**
 * The ordinary, healthy answers to a handshake.
 *
 * ONLY the handshake: whoever wants to answer more builds on top, and several
 * tests down below do. Putting `channel.backfill` inside here was tried and is
 * wrong, the poison tests call `baseReply` FIRST, and an empty page returned
 * here would swallow the poison before it got served. The healthy default lives
 * one level up, in `servidorSaudavel`.
 */
function baseReply(frame: Sent): unknown[] | undefined {
  if (frame.t === "hello") return [{ t: "hello.ok", version: 1, capabilities: ["presence"] }]
  if (frame.t === "auth.begin") return [{ t: "auth.challenge", nonce: "AAAA" }]
  if (frame.t === "auth.finish") return [{ t: "auth.ok", address: "@x:localhost" }]
  return undefined
}

/**
 * The default server of these tests: handshake, and catch-up answered.
 *
 * ⚠️ The empty page is here for a timing reason. `loadedSession()` leaves two
 * channels with anchors, so joining asks for two backfills. With no answer,
 * `#await("channel.backfill.page")` waits the ten-second default timeout, TWICE
 * -, and two tests in this file wasted twenty seconds each waiting for nothing.
 * Neither of them measures a silent server: they measure staying online with the
 * vault refusing writes, and an unreadable channel reported once. Entire file:
 * 45 s → 3 s.
 *
 * An empty page is what a working server answers to someone already up to date,
 * and it is the same answer that `servidorComVeneno` down below already gave to
 * channels without poison. A silent server is not "ordinary": it was a fixture
 * accident, and an expensive one.
 *
 * Anyone wanting to measure a silent server can still, and still does: the test
 * "request pending invites before wasting time on catch-up" deliberately puts a
 * server that never answers backfill, with the comment saying why.
 */
function servidorSaudavel(frame: Sent): unknown[] | undefined {
  const base = baseReply(frame)
  if (base) return base
  if (frame.t === "channel.backfill") {
    return [{ t: "channel.backfill.page", channel: frame.channel, more: false, events: [] }]
  }
  return undefined
}

/**
 * The sessions opened by this file, so we can call `disconnect()` on them at
 * the end.
 *
 * ⚠️ A session does not die with the test that created it: it keeps
 * timers running, and what they do no longer belongs to any test. This is how
 * an `Unhandled Rejection: QuotaExceededError` appeared after the fake server
 * started answering catch-up, before, catch-up would time out and never
 * write; now it writes, and the test that leaves the vault refusing writes
 * also left a promise to catch and explode in another test. Vitest counts that
 * as an error and the whole run exits with 1, even with 327 tests green.
 */
const abertas: Session[] = []
const cofres: MemoryBackend[] = []

async function loadedSession(): Promise<{ session: Session; vault: Vault; backend: MemoryBackend }> {
  const backend = new MemoryBackend()
  const vault = new Vault(backend)
  await vault.create("frase-passe")
  const session = new Session(vault)
  await session.createIdentity("localhost:8448")

  // A device that has been used: three channels with a catch-up anchor each,
  // and one whose group blob is corrupt — the state a real vault reaches after
  // a browser eviction or a half-written record.
  await session.createSpaceChannel(moradaDeTeste("geral")).catch(() => {})
  await session.createSpaceChannel(moradaDeTeste("fotos")).catch(() => {})
  await vault.update((contents) => {
    contents.groups[moradaDeTeste("ilegivel")] = "AAAA"
    contents.lastSeq[moradaDeTeste("geral")] = 10
    contents.lastSeq[moradaDeTeste("fotos")] = 4
  })
  abertas.push(session)
  cofres.push(backend)
  return { session, vault, backend }
}

/**
 * A newly created account: no name and no channels.
 *
 * It is the opposite of `loadedSession`, and exists for one case only, the
 * profile repair round, whose success condition is "no channel failed" and
 * which in a vault like this has zero channels to fail.
 */
async function contaNova(): Promise<{ session: Session; vault: Vault }> {
  const backend = new MemoryBackend()
  const vault = new Vault(backend)
  await vault.create("frase-passe")
  const session = new Session(vault)
  await session.createIdentity("localhost:8448")
  abertas.push(session)
  cofres.push(backend)
  return { session, vault }
}

beforeEach(() => {
  FakeSocket.reply = servidorSaudavel
  FakeSocket.failToOpen = false
  FakeSocket.last = null
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  /**
   * First the vault goes back to accepting writes, and only then does it
   * disconnect.
   *
   * `Session.flush` runs on a timer with a delay: the clock kept running after
   * the test ended and the write arrived when no one was waiting for it anymore.
   * With the vault still refusing, what arrived was a rejected promise that no
   * one caught, vitest counts it as an error and the run exits with 1 with all
   * tests green.
   *
   * The product finding that was recorded here, that deferred `flush` does not
   * handle the failure anywhere, and `disconnect()` does not cancel the timer,    * **is fixed**: the failure is handled in `#falhaAoGravar` and the exit
   * disarms the clock. See the `describe("o flush adiado")` down below, which
   * guards it, and `docs/PENDENTES.md`, point 5 of the vault.
   *
   * This line stays the same, and is not redundant: a vault refusing writes is
   * a test leaving traps set up for the next one, and restoring it is file
   * hygiene, not a product fix.
   */
  for (const cofre of cofres.splice(0)) cofre.failWrites = false
  // Disconnect BEFORE taking the WebSocket away, and one by one: a live session
  // talking to the next test's fake socket is the fastest way to turn seven
  // seconds of suite into nine hundred.
  for (const sessao of abertas.splice(0)) {
    try {
      sessao.disconnect()
    } catch {
      // A session that never connected has nothing to disconnect.
    }
  }
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

/** Let the fake socket's queued callbacks run. */
async function settle(times = 40): Promise<void> {
  for (let index = 0; index < times; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("connect, on an account that has been used", () => {
  it("um evento ilegível no catch-up não derruba a ligação nem cala o welcome.resync", async () => {
    const { session } = await loadedSession()

    FakeSocket.reply = (frame) => {
      const base = baseReply(frame)
      if (base) return base
      if (frame.t === "channel.backfill") {
        // The poison: a ciphertext that is not base64 at all. `fromBase64`
        // throws on the first bad character, and that throw used to travel out
        // of catch-up, out of the handshake, and take the connection with it —
        // on every single attempt, for ever, because the same page came back.
        return [
          {
            t: "channel.backfill.page",
            channel: frame.channel,
            more: false,
            events: [{ seq: 11, kind: "application", ciphertext: "!!!não é base64!!!" }],
          },
        ]
      }
      return undefined
    }

    const statuses: { code?: string; route?: string }[] = []
    session.on("status", (event) => statuses.push(event))

    await session.connect()
    await settle()

    expect(session.connection).toBe("online")
    const kinds = (FakeSocket.last?.sent ?? []).map((frame) => frame.t)
    expect(kinds).toContain("welcome.resync")
    // The unreadable event is reported to the log, never as an interruption.
    const failure = statuses.find((status) => status.code === "event-failed")
    expect(failure?.route).toBe("log")
  }, 60_000)

  it("pede os convites pendentes antes de gastar tempo no catch-up", async () => {
    const { session } = await loadedSession()
    FakeSocket.reply = (frame) => {
      const base = baseReply(frame)
      if (base) return base
      // Never answer a backfill: a slow or dead server must not be able to
      // hold back the one frame somebody else is blocked on.
      return undefined
    }

    void session.connect().catch(() => {})
    await settle(10)

    const kinds = (FakeSocket.last?.sent ?? []).map((frame) => frame.t)
    const resync = kinds.indexOf("welcome.resync")
    const backfill = kinds.indexOf("channel.backfill")
    expect(resync).toBeGreaterThanOrEqual(0)
    // The ORDER is the central assertion of this test, and was inside an `if`:
    // without any `channel.backfill` coming out, a frame name changed, a
    // catch-up that stopped happening, the comparison never ran and the line
    // above was left over, which only says the resync exists. What is needed is
    // for both to come out, and in this order.
    expect(backfill).toBeGreaterThanOrEqual(0)
    expect(resync).toBeLessThan(backfill)
  }, 60_000)

  it("um cofre que recusa escritas não impede a ligação de ficar online", async () => {
    const { session, backend } = await loadedSession()
    backend.failWrites = true

    await session.connect()
    await settle()

    // First: that the vault really DID REFUSE something. Without this the test
    // passed with `failWrites` doing nothing, it took just renaming the field,
    // or enter stopping writing, and green kept appearing without any refusal to
    // survive. It was a test that measured the name of a flag and not its effect.
    expect(backend.recusadas).toBeGreaterThan(0)
    // And only then: refusals do not bring down the connection.
    expect(session.connection).toBe("online")
    expect((FakeSocket.last?.sent ?? []).map((frame) => frame.t)).toContain("welcome.resync")
  }, 60_000)

  it("uma ligação que nunca abre volta a tentar sozinha", async () => {
    const { session } = await loadedSession()
    FakeSocket.failToOpen = true

    await expect(session.connect()).rejects.toThrow()
    expect(session.connection).toBe("reconnecting")

    // The retry is scheduled: the socket that never opened fires no close
    // event, so without an explicit schedule nothing ever tried again and the
    // app sat on "a ligar…" until somebody reloaded the page.
    const first = FakeSocket.last
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    expect(FakeSocket.last).not.toBe(first)

    session.disconnect()
  }, 60_000)

  it("canais ilegíveis são reportados uma vez, como toast", async () => {
    const { session } = await loadedSession()
    const statuses: { code?: string; route?: string }[] = []
    session.on("status", (event) => statuses.push(event))

    await session.connect()
    await settle()

    const unreadable = statuses.filter((status) => status.code === "channels-unreadable")
    expect(unreadable).toHaveLength(1)
    expect(unreadable[0]?.route).toBe("toast")
  }, 60_000)
})

/**
 * The profile repair round, and the gate where it burned to a crisp.
 *
 * `publishProfile` with no name returns the list of channels it got, "all
 * failed" -, and that is what stops the round from saving to an account with
 * no name. But on a NEWLY CREATED account that list is empty: there are no
 * channels. Zero failed out of zero publications passed as success, and the
 * round saved itself on the first connection of the account's life, before
 * there was a name or channel, spent before it serves any purpose, which is
 * exactly what it exists not to be.
 *
 * The cost of getting it wrong this way is a second attempt on the next
 * connection; the other way is a person appearing forever as an address on
 * the screen of whoever invited them, with nothing on their side that sends it
 * back.
 */
describe("a posse do aparelho no login", () => {
  /*
    An imported vault is a copy of the device that exported it. Login claims
    ownership (`assumirPosse`) until the server responds with a generation, then
    presents that generation on each subsequent login. Without this, the origin
    copy would keep speaking for the account (`scripts/e2e-exportar-importar.mjs`).
  */
  it("o cofre importado pede a posse, guarda a geração e deixa de a pedir", async () => {
    const { session, vault } = await contaNova()
    await vault.update((contents) => {
      contents.assumirPosse = "marca-da-importacao"
    })
    FakeSocket.reply = (frame) => {
      if (frame.t === "auth.finish") return [{ t: "auth.ok", address: "@x:localhost", posse: 4 }]
      return servidorSaudavel(frame)
    }
    await session.connect()
    await settle()
    const fim = (FakeSocket.last?.sent ?? []).find((frame) => frame.t === "auth.finish")
    expect(fim).toMatchObject({ assumirPosse: "marca-da-importacao" })
    expect(vault.contents.posseDoAparelho).toBe(4)
    expect(vault.contents.assumirPosse).toBeUndefined()

    session.disconnect()
    await session.connect()
    await settle()
    const segundo = (FakeSocket.last?.sent ?? []).find((frame) => frame.t === "auth.finish")
    expect(segundo).toMatchObject({ posse: 4 })
    expect(segundo).not.toHaveProperty("assumirPosse")
  })

  it("contra um servidor que não conhece a posse, o pedido fica de pé", async () => {
    const { session, vault } = await contaNova()
    await vault.update((contents) => {
      contents.assumirPosse = "marca-da-importacao"
    })
    await session.connect()
    await settle()
    expect(vault.contents.assumirPosse).toBe("marca-da-importacao")
    expect(vault.contents.posseDoAparelho).toBeUndefined()
  })
})

describe("a ronda de reparação de perfis", () => {
  it("não se grava numa conta sem nome e sem canais, onde nada falhou por não haver nada", async () => {
    const { session, vault } = await contaNova()

    await session.connect()
    await settle()
    expect(session.connection).toBe("online")

    // The line that matters: the round went unfulfilled, and the next connection
    // tries again.
    expect(vault.contents.profileRepairRound ?? 0).toBe(0)
  }, 60_000)

  it("e grava-se quando há nome, que é quando ela serve para alguma coisa", async () => {
    // The contrast, and this is what keeps the new condition from being "never": with
    // a name, a round with no channels is a fulfilled round, there is nothing to
    // repair and nothing a second attempt would find.
    const { session, vault } = await contaNova()
    await session.updateProfile({ displayName: "Ana", donations: [] })

    await session.connect()
    await settle()
    expect(session.connection).toBe("online")

    expect(vault.contents.profileRepairRound ?? 0).toBeGreaterThan(0)
  }, 60_000)
})

describe("flush", () => {
  it("uma escrita falhada deixa o canal por gravar, para a próxima tentativa o apanhar", async () => {
    const { session, vault, backend } = await loadedSession()

    // A send advances the group; the vault refuses the write, as a full
    // IndexedDB does on an account carrying real photos.
    //
    // ⚠️ The `id` has eight characters because the schema requires eight (`MessageId`,
    // in `payload.ts`). This test had `"m1"`: `encodePayload` rejected the
    // message BEFORE any ratchet moved, so there was no group advanced, no dirty mark,
    // and no write to fail. The green came from the test never running, it passed with
    // the fix that stores deletion, measured on August 16. A short `id`
    // here is not a fixture detail: it is the entire test not running.
    backend.failWrites = true
    await session
      .send(moradaDeTeste("geral"), {
        t: "message",
        id: "mensagem-00",
        sentAt: 1,
        body: "olá",
        attachments: [],
        mentions: [],
        links: [],
      })
      .catch(() => {})

    // The vault really did refuse something: without this the rest compares two states
    // that never diverged.
    expect(backend.recusadas).toBeGreaterThan(0)

    backend.failWrites = false
    await session.flush()

    // Read what is actually ON DISK, not what the live vault holds in memory:
    // the failure is only survivable if the next flush wrote the advance out.
    // With the dirty mark consumed by the failed attempt, this flush had
    // nothing to do and the group on disk stayed a generation behind — the
    // exact state that makes a restart re-encrypt under a used key.
    const reopened = new Vault(backend)
    await reopened.unlock("frase-passe")
    expect(reopened.contents.groups[moradaDeTeste("geral")]).toBe(
      vault.contents.groups[moradaDeTeste("geral")],
    )
  }, 60_000)
})

/**
 * The flush that runs on its own, one and a half seconds after everyone leaves.
 *
 * `#persistGroup` arms a timer and drops the promise (`void this.flush()`).
 * While the vault accepts writes nobody notices; the day it refuses,  * IndexedDB full, which is the realistic case on an account with real photos, the
 * promise breaks with nobody catching it. In the browser that is a genuine
 * `unhandledrejection`, in the real app it is too.
 *
 * The two tests measure the two halves of the debt: the failure nobody handles, and
 * the timer that `disconnect()` left running after closing the gate.
 *
 * Both use `send`, and use it on purpose: it is the public path where the two
 * things happen together, arms the timer in `#persistGroup`, and the
 * synchronous write that follows fails and restores the dirty marks, which is what
 * leaves work for the deferred one to find.
 */
describe("o flush adiado", () => {
  /** A payload the schema accepts. `id` has eight characters minimum. */
  const mensagem = (id: string): Payload => ({ t: "message", id, sentAt: 1, body: "olá", attachments: [], mentions: [], links: [] })

  it("uma falha sua é tratada e dita, e não morre numa rejeição sem dono", async () => {
    const { session, backend } = await loadedSession()
    const statuses: { code?: string; detail?: string; route?: string }[] = []
    session.on("status", (event) => statuses.push(event))

    const rejeicoes: string[] = []
    const apanhar = (motivo: unknown): void => {
      rejeicoes.push(motivo instanceof Error ? motivo.message : String(motivo))
    }
    process.on("unhandledRejection", apanhar)

    try {
      backend.failWrites = true
      await session.send(moradaDeTeste("geral"), mensagem("mensagem-01")).catch(() => {})

      const recusadasAntes = backend.recusadas
      await new Promise((resolve) => setTimeout(resolve, Session.FLUSH_MS + 500))

      // First the control: that the deferred one really DID run and really failed.
      // Without this the test stayed green because the timer never fired, // it would measure the name of a mechanism instead of its effect.
      expect(backend.recusadas).toBeGreaterThan(recusadasAntes)
      // And only then: the failure does not slip under, and it does not stay silent.
      expect(rejeicoes).toEqual([])
      const falha = statuses.find((status) => status.code === "persist-failed")
      expect(falha?.detail).toContain("QuotaExceededError")
    } finally {
      process.off("unhandledRejection", apanhar)
      backend.failWrites = false
    }
  }, 60_000)

  it("o disco cheio interrompe; o resto vai para o diário", async () => {
    const { session, backend } = await loadedSession()
    const statuses: { code?: string; route?: string }[] = []
    session.on("status", (event) => statuses.push(event))

    // The message the browser bridge delivers to the core when the quota runs out.
    // It is the only write failure the user can resolve, delete photos,
    // delete conversations, and so it is the only one that gains the right to interrupt.
    backend.mensagemDeFalha = "vault storage is full"
    backend.failWrites = true
    await session.send(moradaDeTeste("geral"), mensagem("mensagem-03")).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, Session.FLUSH_MS + 500))
    backend.failWrites = false

    const falha = statuses.find((status) => status.code === "persist-failed")
    expect(falha?.route).toBe("toast")
  }, 60_000)

  it("disconnect() cancela-o, em vez de o deixar a bater num cofre já fechado", async () => {
    const { session, backend } = await loadedSession()
    backend.failWrites = true
    await session.send(moradaDeTeste("geral"), mensagem("mensagem-02")).catch(() => {})

    // Leaving writes what there is, and here that write is also refused, so
    // the channel stays dirty. It is the situation where the armed timer would
    // really have work to do, and that is why the count below distinguishes.
    session.disconnect()
    await settle(5)
    const recusadas = backend.recusadas
    expect(recusadas).toBeGreaterThan(0)

    await new Promise((resolve) => setTimeout(resolve, Session.FLUSH_MS + 500))

    // Nothing else knocked on the vault door: who disconnects does not leave clocks running.
    expect(backend.recusadas).toBe(recusadas)
    backend.failWrites = false
  }, 60_000)
})

describe("send", () => {
  it("recusa um payload maior do que o servidor aceita, antes de o gravar", async () => {
    const { session, vault } = await loadedSession()
    const before = vault.contents.groups[moradaDeTeste("geral")]
    const historyBefore = session.history(moradaDeTeste("geral")).length

    // Oversized by a route the schema actually permits: four inline images, each
    // under the four-megabyte attachment cap, together past the frame limit.
    // (This used to send a 12 MB `body` with a three-character `id`, both of
    // which the payload schema forbids. It only reached the size check because
    // the sender did not validate; now that `encodePayload` does, the test has to
    // be oversized rather than malformed, or it would pass for the wrong reason.)
    const image = (bytes: number) => ({
      url: "",
      inline: `data:image/png;base64,${"A".repeat(bytes)}`,
      key: "",
      nonce: "",
      digest: "",
      kind: "image" as const,
      name: "grande.png",
      mediaType: "image/png",
      byteLength: bytes,
    })

    await expect(
      session.send(moradaDeTeste("geral"), {
        t: "message",
        id: "mensagem-grande-01",
        sentAt: 1,
        body: "quatro fotografias",
        attachments: [image(3_500_000), image(3_500_000), image(3_500_000), image(3_500_000)],
        mentions: [],
        links: [],
      }),
    ).rejects.toThrow("too large to send")

    // Nothing persisted, nothing in the timeline: the alternative was a
    // message shown as sent that the server would refuse and never deliver.
    expect(vault.contents.groups[moradaDeTeste("geral")]).toBe(before)
    expect(session.history(moradaDeTeste("geral"))).toHaveLength(historyBefore)
  }, 60_000)
})

/**
 * What happens AFTER an unreadable event, which is where the price gets paid.
 *
 * The test above proves that the connection survives an event that does not read, and
 * that is right and stays necessary. What nobody had measured is the
 * consequence: the read anchor advances over the event that failed, is
 * written, and **the event is never requested from any server again**.
 *
 * For a single message, the price is a message lost in silence. For a
 * commit, it is the epoch not advancing on this device, and from then on all
 * following messages on the channel become unreadable, each counting as
 * ignored, until deafness is declared and the reseat carries the history with it.
 *
 * The fix was not to stop advancing, that brings back the infinite loop the
 * old comment described, and for good reason. It was **to distinguish**: what does not READ
 * skips, because text that is not base64 will never be base64; what does not ARRIVE
 * waits, because most of the time it is an epoch on the way.
 *
 * The first two tests cover the side that keeps skipping, and it is good that
 * it continues. The third is what the fix rescues.
 */
describe("o preço de saltar um evento que não se leu", () => {
  /** A server that serves the poisoned event once and logs what is requested from it. */
  function servidorComVeneno(pedidos: { channel: string; afterSeq: number }[]) {
    const servidos = new Set<string>()
    return (frame: Sent): unknown[] | undefined => {
      const base = baseReply(frame)
      if (base) return base
      if (frame.t !== "channel.backfill") return undefined
      const channel = frame.channel as string
      pedidos.push({ channel, afterSeq: frame.afterSeq as number })
      // The poison is served once only, and only to whoever requests from position 10.
      if (channel === moradaDeTeste("geral") && !servidos.has(channel)) {
        servidos.add(channel)
        return [
          {
            t: "channel.backfill.page",
            channel,
            more: false,
            events: [{ seq: 11, kind: "application", ciphertext: "!!!não é base64!!!" }],
          },
        ]
      }
      return [{ t: "channel.backfill.page", channel, more: false, events: [] }]
    }
  }

  it("a âncora avança por cima do evento que falhou", async () => {
    const { session, vault } = await loadedSession()
    const pedidos: { channel: string; afterSeq: number }[] = []
    FakeSocket.reply = servidorComVeneno(pedidos)

    await session.connect()
    await settle()

    // It started requesting from position 10, which is where it had stopped.
    expect(pedidos.find((p) => p.channel === moradaDeTeste("geral"))?.afterSeq).toBe(10)
    // And it left with the anchor at 11, an event that never got applied.
    expect(vault.contents.lastSeq[moradaDeTeste("geral")]).toBe(11)
  }, 60_000)

  it("e por isso o evento nunca mais é pedido, nem numa ligação nova", async () => {
    /*
      This is the defect, and it is what a person sees as "the message did not arrive".

      There is no second chance anywhere: not on another connection, not another
      day, not reloading the app. Event 11 exists on the server and this
      device will never request it again.
    */
    const { session, vault } = await loadedSession()
    const pedidos: { channel: string; afterSeq: number }[] = []
    FakeSocket.reply = servidorComVeneno(pedidos)

    await session.connect()
    await settle()
    session.disconnect()
    await settle(5)
    await session.connect()
    await settle()

    const doGeral = pedidos.filter((p) => p.channel === moradaDeTeste("geral"))
    expect(doGeral.length).toBeGreaterThan(1)
    // The second connection requests from position 11: the 11 stayed behind forever.
    expect(doGeral[doGeral.length - 1]?.afterSeq).toBe(11)
    expect(vault.contents.lastSeq[moradaDeTeste("geral")]).toBe(11)
  }, 60_000)
})

/**
 * **Channels appear before `auth.ok`** (WebKit, 2026-10-20).
 *
 * `restore()` ran only inside `#handshake`, after authentication. A
 * first socket that dropped before `auth.ok` (WebKit does it when switching tabs), or
 * an open with no network, left `channels` empty, and the interface
 * seeded the channel list as empty. Here the session is new, over a vault that already
 * holds groups, like an app that just opened.
 */
describe("os canais do cofre antes de autenticar", () => {
  async function aberturaNova(): Promise<Session> {
    const { session, backend } = await loadedSession()
    await session.flush()
    session.disconnect()
    const vault = new Vault(backend)
    await vault.unlock("frase-passe")
    const nova = new Session(vault)
    abertas.push(nova)
    nova.loadIdentity()
    return nova
  }

  it("um socket que fecha antes do auth.ok deixa channels com os grupos do cofre", async () => {
    const session = await aberturaNova()
    const eventos: string[][] = []
    session.on("channels", (evento) => eventos.push(evento.channels))
    FakeSocket.reply = (frame) => {
      if (frame.t === "hello") {
        setTimeout(() => FakeSocket.last?.close(), 0)
        return []
      }
      return servidorSaudavel(frame)
    }
    await session.connect().catch(() => {})
    await settle()
    expect(session.channels).toEqual(expect.arrayContaining([moradaDeTeste("geral"), moradaDeTeste("fotos")]))
    // And the interface knows: the event came out with them.
    expect(eventos.some((lista) => lista.includes(moradaDeTeste("geral")))).toBe(true)
  })

  it("abrir sem rede também mostra os canais", async () => {
    const session = await aberturaNova()
    FakeSocket.failToOpen = true
    await expect(session.connect()).rejects.toThrow("could not reach the homeserver")
    expect(session.channels).toEqual(expect.arrayContaining([moradaDeTeste("geral"), moradaDeTeste("fotos")]))
    // The unreadable stays out, as in the handshake.
    expect(session.channels).not.toContain(moradaDeTeste("ilegivel"))
  })
})

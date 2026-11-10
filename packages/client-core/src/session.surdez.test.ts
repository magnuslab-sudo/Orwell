import {
  addMembers,
  createChannel,
  decodeKeyPackage,
  encryptPayload,
  rotateEpoch,
  type GroupSession,
} from "@enclave/crypto"
import { fromBase64, generateIdentity, parseServerName, toBase64, type Identity, type Payload } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The deafness trigger, measured.
 *
 * `surdezConfirmada` declares a channel deaf, `repairChannel` requests a new seat, and
 * whoever responds does a reseat, which is a remove followed by an add. On the
 * side of whoever got reseated, forward secrecy closes everything said before:
 * the channel history vanishes and never comes back. This is the silent damage most
 * expensive that this product can do, and until now no one had measured what fires it.
 *
 * The question is one: **how many ignored events are enough, and on which ones?**
 *
 * Ana exists here only as encryption, needs no session or socket.
 * Bento is a real `Session` against a script server, because what we measure
 * is HIS bookkeeping.
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
  static last: FakeSocket | null = null
  static reply: (frame: Sent) => unknown[] | undefined = () => undefined

  readyState = 0
  readonly sent: Sent[] = []
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    FakeSocket.last = this
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
    const frame = JSON.parse(raw) as Sent
    this.sent.push(frame)
    for (const reply of FakeSocket.reply(frame) ?? []) {
      setTimeout(() => this.#fire("message", { data: JSON.stringify(reply) }), 0)
    }
  }

  /** Push a frame from the server without anyone asking for it. */
  empurrar(frame: unknown): void {
    setTimeout(() => this.#fire("message", { data: JSON.stringify(frame) }), 0)
  }

  close(): void {
    this.readyState = 3
    this.#fire("close", {})
  }

  #fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

const CANAL = "!lagar:localhost:8448"
const CASA = parseServerName("localhost:8448")

function texto(corpo: string): Payload {
  return { t: "message", id: crypto.randomUUID(), sentAt: 1, body: corpo, attachments: [], mentions: [], links: [] }
}

/** Normal responses to a handshake, plus the echo from the writer. */
function respostaBase(frame: Sent): unknown[] | undefined {
  if (frame.t === "hello") return [{ t: "hello.ok", version: 1, capabilities: [] }]
  if (frame.t === "auth.begin") return [{ t: "auth.challenge", nonce: "AAAA" }]
  if (frame.t === "auth.finish") return [{ t: "auth.ok", address: "@x:localhost:8448" }]
  if (frame.t === "channel.send") {
    // The relay returns what was given to it, with the reference of who wrote it: without
    // this, each `send` sits for ten seconds waiting for a receipt that never comes.
    return [
      {
        t: "channel.event",
        channel: frame.channel,
        seq: 900 + Math.floor(Math.random() * 90),
        kind: frame.kind,
        ciphertext: frame.ciphertext,
        receivedAtMinute: 0,
        ...(frame.ref !== undefined ? { ref: frame.ref } : {}),
      },
    ]
  }
  return undefined
}

let abertas: Session[] = []

async function bentoLigado(): Promise<{ session: Session; socket: FakeSocket }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  await session.createIdentity("localhost:8448")
  await session.connect()
  await assentar(20)
  const socket = FakeSocket.last
  if (!socket) throw new Error("sem socket")
  return { session, socket }
}

/** The first key package Bento published, which is how Ana invites him. */
function keyPackagePublicado(socket: FakeSocket): Uint8Array {
  const publicacao = socket.sent.find((frame) => frame.t === "keypackage.publish")
  const wire = (publicacao?.packages as string[] | undefined)?.[0]
  if (!wire) throw new Error("o Bento não publicou key packages")
  return fromBase64(wire)
}

async function assentar(vezes = 60): Promise<void> {
  for (let i = 0; i < vezes; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  FakeSocket.reply = respostaBase
  FakeSocket.last = null
  abertas = []
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  vi.useRealTimers()
  // A session does not die with the test that created it: timers keep running.
  // See the same trap in `session.corrida.test.ts`.
  for (const session of abertas) session.disconnect()
  abertas = []
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

/**
 * Ana founds the channel, says `how many` things BEFORE Bento has a seat, and only
 * then invites him. This is the most ordinary form a channel has: whoever arrives
 * today arrives in a room where people already talked.
 */
async function canalComHistoria(
  keyPackage: Uint8Array,
  quantas: number,
): Promise<{ ana: Identity; grupo: GroupSession; antes: string[]; welcome: string }> {
  const ana = generateIdentity(CASA)
  let grupo = await createChannel(ana, CANAL)

  const antes: string[] = []
  for (let i = 0; i < quantas; i++) {
    const dito = await encryptPayload(grupo, texto(`antes ${i}`))
    grupo = dito.session
    antes.push(toBase64(dito.ciphertext))
  }

  const convite = await addMembers(grupo, [decodeKeyPackage(keyPackage)])
  return { ana, grupo: convite.session, antes, welcome: toBase64(convite.welcome) }
}

describe("surdez: quem entra num canal que já tem história", () => {
  it("não fica surdo por causa do que nunca poderia ler", async () => {
    const { session, socket } = await bentoLigado()
    const { antes, welcome } = await canalComHistoria(keyPackagePublicado(socket), 6)

    /*
      The catch-up delivers everything before Bento's seat, because that is what
      the server stores and has no way to know what he opens. Each one of these
      is `ignored`, with "epoch too old", and forward secrecy guarantees that
      NONE of them will ever open. There are six, and `DEAF_FAILURES` is five.
    */
    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (base) return base
      if (frame.t === "channel.backfill") {
        return [
          {
            t: "channel.backfill.page",
            channel: frame.channel,
            more: false,
            events: antes.map((ciphertext, indice) => ({
              seq: indice,
              kind: "application",
              ciphertext,
              receivedAtMinute: 0,
            })),
          },
        ]
      }
      return undefined
    }

    socket.empurrar({
      t: "channel.event",
      channel: CANAL,
      seq: antes.length,
      kind: "welcome",
      ciphertext: welcome,
      receivedAtMinute: 0,
    })
    await assentar(200)
    expect(session.channels).toContain(CANAL)

    /*
      And now the second condition: the series must hurt for thirty seconds. `since` is
      only reset by a SUCCESS, and in a silent channel there is none, so the series
      opened by the history stays open half an hour later. One more unreadable frame
      is enough, and it does not even need to be a sign of trouble: our echo, a
      repeated handshake, plus one more page of history.
    */
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.now() + 31_000)

    socket.empurrar({
      t: "channel.event",
      channel: CANAL,
      seq: antes.length + 1,
      kind: "application",
      ciphertext: antes[0],
      receivedAtMinute: 0,
    })
    await assentar(120)

    expect(session.deafChannels()).not.toContain(CANAL)
    expect(socket.sent.filter((frame) => frame.t === "channel.rejoin.request")).toHaveLength(0)
  }, 120_000)

  it("mas um lugar que morreu continua a ser declarado surdo", async () => {
    const { session, socket } = await bentoLigado()
    const { grupo, welcome } = await canalComHistoria(keyPackagePublicado(socket), 0)

    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (base) return base
      if (frame.t === "channel.backfill") {
        return [{ t: "channel.backfill.page", channel: frame.channel, more: false, events: [] }]
      }
      return undefined
    }

    socket.empurrar({
      t: "channel.event",
      channel: CANAL,
      seq: 0,
      kind: "welcome",
      ciphertext: welcome,
      receivedAtMinute: 0,
    })
    await assentar(200)
    expect(session.channels).toContain(CANAL)

    /*
      The channel advances two epochs without the commits reaching Bento, that is what
      a dead seat looks like from inside: the world keeps moving and he stays where he was.
      What reaches him next are messages from an epoch AHEAD of his, and
      that is deafness for real: must keep being treated as such.
    */
    let depois = grupo
    for (let i = 0; i < 2; i++) depois = (await rotateEpoch(depois)).session
    const ilegiveis: string[] = []
    for (let i = 0; i < 6; i++) {
      const dito = await encryptPayload(depois, texto(`depois ${i}`))
      depois = dito.session
      ilegiveis.push(toBase64(dito.ciphertext))
    }

    for (const [indice, ciphertext] of ilegiveis.entries()) {
      socket.empurrar({
        t: "channel.event",
        channel: CANAL,
        seq: 10 + indice,
        kind: "application",
        ciphertext,
        receivedAtMinute: 0,
      })
    }
    await assentar(200)

    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.now() + 31_000)

    const dito = await encryptPayload(depois, texto("e mais uma"))
    socket.empurrar({
      t: "channel.event",
      channel: CANAL,
      seq: 20,
      kind: "application",
      ciphertext: toBase64(dito.ciphertext),
      receivedAtMinute: 0,
    })
    await assentar(120)

    expect(session.deafChannels()).toContain(CANAL)
    expect(socket.sent.filter((frame) => frame.t === "channel.rejoin.request").length).toBeGreaterThan(0)
  }, 120_000)
})

/**
 * What deafness leaves behind when the account goes away.
 *
 * `reset()` exists to drop everything this session holds in memory, and that is what
 * `bridge.ts` calls to lock the vault and import another account to the same
 * tab. The deafness bookkeeping was left out, and the key to these maps
 * is the CHANNEL, which in the case of the common room is the same identifier for
 * everyone on the same server.
 *
 * What that is worth, measured here: an account that went deaf leaves five failures and
 * an old `since` under the channel name. `surdezConfirmada` asks for five
 * failures and thirty seconds, and both conditions are already met before the
 * next account reads the first frame. The new account enters a healthy channel and is
 * declared deaf in it; after that comes the reseat, and reseat takes the history.
 */
describe("surdez: o que fica para a conta seguinte", () => {
  it("reset() larga a contabilidade da surdez", async () => {
    const { session, socket } = await bentoLigado()
    const { grupo, welcome } = await canalComHistoria(keyPackagePublicado(socket), 0)

    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (base) return base
      if (frame.t === "channel.backfill") {
        return [{ t: "channel.backfill.page", channel: frame.channel, more: false, events: [] }]
      }
      return undefined
    }

    socket.empurrar({
      t: "channel.event",
      channel: CANAL,
      seq: 0,
      kind: "welcome",
      ciphertext: welcome,
      receivedAtMinute: 0,
    })
    await assentar(200)
    expect(session.channels).toContain(CANAL)

    // Same dead channel as the test above: the channel advances two epochs without
    // commits arriving, and what comes next is unreadable for real.
    let depois = grupo
    for (let i = 0; i < 2; i++) depois = (await rotateEpoch(depois)).session
    for (let i = 0; i < 6; i++) {
      const dito = await encryptPayload(depois, texto(`depois ${i}`))
      depois = dito.session
      socket.empurrar({
        t: "channel.event",
        channel: CANAL,
        seq: 10 + i,
        kind: "application",
        ciphertext: toBase64(dito.ciphertext),
        receivedAtMinute: 0,
      })
    }
    await assentar(200)

    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.now() + 31_000)
    const ultima = await encryptPayload(depois, texto("e mais uma"))
    socket.empurrar({
      t: "channel.event",
      channel: CANAL,
      seq: 20,
      kind: "application",
      ciphertext: toBase64(ultima.ciphertext),
      receivedAtMinute: 0,
    })
    await assentar(120)

    // The baseline: this account is truly deaf on this channel.
    expect(session.deafChannels()).toContain(CANAL)

    /*
      Leaving the channel already erases the record, and that's the half that
      matters most: you rejoin the same channel by a new invite, and the common
      room is the same identifier for everyone on the same server, forgotten and
      rejoined in one gesture by `#contarDesmentido`. With the old chain beneath,
      the first frame the new entry does not open declared it deaf again, and
      then comes the reseat, which wipes the history just received.
    */
    await session.forgetChannel(CANAL)
    expect(session.deafChannels()).toEqual([])

    // And whatever remains from any other channel goes away with the account.
    session.reset()

    // And the next one inherits nothing from it. Without cleanup, the channel
    // stays here, with the five failures and the clock already expired, and the
    // first frame the new account does not open declares it deaf right away.
    expect(session.deafChannels()).toEqual([])
  }, 120_000)
})

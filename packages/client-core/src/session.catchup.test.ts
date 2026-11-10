import { addMembers, createChannel, decodeKeyPackage, encryptPayload } from "@enclave/crypto"
import { fromBase64, generateIdentity, parseServerName, toBase64, type Payload } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * Two channels catching up at the same time, and what happens when the server
 * stays silent on one of the requests.
 *
 * `#catchUpChannel` asks and waits for the **next** `channel.backfill.page`
 * that arrives, from whatever channel, and if it comes from another one it does
 * `break`, without a word, without logging, without retrying. The `#await`
 * queue pairs by frame TYPE and by arrival order, and that order is reliable
 * only while the server responds to everything.
 *
 * And the server does not respond to everything: `channel.backfill` is silently
 * discarded when the requester has no place in the channel (`#mayReach`) and
 * when it passes the sixty-per-minute limit (`BACKFILLS_POR_MINUTO`), which a
 * device with three lagging channels passes without effort, because
 * `#catchUpChannel` asks for up to forty pages per channel.
 *
 * The `#onClose` already has the other half of this trap written in a comment:
 * the connection that dropped left waits behind, the new one answered them, and
 * "that channel silently stopped catching up". The missing half is this, and it
 * does not need any socket to die.
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

const CALADO = "!calado:localhost:8448"
const FALADOR = "!falador:localhost:8448"
const CASA = parseServerName("localhost:8448")

function texto(corpo: string): Payload {
  return { t: "message", id: crypto.randomUUID(), sentAt: 1, body: corpo, attachments: [], mentions: [], links: [] }
}

function respostaBase(frame: Sent): unknown[] | undefined {
  if (frame.t === "hello") return [{ t: "hello.ok", version: 1, capabilities: [] }]
  if (frame.t === "auth.begin") return [{ t: "auth.challenge", nonce: "AAAA" }]
  if (frame.t === "auth.finish") return [{ t: "auth.ok", address: "@x:localhost:8448" }]
  if (frame.t === "channel.send") {
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

async function bentoLigado(): Promise<{ session: Session; vault: Vault; socket: FakeSocket }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  await session.createIdentity("localhost:8448")
  await session.connect()
  await assentar(20)
  const socket = FakeSocket.last
  if (!socket) throw new Error("sem socket")
  return { session, vault, socket }
}

/** The key packages that Bento published: others invite him because of them. */
function keyPackagesPublicados(socket: FakeSocket): Uint8Array[] {
  const publicacao = socket.sent.find((frame) => frame.t === "keypackage.publish")
  const wires = publicacao?.packages as string[] | undefined
  if (!wires || wires.length < 2) throw new Error("o Bento não publicou key packages que cheguem")
  return wires.map(fromBase64)
}

async function assentar(vezes = 60): Promise<void> {
  for (let i = 0; i < vezes; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** A channel founded by someone else, with history, and the invite for Bento. */
async function canalComConvite(
  canal: string,
  keyPackage: Uint8Array,
  quantas: number,
): Promise<{ historia: string[]; welcome: string }> {
  const dono = generateIdentity(CASA)
  let grupo = await createChannel(dono, canal)

  const convite = await addMembers(grupo, [decodeKeyPackage(keyPackage)])
  grupo = convite.session

  // Said AFTER the invite, so at Bento's epoch: this is what he opens, and that
  // is why it serves as a measure, if it does not arrive, it was the catch-up
  // that got lost.
  const historia: string[] = []
  for (let i = 0; i < quantas; i++) {
    const dito = await encryptPayload(grupo, texto(`${canal} ${i}`))
    grupo = dito.session
    historia.push(toBase64(dito.ciphertext))
  }

  return { historia, welcome: toBase64(convite.welcome) }
}

beforeEach(() => {
  FakeSocket.reply = respostaBase
  FakeSocket.last = null
  abertas = []
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  for (const session of abertas) session.disconnect()
  abertas = []
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

describe("catch-up de dois canais ao mesmo tempo", () => {
  it("uma pergunta que o servidor cala não leva a resposta do outro canal atrás", async () => {
    const { session, vault, socket } = await bentoLigado()
    const [primeiro, segundo] = keyPackagesPublicados(socket)
    if (!primeiro || !segundo) throw new Error("faltam key packages")

    const calado = await canalComConvite(CALADO, primeiro, 3)
    const falador = await canalComConvite(FALADOR, segundo, 3)

    /*
      The server stays silent on one channel and responds on the other. It is
      not a hostile server: it is exactly what `gateway.ts` does when `#mayReach`
      says no (a room the server no longer knows, the same state that lights up
      "this room no longer exists") or when the backfill limit overflows. In both
      cases it does `return` without saying anything to anyone.
    */
    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (base) return base
      if (frame.t === "channel.backfill") {
        if (frame.channel === CALADO) return undefined
        return [
          {
            t: "channel.backfill.page",
            channel: frame.channel,
            more: false,
            events: falador.historia.map((ciphertext, indice) => ({
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

    /*
      Two invites waiting are the most ordinary thing in the world: someone who
      was away for a day connects and the server delivers them all at once, in
      the `welcome.resync` that the handshake sends before catch-up. Each welcome
      does its own `#catchUp`, and welcomes do not go through the per-channel
      queue, so the two run side by side.
    */
    socket.empurrar({
      t: "channel.event",
      channel: CALADO,
      seq: 0,
      kind: "welcome",
      ciphertext: calado.welcome,
      receivedAtMinute: 0,
    })
    // A short head start, just so the silent channel is first to ask.
    await assentar(120)
    socket.empurrar({
      t: "channel.event",
      channel: FALADOR,
      seq: 0,
      kind: "welcome",
      ciphertext: falador.welcome,
      receivedAtMinute: 0,
    })
    await assentar(300)

    expect(session.channels).toContain(FALADOR)

    // The channel the server answered must have caught up. The anchor is the right
    // measure: it says where the next connection will continue from.
    expect(vault.contents.lastSeq[FALADOR]).toBe(falador.historia.length - 1)

    // And the silent one stays to catch up, which is expected and not a bug: the
    // bug was dragging the other one with it.
    expect(vault.contents.lastSeq[CALADO]).toBeUndefined()
  }, 120_000)
})

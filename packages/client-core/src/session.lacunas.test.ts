import { addMembers, createChannel, decodeKeyPackage, encryptPayload, generateKeyPackages } from "@enclave/crypto"
import { fromBase64, generateIdentity, parseServerName, toBase64, type Payload } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * **The gaps: what the anchor skipped without reading gets named.**
 *
 * The gate (`#portaoFechado`) is the primary path and handles most cases. This is the
 * fallback below it for when it fails, and it fails on purpose, because a
 * gate with no cap is a dangling connection and a channel that cannot send:
 *
 *   - a recovery that exhausts the 40 p pages, or that hits a silent server
 *     (the cap of 60 backfills per minute, `Gateway.BACKFILLS_POR_MINUTO`,
 *     where it neither responds nor says it cannot respond);
 *   - a retained frame that applies without reaching the anchor: stays usable, but
 *     leaves unread events behind.
 *
 * In that case the next recovery finds messages from an epoch the group
 * already left behind. Before 5 October 2026 it was worth `"lido"` and the
 * anchor passed over it in silence forever. Now:
 *
 *   1. enters the channel's gap list, PERSISTED in the vault, and the test
 *      reopens the vault from scratch, because the September trap was writing to
 *      live content with `flush` exiting early and tests asserting against
 *      memory;
 *   2. a diagnostic comes out with a name, `epoca-saltada`, with channel and `seq`;
 *   3. **and the channel does NOT enter `deafChannels()`.** This is the part that cannot
 *      break: reporting it marked channels as deaf where someone had just
 *      joined, and behind deafness comes the repair that pulls the
 *      history. It is the decision from 16 August (`docs/PENDENTES.md`), and
 *      "not mark as read" and "not count toward deafness" are different things;
 *   4. and it gets asked again on the next connection, one at a time.
 *
 * This file takes eleven seconds on purpose: the ten-second wait for a page
 * the server does not respond to is the mechanism that does it, and simulating it with a
 * fake clock would measure something else.
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

const CANAL = "!contio:localhost:8448"
const CASA = parseServerName("localhost:8448")
/** The timeout for `#await` on a page, plus the slack of waiting for it. */
const ESPERA_DA_PAGINA_MS = 11_500
/**
 * The minute the server puts in events, and why it is not zero.
 *
 * `receivedAtMinute` is the clock by which a gap expires: pruning throws away
 * anything older than the retention announced in `hello.ok`. With zero, which is
 * what most fixtures in this folder use, because they don't care, gaps
 * started from 1970 and were pruned in the same write they entered. That is exactly
 * what happened on the first run of this test.
 */
const MINUTO_DE_AGORA = Math.floor(Date.now() / 60_000)

function texto(corpo: string): Payload {
  return { t: "message", id: crypto.randomUUID(), sentAt: 1, body: corpo, attachments: [], mentions: [], links: [] }
}

function respostaBase(frame: Sent): unknown[] | undefined {
  if (frame.t === "hello") return [{ t: "hello.ok", version: 1, capabilities: [], retentionDays: 30 }]
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
const estados: { code?: string; channel?: string; detail: string }[] = []

async function assentar(vezes = 60): Promise<void> {
  for (let i = 0; i < vezes; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function escutar(session: Session): void {
  session.on("status", (estado) => estados.push(estado))
}

async function bentoLigado(backend: MemoryBackend): Promise<{ session: Session; vault: Vault; socket: FakeSocket }> {
  const vault = new Vault(backend)
  await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  escutar(session)
  await session.createIdentity("localhost:8448")
  await session.connect()
  await assentar(20)
  const socket = FakeSocket.last
  if (!socket) throw new Error("sem socket")
  return { session, vault, socket }
}

/** The same vault, reopened from scratch: another `Vault`, another `Session`, the same bytes. */
async function reabrir(backend: MemoryBackend): Promise<{ session: Session; vault: Vault }> {
  const vault = new Vault(backend)
  await vault.unlock("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  escutar(session)
  session.loadIdentity()
  return { session, vault }
}

function keyPackagesPublicados(socket: FakeSocket): Uint8Array[] {
  const publicacao = socket.sent.find((frame) => frame.t === "keypackage.publish")
  const wires = publicacao?.packages as string[] | undefined
  if (!wires || wires.length < 1) throw new Error("o Bento não publicou key packages")
  return wires.map(fromBase64)
}

interface Evento {
  seq: number
  kind: "application" | "handshake"
  ciphertext: string
  receivedAtMinute: number
}

/**
 * Another person's channel: the invite, three messages in Bento's epoch, four
 * commits, and an event from BEFORE his seat with a HIGH `seq`.
 *
 * That last one is not decoration: it is the false positive the first version of this
 * fix produced, tested against `scripts/e2e-cliente-antigo.mjs`. A member
 * encrypts in the epoch before the commit that gives us a seat, and the server numbers that
 * event AFTER our commit because it arrived after. `seq` above our seat,
 * epoch below ours: it was never ours, never will open, and it was announced as
 * a loss.
 */
async function canalDoDono(socket: FakeSocket): Promise<{
  welcome: string
  eventos: Evento[]
  corpos: string[]
  anteriorAoLugar: Evento
}> {
  const dono = generateIdentity(CASA)
  let grupo = await createChannel(dono, CANAL)

  const pacoteDoBento = keyPackagesPublicados(socket)[0]
  if (!pacoteDoBento) throw new Error("faltam key packages do Bento")

  // Sent BEFORE the invite, so in the epoch before Bento's seat. The `seq`
  // goes up on purpose: above everything the invite brought.
  const antes = await encryptPayload(grupo, texto("de antes do lugar"))
  grupo = antes.session
  const anteriorAoLugar: Evento = {
    seq: 50,
    kind: "application",
    ciphertext: toBase64(antes.ciphertext),
    receivedAtMinute: MINUTO_DE_AGORA,
  }

  const convite = await addMembers(grupo, [decodeKeyPackage(pacoteDoBento)])
  grupo = convite.session

  const eventos: Evento[] = []
  const corpos: string[] = []
  for (let i = 0; i < 3; i++) {
    const corpo = `dito ${i}`
    const dito = await encryptPayload(grupo, texto(corpo))
    grupo = dito.session
    eventos.push({
      seq: 1 + i,
      kind: "application",
      ciphertext: toBase64(dito.ciphertext),
      receivedAtMinute: MINUTO_DE_AGORA,
    })
    corpos.push(corpo)
  }
  for (let i = 0; i < 4; i++) {
    const figurante = generateIdentity(CASA)
    const pacotes = await generateKeyPackages(figurante, 1)
    const pacote = pacotes[0]
    if (!pacote) throw new Error("sem pacote para o figurante")
    const commit = await addMembers(grupo, [pacote.publicPackage])
    grupo = commit.session
    eventos.push({
      seq: 4 + i,
      kind: "handshake",
      ciphertext: toBase64(commit.commit),
      receivedAtMinute: MINUTO_DE_AGORA,
    })
  }

  return { welcome: toBase64(convite.welcome), eventos, corpos, anteriorAoLugar }
}

beforeEach(() => {
  FakeSocket.reply = respostaBase
  FakeSocket.last = null
  abertas = []
  estados.length = 0
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  for (const session of abertas) session.disconnect()
  abertas = []
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

describe("a lista de lacunas", () => {
  it(
    "o que não se leu fica no cofre reaberto, com nome no diagnóstico, sem surdez, e volta a ser pedido",
    async () => {
      const backend = new MemoryBackend()
      const { session, vault, socket } = await bentoLigado(backend)
      const canal = await canalDoDono(socket)
      const commits = canal.eventos.filter((evento) => evento.kind === "handshake")
      const mensagens = canal.eventos.filter((evento) => evento.kind === "application")

      /*
        The gate's cap, assembled step by step.

        Request 1: push the four live commits (the gate holds them) and
        respond with the FIRST message only, saying there is more.
        Request 2: silence, it is the server's backfill cap, which does not respond
        nor say it won't. The recovery waits ten seconds and gives up.
        Then the gate opens: the commits apply without the anchor moving (seq 4 does not
        touch 1), a hole opens at 2, and the next recovery finds
        messages 2 and 3 in an epoch the group has already left.
        Request 3 onward: respond with everything.
      */
      let pedidos = 0
      FakeSocket.reply = (frame) => {
        const base = respostaBase(frame)
        if (base) return base
        if (frame.t !== "channel.backfill" || frame.channel !== CANAL) return undefined
        pedidos += 1
        const numero = pedidos
        const depois = typeof frame.afterSeq === "number" ? frame.afterSeq : -1
        const limite = typeof frame.limit === "number" ? frame.limit : 100
        void (async () => {
          if (numero === 1) {
            for (const commit of commits) {
              socket.empurrar({
                t: "channel.event",
                channel: CANAL,
                seq: commit.seq,
                kind: commit.kind,
                ciphertext: commit.ciphertext,
                receivedAtMinute: MINUTO_DE_AGORA,
              })
            }
            await assentar(30)
            socket.empurrar({ t: "channel.backfill.page", channel: CANAL, more: true, events: [mensagens[0]] })
            return
          }
          if (numero === 2) return
          const seguintes = canal.eventos.filter((evento) => evento.seq > depois).slice(0, limite)
          socket.empurrar({
            t: "channel.backfill.page",
            channel: CANAL,
            more: false,
            events: seguintes,
          })
        })()
        return undefined
      }

      socket.empurrar({
        t: "channel.event",
        channel: CANAL,
        seq: 0,
        kind: "welcome",
        ciphertext: canal.welcome,
        receivedAtMinute: 0,
      })
      await dormir(ESPERA_DA_PAGINA_MS)
      await assentar(300)

      expect(session.channels).toContain(CANAL)

      // The first one got in (the recovery read it before the gate opened); the
      // other two are the loss this names.
      const lidas = (vault.contents.history[CANAL] ?? [])
        .filter((entrada) => entrada.payload.t === "message")
        .map((entrada) => String(entrada.payload.body))
      expect(lidas).toEqual([canal.corpos[0]])

      const lacunas = (vault.contents.lacunas?.[CANAL] ?? []).map((lacuna) => lacuna.seq)
      expect(lacunas).toEqual([2, 3])

      // The diagnostic with a name, with channel and `seq`, and in the log not in a bubble.
      const saltadas = estados.filter((estado) => estado.code === "epoca-saltada")
      expect(saltadas.length).toBeGreaterThanOrEqual(2)
      expect(saltadas.every((estado) => estado.channel === CANAL)).toBe(true)
      expect(saltadas.some((estado) => estado.detail.includes(" 2 "))).toBe(true)
      expect(saltadas.some((estado) => estado.detail.includes(" 3 "))).toBe(true)

      // **And the channel is not deaf.** This is the August 16 decision, intact.
      expect(session.deafChannels()).not.toContain(CANAL)
      expect(session.deafChannels()).toEqual([])

      session.disconnect()
      await assentar(20)

      // THE VAULT REOPENED FROM SCRATCH. This is where the September trap would die:
      // a gap written only to live content would not show on this line.
      const voltou = await reabrir(backend)
      expect((voltou.vault.contents.lacunas?.[CANAL] ?? []).map((lacuna) => lacuna.seq)).toEqual([2, 3])

      /*
        And on the next connection it gets requested again, one at a time, **FROM THE MOST
        RECENT to the oldest**.
        
        The order is not tidiness. It used to ask for the oldest (`slice(0, …)`) with a
        cap of ten per connection, and a gap from an epoch whose keys were already
        thrown away never gives proof: it stayed in the list forever and took the same
        slot on every connection, so the up to 190 remaining, the recent ones
        included, which are the only ones this device can still have the epoch for,         never got attempted. See `LACUNAS_POR_LIGACAO` and
        `TENTATIVAS_POR_LACUNA`.
        */
      const pedidosDeLacuna: number[] = []
      FakeSocket.reply = (frame) => {
        const base = respostaBase(frame)
        if (base) return base
        if (frame.t !== "channel.backfill" || frame.channel !== CANAL) return undefined
        const depois = typeof frame.afterSeq === "number" ? frame.afterSeq : -1
        const limite = typeof frame.limit === "number" ? frame.limit : 100
        if (limite === 1) pedidosDeLacuna.push(depois + 1)
        const seguintes = canal.eventos.filter((evento) => evento.seq > depois).slice(0, limite)
        return [{ t: "channel.backfill.page", channel: CANAL, more: false, events: seguintes }]
      }
      await voltou.session.connect()
      await assentar(300)

      expect(pedidosDeLacuna).toEqual([3, 2])
      // They stay in the list: an event from an epoch thrown away never opens again,
      // and the list is the honest record of it until retention takes it.
      expect((voltou.vault.contents.lacunas?.[CANAL] ?? []).map((lacuna) => lacuna.seq)).toEqual([2, 3])
      expect(voltou.session.deafChannels()).toEqual([])
    },
    120_000,
  )
})

/**
 * **The false positive, the August 16 trap in another guise.**
 *
 * The first version of this fix decided "this was mine" by comparing the event's `seq`
 * with `seatSince`, which is a SEQUENCE number. When someone joins a channel,  * by Welcome or by seat, they join in epoch E; an event another member
 * encrypted in epoch E-1 and the server numbered AFTER our commit, because
 * it arrived after, has `seq` above our seat and epoch below ours. It was never
 * ours and never will open.
 *
 * The `scripts/e2e-cliente-antigo.mjs` caught it on the first run: a seat entry in the
 * common room, perfectly healthy, with a loss announced at error level and thirty days of
 * server requests behind it. It is the same form of error the August 16 decision
 * exists to forbid, reporting a problem to someone who just joined.
 *
 * The right question is of epoch: did this device EVER HAVE this epoch? See
 * `#epocaAoLigar`.
 */
describe("o que é de antes do nosso lugar não é lacuna", () => {
  it("uma trama de uma epoch anterior ao lugar, com seq acima dele, não é perda nenhuma", async () => {
    const backend = new MemoryBackend()
    const { session, vault, socket } = await bentoLigado(backend)
    const canal = await canalDoDono(socket)

    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (base) return base
      if (frame.t !== "channel.backfill" || frame.channel !== CANAL) return undefined
      const depois = typeof frame.afterSeq === "number" ? frame.afterSeq : -1
      // Everything the invite brought, AND the event from before the seat with the high seq.
      const todos = [...canal.eventos, canal.anteriorAoLugar].filter((evento) => evento.seq > depois)
      return [{ t: "channel.backfill.page", channel: CANAL, more: false, events: todos }]
    }

    socket.empurrar({
      t: "channel.event",
      channel: CANAL,
      seq: 0,
      kind: "welcome",
      ciphertext: canal.welcome,
      receivedAtMinute: 0,
    })
    await assentar(400)

    expect(session.channels).toContain(CANAL)
    // The three from Bento's epoch got in, in order, with the commits in between.
    const lidas = (vault.contents.history[CANAL] ?? [])
      .filter((entrada) => entrada.payload.t === "message")
      .map((entrada) => String(entrada.payload.body))
    expect(lidas).toEqual(canal.corpos)

    // And the one from before the seat did not get in, it could not, and is NOT a gap.
    expect(lidas).not.toContain("de antes do lugar")
    expect(vault.contents.lacunas).toBeUndefined()
    expect(estados.filter((estado) => estado.code === "epoca-saltada")).toEqual([])
    // And it is not deafness either, which is the half that cannot break.
    expect(session.deafChannels()).toEqual([])
  }, 120_000)
})

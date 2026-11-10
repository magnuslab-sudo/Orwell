import { addMembers, createChannel, decodeKeyPackage, encryptPayload, epochOf, importSession, rotateEpoch, type GroupSession } from "@enclave/crypto"
import { fromBase64, generateIdentity, parseServerName, toBase64, type Payload } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Session, type SessionEvents } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The read anchor and the group state cannot get out of sync.
 *
 * The common production room split into three branches on 12/9/2026 (epochs 12, 16 and
 * 17). Two of the doors where this happened are in this file, and both were
 * the same thing seen from two sides: the number saying "I've read up to here" moving ahead of
 * a commit that the group never applied. From that point the commit
 * is never requested again, and the device stays in an epoch no one uses anymore.
 *
 * - **Live, before the channel's turn.** The subscription exits before recovery,
 *   and recovery is one channel at a time. A live frame from the last channel
 *   would advance its anchor, and when recovery's turn came it would start after
 *   the missing commit.
 * - **On disk.** The anchor was saved right away, with the OLD group in the same vault;
 *   the new group would go to disk a second and a half later. Reloading in that window
 *   left the new anchor and old group for good.
 *
 * The server here is a script: it responds to what is asked and lets the test decide what
 * reaches live and when. The frames are all real MLS, produced by an
 * owner on the other side with the real library.
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

interface Evento {
  seq: number
  kind: string
  ciphertext: string
  recipient?: string
}

const CASA = parseServerName("localhost:8448")
const OUTRO = "!outro:localhost:8448"
const SALA = "!sala:localhost:8448"

/** The server, reduced to a script that the test writes. */
class Guiao {
  readonly log = new Map<string, Evento[]>()
  /** Recovery page delay, per channel. */
  readonly atrasos = new Map<string, number>()
  capacidades: string[] = []
  salaComum: string | undefined
  temCartao = false
  aoSubscrever: (socket: FakeSocket, canais: string[]) => void = () => {}

  acrescentar(canal: string, kind: string, bytes: Uint8Array, recipient?: string): Evento {
    const log = this.log.get(canal) ?? []
    const evento: Evento = { seq: log.length, kind, ciphertext: toBase64(bytes), ...(recipient ? { recipient } : {}) }
    log.push(evento)
    this.log.set(canal, log)
    return evento
  }

  responder(socket: FakeSocket, frame: Sent): void {
    switch (frame.t) {
      case "hello":
        socket.entregar({
          t: "hello.ok",
          version: 1,
          capabilities: this.capacidades,
          ...(this.salaComum ? { commonRoom: this.salaComum, commonRoomGroupInfo: this.temCartao } : {}),
        })
        return
      case "auth.begin":
        socket.address = frame.address as string
        socket.entregar({ t: "auth.challenge", nonce: "AAAA" })
        return
      case "auth.finish":
        socket.entregar({ t: "auth.ok", address: socket.address })
        return
      case "channel.subscribe":
        this.aoSubscrever(socket, frame.channels as string[])
        return
      case "channel.backfill": {
        const canal = frame.channel as string
        const depois = frame.afterSeq as number | undefined
        if (depois === undefined) {
          socket.entregar({ t: "channel.backfill.page", channel: canal, events: [], more: false })
          return
        }
        const events = (this.log.get(canal) ?? [])
          .filter((evento) => evento.seq > depois && (!evento.recipient || evento.recipient === socket.address))
          .map(({ seq, kind, ciphertext }) => ({ seq, kind, ciphertext, receivedAtMinute: 0 }))
        socket.entregar({ t: "channel.backfill.page", channel: canal, events, more: false }, this.atrasos.get(canal) ?? 0)
        return
      }
      case "channel.claim":
        socket.entregar({ t: "channel.claim.result", channel: frame.channel, owner: "@outra:localhost:8448", mine: false, empty: false })
        return
      case "channel.groupinfo.take":
        socket.entregar({ t: "channel.groupinfo", channel: frame.channel })
        return
      case "channel.rejoin.request":
        socket.entregar({ t: "channel.rejoin.sent", channel: frame.channel, ouviram: 0 })
        return
      default:
        return
    }
  }
}

let guiao = new Guiao()

class FakeSocket {
  static ultimo: FakeSocket | null = null
  address: string | null = null
  readyState = 0
  readonly sent: Sent[] = []
  readonly #guiao = guiao
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    FakeSocket.ultimo = this
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
    this.#guiao.responder(this, frame)
  }

  entregar(frame: unknown, atraso = 0): void {
    setTimeout(() => {
      if (this.readyState === 1) this.#fire("message", { data: JSON.stringify(frame) })
    }, atraso)
  }

  /** An event from the server log, pushed live as `broadcast` does. */
  aoVivo(canal: string, evento: Evento, atraso = 0): void {
    this.entregar({ t: "channel.event", channel: canal, ...evento, receivedAtMinute: 0 }, atraso)
  }

  close(): void {
    this.readyState = 3
    this.#fire("close", {})
  }

  #fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

function texto(corpo: string): Payload {
  return { t: "message", id: crypto.randomUUID(), sentAt: 1, body: corpo, attachments: [], mentions: [], links: [] }
}

async function assentar(vezes = 60): Promise<void> {
  for (let i = 0; i < vezes; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Wait for a condition, with a timeout. Returns whether it happened; the caller asserts. */
async function ate(condicao: () => boolean, prazoMs = 5_000): Promise<boolean> {
  const limite = Date.now() + prazoMs
  while (Date.now() < limite) {
    if (condicao()) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return condicao()
}

let abertas: Session[] = []

interface Bento {
  session: Session
  vault: Vault
  backend: MemoryBackend
  /** The room's group from the owner's side, who produces the frames. */
  sala: GroupSession
  estados: SessionEvents["status"][]
}

/**
 * Bento, member of two channels: OTHER enters the vault first and then ROOM,
 * like the common room, which is (re)inserted at the end of `contents.groups` when
 * you enter it. That puts it last in recovery.
 */
async function bentoEmDoisCanais(): Promise<Bento> {
  const backend = new MemoryBackend()
  const vault = new Vault(backend)
  await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  const estados: SessionEvents["status"][] = []
  session.on("status", (estado) => estados.push(estado))
  const { address } = await session.createIdentity("localhost:8448")
  await session.connect()
  await assentar(20)
  const socket = FakeSocket.ultimo as FakeSocket
  const pacotes = (socket.sent.find((frame) => frame.t === "keypackage.publish")?.packages as string[]).map(fromBase64)

  const dono = generateIdentity(CASA)
  const outro = await addMembers(await createChannel(dono, OUTRO), [decodeKeyPackage(pacotes[0] as Uint8Array)])
  const sala = await addMembers(await createChannel(dono, SALA), [decodeKeyPackage(pacotes[1] as Uint8Array)])

  socket.aoVivo(OUTRO, guiao.acrescentar(OUTRO, "welcome", outro.welcome, address))
  expect(await ate(() => session.channels.includes(OUTRO))).toBe(true)
  socket.aoVivo(SALA, guiao.acrescentar(SALA, "welcome", sala.welcome, address))
  expect(await ate(() => session.channels.includes(SALA))).toBe(true)
  // The recovery each entry does, and the delayed save, settling down.
  await ate(() => vault.contents.lastSeq[SALA] === 0 && vault.contents.lastSeq[OUTRO] === 0)
  expect(epochOf(session.groupFor(SALA) as GroupSession)).toBe(1n)
  return { session, vault, backend, sala: sala.session, estados }
}

beforeEach(() => {
  guiao = new Guiao()
  abertas = []
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  vi.useRealTimers()
  for (const session of abertas) session.disconnect()
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

describe("M1: a âncora não passa por cima de um commit por aplicar", () => {
  it("uma trama ao vivo que chega antes da vez do canal não salta o commit que falta", async () => {
    const { session, vault, sala } = await bentoEmDoisCanais()
    session.disconnect()
    await assentar(50)

    // While Bento is away: one commit (1→2) and a message already in 2.
    const rotacao = await rotateEpoch(sala)
    const dita = await encryptPayload(rotacao.session, texto("batimento"))
    guiao.acrescentar(SALA, "handshake", rotacao.commits[0] as Uint8Array)
    const eventoDito = guiao.acrescentar(SALA, "application", dita.ciphertext)

    // The first channel takes time to recover; the room gets a beat live
    // as soon as the subscription opens, long before its turn comes.
    guiao.atrasos.set(OUTRO, 150)
    guiao.aoSubscrever = (socket) => socket.aoVivo(SALA, eventoDito, 5)

    await session.connect()
    const chegou = await ate(() => epochOf(session.groupFor(SALA) as GroupSession) === 2n)

    expect(chegou).toBe(true)
    expect(vault.contents.lastSeq[SALA]).toBe(eventoDito.seq)
    // And it was read once, not twice: the live frame and recovery are the same.
    expect(session.history(SALA).filter((m) => m.payload.t === "message")).toHaveLength(1)
  }, 60_000)

  it("nem uma trama ao vivo que ABRE, dita por quem ainda não aplicou o commit, adianta a âncora antes da vez", async () => {
    const { session, vault, sala } = await bentoEmDoisCanais()
    session.disconnect()
    await assentar(50)

    // The commit (1→2), then a message from a delayed member, still in
    // epoch 1. For Bento, who is also in 1, this opens, and it opens because the
    // gap rule doesn't catch it: only the stuck anchor holds it back.
    const rotacao = await rotateEpoch(sala)
    guiao.acrescentar(SALA, "handshake", rotacao.commits[0] as Uint8Array)
    const atrasada = guiao.acrescentar(SALA, "application", (await encryptPayload(sala, texto("ainda na 1"))).ciphertext)

    guiao.atrasos.set(OUTRO, 150)
    guiao.aoSubscrever = (socket) => socket.aoVivo(SALA, atrasada, 5)

    await session.connect()
    const chegou = await ate(() => epochOf(session.groupFor(SALA) as GroupSession) === 2n)

    expect(chegou).toBe(true)
    expect(await ate(() => vault.contents.lastSeq[SALA] === atrasada.seq)).toBe(true)
    expect(session.history(SALA).filter((m) => m.payload.t === "message")).toHaveLength(1)
  }, 60_000)

  it("e a recuperação não volta a abrir o que já entrou ao vivo, nem o conta como surdez", async () => {
    const { session, sala } = await bentoEmDoisCanais()
    session.disconnect()
    await assentar(50)

    // Two messages in the epoch Bento is in; the second arrives live before
    // the channel's turn and opens. Recovery will ask for it again, because the
    // anchor got stuck before both.
    const primeira = await encryptPayload(sala, texto("primeira"))
    const segunda = await encryptPayload(primeira.session, texto("segunda"))
    guiao.acrescentar(SALA, "application", primeira.ciphertext)
    const aoVivo = guiao.acrescentar(SALA, "application", segunda.ciphertext)
    guiao.atrasos.set(OUTRO, 150)
    guiao.aoSubscrever = (socket) => socket.aoVivo(SALA, aoVivo, 5)

    await session.connect()
    expect(await ate(() => session.history(SALA).filter((m) => m.payload.t === "message").length === 2)).toBe(true)
    await assentar(100)

    // Opening the same generation twice fails, and the failure counted as deafness: with
    // the clock thirty seconds ahead, only one would arrive to declare it.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.now() + 31_000)
    expect(session.deafChannels(1)).not.toContain(SALA)
  }, 60_000)

  it("uma queda de rede logo a seguir não desfaz o commit que entrou ao vivo com a âncora presa", async () => {
    const { session, sala } = await bentoEmDoisCanais()
    session.disconnect()
    await assentar(50)

    // The commit arrives LIVE, before the channel's turn, and enters: the anchor is
    // stuck, so nothing writes it to the vault before the second and a half.
    const rotacao = await rotateEpoch(sala)
    const commit = guiao.acrescentar(SALA, "handshake", rotacao.commits[0] as Uint8Array)
    guiao.atrasos.set(OUTRO, 400)
    guiao.aoSubscrever = (socket) => {
      guiao.aoSubscrever = () => {}
      socket.aoVivo(SALA, commit, 5)
    }

    // Without waiting for `connect`, which only returns after recovery is done.
    const ligacao = session.connect().catch(() => {})
    expect(await ate(() => epochOf(session.groupFor(SALA) as GroupSession) === 2n)).toBe(true)

    // And the connection drops, before recovery and before the delayed save. The
    // reconnection restores the groups: if it restored the vault over memory,
    // the commit would undo and recovery would skip it because it already entered.
    const caida = FakeSocket.ultimo as FakeSocket
    caida.close()
    guiao.atrasos.delete(OUTRO)
    await ligacao
    expect(await ate(() => session.connection === "online" && FakeSocket.ultimo !== caida, 5_000)).toBe(true)
    await ate(() => false, 800)

    expect(epochOf(session.groupFor(SALA) as GroupSession)).toBe(2n)
  }, 60_000)

  it("controlo: sem a trama ao vivo, a mesma recuperação aplica o commit", async () => {
    const { session, sala } = await bentoEmDoisCanais()
    session.disconnect()
    await assentar(50)
    const rotacao = await rotateEpoch(sala)
    guiao.acrescentar(SALA, "handshake", rotacao.commits[0] as Uint8Array)
    guiao.acrescentar(SALA, "application", (await encryptPayload(rotacao.session, texto("batimento"))).ciphertext)
    guiao.atrasos.set(OUTRO, 150)

    await session.connect()
    expect(await ate(() => epochOf(session.groupFor(SALA) as GroupSession) === 2n)).toBe(true)
  }, 60_000)

  it("uma trama de epoch futura ao vivo é um buraco: a âncora fica e vai-se buscar o que falta a partir dela", async () => {
    const { session, vault, sala, estados } = await bentoEmDoisCanais()
    const socket = FakeSocket.ultimo as FakeSocket
    const ancora = vault.contents.lastSeq[SALA] as number

    // The commit is on the server but didn't reach live (a recovery that the
    // server silenced, for example). Only the next message arrives, already in epoch 2.
    const rotacao = await rotateEpoch(sala)
    guiao.acrescentar(SALA, "handshake", rotacao.commits[0] as Uint8Array)
    const eventoDito = guiao.acrescentar(SALA, "application", (await encryptPayload(rotacao.session, texto("depois"))).ciphertext)
    const antes = socket.sent.length
    socket.aoVivo(SALA, eventoDito)

    const chegou = await ate(() => epochOf(session.groupFor(SALA) as GroupSession) === 2n)
    expect(chegou).toBe(true)
    expect(
      socket.sent.slice(antes).some((frame) => frame.t === "channel.backfill" && frame.channel === SALA && frame.afterSeq === ancora),
    ).toBe(true)
    expect(await ate(() => vault.contents.lastSeq[SALA] === eventoDito.seq)).toBe(true)
    expect(session.history(SALA).map((m) => (m.payload as { body?: string }).body)).toContain("depois")
    expect(estados.some((estado) => estado.code === "epoch-gap" && estado.channel === SALA && estado.route === "log")).toBe(true)
  }, 60_000)
})

/**
 * A frame from a "future" epoch that is from no branch.
 *
 * Any account with a seat in the common room, and lifting the card gives a seat, can
 * leave an encrypted frame there in a group of its own with the same identifier and whatever
 * epoch it wants. The gap rule took it for a missing commit: recovery for whoever
 * came back would stall on it for two connections, the first readable frame live
 * would move the anchor past it and everything in between, commits included, and
 * whoever saw it never published a card again.
 *
 * Here the frame is real MLS: an intruder's group with the room's identifier,
 * rotated to an epoch ahead of everyone.
 */
async function tramaDoIntruso(epocas = 5): Promise<Uint8Array> {
  let grupo = await createChannel(generateIdentity(CASA), SALA)
  for (let i = 0; i < epocas; i++) grupo = (await rotateEpoch(grupo)).session
  return (await encryptPayload(grupo, texto("lixo"))).ciphertext
}

describe("ronda 2: uma trama de epoch alta que não é de ramo nenhum", () => {
  it("no meio da recuperação não a pára: chega à epoch certa, não perde nada, e volta a pôr cartão", async () => {
    const { session, vault, sala } = await bentoEmDoisCanais()
    session.disconnect()
    await assentar(50)

    guiao.acrescentar(SALA, "application", await tramaDoIntruso())
    const rotacao = await rotateEpoch(sala)
    guiao.acrescentar(SALA, "handshake", rotacao.commits[0] as Uint8Array)
    const primeira = await encryptPayload(rotacao.session, texto("primeira"))
    guiao.acrescentar(SALA, "application", primeira.ciphertext)
    const ultima = guiao.acrescentar(SALA, "application", (await encryptPayload(primeira.session, texto("segunda"))).ciphertext)

    guiao.salaComum = SALA
    guiao.capacidades = ["common-room-groupinfo"]
    guiao.temCartao = false
    await session.connect()

    expect(await ate(() => epochOf(session.groupFor(SALA) as GroupSession) === 2n)).toBe(true)
    expect(await ate(() => vault.contents.lastSeq[SALA] === ultima.seq)).toBe(true)
    const ditas = session.history(SALA).map((m) => (m.payload as { body?: string }).body)
    expect(ditas).toContain("primeira")
    expect(ditas).toContain("segunda")
    const socket = FakeSocket.ultimo as FakeSocket
    expect(await ate(() => socket.sent.some((frame) => frame.t === "channel.groupinfo.put"), Session.CARTAO_ATRASO_MS + 3_000)).toBe(true)
  }, 60_000)

  it("ao vivo, uma trama legível não passa a âncora por cima do buraco e do commit que só a recuperação traz", async () => {
    const { session, vault, sala } = await bentoEmDoisCanais()
    const socket = FakeSocket.ultimo as FakeSocket

    // The garbage arrives live and is the last thing on the server: recovery that it
    // triggers ends on it, with no proof of anything, and the gap stays open.
    socket.aoVivo(SALA, guiao.acrescentar(SALA, "application", await tramaDoIntruso()))
    await ate(() => false, 400)

    // A commit that doesn't reach live (the server silenced it) and then a
    // message from a member who hasn't applied it yet, readable in epoch 1.
    const rotacao = await rotateEpoch(sala)
    guiao.acrescentar(SALA, "handshake", rotacao.commits[0] as Uint8Array)
    const atrasada = guiao.acrescentar(SALA, "application", (await encryptPayload(sala, texto("ainda na 1"))).ciphertext)
    socket.aoVivo(SALA, atrasada)

    expect(await ate(() => epochOf(session.groupFor(SALA) as GroupSession) === 2n)).toBe(true)
    expect(await ate(() => vault.contents.lastSeq[SALA] === atrasada.seq)).toBe(true)
    expect(session.history(SALA).filter((m) => m.payload.t === "message")).toHaveLength(1)
  }, 60_000)
})

describe("ronda 2: a marca de recuperação por fazer", () => {
  it("não fica presa quando a entrada num canal rebenta entre a marca e a recuperação", async () => {
    const { session, vault } = await bentoEmDoisCanais()
    const socket = FakeSocket.ultimo as FakeSocket
    const pacotes = socket.sent.filter((frame) => frame.t === "keypackage.publish").flatMap((frame) => frame.packages as string[])
    const TERCEIRO = "!terceiro:localhost:8448"

    const dono = generateIdentity(CASA)
    const convite = await addMembers(await createChannel(dono, TERCEIRO), [decodeKeyPackage(fromBase64(pacotes[2] as string))])
    // The subscription breaks once, a socket dying at the worst moment.
    guiao.aoSubscrever = (_, canais) => {
      if (!canais.includes(TERCEIRO)) return
      guiao.aoSubscrever = () => {}
      throw new Error("o socket morreu")
    }
    socket.aoVivo(TERCEIRO, guiao.acrescentar(TERCEIRO, "welcome", convite.welcome, session.identity.address))
    expect(await ate(() => session.channels.includes(TERCEIRO))).toBe(true)
    await ate(() => false, 200)

    // The channel stayed (the group was saved first); reading it must continue.
    const dita = guiao.acrescentar(TERCEIRO, "application", (await encryptPayload(convite.session, texto("olá"))).ciphertext)
    socket.aoVivo(TERCEIRO, dita)
    expect(await ate(() => vault.contents.lastSeq[TERCEIRO] === dita.seq, 3_000)).toBe(true)
  }, 60_000)
})

describe("M2: no disco, a âncora nunca fica à frente do grupo", () => {
  it("recarregar logo a seguir a aplicar um commit não deixa âncora nova com grupo velho", async () => {
    const { vault, backend, sala } = await bentoEmDoisCanais()
    // Let the delayed save of entries finish, so the window is of the commit.
    await new Promise((resolve) => setTimeout(resolve, Session.FLUSH_MS + 200))

    const rotacao = await rotateEpoch(sala)
    const evento = guiao.acrescentar(SALA, "handshake", rotacao.commits[0] as Uint8Array)
    ;(FakeSocket.ultimo as FakeSocket).aoVivo(SALA, evento)
    await ate(() => vault.contents.lastSeq[SALA] === evento.seq)

    // F5 here, well inside the second and a half: what is on disk.
    const reaberto = new Vault(backend)
    await reaberto.unlock("frase-passe")
    const noDisco = await importSession(SALA, fromBase64(reaberto.contents.groups[SALA] as string))
    const ancoraNoDisco = reaberto.contents.lastSeq[SALA] ?? -1
    expect(ancoraNoDisco).toBe(evento.seq)
    expect(epochOf(noDisco)).toBe(2n)
  }, 60_000)
})

describe("M4: o cartão da sala comum", () => {
  it("quem sabe que está atrasado não repõe o cartão", async () => {
    const { session, vault, sala } = await bentoEmDoisCanais()
    session.disconnect()
    await assentar(50)

    // A commit and a message in the new epoch, and an anchor already past the
    // commit, the state M1 and M2 left accounts in production with.
    const rotacao = await rotateEpoch(sala)
    const commit = guiao.acrescentar(SALA, "handshake", rotacao.commits[0] as Uint8Array)
    guiao.acrescentar(SALA, "application", (await encryptPayload(rotacao.session, texto("na 2"))).ciphertext)
    await vault.update((contents) => {
      contents.lastSeq[SALA] = commit.seq
    })

    guiao.salaComum = SALA
    guiao.capacidades = ["common-room-groupinfo"]
    guiao.temCartao = false
    await session.connect()
    await new Promise((resolve) => setTimeout(resolve, Session.CARTAO_ATRASO_MS + 700))

    const socket = FakeSocket.ultimo as FakeSocket
    expect(epochOf(session.groupFor(SALA) as GroupSession)).toBe(1n)
    expect(socket.sent.filter((frame) => frame.t === "channel.groupinfo.put")).toHaveLength(0)
  }, 60_000)

  it("controlo: em dia, repõe o cartão que falta", async () => {
    const { session } = await bentoEmDoisCanais()
    session.disconnect()
    await assentar(50)

    guiao.salaComum = SALA
    guiao.capacidades = ["common-room-groupinfo"]
    guiao.temCartao = false
    await session.connect()
    const socket = FakeSocket.ultimo as FakeSocket
    expect(await ate(() => socket.sent.some((frame) => frame.t === "channel.groupinfo.put"), Session.CARTAO_ATRASO_MS + 3_000)).toBe(true)
  }, 60_000)

  it("um cartão recusado por velho vai só para o diagnóstico, e não faz a sala parecer perdida", async () => {
    const { estados } = await bentoEmDoisCanais()
    const socket = FakeSocket.ultimo as FakeSocket
    const antes = estados.length

    socket.entregar({ t: "channel.rejected", channel: SALA, reason: "stale-groupinfo", epoch: 7 })
    socket.entregar({ t: "channel.rejected", channel: SALA, reason: "stale-epoch", ref: "nao-e-nosso", epoch: 7 })
    await ate(() => estados.length >= antes + 2, 1_000)
    const novos = estados.slice(antes)

    expect(novos.some((estado) => estado.code === "channel-orphaned")).toBe(false)
    expect(novos.some((estado) => estado.route === "toast")).toBe(false)
    expect(novos.some((estado) => estado.code === "groupinfo-rejected" && estado.route === "log")).toBe(true)
  }, 60_000)
})

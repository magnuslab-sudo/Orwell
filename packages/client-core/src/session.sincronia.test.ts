import { generateIdentity, moradaDeSala, moradaDoMural, parseServerName, toBase64 } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { REPARAR_PAR_MS, Session } from "./session.js"
import { appendHistory, Vault, type VaultBackend } from "./vault.js"

/**
 * **Reconciliation runs with the connection live** (F9, audit from 20/10/2026).
 *
 * Before this fix, `syncFriendships` and `syncChannelInvites` only ran at connect.
 * A connection open for days straight would repair nothing on those days. Here
 * we measure the clock (every ten minutes, and only while connected), returning
 * to the foreground (`setVisible(true)`), and a peer lighting up (repair that
 * peer, and only one every ten minutes).
 *
 * Fake clock only for `setInterval` and `Date`: everything else (the `setTimeout`
 * calls in the mock socket and vault) runs for real, which is what the session expects.
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
    const respostas: unknown[] = []
    if (frame.t === "hello") respostas.push({ t: "hello.ok", version: 1, capabilities: [], retentionDays: 30 })
    if (frame.t === "auth.begin") respostas.push({ t: "auth.challenge", nonce: "AAAA" })
    if (frame.t === "auth.finish") respostas.push({ t: "auth.ok", address: "@x:localhost:8448" })
    for (const resposta of respostas) this.empurrar(resposta)
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

const CASA = parseServerName("localhost:8448")
let abertas: Session[] = []

async function assentar(vezes = 40): Promise<void> {
  for (let i = 0; i < vezes; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

async function ligada(): Promise<{ session: Session; vault: Vault; socket: FakeSocket }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  await session.createIdentity("localhost:8448")
  await session.connect()
  await assentar()
  const socket = FakeSocket.last
  if (!socket) throw new Error("sem socket")
  return { session, vault, socket }
}

/** The vault key for each friend's board (D1), so tests know the address the vault knows. */
const segredosDosMurais = new Map<string, Uint8Array>()

/** A friend's board, by the opaque address of the key she gave us. */
function muralDe(ela: string): string {
  const segredo = segredosDosMurais.get(ela)
  if (!segredo) throw new Error("amiga sem mural")
  return moradaDoMural(segredo, CASA)
}

/**
 * A friend, as the vault stores her: her request and our acceptance, in the
 * direct channel between us (an opaque address with the direct channel record),
 * and the key to her board, as her profile would have brought it (1.0 "Arca", slice 3).
 */
async function comAmiga(session: Session, vault: Vault): Promise<string> {
  const ela = generateIdentity(CASA).address
  const dm = moradaDeSala(CASA)
  const segredo = crypto.getRandomValues(new Uint8Array(32))
  segredosDosMurais.set(ela, segredo)
  await vault.update((contents) => {
    contents.fichasDosCanais = { ...contents.fichasDosCanais, [dm]: { tipo: "directa", par: ela } }
    contents.muraisDosOutros = { ...contents.muraisDosOutros, [ela]: toBase64(segredo) }
    appendHistory(contents, dm, { seq: 1, sender: ela, at: 1, payload: { t: "friend.request", sentAt: 1 } })
    appendHistory(contents, dm, { seq: 2, sender: session.identity.address, at: 2, payload: { t: "friend.accept", acceptedAt: 2 } })
  })
  expect(session.friendTies().get(ela)?.link).toBe("amigos")
  return ela
}

beforeEach(() => {
  abertas = []
  FakeSocket.last = null
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] })
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  for (const session of abertas) session.disconnect()
  abertas = []
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

describe("a reconciliação com a ligação viva", () => {
  it("corre de dez em dez minutos enquanto há ligação, e pára quando a ligação acaba", async () => {
    const { session } = await ligada()
    const amizades = vi.spyOn(session, "syncFriendships").mockResolvedValue()
    const convites = vi.spyOn(session, "syncChannelInvites").mockResolvedValue()

    vi.advanceTimersByTime(Session.SINCRONIA_MS - 1)
    await assentar()
    expect(amizades).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    await assentar()
    expect(amizades).toHaveBeenCalledTimes(1)
    expect(convites).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(Session.SINCRONIA_MS)
    await assentar()
    expect(amizades).toHaveBeenCalledTimes(2)

    session.disconnect()
    vi.advanceTimersByTime(Session.SINCRONIA_MS * 3)
    await assentar()
    expect(amizades).toHaveBeenCalledTimes(2)
  })

  it("voltar a estar visível reconcilia, mas não duas vezes no mesmo minuto", async () => {
    const { session } = await ligada()
    const amizades = vi.spyOn(session, "syncFriendships").mockResolvedValue()

    // Just connected: the connection transition still counts.
    session.setVisible(true)
    await assentar()
    expect(amizades).not.toHaveBeenCalled()

    vi.setSystemTime(Date.now() + 60_000)
    session.setVisible(true)
    await assentar()
    expect(amizades).toHaveBeenCalledTimes(1)

    session.setVisible(true)
    await assentar()
    expect(amizades).toHaveBeenCalledTimes(1)
  })

  it("a presença de uma amiga a acender repara-a a ela, uma vez a cada dez minutos", async () => {
    const { session, vault, socket } = await ligada()
    const ela = await comAmiga(session, vault)
    const outra = generateIdentity(CASA).address
    const reparacoes = vi.spyOn(session, "repairInvite").mockResolvedValue("live")
    const pedidos = vi.spyOn(session, "requestRejoin")

    socket.empurrar({ t: "presence", address: ela, online: true })
    await assentar(80)
    const noFeed = (): number => reparacoes.mock.calls.filter(([canal, quem]) => canal === session.feedChannel && quem === ela).length
    expect(noFeed()).toBe(1)
    // And the place in her feed, which this device does not have: request it.
    const feedDela = muralDe(ela)
    expect(pedidos.mock.calls.map(([canal]) => canal)).toContain(feedDela)

    // Presence blinks: nothing new before ten minutes.
    socket.empurrar({ t: "presence", address: ela, online: false })
    socket.empurrar({ t: "presence", address: ela, online: true })
    await assentar(80)
    expect(noFeed()).toBe(1)

    // Another person is not repaired because her presence lit up: not a friend.
    socket.empurrar({ t: "presence", address: outra, online: true })
    await assentar(80)
    expect(reparacoes.mock.calls.some(([, quem]) => quem === outra)).toBe(false)

    vi.setSystemTime(Date.now() + REPARAR_PAR_MS)
    socket.empurrar({ t: "presence", address: ela, online: true })
    await assentar(80)
    expect(noFeed()).toBe(2)
  })

  /**
   * I7 of the review: several live connection triggers may request the same
   * repair at the same time. One at a time per (channel, person), and the brake
   * recorded BEFORE the claim: two in parallel claimed two packets and gave
   * two leaves to the same account.
   */
  it("duas reparações do mesmo par ao mesmo tempo assentam uma vez, com o travão já gravado", async () => {
    const { session, vault } = await ligada()
    const ela = generateIdentity(CASA).address
    const canal = session.feedChannel
    let travaoAntesDoAssento = false
    const assentos = vi.spyOn(session, "seat").mockImplementation(async () => {
      travaoAntesDoAssento = vault.contents.repairAttempts[`${ela}|${canal}`] !== undefined
      await new Promise((resolve) => setTimeout(resolve, 30))
      return "invited"
    })
    const [uma, outra] = await Promise.all([session.repairInvite(canal, ela), session.repairInvite(canal, ela)])
    expect(assentos).toHaveBeenCalledTimes(1)
    expect([uma, outra]).toEqual(["invited", "invited"])
    expect(travaoAntesDoAssento).toBe(true)
    // And then the brake holds.
    expect(await session.repairInvite(canal, ela)).toBe("cooldown")
  })

  it("uma reparação que não gastou nada devolve o travão ao que era", async () => {
    const { session, vault } = await ligada()
    const ela = generateIdentity(CASA).address
    const canal = session.feedChannel
    vi.spyOn(session, "seat").mockResolvedValue("live")
    expect(await session.repairInvite(canal, ela)).toBe("live")
    expect(vault.contents.repairAttempts[`${ela}|${canal}`]).toBeUndefined()
  })

  /**
   * N1 of the review: a `seat` that fails without spending any packet (no
   * connection, or no packets from the other side) does not leave the six-hour
   * brake recorded. A timeout does: the server may have served the packet.
   */
  it("um assento que falha com o socket fechado deixa o travão como estava", async () => {
    const { session, vault, socket } = await ligada()
    const ela = generateIdentity(CASA).address
    const canal = session.feedChannel
    socket.close()
    vi.spyOn(session, "seat").mockRejectedValue(new Error("no connection to the server"))
    await expect(session.repairInvite(canal, ela)).rejects.toThrow("no connection to the server")
    expect(vault.contents.repairAttempts[`${ela}|${canal}`]).toBeUndefined()
  })

  it("um assento sem pacotes do outro lado também não trava, e um prazo esgotado trava", async () => {
    const { session, vault } = await ligada()
    const ela = generateIdentity(CASA).address
    const canal = session.feedChannel
    const assento = vi.spyOn(session, "seat").mockRejectedValue(new Error("that person has no invite keys"))
    await expect(session.repairInvite(canal, ela)).rejects.toThrow("that person has no invite keys")
    expect(vault.contents.repairAttempts[`${ela}|${canal}`]).toBeUndefined()

    assento.mockRejectedValue(new Error("the server did not answer in time"))
    await expect(session.repairInvite(canal, ela)).rejects.toThrow("the server did not answer in time")
    expect(vault.contents.repairAttempts[`${ela}|${canal}`]).toBeDefined()
  })

  /** N8: manual with an automatic in progress runs after it, and does not inherit its outcome. */
  it("uma reparação manual pedida durante uma automática corre a seguir, a sério", async () => {
    const { session } = await ligada()
    const ela = generateIdentity(CASA).address
    const canal = session.feedChannel
    const assentos = vi.spyOn(session, "seat").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return "invited"
    })
    const automatica = session.repairInvite(canal, ela)
    const manual = session.repairInvite(canal, ela, true)
    expect(await automatica).toBe("invited")
    expect(await manual).toBe("invited")
    expect(assentos).toHaveBeenCalledTimes(2)
  })
})

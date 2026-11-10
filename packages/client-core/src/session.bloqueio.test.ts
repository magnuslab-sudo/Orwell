import { moradaDeTeste } from "../testes/moradas.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * Block and unblock (phase 3 of the friends plan, 20/10/2026).
 *
 * What gets locked: a blocked person cannot reach, directly or through
 * feeds, the vault or screen of whoever blocked them, and will not gain access through
 * any of the doors that grant access (`seat`, `acceptFollower`, `openDirect`, a
 * Welcome). In shared rooms nothing changes. Unblocking restores what the
 * server still holds.
 *
 * The relay is from `session.publicacoes.test.ts`, with two real accounts.
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

interface Frame {
  t: string
  [key: string]: unknown
}

interface Evento {
  seq: number
  kind: string
  ciphertext: string
  recipient?: string | undefined
  ref?: string | undefined
}

/** See `TRAMAS_MAXIMAS` in `session.corrida.test.ts`: a cap on a cascade to keep
 * the whole suite from collapsing. */
const TRAMAS_MAXIMAS = 3_000

class Rele {
  readonly eventos = new Map<string, Evento[]>()
  readonly pools = new Map<string, string[]>()
  readonly ligacoes = new Set<FakeSocket>()
  entregues = 0

  frame(socket: FakeSocket, frame: Frame): void {
    switch (frame.t) {
      case "hello":
        socket.entregar({ t: "hello.ok", version: 1, capabilities: [] })
        return
      case "auth.begin":
        socket.address = frame.address as string
        socket.entregar({ t: "auth.challenge", nonce: "AAAA" })
        return
      case "auth.finish":
        socket.entregar({ t: "auth.ok", address: socket.address })
        return
      case "channel.subscribe":
        for (const canal of frame.channels as string[]) socket.canais.add(canal)
        return
      case "channel.unsubscribe":
        for (const canal of frame.channels as string[]) socket.canais.delete(canal)
        return
      case "keypackage.publish": {
        const anterior = frame.replace ? [] : (this.pools.get(socket.address ?? "") ?? [])
        this.pools.set(socket.address ?? "", [...anterior, ...(frame.packages as string[])])
        return
      }
      case "keypackage.claim": {
        const pool = this.pools.get(frame.address as string) ?? []
        const pacote = pool.shift() ?? null
        socket.entregar({ t: "keypackage.claimed", address: frame.address, keyPackage: pacote })
        return
      }
      case "channel.send": {
        const canal = frame.channel as string
        const log = this.eventos.get(canal) ?? []
        const evento: Evento = {
          seq: log.length,
          kind: frame.kind as string,
          ciphertext: frame.ciphertext as string,
          recipient: frame.recipient as string | undefined,
          ref: frame.ref as string | undefined,
        }
        log.push(evento)
        this.eventos.set(canal, log)
        this.difundir(canal, evento)
        return
      }
      case "channel.backfill": {
        const canal = frame.channel as string
        const log = this.eventos.get(canal) ?? []
        const depois = (frame.afterSeq as number | undefined) ?? -1
        const visiveis = log.filter(
          (evento) =>
            evento.seq > depois && (evento.recipient === undefined || evento.recipient === socket.address),
        )
        const pagina = visiveis.slice(0, (frame.limit as number | undefined) ?? 50)
        socket.entregar({
          t: "channel.backfill.page",
          channel: canal,
          events: pagina.map((evento) => ({
            seq: evento.seq,
            kind: evento.kind,
            ciphertext: evento.ciphertext,
            receivedAtMinute: 0,
          })),
          more: pagina.length < visiveis.length,
        })
        return
      }
      case "channel.rejoin.request": {
        // Like in `gateway.ts`: delivered to connected members of the channel.
        const canal = frame.channel as string
        for (const ligacao of this.ligacoes) {
          if (ligacao === socket || !ligacao.canais.has(canal)) continue
          ligacao.entregar({ t: "channel.rejoin", channel: canal, address: socket.address })
        }
        return
      }
      case "welcome.resync": {
        for (const [canal, log] of this.eventos) {
          for (const evento of log) {
            if (evento.kind === "welcome" && evento.recipient === socket.address) {
              socket.entregar(this.#comoEvento(canal, evento))
            }
          }
        }
        return
      }
      default:
        return
    }
  }

  difundir(canal: string, evento: Evento): void {
    for (const ligacao of this.ligacoes) {
      if (!ligacao.address) continue
      if (evento.recipient) {
        if (ligacao.address !== evento.recipient) continue
      } else if (!ligacao.canais.has(canal)) continue
      ligacao.entregar(this.#comoEvento(canal, evento))
    }
  }

  #comoEvento(canal: string, evento: Evento): Frame {
    return {
      t: "channel.event",
      channel: canal,
      seq: evento.seq,
      kind: evento.kind,
      ciphertext: evento.ciphertext,
      receivedAtMinute: 0,
      ...(evento.ref !== undefined ? { ref: evento.ref } : {}),
    }
  }
}

let rele = new Rele()

class FakeSocket {
  address: string | null = null
  readonly canais = new Set<string>()
  readyState = 0
  /** The relay this socket was born with. See the note in `session.corrida.test.ts`:
   * without it, old sessions talk to the next test's relay. */
  readonly #rele = rele
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    this.#rele.ligacoes.add(this)
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
    this.#listeners.set(
      kind,
      (this.#listeners.get(kind) ?? []).filter((item) => item !== handler),
    )
  }

  send(raw: string): void {
    this.#rele.frame(this, JSON.parse(raw) as Frame)
  }

  entregar(frame: unknown): void {
    if (this.#rele.entregues++ > TRAMAS_MAXIMAS) return
    setTimeout(() => this.#fire("message", { data: JSON.stringify(frame) }), 0)
  }

  close(): void {
    this.readyState = 3
    this.#rele.ligacoes.delete(this)
    this.#fire("close", {})
  }

  #fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

async function settle(times = 200): Promise<void> {
  for (let index = 0; index < times; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

let abertas: Session[] = []

interface Conta {
  session: Session
  address: string
  vault: Vault
}

async function conta(): Promise<Conta> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  const { address } = await session.createIdentity("localhost:8448")
  await session.connect()
  await settle(20)
  return { session, address, vault }
}

beforeEach(() => {
  rele = new Rele()
  abertas = []
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  for (const session of abertas) session.disconnect()
  abertas = []
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

/** What reached the screen: the `message` events of a channel, by type. */
function ouvir(quem: Conta): { canal: string; t: string; sender: string }[] {
  const vistos: { canal: string; t: string; sender: string }[] = []
  quem.session.on("message", (mensagem) => vistos.push({ canal: mensagem.channel, t: mensagem.payload.t, sender: mensagem.sender }))
  return vistos
}

async function amizade(quem: Conta, com: Conta): Promise<string> {
  const dm = await quem.session.openDirect(com.address)
  await settle(120)
  await quem.session.sendFriendRequest(dm)
  await settle(120)
  await com.session.acceptFriend(dm, quem.address)
  await settle(240)
  expect(quem.session.friendTies().get(com.address)?.link).toBe("amigos")
  return dm
}

function mensagem(body: string): Parameters<Session["send"]>[1] {
  return { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body, attachments: [], mentions: [], links: [] } as never
}

describe("bloquear", () => {
  it("um pedido de quem está bloqueado não se grava, não se emite, e não fica por responder", async () => {
    const ana = await conta()
    const bento = await conta()
    const dm = await ana.session.openDirect(bento.address)
    await settle(120)
    expect(bento.session.channels).toContain(dm)

    await bento.session.block(ana.address)
    expect(bento.session.isBlocked(ana.address)).toBe(true)
    expect(bento.session.blocked().map((linha) => linha.address)).toEqual([ana.address])
    const vistos = ouvir(bento)

    await ana.session.sendFriendRequest(dm, "olá")
    await ana.session.send(dm, mensagem("estás aí?"))
    await settle(160)

    expect(vistos.filter((visto) => visto.canal === dm)).toEqual([])
    expect(bento.session.history(dm).map((entrada) => entrada.payload.t)).not.toContain("friend.request")
    expect(bento.session.history(dm).map((entrada) => entrada.payload.t)).not.toContain("message")
    expect(bento.session.openFriendRequests()).toEqual([])
    // The ratchet advanced the same way: the channel did not go deaf because of the filter.
    expect(bento.session.deafChannels()).not.toContain(dm)
  })

  it("numa sala partilhada, o que ela diz continua a chegar", async () => {
    const ana = await conta()
    const bento = await conta()
    const carlos = await conta()
    const sala = moradaDeTeste("lagar")
    await ana.session.createSpaceChannel(sala)
    await ana.session.seat(sala, bento.address)
    await ana.session.seat(sala, carlos.address)
    await settle(200)
    expect(bento.session.channels).toContain(sala)

    await bento.session.block(ana.address)
    const vistos = ouvir(bento)
    await ana.session.send(sala, mensagem("para todos"))
    await settle(160)
    expect(vistos.filter((visto) => visto.canal === sala && visto.t === "message")).toHaveLength(1)
  })

  it("nenhuma porta volta a dar-lhe lugar: seat, acceptFollower, openDirect, pedir amizade", async () => {
    const ana = await conta()
    const bento = await conta()
    const dm = await ana.session.openDirect(bento.address)
    await settle(120)
    await bento.session.block(ana.address)

    await expect(bento.session.seat(bento.session.feedChannel, ana.address)).rejects.toThrow("that person is blocked")
    await expect(bento.session.acceptFollower(ana.address)).rejects.toThrow("that person is blocked")
    await expect(bento.session.openDirect(ana.address)).rejects.toThrow("that person is blocked")
    await expect(bento.session.sendFriendRequest(dm)).rejects.toThrow("that person is blocked")
    await expect(bento.session.repairInvite(dm, ana.address, true)).rejects.toThrow("that person is blocked")
    // And the repair did not engage anyone's brake.
    expect(Object.keys(bento.vault.contents.repairAttempts).filter((chave) => chave.startsWith(ana.address))).toEqual([])
    // Blocking oneself is not a block.
    await expect(bento.session.block(bento.address)).rejects.toThrow("you cannot block yourself")
    await expect(bento.session.block("!sala:localhost:8448")).rejects.toThrow("that is not an account address")
  })

  it("bloquear um amigo desfaz a amizade nos dois sentidos", async () => {
    const ana = await conta()
    const bento = await conta()
    await amizade(ana, bento)
    const feedAna = ana.session.feedChannel
    const feedBento = bento.session.feedChannel
    expect(ana.session.channels).toContain(feedBento)
    expect(bento.session.channels).toContain(feedAna)

    await bento.session.block(ana.address)
    await settle(400)

    // On her side, a friendship undone, which is what it is.
    expect(ana.session.friendTies().get(bento.address)?.severed).toBe(true)
    expect(bento.session.friendTies().get(ana.address)?.severed).toBe(true)
    // He left her feed, and she was removed from his.
    expect(bento.session.channels).not.toContain(feedAna)
    expect(bento.session.membersOf(feedBento).map(String)).not.toContain(ana.address)

    // And reconciliation does not seat her again.
    await bento.session.syncFriendships()
    await settle(200)
    expect(bento.session.membersOf(feedBento).map(String)).not.toContain(ana.address)
  })

  it("um Welcome de quem está bloqueado não se abre, e desbloquear recupera-o", async () => {
    const ana = await conta()
    const bento = await conta()
    await bento.session.block(ana.address)

    const dm = await ana.session.openDirect(bento.address)
    await settle(160)
    expect(bento.session.channels).not.toContain(dm)
    // He was not marked dead: that is what lets the unblock recover him.
    expect(bento.vault.contents.deadWelcomes.some((marca) => marca.includes(dm))).toBe(false)

    await bento.session.unblock(ana.address)
    await settle(200)
    expect(bento.session.isBlocked(ana.address)).toBe(false)
    expect(bento.session.channels).toContain(dm)

    // And what she says from here reaches him again.
    const vistos = ouvir(bento)
    await ana.session.sendFriendRequest(dm)
    await settle(160)
    expect(vistos.some((visto) => visto.canal === dm && visto.t === "friend.request")).toBe(true)
    expect(bento.session.openFriendRequests().map((tie) => tie.peer)).toEqual([ana.address])
  })

  /**
   * Without a live direct, the block has no way to signal the cut, and the fold
   * stays in "friends". During the block this grants no one access; on
   * unblock, the friendship truly breaks instead of restoring itself.
   */
  it("bloquear sem directa viva, e desbloquear, não lhe devolve o lugar no feed", async () => {
    const ana = await conta()
    const bento = await conta()
    const dm = await amizade(ana, bento)
    const feed = bento.session.feedChannel
    // Ana leaves the direct: Bento honors the exit and stays there alone.
    await ana.session.leaveChannel(dm)
    const fim = Date.now() + 20_000
    while (Date.now() < fim && bento.session.membersOf(dm).map(String).includes(ana.address)) await settle(50)
    expect(bento.session.membersOf(dm).map(String)).not.toContain(ana.address)

    await bento.session.block(ana.address)
    await settle(200)
    // The cut had no way to go out: the fold still says "friends".
    expect(bento.session.friendTies().get(ana.address)?.link).toBe("amigos")
    expect(bento.session.membersOf(feed).map(String)).not.toContain(ana.address)
    await bento.session.syncFriendships()
    await settle(200)
    expect(bento.session.membersOf(feed).map(String)).not.toContain(ana.address)

    await bento.session.unblock(ana.address)
    await settle(300)
    await bento.session.syncFriendships()
    await settle(300)
    expect(bento.session.friendTies().get(ana.address)?.severed).toBe(true)
    expect(bento.session.membersOf(feed).map(String)).not.toContain(ana.address)
  })

  it("desbloquear sem rede, com a amizade por cortar, falha e não lhe devolve o lugar", async () => {
    const ana = await conta()
    const bento = await conta()
    const dm = await amizade(ana, bento)
    const feed = bento.session.feedChannel
    await ana.session.leaveChannel(dm)
    const fim = Date.now() + 20_000
    while (Date.now() < fim && bento.session.membersOf(dm).map(String).includes(ana.address)) await settle(50)
    await bento.session.block(ana.address)
    await settle(200)
    expect(bento.session.friendTies().get(ana.address)?.link).toBe("amigos")

    bento.session.disconnect()
    await settle(20)
    await expect(bento.session.unblock(ana.address)).rejects.toThrow()
    // The mark came back: without the cut, unblock does not happen.
    expect(bento.session.isBlocked(ana.address)).toBe(true)

    await bento.session.connect()
    await settle(400)
    await bento.session.syncFriendships()
    await settle(200)
    expect(bento.session.membersOf(feed).map(String)).not.toContain(ana.address)
  })

  it("bloquear sem rede: a reconciliação da ligação seguinte acaba o que ficou por fazer", async () => {
    const ana = await conta()
    const bento = await conta()
    await amizade(ana, bento)
    const feed = bento.session.feedChannel
    bento.session.disconnect()
    await settle(20)
    await bento.session.block(ana.address)
    // With no network, nothing left: she stays in the feed and the friendship undone.
    expect(bento.session.membersOf(feed).map(String)).toContain(ana.address)

    await bento.session.connect()
    const fim = Date.now() + 20_000
    while (Date.now() < fim && ana.session.friendTies().get(bento.address)?.severed !== true) await settle(50)
    await settle(300)
    expect(bento.session.membersOf(feed).map(String)).not.toContain(ana.address)
    expect(ana.session.friendTies().get(bento.address)?.severed).toBe(true)
    expect(bento.session.channels).not.toContain(ana.session.feedChannel)
  })

  /**
   * A request for a new seat in a direct is the door through which a second device
   * of the blocked account would ask entry (`#answerRejoin`). Here it is asked by the device
   * already there, which goes to the same place: the guard is by account. With a
   * positive control, no block, so the measure does not pass by not measuring.
   */
  it("um pedido de lugar de quem está bloqueado não tem resposta; sem bloqueio, tem", async () => {
    const epocasDe = (quem: Conta, canal: string): (() => number) => {
      let n = 0
      quem.session.on("epoch", (evento) => {
        if (evento.channel === canal) n += 1
      })
      return () => n
    }
    /*
      Two pairs, not one: whoever responds stores, by (channel, person), that they already
      responded, and a second request from the same pair in the same minute would have no
      response with or without a block. Measured this way, the guard is what decides.
    */
    async function parComDirecta(): Promise<{ quem: Conta; dono: Conta; dm: string }> {
      const quem = await conta()
      const dono = await conta()
      const dm = await quem.session.openDirect(dono.address)
      await settle(200)
      await quem.session.send(dm, mensagem("prova de vida"))
      await dono.session.send(dm, mensagem("prova de vida"))
      await settle(200)
      return { quem, dono, dm }
    }
    // The control: no block, the owner of the direct responds with a new seat.
    const controlo = await parComDirecta()
    const epocasDoControlo = epocasDe(controlo.dono, controlo.dm)
    controlo.quem.session.requestRejoin(controlo.dm)
    let fim = Date.now() + 12_000
    while (Date.now() < fim && epocasDoControlo() === 0) await settle(50)
    expect(epocasDoControlo()).toBeGreaterThan(0)

    const caso = await parComDirecta()
    await caso.dono.session.block(caso.quem.address)
    await settle(200)
    const epocasDoCaso = epocasDe(caso.dono, caso.dm)
    caso.quem.session.requestRejoin(caso.dm)
    fim = Date.now() + 9_000
    while (Date.now() < fim) await settle(50)
    expect(epocasDoCaso()).toBe(0)
  })

  it("a lista vive no cofre: sobrevive a recarregar, lida do disco", async () => {
    const ana = await conta()
    const backend = new MemoryBackend()
    const vault = new Vault(backend)
    await vault.create("frase-passe")
    const session = new Session(vault)
    abertas.push(session)
    await session.createIdentity("localhost:8448")
    await session.connect()
    await settle(20)
    await session.block(ana.address)
    await session.flush()

    const outra = new Vault(backend)
    await outra.unlock("frase-passe")
    const reaberta = new Session(outra)
    reaberta.loadIdentity()
    expect(reaberta.isBlocked(ana.address)).toBe(true)
  })
})

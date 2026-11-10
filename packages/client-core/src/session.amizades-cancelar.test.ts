import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Session, type SessionEvents } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * Cancel a friend request (phase 1 of the friendship plan, 20/10/2026).
 *
 * Two real accounts and the relay from `session.publicacoes.test.ts` (copied from
 * `session.corrida.test.ts`, which copied it from `#relay` in `gateway.ts`): what
 * we measure is what each side learns, and that's only visible with both.
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

/**
 * Wait until the condition holds, with a timeout (S6). The fixed loops in
 * `settle` were barely holding up with the whole suite running, and the test
 * failed one in ten times for no reason.
 */
async function ate(condicao: () => void): Promise<void> {
  await vi.waitFor(condicao, { timeout: 10_000, interval: 5 })
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

/** The events on a channel in the relay: what actually left, encrypted or not. */
function enviadosPara(canal: string): number {
  return (rele.eventos.get(canal) ?? []).filter((evento) => evento.kind === "application").length
}

/** Ana opens the direct and sends a friend request to Bento. */
async function pedidoDaAna(): Promise<{ ana: Conta; bento: Conta; dm: string }> {
  const ana = await conta()
  const bento = await conta()
  const dm = await ana.session.openDirect(bento.address)
  await ate(() => expect(bento.session.channels).toContain(dm))
  await ana.session.sendFriendRequest(dm, "do lagar")
  await ate(() => {
    expect(bento.session.openFriendRequests().map((tie) => tie.peer)).toEqual([ana.address])
    expect(ana.session.sentFriendRequests().map((tie) => tie.peer)).toEqual([bento.address])
  })
  return { ana, bento, dm }
}

describe("cancelar um pedido", () => {
  it("fecha o pedido dos dois lados, e do outro lado sai o aviso para o sino", async () => {
    const { ana, bento, dm } = await pedidoDaAna()
    const avisos: SessionEvents["status"][] = []
    bento.session.on("status", (status) => avisos.push(status))

    await ana.session.cancelFriendRequest(bento.address)
    await ate(() => {
      expect(ana.session.friendTies().get(bento.address)?.link).toBe("nenhum")
      expect(ana.session.sentFriendRequests()).toEqual([])
      expect(bento.session.friendTies().get(ana.address)?.link).toBe("nenhum")
      expect(bento.session.openFriendRequests()).toEqual([])
      expect(avisos.some((status) => status.code === "friend-withdrawn")).toBe(true)
    })
    // Not a broken friendship: a new request, later, is just a request.
    expect(bento.session.friendTies().get(ana.address)?.severed).toBe(false)

    const aviso = avisos.find((status) => status.code === "friend-withdrawn")
    expect(aviso).toMatchObject({ actor: ana.address, channel: dm, route: "log" })

    // In the vault of whoever cancelled, with the echo's `seq`: it's an entry in the ledger.
    const guardado = ana.session.history(dm).find((entrada) => entrada.payload.t === "friend.decline")
    expect(guardado?.payload["withdrawn"]).toBe(true)
    expect(guardado?.seq).toBeGreaterThanOrEqual(0)
  })

  it("cancelar e pedir outra vez é um pedido novo, que se aceita", async () => {
    const { ana, bento, dm } = await pedidoDaAna()
    await ana.session.cancelFriendRequest(bento.address)
    await ate(() => expect(bento.session.openFriendRequests()).toEqual([]))
    await ana.session.sendFriendRequest(dm)
    await ate(() => expect(bento.session.openFriendRequests().map((tie) => tie.peer)).toEqual([ana.address]))

    await bento.session.acceptFriend(dm, ana.address)
    await ate(() => {
      expect(ana.session.friendTies().get(bento.address)?.link).toBe("amigos")
      expect(bento.session.friendTies().get(ana.address)?.link).toBe("amigos")
    })
  })

  it("sem pedido nosso em aberto, atira e não manda nada", async () => {
    const { ana, bento, dm } = await pedidoDaAna()
    // Bento asked for nothing: he has no request to cancel.
    const antes = enviadosPara(dm)
    await expect(bento.session.cancelFriendRequest(ana.address)).rejects.toThrow("there is no friend request to cancel")
    await settle(40)
    expect(enviadosPara(dm)).toBe(antes)
    // And twice in a row: the second time there's nothing left to cancel.
    await ana.session.cancelFriendRequest(bento.address)
    await settle(120)
    await expect(ana.session.cancelFriendRequest(bento.address)).rejects.toThrow("there is no friend request to cancel")
  })

  it("um pedido cancelado não volta a sair pela reconciliação", async () => {
    const { ana, bento, dm } = await pedidoDaAna()
    await ana.session.cancelFriendRequest(bento.address)
    await settle(160)
    const antes = enviadosPara(dm)
    await ana.session.syncFriendships()
    await settle(160)
    expect(enviadosPara(dm)).toBe(antes)
    expect(bento.session.openFriendRequests()).toEqual([])
  })

  /**
   * A 0.5.x client reads the cancellation as no refusal, keeps seeing the request,
   * and can accept it: it gives us space in his feed and sends the accept. Here
   * Bento plays old with `acceptFriend` (which settles and announces without
   * checking the fold). Ana responds with the cut and leaves his feed.
   */
  it("um aceite a um pedido já cancelado (cliente antigo) recebe o corte, e quem cancelou sai do feed dele", async () => {
    const { ana, bento, dm } = await pedidoDaAna()
    await ana.session.cancelFriendRequest(bento.address)
    await settle(160)
    await bento.session.acceptFriend(dm, ana.address)
    const fim = Date.now() + 15_000
    while (Date.now() < fim && bento.session.friendTies().get(ana.address)?.severed !== true) await settle(20)
    /*
      Her feed welcome and accept arrive almost together: if Ana hadn't joined when
      she replied, she joins next, and who removes her is reconciliation (the
      "broken" link leaves the feeds). One pass runs.
    */
    /*
      What matters is she stops reading his feed. It comes two ways, and one is
      enough: her exit (`member.left`) or his cut, which removes her with a commit.
      When the second wins, her exit gets no receipt (she's not in the group anymore)
      and her client drops the channel after grace.
    */
    const foraDoFeed = (): boolean => !bento.session.membersOf(bento.session.feedChannel).map(String).includes(ana.address)
    const ate = Date.now() + 15_000
    while (Date.now() < ate && !foraDoFeed()) {
      await ana.session.syncFriendships()
      await settle(100)
    }
    expect(bento.session.friendTies().get(ana.address)?.severed).toBe(true)
    expect(ana.session.friendTies().get(bento.address)?.link).not.toBe("amigos")
    expect(foraDoFeed()).toBe(true)
  })

  it("o mesmo aceite órfão, chegado pela recuperação, recebe o corte na reconciliação", async () => {
    const { ana, bento, dm } = await pedidoDaAna()
    await ana.session.cancelFriendRequest(bento.address)
    await settle(160)
    ana.session.disconnect()
    await settle(20)
    // The old accept with Ana gone: the accept stays on the server.
    await bento.session.acceptFriend(dm, ana.address)
    await settle(160)

    await ana.session.connect()
    const fim = Date.now() + 20_000
    while (Date.now() < fim && bento.session.friendTies().get(ana.address)?.severed !== true) {
      await ana.session.syncFriendships()
      await settle(100)
    }
    expect(bento.session.friendTies().get(ana.address)?.severed).toBe(true)
    // She stops reading his feed: by her exit or his cut (see above).
    const foraDoFeed = (): boolean => !bento.session.membersOf(bento.session.feedChannel).map(String).includes(ana.address)
    const ate = Date.now() + 15_000
    while (Date.now() < ate && !foraDoFeed()) {
      await ana.session.syncFriendships()
      await settle(100)
    }
    expect(foraDoFeed()).toBe(true)
  })

  it("sem ligação, o cancelamento não fica gravado como feito", async () => {
    const { ana, bento } = await pedidoDaAna()
    const socket = [...rele.ligacoes].find((ligacao) => ligacao.address === ana.address)
    socket?.close()
    await expect(ana.session.cancelFriendRequest(bento.address)).rejects.toThrow()
    // The request stays to be cancelled, and the button stays there.
    expect(ana.session.friendTies().get(bento.address)?.link).toBe("pedido-enviado")
  })
})

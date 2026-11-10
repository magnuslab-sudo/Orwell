import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The feed as seen from outside: what reaches those who FOLLOW, and what stays
 * there.
 *
 * Two complaints from the owner, reported in production with two real devices:
 * "posts appear duplicated" and "when I delete them they only delete for me
 *, they don't delete for everyone else".
 *
 * Neither one measures on a single side of the wire, and that's why this file
 * exists: two real accounts, one real relay, and the count done from the
 * reader's side. The relay is the server part this question needs, sequence
 * number per channel, subscriptions, key package reserve, and the welcome
 * delivered only to the intended recipient, copied from
 * `session.corrida.test.ts`, which copied it from the `#relay` in
 * `gateway.ts`.
 */

/**
 * Creating an account is real cryptography, two to three seconds each, and
 * here we create three. See the same note in `session.eliminar.test.ts`.
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

/**
 * What one person SEES of another's feed: what stayed in their vault, folded
 * the way the interface folds it.
 *
 * Deliberately counted from the vault, not from what passed over the wire:
 * what's on the screen is what survived writing, and that's what a reload
 * shows.
 */
function publicacoesVistas(quem: Conta, canal: string): { id: string; sender: string }[] {
  const guardadas = quem.session.history(canal)
  const publicadas = guardadas.filter((entrada) => (entrada.payload as { t?: string }).t === "post")
  const apagadas = new Set(
    guardadas
      .filter((entrada) => (entrada.payload as { t?: string }).t === "redact")
      .map((entrada) => (entrada.payload as { target?: string }).target ?? ""),
  )
  return publicadas
    .map((entrada) => ({ id: (entrada.payload as { id?: string }).id ?? "", sender: entrada.sender }))
    .filter((publicacao) => !apagadas.has(publicacao.id))
}

/** Ana with the feed created and Bento in it, which is what a friendship does. */
async function feedComUmSeguidor(): Promise<{ ana: Conta; bento: Conta; carlos: Conta; feed: string }> {
  const ana = await conta()
  const bento = await conta()
  const carlos = await conta()

  const feed = await ana.session.ensureFeed()
  await settle(20)
  await ana.session.acceptFollower(bento.address)
  await settle(80)

  return { ana, bento, carlos, feed }
}

describe("o mural de quem segue", () => {
  it("uma publicação chega uma vez, e continua uma depois de o feed crescer", async () => {
    const { ana, bento, carlos, feed } = await feedComUmSeguidor()

    await ana.session.post("primeira")
    await settle(80)

    expect(publicacoesVistas(bento, feed)).toHaveLength(1)

    // A new friendship. Nothing was published twice: what Bento already had must
    // keep being one publication, not two.
    await ana.session.acceptFollower(carlos.address)
    await settle(160)

    expect(publicacoesVistas(bento, feed)).toHaveLength(1)
    // And on the screen of whoever published it, which is where the owner saw it duplicated.
    expect(publicacoesVistas(ana, feed)).toHaveLength(1)
  })

  it("apagar uma publicação apaga-a para quem segue", async () => {
    const { ana, bento, feed } = await feedComUmSeguidor()

    await ana.session.post("uma que vai ser apagada")
    await settle(80)
    const [publicada] = publicacoesVistas(bento, feed)
    expect(publicada).toBeDefined()

    await ana.session.deletePost(publicada?.id ?? "")
    await settle(80)

    expect(publicacoesVistas(ana, feed)).toHaveLength(0)
    expect(publicacoesVistas(bento, feed)).toHaveLength(0)
  })

  it("uma publicação apagada não ressuscita quando o feed cresce", async () => {
    const { ana, bento, carlos, feed } = await feedComUmSeguidor()

    await ana.session.post("uma que vai ser apagada")
    await settle(80)
    const [publicada] = publicacoesVistas(bento, feed)
    await ana.session.deletePost(publicada?.id ?? "")
    await settle(80)
    expect(publicacoesVistas(bento, feed)).toHaveLength(0)

    // Carlos enters after the post was already deleted. The feed he receives is
    // the feed that exists, and in it that post is gone.
    await ana.session.acceptFollower(carlos.address)
    await settle(200)

    expect(publicacoesVistas(carlos, feed)).toHaveLength(0)
    expect(publicacoesVistas(bento, feed)).toHaveLength(0)
  })

  /**
   * The normal case with two devices: the other was closed.
   *
   * A delete request is an application message like any other, so whoever was
   * offline only receives it in catch-up. If it weren't written backwards, the
   * deleted post would reappear on the next open, which is exactly when you
   * look at the feed.
   */
  it("apagar com o outro lado fechado apaga na mesma quando ele volta", async () => {
    const ana = await conta()
    const bento = await conta()

    const feed = await ana.session.ensureFeed()
    await settle(20)
    await ana.session.acceptFollower(bento.address)
    await settle(80)

    await ana.session.post("uma publicação")
    await settle(80)
    expect(publicacoesVistas(bento, feed)).toHaveLength(1)

    bento.session.disconnect()
    await settle(20)
    await ana.session.deletePost(publicacoesVistas(ana, feed)[0]?.id ?? "")
    await settle(80)
    // While closed, they still had the post: that's what we expect, and that's
    // what makes the next step a measurement and not a coincidence.
    expect(publicacoesVistas(bento, feed)).toHaveLength(1)

    await bento.session.connect()
    await settle(300)

    expect(publicacoesVistas(bento, feed)).toHaveLength(0)
  })

  /**
   * The two sides of a friendship, each one owning their own feed.
   *
   * Nothing here is symmetric by accident: `deletePost` always sends to OUR
   * feed, and that's why the channel doesn't come as an argument. A mistake in
   * that choice only shows up when two feeds are in play at the same time.
   */
  it("cada um apaga no seu mural, e o outro lado vê", async () => {
    const ana = await conta()
    const bento = await conta()

    const feedAna = await ana.session.ensureFeed()
    const feedBento = await bento.session.ensureFeed()
    await settle(20)
    await ana.session.acceptFollower(bento.address)
    await settle(60)
    await bento.session.acceptFollower(ana.address)
    await settle(60)

    await ana.session.post("a da ana")
    await settle(60)
    await bento.session.post("a do bento")
    await settle(60)

    expect(publicacoesVistas(bento, feedAna)).toHaveLength(1)
    expect(publicacoesVistas(ana, feedBento)).toHaveLength(1)

    await bento.session.deletePost(publicacoesVistas(bento, feedBento)[0]?.id ?? "")
    await settle(100)

    // Bento's leaves both screens; Ana's is not touched by it.
    expect(publicacoesVistas(bento, feedBento)).toHaveLength(0)
    expect(publicacoesVistas(ana, feedBento)).toHaveLength(0)
    expect(publicacoesVistas(bento, feedAna)).toHaveLength(1)
    expect(publicacoesVistas(ana, feedAna)).toHaveLength(1)
  })
})


/**
 * What a person sees of a poll: the post that carries it, and the votes that
 * reached it.
 *
 * Counted from the vault for the same reason as `publicacoesVistas`: what's on
 * the screen is what survived writing.
 */
function votacoesVistas(quem: Conta, canal: string): { id: string; pergunta: string; opcoes: string[] }[] {
  return quem.session
    .history(canal)
    .filter((entrada) => (entrada.payload as { t?: string; poll?: unknown }).t === "post")
    .filter((entrada) => (entrada.payload as { poll?: unknown }).poll)
    .map((entrada) => {
      const poll = entrada.payload.poll as { question: string; options: string[] }
      return { id: (entrada.payload as { id?: string }).id ?? "", pergunta: poll.question, opcoes: poll.options }
    })
}

/**
 * The votes stored against a target, one per vault entry.
 *
 * **Without deduplicating anything**, on purpose: this is where one extra
 * retransmission shows up. The count the interface displays is a table of
 * voter to option and so is immune to repeats, but the vault has a cap, and
 * filling it with copies is like a tombstone once got pushed out of it.
 */
function votosGuardados(
  quem: Conta,
  canal: string,
  alvo: string,
): { id: string; sender: string; vote: number; at: number }[] {
  return quem.session
    .history(canal)
    .filter((entrada) => {
      const bruto = entrada.payload as { t?: string; target?: string; vote?: unknown }
      return bruto.t === "post.reaction" && bruto.target === alvo && typeof bruto.vote === "number"
    })
    .map((entrada) => ({
      id: (entrada.payload as { id?: string }).id ?? "",
      sender: entrada.sender,
      vote: entrada.payload.vote as number,
      at: entrada.at,
    }))
}

/**
 * A poll on the feed: what reaches those who follow, and what reaches those
 * who arrive later.
 *
 * The question this block answers is one encryption raises and no interface
 * solves: **everything published before someone joins the group is unreadable
 * to them, forever.** A poll published yesterday, and the votes it got
 * yesterday, were encrypted in epochs whoever joins today will never have. If
 * nobody says them again, whoever arrives sees an empty poll and has no way to
 * know it's not.
 */
describe("uma votação no mural", () => {
  const PERGUNTA = "Qual é o melhor dia?"
  const OPCOES = ["Segunda", "Terça", "Quarta"]

  /** The caption carries the poll in full, the way the interface writes it. */
  const legenda = `${PERGUNTA}\n1. Segunda\n2. Terça\n3. Quarta`

  it("chega inteira a quem já lá estava", async () => {
    const { ana, bento, feed } = await feedComUmSeguidor()

    await ana.session.post(legenda, [], { poll: { question: PERGUNTA, options: OPCOES } })
    await settle(80)

    expect(votacoesVistas(bento, feed)).toEqual([
      { id: expect.any(String) as unknown as string, pergunta: PERGUNTA, opcoes: OPCOES },
    ])
  })

  /**
   * The scenario that names everything. Carlos joins AFTER the poll exists.
   *
   * Without the poll traveling in republication, he would receive the post, the
   * caption, with the question spelled out in full, and nowhere to tap. The
   * symptom would be "Carlos's poll doesn't work", and the cause was a field
   * that field-by-field reconstruction in `republishPosts` didn't copy.
   */
  it("chega inteira a quem só entra depois de ela existir", async () => {
    const { ana, carlos, feed } = await feedComUmSeguidor()

    await ana.session.post(legenda, [], { poll: { question: PERGUNTA, options: OPCOES } })
    await settle(80)

    await ana.session.acceptFollower(carlos.address)
    await settle(200)

    expect(votacoesVistas(carlos, feed)).toEqual([
      { id: expect.any(String) as unknown as string, pergunta: PERGUNTA, opcoes: OPCOES },
    ])
  })

  it("e o voto de quem a publicou volta com ela", async () => {
    const { ana, carlos, feed } = await feedComUmSeguidor()

    await ana.session.post(legenda, [], { poll: { question: PERGUNTA, options: OPCOES } })
    await settle(80)
    const [votacao] = votacoesVistas(ana, feed)
    expect(votacao).toBeDefined()

    await ana.session.voteOnPoll(feed, votacao?.id ?? "", 2)
    await settle(80)

    await ana.session.acceptFollower(carlos.address)
    await settle(200)

    expect(votosGuardados(carlos, feed, votacao?.id ?? "")).toEqual([
      { id: expect.any(String) as unknown as string, sender: ana.address, vote: 2, at: expect.any(Number) as unknown as number },
    ])
  })

  /**
   * The trap in this family, and the one that already cost a duplicated banner.
   *
   * Re-emitting is saying again what was already said. Whoever had the vote must
   * keep ONE, in the vault and on screen. A vote counted twice is worse
   * than a vote lost: one is lost and you notice, the other lies.
   */
  it("e quem já tinha o voto continua a ter um só, depois de o feed crescer", async () => {
    const { ana, bento, carlos, feed } = await feedComUmSeguidor()

    await ana.session.post(legenda, [], { poll: { question: PERGUNTA, options: OPCOES } })
    await settle(80)
    const [votacao] = votacoesVistas(ana, feed)
    await ana.session.voteOnPoll(feed, votacao?.id ?? "", 1)
    await settle(80)

    expect(votosGuardados(bento, feed, votacao?.id ?? "")).toHaveLength(1)

    // Carlos joining makes the poll and vote get said again, and Bento
    // hears them the same way: the server forwards to the whole channel.
    await ana.session.acceptFollower(carlos.address)
    await settle(200)

    expect(votosGuardados(bento, feed, votacao?.id ?? "")).toHaveLength(1)
    expect(votacoesVistas(bento, feed)).toHaveLength(1)
    // And in the vault of whoever posted, who receives the echo of their own sends.
    expect(votosGuardados(ana, feed, votacao?.id ?? "")).toHaveLength(1)
  })

  /**
   * Changing your mind: the most recent choice stands, and re-emission doesn't
   * undo it.
   *
   * The deduplication by `id` does the work here: without it, re-emission
   * of the old vote would enter again in the vault of whoever had it, and the
   * relative order of the two choices would stop being the voter's. Measured by
   * turning it off, the two votes become three, and whoever reads the count
   * depends on what arrived last.
   */
  it("uma mudança de voto sobrevive à entrada de mais gente", async () => {
    const { ana, bento, carlos, feed } = await feedComUmSeguidor()

    await ana.session.post(legenda, [], { poll: { question: PERGUNTA, options: OPCOES } })
    await settle(80)
    const [votacao] = votacoesVistas(ana, feed)

    await ana.session.voteOnPoll(feed, votacao?.id ?? "", 0)
    await settle(40)
    await ana.session.voteOnPoll(feed, votacao?.id ?? "", 2)
    await settle(80)

    await ana.session.acceptFollower(carlos.address)
    await settle(200)

    // What Bento has stored still says the most recent choice is the
    // third option, and it stays one vote per act, not three.
    const deBento = votosGuardados(bento, feed, votacao?.id ?? "")
    expect(deBento).toHaveLength(2)
    const primeiro = deBento.find((voto) => voto.vote === 0)
    const segundo = deBento.find((voto) => voto.vote === 2)
    expect(primeiro).toBeDefined()
    expect(segundo).toBeDefined()
    expect(segundo?.at ?? 0).toBeGreaterThan(primeiro?.at ?? 0)
  })

  /**
   * The like is also re-emitted, from phase S1 of absolute sync.
   *
   * Until 20/10/2026 it wasn't, by choice: thumbs were an open case, and
   * broadening their re-emission along the way was passing off a decision
   * nobody had made as a fix. The owner made it by approving the absolute sync
   * plan (§3, "each author resends their own"): `republishEngagement`
   * says the last like of each post again, with the original `id` and timestamp.
   * Once: the copy doesn't enter twice in the vault of whoever arrives.
   */
  it("e um gosto também é reemitido, uma vez, com o id original (S1)", async () => {
    const { ana, carlos, feed } = await feedComUmSeguidor()

    await ana.session.post("uma publicação normal")
    await settle(80)
    const [publicada] = publicacoesVistas(ana, feed)
    await ana.session.reactToPost(feed, publicada?.id ?? "", "👍")
    await settle(80)

    await ana.session.acceptFollower(carlos.address)
    await settle(200)

    const gostos = carlos.session
      .history(feed)
      .filter((entrada) => (entrada.payload as { t?: string }).t === "post.reaction")
    expect(gostos).toHaveLength(1)
    const doCofreDaAna = ana.session.history(feed).find((entrada) => entrada.payload.t === "post.reaction")
    expect(gostos[0]?.payload["id"]).toBe(doCofreDaAna?.payload["id"])
  })
})

/**
 * A real friendship, through the product path: the direct, the request, the accept.
 * The shown list only takes friends from the fold, and `acceptFollower` alone
 * doesn't make a bond.
 */
async function amizade(quem: Conta, com: Conta): Promise<string> {
  const dm = await quem.session.openDirect(com.address)
  await ate(() => expect(com.session.channels).toContain(dm))
  await quem.session.sendFriendRequest(dm)
  await ate(() => expect(com.session.friendTies().get(quem.address)?.link).toBe("pedido-recebido"))
  await com.session.acceptFriend(dm, quem.address)
  await ate(() => {
    expect(quem.session.friendTies().get(com.address)?.link).toBe("amigos")
    expect(com.session.friendTies().get(quem.address)?.link).toBe("amigos")
  })
  return dm
}

/**
 * The friends list on the profile (phase 5 of the friendships plan, 20/10/2026).
 *
 * Opt-in, encrypted, and only in the feed of whoever shows it: friends read it,
 * nobody else. No "mutual friends": the core returns the list and doesn't
 * compare it.
 */
describe("a lista de amigos mostrada", () => {
  // The three-second wait is measured in its test; in others, zero.
  const espera = Session.LISTA_MS
  const tecto = Session.LISTAS_SEGUIDAS_MAX
  beforeEach(() => {
    Session.LISTA_MS = 0
  })
  afterEach(() => {
    Session.LISTA_MS = espera
    Session.LISTAS_SEGUIDAS_MAX = tecto
  })

  /** The lists that went to the feed, counted at the gate of `send`. */
  function contarListas(quem: Conta): () => number {
    const envio = vi.spyOn(quem.session, "send")
    return () =>
      envio.mock.calls.filter(([canal, payload]) => canal === quem.session.feedChannel && payload.t === "friends.shown").length
  }

  /**
   * One account alone in the feed, with the fold saying these people are
   * friends. With nobody in the feed there are no reassignments or republications
   * midway, and what counts is only what `setShownFriends` sends.
   */
  async function sozinhaComAmigos(amigos: string[]): Promise<Conta> {
    const ana = await conta()
    await ana.session.ensureFeed()
    await settle(40)
    vi.spyOn(ana.session, "friendTies").mockReturnValue(
      new Map(amigos.map((peer) => [peer, { peer, channel: "!x:localhost:8448", link: "amigos" as const, at: 0, severed: false }])),
    )
    return ana
  }
  const B = "@bento:localhost:8448"
  const C = "@carlos:localhost:8448"

  it("várias alterações seguidas saem como UMA, a última", async () => {
    const ana = await sozinhaComAmigos([B, C])
    Session.LISTA_MS = 200
    const listas = contarListas(ana)
    const chamadas = [ana.session.setShownFriends([B]), ana.session.setShownFriends([C]), ana.session.setShownFriends([B, C])]
    // The choice is in the vault right away, before it goes out.
    await settle(20)
    expect(listas()).toBe(0)
    expect(ana.session.shownFriendsOf(ana.address)?.shown).toEqual([B, C])
    await Promise.all(chamadas)
    expect(listas()).toBe(1)
    const [, enviada] = vi.mocked(ana.session.send).mock.calls.find(([, payload]) => payload.t === "friends.shown") ?? []
    expect(enviada).toMatchObject({ shown: [B, C] })
  })

  it("três listas seguidas sem outro evento, e a seguinte espera pela publicação", async () => {
    const ana = await sozinhaComAmigos([B, C])
    const listas = contarListas(ana)
    for (const escolha of [[B], [C], [B, C], [B], [C]]) {
      await ana.session.setShownFriends(escolha)
      await settle(20)
    }
    // Only three went out; the fifth choice is in the vault, waiting.
    expect(listas()).toBe(3)
    expect(ana.session.shownFriendsOf(ana.address)?.shown).toEqual([C])
    // And not even a shortcut lets it pass: the cap is in the way of every send.
    await expect(ana.session.send(ana.session.feedChannel, { t: "friends.shown", shown: [B], updatedAt: Date.now() })).rejects.toThrow(
      "too many friend lists in a row",
    )
    await ana.session.post("um evento no feed")
    await settle(80)
    // The post reset the count, and the stored list went out after: the last one.
    expect(listas()).toBe(5)
    const ultima = vi.mocked(ana.session.send).mock.calls.filter(([, payload]) => payload.t === "friends.shown").pop()
    expect(ultima?.[1]).toMatchObject({ shown: [C] })
  })

  it("só conta o que saiu: uma lista que não saiu não gasta a vez", async () => {
    const ana = await sozinhaComAmigos([B, C])
    const feed = ana.session.feedChannel
    ana.session.disconnect()
    await expect(ana.session.send(feed, { t: "friends.shown", shown: [B], updatedAt: 1 })).rejects.toThrow()
    await ana.session.connect()
    await settle(80)
    // Three go out; if the failed one had counted, the third would already be refused.
    for (let vez = 0; vez < 3; vez++) await ana.session.send(feed, { t: "friends.shown", shown: [B], updatedAt: 2 + vez })
    await expect(ana.session.send(feed, { t: "friends.shown", shown: [B], updatedAt: 9 })).rejects.toThrow("too many friend lists in a row")
  })

  it("a contagem e a lista à espera sobrevivem a recarregar, e a lista sai depois do evento seguinte", async () => {
    const backend = new MemoryBackend()
    const vault = new Vault(backend)
    await vault.create("frase-passe")
    const primeira = new Session(vault)
    abertas.push(primeira)
    await primeira.createIdentity("localhost:8448")
    await primeira.connect()
    await settle(20)
    await primeira.ensureFeed()
    const amigos = (quem: Session): void => {
      vi.spyOn(quem, "friendTies").mockReturnValue(
        new Map([B, C].map((peer) => [peer, { peer, channel: "!x:localhost:8448", link: "amigos" as const, at: 0, severed: false }])),
      )
    }
    amigos(primeira)
    for (const escolha of [[B], [C], [B, C], [C]]) {
      await primeira.setShownFriends(escolha)
      await settle(20)
    }
    await primeira.flush()
    primeira.disconnect()
    await settle(20)

    const outra = new Vault(backend)
    await outra.unlock("frase-passe")
    expect(outra.contents.listasSeguidas).toBe(3)
    expect(outra.contents.listaPorEnviar).toBe(true)
    const segunda = new Session(outra)
    abertas.push(segunda)
    segunda.loadIdentity()
    amigos(segunda)
    const listas = contarListas({ session: segunda, address: segunda.identity.address, vault: outra })
    await segunda.connect()
    await settle(80)
    // The connection may have already put another event in the feed (the profile);
    // if it didn't, the post does. Either way, the waiting list goes out once.
    await segunda.post("um evento no feed")
    await settle(120)
    expect(listas()).toBe(1)
    const enviada = vi.mocked(segunda.send).mock.calls.find(([, payload]) => payload.t === "friends.shown")
    expect(enviada?.[1]).toMatchObject({ shown: [C] })
    expect(outra.contents.listaPorEnviar).toBeUndefined()
  })

  it("um seguidor antigo que pede amizade não fica a ler a lista", async () => {
    const ana = await conta()
    const bento = await conta()
    const carlos = await conta()
    await amizade(ana, bento)
    const feed = ana.session.feedChannel
    await ana.session.acceptFollower(carlos.address)
    await settle(200)
    // Carlos asks for friendship: on Ana's side, `request-received`.
    const dm = await carlos.session.openDirect(ana.address)
    await settle(160)
    await carlos.session.sendFriendRequest(dm)
    await settle(160)
    expect(ana.session.friendTies().get(carlos.address)?.link).toBe("pedido-recebido")

    await ana.session.setShownFriends([bento.address])
    await settle(200)
    expect(ana.session.membersOf(feed).map(String)).not.toContain(carlos.address)
    expect(carlos.vault.contents.shownFriends?.[ana.address]).toBeUndefined()
  })

  it("fechar a sessão com uma lista à espera diz a quem esperava, e nada sai depois", async () => {
    const ana = await sozinhaComAmigos([B])
    Session.LISTA_MS = 300
    const listas = contarListas(ana)
    const espera = ana.session.setShownFriends([B])
    await settle(20)
    ana.session.disconnect()
    await expect(espera).rejects.toThrow("the session ended")
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(listas()).toBe(0)
    // A escolha ficou no cofre.
    expect(ana.session.shownFriendsOf(ana.address)?.shown).toEqual([B])
  })

  it("uma lista vazia sem nenhuma antes não envia nada", async () => {
    const ana = await sozinhaComAmigos([B])
    const listas = contarListas(ana)
    await ana.session.setShownFriends([])
    await settle(80)
    expect(listas()).toBe(0)
    expect(ana.session.shownFriendsOf(ana.address)).toBeNull()
  })

  it("um feed é dos amigos: quem lá está sem ser amigo sai antes de a lista sair", async () => {
    const ana = await conta()
    const bento = await conta()
    const carlos = await conta()
    await amizade(ana, bento)
    const feed = ana.session.feedChannel
    // Carlos, follower without friendship (the old way): he's in the feed.
    await ana.session.acceptFollower(carlos.address)
    await settle(200)
    expect(ana.session.membersOf(feed).map(String)).toContain(carlos.address)

    await ana.session.setShownFriends([bento.address])
    await settle(200)
    expect(ana.session.membersOf(feed).map(String)).not.toContain(carlos.address)
    expect(bento.session.shownFriendsOf(ana.address)?.shown).toEqual([bento.address])
    // What Carlos stored from the feed: nothing from the list.
    expect(carlos.vault.contents.shownFriends?.[ana.address]).toBeUndefined()
  })

  it("sem rede para tirar quem não é amigo, a lista não sai e diz porquê", async () => {
    const ana = await conta()
    const bento = await conta()
    const carlos = await conta()
    await amizade(ana, bento)
    await ana.session.acceptFollower(carlos.address)
    await settle(200)
    ana.session.disconnect()
    await expect(ana.session.setShownFriends([bento.address])).rejects.toThrow("your feed has people who are not friends")
  })

  it("chega a um amigo, só com amigos, sem repetidos, e a vazia deixa de mostrar", async () => {
    const ana = await conta()
    const bento = await conta()
    const carlos = await conta()
    await amizade(ana, bento)

    expect(bento.session.shownFriendsOf(ana.address)).toBeNull()
    // Carlos is not Ana's friend: it falls silent. Bento repeated counts once.
    await ana.session.setShownFriends([bento.address, carlos.address, bento.address])
    await settle(120)
    expect(ana.session.shownFriendsOf(ana.address)?.shown).toEqual([bento.address])
    expect(bento.session.shownFriendsOf(ana.address)?.shown).toEqual([bento.address])

    await ana.session.setShownFriends([])
    await settle(120)
    expect(bento.session.shownFriendsOf(ana.address)?.shown).toEqual([])
    // Non-friends cannot see it, even if they have it in the vault through another path.
    expect(carlos.session.shownFriendsOf(ana.address)).toBeNull()
  })

  it("chega a quem entra no feed depois de ela existir", async () => {
    const ana = await conta()
    const bento = await conta()
    const carlos = await conta()
    await amizade(ana, bento)
    await ana.session.setShownFriends([bento.address])
    await settle(120)

    // Carlos becomes a friend after: doesn't decrypt what was already in the feed,
    // and it's `republishPosts` that says it to him again.
    await amizade(ana, carlos)
    await ate(() => expect(carlos.session.shownFriendsOf(ana.address)?.shown).toEqual([bento.address]))
  })

  it("vinda de outro canal que não o feed do autor, não se guarda", async () => {
    const ana = await conta()
    const bento = await conta()
    const dm = await amizade(ana, bento)
    // Ana sends the list direct: it's not her feed, it's noise.
    await ana.session.send(dm, { t: "friends.shown", shown: [bento.address], updatedAt: Date.now() })
    await settle(120)
    expect(bento.session.shownFriendsOf(ana.address)).toBeNull()
  })

  it("desfazer a amizade tira a pessoa da lista, e o ex-amigo deixa de a ver", async () => {
    const ana = await conta()
    const bento = await conta()
    const carlos = await conta()
    await amizade(ana, bento)
    await amizade(ana, carlos)
    await ana.session.setShownFriends([bento.address, carlos.address])
    // By condition and not by a fixed number of rounds: from phase S1, each
    // growing feed also carries the announcement and resend of its own, and with
    // the full suite running fixed rounds they reached the mark.
    const ateQue = async (condicao: () => boolean): Promise<void> => {
      for (let volta = 0; volta < 50 && !condicao(); volta++) await settle(100)
    }
    await ateQue(() => carlos.session.shownFriendsOf(ana.address)?.shown.length === 2)
    expect(carlos.session.shownFriendsOf(ana.address)?.shown).toEqual([bento.address, carlos.address])

    await ana.session.unfriend(bento.address)
    await ateQue(() => carlos.session.shownFriendsOf(ana.address)?.shown.length === 1)
    await settle(300)
    expect(ana.session.shownFriendsOf(ana.address)?.shown).toEqual([carlos.address])
    expect(carlos.session.shownFriendsOf(ana.address)?.shown).toEqual([carlos.address])
    expect(bento.session.shownFriendsOf(ana.address)).toBeNull()
  })

  it("mais de quinhentos recusa-se antes de cifrar", async () => {
    const ana = await conta()
    const bento = await conta()
    await amizade(ana, bento)
    // The friends filter runs first; to measure the cap, the fold says
    // everyone is a friend.
    const muitos = Array.from({ length: 501 }, (_v, i) => `@conta${i}:localhost:8448`)
    vi.spyOn(ana.session, "friendTies").mockReturnValue(
      new Map(muitos.map((peer) => [peer, { peer, channel: "!x:localhost:8448", link: "amigos" as const, at: 0, severed: false }])),
    )
    await expect(ana.session.setShownFriends(muitos)).rejects.toThrow("too many friends to show")
  })
})

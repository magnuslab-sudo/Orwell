import { moradaDeTeste } from "../testes/moradas.js"
import { declaredEpoch, epochOf, memberLeaves, type GroupSession } from "@enclave/crypto"
import { fromBase64, type UserAddress } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Session, type SessionEvents } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * Each one's commits, and the server that accepts only one per epoch.
 *
 * The shared room broke on 9/12/2026 also here: two entries at the same
 * time, one by card, another admitted by a member, produced two
 * commits for the same epoch, the server stored both, and each author applied
 * theirs before knowing if anyone would accept it. Two branches, each with half the
 * room, and no error anywhere.
 *
 * The new contract (`channel.rejected` with `stale-epoch`, in `wire.ts`) says the
 * server accepts the first commit of each epoch and refuses others with an echo
 * of the reference. This only works if the client waits for the verdict before
 * applying, that is what we prove here, with real accounts on both sides.
 *
 * The relay below is the server reduced to what this needs. It applies the rule by reading
 * the epoch in plain text from the MLS header (`declaredEpoch`), as the server does, and
 * can hold commits for the test to decide the order they arrive in.
 */

class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  /** Refuse writes, like a full IndexedDB. */
  cheio = false
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    if (this.cheio) throw new Error("QuotaExceededError: storage is full")
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

const CASA = "localhost:8448"
const SALA = `!orwell:${CASA}`
const CANAL = moradaDeTeste("lagar", CASA)

/** See the same cap in `session.corrida.test.ts`: a broken channel cannot hang the suite. */
const TRAMAS_MAXIMAS = 20_000

class Rele {
  readonly eventos = new Map<string, Evento[]>()
  readonly pools = new Map<string, string[]>()
  readonly ligacoes = new Set<FakeSocket>()
  readonly cartoes = new Map<string, string>()
  readonly epocas = new Map<string, bigint>()
  readonly donos = new Map<string, string>()
  /** Published cards, by whom and with which epoch. */
  readonly cartoesPostos: { address: string; epoch: bigint | undefined; aceite: boolean }[] = []
  readonly recusas: Frame[] = []
  entregues = 0

  /** The contract rule: one commit per epoch per channel. Off is the old server. */
  umCommitPorEpoca = true
  /** The shared room announced in `hello`. Only in tests that talk about it. */
  salaComum: string | undefined = undefined
  /** The empty gate: whoever picks up the card receives none. */
  semCartao = false
  /**
   * Refuse commits and cards from whoever did not announce `commit-after-echo` in hello,
   * like the second round server. On by default: it is the server going
   * to production.
   */
  exigirCommitDepoisDoEco = true
  /** What each connection announced in `hello`. */
  readonly anunciado = new Map<FakeSocket, string[]>()
  /** Hold commits (handshakes) instead of handling them; `release` handles them in order. */
  segurar = false
  /** Release on its own when there are this many held commits. */
  libertarAos = 0
  readonly seguros: (() => void)[] = []

  capacidades(): string[] {
    return ["common-room-groupinfo", ...(this.umCommitPorEpoca ? ["commit-per-epoch"] : [])]
  }

  libertar(): void {
    this.segurar = false
    for (const tratar of this.seguros.splice(0, this.seguros.length)) tratar()
  }

  frame(socket: FakeSocket, frame: Frame): void {
    switch (frame.t) {
      case "hello":
        this.anunciado.set(socket, (frame.capabilities as string[] | undefined) ?? [])
        socket.entregar({
          t: "hello.ok",
          version: 1,
          server: CASA,
          capabilities: this.capacidades(),
          ...(this.salaComum ? { commonRoom: this.salaComum, commonRoomGroupInfo: this.cartoes.has(this.salaComum) } : {}),
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
        socket.entregar({ t: "keypackage.claimed", address: frame.address, keyPackage: pool.shift() ?? null })
        return
      }
      case "channel.claim": {
        const canal = frame.channel as string
        if (!this.donos.has(canal)) this.donos.set(canal, socket.address as string)
        socket.entregar({
          t: "channel.claim.result",
          channel: canal,
          owner: this.donos.get(canal),
          mine: this.donos.get(canal) === socket.address,
          empty: (this.eventos.get(canal) ?? []).length === 0,
        })
        return
      }
      case "channel.groupinfo.put": {
        const canal = frame.channel as string
        if (!socket.canais.has(canal)) return
        if (this.#semGarantia(socket)) {
          this.#recusar(socket, { t: "channel.rejected", channel: canal, reason: "update-required" })
          return
        }
        const epoch = declaredEpoch(fromBase64(frame.info as string))
        const atual = this.epocas.get(canal)
        const aceite = !this.umCommitPorEpoca || atual === undefined || epoch === undefined || epoch >= atual
        this.cartoesPostos.push({ address: socket.address as string, epoch, aceite })
        if (!aceite) {
          this.#recusar(socket, { t: "channel.rejected", channel: canal, reason: "stale-groupinfo", epoch: Number(atual) })
          return
        }
        this.cartoes.set(canal, frame.info as string)
        return
      }
      case "channel.groupinfo.take": {
        const canal = frame.channel as string
        const info = this.semCartao ? undefined : this.cartoes.get(canal)
        if (info) this.cartoes.delete(canal)
        if (info) socket.canais.add(canal)
        socket.entregar({ t: "channel.groupinfo", channel: canal, ...(info ? { info } : {}) })
        return
      }
      case "channel.rejoin.request": {
        const canal = frame.channel as string
        let ouviram = 0
        for (const ligacao of this.ligacoes) {
          if (ligacao === socket || !ligacao.address || !ligacao.canais.has(canal)) continue
          ouviram += 1
          ligacao.entregar({ t: "channel.rejoin", channel: canal, address: socket.address })
        }
        socket.entregar({ t: "channel.rejoin.sent", channel: canal, ouviram })
        return
      }
      case "channel.send": {
        if (frame.kind === "handshake" && this.segurar) {
          this.seguros.push(() => this.#enviar(socket, frame))
          if (this.libertarAos > 0 && this.seguros.length >= this.libertarAos) this.libertar()
          return
        }
        this.#enviar(socket, frame)
        return
      }
      case "channel.backfill": {
        const canal = frame.channel as string
        const depois = (frame.afterSeq as number | undefined) ?? -1
        const visiveis = (this.eventos.get(canal) ?? []).filter(
          (evento) => evento.seq > depois && (evento.recipient === undefined || evento.recipient === socket.address),
        )
        const pagina = visiveis.slice(0, (frame.limit as number | undefined) ?? 100)
        socket.entregar({
          t: "channel.backfill.page",
          channel: canal,
          events: pagina.map(({ seq, kind, ciphertext }) => ({ seq, kind, ciphertext, receivedAtMinute: 0 })),
          more: pagina.length < visiveis.length,
        })
        return
      }
      case "welcome.resync": {
        for (const [canal, log] of this.eventos) {
          for (const evento of log) {
            if (evento.kind === "welcome" && evento.recipient === socket.address) socket.entregar(this.#comoEvento(canal, evento))
          }
        }
        return
      }
      default:
        return
    }
  }

  #semGarantia(socket: FakeSocket): boolean {
    return this.exigirCommitDepoisDoEco && !(this.anunciado.get(socket) ?? []).includes("commit-after-echo")
  }

  #enviar(socket: FakeSocket, frame: Frame): void {
    const canal = frame.channel as string
    if (frame.kind === "handshake" && this.#semGarantia(socket)) {
      this.#recusar(socket, {
        t: "channel.rejected",
        channel: canal,
        reason: "update-required",
        ...(frame.ref ? { ref: frame.ref } : {}),
      })
      return
    }
    if (frame.kind === "handshake" && this.umCommitPorEpoca) {
      const epoch = declaredEpoch(fromBase64(frame.ciphertext as string))
      const atual = this.epocas.get(canal)
      if (epoch !== undefined && atual !== undefined && epoch < atual) {
        this.#recusar(socket, {
          t: "channel.rejected",
          channel: canal,
          reason: "stale-epoch",
          ...(frame.ref ? { ref: frame.ref } : {}),
          epoch: Number(atual),
        })
        return
      }
      if (epoch !== undefined) this.epocas.set(canal, epoch + 1n)
    }
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
    for (const ligacao of this.ligacoes) {
      if (!ligacao.address) continue
      if (evento.recipient) {
        if (ligacao.address !== evento.recipient) continue
      } else if (!ligacao.canais.has(canal)) continue
      ligacao.entregar(this.#comoEvento(canal, evento))
    }
  }

  #recusar(socket: FakeSocket, frame: Frame): void {
    this.recusas.push({ ...frame, address: socket.address })
    socket.entregar(frame)
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
    this.#listeners.set(kind, (this.#listeners.get(kind) ?? []).filter((item) => item !== handler))
  }

  send(raw: string): void {
    this.#rele.frame(this, JSON.parse(raw) as Frame)
  }

  entregar(frame: unknown): void {
    if (this.#rele.entregues++ > TRAMAS_MAXIMAS) return
    setTimeout(() => {
      if (this.readyState === 1) this.#fire("message", { data: JSON.stringify(frame) })
    }, 0)
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

interface Conta {
  nome: string
  session: Session
  address: string
  vault: Vault
  backend: MemoryBackend
  estados: SessionEvents["status"][]
  ditas: string[]
}

let abertas: Session[] = []

async function conta(nome: string, backend = new MemoryBackend(), ligar = true): Promise<Conta> {
  const vault = new Vault(backend)
  if (backend.bytes) await vault.unlock("frase-passe")
  else await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  const estados: SessionEvents["status"][] = []
  const ditas: string[] = []
  session.on("status", (estado) => estados.push(estado))
  session.on("message", (evento) => {
    if (evento.payload.t === "message") ditas.push(`${evento.channel}|${evento.payload.body}`)
  })
  const address = vault.contents.signingPrivateKey ? session.loadIdentity().address : (await session.createIdentity(CASA)).address
  if (ligar) await session.connect()
  return { nome, session, address, vault, backend, estados, ditas }
}

async function ate(condicao: () => boolean, prazoMs = 20_000): Promise<boolean> {
  const limite = Date.now() + prazoMs
  while (Date.now() < limite) {
    if (condicao()) return true
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return condicao()
}

function grupo(quem: Conta, canal: string): GroupSession | undefined {
  return quem.session.groupFor(canal)
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** The fingerprint of the branch: epoch and summary of the transcript. Two branches never share it. */
function ramo(quem: Conta, canal: string): string {
  const g = grupo(quem, canal)
  if (!g) return `${quem.nome}: sem grupo`
  return `${epochOf(g)}:${hex(g.state.groupContext.confirmedTranscriptHash)}`
}

function mesmoRamo(contas: Conta[], canal: string, membros: number): boolean {
  const ramos = new Set(contas.map((quem) => ramo(quem, canal)))
  return ramos.size === 1 && contas.every((quem) => quem.session.membersOf(canal).length === membros)
}

function mensagem(corpo: string) {
  return { t: "message" as const, id: crypto.randomUUID(), sentAt: Date.now(), body: corpo, attachments: [], mentions: [], links: [] }
}

beforeEach(() => {
  rele = new Rele()
  abertas = []
  Session.CONFIRM_MS = 10_000
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  for (const session of abertas) session.disconnect()
  abertas = []
  Session.CONFIRM_MS = 10_000
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

/** The founder is the shared room; each of the others joins by card, one at a time. */
async function salaComum(...nomes: string[]): Promise<Conta[]> {
  rele.salaComum = SALA
  const contas: Conta[] = []
  for (const nome of nomes) {
    const nova = await conta(nome)
    contas.push(nova)
    expect(await ate(() => grupo(nova, SALA) !== undefined && mesmoRamo(contas, SALA, contas.length)), `${nome} na sala`).toBe(true)
    // The next card must be posted before the next one arrives.
    expect(await ate(() => rele.cartoes.has(SALA)), `cartão depois de ${nome}`).toBe(true)
  }
  return contas
}

describe("M3: o próprio commit só entra depois de o servidor o aceitar", () => {
  it("fica na epoch de antes enquanto não há eco, e o Welcome só sai depois dele", async () => {
    const ana = await conta("ana")
    const bento = await conta("bento")
    await ana.session.createSpaceChannel(CANAL)

    rele.segurar = true
    const assento = ana.session.seat(CANAL, bento.address)
    expect(await ate(() => rele.seguros.length === 1)).toBe(true)
    await ate(() => false, 200)

    expect(epochOf(grupo(ana, CANAL) as GroupSession)).toBe(0n)
    expect((rele.eventos.get(CANAL) ?? []).some((evento) => evento.kind === "welcome")).toBe(false)

    rele.libertar()
    await assento
    expect(epochOf(grupo(ana, CANAL) as GroupSession)).toBe(1n)
    expect(await ate(() => mesmoRamo([ana, bento], CANAL, 2))).toBe(true)

    await ana.session.send(CANAL, mensagem("chegou"))
    expect(await ate(() => bento.ditas.includes(`${CANAL}|chegou`))).toBe(true)
  }, 60_000)

  it("dois commits na mesma epoch: quem perde apanha o canal, repete, e ficam todos no mesmo ramo", async () => {
    const [ana, bento, carlos, diana] = [await conta("ana"), await conta("bento"), await conta("carlos"), await conta("diana")] as [Conta, Conta, Conta, Conta]
    await ana.session.createSpaceChannel(CANAL)
    await ana.session.seat(CANAL, bento.address)
    expect(await ate(() => mesmoRamo([ana, bento], CANAL, 2))).toBe(true)

    // The two commits go out for the same epoch and reach the server together.
    rele.segurar = true
    rele.libertarAos = 2
    await Promise.all([ana.session.seat(CANAL, carlos.address), bento.session.seat(CANAL, diana.address)])

    const todos = [ana, bento, carlos, diana]
    expect(await ate(() => mesmoRamo(todos, CANAL, 4)), todos.map((quem) => ramo(quem, CANAL)).join(" / ")).toBe(true)
    expect(rele.recusas.filter((recusa) => recusa.reason === "stale-epoch")).toHaveLength(1)
    const perdedor = todos.find((quem) => quem.address === rele.recusas[0]?.address) as Conta
    expect(perdedor.estados.some((estado) => estado.code === "commit-rejected" && estado.route === "log")).toBe(true)

    // And they speak through what has happened: the last to join hears the first.
    await carlos.session.send(CANAL, mensagem("do carlos"))
    expect(await ate(() => diana.ditas.includes(`${CANAL}|do carlos`))).toBe(true)
  }, 90_000)

  it("sem eco no prazo não se aplica — e se o commit afinal entrou, aplica-se quando aparece", async () => {
    const ana = await conta("ana")
    const bento = await conta("bento")
    await ana.session.createSpaceChannel(CANAL)
    Session.CONFIRM_MS = 400

    rele.segurar = true
    await expect(ana.session.seat(CANAL, bento.address)).rejects.toThrow()
    expect(epochOf(grupo(ana, CANAL) as GroupSession)).toBe(0n)
    expect(ana.estados.some((estado) => estado.code === "commit-unconfirmed")).toBe(true)

    // The server had it after all: it arrives late, and it is the same commit.
    rele.libertar()
    expect(await ate(() => epochOf(grupo(ana, CANAL) as GroupSession) === 1n)).toBe(true)
    expect(await ate(() => mesmoRamo([ana, bento], CANAL, 2))).toBe(true)
  }, 60_000)

  it("recarregar com um commit por confirmar: o que o servidor guardou é adoptado ao voltar", async () => {
    const backend = new MemoryBackend()
    const ana = await conta("ana", backend)
    const bento = await conta("bento")
    await ana.session.createSpaceChannel(CANAL)

    rele.segurar = true
    const assento = ana.session.seat(CANAL, bento.address).catch(() => "sem veredicto")
    expect(await ate(() => rele.seguros.length === 1)).toBe(true)
    await ate(() => false, 100)

    // F5 with the commit in flight: the session ends, the page opens the same vault again.
    ana.session.disconnect()
    expect(await assento).toBe("sem veredicto")
    rele.libertar()

    const deNovo = await conta("ana", backend)
    expect(await ate(() => mesmoRamo([deNovo, bento], CANAL, 2)), `${ramo(deNovo, CANAL)} / ${ramo(bento, CANAL)}`).toBe(true)
  }, 60_000)
})

describe("M4: a porta da sala comum", () => {
  it("quem entra pelo cartão só publica o seguinte depois de o seu commit ser aceite", async () => {
    const [ana] = await salaComum("ana")
    rele.segurar = true
    const filipa = await conta("filipa", new MemoryBackend(), false)
    void filipa.session.connect().catch(() => {})

    expect(await ate(() => rele.seguros.length === 1)).toBe(true)
    await ate(() => false, 300)
    expect(rele.cartoesPostos.filter((posto) => posto.address === filipa.address)).toHaveLength(0)
    expect(grupo(filipa, SALA)).toBeUndefined()

    rele.libertar()
    expect(await ate(() => mesmoRamo([ana as Conta, filipa], SALA, 2))).toBe(true)
    expect(await ate(() => rele.cartoesPostos.some((posto) => posto.address === filipa.address && posto.aceite))).toBe(true)
  }, 60_000)

  it("reentrada do mesmo aparelho: uma folha só, e a sala continua a aceitar cartões e admissões", async () => {
    const [ana, bento] = (await salaComum("ana", "bento")) as [Conta, Conta]

    await bento.session.forgetChannel(SALA)
    await bento.session.ensureCommonRoom()
    expect(await ate(() => mesmoRamo([ana, bento], SALA, 2))).toBe(true)
    expect(memberLeaves(grupo(ana, SALA) as GroupSession, bento.address as UserAddress)).toHaveLength(1)
    expect(bento.estados.some((estado) => estado.code === "rejoin-resync" && estado.route === "log")).toBe(true)

    // By card...
    expect(await ate(() => rele.cartoes.has(SALA))).toBe(true)
    const nuno = await conta("nuno")
    expect(await ate(() => mesmoRamo([ana, bento, nuno], SALA, 3))).toBe(true)

    // ...and by admission, with no card at the gate.
    expect(await ate(() => rele.cartoes.has(SALA))).toBe(true)
    rele.cartoes.delete(SALA)
    const marta = await conta("marta")
    expect(await ate(() => mesmoRamo([ana, bento, nuno, marta], SALA, 4), 40_000)).toBe(true)
  }, 90_000)
})

/**
 * The acceptance, at the core level: the production case, end to end.
 *
 * Filipa enters by card and her commit stays in flight. Eduardo arrives right
 * after, finds no card (Filipa picked it up) and requests a place; a member
 * admits him with a commit for the SAME epoch. The two commits reach the
 * server together. Two orders, because what is lost is different in each one: in one
 * it is an admission that must repeat, in the other it is a card entry that must
 * go back to the gate.
 */
describe("duas entradas ao mesmo tempo na sala comum", () => {
  for (const ordem of ["o cartão chega primeiro", "a admissão chega primeiro"] as const) {
    it(`convergem todas para o mesmo ramo — ${ordem}`, async () => {
      const [ana, bento] = (await salaComum("ana", "bento")) as [Conta, Conta]

      rele.segurar = true
      const filipa = await conta("filipa", new MemoryBackend(), false)
      void filipa.session.connect().catch(() => {})
      expect(await ate(() => rele.seguros.length === 1)).toBe(true)
      // The gate is empty when Eduardo arrives: Filipa picked up the card and her
      // commit has not been accepted yet. (A client that posted the next card
      // without waiting for the verdict would chain the two entries by chance
      //, and that is exactly what M4 stopped doing.)
      rele.semCartao = true
      const eduardo = await conta("eduardo", new MemoryBackend(), false)
      void eduardo.session.connect().catch(() => {})
      expect(await ate(() => rele.seguros.length === 2, 30_000)).toBe(true)

      if (ordem === "a admissão chega primeiro") rele.seguros.reverse()
      rele.semCartao = false
      rele.libertar()

      const todos = [ana, bento, filipa, eduardo]
      expect(
        await ate(() => mesmoRamo(todos, SALA, 4), 60_000),
        todos.map((quem) => `${quem.nome}=${ramo(quem, SALA)}`).join(" "),
      ).toBe(true)

      await eduardo.session.send(SALA, mensagem("do eduardo"))
      await filipa.session.send(SALA, mensagem("da filipa"))
      expect(await ate(() => filipa.ditas.includes(`${SALA}|do eduardo`) && eduardo.ditas.includes(`${SALA}|da filipa`))).toBe(true)
      expect(await ate(() => ana.ditas.includes(`${SALA}|do eduardo`) && bento.ditas.includes(`${SALA}|da filipa`))).toBe(true)
    }, 150_000)
  }
})

describe("ronda 2: o Welcome de um commit aceite", () => {
  it("sai logo a seguir ao veredicto, mesmo que a gravação a seguir falhe", async () => {
    const backend = new MemoryBackend()
    const ana = await conta("ana", backend)
    const bento = await conta("bento")
    await ana.session.createSpaceChannel(CANAL)

    rele.segurar = true
    const assento = ana.session.seat(CANAL, bento.address).then(
      () => "assentou",
      (erro: Error) => erro.message,
    )
    expect(await ate(() => rele.seguros.length === 1)).toBe(true)
    // The commit is already stored as pending; from here on the disk refuses.
    backend.cheio = true
    rele.libertar()

    expect(await assento).toContain("storage is full")
    expect((rele.eventos.get(CANAL) ?? []).some((evento) => evento.kind === "welcome" && evento.recipient === bento.address)).toBe(true)
    expect(await ate(() => bento.session.channels.includes(CANAL))).toBe(true)
  }, 60_000)
})

describe("ronda 2: a garantia dita no hello", () => {
  it("o hello anuncia commit-after-echo, e todos os caminhos de commit passam num servidor que a exige", async () => {
    const ana = await conta("ana")
    const bento = await conta("bento")
    const carlos = await conta("carlos")
    for (const ligacao of rele.ligacoes) expect(rele.anunciado.get(ligacao)).toContain("commit-after-echo")

    // Invite, expel, and invite again to an empty seat.
    await ana.session.createSpaceChannel(CANAL)
    await ana.session.seat(CANAL, bento.address)
    await ana.session.seat(CANAL, carlos.address)
    expect(await ate(() => mesmoRamo([ana, bento, carlos], CANAL, 3))).toBe(true)
    await ana.session.expel(CANAL, carlos.address)
    expect(await ate(() => mesmoRamo([ana, bento], CANAL, 2))).toBe(true)
    // Remove a seat (`#unseat`, which is also half of reseating and the entire
    // undo of a friendship): Bento leaves, and Ana honors the departure.
    await bento.session.leaveChannel(CANAL)
    expect(await ate(() => ana.session.membersOf(CANAL).length === 1, 20_000)).toBe(true)

    // The common room: creation, entry by card, and admission without a card at the door.
    // After the invites, on purpose: see the note about key packages at the end.
    rele.salaComum = SALA
    for (const quem of [ana, bento]) {
      quem.session.disconnect()
      await quem.session.connect()
    }
    expect(await ate(() => mesmoRamo([ana, bento], SALA, 2))).toBe(true)
    // (A device that entered by card consumed the first key package, which
    // stays on the server for whoever invites it next: that invite is born dead.
    // It is not of the partition, and stays out of this test by the order above.)
    rele.semCartao = true
    carlos.session.disconnect()
    await carlos.session.connect()
    expect(await ate(() => mesmoRamo([ana, bento, carlos], SALA, 3), 40_000)).toBe(true)

    expect(rele.recusas.filter((recusa) => recusa.reason === "update-required")).toHaveLength(0)
    for (const ligacao of rele.ligacoes) expect(rele.anunciado.get(ligacao)).toContain("commit-after-echo")
  }, 90_000)

  it("update-required só vai para o diagnóstico, e o commit recusado não fica à espera nem se aplica", async () => {
    const ana = await conta("ana")
    const bento = await conta("bento")
    await ana.session.createSpaceChannel(CANAL)
    // A server that refuses for some other reason: here, we pretend that
    // Ana's connection announced nothing.
    for (const ligacao of rele.ligacoes) if (ligacao.address === ana.address) rele.anunciado.set(ligacao, [])

    const inicio = Date.now()
    await expect(ana.session.seat(CANAL, bento.address)).rejects.toThrow()
    expect(Date.now() - inicio).toBeLessThan(Session.CONFIRM_MS)
    expect(epochOf(grupo(ana, CANAL) as GroupSession)).toBe(0n)

    const novos = ana.estados.filter((estado) => estado.code === "update-required" || estado.code === "channel-orphaned" || estado.route === "toast")
    expect(novos.map((estado) => [estado.code, estado.route])).toEqual([["update-required", "log"]])
  }, 60_000)
})

describe("diagnóstico", () => {
  it("uma admissão que falha deixa de ser engolida em silêncio, e não leva o endereço inteiro", async () => {
    const [ana] = (await salaComum("ana")) as [Conta]
    rele.cartoes.delete(SALA)
    const eduardo = await conta("eduardo", new MemoryBackend(), false)
    // No invite keys on the server: whoever tries to admit it fails.
    const original = rele.frame.bind(rele)
    rele.frame = (socket, frame) => {
      if (frame.t === "keypackage.publish" && socket.address === eduardo.address) return
      original(socket, frame)
    }
    void eduardo.session.connect().catch(() => {})

    expect(await ate(() => ana.estados.some((estado) => estado.code === "reseat-failed"), 30_000)).toBe(true)
    const falha = ana.estados.find((estado) => estado.code === "reseat-failed") as SessionEvents["status"]
    expect(falha.route).toBe("log")
    expect(falha.channel).toBe(SALA)
    expect(falha.detail).not.toContain(eduardo.address)
  }, 60_000)
})

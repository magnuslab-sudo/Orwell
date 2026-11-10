import { exportKeyPackage, generateKeyPackages } from "@enclave/crypto"
import { appendHistory, Session, Vault, type VaultBackend } from "@enclave/client-core"
import { moradaDeSala, parseServerName, toBase64 } from "@enclave/protocol"
import { mkdtempSync, rmSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"

/**
 * Sync between two accounts, end to end (audit of 20/10/2026, phase 1).
 *
 * For real: the gateway, the MLS groups, two `Session` with their own vaults. Each
 * test is one of the findings that needed a real server to see: what happens to
 * someone who is disconnected (F5), someone who joins late on a direct (F4), someone
 * who lost their spot (F3), and someone who was expelled (F7).
 *
 * Like in `feed-delivery.test.ts`, the server starts on an ephemeral port and its
 * address carries the port, because it is from it that each `Session` gets the gateway
 * address.
 */

let PORT: number
let enclave: Enclave
let dataDir: string

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

interface Conta {
  session: Session
  vault: Vault
  address: string
  avisos: string[]
}

const abertas: Session[] = []

function seguir(session: Session, avisos: string[]): void {
  session.on("status", (evento) => {
    if (evento.code) avisos.push(evento.code)
  })
}

async function conta(nome: string): Promise<Conta> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe-de-teste")
  const session = new Session(vault)
  abertas.push(session)
  const identidade = await session.createIdentity(`localhost:${PORT}`)
  const avisos: string[] = []
  seguir(session, avisos)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  return { session, vault, address: identidade.address, avisos }
}

async function ate(predicado: () => boolean, rotulo: string, prazoMs = 15_000): Promise<void> {
  const fim = Date.now() + prazoMs
  while (Date.now() < fim) {
    if (predicado()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`esgotou-se o prazo à espera de: ${rotulo}`)
}

function membros(quem: Conta, canal: string): string[] {
  return quem.session.membersOf(canal).map(String)
}

/** Two accounts really friends: request on direct, accepted, and each one in the other's feed. */
async function amigas(ana: Conta, bruno: Conta): Promise<string> {
  const dm = await ana.session.openDirect(bruno.address)
  await ate(() => bruno.session.channels.includes(dm), "o Bruno entra na directa")
  await ana.session.sendFriendRequest(dm)
  await ate(() => bruno.session.friendTies().get(ana.address)?.link === "pedido-recebido", "o pedido chega ao Bruno")
  await bruno.session.acceptFriend(dm, ana.address)
  await ate(() => ana.session.friendTies().get(bruno.address)?.link === "amigos", "a Ana vê a amizade feita")
  await ate(() => ana.session.channels.includes(bruno.session.feedChannel), "a Ana entra no feed do Bruno")
  await ate(() => bruno.session.channels.includes(ana.session.feedChannel), "o Bruno entra no feed da Ana")
  return dm
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-sincronia-"))
  const config: ServerConfig = {
    serverName: parseServerName("localhost"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    dataDir,
    databasePath: join(dataDir, "test.sqlite"),
    sfuPort: 0,
    sfuAnnouncedIp: "",
    retentionDays: 30,
    allowlist: [],
    turnUrls: [],
    turnSecret: "",
    turnTtl: 600,
    communityMode: false,
    commonRoom: "",
  }
  enclave = await buildServer(config)
  await enclave.app.listen({ host: config.bindHost, port: 0 })
  PORT = (enclave.app.server.address() as { port: number }).port
  config.serverName = parseServerName(`localhost:${PORT}`)
}, 30_000)

afterEach(() => {
  for (const session of abertas.splice(0)) session.disconnect()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe("sincronia entre contas", () => {
  /**
   * F5. Undo with the other disconnected: whoever undid leaves the other's feed.
   *
   * `friend.remove` only cuts live. With Bruno disconnected, he would read it on
   * recovery, which does not react to friendship events, and Ana would keep reading
   * the feed of someone who was no longer her friend.
   */
  it("F5: a Ana desfaz com o Bruno desligado, e quando ele volta a folha dela sai do feed dele", async () => {
    const ana = await conta("Ana")
    const bruno = await conta("Bruno")
    await amigas(ana, bruno)
    const feedBruno = bruno.session.feedChannel
    expect(membros(bruno, feedBruno)).toContain(ana.address)

    bruno.session.disconnect()
    await ana.session.unfriend(bruno.address)
    // On her end, already gone: she requested to leave and the server confirmed.
    expect(ana.session.channels, `avisos da Ana: ${ana.avisos.join(",")}`).not.toContain(feedBruno)

    await bruno.session.connect()
    await ate(() => !membros(bruno, feedBruno).includes(ana.address), "a folha da Ana sai do feed do Bruno", 20_000)
  }, 60_000)

  /**
   * F4. Someone joining a direct chat late reads the friendship state.
   *
   * Via the main path (M6 of the revision): Bruno accepts for real, with Ana
   * disconnected, and the acceptance is recorded in both places with the server's `seq`.
   * Then it gets lost on the way to Ana (deleted from the server's database before
   * she returns), which is how an acceptance that left never arrives. The direct is
   * remade for Bruno, and from then on each side repeats the last action that
   * counts, with the ORIGINAL payload (I5): Ana sends the request, and Bruno sends the acceptance.
   */
  it("F4: o aceite perdido volta quando o Bruno é re-sentado, e as duas dobras dão «amigos»", async () => {
    const ana = await conta("Ana")
    const bruno = await conta("Bruno")
    const dm = await ana.session.openDirect(bruno.address)
    await ate(() => bruno.session.channels.includes(dm), "o Bruno entra na directa")
    await ana.session.sendFriendRequest(dm)
    await ate(() => bruno.session.friendTies().get(ana.address)?.link === "pedido-recebido", "o pedido chega ao Bruno")

    ana.session.disconnect()
    await bruno.session.acceptFriend(dm, ana.address)
    const aceite = bruno.session.history(dm).find((entrada) => entrada.payload.t === "friend.accept")
    expect(aceite?.seq).toBeGreaterThanOrEqual(0)
    const carimbo = aceite?.payload["acceptedAt"]
    // Lost in transit: the server no longer has it.
    const base = new DatabaseSync(join(dataDir, "test.sqlite"))
    base.prepare("DELETE FROM events WHERE channel = ? AND seq = ?").run(dm, aceite?.seq ?? -1)
    base.close()

    await ana.session.connect()
    await ate(() => ana.session.channels.includes(bruno.session.feedChannel), "a Ana entra no feed do Bruno")
    expect(ana.session.friendTies().get(bruno.address)?.link).toBe("pedido-enviado")

    // Bruno requests a new position in the direct; Ana re-sends it to him.
    bruno.session.requestRejoin(dm)

    await ate(() => ana.session.friendTies().get(bruno.address)?.link === "amigos", "a Ana lê o aceite", 20_000)
    expect(bruno.session.friendTies().get(ana.address)?.link).toBe("amigos")
    await ate(() => membros(ana, ana.session.feedChannel).includes(bruno.address), "o Bruno no feed da Ana", 20_000)
    expect(membros(bruno, bruno.session.feedChannel)).toContain(ana.address)
    // And all acceptances that reached Ana are the SAME action: the original timestamp.
    const aceitesNaAna = ana.session.history(dm).filter((entrada) => entrada.payload.t === "friend.accept" && entrada.sender === bruno.address)
    expect(aceitesNaAna.length).toBeGreaterThan(0)
    expect(aceitesNaAna.every((entrada) => entrada.payload["acceptedAt"] === carimbo)).toBe(true)
  }, 60_000)

  /**
   * F3. Someone who lost their position requests another, and the other person grants it.
   *
   * Bruno returns with a vault missing the private keys from the key package that Ana
   * used to add him to the direct: the Welcome won't open, and it stays marked dead. On
   * Ana's side he is in the tree, so her repair doesn't touch him. This was where
   * everything stopped, with a message saying the other person would invite again.
   */
  it("F3: com um Welcome morto para a directa e a Ana ligada, o Bruno lê a directa em menos de dois turnos", async () => {
    const ana = await conta("Ana")
    const bruno = await conta("Bruno")
    bruno.session.disconnect()
    const dm = await ana.session.openDirect(bruno.address)

    // The previous private keys are lost; five remain that the server doesn't have.
    const novas = await generateKeyPackages(bruno.session.identity, 5)
    await bruno.vault.update((contents) => {
      contents.pendingKeyPackages = novas.map(exportKeyPackage).map((guardado) => ({
        wire: toBase64(guardado.wire),
        initPrivateKey: toBase64(guardado.initPrivateKey),
        hpkePrivateKey: toBase64(guardado.hpkePrivateKey),
        signaturePrivateKey: toBase64(guardado.signaturePrivateKey),
      }))
    })
    const outra = new Session(bruno.vault)
    abertas.push(outra)
    outra.loadIdentity()
    const avisos: string[] = []
    seguir(outra, avisos)
    const lidas: string[] = []
    outra.on("message", (evento) => {
      if (evento.channel === dm && evento.payload.t === "message") lidas.push(evento.payload.body)
    })
    const inicio = Date.now()
    await outra.connect()

    await ate(() => avisos.includes("welcome-dead"), "o Welcome morre")
    await ate(() => outra.channels.includes(dm), "o Bruno entra na directa com um lugar novo", 2 * 3_000 + 6_000)
    expect(Date.now() - inicio).toBeLessThan(2 * 3_000 + 6_000)

    await ana.session.send(dm, { t: "message", id: crypto.randomUUID(), body: "estás aí?", sentAt: Date.now(), attachments: [] } as never)
    await ate(() => lidas.includes("estás aí?"), "o Bruno lê a directa")
    // And the vault stops having a position to request.
    expect(bruno.vault.contents.lugaresPorPedir?.[dm]).toBeUndefined()
  }, 60_000)

  /**
   * F7. Someone who is removed leaves the channel and stops requesting to return.
   *
   * ts-mls says our leaf left (`removedFromGroup`) and nobody was reading it: the
   * channel stayed in the list, deaf, and the deafness ended in a request to rejoin
   * the person who had just removed him.
   */
  it("F7: a Ana expulsa o Bruno; o cliente dele larga o canal e não pede reentrada", async () => {
    const graca = Session.SAIDA_GRACA_MS
    Session.SAIDA_GRACA_MS = 500
    try {
      const ana = await conta("Ana")
      const bruno = await conta("Bruno")
      const canal = moradaDeSala(parseServerName(`localhost:${PORT}`))
      await ana.session.createSpaceChannel(canal)
      await ate(() => ana.session.founderOf(canal) === ana.address, "a Ana funda o canal")
      await ana.session.seat(canal, bruno.address)
      await ate(() => bruno.session.channels.includes(canal), "o Bruno entra no canal")
      const pedidos = vi.spyOn(bruno.session, "requestRejoin")

      await ana.session.expel(canal, bruno.address)
      await ate(() => !bruno.session.channels.includes(canal), "o Bruno larga o canal", 10_000)
      expect(bruno.avisos).toContain("channel-removed")
      expect(bruno.vault.contents.groups[canal]).toBeUndefined()
      // Left but archived: the history remains (C1).
      expect(bruno.vault.contents.canaisArquivados?.[canal]).toBeDefined()

      // Ana keeps talking in the channel; none of it reaches Bruno nor makes him request.
      for (let i = 0; i < 6; i++) {
        await ana.session.send(canal, { t: "message", id: crypto.randomUUID(), body: `depois ${i}`, sentAt: Date.now(), attachments: [] } as never)
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      expect(pedidos.mock.calls.map(([qual]) => qual)).not.toContain(canal)
      expect(bruno.session.channels).not.toContain(canal)
    } finally {
      Session.SAIDA_GRACA_MS = graca
    }
  }, 60_000)

  /** Ana's channel with Bruno in it and a message he read. */
  async function canalComHistoria(ana: Conta, bruno: Conta): Promise<string> {
    const canal = moradaDeSala(parseServerName(`localhost:${PORT}`))
    await ana.session.createSpaceChannel(canal)
    await ate(() => ana.session.founderOf(canal) === ana.address, "a Ana funda o canal")
    await ana.session.seat(canal, bruno.address)
    await ate(() => bruno.session.channels.includes(canal), "o Bruno entra no canal")
    await ate(() => membros(ana, canal).includes(bruno.address), "a Ana vê o Bruno")
    await ana.session.send(canal, { t: "message", id: crypto.randomUUID(), body: "para guardar", sentAt: Date.now(), attachments: [] } as never)
    await ate(() => bruno.session.history(canal).some((entrada) => entrada.payload["body"] === "para guardar"), "o Bruno guarda a mensagem")
    return canal
  }

  const guardada = (quem: Conta, canal: string): boolean =>
    (quem.vault.contents.history[canal] ?? []).some((entrada) => entrada.payload["body"] === "para guardar")

  /**
   * C1 of the revision. Being removed from a group doesn't erase the history: a
   * reseat removes ALL leaves from an account, and a device without packages had no
   * position and, after the grace period, nothing it had already received. Inside the
   * grace period and outside it, what was read stays.
   */
  it("C1: reassentado dentro da graça, o Bruno guarda o histórico", async () => {
    const graca = Session.SAIDA_GRACA_MS
    Session.SAIDA_GRACA_MS = 5_000
    try {
      const ana = await conta("Ana")
      const bruno = await conta("Bruno")
      const canal = await canalComHistoria(ana, bruno)
      const epocas = bruno.session.groupFor(canal)?.state.groupContext.epoch ?? 0n
      bruno.session.requestRejoin(canal)
      await ate(() => (bruno.session.groupFor(canal)?.state.groupContext.epoch ?? 0n) > epocas + 1n, "o Bruno é reassentado", 15_000)
      expect(bruno.session.groupFor(canal)?.state.groupActiveState.kind).toBe("active")
      await new Promise((resolve) => setTimeout(resolve, Session.SAIDA_GRACA_MS + 500))
      expect(bruno.session.channels).toContain(canal)
      expect(guardada(bruno, canal)).toBe(true)
    } finally {
      Session.SAIDA_GRACA_MS = graca
    }
  }, 60_000)

  it("C1: tirado e só reposto depois da graça, o Bruno guarda o histórico", async () => {
    const graca = Session.SAIDA_GRACA_MS
    Session.SAIDA_GRACA_MS = 500
    try {
      const ana = await conta("Ana")
      const bruno = await conta("Bruno")
      const canal = await canalComHistoria(ana, bruno)
      await ana.session.expel(canal, bruno.address)
      await ate(() => !bruno.session.channels.includes(canal), "o Bruno larga o canal")
      expect(guardada(bruno, canal)).toBe(true)

      await ana.session.seat(canal, bruno.address)
      await ate(() => bruno.session.channels.includes(canal), "o Bruno volta ao canal")
      expect(guardada(bruno, canal)).toBe(true)
      expect(bruno.vault.contents.canaisArquivados?.[canal]).toBeUndefined()
    } finally {
      Session.SAIDA_GRACA_MS = graca
    }
  }, 60_000)

  /**
   * I2 of the revision. Grace is counted with a connection: someone who drops in the
   * middle of it doesn't lose the channel when they return, and has the full grace
   * period for a reseat's Welcome to arrive.
   */
  it("I2: a graça recomeça ao religar", async () => {
    const graca = Session.SAIDA_GRACA_MS
    Session.SAIDA_GRACA_MS = 2_000
    try {
      const ana = await conta("Ana")
      const bruno = await conta("Bruno")
      const canal = await canalComHistoria(ana, bruno)
      await ana.session.expel(canal, bruno.address)
      await ate(() => bruno.session.groupFor(canal)?.state.groupActiveState.kind === "removedFromGroup", "o Bruno vê-se tirado")
      bruno.session.disconnect()
      await new Promise((resolve) => setTimeout(resolve, 1_200))
      await bruno.session.connect()
      // Grace passed since removal, but not since the connection: the channel is still here.
      await new Promise((resolve) => setTimeout(resolve, 1_200))
      expect(bruno.session.channels).toContain(canal)
      await ate(() => !bruno.session.channels.includes(canal), "o Bruno larga o canal no fim da graça nova", 10_000)
      expect(guardada(bruno, canal)).toBe(true)
    } finally {
      Session.SAIDA_GRACA_MS = graca
    }
  }, 60_000)
})

import {
  fromBase64,
  generateIdentity,
  moradaDeSala,
  parseServerName,
  sign,
  toBase64,
  type ClientFrame,
  type ServerFrame,
} from "@enclave/protocol"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocket } from "ws"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createChannel, publishableGroupInfo } from "@enclave/crypto"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"

/**
 * The common room, server side.
 *
 * The project owner decided on exactly one opening: any account on this
 * server can REQUEST to be admitted to the common room. This file exists
 * to pin down the gap between that and "any account can do everything in that
 * room", which is what the first version of the opening granted, because request and
 * read and write all went through the same gate.
 */

/**
 * Ephemeral port, not a hand-picked number.
 *
 * This file has been through 8452 and 8453 dodging collisions: a verification
 * server sleeping on the port made it crash with EADDRINUSE, chained `npm test`
 * stopped there, and the next suites (812 interface tests) never ran,
 * with the report reading as "server problem". Picking another number just changes
 * who collides with whom; `port: 0` ends the whole class.
 *
 * The server name carries the assigned port, so it is decided after
 * `listen`, just like the common room, which is an identifier built from it.
 * The `ServerConfig` is read on demand, never at startup.
 */
let HOME: ReturnType<typeof parseServerName>
let COMMON: string

let enclave: Enclave
let dataDir: string
let gatewayUrl: string
/** The room's creator. One per server, as in reality. */
let fundador: TestClient

class TestClient {
  #socket: WebSocket
  #queue: ServerFrame[] = []
  #waiters: ((frame: ServerFrame) => void)[] = []

  private constructor(socket: WebSocket) {
    this.#socket = socket
    socket.on("message", (raw: Buffer) => {
      const frame = JSON.parse(raw.toString("utf8")) as ServerFrame
      const waiter = this.#waiters.shift()
      if (waiter) waiter(frame)
      else this.#queue.push(frame)
    })
  }

  static async connect(url: string): Promise<TestClient> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve())
      socket.once("error", reject)
    })
    return new TestClient(socket)
  }

  send(frame: ClientFrame): void {
    this.#socket.send(JSON.stringify(frame))
  }

  next(): Promise<ServerFrame> {
    const queued = this.#queue.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve) => {
      const waiter = (frame: ServerFrame): void => resolve(frame)
      this.#waiters.push(waiter)
      setTimeout(() => {
        // Remove the waiter from the queue when giving up on it. Left there, the first
        // REAL frame that arrives next is delivered to a promise that already resolved,
        // in other words it vanishes. You only notice in a client reused across
        // tests, and you notice hard: each "got nothing" leaves a trap for the next test.
        const index = this.#waiters.indexOf(waiter)
        if (index >= 0) this.#waiters.splice(index, 1)
        resolve({ t: "error", code: "timeout", message: "no frame", fatal: false })
      }, 2500)
    })
  }

  async nextOf<K extends ServerFrame["t"]>(kind: K): Promise<Extract<ServerFrame, { t: K }>> {
    for (let i = 0; i < 10; i++) {
      const frame = await this.next()
      if (frame.t === kind) return frame as Extract<ServerFrame, { t: K }>
      if (frame.t === "error" && frame.code === "timeout") break
    }
    throw new Error(`never received a ${kind} frame`)
  }

  async sync(): Promise<void> {
    this.send({ t: "ping" })
    await this.nextOf("pong")
  }

  /**
   * Everything this client received, up to the `pong` of a `ping` we sent now.
   *
   * It is the way to prove something did NOT arrive without waiting for it.
   * Before, each "a stranger cannot X" sent the request and did
   * `expect(await next()).not.toBe(...)`, which waited the 2.5 s timeout of
   * `next()` and then accepted the `{ t: "error", code: "timeout" }` it
   * fabricates. Five tests like that are twelve and a half seconds of pure waiting.
   *
   * And worse than slow, they were blind: a timeout is what you get from
   * a server that refused the request, but it is ALSO what you get from a
   * dead server, a closed socket and a test that got the channel wrong.
   * All of them passed.
   *
   * The `pong` fixes both at once. The server processes in order:
   * if what you feared had been delivered, it would come before the pong. The
   * pong arriving proves the server is ALIVE and has already reached this point
   * in the queue: absence becomes a measured absence, not giving up.
   */
  async ateAoPong(): Promise<ServerFrame[]> {
    this.send({ t: "ping" })
    const recebidos: ServerFrame[] = []
    for (let i = 0; i < 20; i++) {
      const frame = await this.next()
      if (frame.t === "pong") return recebidos
      if (frame.t === "error" && frame.code === "timeout") {
        throw new Error(
          "o servidor não respondeu ao ping: sem prova de vida, ausência de frames não prova nada",
        )
      }
      recebidos.push(frame)
    }
    throw new Error("frames a mais antes do pong")
  }

  close(): void {
    this.#socket.close()
  }
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-comum-"))
  const config: ServerConfig = {
    // Name and startup room, replaced as soon as the assigned port is known.
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
  const port = (enclave.app.server.address() as { port: number }).port
  HOME = parseServerName(`localhost:${port}`)
  COMMON = `!orwell:${HOME}`
  config.serverName = HOME
  config.commonRoom = COMMON
  gatewayUrl = `ws://127.0.0.1:${port}/_enclave/gateway`
  fundador = await fundarSalaComum()
})

afterAll(async () => {
  fundador?.close()
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

/**
 * @param identity the account to use. Defaults to a new one; pass the same
 *   account across connections to prove what an account carries forward, which
 *   is where everything the server writes to disk lives.
 */
async function login(client: TestClient, identity = generateIdentity(HOME)): Promise<string> {
  // A current client: without `commit-after-echo` the server discarded the cards
  // before the guards tested here had a chance to say anything.
  client.send({ t: "hello", version: 1, capabilities: ["commit-after-echo"] })
  await client.nextOf("hello.ok")
  client.send({ t: "auth.begin", address: identity.address, signingKey: toBase64(identity.signingPublicKey) })
  const challenge = await client.next()
  if (challenge.t !== "auth.challenge") throw new Error("no challenge")
  client.send({ t: "auth.finish", signature: toBase64(sign(identity, fromBase64(challenge.nonce))) })
  const ok = await client.next()
  if (ok.t !== "auth.ok") throw new Error("login refused")
  // The `keypackage.low` that follows authentication sits in the queue and is the
  // first frame any `next()` would return. Without consuming it here, all
  // assertions "did not receive X" would pass by finding it first, meaning they
  // would always pass, even with the bug in place.
  await client.sync()
  return identity.address
}

/** Any account, with no relation to the common room. */
async function stranger(): Promise<TestClient> {
  const client = await TestClient.connect(gatewayUrl)
  await login(client)
  return client
}

/**
 * The one who created the common room: arrived first, subscribed to it while it
 * did not yet exist, and spoke inside. Speaking matters: the tolerance that
 * lets any account touch an unused channel is what would mask everything tested
 * next.
 */
async function fundarSalaComum(): Promise<TestClient> {
  const client = await TestClient.connect(gatewayUrl)
  await login(client)
  client.send({ t: "channel.subscribe", channels: [COMMON] })
  client.send({
    t: "channel.send",
    channel: COMMON,
    kind: "application",
    ciphertext: toBase64(new TextEncoder().encode("uma mensagem qualquer")),
  })
  await client.nextOf("channel.event")
  return client
}

/**
 * Someone admitted to the common room through the real path: a member produces
 * the directed Welcome, which is the only proof of seat this server can
 * recognize without reading the MLS tree.
 */
async function admitido(): Promise<TestClient> {
  const client = await TestClient.connect(gatewayUrl)
  const address = await login(client)
  fundador.send({
    t: "channel.send",
    channel: COMMON,
    kind: "welcome",
    ciphertext: toBase64(new TextEncoder().encode("welcome")),
    recipient: address,
  })
  await fundador.sync()
  client.send({ t: "channel.subscribe", channels: [COMMON] })
  await client.sync()
  return client
}

describe("sala comum: o que a abertura NÃO abriu", () => {
  it("um estranho não pode escrever na sala comum", async () => {
    const member = fundador
    const outsider = await stranger()

    outsider.send({
      t: "channel.send",
      channel: COMMON,
      kind: "application",
      ciphertext: toBase64(new TextEncoder().encode("lixo")),
    })
    await outsider.sync()

    // Five of these over thirty seconds are enough for each member to declare
    // itself deaf (DEAF_FAILURES), request a new seat, and the entire channel to
    // enter a cascade of reseats that wipes history under forward secrecy.
    // Registering an account on this server takes one second.
    expect(await member.ateAoPong()).toEqual([])

    outsider.close()
  }, 20_000)

  it("um estranho não pode ler o histórico cifrado da sala comum", async () => {
    const outsider = await stranger()

    outsider.send({ t: "channel.backfill", channel: COMMON, afterSeq: -1, limit: 100 })
    const respostas = await outsider.ateAoPong()
    expect(respostas.map((f) => f.t)).not.toContain("channel.backfill.page")

    outsider.close()
  }, 20_000)

  it("um estranho não pode listar os convites da sala comum", async () => {
    const member = fundador
    member.send({ t: "invite.create", channel: COMMON, codeHash: "convite-da-sala-comum", expiresAt: null, maxUses: null })
    await member.nextOf("invite.created")

    const outsider = await stranger()
    outsider.send({ t: "invite.list", channel: COMMON })
    const respostas = await outsider.ateAoPong()
    // The server redeems an invite by its HASH, and the hash is what this list
    // returns: whoever gets it enters by an invite never given to them.
    expect(respostas.map((f) => f.t)).not.toContain("invite.list.result")

    outsider.close()
  }, 20_000)

  it("um estranho subscrito à sala comum não fica a ver quem se liga ao servidor", async () => {
    const outsider = await stranger()
    outsider.send({ t: "channel.subscribe", channels: [COMMON] })
    await outsider.sync()

    // Everyone on the server is in this room. If subscribing to it were enough to
    // receive presence, any throwaway account would start to see, live, who is
    // connected, which is precisely the list that `directory.list` refuses to give.
    const recemChegado = await admitido()

    // `ateAoPong()` and never `sync()`: `sync` skips frames up to the pong and
    // would swallow exactly the `presence` we're looking for here. This one keeps
    // them.
    expect((await outsider.ateAoPong()).map((f) => f.t)).not.toContain("presence")

    recemChegado.close()
    outsider.close()
  }, 20_000)

  it("um estranho continua a poder PEDIR entrada, e o pedido chega aos membros", async () => {
    const member = fundador
    const outsider = await stranger()

    outsider.send({ t: "channel.subscribe", channels: [COMMON] })
    outsider.send({ t: "channel.rejoin.request", channel: COMMON })
    await outsider.sync()

    const pedido = await member.nextOf("channel.rejoin")
    expect(pedido.channel).toBe(COMMON)

    outsider.close()
  }, 20_000)

  it("noutro canal, o pedido de um estranho continua a morrer no servidor", async () => {
    const outra = moradaDeSala(HOME)
    const member = await TestClient.connect(gatewayUrl)
    await login(member)
    member.send({ t: "channel.subscribe", channels: [outra] })
    member.send({
      t: "channel.send",
      channel: outra,
      kind: "application",
      ciphertext: toBase64(new TextEncoder().encode("conversa privada")),
    })
    await member.nextOf("channel.event")

    const outsider = await stranger()
    outsider.send({ t: "channel.rejoin.request", channel: outra })
    await outsider.sync()

    expect((await member.ateAoPong()).map((f) => f.t)).not.toContain("channel.rejoin")

    outsider.close()
  }, 20_000)
})

describe("sala comum: o caminho inteiro de quem chega", () => {
  it("recebe o Welcome sem estar subscrito, e só depois passa a poder ler e escrever", async () => {
    // The risk of closing the subscription to someone who has no seat yet: if the
    // Welcome depended on it, nobody would ever enter a room again. It does not:
    // a directed frame goes by the recipient's name and ignores subscriptions, which
    // is precisely why you can be invited to a channel you do not yet know.
    const recemChegado = await TestClient.connect(gatewayUrl)
    const address = await login(recemChegado)

    recemChegado.send({ t: "channel.subscribe", channels: [COMMON] })
    recemChegado.send({ t: "channel.rejoin.request", channel: COMMON })
    await recemChegado.sync()

    // Before being admitted: nothing from what is said in the room reaches them.
    fundador.send({
      t: "channel.send",
      channel: COMMON,
      kind: "application",
      ciphertext: toBase64(new TextEncoder().encode("conversa a decorrer")),
    })
    await fundador.sync()
    expect((await recemChegado.ateAoPong()).map((f) => f.t)).not.toContain("channel.event")

    // The member admits them. The Welcome is directed and arrives the same.
    fundador.send({
      t: "channel.send",
      channel: COMMON,
      kind: "welcome",
      ciphertext: toBase64(new TextEncoder().encode("welcome")),
      recipient: address,
    })
    const welcome = await recemChegado.nextOf("channel.event")
    expect(welcome.kind).toBe("welcome")

    // And from then on they are a member in every way: subscribe, read what
    // happened, and write.
    recemChegado.send({ t: "channel.subscribe", channels: [COMMON] })
    recemChegado.send({ t: "channel.backfill", channel: COMMON, afterSeq: -1, limit: 100 })
    const pagina = await recemChegado.nextOf("channel.backfill.page")
    expect(pagina.events.length).toBeGreaterThan(0)

    recemChegado.send({
      t: "channel.send",
      channel: COMMON,
      kind: "application",
      ciphertext: toBase64(new TextEncoder().encode("olá a todos")),
    })
    const eco = await recemChegado.nextOf("channel.event")
    expect(eco.kind).toBe("application")

    recemChegado.close()
  }, 20_000)
})

// Last block of the file on purpose: deletes ALL events from this test server,
// because that is how retention works, by age, not by channel.
describe("a tolerância para canais acabados de criar", () => {
  it("não se estende a uma sala privada a quem a retenção apagou o histórico", async () => {
    // Thirty days of silence and the room has no events. Only with `channelIsEmpty`
    // would it look brand new again, and any account in the world could start
    // writing inside: five frames of garbage are enough for each member to declare
    // itself deaf and the history to be lost to forward secrecy.
    const dormente = moradaDeSala(HOME)
    const member = await TestClient.connect(gatewayUrl)
    await login(member)
    member.send({ t: "channel.subscribe", channels: [dormente] })
    member.send({
      t: "channel.send",
      channel: dormente,
      kind: "application",
      ciphertext: toBase64(new TextEncoder().encode("conversa que vai envelhecer")),
    })
    await member.nextOf("channel.event")

    // Retention running: `expireEvents(0)` is what the server does minute by minute
    // when the operator chooses to keep nothing.
    enclave.store.expireEvents(0)

    const outsider = await stranger()
    outsider.send({
      t: "channel.send",
      channel: dormente,
      kind: "application",
      ciphertext: toBase64(new TextEncoder().encode("lixo")),
    })
    await outsider.sync()

    expect((await member.ateAoPong()).map((f) => f.t)).not.toContain("channel.event")

    outsider.close()
  }, 20_000)
})

/**
 * An admission request now says how many it reached.
 *
 * It was a frame with no answer: it left, and whoever sent it never knew if it
 * reached anyone or no one. Zero members online and two members ignoring the
 * request were exactly the same thing seen from outside, and that indistinction
 * kept the admission failure invisible on August 6 (four accounts, one invite,
 * and no one with a way to know why).
 */
describe("recibo do pedido de entrada", () => {
  it("diz zero quando não há ninguém a ouvir a sala", async () => {
    const sozinho = await stranger()
    sozinho.send({ t: "channel.rejoin.request", channel: moradaDeSala(HOME) })
    const recibo = await sozinho.nextOf("channel.rejoin.sent")
    expect(recibo.t === "channel.rejoin.sent" && recibo.ouviram).toBe(0)
    sozinho.close()
  }, 20_000)

  it("conta os membros que estão a ouvir a sala comum", async () => {
    // Two connections subscribed to the common room, and a third requesting entry.
    const ouvinte = await TestClient.connect(gatewayUrl)
    await login(ouvinte)
    ouvinte.send({ t: "channel.subscribe", channels: [COMMON] })
    await ouvinte.sync()

    const pedinte = await stranger()
    pedinte.send({ t: "channel.rejoin.request", channel: COMMON })
    const recibo = await pedinte.nextOf("channel.rejoin.sent")
    expect(recibo.t === "channel.rejoin.sent" && recibo.ouviram).toBeGreaterThanOrEqual(1)

    ouvinte.close()
    pedinte.close()
  }, 20_000)
})

/**
 * Writing to a channel without a seat there stops being silent.
 *
 * The refusal existed and was right: it is what stops three frames of garbage
 * from making every member declare itself deaf. What was wrong was
 * the silence: whoever wrote kept speaking to empty air with everything looking
 * fine on their side, because the message enters the local history before it
 * leaves.
 *
 * It cost an afternoon: someone took over administration of a channel whose room
 * the server no longer recognized, saw the button disappear, and the record never
 * left the computer. Nobody had a way to know.
 */
describe("recusa de envio", () => {
  it("diz a quem escreve que não tem lugar no canal", async () => {
    // The common room, which the founder already used. A channel NEVER used is
    // reachable on purpose (that is how you create a room), and would not serve
    // here.
    const estranho = await stranger()
    estranho.send({ t: "channel.send", channel: COMMON, kind: "application", ciphertext: "bGl4bw" })
    const resposta = await estranho.nextOf("channel.rejected")
    expect(resposta.t === "channel.rejected" && resposta.reason).toBe("no-seat")
    estranho.close()
  }, 20_000)
})

/**
 * The admission card, from the server side.
 *
 * What this pins down is not the encryption (proven in
 * `group.externo.test.ts`, with two real ends). It is the guard: a card is a
 * key to the door, and a key to the door kept for the wrong channel is the wrong
 * channel open to whoever gets their hands on it.
 */
/**
 * A real card for the common room: a GroupInfo from the group with its
 * identifier, at epoch 0.
 *
 * It used to be any text ("cartão"), and can no longer be: the server now
 * keeps only a card that parses and describes the channel's epoch (see
 * `Store.putGroupInfo`). What these tests pin down is the guard on who can put and
 * take one, and that does not change because the card is real.
 */
async function cartaoDaSala(): Promise<Uint8Array> {
  return publishableGroupInfo(await createChannel(generateIdentity(HOME), COMMON))
}

describe("cartão de entrada da sala comum", () => {
  it("entrega-se uma vez, e a segunda já não há", async () => {
    fundador.send({ t: "channel.groupinfo.put", channel: COMMON, info: toBase64(await cartaoDaSala()) })
    await fundador.sync()

    const primeiro = await stranger()
    primeiro.send({ t: "channel.groupinfo.take", channel: COMMON })
    const entregue = await primeiro.nextOf("channel.groupinfo")
    expect(entregue.info).toBeDefined()

    // Two arriving at the same moment would get the same card, build two commits
    // for the same epoch, and the room accepts only one. The second would end up with
    // a group with the right name and nobody inside.
    const segundo = await stranger()
    segundo.send({ t: "channel.groupinfo.take", channel: COMMON })
    const vazio = await segundo.nextOf("channel.groupinfo")
    expect(vazio.info).toBeUndefined()

    primeiro.close()
    segundo.close()
  })

  it("quem o levanta fica com um lugar temporário, que só deixa sair um commit externo", async () => {
    fundador.send({ t: "channel.groupinfo.put", channel: COMMON, info: toBase64(await cartaoDaSala()) })
    await fundador.sync()

    const novo = await stranger()
    novo.send({ t: "channel.groupinfo.take", channel: COMMON })
    await novo.nextOf("channel.groupinfo")

    /*
      The seat of whoever takes the card is TEMPORARY (INV-01, external audit
      at 1.1.0): it lets through the card's external commit and nothing
      else. A frame that is not an external commit from this channel is refused
      with `no-seat`, like one from someone with no seat at all, and does not
      reach the members.

      The right path (the real external commit, accepted, promoting the seat to
      subscription) is in `admissao-pendente.test.ts`, with a server just for it:
      accepting a commit here would change the epoch of the room that the later
      tests in this file use.
      */
    novo.send({
      t: "channel.send",
      channel: COMMON,
      kind: "handshake",
      ciphertext: toBase64(new TextEncoder().encode("commit externo")),
    })
    const resposta = await novo.nextOf("channel.rejected")
    expect(resposta.reason).toBe("no-seat")
    expect((await fundador.ateAoPong()).map((f) => f.t)).not.toContain("channel.event")
    novo.close()
  })

  it("mas quem o levanta e não entra não fica com lugar na sala para sempre", async () => {
    /*
      Taking the card is not joining. `#entrarComCartao` gives up in silence
      when it runs out of key packages, and gives up when the card no longer
      describes the room; and a card can be requested by any account with a
      frame and nothing else, with no intention to use it.

      The seat granted to whoever takes it was saved to disk, and a line on disk
      is a seat on ALL later connections. What that bought, for one frame:
      writing garbage in everyone's common room (five are enough for each member
      to declare itself deaf and history to go with it under forward secrecy),
      and publishing a card for it, which sends everyone who arrives next to a
      dead epoch.
      */
    const identidade = generateIdentity(HOME)

    fundador.send({ t: "channel.groupinfo.put", channel: COMMON, info: toBase64(await cartaoDaSala()) })
    await fundador.sync()

    const primeira = await TestClient.connect(gatewayUrl)
    await login(primeira, identidade)
    primeira.send({ t: "channel.groupinfo.take", channel: COMMON })
    expect((await primeira.nextOf("channel.groupinfo")).info).toBeDefined()
    // And never builds the commit: that is exactly what happens to someone who runs
    // out of key packages, and what happens to someone who only wanted the card.
    primeira.close()

    const segunda = await TestClient.connect(gatewayUrl)
    await login(segunda, identidade)
    segunda.send({
      t: "channel.send",
      channel: COMMON,
      kind: "application",
      ciphertext: toBase64(new TextEncoder().encode("lixo")),
    })
    const resposta = await segunda.nextOf("channel.rejected")
    expect(resposta.t === "channel.rejected" && resposta.reason).toBe("no-seat")
    // And the refusal is real refusal: the garbage did not reach the members.
    // (Presence arrives, and that is another matter: the connection that took the
    // card announced itself to the room and has not gone quiet yet.)
    expect((await fundador.ateAoPong()).map((f) => f.t)).not.toContain("channel.event")

    segunda.close()
  }, 20_000)

  it("um estranho não pode publicar cartão nenhum", async () => {
    // An old card put back on top of the good one sends everyone who arrives next
    // to a dead epoch: they enter, think they are inside, and they are not.
    const outsider = await stranger()
    // A real card, not garbage: garbage is refused for being unreadable, and this
    // test would pass without the seat guard it exists to prove.
    outsider.send({ t: "channel.groupinfo.put", channel: COMMON, info: toBase64(await cartaoDaSala()) })
    await outsider.sync()

    const seguinte = await stranger()
    seguinte.send({ t: "channel.groupinfo.take", channel: COMMON })
    expect((await seguinte.nextOf("channel.groupinfo")).info).toBeUndefined()

    outsider.close()
    seguinte.close()
  })

  it("e nenhum canal que não seja a sala comum tem cartão, nem sequer para quem lá está", async () => {
    // The guard that separates a public room from a door left open. Someone who
    // enters by card is invited by nobody: in a private channel this would be the
    // key left under the doormat.
    const privado = moradaDeSala(HOME)
    const dono = await TestClient.connect(gatewayUrl)
    await login(dono)
    dono.send({ t: "channel.subscribe", channels: [privado] })
    dono.send({
      t: "channel.send",
      channel: privado,
      kind: "application",
      ciphertext: toBase64(new TextEncoder().encode("olá")),
    })
    await dono.nextOf("channel.event")

    // Real and from the private channel itself, for the same reason: an unreadable
    // card is refused before the guard on the common room has to say anything.
    const cartaoPrivado = await publishableGroupInfo(await createChannel(generateIdentity(HOME), privado))
    dono.send({ t: "channel.groupinfo.put", channel: privado, info: toBase64(cartaoPrivado) })
    await dono.sync()
    // In the database, not just in delivery: `take` has its own guard, and on its own
    // could not tell a refused card from a kept and undelivered one.
    expect(enclave.store.hasGroupInfo(privado)).toBe(false)

    dono.send({ t: "channel.groupinfo.take", channel: privado })
    expect((await dono.nextOf("channel.groupinfo")).info).toBeUndefined()
    dono.close()
  })
})

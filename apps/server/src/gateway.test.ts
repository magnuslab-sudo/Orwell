import {
  fromBase64,
  generateIdentity,
  identityFromPrivateKey,
  moradaDeSala,
  parseServerName,
  sign,
  signDeviceCert,
  signWithDevice,
  toBase64,
  type ClientFrame,
  type ServerFrame,
  CAPACIDADE_APARELHOS,
  CAPACIDADE_BUNDLE,
  CAPACIDADE_EMPARELHAMENTO,
  CAPACIDADE_SFU,
  PROTOCOL_VERSION,
  signDeviceManifest,
} from "@enclave/protocol"
import type { z } from "zod"
import { ed25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocket } from "ws"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"
import { Gateway } from "./gateway.js"
import { conviteComProva, PACOTE_DE_TESTE } from "../testes/convite-com-prova.js"

/**
 * This server's name and the port it listens on, decided at startup.
 *
 * Ephemeral port, not a hardcoded number. Each server suite had its own, 8449
 * here, 8453 in the common room, and the test scripts adopted the same: a
 * forgotten server sleeping on one of those ports would break the entire suite
 * with EADDRINUSE, and because `npm test` runs packages in sequence, what you
 * saw at the end was "server issue" with hundreds of tests that never ran at
 * all. It happened. With `port: 0` the system assigns a free port and the
 * problem class disappears.
 *
 * The server name has to carry the assigned port because that is where the
 * account addresses come from, and the real client connects to what is there.
 * That is why it is assigned AFTER `listen`, the `ServerConfig` is read on
 * request, never at startup, and nothing connects before this point.
 */
let HOME: ReturnType<typeof parseServerName>

let enclave: Enclave
let dataDir: string
let gatewayUrl: string

/**
 * A frame as it comes from the client, BEFORE the server schema: fields with
 * default values (`replace`, `bundle`, …) may be missing, and the server fills
 * them in. `ClientFrame` is the type after the schema.
 */
type FrameDoCliente = z.input<typeof ClientFrame>

/** A tiny client, just enough to exercise the gateway the way the real one does. */
class TestClient {
  /** The address that `login` authenticated with; the invite proof signs it. */
  address = ""
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

  send(frame: FrameDoCliente): void {
    this.#socket.send(JSON.stringify(frame))
  }

  next(): Promise<ServerFrame> {
    const queued = this.#queue.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve) => {
      this.#waiters.push(resolve)
      setTimeout(() => resolve({ t: "error", code: "timeout", message: "no frame", fatal: false }), 4000)
    })
  }

  /** Waits past frames we do not care about, like keypackage.low nudges. */
  async nextOf<K extends ServerFrame["t"]>(kind: K): Promise<Extract<ServerFrame, { t: K }>> {
    for (let i = 0; i < 10; i++) {
      const frame = await this.next()
      if (frame.t === kind) return frame as Extract<ServerFrame, { t: K }>
      if (frame.t === "error" && frame.code === "timeout") break
    }
    throw new Error(`never received a ${kind} frame`)
  }

  /**
   * Round-trip a ping so we know the server has processed everything sent
   * before it. Frames from two different sockets are otherwise unordered, and
   * a test that assumes otherwise fails intermittently for no real reason.
   */
  async sync(): Promise<void> {
    this.send({ t: "ping" })
    await this.nextOf("pong")
  }

  close(): void {
    this.#socket.close()
  }
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-test-"))
  const config: ServerConfig = {
    // A startup name with no port, replaced as soon as we know what it is.
    serverName: parseServerName("localhost"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    dataDir,
    databasePath: join(dataDir, "test.sqlite"),
    // No SFU: these tests are for the gateway, and one media worker per suite
    // means extra subprocesses for nothing. The engine is exercised in
    // `media.test.ts`, and end-to-end frames in `sfu.*` are exercised in
    // `sfu.test.ts`.
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
  config.serverName = HOME
  gatewayUrl = `ws://127.0.0.1:${port}/_enclave/gateway`
})

afterAll(async () => {
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

async function login(client: TestClient, identity: ReturnType<typeof generateIdentity>): Promise<ServerFrame> {
  // A real client. Without `commit-after-echo` the server does not save or
  // deliver the Welcomes for this connection, and the tests for directed invites,
  // which is what we measure here, would have nothing to measure.
  client.send({ t: "hello", version: PROTOCOL_VERSION, capabilities: ["commit-after-echo"] })
  await client.nextOf("hello.ok")
  client.address = identity.address
  client.send({ t: "auth.begin", address: identity.address, signingKey: toBase64(identity.signingPublicKey) })
  const challenge = await client.next()
  if (challenge.t !== "auth.challenge") return challenge

  client.send({ t: "auth.finish", signature: toBase64(sign(identity, fromBase64(challenge.nonce))) })
  return client.next()
}

/**
 * Seat a second account in a channel via the invite path.
 *
 * These tests had both accounts subscribe to the same fresh channel, and that
 * passed only because fresh channel tolerance was not anchored to anyone: any
 * account could sit in any unused channel. With tolerance anchored, the second
 * account has to join the way it does for real, and the server, which does
 * not read the MLS tree, only recognizes two paths: a redeemed invite, or a
 * directed Welcome.
 *
 * Since the fix for INV-01 (external audit at 1.1.0) redemption is just a
 * request: the seat comes from the directed Welcome that the host sends next,
 * the way a member does when admitting someone. That Welcome is an event, so
 * it takes up channel `seq` 0; tests that assert numbering count on it. The
 * `invite.request` that reaches the host is consumed right here.
 */
async function sentarPorConvite(host: TestClient, guest: TestClient, channel: string): Promise<void> {
  // With the code proof, like 1.0 redeems (slice 6a): the hash alone does not work.
  const convite = conviteComProva()
  host.send({ t: "invite.create", channel, ...convite.criar, expiresAt: null, maxUses: 1 })
  await host.nextOf("invite.created")
  guest.send(convite.resgate(guest.address))
  await host.nextOf("invite.request")
  // Redemption is a request, not a seat (INV-01): the seat comes from the
  // directed Welcome from someone already there, which is what a member sends
  // when admitting.
  host.send({ t: "channel.send", channel, kind: "welcome", ciphertext: toBase64(crypto.getRandomValues(new Uint8Array(64))), recipient: guest.address })
  await guest.nextOf("channel.event")
  // The `channel.subscribe` is for the caller to send right after.
  await guest.sync()
}

/**
 * The other path: the directed Welcome from someone already inside.
 *
 * It costs the channel one `seq`, it is an event like any other, and in
 * return it tells nothing to those already there, because a directed frame goes
 * only to its recipient.
 */
async function sentarPorWelcome(
  host: TestClient,
  guest: TestClient,
  channel: string,
  address: string,
): Promise<void> {
  host.send({ t: "channel.send", channel, kind: "welcome", ciphertext: "dmVsY29tZQ", recipient: address })
  await guest.nextOf("channel.event")
  // The `channel.subscribe` is for the caller to send right after.
  await guest.sync()
}

describe("gateway", () => {
  it("completes a challenge-response login with no password anywhere", async () => {
    const client = await TestClient.connect(gatewayUrl)
    const identity = generateIdentity(HOME)

    client.send({ t: "hello", version: PROTOCOL_VERSION })
    const hello = await client.next()
    expect(hello.t).toBe("hello.ok")

    const result = await login(client, identity)
    expect(result.t).toBe("auth.ok")
    if (result.t === "auth.ok") expect(result.address).toBe(identity.address)

    client.close()
  })

  it("refuses an address the presented key does not hash to", async () => {
    const client = await TestClient.connect(gatewayUrl)
    const victim = generateIdentity(HOME)
    const attacker = generateIdentity(HOME)

    // Attacker claims the victim's address while holding only their own key.
    client.send({ t: "auth.begin", address: victim.address, signingKey: toBase64(attacker.signingPublicKey) })
    const response = await client.next()

    expect(response.t).toBe("error")
    if (response.t === "error") expect(response.code).toBe("key-mismatch")

    client.close()
  })

  it("refuses a signature over the wrong nonce", async () => {
    const client = await TestClient.connect(gatewayUrl)
    const identity = generateIdentity(HOME)

    client.send({ t: "auth.begin", address: identity.address, signingKey: toBase64(identity.signingPublicKey) })
    const challenge = await client.next()
    expect(challenge.t).toBe("auth.challenge")

    // A signature over an attacker-chosen value, not the server's nonce.
    client.send({ t: "auth.finish", signature: toBase64(sign(identity, new Uint8Array(32))) })
    const response = await client.next()

    expect(response.t).toBe("error")
    if (response.t === "error") expect(response.code).toBe("bad-signature")

    client.close()
  })

  it("will not act on anything before authentication", async () => {
    const client = await TestClient.connect(gatewayUrl)

    client.send({ t: "channel.subscribe", channels: [moradaDeSala(HOME)] })
    const response = await client.next()

    expect(response.t).toBe("error")
    if (response.t === "error") expect(response.code).toBe("unauthenticated")

    client.close()
  })

  it("fans a ciphertext out to other subscribers without reading it", async () => {
    const alice = await TestClient.connect(gatewayUrl)
    const bob = await TestClient.connect(gatewayUrl)
    const aliceId = generateIdentity(HOME)
    const bobId = generateIdentity(HOME)

    expect((await login(alice, aliceId)).t).toBe("auth.ok")
    expect((await login(bob, bobId)).t).toBe("auth.ok")

    const channel = moradaDeSala(HOME)
    alice.send({ t: "channel.subscribe", channels: [channel] })
    await alice.sync()
    // Bob joins via invite, not by subscribing to the same fresh channel Alice
    // just created, that shortcut was the hole. See `sentarPorConvite`.
    await sentarPorConvite(alice, bob, channel)
    bob.send({ t: "channel.subscribe", channels: [channel] })
    await bob.sync()

    const ciphertext = toBase64(crypto.getRandomValues(new Uint8Array(512)))
    alice.send({ t: "channel.send", channel, kind: "application", ciphertext, ref: "r1" })

    const event = await bob.nextOf("channel.event")
    expect(event.channel).toBe(channel)
    expect(event.ciphertext).toBe(ciphertext)
    // The 0 is the Welcome that seated Bob. See `sentarPorConvite`.
    expect(event.seq).toBe(1)
    // Minute resolution: the stored timestamp must not be a millisecond clock.
    expect(event.receivedAtMinute).toBeLessThan(Date.now() / 1000)

    alice.close()
    bob.close()
  })

  it("carries a post with a real photo in it, instead of severing the connection", async () => {
    /**
     * The regression this exists for: the socket accepted 12 MiB while the
     * gateway dropped anything over 1 MiB — as a *fatal* error, closing the
     * connection. One ordinary photo in a post was enough to hit it. The
     * sender saw their post in their own timeline, because the client records
     * it before the frame leaves; nobody else ever received it, and the only
     * visible symptom was a connection that dropped for no stated reason.
     */
    const alice = await TestClient.connect(gatewayUrl)
    const bob = await TestClient.connect(gatewayUrl)
    const aliceId = generateIdentity(HOME)
    const bobId = generateIdentity(HOME)

    expect((await login(alice, aliceId)).t).toBe("auth.ok")
    expect((await login(bob, bobId)).t).toBe("auth.ok")

    const channel = moradaDeSala(HOME)
    alice.send({ t: "channel.subscribe", channels: [channel] })
    await alice.sync()
    await sentarPorConvite(alice, bob, channel)
    bob.send({ t: "channel.subscribe", channels: [channel] })
    await bob.sync()

    // Two megabytes: past the old ceiling, and well inside one real photo.
    const ciphertext = "A".repeat(2 * 1024 * 1024)
    alice.send({ t: "channel.send", channel, kind: "application", ciphertext, ref: "big" })

    const event = await bob.nextOf("channel.event")
    expect(event.channel).toBe(channel)
    expect(event.ciphertext).toHaveLength(ciphertext.length)

    alice.close()
    bob.close()
  })

  it("delivers an invitation to a channel the recipient is not in yet", async () => {
    const host = await TestClient.connect(gatewayUrl)
    const guest = await TestClient.connect(gatewayUrl)
    const hostId = generateIdentity(HOME)
    const guestId = generateIdentity(HOME)

    expect((await login(host, hostId)).t).toBe("auth.ok")
    expect((await login(guest, guestId)).t).toBe("auth.ok")

    const channel = moradaDeSala(HOME)
    host.send({ t: "channel.subscribe", channels: [channel] })
    // The guest deliberately does NOT subscribe: not being in the channel is
    // the entire situation an invitation exists to resolve. Requiring a prior
    // subscription would make it impossible to ever be invited to anything.
    await host.sync()

    const welcome = toBase64(crypto.getRandomValues(new Uint8Array(256)))
    host.send({
      t: "channel.send",
      channel,
      kind: "welcome",
      ciphertext: welcome,
      recipient: guestId.address,
    })

    const received = await guest.nextOf("channel.event")
    expect(received.kind).toBe("welcome")
    expect(received.ciphertext).toBe(welcome)

    host.close()
    guest.close()
  })

  it("does not leak a directed welcome to other members of the channel", async () => {
    const host = await TestClient.connect(gatewayUrl)
    const guest = await TestClient.connect(gatewayUrl)
    const bystander = await TestClient.connect(gatewayUrl)
    const hostId = generateIdentity(HOME)
    const guestId = generateIdentity(HOME)
    const bystanderId = generateIdentity(HOME)

    expect((await login(host, hostId)).t).toBe("auth.ok")
    expect((await login(guest, guestId)).t).toBe("auth.ok")
    expect((await login(bystander, bystanderId)).t).toBe("auth.ok")

    const channel = moradaDeSala(HOME)
    host.send({ t: "channel.subscribe", channels: [channel] })
    await host.sync()
    // The observer is a MEMBER, and has to be: what this test asserts is that a
    // directed frame does not leak to someone in the channel, not that it does not
    // leak to someone not there.
    await sentarPorConvite(host, bystander, channel)
    bystander.send({ t: "channel.subscribe", channels: [channel] })
    await bystander.sync()

    host.send({
      t: "channel.send",
      channel,
      kind: "welcome",
      ciphertext: toBase64(crypto.getRandomValues(new Uint8Array(128))),
      recipient: guestId.address,
    })
    await guest.nextOf("channel.event")

    // The bystander is subscribed, but this frame was not addressed to them.
    // A later ordinary message proves the socket was live the whole time.
    host.send({ t: "channel.send", channel, kind: "application", ciphertext: toBase64(new Uint8Array(8)) })
    const seen = await bystander.nextOf("channel.event")
    expect(seen.kind).toBe("application")

    host.close()
    guest.close()
    bystander.close()
  })

  it("forwards a redeemed invite to the channel, without being able to admit anyone itself", async () => {
    const host = await TestClient.connect(gatewayUrl)
    const guest = await TestClient.connect(gatewayUrl)
    const hostId = generateIdentity(HOME)
    const guestId = generateIdentity(HOME)
    expect((await login(host, hostId)).t).toBe("auth.ok")
    expect((await login(guest, guestId)).t).toBe("auth.ok")

    const channel = moradaDeSala(HOME)
    host.send({ t: "channel.subscribe", channels: [channel] })

    const convite = conviteComProva()
    host.send({ t: "invite.create", channel, ...convite.criar, expiresAt: null, maxUses: null })
    await host.nextOf("invite.created")

    // A real MLS key package: the server checks the format (INV-02).
    const keyPackage = PACOTE_DE_TESTE
    guest.send(convite.resgate(guest.address, keyPackage))

    // The server relays the request; it holds no group keys and so cannot
    // produce the commit that would actually add anybody.
    const request = await host.nextOf("invite.request")
    expect(request.channel).toBe(channel)
    expect(request.address).toBe(guestId.address)
    expect(request.keyPackage).toBe(keyPackage)

    host.close()
    guest.close()
  })

  it("echoes the code hash back, so a member can tell a genuine invite from a forged one", async () => {
    const host = await TestClient.connect(gatewayUrl)
    const attacker = await TestClient.connect(gatewayUrl)
    const attackerId = generateIdentity(HOME)
    expect((await login(host, generateIdentity(HOME))).t).toBe("auth.ok")
    expect((await login(attacker, attackerId)).t).toBe("auth.ok")

    const channel = moradaDeSala(HOME)
    host.send({ t: "channel.subscribe", channels: [channel] })
    await host.sync()

    // The forger is a MEMBER of the channel, admitted by the host. Has to be: a
    // stranger cannot forge codes for a channel where they have no seat, and they
    // used to, not because the guard failed, but because fresh channel tolerance
    // was not anchored to anyone.
    //
    // And this is the risk that remains, that cryptography does not close: the
    // server does not read the group, so it cannot tell an invite a member issued
    // in good faith from one another member forged for themselves.
    await sentarPorWelcome(host, attacker, channel, attackerId.address)

    const cunhado = conviteComProva()
    const forged = cunhado.criar.codeHash
    attacker.send({ t: "invite.create", channel, ...cunhado.criar, expiresAt: null, maxUses: null })
    await attacker.nextOf("invite.created")
    attacker.send(cunhado.resgate(attacker.address))

    // The request still reaches members — but it carries the hash, which is what
    // lets a member check it against the codes it actually issued and refuse.
    // Without this field the member has only the server's word, which is worth
    // nothing here.
    const request = await host.nextOf("invite.request")
    expect(request.codeHash).toBe(forged)

    host.close()
    attacker.close()
  })

  it("refuses an expired invite", async () => {
    const host = await TestClient.connect(gatewayUrl)
    const guest = await TestClient.connect(gatewayUrl)
    expect((await login(host, generateIdentity(HOME))).t).toBe("auth.ok")
    expect((await login(guest, generateIdentity(HOME))).t).toBe("auth.ok")

    const convite = conviteComProva()
    host.send({
      t: "invite.create",
      channel: moradaDeSala(HOME),
      ...convite.criar,
      expiresAt: Math.floor(Date.now() / 1000) - 1,
      maxUses: null,
    })
    await host.nextOf("invite.created")

    guest.send(convite.resgate(guest.address))
    const rejected = await guest.nextOf("invite.rejected")
    expect(rejected.reason).toBe("expired")

    host.close()
    guest.close()
  })

  it("stops honouring an invite once its uses run out", async () => {
    const host = await TestClient.connect(gatewayUrl)
    const guest = await TestClient.connect(gatewayUrl)
    expect((await login(host, generateIdentity(HOME))).t).toBe("auth.ok")
    expect((await login(guest, generateIdentity(HOME))).t).toBe("auth.ok")

    const channel = moradaDeSala(HOME)
    host.send({ t: "channel.subscribe", channels: [channel] })

    const convite = conviteComProva()
    host.send({ t: "invite.create", channel, ...convite.criar, expiresAt: null, maxUses: 1 })
    await host.nextOf("invite.created")

    guest.send(convite.resgate(guest.address))
    await host.nextOf("invite.request")

    // "Max uses" has to be a limit, not a suggestion, or a forwarded link keeps
    // letting people in long after the sender expected it to stop.
    //
    // Someone else with the same link: the same account repeating a request that
    // already reached members is not forwarded again (INV-02), and never spends or
    // sees the limit.
    const second = await TestClient.connect(gatewayUrl)
    expect((await login(second, generateIdentity(HOME))).t).toBe("auth.ok")
    second.send(convite.resgate(second.address))
    const rejected = await second.nextOf("invite.rejected")
    expect(rejected.reason).toBe("exhausted")

    host.close()
    guest.close()
    second.close()
  })

  it("refuses a revoked invite", async () => {
    const host = await TestClient.connect(gatewayUrl)
    const guest = await TestClient.connect(gatewayUrl)
    expect((await login(host, generateIdentity(HOME))).t).toBe("auth.ok")
    expect((await login(guest, generateIdentity(HOME))).t).toBe("auth.ok")

    const convite = conviteComProva()
    host.send({ t: "invite.create", channel: moradaDeSala(HOME), ...convite.criar, expiresAt: null, maxUses: null })
    await host.nextOf("invite.created")
    host.send({ t: "invite.revoke", codeHash: convite.criar.codeHash })
    await host.sync()

    guest.send(convite.resgate(guest.address))
    const rejected = await guest.nextOf("invite.rejected")
    expect(rejected.reason).toBe("unknown")

    host.close()
    guest.close()
  })

  it("replays what was missed while a member was offline, oldest first", async () => {
    const speaker = await TestClient.connect(gatewayUrl)
    const speakerId = generateIdentity(HOME)
    expect((await login(speaker, speakerId)).t).toBe("auth.ok")

    const channel = moradaDeSala(HOME)
    speaker.send({ t: "channel.subscribe", channels: [channel] })
    await speaker.sync()

    // The absent member has to have been IN the channel, that is what the name
    // of this test says and what makes the catch-up its own. It subscribes, then
    // goes away; the subscription lives on the server, per account, so it is
    // still there when the account reconnects on any device.
    //
    // (This used to be a brand new account that had never subscribed, asking for
    // the history of a channel it had never been in. That passed because the
    // gateway checked nothing at all, which is precisely the hole being closed:
    // feed ids are derived from public addresses, so "knows the id" cannot mean
    // "may read it".)
    //
    // And joins via invite: subscribing to the same fresh channel the speaker
    // just created was the second half of the same hole. The Welcome that seats
    // him is event 0 (see `sentarPorConvite`), directed to him, so it also comes
    // in his page; the three messages are what comes after.
    const memberId = generateIdentity(HOME)
    const first = await TestClient.connect(gatewayUrl)
    expect((await login(first, memberId)).t).toBe("auth.ok")
    await sentarPorConvite(speaker, first, channel)
    first.send({ t: "channel.subscribe", channels: [channel] })
    await first.sync()
    first.close()

    // Three events land while the other member is away. In a real channel one of
    // these would be a membership commit — and missing it strands the absent
    // member on an old epoch, after which nothing decrypts. Ever.
    const sent = ["um", "dois", "tres"].map((word) => toBase64(new TextEncoder().encode(word)))
    for (const ciphertext of sent) {
      speaker.send({ t: "channel.send", channel, kind: "application", ciphertext })
    }
    await speaker.sync()

    const latecomer = await TestClient.connect(gatewayUrl)
    expect((await login(latecomer, memberId)).t).toBe("auth.ok")

    latecomer.send({ t: "channel.backfill", channel, afterSeq: -1, limit: 100 })
    const page = await latecomer.nextOf("channel.backfill.page")

    const mensagens = page.events.filter((event) => event.kind === "application")
    expect(mensagens.map((event) => event.ciphertext)).toEqual(sent)
    // Ascending order is the requirement, not a nicety: commits must be applied
    // in the order they were issued or the group state diverges.
    expect(page.events.map((event) => event.seq)).toEqual([0, 1, 2, 3])
    expect(page.events[0]?.kind).toBe("welcome")
    expect(page.more).toBe(false)

    speaker.close()
    latecomer.close()
  })

  it("pages forward, and says when more remains", async () => {
    const client = await TestClient.connect(gatewayUrl)
    expect((await login(client, generateIdentity(HOME))).t).toBe("auth.ok")

    const channel = moradaDeSala(HOME)
    client.send({ t: "channel.subscribe", channels: [channel] })
    for (let i = 0; i < 5; i++) {
      client.send({ t: "channel.send", channel, kind: "application", ciphertext: toBase64(new Uint8Array([i])) })
    }
    await client.sync()

    client.send({ t: "channel.backfill", channel, afterSeq: -1, limit: 2 })
    const first = await client.nextOf("channel.backfill.page")
    expect(first.events.map((event) => event.seq)).toEqual([0, 1])
    // Without this flag a client stops at the first page and silently stays
    // behind — the exact failure the catch-up path exists to prevent.
    expect(first.more).toBe(true)

    client.send({ t: "channel.backfill", channel, afterSeq: 1, limit: 2 })
    const second = await client.nextOf("channel.backfill.page")
    expect(second.events.map((event) => event.seq)).toEqual([2, 3])

    client.close()
  })

  it("hands out each key package exactly once", async () => {
    const owner = await TestClient.connect(gatewayUrl)
    const ownerId = generateIdentity(HOME)
    expect((await login(owner, ownerId)).t).toBe("auth.ok")

    const first = toBase64(crypto.getRandomValues(new Uint8Array(64)))
    const second = toBase64(crypto.getRandomValues(new Uint8Array(64)))
    owner.send({ t: "keypackage.publish", packages: [first, second] })

    const claimer = await TestClient.connect(gatewayUrl)
    const claimerId = generateIdentity(HOME)
    expect((await login(claimer, claimerId)).t).toBe("auth.ok")

    claimer.send({ t: "keypackage.claim", address: ownerId.address })
    const one = await claimer.nextOf("keypackage.claimed")
    claimer.send({ t: "keypackage.claim", address: ownerId.address })
    const two = await claimer.nextOf("keypackage.claimed")
    claimer.send({ t: "keypackage.claim", address: ownerId.address })
    const three = await claimer.nextOf("keypackage.claimed")

    expect([one.keyPackage, two.keyPackage].sort()).toEqual([first, second].sort())
    // Reusing a key package would silently destroy forward secrecy, so the
    // third claim must come back empty rather than repeat one.
    expect(three.keyPackage).toBeNull()

    owner.close()
    claimer.close()
  })

  it("stores nothing but ciphertext for a delivered message", async () => {
    const client = await TestClient.connect(gatewayUrl)
    const identity = generateIdentity(HOME)
    expect((await login(client, identity)).t).toBe("auth.ok")

    const channel = moradaDeSala(HOME)
    client.send({ t: "channel.subscribe", channels: [channel] })
    client.send({
      t: "channel.send",
      channel,
      kind: "application",
      ciphertext: toBase64(new TextEncoder().encode("pretend-ciphertext")),
    })
    await client.nextOf("channel.event")

    // Read back exactly what an operator with database access would see.
    const rows = enclave.store.backfill(channel, undefined, 10, identity.address)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "channel",
      "ciphertext",
      "kind",
      "receivedAtMinute",
      "recipient",
      "seq",
    ])
    // No author column exists to populate.
    expect(JSON.stringify(row)).not.toContain(identity.address)
    expect(JSON.stringify(row)).not.toContain(identity.accountId)

    client.close()
  })
})

describe("presença", () => {
  it("difunde online/offline só a quem partilha canal, e dá o snapshot ao subscrever", async () => {
    const channel = moradaDeSala(HOME)
    const alice = await TestClient.connect(gatewayUrl)
    const bob = await TestClient.connect(gatewayUrl)
    const stranger = await TestClient.connect(gatewayUrl)

    await login(alice, generateIdentity(HOME))
    const bobIdentity = generateIdentity(HOME)
    await login(bob, bobIdentity)
    const strangerIdentity = generateIdentity(HOME)
    await login(stranger, strangerIdentity)

    alice.send({ t: "channel.subscribe", channels: [channel] })
    await alice.sync()
    // A stranger subscribes to some other channel: should never hear anything.
    stranger.send({ t: "channel.subscribe", channels: [moradaDeSala(HOME)] })
    await stranger.sync()

    // Bob subscribes to the shared channel: Alice is notified he is online, and
    // Bob gets the snapshot with Alice. Seated via invite first, sharing a
    // channel with someone assumes having a seat there, and the shortcut of
    // subscribing to someone else's fresh channel no longer exists.
    await sentarPorConvite(alice, bob, channel)
    bob.send({ t: "channel.subscribe", channels: [channel] })
    const bobSnapshot = await bob.nextOf("presence")
    expect(bobSnapshot.online).toBe(true)
    const aliceSees = await alice.nextOf("presence")
    expect(aliceSees.address).toBe(bobIdentity.address)
    expect(aliceSees.online).toBe(true)

    // Bob disconnects: Alice hears offline; the stranger still hears nothing.
    bob.close()
    const aliceSeesOffline = await alice.nextOf("presence")
    expect(aliceSeesOffline.address).toBe(bobIdentity.address)
    expect(aliceSeesOffline.online).toBe(false)

    stranger.send({ t: "ping" })
    const strangerFrame = await stranger.next()
    expect(strangerFrame.t).toBe("pong") // no presence in between

    alice.close()
    stranger.close()
  }, 15_000)

  it("hello.ok anuncia a capacidade, para o feature-detect do cliente", async () => {
    const client = await TestClient.connect(gatewayUrl)
    client.send({ t: "hello", version: PROTOCOL_VERSION })
    const hello = await client.nextOf("hello.ok")
    expect(hello.capabilities).toContain("presence")
    client.close()
  })
})

/**
 * The `sfu` capability, which is the gate to the entire SFU passage.
 *
 * The order is server first, client after: the server gains the SFU in its own
 * phase, with no client using it, and only then do clients start choosing the
 * engine by this. As long as that gap lasts, and it lasts days, the
 * `hello.ok` has to tell the truth about what exists on this side, because a
 * client that hears the capability STOPS building the mesh.
 *
 * That is why the two tests are symmetric and both necessary. The first is what
 * protects those already here: no engine, no promise. The second is what
 * guarantees the promise comes when the engine exists, instead of staying
 * forgotten in a predicate no one wires.
 */
describe("a capacidade sfu sai do estado do motor de media", () => {
  it("sem motor de media, o hello.ok não promete SFU nenhum", async () => {
    const client = await TestClient.connect(gatewayUrl)
    client.send({ t: "hello", version: PROTOCOL_VERSION })
    const hello = await client.nextOf("hello.ok")

    // There is no engine in this process today, so this is the normal state, not a
    // test configuration. The day Phase 1 brings a worker up, this test still
    // holds: what it requires is that the capability comes from `declararSfu`, and
    // never from a constant written by hand in the list.
    expect(hello.capabilities).not.toContain(CAPACIDADE_SFU)
    // And the rest stays where it was: this is not a list that gets rewritten.
    expect(hello.capabilities).toEqual(expect.arrayContaining(["mls", "presence", "voice-sframe"]))
    client.close()
  })

  it("com motor declarado, anuncia-a — e deixa de a anunciar quando ele cai", async () => {
    try {
      enclave.gateway.declararSfu(() => true)
      const comMotor = await TestClient.connect(gatewayUrl)
      comMotor.send({ t: "hello", version: PROTOCOL_VERSION })
      expect((await comMotor.nextOf("hello.ok")).capabilities).toContain(CAPACIDADE_SFU)
      comMotor.close()

      // The worker dies. The capability is read at each `hello` and not saved at
      // startup, so the next connection already hears the truth, that is what
      // separates a predicate from a boolean read once.
      enclave.gateway.declararSfu(() => false)
      const semMotor = await TestClient.connect(gatewayUrl)
      semMotor.send({ t: "hello", version: PROTOCOL_VERSION })
      expect((await semMotor.nextOf("hello.ok")).capabilities).not.toContain(CAPACIDADE_SFU)
      semMotor.close()
    } finally {
      // The server is shared by this entire file: leaving it lying would poison
      // everything that ran after.
      enclave.gateway.declararSfu(() => false)
    }
  })
})

describe("keypackage.claim responde sempre", () => {
  it("endereço malformado responde claimed:null em vez de silêncio", async () => {
    const client = await TestClient.connect(gatewayUrl)
    await login(client, generateIdentity(HOME))

    client.send({ t: "keypackage.claim", address: "@endereço inválido!!" })
    const reply = await client.nextOf("keypackage.claimed")
    expect(reply.keyPackage).toBeNull()
    client.close()
  }, 15_000)

  it("pool vazio responde claimed:null; claims concorrentes respondem todos por ordem", async () => {
    const client = await TestClient.connect(gatewayUrl)
    await login(client, generateIdentity(HOME))
    const ghost = generateIdentity(HOME)

    // Three claims fired without waiting, the pattern the real client now
    // produces (friendship repair + user invite at once).
    client.send({ t: "keypackage.claim", address: ghost.address })
    client.send({ t: "keypackage.claim", address: ghost.address })
    client.send({ t: "keypackage.claim", address: ghost.address })

    for (let i = 0; i < 3; i++) {
      const reply = await client.nextOf("keypackage.claimed")
      expect(reply.address).toBe(ghost.address)
      expect(reply.keyPackage).toBeNull()
    }
    client.close()
  }, 15_000)
})

describe("welcomes para destinatários offline", () => {
  it("um welcome enviado com o convidado offline é entregue no próximo login dele", async () => {
    const channel = moradaDeSala(HOME)
    const host = await TestClient.connect(gatewayUrl)
    await login(host, generateIdentity(HOME))
    const invitee = generateIdentity(HOME)

    // The host sends the directed welcome while the guest does not even exist as
    // a connection yet. Before the fix, this died here forever.
    host.send({ t: "channel.subscribe", channels: [channel] })
    host.send({
      t: "channel.send",
      channel,
      kind: "welcome",
      ciphertext: "Y2lmcmFkbw",
      recipient: invitee.address,
    })
    await host.sync()

    const late = await TestClient.connect(gatewayUrl)
    const auth = await login(late, invitee)
    expect(auth.t).toBe("auth.ok")

    // The client asks once its vault is restored — pushing at auth time
    // handed welcomes to a client with no keys to open them.
    late.send({ t: "welcome.resync" })
    const delivered = await late.nextOf("channel.event")
    expect(delivered.kind).toBe("welcome")
    expect(delivered.channel).toBe(channel)
    expect(delivered.ciphertext).toBe("Y2lmcmFkbw")

    // And comes back on the next login, the server does not guess consumption;
    // the client ignores welcomes for channels it already has.
    late.close()
    const again = await TestClient.connect(gatewayUrl)
    await login(again, invitee)
    again.send({ t: "welcome.resync" })
    const redelivered = await again.nextOf("channel.event")
    expect(redelivered.channel).toBe(channel)

    host.close()
    again.close()
  }, 20_000)
})

/**
 * Accumulated invites are all delivered, and the reason changed its mind.
 *
 * It used to deliver only the newest, on the grounds that only that one can
 * open: a legitimate re-invite demands a new key package and builds the
 * welcome against it, so the old one is trash. The argument holds between
 * honest invites and fails against a forged one, which does not demand any key
 * package, it does not invalidate the legit one, just buries it by having a
 * higher `seq`. That alone, coming from a channel member, would keep someone
 * out forever, with no signal anywhere.
 *
 * Cost accepted: up to four welcomes that do not open per channel, tried and
 * failed silently by the client on each login. That is far less bad than
 * someone kept out by another person's frame.
 */
describe("welcomes zombie", () => {
  it("re-convites acumulados: entregues todos, para nenhum poder enterrar o legítimo", async () => {
    const channel = moradaDeSala(HOME)
    const host = await TestClient.connect(gatewayUrl)
    await login(host, generateIdentity(HOME))
    const invitee = generateIdentity(HOME)

    host.send({ t: "channel.subscribe", channels: [channel] })
    // Three invites for the same pair, exactly what unthrottled repair produced.
    // Only the latest can open; the others are eternal trash.
    for (const bytes of ["dmVsaG8x", "dmVsaG8y", "bm92bw"]) {
      host.send({ t: "channel.send", channel, kind: "welcome", ciphertext: bytes, recipient: invitee.address })
    }
    await host.sync()

    const late = await TestClient.connect(gatewayUrl)
    await login(late, invitee)
    late.send({ t: "welcome.resync" })

    // All three arrive, newest first. The client tries them in order and opens
    // what works; the others fail silently, as they always have.
    const entregues = [
      (await late.nextOf("channel.event")).ciphertext,
      (await late.nextOf("channel.event")).ciphertext,
      (await late.nextOf("channel.event")).ciphertext,
    ]
    expect(entregues[0]).toBe("bm92bw")
    expect(entregues).toContain("dmVsaG8x")

    // And they end here: the queue does not repeat or invent.
    late.send({ t: "ping" })
    const next = await late.next()
    expect(next.t).toBe("pong")

    host.close()
    late.close()
  }, 20_000)
})

describe("invisibilidade", () => {
  it("um invisível não é anunciado, e o seu regresso à visibilidade é", async () => {
    const channel = moradaDeSala(HOME)
    const watcher = await TestClient.connect(gatewayUrl)
    await login(watcher, generateIdentity(HOME))
    watcher.send({ t: "channel.subscribe", channels: [channel] })
    await watcher.sync()

    const ghost = await TestClient.connect(gatewayUrl)
    const ghostIdentity = generateIdentity(HOME)
    await login(ghost, ghostIdentity)
    // Invisible BEFORE everything else: that is how the client avoids flicker, and
    // here it also stops the seat itself from announcing a departure to the
    // observer, with no shared channels there is no one to tell.
    ghost.send({ t: "presence.set", visible: false })
    await ghost.sync()
    await sentarPorConvite(watcher, ghost, channel)
    ghost.send({ t: "channel.subscribe", channels: [channel] })
    await ghost.sync()

    // The observer could not have heard anything about the phantom.
    watcher.send({ t: "ping" })
    const quiet = await watcher.next()
    expect(quiet.t).toBe("pong")

    // Going visible again announces it.
    ghost.send({ t: "presence.set", visible: true })
    const announced = await watcher.nextOf("presence")
    expect(announced.address).toBe(ghostIdentity.address)
    expect(announced.online).toBe(true)

    // And going invisible again reads as a departure.
    ghost.send({ t: "presence.set", visible: false })
    const vanished = await watcher.nextOf("presence")
    expect(vanished.address).toBe(ghostIdentity.address)
    expect(vanished.online).toBe(false)

    watcher.close()
    ghost.close()
  }, 20_000)

  it("uma ligação que sai deixa a conta offline se a que fica for invisível", async () => {
    // Two connections from the same account, two tabs, or one half-open connection
    // that the server hasn't noticed yet. The exit is only announced when no
    // connection from that account remains, and this counted invisible ones too:
    // someone who went invisible on one and closed the other stayed green forever
    // to channel members. A presence point that lies is worse than having no point
    // at all.
    const channel = moradaDeSala(HOME)
    const identity = generateIdentity(HOME)

    const watcher = await TestClient.connect(gatewayUrl)
    await login(watcher, generateIdentity(HOME))
    watcher.send({ t: "channel.subscribe", channels: [channel] })
    await watcher.sync()

    const visivel = await TestClient.connect(gatewayUrl)
    await login(visivel, identity)
    await sentarPorConvite(watcher, visivel, channel)
    visivel.send({ t: "channel.subscribe", channels: [channel] })
    const chegou = await watcher.nextOf("presence")
    expect(chegou.online).toBe(true)

    const escondida = await TestClient.connect(gatewayUrl)
    await login(escondida, identity)
    escondida.send({ t: "presence.set", visible: false })
    escondida.send({ t: "channel.subscribe", channels: [channel] })
    await escondida.sync()

    visivel.close()
    const saiu = await watcher.nextOf("presence")
    expect(saiu.address).toBe(identity.address)
    expect(saiu.online).toBe(false)

    watcher.close()
    escondida.close()
  }, 20_000)

  it("quem chega depois não vê o invisível no snapshot", async () => {
    const channel = moradaDeSala(HOME)
    const ghost = await TestClient.connect(gatewayUrl)
    const ghostIdentity = generateIdentity(HOME)
    await login(ghost, ghostIdentity)
    ghost.send({ t: "presence.set", visible: false })
    ghost.send({ t: "channel.subscribe", channels: [channel] })
    await ghost.sync()

    const late = await TestClient.connect(gatewayUrl)
    await login(late, generateIdentity(HOME))
    late.send({ t: "channel.subscribe", channels: [channel] })
    // nextOf skips keypackage.low pushes; what matters is that no presence frame
    // appears before the pong.
    const frames: string[] = []
    late.send({ t: "ping" })
    for (let i = 0; i < 6; i++) {
      const frame = await late.next()
      frames.push(frame.t)
      if (frame.t === "pong") break
    }
    expect(frames).not.toContain("presence")

    ghost.close()
    late.close()
  }, 20_000)
})

/**
 * Authorisation.
 *
 * Registration here is open and instant, and a feed id is derived from a public
 * account address, so before these checks existed "an authenticated account" was
 * the same thing as "anybody at all": any account could read, write to, or
 * administer any channel it could name.
 *
 * Each of these fails if the corresponding guard in the gateway is removed. That
 * is the point — the defences they cover used to be absent, and the whole suite
 * stayed green.
 */
describe("gateway authorisation", () => {
  // Drawn in `beforeAll`: `HOME` is only known after `listen`.
  let channel: string
  beforeAll(() => {
    channel = moradaDeSala(HOME)
  })

  async function seatedMember(): Promise<TestClient> {
    const client = await TestClient.connect(gatewayUrl)
    expect((await login(client, generateIdentity(HOME))).t).toBe("auth.ok")
    client.send({ t: "channel.subscribe", channels: [channel] })
    await client.sync()
    return client
  }

  async function stranger(): Promise<TestClient> {
    const client = await TestClient.connect(gatewayUrl)
    expect((await login(client, generateIdentity(HOME))).t).toBe("auth.ok")
    return client
  }

  it("a stranger cannot read a channel's history", async () => {
    const member = await seatedMember()
    member.send({
      t: "channel.send",
      channel,
      kind: "application",
      ciphertext: toBase64(new TextEncoder().encode("segredo")),
    })
    await member.sync()

    const outsider = await stranger()
    outsider.send({ t: "channel.backfill", channel, afterSeq: -1, limit: 100 })
    // No page comes back at all; `next` gives up after its timeout.
    const answer = await outsider.next()
    expect(answer.t).not.toBe("channel.backfill.page")

    member.close()
    outsider.close()
  }, 20_000)

  it("a stranger cannot subscribe to a channel and receive what is said in it", async () => {
    const member = await seatedMember()
    const outsider = await stranger()
    outsider.send({ t: "channel.subscribe", channels: [channel] })
    await outsider.sync()

    member.send({
      t: "channel.send",
      channel,
      kind: "application",
      ciphertext: toBase64(new TextEncoder().encode("mais um segredo")),
    })
    await member.sync()

    const answer = await outsider.next()
    expect(answer.t).not.toBe("channel.event")

    member.close()
    outsider.close()
  }, 20_000)

  it("a stranger cannot write into a channel", async () => {
    const member = await seatedMember()
    const outsider = await stranger()

    outsider.send({
      t: "channel.send",
      channel,
      kind: "application",
      ciphertext: toBase64(new TextEncoder().encode("lixo")),
    })
    await outsider.sync()

    // Three of these used to be enough to make every member declare the channel
    // deaf, which triggers a rejoin, which reseats members, which destroys the
    // history by forward secrecy. A member must not see it.
    const answer = await member.next()
    expect(answer.t).not.toBe("channel.event")

    member.close()
    outsider.close()
  }, 20_000)

  it("a stranger's rejoin request never reaches the members who could seat them", async () => {
    const member = await seatedMember()
    const outsider = await stranger()

    outsider.send({ t: "channel.rejoin.request", channel })
    await outsider.sync()

    const answer = await member.next()
    expect(answer.t).not.toBe("channel.rejoin")

    member.close()
    outsider.close()
  }, 20_000)

  /**
   * Roles do not arrive here, and the temptation to bring them has a name.
   *
   * Removing someone is a cryptographic fact: the leaf leaves the MLS tree, the
   * epoch advances, and the removed person stops reading what follows. This
   * server sees none of that, it does not read the group, by design, so the
   * subscription of the removed person survives, and they can still write frames
   * to the channel that no one else can decipher. Three such frames make each
   * member declare the channel deaf, which triggers re-entries, which re-seat
   * people, which erase history for future secrecy.
   *
   * The obvious fix, a frame telling the server to stop serving an account in
   * a channel, is the one that cannot be done, and this test exists to force
   * the argument to be repeated before someone does it: the server does not know
   * who administers and cannot know, so it would have to accept the order from
   * any member. That is a weapon that kills the channel for everyone, handed to
   * all, to cover a risk that cryptography has already limited to noise.
   */
  it("não existe forma de mandar o servidor expulsar alguém, e a subscrição de quem sai sobrevive", async () => {
    // Own channel: here you need a member actually seated, and the tolerance for
    // newborn-channel only serves the first to arrive.
    const sala = moradaDeSala(HOME)
    const member = await TestClient.connect(gatewayUrl)
    expect((await login(member, generateIdentity(HOME))).t).toBe("auth.ok")
    member.send({ t: "channel.subscribe", channels: [sala] })
    await member.sync()

    const outsider = await stranger()
    // Does not exist in `ClientFrame`, the template is part of the defense, not just the code.
    outsider.send({ t: "channel.evict", channel: sala, address: `@quemquerqueseja:${HOME}` } as unknown as ClientFrame)
    const recusa = await outsider.nextOf("error")
    expect(recusa.code).toBe("bad-frame")

    // And the server remains exactly as ignorant as before: who was seated stays
    // seated, whatever happens inside the group.
    member.send({
      t: "channel.send",
      channel: sala,
      kind: "application",
      ciphertext: toBase64(new TextEncoder().encode("continua a chegar")),
    })
    const eco = await member.nextOf("channel.event")
    expect(eco.channel).toBe(sala)

    member.close()
    outsider.close()
  }, 20_000)
})

/**
 * Early seating.
 *
 * In 0.9 a feed was called `!feed-<id>` and a private conversation `!dm-<a>.<b>`:
 * both derived from public addresses, so any account could calculate them. In
 * 1.0 those forms do not open (`moradas-opacas.test.ts`), and the proofs for
 * them left here with them (slice 6a); what remains is the opaque channel proof.
 * The tolerance that lets you touch a channel not yet opened exists for the
 * instant between creating a room and talking in it for the first time, but
 * it was not anchored to anyone, so it granted that instant to EVERYONE: you
 * just had to arrive before the victim and the subscription was recorded,
 * forever.
 *
 * Measured with real requests against this same server, before the fix:
 * reading the cipher live, backfilling what passed, presence, and frames forged
 * inside another's channel, which is what triggers the deafness detector for
 * each member and moves history forward for future secrecy.
 *
 * It is the same shape as the hole that `#isSeated` closed, entry through
 * another door. Nothing exercised reach to a virgin channel by someone who is
 * not its owner, and that is why it went unnoticed.
 */
describe("o assento antecipado num canal por estrear", () => {
  async function conta(): Promise<{ client: TestClient; address: string }> {
    const client = await TestClient.connect(gatewayUrl)
    const identity = generateIdentity(HOME)
    expect((await login(client, identity)).t).toBe("auth.ok")
    // Consume the `keypackage.low` that follows login. Without this, each assertion
    // "received nothing" would pass by finding that frame first.
    await client.sync()
    return { client, address: identity.address }
  }

  /**
   * Nothing reached this client before the pong.
   *
   * A `channel.event` broadcast during the previous frame is already written to
   * the socket when the ping goes out, so it comes before the pong: if the
   * first frame to arrive is the pong, there was no delivery. Better than
   * waiting for a timeout, it is deterministic and immediate.
   */
  async function nadaAntesDoPong(client: TestClient): Promise<void> {
    client.send({ t: "ping" })
    expect((await client.next()).t).toBe("pong")
  }

  it("num canal opaco a tolerância serve o primeiro que lá chega, e mais ninguém", async () => {
    const criador = await conta()
    const eve = await conta()
    const sala = moradaDeSala(HOME)

    criador.client.send({ t: "channel.subscribe", channels: [sala] })
    await criador.client.sync()

    // Latecomer to the same virgin identifier: no longer anyone's creation, it is
    // a free ride on someone else's tolerance.
    eve.client.send({ t: "channel.subscribe", channels: [sala] })
    await eve.client.sync()

    criador.client.send({
      t: "channel.send",
      channel: sala,
      kind: "application",
      ciphertext: toBase64(new TextEncoder().encode("cifra")),
    })
    await criador.client.nextOf("channel.event")
    await criador.client.sync()

    await nadaAntesDoPong(eve.client)

    criador.client.close()
    eve.client.close()
  }, 30_000)
})

/**
 * The other side of the same coin: closing this cannot break channel creation,
 * which is the only thing the tolerance exists to protect.
 */
describe("a tolerância do canal por estrear continua a servir quem cria", () => {
  async function conta(): Promise<{ client: TestClient; address: string }> {
    const client = await TestClient.connect(gatewayUrl)
    const identity = generateIdentity(HOME)
    expect((await login(client, identity)).t).toBe("auth.ok")
    await client.sync()
    return { client, address: identity.address }
  }

  it("quem cria um canal opaco subscreve-o e fala nele", async () => {
    const criador = await conta()
    const sala = moradaDeSala(HOME)

    criador.client.send({ t: "channel.subscribe", channels: [sala] })
    criador.client.send({
      t: "channel.send",
      channel: sala,
      kind: "application",
      ciphertext: toBase64(new TextEncoder().encode("room.created")),
    })
    const eco = await criador.client.nextOf("channel.event")
    expect(eco.channel).toBe(sala)

    criador.client.close()
  }, 20_000)

  it("o guião da reclamação continua de pé: reclamar, criar, falar", async () => {
    const criador = await conta()
    const sala = moradaDeSala(HOME)

    criador.client.send({ t: "channel.claim", channel: sala })
    const reclamacao = await criador.client.nextOf("channel.claim.result")
    expect(reclamacao.mine).toBe(true)
    expect(reclamacao.empty).toBe(true)

    criador.client.send({ t: "channel.subscribe", channels: [sala] })
    criador.client.send({
      t: "channel.send",
      channel: sala,
      kind: "application",
      ciphertext: toBase64(new TextEncoder().encode("room.created")),
    })
    const eco = await criador.client.nextOf("channel.event")
    expect(eco.channel).toBe(sala)

    // And whoever lost the report does not enter here, they exit through the
    // entry request, which is what the common room script does next.
    const tardio = await conta()
    tardio.client.send({ t: "channel.claim", channel: sala })
    const perdida = await tardio.client.nextOf("channel.claim.result")
    expect(perdida.mine).toBe(false)

    criador.client.close()
    tardio.client.close()
  }, 20_000)
})

/**
 * Periodic maintenance, and what it was not doing.
 *
 * `Store.expireInvites()` existed and never ran: `Federation.sweep()` only
 * called `expireNonces` and `expireEvents`. An audit found three thousand
 * expired invites, all still in the database, each with its hash and its
 * channel. Dead code that no one calls is worse than missing code, anyone
 * reading the function assumes it runs.
 */
describe("a manutenção periódica", () => {
  it("apaga os convites caducados, que ninguém estava a apagar", async () => {
    const host = await TestClient.connect(gatewayUrl)
    await login(host, generateIdentity(HOME))
    const channel = moradaDeSala(HOME)
    host.send({ t: "channel.subscribe", channels: [channel] })
    await host.sync()

    const caducado = toBase64(crypto.getRandomValues(new Uint8Array(32)))
    const vivo = toBase64(crypto.getRandomValues(new Uint8Array(32)))
    // A second after the epoch: expired more than fifty years ago.
    host.send({ t: "invite.create", channel, codeHash: caducado, expiresAt: 1, maxUses: null })
    await host.nextOf("invite.created")
    host.send({ t: "invite.create", channel, codeHash: vivo, expiresAt: null, maxUses: null })
    await host.nextOf("invite.created")
    expect(enclave.store.listInvites(channel)).toHaveLength(2)

    enclave.federation.sweep()

    // What had an expiry and passed disappeared; what has no expiry stays, because
    // having no expiry is a choice by whoever issued it, not an oversight.
    expect(enclave.store.listInvites(channel).map((convite) => convite.codeHash)).toEqual([vivo])

    host.close()
  }, 20_000)
})

/**
 * The per-account caps.
 *
 * Each frame counted here leaves a permanent mark in the database at the
 * request of whoever sends it, and none had a limit: an audit filled the tables
 * from a single account without effort. Tested because a cap that does not bite
 * is the same as the `expireInvites` that never ran, it looks like it is there.
 */
describe("os tectos por conta", () => {
  it("estrear canais virgens pára no tecto, e as estreias de mais não deixam rasto", async () => {
    const client = await TestClient.connect(gatewayUrl)
    const identity = generateIdentity(HOME)
    expect((await login(client, identity)).t).toBe("auth.ok")
    await client.sync()

    // A hundred virgin identifiers at once. Without a cap, those are a hundred
    // subscriptions and a hundred reports recorded by an account that still has no
    // seat anywhere, as fast as the network allows.
    const canais = Array.from({ length: 100 }, () => moradaDeSala(HOME))
    client.send({ t: "channel.subscribe", channels: canais })
    await client.sync()

    const gravados = canais.filter((canal) => enclave.store.isSubscribed(canal, identity.address))
    expect(gravados).toHaveLength(Gateway.ESTREIAS_POR_MINUTO)
    // And they are the first: the cap cuts the tail, does not choose at random.
    expect(gravados[0]).toBe(canais[0])

    client.close()
  }, 20_000)

  it("cunhar convites pára no tecto", async () => {
    const client = await TestClient.connect(gatewayUrl)
    expect((await login(client, generateIdentity(HOME))).t).toBe("auth.ok")
    await client.sync()
    const channel = moradaDeSala(HOME)
    client.send({ t: "channel.subscribe", channels: [channel] })
    await client.sync()

    const pedidos = Gateway.CONVITES_POR_MINUTO + 10
    for (let i = 0; i < pedidos; i++) {
      client.send({
        t: "invite.create",
        channel,
        codeHash: toBase64(crypto.getRandomValues(new Uint8Array(32))),
        expiresAt: null,
        maxUses: null,
      })
    }
    // Drain to the pong by hand: `sync()` only skips ten frames, and here there
    // are thirty confirmations ahead of it.
    client.send({ t: "ping" })
    let confirmados = 0
    for (let i = 0; i < pedidos + 5; i++) {
      const frame = await client.next()
      if (frame.t === "pong") break
      if (frame.t === "invite.created") confirmados += 1
    }

    expect(confirmados).toBe(Gateway.CONVITES_POR_MINUTO)
    expect(enclave.store.listInvites(channel)).toHaveLength(Gateway.CONVITES_POR_MINUTO)

    client.close()
  }, 20_000)

  it("a piscina de key packages tem tecto, e `replace` continua a ser a saída", async () => {
    const client = await TestClient.connect(gatewayUrl)
    const identity = generateIdentity(HOME)
    expect((await login(client, identity)).t).toBe("auth.ok")
    await client.sync()

    const lote = (): string[] =>
      Array.from({ length: 100 }, () => toBase64(crypto.getRandomValues(new Uint8Array(16))))
    // Six batches of a hundred: the sixth does not fit, because the limit is five hundred.
    for (let i = 0; i < 6; i++) client.send({ t: "keypackage.publish", packages: lote(), replace: false })
    await client.sync()
    expect(enclave.store.availableKeyPackages(identity.address)).toBe(Gateway.KEYPACKAGES_EM_ESPERA)

    // `replace` deletes the pending ones before writing, so it never adds, and
    // that is why it always passes. Whoever filled the vault by accident recovers
    // it on their own on the next connection.
    client.send({ t: "keypackage.publish", packages: lote(), replace: true })
    await client.sync()
    expect(enclave.store.availableKeyPackages(identity.address)).toBe(100)

    client.close()
  }, 20_000)

  /**
   * Drain by hand everything the server sent up to the `pong`.
   *
   * `sync()` does not work here: it skips ten frames and gives up, and these
   * tests send hundreds. The `ping` goes behind the whole batch, so the `pong`
   * only arrives after the server has processed the last one, that is the proof
   * that what did not come was not slowness, it was refusal.
   */
  async function escoarAteAoPong(client: TestClient, maximo: number): Promise<ServerFrame[]> {
    client.send({ t: "ping" })
    const recebidos: ServerFrame[] = []
    for (let i = 0; i < maximo; i++) {
      const frame = await client.next()
      if (frame.t === "pong") break
      if (frame.t === "error" && frame.code === "timeout") break
      recebidos.push(frame)
    }
    return recebidos
  }

  /**
   * The cap on outgoing frames, measured in the DATABASE and not in the socket.
   *
   * The earlier attempt measured the test client, `sync()` ran out of pong
   * behind six hundred echoes and what you saw was the test's queue, not the
   * server's refusal. What is counted here are the rows that stayed in `events`:
   * no one writes them but the server, and the `pong` at the end proves it has
   * already processed the whole batch. If the cap does not bite, 630 stay there.
   */
  it("falar pára no tecto, e o que passa dele não chega à base", async () => {
    const client = await TestClient.connect(gatewayUrl)
    const identity = generateIdentity(HOME)
    expect((await login(client, identity)).t).toBe("auth.ok")
    const channel = moradaDeSala(HOME)
    client.send({ t: "channel.subscribe", channels: [channel] })
    await client.sync()

    const pedidos = Gateway.ENVIOS_POR_MINUTO + 30
    for (let i = 0; i < pedidos; i++) {
      client.send({ t: "channel.send", channel, kind: "application", ciphertext: toBase64(new Uint8Array([i % 251])) })
    }
    await escoarAteAoPong(client, pedidos + 50)

    const gravados = enclave.store.backfill(channel, undefined, pedidos + 50, identity.address)
    expect(gravados).toHaveLength(Gateway.ENVIOS_POR_MINUTO)

    client.close()
  }, 30_000)

  /**
   * The history cap.
   *
   * This one writes nothing, so the only mark it leaves is the response, and
   * that is exactly what is counted. It is not the test's socket being
   * measured: the `pong` comes after seventy requests, so the server processed
   * them all and chose not to answer ten.
   */
  it("pedir histórico pára no tecto", async () => {
    const client = await TestClient.connect(gatewayUrl)
    const identity = generateIdentity(HOME)
    expect((await login(client, identity)).t).toBe("auth.ok")
    const channel = moradaDeSala(HOME)
    client.send({ t: "channel.subscribe", channels: [channel] })
    await client.sync()

    const pedidos = Gateway.BACKFILLS_POR_MINUTO + 10
    for (let i = 0; i < pedidos; i++) client.send({ t: "channel.backfill", channel, limit: 1 })
    const respostas = await escoarAteAoPong(client, pedidos + 20)

    expect(respostas.filter((frame) => frame.t === "channel.backfill.page")).toHaveLength(
      Gateway.BACKFILLS_POR_MINUTO,
    )

    client.close()
  }, 30_000)

  /**
   * The invite resync: the most expensive frame that exists here, and the last
   * to gain a cap.
   *
   * Each request reads the events table and returns up to two hundred invites.
   * The client makes one per connection; without a cap, an account makes a
   * thousand per minute and each one is a sorted lookup plus what it returns.
   */
  it("repetir o resync dos convites pára no tecto", async () => {
    const anfitriao = await TestClient.connect(gatewayUrl)
    expect((await login(anfitriao, generateIdentity(HOME))).t).toBe("auth.ok")
    const convidado = generateIdentity(HOME)
    const channel = moradaDeSala(HOME)
    anfitriao.send({ t: "channel.subscribe", channels: [channel] })
    await anfitriao.sync()
    // A targeted invite, waiting for someone who has not yet arrived. It is
    // reading it that the resync repeats, and that is why there is something to
    // count here.
    anfitriao.send({ t: "channel.send", channel, kind: "welcome", ciphertext: "dmVsY29tZQ", recipient: convidado.address })
    await anfitriao.sync()

    const client = await TestClient.connect(gatewayUrl)
    expect((await login(client, convidado)).t).toBe("auth.ok")
    await client.sync()

    const pedidos = Gateway.RESYNCS_POR_MINUTO + 10
    for (let i = 0; i < pedidos; i++) client.send({ t: "welcome.resync" })
    const respostas = await escoarAteAoPong(client, pedidos + 20)

    // One invite per resync served: sixty, not seventy.
    expect(respostas.filter((frame) => frame.t === "channel.event")).toHaveLength(Gateway.RESYNCS_POR_MINUTO)

    client.close()
    anfitriao.close()
  }, 30_000)

  /**
   * TURN credentials, which are the only thing here that costs third parties
   * money: each one opens a relay for `turnTtl`.
   */
  it("pedir servidores ICE pára no tecto", async () => {
    const client = await TestClient.connect(gatewayUrl)
    expect((await login(client, generateIdentity(HOME))).t).toBe("auth.ok")
    await client.sync()

    const pedidos = Gateway.ICE_POR_MINUTO + 10
    for (let i = 0; i < pedidos; i++) client.send({ t: "ice.servers" })
    const respostas = await escoarAteAoPong(client, pedidos + 20)

    expect(respostas.filter((frame) => frame.t === "ice.servers.result")).toHaveLength(Gateway.ICE_POR_MINUTO)

    client.close()
  }, 30_000)

  /** The list of who lives here, which in community mode goes whole in each frame. */
  it("pedir o directório pára no tecto", async () => {
    const client = await TestClient.connect(gatewayUrl)
    expect((await login(client, generateIdentity(HOME))).t).toBe("auth.ok")
    await client.sync()

    const pedidos = Gateway.DIRECTORIOS_POR_MINUTO + 10
    for (let i = 0; i < pedidos; i++) client.send({ t: "directory.list" })
    const respostas = await escoarAteAoPong(client, pedidos + 20)

    expect(respostas.filter((frame) => frame.t === "directory.list.result")).toHaveLength(
      Gateway.DIRECTORIOS_POR_MINUTO,
    )

    client.close()
  }, 30_000)
})

/**
 * Sign in with the chain: account, device, and the certificate of one over the
 * other.
 *
 * What the server now verifies is a longer link than before:
 * `hash(accountKey) == endereço`, the account signed this device, and it is this
 * device that signs the challenge. What it does NOT now gain is the ability to
 * invent a device: without the account key nobody produces a certificate that
 * closes, and it is each client that validates the chain before it admits a
 * leaf.
 *
 * The fields are optional and not a new `t`, so the old path, the account
 * key matching directly with the address, continues to be accepted and
 * continues to be sufficient proof, because it requires the account key in hand.
 * That is what the `login` above does, and that is why the forty-odd tests in this
 * file did not change.
 */
describe("gateway: a cadeia de aparelho no login", () => {
  async function loginComCadeia(
    client: TestClient,
    identity: ReturnType<typeof generateIdentity>,
  ): Promise<ServerFrame> {
    client.send({
      t: "auth.begin",
      address: identity.address,
      signingKey: toBase64(identity.deviceSigningPublicKey),
      accountKey: toBase64(identity.signingPublicKey),
      deviceCert: toBase64(identity.credential.signature),
    })
    const challenge = await client.next()
    if (challenge.t !== "auth.challenge") return challenge

    client.send({ t: "auth.finish", signature: toBase64(signWithDevice(identity, fromBase64(challenge.nonce))) })
    return client.next()
  }

  it("aceita a cadeia, e a conta que fica registada é a do endereço", async () => {
    const client = await TestClient.connect(gatewayUrl)
    const identity = generateIdentity(HOME)

    const resultado = await loginComCadeia(client, identity)
    expect(resultado.t).toBe("auth.ok")
    if (resultado.t === "auth.ok") expect(resultado.address).toBe(identity.address)

    // The account is the ACCOUNT key, not the device key. If it were the device
    // key, the address would stop being a hash of a key and become a name stored
    // next to it.
    expect(enclave.store.registerOrVerifyAccount(identity.address, identity.signingPublicKey)).toBe(true)
    expect(enclave.store.registerOrVerifyAccount(identity.address, identity.deviceSigningPublicKey)).toBe(false)

    client.close()
  })

  it("regista o aparelho que assinou o desafio, e não a conta", async () => {
    const client = await TestClient.connect(gatewayUrl)
    const identity = generateIdentity(HOME)
    expect((await loginComCadeia(client, identity)).t).toBe("auth.ok")

    const aparelhos = enclave.store.devicesOf(identity.address)
    expect(aparelhos).toHaveLength(1)
    expect(Uint8Array.from(aparelhos[0] as Uint8Array)).toEqual(identity.deviceSigningPublicKey)

    client.close()
  })

  it("um segundo aparelho da mesma conta entra, e o primeiro fica", async () => {
    // The same account, another device key, certified by the same account key:
    // that is what a second paired computer will present. Until 22 September 2026
    // the second's login erased the first's row.
    const primeiro = generateIdentity(HOME)
    const segundo = identityFromPrivateKey(primeiro.signingPrivateKey, HOME)
    expect(segundo.address).toBe(primeiro.address)

    const a = await TestClient.connect(gatewayUrl)
    expect((await loginComCadeia(a, primeiro)).t).toBe("auth.ok")
    const b = await TestClient.connect(gatewayUrl)
    expect((await loginComCadeia(b, segundo)).t).toBe("auth.ok")

    const aparelhos = enclave.store.devicesOf(primeiro.address).map((k) => Uint8Array.from(k))
    expect(aparelhos).toEqual([primeiro.deviceSigningPublicKey, segundo.deviceSigningPublicKey])

    a.close()
    b.close()
  })

  it("o desafio tem de ser assinado pelo APARELHO, não pela conta", async () => {
    const client = await TestClient.connect(gatewayUrl)
    const identity = generateIdentity(HOME)

    client.send({
      t: "auth.begin",
      address: identity.address,
      signingKey: toBase64(identity.deviceSigningPublicKey),
      accountKey: toBase64(identity.signingPublicKey),
      deviceCert: toBase64(identity.credential.signature),
    })
    const challenge = await client.next()
    expect(challenge.t).toBe("auth.challenge")
    if (challenge.t !== "auth.challenge") return

    // Signed with the account key, which is the wrong key for this challenge.
    client.send({ t: "auth.finish", signature: toBase64(sign(identity, fromBase64(challenge.nonce))) })
    const resposta = await client.next()

    expect(resposta.t).toBe("error")
    if (resposta.t === "error") expect(resposta.code).toBe("bad-signature")

    client.close()
  })

  it("recusa o certificado assinado por outra conta", async () => {
    const client = await TestClient.connect(gatewayUrl)
    const ana = generateIdentity(HOME)
    const eva = generateIdentity(HOME)

    // Eve certifies her device as if it were Ana's: that is the server inventing a
    // device, and that is the attack this chain exists to kill.
    client.send({
      t: "auth.begin",
      address: ana.address,
      signingKey: toBase64(eva.deviceSigningPublicKey),
      accountKey: toBase64(ana.signingPublicKey),
      deviceCert: toBase64(signDeviceCert(eva.signingPrivateKey, eva.deviceSigningPublicKey, ana.address)),
    })
    const resposta = await client.next()

    expect(resposta.t).toBe("error")
    if (resposta.t === "error") expect(resposta.code).toBe("bad-device-cert")

    client.close()
  })

  it("recusa o certificado de um aparelho que não é o que se apresenta", async () => {
    const client = await TestClient.connect(gatewayUrl)
    const identity = generateIdentity(HOME)
    const outro = generateIdentity(HOME)

    // A true account certificate, but issued for another device: whoever catches
    // a stranger's chain on the wire cannot put it on.
    client.send({
      t: "auth.begin",
      address: identity.address,
      signingKey: toBase64(outro.deviceSigningPublicKey),
      accountKey: toBase64(identity.signingPublicKey),
      deviceCert: toBase64(identity.credential.signature),
    })
    const resposta = await client.next()

    expect(resposta.t).toBe("error")
    if (resposta.t === "error") expect(resposta.code).toBe("bad-device-cert")

    client.close()
  })

  it("recusa a chave de conta que não bate com o endereço", async () => {
    const client = await TestClient.connect(gatewayUrl)
    const vitima = generateIdentity(HOME)
    const atacante = generateIdentity(HOME)

    client.send({
      t: "auth.begin",
      address: vitima.address,
      signingKey: toBase64(atacante.deviceSigningPublicKey),
      accountKey: toBase64(atacante.signingPublicKey),
      deviceCert: toBase64(atacante.credential.signature),
    })
    const resposta = await client.next()

    expect(resposta.t).toBe("error")
    if (resposta.t === "error") expect(resposta.code).toBe("key-mismatch")

    client.close()
  })

  it("recusa meia cadeia, em vez de a tratar como ausência", async () => {
    // Falling into the old path would give an error about the key not matching the
    // address, and would send you looking for the fault in the wrong place.
    const semCertificado = await TestClient.connect(gatewayUrl)
    const identity = generateIdentity(HOME)
    semCertificado.send({
      t: "auth.begin",
      address: identity.address,
      signingKey: toBase64(identity.deviceSigningPublicKey),
      accountKey: toBase64(identity.signingPublicKey),
    })
    const primeira = await semCertificado.next()
    expect(primeira.t).toBe("error")
    if (primeira.t === "error") expect(primeira.code).toBe("bad-device-cert")
    semCertificado.close()

    const semConta = await TestClient.connect(gatewayUrl)
    semConta.send({
      t: "auth.begin",
      address: identity.address,
      signingKey: toBase64(identity.deviceSigningPublicKey),
      deviceCert: toBase64(identity.credential.signature),
    })
    const segunda = await semConta.next()
    expect(segunda.t).toBe("error")
    if (segunda.t === "error") expect(segunda.code).toBe("bad-device-cert")
    semConta.close()
  })

  it("o caminho antigo, sem cadeia nenhuma, continua a entrar", async () => {
    const client = await TestClient.connect(gatewayUrl)
    const identity = generateIdentity(HOME)

    // Without `accountKey`, `signingKey` is the account key itself and the check
    // is the usual direct one. It still requires the account key in hand, which is
    // stronger proof, not weaker.
    expect((await login(client, identity)).t).toBe("auth.ok")

    client.close()
  })
})

/**
 * The device manifest at the gateway: the announced capacity, the retention
 * window stated, and the three responses from `manifest.publish`.
 *
 * The cryptographic guards (signature, version) have their tests in
 * `store.test.ts`; what is measured here is what only the gateway knows: who
 * is connected, and what is sent back to them.
 */
describe("gateway: o manifesto de aparelhos", () => {
  const aparelho = (n: number) => ed25519.getPublicKey(sha256(Uint8Array.from([n])))
  const manifestoDe = (identity: ReturnType<typeof generateIdentity>, version: number) =>
    signDeviceManifest(identity.signingPrivateKey, {
      address: identity.address,
      version,
      devices: [{ deviceKey: identity.deviceSigningPublicKey, addedAt: 0 }, { deviceKey: aparelho(version), addedAt: 1 }],
      signedAt: version,
    })

  it("hello.ok anuncia devices e diz quantos dias guarda", async () => {
    const client = await TestClient.connect(gatewayUrl)
    client.send({ t: "hello", version: PROTOCOL_VERSION })
    const hello = await client.nextOf("hello.ok")
    expect(hello.capabilities).toContain(CAPACIDADE_APARELHOS)
    expect(hello.capabilities).toContain("devices")
    expect(hello.retentionDays).toBe(30)
    client.close()
  })

  it("publicar o próprio: guardado, e manifest.get devolve-o a qualquer conta", async () => {
    const ana = await TestClient.connect(gatewayUrl)
    const identity = generateIdentity(HOME)
    expect((await login(ana, identity)).t).toBe("auth.ok")

    ana.send({ t: "manifest.get", address: identity.address })
    expect(await ana.nextOf("manifest.result")).toMatchObject({ address: identity.address, manifest: null })

    const v1 = manifestoDe(identity, 1)
    ana.send({ t: "manifest.publish", manifest: v1 })
    expect(await ana.nextOf("manifest.published")).toEqual({ t: "manifest.published", address: identity.address, version: 1, ok: true })

    const bento = await TestClient.connect(gatewayUrl)
    expect((await login(bento, generateIdentity(HOME))).t).toBe("auth.ok")
    bento.send({ t: "manifest.get", address: identity.address })
    expect(await bento.nextOf("manifest.result")).toEqual({ t: "manifest.result", address: identity.address, manifest: v1 })

    ana.close()
    bento.close()
  })

  it("republicar a mesma versão é recusado com stale-version, e a guardada fica", async () => {
    const ana = await TestClient.connect(gatewayUrl)
    const identity = generateIdentity(HOME)
    expect((await login(ana, identity)).t).toBe("auth.ok")

    const v1 = manifestoDe(identity, 1)
    ana.send({ t: "manifest.publish", manifest: v1 })
    expect((await ana.nextOf("manifest.published")).ok).toBe(true)
    ana.send({ t: "manifest.publish", manifest: manifestoDe(identity, 1) })
    expect(await ana.nextOf("manifest.published")).toMatchObject({ ok: false, reason: "stale-version", version: 1 })

    ana.send({ t: "manifest.get", address: identity.address })
    expect((await ana.nextOf("manifest.result")).manifest).toEqual(v1)
    ana.close()
  })

  it("uma conta não publica em nome de outra, por muito bem assinado que venha", async () => {
    const ana = generateIdentity(HOME)
    const bento = await TestClient.connect(gatewayUrl)
    expect((await login(bento, generateIdentity(HOME))).t).toBe("auth.ok")

    // Signed by Ana for real, sent by Ben's connection.
    bento.send({ t: "manifest.publish", manifest: manifestoDe(ana, 1) })
    expect(await bento.nextOf("manifest.published")).toMatchObject({ address: ana.address, ok: false, reason: "not-yours" })
    expect(enclave.store.deviceManifestOf(ana.address)).toBeNull()
    bento.close()
  })

  it("mexido depois de assinado é recusado com a razão do verificador", async () => {
    const ana = await TestClient.connect(gatewayUrl)
    const identity = generateIdentity(HOME)
    expect((await login(ana, identity)).t).toBe("auth.ok")

    const v1 = manifestoDe(identity, 1)
    ana.send({ t: "manifest.publish", manifest: { ...v1, version: 2 } })
    expect(await ana.nextOf("manifest.published")).toMatchObject({ ok: false, reason: "bad-signature" })
    expect(enclave.store.deviceManifestOf(identity.address)).toBeNull()
    ana.close()
  })

  it("sem autenticar, nem publicar nem pedir", async () => {
    const client = await TestClient.connect(gatewayUrl)
    client.send({ t: "hello", version: PROTOCOL_VERSION })
    await client.nextOf("hello.ok")
    client.send({ t: "manifest.get", address: "@x:localhost" })
    const resposta = await client.next()
    expect(resposta).toMatchObject({ t: "error", code: "unauthenticated" })
    client.close()
  })
})

/**
 * The claim in bundle: one package per device from the manifest, only to the caller.
 *
 * The scenario is "a second device from the same account connects, and the first stays",
 * above: now both publish pools, the account publishes the manifest with both,
 * and a third one claims. What we count here are PACKAGES SPENT, read
 * from the database, because that is what a 0.2.3 client inviting someone cannot see
 * change: without `bundle`, one.
 */
describe("gateway: keypackage.claim em bundle", () => {
  async function entrarComCadeia(client: TestClient, identity: ReturnType<typeof generateIdentity>): Promise<void> {
    client.send({ t: "hello", version: PROTOCOL_VERSION, capabilities: ["commit-after-echo"] })
    await client.nextOf("hello.ok")
    client.send({
      t: "auth.begin",
      address: identity.address,
      signingKey: toBase64(identity.deviceSigningPublicKey),
      accountKey: toBase64(identity.signingPublicKey),
      deviceCert: toBase64(identity.credential.signature),
    })
    const challenge = await client.next()
    if (challenge.t !== "auth.challenge") throw new Error(`sem desafio: ${challenge.t}`)
    client.send({ t: "auth.finish", signature: toBase64(signWithDevice(identity, fromBase64(challenge.nonce))) })
    const ok = await client.next()
    if (ok.t !== "auth.ok") throw new Error(`login falhou: ${ok.t}`)
  }

  const pacotes = (n: number) => Array.from({ length: n }, () => toBase64(crypto.getRandomValues(new Uint8Array(24))))

  /** An account with two connected devices, each with its own pool, and the manifest listing both. */
  async function contaComDoisAparelhos(comDevice = true) {
    const a = generateIdentity(HOME)
    const b = identityFromPrivateKey(a.signingPrivateKey, HOME)
    const ligA = await TestClient.connect(gatewayUrl)
    const ligB = await TestClient.connect(gatewayUrl)
    await entrarComCadeia(ligA, a)
    await entrarComCadeia(ligB, b)
    // A states the device; B does not (like a 0.2.3 client), and the server removes it
    // from login with the chain.
    ligA.send({ t: "keypackage.publish", packages: pacotes(3), replace: true, ...(comDevice ? { device: toBase64(a.deviceSigningPublicKey) } : {}) })
    ligB.send({ t: "keypackage.publish", packages: pacotes(3), replace: true })
    const agora = Math.floor(Date.now() / 1000)
    ligA.send({
      t: "manifest.publish",
      manifest: signDeviceManifest(a.signingPrivateKey, {
        address: a.address,
        version: 1,
        devices: [
          { deviceKey: a.deviceSigningPublicKey, addedAt: agora },
          { deviceKey: b.deviceSigningPublicKey, addedAt: agora },
        ],
        signedAt: agora,
      }),
    })
    expect((await ligA.nextOf("manifest.published")).ok).toBe(true)
    await ligA.sync()
    await ligB.sync()
    expect(enclave.store.availableKeyPackages(a.address, a.deviceSigningPublicKey)).toBe(3)
    expect(enclave.store.availableKeyPackages(a.address, b.deviceSigningPublicKey)).toBe(3)
    expect(enclave.store.availableKeyPackages(a.address)).toBe(6)
    return { a, b, ligA, ligB }
  }

  it("o hello.ok anuncia keypackage-bundle", async () => {
    const client = await TestClient.connect(gatewayUrl)
    client.send({ t: "hello", version: PROTOCOL_VERSION })
    const hello = await client.nextOf("hello.ok")
    expect(hello.capabilities).toContain(CAPACIDADE_BUNDLE)
    client.close()
  })

  it("um terceiro que pede o bundle recebe um pacote de cada aparelho, com o manifesto, e gasta dois", async () => {
    const { a, b, ligA, ligB } = await contaComDoisAparelhos()
    const carlos = await TestClient.connect(gatewayUrl)
    await entrarComCadeia(carlos, generateIdentity(HOME))

    carlos.send({ t: "keypackage.claim", address: a.address, bundle: true })
    const resposta = await carlos.nextOf("keypackage.claimed")
    expect(resposta.address).toBe(a.address)
    expect(resposta.manifest?.version).toBe(1)
    expect(resposta.keyPackages?.map((p) => p.deviceKey).sort()).toEqual(
      [toBase64(a.deviceSigningPublicKey), toBase64(b.deviceSigningPublicKey)].sort(),
    )
    // The singular is the first in the bundle, for anyone who only knows how to read the singular.
    expect(resposta.keyPackage).toBe(resposta.keyPackages?.[0]?.keyPackage)
    expect(enclave.store.availableKeyPackages(a.address, a.deviceSigningPublicKey)).toBe(2)
    expect(enclave.store.availableKeyPackages(a.address, b.deviceSigningPublicKey)).toBe(2)

    carlos.close()
    ligA.close()
    ligB.close()
  })

  it("sem `bundle` recebe UM pacote, sem bundle nem manifesto na resposta, e gasta UM", async () => {
    const { a, ligA, ligB } = await contaComDoisAparelhos()
    const carlos = await TestClient.connect(gatewayUrl)
    await entrarComCadeia(carlos, generateIdentity(HOME))

    carlos.send({ t: "keypackage.claim", address: a.address })
    const resposta = await carlos.nextOf("keypackage.claimed")
    expect(resposta.keyPackage).not.toBeNull()
    // Not even empty: a 0.2.3 client reads the same response as always.
    expect("keyPackages" in resposta).toBe(false)
    expect("manifest" in resposta).toBe(false)
    expect(enclave.store.availableKeyPackages(a.address)).toBe(5)

    carlos.close()
    ligA.close()
    ligB.close()
  })

  it("com `devices` só gasta os pedidos", async () => {
    const { a, b, ligA, ligB } = await contaComDoisAparelhos()
    const carlos = await TestClient.connect(gatewayUrl)
    await entrarComCadeia(carlos, generateIdentity(HOME))

    carlos.send({ t: "keypackage.claim", address: a.address, bundle: true, devices: [toBase64(b.deviceSigningPublicKey)] })
    const resposta = await carlos.nextOf("keypackage.claimed")
    expect(resposta.keyPackages?.map((p) => p.deviceKey)).toEqual([toBase64(b.deviceSigningPublicKey)])
    expect(enclave.store.availableKeyPackages(a.address, a.deviceSigningPublicKey)).toBe(3)
    expect(enclave.store.availableKeyPackages(a.address, b.deviceSigningPublicKey)).toBe(2)

    carlos.close()
    ligA.close()
    ligB.close()
  })

  it("um aparelho do manifesto sem pacotes não é erro: vêm os que há", async () => {
    const { a, b, ligA, ligB } = await contaComDoisAparelhos()
    // Esgotar o B.
    for (let i = 0; i < 3; i++) enclave.store.claimKeyPackage(a.address, b.deviceSigningPublicKey)
    const carlos = await TestClient.connect(gatewayUrl)
    await entrarComCadeia(carlos, generateIdentity(HOME))

    carlos.send({ t: "keypackage.claim", address: a.address, bundle: true })
    const resposta = await carlos.nextOf("keypackage.claimed")
    expect(resposta.keyPackages?.map((p) => p.deviceKey)).toEqual([toBase64(a.deviceSigningPublicKey)])
    expect(resposta.manifest?.version).toBe(1)
    expect(resposta.keyPackage).not.toBeNull()

    carlos.close()
    ligA.close()
    ligB.close()
  })

  it("com `bundle` mas sem manifesto, a resposta é o singular com bundle vazio e manifesto null", async () => {
    const ana = generateIdentity(HOME)
    const lig = await TestClient.connect(gatewayUrl)
    await entrarComCadeia(lig, ana)
    lig.send({ t: "keypackage.publish", packages: pacotes(2), replace: true })
    await lig.sync()
    const carlos = await TestClient.connect(gatewayUrl)
    await entrarComCadeia(carlos, generateIdentity(HOME))

    carlos.send({ t: "keypackage.claim", address: ana.address, bundle: true })
    const resposta = await carlos.nextOf("keypackage.claimed")
    expect(resposta.keyPackage).not.toBeNull()
    expect(resposta.keyPackages).toEqual([])
    expect(resposta.manifest).toBeNull()
    expect(enclave.store.availableKeyPackages(ana.address)).toBe(1)

    carlos.close()
    lig.close()
  })

  it("um `device` que não é o do login é um frame que não se guarda, e diz-se: device-mismatch, não fatal", async () => {
    const ana = generateIdentity(HOME)
    const outro = generateIdentity(HOME)
    const lig = await TestClient.connect(gatewayUrl)
    await entrarComCadeia(lig, ana)
    lig.send({ t: "keypackage.publish", packages: pacotes(2), replace: true, device: toBase64(outro.deviceSigningPublicKey) })
    // (`nextOf` skips the `keypackage.low` that follows login.)
    expect(await lig.nextOf("error")).toMatchObject({ code: "device-mismatch", fatal: false })
    await lig.sync()
    expect(enclave.store.availableKeyPackages(ana.address)).toBe(0)
    // The same device from login, stated or inferred, enters.
    lig.send({ t: "keypackage.publish", packages: pacotes(2), replace: true, device: toBase64(ana.deviceSigningPublicKey) })
    await lig.sync()
    expect(enclave.store.availableKeyPackages(ana.address, ana.deviceSigningPublicKey)).toBe(2)
    lig.close()
  })

  /**
   * Login WITHOUT the chain (the one from scripts) with `device` declared: the declared
   * is NEVER a source. If it were, any account could invent a device per frame
   * and the limit of five hundred per device would cease to exist. Without chain the
   * packages stay NULL, the declared is refused, and the limit is the account's.
   */
  it("sem cadeia, um `device` declarado é recusado, e os pacotes sem `device` ficam NULL com o tecto da conta", async () => {
    const ana = generateIdentity(HOME)
    const lig = await TestClient.connect(gatewayUrl)
    expect((await login(lig, ana)).t).toBe("auth.ok")
    await lig.sync()

    const inventado = generateIdentity(HOME)
    lig.send({ t: "keypackage.publish", packages: pacotes(2), device: toBase64(inventado.deviceSigningPublicKey) })
    expect(await lig.nextOf("error")).toMatchObject({ code: "device-mismatch", fatal: false })
    await lig.sync()
    expect(enclave.store.availableKeyPackages(ana.address)).toBe(0)

    // No `device`: they enter, without a device.
    for (let i = 0; i < 5; i++) lig.send({ t: "keypackage.publish", packages: pacotes(100) })
    await lig.sync()
    expect(enclave.store.availableKeyPackages(ana.address)).toBe(Gateway.KEYPACKAGES_EM_ESPERA)
    const semAparelho = enclave.store.availableKeyPackages(ana.address)
    // All NULL: a claim for any device sees none.
    expect(enclave.store.claimKeyPackage(ana.address, inventado.deviceSigningPublicKey)).toBeUndefined()
    // The limit holds: one more batch does not enter, with or without `device` declared.
    lig.send({ t: "keypackage.publish", packages: pacotes(10) })
    lig.send({ t: "keypackage.publish", packages: pacotes(10), device: toBase64(inventado.deviceSigningPublicKey) })
    expect(await lig.nextOf("error")).toMatchObject({ code: "device-mismatch" })
    await lig.sync()
    expect(enclave.store.availableKeyPackages(ana.address)).toBe(semAparelho)
    lig.close()
  }, 20_000)

  it("o aviso keypackage.low é por aparelho: o segundo aparelho ouve zero, o primeiro não ouve nada", async () => {
    const a = generateIdentity(HOME)
    const b = identityFromPrivateKey(a.signingPrivateKey, HOME)
    const ligA = await TestClient.connect(gatewayUrl)
    await entrarComCadeia(ligA, a)
    ligA.send({ t: "keypackage.publish", packages: pacotes(20), replace: true })
    await ligA.sync()
    ligA.close()

    const ligB = await TestClient.connect(gatewayUrl)
    await entrarComCadeia(ligB, b)
    const aviso = await ligB.next()
    expect(aviso).toMatchObject({ t: "keypackage.low", remaining: 0 })
    ligB.close()

    const outraVezA = await TestClient.connect(gatewayUrl)
    await entrarComCadeia(outraVezA, a)
    outraVezA.send({ t: "ping" })
    expect((await outraVezA.next()).t).toBe("pong")
    outraVezA.close()
  })

  it("o tecto da piscina é por aparelho", async () => {
    const a = generateIdentity(HOME)
    const b = identityFromPrivateKey(a.signingPrivateKey, HOME)
    const ligA = await TestClient.connect(gatewayUrl)
    const ligB = await TestClient.connect(gatewayUrl)
    await entrarComCadeia(ligA, a)
    await entrarComCadeia(ligB, b)
    for (let i = 0; i < 5; i++) ligA.send({ t: "keypackage.publish", packages: pacotes(100) })
    await ligA.sync()
    expect(enclave.store.availableKeyPackages(a.address, a.deviceSigningPublicKey)).toBe(Gateway.KEYPACKAGES_EM_ESPERA)
    // A is at the limit; B still publishes.
    ligB.send({ t: "keypackage.publish", packages: pacotes(10) })
    await ligB.sync()
    expect(enclave.store.availableKeyPackages(a.address, b.deviceSigningPublicKey)).toBe(10)
    ligA.close()
    ligB.close()
  }, 20_000)
})

/**
 * The pairing boxes: blind transport between a connection with an account and
 * one without, in memory, with timeout and caps.
 *
 * What we measure here is the most sensitive line of the gateway, `needsAuth`: that
 * `pair.join` passes without an account, that `pair.open` does NOT pass, that `pair.send` and
 * `pair.close` only pass without an account for whoever is in a box, and that ALL other
 * frames without an account remain fatal. The content of `pair.send`
 * is opaque to the server and to these tests: plain text goes here, and what we
 * assert is that it arrives on the other side exactly as it came.
 */
describe("caixas de emparelhamento", () => {
  const pairIdDeTeste = (): string => toBase64(sha256(crypto.getRandomValues(new Uint8Array(32)))).slice(0, 22)

  async function anfitriao(): Promise<{ cliente: TestClient; identity: ReturnType<typeof generateIdentity> }> {
    const identity = generateIdentity(HOME)
    const cliente = await TestClient.connect(gatewayUrl)
    expect((await login(cliente, identity)).t).toBe("auth.ok")
    return { cliente, identity }
  }

  /** A connection WITHOUT an account: `hello` and nothing else, like a phone before it has a vault. */
  async function semConta(): Promise<TestClient> {
    const cliente = await TestClient.connect(gatewayUrl)
    cliente.send({ t: "hello", version: PROTOCOL_VERSION })
    await cliente.nextOf("hello.ok")
    return cliente
  }

  it("o servidor anuncia a capacidade", async () => {
    const cliente = await semConta()
    cliente.close()
    const outro = await TestClient.connect(gatewayUrl)
    outro.send({ t: "hello", version: PROTOCOL_VERSION })
    const hello = await outro.nextOf("hello.ok")
    expect(hello.capabilities).toContain(CAPACIDADE_EMPARELHAMENTO)
    outro.close()
  })

  it("abre, junta, e reencaminha nos dois sentidos sem tocar no payload", async () => {
    const pc = await anfitriao()
    const pairId = pairIdDeTeste()
    pc.cliente.send({ t: "pair.open", pairId })
    expect(await pc.cliente.nextOf("pair.opened")).toMatchObject({ pairId })

    const telemovel = await semConta()
    telemovel.send({ t: "pair.join", pairId })
    expect(await telemovel.nextOf("pair.joined")).toMatchObject({ pairId })
    expect(await pc.cliente.nextOf("pair.joined")).toMatchObject({ pairId })

    telemovel.send({ t: "pair.send", pairId, payload: "do-telemovel" })
    expect(await pc.cliente.nextOf("pair.message")).toMatchObject({ pairId, payload: "do-telemovel" })
    // Any string, delivered character by character as it came: the server
    // does not read it, does not normalize it, does not rewrap it.
    const opaco = "dGFudG8-faz_ao~caso.0123456789-_"
    pc.cliente.send({ t: "pair.send", pairId, payload: opaco })
    expect(await telemovel.nextOf("pair.message")).toMatchObject({ pairId, payload: opaco })

    // Whoever closes does not hear the echo; the other side hears `closed`.
    telemovel.send({ t: "pair.close", pairId })
    expect(await pc.cliente.nextOf("pair.closed")).toMatchObject({ pairId, reason: "closed" })
    // And the box died: a new join is `unknown`.
    const outro = await semConta()
    outro.send({ t: "pair.join", pairId })
    expect(await outro.nextOf("pair.rejected")).toMatchObject({ pairId, reason: "unknown" })
    outro.close()
    telemovel.close()
    pc.cliente.close()
  })

  it("pair.open exige conta; pair.join não", async () => {
    const semLogin = await semConta()
    semLogin.send({ t: "pair.open", pairId: pairIdDeTeste() })
    expect(await semLogin.next()).toMatchObject({ t: "error", code: "unauthenticated", fatal: true })
    semLogin.close()

    const outro = await semConta()
    outro.send({ t: "pair.join", pairId: pairIdDeTeste() })
    // It passed the gate: the response is from the box (which does not exist), not from the gate.
    expect(await outro.next()).toMatchObject({ t: "pair.rejected", reason: "unknown" })
    outro.close()
  })

  it("pair.send e pair.close sem conta e fora de uma caixa são fatais, como tudo o resto", async () => {
    const pc = await anfitriao()
    const pairId = pairIdDeTeste()
    pc.cliente.send({ t: "pair.open", pairId })
    await pc.cliente.nextOf("pair.opened")

    // A connection without an account that did NOT join tries to speak to the box: it
    // is not in it, so it is a frame without an account like any other.
    const intruso = await semConta()
    intruso.send({ t: "pair.send", pairId, payload: "olá" })
    expect(await intruso.next()).toMatchObject({ t: "error", code: "unauthenticated", fatal: true })
    intruso.close()
    const outro = await semConta()
    outro.send({ t: "pair.close", pairId })
    expect(await outro.next()).toMatchObject({ t: "error", code: "unauthenticated", fatal: true })
    outro.close()

    // The box stays up: the host heard nothing.
    pc.cliente.send({ t: "ping" })
    expect((await pc.cliente.next()).t).toBe("pong")
    pc.cliente.close()
  })

  it("todas as outras tramas sem conta continuam fatais, uma a uma", async () => {
    const tramas: FrameDoCliente[] = [
      { t: "channel.subscribe", channels: [`!x:${HOME}`] },
      { t: "channel.send", channel: `!x:${HOME}`, kind: "application", ciphertext: "AAAA" },
      { t: "keypackage.claim", address: `@x:${HOME}` },
      { t: "manifest.get", address: `@x:${HOME}` },
      { t: "welcome.resync" },
      { t: "directory.list" },
      { t: "presence.set", visible: false },
      { t: "invite.list", channel: `!x:${HOME}` },
      { t: "ice.servers" },
    ]
    for (const trama of tramas) {
      const cliente = await semConta()
      cliente.send(trama)
      expect(await cliente.next(), trama.t).toMatchObject({ t: "error", code: "unauthenticated", fatal: true })
      cliente.close()
    }
  })

  it("um segundo open com o mesmo pairId é recusado, e a caixa que existe fica intacta", async () => {
    const pc = await anfitriao()
    const pairId = pairIdDeTeste()
    pc.cliente.send({ t: "pair.open", pairId })
    await pc.cliente.nextOf("pair.opened")
    const outraConta = await anfitriao()
    outraConta.cliente.send({ t: "pair.open", pairId })
    expect(await outraConta.cliente.nextOf("pair.rejected")).toMatchObject({ pairId, reason: "exists" })
    outraConta.cliente.close()
    // The phone joins the host's box.
    const telemovel = await semConta()
    telemovel.send({ t: "pair.join", pairId })
    await telemovel.nextOf("pair.joined")
    expect(await pc.cliente.nextOf("pair.joined")).toMatchObject({ pairId })
    telemovel.close()
    pc.cliente.close()
  })

  it("a terceira ligação é recusada e a caixa é queimada para os dois: alguém mais tinha o segredo", async () => {
    const pc = await anfitriao()
    const pairId = pairIdDeTeste()
    pc.cliente.send({ t: "pair.open", pairId })
    await pc.cliente.nextOf("pair.opened")
    const telemovel = await semConta()
    telemovel.send({ t: "pair.join", pairId })
    await telemovel.nextOf("pair.joined")
    await pc.cliente.nextOf("pair.joined")

    const intruso = await semConta()
    intruso.send({ t: "pair.join", pairId })
    expect(await intruso.nextOf("pair.rejected")).toMatchObject({ pairId, reason: "full" })
    expect(await pc.cliente.nextOf("pair.closed")).toMatchObject({ pairId, reason: "intruder" })
    expect(await telemovel.nextOf("pair.closed")).toMatchObject({ pairId, reason: "intruder" })
    // After it burned, even the phone that was in it cannot speak without an account.
    telemovel.send({ t: "pair.send", pairId, payload: "x" })
    expect(await telemovel.next()).toMatchObject({ t: "error", code: "unauthenticated" })
    intruso.close()
    telemovel.close()
    pc.cliente.close()
  })

  it("o anfitrião a juntar-se à própria caixa não conta como segundo lado", async () => {
    const pc = await anfitriao()
    const pairId = pairIdDeTeste()
    pc.cliente.send({ t: "pair.open", pairId })
    await pc.cliente.nextOf("pair.opened")
    pc.cliente.send({ t: "pair.join", pairId })
    expect(await pc.cliente.nextOf("pair.rejected")).toMatchObject({ pairId, reason: "full" })
    pc.cliente.close()
  })

  it("a queda de qualquer das ligações queima a caixa e avisa a outra", async () => {
    const pc = await anfitriao()
    const pairId = pairIdDeTeste()
    pc.cliente.send({ t: "pair.open", pairId })
    await pc.cliente.nextOf("pair.opened")
    const telemovel = await semConta()
    telemovel.send({ t: "pair.join", pairId })
    await telemovel.nextOf("pair.joined")
    await pc.cliente.nextOf("pair.joined")
    telemovel.close()
    expect(await pc.cliente.nextOf("pair.closed")).toMatchObject({ pairId, reason: "peer-left" })

    // And the reverse: the host falls, the phone hears.
    const pc2 = await anfitriao()
    const pairId2 = pairIdDeTeste()
    pc2.cliente.send({ t: "pair.open", pairId: pairId2 })
    await pc2.cliente.nextOf("pair.opened")
    const tel2 = await semConta()
    tel2.send({ t: "pair.join", pairId: pairId2 })
    await tel2.nextOf("pair.joined")
    await pc2.cliente.nextOf("pair.joined")
    pc2.cliente.close()
    expect(await tel2.nextOf("pair.closed")).toMatchObject({ pairId: pairId2, reason: "peer-left" })
    tel2.close()
    pc.cliente.close()
  })

  it("o prazo expira a caixa e avisa quem lá estava", async () => {
    const ttl = Gateway.PAIR_TTL_MS
    Gateway.PAIR_TTL_MS = 150
    try {
      const pc = await anfitriao()
      const pairId = pairIdDeTeste()
      pc.cliente.send({ t: "pair.open", pairId })
      await pc.cliente.nextOf("pair.opened")
      expect(await pc.cliente.nextOf("pair.closed")).toMatchObject({ pairId, reason: "expired" })
      const telemovel = await semConta()
      telemovel.send({ t: "pair.join", pairId })
      expect(await telemovel.nextOf("pair.rejected")).toMatchObject({ reason: "unknown" })
      telemovel.close()
      pc.cliente.close()
    } finally {
      Gateway.PAIR_TTL_MS = ttl
    }
  })

  it("um payload acima de 8 KiB, ou que não seja cadeia, é uma trama que não se lê", async () => {
    const pc = await anfitriao()
    const pairId = pairIdDeTeste()
    pc.cliente.send({ t: "pair.open", pairId })
    await pc.cliente.nextOf("pair.opened")
    const telemovel = await semConta()
    telemovel.send({ t: "pair.join", pairId })
    await telemovel.nextOf("pair.joined")
    await pc.cliente.nextOf("pair.joined")
    telemovel.send({ t: "pair.send", pairId, payload: "A".repeat(8 * 1024 + 1) })
    expect(await telemovel.next()).toMatchObject({ t: "error", code: "bad-frame" })
    // And an object does not even pass through the mold: measuring it would force the server to
    // serialize whatever was sent to it BEFORE the authentication gate.
    telemovel.send({ t: "pair.send", pairId, payload: { grande: "A".repeat(8 * 1024) } } as unknown as FrameDoCliente)
    expect(await telemovel.next()).toMatchObject({ t: "error", code: "bad-frame" })
    telemovel.close()
    pc.cliente.close()
  })

  it("tecto de aberturas por conta", async () => {
    const pc = await anfitriao()
    const ids: string[] = []
    for (let i = 0; i < Gateway.PAIR_ABERTURAS_POR_MINUTO + 1; i++) {
      const pairId = pairIdDeTeste()
      ids.push(pairId)
      pc.cliente.send({ t: "pair.open", pairId })
    }
    let abertas = 0
    let recusadas = 0
    // The `keypackage.low` from a new account arrives in the middle: count only what belongs to the box.
    while (abertas + recusadas < ids.length) {
      const resposta = await pc.cliente.next()
      if (resposta.t === "pair.opened") abertas++
      else if (resposta.t === "pair.rejected" && resposta.reason === "rate-limited") recusadas++
      else if (resposta.t === "error" && resposta.code === "timeout") break
    }
    expect(abertas).toBe(Gateway.PAIR_ABERTURAS_POR_MINUTO)
    expect(recusadas).toBe(1)
    for (const pairId of ids) pc.cliente.send({ t: "pair.close", pairId })
    await pc.cliente.sync()
    pc.cliente.close()
  })

  it("tecto de junções por ligação, e a ligação sem conta que insiste é fechada", async () => {
    const telemovel = await semConta()
    for (let i = 0; i < Gateway.PAIR_JOINS_POR_MINUTO + 1; i++) telemovel.send({ t: "pair.join", pairId: pairIdDeTeste() })
    let desconhecidas = 0
    let limite = 0
    for (let i = 0; i < Gateway.PAIR_JOINS_POR_MINUTO + 2; i++) {
      const resposta = await telemovel.next()
      if (resposta.t === "pair.rejected" && resposta.reason === "unknown") desconhecidas++
      if (resposta.t === "pair.rejected" && resposta.reason === "rate-limited") limite++
      if (resposta.t === "error" && resposta.code === "rate-limited") {
        expect(resposta.fatal).toBe(true)
        break
      }
    }
    expect(desconhecidas).toBe(Gateway.PAIR_JOINS_POR_MINUTO)
    expect(limite).toBe(1)
    telemovel.close()
  })

  it("tecto global de caixas vivas", async () => {
    const vivas = Gateway.PAIR_CAIXAS_VIVAS
    // Two above whatever is already live from other tests: the cap is per process.
    const a = await anfitriao()
    const b = await anfitriao()
    const c = await anfitriao()
    const sonda = pairIdDeTeste()
    a.cliente.send({ t: "pair.open", pairId: sonda })
    await a.cliente.nextOf("pair.opened")
    a.cliente.send({ t: "pair.close", pairId: sonda })
    await a.cliente.sync()
    try {
      // Opens up to the cap and counts: the first refusal must be `full`, and
      // must arrive exactly when the cap is reached.
      Gateway.PAIR_CAIXAS_VIVAS = 3
      const ids = [pairIdDeTeste(), pairIdDeTeste(), pairIdDeTeste(), pairIdDeTeste()]
      const donos = [a, b, c, a]
      const respostas: string[] = []
      for (let i = 0; i < ids.length; i++) {
        const dono = donos[i] as typeof a
        dono.cliente.send({ t: "pair.open", pairId: ids[i] as string })
        const resposta = await dono.cliente.next()
        if (resposta.t === "pair.opened") respostas.push("opened")
        else if (resposta.t === "pair.rejected") respostas.push(resposta.reason)
        else respostas.push(resposta.t)
        if (resposta.t === "keypackage.low") i-- // new account: read again
      }
      const cheias = respostas.filter((r) => r === "full").length
      const abertas = respostas.filter((r) => r === "opened").length
      expect(cheias).toBeGreaterThanOrEqual(1)
      expect(abertas).toBeLessThanOrEqual(3)
      expect(abertas + cheias).toBe(ids.length)
      a.cliente.close()
      b.cliente.close()
      c.cliente.close()
    } finally {
      Gateway.PAIR_CAIXAS_VIVAS = vivas
    }
  })

  it("nada de uma caixa fica na base", async () => {
    const pc = await anfitriao()
    const pairId = pairIdDeTeste()
    pc.cliente.send({ t: "pair.open", pairId })
    await pc.cliente.nextOf("pair.opened")
    const telemovel = await semConta()
    telemovel.send({ t: "pair.join", pairId })
    await telemovel.nextOf("pair.joined")
    await pc.cliente.nextOf("pair.joined")
    telemovel.send({ t: "pair.send", pairId, payload: "segredo-em-claro-de-teste" })
    await pc.cliente.nextOf("pair.message")
    telemovel.close()
    pc.cliente.close()
    // The whole database, byte by byte: neither the pairId nor the payload anywhere.
    const { readFileSync } = await import("node:fs")
    const base = readFileSync(join(dataDir, "test.sqlite"))
    expect(base.includes(pairId)).toBe(false)
    expect(base.includes("segredo-em-claro-de-teste")).toBe(false)
  })
})

describe("batimento do websocket", () => {
  /*
    Nginx in front of orwell.pt cuts a idle websocket after one hour
    (`proxy_read_timeout 1h`). An idle client was cut every hour and,
    on each reconnection, ran the profile repair round on all channels again:
    two messages per channel per hour, measured in the production database on
    October 18, 2026. The server now sends a control ping regularly; the browser
    responds on its own with a pong, and neither counts as a frame to the client.
    */
  it("o servidor envia pings de controlo a uma ligação parada", async () => {
    const anterior = Gateway.BATIMENTO_MS
    Gateway.BATIMENTO_MS = 40
    const socket = new WebSocket(gatewayUrl)
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("open", () => resolve())
        socket.once("error", reject)
      })
      const ping = await new Promise<boolean>((resolve) => {
        const prazo = setTimeout(() => resolve(false), 2000)
        socket.once("ping", () => {
          clearTimeout(prazo)
          resolve(true)
        })
      })
      expect(ping).toBe(true)
    } finally {
      Gateway.BATIMENTO_MS = anterior
      socket.close()
    }
  })
})

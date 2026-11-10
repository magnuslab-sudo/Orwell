import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Session, Vault, type VaultBackend } from "@enclave/client-core"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"
import { parseServerName } from "@enclave/protocol"

/**
 * Feed delivery between two real accounts, end to end.
 *
 * Everything here is real: a real gateway, real MLS groups, two real
 * `Session` objects with their own vaults. The scenario is exactly the one
 * people reported broken on orwell.pt — A seats B in A's feed, A publishes,
 * and B has to actually see it — so a regression here is a regression there.
 */

/**
 * Ephemeral port. A fixed port per suite guarantees collisions, with a
 * forgotten development server, or with another suite, and the symptom is the
 * entire suite dying on startup with EADDRINUSE.
 *
 * Here the server name matters more than elsewhere: these clients are
 * `Session` for real, and a `Session` marks the number from its own address
 * (see `gatewayUrl` in `session.ts`). The name must carry the assigned port,
 * and that is only known after `listen`.
 */
let PORT: number
let HOME: ReturnType<typeof parseServerName>

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

interface Peer {
  session: Session
  address: string
  seen: { channel: string; sender: string; payload: Record<string, unknown> }[]
  /** Every rekey this peer lived through — the thing that costs it history. */
  epochs: string[]
}

async function peer(nome: string): Promise<Peer> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe-de-teste")
  const session = new Session(vault)
  const identity = await session.createIdentity(`localhost:${PORT}`)
  const seen: Peer["seen"] = []
  const epochs: string[] = []
  session.on("message", (event) => {
    seen.push({
      channel: event.channel,
      sender: event.sender,
      payload: event.payload as unknown as Record<string, unknown>,
    })
  })
  session.on("epoch", (event) => epochs.push(`${event.channel}@${event.epoch}`))
  await session.connect()
  // Real accounts have a name, and the name is what a silent feed reader
  // republishes into the channel on every epoch — the evidence `seat` reads
  // to tell a live member from a dead one. A nameless peer would be testing a
  // person who does not exist on orwell.pt.
  await session.updateProfile({ displayName: nome, donations: [] })
  return { session, address: identity.address, seen, epochs }
}

/** Poll until the predicate holds, or give up — delivery is asynchronous. */
async function until(predicate: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timed out waiting for: ${label}`)
}

function postsIn(reader: Peer, channel: string): Record<string, unknown>[] {
  return reader.seen.filter((m) => m.channel === channel && m.payload["t"] === "post").map((m) => m.payload)
}

/**
 * The feed as the screen shows it: what is stored on this device, with
 * tombstones honored.
 *
 * Counted from the vault and not from the list of what came over the wire,
 * because they are not the same: the wire says what arrived, the vault says
 * what stays, and the vault is what an app reload reads. A delete that only
 * deleted from the list would come back with the next window.
 */
function muralDe(quem: Peer, channel: string): string[] {
  const guardadas = quem.session.history(channel)
  const apagadas = new Set(
    guardadas
      .filter((entrada) => entrada.payload["t"] === "redact")
      .map((entrada) => String(entrada.payload["target"])),
  )
  return guardadas
    .filter((entrada) => entrada.payload["t"] === "post" && !apagadas.has(String(entrada.payload["id"])))
    .map((entrada) => String(entrada.payload["caption"]))
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-feed-"))
  const config: ServerConfig = {
    // Startup name, replaced once we know the assigned port.
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
  HOME = parseServerName(`localhost:${PORT}`)
  config.serverName = HOME
}, 30000)

afterAll(async () => {
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe("entrega do feed entre duas contas", () => {
  it("uma publicação feita DEPOIS do assento chega ao leitor e abre", async () => {
    const autor = await peer("Autor")
    const leitor = await peer("Leitor")

    // The reader must be seated before the post exists: forward secrecy is
    // the whole point of the group, so this order is not incidental.
    await autor.session.acceptFollower(leitor.address)
    const feed = autor.session.feedChannel

    await until(() => leitor.session.channels.includes(feed), "o leitor entra no feed do autor")

    await autor.session.post("olá do autor #teste", ["teste"])

    await until(() => postsIn(leitor, feed).length > 0, "a publicação chega ao leitor")

    const chegou = postsIn(leitor, feed)[0] as { caption?: string; tags?: string[] }
    expect(chegou.caption).toBe("olá do autor #teste")
    expect(chegou.tags).toEqual(["teste"])

    // And the author sees their own — the half that was never broken, kept
    // here so the test tells the two apart if one of them regresses.
    expect(postsIn(autor, feed).length).toBeGreaterThan(0)

    autor.session.disconnect()
    leitor.session.disconnect()
  }, 40000)

  it("entrega nos dois sentidos: cada um lê o feed do outro", async () => {
    const ana = await peer("Ana")
    const bruno = await peer("Bruno")

    await ana.session.acceptFollower(bruno.address)
    await bruno.session.acceptFollower(ana.address)

    const feedAna = ana.session.feedChannel
    const feedBruno = bruno.session.feedChannel

    await until(() => bruno.session.channels.includes(feedAna), "bruno entra no feed da ana")
    await until(() => ana.session.channels.includes(feedBruno), "ana entra no feed do bruno")

    await ana.session.post("publicação da ana", [])
    await bruno.session.post("publicação do bruno", [])

    await until(() => postsIn(bruno, feedAna).length > 0, "bruno lê a ana")
    await until(() => postsIn(ana, feedBruno).length > 0, "ana lê o bruno")

    expect((postsIn(bruno, feedAna)[0] as { caption?: string }).caption).toBe("publicação da ana")
    expect((postsIn(ana, feedBruno)[0] as { caption?: string }).caption).toBe("publicação do bruno")

    ana.session.disconnect()
    bruno.session.disconnect()
  }, 40000)

  it("re-assentar um leitor não o deixa surdo às publicações seguintes", async () => {
    const autor = await peer("Autor")
    const leitor = await peer("Leitor")

    await autor.session.acceptFollower(leitor.address)
    const feed = autor.session.feedChannel
    await until(() => leitor.session.channels.includes(feed), "o leitor entra no feed")

    await autor.session.post("antes do re-assento", [])
    await until(() => postsIn(leitor, feed).length === 1, "primeira publicação chega")

    // A second seating pass is exactly what the circle repair and the
    // bootstrap do on reconnect. A reader who is demonstrably alive must be
    // left alone: re-seating them rekeys the group and forward secrecy then
    // takes every earlier post away from them, which is the bug this whole
    // file exists to pin down.
    const rekeysAntes = leitor.epochs.length
    await autor.session.acceptFollower(leitor.address)
    await autor.session.post("depois do re-assento", [])

    await until(() => postsIn(leitor, feed).length === 2, "a publicação pós-re-assento chega")
    const captions = postsIn(leitor, feed).map((p) => (p as { caption?: string }).caption)
    expect(captions).toContain("depois do re-assento")
    // The repair pass changed nothing, so it cost nothing.
    expect(leitor.epochs.length).toBe(rekeysAntes)

    autor.session.disconnect()
    leitor.session.disconnect()
  }, 40000)

  /**
   * Deleting deletes for the reader, and does not come back.
   *
   * Reported by the owner in production: *"when I delete them it only deletes
   * for me, it does not delete for the others"*. Here it is whole, with the
   * real server, because the two halves of the fault live in different places
   * and one without the other gives green: the request has to arrive, and the
   * feed that gets rebroadcast to whoever comes next must respect it. Without
   * the second, delete was a postponement, the post came back on everyone's
   * screen in the next friendship, and whoever hit the button never knew.
   */
  it("uma publicação apagada sai do mural de quem lê, e não volta com quem chega", async () => {
    const autor = await peer("Autor")
    const leitor = await peer("Leitor")
    const terceiro = await peer("Terceiro")

    await autor.session.acceptFollower(leitor.address)
    const feed = autor.session.feedChannel
    await until(() => leitor.session.channels.includes(feed), "o leitor entra no feed")

    await autor.session.post("fica", [])
    await autor.session.post("some", [])
    await until(() => muralDe(leitor, feed).length === 2, "as duas publicações chegam ao leitor")

    const some = autor.session
      .history(feed)
      .find((entrada) => entrada.payload["t"] === "post" && entrada.payload["caption"] === "some")
    await autor.session.deletePost(String(some?.payload["id"]))

    await until(() => muralDe(leitor, feed).length === 1, "o apagamento chega ao leitor")
    expect(muralDe(leitor, feed)).toEqual(["fica"])
    expect(muralDe(autor, feed)).toEqual(["fica"])

    // And whoever comes next gets the feed that exists. This step was broken:
    // the feed was rebroadcast from history, tombstones aside, and the deleted
    // post rose again for anyone who never heard it deleted.
    await autor.session.acceptFollower(terceiro.address)
    await until(() => muralDe(terceiro, feed).length > 0, "o terceiro recebe o mural")
    expect(muralDe(terceiro, feed)).toEqual(["fica"])

    // And no one got the same post twice because it was said twice, which was
    // the other complaint, and comes from the same mechanism.
    expect(muralDe(leitor, feed)).toEqual(["fica"])
    expect(muralDe(autor, feed)).toEqual(["fica"])

    autor.session.disconnect()
    leitor.session.disconnect()
    terceiro.session.disconnect()
  }, 60000)
})

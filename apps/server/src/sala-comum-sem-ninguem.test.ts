import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Session, Vault, type VaultBackend } from "@enclave/client-core"
import { parseServerName, type ServerName } from "@enclave/protocol"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"

/**
 * Join the common room with nobody on the other side.
 *
 * This proves what the rest of the system could not do, and could not do for
 * a reason that was not a bug at all: only a member can admit, because only a
 * member has the keys, and a sleeping member admits no one. Two accounts
 * registered at 01:46 on August 20, 2026 on a server where no member was
 * online stayed out, and stayed out indefinitely: the request is a frame, the
 * server does not save it, and when the founder connected 71 minutes later
 * there was nothing to tell him.
 *
 * What this file measures is the new gate: a `GroupInfo` that allows external
 * joins, left on the server, which a newcomer picks up to add itself to the
 * tree. Nobody awake, nobody authorizing, and it gets in.
 *
 * With real accounts and a real server, on both sides. This is the only
 * proof that matters here: the suite already passed 320/320 with all critical
 * defenses removed, because the tests built the network format by hand.
 */

let enclave: Enclave
let dataDir: string
let PORT = 0
let HOME: ServerName
let COMUM = ""

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
}

/** A new account, connected, with profile published and still outside the common room. */
async function conta(nome: string): Promise<Peer> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe-de-teste")
  const session = new Session(vault)
  const identity = await session.createIdentity(`localhost:${PORT}`)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  return { session, address: identity.address }
}

async function until(predicate: () => boolean, label: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`esgotou o tempo à espera de: ${label}`)
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-sozinho-"))
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
  HOME = parseServerName(`localhost:${PORT}`)
  config.serverName = HOME
  COMUM = `!orwell:${HOME}`
  config.commonRoom = COMUM
}, 60_000)

afterAll(async () => {
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe("a sala comum com a casa vazia", () => {
  it("quem chega entra sozinho, sem estar nenhum membro ligado", async () => {
    // The founder creates the room, leaves the gate in place, and goes away. This is what
    // production has at two in the morning.
    const fundador = await conta("Fundador")
    await fundador.session.ensureCommonRoom()
    await until(() => fundador.session.channels.includes(COMUM), "a sala é criada")
    await until(() => enclave.store.hasGroupInfo(COMUM), "o cartão fica no servidor")
    fundador.session.disconnect()

    // And now the two accounts in the small hours, one after the other, with the
    // house empty. The second proves something as important as the first: the gate
    // resets by itself, because whoever joins leaves the next card.
    const primeira = await conta("Madrugada")
    await primeira.session.ensureCommonRoom()
    await until(() => primeira.session.channels.includes(COMUM), "a primeira entra sem ninguém")
    await until(() => enclave.store.hasGroupInfo(COMUM), "a primeira repõe o cartão")

    const segunda = await conta("Outra")
    await segunda.session.ensureCommonRoom()
    await until(() => segunda.session.channels.includes(COMUM), "a segunda entra sem ninguém")

    // And the founder, when he returns, finds them inside: the commits that bring
    // him up to date with their joins were waiting for him on the server.
    await fundador.session.connect()
    await until(
      () => fundador.session.membersOf(COMUM).map(String).includes(primeira.address) &&
        fundador.session.membersOf(COMUM).map(String).includes(segunda.address),
      "o fundador vê as duas na sala quando volta",
    )

    expect(fundador.session.membersOf(COMUM).sort()).toEqual(
      [fundador.address, primeira.address, segunda.address].sort(),
    )

    primeira.session.disconnect()
    segunda.session.disconnect()
    fundador.session.disconnect()
  }, 120_000)
})

describe("a porta que se repõe sozinha", () => {
  it("um membro que se liga repõe o cartão que faltava", async () => {
    // The case that retrying does not cover: whoever picked up the card closed the
    // app before publishing the next one. In a quiet room the epoch does not
    // move again, and without this the gate would stay unset for weeks.
    const membro = await conta("Membro")
    await membro.session.ensureCommonRoom()
    await until(() => membro.session.channels.includes(COMUM), "entra na sala")
    await until(() => enclave.store.hasGroupInfo(COMUM), "há cartão")

    membro.session.disconnect()
    expect(enclave.store.takeGroupInfo(COMUM)).toBeDefined()
    expect(enclave.store.hasGroupInfo(COMUM)).toBe(false)

    await membro.session.connect()
    await membro.session.ensureCommonRoom()
    await until(() => enclave.store.hasGroupInfo(COMUM), "o membro repõe a porta ao ligar-se")
    membro.session.disconnect()
  }, 120_000)
})

import { Session, Vault, type VaultBackend } from "@enclave/client-core"
import { parseServerName } from "@enclave/protocol"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"

/**
 * The account channel belongs to the account, and to no one else (review of wave 1 of phase 5,
 * B1).
 *
 * In phase 5 the channel was `!self-<id>`, and the gateway saw it as an opaque group channel:
 * whoever claimed it first got it. Eve created the group with the name of Ana's account channel,
 * invited her, and Ana's device joined and sent Eve the entire state (read markers, archive,
 * blocks, preferences, friends list). In 1.0 the address is opaque and the client does the guarding.
 *
 * For real: the gateway, the MLS groups, two `Session` objects with their own vaults.
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

async function conta(nome: string): Promise<Conta> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe-de-teste")
  const session = new Session(vault)
  abertas.push(session)
  const identidade = await session.createIdentity(`localhost:${PORT}`)
  const avisos: string[] = []
  session.on("status", (evento) => {
    if (evento.code) avisos.push(evento.code)
  })
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  return { session, vault, address: identidade.address, avisos }
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-canal-da-conta-"))
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
})

afterAll(async () => {
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe("o canal da conta é só da conta", () => {
  /*
    1.0 "Arca", slice 3: the account channel is `moradaDaConta`, derived from
    Ana's private key. Eve cannot compute it, and the server no longer knows
    whose it is (no name). Here Eve is handed it (a leak), and the guard
    moves to Ana's client (`#confiarNoCanalDaConta`): a Welcome for an
    account channel with foreign leaves is not opened, and none of the
    state goes to Eve.
  */
  it("a Eve cria o canal da conta da Ana (a morada fugiu) e convida-a: a Ana recusa o Welcome", async () => {
    const ana = await conta("Ana")
    const eve = await conta("Eve")
    const alheio = ana.session.canalDaConta
    expect(alheio.startsWith("!self-")).toBe(false)

    await eve.session.createSpaceChannel(alheio)
    await eve.session.seat(alheio, ana.address).catch(() => {})
    await esperar(1_500)
    await ana.session.sincronizarAgora().catch(() => {})
    await esperar(1_000)

    // Ana did not join: she does not have the group, and the warning comes from the client's guard.
    expect(ana.vault.contents.groups[alheio]).toBeUndefined()
    expect(ana.avisos).toContain("account-channel-foreign")
  }, 30_000)
})

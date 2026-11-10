import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Session, Vault, type VaultBackend } from "@enclave/client-core"
import { parseServerName, type ServerName } from "@enclave/protocol"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"

/** The session vault is private; tests read and modify it on purpose. */
const cofreDe = (session: Session): Vault => (session as unknown as { vault: Vault }).vault

/**
 * The common room with real accounts, which is how people get in.
 *
 * `common-room.test.ts` locks the SERVER guard, with raw sockets. This locks
 * what happens on the client side after the guard lets it through: a newcomer is
 * admitted via `channel.rejoin.request` → `#reseat`, a different path from the
 * `seat` the other files exercise, and it is the path everyone takes when they
 * open an account on a server with a common room.
 *
 * Written on 18 August 2026 for the owner's report: *"she is seeing the first
 * word of the address instead of the username"*, with the detail that makes it
 * diagnostic, **she sees the right name of one user and not the others**.
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
  seen: { channel: string; sender: string; payload: Record<string, unknown> }[]
}

/**
 * A profile picture as large as the ones people actually upload.
 *
 * Size is the variable that matters: a profile with a portrait goes over a
 * hundred thousand characters and one without has two hundred. If there were a
 * cap somewhere along the way, the asymmetry in the report (one name arrives
 * and the other does not) would come from here.
 */
function retrato(kb: number): string {
  return `data:image/png;base64,${"A".repeat(kb * 1024)}`
}

async function peer(nome: string, avatarDataUrl?: string): Promise<Peer> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe-de-teste")
  const session = new Session(vault)
  const identity = await session.createIdentity(`localhost:${PORT}`)
  const seen: Peer["seen"] = []
  session.on("message", (event) => {
    seen.push({
      channel: event.channel,
      sender: event.sender,
      payload: event.payload as unknown as Record<string, unknown>,
    })
  })
  await session.connect()
  await session.updateProfile({
    displayName: nome,
    donations: [],
    ...(avatarDataUrl ? { avatarDataUrl } : {}),
  })
  await session.ensureCommonRoom()
  return { session, address: identity.address, seen }
}

async function until(predicate: () => boolean, label: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`esgotou o tempo à espera de: ${label}`)
}

/**
 * The name this device would show for this person.
 *
 * Read from the vault DIRECTORY, not from the seen-messages list: it is what
 * the interface reads (`useDirectory` is seeded from `profile.directory()`), and a
 * profile that arrives and is not saved produces exactly the same defect as a
 * profile that never arrives. Empty means the interface falls back to
 * `shortAddress`, the first word of the address, which is the owner's report
 * word for word.
 */
function nomeQueVe(quem: Peer, de: string): string {
  const entrada = cofreDe(quem.session).contents.directory[de]
  if (!entrada) return ""
  return String((entrada.payload as { displayName?: unknown }).displayName ?? "")
}

/** What the interface puts in place of the name when it knows none. */
function primeiraPalavraDoEndereco(address: string): string {
  return (address.replace(/^@/, "").split(":")[0] ?? "").split("-")[0] ?? ""
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-comum-"))
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

  dono = await peer("Duarte", retrato(120))
  await until(() => dono.session.channels.includes(COMUM), "o dono cria a sala comum")
}, 60_000)

afterAll(async () => {
  dono?.session.disconnect()
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

/**
 * The owner, who stays connected through the entire file.
 *
 * There is ONE common room per server and it is not recreated: whoever founds it
 * must stay around to admit newcomers, otherwise the second test asks to join a
 * room with no one listening. It is also what production has: the owner is the
 * oldest account and the one that is always connected.
 *
 * And it carries a portrait on purpose, because that is the difference between
 * his account and the new ones: in production the owner has a profile photo and
 * newcomers do not.
 */
let dono: Peer

describe("os nomes na sala comum", () => {
  it("quem chega vê o nome de toda a gente que já lá estava", async () => {
    const segundo = await peer("Segundo")
    await until(() => segundo.session.channels.includes(COMUM), "o segundo é admitido")
    await until(() => nomeQueVe(segundo, dono.address) === "Duarte", "o segundo vê o nome do dono")

    // And now her, the one who complained.
    const ela = await peer("Joana")
    await until(() => ela.session.channels.includes(COMUM), "ela é admitida")

    await until(() => nomeQueVe(ela, dono.address) === "Duarte", "ela vê o nome do dono")
    await until(() => nomeQueVe(ela, segundo.address) === "Segundo", "ela vê o nome do segundo")

    // And stated the other way round, which is how the defect was reported: neither of them
    // shows as the first word of the address.
    expect(nomeQueVe(ela, dono.address)).not.toBe(primeiraPalavraDoEndereco(dono.address))
    expect(nomeQueVe(ela, segundo.address)).not.toBe(primeiraPalavraDoEndereco(segundo.address))

    segundo.session.disconnect()
    ela.session.disconnect()
  }, 120_000)

  /**
   * And the case that republishing on GROWTH does not cover by design: a member
   * who was offline when the group grew.
   *
   * `#noteMembership` lives in memory and is not saved. A member who had the app
   * closed when someone joined does not go through the receive path at that moment;
   * when they return, they recover the commit and that is when the count
   * happens. It is the narrowest path in the whole mechanism, and the one that
   * would explain an asymmetry (the name of whoever was online arrives, the name
   * of whoever was offline does not).
   */
  it("quem estava fora quando ela entrou dá-lhe o nome ao voltar", async () => {
    const ausente = await peer("Ausente")
    await until(() => ausente.session.channels.includes(COMUM), "o ausente entra na sala comum")

    // Close the app. The owner stays, and he admits whoever arrives.
    ausente.session.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 300))

    const ela = await peer("Recemchegada")
    await until(() => ela.session.channels.includes(COMUM), "ela é admitida com o outro fora")
    await until(() => nomeQueVe(ela, dono.address) === "Duarte", "vê o nome de quem a admitiu")

    // E o ausente volta.
    await ausente.session.connect()

    await until(
      () => nomeQueVe(ela, ausente.address) === "Ausente",
      "ela passa a ver o nome de quem estava fora quando entrou",
    )
    expect(nomeQueVe(ela, ausente.address)).toBe("Ausente")

    ausente.session.disconnect()
    ela.session.disconnect()
  }, 120_000)
})

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { Session, Vault, type VaultBackend } from "@enclave/client-core"
import { parseServerName, type ServerName } from "@enclave/protocol"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"

/**
 * "No name" in the common room (3/11/2026, the Reddit account wave).
 *
 * Whoever joins through the common room gate (the card) gets no portrait, and a name
 * only reached them from members who were online when they joined: online members
 * republish their profile when the room grows. Members who were offline never sent it,
 * and the new account saw "No name" for all of them, forever or until each one
 * came back. Measured with the script `scripts/e2e-sem-nome.mjs`: 12 offline accounts,
 * 12 "No name" for the account that joined next.
 *
 * The fix: a client that sees someone without a name asks for it (`pedirPerfis`), and
 * an online member replies with the profile the author signed. With real accounts and
 * server, as in `sala-comum-sem-ninguem.test.ts`.
 */

let enclave: Enclave
let dataDir: string
let PORT = 0
let HOME: ServerName
let COMUM = ""
const abertas: Session[] = []

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
  vault: Vault
  address: string
}

/** A new account, in Setup order: connect, set the name, and join the common room. */
async function conta(nome: string): Promise<Peer> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe-de-teste")
  const session = new Session(vault)
  abertas.push(session)
  const identity = await session.createIdentity(`localhost:${PORT}`)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  await session.ensureCommonRoom()
  await until(() => session.channels.includes(COMUM), `${nome} entra na sala comum`)
  return { session, vault, address: identity.address }
}

async function until(predicate: () => boolean, label: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`esgotou o tempo à espera de: ${label}`)
}

const nomeQueVe = (quem: Peer, de: Peer): unknown => quem.vault.contents.directory[de.address]?.payload["displayName"]

/** The profile report frames that went out (all sessions in this process). */
let respostasDePerfis = 0
const enviar = Session.prototype.send
Session.prototype.send = function (this: Session, canal, payload) {
  const relatos = (payload as { relatos?: { q?: string } }).relatos
  if (payload.t === "typing" && relatos?.q?.startsWith("pf.")) respostasDePerfis += 1
  return enviar.call(this, canal, payload)
}

let espera = 0
let acaso = 0
beforeAll(async () => {
  espera = Session.ESPERA_DO_PEDIDO_DE_PERFIS_MS
  acaso = Session.ACASO_DO_PEDIDO_DE_PERFIS_MS
  Session.ESPERA_DO_PEDIDO_DE_PERFIS_MS = 1_500
  Session.ACASO_DO_PEDIDO_DE_PERFIS_MS = 0
  dataDir = mkdtempSync(join(tmpdir(), "enclave-sem-nome-"))
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

afterEach(() => {
  for (const session of abertas.splice(0)) session.disconnect()
})

afterAll(async () => {
  Session.ESPERA_DO_PEDIDO_DE_PERFIS_MS = espera
  Session.ACASO_DO_PEDIDO_DE_PERFIS_MS = acaso
  Session.prototype.send = enviar
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe("os nomes na sala comum, para quem entra", () => {
  it("quem entra vê o nome de quem estava desligado, e responde um membro só", async () => {
    const ana = await conta("Ana")
    const marta = await conta("Marta")
    // Bruno joins, Ana and Marta get his name, and Bruno leaves.
    const bruno = await conta("Bruno")
    await until(() => nomeQueVe(ana, bruno) === "Bruno" && nomeQueVe(marta, bruno) === "Bruno", "a Ana e a Marta sabem o nome do Bruno")
    bruno.session.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 3_000))

    const antes = respostasDePerfis
    // Carla arrives with Bruno offline: nobody there would tell her his name.
    const carla = await conta("Carla")
    await until(() => nomeQueVe(carla, ana) === "Ana" && nomeQueVe(carla, marta) === "Marta", "a Carla sabe os nomes de quem está ligado")
    await until(() => nomeQueVe(carla, bruno) === "Bruno", "a Carla sabe o nome do Bruno, desligado", 20_000)

    // Two could answer (Ana and Marta), and one did: the other stayed quiet.
    await new Promise((resolve) => setTimeout(resolve, 6_000))
    expect(respostasDePerfis - antes).toBe(1)
  }, 120_000)

  it("uma conta que já estava sem nome cura-se ao ligar outra vez", async () => {
    const ana = await conta("Ana")
    const bruno = await conta("Bruno")
    await until(() => nomeQueVe(ana, bruno) === "Bruno", "a Ana sabe o nome do Bruno")
    bruno.session.disconnect()
    // Carla joins with Ana offline: with nobody there, she gets neither name.
    ana.session.disconnect()
    const carla = await conta("Carla")
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    expect(nomeQueVe(carla, bruno)).toBeUndefined()

    // Ana returns; Carla refreshes and connects again (the new client in production).
    await ana.session.connect()
    await until(() => nomeQueVe(carla, ana) === "Ana", "a Carla sabe o nome da Ana, que voltou")
    carla.session.disconnect()
    await carla.session.connect()
    await until(() => nomeQueVe(carla, bruno) === "Bruno", "a Carla sabe o nome do Bruno depois de ligar", 20_000)
  }, 120_000)
})

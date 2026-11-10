import { memberLeaves, type GroupSession } from "@enclave/crypto"
import { parseServerName, type UserAddress } from "@enclave/protocol"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildServer, type Enclave } from "../../../apps/server/src/app.js"
import type { ServerConfig } from "../../../apps/server/src/config.js"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The partition fix against the server in production today.
 *
 * The other two partition files use a reduced server, a script and
 * a relay, and the relay even applies the new rule of one commit per epoch. This one uses the
 * real server, in process, in the version WITHOUT that rule: the case of a
 * new client talking to a server that doesn't have it yet, and proof that
 * waiting for the echo doesn't hang anything. The echo of a member commit comes via
 * the subscription; the echo of a card entry comes because lifting the card already puts
 * the connection on the channel (`channel.groupinfo.take` in `gateway.ts`).
 *
 * We don't touch `apps/server`: we import and use it as its tests use it.
 */

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

let enclave: Enclave
let dataDir: string
let porta = 0
let COMUM = ""
const abertas: Session[] = []

interface Conta {
  nome: string
  session: Session
  address: string
  codigos: string[]
}

async function conta(nome: string): Promise<Conta> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe-de-teste")
  const session = new Session(vault)
  abertas.push(session)
  const codigos: string[] = []
  session.on("status", (estado) => {
    if (estado.code) codigos.push(estado.code)
  })
  const { address } = await session.createIdentity(`localhost:${porta}`)
  await session.connect()
  return { nome, session, address, codigos }
}

async function ate(condicao: () => boolean, rotulo: string, prazoMs = 30_000): Promise<void> {
  const limite = Date.now() + prazoMs
  while (Date.now() < limite) {
    if (condicao()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`esgotou o tempo à espera de: ${rotulo}`)
}

function ramo(quem: Conta): string {
  const grupo = quem.session.groupFor(COMUM)
  if (!grupo) return "sem grupo"
  return `${grupo.state.groupContext.epoch}:${[...grupo.state.groupContext.confirmedTranscriptHash].join(",")}`
}

function mesmoRamo(contas: Conta[]): boolean {
  return new Set(contas.map(ramo)).size === 1 && contas.every((quem) => quem.session.membersOf(COMUM).length === contas.length)
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-particao-"))
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
  porta = (enclave.app.server.address() as { port: number }).port
  config.serverName = parseServerName(`localhost:${porta}`)
  COMUM = `!orwell:localhost:${porta}`
  config.commonRoom = COMUM
}, 60_000)

afterAll(async () => {
  for (const session of abertas) session.disconnect()
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe("contra o servidor real, sem a regra de um commit por epoch", () => {
  it("a entrada espera pelo eco, a reentrada do mesmo aparelho não duplica a folha, e a sala continua aberta", async () => {
    const fundador = await conta("fundador")
    await ate(() => fundador.session.channels.includes(COMUM), "a sala é criada")
    await ate(() => enclave.store.hasGroupInfo(COMUM), "o cartão fica no servidor")

    const bento = await conta("bento")
    await ate(() => mesmoRamo([fundador, bento]), "o bento entra pelo cartão")
    await ate(() => enclave.store.hasGroupInfo(COMUM), "o bento repõe o cartão")

    // Bento forgets the room and comes back through the door, with the same device.
    await bento.session.forgetChannel(COMUM)
    await bento.session.ensureCommonRoom()
    await ate(() => mesmoRamo([fundador, bento]), "o bento volta a entrar")
    expect(memberLeaves(fundador.session.groupFor(COMUM) as GroupSession, bento.address as UserAddress)).toHaveLength(1)
    expect(bento.codigos).toContain("rejoin-resync")

    // Whoever comes next enters by card...
    await ate(() => enclave.store.hasGroupInfo(COMUM), "há cartão depois da reentrada")
    const nuno = await conta("nuno")
    await ate(() => mesmoRamo([fundador, bento, nuno]), "o nuno entra pelo cartão")

    // ...and without a card at the door, by admission from whoever is there.
    await ate(() => enclave.store.hasGroupInfo(COMUM), "há cartão depois do nuno")
    enclave.store.takeGroupInfo(COMUM)
    const marta = await conta("marta")
    await ate(() => mesmoRamo([fundador, bento, nuno, marta]), "a marta é admitida", 60_000)

    // No commit was left without a verdict against this server.
    for (const quem of [fundador, bento, nuno, marta]) expect(quem.codigos).not.toContain("commit-unconfirmed")
  }, 150_000)
})

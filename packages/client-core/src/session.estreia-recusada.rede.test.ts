import { moradaDeSala } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
// Only the server's harness server, which spins up a real homeserver on an ephemeral port.
// The sessions are from this package (`./session.js`).
import { levantarServidor, type ServidorDeTeste } from "../../../apps/server/testes/cliente-de-teste.js"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * An address the server does not start up is refused in the core, before anything.
 *
 * Since 1.0 "Arca" 6a.1 (738311af) the server only opens new channels with
 * opaque address or the common room (`#formaFechada` in `gateway.ts`). Until
 * then `createSpaceChannel` accepted `!nome:servidor`, saved the group, sent
 * the commit, and only then fell into `channel-orphaned`. Now it refuses right
 * away, by the same rule (`podeEstrearCanal`, in `@enclave/protocol`), and
 * nothing is left behind: neither group nor warning.
 */

class CofreEmMemoria implements VaultBackend {
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

async function conta(servidor: ServidorDeTeste): Promise<Session> {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-passe-de-teste")
  const session = new Session(vault)
  await session.createIdentity(servidor.casa)
  await session.connect()
  abertas.push(session)
  return session
}

async function ate(predicado: () => boolean, rotulo: string, prazoMs = 30_000): Promise<void> {
  const inicio = Date.now()
  while (Date.now() - inicio < prazoMs) {
    if (predicado()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`tempo esgotado: ${rotulo}`)
}

let servidor: ServidorDeTeste
const abertas: Session[] = []
// One server per test: the common room is born once, in the first session that wants it,
// and the second test needs to be that session.
beforeEach(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterEach(async () => {
  for (const s of abertas.splice(0)) s.disconnect()
  await servidor?.fechar()
})

describe("a estreia de um canal com uma morada que o servidor não abre", () => {
  it("o núcleo recusa a morada legível logo, sem grupo nem aviso", async () => {
    const ana = await conta(servidor)
    const avisos: string[] = []
    ana.on("status", (s) => {
      if (s.code) avisos.push(s.code)
    })
    const legivel = `!sincronia-antiga:${servidor.casa}`

    await expect(ana.createSpaceChannel(legivel, "sincronia-antiga")).rejects.toThrow(
      "the server does not open this channel address",
    )
    await expect(ana.createSpace(legivel)).rejects.toThrow("the server does not open this channel address")

    // Give time for a server response that came from a sent commit.
    await new Promise((r) => setTimeout(r, 500))
    expect(ana.channels).not.toContain(legivel)
    expect(avisos).not.toContain("channel-orphaned")
    expect(avisos).not.toContain("commit-unconfirmed")
  }, 30_000)

  it("a morada opaca e a sala comum continuam a estrear-se", async () => {
    const ana = await conta(servidor)
    // The common room (`!orwell:<casa>`, readable) creates itself on the first session
    // that wants it, via `createSpace`. The server does the same, as the exception.
    await ate(() => ana.channels.includes(servidor.sala), "a sala comum nasce")

    const sala = moradaDeSala(servidor.casa)
    await ana.createSpaceChannel(sala, "adega")
    expect(ana.channels).toContain(sala)
  }, 30_000)
})

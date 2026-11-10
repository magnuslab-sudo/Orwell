import { moradaDeSala } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
// Only the server harness server, which brings up a real homeserver on an
// ephemeral port. The sessions are from this package (`./session.js`), not from the
// `dist` that the harness uses: it is the code of this slice that is measured.
import { levantarServidor, type ServidorDeTeste } from "../../../apps/server/testes/cliente-de-teste.js"
import { formatShortInviteLink, novoCodigoDoConvite, parseInviteLink, parseShortInviteLink, Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The short invite connection against a real server (1.0 "Ark", slice 5b-2).
 *
 * Ana creates the invite and receives the short code; Bia enters by it: `invite.resolve`
 * with the short code, the check of `codeHash` against the code the
 * connection brings, and the redemption by proof. A short code with the code swapped stops
 * on the device of whoever opens it, and the invite stays unused.
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

async function conta(servidor: ServidorDeTeste, nome: string): Promise<Session> {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-passe-de-teste")
  const session = new Session(vault)
  await session.createIdentity(servidor.casa)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
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
beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterAll(async () => {
  await servidor?.fechar()
})
afterEach(() => {
  for (const s of abertas.splice(0)) s.disconnect()
})

describe("a ligação curta de convite, com sessões a sério", () => {
  it("a Ana cria a curta, e a Bia entra por ela", async () => {
    const ana = await conta(servidor, "Ana")
    const bia = await conta(servidor, "Bia")
    const sala = moradaDeSala(servidor.casa)
    await ana.createSpaceChannel(sala)

    const { longa, curta } = await ana.criarConvite(sala)
    expect(curta).not.toBeNull()
    const lida = parseShortInviteLink(curta as string)
    expect(curta).toBe(`http://${servidor.casa}/c#${lida?.codigoCurto}.${lida?.code}`)
    // The two connections are the same invite: the same code.
    expect(parseInviteLink(longa)?.code).toBe(lida?.code)
    expect(lida?.code).toHaveLength(16)

    // Resolving gives the long form, with the channel the server stored.
    const resolvida = await bia.resolverConvite(curta as string)
    expect(parseInviteLink(resolvida)).toEqual({ server: servidor.casa, channel: sala, code: lida?.code })

    await bia.redeemInvite(curta as string)
    await ate(() => bia.channels.includes(sala), "a Bia entra na sala")
  }, 120_000)

  it("uma curta com o código trocado é recusada no aparelho, e o uso fica por gastar", async () => {
    const ana = await conta(servidor, "Ana")
    const bia = await conta(servidor, "Bia")
    const sala = moradaDeSala(servidor.casa)
    await ana.createSpaceChannel(sala)
    const { curta } = await ana.criarConvite(sala, { maxUses: 1 })
    const lida = parseShortInviteLink(curta as string)!

    const trocada = formatShortInviteLink(lida.server, lida.codigoCurto, novoCodigoDoConvite())
    await expect(bia.resolverConvite(trocada)).rejects.toThrow("this invite link is wrong")
    await expect(bia.redeemInvite(trocada)).rejects.toThrow("this invite link is wrong")

    // Nothing reached `invite.redeem`: the single-use invite stays at zero.
    const [convite] = await ana.listInvites(sala)
    expect(convite?.uses).toBe(0)

    // And the right connection still enters with the use that stayed there.
    await bia.redeemInvite(curta as string)
    await ate(() => bia.channels.includes(sala), "a Bia entra com a ligação certa")
  }, 120_000)

  it("um código curto que não existe diz-se com a frase do convite que já não existe", async () => {
    const carla = await conta(servidor, "Carla")
    const inexistente = formatShortInviteLink(servidor.casa, "zzzzzzzz", novoCodigoDoConvite())
    await expect(carla.resolverConvite(inexistente)).rejects.toThrow("that invite no longer exists")
  }, 60_000)

  it("o tecto de resoluções (12 por minuto por conta) diz-se com a frase do tecto", async () => {
    const carla = await conta(servidor, "Carla")
    const inexistente = formatShortInviteLink(servidor.casa, "zzzzzzzz", novoCodigoDoConvite())
    // `Gateway.RESOLUCOES_POR_MINUTO`. Each question costs one, whether the code exists or not.
    let erro: Error | null = null
    for (let i = 0; i < 20 && erro === null; i++) {
      await carla.resolverConvite(inexistente).catch((e: unknown) => {
        if (e instanceof Error && e.message !== "that invite no longer exists") erro = e
      })
    }
    expect((erro as Error | null)?.message).toBe("too many invite lookups")
  }, 60_000)

  it("de outro servidor não se pergunta nada", async () => {
    const carla = await conta(servidor, "Carla")
    await expect(carla.resolverConvite(formatShortInviteLink("outro.pt", "ab23cd45", novoCodigoDoConvite()))).rejects.toThrow(
      "that invite is from another server",
    )
  }, 60_000)
})

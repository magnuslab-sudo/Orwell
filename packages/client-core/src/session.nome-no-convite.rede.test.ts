import { DatabaseSync } from "node:sqlite"
import { moradaDeSala } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
// The harness server, for real, on an ephemeral port. The sessions
// are from this package (`./session.js`): it is the code of this slice that we test.
import { levantarServidor, type ServidorDeTeste } from "../../../apps/server/testes/cliente-de-teste.js"
import { parseInviteLink, Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The channel name in the invite query, against a real server (1.0
 * "Arca", slice 5c).
 *
 * Ana creates the invite for a room with opaque address and name "Book Club".
 * Bia opens the connection (short and long) and reads the name, opened from the
 * seal with the code that the connection brings. The server stores only the seal:
 * the name is nowhere in the database in plain text. A seal swapped in the database
 * (the one from another invite) does not open, and the query says "a channel".
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

/** The rows of `invites`, read from the server database as they are on disk. */
function linhasDosConvites(): { code_hash: string; channel: string; selo: string | null }[] {
  const base = new DatabaseSync(servidor.baseDeDados)
  try {
    return base.prepare("SELECT code_hash, channel, selo FROM invites").all() as {
      code_hash: string
      channel: string
      selo: string | null
    }[]
  } finally {
    base.close()
  }
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

describe("o nome do canal na pergunta do convite, com sessões a sério", () => {
  it("a Ana cria, a Bia abre a curta e a longa e lê o nome; o servidor tem só o selo", async () => {
    const ana = await conta(servidor, "Ana")
    const sala = moradaDeSala(servidor.casa)
    await ana.createSpaceChannel(sala, "Clube de Leitura")
    const { longa, curta } = await ana.criarConvite(sala)

    // The short one: the seal comes in the response to `invite.resolve`.
    const bia = await conta(servidor, "Bia")
    const resolvida = await bia.resolverConvite(curta as string)
    expect(await bia.nomeDoConvite(resolvida)).toEqual({ canal: "Clube de Leitura", quem: "Ana" })

    // The long one, on another account (with nothing stored): requests the seal by `codeHash`.
    const carla = await conta(servidor, "Carla")
    expect(await carla.nomeDoConvite(longa)).toEqual({ canal: "Clube de Leitura", quem: "Ana" })

    // The server stored the seal, and the name is not in the database in plain text.
    const [linha] = linhasDosConvites().filter((l) => l.channel === sala)
    expect(linha?.selo).toMatch(/^[A-Za-z0-9_-]{700,}$/)
    const base = new DatabaseSync(servidor.baseDeDados)
    try {
      const tudo = JSON.stringify(base.prepare("SELECT * FROM invites").all())
      expect(tudo).not.toContain("Clube de Leitura")
      expect(tudo).not.toContain("Clube")
    } finally {
      base.close()
    }
  }, 120_000)

  it('um selo trocado na base (o de outro convite) não abre: a pergunta diz "um canal"', async () => {
    const ana = await conta(servidor, "Ana")
    const sala = moradaDeSala(servidor.casa)
    const outra = moradaDeSala(servidor.casa)
    await ana.createSpaceChannel(sala, "Sala Verdadeira")
    await ana.createSpaceChannel(outra, "Sala Falsa")
    const { longa } = await ana.criarConvite(sala)
    await ana.criarConvite(outra)

    // Who has the database swaps the seals: the invite from `room` gets the one from `other`.
    const linhas = linhasDosConvites()
    const daOutra = linhas.find((l) => l.channel === outra)?.selo
    const daSala = linhas.find((l) => l.channel === sala)?.code_hash
    expect(daOutra && daSala).toBeTruthy()
    const base = new DatabaseSync(servidor.baseDeDados)
    try {
      base.prepare("UPDATE invites SET selo = ? WHERE code_hash = ?").run(daOutra as string, daSala as string)
    } finally {
      base.close()
    }

    const bia = await conta(servidor, "Bia")
    expect(await bia.nomeDoConvite(longa)).toBeNull()
  }, 120_000)

  it('um convite sem selo (canal sem nome, ou cliente antigo) dá "um canal"', async () => {
    const ana = await conta(servidor, "Ana")
    const sala = moradaDeSala(servidor.casa)
    await ana.createSpaceChannel(sala)
    // No name when creating means no `space.meta`: Ana has no name to seal, and the
    // invite goes without a seal, like one from a client before 5c.
    expect(ana.spaceMeta(sala)).toBeNull()
    const { longa } = await ana.criarConvite(sala)
    expect(linhasDosConvites().find((l) => l.channel === sala)?.selo).toBeNull()
    const bia = await conta(servidor, "Bia")
    expect(await bia.nomeDoConvite(longa)).toBeNull()
  }, 120_000)

  it("um código que não é o do convite não abre o selo, mesmo com o canal certo", async () => {
    const ana = await conta(servidor, "Ana")
    const sala = moradaDeSala(servidor.casa)
    await ana.createSpaceChannel(sala, "Geral")
    const { longa } = await ana.criarConvite(sala)
    const lida = parseInviteLink(longa)!
    const bia = await conta(servidor, "Bia")
    // Another code gives another `codeHash`: the server has no invite for it.
    const errada = longa.replace(lida.code, "zzzzzzzzzzzzzzzz")
    expect(await bia.nomeDoConvite(errada)).toBeNull()
    expect(await bia.nomeDoConvite(longa)).toEqual({ canal: "Geral", quem: "Ana" })
  }, 120_000)
})

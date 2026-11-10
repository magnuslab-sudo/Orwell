import { moradaDeTeste } from "../testes/moradas.js"
import { describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The session asks the vault what a channel is (1.0 "Arca", slice 2).
 *
 * With opaque addresses the form says nothing. These tests deliberately use an opaque address with a slot in the vault, and an old form whose slot says something else: if the session still read the form, they would fail.
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

const SERVIDOR = "localhost:8448"
// Opaque for real: the old constant had `l` and `o`, outside the alphabet, and the core started refusing a debut of such an address.
const OPACA = moradaDeTeste("opaca", SERVIDOR)
const BENTO = `@bentobentobentobento:${SERVIDOR}`

async function sessao(): Promise<{ session: Session; vault: Vault; eu: string; backend: MemoryBackend }> {
  const backend = new MemoryBackend()
  const vault = new Vault(backend)
  await vault.create("frase-passe")
  const session = new Session(vault)
  const { address } = await session.createIdentity(SERVIDOR)
  return { session, vault, eu: address, backend }
}

describe("o tipo do canal vem do cofre", () => {
  it("uma morada opaca com ficha de directa é uma directa: sem papéis, sem moderação, não se elimina", async () => {
    const { session, vault } = await sessao()
    // Offline: the group is saved, and it is the `channel.subscribe` that breaks.
    await session.createSpaceChannel(OPACA).catch(() => {})
    await vault.update((contents) => {
      contents.fichasDosCanais = { ...contents.fichasDosCanais, [OPACA]: { tipo: "directa", par: BENTO } }
    })
    // The first group write had already given it a room slot, by form; here we swap it by hand to prove the slot is what matters.
    expect(session.tipoDoCanal(OPACA)).toBe("directa")
    expect(session.mayModerate(OPACA)).toBe(false)
    expect(session.mayDeleteChannel(OPACA)).toBe(false)
    await expect(session.assignRoles(OPACA, BENTO, ["admin"])).rejects.toThrow("a direct conversation has no administration")
  })

  it("uma forma antiga de directa cuja ficha diz sala é uma sala", async () => {
    const { session, vault, eu } = await sessao()
    const [a, b] = [eu.slice(1, eu.indexOf(":")), BENTO.slice(1, BENTO.indexOf(":"))].sort()
    const directa = `!dm-${a}.${b}:${SERVIDOR}`
    await vault.update((contents) => {
      contents.fichasDosCanais = { [directa]: { tipo: "sala" } }
    })
    expect(session.tipoDoCanal(directa)).toBe("sala")
  })

  it("o mural nasce com a ficha de mural e o dono, e a sala com a de sala", async () => {
    const { session, vault, eu } = await sessao()
    const feed = await session.ensureFeed().catch(() => session.feedChannel)
    await session.createSpaceChannel(moradaDeTeste("lagar", SERVIDOR)).catch(() => {})
    await session.flush()
    expect(vault.contents.fichasDosCanais?.[feed]).toEqual({ tipo: "mural", dono: eu })
    expect(vault.contents.fichasDosCanais?.[moradaDeTeste("lagar", SERVIDOR)]).toEqual({ tipo: "sala" })
  })

  it("um cofre sem fichas não as ganha pela forma: a migração saiu (fatia 3)", async () => {
    const { session, vault, eu, backend } = await sessao()
    const [a, b] = [eu.slice(1, eu.indexOf(":")), BENTO.slice(1, BENTO.indexOf(":"))].sort()
    const directa = `!dm-${a}.${b}:${SERVIDOR}`
    await session.createSpaceChannel(directa).catch(() => {})
    await session.flush()
    await vault.update((contents) => {
      delete contents.fichasDosCanais
    })

    const outra = new Vault(backend)
    await outra.unlock("frase-passe")
    const aberta = new Session(outra)
    aberta.loadIdentity()
    // Before, `migrarFichasDosCanais` gave it the direct chat slot by form.
    expect(outra.contents.fichasDosCanais?.[directa]).toBeUndefined()
    expect(aberta.tipoDoCanal(directa)).toBe("sala")
  })
})

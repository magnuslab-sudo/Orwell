import { afterEach, describe, expect, it } from "vitest"
import { Session, type SessionEvents } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * Error 349 (2 November 2026): a newly paired device was recreating
 * the account's feed.
 *
 * The pairing snapshot brings the feed anchor (`lastSeq`) and the group
 * arrives later, via Welcome. The first pass of friends requested the feed
 * before that, and `ensureFeed` created a new group at the same address: the alert
 * "lost state and was recreated", and encrypted messages for a group that
 * no one else had. A feed with history waits for the group and does not
 * spawn again.
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
const ESPERA = Session.ESPERA_DA_ESTREIA_MS

afterEach(() => {
  Session.ESPERA_DA_ESTREIA_MS = ESPERA
})

async function sessao(): Promise<{ session: Session; vault: Vault; avisos: SessionEvents["status"][] }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  await session.createIdentity(SERVIDOR)
  const avisos: SessionEvents["status"][] = []
  session.on("status", (status) => avisos.push(status))
  return { session, vault, avisos }
}

describe("o mural de um aparelho emparelhado", () => {
  it("com história no cofre e sem grupo, espera pelo grupo e não o cria outra vez", async () => {
    Session.ESPERA_DA_ESTREIA_MS = 20
    const { session, vault, avisos } = await sessao()
    const feed = session.feedChannel
    expect(feed).not.toBe("")
    // The anchor that the pairing snapshot brings, without the group.
    await vault.update((contents) => {
      contents.lastSeq = { ...contents.lastSeq, [feed]: 16 }
    })

    await expect(session.ensureFeed()).rejects.toThrow("this device does not know the account feed yet")
    expect(session.channels).not.toContain(feed)
    expect(avisos.filter((aviso) => aviso.code === "channel-forked")).toEqual([])
  })

  it("sem história nenhuma, o mural nasce como sempre", async () => {
    const { session, avisos } = await sessao()
    const feed = session.feedChannel
    // Offline: the group is saved, and it is the `channel.subscribe` that breaks.
    await session.ensureFeed().catch(() => {})
    expect(session.channels).toContain(feed)
    expect(avisos.filter((aviso) => aviso.code === "channel-forked")).toEqual([])
  })
})

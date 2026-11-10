import { describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The channel metadata, and the timestamp without which it cannot defend itself.
 *
 * A channel icon would vanish on its own, and the blame lay with none of the
 * three obvious suspects: the vault does not drop it (it lives outside the history, which is
 * what the media budget traverses), the date guard in `upsertSpaceMeta`
 * withstands an old republish, and whoever joins afterward receives it. All this is
 * proven with two accounts against a real server.
 *
 * What was missing was smaller and deeper: `spaceMeta()` returned the
 * metadata WITHOUT the timestamp it was stored with. Whoever reads this, the interface, has
 * a second source nearby, the `space.meta` still in memory, and
 * chooses between the two by timestamp. A vault without a timestamp entered that comparison
 * worth zero and lost against ANY message, no matter how old.
 *
 * And losing there is not cosmetic. The properties sheet seeds the icon field with
 * what is on screen; saving from there publishes a `space.meta` without an icon
 * with today's timestamp, and that the vault of everyone accepts. The icon died
 * for everyone, published by whoever was changing the name.
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

async function offlineSession(): Promise<{ vault: Vault; session: Session }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  await session.createIdentity("localhost:8448")
  return { vault, session }
}

const ICONE = "data:image/png;base64,AAAA"

describe("Session.spaceMeta", () => {
  it("devolve o carimbo com que a apresentação foi gravada", async () => {
    const { vault, session } = await offlineSession()
    const canal = session.feedChannel

    // As if it had come through the wire and been stored: this is the form the
    // vault keeps, and `at` is what the reception guard compared to accept it.
    await vault.update((contents) => {
      contents.spaceMeta[canal] = {
        at: 1_700_000_000_000,
        payload: { t: "space.meta", name: "Lagar do Zé", icon: { inline: ICONE } },
      }
    })

    const meta = session.spaceMeta(canal)
    expect(meta?.name).toBe("Lagar do Zé")
    expect(meta?.icon).toBe(ICONE)
    // What was missing. Without this the interface has no way to defend the icon.
    expect(meta?.updatedAt).toBe(1_700_000_000_000)
  }, 60_000)

  it("o carimbo é o do cofre, e não o que o remetente escreveu no payload", async () => {
    const { vault, session } = await offlineSession()
    const canal = session.feedChannel

    // The two timestamps diverge on purpose: `upsertSpaceMeta` decides by `at`, and
    // the interface must decide by `at` as well, or the two guards
    // will answer differently about the same fact.
    await vault.update((contents) => {
      contents.spaceMeta[canal] = {
        at: 2_000,
        payload: { t: "space.meta", name: "Adega", updatedAt: 9_999 },
      }
    })

    expect(session.spaceMeta(canal)?.updatedAt).toBe(2_000)
  }, 60_000)

  it("um canal de que nada se sabe continua a não responder nada", async () => {
    const { session } = await offlineSession()
    expect(session.spaceMeta("!nunca-visto:teste")).toBeNull()
  }, 60_000)
})

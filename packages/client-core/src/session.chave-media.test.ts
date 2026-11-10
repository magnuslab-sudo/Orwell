import { moradaDeTeste } from "../testes/moradas.js"
import { addMembers, decodeKeyPackage, epochOf, generateKeyPackages } from "@enclave/crypto"
import { generateIdentity, parseServerName } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * `Session.mediaKey` really reads the live epoch of the channel.
 *
 * It looks like a line with no history, `epoch % 65 536`, and it is the axis
 * of all media key rotation. If it stopped reading the epoch, nothing would
 * break anywhere: `deriveSframeKeyMaterial` would keep returning plausible
 * bytes, calls would keep connecting, and the only visible effect would be none
 *, someone expelled mid-call would keep hearing everything, and the `keyId` in
 * the header would stop distinguishing one epoch from the next, so the two-key
 * window would choose the wrong key in silence.
 *
 * `sframe.epoch.test.ts` proves the derivation against real MLS, but replicates
 * this formula instead of calling it; `call.sframe.test.ts` proves the rotation
 * of the `Call` against a fake bridge. Between the two sat exactly this step to
 * measure, which is what links one to the other.
 *
 * The epoch advances here through the side door, by adding a member to the
 * group object the session has in hand, because the true path needs a second
 * device and a server. What is measured is not the commit: it is the read.
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

const CANAL = moradaDeTeste("chamada")

async function sessaoComCanal(): Promise<Session> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  await session.createIdentity("localhost:8448")
  // No connection, the `channel.subscribe` at the end throws. The group is
  // already set up and saved before that, which is all this test needs.
  await session.createSpaceChannel(CANAL).catch(() => {})
  return session
}

function iguais(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}

describe("Session.mediaKey", () => {
  it("acompanha a epoch do canal: keyId novo e material novo depois de um commit", async () => {
    const session = await sessaoComCanal()
    const grupo = session.groupFor(CANAL)
    if (!grupo) throw new Error("o canal não ficou montado")

    const antes = await session.mediaKey(CANAL, session.identity.address)
    if (!antes) throw new Error("sem chave de media para nós próprios")
    expect(antes.keyId).toBe(Number(epochOf(grupo) % 65_536n))

    // Someone joins the channel: a commit, and the epoch advances.
    const bruno = generateIdentity(parseServerName("localhost:8448"))
    const [pacote] = await generateKeyPackages(bruno, 1)
    if (!pacote) throw new Error("sem key package")
    const entrada = await addMembers(grupo, [decodeKeyPackage(pacote.wire)])
    grupo.state = entrada.session.state

    const depois = await session.mediaKey(CANAL, session.identity.address)
    if (!depois) throw new Error("sem chave de media depois do commit")

    // The label that travels in the header of each frame changed, and changed TO
    // the new epoch, not to any other number.
    expect(depois.keyId).toBe(Number(epochOf(grupo) % 65_536n))
    expect(depois.keyId).not.toBe(antes.keyId)
    // Our leaf did not move; the key did.
    expect(depois.senderId).toBe(antes.senderId)
    expect(iguais(depois.material, antes.material)).toBe(false)
  }, 60_000)

  it("e não devolve chave nenhuma para quem não tem folha na árvore", async () => {
    // The question that `call.ts` asks to know if a pair is still a member of the
    // channel. A `null` here is what removes them from the call; a plausible value
    // would leave them receiving media they should no longer hear.
    const session = await sessaoComCanal()
    const estranho = generateIdentity(parseServerName("localhost:8448"))
    expect(await session.mediaKey(CANAL, estranho.address)).toBeNull()
  }, 60_000)
})

import { moradaDeTeste } from "../testes/moradas.js"
import { ed25519 } from "@noble/curves/ed25519.js"
import {
  addMembers,
  createChannel,
  decodeKeyPackage,
  generateKeyPackages,
  importSframeKey,
  joinChannel,
  leavesOf,
  SframeReceiver,
  SframeSender,
  readHeader,
  type GroupSession,
} from "@enclave/crypto"
import { generateIdentity, identityFromPrivateKey, parseServerName } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * Two devices on the SAME account on the same call never use the same key/nonce
 * pair.
 *
 * Found on 2 November 2026 (`docs/planos/som-que-se-perde-relatorio.md`):
 * `Session.mediaKey` used `leafIndexOf`, which returns the FIRST leaf of the
 * account. Both devices derived the same key and the same `senderId`, and each
 * one reserved counters in its own vault starting from zero: the same nonces
 * with the same key, in AES-GCM. This reveals the XOR of the two plaintexts and
 * gives the GHASH subkey, with which authenticated frames can be forged.
 *
 * The fix: each device encrypts with the key of ITS leaf. The `senderId` goes in
 * clear in the header of each frame, and the receiver asks for the key of that
 * leaf, as long as the leaf really belongs to the account that sends it.
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

const HOME = parseServerName("enclave.test")
const CANAL = moradaDeTeste("chamada", "enclave.test")

/** A channel with Alice on two devices and Bob on one, at the MLS level. */
async function canalComDoisAparelhos() {
  const alicePortatil = generateIdentity(HOME)
  const aliceTelemovel = identityFromPrivateKey(alicePortatil.signingPrivateKey, HOME, ed25519.utils.randomSecretKey())
  const bruno = generateIdentity(HOME)
  const [kpTelemovel] = await generateKeyPackages(aliceTelemovel, 1)
  const [kpBruno] = await generateKeyPackages(bruno, 1)
  if (!kpTelemovel || !kpBruno) throw new Error("sem key packages")
  const criado = await createChannel(alicePortatil, CANAL)
  const entrada = await addMembers(criado, [decodeKeyPackage(kpTelemovel.wire), decodeKeyPackage(kpBruno.wire)])
  const telemovel = await joinChannel(CANAL, entrada.welcome, kpTelemovel.publicPackage, kpTelemovel.privatePackage)
  const brunoGrupo = await joinChannel(CANAL, entrada.welcome, kpBruno.publicPackage, kpBruno.privatePackage)
  return { alice: alicePortatil.address, bruno: bruno.address, portatil: entrada.session, telemovel, brunoGrupo }
}

/**
 * A `Session` whose channel group is the given one.
 *
 * The session sets up its own channel and its state is swapped for that of the
 * device we want to test: what is measured is the read that `mediaKey` does on
 * the tree, and the true path (pair, invite, accept) needs a server.
 */
async function sessaoCom(grupo: GroupSession): Promise<Session> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  await session.createIdentity("enclave.test:8448")
  await session.createSpaceChannel(CANAL).catch(() => {})
  const meu = session.groupFor(CANAL)
  if (!meu) throw new Error("o canal não ficou montado")
  meu.state = grupo.state
  return session
}

const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")

/** The nonce of a frame, as `SframeSender` calculates it: salt XOR counter. */
function nonceDe(material: Uint8Array, counter: number): string {
  const nonce = material.slice(16, 28)
  const view = new DataView(nonce.buffer)
  view.setUint32(4, view.getUint32(4, false) ^ Math.floor(counter / 0x100000000), false)
  view.setUint32(8, view.getUint32(8, false) ^ (counter >>> 0), false)
  return hex(nonce)
}

describe("dois aparelhos da mesma conta na mesma chamada", () => {
  it("nunca cifram com o mesmo par chave/nonce", async () => {
    const { alice, portatil, telemovel } = await canalComDoisAparelhos()
    const sessaoPortatil = await sessaoCom(portatil)
    const sessaoTelemovel = await sessaoCom(telemovel)

    const pares = new Set<string>()
    let frames = 0
    for (const sessao of [sessaoPortatil, sessaoTelemovel]) {
      const chave = await sessao.mediaKey(CANAL, alice)
      if (!chave) throw new Error("sem chave de media")
      // Each device reserves in ITS vault, and both start at the same place.
      const inicio = await sessao.reservarContadorSframe(CANAL, chave.keyId)
      expect(inicio).toBe(0)
      const emissor = new SframeSender(await importSframeKey(chave.material, chave.keyId, chave.senderId), inicio)
      for (let i = 0; i < 20; i++) {
        const frame = await emissor.encrypt(new Uint8Array([i, 1, 2]) as Uint8Array<ArrayBuffer>)
        const cabecalho = readHeader(frame)
        if (!cabecalho) throw new Error("frame sem cabeçalho")
        pares.add(`${hex(chave.material.subarray(0, 16))}|${nonceDe(chave.material, cabecalho.counter)}`)
        frames++
      }
    }
    expect(pares.size).toBe(frames)
  }, 60_000)

  it("cada aparelho usa a sua folha como senderId", async () => {
    const { alice, portatil, telemovel } = await canalComDoisAparelhos()
    const folhas = leavesOf(portatil.state.ratchetTree, alice)
    expect(folhas).toHaveLength(2)
    const doPortatil = await (await sessaoCom(portatil)).mediaKey(CANAL, alice)
    const doTelemovel = await (await sessaoCom(telemovel)).mediaKey(CANAL, alice)
    expect(doPortatil?.senderId).toBe(portatil.state.privatePath.leafIndex)
    expect(doTelemovel?.senderId).toBe(telemovel.state.privatePath.leafIndex)
    expect(new Set([doPortatil?.senderId, doTelemovel?.senderId])).toEqual(new Set(folhas))
  }, 60_000)

  it("quem ouve abre os dois, pela folha que o frame declara", async () => {
    const { alice, bruno, portatil, telemovel, brunoGrupo } = await canalComDoisAparelhos()
    const sessaoBruno = await sessaoCom(brunoGrupo)
    for (const grupo of [portatil, telemovel]) {
      const chave = await (await sessaoCom(grupo)).mediaKey(CANAL, alice)
      if (!chave) throw new Error("sem chave de media")
      const frame = await new SframeSender(await importSframeKey(chave.material, chave.keyId, chave.senderId)).encrypt(
        new Uint8Array([7, 7, 7]) as Uint8Array<ArrayBuffer>,
      )
      const folha = readHeader(frame)?.senderId
      const doLado = await sessaoBruno.mediaKey(CANAL, alice, folha)
      if (!doLado) throw new Error("o Bruno não tem a chave desta folha")
      const aberto = await new SframeReceiver(await importSframeKey(doLado.material, doLado.keyId, doLado.senderId)).decrypt(frame)
      expect(aberto && [...aberto]).toEqual([7, 7, 7])
    }
    // A leaf that is not Alice's does not work for "Alice": the receiver of an
    // Alice frame never accepts Bob's key in her place.
    const folhaDoBruno = leavesOf(brunoGrupo.state.ratchetTree, bruno)[0]
    expect(await sessaoBruno.mediaKey(CANAL, alice, folhaDoBruno)).toBeNull()
  }, 60_000)
})

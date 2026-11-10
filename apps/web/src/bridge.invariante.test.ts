import { Session, Vault, type DerivarChaveDoCofre } from "@enclave/client-core"
import { beforeEach, describe, expect, it } from "vitest"
import { createBrowserBridge } from "./bridge.js"
import { IdbFalso } from "./testes/idb-falso.js"
import { BrowserVaultBackend } from "./vault-backend.js"

/**
 * The central invariant of ownership handoff, with real pieces.
 *
 * `Vault` and `Session` from the core, `BrowserVaultBackend` from this folder,
 * and only the fake IndexedDB underneath. The test with all fakes
 * (`bridge.parar.test.ts`) locks the order of calls; this one locks the EFFECT:
 * the work waiting to write when stop is requested reaches disk, and is not
 * refused by the seal.
 *
 * Why it matters. The core's `disconnect` writes with `void flush().catch(() => {})`.
 * If the seal came before writing, the refusal would vanish in that `catch`, the
 * fake tests would stay green, and the new owner would read an old vault.
 *
 * The work to write is key packages: `topUpKeyPackages` generates them, marks
 * them dirty, and only then tries to publish, which fails with no server. It is
 * the public, network-free way to leave the core with something in the batch.
 */

const FRASE = "frase-de-teste-do-separador"
// Real key derivation takes seconds; here we only care about being deterministic.
const rapida: DerivarChaveDoCofre = async () => new Uint8Array(32).fill(7)

let idb: IdbFalso

beforeEach(() => {
  idb = new IdbFalso()
  ;(globalThis as { indexedDB?: unknown }).indexedDB = idb.indexedDB
  sessionStorage.clear()
})

async function ponteComTrabalhoPorGravar(): Promise<{
  ponte: ReturnType<typeof createBrowserBridge>
  session: Session
}> {
  let session: Session | null = null
  const ponte = createBrowserBridge({
    backend: new BrowserVaultBackend(),
    derivar: rapida,
    aoCriar: (partes) => (session = partes.session),
  })
  await ponte.assumirPosse("dono-a")
  await ponte.vault.create(FRASE)
  await ponte.identity.create("localhost:8448")
  const viva = session as unknown as Session
  // Generates and marks as dirty; publishing fails (no server), and they stay in the batch.
  await viva.topUpKeyPackages(2).catch(() => {})
  return { ponte, session: viva }
}

async function keyPackagesNoDisco(): Promise<number> {
  const leitor = new Vault(new BrowserVaultBackend(), rapida)
  await leitor.unlock(FRASE)
  return leitor.contents.pendingKeyPackages?.length ?? 0
}

describe("pararDeEscrever com Vault e Session verdadeiros", () => {
  it("o lote por gravar chega ao disco antes de a paragem resolver", async () => {
    await ponteComTrabalhoPorGravar()
    expect(await keyPackagesNoDisco()).toBe(0)
  })

  it("com gravação: o put chega, e não é recusado pelo selo", async () => {
    const { ponte } = await ponteComTrabalhoPorGravar()
    const putsAntes = idb.putsDoCofre
    await ponte.pararDeEscrever()
    expect(idb.putsDoCofre).toBe(putsAntes + 1)
    expect(await keyPackagesNoDisco()).toBe(2)
  })

  it("sem gravação (posse perdida): o selo vem primeiro e nada chega ao disco", async () => {
    const { ponte } = await ponteComTrabalhoPorGravar()
    const putsAntes = idb.putsDoCofre
    await ponte.pararDeEscrever({ gravar: false })
    expect(idb.putsDoCofre).toBe(putsAntes)
    expect(await keyPackagesNoDisco()).toBe(0)
  })

  it("um dono antigo que acorda depois de outro assumir não grava nada", async () => {
    const { ponte } = await ponteComTrabalhoPorGravar()
    // Another tab assumes the slot while this one sleeps.
    await new BrowserVaultBackend().assumirPosse("dono-b")
    const putsAntes = idb.putsDoCofre
    await ponte.pararDeEscrever()
    expect(idb.putsDoCofre).toBe(putsAntes)
    expect(await keyPackagesNoDisco()).toBe(0)
  })
})

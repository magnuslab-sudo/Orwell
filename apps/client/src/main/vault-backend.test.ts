import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ safeStorage: { isEncryptionAvailable: () => false } }))

/**
 * Disk full, requested for every test.
 *
 * Real `fs`, with `writeFileSync` failing like the system fails: leaves some
 * bytes written, throws the system `code`. Both module names, because vitest
 * can resolve `node:fs` as either.
 */
const disco = vi.hoisted(() => {
  const estado = { codigo: null as string | null }
  const falso = async (original: () => Promise<unknown>): Promise<unknown> => {
    const fs = (await original()) as typeof import("node:fs")
    const writeFileSync = (...argumentos: Parameters<typeof fs.writeFileSync>): void => {
      if (estado.codigo !== null) {
        fs.writeFileSync(argumentos[0], "meio")
        throw Object.assign(new Error(`${estado.codigo}: no space left on device, write`), { code: estado.codigo })
      }
      fs.writeFileSync(...argumentos)
    }
    return { ...fs, default: { ...fs, writeFileSync }, writeFileSync }
  }
  return { estado, falso }
})
vi.mock("node:fs", (original) => disco.falso(original))
vi.mock("fs", (original) => disco.falso(original))

const { DesktopVaultBackend } = await import("./vault-backend.js")

describe("o cofre da secretária com o disco cheio", () => {
  const pastas: string[] = []
  afterEach(() => {
    disco.estado.codigo = null
    for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
  })
  function cofre(): { backend: InstanceType<typeof DesktopVaultBackend>; pasta: string } {
    const pasta = mkdtempSync(join(tmpdir(), "cofre-"))
    pastas.push(pasta)
    return { backend: new DesktopVaultBackend(pasta), pasta }
  }

  it('ENOSPC passa a "vault storage is full" (106), e o cofre anterior fica', async () => {
    const { backend, pasta } = cofre()
    await backend.write(new Uint8Array([1, 2, 3]))
    disco.estado.codigo = "ENOSPC"
    await expect(backend.write(new Uint8Array([9]))).rejects.toThrow(/^vault storage is full$/)
    expect([...readFileSync(join(pasta, "vault.enc"))]).toEqual([1, 2, 3])
    expect(existsSync(join(pasta, "vault.enc.tmp"))).toBe(false)
  })

  it("a quota cheia (EDQUOT) também", async () => {
    const { backend } = cofre()
    disco.estado.codigo = "EDQUOT"
    await expect(backend.write(new Uint8Array([9]))).rejects.toThrow(/^vault storage is full$/)
  })

  it("outra falha do sistema passa como veio", async () => {
    const { backend } = cofre()
    disco.estado.codigo = "EACCES"
    await expect(backend.write(new Uint8Array([9]))).rejects.toThrow(/EACCES/)
  })
})

describe("apagar o cofre da secretária", () => {
  const pastas: string[] = []
  afterEach(() => {
    for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
  })

  it("clear() apaga o vault.enc e o vault.enc.tmp de uma escrita interrompida", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "cofre-"))
    pastas.push(pasta)
    const backend = new DesktopVaultBackend(pasta)
    await backend.write(new Uint8Array([1, 2, 3]))
    // What remains when the process dies between write and rename.
    writeFileSync(join(pasta, "vault.enc.tmp"), "{\"meio\":1}")
    await backend.clear()
    expect(existsSync(join(pasta, "vault.enc"))).toBe(false)
    expect(existsSync(join(pasta, "vault.enc.tmp"))).toBe(false)
    expect(await backend.read()).toBeNull()
  })

  it("clear() sem ficheiro nenhum não atira", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "cofre-"))
    pastas.push(pasta)
    await expect(new DesktopVaultBackend(pasta).clear()).resolves.toBeUndefined()
  })
})

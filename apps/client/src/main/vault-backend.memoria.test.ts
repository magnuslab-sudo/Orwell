import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * The mock `safeStorage`: "encrypts" by prepending a prefix and reversing
 * bytes. Good enough to prove what stays on disk is not plaintext, and only
 * `safeStorage` gets it back.
 */
const porta = vi.hoisted(() => ({
  disponivel: true,
  backend: "keychain",
}))
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => porta.disponivel,
    getSelectedStorageBackend: () => porta.backend,
    encryptString: (texto: string) => Buffer.concat([Buffer.from("ss:"), Buffer.from(texto).reverse()]),
    decryptString: (embrulho: Buffer) => {
      if (!embrulho.subarray(0, 3).equals(Buffer.from("ss:"))) throw new Error("Error while decrypting the ciphertext")
      return Buffer.from(embrulho.subarray(3)).reverse().toString()
    },
  },
}))

const { DesktopVaultBackend, safeStorageProtege } = await import("./vault-backend.js")
const { Vault } = await import("@enclave/client-core")

describe("a sessão memorizada na secretária (sessao.enc)", () => {
  const pastas: string[] = []
  afterEach(() => {
    porta.disponivel = true
    porta.backend = "keychain"
    for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
  })
  function pasta(): string {
    const caminho = mkdtempSync(join(tmpdir(), "sessao-"))
    pastas.push(caminho)
    return caminho
  }

  it("guarda ao lado do cofre, 0600, embrulhada pelo safeStorage e nunca em claro", async () => {
    const dir = pasta()
    const backend = new DesktopVaultBackend(dir)
    const chave = new Uint8Array(32).map((_, i) => i + 1)
    await backend.memoria.guardar(chave)
    const ficheiro = join(dir, "sessao.enc")
    expect(existsSync(ficheiro)).toBe(true)
    expect(statSync(ficheiro).mode & 0o777).toBe(0o600)
    expect(readFileSync(ficheiro, "utf8")).not.toContain(Buffer.from(chave).toString("base64"))
    expect(await backend.memoria.existe()).toBe(true)
    expect([...((await backend.memoria.ler()) ?? [])]).toEqual([...chave])
    await backend.memoria.apagar()
    expect(existsSync(ficheiro)).toBe(false)
    expect(await backend.memoria.ler()).toBeNull()
  })

  it("um registo estragado lê-se como nenhum", async () => {
    const dir = pasta()
    const backend = new DesktopVaultBackend(dir)
    await backend.memoria.guardar(new Uint8Array(32))
    const { writeFileSync } = await import("node:fs")
    writeFileSync(join(dir, "sessao.enc"), "{lixo")
    expect(await backend.memoria.ler()).toBeNull()
  })

  it("sem safeStorage, ou no Linux com `basic_text`, não há onde guardar", () => {
    expect(safeStorageProtege({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "keychain" }, "darwin")).toBe(true)
    expect(safeStorageProtege({ isEncryptionAvailable: () => false }, "darwin")).toBe(false)
    expect(safeStorageProtege({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "basic_text" }, "linux")).toBe(false)
    expect(safeStorageProtege({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "gnome_libsecret" }, "linux")).toBe(true)
  })

  it("com o núcleo: memorizar, fechar a app, abrir sem frase; apagar a conta apaga a memória", async () => {
    const dir = pasta()
    const vault = new Vault(new DesktopVaultBackend(dir))
    await vault.create("a frase da secretária")
    await vault.memorizar()
    vault.lock()

    // Close the app: new process, new backend, same folder.
    const outra = new Vault(new DesktopVaultBackend(dir))
    expect(await outra.abrirMemorizada()).toBe(true)
    expect((await outra.estado()).sessaoMemorizada).toBe(true)
    await outra.destroy()
    expect(existsSync(join(dir, "sessao.enc"))).toBe(false)
    expect(existsSync(join(dir, "vault.enc"))).toBe(false)
  }, 30_000)
})

describe('"Mudar de conta" na secretária: uma pasta por conta', () => {
  const pastas: string[] = []
  afterEach(() => {
    for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
  })

  it("a principal fica na pasta de dados; as outras em `contas/<id>`, e trocar não mexe na de onde se sai", async () => {
    const dir = mkdtempSync(join(tmpdir(), "contas-"))
    pastas.push(dir)
    const backend = new DesktopVaultBackend(dir)
    const vault = new Vault(backend)
    await vault.create("a frase da Ana")
    await vault.memorizar()
    vault.lock()

    backend.usarConta("b0b")
    expect(await vault.exists()).toBe(false)
    await vault.create("a frase do Bruno")
    vault.lock()
    expect(existsSync(join(dir, "contas", "b0b", "vault.enc"))).toBe(true)
    expect(backend.estadoDaConta("principal")).toEqual({ temCofre: true, memorizada: true })
    expect(backend.estadoDaConta("b0b")).toEqual({ temCofre: true, memorizada: false })

    backend.usarConta("principal")
    expect(await vault.abrirMemorizada()).toBe(true)
    vault.lock()

    backend.largarConta("b0b")
    expect(existsSync(join(dir, "contas", "b0b"))).toBe(false)
    // The main one is the data folder: leaving it doesn't wipe anything.
    backend.largarConta("principal")
    expect(existsSync(join(dir, "vault.enc"))).toBe(true)
  }, 30_000)

  it("um id que fugiria da pasta recusa-se", () => {
    const dir = mkdtempSync(join(tmpdir(), "contas-"))
    pastas.push(dir)
    expect(() => new DesktopVaultBackend(dir, "../fora")).toThrow("there is no such account on this device")
    expect(() => new DesktopVaultBackend(dir).usarConta("a/b")).toThrow("there is no such account on this device")
  })
})

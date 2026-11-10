import type { MemoriaDaSessao, VaultBackend } from "@enclave/client-core"
import { CONTA_PRINCIPAL, idDeContaValido } from "@enclave/client-core/contas"
import { safeStorage } from "electron"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Vault storage for the desktop app: a file, plus the OS credential store.
 *
 * This is the part the browser cannot match. DPAPI on Windows, Keychain on
 * macOS and libsecret on Linux will hold a key for us that is bound to the user
 * account, so the vault can be unlocked without a passphrase and still not be
 * readable by simply copying the file off the disk.
 */
/**
 * Does `safeStorage` really keep things safe? On Linux without a keyring,
 * Electron falls back to `basic_text`, a hardcoded password: it encrypts, but
 * doesn't protect. The session won't remember itself then.
 */
export function safeStorageProtege(porta: Pick<typeof safeStorage, "isEncryptionAvailable"> & {
  getSelectedStorageBackend?: () => string
} = safeStorage, plataforma: NodeJS.Platform = process.platform): boolean {
  if (!porta.isEncryptionAvailable()) return false
  if (plataforma === "linux" && porta.getSelectedStorageBackend?.() === "basic_text") return false
  return true
}

/**
 * Atomic write using `.tmp` and `rename`. When disk space or user quota runs full, we surface the `QuotaExceededError` message "vault storage is full" (106) so users know what to do. Without this, the OS message "ENOSPC: no space left on device" would appear as Error 900 instead. A partial file gets cleaned up; the previous version stays intact.
 */
export function escreverInteiro(caminho: string, bytes: Uint8Array): void {
  const temporary = `${caminho}.tmp`
  try {
    writeFileSync(temporary, bytes, { mode: 0o600 })
    renameSync(temporary, caminho)
  } catch (erro) {
    const codigo = (erro as NodeJS.ErrnoException | null)?.code
    if (codigo === "ENOSPC" || codigo === "EDQUOT") {
      rmSync(temporary, { force: true })
      throw new Error("vault storage is full", { cause: { codigo } })
    }
    throw erro
  }
}

/**
 * Each account gets its own folder ("Switch Account"). The main one is the data folder, where the vault has always lived: for users with a single account, nothing changes. Other accounts live in `contas/<id>/`, each with its own `vault.enc` and `sessao.enc`.
 */
export function pastaDaConta(raiz: string, conta: string): string {
  if (!idDeContaValido(conta)) throw new Error("there is no such account on this device")
  return conta === CONTA_PRINCIPAL ? raiz : join(raiz, "contas", conta)
}

export class DesktopVaultBackend implements VaultBackend {
  readonly #raiz: string
  #pasta: string

  constructor(directory: string, conta: string = CONTA_PRINCIPAL) {
    mkdirSync(directory, { recursive: true })
    this.#raiz = directory
    this.#pasta = pastaDaConta(directory, conta)
  }

  /**
   * Switch to storing in another account. Only when the vault is locked: the caller (`contas:mudar` in the main process) locks first. Writes already in progress complete in the file of their original account, because the path is read synchronously at write time.
   */
  usarConta(conta: string): void {
    this.#pasta = pastaDaConta(this.#raiz, conta)
  }

  /** What an account has in this data folder, without opening anything. */
  estadoDaConta(conta: string): { temCofre: boolean; memorizada: boolean } {
    const pasta = pastaDaConta(this.#raiz, conta)
    return { temCofre: existsSync(join(pasta, "vault.enc")), memorizada: existsSync(join(pasta, "sessao.enc")) }
  }

  /** Delete the folder of an account that left the list. The main data folder is never deleted. */
  largarConta(conta: string): void {
    if (conta === CONTA_PRINCIPAL) return
    rmSync(pastaDaConta(this.#raiz, conta), { recursive: true, force: true })
  }

  get #path(): string {
    return join(this.#pasta, "vault.enc")
  }

  /** The remembered session: `sessao.enc` alongside `vault.enc`. */
  get #pathDaSessao(): string {
    return join(this.#pasta, "sessao.enc")
  }

  get supportsOsProtection(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  /**
   * The remembered session (F1): the vault key wrapped by `safeStorage`
   * (Keychain on macOS, DPAPI on Windows), in a separate file. Copying the data folder to another computer won't open it: the wrapping is tied to this machine's system account.
   */
  readonly memoria: MemoriaDaSessao = {
    via: "safeStorage",
    disponivel: async () => safeStorageProtege(),
    existe: async () => existsSync(this.#pathDaSessao),
    guardar: async (chave) => {
      const embrulho = safeStorage.encryptString(Buffer.from(chave).toString("base64"))
      const registo = JSON.stringify({ v: 1, via: "safeStorage", embrulho: embrulho.toString("base64") })
      mkdirSync(this.#pasta, { recursive: true })
      escreverInteiro(this.#pathDaSessao, new TextEncoder().encode(registo))
    },
    ler: async () => {
      if (!existsSync(this.#pathDaSessao)) return null
      try {
        const registo = JSON.parse(readFileSync(this.#pathDaSessao, "utf8")) as { v?: unknown; via?: unknown; embrulho?: unknown }
        if (registo.v !== 1 || registo.via !== "safeStorage" || typeof registo.embrulho !== "string") return null
        const chave = Buffer.from(safeStorage.decryptString(Buffer.from(registo.embrulho, "base64")), "base64")
        return chave.length === 32 ? new Uint8Array(chave) : null
      } catch {
        return null
      }
    },
    apagar: async () => {
      rmSync(this.#pathDaSessao, { force: true })
      rmSync(`${this.#pathDaSessao}.tmp`, { force: true })
    },
  }

  async read(): Promise<Uint8Array | null> {
    if (!existsSync(this.#path)) return null
    return new Uint8Array(readFileSync(this.#path))
  }

  async write(bytes: Uint8Array): Promise<void> {
    // Write-then-rename, so a crash mid-write leaves the previous vault intact
    // rather than a truncated file nobody can decrypt.
    mkdirSync(this.#pasta, { recursive: true })
    escreverInteiro(this.#path, bytes)
  }

  async clear(): Promise<void> {
    rmSync(this.#path, { force: true })
    /*
      And the `.tmp` from an interrupted write (the process died between
      `writeFileSync` and `renameSync`). It's a full copy of the vault, encrypted
      like it: deleting an account must delete both, or the exit screen
      ("Orwell is out of beta") would leave a beta vault on disk that we said
      we had deleted.
    */
    rmSync(`${this.#path}.tmp`, { force: true })
  }

  async wrapKey(key: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(safeStorage.encryptString(Buffer.from(key).toString("base64")))
  }

  async unwrapKey(wrapped: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(Buffer.from(safeStorage.decryptString(Buffer.from(wrapped)), "base64"))
  }
}

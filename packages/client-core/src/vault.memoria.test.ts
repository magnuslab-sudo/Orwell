import { describe, expect, it } from "vitest"
import { semCabecalho } from "./cabecalhoDoCofre.js"
import { Vault, type MemoriaDaSessao, type VaultBackend } from "./vault.js"

/**
 * The memorized session (F1 of `docs/planos/memorizar-sessao-plano.md`).
 *
 * What we enforce here are the plan's invariants: the record lives outside the
 * vault, export does not include it, it is always the CURRENT key, and without
 * it the password still opens everything.
 */

class MemoriaDeTeste implements MemoriaDaSessao {
  readonly via = "webcrypto" as const
  guardada: Uint8Array | null = null
  disponivelAgora = true
  guardar = async (chave: Uint8Array): Promise<void> => {
    this.guardada = new Uint8Array(chave)
  }
  ler = async (): Promise<Uint8Array | null> => (this.guardada ? new Uint8Array(this.guardada) : null)
  existe = async (): Promise<boolean> => this.guardada !== null
  apagar = async (): Promise<void> => {
    this.guardada = null
  }
  disponivel = async (): Promise<boolean> => this.disponivelAgora
}

class Disco implements VaultBackend {
  bytes: Uint8Array | null = null
  escritas = 0
  readonly supportsOsProtection: boolean
  readonly memoria: MemoriaDeTeste | undefined
  constructor({ os = false, memoria = true }: { os?: boolean; memoria?: boolean } = {}) {
    this.supportsOsProtection = os
    this.memoria = memoria ? new MemoriaDeTeste() : undefined
  }
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.escritas += 1
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
  // Test keyring: wrapping is copying.
  async wrapKey(key: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(key)
  }
  async unwrapKey(wrapped: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(wrapped)
  }
}

const FRASE = "a frase da Ana, comprida"

async function cofreAberto(disco = new Disco()): Promise<{ disco: Disco; vault: Vault }> {
  const vault = new Vault(disco)
  await vault.create(FRASE)
  await vault.update((c) => {
    c.profile.displayName = "Ana"
  })
  return { disco, vault }
}

describe("o estado do cofre (F0)", () => {
  it("diz a protecção DESTE cofre, e a memória da plataforma", async () => {
    const { disco, vault } = await cofreAberto()
    expect(await vault.estado()).toEqual({
      exists: true,
      supportsOsProtection: false,
      versao: "orwv2",
      protection: "passphrase",
      memoriaDisponivel: true,
      sessaoMemorizada: false,
    })
    await vault.memorizar()
    expect((await vault.estado()).sessaoMemorizada).toBe(true)
    disco.memoria!.disponivelAgora = false
    expect((await vault.estado()).memoriaDisponivel).toBe(false)
  })

  it("um cofre `os` diz `os`, mesmo com o aparelho a saber de palavras-passe", async () => {
    const vault = new Vault(new Disco({ os: true }))
    await vault.create(null)
    expect((await vault.estado()).protection).toBe("os")
  })

  it("sem memória na plataforma, os campos dela não aparecem; sem cofre, nem a protecção", async () => {
    const vault = new Vault(new Disco({ memoria: false }))
    expect(await vault.estado()).toEqual({ exists: false, supportsOsProtection: false })
  })

  it("um cofre do beta não diz protecção nenhuma: o envelope dele não se lê", async () => {
    const disco = new Disco({ memoria: false })
    disco.bytes = new TextEncoder().encode(JSON.stringify({ version: 2, protection: "passphrase" }))
    expect(await new Vault(disco).estado()).toEqual({ exists: true, supportsOsProtection: false, versao: "beta" })
  })
})

describe("memorizar a sessão (F1)", () => {
  it("memorizar não escreve no cofre, e a memória abre-o sem frase", async () => {
    const { disco, vault } = await cofreAberto()
    const antes = disco.escritas
    const bytesAntes = disco.bytes
    await vault.memorizar()
    expect(disco.escritas).toBe(antes)
    expect(disco.bytes).toBe(bytesAntes)
    expect(disco.memoria!.guardada).toHaveLength(32)

    vault.lock()
    const outro = new Vault(disco)
    expect(await outro.abrirMemorizada()).toBe(true)
    expect(outro.contents.profile.displayName).toBe("Ana")
  })

  it("o registo vive fora do cofre: o ficheiro em disco não muda de forma", async () => {
    const { disco, vault } = await cofreAberto()
    await vault.memorizar()
    const envelope = JSON.parse(semCabecalho(disco.bytes!)!) as Record<string, unknown>
    expect(Object.keys(envelope).sort()).toEqual(["ciphertext", "nonce", "protection", "salt", "version"])
  })

  it("a exportação nunca leva a chave memorizada", async () => {
    const { disco, vault } = await cofreAberto()
    await vault.memorizar()
    const ficheiro = new TextDecoder().decode(await vault.exportVault())
    const chave = btoa(String.fromCharCode(...disco.memoria!.guardada!))
    expect(ficheiro).not.toContain(chave)
    expect(ficheiro).not.toContain("sessao")
  })

  it("esquecer não tranca nem toca no cofre, e a frase continua a abrir", async () => {
    const { disco, vault } = await cofreAberto()
    await vault.memorizar()
    const antes = disco.escritas
    await vault.esquecerSessao()
    expect(vault.unlocked).toBe(true)
    expect(disco.escritas).toBe(antes)
    vault.lock()
    expect(await vault.abrirMemorizada()).toBe(false)
    await vault.unlock(FRASE)
    expect(vault.contents.profile.displayName).toBe("Ana")
  })

  it("uma memória que já não abre o cofre apaga-se, e o portão pede a frase", async () => {
    const { disco, vault } = await cofreAberto()
    disco.memoria!.guardada = new Uint8Array(32).fill(7)
    vault.lock()
    expect(await vault.abrirMemorizada()).toBe(false)
    expect(disco.memoria!.guardada).toBeNull()
    expect(vault.unlocked).toBe(false)
  })

  it("trancado, provisório, cofre `os` ou plataforma sem sítio: memorizar recusa", async () => {
    const { disco, vault } = await cofreAberto()
    vault.lock()
    await expect(vault.memorizar()).rejects.toThrow("vault is locked")

    await vault.unlock(FRASE)
    disco.memoria!.disponivelAgora = false
    await expect(vault.memorizar()).rejects.toThrow("this device cannot remember the session")

    const os = new Vault(new Disco({ os: true }))
    await os.create(null)
    await expect(os.memorizar()).rejects.toThrow("this vault has no passphrase to remember")

    const semMemoria = new Vault(new Disco({ memoria: false }))
    await semMemoria.create(FRASE)
    await expect(semMemoria.memorizar()).rejects.toThrow("this device cannot remember the session")

    await vault.criarProvisorio(FRASE)
    await expect(vault.memorizar()).rejects.toThrow("vault is locked")
  })

  it("é sempre a chave ACTUAL: criar, importar e confirmar um provisório apagam a memória", async () => {
    const { disco, vault } = await cofreAberto()
    const exportado = await vault.exportVault()

    await vault.memorizar()
    await vault.create("outra frase qualquer")
    expect(disco.memoria!.guardada).toBeNull()

    await vault.memorizar()
    await vault.importVault(exportado, FRASE)
    expect(disco.memoria!.guardada).toBeNull()

    await vault.unlock(FRASE)
    await vault.memorizar()
    await vault.criarProvisorio("a frase do provisório")
    // While it's temporary, the disk belongs to the old account and so does memory.
    expect(disco.memoria!.guardada).not.toBeNull()
    await vault.confirmarProvisorio()
    expect(disco.memoria!.guardada).toBeNull()
  })

  it("descartar um provisório não esquece a sessão da conta que ficou", async () => {
    const { disco, vault } = await cofreAberto()
    await vault.memorizar()
    await vault.criarProvisorio("a frase do provisório")
    vault.descartarProvisorio()
    expect(await new Vault(disco).abrirMemorizada()).toBe(true)
  })

  it("apagar a conta apaga a memória", async () => {
    const { disco, vault } = await cofreAberto()
    await vault.memorizar()
    await vault.destroy()
    expect(disco.memoria!.guardada).toBeNull()
    expect(disco.bytes).toBeNull()
  })

  it("sem memória na plataforma, abrir memorizada diz que não, e esquecer não atira", async () => {
    const vault = new Vault(new Disco({ memoria: false }))
    await vault.create(FRASE)
    vault.lock()
    expect(await vault.abrirMemorizada()).toBe(false)
    await expect(vault.esquecerSessao()).resolves.toBeUndefined()
  })

  it("um cofre `os` com uma memória perdida: não abre por ela, e apaga-a", async () => {
    const disco = new Disco({ os: true })
    const vault = new Vault(disco)
    await vault.create(null)
    disco.memoria!.guardada = new Uint8Array(32)
    vault.lock()
    expect(await vault.abrirMemorizada()).toBe(false)
    expect(disco.memoria!.guardada).toBeNull()
  })
})

describe("definir a palavra-passe num cofre `os` (F3)", () => {
  it("converte numa escrita só: a frase passa a abrir, e o cofre deixa de ser `os`", async () => {
    const disco = new Disco({ os: true })
    const vault = new Vault(disco)
    await vault.create(null)
    await vault.update((c) => {
      c.profile.displayName = "Bruno"
    })
    const antes = disco.escritas
    await vault.definirPalavraPasse(FRASE)
    expect(disco.escritas).toBe(antes + 1)
    expect((await vault.estado()).protection).toBe("passphrase")
    const envelope = JSON.parse(semCabecalho(disco.bytes!)!) as Record<string, unknown>
    expect(envelope.wrappedKey).toBeUndefined()

    vault.lock()
    await expect(vault.unlock()).rejects.toThrow("this vault needs a passphrase")
    await vault.unlock(FRASE)
    expect(vault.contents.profile.displayName).toBe("Bruno")
  })

  it("uma escrita que falhe deixa o cofre `os`, aberto, e a abrir como abria", async () => {
    const disco = new Disco({ os: true })
    const vault = new Vault(disco)
    await vault.create(null)
    disco.write = async () => {
      throw new Error("vault storage is full")
    }
    await expect(vault.definirPalavraPasse(FRASE)).rejects.toThrow("vault storage is full")
    expect(vault.unlocked).toBe(true)
    expect((await vault.estado()).protection).toBe("os")
    vault.lock()
    await vault.unlock()
    expect(vault.unlocked).toBe(true)
  })

  it("recusa num cofre que já tem palavra-passe, ou trancado", async () => {
    const { vault } = await cofreAberto()
    await expect(vault.definirPalavraPasse("outra")).rejects.toThrow("this vault already has a passphrase")
    vault.lock()
    await expect(vault.definirPalavraPasse("outra")).rejects.toThrow("vault is locked")
  })
})

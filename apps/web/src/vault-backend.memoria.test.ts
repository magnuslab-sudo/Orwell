import { beforeEach, describe, expect, it } from "vitest"
import { Vault, type DerivarChaveDoCofre } from "@enclave/client-core"
import { IdbFalso } from "./testes/idb-falso.js"
import { BrowserVaultBackend } from "./vault-backend.js"

/**
 * The session stored in the browser (F1): a non-extractable AES-GCM `CryptoKey`
 * wrapping the vault key, in the same store as the vault, under a separate key.
 *
 * Against the fake IndexedDB in `testes/`, with the core vault for real and
 * cheap derivation (Argon2id is not what we measure here).
 */

let idb: IdbFalso

beforeEach(() => {
  idb = new IdbFalso()
  ;(globalThis as { indexedDB?: unknown }).indexedDB = idb.indexedDB
})

const derivarBarato: DerivarChaveDoCofre = async (frase, sal) => {
  const bytes = new TextEncoder().encode(`${frase}:${Array.from(sal).join(",")}`)
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
}

async function cofre(backend = new BrowserVaultBackend()): Promise<{ backend: BrowserVaultBackend; vault: Vault }> {
  const vault = new Vault(backend, derivarBarato)
  return { backend, vault }
}

describe("a sessão memorizada no IndexedDB", () => {
  it("guarda uma CryptoKey que não se exporta, e nunca a chave do cofre em claro", async () => {
    const { backend, vault } = await cofre()
    await vault.create("a frase do browser")
    await vault.memorizar()
    const registo = idb.dados.get("sessao") as { chave: CryptoKey; embrulho: ArrayBuffer; via: string }
    expect(registo.via).toBe("webcrypto")
    expect(registo.chave.extractable).toBe(false)
    expect(registo.chave.algorithm.name).toBe("AES-GCM")
    const emClaro = vault.exportSessionKey()
    expect(new Uint8Array(registo.embrulho)).not.toEqual(emClaro)
    expect(await backend.memoria.existe()).toBe(true)
  })

  it("fechar o browser e voltar: um separador novo abre sem frase", async () => {
    const { vault } = await cofre()
    await vault.create("a frase do browser")
    await vault.update((c) => {
      c.profile.displayName = "Ana"
    })
    await vault.memorizar()
    vault.lock()

    const { vault: outro } = await cofre(new BrowserVaultBackend())
    expect(await outro.abrirMemorizada()).toBe(true)
    expect(outro.contents.profile.displayName).toBe("Ana")
  })

  it("memorizar não conta como escrita no cofre: a ficha de posse continua a aceitar o dono", async () => {
    const backend = new BrowserVaultBackend()
    await backend.assumirPosse("dono-a")
    const { vault } = await cofre(backend)
    await vault.create("a frase do browser")
    const putsDoCofre = idb.putsDoCofre
    await vault.memorizar()
    expect(idb.putsDoCofre).toBe(putsDoCofre)
    // The next owner write passes: the token digest is vault-only.
    await vault.update((c) => {
      c.profile.displayName = "Ana"
    })
    expect(idb.putsDoCofre).toBe(putsDoCofre + 1)
  })

  it("esquecer apaga só o registo; apagar a conta apaga os dois", async () => {
    const { backend, vault } = await cofre()
    await vault.create("a frase do browser")
    await vault.memorizar()
    await vault.esquecerSessao()
    expect(idb.dados.has("sessao")).toBe(false)
    expect(idb.dados.has("current")).toBe(true)

    await vault.memorizar()
    await vault.destroy()
    expect(idb.dados.has("sessao")).toBe(false)
    expect(idb.dados.has("current")).toBe(false)
    expect(await backend.memoria.ler()).toBeNull()
  })

  it("um registo com outra forma lê-se como nenhum", async () => {
    const { backend } = await cofre()
    idb.dados.set("sessao", { v: 1, via: "outra coisa" })
    expect(await backend.memoria.existe()).toBe(false)
    expect(await backend.memoria.ler()).toBeNull()
  })
})

describe('"Mudar de conta": cada conta com o seu cofre e a sua sessão', () => {
  it("a principal fica em `current` e `sessao`; uma conta acrescentada nas chaves dela", async () => {
    const { vault: ana } = await cofre(new BrowserVaultBackend())
    await ana.create("a frase da Ana")
    await ana.update((c) => {
      c.profile.displayName = "Ana"
    })
    await ana.memorizar()
    const { backend: doBruno, vault: bruno } = await cofre(new BrowserVaultBackend({ conta: "b0b" }))
    await bruno.create("a frase do Bruno")
    await bruno.update((c) => {
      c.profile.displayName = "Bruno"
    })
    expect([...idb.dados.keys()].sort()).toEqual(["cofre:b0b", "current", "sessao"])

    // Both open, each on its own path, and they do not mix.
    ana.lock()
    bruno.lock()
    const outraAna = new Vault(new BrowserVaultBackend(), derivarBarato)
    expect(await outraAna.abrirMemorizada()).toBe(true)
    expect(outraAna.contents.profile.displayName).toBe("Ana")
    const outroBruno = new Vault(new BrowserVaultBackend({ conta: "b0b" }), derivarBarato)
    expect(await outroBruno.abrirMemorizada()).toBe(false)
    await outroBruno.unlock("a frase do Bruno")
    expect(outroBruno.contents.profile.displayName).toBe("Bruno")

    expect(await doBruno.estadoDaConta("principal")).toEqual({ temCofre: true, memorizada: true })
    expect(await doBruno.estadoDaConta("b0b")).toEqual({ temCofre: true, memorizada: false })
    expect(await doBruno.estadoDaConta("nova")).toEqual({ temCofre: false, memorizada: false })
  })

  it("apagar uma conta não toca na outra", async () => {
    const { vault: ana } = await cofre(new BrowserVaultBackend())
    await ana.create("a frase da Ana")
    await ana.memorizar()
    const { vault: bruno } = await cofre(new BrowserVaultBackend({ conta: "b0b" }))
    await bruno.create("a frase do Bruno")
    await bruno.memorizar()
    await bruno.destroy()
    expect([...idb.dados.keys()].sort()).toEqual(["current", "sessao"])
  })

  it("um id que fugiria da chave recusa-se logo", () => {
    expect(() => new BrowserVaultBackend({ conta: "../x" })).toThrow("there is no such account on this device")
  })
})

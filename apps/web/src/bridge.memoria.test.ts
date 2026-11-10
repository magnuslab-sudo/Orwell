import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The session memory on the browser bridge (F1): the order of the silent attempt,
 * "Log out" forgetting BEFORE locking, and `navigator.storage.persist()` only on
 * iOS.
 */

const feito: string[] = []
let memorizada = false

vi.mock("@enclave/client-core", () => ({
  Call: class {
    on(): () => void {
      return () => {}
    }
    emit(): void {}
    rekey(): Promise<void> {
      return Promise.resolve()
    }
    async aplicarSomAoVivo(): Promise<void> {}
    readonly audio = { ligarPreferencias: () => () => {} }
  },
  Session: class {
    on(): () => void {
      return () => {}
    }
    disconnect(): void {
      feito.push("desligar")
    }
    reset(): void {
      feito.push("esquecer-grupos")
    }
  },
  Vault: class {
    async abrirMemorizada(): Promise<boolean> {
      feito.push("abrir-memorizada")
      return memorizada
    }
    async unlockWithKey(): Promise<void> {
      feito.push("abrir-com-chave-do-separador")
    }
    async unlock(): Promise<void> {
      feito.push("abrir-com-frase")
    }
    async memorizar(): Promise<void> {
      feito.push("memorizar")
      memorizada = true
    }
    async esquecerSessao(): Promise<void> {
      feito.push("esquecer-sessao")
      memorizada = false
    }
    lock(): void {
      feito.push("trancar")
    }
    exportSessionKey(): Uint8Array {
      return new Uint8Array(32).fill(1)
    }
  },
}))
vi.mock("@enclave/crypto", () => ({ kindOf: () => "application" }))
vi.mock("./vault-backend.js", () => ({ BrowserVaultBackend: class {} }))

const { createBrowserBridge } = await import("./bridge.js")

beforeEach(() => {
  feito.length = 0
  memorizada = false
  sessionStorage.clear()
})

describe("a ponte do browser e a sessão memorizada", () => {
  it("a tentativa silenciosa tenta primeiro a memória, e com ela abre sem tocar no separador", async () => {
    memorizada = true
    const ponte = createBrowserBridge()
    await ponte.vault.unlock(null)
    expect(feito).toEqual(["abrir-memorizada"])
    // Leave the key in the tab so F5 doesn't read memory again.
    expect(sessionStorage.getItem("enclave-session-key")).not.toBeNull()
  })

  it("sem memória, cai na chave do separador; sem nenhuma das duas, pede a frase", async () => {
    const ponte = createBrowserBridge()
    await expect(ponte.vault.unlock(null)).rejects.toThrow("this vault needs a passphrase")
    expect(feito).toEqual(["abrir-memorizada"])
    feito.length = 0
    sessionStorage.setItem("enclave-session-key", btoa(String.fromCharCode(...new Uint8Array(32))))
    await ponte.vault.unlock(null)
    expect(feito).toEqual(["abrir-memorizada", "abrir-com-chave-do-separador"])
  })

  it('"Terminar sessão" esquece a sessão ANTES de desligar e trancar', async () => {
    memorizada = true
    const ponte = createBrowserBridge()
    await ponte.vault.lock()
    expect(feito.indexOf("esquecer-sessao")).toBe(0)
    expect(feito).toEqual(["esquecer-sessao", "desligar", "esquecer-grupos", "trancar"])
    expect(memorizada).toBe(false)
  })

  it("`memorizar(true)` memoriza e `memorizar(false)` esquece, sem trancar", async () => {
    const ponte = createBrowserBridge()
    await ponte.vault.memorizar?.(true)
    await ponte.vault.memorizar?.(false)
    expect(feito).toEqual(["memorizar", "esquecer-sessao"])
  })

  it("no iPhone pede `navigator.storage.persist()`; noutro browser não pergunta nada", async () => {
    const persist = vi.fn(async () => true)
    Object.defineProperty(navigator, "storage", { value: { persist }, configurable: true })
    const agente = vi.spyOn(navigator, "userAgent", "get")
    const ponte = createBrowserBridge()

    agente.mockReturnValue("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0")
    await ponte.vault.memorizar?.(true)
    expect(persist).not.toHaveBeenCalled()

    agente.mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile/15E148 Safari/604.1")
    await ponte.vault.memorizar?.(true)
    expect(persist).toHaveBeenCalledTimes(1)
    agente.mockRestore()
  })
})

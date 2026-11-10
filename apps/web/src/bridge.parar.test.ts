import { describe, expect, it, vi } from "vitest"

/**
 * A tab that stopped being the owner, or became stale, stops writing.
 *
 * The order is what we lock here: disconnect (which saves the pending batch)
 * BEFORE sealing the vault, and only resolve after the last write finishes.
 * That resolution is what allows `posse-do-separador.ts` to release the latch.
 */

const registo: string[] = []
let terminarEscrita: () => void = () => {}

vi.mock("@enclave/client-core", () => ({
  Call: class {
    active = false
    on(): () => void {
      return () => {}
    }
    emit(): void {}
  },
  Session: class {
    on(): () => void {
      return () => {}
    }
    flush(): Promise<void> {
      registo.push("flush")
      return Promise.resolve()
    }
    disconnect(): void {
      registo.push("disconnect")
    }
    connect(): Promise<void> {
      registo.push("connect")
      return Promise.resolve()
    }
  },
  Vault: class {},
}))

vi.mock("@enclave/crypto", () => ({ kindOf: () => "application" }))
vi.mock("./vault-backend.js", () => ({
  BrowserVaultBackend: class {
    selar(): void {
      registo.push("selar")
    }
    escritasAcabadas(): Promise<void> {
      registo.push("a-esperar-escritas")
      return new Promise<void>((resolve) => {
        terminarEscrita = () => {
          registo.push("escritas-acabadas")
          resolve()
        }
      })
    }
  },
}))

const { createBrowserBridge } = await import("./bridge.js")

describe("pararDeEscrever", () => {
  it("desliga, sela, e só resolve quando a última escrita acaba", async () => {
    registo.length = 0
    const ponte = createBrowserBridge()
    let resolvido = false
    const parado = ponte.pararDeEscrever().then(() => {
      resolvido = true
    })
    await Promise.resolve()
    expect(registo).toEqual(["disconnect", "selar", "a-esperar-escritas"])
    expect(resolvido).toBe(false)
    terminarEscrita()
    await parado
    expect(resolvido).toBe(true)
  })

  it("depois de parado não volta a ligar, nem grava ao sair da página", async () => {
    registo.length = 0
    const ponte = createBrowserBridge()
    const parado = ponte.pararDeEscrever()
    terminarEscrita()
    await parado
    registo.length = 0

    await expect(ponte.session.connect()).rejects.toThrow("this tab no longer writes")
    window.dispatchEvent(new Event("pagehide"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(registo).not.toContain("connect")
    expect(registo).not.toContain("flush")
  })

  it("sem gravar (posse perdida): sela ANTES de desligar, para o lote do disconnect ser recusado", async () => {
    registo.length = 0
    const ponte = createBrowserBridge()
    const parado = ponte.pararDeEscrever({ gravar: false })
    await Promise.resolve()
    expect(registo).toEqual(["selar", "disconnect", "a-esperar-escritas"])
    terminarEscrita()
    await parado
  })

  it("parar duas vezes desliga uma vez só", async () => {
    registo.length = 0
    const ponte = createBrowserBridge()
    const primeira = ponte.pararDeEscrever()
    terminarEscrita()
    await primeira
    const segunda = ponte.pararDeEscrever()
    terminarEscrita()
    await segunda
    expect(registo.filter((passo) => passo === "disconnect")).toHaveLength(1)
  })
})

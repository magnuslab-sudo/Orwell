import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The temporary vault for pairing, in the browser bridge (core 1j).
 *
 * The core proves the vault (`vault.test.ts`) and the screen proves the step
 * order (`Unlock.test.tsx`), but between them is this glue: this is where the
 * temporary goes to disk on `pairing.done` and is released on `pairing.cancel`.
 * Without it, the temporary never reached disk (the device would sign up and
 * lose the new account on close) or was never released (the session stayed
 * connected to an account the disk doesn't have).
 */

const feito: string[] = []
let provisorio = false
let gravacaoFalha: Error | null = null

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
  },
  Session: class {
    on(): () => void {
      return () => {}
    }
    cancelarEmparelhamento(): void {
      feito.push("cancelar")
    }
    concluirEmparelhamento(): void {
      feito.push("pronto")
    }
    disconnect(): void {
      feito.push("desligar")
    }
    reset(): void {
      feito.push("esquecer")
    }
  },
  Vault: class {
    get provisorio(): boolean {
      return provisorio
    }
    async criarProvisorio(): Promise<void> {
      feito.push("criar-provisorio")
      provisorio = true
    }
    async confirmarProvisorio(): Promise<void> {
      if (gravacaoFalha) throw gravacaoFalha
      feito.push("gravar-provisorio")
      provisorio = false
    }
    descartarProvisorio(): void {
      feito.push("largar-provisorio")
      provisorio = false
    }
    exportSessionKey(): Uint8Array {
      return new Uint8Array(32)
    }
  },
}))

vi.mock("@enclave/crypto", () => ({ kindOf: () => "application" }))
vi.mock("./vault-backend.js", () => ({ BrowserVaultBackend: class {} }))

const { createBrowserBridge } = await import("./bridge.js")

beforeEach(() => {
  feito.length = 0
  provisorio = false
  gravacaoFalha = null
})

describe("a ponte do browser e o cofre provisório", () => {
  it('o "pronto" só sai depois de o provisório estar gravado', async () => {
    const bridge = createBrowserBridge()
    await bridge.vault.createProvisional?.("frase")
    await bridge.pairing?.done()
    expect(feito).toEqual(["criar-provisorio", "gravar-provisorio", "pronto"])
  })

  it('uma gravação que falha atira, e o computador não ouve "pronto"', async () => {
    const bridge = createBrowserBridge()
    await bridge.vault.createProvisional?.("frase")
    gravacaoFalha = new Error("vault storage is full")
    await expect(bridge.pairing?.done()).rejects.toThrow("vault storage is full")
    expect(feito).not.toContain("pronto")
  })

  it("cancelar com um provisório aberto desliga, esquece e larga-o", async () => {
    const bridge = createBrowserBridge()
    await bridge.vault.createProvisional?.("frase")
    await bridge.pairing?.cancel()
    expect(feito).toEqual(["criar-provisorio", "cancelar", "desligar", "esquecer", "largar-provisorio"])
  })

  it("cancelar sem provisório só cancela, como sempre", async () => {
    const bridge = createBrowserBridge()
    await bridge.pairing?.cancel()
    await bridge.pairing?.done()
    expect(feito).toEqual(["cancelar", "pronto"])
  })
})

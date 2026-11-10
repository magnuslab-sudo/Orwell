import { describe, expect, it, vi } from "vitest"

/**
 * The tab that goes away saves what was in the timer.
 *
 * It closes the connection and nothing else: what the save carries comes from
 * the core, and the guarantee that matters, anchor and group on disk always
 * together, is locked in `packages/client-core/src/session.particao.test.ts`.
 */

const gravacoes = { pedidas: 0 }

vi.mock("@enclave/client-core", () => ({
  Call: class {
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
      gravacoes.pedidas += 1
      // A locked vault refuses: the bridge cannot let this escape.
      return Promise.reject(new Error("vault is locked"))
    }
  },
  Vault: class {},
}))

vi.mock("@enclave/crypto", () => ({ kindOf: () => "application" }))
vi.mock("./vault-backend.js", () => ({ BrowserVaultBackend: class {} }))

const { createBrowserBridge } = await import("./bridge.js")

describe("a ponte do browser ao sair da página", () => {
  it("pede ao núcleo que grave o que tem por gravar", async () => {
    createBrowserBridge()
    expect(gravacoes.pedidas).toBe(0)

    window.dispatchEvent(new Event("pagehide"))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(gravacoes.pedidas).toBe(1)
  })
})

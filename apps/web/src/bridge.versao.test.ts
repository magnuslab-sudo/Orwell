import { describe, expect, it, vi } from "vitest"

/**
 * The vault version in the browser bridge (1.0 "Arca", slice 2).
 *
 * The gate asks `vault.status()` before asking for the password. With a beta vault it must hear
 * `versao: "beta"` and nothing else: the bridge reads only the header, and the derivation
 * (the Argon2id worker) never runs. Here the vault is the TRUE one from the core, over a
 * disk in memory; only the session and the call are duplicates, because `status` does not touch them.
 */

/** What the bridge gave the session when it created it. */
const criacao = vi.hoisted(() => ({ opcoes: undefined as unknown }))

vi.mock("@enclave/client-core", async (original) => ({
  ...(await original<typeof import("@enclave/client-core")>()),
  Call: class {
    on(): () => void {
      return () => {}
    }
    emit(): void {}
    async rekey(): Promise<void> {}
    async aplicarSomAoVivo(): Promise<void> {}
  },
  Session: class {
    constructor(_vault: unknown, opcoes?: unknown) {
      criacao.opcoes = opcoes
    }
    on(): () => void {
      return () => {}
    }
    disconnect(): void {}
    reset(): void {}
  },
}))
vi.mock("@enclave/crypto", () => ({ kindOf: () => "application" }))
vi.mock("./vault-backend.js", () => ({ BrowserVaultBackend: class {} }))

const { CABECALHO_DO_COFRE } = await import("@enclave/client-core")
const pacote = (await import("../package.json", { with: { type: "json" } })).default as { version: string }
const { createBrowserBridge } = await import("./bridge.js")

type Disco = NonNullable<NonNullable<Parameters<typeof createBrowserBridge>[0]>["backend"]>

/** A disk in memory, with the bytes given to it. Only what `Vault` uses from the browser backend. */
function disco(bytes: Uint8Array | null): Disco {
  const memoria = {
    bytes,
    supportsOsProtection: false,
    async read() {
      return this.bytes
    },
    async write(novos: Uint8Array) {
      this.bytes = novos
    },
    async clear() {
      this.bytes = null
    },
  }
  return memoria as unknown as Disco
}

describe("a ponte do browser diz a versão do cofre", () => {
  it("um cofre do beta dá versao beta, e a derivação não corre", async () => {
    const derivar = vi.fn(async () => new Uint8Array(32))
    const seloDoBeta = new TextEncoder().encode(
      JSON.stringify({ version: 2, protection: "passphrase", salt: "AA", nonce: "AA", ciphertext: "AA" }),
    )
    const bridge = createBrowserBridge({ backend: disco(seloDoBeta), derivar })

    expect(await bridge.vault.status()).toEqual({ exists: true, supportsOsProtection: false, versao: "beta" })
    expect(derivar).not.toHaveBeenCalled()
  })

  it("um cofre da 1.0 dá versao orwv2", async () => {
    const bytes = new TextEncoder().encode(`${CABECALHO_DO_COFRE}{}`)
    const bridge = createBrowserBridge({ backend: disco(bytes), derivar: vi.fn() })
    expect(await bridge.vault.status()).toEqual({ exists: true, supportsOsProtection: false, versao: "orwv2" })
  })

  it("sem cofre não há versão", async () => {
    const bridge = createBrowserBridge({ backend: disco(null), derivar: vi.fn() })
    expect(await bridge.vault.status()).toEqual({ exists: false, supportsOsProtection: false })
  })
})

describe("a ponte do browser dá à sessão a versão da app", () => {
  it("a do package.json da app, para os dois hello", () => {
    createBrowserBridge({ backend: disco(null), derivar: vi.fn() })
    expect(criacao.opcoes).toEqual({ versaoDaApp: pacote.version })
  })
})

import { describe, expect, it, vi } from "vitest"

/**
 * The short invite link on the browser bridge (1.0 "Arca", slice 5b-2).
 *
 * Creating gives the short one when the session has it, and the long one when
 * the server gave no short code. Resolving passes the link to the session as it
 * came. The session is a double: what it does with the link is measured in the
 * core (`session.convite-curto.rede.test.ts`).
 */

const sessao = vi.hoisted(() => ({
  criarConvite: vi.fn(async () => ({ longa: "https://s/app/convite#!sala%3As/0123456789abcdef", curta: "https://s/c#ab23cd45.0123456789abcdef" as string | null })),
  resolverConvite: vi.fn(async (link: string) => `resolvida:${link}`),
}))

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
    criarConvite = sessao.criarConvite
    resolverConvite = sessao.resolverConvite
    on(): () => void {
      return () => {}
    }
    disconnect(): void {}
    reset(): void {}
  },
}))
vi.mock("@enclave/crypto", () => ({ kindOf: () => "application" }))
vi.mock("./vault-backend.js", () => ({ BrowserVaultBackend: class {} }))

const { createBrowserBridge } = await import("./bridge.js")

describe("a ponte do browser e a ligação curta de convite", () => {
  it("criar dá a curta, e a longa quando o servidor não deu código curto", async () => {
    const bridge = createBrowserBridge()
    expect(await bridge.invites.create("!sala:s", { maxUses: 1 })).toBe("https://s/c#ab23cd45.0123456789abcdef")
    expect(sessao.criarConvite).toHaveBeenCalledWith("!sala:s", { maxUses: 1 })

    sessao.criarConvite.mockResolvedValueOnce({ longa: "https://s/app/convite#!sala%3As/x", curta: null })
    expect(await bridge.invites.create("!sala:s", {})).toBe("https://s/app/convite#!sala%3As/x")
  })

  it("resolver passa a ligação à sessão tal como veio, e devolve a longa", async () => {
    const bridge = createBrowserBridge()
    expect(await bridge.invites.resolve?.("https://s/c#ab23cd45.0123456789abcdef")).toBe(
      "resolvida:https://s/c#ab23cd45.0123456789abcdef",
    )
    expect(sessao.resolverConvite).toHaveBeenCalledExactlyOnceWith("https://s/c#ab23cd45.0123456789abcdef")
  })
})

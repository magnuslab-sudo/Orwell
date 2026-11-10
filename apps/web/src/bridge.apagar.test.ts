import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Deleting the account leaves the channels BEFORE destroying the vault. Proved
 * in the bridge.
 *
 * **Why this deserves its own file.** The original bug is known: `Vault.destroy()`
 * cleaned up the local vault and nothing else, and the person's leaf stayed in
 * the MLS tree of each channel, with the epoch stopped. The fix is in the core
 * (`Session.prepareAccountDeletion`) and has its own tests; the screen that
 * reports the failure has its own. But in between is this glue line, and it had
 * no test.
 *
 * Core tests call `prepareAccountDeletion` by hand; screen tests talk to a fake
 * bridge. Removing the call from here left all fifteen tests green and handed
 * the whole bug back to the user. That is exactly the kind of hole the bridge
 * layer already had once, when we found that `applyMediaPrefs` was never
 * implemented (see `bridge.media.test.ts`).
 *
 * What ties in here is the ORDER and the REFUSAL, where the decision lies: leave
 * first, and if you cannot leave, destroy nothing.
 */

/** What the bridge did to the core, in the order it did it. */
const feito: string[] = []
/** What `prepareAccountDeletion` will answer in this run. */
let saidaFalha: Error | null = null

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
    async prepareAccountDeletion(): Promise<void> {
      feito.push("sair-dos-canais")
      if (saidaFalha) throw saidaFalha
    }
    disconnect(): void {
      feito.push("desligar")
    }
    reset(): void {
      feito.push("esquecer")
    }
  },
  Vault: class {
    async destroy(): Promise<void> {
      feito.push("destruir-cofre")
    }
  },
}))

vi.mock("@enclave/crypto", () => ({ kindOf: () => "application" }))
vi.mock("./vault-backend.js", () => ({ BrowserVaultBackend: class {} }))

const { createBrowserBridge } = await import("./bridge.js")

beforeEach(() => {
  feito.length = 0
  saidaFalha = null
})

describe("a ponte do browser não apaga uma conta que continua nos canais", () => {
  it("sai dos canais primeiro, e só depois destrói o cofre", async () => {
    const bridge = createBrowserBridge()

    await bridge.vault.destroy()

    // The order is the entire fix: destroying first throws away the keys that the
    // leave request would need to encrypt with.
    expect(feito).toEqual(["sair-dos-canais", "desligar", "esquecer", "destruir-cofre"])
  })

  it("se a saída falhar, NÃO destrói o cofre e deixa o erro subir ao ecrã", async () => {
    // The decision recorded in `docs/PENDENTES.md`: destroying the vault without
    // leaving is the worst of both worlds, because the person stays convinced they
    // left and stays in everyone's member list, with the epoch frozen and no device
    // in the world able to request the leave.
    saidaFalha = new Error("Não foi possível sair de 1 canal, por isso a conta não foi apagada")
    const bridge = createBrowserBridge()

    await expect(bridge.vault.destroy()).rejects.toThrow(/não foi apagada/i)

    // Nothing after the leave had a chance to run. The error that bubbles up is
    // what the screen shows, and that is why it cannot be swallowed here.
    expect(feito).toEqual(["sair-dos-canais"])
    expect(feito).not.toContain("destruir-cofre")
  })
})

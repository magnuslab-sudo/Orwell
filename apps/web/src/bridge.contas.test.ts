import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * "Switch account" on the browser bridge: the account in this tab comes from
 * the `localStorage` list; switching and adding close the open account WITHOUT
 * forgetting its stored session; and each account has its own tab key.
 */

const feito: string[] = []
const contasDosBackends: (string | undefined)[] = []
const cofres = new Set<string>(["principal"])

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
    async prepareAccountDeletion(): Promise<void> {}
  },
  Vault: class {
    unlocked = true
    provisorio = false
    contents = { profile: { displayName: "Ana" } }
    async unlock(): Promise<void> {}
    async abrirMemorizada(): Promise<boolean> {
      return false
    }
    async esquecerSessao(): Promise<void> {
      feito.push("esquecer-sessao")
    }
    async destroy(): Promise<void> {
      feito.push("apagar")
    }
    lock(): void {
      feito.push("trancar")
      this.unlocked = false
    }
    exportSessionKey(): Uint8Array {
      return new Uint8Array(32).fill(7)
    }
  },
}))
vi.mock("@enclave/crypto", () => ({ kindOf: () => "application" }))
vi.mock("./vault-backend.js", () => ({
  BrowserVaultBackend: class {
    constructor(opcoes: { conta?: string } = {}) {
      contasDosBackends.push(opcoes.conta)
    }
    async estadoDaConta(id: string): Promise<{ temCofre: boolean; memorizada: boolean }> {
      return { temCofre: cofres.has(id), memorizada: false }
    }
  },
}))

const { createBrowserBridge, LISTA_DE_CONTAS } = await import("./bridge.js")

beforeEach(() => {
  feito.length = 0
  contasDosBackends.length = 0
  cofres.clear()
  cofres.add("principal")
  localStorage.clear()
  sessionStorage.clear()
})

describe("a ponte do browser e as contas do aparelho", () => {
  it("sem lista, a ponte abre a principal e nada se grava: nada muda para quem tem uma conta", async () => {
    const ponte = createBrowserBridge()
    expect(contasDosBackends).toEqual(["principal"])
    const { contas } = await ponte.contas!.listar()
    expect(contas).toEqual([{ id: "principal", nome: "", activa: true, temCofre: true, memorizada: false }])
    expect(localStorage.getItem(LISTA_DE_CONTAS)).toBeNull()
  })

  it("acrescentar não esquece a sessão desta conta nem a fecha a meio do desenho; a ponte seguinte abre a nova", async () => {
    const ponte = createBrowserBridge()
    await ponte.vault.unlock("frase")
    expect(sessionStorage.getItem("enclave-session-key")).not.toBeNull()
    await ponte.contas!.acrescentar()
    // The open account dies on reload, like closing the tab: nothing disconnects or
    // locks here, and its stored session stays.
    expect(feito).toEqual([])
    // This account's tab key goes away, like locking.
    expect(sessionStorage.getItem("enclave-session-key")).toBeNull()
    const lista = JSON.parse(localStorage.getItem(LISTA_DE_CONTAS) ?? "null") as { activa: string; contas: { id: string; nome: string }[] }
    expect(lista.contas[0]).toEqual({ id: "principal", nome: "Ana" })
    expect(lista.activa).not.toBe("principal")

    // "Reload": the new bridge opens the new account, with its tab key.
    const nova = createBrowserBridge()
    expect(contasDosBackends.at(-1)).toBe(lista.activa)
    await nova.vault.unlock("outra frase")
    expect(sessionStorage.getItem(`enclave-session-key:${lista.activa}`)).not.toBeNull()
    expect(sessionStorage.getItem("enclave-session-key")).toBeNull()
  })

  it("mudar para uma conta que não está no aparelho atira 137 e não fecha nada", async () => {
    const ponte = createBrowserBridge()
    await expect(ponte.contas!.mudar("nenhuma")).rejects.toThrow("there is no such account on this device")
    expect(feito).toEqual([])
  })

  it("mudar de volta, e apagar a activa passa à outra", async () => {
    const ponte = createBrowserBridge()
    await ponte.contas!.acrescentar()
    const nova = (JSON.parse(localStorage.getItem(LISTA_DE_CONTAS) ?? "{}") as { activa: string }).activa
    cofres.add(nova)
    const naNova = createBrowserBridge()
    await naNova.contas!.mudar("principal")
    expect((JSON.parse(localStorage.getItem(LISTA_DE_CONTAS) ?? "{}") as { activa: string }).activa).toBe("principal")

    // Delete the main one: it leaves the list, the active one becomes the new one.
    const naPrincipal = createBrowserBridge()
    await naPrincipal.vault.destroy()
    const depois = JSON.parse(localStorage.getItem(LISTA_DE_CONTAS) ?? "{}") as { activa: string; contas: { id: string }[] }
    expect(depois.activa).toBe(nova)
    expect(depois.contas.map((c) => c.id)).toEqual([nova])
  })

  it('"Bloquear agora" noutro separador apaga as chaves do separador de todas as contas', async () => {
    const { ouvirBloqueios, avisarBloqueio } = await import("./bridge.js")
    sessionStorage.setItem("enclave-session-key", "a")
    sessionStorage.setItem("enclave-session-key:b0b", "b")
    sessionStorage.setItem("outra-coisa", "c")
    ouvirBloqueios("canal-de-teste")
    avisarBloqueio("canal-de-teste")
    await vi.waitFor(() => expect(sessionStorage.getItem("enclave-session-key:b0b")).toBeNull())
    expect(sessionStorage.getItem("enclave-session-key")).toBeNull()
    expect(sessionStorage.getItem("outra-coisa")).toBe("c")
  })
})

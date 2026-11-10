import { describe, expect, it, vi } from "vitest"
import { desembrulhar, desembrulharAnfitriao } from "./envelope.js"

/**
 * The renderer remakes the error that the main process put in the envelope.
 *
 * What matters: the interface receives the same `Error` that the web bridge throws,
 * with the catalog key in the `message`. And what is not an error envelope passes as
 * it did.
 */
describe("desembrulhar", () => {
  it("um envelope de erro volta a ser um Error com chave, nome e causa", () => {
    expect(() => desembrulhar({ ok: false, chave: "wrong passphrase", detalhe: { n: 1 }, nome: "X" })).toThrow(
      expect.objectContaining({ message: "wrong passphrase", name: "X", cause: { n: 1 } }),
    )
  })

  it("sem detalhe, o erro não leva causa", () => {
    try {
      desembrulhar({ ok: false, chave: "falhou", detalhe: null, nome: "Error" })
    } catch (erro) {
      expect((erro as Error).cause).toBeUndefined()
      return
    }
    throw new Error("devia ter atirado")
  })

  it("um { ok: false } sem chave é uma resposta normal, e passa", () => {
    // The skipped update that did not save responds like this, and is not an error.
    expect(desembrulhar({ ok: false })).toEqual({ ok: false })
  })

  it("respostas normais passam tal e qual", () => {
    expect(desembrulhar({ ok: true })).toEqual({ ok: true })
    expect(desembrulhar(null)).toBeNull()
    expect(desembrulhar(["!a:casa.pt"])).toEqual(["!a:casa.pt"])
  })
})

describe("desembrulharAnfitriao", () => {
  const envelope = { ok: false, chave: "wrong passphrase", detalhe: null, nome: "Error" }

  it("um pedido que falha atira o erro com a chave", async () => {
    const anfitriao = desembrulharAnfitriao({ vault: { unlock: async () => envelope } })
    await expect(anfitriao.vault.unlock()).rejects.toThrow("wrong passphrase")
  })

  it("um pedido que corre bem devolve a resposta e os argumentos chegam", async () => {
    const unlock = vi.fn(async (frase: string) => ({ ok: true, frase }))
    const anfitriao = desembrulharAnfitriao({ vault: { unlock } })
    await expect(anfitriao.vault.unlock("abc")).resolves.toEqual({ ok: true, frase: "abc" })
    expect(unlock).toHaveBeenCalledWith("abc")
  })

  it("as leituras síncronas dos canais não mudam: o envelope delas é delas", () => {
    const leitura = { ok: false, erro: "cofre fechado" }
    const anfitriao = desembrulharAnfitriao({ channels: { rooms: () => leitura } })
    expect(anfitriao.channels.rooms()).toBe(leitura)
  })

  it("os ouvintes de `on` ficam como estão", () => {
    const message = (): (() => void) => () => {}
    const anfitriao = desembrulharAnfitriao({ on: { message } })
    expect(anfitriao.on.message).toBe(message)
  })
})

describe("desembrulharAnfitriao, com o anfitrião congelado", () => {
  it("lê e embrulha sem atirar, e a cópia por espalhamento também funciona", async () => {
    const envelope = { ok: false, chave: "wrong passphrase", detalhe: null, nome: "Error" }
    // The `contextBridge` can deliver frozen objects.
    const anfitriao = desembrulharAnfitriao(Object.freeze({ vault: Object.freeze({ unlock: async () => envelope }) }))
    await expect(anfitriao.vault.unlock()).rejects.toThrow("wrong passphrase")
    expect(anfitriao.vault).toBe(anfitriao.vault)
    const copia = { ...anfitriao.vault }
    await expect(copia.unlock()).rejects.toThrow("wrong passphrase")
    expect("unlock" in anfitriao.vault).toBe(true)
  })
})

import { describe, expect, it } from "vitest"
import { embrulharErros, erroEmEnvelope } from "./envelope.js"
import { desembrulhar } from "../renderer/envelope.js"

/**
 * The error from the main process reaches the interface with the key intact.
 *
 * This was "Error 900" in the installed app: the exception rose raw, Electron
 * rewrote the message to `Error invoking remote method …`, and the error
 * catalog never found the key.
 */
describe("embrulharErros", () => {
  it("o que corre bem sai como saía", async () => {
    const pedido = embrulharErros(async (a: number, b: number) => ({ ok: true, soma: a + b }))
    expect(await pedido(2, 3)).toEqual({ ok: true, soma: 5 })
  })

  it("um handler síncrono também", async () => {
    const pedido = embrulharErros(() => "!canal:casa.pt")
    expect(await pedido()).toBe("!canal:casa.pt")
  })

  it("uma recusa vira envelope com chave, nome e detalhe", async () => {
    const pedido = embrulharErros(async () => {
      const erro = new Error("wrong passphrase", { cause: { tentativas: 3 } })
      erro.name = "PalavraPasseErrada"
      throw erro
    })
    expect(await pedido()).toEqual({
      ok: false,
      chave: "wrong passphrase",
      detalhe: { tentativas: 3 },
      nome: "PalavraPasseErrada",
    })
  })

  it("uma excepção síncrona também é apanhada", async () => {
    const pedido = embrulharErros(() => {
      throw new Error("não és membro de !x:casa.pt")
    })
    expect(await pedido()).toMatchObject({ ok: false, chave: "não és membro de !x:casa.pt", nome: "Error" })
  })

  it("um detalhe que não se serializa não leva o erro com ele", () => {
    // A field with a function drops out (JSON ignores it); the rest stays.
    const envelope = erroEmEnvelope(new Error("falhou", { cause: { fazer: () => 1, n: 2 } }))
    expect(envelope.chave).toBe("falhou")
    expect(envelope.detalhe).toEqual({ n: 2 })
    // A `cause` that is itself a function becomes text, and the key stays.
    const funcao = erroEmEnvelope(new Error("falhou", { cause: () => 1 }))
    expect(typeof funcao.detalhe).toBe("string")
    // And the whole envelope crosses cloning, which is what IPC does.
    expect(() => structuredClone(envelope)).not.toThrow()
    expect(() => structuredClone(funcao)).not.toThrow()
  })

  it("quem atira uma string fica com ela como chave", () => {
    expect(erroEmEnvelope("cofre fechado")).toEqual({ ok: false, chave: "cofre fechado", detalhe: null, nome: "Error" })
  })
})

describe("ida e volta", () => {
  it("o erro refeito do lado do renderer é o que saiu do núcleo", async () => {
    const original = new Error("wrong passphrase", { cause: "detalhe" })
    original.name = "PalavraPasseErrada"
    const envelope = structuredClone(await embrulharErros(async () => Promise.reject(original))())
    let refeito: unknown
    try {
      desembrulhar(envelope)
    } catch (erro) {
      refeito = erro
    }
    expect(refeito).toBeInstanceOf(Error)
    expect((refeito as Error).message).toBe("wrong passphrase")
    expect((refeito as Error).name).toBe("PalavraPasseErrada")
    expect((refeito as Error).cause).toBe("detalhe")
  })
})

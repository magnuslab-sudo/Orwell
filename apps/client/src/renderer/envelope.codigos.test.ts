import { erroDaChamada, RecusaDoSfu } from "@enclave/client-core"
import { describe, expect, it } from "vitest"
import { CODIGO_DESCONHECIDO, CODIGOS_DE_ERRO, codigoDoErro } from "../../../../packages/ui/src/lib/codigosDeErro.js"
import { traduzirErro, translatePairingError } from "../../../../packages/ui/src/strings.js"
import { embrulharErros } from "../main/envelope.js"
import { desembrulharAnfitriao } from "./envelope.js"

/**
 * The IPC bench: each key in the catalog crosses the envelope whole, and the code
 * shown in the installed app is the same as in the browser.
 *
 * The path is the real app, with Electron taken out: the handler of the main process
 * dressed in `embrulharErros`, the envelope cloned as IPC clones it
 * (`structuredClone`, the same algorithm), and the host of the renderer dressed in
 * `desembrulharAnfitriao`. On the other side, the interface translates the error
 * remade with `traduzirErro`, as it does in each `catch`.
 *
 * The comparison is with the ORIGINAL error translated in the web bridge, where there
 * is no IPC: the same phrase on both sides is the parity that "Error 900" broke.
 */

/** A host with one request, which fails with `erro` on the side of the main process. */
function anfitriaoQueFalhaCom(erro: unknown): { pedir: () => Promise<unknown> } {
  const handler = embrulharErros(async () => Promise.reject(erro))
  // What `ipcRenderer.invoke` delivers: the response of the handler, cloned.
  const preload = { pedir: async () => structuredClone(await handler()) }
  return desembrulharAnfitriao(preload)
}

async function refeito(erro: unknown): Promise<Error> {
  try {
    await anfitriaoQueFalhaCom(erro).pedir()
  } catch (apanhado) {
    return apanhado as Error
  }
  throw new Error("o pedido devia ter falhado")
}

describe("cada chave do catálogo atravessa o IPC inteira", () => {
  it("todas as chaves: a mesma mensagem, o mesmo código, a mesma frase", async () => {
    const chaves = Object.keys(CODIGOS_DE_ERRO)
    expect(chaves.length).toBeGreaterThan(100)
    for (const chave of chaves) {
      const original = new Error(chave, { cause: { canal: "!lagar:casa.pt", canais: 2, max: 3 } })
      const doOutroLado = await refeito(original)
      expect(doOutroLado.message, chave).toBe(chave)
      expect(codigoDoErro(doOutroLado.message), chave).toBe(CODIGOS_DE_ERRO[chave])
      expect(doOutroLado.cause, chave).toEqual(original.cause)
      expect(traduzirErro(doOutroLado), chave).toBe(traduzirErro(original))
    }
  })

  it("a frase com dados usa o `cause` que atravessou", async () => {
    const original = new Error("the room has the maximum of pinned messages", { cause: { max: 5 } })
    expect(traduzirErro(await refeito(original))).toMatch(/^Erro 330\n.*5 mensagens fixas/)
  })
})

describe("os erros que não nascem no catálogo também chegam com código", () => {
  it("uma recusa do SFU, que só tem a chave e o `cause` do outro lado (a classe fica no principal)", async () => {
    const recusa = new RecusaDoSfu("chamada-cheia", "esta chamada já tem 12 pessoas")
    const doOutroLado = await refeito(recusa)
    expect(doOutroLado).not.toBeInstanceOf(RecusaDoSfu)
    expect(doOutroLado.name).toBe("RecusaDoSfu")
    expect(doOutroLado.cause).toEqual({ codigo: "chamada-cheia", frase: "esta chamada já tem 12 pessoas" })
    expect(traduzirErro(doOutroLado)).toMatch(/^Erro 425\n/)
    // And the call, in the renderer, says the same key it would say in the browser.
    expect(erroDaChamada(doOutroLado, "the call media failed")).toEqual(erroDaChamada(recusa, "the call media failed"))
  })

  it("um erro do browser guarda o `name`, e é pelo nome que ganha o código", async () => {
    // In Node of the main process a `DOMException` is an `Error`; in the jsdom of this
    // bench it is not. An `Error` with the same name is what the main process sees.
    const recusado = Object.assign(new Error("Permission denied"), { name: "NotAllowedError" })
    const doOutroLado = await refeito(recusado)
    expect(doOutroLado.name).toBe("NotAllowedError")
    expect(traduzirErro(doOutroLado)).toMatch(/^Erro 404\n/)
    expect(traduzirErro(doOutroLado)).toBe(traduzirErro(recusado))
  })

  it("uma razão de emparelhamento chega como chave e é traduzida como no browser", async () => {
    const doOutroLado = await refeito(new Error("recusado:full"))
    expect(translatePairingError(doOutroLado.message, doOutroLado.cause)).toMatch(/^Erro 707\n/)
  })

  it("o imprevisto continua o 900, com a mesma mensagem em cru dos dois lados", async () => {
    const original = new TypeError("createEncodedStreams is not a function")
    const doOutroLado = await refeito(original)
    expect(codigoDoErro(doOutroLado.message)).toBe(CODIGO_DESCONHECIDO)
    expect(traduzirErro(doOutroLado)).toBe(
      "Erro 900\nAconteceu um erro que a app não conhece.\ncreateEncodedStreams is not a function",
    )
    expect(traduzirErro(doOutroLado)).toBe(traduzirErro(original))
  })
})

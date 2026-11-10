import { describe, expect, it } from "vitest"
import { RecusaDoSfu, RECUSA_DO_SFU_GENERICA } from "./call-sfu.js"
import { erroDaChamada } from "./call.js"
import { chaveDoErroDoBrowser, comChaveDoBrowser } from "./erros-do-browser.js"

const doBrowser = (name: string, message = "frase do motor"): Error => Object.assign(new Error(message), { name })

describe("os erros do browser ganham a chave pelo `name`", () => {
  it("o mesmo nome dá a mesma chave, seja qual for a frase do motor", () => {
    expect(chaveDoErroDoBrowser(doBrowser("NotAllowedError", "Permission denied"))).toBe(
      "the browser or the system did not allow this",
    )
    expect(chaveDoErroDoBrowser(doBrowser("NotAllowedError", "The request is not allowed by the user agent"))).toBe(
      "the browser or the system did not allow this",
    )
    expect(chaveDoErroDoBrowser(doBrowser("QuotaExceededError"))).toBe("vault storage is full")
  })

  it("a recusa do Electron, que só traz a mensagem", () => {
    expect(chaveDoErroDoBrowser(new Error("Permission denied by system"))).toBe("the browser or the system did not allow this")
  })

  it("o que não é erro do browser fica como estava", () => {
    const doNucleo = new Error("vault is locked")
    expect(chaveDoErroDoBrowser(doNucleo)).toBeNull()
    expect(comChaveDoBrowser(doNucleo)).toBe(doNucleo)
    expect(chaveDoErroDoBrowser("texto")).toBeNull()
    // `hasOwn`: a name that is a property of the prototype is not a key.
    expect(chaveDoErroDoBrowser(doBrowser("constructor"))).toBeNull()
  })

  it("o erro trocado leva o nome e a frase do motor no `cause`", () => {
    const trocado = comChaveDoBrowser(doBrowser("NotFoundError", "Requested device not found")) as Error
    expect(trocado.message).toBe("no microphone or camera was found")
    expect(trocado.cause).toEqual({ nome: "NotFoundError", mensagem: "Requested device not found" })
  })
})

describe("as recusas do SFU levam a chave na mensagem e a frase no `cause`", () => {
  it("um código conhecido tem chave própria; um desconhecido, a genérica", () => {
    const cheia = new RecusaDoSfu("chamada-cheia", "esta chamada já tem 12 pessoas")
    expect(cheia.message).toBe("the call is full")
    expect(cheia.codigo).toBe("chamada-cheia")
    expect(cheia.frase).toBe("esta chamada já tem 12 pessoas")
    expect(cheia.cause).toEqual({ codigo: "chamada-cheia", frase: "esta chamada já tem 12 pessoas" })
    expect(new RecusaDoSfu("codigo-novo", "x").message).toBe(RECUSA_DO_SFU_GENERICA)
  })
})

describe("erroDaChamada: uma falha da chamada dita como evento `error`", () => {
  it("uma recusa do SFU, mesmo refeita do outro lado do IPC (sem a classe)", () => {
    const recusa = new RecusaDoSfu("ecra-ocupado", "já há um ecrã")
    const refeita = Object.assign(new Error(recusa.message, { cause: recusa.cause }), { name: "RecusaDoSfu" })
    expect(erroDaChamada(recusa, "could not share the screen")).toEqual({
      detail: "someone already shares a screen in this call",
      cause: { codigo: "ecra-ocupado", frase: "já há um ecrã" },
    })
    expect(erroDaChamada(refeita, "could not share the screen")).toEqual(erroDaChamada(recusa, "could not share the screen"))
  })

  it("um erro do browser", () => {
    expect(erroDaChamada(doBrowser("NotReadableError", "Could not start"), "the call media failed")).toEqual({
      detail: "the microphone or the camera is busy",
      cause: { nome: "NotReadableError", mensagem: "Could not start" },
    })
  })

  it("o resto leva a chave do passo que falhou, com a mensagem em cru no `cause`", () => {
    expect(erroDaChamada(new Error("socket morto"), "call signalling failed")).toEqual({
      detail: "call signalling failed",
      cause: { detalhe: "socket morto" },
    })
    // Without a step, it goes raw: the interface shows it as 900, with the message below.
    expect(erroDaChamada(new Error("socket morto"))).toEqual({ detail: "socket morto" })
  })
})

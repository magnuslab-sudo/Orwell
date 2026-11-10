import { describe, expect, it } from "vitest"
import { transmissaoDoAnuncio } from "./transmissaoDaPresenca.js"

describe("o que se transmite, lido do anúncio de presença (fase 1i)", () => {
  const anuncio = (campos: Record<string, unknown>) => ({ t: "voice.join", at: 1, ...campos })

  it("ecrã, música, os dois, e nada", () => {
    expect(transmissaoDoAnuncio(anuncio({ screen: true }))).toBe("ecra")
    expect(transmissaoDoAnuncio(anuncio({ aTocar: "Fado" }))).toBe("musica")
    expect(transmissaoDoAnuncio(anuncio({ screen: true, aTocar: "Fado" }))).toBe("ecra+musica")
    expect(transmissaoDoAnuncio(anuncio({}))).toBeUndefined()
  })

  it("um cliente antigo, sem os campos, não transmite; e uma saída também não", () => {
    expect(transmissaoDoAnuncio(anuncio({ screen: false, aTocar: "" }))).toBeUndefined()
    expect(transmissaoDoAnuncio({ t: "voice.leave", screen: true })).toBeUndefined()
  })
})

import { describe, expect, it } from "vitest"
import { abrirBloco, chaveDoHistorico, novoParDoHistorico, selarBloco } from "./historico.js"

const aparelho = (n: number): Uint8Array => new Uint8Array(32).fill(n)

describe("a cifra do histórico entre aparelhos", () => {
  it("os dois lados chegam à mesma chave, e um terceiro não", () => {
    const pede = novoParDoHistorico()
    const responde = novoParDoHistorico()
    const terceiro = novoParDoHistorico()
    const contexto = {
      aparelhoQuePede: aparelho(1),
      aparelhoQueResponde: aparelho(2),
      efemeraQuePede: pede.publica,
      efemeraQueResponde: responde.publica,
    }
    const deQuemPede = chaveDoHistorico(pede.privada, responde.publica, "s1", contexto)
    const deQuemResponde = chaveDoHistorico(responde.privada, pede.publica, "s1", contexto)
    expect(deQuemPede).toEqual(deQuemResponde)
    expect(chaveDoHistorico(terceiro.privada, responde.publica, "s1", contexto)).not.toEqual(deQuemPede)
    // Another session, another key.
    expect(chaveDoHistorico(pede.privada, responde.publica, "s2", contexto)).not.toEqual(deQuemPede)
  })

  it("um bloco abre com a chave e o pedido certos, e com mais nenhum", () => {
    const chave = new Uint8Array(32).fill(7)
    const texto = new TextEncoder().encode("olá")
    const bloco = selarBloco(chave, "s1", "p1", texto)
    expect(abrirBloco(chave, "s1", "p1", bloco)).toEqual(texto)
    expect(abrirBloco(chave, "s1", "p2", bloco)).toBeNull()
    expect(abrirBloco(chave, "s2", "p1", bloco)).toBeNull()
    expect(abrirBloco(new Uint8Array(32).fill(8), "s1", "p1", bloco)).toBeNull()
    const alterado = bloco.slice()
    alterado[alterado.length - 1] ^= 1
    expect(abrirBloco(chave, "s1", "p1", alterado)).toBeNull()
    // The same text twice doesn't give the same bytes: the nonce is new.
    expect(selarBloco(chave, "s1", "p1", texto)).not.toEqual(bloco)
  })
})

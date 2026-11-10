import { describe, expect, it } from "vitest"
import { mensagemDoPedido, PedidoAssinado, ROTAS_DA_DENUNCIA } from "./denuncia.js"

describe("pedido assinado", () => {
  it("mensagemDoPedido é determinista e muda com cada campo", () => {
    const base = {
      endereco: "@a:orwell.pt",
      aparelho: "A".repeat(43),
      cadeia: { k: "B".repeat(43), x: "C".repeat(86) },
      emitido: 1,
      nonce: "n".repeat(22),
      rota: "/_enclave/denuncia",
      corpo: { x: 1 },
    }
    expect(mensagemDoPedido(base)).toEqual(mensagemDoPedido({ ...base }))
    expect(mensagemDoPedido({ ...base, rota: "/_enclave/denuncia/revisao" })).not.toEqual(mensagemDoPedido(base))
    expect(new TextDecoder().decode(mensagemDoPedido(base).slice(0, 26))).toBe("orwell-pedido-assinado-v1\0")
    for (const mudado of [
      { ...base, endereco: "@b:orwell.pt" },
      { ...base, aparelho: "D".repeat(43) },
      { ...base, emitido: 2 },
      { ...base, nonce: "m".repeat(22) },
      { ...base, corpo: { x: 2 } },
    ]) {
      expect(mensagemDoPedido(mudado)).not.toEqual(mensagemDoPedido(base))
    }
  })

  it("as rotas vivem todas debaixo de /_enclave/denuncia", () => {
    for (const rota of Object.values(ROTAS_DA_DENUNCIA)) expect(rota.startsWith("/_enclave/denuncia")).toBe(true)
  })

  it("o esquema recusa um nonce do tamanho errado e uma versão desconhecida", () => {
    const pedido = {
      v: 1,
      endereco: "@a:orwell.pt",
      aparelho: "A".repeat(43),
      cadeia: { k: "B".repeat(43), x: "C".repeat(86) },
      emitido: 1,
      nonce: "n".repeat(22),
      rota: "/_enclave/denuncia",
      corpo: {},
      as: "C".repeat(86),
    }
    expect(PedidoAssinado.safeParse(pedido).success).toBe(true)
    expect(PedidoAssinado.safeParse({ ...pedido, nonce: "n".repeat(21) }).success).toBe(false)
    expect(PedidoAssinado.safeParse({ ...pedido, v: 2 }).success).toBe(false)
  })
})

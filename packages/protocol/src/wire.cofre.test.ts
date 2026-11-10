import { describe, expect, it } from "vitest"
import {
  CAPACIDADE_COFRE_CIFRADO,
  ClientFrame,
  CODIGOS_DE_RECUSA_DO_COFRE,
  COFRE_CONTEUDO_MAX_CARACTERES,
  COFRE_ENTRADA_MAX_BYTES,
  COFRE_ENTRADAS_POR_TRAMA,
  parseClientFrame,
  RAZOES_DE_RECUSA_DA_ENTRADA,
  ServerFrame,
} from "./wire.js"

/**
 * The frames `cofre.*` on the wire (phase 3a of the encrypted state plan).
 *
 * What is asserted: the contract names, the request and response shape, the limits
 * of the schema (opaque key, scope, content, entries per frame), and that
 * frames from before still pass unchanged through the new union.
 */
const ESCOPO = "canal:!sala-opaca:localhost"
const CHAVE = "A".repeat(22)

describe("cofre.* no fio", () => {
  it("os nomes do contrato não mudam", () => {
    expect(CAPACIDADE_COFRE_CIFRADO).toBe("cofre-cifrado")
    expect(CODIGOS_DE_RECUSA_DO_COFRE).toEqual(["cofre-nao-anunciado", "cofre-sem-lugar", "cofre-ritmo"])
    expect(RAZOES_DE_RECUSA_DA_ENTRADA).toEqual(["versao", "tecto", "acolchoamento", "inexistente", "chave-de-escrita"])
    expect(COFRE_ENTRADA_MAX_BYTES).toBe(65536)
    expect(COFRE_CONTEUDO_MAX_CARACTERES).toBe(87382)
  })

  it("cofre.put, cofre.get e cofre.del do cliente", () => {
    const put = { t: "cofre.put", escopo: ESCOPO, entradas: [{ chave: CHAVE, conteudo: "AAEC", versaoEsperada: 0 }], ref: "r" }
    expect(ClientFrame.parse(put)).toStrictEqual(put)
    expect(ClientFrame.parse({ t: "cofre.get", escopo: "conta:@ana:localhost", desdeVersao: 0 })).toStrictEqual({
      t: "cofre.get",
      escopo: "conta:@ana:localhost",
      desdeVersao: 0,
    })
    expect(ClientFrame.safeParse({ t: "cofre.del", escopo: ESCOPO, chave: CHAVE, versaoEsperada: 3 }).success).toBe(true)
  })

  it("recusa no molde o que o servidor nunca deve ver", () => {
    const put = (mudar: Record<string, unknown>) =>
      ClientFrame.safeParse({ t: "cofre.put", escopo: ESCOPO, entradas: [{ chave: CHAVE, conteudo: "AAEC" }], ...mudar }).success
    // A logical key in the clear, or of the wrong size.
    expect(put({ entradas: [{ chave: "sala:geral", conteudo: "AAEC" }] })).toBe(false)
    expect(put({ entradas: [{ chave: "A".repeat(21), conteudo: "AAEC" }] })).toBe(false)
    // A scope that is not a channel: not account: either.
    expect(put({ escopo: "!sala:localhost" })).toBe(false)
    expect(put({ escopo: "canal:" })).toBe(false)
    expect(put({ escopo: "canal:com espaço" })).toBe(false)
    // Empty content, outside base64url, or above the protocol limit.
    expect(put({ entradas: [{ chave: CHAVE, conteudo: "" }] })).toBe(false)
    expect(put({ entradas: [{ chave: CHAVE, conteudo: "não é base64" }] })).toBe(false)
    expect(put({ entradas: [{ chave: CHAVE, conteudo: "A".repeat(COFRE_CONTEUDO_MAX_CARACTERES) }] })).toBe(true)
    expect(put({ entradas: [{ chave: CHAVE, conteudo: "A".repeat(COFRE_CONTEUDO_MAX_CARACTERES + 1) }] })).toBe(false)
    // No entries, or more than fit in one frame.
    expect(put({ entradas: [] })).toBe(false)
    const muitas = Array.from({ length: COFRE_ENTRADAS_POR_TRAMA + 1 }, () => ({ chave: CHAVE, conteudo: "AAEC" }))
    expect(put({ entradas: muitas })).toBe(false)
    expect(put({ entradas: muitas.slice(1) })).toBe(true)
    // Negative or fractional versions.
    expect(ClientFrame.safeParse({ t: "cofre.get", escopo: ESCOPO, desdeVersao: -1 }).success).toBe(false)
    expect(ClientFrame.safeParse({ t: "cofre.get", escopo: ESCOPO, desdeVersao: 1.5 }).success).toBe(false)
  })

  it("as respostas do servidor", () => {
    const entradas = {
      t: "cofre.entradas",
      escopo: ESCOPO,
      versaoGlobal: 3,
      completo: false,
      ate: 3,
      mais: false,
      entradas: [{ chave: CHAVE, versao: 2, conteudo: "AAEC" }],
      lapides: [{ chave: "B".repeat(22), versao: 3 }],
    }
    expect(ServerFrame.parse(entradas)).toStrictEqual(entradas)
    expect(
      ServerFrame.safeParse({
        t: "cofre.put.result",
        escopo: ESCOPO,
        aceites: [{ chave: CHAVE, versao: 1 }],
        recusadas: [{ chave: CHAVE, razao: "versao", versao: 1 }],
        versaoGlobal: 1,
      }).success,
    ).toBe(true)
    expect(ServerFrame.safeParse({ t: "cofre.del.result", escopo: ESCOPO, chave: CHAVE, razao: "inexistente", versao: 0, versaoGlobal: 1 }).success).toBe(true)
    expect(ServerFrame.safeParse({ t: "cofre.versoes", cofres: [{ escopo: ESCOPO, versaoGlobal: 7 }] }).success).toBe(true)
    expect(ServerFrame.safeParse({ t: "cofre.rejected", escopo: ESCOPO, code: "cofre-ritmo", message: "x", retryAfterMs: 10 }).success).toBe(true)
    expect(ServerFrame.safeParse({ t: "cofre.rejected", escopo: ESCOPO, code: "outro", message: "x" }).success).toBe(false)
  })

  it("as tramas de antes passam iguais pela união com o cofre", () => {
    expect(parseClientFrame({ t: "hello", version: 1 })).toStrictEqual({ t: "hello", version: 1 })
    expect(parseClientFrame({ t: "ping" })).toStrictEqual({ t: "ping" })
    expect(ServerFrame.parse({ t: "pong" })).toStrictEqual({ t: "pong" })
    expect(ClientFrame.safeParse({ t: "cofre.inventado", escopo: ESCOPO }).success).toBe(false)
  })
})

import { describe, expect, it } from "vitest"
import { errosEn } from "../linguas/en.js"
import { errosPt } from "../linguas/pt.js"
import { CHAVES_DO_EMPARELHAMENTO, CODIGO_DESCONHECIDO, CODIGOS_DE_ERRO, codigoDoErro } from "./codigosDeErro.js"

describe("os códigos de erro", () => {
  it("cada erro traduzido tem código, e cada código tem frase nas duas línguas", () => {
    for (const mensagem of Object.keys(errosPt)) {
      expect(CODIGOS_DE_ERRO[mensagem], `sem código: ${mensagem}`).toBeTypeOf("number")
    }
    for (const mensagem of Object.keys(CODIGOS_DE_ERRO)) {
      // A sentence is either text or a detail function; in both languages it must be
      // the same thing, so the same `cause` works for both.
      expect(["string", "function"], `sem frase em português: ${mensagem}`).toContain(typeof errosPt[mensagem])
      expect(typeof errosEn[mensagem], `forma diferente em inglês: ${mensagem}`).toBe(typeof errosPt[mensagem])
    }
  })

  it("nenhum código se repete, e nenhum é o 900", () => {
    const codigos = Object.values(CODIGOS_DE_ERRO)
    expect(new Set(codigos).size).toBe(codigos.length)
    expect(codigos).not.toContain(CODIGO_DESCONHECIDO)
    for (const codigo of codigos) expect(codigo).toBeGreaterThanOrEqual(100)
  })

  it("as chaves vêm em inglês minúsculo, sem dados variáveis dentro", () => {
    // The hyphen is part of the revocation keys (740-748), which the core fires in
    // kebab-case (`device-revoke-self`). They stay lowercase English and fixed.
    for (const mensagem of Object.keys(CODIGOS_DE_ERRO)) {
      expect(mensagem, mensagem).toMatch(/^[a-z][a-z ,'-]*$/)
    }
  })

  it("as centenas novas: canais 3xx, chamadas 4xx, amizades 6xx, aparelhos 7xx", () => {
    expect(codigoDoErro("not a member of this channel")).toBe(301)
    expect(codigoDoErro("this device has no seat in this channel")).toBe(345)
    expect(codigoDoErro("the call could not be set up on this server")).toBe(401)
    expect(codigoDoErro("a friend request is already pending")).toBe(601)
    expect(codigoDoErro("this account already has four devices")).toBe(717)
    expect(codigoDoErro("read mark channel is invalid")).toBe(720)
    expect(codigoDoErro("device-revoke-self")).toBe(743)
    expect(codigoDoErro("device-revoked")).toBe(748)
  })

  it("cada razão de emparelhamento aponta para uma chave da tabela", () => {
    for (const [razao, chave] of Object.entries(CHAVES_DO_EMPARELHAMENTO)) {
      expect(CODIGOS_DE_ERRO[chave], `${razao} → ${chave}`).toBeTypeOf("number")
    }
    // The three that `Session` also mentions share the code.
    expect(codigoDoErro(CHAVES_DO_EMPARELHAMENTO["sem-chave-de-conta"]!)).toBe(701)
    expect(codigoDoErro(CHAVES_DO_EMPARELHAMENTO["servidor-sem-emparelhamento"]!)).toBe(702)
    expect(codigoDoErro(CHAVES_DO_EMPARELHAMENTO["sem-ligacao"]!)).toBe(202)
  })

  it("o que a tabela não conhece é o 900", () => {
    expect(codigoDoErro("vault is locked")).toBe(101)
    expect(codigoDoErro("nunca visto")).toBe(CODIGO_DESCONHECIDO)
  })
})

import { describe, expect, it } from "vitest"
import { sha256 } from "@noble/hashes/sha2.js"
import { toBase64 } from "./canonical.js"
import { chaveDaProvaDoConvite, provarCodigoDoConvite, verificarProvaDoConvite } from "./prova-do-convite.js"

/**
 * The proof of an invite code (1.0 "Arca", slice 2). What matters: the key
 * comes from the code and only the code; the proof is valid for THIS request and
 * this account and no other; and what sits in the database (the hash and public
 * key) does not sign anything.
 */

const CODIGO = "c2VncmVkby1kby1jb252aXRlLWRlLXRlc3Rl"
const CODE_HASH = toBase64(sha256(new TextEncoder().encode(CODIGO)))
const PEDIDO = { codeHash: CODE_HASH, address: "@bruno:orwell.pt", keyPackage: toBase64(new Uint8Array([1, 2, 3])) }

describe("a prova do código do convite", () => {
  it("a chave é a mesma para o mesmo código, outra para outro, e não é o hash", () => {
    const a = chaveDaProvaDoConvite(CODIGO)
    expect(toBase64(chaveDaProvaDoConvite(CODIGO).publica)).toBe(toBase64(a.publica))
    expect(toBase64(chaveDaProvaDoConvite(`${CODIGO}x`).publica)).not.toBe(toBase64(a.publica))
    expect(toBase64(a.publica)).not.toBe(CODE_HASH)
  })

  it("quem tem o código prova; a prova confere com a chave pública", () => {
    const codeKey = toBase64(chaveDaProvaDoConvite(CODIGO).publica)
    const prova = provarCodigoDoConvite(CODIGO, PEDIDO)
    expect(verificarProvaDoConvite(codeKey, prova, PEDIDO)).toBe(true)
  })

  it("a prova não serve a outra conta, a outro key package, nem a outro convite", () => {
    const codeKey = toBase64(chaveDaProvaDoConvite(CODIGO).publica)
    const prova = provarCodigoDoConvite(CODIGO, PEDIDO)
    expect(verificarProvaDoConvite(codeKey, prova, { ...PEDIDO, address: "@carla:orwell.pt" })).toBe(false)
    expect(verificarProvaDoConvite(codeKey, prova, { ...PEDIDO, keyPackage: toBase64(new Uint8Array([9])) })).toBe(false)
    expect(verificarProvaDoConvite(codeKey, prova, { ...PEDIDO, codeHash: toBase64(new Uint8Array(32)) })).toBe(false)
  })

  it("o que está na base não chega: sem o código, nenhuma assinatura confere", () => {
    const codeKey = toBase64(chaveDaProvaDoConvite(CODIGO).publica)
    // A caller with only the hash and public key tries what they can: the hash as
    // code, the key as proof, garbage.
    expect(verificarProvaDoConvite(codeKey, provarCodigoDoConvite(CODE_HASH, PEDIDO), PEDIDO)).toBe(false)
    expect(verificarProvaDoConvite(codeKey, codeKey, PEDIDO)).toBe(false)
    expect(verificarProvaDoConvite(codeKey, "lixo", PEDIDO)).toBe(false)
  })
})

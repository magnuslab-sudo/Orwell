import { ed25519 } from "@noble/curves/ed25519.js"
import { describe, expect, it } from "vitest"
import { abrirComConta, selarParaConta } from "./selo.js"

const conta = (): { privada: Uint8Array; publica: Uint8Array } => {
  const privada = ed25519.utils.randomSecretKey()
  return { privada, publica: ed25519.getPublicKey(privada) }
}

const texto = new TextEncoder().encode("a cópia da denúncia, só para o fundador")
const CANAL = "abcdefghijklmnopqrstuvwxyz234567abcdefgh:localhost"

describe("o selo da cópia do fundador", () => {
  it("sela para uma chave de conta Ed25519 e só a privada dessa conta abre", () => {
    const fundador = conta()
    const selado = selarParaConta(fundador.publica, CANAL, texto)
    expect(selado.e.length).toBe(32)
    expect(selado.n.length).toBe(24)
    // The text does not appear in the seal.
    expect(Buffer.from(selado.c).includes(Buffer.from(texto))).toBe(false)
    expect(abrirComConta(fundador.privada, CANAL, selado)).toEqual(texto)
  })

  it("outra conta, AAD trocado ou um byte alterado dão null", () => {
    const fundador = conta()
    const outra = conta()
    const selado = selarParaConta(fundador.publica, CANAL, texto)
    expect(abrirComConta(outra.privada, CANAL, selado)).toBeNull()
    expect(abrirComConta(fundador.privada, `${CANAL}x`, selado)).toBeNull()

    const c = selado.c.slice()
    c[3] = c[3]! ^ 1
    expect(abrirComConta(fundador.privada, CANAL, { ...selado, c })).toBeNull()
    const n = selado.n.slice()
    n[0] = n[0]! ^ 1
    expect(abrirComConta(fundador.privada, CANAL, { ...selado, n })).toBeNull()
    const e = selado.e.slice()
    e[5] = e[5]! ^ 1
    expect(abrirComConta(fundador.privada, CANAL, { ...selado, e })).toBeNull()
    // Malformed shapes also give null, without throwing.
    expect(abrirComConta(fundador.privada, CANAL, { e: new Uint8Array(3), n: selado.n, c: selado.c })).toBeNull()
    expect(abrirComConta(fundador.privada, CANAL, { e: selado.e, n: new Uint8Array(12), c: selado.c })).toBeNull()
  })

  it("cada selo tem efémera e nonce diferentes", () => {
    const fundador = conta()
    const um = selarParaConta(fundador.publica, CANAL, texto)
    const outro = selarParaConta(fundador.publica, CANAL, texto)
    expect(um.e).not.toEqual(outro.e)
    expect(um.n).not.toEqual(outro.n)
    expect(um.c).not.toEqual(outro.c)
  })
})

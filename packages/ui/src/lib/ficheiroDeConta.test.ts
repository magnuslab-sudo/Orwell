import { describe, expect, it } from "vitest"
import { CABECALHO_DO_COFRE } from "@enclave/client-core"
import { eFicheiroDoBeta, pareceFicheiroDeConta } from "./ficheiroDeConta.js"

/** The envelope in the shape `exportVault` writes, without the header. The contents are noise. */
const ENVELOPE = JSON.stringify({
  format: "enclave-vault",
  formatVersion: 1,
  exportedAt: 0,
  vault: { version: 1, protection: "passphrase", salt: "c2Fs", nonce: "bm9uY2U=", ciphertext: "Y2lmcmFkbw==" },
})
/** The 1.0 account file: the plaintext header and the envelope. */
const BOM = CABECALHO_DO_COFRE + ENVELOPE
/** The same envelope with the header, for tests that tweak its fields. */
const comCabecalho = (json: string): string => CABECALHO_DO_COFRE + json
const envelope = (): Record<string, unknown> => JSON.parse(ENVELOPE) as Record<string, unknown>

describe("pareceFicheiroDeConta", () => {
  it("aceita o envelope que o exportar escreve", () => {
    expect(pareceFicheiroDeConta(BOM)).toBe(true)
  })

  it("recusa o que nem é JSON: uma fotografia escolhida por engano", () => {
    expect(pareceFicheiroDeConta("\u0089PNG\r\n")).toBe(false)
    expect(pareceFicheiroDeConta("")).toBe(false)
  })

  it("recusa JSON de outra coisa, e o envelope de outra versão", () => {
    expect(pareceFicheiroDeConta('{"v":1}')).toBe(false)
    expect(pareceFicheiroDeConta("[]")).toBe(false)
    expect(pareceFicheiroDeConta("null")).toBe(false)
    const outraVersao = envelope()
    outraVersao["formatVersion"] = 2
    expect(pareceFicheiroDeConta(comCabecalho(JSON.stringify(outraVersao)))).toBe(false)
  })

  it("recusa um cofre protegido pelo sistema, que não se abre noutro aparelho", () => {
    // `exportVault` always reseals with password. An `os` here is a file manually
    // copied from the app folder, and the core refuses it too.
    const doSistema = envelope() as { vault: Record<string, unknown> }
    doSistema.vault["protection"] = "os"
    expect(pareceFicheiroDeConta(comCabecalho(JSON.stringify(doSistema)))).toBe(false)
  })

  it("recusa um cofre a que falta o sal, o nonce ou o cifrado", () => {
    for (const campo of ["salt", "nonce", "ciphertext"]) {
      const cortado = envelope() as { vault: Record<string, unknown> }
      cortado.vault[campo] = ""
      expect(pareceFicheiroDeConta(comCabecalho(JSON.stringify(cortado)))).toBe(false)
    }
  })

  it("um ficheiro da 0.9.x, sem o cabeçalho, é do beta e não passa como ficheiro de conta", () => {
    expect(pareceFicheiroDeConta(ENVELOPE)).toBe(false)
    expect(eFicheiroDoBeta(ENVELOPE)).toBe(true)
    expect(eFicheiroDoBeta(BOM)).toBe(false)
    // A photo is not from the beta: it's something else, and we say so.
    expect(eFicheiroDoBeta("\u0089PNG\r\n")).toBe(false)
  })
})

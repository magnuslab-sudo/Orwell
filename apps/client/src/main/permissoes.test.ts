import { describe, expect, it } from "vitest"
import { permissaoConcedida } from "./permissoes.js"

describe("as permissões da app de secretária", () => {
  it('escrever na área de transferência vale sempre, dentro e fora de chamada (os botões "Copiar")', () => {
    expect(permissaoConcedida("clipboard-sanitized-write", false)).toBe(true)
    expect(permissaoConcedida("clipboard-sanitized-write", true)).toBe(true)
  })

  it("o ecrã inteiro vale sempre: é o palco da partilha de ecrã, depois de um gesto", () => {
    expect(permissaoConcedida("fullscreen", false)).toBe(true)
    expect(permissaoConcedida("fullscreen", true)).toBe(true)
  })

  it("ler a área de transferência nunca", () => {
    expect(permissaoConcedida("clipboard-read", false)).toBe(false)
    expect(permissaoConcedida("clipboard-read", true)).toBe(false)
  })

  it("microfone, câmara e ecrã só em chamada", () => {
    for (const p of ["media", "audioCapture", "videoCapture", "display-capture"]) {
      expect(permissaoConcedida(p, false)).toBe(false)
      expect(permissaoConcedida(p, true)).toBe(true)
    }
  })

  it("o resto nunca", () => {
    for (const p of ["geolocation", "notifications", "midi", "openExternal"]) {
      expect(permissaoConcedida(p, true)).toBe(false)
    }
  })
})

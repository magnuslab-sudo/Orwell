import { describe, expect, it } from "vitest"
import { apelidoDaMensagem, apelidosDoCanal, esquecerApelidos, registarApelido } from "./apelidos.js"
import { newVaultContents } from "./vault.js"

const CANAL = "!lagar:s"

describe("o registo dos apelidos (fase 3)", () => {
  it("vence o carimbo mais recente, e o vazio tira o apelido", () => {
    const cofre = newVaultContents()
    registarApelido(cofre, CANAL, "@ana:s", { valor: "Aninhas", at: 2, seq: 2, por: "@ana:s" })
    // An older alias, arriving later in history, does not win.
    registarApelido(cofre, CANAL, "@ana:s", { valor: "Velho", at: 1, seq: 1, por: "@ana:s" })
    expect(apelidosDoCanal(cofre, CANAL)).toEqual({ "@ana:s": "Aninhas" })
    registarApelido(cofre, CANAL, "@ana:s", { valor: "", at: 3, seq: 3, por: "@mod:s" })
    expect(apelidosDoCanal(cofre, CANAL)).toEqual({})
  })

  it("é por canal, e esquece-se com o canal", () => {
    const cofre = newVaultContents()
    registarApelido(cofre, CANAL, "@ana:s", { valor: "Aninhas", at: 2, seq: 2, por: "@ana:s" })
    expect(apelidosDoCanal(cofre, "!outro:s")).toEqual({})
    esquecerApelidos(cofre, CANAL)
    expect(apelidosDoCanal(cofre, CANAL)).toEqual({})
  })

  it("lê o campo de uma mensagem em cru, e recusa o resto", () => {
    expect(apelidoDaMensagem({ t: "message", apelido: { subject: "@ana:s", nick: " Ana ", at: 4 } })).toEqual({
      subject: "@ana:s",
      nick: "Ana",
      at: 4,
    })
    expect(apelidoDaMensagem({ t: "message", body: "olá" })).toBeNull()
    expect(apelidoDaMensagem({ t: "edit", apelido: { subject: "@ana:s", nick: "x", at: 1 } })).toBeNull()
    expect(apelidoDaMensagem({ t: "message", apelido: { nick: "x" } })).toBeNull()
  })
})

describe("os apelidos à espera da gravação", () => {
  it("contam na leitura, com a mesma regra do carimbo", () => {
    const cofre = newVaultContents()
    registarApelido(cofre, CANAL, "@ana:s", { valor: "Aninhas", at: 2, seq: 2, por: "@ana:s" })
    const pendentes = [
      { subject: "@ana:s", valor: "Ana R.", at: 5, seq: -1, por: "@mod:s" },
      { subject: "@rui:s", valor: "Rui", at: 1, seq: -1, por: "@rui:s" },
    ]
    expect(apelidosDoCanal(cofre, CANAL, pendentes)).toEqual({ "@ana:s": "Ana R.", "@rui:s": "Rui" })
  })
})

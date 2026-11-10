import { describe, expect, it } from "vitest"
import { pedidoCabe } from "./privacidade.js"

describe("pedidoCabe: quem me pode enviar pedidos de amizade", () => {
  const conhecidos = new Set(["@ana:casa.pt"])

  it('"Toda a gente" deixa passar todos, e "Ninguém" nenhum', () => {
    expect(pedidoCabe("todos", "@rui:longe.pt", null)).toBe(true)
    expect(pedidoCabe("ninguem", "@ana:casa.pt", conhecidos)).toBe(false)
  })

  it('"Amigos de amigos" só deixa passar quem a interface conhece', () => {
    expect(pedidoCabe("amigos-de-amigos", "@ana:casa.pt", conhecidos)).toBe(true)
    expect(pedidoCabe("amigos-de-amigos", "@rui:longe.pt", conhecidos)).toBe(false)
  })

  it("enquanto os conhecidos não se leram, ninguém cabe", () => {
    expect(pedidoCabe("amigos-de-amigos", "@ana:casa.pt", null)).toBe(false)
  })
})

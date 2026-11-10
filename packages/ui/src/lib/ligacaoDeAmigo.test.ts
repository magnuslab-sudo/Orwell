import { describe, expect, it } from "vitest"
import { friendLink } from "@enclave/client-core"
import { eCaminhoDeAmigo, lerLigacaoDeAmigo, ligacaoCurtaDeAmigo } from "./ligacaoDeAmigo.js"

/** A long id, so the size difference shows in the test. */
const ID = "k7q3m2xw9fz4h8rt6vbn5cdj0pgs1ylae3uow2qi"
const EU = `@${ID}:orwell.pt`

describe("a ligação curta de amigo", () => {
  it("do meu servidor: https://orwell.pt/a#<id>, sem @ nem :servidor", () => {
    expect(ligacaoCurtaDeAmigo("orwell.pt", EU)).toBe(`https://orwell.pt/a#${ID}`)
  })

  it("de uma conta de outro servidor leva <id>@<servidor>", () => {
    expect(ligacaoCurtaDeAmigo("orwell.pt", "@rui:outro.pt")).toBe("https://orwell.pt/a#rui@outro.pt")
  })

  it("no loopback é http, como a longa", () => {
    expect(ligacaoCurtaDeAmigo("localhost:5173", "@ana:localhost:5173")).toBe("http://localhost:5173/a#ana")
  })

  it("volta a dar o mesmo endereço, pelas duas formas do caminho", () => {
    const curta = ligacaoCurtaDeAmigo("orwell.pt", EU)
    expect(lerLigacaoDeAmigo(curta)).toEqual({ server: "orwell.pt", address: EU })
    expect(lerLigacaoDeAmigo(`https://orwell.pt/app/a#${ID}`)).toEqual({ server: "orwell.pt", address: EU })
    expect(lerLigacaoDeAmigo("https://orwell.pt/a#rui@outro.pt")).toEqual({ server: "orwell.pt", address: "@rui:outro.pt" })
    expect(lerLigacaoDeAmigo("  http://localhost:5173/a#ana \n")).toEqual({
      server: "localhost:5173",
      address: "@ana:localhost:5173",
    })
  })

  it("a forma antiga continua a ler-se", () => {
    expect(lerLigacaoDeAmigo(friendLink("orwell.pt", EU))).toEqual({ server: "orwell.pt", address: EU })
  })

  it("recusa o que a longa também recusa", () => {
    for (const mau of [
      "http://orwell.pt/a#ana", // http outside loopback
      "https://orwell.pt/a?x=1#ana", // query
      "https://orwell.pt/a#", // no id
      "https://orwell.pt/a#ana:orwell.pt", // a forma longa no caminho curto
      "https://orwell.pt/a#@ana", // the secret does not go in the short fragment
      "https://orwell.pt/a#a b", // space
      "https://orwell.pt/a#%E0%A4%A", // escape partido
      "https://orwell.pt/A#ana", // o caminho conta letra a letra
      "https://orwell.pt/app/ab#ana", // different path
      "https://ana@orwell.pt/a#ana", // userinfo
      "ftp://orwell.pt/a#ana",
      `https://orwell.pt/a#${"x".repeat(3000)}`, // acima do tecto
    ]) {
      expect(lerLigacaoDeAmigo(mau), mau).toBeNull()
    }
  })

  it("os caminhos que a app abre: /app/amigo e /app/a, e mais nenhum", () => {
    expect(eCaminhoDeAmigo("/app/amigo")).toBe(true)
    expect(eCaminhoDeAmigo("/app/a")).toBe(true)
    expect(eCaminhoDeAmigo("/a")).toBe(false)
    expect(eCaminhoDeAmigo("/app/")).toBe(false)
  })
})

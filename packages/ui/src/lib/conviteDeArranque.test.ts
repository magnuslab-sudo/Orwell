import { describe, expect, it } from "vitest"
import { moradaDeSala, parseServerName } from "@enclave/protocol"
import { canalAEsperaParaMostrar, nomeDoSelo } from "./conviteDeArranque.js"

/**
 * The name of a pending channel (bugs A and B from the 1.0 live test): an opaque
 * address never goes to the screen, and addresses with names stay as they were.
 */
describe("canalAEsperaParaMostrar", () => {
  const OPACA = moradaDeSala(parseServerName("casa.pt"))

  it("uma morada opaca: o nome do selo, depois o publicado, e sem nenhum, nada", () => {
    expect(canalAEsperaParaMostrar(OPACA, "Clube", "Outro")).toBe("Clube")
    expect(canalAEsperaParaMostrar(OPACA, null, "Publicado")).toBe("Publicado")
    expect(canalAEsperaParaMostrar(OPACA, null, undefined)).toBeNull()
    expect(canalAEsperaParaMostrar(OPACA, null, "")).toBeNull()
  })

  it("o nome publicado também é limpo: sem marcas de direcção", () => {
    expect(canalAEsperaParaMostrar(OPACA, null, "\u202Elareg")).toBe("lareg")
  })

  it("uma morada com nome (de antes da 1.0) diz o nome dela, como antes", () => {
    expect(canalAEsperaParaMostrar("!sala-nova:casa.pt", null, undefined)).toBe("sala-nova")
    expect(canalAEsperaParaMostrar("!sala-nova:casa.pt", "Clube", "Publicado")).toBe("sala-nova")
  })

  it("o nome do selo sai limpo, e um selo vazio não é nome", () => {
    expect(nomeDoSelo({ canal: "\u202EClube" })).toBe("Clube")
    expect(nomeDoSelo({ canal: "" })).toBeNull()
    expect(nomeDoSelo(null)).toBeNull()
  })
})

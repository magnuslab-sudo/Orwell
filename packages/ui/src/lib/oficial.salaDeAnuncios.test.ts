import { describe, expect, it } from "vitest"
import { ehSalaDeAnuncios } from "./oficial.js"

/** The release notes room is known by its new name and its old one (2 November 2026). */
describe("ehSalaDeAnuncios", () => {
  it('aceita "Release notes", com espaço ou hífen, em qualquer caixa', () => {
    for (const nome of ["Release notes", "release notes", "RELEASE  NOTES", "release-notes", " Release notes "]) {
      expect(ehSalaDeAnuncios(nome), nome).toBe(true)
    }
  })

  it('continua a aceitar "anúncios", com ou sem acento', () => {
    expect(ehSalaDeAnuncios("anúncios")).toBe(true)
    expect(ehSalaDeAnuncios("Anuncios")).toBe(true)
  })

  it("recusa outros nomes", () => {
    for (const nome of ["notes", "release", "releasenotes", "geral", "anuncio"]) {
      expect(ehSalaDeAnuncios(nome), nome).toBe(false)
    }
  })
})

import { describe, expect, it } from "vitest"
import { COTOVELADA_INTERVALO_MS, segundosQueFaltam } from "./limiteDaCotovelada.js"

describe("segundosQueFaltam", () => {
  it("uma conversa sem cotovelada está livre", () => {
    expect(segundosQueFaltam(undefined, 1_000)).toBe(0)
  })

  it("logo a seguir a uma, falta o minuto inteiro", () => {
    expect(COTOVELADA_INTERVALO_MS).toBe(60_000)
    expect(segundosQueFaltam(1_000, 1_000)).toBe(60)
  })

  it("arredonda para cima, e chega a zero no fim do minuto", () => {
    expect(segundosQueFaltam(0, 59_001)).toBe(1)
    expect(segundosQueFaltam(0, 60_000)).toBe(0)
    expect(segundosQueFaltam(0, 120_000)).toBe(0)
  })
})

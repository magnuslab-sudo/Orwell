import { describe, expect, it } from "vitest"
import { ACENDE, APAGA, SEGURA_MS, criarDetectorDeFala, mesmoConjunto } from "./quemFala.js"

describe("quem está a falar, para a overlay de jogo", () => {
  it("acende acima do limiar, e não com o ruído da sala", () => {
    const detector = criarDetectorDeFala()
    expect(detector.observar(APAGA / 2, 0)).toBe(false)
    expect(detector.observar(ACENDE + 0.01, 100)).toBe(true)
  })

  it("aguenta as pausas entre palavras: só apaga depois de um tempo calado", () => {
    const detector = criarDetectorDeFala()
    detector.observar(0.5, 0)
    expect(detector.observar(0, 100)).toBe(true)
    expect(detector.observar(0, 100 + SEGURA_MS - 1)).toBe(true)
    expect(detector.observar(0, 100 + SEGURA_MS + 1)).toBe(false)
  })

  it("entre os dois limiares fica como estava: não pisca à beira do limiar", () => {
    const detector = criarDetectorDeFala()
    const meio = (ACENDE + APAGA) / 2
    expect(detector.observar(meio, 0)).toBe(false)
    detector.observar(0.5, 10)
    expect(detector.observar(meio, 10 + SEGURA_MS * 3)).toBe(true)
  })

  it("um nível de lixo lê-se como silêncio", () => {
    const detector = criarDetectorDeFala()
    expect(detector.observar(Number.NaN, 0)).toBe(false)
  })

  it("compara dois conjuntos de quem fala", () => {
    expect(mesmoConjunto(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true)
    expect(mesmoConjunto(new Set(["a"]), new Set(["a", "b"]))).toBe(false)
  })
})

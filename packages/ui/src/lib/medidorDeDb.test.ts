import { describe, expect, it } from "vitest"
import {
  ChaoDeRuido,
  DB_ACENDE,
  DB_MAXIMO,
  dbDeRms,
  emPassos,
  INICIO_MAXIMO_DB,
  inicioDaEscala,
  JANELA_DO_CHAO_MS,
  nivelDaVoz,
} from "./medidorDeDb.js"

describe("dbDeRms — valor eficaz para dBFS", () => {
  it("a escala cheia é 0 dB e cada décimo são −20 dB", () => {
    expect(dbDeRms(1)).toBe(0)
    expect(dbDeRms(0.1)).toBeCloseTo(-20, 10)
    expect(dbDeRms(0.001)).toBeCloseTo(-60, 10)
  })

  it("o silêncio digital é −∞, e não um número inventado", () => {
    expect(dbDeRms(0)).toBe(Number.NEGATIVE_INFINITY)
  })
})

/**
 * Owner calibration (October 26, 2026): the halo lights at −50 dBFS,
 * peaks at −12, and normal speech sits in the middle. The four points from
 * the report table.
 */
describe("nivelDaVoz — a escala do halo, numa sala em silêncio", () => {
  it.each([
    ["silêncio", Number.NEGATIVE_INFINITY, 0],
    ["ruído de fundo, −56 dBFS", -56, 0],
    ["sussurro, −45 dBFS", -45, 0.132],
    ["fala, −30 dBFS", -30, 0.526],
    ["fala alta, −15 dBFS", -15, 0.921],
    ["grito, −6 dBFS", -6, 1],
  ])("%s dá %s", (_nome, db, esperado) => {
    expect(nivelDaVoz(db)).toBeCloseTo(esperado, 3)
  })

  it("acende a −50 e chega ao máximo a −12", () => {
    expect(nivelDaVoz(DB_ACENDE)).toBe(0)
    expect(nivelDaVoz(DB_ACENDE + 0.5)).toBeGreaterThan(0)
    expect(nivelDaVoz(DB_MAXIMO)).toBe(1)
  })

  it("a fala normal fica a meio, e não quase apagada", () => {
    expect(nivelDaVoz(-30)).toBeGreaterThan(0.45)
    expect(nivelDaVoz(-30)).toBeLessThan(0.6)
  })

  it("sobe sempre com o nível: mais voz nunca dá menos halo", () => {
    let antes = -1
    for (let db = -70; db <= 5; db += 0.5) {
      const nivel = nivelDaVoz(db)
      expect(nivel).toBeGreaterThanOrEqual(antes)
      antes = nivel
    }
  })

  it("não é número, não acende", () => {
    expect(nivelDaVoz(Number.NaN)).toBe(0)
  })
})

describe("inicioDaEscala — o ruído da sala sobe o começo", () => {
  it("sem medida, a escala começa em −50", () => {
    expect(inicioDaEscala(null)).toBe(DB_ACENDE)
  })

  it("com ruído a −48, começa 6 dB acima: o ambiente não acende", () => {
    expect(inicioDaEscala(-48)).toBe(-42)
    expect(nivelDaVoz(-46, inicioDaEscala(-48))).toBe(0)
    // Whisper over noise still lights the halo.
    expect(nivelDaVoz(-38, inicioDaEscala(-48))).toBeGreaterThan(0)
  })

  it("numa sala muito ruidosa o começo pára em −36: a fala normal acende sempre", () => {
    expect(inicioDaEscala(-20)).toBe(INICIO_MAXIMO_DB)
    expect(nivelDaVoz(-30, inicioDaEscala(-20))).toBeGreaterThan(0.2)
  })

  it("numa sala mais silenciosa do que −56 o começo fica em −50", () => {
    expect(inicioDaEscala(-70)).toBe(DB_ACENDE)
  })
})

describe("ChaoDeRuido — o ruído medido nos primeiros 2 s", () => {
  it("durante a janela não há medida, e a escala fica em −50", () => {
    const chao = new ChaoDeRuido(0)
    chao.observar(-48, 100)
    expect(chao.valor(1000)).toBeNull()
  })

  it("depois da janela é o mínimo do que se ouviu nela (as pausas entre palavras)", () => {
    const chao = new ChaoDeRuido(0)
    chao.observar(-30, 100)
    chao.observar(-48, 600)
    chao.observar(-25, 1500)
    expect(chao.valor(JANELA_DO_CHAO_MS + 1)).toBe(-48)
  })

  it("o que se ouve depois da janela já não mexe no chão", () => {
    const chao = new ChaoDeRuido(0)
    chao.observar(-48, 100)
    chao.observar(-70, JANELA_DO_CHAO_MS + 500)
    expect(chao.valor(JANELA_DO_CHAO_MS + 600)).toBe(-48)
  })

  it("silêncio digital (−∞) não é sala: sem medida", () => {
    const chao = new ChaoDeRuido(0)
    chao.observar(Number.NEGATIVE_INFINITY, 100)
    expect(chao.valor(JANELA_DO_CHAO_MS + 1)).toBeNull()
  })
})

describe("emPassos — o halo com movimento reduzido", () => {
  it("anda aos saltos de 10%", () => {
    expect(emPassos(0.04)).toBe(0)
    expect(emPassos(0.526)).toBeCloseTo(0.5, 10)
    expect(emPassos(1)).toBeCloseTo(1, 10)
  })
})

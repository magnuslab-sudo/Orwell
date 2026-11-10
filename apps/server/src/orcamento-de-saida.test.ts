import { describe, expect, it } from "vitest"
import { TECTO_DA_CAMARA, TECTO_DO_ECRA } from "@enclave/protocol"
import { CUSTO_DA_VOZ_NO_FIO, OrcamentoDeSaida, linhaDaSaida, type LeituraDaSaida } from "./orcamento-de-saida.js"

/**
 * The outbound budget counter, without mediasoup. See `orcamento-de-saida.ts`.
 * Integration with the engine is in `media.orcamento-de-saida.test.ts`.
 */
describe("OrcamentoDeSaida", () => {
  it("admite vídeo até ao tecto, e o que não cabe não reserva nada", () => {
    const orcamento = new OrcamentoDeSaida(10 * TECTO_DO_ECRA, 1_000_000)
    for (let i = 0; i < 10; i++) expect(orcamento.reservar(`e${i}`, "video", TECTO_DO_ECRA)).toBe(true)
    expect(orcamento.ler().video).toEqual({ uso: 25_000_000, tecto: 25_000_000, fluxos: 10 })

    expect(orcamento.cabeVideo(TECTO_DA_CAMARA)).toBe(false)
    expect(orcamento.reservar("a-mais", "video", TECTO_DA_CAMARA)).toBe(false)
    expect(orcamento.reservado("a-mais")).toBe(false)
    expect(orcamento.ler().video.uso).toBe(25_000_000)
  })

  it("recusa só o pedido novo: quem já tem reserva mantém-na", () => {
    const orcamento = new OrcamentoDeSaida(2 * TECTO_DA_CAMARA, 1_000_000)
    orcamento.reservar("a", "video", TECTO_DA_CAMARA)
    orcamento.reservar("b", "video", TECTO_DA_CAMARA)
    expect(orcamento.reservar("c", "video", TECTO_DA_CAMARA)).toBe(false)
    // The same key again does not count twice, and is not rejected.
    expect(orcamento.reservar("a", "video", TECTO_DA_CAMARA)).toBe(true)
    expect(orcamento.ler().video.fluxos).toBe(2)
  })

  it("liberta, e volta a zero sem fugas", () => {
    const orcamento = new OrcamentoDeSaida(100_000_000, 1_000_000)
    for (let i = 0; i < 20; i++) orcamento.reservar(`v${i}`, i % 2 ? "video" : "voz", i % 2 ? TECTO_DO_ECRA : CUSTO_DA_VOZ_NO_FIO)
    for (let i = 0; i < 20; i++) orcamento.libertar(`v${i}`)
    // Releasing twice, or releasing what was never reserved, deducts nothing.
    orcamento.libertar("v0")
    orcamento.libertar("nunca")
    expect(orcamento.ler()).toEqual({
      video: { uso: 0, tecto: 100_000_000, fluxos: 0 },
      voz: { uso: 0, tecto: 1_000_000, fluxos: 0 },
    })
  })

  it("o espaço libertado volta a servir", () => {
    const orcamento = new OrcamentoDeSaida(TECTO_DO_ECRA, 1_000_000)
    orcamento.reservar("a", "video", TECTO_DO_ECRA)
    expect(orcamento.reservar("b", "video", TECTO_DO_ECRA)).toBe(false)
    orcamento.libertar("a")
    expect(orcamento.reservar("b", "video", TECTO_DO_ECRA)).toBe(true)
  })

  it("a voz conta à parte, nunca é recusada, e diz uma vez quando passa da reserva", () => {
    const passagens: LeituraDaSaida[] = []
    // Video at zero: not a single video fits, and voice does not depend on it.
    const orcamento = new OrcamentoDeSaida(0, 3 * CUSTO_DA_VOZ_NO_FIO, (leitura) => passagens.push(leitura))
    expect(orcamento.reservar("video", "video", TECTO_DA_CAMARA)).toBe(false)

    for (let i = 0; i < 5; i++) expect(orcamento.reservar(`voz${i}`, "voz", CUSTO_DA_VOZ_NO_FIO)).toBe(true)
    expect(orcamento.ler().voz).toEqual({ uso: 5 * CUSTO_DA_VOZ_NO_FIO, tecto: 3 * CUSTO_DA_VOZ_NO_FIO, fluxos: 5 })
    expect(orcamento.ler().video.uso).toBe(0)
    expect(passagens).toHaveLength(1)
    expect(passagens[0]!.voz.fluxos).toBe(4)

    // Falls below the reserve and comes back up: reports again.
    orcamento.libertar("voz0")
    orcamento.libertar("voz1")
    orcamento.libertar("voz2")
    orcamento.reservar("voz5", "voz", CUSTO_DA_VOZ_NO_FIO)
    expect(passagens).toHaveLength(1)
    orcamento.reservar("voz6", "voz", CUSTO_DA_VOZ_NO_FIO)
    expect(passagens).toHaveLength(2)
  })

  it("a voz não come o vídeo", () => {
    const orcamento = new OrcamentoDeSaida(TECTO_DO_ECRA, CUSTO_DA_VOZ_NO_FIO)
    for (let i = 0; i < 100; i++) orcamento.reservar(`voz${i}`, "voz", CUSTO_DA_VOZ_NO_FIO)
    expect(orcamento.reservar("ecra", "video", TECTO_DO_ECRA)).toBe(true)
  })

  it("limpar esquece tudo", () => {
    const orcamento = new OrcamentoDeSaida(TECTO_DO_ECRA, 1_000_000)
    orcamento.reservar("a", "video", TECTO_DO_ECRA)
    orcamento.reservar("b", "voz", CUSTO_DA_VOZ_NO_FIO)
    orcamento.limpar()
    expect(orcamento.ler().video.uso + orcamento.ler().voz.uso).toBe(0)
    expect(orcamento.reservar("c", "video", TECTO_DO_ECRA)).toBe(true)
  })

  it("a linha de registo só tem números", () => {
    const orcamento = new OrcamentoDeSaida(300_000_000, 40_000_000)
    orcamento.reservar("a", "video", TECTO_DO_ECRA)
    expect(linhaDaSaida(orcamento.ler())).toBe("vídeo 2.5/300.0 Mbit/s (1 consumos), voz 0.0/40.0 Mbit/s (0 consumos)")
  })
})

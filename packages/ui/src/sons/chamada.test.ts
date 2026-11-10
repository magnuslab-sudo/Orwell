import { beforeEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ROSTER_SETTLE_MS } from "../lib/sounds.js"
import { lembrarFichasDosCanais } from "../lib/tipoDoCanal.js"
import { moradaDeTeste } from "../../testes/moradas.js"
import {
  comecaAChamar,
  criarVigiaDaQueda,
  criarVigiaDasTransmissoes,
  ERRO_DA_CHAMADA_QUE_CAIU,
  haOutraPessoa,
  paraDeChamar,
  type EstadoDaTransmissao,
  type ParDaTransmissao,
} from "./chamada.js"

/**
 * The moments of a call matching Discord parity (November 3, 2026),
 * rule by rule. Each rule with both sides: the case that mutes and the neighbor that plays.
 */

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const RUI = "@rui:casa.pt"
const DM = moradaDeTeste("directa ana eu", "casa.pt")
const LAGAR = "!lagar:casa.pt"

beforeEach(() => lembrarFichasDosCanais({ [DM]: { tipo: "directa" } }))

describe("a chamada a sair", () => {
  it("toca quando entro numa privada onde ainda não está ninguém: fui eu que liguei", () => {
    expect(comecaAChamar({ canal: DM, eu: EU, naChamada: [], pares: [] })).toBe(true)
    // My own announcement (or another device of mine) is not someone answering.
    expect(comecaAChamar({ canal: DM, eu: EU, naChamada: [EU], pares: [{ address: EU }] })).toBe(true)
  })

  it("não toca quando a outra pessoa já lá está: entrar é atender", () => {
    expect(comecaAChamar({ canal: DM, eu: EU, naChamada: [ANA], pares: [] })).toBe(false)
    expect(comecaAChamar({ canal: DM, eu: EU, naChamada: [], pares: [{ address: ANA }] })).toBe(false)
  })

  it("não toca numa sala de voz de uma comunidade: ninguém liga a ninguém", () => {
    expect(comecaAChamar({ canal: LAGAR, eu: EU, naChamada: [], pares: [] })).toBe(false)
  })

  it("não toca quando a entrada foi uma mudança feita por outra pessoa", () => {
    expect(comecaAChamar({ canal: DM, eu: EU, naChamada: [], pares: [], movido: true })).toBe(false)
  })

  it("pára quando alguém atende, quando desisto, e quando mudo para outra chamada", () => {
    expect(paraDeChamar(DM, DM, false)).toBe(false)
    expect(paraDeChamar(DM, DM, true)).toBe(true)
    expect(paraDeChamar(DM, null, false)).toBe(true)
    expect(paraDeChamar(DM, LAGAR, false)).toBe(true)
  })

  it("quem atende conta pelos anúncios e pelos pares; eu não conto", () => {
    expect(haOutraPessoa({ eu: EU, naChamada: [EU], pares: [] })).toBe(false)
    expect(haOutraPessoa({ eu: EU, naChamada: [EU, ANA], pares: [] })).toBe(true)
    expect(haOutraPessoa({ eu: EU, naChamada: [], pares: [{ address: ANA }] })).toBe(true)
  })
})

describe("a ligação de voz perdida", () => {
  function ligadaPorSfu() {
    const vigia = criarVigiaDaQueda()
    vigia.ligacao(true, false)
    vigia.caminho("sfu")
    return vigia
  }

  it("toca quando o socket cai com uma chamada por SFU de pé", () => {
    expect(ligadaPorSfu().ligacao(false, true)).toBe("voz-perdida")
  })

  it("não toca sem chamada, nem numa chamada de malha (a media continua entre pares)", () => {
    expect(ligadaPorSfu().ligacao(false, false)).toBeNull()
    const malha = criarVigiaDaQueda()
    malha.ligacao(true, false)
    malha.caminho("malha")
    expect(malha.ligacao(false, true)).toBeNull()
    // Without a known path, it speaks like the mesh (`caminhoDoDetalhe`).
    const semCaminho = criarVigiaDaQueda()
    semCaminho.ligacao(true, false)
    expect(semCaminho.ligacao(false, true)).toBeNull()
  })

  it("só a passagem de ligado a desligado conta: as tentativas a seguir não tocam", () => {
    const vigia = ligadaPorSfu()
    expect(vigia.ligacao(false, true)).toBe("voz-perdida")
    vigia.mediaVoltou()
    // Still disconnected: "connecting", "disconnected" again. Not another drop.
    expect(vigia.ligacao(false, true)).toBeNull()
    // The app opening (never been on) either.
    const nova = criarVigiaDaQueda()
    nova.caminho("sfu")
    expect(nova.ligacao(false, true)).toBeNull()
  })

  it("uma queda faz um som: o núcleo largar a chamada a seguir não toca outra vez", () => {
    const vigia = ligadaPorSfu()
    expect(vigia.ligacao(false, true)).toBe("voz-perdida")
    vigia.ligacao(true, true)
    expect(vigia.chamadaCaiu()).toBeNull()
  })

  it("o núcleo largar a chamada sem queda do socket antes toca", () => {
    expect(ligadaPorSfu().chamadaCaiu()).toBe("voz-perdida")
  })

  it("a chamada refeita (a media voltou) faz da queda seguinte outra queda", () => {
    const vigia = ligadaPorSfu()
    vigia.ligacao(false, true)
    vigia.ligacao(true, true)
    vigia.mediaVoltou()
    expect(vigia.ligacao(false, true)).toBe("voz-perdida")
  })

  it("quem modera tirar-me da chamada toca; uma vez, mesmo depois de uma queda que acabou a chamada", () => {
    const vigia = ligadaPorSfu()
    expect(vigia.desligadoPorOutro()).toBe("voz-perdida")
    expect(vigia.desligadoPorOutro()).toBeNull()
    vigia.chamadaAcabou()
    expect(vigia.desligadoPorOutro()).toBe("voz-perdida")
  })

  it("a chamada que acaba esquece o caminho: a chamada seguinte diz o seu", () => {
    const vigia = ligadaPorSfu()
    vigia.chamadaAcabou()
    expect(vigia.ligacao(false, true)).toBeNull()
  })

  it("o erro que o núcleo emite é o que este ficheiro espera", () => {
    const nucleo = readFileSync(join(__dirname, "../../../client-core/src/call.ts"), "utf8")
    expect(nucleo).toContain(`this.emit("error", { detail: "${ERRO_DA_CHAMADA_QUE_CAIU}" })`)
  })
})

describe("a transmissão", () => {
  const par = (address: string, sobre: Partial<ParDaTransmissao> = {}): ParDaTransmissao => ({
    address,
    ecraOferecido: false,
    aVerONossoEcra: false,
    ...sobre,
  })
  const estado = (sobre: Partial<EstadoDaTransmissao> = {}): EstadoDaTransmissao => ({
    eu: EU,
    euPartilho: false,
    pares: [],
    ensurdecido: false,
    naSalaAfk: false,
    ...sobre,
  })
  const DEPOIS = ROSTER_SETTLE_MS + 1
  /** A watcher already in the room, with the list settled. */
  function naSala(pares: ParDaTransmissao[] = [par(ANA)]) {
    const vigia = criarVigiaDasTransmissoes()
    vigia.enter("lagar/voz", 0)
    vigia.observar(estado({ pares }), 10)
    return vigia
  }
  const tipos = (sons: { tipo: string }[]): string[] => sons.map((som) => som.tipo)

  it("a minha começa e acaba: toca nos dois sentidos, e o fim espera para saber se saí", () => {
    const vigia = naSala()
    expect(vigia.observar(estado({ euPartilho: true, pares: [par(ANA)] }), 20)).toEqual([{ tipo: "transmissao-iniciada" }])
    expect(vigia.observar(estado({ euPartilho: false, pares: [par(ANA)] }), 30)).toEqual([
      { tipo: "transmissao-terminada", minha: true },
    ])
  })

  it("a minha ouve-se mesmo com «Silenciar tudo», e logo à entrada: é um gesto", () => {
    const vigia = criarVigiaDasTransmissoes()
    vigia.enter("lagar/voz", 0)
    expect(tipos(vigia.observar(estado({ euPartilho: true, ensurdecido: true }), 10))).toEqual(["transmissao-iniciada"])
  })

  it("a de outra pessoa da sala começa e acaba: toca", () => {
    const vigia = naSala()
    expect(tipos(vigia.observar(estado({ pares: [par(ANA, { ecraOferecido: true })] }), DEPOIS))).toEqual(["transmissao-iniciada"])
    expect(tipos(vigia.observar(estado({ pares: [par(ANA)] }), DEPOIS + 1))).toEqual(["transmissao-terminada"])
  })

  it("quem já transmitia quando entrei, ou nos primeiros segundos, não começou agora", () => {
    const vigia = criarVigiaDasTransmissoes()
    vigia.enter("lagar/voz", 0)
    expect(vigia.observar(estado({ pares: [par(ANA, { ecraOferecido: true })] }), 10)).toEqual([])
    expect(vigia.observar(estado({ pares: [par(ANA, { ecraOferecido: true }), par(RUI)] }), 100)).toEqual([])
    expect(vigia.observar(estado({ pares: [par(ANA, { ecraOferecido: true }), par(RUI, { ecraOferecido: true })] }), 200)).toEqual([])
    // After the list settles, someone stopping and coming back is news.
    expect(tipos(vigia.observar(estado({ pares: [par(ANA, { ecraOferecido: true }), par(RUI)] }), DEPOIS))).toEqual(["transmissao-terminada"])
  })

  it("quem chega já a transmitir entrou: toca o «entrou», e não este", () => {
    const vigia = naSala()
    expect(vigia.observar(estado({ pares: [par(ANA), par(RUI, { ecraOferecido: true })] }), DEPOIS)).toEqual([])
  })

  it("quem sai a transmitir leva a transmissão: toca o «saiu», e não este", () => {
    const vigia = naSala([par(ANA, { ecraOferecido: true })])
    expect(vigia.observar(estado({ pares: [] }), DEPOIS)).toEqual([])
    // And if they come back already broadcasting, it is not.
    expect(vigia.observar(estado({ pares: [par(ANA, { ecraOferecido: true })] }), DEPOIS + 1)).toEqual([])
  })

  it("«Silenciar tudo» e a sala AFK calam as dos outros; a lista actualiza-se na mesma", () => {
    const vigia = naSala()
    expect(vigia.observar(estado({ pares: [par(ANA, { ecraOferecido: true })], ensurdecido: true }), DEPOIS)).toEqual([])
    // Listening again does not play for what changed meanwhile.
    expect(vigia.observar(estado({ pares: [par(ANA, { ecraOferecido: true })] }), DEPOIS + 1)).toEqual([])
    expect(vigia.observar(estado({ pares: [par(ANA)], naSalaAfk: true }), DEPOIS + 2)).toEqual([])
  })

  it("eu nunca sou um par: o meu anúncio na lista não toca", () => {
    const vigia = naSala([par(EU)])
    expect(vigia.observar(estado({ pares: [par(EU, { ecraOferecido: true })] }), DEPOIS)).toEqual([])
  })

  it("mudar de sala recomeça a fotografia, e a minha transmissão não começa outra vez", () => {
    const vigia = naSala()
    vigia.observar(estado({ euPartilho: true, pares: [par(ANA)] }), 20)
    vigia.enter("lagar/outra", DEPOIS)
    expect(vigia.observar(estado({ euPartilho: true, pares: [par(RUI, { ecraOferecido: true })] }), DEPOIS + 10)).toEqual([])
    // Leaving the call forgets it: the next one starts from zero.
    vigia.enter(null, DEPOIS + 20)
    vigia.enter("lagar/voz", DEPOIS + 30)
    expect(tipos(vigia.observar(estado({ euPartilho: true }), DEPOIS + 40))).toEqual(["transmissao-iniciada"])
  })

  it("fora de uma sala, nada", () => {
    expect(criarVigiaDasTransmissoes().observar(estado({ euPartilho: true }), 0)).toEqual([])
  })

  describe("quem vê a minha", () => {
    function aTransmitir() {
      const vigia = naSala([par(ANA), par(RUI)])
      vigia.observar(estado({ euPartilho: true, pares: [par(ANA), par(RUI)] }), 20)
      return vigia
    }

    it("alguém começa a ver e deixa de ver: toca nos dois sentidos", () => {
      const vigia = aTransmitir()
      expect(tipos(vigia.observar(estado({ euPartilho: true, pares: [par(ANA, { aVerONossoEcra: true }), par(RUI)] }), DEPOIS))).toEqual([
        "espectador-entrou",
      ])
      expect(tipos(vigia.observar(estado({ euPartilho: true, pares: [par(ANA), par(RUI)] }), DEPOIS + 1))).toEqual(["espectador-saiu"])
    })

    it("dois a começar a ver de uma vez fazem um som", () => {
      const vigia = aTransmitir()
      const sons = vigia.observar(
        estado({ euPartilho: true, pares: [par(ANA, { aVerONossoEcra: true }), par(RUI, { aVerONossoEcra: true })] }),
        DEPOIS,
      )
      expect(tipos(sons)).toEqual(["espectador-entrou"])
    })

    it("sem transmissão minha, ninguém me vê: um «aVer» antigo não toca", () => {
      const vigia = naSala([par(ANA), par(RUI)])
      expect(vigia.observar(estado({ pares: [par(ANA, { aVerONossoEcra: true }), par(RUI)] }), DEPOIS)).toEqual([])
    })

    it("quando a minha acaba, quem a via deixa de a ver em silêncio", () => {
      const vigia = aTransmitir()
      vigia.observar(estado({ euPartilho: true, pares: [par(ANA, { aVerONossoEcra: true }), par(RUI)] }), DEPOIS)
      expect(tipos(vigia.observar(estado({ euPartilho: false, pares: [par(ANA, { aVerONossoEcra: true }), par(RUI)] }), DEPOIS + 1))).toEqual([
        "transmissao-terminada",
      ])
      expect(vigia.observar(estado({ pares: [par(ANA), par(RUI)] }), DEPOIS + 2)).toEqual([])
    })

    it("quem sai da chamada a ver leva a vista consigo: toca o «saiu», e não este", () => {
      const vigia = aTransmitir()
      vigia.observar(estado({ euPartilho: true, pares: [par(ANA, { aVerONossoEcra: true }), par(RUI)] }), DEPOIS)
      expect(vigia.observar(estado({ euPartilho: true, pares: [par(RUI)] }), DEPOIS + 1)).toEqual([])
    })

    it("«Silenciar tudo» cala os espectadores", () => {
      const vigia = aTransmitir()
      expect(vigia.observar(estado({ euPartilho: true, ensurdecido: true, pares: [par(ANA, { aVerONossoEcra: true }), par(RUI)] }), DEPOIS)).toEqual([])
    })
  })
})

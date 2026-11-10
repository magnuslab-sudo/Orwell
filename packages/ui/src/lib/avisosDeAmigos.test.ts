import { describe, expect, it } from "vitest"
import { criarVigiaDaVoz, criarVigiaDasComunidades } from "./avisosDeAmigos.js"
import { criarVigiaDosAmigos, INTERVALO_DO_AVISO_MS } from "./amigosOnline.js"
import { criarVigiaDasChamadas } from "./chamadasPerdidas.js"
import { PRESENCA_VALIDA_MS } from "./presenca.js"

const ANA = "@ana:casa.pt"
const BRUNO = "@bruno:casa.pt"
const SALA = "!oficina:casa.pt lounge"

const anuncio = (agora: number, extra: Partial<Parameters<ReturnType<typeof criarVigiaDaVoz>["ouvir"]>[0]> = {}) => ({
  sala: SALA,
  quem: ANA,
  entrou: true,
  ecra: false,
  agora,
  aAssentar: false,
  ...extra,
})

describe("o vigia da voz", () => {
  it("a primeira entrada é entrada; o mesmo anúncio repetido não é", () => {
    const vigia = criarVigiaDaVoz()
    expect(vigia.ouvir(anuncio(1000)).entrou).toBe(true)
    expect(vigia.ouvir(anuncio(5000)).entrou).toBe(false)
  })

  it("durante a abertura guarda e não avisa, e depois a mesma pessoa não conta", () => {
    const vigia = criarVigiaDaVoz()
    expect(vigia.ouvir(anuncio(1000, { aAssentar: true }))).toEqual({ entrou: false, comecouOEcra: false })
    expect(vigia.ouvir(anuncio(5000)).entrou).toBe(false)
  })

  it("sair e voltar é entrar outra vez; uma presença caducada também", () => {
    const vigia = criarVigiaDaVoz()
    vigia.ouvir(anuncio(1000))
    vigia.ouvir(anuncio(2000, { entrou: false }))
    expect(vigia.ouvir(anuncio(3000)).entrou).toBe(true)
    expect(vigia.ouvir(anuncio(3000 + PRESENCA_VALIDA_MS + 1)).entrou).toBe(true)
  })

  it("começar a partilhar o ecrã é passar de sem ecrã a com ecrã", () => {
    const vigia = criarVigiaDaVoz()
    vigia.ouvir(anuncio(1000))
    expect(vigia.ouvir(anuncio(2000, { ecra: true })).comecouOEcra).toBe(true)
    expect(vigia.ouvir(anuncio(3000, { ecra: true })).comecouOEcra).toBe(false)
    vigia.ouvir(anuncio(4000))
    expect(vigia.ouvir(anuncio(5000, { ecra: true })).comecouOEcra).toBe(true)
  })

  it("quem se desliga sai de todas as salas", () => {
    const vigia = criarVigiaDaVoz()
    vigia.ouvir(anuncio(1000))
    vigia.esquecer(ANA)
    expect(vigia.ouvir(anuncio(2000)).entrou).toBe(true)
  })
})

describe("o vigia das comunidades", () => {
  it("a primeira lista é fotografia; as seguintes dizem quem entrou", () => {
    const vigia = criarVigiaDasComunidades()
    expect(vigia.membros("!c", [ANA], false)).toEqual([])
    expect(vigia.membros("!c", [ANA, BRUNO], false)).toEqual([BRUNO])
    expect(vigia.membros("!c", [ANA, BRUNO], false)).toEqual([])
  })

  it("na abertura da ligação só guarda", () => {
    const vigia = criarVigiaDasComunidades()
    vigia.membros("!c", [ANA], true)
    expect(vigia.membros("!c", [ANA, BRUNO], true)).toEqual([])
    expect(vigia.membros("!c", [ANA, BRUNO], false)).toEqual([])
  })
})

describe("o intervalo de 30 minutos conta por tipo", () => {
  it("a Ana online não cala a Ana na sala de voz", () => {
    const vigia = criarVigiaDosAmigos()
    expect(vigia.registar(ANA, 0)).toBe(true)
    expect(vigia.registar(ANA, 1, "voz")).toBe(true)
    expect(vigia.registar(ANA, 2, "voz")).toBe(false)
    expect(vigia.registar(ANA, INTERVALO_DO_AVISO_MS + 1, "voz")).toBe(true)
  })
})

describe("o vigia das chamadas perdidas", () => {
  it("quem ligou desiste sem nós entrarmos: perdida", () => {
    const vigia = criarVigiaDasChamadas()
    vigia.tocou("!dm", ANA, 100)
    expect(vigia.saiu("!dm", ANA)).toEqual({ canal: "!dm", quem: ANA, em: 100 })
    expect(vigia.saiu("!dm", ANA)).toBeNull()
  })

  it("atendida não é perdida", () => {
    const vigia = criarVigiaDasChamadas()
    vigia.tocou("!dm", ANA, 100)
    vigia.atendida("!dm")
    expect(vigia.saiu("!dm", ANA)).toBeNull()
  })

  it("quem ligou desliga-se: perdida", () => {
    const vigia = criarVigiaDasChamadas()
    vigia.tocou("!dm", ANA, 100)
    expect(vigia.desligou(BRUNO)).toEqual([])
    expect(vigia.desligou(ANA)).toHaveLength(1)
  })
})

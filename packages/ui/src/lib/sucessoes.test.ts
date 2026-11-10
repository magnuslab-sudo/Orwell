import { describe, expect, it } from "vitest"
import type { FriendTie } from "@enclave/protocol"
import type { Sucessao } from "../bridge.js"
import { escondidasPorSucessao, ofertasDeSucessao } from "./sucessoes.js"
import { moradaDeTeste } from "../../testes/moradas.js"

const DM_ANA_BRUNO = moradaDeTeste("directa ana bruno", "orwell.pt")

const ANA = "@ana:orwell.pt"
const DORA = "@dora:orwell.pt"
const EU = "@bruno:orwell.pt"
const SALA = "!sala:orwell.pt"

const sucessao = (extra: Partial<Sucessao> = {}): Sucessao => ({
  para: DORA,
  at: 1,
  seq: 1,
  canais: [DM_ANA_BRUNO, SALA],
  eraAmigo: true,
  feitos: [],
  ...extra,
})

const contexto = (extra: Partial<Parameters<typeof ofertasDeSucessao>[1]> = {}): Parameters<typeof ofertasDeSucessao>[1] => ({
  eu: EU,
  ties: new Map<string, FriendTie>(),
  canais: [SALA],
  podeConvidar: () => true,
  ...extra,
})

describe("o que se oferece quando uma conta passou a ser outra", () => {
  it('a quem era amigo, "Adicionar?"; a quem pode convidar, "Convidar?" por canal; nunca na directa', () => {
    expect(ofertasDeSucessao({ [ANA]: sucessao() }, contexto())).toEqual([
      { de: ANA, para: DORA, tipo: "amigo" },
      { de: ANA, para: DORA, tipo: "canal", canal: SALA },
    ])
  })

  it('uma vez: o que já se respondeu não volta, e "*" fecha tudo', () => {
    expect(ofertasDeSucessao({ [ANA]: sucessao({ feitos: ["amigo", SALA] }) }, contexto())).toEqual([])
    expect(ofertasDeSucessao({ [ANA]: sucessao({ feitos: ["*"] }) }, contexto())).toEqual([])
  })

  it("sem amizade antiga, sem poder de convidar ou fora do canal, nada", () => {
    expect(ofertasDeSucessao({ [ANA]: sucessao({ eraAmigo: false }) }, contexto({ podeConvidar: () => false }))).toEqual([])
    expect(ofertasDeSucessao({ [ANA]: sucessao({ eraAmigo: false }) }, contexto({ canais: [] }))).toEqual([])
  })

  it("já amiga da principal, ou a própria principal: não se oferece o pedido", () => {
    const ties = new Map([[DORA, { peer: DORA, link: "amigos" } as FriendTie]])
    expect(ofertasDeSucessao({ [ANA]: sucessao({ canais: [] }) }, contexto({ ties }))).toEqual([])
    expect(ofertasDeSucessao({ [ANA]: sucessao() }, contexto({ eu: DORA }))).toEqual([])
  })

  it("a conta antiga sai das listas", () => {
    expect([...escondidasPorSucessao({ [ANA]: sucessao() })]).toEqual([ANA])
  })
})

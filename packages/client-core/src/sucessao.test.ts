import { describe, expect, it } from "vitest"
import {
  comContaJuntada,
  contasJuntadas,
  marcarSucessaoFeita,
  PREFERENCIA_CONTAS_JUNTADAS,
  registarSucessao,
  sucessoesDoCofre,
  sucessoraDaMensagem,
  type SucessaoRecebida,
} from "./sucessao.js"
import { newVaultContents } from "./vault.js"
import { moradaDeTeste } from "../testes/moradas.js"

const DM_A_B = moradaDeTeste("directa a b", "orwell.pt")

/** The record of account mergers (phase 8.2, "Merge accounts"). See `sucessao.ts`. */

const ANA = "@ana:orwell.pt"
const DORA = "@dora:orwell.pt"
const EVA = "@eva:orwell.pt"

const recebida = (extra: Partial<SucessaoRecebida> = {}): SucessaoRecebida => ({
  de: ANA,
  para: DORA,
  at: 10,
  seq: 5,
  canal: DM_A_B,
  eraAmigo: true,
  ...extra,
})

describe("a sucessão que uma mensagem traz", () => {
  it("lê o destino, e recusa o que não é endereço nem mensagem", () => {
    expect(sucessoraDaMensagem({ t: "message", sucessora: { para: DORA, at: 3 } })).toEqual({ para: DORA, at: 3 })
    expect(sucessoraDaMensagem({ t: "message", sucessora: { para: "dora", at: 3 } })).toBeNull()
    expect(sucessoraDaMensagem({ t: "post", sucessora: { para: DORA, at: 3 } })).toBeNull()
    expect(sucessoraDaMensagem({ t: "message", body: "olá" })).toBeNull()
  })
})

describe("o registo, uma vez por conta", () => {
  it("a primeira fica; uma segunda para outro destino não redirecciona", () => {
    const cofre = newVaultContents()
    expect(registarSucessao(cofre, recebida())).toBe(true)
    expect(registarSucessao(cofre, recebida({ para: EVA, canal: "!sala:orwell.pt" }))).toBe(false)
    expect(sucessoesDoCofre(cofre)[ANA]?.para).toBe(DORA)
  })

  it("as seguintes para o mesmo destino só acrescentam o canal", () => {
    const cofre = newVaultContents()
    registarSucessao(cofre, recebida({ eraAmigo: false }))
    expect(registarSucessao(cofre, recebida({ canal: "!sala:orwell.pt", eraAmigo: false }))).toBe(true)
    expect(registarSucessao(cofre, recebida({ canal: "!sala:orwell.pt", eraAmigo: false }))).toBe(false)
    const registo = sucessoesDoCofre(cofre)[ANA]
    expect(registo?.canais).toEqual([DM_A_B, "!sala:orwell.pt"])
    expect(registo?.eraAmigo).toBe(false)
  })

  it("lê as pendentes por cima do cofre, sem as gravar", () => {
    const cofre = newVaultContents()
    expect(sucessoesDoCofre(cofre, [recebida()])[ANA]?.para).toBe(DORA)
    expect(sucessoesDoCofre(cofre)[ANA]).toBeUndefined()
  })

  it("marcar uma resposta fecha só essa oferta", () => {
    const cofre = newVaultContents()
    registarSucessao(cofre, recebida())
    expect(marcarSucessaoFeita(cofre, ANA, "amigo")).toBe(true)
    expect(marcarSucessaoFeita(cofre, ANA, "amigo")).toBe(false)
    expect(marcarSucessaoFeita(cofre, EVA, "amigo")).toBe(false)
    expect(sucessoesDoCofre(cofre)[ANA]?.feitos).toEqual(["amigo"])
  })
})

describe("as contas que a principal juntou", () => {
  it("vivem numa preferência da conta, como lista JSON", () => {
    expect(contasJuntadas({})).toEqual([])
    const valor = comContaJuntada({}, ANA)
    expect(valor).toBe(JSON.stringify([ANA]))
    const preferencias = { [PREFERENCIA_CONTAS_JUNTADAS]: valor! }
    expect(contasJuntadas(preferencias)).toEqual([ANA])
    expect(comContaJuntada(preferencias, ANA)).toBeNull()
    expect(contasJuntadas({ [PREFERENCIA_CONTAS_JUNTADAS]: "{estragada" })).toEqual([])
  })
})

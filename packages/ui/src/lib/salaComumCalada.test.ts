import { beforeEach, describe, expect, it } from "vitest"
import { DEFAULT_PREFS, readPrefs, writePrefs } from "../hooks/usePrefs.js"
import { CHAVE_LOCAL, MARCA_NA_CONTA, calarSalaComumUmaVez } from "./salaComumCalada.js"

/**
 * The common channel comes with sound off, via the mute that already exists
 * (owner decision, November 3, 2026). Once only: whoever turns it back on keeps
 * it on.
 */

const COMUM = "!orwell:casa.pt"

function memoria(): Pick<Storage, "getItem" | "setItem"> & { dados: Map<string, string> } {
  const dados = new Map<string, string>()
  return { dados, getItem: (chave) => dados.get(chave) ?? null, setItem: (chave, valor) => void dados.set(chave, valor) }
}

function conta(inicial: Record<string, string> = {}) {
  const preferencias: Record<string, string> = { ...inicial }
  return {
    preferencias,
    lerConta: () => ({ preferencias }),
    definirNaConta: (chave: string, valor: string) => {
      preferencias[chave] = valor
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  writePrefs({ ...DEFAULT_PREFS, silenciados: [] })
})

describe("o canal comum calado de fábrica", () => {
  it("na primeira vez, silencia o canal comum e marca no aparelho e na conta", () => {
    const armazem = memoria()
    const daConta = conta()
    expect(calarSalaComumUmaVez(COMUM, { armazem, ...daConta })).toBe(true)
    expect(readPrefs().silenciados).toEqual([COMUM])
    expect(armazem.dados.get(CHAVE_LOCAL)).toBe(COMUM)
    expect(daConta.preferencias[MARCA_NA_CONTA]).toBe(COMUM)
  })

  it("quem o liga outra vez fica com ele ligado: a segunda vez não silencia", () => {
    const armazem = memoria()
    const daConta = conta()
    calarSalaComumUmaVez(COMUM, { armazem, ...daConta })
    writePrefs({ ...readPrefs(), silenciados: [] })
    expect(calarSalaComumUmaVez(COMUM, { armazem, ...daConta })).toBe(false)
    expect(readPrefs().silenciados).toEqual([])
  })

  it("um aparelho novo da mesma conta lê a marca da conta e não silencia outra vez", () => {
    const armazem = memoria()
    const daConta = conta({ [MARCA_NA_CONTA]: COMUM })
    expect(calarSalaComumUmaVez(COMUM, { armazem, ...daConta })).toBe(false)
    expect(readPrefs().silenciados).toEqual([])
    expect(armazem.dados.get(CHAVE_LOCAL)).toBe(COMUM)
  })

  it("sem ligação à conta, a marca sobe na ligação seguinte", () => {
    const armazem = memoria()
    const semLigacao = { lerConta: () => ({ preferencias: {} }), definirNaConta: () => {} }
    calarSalaComumUmaVez(COMUM, { armazem, ...semLigacao })
    const daConta = conta()
    expect(calarSalaComumUmaVez(COMUM, { armazem, ...daConta })).toBe(false)
    expect(daConta.preferencias[MARCA_NA_CONTA]).toBe(COMUM)
  })

  it("já silenciado à mão: não mexe na lista, e marca", () => {
    writePrefs({ ...readPrefs(), silenciados: [COMUM] })
    const armazem = memoria()
    const daConta = conta()
    expect(calarSalaComumUmaVez(COMUM, { armazem, ...daConta })).toBe(false)
    expect(readPrefs().silenciados).toEqual([COMUM])
    expect(daConta.preferencias[MARCA_NA_CONTA]).toBe(COMUM)
  })

  it("um canal comum novo do servidor cala-se uma vez; sem canal comum, nada", () => {
    const armazem = memoria()
    const daConta = conta()
    calarSalaComumUmaVez(COMUM, { armazem, ...daConta })
    expect(calarSalaComumUmaVez("!novo:casa.pt", { armazem, ...daConta })).toBe(true)
    expect(readPrefs().silenciados).toEqual([COMUM, "!novo:casa.pt"])
    expect(calarSalaComumUmaVez(null, { armazem, ...daConta })).toBe(false)
  })
})

import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_PREFS, PREFS_KEY, readPrefs, writePrefs } from "../hooks/usePrefs.js"
import {
  ligarPreferenciasDaConta,
  PREFERENCIAS_QUE_VIAJAM,
  silenciadosDaConta,
  silenciadosEmPartes,
  SILENCIADOS_MAIS,
} from "./preferenciasDaConta.js"
import { alternarSilencio, chaveDoSilencio, estaSilenciado, lerSilenciados, numeroVisivel, SILENCIADOS_MAX } from "./silenciados.js"

afterEach(() => localStorage.clear())

describe("silenciados — as chaves e a regra", () => {
  it("o canal inteiro cala as salas dele; uma sala cala-se sozinha", () => {
    const lista = ["!lagar:s", chaveDoSilencio("!adega:s", "vinha")]
    expect(estaSilenciado(lista, "!lagar:s")).toBe(true)
    expect(estaSilenciado(lista, "!lagar:s", "qualquer")).toBe(true)
    expect(estaSilenciado(lista, "!adega:s", "vinha")).toBe(true)
    expect(estaSilenciado(lista, "!adega:s", "")).toBe(false)
    expect(estaSilenciado(lista, "!adega:s")).toBe(false)
  })

  it("alternar acrescenta e tira, e a lista tem tecto", () => {
    expect(alternarSilencio([], "!a:s")).toEqual(["!a:s"])
    expect(alternarSilencio(["!a:s", "!b:s"], "!a:s")).toEqual(["!b:s"])
    const cheia = Array.from({ length: SILENCIADOS_MAX }, (_, i) => `!c${i}:s`)
    expect(alternarSilencio(cheia, "!novo:s")).toHaveLength(SILENCIADOS_MAX)
  })

  it("o lixo não entra, e o número silenciado é o das menções", () => {
    expect(lerSilenciados(["!a:s", "@pessoa:s", 3, "!a:s"])).toEqual(["!a:s"])
    expect(lerSilenciados("!a:s")).toEqual([])
    expect(numeroVisivel({ todas: 5, mencoes: 1 }, true)).toBe(1)
    expect(numeroVisivel({ todas: 5, mencoes: 1 }, false)).toBe(5)
  })
})

/** A fake account: what `set` writes, `read` returns. */
function contaFalsa(inicial: Record<string, string> = {}) {
  let preferencias: Record<string, string> = { ...inicial }
  const ouvintes = new Set<() => void>()
  const definidas: [string, string][] = []
  return {
    definidas,
    ler: () => ({ preferencias }),
    aoMudar: (ouvinte: () => void) => {
      ouvintes.add(ouvinte)
      return () => ouvintes.delete(ouvinte)
    },
    definir: (chave: string, valor: string) => {
      definidas.push([chave, valor])
      preferencias = { ...preferencias, [chave]: valor }
    },
    /** A peer changed the account. */
    chegou: (chave: string, valor: string) => {
      preferencias = { ...preferencias, [chave]: valor }
      for (const ouvinte of ouvintes) ouvinte()
    },
  }
}

describe("silenciados — vão aos outros aparelhos com as preferências", () => {
  it("silenciar aqui sobe para a conta, e só uma vez", () => {
    const conta = contaFalsa()
    const desligar = ligarPreferenciasDaConta(conta.ler, conta.aoMudar, conta.definir)
    writePrefs({ ...readPrefs(), silenciados: ["!lagar:s"] })
    expect(conta.definidas).toEqual([[PREFERENCIAS_QUE_VIAJAM.silenciados, JSON.stringify(["!lagar:s"])]])
    // Another write that does not touch mute does not upload anything.
    writePrefs({ ...readPrefs(), soundVolume: 20 })
    expect(conta.definidas).toHaveLength(1)
    desligar()
  })

  it("o que um irmão silenciou chega aqui, e não volta para lá como escolha nova", () => {
    const conta = contaFalsa()
    const desligar = ligarPreferenciasDaConta(conta.ler, conta.aoMudar, conta.definir)
    conta.chegou(PREFERENCIAS_QUE_VIAJAM.silenciados, JSON.stringify(["!adega:s/vinha"]))
    expect(readPrefs().silenciados).toEqual(["!adega:s/vinha"])
    expect(conta.definidas).toEqual([])
    desligar()
  })

  it("um aparelho com silêncios e uma conta sem eles sobe-os como semente", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...DEFAULT_PREFS, silenciados: ["!lagar:s"], chosen: true }))
    const conta = contaFalsa()
    const desligar = ligarPreferenciasDaConta(conta.ler, conta.aoMudar, conta.definir)
    expect(conta.definidas).toContainEqual([PREFERENCIAS_QUE_VIAJAM.silenciados, JSON.stringify(["!lagar:s"])])
    desligar()
  })
})

describe("silenciados acima de 2000 caracteres (fase 1i)", () => {
  // 120 rooms with long names: well above a preference.
  const muitos = Array.from({ length: 120 }, (_, i) => chaveDoSilencio(`!canal-com-um-nome-comprido-${i}:servidor.exemplo.pt`, `sala-${i}`))

  it("a lista inteira sobe em partes, e cada parte cabe numa preferência", () => {
    expect(JSON.stringify(muitos).length).toBeGreaterThan(2000)
    const conta = contaFalsa()
    const desligar = ligarPreferenciasDaConta(conta.ler, conta.aoMudar, conta.definir)
    writePrefs({ ...readPrefs(), silenciados: muitos })
    const subidas = Object.fromEntries(conta.definidas)
    for (const valor of Object.values(subidas)) expect(valor.length).toBeLessThanOrEqual(2000)
    expect(Number(subidas[SILENCIADOS_MAIS]?.split(":")[0])).toBeGreaterThan(0)
    // Another device reads the entire list of what uploaded.
    expect(silenciadosDaConta(subidas)).toEqual(muitos)
    desligar()
  })

  it("um irmão recebe as partes e fica com a lista inteira; com uma parte em falta, espera", () => {
    const partes = silenciadosEmPartes(muitos, 77)
    const semUma = { ...partes }
    delete semUma[`${PREFERENCIAS_QUE_VIAJAM.silenciados}.2`]
    expect(silenciadosDaConta(semUma)).toBeUndefined()

    const conta = contaFalsa()
    const desligar = ligarPreferenciasDaConta(conta.ler, conta.aoMudar, conta.definir)
    for (const [chave, valor] of Object.entries(partes)) conta.chegou(chave, valor)
    expect(readPrefs().silenciados).toEqual(muitos)
    expect(conta.definidas).toEqual([])
    desligar()
  })

  it("uma parte de uma escrita antiga não se mistura com as de uma nova", () => {
    const velhas = silenciadosEmPartes(muitos, 1)
    const novas = silenciadosEmPartes(muitos.slice(10), 2)
    const misturadas = { ...novas, [`${PREFERENCIAS_QUE_VIAJAM.silenciados}.2`]: velhas[`${PREFERENCIAS_QUE_VIAJAM.silenciados}.2`]! }
    expect(silenciadosDaConta(misturadas)).toBeUndefined()
  })

  it("um irmão de uma versão anterior lê a primeira parte como uma lista normal", () => {
    const partes = silenciadosEmPartes(muitos)
    const primeira = lerSilenciados(JSON.parse(partes[PREFERENCIAS_QUE_VIAJAM.silenciados]!))
    expect(primeira.length).toBeGreaterThan(0)
    expect(muitos.slice(0, primeira.length)).toEqual(primeira)
  })
})


import { beforeEach, describe, expect, it, vi } from "vitest"
import { readPrefs, writePrefs } from "../hooks/usePrefs.js"
import { MARCA_DE_SEMENTE } from "./preferenciasDaConta.js"
import { ligarPrivacidadeDaConta, PRIVACIDADE_QUE_VIAJA } from "./privacidadeDaConta.js"

/**
 * Privacy travels with the account (stage 4): the same contract as other
 * account preferences, in a separate module.
 */

beforeEach(() => localStorage.clear())

function conta(inicial: Record<string, string> = {}) {
  let preferencias: Record<string, string> = { ...inicial }
  const ouvintes = new Set<() => void>()
  const definir = vi.fn((chave: string, valor: string) => {
    preferencias = { ...preferencias, [chave]: valor }
  })
  return {
    ler: () => ({ preferencias }),
    aoMudar: (ouvinte: () => void) => {
      ouvintes.add(ouvinte)
      return () => ouvintes.delete(ouvinte)
    },
    definir,
    chegaDeOutroAparelho: (chave: string, valor: string) => {
      preferencias = { ...preferencias, [chave]: valor }
      for (const ouvinte of ouvintes) ouvinte()
    },
  }
}

describe("ligarPrivacidadeDaConta", () => {
  it("aplica o que a conta tem a este aparelho", () => {
    const c = conta({ [PRIVACIDADE_QUE_VIAJA.pedidosDeAmizade]: "ninguem", [PRIVACIDADE_QUE_VIAJA.mostrarOnline]: "nao" })
    const desligar = ligarPrivacidadeDaConta(c.ler, c.aoMudar, c.definir)
    expect(readPrefs().pedidosDeAmizade).toBe("ninguem")
    expect(readPrefs().mostrarOnline).toBe(false)
    expect(c.definir).not.toHaveBeenCalled()
    desligar()
  })

  it("sobe como semente o que só este aparelho escolheu, e nada da fábrica", () => {
    writePrefs({ ...readPrefs(), pedidosDeAmizade: "amigos-de-amigos" })
    const c = conta()
    const desligar = ligarPrivacidadeDaConta(c.ler, c.aoMudar, c.definir)
    expect(c.definir).toHaveBeenCalledTimes(1)
    expect(c.definir).toHaveBeenCalledWith(PRIVACIDADE_QUE_VIAJA.pedidosDeAmizade, "amigos-de-amigos", MARCA_DE_SEMENTE)
    desligar()
  })

  it("um gesto aqui sobe; uma mudança de outro aparelho desce, sem voltar a subir", () => {
    const c = conta()
    const desligar = ligarPrivacidadeDaConta(c.ler, c.aoMudar, c.definir)
    writePrefs({ ...readPrefs(), mostrarOnline: false })
    expect(c.definir).toHaveBeenLastCalledWith(PRIVACIDADE_QUE_VIAJA.mostrarOnline, "nao")

    c.definir.mockClear()
    c.chegaDeOutroAparelho(PRIVACIDADE_QUE_VIAJA.pedidosDeAmizade, "ninguem")
    expect(readPrefs().pedidosDeAmizade).toBe("ninguem")
    expect(c.definir).not.toHaveBeenCalled()
    desligar()
  })

  it("lixo da conta não muda nada", () => {
    const c = conta({ [PRIVACIDADE_QUE_VIAJA.pedidosDeAmizade]: "uns", [PRIVACIDADE_QUE_VIAJA.mostrarOnline]: "talvez" })
    const desligar = ligarPrivacidadeDaConta(c.ler, c.aoMudar, c.definir)
    expect(readPrefs().pedidosDeAmizade).toBe("todos")
    expect(readPrefs().mostrarOnline).toBe(true)
    desligar()
  })
})

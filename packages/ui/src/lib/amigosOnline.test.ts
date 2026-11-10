import { describe, expect, it } from "vitest"
import { INTERVALO_DO_AVISO_MS, avisoDoAmigoCabe, criarVigiaDosAmigos, type ContextoDoAmigo } from "./amigosOnline.js"

const ANA = "@ana:casa.pt"
const BRUNO = "@bruno:casa.pt"

/**
 * MSN-style notifications (requested by the owner and community, 2 November 2026, item 6):
 * when a friend comes online, send a notification. Once per friend every 30 minutes, and
 * nothing for friends who were already there when the person starts up.
 */
describe("o vigia dos amigos", () => {
  it("avisa quando um amigo passa de desligado a online", () => {
    const vigia = criarVigiaDosAmigos()
    expect(vigia.chegou(ANA, true, 10_000, false)).toBe(true)
  })

  it("a primeira rajada de presença depois de ligar não avisa: essas pessoas já lá estavam", () => {
    const vigia = criarVigiaDosAmigos()
    expect(vigia.chegou(ANA, true, 1000, true)).toBe(false)
    // After startup, Ana stays online: a second announcement is not arrival.
    expect(vigia.chegou(ANA, true, 20_000, false)).toBe(false)
    // Someone who arrives after startup sends a notification.
    expect(vigia.chegou(BRUNO, true, 20_000, false)).toBe(true)
  })

  it("sair e voltar é chegar outra vez", () => {
    const vigia = criarVigiaDosAmigos()
    expect(vigia.chegou(ANA, true, 1000, false)).toBe(true)
    expect(vigia.chegou(ANA, false, 2000, false)).toBe(false)
    expect(vigia.chegou(ANA, true, 3000, false)).toBe(true)
  })

  it("uma vez por amigo a cada 30 minutos", () => {
    const vigia = criarVigiaDosAmigos()
    expect(vigia.registar(ANA, 0)).toBe(true)
    expect(vigia.registar(ANA, INTERVALO_DO_AVISO_MS - 1)).toBe(false)
    // Another friend does not wait for Ana.
    expect(vigia.registar(BRUNO, 1)).toBe(true)
    expect(vigia.registar(ANA, INTERVALO_DO_AVISO_MS)).toBe(true)
  })

  it("a ligação a cair esquece quem estava online: a abertura seguinte volta a calar", () => {
    const vigia = criarVigiaDosAmigos()
    expect(vigia.chegou(ANA, true, 1000, false)).toBe(true)
    vigia.desligou()
    expect(vigia.chegou(ANA, true, 2000, true)).toBe(false)
    expect(vigia.chegou(ANA, true, 30_000, false)).toBe(false)
  })
})

describe("o aviso cabe?", () => {
  const base: ContextoDoAmigo = {
    ligado: true,
    eAmigo: true,
    ocupado: false,
    pausado: false,
    silenciado: false,
    desbloqueado: true,
  }

  it("cabe com tudo a favor", () => {
    expect(avisoDoAmigoCabe(base)).toBe(true)
  })

  it("cada silêncio cala", () => {
    expect(avisoDoAmigoCabe({ ...base, ligado: false })).toBe(false)
    expect(avisoDoAmigoCabe({ ...base, eAmigo: false })).toBe(false)
    expect(avisoDoAmigoCabe({ ...base, ocupado: true })).toBe(false)
    expect(avisoDoAmigoCabe({ ...base, pausado: true })).toBe(false)
    expect(avisoDoAmigoCabe({ ...base, silenciado: true })).toBe(false)
    expect(avisoDoAmigoCabe({ ...base, desbloqueado: false })).toBe(false)
  })
})

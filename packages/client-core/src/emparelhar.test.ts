import { ESTADO_PARTE_CARACTERES, ESTADO_PARTES_MAX, EstadoDeConta, juntarEstado, partirEstado } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import { adoptarPerfil, aplicarEstadoDeConta, newVaultContents } from "./vault.js"

/**
 * The profile in the pairing snapshot (phase 1e).
 *
 * Owner report (27/10/2026): "I log in to the app: I do not have the same
 * profile photo I had in the browser". The new device was born with an empty
 * profile, because the snapshot carried reads, the vault, the block list and
 * preferences, but not the profile. Here we measure the snapshot part: the
 * profile goes, with the portrait, and reaches the new device's vault before the
 * first `connect()`. The full path, with two real devices, is in
 * `session.perfil-entre-aparelhos.test.ts`.
 */

const EU = "@ana:localhost:8448"
const RETRATO = `data:image/png;base64,${"A".repeat(2_000)}`

function estadoCom(perfil?: EstadoDeConta["perfil"]): EstadoDeConta {
  return { v: 1, amizades: {}, bloqueio: {}, arquivo: {}, lidas: {}, preferencias: {}, ...(perfil ? { perfil } : {}) }
}

describe("o perfil no instantâneo", () => {
  it("vai e volta pelas partes da caixa, com o retrato", () => {
    const perfil = { displayName: "Ana", donations: [], bio: "olá", avatarDataUrl: RETRATO, updatedAt: 1_000 }
    const volta = juntarEstado(partirEstado(estadoCom(perfil)))
    expect(volta?.perfil).toEqual(perfil)
  })

  it("um instantâneo sem perfil (um anfitrião anterior) continua a ler-se", () => {
    expect(juntarEstado(partirEstado(estadoCom()))?.perfil).toBeUndefined()
  })

  it("um retrato que não cabe sai do instantâneo, e o nome fica", () => {
    // Above the cap of the whole box: without this cut, `partirEstado` would throw
    // and the device would start with no state.
    const enorme = `data:image/gif;base64,${"B".repeat(ESTADO_PARTES_MAX * ESTADO_PARTE_CARACTERES)}`
    const partes = partirEstado(estadoCom({ displayName: "Ana", donations: [], avatarDataUrl: enorme, updatedAt: 5 }))
    const volta = juntarEstado(partes)
    expect(volta?.perfil?.displayName).toBe("Ana")
    expect(volta?.perfil?.avatarDataUrl).toBeUndefined()
  })

  it("o aparelho novo nasce com o perfil do principal", () => {
    const cofre = newVaultContents()
    aplicarEstadoDeConta(cofre, EU, estadoCom({ displayName: "Ana", donations: [], avatarDataUrl: RETRATO, updatedAt: 1_000 }))
    expect(cofre.profile).toEqual({ displayName: "Ana", donations: [], avatarDataUrl: RETRATO, updatedAt: 1_000 })
  })
})

describe("o perfil mais recente ganha (`adoptarPerfil`)", () => {
  it("um mais antigo não passa por cima do que lá está", () => {
    const cofre = newVaultContents()
    cofre.profile = { displayName: "Ana nova", donations: [], updatedAt: 2_000 }
    expect(adoptarPerfil(cofre, { displayName: "Ana velha", donations: [], updatedAt: 1_000 })).toBe(false)
    expect(cofre.profile.displayName).toBe("Ana nova")
  })

  it("um mais recente substitui tudo, e tirar o retrato também vale", () => {
    const cofre = newVaultContents()
    cofre.profile = { displayName: "Ana", donations: [], avatarDataUrl: RETRATO, updatedAt: 1_000 }
    expect(adoptarPerfil(cofre, { displayName: "Ana", donations: [], updatedAt: 2_000 })).toBe(true)
    expect(cofre.profile).toEqual({ displayName: "Ana", donations: [], updatedAt: 2_000 })
  })

  it("o estado escolhido vem com o perfil do irmão, e um desconhecido cai (fase 1h)", () => {
    const cofre = newVaultContents()
    cofre.profile = { displayName: "Ana", donations: [], updatedAt: 1_000 }
    expect(adoptarPerfil(cofre, { displayName: "Ana", activity: "ocupado", donations: [], updatedAt: 2_000 })).toBe(true)
    expect(cofre.profile.activity).toBe("ocupado")
    expect(adoptarPerfil(cofre, { displayName: "Ana", activity: "invisivel", donations: [], updatedAt: 3_000 })).toBe(true)
    expect(cofre.profile.activity).toBeUndefined()
  })

  it("um perfil sem nome nunca se adopta: apagava o do principal", () => {
    const cofre = newVaultContents()
    cofre.profile = { displayName: "Ana", donations: [], avatarDataUrl: RETRATO, updatedAt: 1_000 }
    expect(adoptarPerfil(cofre, { displayName: "", donations: [], updatedAt: 9_000 })).toBe(false)
    expect(cofre.profile.avatarDataUrl).toBe(RETRATO)
  })

  it("um perfil local sem nome perde para qualquer um com nome, mesmo com a hora mais alta", () => {
    // The freshly paired device saves the activity state in an empty profile, and
    // that gives it an `updatedAt` of now.
    const cofre = newVaultContents()
    cofre.profile = { displayName: "", donations: [], updatedAt: 9_000 }
    expect(adoptarPerfil(cofre, { displayName: "Ana", donations: [], updatedAt: 1_000 })).toBe(true)
    expect(cofre.profile.displayName).toBe("Ana")
  })
})

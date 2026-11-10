import { describe, expect, it } from "vitest"
import {
  aplicarEstadoDeConta,
  fundirAmigosMostrados,
  fundirArquivo,
  fundirBloqueio,
  fundirLidas,
  fundirPerfisDeOutros,
  fundirPreferencias,
  maisRecentes,
  perfisParaOsIrmaos,
  upsertDirectory,
  marcasDeBloqueio,
  newVaultContents,
  Vault,
} from "./vault.js"
import { moradaDeTeste } from "../testes/moradas.js"

const DM_A_B = moradaDeTeste("directa a b", "localhost")

/**
 * Account state merge (phase 5): the newest timestamp wins per key, and two
 * devices that receive the same gestures in different orders end up in the same
 * place. This is what lets the same payload work as both delta and full state.
 */

const ANA = "@ana:localhost"
const BRUNO = "@bruno:localhost"

describe("fundir as marcas", () => {
  it("lidas: só sobe, e devolve o que mudou", () => {
    const c = newVaultContents()
    expect(fundirLidas(c, { a: 10, b: 5 })).toEqual(["a", "b"])
    expect(fundirLidas(c, { a: 9, b: 6 })).toEqual(["b"])
    expect(c.lidas).toEqual({ a: 10, b: 6 })
    expect(fundirLidas(c, { a: 10 })).toEqual([])
  })

  it("arquivo: o gesto mais recente ganha, e no empate arquivar ganha, por qualquer ordem", () => {
    const gestos = [
      { canal: { arquivado: true, at: 5 } },
      { canal: { arquivado: false, at: 7 } },
      { canal: { arquivado: true, at: 7 } },
    ]
    const um = newVaultContents()
    const outro = newVaultContents()
    for (const gesto of gestos) fundirArquivo(um, gesto)
    for (const gesto of [...gestos].reverse()) fundirArquivo(outro, gesto)
    expect(um.arquivo).toEqual({ canal: { arquivado: true, at: 7 } })
    expect(outro.arquivo).toEqual(um.arquivo)
  })

  it("preferências: a escolha mais recente, e no empate o maior valor, por qualquer ordem", () => {
    const um = newVaultContents()
    const outro = newVaultContents()
    const escolhas = [{ tema: { valor: "claro", at: 3 } }, { tema: { valor: "escuro", at: 3 } }, { tema: { valor: "azul", at: 2 } }]
    for (const escolha of escolhas) fundirPreferencias(um, escolha)
    for (const escolha of [...escolhas].reverse()) fundirPreferencias(outro, escolha)
    expect(um.preferencias).toEqual({ tema: { valor: "escuro", at: 3 } })
    expect(outro.preferencias).toEqual(um.preferencias)
  })

  it("bloqueio: um desbloqueio mais recente vence o bloqueio, e diz quem mudou", () => {
    const c = newVaultContents()
    c.blocked = { [BRUNO]: 10 }
    expect(fundirBloqueio(c, { [BRUNO]: { bloqueado: false, at: 9 } })).toEqual({ bloqueados: [], desbloqueados: [] })
    expect(c.blocked).toEqual({ [BRUNO]: 10 })
    expect(fundirBloqueio(c, { [BRUNO]: { bloqueado: false, at: 11 } })).toEqual({ bloqueados: [], desbloqueados: [BRUNO] })
    expect(c.blocked).toEqual({})
    expect(c.desbloqueados).toEqual({ [BRUNO]: 11 })
    expect(marcasDeBloqueio(c)).toEqual({ [BRUNO]: { bloqueado: false, at: 11 } })
    expect(fundirBloqueio(c, { [BRUNO]: { bloqueado: true, at: 12 } })).toEqual({ bloqueados: [BRUNO], desbloqueados: [] })
    expect(c.blocked).toEqual({ [BRUNO]: 12 })
    expect(c.desbloqueados).toEqual({})
  })

  it("a lista mostrada: só a mais recente da própria conta", () => {
    const c = newVaultContents()
    expect(fundirAmigosMostrados(c, ANA, { shown: [BRUNO, BRUNO], updatedAt: 4 })).toBe(true)
    expect(fundirAmigosMostrados(c, ANA, { shown: [], updatedAt: 3 })).toBe(false)
    expect(c.shownFriends).toEqual({ [ANA]: { shown: [BRUNO], updatedAt: 4 } })
  })

  it("maisRecentes corta pelo carimbo, e deixa um mapa pequeno inteiro", () => {
    expect(maisRecentes({ a: 1, b: 3, c: 2 }, 2, (at) => at)).toEqual({ b: 3, c: 2 })
    expect(maisRecentes({ a: 1 }, 2, (at) => at)).toEqual({ a: 1 })
  })
})

describe("no disco", () => {
  it("as marcas sobrevivem a fechar e reabrir o cofre", async () => {
    let bytes: Uint8Array | null = null
    const backend = {
      supportsOsProtection: false,
      read: async () => bytes,
      write: async (novos: Uint8Array) => {
        bytes = novos
      },
      clear: async () => {
        bytes = null
      },
    }
    const vault = new Vault(backend)
    await vault.create("frase")
    await vault.update((c) => {
      fundirLidas(c, { a: 1 })
      fundirPreferencias(c, { tema: { valor: "escuro", at: 2 } })
      fundirArquivo(c, { a: { arquivado: true, at: 3 } })
      fundirBloqueio(c, { [BRUNO]: { bloqueado: false, at: 4 } })
      c.aparelhosComEstado = { chave: 5 }
      c.estadoPorEnviar = true
    })
    vault.lock()
    await vault.unlock("frase")
    expect(vault.contents.lidas).toEqual({ a: 1 })
    expect(vault.contents.preferencias).toEqual({ tema: { valor: "escuro", at: 2 } })
    expect(vault.contents.arquivo).toEqual({ a: { arquivado: true, at: 3 } })
    expect(vault.contents.desbloqueados).toEqual({ [BRUNO]: 4 })
    expect(vault.contents.aparelhosComEstado).toEqual({ chave: 5 })
    expect(vault.contents.estadoPorEnviar).toBe(true)
  })
})

describe("aplicar o instantâneo", () => {
  it("num cofre novo copia as marcas e põe o livro no livro de estado, marcado como herdado", () => {
    const c = newVaultContents()
    aplicarEstadoDeConta(c, ANA, {
      amizades: { [DM_A_B]: [{ seq: 3, sender: BRUNO, t: "friend.request", sentAt: 1, note: "olá" }] },
      bloqueio: { [BRUNO]: { bloqueado: true, at: 2 } },
      amigosMostrados: { shown: [BRUNO], updatedAt: 3 },
      arquivo: { "!x:localhost": { arquivado: true, at: 4 } },
      lidas: { "!x:localhost": 5 },
      preferencias: { tema: { valor: "escuro", at: 6 } },
    })
    expect(c.blocked).toEqual({ [BRUNO]: 2 })
    expect(c.shownFriends?.[ANA]).toEqual({ shown: [BRUNO], updatedAt: 3 })
    expect(c.arquivo).toEqual({ "!x:localhost": { arquivado: true, at: 4 } })
    expect(c.lidas).toEqual({ "!x:localhost": 5 })
    expect(c.preferencias).toEqual({ tema: { valor: "escuro", at: 6 } })
    // Since vault version 2 (phase S2): the same state ledger, not a separate field.
    expect(c.livroHerdado).toBeUndefined()
    expect(c.estadoDoCanal).toEqual({
      [DM_A_B]: [
        { seq: 3, sender: BRUNO, at: 1, herdado: true, payload: { t: "friend.request", sentAt: 1, note: "olá" } },
      ],
    })
    expect(c.history).toEqual({})
  })
})

describe("os perfis das outras pessoas entre aparelhos", () => {
  const CARLA = "@carla:localhost"

  it("o instantâneo põe os nomes no diretório, e o perfil da pessoa com a mesma versão substitui-os", () => {
    const c = newVaultContents()
    aplicarEstadoDeConta(c, ANA, {
      amizades: {},
      bloqueio: {},
      arquivo: {},
      lidas: {},
      preferencias: {},
      perfis: { [BRUNO]: { displayName: "Bruno", statusText: "a ler", updatedAt: 5 }, [ANA]: { displayName: "Eu", updatedAt: 9 } },
    })
    expect(c.directory[BRUNO]).toEqual({
      at: 5,
      payload: { t: "profile", donations: [], displayName: "Bruno", statusText: "a ler", updatedAt: 5 },
      parcial: true,
    })
    // Our own address does not go in: the profile itself is a different field.
    expect(c.directory[ANA]).toBeUndefined()
    // Bruno's profile, with portrait and the same version: replaces the whole entry.
    upsertDirectory(c, BRUNO, { t: "profile", displayName: "Bruno", updatedAt: 5, avatar: { inline: "data:x" } }, 5)
    expect(c.directory[BRUNO]?.parcial).toBeUndefined()
    expect(c.directory[BRUNO]?.payload["avatar"]).toEqual({ inline: "data:x" })
  })

  it("só uma versão maior entra, e o que ela não diz fica o da anterior", () => {
    const c = newVaultContents()
    upsertDirectory(c, BRUNO, { t: "profile", displayName: "Bruno", statusText: "velho", updatedAt: 5, avatar: { inline: "data:x" }, bio: "b" }, 5)
    // Same version, no portrait: does not replace what came from that person.
    expect(fundirPerfisDeOutros(c, ANA, { [BRUNO]: { displayName: "Outro", updatedAt: 5 } })).toEqual([])
    expect(c.directory[BRUNO]?.payload["displayName"]).toBe("Bruno")
    // An older one does not either.
    expect(fundirPerfisDeOutros(c, ANA, { [BRUNO]: { displayName: "Antigo", updatedAt: 4 } })).toEqual([])
    // A newer one: the new name and status, the old portrait and bio.
    expect(fundirPerfisDeOutros(c, ANA, { [BRUNO]: { displayName: "Bruno Novo", updatedAt: 6 } })).toEqual([BRUNO])
    expect(c.directory[BRUNO]).toEqual({
      at: 6,
      payload: { t: "profile", donations: [], displayName: "Bruno Novo", updatedAt: 6, avatar: { inline: "data:x" }, bio: "b" },
      parcial: true,
    })
  })

  it("aos irmãos vão os de versão dita pela pessoa, os mais recentes primeiro, sem retrato nem o nosso", () => {
    const c = newVaultContents()
    upsertDirectory(c, BRUNO, { t: "profile", displayName: "Bruno", updatedAt: 5, avatar: { inline: "data:x" } }, 5)
    upsertDirectory(c, CARLA, { t: "profile", displayName: "Carla", activity: "ocupado", updatedAt: 8 }, 8)
    upsertDirectory(c, ANA, { t: "profile", displayName: "Ana", updatedAt: 9 }, 9)
    // No `updatedAt`: the directory has the arrival time, which is not a version.
    upsertDirectory(c, "@dora:localhost", { t: "profile", displayName: "Dora" }, 100)
    upsertDirectory(c, "@eva:localhost", { t: "profile", displayName: "", updatedAt: 3 }, 3)
    expect(perfisParaOsIrmaos(c, ANA, 10)).toEqual({
      [CARLA]: { displayName: "Carla", activity: "ocupado", updatedAt: 8 },
      [BRUNO]: { displayName: "Bruno", updatedAt: 5 },
    })
    expect(Object.keys(perfisParaOsIrmaos(c, ANA, 1))).toEqual([CARLA])
  })
})

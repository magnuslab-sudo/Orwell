import { ed25519 } from "@noble/curves/ed25519.js"
import { describe, expect, it } from "vitest"
import { assinarAutoria, formaAssinada, verificarAutoria, type ItemRelatado } from "./autoria.js"
import { Payload } from "./payload.js"
import {
  codificarRetrato,
  EXTENSAO_RETRATO,
  lerRetrato,
  partirRetrato,
  RETRATO_ITENS_MAX,
  RETRATO_MAX_BYTES,
  type CandidatoDoRetrato,
} from "./retrato.js"

/**
 * The snapshot of the Welcome (phase 1 of `docs/planos/estado-cifrado-plano.md`):
 * the priority-based cut, the cap, the schema, and the profile authorship (D1).
 */

const SEMENTE = new Uint8Array(32).map((_, i) => i + 7)
const APARELHO = ed25519.getPublicKey(SEMENTE)
const assinar = (mensagem: Uint8Array): Uint8Array => ed25519.sign(mensagem, SEMENTE)
const CANAL = "!lagar:orwell.pt"
const ANA = "@ana:orwell.pt"

function assinado(bruto: Record<string, unknown>, autor = ANA): Record<string, unknown> {
  const payload = Payload.parse(bruto) as Record<string, unknown>
  return { ...payload, autoria: assinarAutoria({ canal: CANAL, autor, payload, aparelho: APARELHO, assinar }) }
}

const item = (p: Record<string, unknown>, s = 1, a = ANA): ItemRelatado => ({ s, a, p })

describe("a extensão", () => {
  it("é da gama de uso privado do RFC 9420 (§17.3)", () => {
    expect(EXTENSAO_RETRATO).toBe(0xf0f0)
    expect(EXTENSAO_RETRATO).toBeGreaterThanOrEqual(0xf000)
    expect(EXTENSAO_RETRATO).toBeLessThanOrEqual(0xffff)
  })
})

describe("o corte por prioridade", () => {
  it("põe o fundador, os cargos, as atribuições, as categorias, as salas, o letreiro e os perfis por esta ordem", () => {
    const candidatos: CandidatoDoRetrato[] = [
      { item: item(assinado({ t: "profile", displayName: "Ana", updatedAt: 5 })) },
      { item: item(assinado({ t: "space.meta", name: "Lagar", updatedAt: 4 })) },
      { item: item(assinado({ t: "channel.meta", room: "prensa", name: "prensa", updatedAt: 3 })) },
      { item: item(assinado({ t: "channel.category", category: "Adega", updatedAt: 3 })) },
      { item: item(assinado({ t: "role.assign", subject: "@bruno:orwell.pt", roles: ["porteiro"], assignedAt: 2 })) },
      { item: item(assinado({ t: "role.define", role: "porteiro", name: "Porteiro", powers: ["convidar"], definedAt: 2 })) },
      { item: item(assinado({ t: "room.created", name: "lagar", createdAt: 1 })) },
    ]
    const { retrato, cortados } = partirRetrato(CANAL, candidatos, 100)
    expect(cortados).toEqual([])
    expect(retrato.itens.map((i) => i.p["t"])).toEqual([
      "room.created",
      "role.define",
      "role.assign",
      "channel.category",
      "channel.meta",
      "space.meta",
      "profile",
    ])
  })

  it("dos perfis, os mais recentes primeiro", () => {
    const perfis = [3, 9, 1, 7].map((v) => ({ item: item(assinado({ t: "profile", displayName: `p${v}`, updatedAt: v })) }))
    const { retrato } = partirRetrato(CANAL, perfis, 0)
    expect(retrato.itens.map((i) => i.p["updatedAt"])).toEqual([9, 7, 3, 1])
  })

  it("corta pelo fim quando não cabe, e nunca passa do tecto", () => {
    const fundador = { item: item(assinado({ t: "room.created", name: "lagar", createdAt: 1 })) }
    const grande = "x".repeat(900)
    const perfis = Array.from({ length: 50 }, (_, i) => ({
      item: item(assinado({ t: "profile", displayName: `p${i}`, bio: grande, updatedAt: i + 1 }), 1, `@p${i}:orwell.pt`),
    }))
    const tecto = 8 * 1024
    const { retrato, bytes, cortados } = partirRetrato(CANAL, [...perfis, fundador], 0, tecto)
    expect(bytes.length).toBeLessThanOrEqual(tecto)
    expect(retrato.itens[0]!.p["t"]).toBe("room.created")
    expect(cortados.length).toBeGreaterThan(0)
    expect(retrato.itens.length + cortados.length).toBe(51)
    // The newest items remain: the cut items are all older than those that stayed.
    const foram = retrato.itens.filter((i) => i.p["t"] === "profile").map((i) => i.p["updatedAt"] as number)
    const ficaram = cortados.map((i) => i.p["updatedAt"] as number)
    expect(Math.min(...foram)).toBeGreaterThan(Math.max(...ficaram))
  })

  it("um perfil que não cabe inteiro vai na forma leve", () => {
    const retratoGrande = `data:image/png;base64,${"A".repeat(6000)}`
    const inteiro = assinado({
      t: "profile",
      displayName: "Ana",
      updatedAt: 3,
      avatar: { url: "", inline: retratoGrande, kind: "image", name: "avatar", mediaType: "image/*", byteLength: retratoGrande.length },
    })
    const leve = { ...inteiro, avatar: { evicted: true, name: "avatar", mediaType: "image/*" } }
    const { retrato, aliviados } = partirRetrato(CANAL, [{ item: item(inteiro), leve: item(leve) }], 0, 2048)
    expect(aliviados).toBe(1)
    expect(retrato.itens).toHaveLength(1)
    expect((retrato.itens[0]!.p["avatar"] as { evicted?: boolean }).evicted).toBe(true)
  })

  it("não passa do tecto de itens", () => {
    const muitos = Array.from({ length: RETRATO_ITENS_MAX + 5 }, (_, i) => ({ item: item({ t: "channel.meta", room: `s${i}` }) }))
    const { retrato, cortados } = partirRetrato(CANAL, muitos, 0, Number.MAX_SAFE_INTEGER)
    expect(retrato.itens).toHaveLength(RETRATO_ITENS_MAX)
    expect(cortados).toHaveLength(5)
  })
})

describe("a leitura", () => {
  it("ida e volta", () => {
    const { bytes, retrato } = partirRetrato(CANAL, [{ item: item(assinado({ t: "room.created", name: "lagar", createdAt: 1 })) }], 42)
    expect(lerRetrato(bytes, CANAL)).toEqual(retrato)
  })

  it("recusa um retrato de outro canal, torto, fora do esquema, ou acima do tecto", () => {
    const { bytes } = partirRetrato(CANAL, [], 1)
    expect(lerRetrato(bytes, "!outro:orwell.pt")).toBeNull()
    expect(lerRetrato(new TextEncoder().encode("{não é json"), CANAL)).toBeNull()
    expect(lerRetrato(new Uint8Array([0xff, 0xfe, 0x00]), CANAL)).toBeNull()
    expect(lerRetrato(new TextEncoder().encode(JSON.stringify({ v: 2, canal: CANAL, itens: [], geradoEm: 1 })), CANAL)).toBeNull()
    expect(lerRetrato(new TextEncoder().encode(JSON.stringify({ v: 1, canal: CANAL, itens: [{ s: 1 }], geradoEm: 1 })), CANAL)).toBeNull()
    const enorme = codificarRetrato({ v: 1, canal: CANAL, itens: [item({ t: "profile", bio: "x".repeat(RETRATO_MAX_BYTES) })], geradoEm: 1 })
    expect(lerRetrato(enorme, CANAL)).toBeNull()
  })
})

describe("a autoria do perfil (D1)", () => {
  const retratoDoPerfil = "data:image/png;base64,iVBORw0KGgo="
  const comRetrato = (): Record<string, unknown> =>
    assinado({
      t: "profile",
      displayName: "Ana",
      updatedAt: 9,
      avatar: { url: "", inline: retratoDoPerfil, kind: "image", name: "avatar", mediaType: "image/*", byteLength: 4 },
    })

  it("o retrato entra na forma assinada só pelo nome e pelo tipo, e o resumo vai em m", () => {
    const perfil = comRetrato()
    expect(formaAssinada(perfil)["avatar"]).toEqual({ name: "avatar", mediaType: "image/*" })
    expect((perfil["autoria"] as { m?: string[] }).m).toHaveLength(1)
    expect(verificarAutoria(CANAL, ANA, perfil).ok).toBe(true)
  })

  it("sem os bytes do retrato a assinatura continua a verificar; com outro nome, não", () => {
    const perfil = comRetrato()
    const semBytes = { ...perfil, avatar: { evicted: true, name: "avatar", mediaType: "image/*" } }
    expect(verificarAutoria(CANAL, ANA, semBytes).ok).toBe(true)
    expect(verificarAutoria(CANAL, ANA, { ...perfil, displayName: "Carla" }).ok).toBe(false)
    expect(verificarAutoria("!outro:orwell.pt", ANA, perfil).ok).toBe(false)
    expect(verificarAutoria(CANAL, "@carla:orwell.pt", perfil).ok).toBe(false)
  })

  it("um campo chamado avatar noutro tipo não muda a forma dele", () => {
    const sala = { t: "channel.meta", room: "prensa", avatar: { name: "x", mediaType: "y", inline: "z" } }
    expect(formaAssinada(sala)["avatar"]).toEqual(sala.avatar)
  })
})

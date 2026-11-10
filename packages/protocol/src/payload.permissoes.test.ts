import { describe, expect, it } from "vitest"
import { z } from "zod"
import { formaAssinada } from "./autoria.js"
import { decodePayload, encodePayload, IRREVERSIBLE_POWERS, Payload, POWERS } from "./payload.js"
import { PODERES_ANTIGOS } from "./permissoes.js"

/**
 * The format of the permissions model (1.2, section 4.2 of the parity plan): new
 * names at the end of `POWERS`, the `rank` in `role.define`, and `perms` in
 * `channel.meta` and `channel.category`. Pins the round trip, the downgrade to a
 * 1.1.0 client, and a malformed value not taking the record down with it.
 */

const bytes = (valor: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(valor))

/** The schema branch as 1.1.0 has it: this one, without the new fields. */
function ramoDa110(t: string, campos: string[]): z.ZodObject {
  const ramo = Payload.options.find((opcao) => (opcao.shape as { t: z.ZodLiteral<string> }).t.value === t) as unknown as z.ZodObject
  return ramo.omit(Object.fromEntries(campos.map((campo) => [campo, true])) as never)
}

/** The list of powers from 1.1.0, word for word. */
const POWERS_DA_110 = ["expulsar", "convidar", "renomear", "mover", "eliminar", "fixar", "atender", "moderar"]

const cargo = {
  t: "role.define",
  role: "guia",
  name: "Guia",
  powers: ["mover", "gerircargos", "gerirsalas"],
  position: 2,
  rank: 3,
  removed: false,
  definedAt: 1_762_000_000_000,
} as const

const sala = {
  t: "channel.meta",
  room: "arena",
  name: "Arena",
  category: "Jogos",
  kind: "voice",
  position: 1,
  closed: false,
  removed: false,
  perms: [
    { role: "@todos", allow: [], deny: ["ligar"] },
    { role: "guia", allow: ["mover"], deny: [] },
  ],
  updatedAt: 1_762_000_000_000,
} as const

const categoria = {
  t: "channel.category",
  category: "Jogos",
  position: 0,
  roles: [],
  perms: [{ role: "guia", allow: [], deny: ["mover"] }],
  removed: false,
  updatedAt: 1_762_000_000_000,
} as const

describe("os nomes das permissões", () => {
  it("os oito antigos ficam à cabeça, pela mesma ordem, e os novos vão ao fim", () => {
    expect(POWERS.slice(0, 8)).toEqual(POWERS_DA_110)
    expect([...PODERES_ANTIGOS]).toEqual(POWERS_DA_110)
    expect(POWERS.length).toBeLessThanOrEqual(32)
    expect(new Set(POWERS).size).toBe(POWERS.length)
  })

  it("cada nome novo passa no formato estreito de `powers` (o de qualquer versão)", () => {
    for (const poder of POWERS) expect(poder).toMatch(/^[a-z][a-z0-9]{1,23}$/)
  })

  it("`banir` não se desfaz; `expulsar` e `eliminar` continuam", () => {
    expect(IRREVERSIBLE_POWERS).toEqual(["expulsar", "eliminar", "banir"])
  })
})

describe("role.define com rank e poderes novos", () => {
  it("vai e volta pelo fio", () => {
    expect(decodePayload(encodePayload(cargo as unknown as Payload))).toMatchObject({ rank: 3, powers: ["mover", "gerircargos", "gerirsalas"] })
  })

  it("um rank mal formado cai para ausente e o cargo chega inteiro", () => {
    for (const mau of [-1, 2.5, "3", null, 10_000_001]) {
      const lido = decodePayload(bytes({ ...cargo, rank: mau })) as Record<string, unknown>
      expect(lido).toMatchObject({ t: "role.define", role: "guia", name: "Guia" })
      expect(lido.rank).toBeUndefined()
    }
  })

  it("uma 1.1.0 lê o cargo novo sem reprovar, e os poderes que não conhece caem na leitura", () => {
    const antigo = ramoDa110("role.define", ["rank"])
    const lido = antigo.parse(cargo) as { powers: string[] } & Record<string, unknown>
    expect(lido).not.toHaveProperty("rank")
    // What the `rolesOf` of that version does: filters by its list.
    expect(POWERS_DA_110.filter((poder) => lido.powers.includes(poder))).toEqual(["mover"])
  })

  it("um cargo sem os campos novos assina-se igual ao de antes (a forma não muda)", () => {
    const { rank: _rank, ...semRank } = cargo
    const lido = decodePayload(bytes({ ...semRank, powers: ["mover"] })) as Record<string, unknown>
    expect(Object.keys(formaAssinada(lido))).not.toContain("rank")
  })
})

describe("perms em channel.meta e channel.category", () => {
  it("vai e volta pelo fio, nas duas formas", () => {
    expect(decodePayload(encodePayload(sala as unknown as Payload))).toMatchObject({ perms: sala.perms })
    expect(decodePayload(encodePayload(categoria as unknown as Payload))).toMatchObject({ perms: categoria.perms })
  })

  it("ausente fica ausente: não é lista vazia, e nada a escreve por omissão", () => {
    const { perms: _p, ...semPerms } = sala
    expect(decodePayload(bytes(semPerms)) as Record<string, unknown>).not.toHaveProperty("perms")
    const { perms: _q, ...semPermsC } = categoria
    expect(decodePayload(bytes(semPermsC)) as Record<string, unknown>).not.toHaveProperty("perms")
  })

  it("um valor mal formado cai para ausente, e a sala (com a lápide) chega inteira", () => {
    const maus = [
      "sim",
      [{ role: "", allow: [] }],
      [{ role: "guia", allow: ["Mover!"] }],
      Array.from({ length: 17 }, (_, i) => ({ role: `c${i}`, allow: [], deny: [] })),
      null,
    ]
    for (const mau of maus) {
      const lido = decodePayload(bytes({ ...sala, removed: true, perms: mau })) as Record<string, unknown>
      expect(lido).toMatchObject({ t: "channel.meta", name: "Arena", removed: true })
      expect(lido.perms).toBeUndefined()
    }
  })

  it("um nome de permissão futuro não reprova a sala", () => {
    const lido = decodePayload(bytes({ ...sala, perms: [{ role: "guia", allow: ["teletransporte"], deny: [] }] })) as Record<string, unknown>
    expect(lido.perms).toEqual([{ role: "guia", allow: ["teletransporte"], deny: [] }])
  })

  it("uma 1.1.0 lê a sala e a categoria novas como as de sempre", () => {
    const meta = ramoDa110("channel.meta", ["perms"]).parse(sala) as Record<string, unknown>
    expect(meta).toMatchObject({ t: "channel.meta", room: "arena", name: "Arena", kind: "voice" })
    expect(meta).not.toHaveProperty("perms")
    const cat = ramoDa110("channel.category", ["perms"]).parse(categoria) as Record<string, unknown>
    expect(cat).toMatchObject({ t: "channel.category", category: "Jogos" })
    expect(cat).not.toHaveProperty("perms")
  })

  it("e o que uma 1.1.0 escreve (sem os campos) passa nesta versão", () => {
    expect(() => decodePayload(bytes(ramoDa110("channel.meta", ["perms"]).parse(sala)))).not.toThrow()
    expect(() => decodePayload(bytes(ramoDa110("role.define", ["rank"]).parse(cargo)))).not.toThrow()
  })
})

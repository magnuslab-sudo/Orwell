import { describe, expect, it } from "vitest"
import { z } from "zod"
import { ed25519 } from "@noble/curves/ed25519.js"
import { assinarAutoria, formaAssinada, verificarAutoria } from "./autoria.js"
import { decodePayload, encodePayload, MINUTOS_AFK, MINUTOS_AFK_POR_OMISSAO, Payload } from "./payload.js"

/**
 * The AFK room (2/11/2026): an optional field in `channel.meta`, never
 * a third `kind`. These tests pin down the three things that make it safe:
 * the round-trip, the downgrade to a client that does not know the field, and a
 * malformed value not taking the whole room with it.
 */

const salaDeVoz = {
  t: "channel.meta",
  room: "contio-dormir",
  name: "AFK",
  category: "",
  kind: "voice",
  position: 3,
  closed: false,
  removed: false,
  updatedAt: 1_762_000_000_000,
} as const

const bytes = (valor: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(valor))

/**
 * The schema of `channel.meta` as version 1.0.6 has it.
 *
 * Version 1.0.6 is exactly this branch WITHOUT the `afk` field: it is the only
 * difference this feature made to the protocol (see the diff of the `sala-afk` branch).
 * Removing it with `omit` rebuilds the old schema without copying a thousand lines by hand.
 */
function esquemaDa106(): z.ZodObject {
  const ramo = Payload.options.find(
    (opcao) => (opcao.shape as { t: z.ZodLiteral<string> }).t.value === "channel.meta",
  ) as unknown as z.ZodObject
  return ramo.omit({ afk: true } as never)
}

describe("channel.meta.afk", () => {
  it("vai e volta pelo fio", () => {
    const lido = decodePayload(encodePayload({ ...salaDeVoz, afk: { minutos: 15 } } as Payload))
    expect(lido).toMatchObject({ t: "channel.meta", kind: "voice", afk: { minutos: 15 } })
  })

  it("ausente é «não é a sala AFK», sem valor por omissão escrito", () => {
    const lido = decodePayload(bytes(salaDeVoz)) as Record<string, unknown>
    expect(lido).not.toHaveProperty("afk")
  })

  it("um valor mal formado cai para ausente e a sala chega inteira (a lápide também)", () => {
    for (const mau of [{ minutos: 0 }, { minutos: 2.5 }, { minutos: 99_999 }, "sim", { horas: 1 }, null]) {
      const lido = decodePayload(bytes({ ...salaDeVoz, removed: true, afk: mau })) as Record<string, unknown>
      expect(lido).toMatchObject({ t: "channel.meta", name: "AFK", removed: true })
      expect(lido.afk).toBeUndefined()
    }
  })

  it("um cliente 1.0.6 lê a sala AFK como uma sala de voz normal", () => {
    const antigo = esquemaDa106()
    expect(Object.keys(antigo.shape)).not.toContain("afk")
    const lido = antigo.parse({ ...salaDeVoz, afk: { minutos: 30 } }) as Record<string, unknown>
    expect(lido).toMatchObject({ t: "channel.meta", room: "contio-dormir", kind: "voice", name: "AFK" })
    expect(lido).not.toHaveProperty("afk")
  })

  it("e um payload escrito pela 1.0.6 (sem o campo) passa nesta versão", () => {
    const daAntiga = esquemaDa106().parse(salaDeVoz)
    expect(() => decodePayload(bytes(daAntiga))).not.toThrow()
  })

  it("os tempos oferecidos: 5, 15, 30 e 60 minutos, 15 por omissão", () => {
    expect([...MINUTOS_AFK]).toEqual([5, 15, 30, 60])
    expect(MINUTOS_AFK_POR_OMISSAO).toBe(15)
    for (const minutos of MINUTOS_AFK) {
      expect(decodePayload(encodePayload({ ...salaDeVoz, afk: { minutos } } as Payload))).toMatchObject({ afk: { minutos } })
    }
  })
})

/**
 * Coexistence of the signed form with 1.0.6 (see `autoria.forma.test.ts`).
 *
 * `afk` is optional and has no default value: a room without it signs the same way in
 * both versions. An AFK room checks here, and does not check in a version that
 * does not know it: that is the boundary stated, and it only matters in a report (live, authorship is not read).
 */
describe("a forma assinada de uma sala, com e sem `afk`", () => {
  const semente = new Uint8Array(32).fill(7)
  const assinar = (payload: Record<string, unknown>): Record<string, unknown> => ({
    ...payload,
    autoria: assinarAutoria({
      canal: "!c:orwell.pt",
      autor: "@ana:orwell.pt",
      payload,
      aparelho: ed25519.getPublicKey(semente),
      assinar: (m) => ed25519.sign(m, semente),
    }),
  })

  it("uma sala sem a marca tem a mesma forma assinada aqui e na 1.0.6", () => {
    const aqui = Payload.parse(salaDeVoz) as Record<string, unknown>
    const na106 = esquemaDa106().parse(salaDeVoz) as Record<string, unknown>
    expect(JSON.stringify(formaAssinada(aqui))).toBe(JSON.stringify(formaAssinada(na106)))
    expect(verificarAutoria("!c:orwell.pt", "@ana:orwell.pt", assinar(aqui)).ok).toBe(true)
  })

  it("com a marca, verifica aqui; despida (como a 1.0.6 a lê), não verifica", () => {
    const normal = Payload.parse({ ...salaDeVoz, afk: { minutos: 15 } }) as Record<string, unknown>
    const assinado = assinar(normal)
    expect(verificarAutoria("!c:orwell.pt", "@ana:orwell.pt", assinado).ok).toBe(true)
    const { afk: _despido, ...comoA106 } = assinado
    expect(verificarAutoria("!c:orwell.pt", "@ana:orwell.pt", comoA106).ok).toBe(false)
  })
})

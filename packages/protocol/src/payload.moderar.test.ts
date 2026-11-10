import { ed25519 } from "@noble/curves/ed25519.js"
import { describe, expect, it } from "vitest"
import { assinarAutoria, verificarAutoria } from "./autoria.js"
import { CRYPTOGRAPHIC_POWERS, decodePayload, encodePayload, IRREVERSIBLE_POWERS, Payload, POWERS } from "./payload.js"

/**
 * The "moderate" power (phase 3 of 0.9).
 *
 * Delete other people's messages, delete closed tickets and change nicknames.
 * A convention, like `fixar`: the cipher does not enforce it, and it is not irreversible.
 */
describe("moderar é uma responsabilidade como as outras", () => {
  it("está na lista, no fim dos oito antigos (os do modelo de 1.2 vêm depois)", () => {
    expect(POWERS[7]).toBe("moderar")
  })

  it("não é da cifra nem é sem volta", () => {
    expect(CRYPTOGRAPHIC_POWERS).not.toContain("moderar")
    expect(IRREVERSIBLE_POWERS).not.toContain("moderar")
  })

  it("um cargo com moderar atravessa a codificação", () => {
    const papel = {
      t: "role.define",
      role: "admin-do-fundador",
      name: "Administração",
      powers: ["moderar", "fixar"],
      position: 0,
      removed: false,
      definedAt: 1,
    } as unknown as Payload
    const lido = decodePayload(encodePayload(papel)) as { powers: string[] }
    expect(lido.powers).toEqual(["moderar", "fixar"])
  })
})

describe("a lápide do ticket é um campo da marca, e não um `t` novo", () => {
  it("atravessa a codificação, e o corpo diz o que aconteceu por extenso", () => {
    const lapide = {
      t: "message",
      room: "forum",
      id: "m-lapide-1",
      sentAt: 5,
      body: "Eliminou o ticket «porta».",
      ticket: { id: "t-porta-1", removed: true, at: 5 },
    } as unknown as Payload
    const lido = decodePayload(encodePayload(lapide)) as { body: string; ticket: { removed?: boolean } }
    expect(lido.ticket.removed).toBe(true)
    expect(lido.body).toBe("Eliminou o ticket «porta».")
  })
})

/**
 * Coexistence of the signed form with 0.9.3 (see `autoria.forma.test.ts`).
 *
 * `apelido` and `ticket.removed` are optional and have no default value. A
 * message without them signs the same in both versions. One with them verifies
 * here, and does not verify in a version that doesn't know them: that is the
 * stated limit, and it only matters in a relayed copy (live, authorship is not read).
 */
describe("a forma assinada de uma mensagem, com e sem os campos da fase 3", () => {
  const semente = new Uint8Array(32).fill(9)
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

  it("uma mensagem sem eles não ganha chave nenhuma ao normalizar", () => {
    const normal = Payload.parse({ t: "message", id: "m-normal-1", sentAt: 1, body: "olá" }) as Record<string, unknown>
    expect("apelido" in normal && normal["apelido"] !== undefined).toBe(false)
    expect(verificarAutoria("!c:orwell.pt", "@ana:orwell.pt", assinar(normal)).ok).toBe(true)
  })

  it("com o apelido, verifica aqui; despido (como a 0.9.3 o lê), não verifica", () => {
    const normal = Payload.parse({
      t: "message",
      id: "m-apelido-1",
      sentAt: 1,
      body: "Mudou o apelido de Ana para «Aninhas».",
      apelido: { subject: "@ana:orwell.pt", nick: "Aninhas", at: 1 },
    }) as Record<string, unknown>
    const assinado = assinar(normal)
    expect(verificarAutoria("!c:orwell.pt", "@ana:orwell.pt", assinado).ok).toBe(true)
    const { apelido: _despido, ...comoA093 } = assinado
    expect(verificarAutoria("!c:orwell.pt", "@ana:orwell.pt", comoA093).ok).toBe(false)
  })
})

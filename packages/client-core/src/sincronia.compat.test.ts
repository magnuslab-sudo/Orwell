import { decodePayload, encodePayload } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { CAPACIDADE_PEDE_PERFIS, CAPACIDADE_REENVIO } from "./session.js"

/**
 * Sync phase S1 and a 0.5.7 client (§4.6 of the plan).
 *
 * No new field on the wire: the resend announcement and profile request go in
 * the `capacidades` field of `typing`, which already exists from phase 5. A
 * 0.5.7 reads `typing` with its schema, which lacks the field and is not
 * `strict()`: discards it and the payload passes. A payload that passes does
 * not count as deafness (`DEAF_FAILURES`), and an expired `typing` does not
 * show.
 */
describe("o sinal de aparelho de S1 num cliente 0.5.7", () => {
  /** The `typing` as 0.5.7 reads it. Copied from that version's schema (see `estado.test.ts` in the protocol). */
  const TypingAntigo = z.object({ t: z.literal("typing"), room: z.string().max(64).optional(), until: z.number().int().nonnegative() })

  it("o anúncio do reenvio e o pedido de perfis passam no esquema novo e no antigo", () => {
    const sinal = {
      t: "typing" as const,
      until: 0,
      capacidades: ["estado-da-conta", "chave-de-conta", CAPACIDADE_REENVIO, CAPACIDADE_PEDE_PERFIS],
    }
    expect(decodePayload(encodePayload(sinal))).toEqual(sinal)
    const lido = TypingAntigo.safeParse(JSON.parse(new TextDecoder().decode(encodePayload(sinal))))
    expect(lido.success).toBe(true)
    expect(lido.data).toEqual({ t: "typing", until: 0 })
  })

  it("as capacidades novas cabem no tecto do campo (16 nomes, 32 caracteres cada)", () => {
    for (const nome of [CAPACIDADE_REENVIO, CAPACIDADE_PEDE_PERFIS]) expect(nome.length).toBeLessThanOrEqual(32)
  })
})

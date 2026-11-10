import { sha256 } from "@noble/hashes/sha2.js"
import { describe, expect, it } from "vitest"
import { fromBase64, toBase64 } from "./canonical.js"
import { decodePayload, encodePayload, type Payload } from "./payload.js"

/**
 * The secret of the wall on the profile (1.0 "Arca"). The profile is the payload
 * that costs most to lose: rejected, it takes the name, the portrait and ways to
 * support with it, and rejected profiles in a row declare the channel deaf. So
 * what is proved here is mainly what the new field CANNOT do to the profile.
 */

const SEGREDO = toBase64(sha256(Uint8Array.of(1, 2, 3)))

function perfil(extra: Record<string, unknown> = {}): Payload {
  return { t: "profile", displayName: "Ana", donations: [], updatedAt: 1_700_000_000_000, ...extra } as Payload
}

describe("o segredo do mural no perfil", () => {
  it("viaja inteiro: 43 caracteres de ida, 32 bytes de volta", () => {
    expect(SEGREDO).toHaveLength(43)
    const recebido = decodePayload(encodePayload(perfil({ mural: SEGREDO })))
    const mural = (recebido as { mural?: string }).mural
    expect(mural).toBe(SEGREDO)
    expect(fromBase64(mural as string)).toHaveLength(32)
  })

  it("um perfil sem mural escreve os mesmos bytes que escrevia", () => {
    // Optional field with no value by default: whoever lacks it doesn't get the key,
    // not even as `undefined`, and a 0.9 profile decrypts the same.
    const bytes = encodePayload(perfil())
    expect(new TextDecoder().decode(bytes)).toBe(
      JSON.stringify({ t: "profile", displayName: "Ana", donations: [], updatedAt: 1_700_000_000_000 }),
    )
    expect("mural" in decodePayload(bytes)).toBe(false)
  })

  it("um segredo torto perde-se sozinho, e o perfil fica", () => {
    for (const torto of ["curto", `${SEGREDO}A`, "+".repeat(43), 42]) {
      const bruto = new TextEncoder().encode(JSON.stringify({ ...perfil(), mural: torto }))
      const recebido = decodePayload(bruto)
      expect(recebido).toMatchObject({ t: "profile", displayName: "Ana" })
      expect((recebido as { mural?: string }).mural).toBeUndefined()
    }
  })
})

import { describe, expect, it } from "vitest"
import { ALFABETO_DO_CODIGO_CURTO, CODIGO_CURTO_CARACTERES, CodigoCurto, eCodigoCurto, normalizarCodigoCurto } from "./ligacao-curta.js"
import { ClientFrame, ServerFrame } from "./wire.js"

describe("o código curto das ligações de convite", () => {
  it("o alfabeto tem 31 símbolos, sem repetidos e sem os que se confundem", () => {
    expect(ALFABETO_DO_CODIGO_CURTO).toHaveLength(31)
    expect(new Set(ALFABETO_DO_CODIGO_CURTO).size).toBe(31)
    for (const ambiguo of ["0", "o", "O", "1", "l", "I", "i"]) expect(ALFABETO_DO_CODIGO_CURTO).not.toContain(ambiguo)
    expect(CODIGO_CURTO_CARACTERES).toBe(8)
  })

  it("a forma do fio é oito minúsculos do alfabeto, e mais nada", () => {
    expect(eCodigoCurto("ab2cd3ef")).toBe(true)
    for (const torto of ["", "ab2cd3e", "ab2cd3efg", "AB2CD3EF", "ab2cd3e0", "ab2cd3el", "ab2c d3e"]) {
      expect(eCodigoCurto(torto), torto).toBe(false)
      expect(CodigoCurto.safeParse(torto).success, torto).toBe(false)
    }
  })

  it("o que uma pessoa escreve normaliza-se sem inventar letras", () => {
    expect(normalizarCodigoCurto("AB2C-D3EF")).toBe("ab2cd3ef")
    expect(normalizarCodigoCurto(" ab2c d3ef\n")).toBe("ab2cd3ef")
    // A zero doesn't read as an "o": the alphabet has neither.
    expect(normalizarCodigoCurto("ab2cd3e0")).toBeNull()
  })

  it("as tramas novas lêem-se, e um invite.created sem código continua a ler-se", () => {
    expect(ClientFrame.parse({ t: "invite.resolve", codigo: "ab2cd3ef" })).toEqual({ t: "invite.resolve", codigo: "ab2cd3ef" })
    expect(ClientFrame.safeParse({ t: "invite.resolve", codigo: "0000OOOO" }).success).toBe(false)
    expect(ServerFrame.parse({ t: "invite.created", channel: "!a:x.pt", codeHash: "aa" })).toEqual({
      t: "invite.created",
      channel: "!a:x.pt",
      codeHash: "aa",
    })
    expect(
      ServerFrame.parse({ t: "invite.unresolved", codigo: "ab2cd3ef", reason: "rate-limited" }),
    ).toEqual({ t: "invite.unresolved", codigo: "ab2cd3ef", reason: "rate-limited" })
    // The hello with and without version.
    expect(ClientFrame.safeParse({ t: "hello", version: 1, versao: "1.0.0" }).success).toBe(true)
    expect(ClientFrame.safeParse({ t: "hello", version: 1 }).success).toBe(true)
  })
})

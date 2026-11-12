import { describe, expect, it } from "vitest"
import {
  CODIGO_DO_CONVITE_CARACTERES,
  SHORT_INVITE_PATH,
  eCodigoDoConvite,
  formatShortInviteLink,
  novoCodigoDoConvite,
  parseInviteLink,
  parseShortInviteLink,
} from "./session.js"

/**
 * The short invite link (1.0 "Arca", slice 5b-2):
 * `https://<servidor>/c#<8 do código curto>.<16 do código do convite>`.
 *
 * Here only the form: the new code, write and read the link. The server call
 * (`invite.resolve`) and redemption by proof are in
 * `session.convite-curto.rede.test.ts`, with a real server.
 */

const CURTO = "ab23cd45"
const CODIGO = "0123456789abcdef"

describe("o código do convite", () => {
  it("tem 16 caracteres do base32 de Crockford, minúsculos (80 bits)", () => {
    const vistos = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const codigo = novoCodigoDoConvite()
      expect(codigo).toHaveLength(CODIGO_DO_CONVITE_CARACTERES)
      expect(eCodigoDoConvite(codigo)).toBe(true)
      expect(codigo).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{16}$/)
      vistos.add(codigo)
    }
    // Five hundred draws of 80 bits: a collision here would mean a broken generator.
    expect(vistos.size).toBe(500)
  })

  it("usa os 32 símbolos, e nenhum que se confunda (i, l, o, u)", () => {
    const simbolos = new Set<string>()
    for (let i = 0; i < 400; i++) for (const c of novoCodigoDoConvite()) simbolos.add(c)
    expect(simbolos.size).toBe(32)
    for (const confuso of ["i", "l", "o", "u"]) expect(simbolos.has(confuso)).toBe(false)
  })

  it("recusa o código de outra forma", () => {
    for (const mau of ["", "0123456789abcde", "0123456789abcdefg", "0123456789abcdeI", "0123456789abcdel", "0123456789ABCDEF"]) {
      expect(eCodigoDoConvite(mau)).toBe(false)
    }
  })
})

describe("a ligação curta de convite", () => {
  it("escreve-se em /c, com https fora do loopback", () => {
    expect(formatShortInviteLink("orwell.pt", CURTO, CODIGO)).toBe(`https://orwell.pt/c#${CURTO}.${CODIGO}`)
    expect(formatShortInviteLink("localhost:8448", CURTO, CODIGO)).toBe(`http://localhost:8448/c#${CURTO}.${CODIGO}`)
  })

  it("lê-se em /c e em /app/c (depois do redireccionamento do Caddy)", () => {
    const esperado = { server: "orwell.pt", codigoCurto: CURTO, code: CODIGO }
    expect(parseShortInviteLink(`https://orwell.pt/c#${CURTO}.${CODIGO}`)).toEqual(esperado)
    expect(parseShortInviteLink(`https://orwell.pt${SHORT_INVITE_PATH}#${CURTO}.${CODIGO}`)).toEqual(esperado)
    expect(parseShortInviteLink(`  https://orwell.pt/c#${CURTO}.${CODIGO}\n`)).toEqual(esperado)
    expect(parseShortInviteLink(`http://localhost:8448/c#${CURTO}.${CODIGO}`)).toEqual({ ...esperado, server: "localhost:8448" })
  })

  it("ida e volta", () => {
    for (let i = 0; i < 50; i++) {
      const codigo = novoCodigoDoConvite()
      expect(parseShortInviteLink(formatShortInviteLink("orwell.pt", CURTO, codigo))?.code).toBe(codigo)
    }
  })

  it("aceita maiúsculas de quem a escreveu à mão, e lê-as em minúsculas", () => {
    expect(parseShortInviteLink(`https://Orwell.PT/c#AB23CD45.0123456789ABCDEF`)).toEqual({
      server: "orwell.pt",
      codigoCurto: CURTO,
      code: CODIGO,
    })
  })

  it("recusa o que não é exactamente a forma", () => {
    const maus = [
      `http://orwell.pt/c#${CURTO}.${CODIGO}`, // http outside loopback
      `https://orwell.pt/c?x=1#${CURTO}.${CODIGO}`, // query
      `https://ana@orwell.pt/c#${CURTO}.${CODIGO}`, // userinfo
      `https://orwell.pt/c/#${CURTO}.${CODIGO}`, // different path
      `https://orwell.pt/C#${CURTO}.${CODIGO}`, // path with uppercase
      `https://orwell.pt/app/convite#${CURTO}.${CODIGO}`, // the long link path
      `https://orwell.pt/c#${CURTO}`, // just the short code: not enough for the proof
      `https://orwell.pt/c#${CURTO}.`, // no code
      `https://orwell.pt/c#.${CODIGO}`, // no short code
      `https://orwell.pt/c#${CURTO}.${CODIGO}.x`, // three parts
      `https://orwell.pt/c#${CURTO}.${CODIGO.slice(1)}`, // code with 15
      `https://orwell.pt/c#ab23cd4.${CODIGO}`, // short code with 7
      `https://orwell.pt/c#ab23cd40.${CODIGO}`, // 0 outside the short alphabet
      `https://orwell.pt/c#${CURTO}.0123456789abcdel`, // l outside the code alphabet
      `https://orwell.pt/c#${CURTO} ${CODIGO}`, // space
      `ftp://orwell.pt/c#${CURTO}.${CODIGO}`,
      `https://orwell.pt/c#${CURTO}.${CODIGO}${"a".repeat(3000)}`, // above the cap
      "",
    ]
    for (const mau of maus) expect(parseShortInviteLink(mau)).toBeNull()
  })

  it("a longa não é uma curta, e a curta não é uma longa", () => {
    expect(parseShortInviteLink("https://orwell.pt/app/convite#!sala%3Aorwell.pt/abc")).toBeNull()
    expect(parseInviteLink(`https://orwell.pt/c#${CURTO}.${CODIGO}`)).toBeNull()
    expect(parseInviteLink(`https://orwell.pt/app/c#${CURTO}.${CODIGO}`)).toBeNull()
  })
})

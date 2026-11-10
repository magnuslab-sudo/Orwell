import { ed25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { describe, expect, it } from "vitest"
import { fromBase64, toBase64 } from "./canonical.js"
import { decodeName } from "./names.js"
import {
  PAIR_ID_CHARS,
  PAIR_ID_PATTERN,
  PAIR_PAYLOAD_MAX_CHARS,
  PAIR_SECRET_BYTES,
  chaveDeEmparelhamento,
  cifrarPairPayload,
  decifrarPairPayload,
  gerarSegredoDeEmparelhamento,
  pairIdDe,
  palavrasDoSas,
  transcricaoDoSas,
} from "./pair.js"
import { parseClientFrame, parseServerFrame } from "./wire.js"

/**
 * The pairing encryption, and what it promises.
 *
 * Three promises, each with its own test: **wrong secret does not decrypt**
 * (the server, which only has the `pairId`, opens nothing); **the SAS changes when
 * either of the two keys changes** (a third party in place of the phone shows
 * different words on the computer); and **the vectors are fixed** (two devices
 * of different versions reach the same `pairId`, the same key and the same
 * words, or they never pair).
 */

const SEGREDO = sha256(new TextEncoder().encode("vector-de-teste-do-emparelhamento"))
const PAIR_ID = pairIdDe(SEGREDO)

function chaveDeAparelho(semente: number): Uint8Array {
  return ed25519.getPublicKey(sha256(Uint8Array.from([semente])))
}

describe("pairId", () => {
  it("é o resumo do segredo em base64url, truncado a 22 caracteres", () => {
    expect(PAIR_ID).toHaveLength(PAIR_ID_CHARS)
    expect(PAIR_ID).toMatch(PAIR_ID_PATTERN)
    expect(PAIR_ID).toBe(toBase64(sha256(SEGREDO)).slice(0, 22))
  })

  it("recusa um segredo com o tamanho errado", () => {
    expect(() => pairIdDe(new Uint8Array(31))).toThrow()
    expect(() => chaveDeEmparelhamento(new Uint8Array(33), PAIR_ID)).toThrow()
  })

  it("um segredo novo tem 32 bytes e nunca se repete", () => {
    const a = gerarSegredoDeEmparelhamento()
    const b = gerarSegredoDeEmparelhamento()
    expect(a).toHaveLength(PAIR_SECRET_BYTES)
    expect(toBase64(a)).not.toBe(toBase64(b))
  })
})

describe("a chave da caixa", () => {
  it("é determinística nos dois lados, e presa ao pairId", () => {
    const a = chaveDeEmparelhamento(SEGREDO, PAIR_ID)
    const b = chaveDeEmparelhamento(SEGREDO, PAIR_ID)
    expect(toBase64(a)).toBe(toBase64(b))
    expect(a).toHaveLength(32)
    const outroId = pairIdDe(sha256(SEGREDO))
    expect(toBase64(chaveDeEmparelhamento(SEGREDO, outroId))).not.toBe(toBase64(a))
  })
})

describe("cifra da caixa", () => {
  const chave = chaveDeEmparelhamento(SEGREDO, PAIR_ID)

  it("faz a ida e volta de cada payload", () => {
    const deviceKey = toBase64(chaveDeAparelho(1))
    for (const payload of [
      { t: "chave-do-aparelho", deviceKey },
      { t: "certificado", address: "@abcd-efgh:orwell.pt", accountKey: deviceKey, deviceCert: toBase64(new Uint8Array(64)) },
      { t: "pronto" },
      { t: "recusado" },
    ] as const) {
      const wire = cifrarPairPayload(chave, PAIR_ID, payload)
      expect(typeof wire).toBe("string")
      expect(decifrarPairPayload(chave, PAIR_ID, wire)).toEqual(payload)
    }
  })

  it("dois cifrados do mesmo payload são diferentes: o nonce é aleatório", () => {
    const a = cifrarPairPayload(chave, PAIR_ID, { t: "pronto" })
    const b = cifrarPairPayload(chave, PAIR_ID, { t: "pronto" })
    expect(a).not.toBe(b)
    expect(fromBase64(a).length).toBe(24 + JSON.stringify({ t: "pronto" }).length + 16)
  })

  it("o segredo errado não decifra: o servidor, com o pairId só, não abre nada", () => {
    const wire = cifrarPairPayload(chave, PAIR_ID, { t: "pronto" })
    const outraChave = chaveDeEmparelhamento(sha256(SEGREDO), PAIR_ID)
    expect(decifrarPairPayload(outraChave, PAIR_ID, wire)).toBeNull()
    // Not even the right key in another box: the pairId is bound as associated data.
    expect(decifrarPairPayload(chave, pairIdDe(sha256(SEGREDO)), wire)).toBeNull()
  })

  it("devolve null a lixo de toda a espécie, sem lançar", () => {
    expect(decifrarPairPayload(chave, PAIR_ID, undefined)).toBeNull()
    expect(decifrarPairPayload(chave, PAIR_ID, 42)).toBeNull()
    expect(decifrarPairPayload(chave, PAIR_ID, "")).toBeNull()
    expect(decifrarPairPayload(chave, PAIR_ID, "!!!")).toBeNull()
    expect(decifrarPairPayload(chave, PAIR_ID, toBase64(new Uint8Array(24)))).toBeNull()
    expect(decifrarPairPayload(chave, PAIR_ID, "A".repeat(PAIR_PAYLOAD_MAX_CHARS + 1))).toBeNull()
    const partido = fromBase64(cifrarPairPayload(chave, PAIR_ID, { t: "pronto" }))
    partido[30] = (partido[30] as number) ^ 0x01
    expect(decifrarPairPayload(chave, PAIR_ID, toBase64(partido))).toBeNull()
  })

  it("um JSON cifrado que não é um payload nosso é null", () => {
    // Encrypted by hand with the same key: the tag verifies, the shape does not.
    const cru = { t: "certificado", address: "@a:b", accountKey: "curto", deviceCert: "x" }
    const wire = cifrarPairPayload(chave, PAIR_ID, cru as never)
    expect(decifrarPairPayload(chave, PAIR_ID, wire)).toBeNull()
  })

  it("o payload do certificado não tem onde levar a chave privada de conta", () => {
    // One extra field is rejected by the schema: the only way to give the private
    // key to the phone would be to change this schema, and this test is what turns red.
    const cru = {
      t: "certificado",
      address: "@abcd-efgh:orwell.pt",
      accountKey: toBase64(chaveDeAparelho(1)),
      deviceCert: toBase64(new Uint8Array(64)),
      signingPrivateKey: toBase64(new Uint8Array(32)),
    }
    const wire = cifrarPairPayload(chave, PAIR_ID, cru as never)
    const lido = decifrarPairPayload(chave, PAIR_ID, wire)
    expect(lido).not.toBeNull()
    expect(lido).not.toHaveProperty("signingPrivateKey")
  })
})

describe("o SAS", () => {
  const pc = chaveDeAparelho(10)
  const telemovel = chaveDeAparelho(11)
  const intruso = chaveDeAparelho(12)

  it("dá seis palavras do vocabulário dos endereços, iguais nos dois lados", () => {
    const palavras = palavrasDoSas(PAIR_ID, pc, telemovel)
    expect(palavras.split("-")).toHaveLength(6)
    expect(palavrasDoSas(PAIR_ID, pc, telemovel)).toBe(palavras)
    // The words are the first 120 bits of the transcript, nothing else.
    expect(toBase64(decodeName(palavras, 6))).toBe(toBase64(transcricaoDoSas(PAIR_ID, pc, telemovel).subarray(0, 15)))
  })

  it("muda quando a chave do convidado é trocada: o homem-no-meio no lugar do telemóvel", () => {
    expect(palavrasDoSas(PAIR_ID, pc, intruso)).not.toBe(palavrasDoSas(PAIR_ID, pc, telemovel))
  })

  it("muda quando a chave do anfitrião é trocada: o homem-no-meio no lugar do computador", () => {
    expect(palavrasDoSas(PAIR_ID, intruso, telemovel)).not.toBe(palavrasDoSas(PAIR_ID, pc, telemovel))
  })

  it("muda com o pairId, e a ordem das chaves conta", () => {
    expect(palavrasDoSas(pairIdDe(sha256(SEGREDO)), pc, telemovel)).not.toBe(palavrasDoSas(PAIR_ID, pc, telemovel))
    expect(palavrasDoSas(PAIR_ID, telemovel, pc)).not.toBe(palavrasDoSas(PAIR_ID, pc, telemovel))
  })

  it("recusa chaves com o tamanho errado", () => {
    expect(() => palavrasDoSas(PAIR_ID, new Uint8Array(31), telemovel)).toThrow()
  })
})

/**
 * Fixed vectors. If any of these change, a new client and an old one stop
 * pairing, and the bug only shows up with two devices in hand.
 */
describe("vectores", () => {
  it("pairId, chave e palavras para um segredo conhecido", () => {
    expect(toBase64(SEGREDO)).toBe("6gzjKC5Y-jxiXv_ZLoIzYX6ZL4PeZ24HirzSb__z6VY")
    expect(PAIR_ID).toBe("nOUZ5vh90qejI5SI-tA8BM")
    expect(toBase64(chaveDeEmparelhamento(SEGREDO, PAIR_ID))).toBe("1RD1_ihozk44hp1cnIUE84rzzNgqHNISYCVLnGSeMYM")
    expect(palavrasDoSas(PAIR_ID, chaveDeAparelho(10), chaveDeAparelho(11))).toBe(
      "tellirum-gemmilum-xermynor-nafrocus-zingyris-xindora",
    )
  })
})

describe("as tramas pair.* no fio", () => {
  it("aceitam a forma certa e recusam um pairId de outra forma", () => {
    expect(parseClientFrame({ t: "pair.open", pairId: PAIR_ID })).toMatchObject({ t: "pair.open" })
    expect(parseClientFrame({ t: "pair.join", pairId: PAIR_ID })).toMatchObject({ t: "pair.join" })
    expect(parseClientFrame({ t: "pair.send", pairId: PAIR_ID, payload: "abc" })).toMatchObject({ t: "pair.send" })
    expect(parseClientFrame({ t: "pair.close", pairId: PAIR_ID })).toMatchObject({ t: "pair.close" })
    expect(() => parseClientFrame({ t: "pair.open", pairId: PAIR_ID.slice(0, 21) })).toThrow()
    expect(() => parseClientFrame({ t: "pair.open", pairId: `${PAIR_ID}=` })).toThrow()
    expect(() => parseClientFrame({ t: "pair.join", pairId: toBase64(SEGREDO) })).toThrow()
    expect(() => parseClientFrame({ t: "pair.join", pairId: "a+b/c" + "x".repeat(17) })).toThrow()
  })

  it("mede o payload cifrado, e recusa acima de 8 KiB", () => {
    expect(parseClientFrame({ t: "pair.send", pairId: PAIR_ID, payload: "A".repeat(PAIR_PAYLOAD_MAX_CHARS - 2) })).toBeTruthy()
    expect(() => parseClientFrame({ t: "pair.send", pairId: PAIR_ID, payload: "A".repeat(PAIR_PAYLOAD_MAX_CHARS + 1) })).toThrow()
    expect(() =>
      parseClientFrame({ t: "pair.send", pairId: PAIR_ID, payload: { grande: "A".repeat(PAIR_PAYLOAD_MAX_CHARS) } }),
    ).toThrow()
  })

  it("as respostas do servidor têm as razões escritas, e só essas", () => {
    expect(parseServerFrame({ t: "pair.opened", pairId: PAIR_ID })).toMatchObject({ t: "pair.opened" })
    expect(parseServerFrame({ t: "pair.joined", pairId: PAIR_ID })).toMatchObject({ t: "pair.joined" })
    expect(parseServerFrame({ t: "pair.message", pairId: PAIR_ID, payload: "x" })).toMatchObject({ t: "pair.message" })
    for (const reason of ["closed", "peer-left", "expired", "intruder"]) {
      expect(parseServerFrame({ t: "pair.closed", pairId: PAIR_ID, reason })).toMatchObject({ reason })
    }
    for (const reason of ["exists", "unknown", "full", "rate-limited"]) {
      expect(parseServerFrame({ t: "pair.rejected", pairId: PAIR_ID, reason })).toMatchObject({ reason })
    }
    expect(() => parseServerFrame({ t: "pair.closed", pairId: PAIR_ID, reason: "whatever" })).toThrow()
  })
})

import { ed25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { describe, expect, it } from "vitest"
import {
  ACCOUNT_ID_BITS,
  ACCOUNT_ID_WORDS,
  MORADA_CARACTERES,
  WORD_BITS,
  accountIdFromSigningKey,
  accountIdToDigestPrefix,
  base32Decode,
  eMoradaOpaca,
  makeUserAddress,
  moradaDaConta,
  moradaDeSala,
  moradaDirecta,
  moradaDoMural,
  parseAddress,
  parseServerName,
  podeEstrearCanal,
  servidorDaDirecta,
  serverOf,
  type SpaceAddress,
} from "./ids.js"
import { identityFromPrivateKey } from "./identity.js"

/**
 * The account identifier got shorter, and shortening a hash is the only change
 * in this project nobody can undo: the address is the key, and whoever picks
 * someone else's address becomes that person inside any MLS group. These tests
 * lock down the three properties this depends on, the derivation is
 * deterministic, it tells different keys apart, and what comes out is the
 * prefix of the true hash, not bits invented in the middle, so any future
 * change to the length must pass through here instead of slipping out silently
 * in a cosmetic commit.
 */

const SERVIDOR = parseServerName("orwell.pt")

/**
 * Keys derived from a counter instead of random: a collision that only showed
 * up with another person's machine seeds would not be a test, it would be a
 * lottery.
 */
function chaveDeTeste(semente: number): { privada: Uint8Array; publica: Uint8Array } {
  const privada = sha256(Uint8Array.from([semente & 0xff, (semente >>> 8) & 0xff, (semente >>> 16) & 0xff]))
  return { privada, publica: ed25519.getPublicKey(privada) }
}

describe("identificador de conta", () => {
  it("a mesma chave dá sempre o mesmo identificador", () => {
    const { publica } = chaveDeTeste(1)
    const primeiro = accountIdFromSigningKey(publica)
    for (let i = 0; i < 10; i++) expect(accountIdFromSigningKey(publica)).toBe(primeiro)
  })

  it("chaves diferentes não partilham identificador", () => {
    const vistos = new Map<string, number>()
    for (let semente = 0; semente < 512; semente++) {
      const { publica } = chaveDeTeste(semente)
      const id = accountIdFromSigningKey(publica)
      expect(vistos.has(id), `${id} repetido nas sementes ${vistos.get(id)} e ${semente}`).toBe(false)
      vistos.set(id, semente)
    }
  })

  /**
   * The bit budget is an assertion, not a comment, and it lives here. The
   * identifier moved to Latin, and the only way that change is presentation and
   * not security is the bit count staying put: four words of twenty bits are the
   * same eighty as sixteen base32 characters wrote.
   */
  it("carrega os 80 bits que o modelo de ameaça exige, nem mais nem menos", () => {
    expect(ACCOUNT_ID_BITS).toBe(80)
    expect(ACCOUNT_ID_WORDS * WORD_BITS).toBe(ACCOUNT_ID_BITS)
  })

  /**
   * Truncating has to be cutting, not recombining, and writing has to be
   * dressing, not hashing again. If the identifier stopped being exactly the
   * first 80 bits of the hash, it would stop inheriting the uniformity of
   * SHA-256 and the budget above would become an unsupported claim. Proving it
   * now is easier than it was in base32: the name unfolds back to bytes.
   */
  it("é o prefixo do resumo completo, sem bits inventados nem descartados a meio", () => {
    for (let semente = 0; semente < 32; semente++) {
      const { publica } = chaveDeTeste(semente)
      const id = accountIdFromSigningKey(publica)
      expect(accountIdToDigestPrefix(id)).toEqual(sha256(publica).subarray(0, 10))
    }
  })

  it("são palavras separadas por hífenes, sem maiúsculas nem algarismos", () => {
    for (let semente = 0; semente < 64; semente++) {
      const { publica } = chaveDeTeste(semente)
      expect(accountIdFromSigningKey(publica)).toMatch(/^[a-z]+(-[a-z]+){3}$/)
    }
  })

  /**
   * What got shorter was not the character count, it grew, it was what costs
   * a person. Sixteen unrelated symbols spell out one by one; four words speak.
   * The cap exists so a new ending does not grow the address without anyone
   * noticing.
   */
  it("cabe num tecto conhecido, para o ecrã poder contar com ele", () => {
    for (let semente = 0; semente < 64; semente++) {
      const { publica } = chaveDeTeste(semente)
      expect(accountIdFromSigningKey(publica).length).toBeLessThanOrEqual(39)
    }
  })
})

describe("a conta sobrevive ao encurtamento", () => {
  /**
   * The vault holds the private key and nothing else about the identity: the
   * address is recomputed each time you open it. That is why shortening changes
   * the presentation and not the account, and that is what the test must prove,
   * because if the address ever becomes stored, the same password starts opening
   * an identity that no longer matches what the server knows.
   */
  it("a mesma chave privada reabre a mesma identidade", () => {
    const { privada } = chaveDeTeste(99)
    const primeira = identityFromPrivateKey(privada, SERVIDOR)
    const segunda = identityFromPrivateKey(privada, SERVIDOR)

    expect(segunda.signingPublicKey).toEqual(primeira.signingPublicKey)
    expect(segunda.signingPrivateKey).toEqual(primeira.signingPrivateKey)
    expect(segunda.accountId).toBe(primeira.accountId)
    expect(segunda.address).toBe(primeira.address)
  })

  it("o endereço continua a ser recomputável a partir da chave", () => {
    const { privada } = chaveDeTeste(100)
    const identidade = identityFromPrivateKey(privada, SERVIDOR)
    const { sigil, localPart, server } = parseAddress(identidade.address)

    expect(sigil).toBe("@")
    expect(server).toBe(SERVIDOR)
    expect(localPart).toBe(accountIdFromSigningKey(identidade.signingPublicKey))
  })
})

/**
 * Opaque addresses (1.0 "Arca"). What this proves is what the rest of 1.0
 * takes for granted: that both sides of a conversation reach the same address
 * without talking, the address shows neither the pair nor the owner, and the
 * form is unique.
 */
describe("moradas opacas", () => {
  const OUTRO = parseServerName("outro.pt")

  function conta(semente: number, servidor = SERVIDOR) {
    const { privada, publica } = chaveDeTeste(semente)
    return { privada, publica, endereco: makeUserAddress(accountIdFromSigningKey(publica), servidor) }
  }

  it("os dois lados de uma conversa directa obtêm a mesma morada", () => {
    for (let i = 0; i < 16; i++) {
      const a = conta(1000 + i)
      const b = conta(2000 + i)
      const deA = moradaDirecta(a.privada, b.publica, a.endereco, b.endereco)
      const deB = moradaDirecta(b.privada, a.publica, b.endereco, a.endereco)
      expect(deB).toBe(deA)
    }
  })

  it("pares diferentes dão moradas diferentes, e nenhuma diz quem lá está", () => {
    const a = conta(1)
    const b = conta(2)
    const c = conta(3)
    const ab = moradaDirecta(a.privada, b.publica, a.endereco, b.endereco)
    const ac = moradaDirecta(a.privada, c.publica, a.endereco, c.endereco)
    expect(ab).not.toBe(ac)
    for (const morada of [ab, ac]) {
      for (const pessoa of [a, b, c]) expect(morada).not.toContain(parseAddress(pessoa.endereco).localPart)
    }
  })

  it("a parte do servidor é a do endereço menor, dos dois lados", () => {
    const a = conta(10, SERVIDOR)
    const b = conta(11, OUTRO)
    const menor = a.endereco < b.endereco ? a.endereco : b.endereco
    const esperado = parseAddress(menor).server
    const deA = moradaDirecta(a.privada, b.publica, a.endereco, b.endereco)
    const deB = moradaDirecta(b.privada, a.publica, b.endereco, a.endereco)
    expect(deB).toBe(deA)
    expect(serverOf(deA as unknown as SpaceAddress)).toBe(esperado)
    expect(servidorDaDirecta(a.endereco, b.endereco)).toBe(esperado)
    expect(servidorDaDirecta(b.endereco, a.endereco)).toBe(esperado)
  })

  it("o servidor menor é por ordem de bytes do endereço inteiro, não só do servidor", () => {
    // The account id comes before the server in the string: it decides, and the
    // server only breaks ties between accounts with the same id on different
    // servers.
    expect(servidorDaDirecta("@b:a.pt", "@a:z.pt")).toBe("z.pt")
    expect(servidorDaDirecta("@a:z.pt", "@a:b.pt")).toBe("b.pt")
  })

  it("recusa uma chave que não é a do endereço que diz ser", () => {
    const a = conta(20)
    const b = conta(21)
    const c = conta(22)
    expect(() => moradaDirecta(a.privada, c.publica, a.endereco, b.endereco)).toThrow(/peer address/)
    expect(() => moradaDirecta(c.privada, b.publica, a.endereco, b.endereco)).toThrow(/my address/)
    expect(() => moradaDirecta(a.privada, a.publica, a.endereco, a.endereco)).toThrow(/two different/)
  })

  it("tem 40 caracteres base32, e a forma é a mesma para os quatro tipos", () => {
    const a = conta(30)
    const b = conta(31)
    const moradas = [
      moradaDirecta(a.privada, b.publica, a.endereco, b.endereco),
      moradaDoMural(sha256(Uint8Array.of(1)), SERVIDOR),
      moradaDaConta(a.privada, SERVIDOR),
      moradaDeSala(SERVIDOR),
    ]
    expect(MORADA_CARACTERES).toBe(40)
    for (const morada of moradas) {
      const { sigil, localPart, server } = parseAddress(morada)
      expect(sigil).toBe("!")
      expect(server).toBe(SERVIDOR)
      expect(localPart).toHaveLength(40)
      expect(base32Decode(localPart)).toHaveLength(25)
      expect(eMoradaOpaca(morada)).toBe(true)
    }
  })

  it("o mural é determinista no segredo, e só nele", () => {
    const segredo = sha256(Uint8Array.of(7))
    expect(moradaDoMural(segredo, SERVIDOR)).toBe(moradaDoMural(Uint8Array.from(segredo), SERVIDOR))
    expect(moradaDoMural(sha256(Uint8Array.of(8)), SERVIDOR)).not.toBe(moradaDoMural(segredo, SERVIDOR))
    expect(() => moradaDoMural(new Uint8Array(31), SERVIDOR)).toThrow(/32 bytes/)
  })

  it("o canal da conta é determinista na chave, e não é a morada do mural com o mesmo segredo", () => {
    const { privada } = chaveDeTeste(40)
    expect(moradaDaConta(privada, SERVIDOR)).toBe(moradaDaConta(Uint8Array.from(privada), SERVIDOR))
    expect(moradaDaConta(chaveDeTeste(41).privada, SERVIDOR)).not.toBe(moradaDaConta(privada, SERVIDOR))
    // Domain tags separate types: the same 32 bytes in two places do not give the
    // same address.
    expect(moradaDaConta(privada, SERVIDOR)).not.toBe(moradaDoMural(privada, SERVIDOR))
  })

  it("a morada de uma sala é sorteada a cada vez", () => {
    const vistas = new Set<string>()
    for (let i = 0; i < 256; i++) vistas.add(moradaDeSala(SERVIDOR))
    expect(vistas.size).toBe(256)
  })

  it("eMoradaOpaca reconhece a forma opaca e nada mais", () => {
    const boa = moradaDeSala(SERVIDOR)
    const local = boa.slice(1, boa.indexOf(":"))
    expect(eMoradaOpaca(`!${local}:localhost:8448`)).toBe(true)
    for (const outra of [
      "!dm-ana.rui:orwell.pt",
      "!feed-ana:orwell.pt",
      "!self-ana:orwell.pt",
      "!forum-lorem-ipsum:orwell.pt",
      `@${local}:orwell.pt`,
      `!${local}`,
      `!${local}:`,
      `!${local}:Orwell.pt`,
      `!${local}:orwell pt`,
      `!${local.slice(1)}:orwell.pt`,
      `!${local}a:orwell.pt`,
      `!${local.toUpperCase()}:orwell.pt`,
      `!${"l".repeat(40)}:orwell.pt`,
      `!${"0".repeat(40)}:orwell.pt`,
    ]) {
      expect(eMoradaOpaca(outra), outra).toBe(false)
    }
  })

  it("podeEstrearCanal: a morada opaca e a sala comum, e mais nada", () => {
    const opaca = moradaDeSala(SERVIDOR)
    expect(podeEstrearCanal(opaca, "")).toBe(true)
    expect(podeEstrearCanal(opaca, null)).toBe(true)
    expect(podeEstrearCanal("!orwell:orwell.pt", "!orwell:orwell.pt")).toBe(true)
    // The common room is the server's room, and only that one: any other readable form stays closed.
    expect(podeEstrearCanal("!sincronia-antiga:orwell.pt", "!orwell:orwell.pt")).toBe(false)
    // Without a common room announced, no readable form debuts, not even an empty one.
    expect(podeEstrearCanal("!orwell:orwell.pt", "")).toBe(false)
    expect(podeEstrearCanal("!orwell:orwell.pt", null)).toBe(false)
    expect(podeEstrearCanal("", "")).toBe(false)
  })
})

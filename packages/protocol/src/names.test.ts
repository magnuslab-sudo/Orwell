import { describe, expect, it } from "vitest"
import {
  ENDING_TABLE,
  MEDIAL_TABLE,
  ONSET_TABLE,
  V1_TABLE,
  V2_TABLE,
  WORD_BITS,
  WORD_SPACE,
  decodeName,
  decodeWord,
  encodeName,
  encodeWord,
  roomIdFromBytes,
} from "./names.js"

/**
 * The Latin syllable replaces base32, and what changes is the clothes, not the
 * body: the same bits, written a different way. That's only true as long as the
 * writing is a bijection, if two different values gave the same word, the
 * address would lose the bits the threat model gives it and the count of 80
 * bits would become folklore.
 *
 * Hence the exhaustive scan of 2^20 words. It's not a sample test: it's proof,
 * done with an iron hand, that the table in the file encodes and decodes every
 * possible word without losing or mixing any of them.
 */

describe("tabelas do vocabulário", () => {
  it("têm o tamanho que o orçamento de bits pressupõe", () => {
    expect(ONSET_TABLE).toHaveLength(16)
    expect(V1_TABLE).toHaveLength(4)
    expect(MEDIAL_TABLE).toHaveLength(64)
    expect(V2_TABLE).toHaveLength(4)
    expect(ENDING_TABLE).toHaveLength(64)
    // 4 + 2 + 6 + 2 + 6. The assertion is there so adding an entry to a table
    // without adjusting the others breaks here, not in production.
    expect(WORD_BITS).toBe(20)
    expect(WORD_SPACE).toBe(2 ** WORD_BITS)
  })

  it("não repetem entradas dentro da mesma tabela", () => {
    for (const tabela of [ONSET_TABLE, V1_TABLE, MEDIAL_TABLE, V2_TABLE, ENDING_TABLE]) {
      expect(new Set(tabela).size).toBe(tabela.length)
    }
  })

  /**
   * The word is read by position: if the first character is a vowel, the onset
   * is empty. This only works because no vowel from the first nucleus appears
   * as an onset, otherwise `belo` would have two readings and the bijection
   * would break.
   */
  it("separa o alfabeto dos ataques do das vogais", () => {
    const vogais = new Set<string>([...V1_TABLE, ...V2_TABLE])
    for (const ataque of ONSET_TABLE) if (ataque !== "") expect(vogais.has(ataque)).toBe(false)
    for (const medial of MEDIAL_TABLE) expect(medial).toHaveLength(2)
    for (const vogal of [...V1_TABLE, ...V2_TABLE]) expect(vogal).toHaveLength(1)
  })

  it("só usa terminações que comecem por consoante", () => {
    const vogais = new Set<string>([...V1_TABLE, ...V2_TABLE])
    for (const fim of ENDING_TABLE) {
      expect(fim.length).toBeGreaterThanOrEqual(2)
      expect(vogais.has(fim[0] as string), `terminação ${fim} começa por vogal`).toBe(false)
    }
  })
})

/**
 * Words that must never come up by chance.
 *
 * Written by hand, and it has to be that way: an identifier is read aloud in
 * front of other people, and a list pulled raw from a dictionary brings both
 * what you want to forbid and what you want to keep. Lives in the test, not the
 * module, on purpose, it's proof, not behavior, and doesn't have to weigh on
 * the package that hits the browser.
 *
 * The criterion is unambiguous vulgarity and insult, not Latin with modern
 * echo: `damnitor` and `orgitus` stay, because `damnum` and `orgia` are Roman
 * words and the world these come from is that one.
 */
const PROIBIDAS = [
  // Portuguese
  "puta",
  "porra",
  "merd",
  "caralh",
  "cona",
  "foda",
  "fode",
  "foder",
  "fodi",
  "caga",
  "cagu",
  "bosta",
  "pila",
  "cabr",
  "corno",
  "paneleir",
  "maricas",
  "bicha",
  "chulo",
  "chupa",
  "peido",
  "peida",
  "mija",
  "mijo",
  "tesao",
  "picha",
  "piche",
  "picho",
  "piroca",
  "escroto",
  "xoxota",
  "boceta",
  "punheta",
  "cuzao",
  "otario",
  "burro",
  "estupid",
  "idiota",
  "sida",
  "violad",
  "violar",
  "estupro",
  "nazi",
  "fasci",
  "fasco",
  "hitler",
  "suicid",
  "cocain",
  "heroina",
  // English
  "fuck",
  "shit",
  "cunt",
  "cock",
  "dick",
  "piss",
  "slut",
  "whore",
  "bitch",
  "nigg",
  "fag",
  "rape",
  "rapist",
  "kike",
  "spic",
  "chink",
  "tits",
  "boob",
  "porn",
  "wank",
  "twat",
  "prick",
  "bollock",
  "arse",
  "asshole",
  "jizz",
  "semen",
  "penis",
  "vagin",
  "anus",
  "incest",
  "pedo",
  "molest",
  "turd",
  "crap",
  "fart",
  "hooker",
  "retard",
]

const PROIBIDAS_RE = new RegExp(PROIBIDAS.join("|"))

/**
 * ⚠️ This block was trap number four in `docs/RETOMAR.md`: on a busy machine
 * it went red on its own, in a test that had nothing to do with what had
 * changed. It was three scans of 2^20 values with the default budget of 5 s,
 * and the first one took 3.6 s on a free machine. Measured again on August 16,
 * with the machine full: 23 s. Red, and wrong red.
 *
 * Two things changed, and the second is the one that matters:
 *
 *   1. The timeout is now WRITTEN, and generous on purpose: what decides this
 *      test's color must be the table, never the machine's load.
 *
 *   2. The `expect` moved out of the loop. The scan called
 *      `expect(decodeWord(palavra)).toBe(valor)` **1,048,576 times**, and that's
 *      where the time went, not in `encodeWord`. Proof: the other two scans,
 *      which go through the same million values but with no `expect` inside,
 *      cost less than three hundred milliseconds each. Building a matcher is
 *      expensive; comparing two integers is not.
 *
 * **No proof is lost.** Still 2^20 values, one by one, all compared. What
 * changed was who does the comparing: equality instead of a matcher, with
 * failures kept and shown all at once at the end, and the report is even
 * better, because it says WHICH values failed instead of dying on the first.
 *
 * Still not a sample. A sample doesn't prove absence.
 */
describe("varredura exaustiva do espaço de uma palavra", () => {
  it("cada um dos 2^20 valores dá uma palavra distinta que se volta a ler no mesmo valor", () => {
    const vistas = new Set<string>()
    const naoVoltaram: string[] = []

    for (let valor = 0; valor < WORD_SPACE; valor++) {
      const palavra = encodeWord(valor)
      const relido = decodeWord(palavra)
      if (relido !== valor && naoVoltaram.length < 20) naoVoltaram.push(`${valor} → ${palavra} → ${relido}`)
      vistas.add(palavra)
    }

    expect(naoVoltaram, `valores que não voltaram: ${naoVoltaram.join(", ")}`).toEqual([])
    // And distinct: a `Set` shorter than the space is a collision, which is the
    // other way the bijection breaks.
    expect(vistas.size).toBe(WORD_SPACE)
  }, 120_000)

  it("nenhuma das 2^20 palavras contém coisa que não se queira dizer em voz alta", () => {
    const infelizes: string[] = []
    for (let valor = 0; valor < WORD_SPACE; valor++) {
      const palavra = encodeWord(valor)
      if (PROIBIDAS_RE.test(palavra) && infelizes.length < 20) infelizes.push(palavra)
    }
    expect(infelizes, `palavras infelizes alcançáveis: ${infelizes.join(", ")}`).toEqual([])
  }, 120_000)

  it("nenhuma palavra passa dos nove caracteres, para o endereço ter um tecto", () => {
    let maior = 0
    for (let valor = 0; valor < WORD_SPACE; valor++) maior = Math.max(maior, encodeWord(valor).length)
    expect(maior).toBeLessThanOrEqual(9)
  }, 120_000)
})

describe("nome completo", () => {
  it("escreve e volta a ler os mesmos bytes", () => {
    for (let semente = 0; semente < 256; semente++) {
      const bytes = Uint8Array.from({ length: 10 }, (_, i) => (semente * 31 + i * 97) & 0xff)
      expect(decodeName(encodeName(bytes, 4), 4)).toEqual(bytes)
    }
  })

  it("recusa um número de bytes que não encha as palavras todas", () => {
    expect(() => encodeName(new Uint8Array(9), 4)).toThrow(/80 bits/)
    expect(() => decodeName("belo-nix", 4)).toThrow(/words/)
  })

  it("é minúsculas, letras e hífenes, e mais nada", () => {
    const bytes = Uint8Array.from({ length: 10 }, (_, i) => (i * 53) & 0xff)
    expect(encodeName(bytes, 4)).toMatch(/^[a-z]+(-[a-z]+){3}$/)
  })
})

describe("identificador de sala", () => {
  /**
   * The room is not an account: the identifier doesn't hash any key and forging
   * it gives nobody power. What we ask here is that the name says what the room
   * is, that's why the prefix is fixed by type, not drawn from a family of
   * synonyms.
   */
  it("diz pelo prefixo se é de escrita ou de voz", () => {
    const bytes = Uint8Array.from([1, 2, 3, 4, 5])
    expect(roomIdFromBytes("text", bytes)).toMatch(/^forum-/)
    expect(roomIdFromBytes("voice", bytes)).toMatch(/^contio-/)
  })

  it("cabe no campo `room` do protocolo, que aceita 64 caracteres", () => {
    for (let semente = 0; semente < 64; semente++) {
      const bytes = Uint8Array.from({ length: 5 }, (_, i) => (semente * 41 + i * 13) & 0xff)
      expect(roomIdFromBytes("voice", bytes).length).toBeLessThanOrEqual(64)
    }
  })

  it("bytes diferentes dão salas diferentes", () => {
    const vistas = new Set<string>()
    for (let semente = 0; semente < 512; semente++) {
      const bytes = Uint8Array.from([semente & 0xff, (semente >>> 8) & 0xff, 0, 0, 0])
      vistas.add(roomIdFromBytes("text", bytes))
    }
    expect(vistas.size).toBe(512)
  })
})

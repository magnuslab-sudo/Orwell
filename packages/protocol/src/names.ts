/**
 * Write bits in Latin.
 *
 * An account address is the hash of a key, and the hash is 80 bits because
 * below that someone buys another person's identity on a GPU rental bill, the
 * account is in `ids.ts` and in `docs/THREAT-MODEL.md`. What this file changes
 * is the clothes, not the body: the same 80 bits, written as four Latin words
 * instead of sixteen base32 characters.
 *
 * The swap has a price, and it's worth knowing what it is. The density of
 * readable text is stuck at about three bits per character, against base32's
 * five, so the address goes from sixteen characters to about thirty-three. In
 * return it stops having sixteen symbols with no relation to each other and has
 * four words instead: `h98q8e9us3g8y4em` you can spell, one character at a time
 * with the alphabet in front; `martinus-bellocor-tenegus-carpylla` you can say.
 * What got short is what costs a person, not what takes up on screen.
 *
 * A derived name apart, the technical address on one side, a pretty nickname
 * on the other, the way Docker does with containers, was considered and
 * rejected. The nickname would have to be short to work as a nickname, short
 * means few bits, and few bits mean you forge a key whose nickname matches
 * another person's in an afternoon. And since it's the nickname people read and
 * say, the personification happens right in the layer where nobody is verifying
 * anything. Here there's no two layers: the word *is* the address.
 */

/**
 * Vocabulary.
 *
 * The tables are written by hand, and what decides each entry is not just Latin.
 * An identifier is read aloud in front of other people, and there are words that
 * must never come up by chance: `names.test.ts` scans the entire space of 2^20
 * words and fails if any of them contains what shouldn't be said. Several
 * absences below, `rn`, `ss`, `ch`, `rd`, `br`, `sp`, are not oversights by
 * a Latinist, they're the result of that scan.
 *
 * The mechanics that does the rest of the work is the medial always having two
 * characters: that settles the whole family of vulgarities with
 * consonant-vowel-consonant-vowel shape, which is most of them. And the second
 * nucleus having no `a` kills the other half, besides settling the `-anus` that
 * would make English speakers laugh while staying Latin.
 */

/** Onset. The empty entry gives words starting with a vowel, Aurelius, Octavia. */
export const ONSET_TABLE = ["", "b", "c", "d", "g", "h", "l", "m", "n", "p", "r", "s", "t", "v", "x", "z"] as readonly string[]

/** First nucleus. This is where the `a` lives that makes Marcus and Cassius. */
export const V1_TABLE = ["a", "e", "i", "o"] as readonly string[]

/**
 * Medial, always two characters. Groups that Latin and Greek use between vowels:
 * geminates, nasal with stop, liquid with stop, aspirates.
 */
export const MEDIAL_TABLE = [
  "ll", "mm", "nn", "tt", "cc", "pp", "ff", "bb", "dd", "rr",
  "mp", "mb", "nt", "nd", "nc", "ng", "nv", "nf", "ns",
  "rb", "rc", "rf", "rg", "rm", "rp", "rv", "rt",
  "lb", "lc", "ld", "lf", "lg", "lm", "lp", "ls", "lt", "lv",
  "st", "sm", "sc",
  "cr", "dr", "fr", "gr", "pr", "tr", "bl", "cl", "fl", "gl", "pl",
  "ph", "th", "rh",
  "ct", "pt", "gn", "mn", "qu", "ps", "xt", "gm", "bs", "dm",
] as readonly string[]

/** Second nucleus. No `a`, and with the `y` that brings Greek. */
export const V2_TABLE = ["e", "i", "o", "y"] as readonly string[]

/**
 * Ending. Always starts with a consonant, the previous nucleus gives the
 * vowel, and that's how `-inus`, `-ensis`, `-orum`, `-ylla` come out without
 * two vowels stuck together by accident. Seven of the entries are whole Latin
 * words (`rex`, `dux`, `lux`, `pax`, `vox`, `nox`, `cor`), which is the flavor
 * at zero cost.
 */
export const ENDING_TABLE = [
  "ne", "no", "ra", "re", "ro", "ta", "te", "to", "le", "lo", "ca", "co", "fer",
  "ma", "mo", "va", "vo", "sa", "so", "ba", "bo", "ga", "go", "pa", "po",
  "nus", "rus", "tus", "lus", "cus", "dus", "mus", "bus", "gus", "sus",
  "vis", "ris", "tis", "lis", "cis", "bis",
  "nor", "ror", "tor", "lor", "cor", "mor",
  "rum", "tum", "lum", "num",
  "rex", "dux", "lux", "pax", "vox", "nox",
  "nda", "lla", "tra", "dra",
  "nsis", "ntus", "ndus",
] as readonly string[]

/** 4 + 2 + 6 + 2 + 6. Twenty divides eighty in four, which is the number of words in an address. */
export const WORD_BITS = 20
export const WORD_SPACE = 2 ** WORD_BITS

function indexOf(tabela: readonly string[]): Map<string, number> {
  return new Map(tabela.map((entrada, indice) => [entrada, indice]))
}

const ONSET_INDEX = indexOf(ONSET_TABLE)
const V1_INDEX = indexOf(V1_TABLE)
const MEDIAL_INDEX = indexOf(MEDIAL_TABLE)
const V2_INDEX = indexOf(V2_TABLE)
const ENDING_INDEX = indexOf(ENDING_TABLE)

/** One word from twenty bits. Most significant bits first, so the name is a prefix of the hash. */
export function encodeWord(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value >= WORD_SPACE) {
    throw new Error(`word value out of range: ${value}`)
  }
  return (
    (ONSET_TABLE[(value >>> 16) & 0x0f] as string) +
    (V1_TABLE[(value >>> 14) & 0x03] as string) +
    (MEDIAL_TABLE[(value >>> 8) & 0x3f] as string) +
    (V2_TABLE[(value >>> 6) & 0x03] as string) +
    (ENDING_TABLE[value & 0x3f] as string)
  )
}

/**
 * The way back.
 *
 * Reading is by position, not by trial: only the onset has variable length, and
 * it's told apart by a rule that doesn't fail, if the first character is a
 * vowel, there's no onset. Vowels and consonants are disjoint sets, so no word
 * has two readings, and that's what guarantees the 80 bits that go in are the
 * 80 bits that come out.
 */
export function decodeWord(word: string): number {
  const inicio = V1_INDEX.has(word[0] as string) ? 0 : 1
  const ataque = inicio === 0 ? "" : (word[0] as string)
  const onset = ONSET_INDEX.get(ataque)
  const v1 = V1_INDEX.get(word[inicio] as string)
  const medial = MEDIAL_INDEX.get(word.slice(inicio + 1, inicio + 3))
  const v2 = V2_INDEX.get(word[inicio + 3] as string)
  const ending = ENDING_INDEX.get(word.slice(inicio + 4))
  if (onset === undefined || v1 === undefined || medial === undefined || v2 === undefined || ending === undefined) {
    throw new Error(`not a name word: ${word}`)
  }
  return (onset << 16) | (v1 << 14) | (medial << 8) | (v2 << 6) | ending
}

function readBits(bytes: Uint8Array, offset: number, count: number): number {
  let value = 0
  for (let i = 0; i < count; i++) {
    const bit = offset + i
    value = (value << 1) | (((bytes[bit >>> 3] as number) >>> (7 - (bit & 7))) & 1)
  }
  return value
}

function writeBits(bytes: Uint8Array, offset: number, count: number, value: number): void {
  for (let i = 0; i < count; i++) {
    const bit = offset + i
    if (((value >>> (count - 1 - i)) & 1) === 1) {
      bytes[bit >>> 3] = (bytes[bit >>> 3] as number) | (1 << (7 - (bit & 7)))
    }
  }
}

/** Bytes to name. The number of bytes must fill all the words: no leftovers or padding. */
export function encodeName(bytes: Uint8Array, words: number): string {
  const bits = words * WORD_BITS
  if (bytes.length * 8 !== bits) {
    throw new Error(`a ${words}-word name needs exactly ${bits} bits, got ${bytes.length * 8}`)
  }
  const partes: string[] = []
  for (let i = 0; i < words; i++) partes.push(encodeWord(readBits(bytes, i * WORD_BITS, WORD_BITS)))
  return partes.join("-")
}

/** Name to bytes. Refuses anything that isn't exactly what `encodeName` writes. */
export function decodeName(text: string, words: number): Uint8Array {
  const partes = text.split("-")
  if (partes.length !== words) throw new Error(`a name of ${words} words, got ${partes.length}`)
  const bytes = new Uint8Array((words * WORD_BITS) / 8)
  for (let i = 0; i < words; i++) writeBits(bytes, i * WORD_BITS, WORD_BITS, decodeWord(partes[i] as string))
  return bytes
}

// --------------------------------------------------------------------- salas

export type RoomKind = "text" | "voice"

/**
 * The prefix says what the room is, and it's fixed by type instead of drawn
 * from a family of synonyms: drawn would be flavor, fixed is information. Rome
 * kept the two places and the two words work perfectly, the *forum* is where
 * you write and post, the *contio* is the assembly where someone speaks aloud
 * and the rest listen. Whoever doesn't know Latin still sees two consistent
 * prefixes; whoever does, reads the function.
 *
 * `praeconium` (the herald's proclamation) is held for the day there's a room
 * type that's only announcements.
 */
const ROOM_PREFIX: Record<RoomKind, string> = { text: "forum", voice: "contio" }

/**
 * Forty bits of entropy, compared to the thirty-two from `randomUUID().slice(0,8)`
 * that this replaces. The room identifier does not hash any key and forging it
 * grants no power to anyone, the worst a collision does is make two rooms share
 * history, so the number here is for comfort, not security.
 */
export function roomIdFromBytes(kind: RoomKind, bytes: Uint8Array): string {
  return `${ROOM_PREFIX[kind]}-${encodeName(bytes, 2)}`
}

export function newRoomId(kind: RoomKind): string {
  const bytes = new Uint8Array(5)
  globalThis.crypto.getRandomValues(bytes)
  return roomIdFromBytes(kind, bytes)
}

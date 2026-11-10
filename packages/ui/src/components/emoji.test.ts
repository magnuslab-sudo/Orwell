import { describe, expect, it } from "vitest"
import { CATEGORIES, findEmoji, fold, searchEmoji } from "./emoji.js"

const ALL = CATEGORIES.flatMap((category) => category.emojis)

describe("catálogo", () => {
  it("tem todas as categorias preenchidas", () => {
    expect(CATEGORIES.length).toBeGreaterThan(0)
    for (const category of CATEGORIES) {
      expect(category.emojis.length, category.id).toBeGreaterThan(0)
    }
  })

  it("dá glifo e nome a cada entrada", () => {
    for (const emoji of ALL) {
      expect(emoji.char.length, emoji.name).toBeGreaterThan(0)
      expect(emoji.name.trim(), emoji.char).not.toBe("")
      // The name should never drag the synonym bar: if it does, the separator was
      // lost in editing and the screen reader would read garbage.
      expect(emoji.name).not.toContain("|")
    }
  })

  it("não repete glifos entre categorias", () => {
    // A repeated glyph appears twice in the grid and makes `findEmoji` depend on
    // order, classic sign of copy-paste between blocks.
    const seen = new Map<string, string>()
    for (const emoji of ALL) {
      expect(seen.get(emoji.char), `${emoji.char} repetido`).toBeUndefined()
      seen.set(emoji.char, emoji.name)
    }
  })

  it("encontra um glifo pelo próprio caracter", () => {
    expect(findEmoji("🙂")?.name).toBe("sorriso leve")
    expect(findEmoji("não é um emoji")).toBeUndefined()
  })
})

describe("fold", () => {
  it("tira acentos e maiúsculas", () => {
    expect(fold("Coração")).toBe("coracao")
    expect(fold("PÊSSEGO")).toBe("pessego")
    expect(fold("São Tomé")).toBe("sao tome")
  })
})

describe("searchEmoji", () => {
  it("devolve nada sem termo", () => {
    expect(searchEmoji("")).toEqual([])
    expect(searchEmoji("   ")).toEqual([])
  })

  it("procura sem exigir acentos", () => {
    const chars = searchEmoji("coracao").map((emoji) => emoji.char)
    expect(chars).toContain("❤️")
  })

  it("procura pelo nome escrito com acentos", () => {
    expect(searchEmoji("café").map((emoji) => emoji.char)).toContain("☕")
  })

  it("encontra por sinónimo e não só pelo nome", () => {
    // "imperial" is not the name of any emoji, it's what you say in Portuguese
    // when you order a beer, and that's why synonyms exist.
    expect(searchEmoji("imperial").map((emoji) => emoji.char)).toContain("🍺")
  })

  it("põe o prefixo do nome à frente do que só bate a meio", () => {
    const first = searchEmoji("cora")[0]
    expect(fold(first?.name ?? "").startsWith("cora")).toBe(true)
  })

  it("não passa do limite pedido", () => {
    expect(searchEmoji("a", 5).length).toBe(5)
  })

  it("devolve vazio para um termo que não existe", () => {
    expect(searchEmoji("zzzzzzq")).toEqual([])
  })
})

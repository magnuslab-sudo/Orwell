import { describe, expect, it } from "vitest"
import { asQueFicaramParaTras, largaDepois, largarCategoriaEm } from "./reordenarCategorias.js"

/**
 * The order of categories, and the two things these tests exist to lock down:
 * that moving a category does not touch rooms, and that an undeclared category
 * becomes declared, otherwise the position has nowhere to go.
 */

/** The order that results after applying changes to today's list. */
function ordemFinal(ordem: readonly string[], declaradas: { category: string; position: number }[], mudancas: { category: string; position: number }[]): string[] {
  const posicoes = new Map(declaradas.map((d) => [d.category, d.position]))
  for (const mudanca of mudancas) posicoes.set(mudanca.category, mudanca.position)
  // Same rule as `useRooms`: undeclared ones go to the end, and name breaks ties.
  return [...ordem]
    .filter((nome) => nome !== "")
    .sort(
      (a, b) =>
        (posicoes.get(a) ?? Number.MAX_SAFE_INTEGER) - (posicoes.get(b) ?? Number.MAX_SAFE_INTEGER) ||
        a.localeCompare(b),
    )
}

describe("largar uma categoria em cima de outra", () => {
  const ordem = ["Início", "Notícias", "Voz"]
  const declaradas = [
    { category: "Início", position: 0 },
    { category: "Notícias", position: 100 },
    { category: "Voz", position: 200 },
  ]

  it("sobe a categoria para cima do alvo", () => {
    const mudancas = largarCategoriaEm(ordem, declaradas, "Voz", "Início")
    expect(ordemFinal(ordem, declaradas, mudancas)).toEqual(["Voz", "Início", "Notícias"])
  })

  it("desce a categoria para baixo do alvo, que é como se chega ao fim", () => {
    // The last position has no header after it where you can drop. If drop always
    // meant "before", you could never reach it.
    const mudancas = largarCategoriaEm(ordem, declaradas, "Início", "Voz")
    expect(ordemFinal(ordem, declaradas, mudancas)).toEqual(["Notícias", "Voz", "Início"])
  })

  it("leva cada categoria a qualquer posição, num só arrasto", () => {
    // The property the direction rule exists to guarantee: no place in the list is
    // unreachable, and the end least of all. (The starting position counts: you are
    // already there, and to stay there you do not drag anything.)
    for (const arrastada of ordem) {
      const indices = new Set<number>([ordem.indexOf(arrastada)])
      for (const alvo of ordem) {
        if (arrastada === alvo) continue
        const final = ordemFinal(ordem, declaradas, largarCategoriaEm(ordem, declaradas, arrastada, alvo))
        // A category is never lost or duplicated along the way.
        expect([...final].sort()).toEqual([...ordem].sort())
        indices.add(final.indexOf(arrastada))
      }
      expect([...indices].sort()).toEqual([0, 1, 2])
    }
  })

  it("dá sempre números inteiros, que é o que o protocolo aceita", () => {
    for (const mudanca of largarCategoriaEm(ordem, declaradas, "Voz", "Início")) {
      expect(Number.isInteger(mudanca.position)).toBe(true)
    }
  })

  it("não publica as que já estavam no número certo", () => {
    // Swapping the first two leaves the third where it was.
    const mudancas = largarCategoriaEm(ordem, declaradas, "Notícias", "Início")
    expect(mudancas.map((m) => m.category)).toEqual(["Notícias", "Início"])
  })

  it("não mexe em nada quando se larga em cima de si própria", () => {
    expect(largarCategoriaEm(ordem, declaradas, "Voz", "Voz")).toEqual([])
  })

  it("ignora nomes que não estão na lista", () => {
    expect(largarCategoriaEm(ordem, declaradas, "Fantasma", "Voz")).toEqual([])
    expect(largarCategoriaEm(ordem, declaradas, "Voz", "Fantasma")).toEqual([])
  })
})

describe("categorias sem declaração publicada", () => {
  // The most likely case: old categories came from the `category` field on rooms
  // and never had their own declaration.
  const ordem = ["Início", "Notícias", "Voz"]

  it("declara a lista toda no primeiro arrasto", () => {
    const mudancas = largarCategoriaEm(ordem, [], "Voz", "Início")
    expect(mudancas).toEqual([
      { category: "Voz", position: 0 },
      { category: "Início", position: 100 },
      { category: "Notícias", position: 200 },
    ])
  })

  it("declarar só a arrastada não chegava — por isso declara-se o resto", () => {
    // Without declaration, `useRooms` sends the category to the end. If only the
    // dragged one became declared, it would jump to the top wherever you dropped it:
    // here, dropping "Home" at the end would have put it first.
    const mudancas = largarCategoriaEm(ordem, [], "Início", "Voz")
    expect(ordemFinal(ordem, [], mudancas)).toEqual(["Notícias", "Voz", "Início"])
  })

  it("cala-se nos arrastos seguintes, já com tudo declarado", () => {
    const primeiro = largarCategoriaEm(ordem, [], "Voz", "Início")
    const depois = ordemFinal(ordem, [], primeiro)
    // Voice, Home, News, swapping the bottom two leaves the top one untouched.
    const segundo = largarCategoriaEm(depois, primeiro, "Notícias", "Início")
    expect(segundo.map((m) => m.category)).toEqual(["Notícias", "Início"])
  })

  it("mistura declaradas e indeclaradas sem deixar nenhuma para trás", () => {
    const mudancas = largarCategoriaEm(ordem, [{ category: "Início", position: 0 }], "Notícias", "Início")
    expect(ordemFinal(ordem, [{ category: "Início", position: 0 }], mudancas)).toEqual([
      "Notícias",
      "Início",
      "Voz",
    ])
  })
})

describe("as salas soltas", () => {
  // The uncategorized group has no header, so it has no handle and no drop target. It stays
  // at the top, and a statement with an empty name never leaves here.
  const ordem = ["", "Início", "Voz"]
  const declaradas = [
    { category: "Início", position: 0 },
    { category: "Voz", position: 100 },
  ]

  it("nunca são declaradas", () => {
    const mudancas = largarCategoriaEm(ordem, declaradas, "Voz", "Início")
    expect(mudancas.map((m) => m.category)).not.toContain("")
  })

  it("não contam para a numeração das outras", () => {
    // "Home" comes second, so it lands at step 100, not 200, which
    // would happen if loose rooms took up a slot.
    const mudancas = largarCategoriaEm(ordem, declaradas, "Voz", "Início")
    expect(mudancas).toEqual([
      { category: "Voz", position: 0 },
      { category: "Início", position: 100 },
    ])
  })

  it("não se arrastam nem recebem", () => {
    expect(largarCategoriaEm(ordem, declaradas, "", "Voz")).toEqual([])
    expect(largarCategoriaEm(ordem, declaradas, "Voz", "")).toEqual([])
  })

  it("estar ou não na lista não muda o sentido do arrasto", () => {
    // The sidebar calls `largaDepois` with the list it draws, loose rooms included; the
    // sorter filters them before counting. Removing something from the middle that is neither
    // the dragged item nor the target does not change their relative order, and that is why
    // both agree without having to share the list.
    expect(largaDepois(ordem, "Início", "Voz")).toBe(largaDepois(["Início", "Voz"], "Início", "Voz"))
    expect(largaDepois(ordem, "Voz", "Início")).toBe(largaDepois(["Início", "Voz"], "Voz", "Início"))
  })
})

describe("o lado onde a categoria vai ficar", () => {
  const ordem = ["Início", "Notícias", "Voz"]

  it("depois do alvo quando desce", () => {
    expect(largaDepois(ordem, "Início", "Voz")).toBe(true)
  })

  it("antes do alvo quando sobe", () => {
    expect(largaDepois(ordem, "Voz", "Início")).toBe(false)
  })

  it("é a mesma regra que arruma, e não uma segunda cópia dela", () => {
    // The mark drawn and the place where the category lands must agree,
    // otherwise the visual feedback lies about the result of the gesture.
    for (const arrastada of ordem) {
      for (const alvo of ordem) {
        if (arrastada === alvo) continue
        const final = ordemFinal(ordem, [], largarCategoriaEm(ordem, [], arrastada, alvo))
        const depois = final.indexOf(arrastada) > final.indexOf(alvo)
        expect(depois).toBe(largaDepois(ordem, arrastada, alvo))
      }
    }
  })
})

describe("as que ficaram para trás", () => {
  const mudancas = [
    { category: "Início", position: 0 },
    { category: "Voz", position: 100 },
  ]

  it("nomeia só as que não passaram", () => {
    const resultados: PromiseSettledResult<unknown>[] = [
      { status: "rejected", reason: new Error("não deu") },
      { status: "fulfilled", value: { ok: true } },
    ]
    expect(asQueFicaramParaTras(mudancas, resultados)).toEqual(["Início"])
  })

  it("cala-se quando passou tudo", () => {
    const resultados: PromiseSettledResult<unknown>[] = [
      { status: "fulfilled", value: { ok: true } },
      { status: "fulfilled", value: { ok: true } },
    ]
    expect(asQueFicaramParaTras(mudancas, resultados)).toEqual([])
  })
})

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * A grid with N areas needs N heights. Count them, don't assume.
 *
 * On August 19, 2026, `.main.sem-cabecalho` gave SEVEN values to `grid-template-rows` in a grid whose `grid-template-areas` declares EIGHT rows. The CSS is valid, the eighth row gets `auto` and no one complains, but all seven values slide up one area. The `minmax(0, 1fr)`, the license to grow, would end up on the `intro` row, which on that screen is empty; and the `timeline` row, where the contact list lives, would be `auto`.
 
 What showed up: the search box and the contacts stuck to the BOTTOM of the window, with 244px of nothing above them. What the tests saw: nothing. The `build` passed, the whole suite passed, and `typecheck` has no opinion about stylesheets. **jsdom doesn't apply any CSS**, there aren't even grid lines to count.
 
 * This counts them in the file. It doesn't replace `scripts/medir-contactos.mjs`, which opens the page in a real browser and proves the result; it exists because a browser doesn't run in each `npm test` and this error is arithmetic, which you catch by reading.
 
 * **What it does NOT cover, stated so you don't trust too much:** it only looks at rules whose selector names a class that also defines `grid-template-areas` in the same file. A grid built with variables, or split across two files, passes under its nose.
 */

function raiz(): string {
  const meu = expect.getState().testPath
  if (!meu) throw new Error("sem caminho do teste: não há folha que ler")
  return dirname(meu)
}

/** A flattened CSS rule: the selector, and the body between braces. */
interface Regra {
  selector: string
  corpo: string
}

/**
 * The top-level rules of a stylesheet.
 
 * Deliberately naive and enough for what the script asks: it catches first-level rules and rules inside a `@media`, which is where the product has theirs. Remove comments first, otherwise a brace written in a note breaks the count.
 */
function regras(folha: string): Regra[] {
  const limpa = folha.replace(/\/\*[\s\S]*?\*\//g, "")
  const achadas: Regra[] = []
  let selector = ""
  let profundidade = 0
  let corpo = ""
  for (const carácter of limpa) {
    if (carácter === "{") {
      profundidade += 1
      if (profundidade === 1) {
        corpo = ""
        continue
      }
    }
    if (carácter === "}") {
      profundidade -= 1
      if (profundidade === 0) {
        // A `@media` brings rules inside it: they enter by recursion.
        if (selector.trim().startsWith("@")) achadas.push(...regras(corpo))
        else achadas.push({ selector: selector.trim(), corpo })
        selector = ""
        continue
      }
    }
    if (profundidade === 0) selector += carácter
    else corpo += carácter
  }
  return achadas
}

/** The value of a property inside a rule body, or null. */
function propriedade(corpo: string, nome: string): string | null {
  const achado = new RegExp(`(?:^|;)\\s*${nome}\\s*:([^;}]*)`).exec(corpo)
  return achado ? achado[1]!.trim() : null
}

/**
 * How many rows a `grid-template-areas` declares.
 
 * One row per quoted string: `"banner" "topbar" …` are two rows, written in two strings, whether they're on two lines of the file or one.
 */
function linhasDeAreas(valor: string): number {
  return [...valor.matchAll(/"[^"]*"/g)].length
}

/**
 * How many heights a `grid-template-rows` declares.
 
 * Count the top-level values: `minmax(0, 1fr)` is ONE, and the comma inside it can't count as a separator. Hence the paren depth.
 */
function contarAlturas(valor: string): number {
  let profundidade = 0
  let dentro = false
  let quantos = 0
  for (const carácter of valor.trim()) {
    if (carácter === "(") profundidade += 1
    if (carácter === ")") profundidade -= 1
    const espaço = /\s/.test(carácter) && profundidade === 0
    if (espaço) {
      dentro = false
      continue
    }
    if (!dentro) {
      quantos += 1
      dentro = true
    }
  }
  return quantos
}

const FOLHA = readFileSync(join(raiz(), "screens.css"), "utf8")
const REGRAS = regras(FOLHA)

/**
 * The classes that declare areas, and how many rows each has.
 
 * By the LAST class in the selector, which is what the rule characterizes: `.main.with-members` redeclares the areas of `.main` and has its own.
 */
function areasPorSelector(): Map<string, number> {
  const mapa = new Map<string, number>()
  for (const regra of REGRAS) {
    const areas = propriedade(regra.corpo, "grid-template-areas")
    if (areas) mapa.set(regra.selector, linhasDeAreas(areas))
  }
  return mapa
}

describe("as grelhas dos ecrãs: tantas alturas quantas as linhas", () => {
  it("o .main declara oito áreas — é a grelha da conversa e é ela que manda", () => {
    const areas = areasPorSelector()
    expect(areas.get(".main")).toBe(8)
  })

  it("cada variante do .main dá exactamente oito alturas, e não sete", () => {
    /*
      The variants: any rule whose selector starts with `.main` and changes `grid-template-rows`. That's where the error fits, because whoever writes the variant is looking at what they want to change (the header to zero) and not at the whole count.
      */
    const erradas: string[] = []
    for (const regra of REGRAS) {
      if (!/^\.main\b/.test(regra.selector)) continue
      const alturas = propriedade(regra.corpo, "grid-template-rows")
      if (!alturas) continue
      // A variant that redeclares the areas is answerable for them, not the eight.
      const proprias = propriedade(regra.corpo, "grid-template-areas")
      const esperadas = proprias ? linhasDeAreas(proprias) : 8
      const dadas = contarAlturas(alturas)
      if (dadas !== esperadas) erradas.push(`${regra.selector}: ${dadas} alturas para ${esperadas} linhas — "${alturas}"`)
    }
    expect(erradas, `grelhas com alturas a menos ou a mais:\n${erradas.join("\n")}`).toEqual([])
  })

  it("e o mesmo vale para qualquer grelha da folha que declare as duas coisas", () => {
    const erradas: string[] = []
    for (const regra of REGRAS) {
      const areas = propriedade(regra.corpo, "grid-template-areas")
      const alturas = propriedade(regra.corpo, "grid-template-rows")
      if (!areas || !alturas) continue
      const linhas = linhasDeAreas(areas)
      const dadas = contarAlturas(alturas)
      if (dadas !== linhas) erradas.push(`${regra.selector}: ${dadas} alturas para ${linhas} linhas`)
    }
    expect(erradas, `grelhas desalinhadas:\n${erradas.join("\n")}`).toEqual([])
  })

  it("a contagem sabe ler um minmax sem se enganar na vírgula", () => {
    // The tool's own trap: `minmax(0, 1fr)` is ONE value.
    expect(contarAlturas("auto 46px auto auto auto minmax(0, 1fr) auto auto")).toBe(8)
    expect(contarAlturas("auto 0 auto auto minmax(0, 1fr) auto auto")).toBe(7)
    expect(contarAlturas("  minmax(0,1fr)  ")).toBe(1)
  })

  it("e sabe contar as linhas de umas áreas escritas numa linha só", () => {
    expect(linhasDeAreas('"banner" "topbar" "timeline"')).toBe(3)
    expect(linhasDeAreas('"call     members"\n"timeline members"')).toBe(2)
  })
})

/**
 * The app grid in wide layout: left margin equal to column gap.
 
 * The left side had only the notch (`--seguro-esquerda`), and the icon bar was stuck to the window edge with margin on the right. Read the file because jsdom doesn't apply CSS: the rule is arithmetic and you catch it by reading.
 */
describe("a grelha da app: a margem da esquerda é a do column-gap", () => {
  /** The top-level values of a shorthand like `padding`, without breaking `calc(…)`. */
  function valoresDeTopo(valor: string): string[] {
    const valores: string[] = []
    let profundidade = 0
    let actual = ""
    for (const carácter of valor.trim()) {
      if (carácter === "(") profundidade += 1
      if (carácter === ")") profundidade -= 1
      if (/\s/.test(carácter) && profundidade === 0) {
        if (actual) valores.push(actual)
        actual = ""
        continue
      }
      actual += carácter
    }
    if (actual) valores.push(actual)
    return valores.map((v) => v.replace(/\s+/g, " "))
  }

  it("o padding-left soma o column-gap ao entalhe", () => {
    const pele = regras(readFileSync(join(raiz(), "pele.css"), "utf8"))
    const app = pele.find((regra) => regra.selector === ":root .app" && propriedade(regra.corpo, "column-gap"))
    expect(app, "a regra `:root .app` da composição larga").toBeTruthy()
    const gap = propriedade(app!.corpo, "column-gap")!
    const padding = valoresDeTopo(propriedade(app!.corpo, "padding")!.replace(/\s+/g, " "))
    expect(padding).toHaveLength(4)
    expect(padding[3]).toBe(`calc(${gap} + var(--seguro-esquerda))`)
  })
})

import { describe, expect, it } from "vitest"
import { analisarFormatacao, type Pedaco } from "./formatacao.js"

/** All the text back around, to prove nothing gets lost along the way. */
function texto(pedacos: Pedaco[]): string {
  return pedacos
    .map((p) => {
      if (p.tipo === "texto") return p.texto
      if (p.tipo === "codigo") return p.texto
      return texto(p.filhos)
    })
    .join("")
}

describe("analisarFormatacao", () => {
  it("texto sem marcadores fica um pedaço só", () => {
    expect(analisarFormatacao("olá, tudo bem?")).toEqual([{ tipo: "texto", texto: "olá, tudo bem?" }])
  })

  it("negrito, itálico e código", () => {
    expect(analisarFormatacao("**forte**")).toEqual([{ tipo: "forte", filhos: [{ tipo: "texto", texto: "forte" }] }])
    expect(analisarFormatacao("*leve*")).toEqual([{ tipo: "enfase", filhos: [{ tipo: "texto", texto: "leve" }] }])
    expect(analisarFormatacao("`npm test`")).toEqual([{ tipo: "codigo", texto: "npm test" }])
  })

  it("o negrito é lido antes do itálico", () => {
    // The other way, `**a**` read as two empty italics pressed together.
    const [pedaco] = analisarFormatacao("**a**")
    expect(pedaco?.tipo).toBe("forte")
  })

  it("marcadores no meio de uma frase", () => {
    expect(analisarFormatacao("isto é **mesmo** urgente")).toEqual([
      { tipo: "texto", texto: "isto é " },
      { tipo: "forte", filhos: [{ tipo: "texto", texto: "mesmo" }] },
      { tipo: "texto", texto: " urgente" },
    ])
  })

  it("dois negritos seguidos não se comem o meio", () => {
    const pedacos = analisarFormatacao("**a** e **b**")
    expect(pedacos.map((p) => p.tipo)).toEqual(["forte", "texto", "forte"])
    expect(texto(pedacos)).toBe("a e b")
  })

  it("aninha: itálico dentro de negrito", () => {
    expect(analisarFormatacao("**muito *muito* urgente**")).toEqual([
      {
        tipo: "forte",
        filhos: [
          { tipo: "texto", texto: "muito " },
          { tipo: "enfase", filhos: [{ tipo: "texto", texto: "muito" }] },
          { tipo: "texto", texto: " urgente" },
        ],
      },
    ])
  })
})

/**
 * What is between backticks is LITERAL.
 *
 * That is what "code" means, and that is why it is read first: an asterisk
 * inside a command is part of the command.
 */
describe("o código é literal por dentro", () => {
  it("os asteriscos lá dentro não formatam nada", () => {
    expect(analisarFormatacao("`rm -rf *.log`")).toEqual([{ tipo: "codigo", texto: "rm -rf *.log" }])
    expect(analisarFormatacao("`a **b** c`")).toEqual([{ tipo: "codigo", texto: "a **b** c" }])
  })
})

/**
 * The three of them have to live together without eating each other.
 *
 * This section is what justifies the whole file: without the protected zones, an
 * address with asterisks would get broken, and an address cannot break in a
 * product where it is meant to be carried.
 */
describe("endereços e menções são zonas protegidas", () => {
  it("um asterisco dentro de um endereço NÃO abre itálico", () => {
    const url = "https://exemplo.pt/a*b*c"
    expect(analisarFormatacao(url)).toEqual([{ tipo: "texto", texto: url }])
  })

  it("um sublinhado num endereço nunca foi itálico, e continua a não ser", () => {
    // The decision this product made the other way from Markdown: underscore is not
    // syntax. `exemplo.pt/a_b_c` is an ordinary path.
    const url = "https://exemplo.pt/relatorio_final_v2.pdf"
    expect(analisarFormatacao(url)).toEqual([{ tipo: "texto", texto: url }])
    expect(analisarFormatacao("o _mais_ importante")).toEqual([{ tipo: "texto", texto: "o _mais_ importante" }])
  })

  it("mas um endereço DENTRO de negrito continua a ser um endereço", () => {
    // The protection is on the markers, not on the text: these `**` are outside the
    // address, so they count.
    expect(analisarFormatacao("**vê https://exemplo.pt hoje**")).toEqual([
      { tipo: "forte", filhos: [{ tipo: "texto", texto: "vê https://exemplo.pt hoje" }] },
    ])
  })

  it("uma menção não é comida por marcadores à volta dela", () => {
    const pedacos = analisarFormatacao("**@tectytus-xilvemor-tascoris-volpilo:s vê isto**")
    expect(pedacos[0]?.tipo).toBe("forte")
    expect(texto(pedacos)).toBe("@tectytus-xilvemor-tascoris-volpilo:s vê isto")
  })
})

/**
 * Nothing that was written disappears from the screen.
 *
 * **The guarantee, stated precisely:** the LETTERS always arrive whole. Markers
 * that paired up are consumed, that is what they are for, and those that did
 * not pair stay visible exactly as is. A parser that swallowed text looking for a
 * nonexistent pair would lose other people's sentences, and that was the worst
 * flaw this could have.
 */
describe("marcadores sem par ficam letras", () => {
  const soltos = [
    // Arithmetic, which is the real-world case: without the spacing rule, the " 4 "
    // in the middle would be in italic.
    "2 * 3 = 6",
    "5 * 4 * 3",
    "3 ** 2 é nove",
    "**sem fecho",
    "*sem fecho",
    "`sem fecho",
    "a ** b",
    "****",
    "**",
    "*",
    "``",
    "a*b",
  ]

  for (const entrada of soltos) {
    it(`"${entrada}" chega inteiro ao outro lado`, () => {
      expect(texto(analisarFormatacao(entrada))).toBe(entrada)
    })
  }

  it("um marcador vazio não vira pedaço nenhum", () => {
    // `****` is four written asterisks, not bold of anything.
    expect(analisarFormatacao("****")).toEqual([{ tipo: "texto", texto: "****" }])
    expect(analisarFormatacao("``")).toEqual([{ tipo: "texto", texto: "``" }])
  })

  it("um asterisco encostado a um espaço não abre nada", () => {
    // The spacing rule, isolated: `* a*` is not italic because the first asterisk
    // has a space in front.
    expect(analisarFormatacao("* a*")).toEqual([{ tipo: "texto", texto: "* a*" }])
    expect(analisarFormatacao("*a *")).toEqual([{ tipo: "texto", texto: "*a *" }])
  })
})

describe("o texto sobrevive sempre", () => {
  it("as letras chegam inteiras, aconteça o que acontecer aos marcadores", () => {
    const casos: [string, string][] = [
      ["**a** *b* `c`", "a b c"],
      ["texto normal", "texto normal"],
      ["**a *b* c**", "a b c"],
      ["", ""],
      ["   ", "   "],
      // Ambiguous entries: the markers pair up somehow, and what you keep is that
      // the LETTERS all stay and in the same order.
      ["*a**b*", "ab"],
      ["**a* b", "*a b"],
    ]
    for (const [entrada, esperado] of casos) {
      expect(texto(analisarFormatacao(entrada))).toBe(esperado)
    }
  })

  it("nenhuma letra se perde, seja o que for que se escreva", () => {
    // The network underneath everything, and the most valuable: strip what is a
    // marker from both sides and what is left has to be the same.
    const semMarcadores = (s: string): string => s.replace(/[*`]/g, "")
    const entradas = [
      "**forte** e *leve* e `código`",
      "5 * 4 * 3 = 60",
      "vê https://exemplo.pt/a*b*c agora",
      "**@tectytus-xilvemor-tascoris-volpilo:s olha**",
      "`rm -rf *.log` cuidado",
      "*a**b***c*",
      "```",
      "**a *b **c* d**",
    ]
    for (const entrada of entradas) {
      expect(semMarcadores(texto(analisarFormatacao(entrada)))).toBe(semMarcadores(entrada))
    }
  })
})

/**
 * Strikethrough and spoiler, which came after the other three.
 *
 * Both markers are TWO characters, and that is not aesthetics: a `~` alone
 * shows up in `~/documentos` and in an approximation (`~5 minutos`), and a `|`
 * alone shows up in tables and in any command with a pipe through it. Either
 * one counting as syntax would break text that people write every day, which is
 * the same reason underline was never italic here.
 */
describe("rasurado e coberto", () => {
  it("dois tis riscam, duas barras cobrem", () => {
    expect(analisarFormatacao("~~errado~~")).toEqual([
      { tipo: "rasurado", filhos: [{ tipo: "texto", texto: "errado" }] },
    ])
    expect(analisarFormatacao("||o assassino é o mordomo||")).toEqual([
      { tipo: "spoiler", filhos: [{ tipo: "texto", texto: "o assassino é o mordomo" }] },
    ])
  })

  it("um ti sozinho e uma barra sozinha não são sintaxe nenhuma", () => {
    expect(analisarFormatacao("~aproximado~")).toEqual([{ tipo: "texto", texto: "~aproximado~" }])
    expect(analisarFormatacao("o ficheiro ~/notas.md")).toEqual([{ tipo: "texto", texto: "o ficheiro ~/notas.md" }])
    expect(analisarFormatacao("|coluna|")).toEqual([{ tipo: "texto", texto: "|coluna|" }])
  })

  it("aninham com os outros, nos dois sentidos", () => {
    expect(analisarFormatacao("||o **fim**||")).toEqual([
      {
        tipo: "spoiler",
        filhos: [
          { tipo: "texto", texto: "o " },
          { tipo: "forte", filhos: [{ tipo: "texto", texto: "fim" }] },
        ],
      },
    ])
    expect(analisarFormatacao("**~~não~~ sim**")).toEqual([
      {
        tipo: "forte",
        filhos: [
          { tipo: "rasurado", filhos: [{ tipo: "texto", texto: "não" }] },
          { tipo: "texto", texto: " sim" },
        ],
      },
    ])
  })

  it("dentro de código continuam letras", () => {
    expect(analisarFormatacao("`a || b ~~c~~`")).toEqual([{ tipo: "codigo", texto: "a || b ~~c~~" }])
  })

  it("dentro de um endereço não contam", () => {
    // The same protected zone as the asterisks. An address with tildes is rare but
    // exists, and a broken address is always worse than a strike that did not strike.
    const url = "https://exemplo.pt/a~~b~~c"
    expect(analisarFormatacao(url)).toEqual([{ tipo: "texto", texto: url }])
  })

  it("a regra do encosto vale para os dois", () => {
    // `a || b` is a logical or, and no one writes redacted with spaces glued to the
    // inside of the markers.
    expect(analisarFormatacao("a || b")).toEqual([{ tipo: "texto", texto: "a || b" }])
    expect(analisarFormatacao("x ~~ y")).toEqual([{ tipo: "texto", texto: "x ~~ y" }])
  })

  it("o lado que ABRE também tem de estar encostado, e não só o que fecha", () => {
    /*
      This case came from a mutation, and that is why it is written separately.

      I removed the spacing check on the opening marker and the suite turned green:
      the examples above, `a || b`, `x ~~ y`, did not exercise it, because the
      side that CLOSES rejected them the same way and for another reason. In other
      words: half the rule was not pinned by any test.

      Here both sides disagree on purpose. The one that opens has a space in front
      (should not open); the one that closes is pressed (would close happily). Only
      the rule on the opening side saves this.
    */
    expect(analisarFormatacao("a || b|| c")).toEqual([{ tipo: "texto", texto: "a || b|| c" }])
    expect(analisarFormatacao("x ~~ y~~ z")).toEqual([{ tipo: "texto", texto: "x ~~ y~~ z" }])
  })

  const soltos = ["~~sem fecho", "||sem fecho", "~~", "||", "~~~~", "||||", "a || b || c", "5 ~~ 3"]
  for (const entrada of soltos) {
    it(`"${entrada}" chega inteiro ao outro lado`, () => {
      expect(texto(analisarFormatacao(entrada))).toBe(entrada)
    })
  }

  it("nenhuma letra se perde com os cinco marcadores à solta", () => {
    const semMarcadores = (s: string): string => s.replace(/[*`~|]/g, "")
    const entradas = [
      "||**forte** e ~~riscado~~||",
      "~~a *b* c~~ e ||d||",
      "a || b ~~ c",
      "||~~||~~||",
      "vê https://exemplo.pt/a||b||c agora",
    ]
    for (const entrada of entradas) {
      expect(semMarcadores(texto(analisarFormatacao(entrada)))).toBe(semMarcadores(entrada))
    }
  })
})

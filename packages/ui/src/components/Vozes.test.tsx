import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { desenharVozes, Vozes, VOZES_A_VISTA } from "./Vozes.js"
import { pt } from "../linguas/pt.js"
import { en } from "../linguas/en.js"

afterEach(cleanup)

/**
 * The voices: the symbol that replaced the "in call" pill.
 *
 * Three groups. The first holds the WORD, which is what text-to-drawing conversion
 * puts at risk and what the view does not show when it is lost. The second
 * holds the COUNT: the drawing asserts a number of people, and a drawing that
 * counts wrong is worse than a pill that did not count. The third holds MOVEMENT,
 * because the house rule (see `Onda.tsx`) is that nothing moves without measurement.
 */
describe("vozes: a palavra que o desenho não pode levar consigo", () => {
  it("anuncia-se por palavras, e diz o mesmo a quem pousa o rato", () => {
    render(<Vozes outros={3} rotulo="3 pessoas em chamada" />)
    const simbolo = screen.getByRole("img", { name: "3 pessoas em chamada" })
    expect(simbolo.getAttribute("title")).toBe("3 pessoas em chamada")
  })

  it("o desenho não fala duas vezes: quem anuncia é o `<span>`", () => {
    const { container } = render(<Vozes outros={3} rotulo="x" />)
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
  })

  it("calado de propósito (`null`) sai da árvore inteiro, e não fica um `img` sem nome", () => {
    const { container } = render(<Vozes outros={3} rotulo={null} />)
    const simbolo = container.querySelector(".vozes")
    expect(simbolo?.getAttribute("aria-hidden")).toBe("true")
    expect(simbolo?.getAttribute("role")).toBeNull()
    expect(screen.queryByRole("img")).toBeNull()
  })

  /**
   * The check is about FORM, not `toContain(strings.x.y)`: with the key
   * missing, that comparison runs against `undefined` and passes. Here, any
   * combination that draws something must come out with a name or silent.
   */
  it("nenhuma combinação desenha um símbolo sem rótulo e sem estar calado", () => {
    for (const eu of [false, true]) {
      for (let outros = 0; outros <= VOZES_A_VISTA + 2; outros++) {
        for (const rotulo of ["dito", null]) {
          const { container, unmount } = render(<Vozes outros={outros} eu={eu} rotulo={rotulo} />)
          const simbolo = container.querySelector(".vozes")
          if (simbolo) {
            const nomeado = simbolo.getAttribute("role") === "img" && (simbolo.getAttribute("aria-label") ?? "") !== ""
            const calado = simbolo.getAttribute("aria-hidden") === "true"
            expect(nomeado !== calado, `outros=${outros} eu=${eu} rotulo=${rotulo}`).toBe(true)
          }
          unmount()
        }
      }
    }
  })

  it("as frases existem nas duas línguas, contam, e não dizem `undefined`", () => {
    // `en` is PARTIAL: a missing key falls back to Portuguese with no error, and
    // someone hearing the screen in English would then hear "3 people in call". So
    // we read `en` directly, not the already-merged `strings`.
    for (const [nome, barra] of [["pt", pt.sidebar], ["en", en.sidebar]] as const) {
      const { callPeople, callingYou, inCallWith } = barra ?? {}
      if (!callPeople || !callingYou || !inCallWith) throw new Error(`falta uma frase das vozes em ${nome}`)
      const frases = [callPeople(1), callPeople(4), callingYou("Ana"), inCallWith(0), inCallWith(1), inCallWith(6)]
      for (const frase of frases) {
        expect(typeof frase).toBe("string")
        expect(frase.length).toBeGreaterThan(8)
        expect(frase).not.toMatch(/undefined|NaN/)
        // House rule for new text.
        expect(frase).not.toContain("—")
      }
      expect(new Set(frases).size).toBe(frases.length)
      expect(callPeople(4)).toContain("4")
      expect(inCallWith(6)).toContain("6")
      expect(callingYou("Ana")).toContain("Ana")
    }
    // And the two languages do not say the same phrase: a translation that is a copy
    // passes everything that is above.
    expect(en.sidebar?.callPeople?.(4)).not.toBe(pt.sidebar.callPeople(4))
  })
})

describe("vozes: o desenho conta, e conta bem", () => {
  it("ninguém não se desenha", () => {
    expect(desenharVozes(0, false)).toBeNull()
    const { container } = render(<Vozes outros={0} rotulo="x" />)
    expect(container.firstChild).toBeNull()
  })

  it("uma voz sozinha chama, seja a de outra pessoa ou a nossa", () => {
    expect(desenharVozes(1, false)).toEqual({ forma: "chama", minha: false })
    expect(desenharVozes(0, true)).toEqual({ forma: "chama", minha: true })
  })

  it("duas ou mais: uma tarja por pessoa, até às que cabem", () => {
    for (let outros = 2; outros <= VOZES_A_VISTA; outros++) {
      const desenho = desenharVozes(outros, false)
      if (desenho?.forma !== "conversa") throw new Error("devia ser conversa")
      expect(desenho.tarjas).toHaveLength(outros)
      expect(desenho.mais).toBe(false)
    }
  })

  it("connosco lá dentro há mais uma, é a primeira, e é a única que é nossa", () => {
    const desenho = desenharVozes(2, true)
    if (desenho?.forma !== "conversa") throw new Error("devia ser conversa")
    expect(desenho.tarjas).toHaveLength(3)
    expect(desenho.tarjas.map((tarja) => tarja.minha)).toEqual([true, false, false])
  })

  it("a nossa tarja escorregou do eixo: o centro dela fica abaixo do de todas as outras", () => {
    const desenho = desenharVozes(VOZES_A_VISTA, true)
    if (desenho?.forma !== "conversa") throw new Error("devia ser conversa")
    const centro = (tarja: { y: number; altura: number }): number => tarja.y + tarja.altura / 2
    const [minha, ...outras] = desenho.tarjas
    if (!minha) throw new Error("falta a nossa")
    for (const outra of outras) expect(centro(minha)).toBeGreaterThan(centro(outra) + 1)
  })

  it("quem chega acrescenta uma tarja e não mexe nas que já lá estavam", () => {
    const antes = desenharVozes(3, false)
    const depois = desenharVozes(4, false)
    if (antes?.forma !== "conversa" || depois?.forma !== "conversa") throw new Error("devia ser conversa")
    expect(depois.tarjas.slice(0, 3)).toEqual(antes.tarjas)
  })

  it("passadas as que cabem, um `+` e nem mais uma tarja", () => {
    const desenho = desenharVozes(VOZES_A_VISTA + 7, true)
    if (desenho?.forma !== "conversa") throw new Error("devia ser conversa")
    expect(desenho.tarjas).toHaveLength(VOZES_A_VISTA + 1)
    expect(desenho.mais).toBe(true)
  })

  it("nenhuma tarja sai da caixa, e nenhuma se sobrepõe à vizinha", () => {
    for (const eu of [false, true]) {
      for (let outros = 2; outros <= VOZES_A_VISTA + 1; outros++) {
        const desenho = desenharVozes(outros, eu)
        if (desenho?.forma !== "conversa") continue
        desenho.tarjas.forEach((tarja, indice) => {
          expect(tarja.y).toBeGreaterThanOrEqual(0)
          expect(tarja.y + tarja.altura).toBeLessThanOrEqual(16)
          expect(tarja.x + 4).toBeLessThanOrEqual(desenho.largura)
          const seguinte = desenho.tarjas[indice + 1]
          // A gap of at least 3: at 2 the banners read as one blur only.
          if (seguinte) expect(seguinte.x - (tarja.x + 4)).toBeGreaterThanOrEqual(3)
        })
      }
    }
  })

  it("tudo cai em píxel inteiro, para não esborratar a 1x nem a 2x", () => {
    for (const eu of [false, true]) {
      for (let outros = 2; outros <= VOZES_A_VISTA + 1; outros++) {
        const desenho = desenharVozes(outros, eu)
        if (desenho?.forma !== "conversa") continue
        expect(Number.isInteger(desenho.largura)).toBe(true)
        for (const tarja of desenho.tarjas) {
          for (const medida of [tarja.x, tarja.y, tarja.altura]) expect(Number.isInteger(medida)).toBe(true)
        }
      }
    }
    // And in what goes to the screen, including the `+`.
    const { container } = render(<Vozes outros={VOZES_A_VISTA + 3} eu rotulo="x" />)
    for (const rect of container.querySelectorAll("rect")) {
      for (const nome of ["x", "y", "width", "height"]) {
        expect(Number.isInteger(Number(rect.getAttribute(nome))), `${nome}=${rect.getAttribute(nome)}`).toBe(true)
      }
    }
  })

  it("vizinhas nunca têm alturas parecidas: a diferença é de 4 ou mais", () => {
    const desenho = desenharVozes(VOZES_A_VISTA, true)
    if (desenho?.forma !== "conversa") throw new Error("devia ser conversa")
    desenho.tarjas.forEach((tarja, i) => {
      const seguinte = desenho.tarjas[i + 1]
      if (seguinte) expect(Math.abs(seguinte.altura - tarja.altura)).toBeGreaterThanOrEqual(4)
    })
  })

  it("as alturas não sobem em escada: isto não é um medidor de rede", () => {
    const desenho = desenharVozes(VOZES_A_VISTA, true)
    if (desenho?.forma !== "conversa") throw new Error("devia ser conversa")
    const alturas = desenho.tarjas.map((tarja) => tarja.altura)
    const crescente = alturas.every((altura, i) => i === 0 || altura >= (alturas[i - 1] as number))
    const primeirasTres = alturas.slice(0, 3)
    expect(crescente).toBe(false)
    expect(primeirasTres[1]).toBeGreaterThan(primeirasTres[2] as number)
  })

  it("veste a cor por herança, para o `--accent` viver no CSS", () => {
    const { container } = render(<Vozes outros={3} eu rotulo="x" />)
    for (const rect of container.querySelectorAll("rect")) expect(rect.getAttribute("fill")).toBe("currentColor")
  })
})

describe("vozes: nada se mexe sem medir", () => {
  const folha = (): string => {
    const meu = expect.getState().testPath
    if (!meu) throw new Error("sem caminho do teste")
    return readFileSync(join(dirname(meu), "..", "styles", "vozes.css"), "utf8")
  }
  /** The sheet without comments: the comments talk about `var()` and `infinite`. */
  const regras = (): string => folha().replace(/\/\*[\s\S]*?\*\//g, "")

  it("há UMA animação, corre um número contado de vezes, e nunca para sempre", () => {
    const animacoes = [...regras().matchAll(/animation:\s*([^;]+);/g)].map((m) => (m[1] ?? "").trim())
    const vivas = animacoes.filter((valor) => valor !== "none")
    expect(vivas).toHaveLength(1)
    expect(vivas[0]).not.toContain("infinite")
  })

  it("os fotogramas só mexem `transform`, e sem `var()` (que tira a animação ao compositor)", () => {
    const fotogramas = regras().match(/@keyframes\s+vozes-chamar\s*\{([\s\S]*?\})\s*\}/)?.[1] ?? ""
    expect(fotogramas).not.toBe("")
    expect(fotogramas).not.toContain("var(")
    const propriedades = [...fotogramas.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1])
    expect(new Set(propriedades)).toEqual(new Set(["transform"]))
  })

  it("quem pediu menos movimento não vê gesto nenhum", () => {
    expect(regras()).toMatch(/prefers-reduced-motion:\s*reduce\)\s*\{\s*\.vozes-badalo\s*\{\s*animation:\s*none/)
  })
})

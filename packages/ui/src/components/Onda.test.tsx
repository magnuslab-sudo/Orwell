import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { Onda } from "./Onda.js"

afterEach(cleanup)

const AQUI = dirname(fileURLToPath(import.meta.url))
const FOLHA = readFileSync(join(AQUI, "../styles/components.css"), "utf8")

/** The block of a rule, from the selector to the closing brace. */
function regra(selector: string): string {
  const inicio = FOLHA.indexOf(`${selector} {`)
  expect(inicio, `não encontrei a regra ${selector}`).toBeGreaterThan(-1)
  return FOLHA.slice(inicio, FOLHA.indexOf("}", inicio) + 1)
}

describe("Onda — o que se desenha", () => {
  it("desenha o número de barras que lhe pedem", () => {
    const { container } = render(<Onda barras={5} />)
    expect(container.querySelectorAll(".onda-barra")).toHaveLength(5)
  })

  it("as do meio são mais altas do que as das pontas: é uma onda, não um bloco", () => {
    const { container } = render(<Onda barras={5} />)
    const pesos = [...container.querySelectorAll<HTMLElement>(".onda-barra")].map((barra) =>
      Number(barra.style.getPropertyValue("--peso")),
    )

    expect(pesos[2]).toBeGreaterThan(pesos[0]!)
    expect(pesos[2]).toBeGreaterThan(pesos[4]!)
    // And symmetric: a crooked wave reads as a misalignment defect.
    expect(pesos[0]).toBeCloseTo(pesos[4]!, 3)
  })

  it("cada barra arranca ao seu nível, senão sobem todas ao mesmo tempo", () => {
    /*
      Without different steps, five bars with proportional heights read as one
      object inflating and deflating. What makes it look like voice is them
      responding at different heights on the scale: the middle one starts at zero
      and the ones at the ends near the end, so the wave WIDENS with the voice.
    */
    const { container } = render(<Onda barras={5} />)
    const degraus = [...container.querySelectorAll<HTMLElement>(".onda-barra")].map((barra) =>
      Number(barra.style.getPropertyValue("--degrau")),
    )

    expect(degraus[2]).toBe(0)
    expect(degraus[0]).toBeGreaterThan(degraus[1]!)
    expect(degraus[1]).toBeGreaterThan(degraus[2]!)
    // Symmetric, like the shape: the wave grows to both sides at the same time.
    expect(degraus[0]).toBeCloseTo(degraus[4]!, 3)
  })

  it("o repouso e a barra mais alta somam exactamente a caixa", () => {
    /*
      At maximum voice, the middle bar has to reach the height of the box: more
      than that and it overflows the wave and the card containing it; less and
      the wave never reaches the end. The two halves of this calculation are
      emitted from here, CSS only adds them up, and that is what stops one of
      them from changing without the other.
      */
    const { container } = render(<Onda barras={5} />)
    const repouso = Number(container.querySelector<HTMLElement>(".onda")!.style.getPropertyValue("--repouso"))
    const barra = container.querySelectorAll<HTMLElement>(".onda-barra")[2]!

    expect(repouso).toBeGreaterThan(0)
    expect(repouso + Number(barra.style.getPropertyValue("--peso"))).toBeCloseTo(1, 2)
  })

  it("desenha o mesmo em dois renders seguidos", () => {
    // If the shapes came from a draw, the wave would change shape every render
    // and a script that measures it would never measure the same thing twice.
    const primeiro = render(<Onda barras={5} />).container.innerHTML
    cleanup()
    expect(render(<Onda barras={5} />).container.innerHTML).toBe(primeiro)
  })

  it("está escondida de quem ouve o ecrã", () => {
    // A number that changes sixty times a second is not announced. The fact that
    // this wave illustrates is always written in text next to it.
    const { container } = render(<Onda barras={4} />)
    expect(container.querySelector(".onda")?.getAttribute("aria-hidden")).toBe("true")
  })
})

/**
 * The two promises that live in CSS and that a jsdom test does not see applied.
 *
 * jsdom does not apply any stylesheets, the one who verifies the drawing for
 * real is `scripts/medir-voz-visivel.mjs`, in Chromium. What is stored here
 * are the two decisions that, if someone undoes them, break the piece in silence
 * and in ways that give no error.
 */
describe("Onda — as duas armadilhas do CSS", () => {
  it("a onda NÃO declara `--voz`, ou ficava parada com o medidor a funcionar", () => {
    /*
      This is the trap par excellence of this piece. `--voz` is inherited from
      the card being measured; a `--voz: 0` declaration in the `.onda` rule gives
      a LOCAL value that shadows the card's, and the wave stays still forever with
      nothing giving an error. The resting value is written as `var(--voz, 0)`,
      which is the fallback for when no one measures, never as a declaration.
    */
    expect(regra(".onda")).not.toMatch(/--voz\s*:/)
    expect(regra(".onda-barra")).not.toMatch(/--voz\s*:/)
    expect(FOLHA).toContain("var(--voz, 0)")
  })

  it("o que muda com a voz é `transform` e cor, e mais nada", () => {
    /*
      This runs on each participant of each call. `height` or `margin` following
      the level would force the browser to redo the layout of the entire row
      sixty times a second, times the number of people. `transform` and color
      are the two that stay on the cheap side.

      The entire sheet is measured, not a single rule: a declaration depending on
      `--voz` placed elsewhere would cost the same and escape a test pointed at
      `.onda-barra`. Measured for real in `scripts/medir-voz-visivel.mjs`, which
      reads Chromium's counters and fails if the number of layouts grows.
    */
    const dependentes = [...FOLHA.matchAll(/^\s*([a-z-]+)\s*:[^;]*var\(--voz/gm)].map((achado) => achado[1])

    expect(dependentes.length).toBeGreaterThan(0)
    expect([...new Set(dependentes)].sort()).toEqual(["background", "transform"])
  })

  it("e não há animação nenhuma a correr quando ninguém fala", () => {
    /*
      There was, and it cost 562 µs per frame in a silent call against 51 µs
      without waves, 49 bars recalculated in the main thread sixty times a
      second to show nothing, because frames with `var()` do not go to the
      compositor. The drawing became a function of the level: in silence there
      is not a single calculation happening.
    */
    expect(FOLHA).not.toMatch(/@keyframes onda-/)
    expect(regra(".onda-barra")).not.toMatch(/animation/)
  })
})

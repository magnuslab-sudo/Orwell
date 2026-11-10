/**
 * The marquee (`Andante`): only what does not fit scrolls, and it scrolls even
 * with reduced motion.
 *
 * The second point came from a report by the owner on October 28, 2026: "the
 * marquee is not looping where it does not fit". The sheet would stop the
 * marquee with `prefers-reduced-motion`, which Windows with animations off
 * turns on by itself, and the text stayed cut off forever.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Andante } from "./Andante.js"

afterEach(cleanup)

/** Fake widths: jsdom does no layout and returns zero for everything. */
function fingirLarguras(caixa: number, texto: number): () => void {
  const originais = {
    clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
    scrollWidth: Object.getOwnPropertyDescriptor(Element.prototype, "scrollWidth"),
  }
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("andante-caixa") ? caixa : 0
    },
  })
  Object.defineProperty(Element.prototype, "scrollWidth", {
    configurable: true,
    get(this: Element) {
      return this.classList.contains("andante-caixa") || this.classList.contains("andante-fita") ? 0 : texto
    },
  })
  return () => {
    if (originais.clientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", originais.clientWidth)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)["clientWidth"]
    if (originais.scrollWidth) Object.defineProperty(Element.prototype, "scrollWidth", originais.scrollWidth)
    else delete (Element.prototype as unknown as Record<string, unknown>)["scrollWidth"]
  }
}

describe("Andante: anda só o que não cabe", () => {
  it("o que cabe fica parado, e sem segunda cópia", () => {
    const repor = fingirLarguras(200, 120)
    try {
      const { container } = render(<Andante className="x" texto="Em reunião" />)
      const caixa = container.querySelector(".andante-caixa")
      expect(caixa?.classList.contains("andante")).toBe(false)
      expect(container.querySelectorAll(".andante-fita > span")).toHaveLength(1)
    } finally {
      repor()
    }
  })

  it("o que não cabe anda, com a segunda cópia atrás para a volta não saltar", () => {
    const repor = fingirLarguras(120, 200)
    try {
      const { container } = render(<Andante className="x" texto="A escrever a tese até às tantas" />)
      const caixa = container.querySelector(".andante-caixa")
      expect(caixa?.classList.contains("andante")).toBe(true)
      const copias = container.querySelectorAll(".andante-fita > span")
      expect(copias).toHaveLength(2)
      expect(copias[1]?.getAttribute("aria-hidden")).toBe("true")
    } finally {
      repor()
    }
  })
})

describe("Andante: a folha", () => {
  const regras = (): string => {
    const meu = expect.getState().testPath
    if (!meu) throw new Error("sem caminho do teste")
    return readFileSync(join(dirname(meu), "..", "styles", "pele.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  }

  it("com movimento reduzido o letreiro continua a andar, mais devagar, e por cima da regra universal", () => {
    const bloco = regras().match(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.andante-caixa\.andante \.andante-fita \{([^}]*)\}/,
    )?.[1]
    expect(bloco, "o bloco de movimento reduzido do letreiro").toBeDefined()
    expect(bloco).toMatch(/animation:\s*call-dock-anda\s+\d+s\s+linear\s+infinite\s+!important/)
    expect(bloco).not.toContain("animation: none")
    const devagar = Number(/call-dock-anda\s+(\d+)s/.exec(bloco ?? "")?.[1])
    const normal = Number(/\.andante-caixa\.andante \.andante-fita \{[^}]*call-dock-anda\s+(\d+)s/.exec(regras())?.[1])
    expect(devagar).toBeGreaterThan(normal)
  })

  it("com movimento reduzido não se corta com reticências: o texto lê-se a andar", () => {
    const reduzido = regras().match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g) ?? []
    const doLetreiro = reduzido.filter((b) => b.includes(".andante"))
    expect(doLetreiro).toHaveLength(1)
    expect(doLetreiro[0]).not.toContain("text-overflow")
  })
})

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { MARCA_CHEIA } from "../../marca.gen.js"
import { strings } from "../../strings.js"
import { aberturaEmHtml, folhaDasLinguas } from "./abertura-marcacao.js"
import { esquecerAbertura } from "./abertura-viva.js"
import { SAIDA_DE_EMERGENCIA_MS, Splash } from "./Splash.js"

/**
 * The splash: "Opening..." and a late emergency exit.
 *
 * It does not say it is taking time. Only after `SAIDA_DE_EMERGENCIA_MS` does
 * a "Reload" link appear, for an opening that never responds.
 */
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  esquecerAbertura()
  vi.useRealTimers()
})

describe("o splash", () => {
  it("a saída de emergência é aos 30 s", () => {
    expect(SAIDA_DE_EMERGENCIA_MS).toBe(30_000)
  })

  it('antes da saída mostra só "A abrir…", sem botão nem aviso', () => {
    render(<Splash />)
    act(() => vi.advanceTimersByTime(SAIDA_DE_EMERGENCIA_MS - 1))
    expect(screen.getByText(strings.gate.splashBody)).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.queryByRole("status")).toBeNull()
    expect(document.body.textContent).not.toMatch(/demor/i)
  })

  it('ao fim da saída mostra o link "Recarregar", sem frase e sem tirar o splash', () => {
    render(<Splash />)
    act(() => vi.advanceTimersByTime(SAIDA_DE_EMERGENCIA_MS))
    const link = screen.getByRole("button", { name: strings.errors.reload })
    expect(link.className).toContain("gate-link")
    expect(screen.getByText(strings.gate.splashBody)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/demor/i)
  })

  it("o link recarrega", () => {
    const onRecarregar = vi.fn()
    render(<Splash onRecarregar={onRecarregar} />)
    act(() => vi.advanceTimersByTime(SAIDA_DE_EMERGENCIA_MS))
    fireEvent.click(screen.getByRole("button", { name: strings.errors.reload }))
    expect(onRecarregar).toHaveBeenCalledOnce()
  })

  it("desenha a marca inteira e o anel, com as tarjas numeradas por linha de cima para baixo", () => {
    const { container } = render(<Splash />)
    const tarjas = [...container.querySelectorAll<SVGPathElement>(".abertura-marca path")]
    expect(tarjas.length).toBe(MARCA_CHEIA.length)
    const linhas = tarjas.map((tarja) => Number(tarja.style.getPropertyValue("--linha")))
    // The seven lines of the full variant, each at least once.
    expect(new Set(linhas)).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]))
    expect(linhas[0]).toBe(0)
    expect(linhas.at(-1)).toBe(6)
    expect(container.querySelector(".abertura-anel")).toBeTruthy()
  })

  /*
    The `index.html` brings this markup written out (`abertura-no-html.ts`), and
    React takes its place. A different character is a different box, and the
    swap was no longer invisible.
  */
  it("é a mesma marcação que o index.html traz escrita, carácter a carácter", () => {
    expect(renderToStaticMarkup(<Splash />)).toBe(aberturaEmHtml(strings.gate.splashBody))
  })

  it("no index.html o texto vai em todas as línguas, e a folha mostra só o da página", () => {
    const html = aberturaEmHtml([
      { lingua: "pt", texto: "A abrir…" },
      { lingua: "en", texto: "Opening…" },
    ])
    expect(html).toContain('<p class="abertura-texto"><span lang="pt">A abrir…</span><span lang="en">Opening…</span></p>')
    expect(folhaDasLinguas(["pt", "en"])).toBe(
      '.abertura-texto>[lang]{display:none}html[lang="pt"] .abertura-texto>[lang="pt"],html[lang="en"] .abertura-texto>[lang="en"]{display:inline}',
    )
  })
})

describe("a abertura: o anel na folha (dono, 28 de Outubro de 2026)", () => {
  const pele = (): string => {
    const meu = expect.getState().testPath
    if (!meu) throw new Error("sem caminho do teste")
    return readFileSync(join(dirname(meu), "..", "..", "styles", "pele.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  }

  it("as quatro cores esbatem uma na outra, e a última volta à primeira", () => {
    const anel = pele().match(/\.abertura-anel::after \{([\s\S]*?)\n\}/)?.[1] ?? ""
    const gradiente = anel.match(/conic-gradient\(([\s\S]*?)\);/)?.[1] ?? ""
    expect(gradiente).not.toBe("")
    // No edges: a color with two angles ("0deg 90deg") is a solid quarter.
    expect(gradiente).not.toMatch(/\d+deg\s+\d+deg/)
    const cores = [...gradiente.matchAll(/var\((--[a-z]+)\)/g)].map((m) => m[1])
    expect(cores).toEqual(["--acento", "--indigo", "--rosa", "--presenca", "--acento"])
  })

  it("a volta tem velocidades: vários troços, cada um com a sua curva, e só transform", () => {
    expect(pele()).toMatch(/\.abertura-anel::after \{[^}]*animation:\s*abertura-gira-vivo/)
    const fotogramas = pele().match(/@keyframes abertura-gira-vivo \{([\s\S]*?)\n\}/)?.[1] ?? ""
    const paragens = [...fotogramas.matchAll(/(\d+)% \{/g)].map((m) => Number(m[1]))
    expect(paragens.length).toBeGreaterThanOrEqual(4)
    expect(paragens[0]).toBe(0)
    expect(paragens[paragens.length - 1]).toBe(100)
    const curvas = fotogramas.match(/animation-timing-function:/g) ?? []
    expect(curvas.length).toBeGreaterThanOrEqual(3)
    const propriedades = new Set([...fotogramas.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]))
    expect(propriedades).toEqual(new Set(["transform", "animation-timing-function"]))
    expect(fotogramas).not.toContain("var(")
  })

  it("com movimento reduzido o anel gira na mesma, com as mesmas velocidades, mais devagar", () => {
    // The sheet has several reduced-motion blocks: each ends in a "}" at
    // column zero, and the ring one is what names the `::after`.
    const blocos = [...pele().matchAll(/@media \(prefers-reduced-motion: reduce\) \{((?:(?!\n\})[\s\S])*)\n\}/g)].map((m) => m[1] ?? "")
    const doAnel = blocos.find((b) => b.includes(".abertura-anel::after")) ?? ""
    const reduzido = doAnel.match(/\.abertura-anel::after \{([^}]*)\}/)?.[1] ?? ""
    expect(reduzido).toMatch(/animation:\s*abertura-gira-vivo\s+[\d.]+s\s+linear\s+infinite\s+!important/)
  })

  /*
    3 November 2026: the phase sat in an `animation-delay`, and the shortcut
    `animation: … !important` of reduced motion reset it to zero. The phase
    moved to `startTime` (`abertura-viva.ts`), and no sheet rule can load it
    again.
  */
  it("a fase não vive na folha: nenhum atraso da abertura conta o tempo da página", () => {
    expect(pele()).not.toContain("--abertura-fase")
    const atrasos = [...pele().matchAll(/\.abertura[^{]*\{[^}]*animation-delay:\s*([^;]+);/g)].map((m) => m[1])
    expect(atrasos).toEqual(["calc(var(--linha, 0) * 110ms)"])
  })

  it("a saída esbate nos dois modos, e com movimento reduzido mais devagar", () => {
    expect(pele()).toMatch(/\.abertura-a-sair \.abertura-veu \{[^}]*animation:\s*abertura-esbate var\(--abertura-saida, 200ms\)/)
    const blocos = [...pele().matchAll(/@media \(prefers-reduced-motion: reduce\) \{((?:(?!\n\})[\s\S])*)\n\}/g)].map((m) => m[1] ?? "")
    const doAnel = blocos.find((b) => b.includes(".abertura-anel::after")) ?? ""
    expect(doAnel).toMatch(/\.abertura-a-sair \.abertura-veu \{[^}]*animation:\s*abertura-esbate var\(--abertura-saida, 360ms\)[^}]*!important/)
    expect(doAnel).toMatch(/\.abertura-a-sair body > :not\(\.abertura-veu\) \{[^}]*reverse both !important/)
  })
})

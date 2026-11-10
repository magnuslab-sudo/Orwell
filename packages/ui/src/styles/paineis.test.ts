import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The surfaces above the dawn (`paineis.css`), without liquid glass.
 *
 * Version 0.8.3 put a `backdrop-filter` on all surfaces; the owner had it
 * removed on 26 October 2026 and kept the dawn. This pins down the new state:
 * no filter anywhere, dawn at the root, and colors almost solid, with text
 * passing AA over the lighter smudge of the dawn.
 *
 * Live measurement (contrast in pixels and fps) is in
 * `scripts/retratar-midnight.mjs`.
 */
const ler = (relativo: string): string => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8")
const semComentarios = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "")
/** All the sheets that `styles.css` imports, in its order. */
const nomes = [...ler("../styles.css").matchAll(/@import "\.\/styles\/([a-z]+\.css)"/g)].map((m) => m[1] as string)
const folhas: Record<string, string> = Object.fromEntries(nomes.map((nome) => [nome, semComentarios(ler(`./${nome}`))]))
const paineis = folhas["paineis.css"] as string
const tokens = folhas["tokens.css"] as string

type Rgb = readonly [number, number, number]
type Rgba = readonly [number, number, number, number]

function rgbaDe(nome: string): Rgba {
  const m = new RegExp(`${nome}:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)\\)`).exec(tokens)
  if (!m) throw new Error(`falta ${nome} em tokens.css`)
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as const
}
function hexDe(nome: string): Rgb {
  const m = new RegExp(`${nome}:\\s*#([0-9a-f]{6})`, "i").exec(tokens)
  if (!m) throw new Error(`falta ${nome} em tokens.css`)
  const n = Number.parseInt(m[1] as string, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const
}
const compor = (base: Rgb, [r, g, b, a]: Rgba): Rgb =>
  [base[0] + (r - base[0]) * a, base[1] + (g - base[1]) * a, base[2] + (b - base[2]) * a] as const
function luminancia([r, g, b]: Rgb): number {
  const linear = (c: number): number => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}
const contraste = (a: Rgb, b: Rgb): number => {
  const [x, y] = [luminancia(a), luminancia(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

describe("as superfícies, sem vidro líquido", () => {
  it("nenhuma folha tem `backdrop-filter`", () => {
    for (const [nome, css] of Object.entries(folhas)) expect(css, nome).not.toMatch(/backdrop-filter/)
  })

  it("nem o filtro `#liquido`: nem nas folhas, nem na chamada", () => {
    for (const [nome, css] of Object.entries(folhas)) expect(css, nome).not.toMatch(/url\(#/)
    expect(ler("../screens/call/CallPanel.tsx")).not.toMatch(/<filter|liquido/)
  })

  it("e `paineis.css` não tem camadas: a tinta pinta-se na própria superfície", () => {
    expect(paineis).not.toMatch(/::before/)
    expect(paineis).toMatch(/:is\([^)]*\.rail,[\s\S]*?\)\s*\{\s*background:\s*var\(--painel-fundo\)/)
  })

  it("o cartão do mural debaixo do rato fica mais claro, e não opaco", () => {
    const rato = /\.card\.post:hover,\s*\.post-row:hover\s*\{([^}]*)\}/.exec(paineis)?.[1] ?? ""
    expect(rato).toMatch(/--painel-fundo:\s*var\(--painel-claro\)/)
    expect(rato).toMatch(/background:\s*var\(--painel-fundo\)/)
  })

  it.each(["--painel-tinta", "--painel-claro", "--painel-poco", "--painel-barra", "--flutuante"])(
    "%s é quase sólida (alfa de 0,88 a 0,96)",
    (nome) => {
      const [, , , alfa] = rgbaDe(nome)
      expect(alfa).toBeGreaterThanOrEqual(0.88)
      expect(alfa).toBeLessThanOrEqual(0.96)
    },
  )

  it("os flutuantes são mais opacos do que os painéis, e as gavetas sólidas", () => {
    expect(tokens).toMatch(/--painel-flutuante:\s*var\(--flutuante\)/)
    expect(rgbaDe("--flutuante")[3]).toBeGreaterThan(rgbaDe("--painel-tinta")[3])
    expect(tokens).toMatch(/--painel-gaveta:\s*var\(--vidro-solido\)/)
  })

  /*
    Worst case: each dawn smudge at its peak, without its blur pulling it down,
    on top of the background, and the color on top. The weakest text color in
    panels is `--discreto`; pink is for errors.
  */
  const manchas = ["--aurora-azul", "--aurora-violeta", "--aurora-rosa", "--aurora-verde"].map(rgbaDe)
  const fundo = hexDe("--fundo")
  it.each(["--painel-tinta", "--painel-claro", "--painel-poco", "--flutuante"])(
    "o texto discreto e o rosa passam 4,5:1 sobre %s, com a aurora no máximo por baixo",
    (tinta) => {
      for (const mancha of manchas) {
        const superficie = compor(compor(fundo, mancha), rgbaDe(tinta))
        for (const cor of ["--discreto", "--apagado", "--rosa"]) {
          expect(contraste(hexDe(cor), superficie), `${cor} sobre ${tinta}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    },
  )

  it("os balões das mensagens têm a tinta interior", () => {
    const balao = /\.message \.message-body\s*\{([^}]*)\}/.exec(paineis)?.[1] ?? ""
    expect(balao).toMatch(/background:\s*var\(--painel-interior\)/)
  })

  it("o contorno segue o acento escolhido", () => {
    expect(tokens).toMatch(/--painel-borda:\s*color-mix\(in srgb, var\(--accent\)/)
  })

  it("o portão, o aviso e os cartões com barra de cor ficam com o contorno deles", () => {
    const regra = /:is\(([^{]*)\)\s*\{\s*border:\s*1px solid var\(--painel-borda\)/.exec(paineis)?.[1] ?? ""
    expect(regra).toContain(".rail")
    for (const fora of [".gate-card", ".gate-convite", ".toast", ".role-card", ".link-card", ".pedido-card", ".post-row"]) {
      expect(regra.split(/[\s,]+/)).not.toContain(fora)
    }
  })

  // The outline that spun around the account card disappeared with it: the owner
  // chose the Discord-style banner on 27 October 2026, without card or frame.
  it("a faixa da conta já não tem o contorno que gira", () => {
    for (const [nome, css] of Object.entries(folhas)) {
      expect(css, nome).not.toMatch(/conic-gradient\(from var\(--ang\)/)
    }
  })

  it("há uma aurora só, na raiz, e pára com movimento reduzido e no telemóvel", () => {
    const fundoCss = folhas["fundo.css"] as string
    expect(fundoCss).toMatch(/body::before\s*\{[^}]*animation:\s*aurora/)
    for (const [nome, css] of Object.entries(folhas)) {
      if (nome !== "fundo.css") expect(css, nome).not.toMatch(/@keyframes\s+aurora/i)
    }
    expect(fundoCss).toMatch(/prefers-reduced-motion[\s\S]*body::before\s*\{\s*animation:\s*none/)
    expect(fundoCss).toMatch(/max-width:\s*600px\)\s*\{\s*body::before\s*\{\s*animation:\s*none/)
  })
})

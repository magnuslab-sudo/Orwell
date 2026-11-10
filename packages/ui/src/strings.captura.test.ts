import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Never store a piece of `strings` outside a function.
 *
 * `strings` is a live link: the object changes when the language changes, and
 * anyone reading it INSIDE a render always reads the current language (see
 * `strings.ts`). Anyone reading it at the top of a module reads it once, when
 * the module loads, and keeps that moment's language for the rest of the session.
 *
 * This is not hypothetical. `screens/settings/seccoes.ts` used to be like this:
 *
 * ```ts
 * export const SECCOES = [
 *   { id: "aspecto", label: strings.settings.appearance },
 *   …
 * ] as const
 * ```
 *
 * Six labels from the settings menu, read when the module loaded. Switching
 * language would redraw the whole app and leave those six in Portuguese
 * forever, with nothing on screen to explain it. Changed it to a function.
 *
 * What this test measures is the shape, and it is a heuristic on purpose: a
 * top-level declaration that mentions `strings.` and has no function inside.
 * A `const` that only exists to name a value computed once is exactly the
 * dangerous pattern; a `const` that holds a function is not, because the
 * function runs when called.
 *
 * When it fails, the fix is always the same: turn the value into a function,
 * or move the read inside the component. Do not add an exception.
 */

function pastaDaFonte(): string {
  let aqui = process.cwd()
  for (let salto = 0; salto < 6; salto++) {
    const candidato = join(aqui, "packages", "ui", "src")
    try {
      if (statSync(candidato).isDirectory()) return candidato
    } catch {
      // Not here. Look up.
    }
    if (statSync(join(aqui, "src", "strings.ts"), { throwIfNoEntry: false })) return join(aqui, "src")
    aqui = dirname(aqui)
  }
  throw new Error("não encontrei packages/ui/src a partir de " + process.cwd())
}

const FONTE = pastaDaFonte()

function ficheiros(pasta: string): string[] {
  const saida: string[] = []
  for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, entrada.name)
    if (entrada.isDirectory()) saida.push(...ficheiros(caminho))
    else if (/\.tsx?$/.test(entrada.name)) saida.push(caminho)
  }
  return saida
}

/** Except comments: `strings.` in an explanatory note is not a read. */
function semComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
}

/**
 * A top-level declaration, from the `const` to what closes it.
 *
 * Count braces, parentheses, and brackets. A single-line declaration closes on
 * the same line; a table closes where the table closes.
 */
function declaracoesDeTopo(texto: string): { nome: string; corpo: string }[] {
  const linhas = texto.split("\n")
  const saida: { nome: string; corpo: string }[] = []

  for (let i = 0; i < linhas.length; i++) {
    const abertura = /^(?:export )?(?:const|let|var) (\w+)/.exec(linhas[i]!)
    if (!abertura) continue

    let fundura = 0
    const pedacos: string[] = []
    for (let j = i; j < linhas.length; j++) {
      const linha = linhas[j]!
      pedacos.push(linha)
      for (const caracter of linha) {
        if (caracter === "{" || caracter === "(" || caracter === "[") fundura++
        if (caracter === "}" || caracter === ")" || caracter === "]") fundura--
      }
      if (fundura <= 0) {
        i = j
        break
      }
    }
    saida.push({ nome: abertura[1]!, corpo: pedacos.join("\n") })
  }

  return saida
}

describe("ninguém congela a língua ao carregar um módulo", () => {
  it("nenhuma declaração de topo guarda texto de `strings`", () => {
    const congelados: string[] = []

    for (const caminho of ficheiros(FONTE)) {
      const texto = semComentarios(readFileSync(caminho, "utf8"))
      if (!texto.includes("strings.")) continue

      for (const { nome, corpo } of declaracoesDeTopo(texto)) {
        if (!corpo.includes("strings.")) continue
        // A function stored in a `const` runs when called, and at that moment it
        // reads the current language. Not a capture.
        if (corpo.includes("=>") || corpo.includes("function")) continue
        congelados.push(`${caminho.slice(FONTE.length + 1)}: ${nome}`)
      }
    }

    expect(
      congelados,
      `texto lido ao carregar o módulo, e por isso preso à língua do arranque:\n${congelados.join("\n")}`,
    ).toEqual([])
  })

  it("e a armadilha que deu origem a isto continua desarmada", () => {
    // Proof that the test above measures something: if `seccoes.ts` becomes a
    // constant again, the case above catches it. This fixes the other side, which
    // is the form the fix took.
    const seccoes = readFileSync(join(FONTE, "screens", "settings", "seccoes.ts"), "utf8")
    expect(seccoes).toContain("export function seccoes()")
    expect(seccoes).not.toMatch(/^export const SECCOES/m)
  })
})

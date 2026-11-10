import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { strings } from "./strings.js"

/**
 * The text scripts search for actually exists in the interface.
 *
 * On August 13, 2026, commit `3eea841` renamed "Papéis" to "Cargos". It
 * touched two files, `strings.ts` and one test, and **the whole suite
 * passed**. So did `typecheck` and `build`. But twelve Playwright scripts kept
 * clicking buttons that no longer existed, and nobody noticed for two days,
 * until a hunt for a call-site bug ran into them.
 *
 * Why the suite caught nothing is instructive: the test that should have caught
 * it asserts `getByText(strings.roles.add)`. An assertion that reads the same
 * constant that changed **cannot fail by definition**, it follows the rename
 * by itself and always says all is well. Interface tests were made immune to
 * renames and in doing so became blind to them. The ones testing text for real
 * were the scripts, writing human words by hand, and those are exactly the ones
 * that broke silently.
 *
 * This test closes the gap from the only side left: it reads the words scripts
 * write and demands that something in `strings.ts` says them. It does not prove
 * the script clicks in the right place, it proves the text it looks for still
 * comes out of the app's mouth, which is where the rename hits first.
 *
 * When it fails, there are two possible fixes and the choice is always the same:
 * if the interface changed on purpose, update the script; if it changed by
 * accident, restore the interface. What you do not do is delete the line here.
 */

/**
 * The scripts folder, found by walking up.
 *
 * `process.cwd()` is not reliable here: `npm test` runs `vitest --root packages/ui`
 * from the monorepo root, and a path relative to cwd escapes the repository. This
 * test started failing only in that invocation form, green running the package
 * directly, red in the suite. Walking up until finding the file is the only way
 * that works in both.
 */
function pastaDosGuioes(): string {
  let aqui = process.cwd()
  for (let salto = 0; salto < 6; salto++) {
    const candidato = join(aqui, "scripts")
    if (existsSync(join(candidato, "ambiente.mjs"))) return candidato
    aqui = dirname(aqui)
  }
  throw new Error("não encontrei scripts/ambiente.mjs a subir a partir de " + process.cwd())
}

const GUIOES = pastaDosGuioes()

/**
 * All visible text, flattened into a list.
 *
 * Functions in `strings` take arguments and return assembled sentences
 * (`Cargos em ${canal}`); from those we keep the fixed part, which is what a
 * script can search for.
 */
function textoDaInterface(valor: unknown, saco: Set<string>): void {
  if (typeof valor === "string") {
    saco.add(valor)
    return
  }
  if (typeof valor === "function") {
    /*
      Called multiple times, and the numbers are not decoration.

      Many of these functions are plural, `n === 0 ? "Comentários" : n === 1 ?
      "1 comentário" : …`. Called with only a text marker, they always fall into
      the last branch, and the other two stay invisible to this test: that is how
      "1 comentário" appeared orphaned even though it exists in `strings.ts`.

      Store the whole sentence AND its words: a script searches for both the
      assembled sentence and a single word inside it.
    */
    for (const argumento of [" ", 0, 1, 2]) {
      try {
        const montado = (valor as (...args: unknown[]) => unknown)(argumento, argumento, argumento)
        if (typeof montado !== "string") continue
        saco.add(montado.trim())
        for (const pedaco of montado.split(" ")) {
          const limpo = pedaco.trim()
          if (limpo.length > 0) saco.add(limpo)
        }
      } catch {
        // A function that demands a specific form of argument. No fixed text to
        // extract from here, and that is not what this test measures.
      }
    }
    return
  }
  if (valor && typeof valor === "object") {
    for (const dentro of Object.values(valor)) textoDaInterface(dentro, saco)
  }
}

const VISIVEL = ((): Set<string> => {
  const saco = new Set<string>()
  textoDaInterface(strings, saco)
  return saco
})()

/**
 * What a script searches for by accessible name or by text.
 *
 * Only forms that capture human text: `getByRole(..., { name: "…" })`,
 * `getByText("…")`, `getByLabel("…")`, `getByPlaceholder("…")`. A CSS class
 * selector is not text and does not count.
 */
const PROCURAS =
  /getBy(?:Role\([^,]+,\s*\{\s*name|Text|Label|Placeholder)\s*[:(]?\s*["'`]([^"'`]{3,60})["'`]/g

/**
 * What the script itself WROTE, and so has every right to search for.
 *
 * A script writes "hello from probe A" in a message and then checks it
 * appears on the other side. That is not an interface label and does not have
 * to exist in `strings.ts`, requiring it would turn this test into a nuisance
 * people learn to ignore, which is how tests die.
 *
 * The distinction is measured, not guessed: collect everything the script
 * passes to `fill(...)`, which is the only way its text enters the app. An
 * account name, a message, a channel or role name, all of it goes through
 * there.
 */
function escritoPeloGuiao(texto: string): Set<string> {
  const meu = new Set<string>()
  for (const achado of texto.matchAll(/\.fill\(\s*[`"']([^`"']{1,120})[`"']/g)) {
    const valor = achado[1]!.trim()
    if (valor.length > 0) meu.add(valor)
  }
  // Names built with a stamp (`sala-${STAMP}`) arrive here truncated at the
  // `${`; store the root too, which is what the script ends up searching for.
  for (const achado of texto.matchAll(/\.fill\(\s*`([^`$]{2,60})\$\{/g)) {
    meu.add(achado[1]!.trim())
  }
  return meu
}

/**
 * Text that comes neither from `strings.ts` nor from a `fill`, with the reason
 * written.
 *
 * Each entry is a debt assumed, not a convenience exception: whoever adds one
 * must write why, and whoever reads it must be able to disagree.
 */
const FORA = new Map<string, string>([
  ["geral", "o marcador do campo de nome de canal, que é um exemplo e não uma etiqueta"],
  ["sanctus-christus", "canal de um ambiente de diagnóstico, criado fora deste guião"],
  ["sala-de-verificacao", "canal criado pela API do núcleo e não pela interface, logo sem `fill`"],
  [
    "Criar link de convite",
    "procurado pelo `e2e-cliente-antigo.mjs` no cliente ANTIGO, que ainda diz esta frase; o guião prova o cliente antigo e não muda",
  ],
])

/**
 * All scripts, including those in subfolders.
 *
 * This used to sweep only the first level until August 20, 2026, and the rail
 * rename that day showed the price: the swarm harness (`scripts/enxame/`) and
 * the SFU rigs (`scripts/sfu-prova-fase2`, and siblings) search for buttons by
 * name just like the others, and this test did not see them. They would have
 * kept clicking "Canais" and "Contactos" without a single red line, exactly
 * the two-day failure this file was written to prevent, but one folder down.
 *
 * The name that comes out here is the relative path, not just the file: with
 * subfolders there are two `montagem.mjs`, and a failure that does not say
 * which one is useless.
 */
function guioes(): { nome: string; texto: string }[] {
  const encontrados: { nome: string; texto: string }[] = []
  const descer = (pasta: string, prefixo: string): void => {
    for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
      const caminho = join(pasta, entrada.name)
      const nome = prefixo ? `${prefixo}/${entrada.name}` : entrada.name
      if (entrada.isDirectory()) descer(caminho, nome)
      else if (entrada.name.endsWith(".mjs")) encontrados.push({ nome, texto: readFileSync(caminho, "utf8") })
    }
  }
  descer(GUIOES, "")
  return encontrados
}

describe("os guiões procuram texto que a interface diz mesmo", () => {
  it("cada palavra procurada existe em strings.ts", () => {
    const orfas: string[] = []

    for (const { nome, texto } of guioes()) {
      const meu = escritoPeloGuiao(texto)
      for (const achado of texto.matchAll(PROCURAS)) {
        const procurado = achado[1]!.trim()
        if (procurado.length === 0) continue
        if (FORA.has(procurado)) continue
        if (meu.has(procurado)) continue
        // Also what the script wrote with a stamp in the middle.
        if ([...meu].some((escrito) => procurado.startsWith(escrito) || escrito.startsWith(procurado))) continue
        /*
          Same, or contained in a bigger sentence, and NEVER the other way.
          
          The first version of this test also accepted `procurado.includes(visivel)`,
          and with that it did not bite: `strings` has short words like "Novo" or
          "Sala", and any sentence containing them passed. I verified it with a
          mutation, I renamed `roles.add` and the test stayed green, which is the
          worst result possible for a test written precisely to catch renames.
          
          The right direction is only one: what the interface says must contain
          what the script looks for. A button can be called "Criar canal novo" and
          the script search for "Criar canal"; the reverse is the script looking
          for a sentence nobody says.
          */
        const existe = [...VISIVEL].some((visivel) => visivel === procurado || visivel.includes(procurado))
        if (!existe) orfas.push(`${nome}: "${procurado}"`)
      }
    }

    expect(orfas, `texto que a interface já não diz:\n${orfas.join("\n")}`).toEqual([])
  })

  it("e a lista de excepções não cresce em silêncio", () => {
    // A low cap on purpose. Each exception is something this test stops watching;
    // if there are many, it stops watching enough to be worth it.
    expect(FORA.size).toBeLessThanOrEqual(6)
  })
})

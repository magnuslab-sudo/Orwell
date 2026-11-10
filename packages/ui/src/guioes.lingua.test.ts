import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * No script opens the application without saying what language it wants.
 *
 * On August 20, 2026 the interface started choosing the language on its own, from
 * `navigator.languages`. That is what you want in a product, and it is poison for
 * this folder: thirty-five scripts look for text in PORTUGUESE written by hand,  * `getByText("Criar canal")`, `getByRole("button", { name: "Nova sala" })`, and
 * Playwright's Chromium starts in English.
 *
 * What would break was not one script. It was all of them at once, and **no test
 * in this suite would notice**, because the suite does not run scripts. It is
 * exactly the form of the failure on August 13 that led to `strings.guioes.test.ts`:
 * a legitimate change in one place, twelve dead scripts in another, and two days
 * before someone stumbles on them.
 *
 * That is why the language is REQUESTED in the address, `?lingua=pt`, placed by
 * `comLingua` in `scripts/ambiente.mjs`, and this test is what prevents the next
 * script from being born without it.
 *
 * ## Why it goes in the address and not in Playwright
 *
 * `newContext({ locale: "pt-PT" })` would be the native path, and it was rejected:
 * `locale` also changes `Intl`, dates, times, numbers, and a dozen scripts in
 * this folder measure pixel widths against hand-written values. Changing the INTERFACE
 * language is what you want; dragging the formatting beneath it was changing what
 * you are measuring.
 *
 * ## What this test considers "the application"
 *
 * A page on LOOPBACK. In development the application always lives at `127.0.0.1`
 * or `localhost`, on one of many ports these files have chosen over time; production
 * is already locked down by `guioes.producao.test.ts`, and an address from outside
 * is not the application, it is a link the script publishes, a YouTube video, or
 * the target of a probe.
 *
 * When it fails: wrap the address in `comLingua(...)`. Do not add an exception here
 * without writing why, and the cap below says how many fit.
 */

/**
 * The scripts folder, found by walking up.
 *
 * `process.cwd()` is not reliable here: `npm test` runs `vitest --root packages/ui`
 * from the monorepo root, and a path relative to cwd escapes the repository.
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

/** Where the script language is decided. It is the only file that can name it. */
const A_TRANCA = "ambiente.mjs"

/** A loopback address: that is where the application lives in development. */
const LOOPBACK = /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?/

/**
 * What the script NAVIGATES TO, not everything it says.
 *
 * `page.goto(X)` is the only way a page enters a script. A message that contains
 * an address, a link it publishes, the target of a preview probe: none of that
 * opens the application, and requiring the parameter on them would turn this test
 * into a chore you learn to ignore, which is how tests die.
 */
const NAVEGACOES = /\.goto\(\s*([^,)]+)/g

/**
 * The value of a `const` at the top of the file, to resolve `goto(URL)`.
 *
 * Only the first line of the declaration, which is where these scripts put the
 * entire address, none of them build the target over several lines, and one that
 * did would fall on the safe side: with no value resolved, it is not flagged.
 */
function declaracoes(texto: string): Map<string, string> {
  const encontradas = new Map<string, string>()
  for (const achado of texto.matchAll(/^const (\w+) = (.*)$/gm)) {
    encontradas.set(achado[1]!, achado[2]!)
  }
  return encontradas
}

/**
 * Addresses that open and are not the application, with the reason written down.
 *
 * Each entry is an assumed debt, not a convenience exception.
 */
const FORA = new Map<string, string>([
  [
    "verificar-favicon.mjs",
    "serve a homepage estática do apps/site num servidor próprio: não é a aplicação, e não tem língua para escolher",
  ],
  [
    "retratar-embaixadores.mjs",
    "retrata o site estático do apps/site (a secção e a página dos embaixadores) num servidor próprio: não é a aplicação, e não tem língua para escolher",
  ],
  [
    "verificar-lingua.mjs",
    "é o guião que MEDE a detecção: abrir sem pedir língua nenhuma é exactamente o caso que ele existe para provar",
  ],
])

function guioes(): { nome: string; texto: string }[] {
  return readdirSync(GUIOES)
    .filter((nome) => nome.endsWith(".mjs") && nome !== A_TRANCA)
    .map((nome) => ({ nome, texto: readFileSync(join(GUIOES, nome), "utf8") }))
}

describe("os guiões pedem a língua em que abrem a aplicação", () => {
  it("nenhuma navegação para loopback vai sem `comLingua`", () => {
    const soltos: string[] = []

    for (const { nome, texto } of guioes()) {
      if (FORA.has(nome)) continue
      const consts = declaracoes(texto)

      for (const achado of texto.matchAll(NAVEGACOES)) {
        const argumento = achado[1]!.trim()
        // Already wrapped in `goto` itself.
        if (argumento.includes("comLingua")) continue

        // A simple identifier resolves from the declaration; anything else (a literal,
        // a template) is measured exactly as written.
        const escrito = /^\w+$/.test(argumento) ? (consts.get(argumento) ?? argumento) : argumento

        if (!LOOPBACK.test(escrito)) continue
        if (escrito.includes("comLingua") || escrito.includes("lingua=")) continue
        soltos.push(`${nome}: goto(${argumento}) -> ${escrito.slice(0, 80)}`)
      }
    }

    expect(soltos, `guiões a abrir a aplicação sem língua pedida:\n${soltos.join("\n")}`).toEqual([])
  })

  it("e a tranca continua a pôr o parâmetro", () => {
    // If someone removes the `comLingua` parameter, all scripts start depending on
    // the machine's language, and this breaks, as it should.
    const tranca = readFileSync(join(GUIOES, A_TRANCA), "utf8")
    expect(tranca).toContain("export function comLingua")
    expect(tranca).toContain('searchParams.set("lingua"')
    expect(tranca).toContain("comLingua(process.env.ORWELL_APP")
  })

  it("e a lista de excepções não cresce em silêncio", () => {
    // Each exception is a script this test stopped watching. A low cap on purpose:
    // if there are many, it stopped watching enough.
    expect(FORA.size).toBeLessThanOrEqual(3)
  })
})

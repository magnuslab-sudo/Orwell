import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { describe, expect, it } from "vitest"
import { nomeEmFalta, shortAddress } from "./lib/format.js"

/**
 * A raw address never takes the place of a name.
 *
 * Owner report on October 5, 2026, after a call with others: "there are
 * usernames that show up as an address". Two distinct issues gave the same
 * symptom, and this is the half that belongs to the interface.
 *
 * A name is not a lookup record: it is something a member told a group,
 * encrypted, and so it may not have arrived. The app has an answer for that
 * case, today `nomeEmFalta`, the first word of the address capitalized (since
 * November 4, 2026, owner order: with the Reddit account wave the shared
 * channel was a column of identical "Unnamed"); from October 27 to November 4
 * it was "Unnamed". What cannot happen is a screen inventing its own resource,
 * and there were four doing it:
 *
 * - `PeopleScreen` wrote the ENTIRE address in place of the name, in two
 *   visible spots and in two `aria-label`s. It was the only screen in the app
 *   doing this.
 * - `App.tsx` gave `(sender) => sender` as a resource to the path of system
 *   notifications, which is read while the real `nameFor` is not yet written to
 *   the ref.
 * - `Timeline` and `PostBody` gave `(address) => address` to voting, so the
 *   vote list for an option read in addresses.
 *
 * Each was one line, and that is exactly the kind of line you rewrite on the
 * next screen. This scan reads the source code so the forgetting appears here.
 *
 * **The limits, logged on purpose, and there are two.**
 *
 * First: this does not tell an identifier called `address` that is actually an
 * address from one that is not, so it judges by the NAME of the identifier. A
 * name resource written with a parameter called `x` gets past it.
 *
 * Second, and the wrong phrase was here, "no false positives", which was
 * comfortable and not true. Two idioms fell into it:
 *
 * - `lista.filter((peer) => peer)`, which is a truth filter and not a name
 *   resource. Solved by CONTEXT: an identity right inside a `filter`, `find`,
 *   `some` and company is a predicate, and does not count.
 * - `displayName ?? endereco.slice(1)`, where what is written in place of the
 *   name is not the address but the result of calling a method on it, which
 *   may be just the right shortening. Solved by narrowing: the scan hunts the
 *   bare identifier in place of the resource, which is the form about which
 *   there is no doubt.
 *
 * The two fixes are contextual and not exceptions, and the difference is not
 * style: a list of files or forgiven lines is what kills a scan like this,
 * because the next exception goes in without discussion. What stays out stays
 * out by its FORM, and it is measured in the contrast test below, both ways.
 *
 * **And a house rule that comes from here:** a comment describing this defect
 * does not write it in the form of code. The scan does not tell comment from
 * code on purpose: telling them apart means trying to read TypeScript with
 * regex, and a `//` inside a string wipes out the whole line for a scan that
 * should be strict.
 */

/**
 * The folder to scan: the one holding this file itself.
 *
 * Neither `import.meta.url`, in jsdom it is an http address and `fileURLToPath`
 * refuses it, nor `process.cwd()`, which is the repo root when `npm test` runs
 * vitest with `--root`. See `botoesEmFormulario.test.ts`, which stumbled on
 * both first.
 */
function raiz(): string {
  const meu = expect.getState().testPath
  if (!meu) throw new Error("sem caminho do teste: não há o que varrer")
  return dirname(meu)
}

function fontes(pasta: string): string[] {
  const achados: string[] = []
  for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, entrada.name)
    if (entrada.isDirectory()) achados.push(...fontes(caminho))
    else if (/\.tsx?$/.test(entrada.name) && !entrada.name.includes(".test.")) achados.push(caminho)
  }
  return achados
}

/**
 * The names by which a person address goes in this code.
 *
 * `channel` and `sala` are left out with good reason: `(channel) => channel`
 * and `(sala) => sala` exist and are honest identities over things that are not
 * people. What is at stake is someone's name.
 */
const COMO_SE_CHAMA_UM_ENDERECO = ["address", "endereco", "sender", "peer", "quem", "who", "remetente"]

/**
 * The methods that take a PREDICATE, not a name resource.
 *
 * `lista.filter((peer) => peer)` is the idiom to throw out empties from a list,
 * and `(peer) => peer` in there does not promise anyone's name. It is a
 * contextual distinction, who receives the function, that is the only thing
 * separating the two readings of the same expression.
 */
const RECEBEM_PREDICADO = ["filter", "find", "findIndex", "findLast", "findLastIndex", "some", "every", "partition"]

/** `(address) => address`, and its siblings: a name resource that solves nothing. */
const IDENTIDADE = new RegExp(
  String.raw`(?<!\.(?:${RECEBEM_PREDICADO.join("|")})\s*\(\s*)` +
    String.raw`\(\s*(${COMO_SE_CHAMA_UM_ENDERECO.join("|")})\s*(?::\s*string\s*)?\)\s*=>\s*\1\s*(?=[,)\]};]|$)`,
  "gm",
)

/**
 * `displayName || address`: the profile name, and the NU address when there is no name.
 *
 * Bare, and that is what `(?!\s*[(.])` at the end requires: `displayName ?? endereco.slice(1)`
 * writes a method result in place of the name, and that method might be
 * exactly the shortening you want. to know which one, and to judge it was to invent. What has
 * no doubt, and is the bug that actually happened in this repository, is the
 * identifier placed there as is.
 */
const NOME_OU_ENDERECO = new RegExp(
  String.raw`displayName\s*(?:\|\||\?\?)\s*(?:\w+\.)*(${COMO_SE_CHAMA_UM_ENDERECO.join("|")})\b(?!\s*[(.])`,
  "g",
)

describe("nenhum ecrã escreve um endereço no lugar de um nome", () => {
  it("não há recursos de nomes que devolvam o endereço que receberam", () => {
    const culpados: string[] = []
    const base = raiz()
    for (const ficheiro of fontes(base)) {
      const fonte = readFileSync(ficheiro, "utf8")
      for (const encontro of fonte.matchAll(IDENTIDADE)) {
        culpados.push(`${relative(base, ficheiro)}: ${encontro[0].trim()}`)
      }
    }
    // The message goes in the assertion, not in a comment: anyone seeing it red is
    // reading this for the first time.
    expect(culpados, "um recurso de nomes devolve o endereço; o recurso é `nomeEmFalta`").toEqual([])
  })

  it("não há ecrã nenhum a pôr o endereço inteiro onde falta o nome do perfil", () => {
    const culpados: string[] = []
    const base = raiz()
    for (const ficheiro of fontes(base)) {
      const fonte = readFileSync(ficheiro, "utf8")
      for (const encontro of fonte.matchAll(NOME_OU_ENDERECO)) {
        culpados.push(`${relative(base, ficheiro)}: ${encontro[0].trim()}`)
      }
    }
    expect(culpados, "falta o nome do perfil e escreve-se o endereço; escreve-se `nomeEmFalta(…)`").toEqual([])
  })

  /**
   * The contrast, without which the two tests above pass in an empty folder.
   *
   * If the scan stops seeing what is in front of it, that is where it shows, and
   * it shows before someone writes the defect for real.
   */
  it("e a varredura vê o defeito quando ele existe", () => {
    // Without the `g` flag: a global `RegExp` keeps `lastIndex` between calls, and
    // `toMatch` runs `test()`, two assertions in a row with the same object gave
    // different results from the second to the third.
    const identidade = new RegExp(IDENTIDADE.source)
    const nomeOuEndereco = new RegExp(NOME_OU_ENDERECO.source)

    expect("nameFor={nameFor ?? ((address) => address)}").toMatch(identidade)
    expect("nameFor: (sender) => sender,").toMatch(identidade)
    expect("{profile.displayName || address}").toMatch(nomeOuEndereco)
    expect("{perfil.displayName ?? quem.endereco}").toMatch(nomeOuEndereco)

    // And it does not see what is not a defect. These live in the code as they do here.
    expect("map((channel) => channel)").not.toMatch(identidade)
    expect(".filter((address) => address !== me)").not.toMatch(identidade)
    expect("profile.displayName || strings.profile.unnamed").not.toMatch(nomeOuEndereco)
    expect("profile.displayName || shortAddress(address)").not.toMatch(nomeOuEndereco)

    /*
      * And the two false positives that the first version of this scan had, and that
      * its header denied. They are pinned here so the denial stops being a comfort
      * claim and becomes a measure.
    */
    expect("lista.filter((peer) => peer)").not.toMatch(identidade)
    expect("pares.some((quem) => quem)").not.toMatch(identidade)
    expect("displayName ?? endereco.slice(1)").not.toMatch(nomeOuEndereco)
  })
})

/**
 * And the resource itself, which is what all screens came to share.
 *
 * `shortAddress` has its own proof elsewhere; what is pinned here is the form
 * of the result, a word you say, not an address, because that is what the
 * four places above came to depend on.
 */
describe("o recurso de quem não tem nome", () => {
  /*
    * It said "it is "Unnamed", and neither the address nor a piece of it". Changed
    * on November 4, 2026 by owner order: the resource became the first word of the
    * address, which tells people apart. What stays pinned is that it is never the
    * address. The whole proof is in `lib/nomeEmFalta.test.ts`.
  */
  it("é a primeira palavra do endereço, e nunca o endereço", () => {
    const endereco = "@garbicis-xapsensis-giprete-birmyris:orwell.pt"
    expect(nomeEmFalta(endereco)).toBe("Garbicis")
    expect(nomeEmFalta(endereco)).not.toContain("@")
    expect(nomeEmFalta(endereco)).not.toContain(":")
  })


  it("`shortAddress`, que não é o recurso (esse tem maiúscula), continua a ser uma palavra e não o endereço", () => {
    const endereco = "@garbicis-xapsensis-giprete-birmyris:orwell.pt"
    expect(shortAddress(endereco)).toBe("garbicis")
    expect(shortAddress(endereco)).not.toContain("@")
    expect(shortAddress(endereco)).not.toContain(":")
    expect(shortAddress(endereco)).not.toContain("-")
  })
})

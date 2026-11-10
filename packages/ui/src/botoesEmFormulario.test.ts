import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Inside a form, a button with no `type` is a SUBMIT button.
 *
 * That's what HTML says, and it's the trap that made `NewRoom` create a text channel
 * for whoever chose "Voice": the button that chose the type submitted the
 * form before the choice took effect. The same cost the `Cancel`
 * in properties saving the changes it was going to discard.
 *
 * The fix is one word per button, and that's exactly the kind of
 * thing you forget again on the next button. This reads the source code so
 * the forgetting shows up here and not in production, the only way the
 * scan stays scanned.
 *
 * A form is the `<form>` literal and also the `<Modal onSubmit=…>`, which
 * renders a real `<form>` (see `Modal.tsx`): whoever writes `<Modal>` doesn't
 * see the tag, and that's where carelessness is easiest.
 *
 * **The limit of this scan, recorded on purpose:** it only ties a button to a
 * form when both are in the SAME file. A button that lives in a
 * separate component and is rendered inside passes it by, the live case is
 * `BuzzButton`, whose `<form>` is in `Composer.tsx`: removing its
 * `type="button"` today doesn't break any test here. It's covered by direct
 * assertion in `screens/chat/BuzzButton.test.tsx`. Hardening this to all buttons in the
 * project would mean touching dozens of components at once; it's written for
 * whoever comes next to decide, and isn't done in passing.
 */

/**
 * The folder to scan: the one that holds this file itself.
 *
 * Not `import.meta.url`, in jsdom it's an http address, and `fileURLToPath`
 * refuses it, nor `process.cwd()`, which is the repo root when
 * `npm test` runs vitest with `--root`. The test path is the only one
 * that's right no matter where it comes from.
 */
function raiz(): string {
  const meu = expect.getState().testPath
  if (!meu) throw new Error("sem caminho do teste: não há o que varrer")
  return dirname(meu)
}

function ficheirosJsx(pasta: string): string[] {
  const achados: string[] = []
  for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, entrada.name)
    if (entrada.isDirectory()) achados.push(...ficheirosJsx(caminho))
    else if (entrada.name.endsWith(".tsx") && !entrada.name.includes(".test.")) achados.push(caminho)
  }
  return achados
}

/** Where this file has forms: [start, end] of each one. */
function regioesDeFormulario(fonte: string): [number, number][] {
  const regioes: [number, number][] = []
  for (const encontro of fonte.matchAll(/<form\b/g)) {
    const fim = fonte.indexOf("</form>", encontro.index)
    regioes.push([encontro.index, fim === -1 ? fonte.length : fim])
  }
  for (const encontro of fonte.matchAll(/<Modal\b/g)) {
    const abertura = fimDoTag(fonte, encontro.index)
    // A `<Modal>` without `onSubmit` renders a `<div>`, and nothing submits there.
    if (!fonte.slice(encontro.index, abertura + 1).includes("onSubmit")) continue
    const fim = fonte.indexOf("</Modal>", abertura)
    regioes.push([encontro.index, fim === -1 ? fonte.length : fim])
  }
  return regioes
}

/**
 * The index of the `>` that closes the tag opened at `inicio`.
 *
 * It counts braces because JSX attributes hold expressions inside them, and the `>`
 * of an arrow function closes no tag.
 */
function fimDoTag(fonte: string, inicio: number): number {
  let chavetas = 0
  for (let i = inicio; i < fonte.length; i++) {
    const caracter = fonte[i]
    if (caracter === "{") chavetas++
    else if (caracter === "}") chavetas--
    else if (caracter === ">" && chavetas === 0) return i
  }
  return fonte.length
}

describe("botões dentro de formulários", () => {
  it("declaram todos o tipo, porque sem ele submetem", () => {
    const RAIZ = raiz()
    const culpados: string[] = []
    for (const ficheiro of ficheirosJsx(RAIZ)) {
      const fonte = readFileSync(ficheiro, "utf8")
      const regioes = regioesDeFormulario(fonte)
      if (regioes.length === 0) continue
      for (const encontro of fonte.matchAll(/<[Bb]utton\b/g)) {
        if (!regioes.some(([abre, fecha]) => abre < encontro.index && encontro.index < fecha)) continue
        const tag = fonte.slice(encontro.index, fimDoTag(fonte, encontro.index) + 1)
        if (/\btype\s*=/.test(tag)) continue
        const linha = fonte.slice(0, encontro.index).split("\n").length
        culpados.push(`${ficheiro.slice(RAIZ.length)}:${linha}`)
      }
    }
    expect(culpados).toEqual([])
  })

  it("sabe reconhecer um em falta, senão não estaria a verificar nada", () => {
    // `NewRoom` as it was before `0d40835`, cut to what matters: the
    // button that chose "Voice" submitted the Modal's form.
    const antes = `
      <Modal onSubmit={criar}>
        <Button variant="ghost" onClick={() => setKind("voice")}>Voz</Button>
      </Modal>`
    const regioes = regioesDeFormulario(antes)
    expect(regioes).toHaveLength(1)
    const botao = antes.indexOf("<Button")
    expect(regioes.some(([abre, fecha]) => abre < botao && botao < fecha)).toBe(true)
    expect(/\btype\s*=/.test(antes.slice(botao, fimDoTag(antes, botao) + 1))).toBe(false)
  })

  it("não confunde um Modal sem onSubmit com um formulário", () => {
    // Without `onSubmit` the Modal is a `<div>`: asking for `type` there would be noise.
    expect(regioesDeFormulario(`<Modal onClose={fechar}><Button variant="ghost">Ok</Button></Modal>`)).toEqual([])
  })

  it("não se deixa enganar pelo > de uma arrow function num atributo", () => {
    // `onClick={() => x}` has a `>` that closes no tag; if it did, the
    // `type` written after it would go unnoticed and this would give false
    // positives until someone gave up on the test.
    const tag = `<Button onClick={() => setKind("voice")} type="button">Voz</Button>`
    expect(/\btype\s*=/.test(tag.slice(0, fimDoTag(tag, 0) + 1))).toBe(true)
  })
})

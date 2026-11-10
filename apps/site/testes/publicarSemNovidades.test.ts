import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

/**
 * No installer ships without its version note in `docs/novidades.json`.
 *
 * The script runs for real, in a test root: four scripts copied, a
 * `package.json` and `docs/novidades.json` written here. Outside the
 * repository on purpose: this way nothing the script does after the guard
 * (reading the installer folder, talking to the VPS) can happen.
 */
const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "../../../scripts")
let raiz = ""

afterEach(() => {
  if (raiz) rmSync(raiz, { recursive: true, force: true })
  raiz = ""
})

function publicar(versao: string): { codigo: number | null; erro: string } {
  raiz = mkdtempSync(join(tmpdir(), "orwell-publicar-"))
  mkdirSync(join(raiz, "scripts"))
  mkdirSync(join(raiz, "docs"))
  for (const nome of [
    "publicar-instaladores.mjs",
    "instaladores.mjs",
    "gerar-novidades.mjs",
    "pagina-de-transferencias.mjs",
  ]) {
    copyFileSync(join(SCRIPTS, nome), join(raiz, "scripts", nome))
  }
  writeFileSync(join(raiz, "package.json"), JSON.stringify({ version: versao, nomeDaVersao: "Arca" }))
  writeFileSync(
    join(raiz, "docs/novidades.json"),
    JSON.stringify([{ versao: "1.0.3", nome: "Arca", data: "2026-10-29", itens: ["Uma nota."] }]),
  )
  const saida = spawnSync(process.execPath, [join(raiz, "scripts/publicar-instaladores.mjs")], { encoding: "utf8" })
  return { codigo: saida.status, erro: saida.stderr }
}

describe("publicar os instaladores", () => {
  it("recusa uma versão sem entrada em docs/novidades.json, e diz porquê", () => {
    const { codigo, erro } = publicar("1.0.4")
    expect(codigo).toBe(3)
    expect(erro).toContain("A versão 1.0.4 não tem entrada em docs/novidades.json")
    expect(erro).toContain("node scripts/gerar-novidades.mjs")
  })

  it("passa a guarda quando a entrada existe (e pára no passo seguinte, sem o site construído)", () => {
    const { codigo, erro } = publicar("1.0.3")
    expect(erro).not.toContain("docs/novidades.json")
    // 2 is the next refusal: no `apps/site/dist` in this root.
    expect(codigo).toBe(2)
  })
})

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  aspasNoCodigo,
  aspasNoHtml,
  // @ts-expect-error plain JavaScript script, no declarations: it also runs
  // alone, with `node scripts/aspas-angulares.mjs`.
} from "../../../scripts/aspas-angulares.mjs"

/**
 * The quotes that site visitors see are straight, never angled.
 *
 * Owner's order on November 3, 2026, same as the app (`packages/ui/src/aspas.test.ts`).
 * HTML comments are left out: they reach no one.
 */
const pasta = fileURLToPath(new URL("..", import.meta.url))
const pagina = fileURLToPath(new URL("../../../scripts/pagina-de-transferencias.mjs", import.meta.url))
const com = (dir: string, fim: RegExp): string[] =>
  readdirSync(join(pasta, dir))
    .filter((nome) => fim.test(nome))
    .map((nome) => join(pasta, dir, nome))

describe("aspas: só as direitas no site", () => {
  it("nenhuma página tem aspas angulares no texto", () => {
    const paginas = [...com("", /\.html$/), ...com("pt", /\.html$/), ...com("src", /\.html$/)]
    expect(paginas.length).toBeGreaterThan(6)
    expect(paginas.flatMap((caminho) => aspasNoHtml(caminho))).toEqual([])
  })

  it("o código do site e a página de transferências não têm aspas angulares", () => {
    const codigo = [...com("src", /\.ts$/), pagina]
    expect(codigo.flatMap((caminho) => aspasNoCodigo(caminho))).toEqual([])
  })

  it("nem aspas curvas: as páginas inglesas também usam as direitas, como a app", () => {
    // November 3, 2026: the site's English had " " and ', and the app's has " and '.
    const curvas = (fonte: string): string[] =>
      fonte
        .replace(/<!--[\s\S]*?-->/g, "")
        .split("\n")
        .filter((linha) => /[“”‘’]/.test(linha))
    const paginas = [...com("", /\.html$/), ...com("pt", /\.html$/)]
    expect(paginas.flatMap((caminho) => curvas(readFileSync(caminho, "utf8")))).toEqual([])
    const transferencias = readFileSync(pagina, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
    expect(curvas(transferencias)).toEqual([])
  })

  it("o detector ignora as angulares num comentário de HTML", () => {
    expect(aspasNoHtml("x.html", "<!-- «nota» -->\n<p>Carrega em \"Instalar\".</p>")).toEqual([])
    expect(aspasNoHtml("x.html", "<p>Carrega em «Instalar».</p>")).toHaveLength(1)
  })
})

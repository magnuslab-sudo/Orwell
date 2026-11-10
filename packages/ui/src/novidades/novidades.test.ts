import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  CAMINHO_DO_HTML,
  CAMINHO_DO_MODULO,
  dataPorExtenso,
  entradaDaVersao,
  gerarMiolo,
  gerarTudo,
  lerNovidades,
  subtitulo,
  // @ts-expect-error plain JavaScript script, no declarations: it is run by
  // `node scripts/gerar-novidades.mjs` and it does not go into any compilation.
} from "../../../../scripts/gerar-novidades.mjs"
import { NOVIDADES_HTML } from "./novidades.gen.js"

interface Entrada {
  versao: string
  nome: string
  data: string
  nota?: string
  itens: { tipo: string; texto: string }[]
}

const novidades = lerNovidades() as Entrada[]
const raiz = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../../package.json"), "utf8")) as {
  version: string
  nomeDaVersao: string
}

/**
 * The news page is generated, and what is on disk must be what the generator
 * writes today. Without this, anyone adding a version to the JSON and
 * forgetting to run the script publishes an app with the previous version's
 * notes.
 */
describe("as novidades geradas", () => {
  it("estão em dia com docs/novidades.json", () => {
    const { html, modulo } = gerarTudo() as { html: string; modulo: string }
    expect(readFileSync(CAMINHO_DO_HTML, "utf8"), "corre: node scripts/gerar-novidades.mjs").toBe(html)
    expect(readFileSync(CAMINHO_DO_MODULO, "utf8"), "corre: node scripts/gerar-novidades.mjs").toBe(modulo)
  })

  it("não têm JavaScript nenhum", () => {
    const html = readFileSync(CAMINHO_DO_HTML, "utf8")
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)
    expect(html).not.toMatch(/javascript:/i)
  })

  it("têm uma secção por versão, a mais recente primeiro", () => {
    const corpo = new DOMParser().parseFromString(NOVIDADES_HTML, "text/html")
    const numeros = [...corpo.querySelectorAll(".versao .numero")].map((no) => no.textContent)
    expect(numeros).toEqual(novidades.map((entrada) => entrada.versao))
    const datas = novidades.map((entrada) => entrada.data)
    expect([...datas].sort().reverse()).toEqual(datas)
  })

  it('têm o título "Release notes" e, por baixo, a versão da app', () => {
    const corpo = new DOMParser().parseFromString(NOVIDADES_HTML, "text/html")
    expect(corpo.querySelector("h1")?.textContent).toBe("Release notes")
    expect(corpo.querySelector(".subtitulo")?.textContent).toBe(subtitulo(raiz))
    expect(subtitulo({ version: "1.0.3", nomeDaVersao: "Arca" })).toBe("Orwell version Arca 1.0")
    expect(subtitulo({ version: "1.2.0", nomeDaVersao: "Sião" })).toBe("Orwell version Sião 1.2")
  })

  it("dizem a data por extenso, em inglês", () => {
    expect(dataPorExtenso("2026-10-29")).toBe("October 29, 2026")
    expect(dataPorExtenso("2027-01-05")).toBe("January 5, 2027")
  })

  it("escapam o texto do JSON: uma nota não traz marcação para dentro da app", () => {
    const miolo = gerarMiolo(
      [{ versao: "1.0.9", nome: "Arca", data: "2026-11-01", nota: "<b>", itens: [{ tipo: "fix", texto: '<img src=x onerror="x">' }] }],
      { version: "1.0.9", nomeDaVersao: "Arca" },
    ) as string
    expect(miolo).toContain("&lt;img src=x onerror=&quot;x&quot;&gt;")
    expect(miolo).not.toContain("<img")
    expect(miolo).not.toContain("<b>")
  })

  it("marcam cada nota com o tipo, pela ordem nova, melhoria, fix", () => {
    const miolo = gerarMiolo(
      [
        {
          versao: "1.0.9",
          nome: "Arca",
          data: "2026-11-01",
          itens: [
            { tipo: "fix", texto: "Um erro." },
            { tipo: "nova", texto: "Uma coisa nova." },
            { tipo: "melhoria", texto: "Uma coisa melhor." },
          ],
        },
      ],
      { version: "1.0.9", nomeDaVersao: "Arca" },
    ) as string
    const corpo = new DOMParser().parseFromString(miolo, "text/html")
    const tipos = [...corpo.querySelectorAll("li .tipo")].map((no) => no.textContent)
    expect(tipos).toEqual(["New", "Improvement", "Fix"])
  })

  it("recusam uma nota sem tipo conhecido", () => {
    expect(() =>
      gerarMiolo([{ versao: "1.0.9", nome: "Arca", data: "2026-11-01", itens: ["Uma nota sem tipo."] }], {
        version: "1.0.9",
        nomeDaVersao: "Arca",
      }),
    ).toThrow(/Nota inválida na versão 1.0.9/)
  })
})

/** The publish script refuses a version without an entry. This version must have one. */
describe("a versão da raiz", () => {
  it("tem entrada em docs/novidades.json", () => {
    expect(entradaDaVersao(novidades, raiz.version)).toBeDefined()
    expect(entradaDaVersao(novidades, "9.9.9")).toBeUndefined()
  })
})

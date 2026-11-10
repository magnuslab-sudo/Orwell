import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
// @ts-expect-error plain JavaScript script, no declarations: it is run by
// `node scripts/publicar-instaladores.mjs` and isn't part of any build.
import { CAMINHOS, FICHEIROS, paginaDeTransferencias } from "../../../scripts/pagina-de-transferencias.mjs"

/**
 * The downloads page in both languages.
 *
 * Since November 3, 2026 English lives at `/transferencias/` and Portuguese
 * at `/pt/transferencias/`, like the other pages (`linguas.test.ts`). The
 * page is generated when installers are published, so it does not live in the
 * site folder: we generate it here with test data and verify the output.
 * Same rules as other pages: `lang`, `hreflang`, `canonical`, the selector,
 * links in the same language, no dashes and no untranslated text.
 */
const caddyfile = readFileSync(fileURLToPath(new URL("../../../infra/Caddyfile", import.meta.url)), "utf8")

const DADOS = {
  versao: "1.0.8",
  versaoCurta: "1.0",
  nomeDaVersao: "Arca",
  folha: "estilo-ensaio.css",
  guiao: "sistema-ensaio.js",
  simbolos: '<symbol id="i-marca" viewBox="0 0 24 24"><path d="M0 0h1" /></symbol>',
  ficheiros: [
    { nome: "Orwell-1.0.8-macos-universal.dmg", sistema: "macOS", bytes: 200 * 1024 * 1024, soma: "a".repeat(64) },
    { nome: "Orwell-1.0.8-windows-x64.exe", sistema: "Windows", bytes: 120 * 1024 * 1024, soma: "b".repeat(64) },
  ],
}

type Lingua = "en" | "pt"
type Botoes = { macOS: string; Windows: string }
const VERSOES: { lingua: Lingua; inicio: string; legais: string[]; botoes: Botoes; nota: string }[] = [
  {
    lingua: "en",
    inicio: "/",
    legais: ["/privacy.html", "/terms.html", "/ambassadors.html"],
    botoes: { macOS: "Download for macOS", Windows: "Download for Windows" },
    nota: "This page runs a single script, from this origin, to put the file for your system first.",
  },
  {
    lingua: "pt",
    inicio: "/pt/",
    legais: ["/pt/privacidade.html", "/pt/termos.html", "/pt/embaixadores.html"],
    botoes: { macOS: "Descarregar para macOS", Windows: "Descarregar para Windows" },
    nota: "Esta página corre um só guião, desta origem, para pôr primeiro o ficheiro do teu sistema.",
  },
]

/** The text readers see: no comments, no images, no `<head>` (except title and
 *  description), and nothing marked with a different `lang`. */
function textoVisivel(html: string, lingua: Lingua): string {
  const cabeca = /<head>[\s\S]*?<\/head>/.exec(html)?.[0] ?? ""
  const titulo = /<title>([^<]*)<\/title>/.exec(cabeca)?.[1] ?? ""
  const descricao = /<meta\s+name="description"\s+content="([^"]*)"/.exec(cabeca)?.[1] ?? ""
  const corpo = (/<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/g, " ")
    .replace(new RegExp(`<(a|span|p)\\b[^>]*\\blang="(?!${lingua})[^"]*"[^>]*>[\\s\\S]*?<\\/\\1>`, "g"), " ")
  return [titulo, descricao, corpo.replace(/<[^>]+>/g, " ")].join(" ").replace(/\s+/g, " ")
}

describe.each(VERSOES)("a página de transferências ($lingua)", (versao) => {
  const html: string = paginaDeTransferencias(versao.lingua, DADOS)
  const cabeca = /<head>[\s\S]*?<\/head>/.exec(html)?.[0] ?? ""
  const topo = /<header class="topo">[\s\S]*?<\/header>/.exec(html)?.[0] ?? ""
  const rodape = /<footer class="rodape">[\s\S]*?<\/footer>/.exec(html)?.[0] ?? ""
  const aqui: string = CAMINHOS[versao.lingua]

  it("grava-se no sítio que o Caddy serve", () => {
    expect(FICHEIROS[versao.lingua]).toBe(versao.lingua === "en" ? "index.html" : "pt/index.html")
    expect(CAMINHOS).toEqual({ en: "/transferencias/", pt: "/pt/transferencias/" })
  })

  it("diz a língua certa no `<html lang>` e no `og:locale`", () => {
    expect(html).toMatch(new RegExp(`^<!doctype html>\\n<html lang="${versao.lingua === "en" ? "en" : "pt-PT"}">`))
    const [lingua, outra] = versao.lingua === "en" ? ["en_GB", "pt_PT"] : ["pt_PT", "en_GB"]
    expect(cabeca).toContain(`<meta property="og:locale" content="${lingua}" />`)
    expect(cabeca).toContain(`<meta property="og:locale:alternate" content="${outra}" />`)
  })

  it("declara o par hreflang, com o inglês por omissão, e o canonical é ela própria", () => {
    expect(cabeca).toContain(`<link rel="canonical" href="https://orwell.pt${aqui}" />`)
    expect(cabeca).toContain('<link rel="alternate" hreflang="en" href="https://orwell.pt/transferencias/" />')
    expect(cabeca).toContain('<link rel="alternate" hreflang="pt" href="https://orwell.pt/pt/transferencias/" />')
    expect(cabeca).toContain('<link rel="alternate" hreflang="x-default" href="https://orwell.pt/transferencias/" />')
  })

  it('tem o selector "EN · PT" só no rodapé, a levar à outra língua', () => {
    // Owner request on November 3, 2026, same as the other pages.
    expect(topo).not.toBe("")
    expect(topo).not.toContain('class="linguas"')
    expect(topo).not.toMatch(/hreflang=/)
    expect(html.match(/<nav class="linguas"/g)).toHaveLength(1)
    const selector = /<nav class="linguas"[\s\S]*?<\/nav>/.exec(rodape)?.[0] ?? ""
    expect(selector).not.toBe("")
    const en = /<a href="([^"]+)" hreflang="en"[^>]*>EN<\/a>/.exec(selector)
    const pt = /<a href="([^"]+)" hreflang="pt"[^>]*>PT<\/a>/.exec(selector)
    expect(en?.[1]).toBe("/transferencias/")
    expect(pt?.[1]).toBe("/pt/transferencias/")
    const [actual, outra] = versao.lingua === "en" ? [en?.[0], pt?.[0]] : [pt?.[0], en?.[0]]
    expect(actual).toContain('aria-current="page"')
    expect(outra).toContain(`lang="${versao.lingua === "en" ? "pt" : "en"}"`)
    expect(selector.indexOf(">EN<")).toBeLessThan(selector.indexOf(">PT<"))
  })

  it("tem o topo das outras páginas: a marca, que leva à página de entrada da mesma língua, e o Entrar", () => {
    // "Home" moved to the footer, like on the other pages (direction "02 Editorial").
    expect(html).toContain('<body class="editorial">')
    expect(topo).toContain(`<a class="marca" href="${versao.inicio}">`)
    expect(topo).toContain(`<a class="topo-entrar" href="/app/">${versao.lingua === "en" ? "Sign in" : "Entrar"}</a>`)
    expect(rodape).toContain(`<a href="${versao.inicio}">${versao.lingua === "en" ? "Home" : "Início"}</a>`)
  })

  it("não tem o estilo antigo: nem céu, nem selo, nem cartões numerados", () => {
    expect(html).not.toContain('class="ceu"')
    expect(html).not.toContain("cabeca-selo")
    expect(html).not.toContain('class="passos"')
    expect(html).not.toContain('class="descargas"')
    expect(html).not.toContain('class="topo-links"')
  })

  it("o rodapé tem os mesmos links das outras páginas, com o Apoiar", () => {
    const nav = /<nav class="rodape-links">[\s\S]*?<\/nav>/.exec(rodape)?.[0] ?? ""
    const links = [...nav.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1])
    expect(links).toEqual([
      versao.inicio,
      aqui,
      ...versao.legais,
      "https://ko-fi.com/orwell_eu",
      "mailto:orwell.eu@proton.me",
    ])
  })

  it("os links do site ficam na mesma língua, fora o selector e os instaladores", () => {
    const semSelector = html.replace(/<nav class="linguas"[\s\S]*?<\/nav>/g, "").replace(/<!--[\s\S]*?-->/g, "")
    const links = [...semSelector.matchAll(/<a\b[^>]*\bhref="(\/[^"]*)"/g)]
      .map((m) => m[1] as string)
      .filter((href) => !href.startsWith("/app/") && !/^\/transferencias\/[^/]+\.(dmg|exe)$/.test(href))
      // Third-party notices are one file, in both languages (1.2.1).
      .filter((href) => href !== "/terceiros.txt")
    expect(links.length).toBeGreaterThan(0)
    for (const href of links) {
      if (versao.lingua === "pt") expect(href, href).toMatch(/^\/pt\//)
      else expect(href, href).not.toMatch(/^\/pt\b|\/(embaixadores|privacidade|termos)\.html/)
    }
    for (const legal of versao.legais) expect(rodape).toContain(`href="${legal}"`)
  })

  it("os instaladores e as somas são os mesmos nas duas línguas", () => {
    for (const f of DADOS.ficheiros) {
      expect(html).toContain(`href="/transferencias/${f.nome}"`)
      expect(html).toContain(`<span class="descarga-rotulo">SHA-256</span>${f.soma}</code>`)
    }
    expect(html).toContain(`>${versao.lingua === "en" ? "Version" : "Versão"} 1.0.8<`)
    expect(html).toContain('Orwell 1.0 "Arca"')
    expect(cabeca).toContain('<link rel="stylesheet" href="/assets/estilo-ensaio.css" />')
  })

  it("cada instalador é um botão com o sistema no nome, e por baixo a versão, o tamanho e a soma", () => {
    // Owner request on November 3, 2026. The button is the site's main focus.
    const instaladores = /<ul class="instaladores">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? ""
    const itens = [...instaladores.matchAll(/<li class="instalador instalador-(\w+)">([\s\S]*?)<\/li>/g)]
    expect(itens.map((m) => m[1])).toEqual(["macos", "windows"])
    for (const [i, f] of DADOS.ficheiros.entries()) {
      const item = itens[i]?.[2] ?? ""
      const botao = `<a class="botao botao-forte botao-instalador" href="/transferencias/${f.nome}">${versao.botoes[f.sistema as keyof Botoes]} <span aria-hidden="true">→</span></a>`
      expect(item).toContain(botao)
      const meta = /<p class="instalador-meta">([\s\S]*?)<\/p>/.exec(item)?.[1] ?? ""
      expect(meta.replace(/<[^>]+>/g, "")).toBe(
        `${versao.lingua === "en" ? "Version" : "Versão"} 1.0.8 · ${f.bytes / 1024 / 1024} MB · ${f.nome}`,
      )
      // Order inside the card: button, then metadata, then total.
      const posBotao = item.indexOf(botao)
      expect(posBotao).toBeGreaterThan(-1)
      expect(item.indexOf('class="instalador-meta"')).toBeGreaterThan(posBotao)
      expect(item.indexOf(f.soma)).toBeGreaterThan(item.indexOf('class="instalador-meta"'))
    }
    // The old card with just "Download" is gone.
    expect(html).not.toMatch(/class="botao[^"]*"[^>]*>(Download|Descarregar)<\/a>/)
  })

  it("um sistema sem botão faz falhar a página, em vez de a escrever sem rótulo", () => {
    const ficheiros = [{ nome: "Orwell.AppImage", sistema: "Linux", bytes: 1, soma: "c".repeat(64) }]
    expect(() => paginaDeTransferencias(versao.lingua, { ...DADOS, ficheiros })).toThrow(/Linux/)
    expect(() => paginaDeTransferencias(versao.lingua, { ...DADOS, guiao: "" })).toThrow(/guião/)
  })

  it("põe primeiro o botão do sistema de quem visita, pelo guião do site e pela folha", () => {
    expect(cabeca).toContain('<script type="module" src="/assets/sistema-ensaio.js"></script>')
    const folha = readFileSync(fileURLToPath(new URL("../src/estilo.css", import.meta.url)), "utf8")
    expect(folha).toMatch(
      /:root\[data-sistema="windows"\] \.instalador-windows,\s*:root\[data-sistema="macos"\] \.instalador-macos \{\s*order: -1;/,
    )
    expect(folha).toMatch(/\.instaladores \{\s*display: grid;/)
  })

  it("mantém a promessa do rodapé: um só guião, desta origem, e nenhum pedido a mais ninguém", () => {
    const guioes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[0])
    expect(guioes).toEqual(['<script type="module" src="/assets/sistema-ensaio.js"></script>'])
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)
    expect(rodape.replace(/\s+/g, " ")).toContain(versao.nota)
    const politica = /http-equiv="Content-Security-Policy"\s*content="([^"]+)"/.exec(html)?.[1] ?? ""
    expect(politica).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    )
    // A `src` and a `<link href>` are the browser fetching on its own; an `<a href>`
    // is a person choosing to follow a link (the "Support" footer link to Ko-fi),
    // as in `pagina.test.ts`.
    expect(html).not.toMatch(/\bsrc="https?:\/\/(?!orwell\.pt\/)/)
    expect(html).not.toMatch(/<link\b[^>]*\bhref="https?:\/\/(?!orwell\.pt\/)/)
  })

  it("não tem travessões no texto que se lê", () => {
    expect(textoVisivel(html, versao.lingua)).not.toMatch(/[—–]/)
  })

  it("não ficou texto da outra língua por traduzir", () => {
    const texto = textoVisivel(html, versao.lingua)
    if (versao.lingua === "en") {
      expect(texto).not.toMatch(/[ãõçáàâéêíóôú]/i)
      expect(texto).not.toMatch(/\b(não|que|para|com|uma|um|os|tu|teu|tua|está|são|mais|nós|página)\b/i)
    } else {
      expect(texto).not.toMatch(/\b(the|and|you|your|with|this|that|is|are|of|we|our|for)\b/i)
    }
  })
})

describe("o Caddyfile, para as transferências", () => {
  const blocoDe = (nome: string): string => new RegExp(`@${nome} \\{([\\s\\S]*?)\\n\\t\\}`).exec(caddyfile)?.[1] ?? ""
  const raiz = blocoDe("primeiraVisitaPt")
  const transferencias = blocoDe("primeiraVisitaPtTransferencias")
  const linha = (bloco: string, inicio: string): string =>
    bloco.split("\n").find((l) => l.trim().startsWith(inicio))?.trim() ?? ""

  it("serve a portuguesa em /pt/transferencias/, a partir do volume dos instaladores", () => {
    const bloco = /handle \/pt\/transferencias\/ \{([\s\S]*?)\n\t\}/.exec(caddyfile)?.[1] ?? ""
    expect(bloco).toContain("root * /srv")
    expect(bloco).toContain("rewrite * /transferencias/pt/index.html")
    expect(bloco).toContain("file_server")
  })

  it("escolhe a língua da primeira visita com a mesma regra da raiz, e com 302", () => {
    // The same pattern and the same exception for visitors from the site itself:
    // the 14 cases in `linguas.test.ts` apply here too.
    expect(transferencias).toContain("path /transferencias/\n")
    expect(linha(transferencias, "header_regexp")).not.toBe("")
    expect(linha(transferencias, "header_regexp")).toBe(linha(raiz, "header_regexp"))
    expect(linha(transferencias, "not expression")).toBe(linha(raiz, "not expression"))
    expect(caddyfile).toContain("redir @primeiraVisitaPtTransferencias /pt/transferencias/ 302")
    expect(caddyfile).toMatch(/@transferencias path \/transferencias\/\n\theader @transferencias Vary "Accept-Language, Referer"/)
  })

  it("não redirecciona os instaladores nem os manifestos, só a página", () => {
    // `path /transferencias/` is the exact path: `versao.json` and `.dmg` files
    // stay outside, and the installed app still finds them.
    expect(transferencias).not.toMatch(/path \/transferencias\/\*/)
  })

  it("dá um endereço só à página portuguesa", () => {
    expect(caddyfile).toContain("redir /pt/transferencias /pt/transferencias/ 301")
    expect(caddyfile).toContain("@transferenciasPtNoDisco path /transferencias/pt /transferencias/pt/ /transferencias/pt/index.html")
    expect(caddyfile).toContain("redir @transferenciasPtNoDisco /pt/transferencias/ 301")
  })
})

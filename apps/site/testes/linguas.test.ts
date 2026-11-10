import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The site's two languages, verified.
 *
 * Owner's order on November 3, 2026: "I want the site in English first, pt
 * second". English lives at the root and Portuguese under `/pt/`, page by page.
 * What breaks here is what fails silently when someone adds or changes a page
 * in one language and forgets the other: the `hreflang` pair, the selector,
 * the `lang`, links that switch languages unintentionally, old names that stop
 * opening, and text left untranslated.
 */
const pasta = fileURLToPath(new URL("..", import.meta.url))
const caddyfile = readFileSync(fileURLToPath(new URL("../../../infra/Caddyfile", import.meta.url)), "utf8")

/** The pairs: the public path in English and its Portuguese counterpart. */
const PARES = [
  { en: "index.html", pt: "pt/index.html", urlEn: "/", urlPt: "/pt/" },
  { en: "ambassadors.html", pt: "pt/embaixadores.html", urlEn: "/ambassadors.html", urlPt: "/pt/embaixadores.html" },
  { en: "privacy.html", pt: "pt/privacidade.html", urlEn: "/privacy.html", urlPt: "/pt/privacidade.html" },
  { en: "terms.html", pt: "pt/termos.html", urlEn: "/terms.html", urlPt: "/pt/termos.html" },
] as const

type Pagina = { ficheiro: string; lingua: "en" | "pt"; aqui: string; outra: string; urlEn: string; urlPt: string }

const PAGINAS: Pagina[] = PARES.flatMap((par) => [
  { ficheiro: par.en, lingua: "en" as const, aqui: par.urlEn, outra: par.urlPt, urlEn: par.urlEn, urlPt: par.urlPt },
  { ficheiro: par.pt, lingua: "pt" as const, aqui: par.urlPt, outra: par.urlEn, urlEn: par.urlEn, urlPt: par.urlPt },
])

const ler = (ficheiro: string): string => readFileSync(`${pasta}${ficheiro}`, "utf8")

/**
 * The text a person reads, in one language only.
 *
 * Out go comments (they are for maintainers, in Portuguese, in both versions),
 * the `<head>` except for title and description, graphics, build markers,
 * and anything marked with a different `lang` (the "PT" from the selector, on
 * an English page). In come image alt texts, which are also read.
 */
function textoVisivel(html: string, lingua: "en" | "pt"): string {
  const cabeca = /<head>[\s\S]*?<\/head>/.exec(html)?.[0] ?? ""
  const titulo = /<title>([^<]*)<\/title>/.exec(cabeca)?.[1] ?? ""
  const descricao = /<meta\s+name="description"\s+content="([^"]*)"/.exec(cabeca)?.[1] ?? ""
  const corpo = (/<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/g, " ")
    .replace(new RegExp(`<(a|span|p)\\b[^>]*\\blang="(?!${lingua})[^"]*"[^>]*>[\\s\\S]*?<\\/\\1>`, "g"), " ")
  const alternativos = [...corpo.matchAll(/\balt="([^"]*)"/g)].map((m) => m[1]).join(" ")
  return [titulo, descricao, corpo.replace(/<[^>]+>/g, " "), alternativos]
    .join(" ")
    .replace(/%[A-Z_]+%/g, " ")
    .replace(/\s+/g, " ")
}

describe.each(PAGINAS)("$ficheiro", (pagina) => {
  const html = ler(pagina.ficheiro)
  const cabeca = /<head>[\s\S]*?<\/head>/.exec(html)?.[0] ?? ""

  it("diz a língua certa no `<html lang>` e no `og:locale`", () => {
    expect(html).toMatch(new RegExp(`^<!doctype html>\\n<html lang="${pagina.lingua === "en" ? "en" : "pt-PT"}">`))
    const [aqui, outra] = pagina.lingua === "en" ? ["en_GB", "pt_PT"] : ["pt_PT", "en_GB"]
    expect(cabeca).toContain(`<meta property="og:locale" content="${aqui}" />`)
    expect(cabeca).toContain(`<meta property="og:locale:alternate" content="${outra}" />`)
  })

  it("declara o par hreflang, com o inglês por omissão, e o canonical é ela própria", () => {
    expect(cabeca).toContain(`<link rel="canonical" href="https://orwell.pt${pagina.aqui}" />`)
    expect(cabeca).toContain(`<link rel="alternate" hreflang="en" href="https://orwell.pt${pagina.urlEn}" />`)
    expect(cabeca).toContain(`<link rel="alternate" hreflang="pt" href="https://orwell.pt${pagina.urlPt}" />`)
    expect(cabeca).toContain(`<link rel="alternate" hreflang="x-default" href="https://orwell.pt${pagina.urlEn}" />`)
  })

  it('tem o selector "EN · PT" só no rodapé, a levar à mesma página na outra língua', () => {
    // Owner's request on November 3, 2026: the selector leaves the header and
    // stays only in the footer. The header is the brand and "Sign in".
    const topo = /<header class="topo">[\s\S]*?<\/header>/.exec(html)?.[0] ?? ""
    const rodape = /<footer class="rodape">[\s\S]*?<\/footer>/.exec(html)?.[0] ?? ""
    expect(topo).not.toBe("")
    expect(topo).not.toContain('class="linguas"')
    expect(topo).not.toMatch(/hreflang=/)
    expect(html.match(/<nav class="linguas"/g)).toHaveLength(1)
    const selector = /<nav class="linguas"[\s\S]*?<\/nav>/.exec(rodape)?.[0] ?? ""
    expect(selector).not.toBe("")
    const en = /<a href="([^"]+)" hreflang="en"[^>]*>EN<\/a>/.exec(selector)
    const pt = /<a href="([^"]+)" hreflang="pt"[^>]*>PT<\/a>/.exec(selector)
    expect(en?.[1]).toBe(pagina.urlEn)
    expect(pt?.[1]).toBe(pagina.urlPt)
    // The page's language gets `aria-current`; the other gets its `lang`.
    const [actual, outra] = pagina.lingua === "en" ? [en?.[0], pt?.[0]] : [pt?.[0], en?.[0]]
    expect(actual).toContain('aria-current="page"')
    expect(outra).toContain(`lang="${pagina.lingua === "en" ? "pt" : "en"}"`)
    expect(selector.indexOf(">EN<")).toBeLessThan(selector.indexOf(">PT<"))
  })

  it("os links internos ficam na mesma língua, fora o selector", () => {
    /*
      A Portuguese page linking to `/privacy.html` sends the person back to
      English mid-read, and vice versa. Count the `<a href>` to site pages; the
      app belongs to everyone. Downloads count if they have a Portuguese version
      (/pt/transferencias/). The selector and the legal pages line that points to
      the pair are the only intentional language switches.
      */
    const semSelector = html
      .replace(/<nav class="linguas"[\s\S]*?<\/nav>/g, "")
      .replace(/<p class="legal-lingua">[\s\S]*?<\/p>/g, "")
      .replace(/<!--[\s\S]*?-->/g, "")
    const links = [...semSelector.matchAll(/<a\b[^>]*\bhref="(\/[^"]*)"/g)]
      .map((m) => m[1] as string)
      .filter((href) => !href.startsWith("/app/"))
      // Third-party notices are one file, in both languages (1.2.1).
      .filter((href) => href !== "/terceiros.txt")
    expect(links.length).toBeGreaterThan(0)
    for (const href of links) {
      if (pagina.lingua === "pt") expect(href, href).toMatch(/^\/pt\//)
      else expect(href, href).not.toMatch(/^\/pt\b|\/(embaixadores|privacidade|termos)\.html/)
    }
  })

  it("não tem travessões no texto que se lê", () => {
    expect(textoVisivel(html, pagina.lingua)).not.toMatch(/[\u2014\u2013]/)
  })

  it("não ficou texto da outra língua por traduzir", () => {
    /*
      A simple check, not a language detector: short, frequent words that exist
      in only one language, and Portuguese accents. A paragraph forgotten in the
      other language always has several.
    */
    const texto = textoVisivel(html, pagina.lingua)
    if (pagina.lingua === "en") {
      expect(texto).not.toMatch(/[ãõçáàâéêíóôú]/i)
      expect(texto).not.toMatch(/\b(não|que|para|com|uma|um|os|tu|teu|tua|está|são|mais|nós|página)\b/i)
    } else {
      expect(texto).not.toMatch(/\b(the|and|you|your|with|this|that|is|are|of|we|our|for)\b/i)
    }
  })
})

describe("as páginas legais", () => {
  it.each([
    ["privacy.html", "/pt/privacidade.html"],
    ["terms.html", "/pt/termos.html"],
  ])("%s diz no topo que a versão portuguesa é a que vale", (ficheiro, par) => {
    const html = ler(ficheiro)
    const linha = /<p class="legal-lingua">[\s\S]*?<\/p>/.exec(html)?.[0] ?? ""
    expect(linha.replace(/<[^>]+>/g, "").replace(/\s+/g, " ")).toContain("The Portuguese version is the legally binding one.")
    expect(linha).toContain(`href="${par}"`)
    expect(html.indexOf('class="legal-lingua"')).toBeLessThan(html.indexOf('class="legal-abertura"'))
  })

  it.each([
    ["pt/privacidade.html", "/privacy.html"],
    ["pt/termos.html", "/terms.html"],
  ])("%s diz que há tradução, e que vale a portuguesa", (ficheiro, par) => {
    const html = ler(ficheiro)
    const linha = (/<p class="legal-lingua">[\s\S]*?<\/p>/.exec(html)?.[0] ?? "").replace(/\s+/g, " ")
    expect(linha).toContain("tradução em inglês")
    expect(linha).toContain("A versão portuguesa é a que vale juridicamente.")
    expect(linha).toContain(`href="${par}"`)
  })
})

describe("o Caddyfile", () => {
  it.each([
    ["/embaixadores.html", "/pt/embaixadores.html"],
    ["/privacidade.html", "/pt/privacidade.html"],
    ["/termos.html", "/pt/termos.html"],
  ])("leva o nome antigo %s para %s com 301", (antigo, novo) => {
    // There are shared links for the old Portuguese names. Breaking one is
    // a 404 on the site where someone recommended us.
    expect(caddyfile).toContain(`redir ${antigo} ${novo} 301`)
  })

  const bloco = /@primeiraVisitaPt \{([\s\S]*?)\n\t\}/.exec(caddyfile)?.[1] ?? ""
  const padrao = /header_regexp Accept-Language `\(\?i\)([^`]+)`/.exec(bloco)?.[1] ?? ""
  // Caddy's RE2 and JavaScript's regex engine read this expression the same way:
  // only character classes, non-capturing groups and quantifiers, no `\b` or lookahead.
  const preferePt = (cabecalho: string): boolean => new RegExp(padrao, "i").test(cabecalho)

  it("só redirecciona a raiz, com 302, e não quem já vem do próprio site", () => {
    expect(bloco).toContain("path /\n")
    expect(padrao).not.toBe("")
    expect(bloco).toMatch(/not expression `\{http\.request\.header\.Referer\}\.startsWith\(/)
    expect(caddyfile).toContain("redir @primeiraVisitaPt /pt/ 302")
    // The same root serves different content to different browsers.
    expect(caddyfile).toContain('header @raiz Vary "Accept-Language, Referer"')
  })

  /*
    `orwell.pt/en` took 404 (3 November 2026). English lives at the root:
    `/en` and `/en/` lead to 301 to `/`, and `/en/<página>` to `/<página>`. The
    Caddy expression runs here in the JavaScript engine, which reads it as RE2
    (classes and one group only). The test against real Caddy, with jumps
    all the way through, is in `scripts/provar-linguas-caddy.sh`.
  */
  const enPagina = /@enPagina path_regexp enPagina (\S+)/.exec(caddyfile)?.[1] ?? ""
  const destinoEn = (caminho: string): string | undefined => {
    if (caminho === "/en" || caminho === "/en/") return "/"
    const m = new RegExp(enPagina).exec(caminho)
    return m ? `/${m[1]}` : undefined
  }

  it("leva /en e /en/ para a raiz com 301", () => {
    expect(caddyfile).toContain("@enRaiz path /en /en/\n\tredir @enRaiz / 301")
    expect(caddyfile).toContain("redir @enPagina /{re.enPagina.1} 301")
  })

  it.each([
    ["/en", "/"],
    ["/en/", "/"],
    ["/en/privacy.html", "/privacy.html"],
    ["/en/terms.html", "/terms.html"],
    ["/en/ambassadors.html", "/ambassadors.html"],
    ["/en/transferencias/", "/transferencias/"],
    ["/en/index.html", "/index.html"],
  ])("%s leva a %s", (caminho, destino) => {
    expect(enPagina).not.toBe("")
    expect(destinoEn(caminho)).toBe(destino)
  })

  it.each(["/en/\\exemplo.org", "/en/\texemplo.org", "/en/a\r\nX: 1", "/english", "/enx/privacy.html", "/pt/en/"])(
    "%s não leva a lado nenhum, e muito menos para fora do site",
    (caminho) => {
      expect(destinoEn(caminho)).toBeUndefined()
    },
  )

  it("nenhum destino de /en/ começa por duas barras, que o browser lia como outro site", () => {
    // Caddy normalizes slashes before comparing; and even without that, the
    // expression requires a letter or digit right after `/en/`.
    expect(destinoEn("/en//exemplo.org")).toBeUndefined()
    expect(enPagina).toBe("^/en/([A-Za-z0-9][A-Za-z0-9._/-]*)$")
  })

  it("o /en não cria um ciclo com o 302 da primeira visita", () => {
    // The 302 only leaves the root (or /transferencias/) to /pt/…, and no
    // `/en` destination starts with `/en`: the longest chain is /en/ → / → /pt/.
    expect(caddyfile).not.toMatch(/redir \S+ \/en\b/)
    expect(destinoEn("/en/")).toBe("/")
    expect(caddyfile).toContain("redir @primeiraVisitaPt /pt/ 302")
  })

  it("e não guarda escolha nenhuma em cookie", () => {
    expect(caddyfile).not.toMatch(/Set-Cookie|lang=/i)
  })

  it.each([
    ["pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7", true],
    ["pt-BR,pt;q=0.9", true],
    ["pt", true],
    ["PT-pt", true],
    ["fr-FR, pt;q=0.8, en;q=0.5", true],
    ["es,pt-PT;q=0.9", true],
    ["en-US,en;q=0.9,pt;q=0.8", false],
    ["en-GB,pt-PT;q=0.9", false],
    ["en", false],
    ["fr,de", false],
    ["es-ES,en;q=0.9,pt;q=0.8", false],
    ["", false],
    ["*", false],
    ["ptx", false],
  ])('Accept-Language "%s" vai para /pt/: %s', (cabecalho, esperado) => {
    expect(preferePt(cabecalho)).toBe(esperado)
  })
})

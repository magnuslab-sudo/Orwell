import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  ENDERECO_DO_APOIO,
  type Apoio,
  carregarApoio,
  larguraDoEnchimento,
  linguaDe,
  medir,
  MEDIDOR_LIGADO,
  textoDoApoio,
  validarApoio,
} from "../src/apoio.js"

/**
 * The support meter for the "Support" section (`src/apoio.ts`), requested by the owner
 * on November 3, 2026. Visitors never request anything from GoFundMe: the script reads
 * only the JSON from our server, on this origin, and without it the section looks as before.
 */
const pasta = fileURLToPath(new URL("..", import.meta.url))
const ler = (nome: string) => readFileSync(`${pasta}${nome}`, "utf8")
const ENTRADAS = ["index.html", "pt/index.html"] as const
const OUTRAS = ["privacy.html", "terms.html", "ambassadors.html", "pt/privacidade.html", "pt/termos.html", "pt/embaixadores.html"]
const politicaDe = (pagina: string) => pagina.match(/http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/)?.[1] ?? ""
/** The text with non-breaking spaces read as spaces. */
const plano = (texto: string) => texto.replace(/ /g, " ")

const APOIO: Apoio = { angariado: 120, meta: 2200, metaTotal: 10_000, doacoes: 4, moeda: "EUR", lidoEm: "2026-11-03T12:00:00.000Z" }

describe("o texto do medidor", () => {
  it("diz o valor, a meta e as doações nas duas línguas", () => {
    expect(textoDoApoio(APOIO, "en")).toBe("€120 raised of €2,200 · 4 donations")
    expect(plano(textoDoApoio(APOIO, "pt"))).toBe("120 € angariados de 2 200 € · 4 doações")
  })

  it("uma doação diz-se no singular", () => {
    const uma = { ...APOIO, angariado: 5, doacoes: 1 }
    expect(textoDoApoio(uma, "en")).toBe("€5 raised of €2,200 · 1 donation")
    expect(plano(textoDoApoio(uma, "pt"))).toBe("5 € angariados de 2 200 € · 1 doação")
  })

  it("os números de pt não partem no fim da linha", () => {
    expect(textoDoApoio(APOIO, "pt")).toContain("2 200 €")
  })

  it("arredonda para baixo, e nunca diz mais do que entrou", () => {
    expect(textoDoApoio({ ...APOIO, angariado: 12.9 }, "en")).toMatch(/^€12 raised/)
  })
})

describe("a língua", () => {
  it("lê o lang das duas páginas de entrada", () => {
    // Portuguese is "pt-PT", not "pt" (November 3, 2026).
    expect(ler("pt/index.html")).toMatch(/<html lang="pt-PT">/)
    expect(linguaDe("pt-PT")).toBe("pt")
    expect(linguaDe("pt")).toBe("pt")
    expect(linguaDe("en")).toBe("en")
    expect(linguaDe("")).toBe("en")
  })
})

describe("a medida", () => {
  it("antes da primeira meta mede contra os 2 200 €", () => {
    expect(medir(APOIO)).toEqual({ alvo: 2200, fraccao: 120 / 2200 })
  })

  it("passada a primeira meta mede contra os 10 000 €", () => {
    const passou = { ...APOIO, angariado: 2300, doacoes: 40 }
    expect(medir(passou)).toEqual({ alvo: 10_000, fraccao: 0.23 })
    expect(textoDoApoio(passou, "en")).toBe("€2,300 raised of €10,000 · 40 donations")
    expect(plano(textoDoApoio(passou, "pt"))).toBe("2 300 € angariados de 10 000 € · 40 doações")
  })

  it("na própria primeira meta já mede contra a total", () => {
    expect(medir({ ...APOIO, angariado: 2200 }).alvo).toBe(10_000)
  })

  it("não passa de cheia", () => {
    expect(medir({ ...APOIO, angariado: 12_000 }).fraccao).toBe(1)
  })

  it("um valor pequeno mostra-se na mesma, e zero fica vazio", () => {
    expect(larguraDoEnchimento(5 / 2200)).toBe("1.5%")
    expect(larguraDoEnchimento(0)).toBe("0%")
    expect(larguraDoEnchimento(0.23)).toBe("23%")
    expect(larguraDoEnchimento(1)).toBe("100%")
  })
})

describe("o JSON", () => {
  it("aceita o formato do servidor", () => {
    expect(validarApoio(APOIO)).toEqual(APOIO)
  })

  it.each([
    ["nulo", null],
    ["um texto", "120"],
    ["sem angariado", { ...APOIO, angariado: undefined }],
    ["com angariado em texto", { ...APOIO, angariado: "120" }],
    ["com angariado negativo", { ...APOIO, angariado: -1 }],
    ["com meta zero", { ...APOIO, meta: 0 }],
    ["com a meta total abaixo da primeira", { ...APOIO, metaTotal: 1000 }],
    ["com doações fraccionárias", { ...APOIO, doacoes: 1.5 }],
    ["noutra moeda", { ...APOIO, moeda: "USD" }],
    ["sem lidoEm", { ...APOIO, lidoEm: undefined }],
  ])("recusa um JSON %s", (_caso, dados) => {
    expect(validarApoio(dados)).toBeUndefined()
  })
})

/** A test meter: the minimum that `mostrarApoio` touches. */
function medidorDeEnsaio() {
  const numeros = { textContent: "" }
  const larguras: string[] = []
  const enchimento = { style: { setProperty: (_nome: string, valor: string) => void larguras.push(valor) } }
  const medidor = {
    dataset: {} as Record<string, string>,
    querySelector: (seletor: string) => (seletor === ".apoio-numeros" ? numeros : seletor === ".apoio-enchimento" ? enchimento : null),
  }
  return { medidor: medidor as unknown as HTMLElement, numeros, larguras, dataset: medidor.dataset }
}

const respostaCom = (corpo: unknown, estado = 200) =>
  (async () => new Response(JSON.stringify(corpo), { status: estado, headers: { "content-type": "application/json" } })) as typeof fetch

describe("o pedido do site", () => {
  it("pede só o JSON desta origem, sem credenciais, e enche a barra", async () => {
    const pedidos: Array<[string, RequestInit | undefined]> = []
    const pedir = (async (url: string, init?: RequestInit) => {
      pedidos.push([url, init])
      return new Response(JSON.stringify(APOIO), { status: 200 })
    }) as typeof fetch
    const ensaio = medidorDeEnsaio()
    expect(await carregarApoio(ensaio.medidor, "en", pedir)).toBe(true)
    expect(pedidos).toHaveLength(1)
    expect(pedidos[0]?.[0]).toBe("/_enclave/apoiar.json")
    expect(ENDERECO_DO_APOIO).toMatch(/^\/[^/]/)
    expect(pedidos[0]?.[1]?.credentials).toBe("omit")
    expect(ensaio.numeros.textContent).toBe("€120 raised of €2,200 · 4 donations")
    expect(ensaio.dataset.estado).toBe("pronto")
    expect(ensaio.larguras).toEqual(["5.45%"])
  })

  it.each([
    ["um 404", respostaCom({ erro: "sem-valor" }, 404)],
    ["um 502", respostaCom({}, 502)],
    ["um JSON com outra forma", respostaCom({ angariado: "muito" })],
    ["um corpo que não é JSON", (async () => new Response("<html>", { status: 200 })) as typeof fetch],
    [
      "uma rede em baixo",
      (async () => {
        throw new TypeError("Failed to fetch")
      }) as typeof fetch,
    ],
  ])("com %s a secção fica como estava, sem erro", async (_caso, pedir) => {
    const ensaio = medidorDeEnsaio()
    await expect(carregarApoio(ensaio.medidor, "pt", pedir)).resolves.toBe(false)
    expect(ensaio.dataset.estado).toBeUndefined()
    expect(ensaio.numeros.textContent).toBe("")
    expect(ensaio.larguras).toEqual([])
  })
})

describe("as páginas", () => {
  it.each(ENTRADAS)("%s traz o lugar do medidor vazio e escondido, na secção Apoiar, depois do botão", (nome) => {
    const apoio = /<section class="seccao seccao-apoio" id="apoiar">[\s\S]*?<\/section>/.exec(ler(nome))?.[0] ?? ""
    // Hidden since November 9, 2026 (see `MEDIDOR_LIGADO`).
    const medidor = /<div class="apoio-medidor" id="apoio-medidor" hidden>[\s\S]*?<\/p>\s*<\/div>/.exec(apoio)?.[0] ?? ""
    expect(medidor).not.toBe("")
    expect(apoio.indexOf("apoio-ligacao")).toBeLessThan(apoio.indexOf("apoio-medidor"))
    expect(medidor).toContain('<p class="apoio-numeros" aria-live="polite"></p>')
    expect(medidor).toContain('<div class="apoio-barra" aria-hidden="true"><div class="apoio-enchimento"></div></div>')
  })

  it.each(ENTRADAS)("%s só liga a esta origem", (nome) => {
    expect(politicaDe(ler(nome))).toContain("connect-src 'self';")
    expect(politicaDe(ler(nome))).not.toMatch(/gofundme|https?:/i)
  })

  it.each(OUTRAS)("%s continua sem ligar a lado nenhum", (nome) => {
    expect(politicaDe(ler(nome))).not.toContain("connect-src")
  })

  it("o guião não fala com o GoFundMe", () => {
    const guiao = ler("src/apoio.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
    expect(guiao).not.toMatch(/gofundme|gofund\.me|https?:\/\//i)
  })

  it("o lugar tem a altura reservada e invisível, e o enchimento não pára com movimento reduzido", () => {
    const estilo = ler("src/estilo.css")
    expect(estilo).toMatch(/\.apoio-medidor \{[^}]*visibility: hidden;/)
    expect(estilo).toMatch(/\.apoio-medidor\[data-estado="pronto"\] \{[^}]*visibility: visible;/)
    expect(estilo).toMatch(/\.apoio-numeros \{[^}]*min-height:/)
    const reduzido = estilo.slice(estilo.lastIndexOf("@media (prefers-reduced-motion: reduce)"))
    expect(reduzido).toMatch(/\.apoio-enchimento \{[^}]*transition-duration: 4\.8s !important;/)
  })
})

/**
 * The top banner and Ko-fi (requested by the owner on November 9, 2026: "put it at the
 * start and end, I really need donations"). On the same day the owner decided that new
 * locations link only to Ko-fi: GoFundMe leaves the banner and section, staying only in
 * the footer. The GoFundMe meter is turned off, pending confirmation.
 */
const KOFI = '<a class="botao-kofi" href="https://ko-fi.com/orwell_eu" target="_blank" rel="noopener noreferrer">'
const SETA = ' <span aria-hidden="true">→</span></a>'
const TEXTOS = {
  "index.html": {
    frase: "I'm an independent solo developer. No ads, no investors: your support means I can keep building Orwell and other public-interest projects.",
    doar: "Support me on Ko-fi",
    botao: "Support me on Ko-fi",
    paraQue: "Every euro goes to the server, the licences and the legal costs",
    partilha: "If you can't donate, share Orwell.",
  },
  "pt/index.html": {
    frase: "Sou um programador independente e trabalho sozinho. Sem anúncios nem investidores: o teu apoio permite-me continuar a desenvolver o Orwell e outros projectos de interesse público.",
    doar: "Apoia-me no Ko-fi",
    botao: "Apoia-me no Ko-fi",
    paraQue: "Cada euro vai para o servidor, as licenças e as custas legais",
    partilha: "Se não puderes doar, partilha o Orwell.",
  },
} as const
const textoDe = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

describe("o medidor desligado", () => {
  it("o guião não pede o JSON enquanto o dono não o ligar", () => {
    expect(MEDIDOR_LIGADO).toBe(false)
  })
})

describe.each(ENTRADAS)("o topo (%s)", (nome) => {
  const html = ler(nome)
  const topo = /<header class="topo">[\s\S]*?<\/header>/.exec(html)?.[0] ?? ""

  it("não tem faixa de apoio por baixo (pedido do dono, 9/11/2026)", () => {
    expect(html).not.toContain("faixa-apoio")
  })

  it("tem o badge do apoio ao lado do Entrar, a levar ao Ko-fi numa janela nova", () => {
    const badge = /<a class="topo-apoio"[^>]*>([^<]*)<\/a>/.exec(topo)
    expect(badge?.[1]).toBe(nome.startsWith("pt/") ? "Apoia-nos" : "Support us")
    expect(badge?.[0]).toContain('href="https://ko-fi.com/orwell_eu"')
    expect(badge?.[0]).toContain('target="_blank" rel="noopener noreferrer"')
    expect(topo.indexOf('class="topo-apoio"')).toBeLessThan(topo.indexOf('class="topo-entrar"'))
  })
})

describe.each(ENTRADAS)("a secção Apoiar (%s)", (nome) => {
  const html = ler(nome)
  const apoio = /<section class="seccao seccao-apoio" id="apoiar">[\s\S]*?<\/section>/.exec(html)?.[0] ?? ""
  const ligacao = /<p class="apoio-ligacao">[\s\S]*?<\/p>/.exec(apoio)?.[0] ?? ""

  it("o botão é o Ko-fi, numa janela nova, e o GoFundMe saiu", () => {
    expect(ligacao).toContain(KOFI)
    expect(ligacao).toContain(`${TEXTOS[nome].botao}</a>`)
    expect(ligacao.match(/<a\b/g)).toHaveLength(1)
    expect(apoio).not.toMatch(/gofund/i)
  })

  it("diz para que serve o dinheiro, e o que pode fazer quem não pode doar", () => {
    expect(textoDe(apoio)).toContain(TEXTOS[nome].paraQue)
    expect(textoDe(apoio)).toContain(TEXTOS[nome].partilha)
  })

  it("continua a ser a última secção da página", () => {
    expect(html.indexOf("</section>", html.indexOf('id="apoiar"'))).toBe(html.lastIndexOf("</section>"))
  })

  it("o rodapé não promete um medidor que está desligado", () => {
    const rodape = /<footer class="rodape">[\s\S]*?<\/footer>/.exec(html)?.[0] ?? ""
    expect(rodape).not.toMatch(/has raised|angariou/)
    expect(rodape).toContain('href="https://ko-fi.com/orwell_eu"')
  })
})

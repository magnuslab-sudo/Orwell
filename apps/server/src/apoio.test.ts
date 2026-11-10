import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import {
  AGENTE,
  ErroDaCampanha,
  MAX_BYTES_DA_PAGINA,
  META_TOTAL_POR_OMISSAO,
  PRIMEIRA_META,
  VigiaDaCampanha,
  buscarPagina,
  extrairCampanha,
  lerApoio,
  montarApoio,
  slugDe,
} from "./apoio.js"
import { buildServer } from "./app.js"
import { loadConfig } from "./config.js"

/**
 * The test for the "Support" section (`apoio.ts`): the extractor against the real
 * GoFundMe page (stripped down, without donor data), the errors, and the JSON
 * the site reads.
 */
const URL_DA_CAMPANHA = "https://www.gofundme.com/f/orwell-privacidade-e-comunicacao-livre-na-europa"
const SLUG = "orwell-privacidade-e-comunicacao-livre-na-europa"
const PAGINA = readFileSync(fileURLToPath(new URL("../testes/gofundme-campanha.html", import.meta.url)), "utf8")

/** A page with this `Fundraiser`, in the same place as the real one. */
function paginaCom(campanha: Record<string, unknown>, raiz: Record<string, unknown> | undefined = undefined): string {
  const apollo: Record<string, unknown> = { "Fundraiser:1": { slug: SLUG, ...campanha } }
  if (raiz) apollo.ROOT_QUERY = raiz
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { __APOLLO_STATE__: apollo } },
  })}</script></html>`
}

const euros = (amount: number) => ({ __typename: "Money", amount, currencyCode: "EUR" })

/** A `fetch` that always responds the same and counts requests. */
function pedidoFalso(corpo: string, estado = 200): typeof fetch & { pedidos: Array<{ url: string; init: RequestInit | undefined }> } {
  const pedidos: Array<{ url: string; init: RequestInit | undefined }> = []
  const falso = (async (url: string | URL | Request, init?: RequestInit) => {
    pedidos.push({ url: String(url), init })
    return new Response(corpo, { status: estado, headers: { "content-type": "text/html" } })
  }) as typeof fetch & { pedidos: typeof pedidos }
  falso.pedidos = pedidos
  return falso
}

describe("o extractor", () => {
  it("lê a página real: 5 € de 1 doação, e a meta do dono", () => {
    expect(extrairCampanha(PAGINA, SLUG)).toEqual({ angariado: 5, doacoes: 1, moeda: "EUR", metaDoDono: 10_000 })
  })

  it("a fixture não traz dados de quem doou", () => {
    expect(PAGINA).not.toMatch(/"Donation:|"name"|"organizer"|"User:|"beneficiary"|"description/)
  })

  it("lê o valor dos dados estruturados, e não do texto visível", () => {
    // The fixture says "EUR 5 raised" in the HTML. A different value in the JSON wins.
    const pagina = paginaCom({ currentAmount: euros(120), donationCount: 4, userDefinedGoalAmount: euros(10_000) })
    expect(extrairCampanha(`<h2>EUR 9999 raised</h2>${pagina}`, SLUG).angariado).toBe(120)
  })

  it("encontra a campanha pela ROOT_QUERY e, sem ela, pelo slug", () => {
    const comRaiz = paginaCom(
      { currentAmount: euros(7), donationCount: 2 },
      { [`fundraiser:${JSON.stringify({ slug: SLUG })}`]: { __ref: "Fundraiser:1" } },
    )
    expect(extrairCampanha(comRaiz, SLUG).angariado).toBe(7)
    expect(extrairCampanha(paginaCom({ currentAmount: euros(8), donationCount: 2 }), SLUG).angariado).toBe(8)
  })

  it("sem userDefinedGoalAmount usa o goalAmount; noutra moeda, nenhum", () => {
    expect(extrairCampanha(paginaCom({ currentAmount: euros(1), donationCount: 1, goalAmount: euros(5000) }), SLUG).metaDoDono).toBe(5000)
    const outraMoeda = { amount: 9000, currencyCode: "USD" }
    expect(extrairCampanha(paginaCom({ currentAmount: euros(1), donationCount: 1, userDefinedGoalAmount: outraMoeda }), SLUG).metaDoDono).toBeUndefined()
  })

  it.each([
    ["sem __NEXT_DATA__", "<html><body>EUR 5 raised</body></html>", /__NEXT_DATA__/],
    ["com __NEXT_DATA__ que não é JSON", '<script id="__NEXT_DATA__" type="application/json">{nope</script>', /não é JSON/],
    ["sem estado do Apollo", '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>', /__APOLLO_STATE__/],
    ["sem esta campanha", paginaCom({ slug: "outra", currentAmount: euros(1), donationCount: 1 }), /não traz a campanha/],
    ["sem currentAmount", paginaCom({ donationCount: 1 }), /currentAmount/],
    ["com currentAmount negativo", paginaCom({ currentAmount: euros(-1), donationCount: 1 }), /currentAmount/],
    ["sem donationCount", paginaCom({ currentAmount: euros(1) }), /donationCount/],
    ["com donationCount fraccionário", paginaCom({ currentAmount: euros(1), donationCount: 1.5 }), /donationCount/],
  ])("recusa uma página %s", (_caso, pagina, razao) => {
    expect(() => extrairCampanha(pagina, SLUG)).toThrow(ErroDaCampanha)
    expect(() => extrairCampanha(pagina, SLUG)).toThrow(razao)
  })

  it("tira o slug do endereço da campanha", () => {
    expect(slugDe(URL_DA_CAMPANHA)).toBe(SLUG)
    expect(slugDe(`${URL_DA_CAMPANHA}?utm=x`)).toBe(SLUG)
    expect(() => slugDe("https://www.gofundme.com/")).toThrow(ErroDaCampanha)
  })
})

describe("o JSON", () => {
  const lidoEm = new Date("2026-11-03T12:00:00.000Z")

  it("tem o formato que o site lê", () => {
    const apoio = montarApoio(extrairCampanha(PAGINA, SLUG), lidoEm)
    expect(apoio).toEqual({ angariado: 5, meta: 2200, metaTotal: 10_000, doacoes: 1, moeda: "EUR", lidoEm: "2026-11-03T12:00:00.000Z" })
    expect(Object.keys(apoio)).toEqual(["angariado", "meta", "metaTotal", "doacoes", "moeda", "lidoEm"])
  })

  it("a primeira meta é a do dono, e não a que o GoFundMe sobe sozinho", () => {
    // The "smart goals": the system's goalAmount goes up; the first target stays.
    const pagina = paginaCom({ currentAmount: euros(2100), donationCount: 40, goalAmount: euros(3000), userDefinedGoalAmount: euros(10_000) })
    expect(montarApoio(extrairCampanha(pagina, SLUG), lidoEm)).toMatchObject({ meta: PRIMEIRA_META, metaTotal: 10_000 })
  })

  it("sem meta na página, a meta total é a por omissão; e a primeira nunca passa da total", () => {
    expect(montarApoio({ angariado: 1, doacoes: 1, moeda: "EUR", metaDoDono: undefined }, lidoEm).metaTotal).toBe(META_TOTAL_POR_OMISSAO)
    expect(montarApoio({ angariado: 1, doacoes: 1, moeda: "EUR", metaDoDono: 1500 }, lidoEm)).toMatchObject({ meta: 1500, metaTotal: 1500 })
  })

  it("lê de volta o que guardou, e recusa o que não é um apoio", () => {
    const apoio = montarApoio(extrairCampanha(PAGINA, SLUG), lidoEm)
    expect(lerApoio(JSON.stringify(apoio))).toEqual(apoio)
    expect(lerApoio("{nope")).toBeUndefined()
    expect(lerApoio(JSON.stringify({ ...apoio, angariado: "5" }))).toBeUndefined()
    expect(lerApoio(JSON.stringify({ ...apoio, lidoEm: "ontem" }))).toBeUndefined()
  })
})

describe("o pedido ao GoFundMe", () => {
  it("diz quem somos e como nos contactar", async () => {
    const falso = pedidoFalso(PAGINA)
    await buscarPagina(URL_DA_CAMPANHA, falso)
    expect(falso.pedidos).toHaveLength(1)
    const cabecalhos = falso.pedidos[0]?.init?.headers as Record<string, string>
    expect(cabecalhos["user-agent"]).toBe(AGENTE)
    expect(AGENTE).toMatch(/orwell\.pt/)
    expect(AGENTE).toMatch(/orwell\.eu@proton\.me/)
  })

  it("um 403 é um erro, e não se tenta outra vez", async () => {
    const falso = pedidoFalso("blocked", 403)
    await expect(buscarPagina(URL_DA_CAMPANHA, falso)).rejects.toThrow(/respondeu 403/)
    expect(falso.pedidos).toHaveLength(1)
  })

  it("uma rede em baixo é um erro", async () => {
    const falha = (async () => {
      throw new TypeError("fetch failed")
    }) as typeof fetch
    await expect(buscarPagina(URL_DA_CAMPANHA, falha)).rejects.toThrow(ErroDaCampanha)
  })

  it("recusa uma página grande demais", async () => {
    await expect(buscarPagina(URL_DA_CAMPANHA, pedidoFalso("x".repeat(MAX_BYTES_DA_PAGINA + 1)))).rejects.toThrow(/passa de/)
  })
})

describe("a vigia", () => {
  const pastas: string[] = []
  afterEach(() => {
    for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
  })
  const ficheiroNovo = () => {
    const pasta = mkdtempSync(join(tmpdir(), "apoio-"))
    pastas.push(pasta)
    return join(pasta, "apoio-campanha.json")
  }
  const agora = () => new Date("2026-11-03T12:00:00.000Z")

  it("guarda o valor bom em disco", async () => {
    const ficheiro = ficheiroNovo()
    const vigia = new VigiaDaCampanha({ url: URL_DA_CAMPANHA, ficheiro, registar: () => {}, fazerPedido: pedidoFalso(PAGINA), agora })
    await vigia.verificar()
    expect(vigia.ultimoBom).toMatchObject({ angariado: 5, doacoes: 1 })
    expect(lerApoio(readFileSync(ficheiro, "utf8"))).toEqual(vigia.ultimoBom)
  })

  it("num erro mantém o último valor bom e di-lo no registo, sem rejeitar", async () => {
    const ficheiro = ficheiroNovo()
    const linhas: string[] = []
    let corpo = PAGINA
    let estado = 200
    const fazerPedido = (async () => new Response(corpo, { status: estado })) as typeof fetch
    const vigia = new VigiaDaCampanha({ url: URL_DA_CAMPANHA, ficheiro, registar: (l) => linhas.push(l), fazerPedido, agora })

    await vigia.verificar()
    const bom = vigia.ultimoBom

    estado = 403
    await expect(vigia.verificar()).resolves.toEqual(bom)
    corpo = "<html>mudou de forma</html>"
    estado = 200
    await expect(vigia.verificar()).resolves.toEqual(bom)
    expect(linhas).toHaveLength(2)
    expect(linhas[0]).toMatch(/aviso: a campanha do GoFundMe não se leu \(o GoFundMe respondeu 403\); fica o valor de 2026-11-03/)
    expect(linhas[1]).toMatch(/__NEXT_DATA__/)

    corpo = PAGINA
    await vigia.verificar()
    expect(linhas.at(-1)).toMatch(/voltou a ler-se/)
  })

  it("ao arrancar lê o disco, e não pede outra vez se o valor tem menos de 15 minutos", async () => {
    const ficheiro = ficheiroNovo()
    const recente = { angariado: 50, meta: 2200, metaTotal: 10_000, doacoes: 3, moeda: "EUR", lidoEm: "2026-11-03T11:55:00.000Z" }
    writeFileSync(ficheiro, JSON.stringify(recente))
    const falso = pedidoFalso(PAGINA)
    const vigia = new VigiaDaCampanha({ url: URL_DA_CAMPANHA, ficheiro, registar: () => {}, fazerPedido: falso, agora })
    const parar = vigia.arrancar()
    await new Promise((r) => setTimeout(r, 20))
    parar()
    expect(vigia.ultimoBom).toEqual(recente)
    expect(falso.pedidos).toHaveLength(0)
  })

  it("ao arrancar com um valor velho, pede logo", async () => {
    const ficheiro = ficheiroNovo()
    writeFileSync(ficheiro, JSON.stringify({ angariado: 50, meta: 2200, metaTotal: 10_000, doacoes: 3, moeda: "EUR", lidoEm: "2026-11-03T10:00:00.000Z" }))
    const falso = pedidoFalso(PAGINA)
    const vigia = new VigiaDaCampanha({ url: URL_DA_CAMPANHA, ficheiro, registar: () => {}, fazerPedido: falso, agora })
    const parar = vigia.arrancar()
    await expect.poll(() => vigia.ultimoBom?.angariado).toBe(5)
    parar()
    expect(falso.pedidos).toHaveLength(1)
  })
})

describe("/_enclave/apoiar.json", () => {
  it("sem campanha configurada responde 404 sem cache, e o servidor não pede nada a ninguém", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "apoio-servidor-"))
    const enclave = await buildServer(loadConfig({ ENCLAVE_DATA_DIR: pasta, ENCLAVE_DB_PATH: join(pasta, "teste.sqlite") }))
    try {
      const resposta = await enclave.app.inject({ method: "GET", url: "/_enclave/apoiar.json" })
      expect(resposta.statusCode).toBe(404)
      expect(resposta.headers["cache-control"]).toBe("no-store")
    } finally {
      await enclave.close()
      rmSync(pasta, { recursive: true, force: true })
    }
  })

  it("com um valor guardado serve-o, com cache curta", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "apoio-servidor-"))
    const apoio = { angariado: 120, meta: 2200, metaTotal: 10_000, doacoes: 4, moeda: "EUR", lidoEm: new Date().toISOString() }
    writeFileSync(join(pasta, "apoio-campanha.json"), JSON.stringify(apoio))
    const enclave = await buildServer(
      loadConfig({ ENCLAVE_DATA_DIR: pasta, ENCLAVE_DB_PATH: join(pasta, "teste.sqlite"), ENCLAVE_CAMPANHA_GOFUNDME: URL_DA_CAMPANHA }),
    )
    try {
      // The value is fresh: the monitor reads the disk and makes no request.
      await expect
        .poll(async () => (await enclave.app.inject({ method: "GET", url: "/_enclave/apoiar.json" })).statusCode)
        .toBe(200)
      const resposta = await enclave.app.inject({ method: "GET", url: "/_enclave/apoiar.json" })
      expect(resposta.json()).toEqual(apoio)
      expect(resposta.headers["cache-control"]).toBe("public, max-age=60")
      expect(resposta.headers["content-type"]).toMatch(/application\/json/)
    } finally {
      await enclave.close()
      rmSync(pasta, { recursive: true, force: true })
    }
  })
})

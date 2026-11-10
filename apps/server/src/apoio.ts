import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

/**
 * The counter for the "Support" section of the site: how much the GoFundMe campaign has raised.
 *
 * Owner request on 3 November 2026. The rule that never breaks: whoever visits orwell.pt never makes a request to GoFundMe. Whoever fetches the value is this server, from 15 em 15 minutos, and the site only reads the small JSON it returns in `/_enclave/apoiar.json`, on the same origin. The page still has no cookies, and the CSP still has only `'self'`.
 *
 * **The structured data, not the visible HTML.** GoFundMe has no public API. The campaign page is Next.js and brings the Apollo state inside the `<script id="__NEXT_DATA__">`, in `props.pageProps.__APOLLO_STATE__`. There is the `Fundraiser`, with `currentAmount`, `goalAmount`, `userDefinedGoalAmount` and `donationCount`. Read on 3 November 2026; the fixture, without donor data, is in `apps/server/testes/gofundme-campanha.html`.
 *
 * **The two targets.** The owner wants the bar against 2 200 € and, after passing that target, against 10 000 €. The first target is `PRIMEIRA_META`, fixed here, not the `goalAmount` from the page: GoFundMe has "smart goals" on this campaign, and the `goalAmount` (set by the system, `source: "SYSTEM"`) goes up by itself as it approaches. The total target is the `userDefinedGoalAmount`, which the owner wrote (`source: "USER"`).
 *
 * **On error, the last good value stays.** A failed request, a page that changed shape or a 403 dizem in the log and nothing changes what's served. The last good value also stays on disk, in `ENCLAVE_DATA_DIR`: a restart doesn't clear the bar, and doesn't make a new request if the last one is less than 15 minutos old.
 *
 * **No workarounds.** A 15 em 15 minutos request, with a User-Agent that says who we are and how to reach us. If GoFundMe refuses, the bar stays at the last good value, or no bar. There's no masked retry.
 */

/** The first target of the campaign, in euros (owner's order, 3 November 2026). */
export const PRIMEIRA_META = 2200

/** The total target, if the page does not bring it. */
export const META_TOTAL_POR_OMISSAO = 10_000

/** How often the campaign is read. */
export const INTERVALO_MS = 15 * 60_000

/** How long the browser can store the JSON. */
export const CACHE_DO_JSON_S = 60

/** The largest body accepted. The page is ~640 kB without compression. */
export const MAX_BYTES_DA_PAGINA = 4 * 1024 * 1024

/** The maximum time for a request. */
export const TEMPO_MAXIMO_MS = 20_000

export const AGENTE = "OrwellApoio/1.0 (+https://orwell.pt; orwell.eu@proton.me; one request every 15 minutes)"

/** The JSON that the site reads. */
export interface Apoio {
  angariado: number
  meta: number
  metaTotal: number
  doacoes: number
  moeda: string
  lidoEm: string
}

/** What is extracted from the page, before combining the targets. */
export interface DadosDaCampanha {
  angariado: number
  doacoes: number
  moeda: string
  /** The `userDefinedGoalAmount`, or the `goalAmount` if the page does not have it. */
  metaDoDono: number | undefined
}

export class ErroDaCampanha extends Error {
  override name = "ErroDaCampanha"
}

/** The slug of `https://www.gofundme.com/f/<slug>`. */
export function slugDe(url: string): string {
  const slug = /\/f\/([^/?#]+)/.exec(new URL(url).pathname)?.[1]
  if (!slug) throw new ErroDaCampanha(`o endereço não é de uma campanha: ${url}`)
  return slug
}

type Registo = Record<string, unknown>
const ehRegisto = (valor: unknown): valor is Registo => typeof valor === "object" && valor !== null && !Array.isArray(valor)

/** A GoFundMe `Money` (`{amount, currencyCode}`), or `undefined`. */
function dinheiro(valor: unknown): { quantia: number; moeda: string } | undefined {
  if (!ehRegisto(valor)) return undefined
  const { amount, currencyCode } = valor
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return undefined
  if (typeof currencyCode !== "string" || !/^[A-Z]{3}$/.test(currencyCode)) return undefined
  return { quantia: amount, moeda: currencyCode }
}

/** The Apollo state inside `__NEXT_DATA__`. */
function estadoDoApollo(html: string): Registo {
  const bloco = /<script\b[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1]
  if (bloco === undefined) throw new ErroDaCampanha("a página não traz __NEXT_DATA__")
  let dados: unknown
  try {
    dados = JSON.parse(bloco)
  } catch {
    throw new ErroDaCampanha("o __NEXT_DATA__ não é JSON")
  }
  const props = ehRegisto(dados) && ehRegisto(dados.props) ? dados.props : undefined
  const pagina = props && ehRegisto(props.pageProps) ? props.pageProps : undefined
  const apollo = pagina?.__APOLLO_STATE__
  if (!ehRegisto(apollo)) throw new ErroDaCampanha("o __NEXT_DATA__ não traz __APOLLO_STATE__")
  return apollo
}

/** The campaign's `Fundraiser`: queried by root, or by slug if not found. */
function campanhaNoApollo(apollo: Registo, slug: string): Registo {
  const raiz = apollo.ROOT_QUERY
  const consulta = ehRegisto(raiz) ? raiz[`fundraiser:${JSON.stringify({ slug })}`] : undefined
  const ref = ehRegisto(consulta) && typeof consulta.__ref === "string" ? consulta.__ref : undefined
  const pelaRaiz = ref ? apollo[ref] : undefined
  if (ehRegisto(pelaRaiz)) return pelaRaiz

  for (const [chave, valor] of Object.entries(apollo)) {
    if (chave.startsWith("Fundraiser:") && ehRegisto(valor) && valor.slug === slug) return valor
  }
  throw new ErroDaCampanha(`a página não traz a campanha ${slug}`)
}

/** Extracts the raised amount, donations, currency, and owner's goal from the page. */
export function extrairCampanha(html: string, slug: string): DadosDaCampanha {
  const campanha = campanhaNoApollo(estadoDoApollo(html), slug)

  const atual = dinheiro(campanha.currentAmount)
  if (!atual) throw new ErroDaCampanha("a campanha não traz currentAmount válido")

  const doacoes = campanha.donationCount
  if (typeof doacoes !== "number" || !Number.isInteger(doacoes) || doacoes < 0) {
    throw new ErroDaCampanha("a campanha não traz donationCount válido")
  }

  const meta = dinheiro(campanha.userDefinedGoalAmount) ?? dinheiro(campanha.goalAmount)
  return {
    angariado: atual.quantia,
    doacoes,
    moeda: atual.moeda,
    metaDoDono: meta && meta.moeda === atual.moeda && meta.quantia > 0 ? meta.quantia : undefined,
  }
}

/** The JSON the site reads, built from what the page returned. */
export function montarApoio(dados: DadosDaCampanha, lidoEm: Date): Apoio {
  const metaTotal = dados.metaDoDono ?? META_TOTAL_POR_OMISSAO
  return {
    angariado: dados.angariado,
    meta: Math.min(PRIMEIRA_META, metaTotal),
    metaTotal,
    doacoes: dados.doacoes,
    moeda: dados.moeda,
    lidoEm: lidoEm.toISOString(),
  }
}

/** An `Apoio` read from disk, or `undefined` if the file is unusable. */
export function lerApoio(texto: string): Apoio | undefined {
  let dados: unknown
  try {
    dados = JSON.parse(texto)
  } catch {
    return undefined
  }
  if (!ehRegisto(dados)) return undefined
  const { angariado, meta, metaTotal, doacoes, moeda, lidoEm } = dados
  const numero = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0
  if (!numero(angariado) || !numero(meta) || !numero(metaTotal) || !numero(doacoes)) return undefined
  if (typeof moeda !== "string" || typeof lidoEm !== "string" || !Number.isFinite(Date.parse(lidoEm))) return undefined
  return { angariado, meta, metaTotal, doacoes, moeda, lidoEm }
}

/** Fetches the campaign page. Fails with `ErroDaCampanha` on anything other than a 200 with HTML. */
export async function buscarPagina(url: string, fazerPedido: typeof fetch = fetch): Promise<string> {
  let resposta: Response
  try {
    resposta = await fazerPedido(url, {
      headers: {
        "user-agent": AGENTE,
        accept: "text/html",
        "accept-language": "en",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
    })
  } catch (erro) {
    throw new ErroDaCampanha(`o pedido falhou (${erro instanceof Error ? erro.message : String(erro)})`)
  }
  if (resposta.status !== 200) {
    await resposta.body?.cancel()
    throw new ErroDaCampanha(`o GoFundMe respondeu ${resposta.status}`)
  }

  const leitor = resposta.body?.getReader()
  if (!leitor) throw new ErroDaCampanha("a resposta não tem corpo")
  const pedacos: Uint8Array[] = []
  let lidos = 0
  for (;;) {
    const { done, value } = await leitor.read()
    if (done) break
    lidos += value.byteLength
    if (lidos > MAX_BYTES_DA_PAGINA) {
      await leitor.cancel()
      throw new ErroDaCampanha(`a página passa de ${MAX_BYTES_DA_PAGINA} bytes`)
    }
    pedacos.push(value)
  }
  return Buffer.concat(pedacos).toString("utf8")
}

export interface OpcoesDaVigia {
  url: string
  /** The file where the last good value is stored. */
  ficheiro: string
  registar: (linha: string) => void
  /** Only tests change this. */
  fazerPedido?: typeof fetch
  agora?: () => Date
}

/** Reads the campaign from 15 em 15 minutos and stores the last good value. */
export class VigiaDaCampanha {
  readonly #opcoes: OpcoesDaVigia
  readonly #slug: string
  readonly #agora: () => Date
  #ultimoBom: Apoio | undefined
  /** If the last read failed, records when it recovers. */
  #emErro = false

  constructor(opcoes: OpcoesDaVigia) {
    this.#opcoes = opcoes
    this.#slug = slugDe(opcoes.url)
    this.#agora = opcoes.agora ?? (() => new Date())
  }

  /** What the site receives, or `undefined` before the first successful read. */
  get ultimoBom(): Apoio | undefined {
    return this.#ultimoBom
  }

  /** Reads the last good value from disk. */
  async carregar(): Promise<void> {
    const texto = await readFile(this.#opcoes.ficheiro, "utf8").catch(() => undefined)
    const guardado = texto === undefined ? undefined : lerApoio(texto)
    if (guardado) this.#ultimoBom = guardado
  }

  /** A read operation. Never rejects: an error goes to the log and the last good value persists. */
  async verificar(): Promise<Apoio | undefined> {
    try {
      const html = await buscarPagina(this.#opcoes.url, this.#opcoes.fazerPedido)
      const apoio = montarApoio(extrairCampanha(html, this.#slug), this.#agora())
      this.#ultimoBom = apoio
      await this.#guardar(apoio)
      if (this.#emErro) this.#opcoes.registar("enclave: a campanha do GoFundMe voltou a ler-se")
      this.#emErro = false
    } catch (erro) {
      this.#emErro = true
      const razao = erro instanceof Error ? erro.message : String(erro)
      const fica = this.#ultimoBom ? `fica o valor de ${this.#ultimoBom.lidoEm}` : "ainda não há valor"
      this.#opcoes.registar(`enclave: aviso: a campanha do GoFundMe não se leu (${razao}); ${fica}`)
    }
    return this.#ultimoBom
  }

  async #guardar(apoio: Apoio): Promise<void> {
    const { ficheiro } = this.#opcoes
    try {
      await mkdir(dirname(ficheiro), { recursive: true })
      const provisorio = `${ficheiro}.${process.pid}.tmp`
      await writeFile(provisorio, `${JSON.stringify(apoio)}\n`)
      await rename(provisorio, ficheiro)
    } catch (erro) {
      this.#opcoes.registar(`enclave: aviso: o valor da campanha não se guardou em ${ficheiro} (${String(erro)})`)
    }
  }

  /**
   * Load from disk. Read now if the stored value is older than 15 minutos, and
   * then again after 15 em 15 minutos. Returns how to stop.
   */
  arrancar(intervaloMs = INTERVALO_MS): () => void {
    let relogio: ReturnType<typeof setInterval> | undefined
    let parado = false
    void this.carregar().then(() => {
      if (parado) return
      const lido = this.#ultimoBom ? Date.parse(this.#ultimoBom.lidoEm) : Number.NaN
      const idade = this.#agora().getTime() - lido
      if (!(idade >= 0 && idade < intervaloMs)) void this.verificar()
      relogio = setInterval(() => void this.verificar(), intervaloMs)
      relogio.unref?.()
    })
    return () => {
      parado = true
      if (relogio) clearInterval(relogio)
    }
  }
}

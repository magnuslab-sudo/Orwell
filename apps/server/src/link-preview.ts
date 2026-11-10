import { lookup as dnsLookup } from "node:dns"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { isIPv4, isIPv6 } from "node:net"
import {
  parsePreviewHtml,
  youtubeIdOf,
  youtubeOembedUrl,
  youtubeThumbnailUrls,
  type ParsedPreview,
} from "@enclave/protocol"

/**
 * Fetch a link preview from the server.
 *
 * Why this exists and what it costs: inside a browser, the destination page can
 * only be read if it sends headers to authorize it, and most do not. Without this,
 * title and thumbnail would have to be written by hand. The price is that the
 * server learns which links are published; this was accepted with full knowledge,
 * and the design keeps it to a minimum: only the publisher's device requests it,
 * once, and what comes out travels afterward inside the encrypted message. The
 * reader still does not speak with the site or with this server.
 *
 * Nothing here is logged. What address was requested and by whom is not written
 * to any table or log, it would recreate, on the server side, exactly the reading
 * record that the entire product exists to avoid.
 */

// ------------------------------------------------------------------ addresses
//
// The dangerous part. A URL finder chosen by the caller is a textbook SSRF:
// without guards, any account sends the server to reach where it cannot go, // `127.0.0.1`, the machine's private network, `169.254.169.254`. This machine
// is shared with another site in production.

/** Bytes of an IPv4 in decimal dotted form, or `null`. */
function bytesIPv4(text: string): Uint8Array | null {
  if (!isIPv4(text)) return null
  const parts = text.split(".").map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return Uint8Array.from(parts)
}

/**
 * Bytes of an IPv6, with `::` expanded and the suffix in IPv4 form accepted.
 *
 * Written by hand, not by regex, because what matters is not the text form but
 * the 16 bytes: `::ffff:127.0.0.1` and `::ffff:7f00:1` are the same machine
 * written two ways, and a guard that only looked at the text would let the
 * second one through.
 */
function bytesIPv6(text: string): Uint8Array | null {
  if (!isIPv6(text)) return null
  // A zone (`fe80::1%eth0`) does not change the address; it only changes how it leaves.
  const semZona = text.split("%")[0] ?? text
  const [cabeca = "", cauda] = semZona.split("::") as [string, string | undefined]

  const grupos = (parte: string): number[] | null => {
    if (parte === "") return []
    const saida: number[] = []
    for (const peca of parte.split(":")) {
      if (peca.includes(".")) {
        // The IPv4 form suffix counts as two groups of 16 bits.
        const quatro = bytesIPv4(peca)
        if (!quatro) return null
        saida.push(((quatro[0] as number) << 8) | (quatro[1] as number))
        saida.push(((quatro[2] as number) << 8) | (quatro[3] as number))
        continue
      }
      const valor = Number.parseInt(peca, 16)
      if (!Number.isInteger(valor) || valor < 0 || valor > 0xffff) return null
      saida.push(valor)
    }
    return saida
  }

  const antes = grupos(cabeca)
  const depois = cauda === undefined ? [] : grupos(cauda)
  if (!antes || !depois) return null
  const enchimento = 8 - antes.length - depois.length
  if (cauda === undefined ? enchimento !== 0 : enchimento < 0) return null
  const todos = [...antes, ...Array<number>(Math.max(0, enchimento)).fill(0), ...depois]
  if (todos.length !== 8) return null

  const bytes = new Uint8Array(16)
  todos.forEach((grupo, i) => {
    bytes[i * 2] = grupo >> 8
    bytes[i * 2 + 1] = grupo & 0xff
  })
  return bytes
}

/** `true` when the four bytes fall in a range that is not the Internet. */
function ipv4Reservado(b: Uint8Array): boolean {
  const [a = 0, segundo = 0, terceiro = 0] = b
  if (a === 0) return true // 0.0.0.0/8, "this network"
  if (a === 10) return true // privada
  if (a === 127) return true // loopback, entire not just .0.1
  if (a === 100 && segundo >= 64 && segundo <= 127) return true // CGNAT
  if (a === 169 && segundo === 254) return true // link-local: cloud metadata
  if (a === 172 && segundo >= 16 && segundo <= 31) return true // privada
  if (a === 192 && segundo === 0 && terceiro === 0) return true // IETF allocations
  if (a === 192 && segundo === 0 && terceiro === 2) return true // TEST-NET-1
  if (a === 192 && segundo === 88 && terceiro === 99) return true // anycast 6to4
  if (a === 192 && segundo === 168) return true // privada
  if (a === 198 && (segundo === 18 || segundo === 19)) return true // ensaios
  if (a === 198 && segundo === 51 && terceiro === 100) return true // TEST-NET-2
  if (a === 203 && segundo === 0 && terceiro === 113) return true // TEST-NET-3
  if (a >= 224) return true // multicast and reserved, up to 255.255.255.255
  return false
}

/**
 * Is the address on the public Internet?
 *
 * Refuse by default: what cannot be read does not pass. A wrong `false` costs
 * a preview; a wrong `true` costs the rest of the machine.
 */
export function isPublicAddress(address: string): boolean {
  const quatro = bytesIPv4(address)
  if (quatro) return !ipv4Reservado(quatro)

  const bytes = bytesIPv6(address)
  if (!bytes) return false

  // An IPv4 wrapped in IPv6 is still that IPv4, and this is how these guards usually
  // fail. Three wrappings, all with the same destination.
  const primeiros10Zero = bytes.slice(0, 10).every((b) => b === 0)
  if (primeiros10Zero && bytes[10] === 0xff && bytes[11] === 0xff) {
    return !ipv4Reservado(bytes.slice(12, 16)) // ::ffff:a.b.c.d
  }
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    return !ipv4Reservado(bytes.slice(12, 16)) // NAT64 64:ff9b::/96
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return !ipv4Reservado(bytes.slice(2, 6)) // 6to4 2002::/16
  }

  if (bytes.every((b) => b === 0)) return false // ::
  if (primeiros10Zero && bytes[10] === 0 && bytes[11] === 0 && bytes[15] === 1) return false // ::1
  if (((bytes[0] as number) & 0xfe) === 0xfc) return false // fc00::/7 unique-local
  if ((bytes[0] as number) === 0xfe && ((bytes[1] as number) & 0xc0) === 0x80) return false // fe80::/10
  if ((bytes[0] as number) === 0xff) return false // ff00::/8 multicast
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return false // documentation
  if (bytes[0] === 0x01 && bytes.slice(1, 8).every((b) => b === 0)) return false // 100::/64 descarte

  return true
}

/**
 * Does the URL pass on first look?
 *
 * Returns the parsed URL, or `null`. Scheme and literal address only, the
 * hostname has not been resolved yet, and resolving here would not help: that
 * is what `guardedLookup` does, closing the window between checking and
 * connecting.
 */
export function urlPermitida(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  // `[::1]` arrives here with brackets; the classifier wants the address.
  const anfitriao = url.hostname.replace(/^\[|\]$/g, "")
  if (!anfitriao) return null
  if ((isIPv4(anfitriao) || isIPv6(anfitriao)) && !isPublicAddress(anfitriao)) return null
  return url
}

/**
 * Name resolution that also decides whether to connect.
 *
 * Checking the address and then letting `fetch` resolve again opens a window
 * between the two: a name that responds with a public address first and then
 * `127.0.0.1` passes the check and connects to the second one. Here there is
 * no window, what this function returns is exactly the address the socket
 * connects to, because `net.connect` calls it.
 */
type Lookup = Exclude<Parameters<typeof httpRequest>[1], undefined>["lookup"]

export const guardedLookup: Lookup = ((anfitriao, opcoes, callback) => {
  dnsLookup(anfitriao, { ...(opcoes as object), all: true }, (erro, enderecos) => {
    if (erro) return callback(erro, "", 0)
    const lista = (Array.isArray(enderecos) ? enderecos : [enderecos]) as { address: string; family: number }[]
    const seguros = lista.filter((entrada) => isPublicAddress(entrada.address))
    if (seguros.length === 0) {
      return callback(new Error("endereço não permitido"), "", 0)
    }
    const primeiro = seguros[0] as { address: string; family: number }
    // `all` decides the response shape; both paths only return verified results.
    if ((opcoes as { all?: boolean }).all) return callback(null, seguros as never, 0)
    return callback(null, primeiro.address, primeiro.family)
  })
}) as Lookup

// -------------------------------------------------------------------- limites

/** How many redirects to follow. A site that responds 302 to itself would lock us up. */
export const REDIRECT_MAX = 3
/** Maximum time for a request. Short: this happens while someone waits. */
export const REQUEST_TIMEOUT_MS = 6000
/** Just enough for Open Graph, which lives in the `<head>`. */
export const PAGE_MAX_BYTES = 256_000
/** The thumbnail is shrunk on the client; this is only the cap on what we transport. */
export const IMAGE_MAX_BYTES = 2_000_000

export interface LinkPreviewResult {
  finalUrl: string
  title?: string
  description?: string
  siteName?: string
  /** The image already fetched, as a data URL. The client shrinks it. */
  image?: string
}

interface RespostaCrua {
  finalUrl: string
  contentType: string
  body: Buffer
}

/**
 * A saved GET, with redirects followed manually.
 *
 * Following redirects automatically seems the same and is not: the check done
 * on the first URL says nothing about the second, and a site that responds 302
 * to `127.0.0.1` is exactly how these defenses fall. Here each redirect passes
 * through `urlPermitida` and `guardedLookup` again.
 */
async function buscar(url: URL, maxBytes: number, saltos = 0): Promise<RespostaCrua> {
  if (saltos > REDIRECT_MAX) throw new Error("demasiados redireccionamentos")

  return new Promise<RespostaCrua>((resolve, reject) => {
    const pedir = url.protocol === "https:" ? httpsRequest : httpRequest
    const pedido = pedir(
      url,
      {
        method: "GET",
        lookup: guardedLookup,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          // We say what we are. A client that disguises itself as a browser is an
          // unnecessary lie, and some sites serve better those who identify as a
          // preview reader.
          "user-agent": "OrwellLinkPreview/1.0 (+https://orwell.pt)",
          accept: "text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5",
          "accept-language": "pt-PT,pt;q=0.9,en;q=0.6",
        },
      },
      (resposta) => {
        const codigo = resposta.statusCode ?? 0
        const destino = resposta.headers.location
        if (codigo >= 300 && codigo < 400 && destino) {
          resposta.resume()
          let seguinte: URL | null
          try {
            seguinte = urlPermitida(new URL(destino, url).href)
          } catch {
            seguinte = null
          }
          if (!seguinte) return reject(new Error("redireccionamento não permitido"))
          buscar(seguinte, maxBytes, saltos + 1).then(resolve, reject)
          return
        }
        if (codigo < 200 || codigo >= 300) {
          resposta.resume()
          return reject(new Error(`a página respondeu ${codigo}`))
        }

        const pedacos: Buffer[] = []
        let lidos = 0
        resposta.on("data", (pedaco: Buffer) => {
          lidos += pedaco.length
          // Cut the read, not just refuse at the end: a multi-GB file hangs the
          // server long before anyone notices the size.
          if (lidos > maxBytes) {
            resposta.destroy()
            pedido.destroy()
            return
          }
          pedacos.push(pedaco)
        })
        resposta.on("end", () =>
          resolve({
            finalUrl: url.href,
            contentType: String(resposta.headers["content-type"] ?? ""),
            body: Buffer.concat(pedacos),
          }),
        )
        resposta.on("close", () =>
          resolve({
            finalUrl: url.href,
            contentType: String(resposta.headers["content-type"] ?? ""),
            body: Buffer.concat(pedacos),
          }),
        )
        resposta.on("error", reject)
      },
    )

    pedido.on("timeout", () => {
      pedido.destroy(new Error("a página demorou de mais"))
    })
    pedido.on("error", reject)
    pedido.end()
  })
}

/** An image already fetched, as a data URL, or `undefined`. Never crashes: a
 * thumbnail that does not arrive does not break the title that already did. */
async function buscarImagem(endereco: string): Promise<string | undefined> {
  try {
    const alvo = urlPermitida(endereco)
    if (!alvo) return undefined
    const bytes = await buscar(alvo, IMAGE_MAX_BYTES)
    const tipo = bytes.contentType.split(";")[0]?.trim() ?? ""
    if (!tipo.startsWith("image/") || bytes.body.length === 0 || bytes.body.length > IMAGE_MAX_BYTES) return undefined
    return `data:${tipo};base64,${bytes.body.toString("base64")}`
  } catch {
    return undefined
  }
}

/**
 * YouTube, which does not read like the others.
 *
 * The page declares Open Graph, but at byte 691,000 of a 1.3 MB document,  * see `youtubeOembedUrl`. We go to oEmbed instead, which is 300 bytes, and to
 * the thumbnail via an address derived from the ID. Two small downloads instead
 * of one huge one, and with no HTML scraping.
 *
 * The ID is validated in `youtubeIdOf` before it enters any URL, eleven
 * characters from a known alphabet, because whoever published chose the link.
 */
async function preverYoutube(id: string, finalUrl: string): Promise<LinkPreviewResult> {
  let title: string | undefined
  let siteName: string | undefined
  const oembedUrl = urlPermitida(youtubeOembedUrl(id))
  try {
    if (!oembedUrl) throw new Error("endereço do oEmbed não permitido")
    const oembed = await buscar(oembedUrl, 64_000)
    const dados = JSON.parse(oembed.body.toString("utf8")) as {
      title?: unknown
      author_name?: unknown
      provider_name?: unknown
    }
    if (typeof dados.title === "string") title = dados.title.slice(0, 200)
    if (typeof dados.author_name === "string") siteName = dados.author_name.slice(0, 100)
    else if (typeof dados.provider_name === "string") siteName = dados.provider_name.slice(0, 100)
  } catch {
    // No title still brings a thumbnail, and the facade still works.
  }

  let image: string | undefined
  for (const endereco of youtubeThumbnailUrls(id)) {
    image = await buscarImagem(endereco)
    if (image) break
  }

  return {
    finalUrl,
    ...(title === undefined ? {} : { title }),
    ...(siteName === undefined ? {} : { siteName }),
    ...(image === undefined ? {} : { image }),
  }
}

/**
 * What the page says about itself, and the image it declared.
 *
 * The extraction is the same as on the client and comes from `@enclave/protocol`:
 * text partitioning, never a foreign HTML parser, and only one copy, two
 * handwritten lists end up disagreeing with each other.
 */
export async function fetchLinkPreview(raw: string): Promise<LinkPreviewResult> {
  const url = urlPermitida(raw)
  if (!url) throw new Error("endereço não permitido")

  const videoId = youtubeIdOf(url.href)
  if (videoId) return preverYoutube(videoId, url.href)

  const pagina = await buscar(url, PAGE_MAX_BYTES)
  const html = pagina.body.toString("utf8")
  const analisada: ParsedPreview = parsePreviewHtml(html, pagina.finalUrl)

  const image = analisada.image ? await buscarImagem(analisada.image) : undefined

  return {
    finalUrl: pagina.finalUrl,
    ...(analisada.title === undefined ? {} : { title: analisada.title }),
    ...(analisada.description === undefined ? {} : { description: analisada.description }),
    ...(analisada.siteName === undefined ? {} : { siteName: analisada.siteName }),
    ...(image === undefined ? {} : { image }),
  }
}

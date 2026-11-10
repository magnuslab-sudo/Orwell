import { parsePreviewHtml, youtubeIdOf, youtubeOembedUrl, youtubeThumbnailUrls } from "@enclave/protocol"

/**
 * Link preview, read by this process, not the homeserver.
 *
 * Here there's no barrier that prevents a tab from reading another domain: this
 * process is a normal HTTP client. The consequence that matters is privacy, not
 * convenience, in the desktop app the Orwell server never learns what links are
 * posted, because it's never asked anything. On the web there's no choice, and
 * the request goes through there; see `link.preview` in the protocol and
 * `apps/server/src/link-preview.ts`.
 *
 * Without any `electron` in here, and that's why the file exists separately from
 * `index.ts`, same reason as `sfu.ts`, `ecra.ts` and `canais.ts`. `fetch`
 * comes in as a parameter, and thus what this process asks of whom and in what
 * order becomes measurable without opening a window.
 *
 * **None of this is logged.** What address was requested is not written to any
 * file: it would be reconstructing, on disk, the read log that the whole
 * product exists not to have.
 *
 * Open Graph extraction is the shared one, from `@enclave/protocol`: text
 * parsing, never a foreign HTML parser, and only one copy, two hand-written
 * lists end up disagreeing with each other.
 *
 * **There's no SSRF defense here, and it's on purpose.** On the server there is
 * and there must be: there the address comes from some remote account and the
 * machine is shared. Here the address comes from the text box of this person, on
 * this machine, and a `fetch` to `127.0.0.1` doesn't give it anything it
 * couldn't already open in the browser next to it.
 */

/** Only enough for Open Graph, which lives in `<head>`. Reading an entire video
 * waiting for a `<meta>` would hang the app. */
const PAGINA_MAX_CHARS = 256_000
/** The cap on what's transported; the real shrinking is on the screen side. */
const IMAGEM_MAX_BYTES = 2_000_000
/** This happens while someone is writing. Short. */
const TIMEOUT_MS = 8000

export interface PreVisualizacao {
  title?: string
  description?: string
  siteName?: string
  /** The image already fetched as a data URL. The screen shrinks it. */
  image?: string
}

export interface DepsDePreVisualizacao {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** An image fetched as a data URL, or `undefined`. Never breaks: a missing thumbnail doesn't spoil the title that already arrived. */
async function buscarImagem(endereco: string, buscar: typeof fetch, sinal: AbortSignal): Promise<string | undefined> {
  try {
    const resposta = await buscar(endereco, { credentials: "omit", referrerPolicy: "no-referrer", signal: sinal })
    if (!resposta.ok) return undefined
    const tipo = (resposta.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? ""
    if (!tipo.startsWith("image/")) return undefined
    const cru = Buffer.from(await resposta.arrayBuffer())
    if (cru.length === 0 || cru.length > IMAGEM_MAX_BYTES) return undefined
    return `data:${tipo};base64,${cru.toString("base64")}`
  } catch {
    return undefined
  }
}

/**
 * YouTube reads differently than the rest.
 *
 * The page declares Open Graph, but at byte 691,000 of a document over 1.3 MB
 * (see `youtubeOembedUrl`). Via the generic path, this process pulled 256 KB
 * from Google's cookie domain, from the IP of whoever wrote it, and still ended
 * up without title and thumbnail because the tag sits far beyond the cutoff.
 *
 * That was tolerable when link preview cost a click. Since August 19, 2026,
 * video preview is automatic, and the cost is paid just by typing the address:
 * two small downloads instead of one huge pointless one stopped being a tweak
 * and became the difference between the path working or not working.
 *
 * The ID is validated in `youtubeIdOf` before entering any URL: eleven
 * characters from a known alphabet, because whoever wrote chose the link.
 */
async function preverYoutube(id: string, buscar: typeof fetch, sinal: AbortSignal): Promise<PreVisualizacao> {
  let title: string | undefined
  let siteName: string | undefined
  try {
    const resposta = await buscar(youtubeOembedUrl(id), {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: sinal,
    })
    if (!resposta.ok) throw new Error(`o oEmbed respondeu ${resposta.status}`)
    const dados = (await resposta.json()) as { title?: unknown; author_name?: unknown; provider_name?: unknown }
    if (typeof dados.title === "string") title = dados.title.slice(0, 200)
    if (typeof dados.author_name === "string") siteName = dados.author_name.slice(0, 100)
    else if (typeof dados.provider_name === "string") siteName = dados.provider_name.slice(0, 100)
  } catch {
    // No title still brings a thumbnail, and the facade still works.
  }

  let image: string | undefined
  for (const endereco of youtubeThumbnailUrls(id)) {
    image = await buscarImagem(endereco, buscar, sinal)
    if (image) break
  }

  return {
    ...(title === undefined ? {} : { title }),
    ...(siteName === undefined ? {} : { siteName }),
    ...(image === undefined ? {} : { image }),
  }
}

/** What the page says about itself, and the image it declared. */
export async function preVisualizarLink(url: string, deps: DepsDePreVisualizacao = {}): Promise<PreVisualizacao> {
  const buscar = deps.fetchImpl ?? globalThis.fetch
  const controlo = new AbortController()
  const relogio = setTimeout(() => controlo.abort(), deps.timeoutMs ?? TIMEOUT_MS)
  try {
    // Recognized by the address, and by exact domain match: `youtube.com` is
    // contained in `youtube.com.exemplo.pt`, and a contains check would send this
    // process to an oEmbed chosen by someone else.
    const videoId = youtubeIdOf(url)
    if (videoId) return await preverYoutube(videoId, buscar, controlo.signal)

    // No cookies and no referrer: this isn't a visit, and the page that matters
    // is what anyone would see.
    const resposta = await buscar(url, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "follow",
      signal: controlo.signal,
    })
    if (!resposta.ok) throw new Error(`a página respondeu ${resposta.status}`)
    const html = (await resposta.text()).slice(0, PAGINA_MAX_CHARS)
    const lida = parsePreviewHtml(html, resposta.url || url)

    const image = lida.image ? await buscarImagem(lida.image, buscar, controlo.signal) : undefined

    return {
      ...(lida.title === undefined ? {} : { title: lida.title }),
      ...(lida.description === undefined ? {} : { description: lida.description }),
      ...(lida.siteName === undefined ? {} : { siteName: lida.siteName }),
      ...(image === undefined ? {} : { image }),
    }
  } finally {
    clearTimeout(relogio)
  }
}

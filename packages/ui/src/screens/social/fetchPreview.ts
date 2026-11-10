/**
 * The link preview, fetched by the device of whoever is publishing.
 *
 * This is the rule, and it is the entire product: the reader NEVER talks to the
 * link's website. All other products build the card on the reader's side, the
 * client fetches the page to draw the thumbnail, and with that they tell the
 * site, and anyone watching the link, that this person looked at this post at
 * this instant. It is a read receipt delivered to a third party that was never
 * part of the conversation.
 *
 * Here the page is read once, by the person sharing it and who was already there,
 * and the bytes travel inside the encrypted message like images do. The reader
 * receives pixels, not an address to go fetch.
 *
 * Inside a browser this only works when the destination site sends headers that
 * allow reading, and most do not. That is why there is a path through the server,
 * in `apps/server/src/link-preview.ts`: this is tried first, because when it
 * works the server learns nothing.
 *
 * Open Graph extraction does not live here: it is shared with the server, in
 * `@enclave/protocol`, so there is one and not two disagreeing with each other.
 */

import { parsePreviewHtml, normaliseUrl } from "@enclave/protocol"

export { normaliseUrl, parsePreviewHtml }
export type { ParsedPreview } from "@enclave/protocol"

/** Maximum thumbnail size, already in data URL form. See `LinkDraft`. */
export const THUMBNAIL_MAX_CHARS = 100_000
/** Never read an entire page that turned out to be a video. */
const PAGE_MAX_BYTES = 2_000_000
/** Larger side of the thumbnail, in pixels, when shrinking is needed. */
const THUMBNAIL_MAX_SIDE = 480

export interface PreviewFields {
  title?: string
  description?: string
  siteName?: string
  thumbnail?: string
}

function maybe<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>)
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("unreadable image"))
    reader.readAsDataURL(blob)
  })
}

/** How many characters a number of bytes takes up in base64, with headroom. */
function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4 + 64
}

/**
 * The image, shrunk to fit inside a message.
 *
 * Small enough passes as is; too large is redrawn on a canvas. Where there is
 * no canvas, a test environment, for example, it quits silently: a post
 * without a thumbnail is better than a message that does not fit in the feed.
 */
export async function shrinkToThumbnail(blob: Blob): Promise<string | undefined> {
  if (base64Length(blob.size) <= THUMBNAIL_MAX_CHARS) {
    const raw = await blobToDataUrl(blob)
    if (raw.length <= THUMBNAIL_MAX_CHARS) return raw
  }
  try {
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, THUMBNAIL_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext("2d")
    if (!context) return undefined
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const shrunk = canvas.toDataURL("image/jpeg", 0.72)
    return shrunk.length <= THUMBNAIL_MAX_CHARS ? shrunk : undefined
  } catch {
    return undefined
  }
}

export interface PreviewDeps {
  fetchImpl?: typeof fetch
  shrink?: (blob: Blob) => Promise<string | undefined>
}

/**
 * Fetch the preview from this device.
 *
 * `credentials: "omit"` because this is not a visit: no cookies from the
 * publisher need to come with the request, and without them the page returned
 * is what anyone would see. Empty `referrer` for the same reason as in
 * `RichText`, where the person came from is this product, and the site has
 * nothing to do with it.
 */
export async function fetchLinkPreview(url: string, deps: PreviewDeps = {}): Promise<PreviewFields> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  const shrink = deps.shrink ?? shrinkToThumbnail
  const target = normaliseUrl(url)
  if (!target) throw new Error("sem endereço")

  const response = await fetchImpl(target, { credentials: "omit", referrerPolicy: "no-referrer", redirect: "follow" })
  if (!response.ok) throw new Error(`a página respondeu ${response.status}`)
  const html = (await response.text()).slice(0, PAGE_MAX_BYTES)
  const parsed = parsePreviewHtml(html, response.url || target)

  let thumbnail: string | undefined
  if (parsed.image) {
    try {
      const image = await fetchImpl(parsed.image, { credentials: "omit", referrerPolicy: "no-referrer" })
      // A thumbnail that does not arrive does not ruin the title that already did.
      if (image.ok) thumbnail = await shrink(await image.blob())
    } catch {
      thumbnail = undefined
    }
  }

  return {
    ...maybe("title", parsed.title),
    ...maybe("description", parsed.description),
    ...maybe("siteName", parsed.siteName),
    ...maybe("thumbnail", thumbnail),
  }
}

/** What the host returns: the same fields, with the image to be shrunk. */
export interface HostPreview {
  title?: string
  description?: string
  siteName?: string
  image?: string
}

/**
 * A data URL broken down to bytes, without going over the network.
 *
 * The obvious path, `fetch(dataUrl)`, does not work here: the app's content
 * policy has `connect-src 'self'`, and the browser refuses that `fetch` even
 * to a `data:`, which does not even leave the machine. It cost a thumbnail that
 * came from the server and vanished silently before being drawn.
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const virgula = dataUrl.indexOf(",")
  if (!dataUrl.startsWith("data:") || virgula < 0) throw new Error("não é uma data URL")
  const cabecalho = dataUrl.slice(5, virgula)
  const tipo = cabecalho.split(";")[0] || "application/octet-stream"
  const corpo = dataUrl.slice(virgula + 1)
  if (!cabecalho.includes("base64")) return new Blob([decodeURIComponent(corpo)], { type: tipo })
  const binario = atob(corpo)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return new Blob([bytes], { type: tipo })
}

/**
 * The link preview, requested from whoever hosts this app.
 *
 * This is the entry to use for anyone wanting link cards elsewhere, in chat,
 * for example: you give it an address, it returns the card ready to publish,
 * with the thumbnail already shrunk to fit in a message.
 *
 * **Why we do not try here first.** Trying from here and only then asking the
 * host would be better for privacy, when it worked, nobody else would know.
 * Except it cannot work: the app's content policy has `connect-src 'self'`,
 * and the browser itself refuses the request before the site has a chance to
 * allow it. That attempt was there, and all it did was an error in the console
 * and a call to the host next. Widening the policy to the entire internet to
 * save it was a much bigger price than what it bought.
 *
 * Who the host is decides what you pay: on Electron it is the main process on
 * this machine, and nobody in the world learns; on the web it is the homeserver,
 * which starts to see what links are published. In both cases, whoever READS the
 * post does not talk to the site or the host, the bytes travel inside the
 * encrypted message, and that is the part of the promise that stays whole.
 */
export async function fetchPreviewViaHost(
  url: string,
  viaHost: (url: string) => Promise<HostPreview>,
  deps: PreviewDeps = {},
): Promise<PreviewFields> {
  const target = normaliseUrl(url)
  if (!target) throw new Error("sem endereço")

  const shrink = deps.shrink ?? shrinkToThumbnail
  const hosted = await viaHost(target)

  let thumbnail: string | undefined
  if (hosted.image) {
    try {
      // It arrives in bytes and leaves shrunk: shrinking needs a canvas, which only
      // exists on this side, and that is what keeps the message within what fits.
      thumbnail = await shrink(dataUrlToBlob(hosted.image))
    } catch {
      // A thumbnail that does not fit does not ruin the title that already did.
      thumbnail = undefined
    }
  }

  return {
    ...maybe("title", hosted.title),
    ...maybe("description", hosted.description),
    ...maybe("siteName", hosted.siteName),
    ...maybe("thumbnail", thumbnail),
  }
}

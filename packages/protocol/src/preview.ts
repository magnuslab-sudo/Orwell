/**
 * What a page says about itself: Open Graph and the classic meta tags.
 *
 * It lives here, not in the screen that uses it, because two parties now read it:
 * the poster's device, when the site allows it, and the server, when
 * it doesn't. A second extraction written by hand would eventually disagree with
 * this one, and the difference would show up as a card that changes its title
 * depending on the path it came from.
 *
 * Everything here is pure and offline: it takes text and returns fields. That is
 * what makes it testable with no socket in sight, from both sides.
 */

/** The fields the page declares, before the image is fetched. */
export interface ParsedPreview {
  title?: string
  description?: string
  siteName?: string
  image?: string
}

const META_TAG = /<meta\b[^>]*>/gi
const TITLE_TAG = /<title[^>]*>([\s\S]*?)<\/title>/i

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag)
  if (!match) return undefined
  return match[2] ?? match[3] ?? match[4]
}

/**
 * The entities that appear even in page titles.
 *
 * A short list, not a general decoder: this runs on third-party HTML, and
 * handing it to an interpreter would open exactly the door the rest of
 * the product works to keep shut. Text comes out of here as text and is
 * drawn as text, never as markup.
 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
}

function clean(value: string | undefined, limit: number): string | undefined {
  if (!value) return undefined
  const text = decodeEntities(value).replace(/\s+/g, " ").trim()
  return text ? text.slice(0, limit) : undefined
}

function maybe<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>)
}

/** An image declared with a relative path still belongs to the same page. */
function absolute(url: string | undefined, base: string): string | undefined {
  if (!url) return undefined
  try {
    const resolved = new URL(decodeEntities(url), base)
    // Only http(s): a giant `data:` on another page is not a thumbnail, and any
    // other scheme is not something to fetch.
    return resolved.protocol === "http:" || resolved.protocol === "https:" ? resolved.href : undefined
  } catch {
    return undefined
  }
}

/**
 * What the page says about itself: Open Graph first, `<title>` and classic meta
 * tags next.
 */
export function parsePreviewHtml(html: string, pageUrl: string): ParsedPreview {
  const head = html.slice(0, 200_000)
  const meta = new Map<string, string>()
  for (const tag of head.match(META_TAG) ?? []) {
    const key = attribute(tag, "property") ?? attribute(tag, "name")
    const content = attribute(tag, "content")
    if (!key || content === undefined) continue
    // The first one wins: pages repeat og:image with variants, and the first is the one
    // the author put first.
    if (!meta.has(key.toLowerCase())) meta.set(key.toLowerCase(), content)
  }

  const documentTitle = TITLE_TAG.exec(head)?.[1]
  const image = meta.get("og:image") ?? meta.get("og:image:url") ?? meta.get("twitter:image")

  return {
    ...maybe("title", clean(meta.get("og:title") ?? meta.get("twitter:title") ?? documentTitle, 200)),
    ...maybe("description", clean(meta.get("og:description") ?? meta.get("description"), 500)),
    ...maybe("siteName", clean(meta.get("og:site_name"), 100)),
    ...maybe("image", absolute(image, pageUrl)),
  }
}

/** An address typed in haste is still an address. */
export function normaliseUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ""
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/**
 * YouTube videos in a post or a message.
 *
 * **There is no embedded player.** Since the owner's request on 2 November 2026, a YouTube
 * video renders as a thumbnail, and a click opens the video in a new browser tab, or in the
 * system browser in the desktop app. Nothing embeds, and so security policies went back to
 * `frame-src 'none'` and `podeSair` (in `@enclave/client-core`) lost its gate to Google.
 *
 * Before that there was an `iframe` from `youtube-nocookie.com`, created on click. It
 * handed the page origin to Google (via `Referer` with `referrerpolicy="origin"`, and via
 * `location.ancestorOrigins`, which no policy closes). Opening outside has no such cost: the
 * new tab goes with `rel="noopener noreferrer"`, no `Referer` and no `window.opener`.
 *
 * **What stays: viewing a message asks nothing of Google.** The thumbnail and title come
 * from the POSTER's side (the desktop app's main process, or the server on the
 * web), once, and travel inside the encrypted message as bytes. The reader renders them
 * without talking to anyone. Only whoever clicks the thumbnail talks to YouTube, and talks
 * because they asked for the video.
 */

/**
 * Eleven characters from a known alphabet, or it is not an identifier.
 *
 * Validation is not hygiene: what comes out of here goes into a URL, and the address came
 * from the poster. Without this, posting a link with a crafted
 * "identifier" would be enough to write anything into the address.
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/** The YouTube domains, and only those. Compared by equality, never by
 * containment: `youtube.com.exemplo.pt` contains `youtube.com`. */
const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
])

/** The paths that carry the identifier in the next segment. */
const PATH_PREFIXES = ["embed", "shorts", "live", "v"]

/**
 * The video identifier, or `null` when the address is not a YouTube video we can recognize
 * with certainty.
 */
export function youtubeIdOf(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null

  const host = parsed.hostname.toLowerCase()
  if (!HOSTS.has(host)) return null

  const segments = parsed.pathname.split("/").filter(Boolean)

  // youtu.be/<id>
  if (host === "youtu.be" || host === "www.youtu.be") {
    const candidato = segments[0] ?? ""
    return VIDEO_ID.test(candidato) ? candidato : null
  }

  // /watch?v=<id>
  if (segments[0] === "watch") {
    const candidato = parsed.searchParams.get("v") ?? ""
    return VIDEO_ID.test(candidato) ? candidato : null
  }

  // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
  if (segments[0] && PATH_PREFIXES.includes(segments[0])) {
    const candidato = segments[1] ?? ""
    return VIDEO_ID.test(candidato) ? candidato : null
  }

  return null
}

/** The address to open, built from an already-validated identifier. */
export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`
}

/**
 * The oEmbed endpoint, which is where the title comes from.
 *
 * The YouTube page declares Open Graph like any other, except at byte 691,000, far beyond
 * any sensible download cap (measured; the whole document is over 1.3 MB). Downloading 700
 * KB to read one `<meta>` tag is the wrong way, and raising the cap for all sites because
 * of this one is worse.
 *
 * oEmbed gives the same information in about 300 bytes, is a documented interface rather than
 * scraping, and needs no HTML parser.
 */
export function youtubeOembedUrl(id: string): string {
  return `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeWatchUrl(id))}&format=json`
}

/**
 * The thumbnails, best to worst. The POSTER fetches them, never the reader: see the
 * start of this file.
 *
 * `maxresdefault` only exists for videos uploaded in high resolution and responds 404 on
 * others; `hqdefault` always exists. A list, not a single address, so whoever fetches can
 * try the next one instead of giving up: a facade without a thumbnail is a gray box, which
 * is exactly what it was meant to avoid.
 */
export function youtubeThumbnailUrls(id: string): string[] {
  return [
    `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
  ]
}

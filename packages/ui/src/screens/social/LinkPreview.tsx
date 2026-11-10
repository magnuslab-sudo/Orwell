import type { LinkCard } from "../../bridge.js"
import { domainOf } from "../../lib/format.js"
import { strings } from "../../strings.js"
import { youtubeIdOf, youtubeWatchUrl } from "@enclave/protocol"

/**
 * The play triangle, drawn rather than borrowed from a typeface.
 *
 * It stays here with the view that uses it while `icons.tsx` is being redone
 * next to it. Same 24-unit grid and same `currentColor` as the others.
 */
function PlayIcon({ size = 30 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 6.8v10.4a.7.7 0 0 0 1.07.6l8.2-5.2a.7.7 0 0 0 0-1.2l-8.2-5.2A.7.7 0 0 0 9 6.8Z" fill="currentColor" />
    </svg>
  )
}

/**
 * A YouTube video: the thumbnail, and clicking it opens the video OUTSIDE the app.
 *
 * Owner request on November 2, 2026: "show YouTube thumbnails visually, but when
 * the user clicks the thumbnail it opens a new window or tab with the link".
 * Until then clicking spawned the YouTube player in an `iframe` inside the chat.
 * It's gone, and with it the `frame-src` exception in both policies and YouTube's
 * port in `podeSair`.
 *
 * It is just a link. In the browser, `target="_blank"` opens a new tab. In the
 * desktop app the same window request reaches `setWindowOpenHandler` in the main
 * process, which hands it to the system browser (`shell.openExternal`, only for
 * `http:` and `https:`) and denies the window: nothing opens inside the app.
 *
 * The thumbnail already comes inside the encrypted message, put there by whoever
 * published it: nothing is requested from Google to draw it. See `@enclave/protocol`,
 * `youtube.ts`.
 */
function YouTubeMiniatura({ link, videoId }: { link: LinkCard; videoId: string }): React.JSX.Element {
  return (
    <a
      className="link-card video-facade"
      href={youtubeWatchUrl(videoId)}
      target="_blank"
      // `noreferrer` kills the header that says where it came from; `noopener` cuts off
      // `window.opener` on the other side. Both, not one: `noopener` alone would let
      // the `Referer` through.
      rel="noopener noreferrer"
      title={strings.linkCard.openVideo}
    >
      <span className="facade-frame">
        {link.thumbnail ? (
          <img className="facade-thumb" src={link.thumbnail} alt="" />
        ) : (
          <span className="facade-blank" />
        )}
        <span className="facade-play" aria-hidden="true">
          <PlayIcon />
        </span>
      </span>
      <span className="link-body">
        <span className="link-site">{link.siteName || domainOf(link.url)}</span>
        {link.title && <span className="link-title">{link.title}</span>}
        {link.description && <span className="link-desc">{link.description}</span>}
      </span>
    </a>
  )
}

export function LinkPreview({ link }: { link: LinkCard }): React.JSX.Element {
  // Recognized by the address, never by `kind`, which is a field the publisher picks
  // from a list and can say anything.
  const videoId = youtubeIdOf(link.url)
  if (videoId) return <YouTubeMiniatura link={link} videoId={videoId} />

  const domain = domainOf(link.url)
  return (
    <div className={`link-card ${link.kind ?? "link"}`}>
      {link.thumbnail && <img className="link-thumb" src={link.thumbnail} alt="" />}
      <div className="link-body">
        <span className="link-site">
          {link.kind === "video" ? strings.linkCard.videoPrefix : ""}
          {link.siteName || domain}
        </span>
        {link.title && <span className="link-title">{link.title}</span>}
        {link.description && <span className="link-desc">{link.description}</span>}
        {/* Selectable text, not an anchor: opening it should be a decision. */}
        <code className="link-url">{link.url}</code>
      </div>
    </div>
  )
}

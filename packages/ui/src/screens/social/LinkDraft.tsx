import { useEffect, useRef, useState } from "react"
import { useBridge } from "../../App.js"
import type { LinkCard } from "../../bridge.js"
import { Button } from "../../components/Button.js"
import { strings } from "../../strings.js"
import { fetchPreviewViaHost, normaliseUrl, shrinkToThumbnail } from "./fetchPreview.js"

/** How long to wait after the last key before fetching on its own. */
const AUTO_DELAY_MS = 700

/**
 * Composing a link card.
 *
 * The title and thumbnail come in on their own: write the address, the preview
 * is fetched without anyone pressing anything, and the bytes travel inside the
 * encrypted message. The reader never contacts the site, see `fetchPreview.ts`.
 *
 * Who fetches it depends on where this runs: on Electron it is the main process
 * on this machine, on the web it is the homeserver. This module does not fetch it
 * on its own because it cannot, see `fetchPreviewViaHost`.
 *
 * Hand-typed fields stay, and they are not a shameful plan B: there are sites that
 * do not let themselves be read any way, and a field that always worked is better
 * than a button that fails silently.
 */
export function LinkDraft({
  link,
  onChange,
  onRemove,
}: {
  link: LinkCard
  onChange: (next: LinkCard) => void
  onRemove: () => void
}): React.JSX.Element {
  const bridge = useBridge()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  /**
   * Addresses already tried in this box.
   *
   * Without this, automatic fetching would repeat with each letter typed next and
   * each redraw, dozens of requests to the host for the same link. A reference,
   * not state: changing this is never a reason to redraw.
   */
  const tentados = useRef(new Set<string>())

  const buscar = (url: string, automatico: boolean): void => {
    if (!url) return
    tentados.current.add(url)
    setBusy(true)
    setNote(null)
    void fetchPreviewViaHost(url, (alvo) => bridge.social.linkPreview(alvo))
      .then((preview) => {
        // What the person already typed beats what the page says: whoever fixed
        // a title does not want to see it undone by a fetch that arrived later.
        onChange({
          ...link,
          url,
          ...(preview.title && !link.title ? { title: preview.title } : {}),
          ...(preview.description && !link.description ? { description: preview.description } : {}),
          ...(preview.siteName && !link.siteName ? { siteName: preview.siteName } : {}),
          ...(preview.thumbnail && !link.thumbnail ? { thumbnail: preview.thumbnail } : {}),
        })
        if (!preview.title && !preview.thumbnail) setNote(strings.linkCard.fetchEmpty)
      })
      .catch(() => {
        // An automatic fetch that fails does not interrupt whoever is typing: the
        // warning is for whoever asked, and whoever did not ask finds out from the
        // empty fields in front of them.
        if (!automatico) setNote(strings.linkCard.fetchFailed)
      })
      .finally(() => setBusy(false))
  }

  /**
   * The automatic fetch, a moment after the last key.
   *
   * The delay is not cosmetic: without it, each letter of a pasted address
   * was a request, and "https://e", "https://ex", "https://exe" all went out.
   */
  const urlNormalizada = normaliseUrl(link.url)
  const temEndereco = /^https?:\/\/[^\s.]+\.[^\s]{2,}/i.test(urlNormalizada)
  useEffect(() => {
    if (!temEndereco || tentados.current.has(urlNormalizada)) return
    // Already filled in by hand is a choice of whoever is writing, and we do not override it.
    if (link.title && link.thumbnail) return
    const relogio = setTimeout(() => buscar(urlNormalizada, true), AUTO_DELAY_MS)
    return () => clearTimeout(relogio)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlNormalizada, temEndereco])

  const escolherMiniatura = (file: File | undefined): void => {
    if (!file) return
    setNote(null)
    void shrinkToThumbnail(file)
      .then((thumbnail) => {
        if (!thumbnail) {
          setNote(strings.linkCard.thumbTooBig)
          return
        }
        onChange({ ...link, thumbnail })
      })
      .catch(() => setNote(strings.linkCard.thumbTooBig))
  }

  return (
    <div className="link-draft">
      <div className="link-draft-row">
        <select
          value={link.kind}
          onChange={(event) => onChange({ ...link, kind: event.target.value as LinkCard["kind"] })}
        >
          <option value="link">{strings.linkCard.kindLink}</option>
          <option value="video">{strings.linkCard.kindVideo}</option>
          <option value="image">{strings.linkCard.kindImage}</option>
          <option value="post">{strings.linkCard.kindPost}</option>
        </select>
        <input
          value={link.url}
          placeholder={strings.linkCard.urlPlaceholder}
          onChange={(event) => onChange({ ...link, url: event.target.value })}
        />
        <Button variant="ghost" onClick={onRemove} title={strings.common.remove}>
          ×
        </Button>
      </div>
      <input
        value={link.title ?? ""}
        placeholder={strings.linkCard.titlePlaceholder}
        onChange={(event) => onChange({ ...link, title: event.target.value })}
      />

      <div className="link-draft-tools">
        {/* There is still a button: automatic fetch runs once per address, and a site
            that was down deserves a second try without having to retype the line. */}
        <Button
          variant="ghost"
          disabled={busy || link.url.trim().length === 0}
          onClick={() => buscar(normaliseUrl(link.url), false)}
        >
          {busy ? strings.linkCard.fetching : strings.linkCard.fetchPreview}
        </Button>
        <label className="ghost file">
          {strings.linkCard.pickThumb}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => {
              escolherMiniatura(event.target.files?.[0])
              event.target.value = ""
            }}
          />
        </label>
        {link.thumbnail && (
          <span className="link-draft-thumb">
            <img src={link.thumbnail} alt="" />
            <button
              type="button"
              title={strings.common.remove}
              aria-label={strings.linkCard.dropThumb}
              onClick={() => {
                const { thumbnail: _dropped, ...rest } = link
                onChange(rest)
              }}
            >
              ×
            </button>
          </span>
        )}
      </div>

      {note && <p className="field-note warn">{note}</p>}
    </div>
  )
}

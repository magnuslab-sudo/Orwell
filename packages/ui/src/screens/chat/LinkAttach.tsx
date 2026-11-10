import { useEffect, useRef, useState } from "react"
import { youtubeIdOf } from "@enclave/protocol"
import { useBridge } from "../../App.js"
import type { LinkCard } from "../../bridge.js"
import { compressImage, IMAGE_BUDGETS } from "../../lib/images.js"
import { domainOf } from "../../lib/format.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { strings, traduzirErro } from "../../strings.js"
import { fetchPreviewViaHost, type PreviewFields } from "../social/fetchPreview.js"
import { LinkPreview } from "../social/LinkPreview.js"

/** How long to wait after the last key before fetching on its own. The same as
 * the feed draft uses, for the same reason: an address being typed passes
 * through many states before it is complete. */
const AUTO_DELAY_MS = 700

/**
 * Compose a link preview in the input box.
 *
 * **The rule, which is the whole product:** whoever SENDS fetches the preview
 * once, and it travels inside the encrypted message. Whoever reads never talks
 * to the site. Otherwise, the link's server would know the IP address of each
 * person who opened the conversation, the time they opened it, without anyone
 * having pressed anything, a read receipt delivered to a third party who was
 * never part of the conversation. It is the same reasoning, and the same code,
 * that the feed already uses; see `fetchPreview.ts`.
 *
 * **A YouTube video enters on its own; other links wait for the tap.**
 * Owner request on August 19, 2026: *"YouTube video and link previews should
 * preview automatically - when they enter chats or posts, they become
 * playable"*. The split is not laziness to generalize, it is what the cost
 * difference allows:
 *
 * - For any other site, the address is chosen by whoever writes and can be
 *   anything. Fetching on its own would mean hitting the host at an arbitrary
 *   destination just because someone wrote a line, before there is a message,
 *   and even if the sentence is deleted after. There the tap is consent, and
 *   whoever does not give it sends the link anyway, tappable as always.
 * - For a YouTube video the destination is fixed and known before it leaves
 *   here: the oEmbed and thumbnail, and nothing else, see `preverYoutube` on
 *   the host. The address never decides where the request goes; it only decides
 *   which identifier it carries, and that is eleven characters validated in
 *   `youtubeIdOf`.
 *
 * **What is not free, and is written in `docs/THREAT-MODEL.md`:** writing a
 * YouTube link in the box now is enough for the host to talk to Google, even if
 * the message is never sent. On the desktop app the host is this machine and no
 * one else finds out; on the web it is the homeserver, and what comes out of it
 * is a request from a server, not from a person.
 *
 * **The card is born with the address, before any request.** Without the card
 * there are no `links` in the message, and without `links` the reader gets text
 * and nothing else, someone who pastes a video and presses Enter the next
 * instant would miss it. The cold card is the facade to fill, which is already
 * playable: the title and thumbnail arrive next and are trim. That is why a
 * failed fetch breaks nothing here: the video still has somewhere to tap.
 *
 * **Who fetches, and why it changed.** There used to be a fetch done by the
 * browser itself, and it could NEVER work: the app's content policy has
 * `connect-src 'self'`, so the request dies in the browser before the site has
 * a chance to allow it. The symptom was a card without a thumbnail, always, and
 * an error in the console that no one read. The feed already moved past that
 * path; the conversation was left behind. Now it asks the host,  * `fetchPreviewViaHost`, the same entry the feed uses, and which the entry
 * itself says was written for this.
 *
 * Who the host is decides what is paid: on Electron it is the main process of
 * this machine and no one finds out anything; on the web it is the homeserver,
 * which now sees which links are shared. **What never changes either way is the
 * promise to whoever reads:** the pixels travel inside the encrypted message,
 * and whoever opens the conversation does not talk to the site, Google, or the
 * host.
 *
 * **Why there is a manual path.** There are sites that will not let themselves
 * be read any way. When it fails, the title is written and the thumbnail is
 * chosen from the disk, and the promise to whoever reads stays the same, because
 * the bytes still come out from inside here.
 */
export function LinkAttach({
  url,
  card,
  onChange,
  onDismiss,
}: {
  /** The address found in the text being typed. */
  url: string
  /** The composed card, if it exists. */
  card: LinkCard | null
  onChange: (card: LinkCard | null) => void
  /** Dismiss the preview for this address. The link still goes. */
  onDismiss: () => void
}): React.JSX.Element {
  const bridge = useBridge()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  /** True after a failed attempt: only then do the manual fields appear. */
  const [manual, setManual] = useState(false)

  /** The video identifier, or null. From the ADDRESS, never from `kind`. */
  const videoId = youtubeIdOf(url)

  /**
   * Videos already tried, and what came from them.
   *
   * Saved by identifier, not address, because `?t=42` written next is the same
   * video: without this, each key after the identifier was another request, and
   * the card that had already arrived would vanish with it, the composer throws
   * away the card whenever the address changes, on purpose.
   *
   * References, not state: changing them is never a reason to redraw.
   */
  const tentados = useRef(new Set<string>())
  const guardados = useRef(new Map<string, PreviewFields>())

  // New address, new card: the previous one doesn't describe this one.
  useEffect(() => {
    setNote(null)
    setManual(false)
  }, [url])

  const buscar = (automatico: boolean): void => {
    if (videoId) tentados.current.add(videoId)
    setBusy(true)
    setNote(null)
    const base: LinkCard = { url, kind: videoId ? "video" : "link" }
    void fetchPreviewViaHost(url, (alvo) => bridge.social.linkPreview(alvo))
      .then((preview) => {
        const campos: PreviewFields = {
          ...(preview.title ? { title: preview.title } : {}),
          ...(preview.description ? { description: preview.description } : {}),
          ...(preview.siteName ? { siteName: preview.siteName } : {}),
          ...(preview.thumbnail ? { thumbnail: preview.thumbnail } : {}),
        }
        if (Object.keys(campos).length === 0) {
          // An automatic search that finds nothing doesn't interrupt the writer: the
          // alert goes to whoever requested it. See the `catch` for the same reason.
          if (!automatico) {
            setNote(strings.linkCard.fetchEmpty)
            setManual(true)
          }
          onChange(base)
          return
        }
        if (videoId) guardados.current.set(videoId, campos)
        onChange({ ...base, ...campos })
      })
      .catch(() => {
        // A site that won't load even here, or a host that doesn't recognize the
        // request. There's nothing to fix on this end. What we have is the path at
        // hand, which always works and gives the same result to anyone reading it, // and in a video it's not even needed, because the preview is already reproducible.
        if (!automatico) {
          setNote(strings.linkCard.fetchFailed)
          setManual(true)
        }
        onChange(base)
      })
      .finally(() => setBusy(false))
  }

  /**
   * The video loads on its own: first the card, then the preview.
   *
   * The `card.url === url` guard is not excessive. When the address changes,
   * child effects run before the parent's, so the card we see here is still
   * from the previous address, and without this comparison the guard would
   * give up seeing a title that no longer describes anything, leaving the
   * compositor to discard the card right after.
   */
  useEffect(() => {
    if (!videoId) return
    // A card with content, at this address, is the writer's choice: we don't override it.
    if (card && card.url === url && (card.title !== undefined || card.thumbnail !== undefined)) return

    const guardado = guardados.current.get(videoId)
    onChange({ url, kind: "video", ...(guardado ?? {}) })
    if (guardado || tentados.current.has(videoId)) return

    const relogio = setTimeout(() => buscar(true), AUTO_DELAY_MS)
    return () => clearTimeout(relogio)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, url])

  const escolherMiniatura = (file: File | undefined): void => {
    if (!file) return
    setNote(null)
    // Through the common compressor, like all other images: the thumbnail travels
    // inside the message and uses the same budget as everything else.
    void compressImage(file, IMAGE_BUDGETS.thumbnail)
      .then((imagem) => onChange({ ...(card ?? { url, kind: "link" }), thumbnail: imagem.dataUrl }))
      .catch((erro: Error) => setNote(traduzirErro(erro)))
  }

  /**
   * Is there a card worth drawing?
   *
   * In a video, the blank card already matters: it's the preview to fill, with
   * the play button on top, and it's exactly what the reader gets if the search
   * finds nothing. Showing the request button on top of it would offer what's
   * already happening.
   */
  const temCartao = card !== null && (videoId !== null || card.title !== undefined || card.thumbnail !== undefined)

  return (
    <div className="link-attach">
      <div className="link-attach-row">
        <span className="link-attach-domain" title={url}>
          {domainOf(url)}
        </span>
        {!temCartao && !manual && (
          <button type="button" className="link-attach-action" disabled={busy} onClick={() => buscar(false)}>
            {busy ? strings.linkCard.fetching : strings.chat.linkPreviewAsk}
          </button>
        )}
        <button
          type="button"
          className="link-attach-close"
          title={strings.chat.linkPreviewDrop}
          aria-label={strings.chat.linkPreviewDrop}
          onClick={onDismiss}
        >
          ×
        </button>
      </div>

      {/* Exactly the card the reader will see, no approximations. */}
      {temCartao && card && <LinkPreview link={card} />}

      {manual && (
        <div className="link-attach-manual">
          <input
            value={card?.title ?? ""}
            placeholder={strings.linkCard.titlePlaceholder}
            maxLength={200}
            onChange={(event) => onChange({ ...(card ?? { url, kind: "link" }), title: event.target.value })}
          />
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
        </div>
      )}

      {note && (
        <p className="field-note warn">
          <TextoDeErro texto={note} />
        </p>
      )}
    </div>
  )
}

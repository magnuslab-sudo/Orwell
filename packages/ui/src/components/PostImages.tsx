import { Fragment } from "react"
import type { MediaItem } from "../types.js"
import { strings } from "../strings.js"
import { ImagemAPedido } from "./AnexoAPedido.js"
import { eVideo, VideoDaPublicacao } from "./VideoDaPublicacao.js"
import { dimensoesDaImagem, reserva } from "../lib/dimensoesDaImagem.js"

/**
 * A post's image grid, shared by the feed and the profile lightbox.
 *
 * An item may arrive with its bytes evicted: history keeps media only for the
 * newest messages and inside a global budget, so an old image degrades to a
 * small, honest placeholder rather than a broken tag — the words around it are
 * untouched.
 */
export function PostImages({
  media,
  onOpen,
}: {
  media: MediaItem[]
  /** When given, each live image becomes a button that opens it large. */
  onOpen?: ((item: MediaItem) => void) | undefined
}): React.JSX.Element | null {
  if (media.length === 0) return null
  return (
    <div className={`post-images n${Math.min(media.length, 4)}`}>
      {media.map((item, index) => {
        // A video in the same grid, with thumbnail and play button. Never opens fullscreen.
        if (eVideo(item)) return <VideoDaPublicacao key={index} item={item} />
        // Without the bytes: the marker, or, inside a message that states it, the request to other members (S5).
        if (item.evicted) return <ImagemAPedido key={index} item={item} onOpen={onOpen} />
        const src = item.inline ?? item.url
        // The reserved box before the image decodes: without this the row
        // was born with zero height and grew after, and the conversation scrolled out
        // of view. See `dimensoesDaImagem`.
        const d = dimensoesDaImagem(src)
        const image = (
          <img
            src={src}
            alt={item.name ?? ""}
            loading="lazy"
            {...(d ? { width: d.largura, height: d.altura } : {})}
          />
        )
        if (!onOpen) return <Fragment key={index}>{image}</Fragment>
        return (
          <button
            key={index}
            type="button"
            className="image-open"
            title={strings.social.viewImage}
            style={reserva(d)}
            onClick={() => onOpen(item)}
          >
            {image}
          </button>
        )
      })}
    </div>
  )
}


import { useId } from "react"
import type { MediaItem } from "../types.js"
import { Modal } from "./Modal.js"
import { nomeSeguro } from "../lib/ficheiros.js"
import { strings } from "../strings.js"

/**
 * A large image over everything else.
 *
 * It was written by hand inside `Social`, and the conversation did not have it, chat
 * images just drew themselves because `PostImages` only makes them a button when given an
 * `onOpen` and `Timeline` called it without one. Extracted here instead of copied there:
 * two identical sheets diverged at the first fix, and the next fix only landed in one.
 *
 * The bytes come from inside the encrypted message and are the same ones that were already
 * on the grid. Nothing here fetches anything from anywhere else.
 */
export function Lightbox({ item, onClose }: { item: MediaItem; onClose: () => void }): React.JSX.Element {
  const titulo = useId()
  // The name is from the sender. It serves as a label here, but goes through the same
  // treatment as everything else, a name with direction marks would reorder the screen
  // reader line just as it reorders the chat one.
  const nome = item.name ? nomeSeguro(item.name) : strings.social.imageFallbackName
  return (
    <Modal className="lightbox" labelledBy={titulo} onClose={onClose}>
      <h2 id={titulo} className="sr-only">
        {nome}
      </h2>
      <img src={item.inline ?? item.url} alt={item.name ? nome : ""} />
      <button
        type="button"
        className="lightbox-close"
        title={strings.common.close}
        aria-label={strings.common.close}
        onClick={onClose}
      >
        ×
      </button>
    </Modal>
  )
}

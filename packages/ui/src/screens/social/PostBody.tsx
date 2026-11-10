import { useMemo } from "react"
import type { MediaItem, ChatMessage } from "../../types.js"
import { FileAttachments, separarAnexos } from "../../components/FileAttachments.js"
import { PostImages } from "../../components/PostImages.js"
import { RichText } from "../../components/RichText.js"
import { strings } from "../../strings.js"
import { nomeEmFalta } from "../../lib/format.js"
import { LinkPreview } from "./LinkPreview.js"
import { Votacao } from "../../components/Votacao.js"
import { votacaoDe, type Apuramento } from "../../lib/votacoes.js"

/**
 * Everything a post says — caption, images, link cards, tags — in one place,
 * so the feed article and the profile lightbox render the same post the same
 * way by construction rather than by copy-paste.
 *
 * Tags become buttons only when a click means something (`onTagClick`); in the
 * profile lightbox they stay plain text, because there is nothing to filter.
 */
export function PostBody({
  payload,
  activeTag,
  onTagClick,
  onOpenImage,
  apuramento,
  nameFor,
  onVotar,
}: {
  payload: ChatMessage["payload"]
  /** The tag the feed is currently filtered by, for `aria-pressed`. */
  activeTag?: string | null | undefined
  onTagClick?: ((tag: string) => void) | undefined
  onOpenImage?: ((item: MediaItem) => void) | undefined
  /**
   * The tally of this poll, if the post is one.
   *
   * It comes already counted from the caller, and for the same reason as in chat:
   * votes are channel events and this function only knows the post payload.
   */
  apuramento?: Apuramento | undefined
  nameFor?: ((address: string) => string) | undefined
  /** Vote on an option. Absent means absent: the card reads but does not vote. */
  onVotar?: ((opcao: number) => void) | undefined
}): React.JSX.Element {
  const { imagens, ficheiros } = useMemo(() => separarAnexos(payload.media ?? []), [payload.media])
  /**
   * The poll this post carries, if it carries a readable one.
   *
   * If not readable, a future version this client does not know how to draw,    * it returns `null`, and the caption renders as always. That is why the caption
   * carries the question and the options in full. See `corpoDaVotacao`.
   */
  const votacao = useMemo(() => votacaoDe(payload), [payload])
  return (
    <>
      {/* Only the title that was actually given. Trimming the first words of the
          caption here would repeat, two lines up, what reads next, that is the
          name the post uses in a list, and the place for it is the list. */}
      {payload.title && <h3 className="post-title">{payload.title}</h3>}

      {/* The caption, except when a poll card says the same thing: a poll's caption
          IS the poll written out, and it exists for those who cannot draw it.
          Those who draw it read it once. */}
      {payload.caption && !votacao && (
        <p className="post-caption">
          <RichText>{payload.caption}</RichText>
        </p>
      )}

      {/* Without `nameFor` the resource is `nomeEmFalta`, as everywhere: it was
          `(address) => address`, and opening the vote list for an option would
          show full addresses instead of names. */}
      {votacao && (
        <Votacao
          votacao={votacao}
          apuramento={apuramento ?? { porOpcao: votacao.options.map(() => []), total: 0, minha: null }}
          nameFor={nameFor ?? nomeEmFalta}
          {...(onVotar ? { onVote: onVotar } : {})}
        />
      )}

      {/* Images in a grid, files in rows. Same split as chat and by the same
          function, so the two never disagree on what is an image, and it decides
          by `mediaType`, because the vault dump throws away `kind`. See
          `separarAnexos`. */}
      <PostImages media={imagens} onOpen={onOpenImage} />
      <FileAttachments files={ficheiros} />

      {payload.links?.map((link, index) => (
        <LinkPreview key={index} link={link} />
      ))}

      {(payload.tags?.length ?? 0) > 0 && (
        <ul className="tags">
          {payload.tags?.map((tag) => (
            <li key={tag}>
              {onTagClick ? (
                <button
                  type="button"
                  className="tag-pill"
                  aria-pressed={tag === activeTag}
                  title={strings.social.filterByTag(tag)}
                  onClick={() => onTagClick(tag)}
                >
                  #{tag}
                </button>
              ) : (
                <span className="tag-pill">#{tag}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

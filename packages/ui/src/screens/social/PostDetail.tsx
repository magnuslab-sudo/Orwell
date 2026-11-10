import { useMemo, useState } from "react"
import { AnexosDoItem } from "../../components/AnexoAPedido.js"
import type { Profile } from "../../bridge.js"
import type { ChatMessage, MediaItem } from "../../types.js"
import { Carrossel } from "../../components/Carrossel.js"
import { separarAnexos } from "../../components/FileAttachments.js"
import { Lightbox } from "../../components/Lightbox.js"
import { engagementOf, NO_ENGAGEMENT } from "./engagement.js"
import { PostBody } from "./PostBody.js"
import { PostEngagement } from "./PostEngagement.js"
import { usePostActions } from "./usePostActions.js"
import { apurar, votacaoDe, votosDe } from "../../lib/votacoes.js"

/**
 * A post opened outside the feed: what it says, and what it received.
 *
 * The profile opened posts long ago and showed only the `PostBody`, the caption,
 * photos, links. Anyone there saw the post and nothing else: no thumbs, no counts,
 * no comments that were already there. The same post viewed in the feed had all
 * three. No mechanism was missing, the protocol has `post.reaction` and
 * `post.comment` since posts existed, and `engagementOf` already summed them,  * this link was missing.
 *
 * It exists as a component and not as another block inside each profile screen
 * because TWO screens open posts: your own profile and someone else's. Written
 * twice, they diverge; written here, it is the same rendering and the same actions
 * on both by design.
 *
 * The counts come from the message thread, not from a counter, see `engagement.ts`,
 * which explains why there cannot be a counter.
 *
 * **Photo enlargement is HERE, not a slot.** It was a prop once, and the prop was
 * optional: the two profile screens did not pass it, and in the profile a photo was
 * a dead image while in the feed it opened large. The `<img>` was in both places,  * the difference was not visible in the markup, it showed when you clicked it. A slot
 * you can forget is a slot someone forgets; a third screen opening posts gets this
 * without writing a line.
 *
 * **And when there are photos, they lead.** This used to open as a text card with
 * images hanging below: title, caption, then a strip of 203-pixel thumbnails inside
 * a 460-pixel sheet on a 1280-pixel screen. The photo was there and opened large on
 * the second click, but when you open a photo post you do not come to read, you
 * come to see. The stage becomes its own and the words move to the side, which is
 * the right order and happens to be Instagram's too.
 *
 * No photo at all: none of this applies. A text post does not gain an empty black
 * stage next to its words. Two renderings and the choice is the content, as it
 * already was between mosaic and list in `ProfileBody`.
 */
export function PostDetail({
  post,
  messages,
  me,
  directory,
  nameFor,
}: {
  post: ChatMessage
  /** The entire thread: votes and comments are summed from it. */
  messages: ChatMessage[]
  me: string | null
  directory: Map<string, Profile>
  nameFor: (sender: string) => string
}): React.JSX.Element {
  /**
   * The photo that is open large, if there is one.
   *
   * The bytes are the same ones already in the grid, the entire `MediaItem` passes
   * from one to the other. Nothing here fetches anything from anywhere, which is the
   * only way this works in a product where the image traveled encrypted inside the
   * message and the server never saw it.
   */
  const [zoom, setZoom] = useState<MediaItem | null>(null)
  /**
   * The photos, separated from the rest of the attachments.
   *
   * By the same function as chat and feed, and so by the same rule: `mediaType`
   * decides, never `kind`, because the vault dump throws `kind` away. See
   * `separarAnexos`.
   */
  const { imagens, ficheiros } = useMemo(() => separarAnexos(post.payload.media ?? []), [post.payload.media])
  /**
   * What is left of the post after photos go to the stage.
   *
   * `PostBody` renders what the post says, and renders any images it finds in
   * `media`. With a stage, they are already rendered there, and the way to say so
   * is to give it the post without them, rather than add a "do not render images"
   * prop that every other place would have to know to ignore. Files stay: a PDF
   * does not go to the stage.
   */
  const semAsFotografias = useMemo(
    () => ({ ...post.payload, media: ficheiros }),
    [post.payload, ficheiros],
  )
  const engagement = useMemo(() => engagementOf(messages, me), [messages, me])
  /**
   * And the poll tally, if this post is one.
   *
   * Counted from the same thread and by the same rules as the feed: a voter to
   * option table, never a counter. Here only this post matters, but the fold is
   * the same, having a second one, "cheaper because it is just one", was having
   * two counts waiting to disagree.
   */
  const apuramentos = useMemo(() => {
    const votacao = votacaoDe(post.payload)
    if (!votacao || !post.payload.id) return new Map<string, ReturnType<typeof apurar>>()
    const escolhas = votosDe(messages).get(post.payload.id)
    return new Map([[post.payload.id, apurar(escolhas, votacao.options.length, me)]])
  }, [messages, post.payload, me])
  const { vote, comment, deleteComment, votar } = usePostActions(engagement, apuramentos)

  /* No `onTagClick`: tags stay as text. There is no feed here to filter, and a
     button that does nothing is worse than a word. */
  /* Which post the attachments come from: to request them from other members when missing (S5). */
  const anexos = { channel: post.channel, alvo: post.payload.id ?? "", lista: post.payload.media ?? [] }
  const palavras = (
    <AnexosDoItem.Provider value={anexos}>
      <PostBody
        payload={imagens.length > 0 ? semAsFotografias : post.payload}
        onOpenImage={setZoom}
        apuramento={apuramentos.get(post.payload.id ?? "")}
        nameFor={nameFor}
        onVotar={(opcao) => votar(post, opcao)}
      />
    </AnexosDoItem.Provider>
  )

  const recebeu = (
    <PostEngagement
      engagement={engagement.get(post.payload.id ?? "") ?? NO_ENGAGEMENT}
      directory={directory}
      me={me}
      nameFor={nameFor}
      /* With the photo on stage, comments are open: there is a column next to it for
         them, and leaving it blank waiting for a click wastes the space we just
         gave it. In the feed they stay closed, there are thirty posts and a wall
         of text. */
      openByDefault={imagens.length > 0}
      onVote={(choice) => vote(post, choice)}
      onComment={(body) => comment(post, body)}
      onDeleteComment={(id) => deleteComment(post, id)}
    />
  )

  /* The same sheet as feed and chat. See `Lightbox`.

     Here it opens ON TOP of another sheet, which is the case neither of the other
     two had: in feed and chat there is no dialog below. That is why `Modal` got a
     stack, without it, Escape closing the photo would close the post too, and
     sometimes the profile behind it. */
  const ampliacao = zoom && <Lightbox item={zoom} onClose={() => setZoom(null)} />

  if (imagens.length === 0) {
    return (
      <>
        {palavras}
        {recebeu}
        {ampliacao}
      </>
    )
  }

  return (
    <>
      {/* Two named areas, and CSS decides if they sit side by side or stack. The order
          here is for keyboard or screen reader readers, and it is the same in both
          renderings: photo first, then what was said about it. On a phone it is
          literally that order on screen; on a wide screen the conversation moves
          right, where there is room for it.

          The `.sheet` wrapping this grows because of this class, see the
          `:has(.post-open)` in `overlays.css`. It could be a prop passed by the
          two profile screens, and it would be another slot you can forget: the same
          mistake the enlargement already made three paragraphs above. */}
      <div className="post-open">
        <div className="post-open-palco">
          <AnexosDoItem.Provider value={anexos}>
            <Carrossel media={imagens} onOpen={setZoom} />
          </AnexosDoItem.Provider>
        </div>
        <div className="post-open-lado">
          {palavras}
          {recebeu}
        </div>
      </div>
      {ampliacao}
    </>
  )
}

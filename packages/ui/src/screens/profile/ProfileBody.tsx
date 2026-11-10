import { useMemo, useState } from "react"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { DistintivoDeEmbaixador } from "../../components/DistintivoDeEmbaixador.js"
import { EmptyState } from "../../components/EmptyState.js"
import { BotaoCopiarId } from "../../components/BotaoCopiarId.js"
import { formatRelative, formatStamp, nomeEmFalta, postKindOf, type PostKind } from "../../lib/format.js"
import { strings } from "../../strings.js"
import { postTitleOf } from "../social/postTitle.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"

/*
  Function, not constant, and the reason is language: a label table built at
  the top of the module reads `strings` once, on load, and stayed with the
  startup language for the rest of the session. See `strings.captura.test.ts`.
*/
function tipos(): { kind: PostKind; label: string }[] {
  return [
    { kind: "fotos", label: strings.profile.kindPhotos },
    // Between the photos and the text: it looks most like the first and still
    // is not the second. Empty sections do not render, see the `groups` below -,
    // so someone who never posted a file gets no separator.
    { kind: "ficheiros", label: strings.profile.kindFiles },
    { kind: "texto", label: strings.profile.kindText },
    { kind: "links", label: strings.profile.kindLinks },
  ]
}

/**
 * The thumbnail of a row: the first image in the post and, if there is no
 * image, the one from the link card.
 *
 * The link thumbnail came inside the message, saved by whoever posted, no
 * request to the site here, neither in the list nor anywhere else. Bytes
 * dumped from the vault leave nothing: the row gets an empty square and the
 * name stays there, which is what matters in a list.
 */
function rowThumbOf(payload: ChatMessage["payload"]): string | undefined {
  const cover = payload.media?.find((item) => !item.evicted && (item.inline || item.url))
  if (cover) return cover.inline ?? cover.url
  return payload.links?.find((link) => link.thumbnail)?.thumbnail
}

/** What the row adds to the date: how many photographs, or what brings a link. */
function rowExtraOf(payload: ChatMessage["payload"]): string | null {
  const photos = payload.media?.length ?? 0
  if (photos > 0) return strings.profile.rowPhotos(photos)
  if ((payload.links?.length ?? 0) > 0) return strings.profile.rowLink
  return null
}

/**
 * A profile, whoever it belongs to: who the person is, and what they posted.
 *
 * Extracted from your own profile screen so another person's profile is
 * *the same design* and not a copy of it. The old comment said your own was
 * seen "as others see it" by design; now that is literal, because this file
 * draws both.
 *
 * **There is no editing here, and it is deliberate.** There is no prop or state
 * that calls the editor: the "Edit profile" button enters through the `action`
 * slot, which only your own screen fills. Another person's profile passes
 * nothing, and that is why there is no path to edit, it is not a condition
 * you can forget to write, it is an absence.
 */
export function ProfileBody({
  profile,
  address,
  posts,
  onOpenPost,
  labels,
  empty,
  note,
  action,
  depoisDaCabeca,
}: {
  /** Absent when nothing from this person reached this device. */
  profile: Profile | undefined
  address: string | null
  posts: ChatMessage[]
  onOpenPost: (post: ChatMessage) => void
  /** What changes between your own profile and another person's: just the words. */
  labels: { posts: string }
  empty: { title: string; body: string; action?: { label: string; onClick: () => void } | undefined }
  /** An honest note in the identity column, when there is something to flag. */
  note?: string | undefined
  /** Next to the name. See the paragraph on editing, above. */
  action?: React.ReactNode
  /**
   * Between the header and the posts. Only your own profile fills it (with
   * "Channels I founded"), by the same rule as `action`: another person's
   * page passes nothing, and so cannot show it.
   */
  depoisDaCabeca?: React.ReactNode
}): React.JSX.Element {
  const displayName = profile?.displayName || nomeEmFalta(address ?? undefined)

  return (
    <>
      <section className="profile-head">
        <span className="profile-avatar">
          {profile?.avatarDataUrl ? (
            <img src={profile.avatarDataUrl} alt="" />
          ) : (
            (profile?.displayName[0] ?? address?.[1] ?? "?").toUpperCase()
          )}
        </span>

        <div className="profile-facts">
          <div className="profile-name-row">
            <h2>
              <NomeDePessoa nome={displayName} endereco={address} />
              <DistintivoDeEmbaixador address={address} />
            </h2>
            {/* The id is not read: it is copied, next to the name. See `BotaoCopiarId`. */}
            {address && <BotaoCopiarId id={address} rotulo={strings.copiarId.de(displayName)} />}
            {action}
          </div>
          {/*
            The status is the line BELOW THE NAME, by the owner's decision on
            August 19, 2026.
            
            It was after the post count, and so it read as one more fact in
            the list. As it is now, it is the person's caption: whoever looks
            at the name catches the status in the same glance, which is what
            it exists to say. The count comes next, with the rest of the facts.
            It is the same order the account card and contact list already use.
            */}
          {profile?.statusText && <p className="profile-status">{profile.statusText}</p>}
          <p className="profile-count">
            <strong>{posts.length}</strong>{" "}
            {posts.length === 1 ? strings.profile.postSingular : strings.profile.postPlural}
          </p>
          {profile?.bio && <p className="profile-bio">{profile.bio}</p>}
          {profile?.email && <p className="profile-contact">{profile.email}</p>}
          {note && <p className="field-note">{note}</p>}
        </div>
      </section>

      {depoisDaCabeca}

      {posts.length === 0 ? (
        <EmptyState title={empty.title} body={empty.body} action={empty.action} />
      ) : (
        <PublicacoesDoPerfil posts={posts} onOpenPost={onOpenPost} rotulo={labels.posts} />
      )}
    </>
  )
}

/**
 * The posts in a profile, by type: photographs, files, text and links.
 *
 * Separated from the rest of the body so another person's page can use it in
 * the "Posts" tab, below their header. Your own profile reaches here through
 * `ProfileBody`, and both reads are the same design.
 *
 * The caller handles the entire empty case (no posts): here we only say that
 * one type is empty.
 */
export function PublicacoesDoPerfil({
  posts,
  onOpenPost,
  rotulo,
}: {
  posts: ChatMessage[]
  onOpenPost: (post: ChatMessage) => void
  /** The accessible name of the list: "Posts by Ana". */
  rotulo: string
}): React.JSX.Element {
  const byKind = useMemo(() => {
    const groups = new Map<PostKind, ChatMessage[]>()
    for (const post of posts) {
      const kind = postKindOf(post)
      groups.set(kind, [...(groups.get(kind) ?? []), post])
    }
    return groups
  }, [posts])

  /** Chosen tab, defaulting to the first kind that actually has content. */
  const [kind, setKind] = useState<PostKind | null>(null)
  const shownKind: PostKind =
    kind ?? tipos().find(({ kind: k }) => (byKind.get(k)?.length ?? 0) > 0)?.kind ?? "fotos"
  const shownPosts = byKind.get(shownKind) ?? []

  return (
    <>
      {/* By kind, not one pile: pictures, words and links read
          differently, and the counts say what kind of publisher you are. */}
      <div className="profile-kinds" role="tablist" aria-label={strings.profile.kindsLabel}>
        {tipos().map(({ kind, label }) => (
          <button
            key={kind}
            role="tab"
            aria-selected={kind === shownKind}
            className={kind === shownKind ? "chip on" : "chip"}
            onClick={() => setKind(kind)}
          >
            {label} <span className="kind-count">{byKind.get(kind)?.length ?? 0}</span>
          </button>
        ))}
      </div>

      {shownPosts.length === 0 ? (
        <EmptyState title={strings.profile.kindEmpty} body={strings.profile.kindEmptyBody} />
      ) : shownKind === "fotos" ? (
        /**
         * Photographs in a grid, and only them.
         *
         * Everything used to be here in a list, and the argument still holds
         * for what is not a photograph: a grid gave each post a square, and
         * the text ones were a bit of a word cut in half, pretending to be
         * an image. What was wrong was applying that answer to all, a
         * photograph in a grid is a photograph, and in a list is a forty-pixel
         * thumbnail next to a date.
         *
         * So the presentation is chosen by content: squares here, rows in the
         * other three sections. It is the same decision as always, with the
         * exception it was missing.
         *
         * `postKindOf` only puts posts here with at least one image, so the
         * square almost always has something to show. Almost: bytes may have
         * been dumped from the vault by the media budget, and in that case
         * the square gets the post name written on top instead of a hole.
         */
        <ul className="post-grid" aria-label={rotulo}>
          {shownPosts.map((post) => {
            const thumb = rowThumbOf(post.payload)
            const contagem = post.payload.media?.length ?? 0
            return (
              <li key={post.payload.id}>
                <button
                  type="button"
                  className="post-tile"
                  title={strings.profile.openPost}
                  onClick={() => onOpenPost(post)}
                >
                  {thumb ? (
                    <img src={thumb} alt="" loading="lazy" />
                  ) : (
                    <span className="post-tile-sem-imagem">{postTitleOf(post.payload)}</span>
                  )}
                  {/* Only from the second on: a "1" on top of each square would be noise in all
                      normal posts. */}
                  {contagem > 1 && (
                    <span className="post-tile-contagem" aria-hidden="true">
                      {contagem}
                    </span>
                  )}
                  <span className="sr-only">
                    {postTitleOf(post.payload)} · {formatStamp(post.payload.postedAt)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        /**
         * One row per post for anything that is not a photograph.
         *
         * Text, links and files are read by name and date, not by thumbnail:
         * the list gives all the same, and treats text as text instead of
         * forcing it to look like a photograph. The link thumbnail appears
         * when it exists, and came inside the message, no request to the site
         * here.
         */
        <ul className="post-list" aria-label={rotulo}>
          {shownPosts.map((post) => {
            const thumb = rowThumbOf(post.payload)
            const extra = rowExtraOf(post.payload)
            return (
              <li key={post.payload.id}>
                <button
                  type="button"
                  className="post-row"
                  title={strings.profile.openPost}
                  onClick={() => onOpenPost(post)}
                >
                  {thumb ? (
                    <img className="post-row-thumb" src={thumb} alt="" loading="lazy" />
                  ) : (
                    <span className="post-row-thumb empty" aria-hidden="true" />
                  )}
                  <span className="post-row-labels">
                    <span className="post-row-title">{postTitleOf(post.payload)}</span>
                    <span className="post-row-meta">
                      <time title={formatStamp(post.payload.postedAt)}>
                        {formatRelative(post.payload.postedAt)}
                      </time>
                      {extra && (
                        <>
                          <span className="sep">·</span>
                          <span>{extra}</span>
                        </>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

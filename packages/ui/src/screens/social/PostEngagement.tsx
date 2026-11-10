import { useState } from "react"
import type { Profile } from "../../bridge.js"
import { Avatar } from "../../components/Avatar.js"
import { Button } from "../../components/Button.js"
import { RichText } from "../../components/RichText.js"
import { useAtalhosDeFormatacao } from "../../hooks/useAtalhosDeFormatacao.js"
import { formatRelative, formatStamp } from "../../lib/format.js"
import { strings } from "../../strings.js"
import type { PostEngagement as Engagement, Vote } from "./engagement.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"

/**
 * The thumbs, drawn here and not in `icons.tsx`.
 *
 * They stay on the screen that uses them while the sidebar is being reworked
 * next to it; when the two changes meet, they move home in one line.
 */
function ThumbIcon({ size = 16, down }: { size?: number; down?: boolean }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={down ? { transform: "rotate(180deg)" } : undefined}
    >
      <path d="M7 21V10l5-7a2.2 2.2 0 0 1 2 2.4L13.2 9H19a2 2 0 0 1 2 2.4l-1.6 7.2A2.4 2.4 0 0 1 17 21Z" />
      <path d="M7 10H3v11h4" />
    </svg>
  )
}

/**
 * The trash icon, drawn here for the same reason as the thumbs: `icons.tsx` is
 * being redone next to it, and an icon added now would clash with that change
 * mid-way. Same 24-unit grid, same stroke weight, same `currentColor`, when the
 * two changes cross, it moves home in one line.
 */
function TrashIcon({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 6.5h16" />
      <path d="M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
      <path d="M6.4 6.5 7.3 19a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5l.9-12.5" />
    </svg>
  )
}

/**
 * What a post received: likes, dislikes and comments.
 *
 * The numbers are sums of messages this device has, not a total anyone guarantees,  * see `engagement.ts`. So there is no ranking by popularity here or anything like
 * it: the feed stays chronological, and a number that does not rank does not ask
 * to be trusted beyond what it knows.
 */
export function PostEngagement({
  engagement,
  directory,
  me,
  nameFor,
  openByDefault,
  onVote,
  onComment,
  onDeleteComment,
}: {
  engagement: Engagement
  directory: Map<string, Profile>
  /** Who I am, to know which comments I can delete. */
  me: string | null
  nameFor: (sender: string) => string
  /**
   * Comments already open, for those who have room for them.
   *
   * Closed is still the default, see `open` below. This exists for the post open
   * large, where there is an entire column next to the photo and nothing to put
   * there: there, closing comments hides content because of a rule made for the
   * opposite case.
   */
  openByDefault?: boolean | undefined
  /** Voting the same thumb twice retracts the vote, decided up here. */
  onVote: (vote: Vote) => void
  onComment: (body: string) => void
  onDeleteComment: (id: string) => void
}): React.JSX.Element {
  const [comment, setComment] = useState("")
  /**
   * The same shortcuts as chat and caption.
   *
   * A comment already rendered with formatting, it goes through `RichText` like
   * everything else, and without this it was the only place in the app where you
   * read it but could not write it. A rule that holds in two of three places is not
   * a rule: it is something you have to memorize.
   */
  const formatar = useAtalhosDeFormatacao(comment, setComment)
  // Closed by default: a feed with all boxes open is a wall of text. The number on
  // the button says if it is worth opening. Whoever has a column just for this opens
  // them from the start, see `openByDefault`.
  const [open, setOpen] = useState(openByDefault ?? false)
  const { up, down, mine, comments } = engagement

  return (
    <div className="post-engagement">
      <div className="post-votes">
        <button
          type="button"
          className={mine === "up" ? "vote on" : "vote"}
          aria-pressed={mine === "up"}
          aria-label={mine === "up" ? strings.social.likeUndo : strings.social.like}
          title={mine === "up" ? strings.social.likeUndo : strings.social.like}
          onClick={() => onVote("up")}
        >
          <ThumbIcon />
          <span className="vote-count">{up}</span>
        </button>
        <button
          type="button"
          className={mine === "down" ? "vote down on" : "vote down"}
          aria-pressed={mine === "down"}
          aria-label={mine === "down" ? strings.social.dislikeUndo : strings.social.dislike}
          title={mine === "down" ? strings.social.dislikeUndo : strings.social.dislike}
          onClick={() => onVote("down")}
        >
          <ThumbIcon down />
          <span className="vote-count">{down}</span>
        </button>
        <button
          type="button"
          className={open ? "vote wide on" : "vote wide"}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {strings.social.commentsToggle(comments.length)}
        </button>
      </div>

      {open && (
        <div className="post-comments">
          {comments.length === 0 ? (
            <p className="comments-empty">{strings.social.commentsEmpty}</p>
          ) : (
            <ul className="comment-list">
              {comments.map((entry) => (
                <li key={entry.id} className="comment">
                  <Avatar profile={directory.get(entry.sender)} fallback={entry.sender[1] ?? "?"} />
                  <div className="comment-body">
                    <span className="comment-who">
                      <span className="comment-name">
                        <NomeDePessoa nome={nameFor(entry.sender)} endereco={entry.sender} />
                      </span>
                      <time className="comment-when" title={formatStamp(entry.postedAt)}>
                        {formatRelative(entry.postedAt)}
                      </time>
                      {/* Only on ours. Showing it on theirs was promising an action any honest client
                          refuses. */}
                      {entry.sender === me && (
                        <button
                          type="button"
                          className="comment-delete"
                          title={strings.social.commentDelete}
                          aria-label={strings.social.commentDelete}
                          onClick={() => onDeleteComment(entry.id)}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </span>
                    <p className="comment-text">
                      <RichText>{entry.body}</RichText>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form
            className="comment-composer"
            onSubmit={(event) => {
              event.preventDefault()
              const body = comment.trim()
              if (!body) return
              onComment(body)
              setComment("")
            }}
          >
            <input
              value={comment}
              placeholder={strings.social.commentPlaceholder}
              maxLength={2200}
              autoComplete="off"
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={(event) => {
                formatar(event)
              }}
            />
            <Button type="submit" variant="primary" disabled={comment.trim().length === 0}>
              {strings.social.commentSend}
            </Button>
          </form>
        </div>
      )}
    </div>
  )
}

import type { ChatMessage } from "../../types.js"
import { strings } from "../../strings.js"

/**
 * How a post appears in a list.
 *
 * A list needs one line per post, and a line needs a name. The name is the
 * title when one exists; without a title, it is the first words of the caption,
 * cut at a word boundary to avoid leaving a dangling syllable.
 *
 * The cut happens here, not in what goes to the feed: trimming the opening
 * words is a presentation choice, and storing it elsewhere would mean keeping
 * two versions of the same text for them to diverge later.
 */

/** How many characters from the caption name a post without a title. */
export const TITLE_FROM_CAPTION_CHARS = 80

export function postTitleOf(
  payload: ChatMessage["payload"],
  limit: number = TITLE_FROM_CAPTION_CHARS,
): string {
  const given = payload.title?.trim()
  if (given) return given

  const caption = payload.caption?.replace(/\s+/g, " ").trim() ?? ""
  if (caption) {
    if (caption.length <= limit) return caption
    const cut = caption.slice(0, limit)
    // Cut at the last word boundary, unless it discards almost everything. In text
    // with no spaces, cutting mid-word beats a line with three letters.
    const space = cut.lastIndexOf(" ")
    return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
  }

  // With no words at all, the post is named by its type.
  if ((payload.media?.length ?? 0) > 0) return strings.social.untitledPhoto
  if ((payload.links?.length ?? 0) > 0) return strings.social.untitledLink
  return strings.social.untitled
}

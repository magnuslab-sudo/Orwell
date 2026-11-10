import { dobrarEnvolvimento, type PostEngagement } from "@enclave/client-core"
import type { ChatMessage } from "../../types.js"

/**
 * Likes, dislikes and comments, calculated from the message thread.
 *
 * There are no counters anywhere, not on the server, which reads nothing, nor
 * in the vault, which would have to keep them up to date. There are messages,
 * and the number comes from summing them here. The honest consequence is that
 * two devices with different histories show different numbers: someone who
 * joined the circle yesterday does not have the keys to votes from two days ago
 * and counts less. That is persistent secrecy working, and it is better than a
 * total only a server could guarantee.
 *
 * Who voted and who commented is always the sender authenticated by MLS, never
 * a field inside the payload, that is written by whoever sends.
 */

export { GOSTO, NAO_GOSTO, NO_ENGAGEMENT, type PostComment, type PostEngagement, type Vote } from "@enclave/client-core"

/**
 * The state of each post, indexed by its id.
 *
 * The fold lives in the core (`dobrarEnvolvimento`, in `dobras.ts`) from phase S1
 * of absolute sync: the screen and the sync summary must read the same one. One
 * vote per person per post: the timestamp of who voted wins, and the server order
 * (`seq`) breaks ties. A comment counts once per author and `id`, and only leaves
 * if the author deletes it.
 */
export function engagementOf(messages: ChatMessage[], me: string | null): Map<string, PostEngagement> {
  return dobrarEnvolvimento(messages, me)
}

/**
 * How many comments from other people on MY posts are unread.
 *
 * This is the number the Social badge shows, and it comes from here instead of a
 * second pass through the feed on purpose: `engagementOf` already unfolded the
 * same comment said twice, and already discarded the ones the author deleted. A
 * badge that counted on its own would say "1" on top of a card showing zero
 * comments, and anyone looking there would find nothing.
 *
 * **`marca` is the timestamp of who wrote it, never the arrival order, and that
 * is what tells a real number from a fake one.** `republishPosts` says the entire
 * feed again each time a new entry arrives, whoever joins cannot decipher
 * anything that was said before they joined the group, and posts come back
 * with the original `id` and `postedAt`. Counting by arrival would light the
 * badge every time someone accepted a friend request, with a number pulled from
 * conversations months old.
 *
 * My own posts arrive already folded (`feedOf`, filtered by sender): it is the
 * same list the profile draws, so a deleted post cannot keep bringing comments
 * attached to it waiting to be read.
 */
export function comentariosPorAtender(
  engagement: ReadonlyMap<string, PostEngagement>,
  minhas: readonly ChatMessage[],
  me: string | null,
  marca: number,
): number {
  if (!me) return 0
  let quantos = 0
  for (const post of minhas) {
    const id = post.payload.id
    if (!id) continue
    for (const comentario of engagement.get(id)?.comments ?? []) {
      // My own never count: nobody goes back to the feed to read what they just
      // wrote below what they had written before.
      if (comentario.sender === me) continue
      if (comentario.postedAt <= marca) continue
      quantos += 1
    }
  }
  return quantos
}

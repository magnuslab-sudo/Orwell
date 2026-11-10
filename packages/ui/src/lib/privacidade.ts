import type { QuemPodePedir } from "../hooks/usePrefs.js"

/**
 * Whether a friend request from `quem` fits the privacy rule of the person who
 * receives it ("Who can send me friend requests", stage 4).
 *
 * **This is a rule for the receiver, not a lock.** The request reaches the
 * core anyway, and the core keeps it: an altered client on the other side sends
 * what it wants, and the interface cannot stop it from arriving. What this decides is
 * whether the request APPEARS (in the bell and in Received) and whether it PLAYS. Changing the rule shows
 * the requests that were hidden, because they were never deleted.
 *
 * "Friends of friends" is someone the interface already knows from one of two sides:
 * they share a channel with us (they are members of a group channel where we are), or
 * they appear in the friends list that one of our friends shows (`shownFriendsOf`). There is
 * nothing else the interface knows, and the server knows nothing of friendships. Someone
 * on neither side does not fit. While that list has not been read yet (`conhecidos` null), they do not fit either: whoever chose to restrict
 * does not want to see the request appear and disappear on startup.
 */
export function pedidoCabe(regra: QuemPodePedir, quem: string, conhecidos: ReadonlySet<string> | null): boolean {
  if (regra === "todos") return true
  if (regra === "ninguem") return false
  return conhecidos?.has(quem) ?? false
}

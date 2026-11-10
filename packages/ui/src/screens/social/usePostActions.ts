import { useBridge } from "../../App.js"
import type { ChatMessage } from "../../types.js"
import { useToast } from "../../components/Toast.js"
import { useConfirmar } from "../../hooks/useConfirmar.js"
import { strings } from "../../strings.js"
import { GOSTO, NAO_GOSTO, type PostEngagement, type Vote } from "./engagement.js"
import type { Apuramento } from "../../lib/votacoes.js"

/**
 * Vote, comment, and delete a comment: the three actions a post accepts,
 * written once.
 *
 * They lived inside `Social`, which was the only place where a post showed up.
 * Now that the profile also opens posts, that "only place" no longer holds.
 * Copying the three functions there would guarantee they diverge one day: the
 * feed changes the thumb and the profile stacks two, or one confirms before
 * deleting and the other does not.
 *
 * The channel always comes from the post and never from the caller. A vote
 * travels to the feed of WHO POSTED, which is the only group where people who
 * read the post are; sending it to ours reaches no one. See `bridge.social`.
 */
export function usePostActions(
  engagement: Map<string, PostEngagement>,
  /**
   * The vote tallies, to know what to remove.
   *
   * Optional because whoever just draws thumbs does not need it, and making
   * them calculate a count they do not use is asking them to do pointless work.
   */
  apuramentos?: Map<string, Apuramento>,
): {
  vote: (post: ChatMessage, choice: Vote) => void
  comment: (post: ChatMessage, body: string) => void
  deleteComment: (post: ChatMessage, id: string) => void
  votar: (post: ChatMessage, opcao: number) => void
} {
  const bridge = useBridge()
  const toast = useToast()
  const confirmar = useConfirmar()

  /**
   * Clicking the thumb that is already selected removes the vote; clicking the
   * other one switches it, because only the most recent from each person counts.
   */
  const vote = (post: ChatMessage, choice: Vote): void => {
    const target = post.payload.id
    if (!target) return
    const mine = engagement.get(target)?.mine ?? null
    void bridge.social
      .react(post.channel, target, choice === "up" ? GOSTO : NAO_GOSTO, mine === choice)
      .catch(() => toast(strings.social.voteFailed, "error"))
  }

  const comment = (post: ChatMessage, body: string): void => {
    const target = post.payload.id
    if (!target) return
    void bridge.social.comment(post.channel, target, body).catch(() => toast(strings.social.commentFailed, "error"))
  }

  /**
   * Delete a comment of mine. It goes to the channel where it is, the feed of
   * who posted, and not to mine, which is what `remove` does with posts.
   */
  const deleteComment = (post: ChatMessage, id: string): void => {
    void confirmar({
      titulo: strings.social.commentDeleteTitle,
      corpo: strings.social.commentDeleteConfirm,
      verbo: strings.social.deleteAction,
      destructive: true,
    }).then((sim) => {
      if (!sim) return
      return bridge.social
        .removeComment(post.channel, id)
        .then(() => toast(strings.social.commentDeleted))
        .catch(() => toast(strings.social.commentDeleteFailed, "error"))
    })
  }

  /**
   * Vote on a poll in a post.
   *
   * Clicking the option that is already chosen removes the vote; clicking
   * another switches it, because only the most recent from each person counts.
   It is the same gesture as the thumbs, and it is on purpose: two different ways
   * to undo the same kind of choice were two things to learn.
   *
   * Without `bridge.votacoes` there is no vote, an older host does not know
   * how to record it. The card renderer does not offer the button in that case;
   * this guard exists for the code path, not for the screen.
   */
  const votar = (post: ChatMessage, opcao: number): void => {
    const target = post.payload.id
    if (!target) return
    const votacoes = bridge.votacoes
    if (!votacoes) return
    const minha = apuramentos?.get(target)?.minha ?? null
    void votacoes
      .votar(post.channel, target, opcao, minha === opcao)
      .catch(() => toast(strings.votacao.votoFalhou, "error"))
  }

  return { vote, comment, deleteComment, votar }
}

import type { ChatMessage } from "../types.js"
import { strings } from "../strings.js"

/**
 * The question and the options, as they travel. See `Poll` in the protocol.
 *
 * Repeated here and not imported from the protocol for the usual reason at
 * this layer: what comes from the server may have been written by a newer
 * version, and discounting what we do not know happens at read time. The
 * options are strings and nothing more, we do not even require two of them,
 * because whoever reads must handle what comes and not reject it.
 */
export interface Votacao {
  question: string
  options: string[]
}

/** What a vote received, already counted. */
export interface Apuramento {
  /** Who voted for each option, by address, in option order. */
  porOpcao: string[][]
  /** How many votes in total. Never more than the number of people who voted. */
  total: number
  /** This account's choice, or `null` if they have not voted yet. */
  minha: number | null
}

/**
 * The vote a message or post carries, if it carries a readable one.
 *
 * A vote with fewer than two options is not a vote: it is what remains from a
 * newer version the schema could not read, or from an altered client. Returns
 * `null` and the caller draws the text, which says the same thing in words.
 */
export function votacaoDe(payload: ChatMessage["payload"]): Votacao | null {
  const poll = payload.poll
  if (!poll || typeof poll.question !== "string" || poll.question === "") return null
  if (!Array.isArray(poll.options) || poll.options.length < 2) return null
  return { question: poll.question, options: poll.options.filter((opcao) => typeof opcao === "string") }
}

/**
 * The votes of each poll, by voter.
 *
 * **A table, never a counter.** This is the decision that decides if the count
 * is right, and it is not a matter of style. Votes arrive as events, and the
 * same event arrives more than once: from the vault and the network, from the
 * initial sync and the resend that makes a vote exist for people who joined
 * later. A number that increments on each event counts the same person twice;
 * a table from voter to option writes the same cell twice and stays the same.
 *
 * **A vote counted twice is worse than a vote lost.** A lost one is noticed,
 * a name is missing from the list of who voted, and a doubled one goes unseen:
 * you get a total no one knows is wrong. This same family of bug made posts
 * appear duplicated, and the cure was the same: index by what identifies
 * instead of summing what arrives.
 *
 * **Who voted is the sender authenticated by MLS**, never a field in the
 * payload, that field is written by whoever sends and so is worthless as proof.
 *
 * Each person's most recent vote is the one that counts, decided by the sender's
 * timestamp and not the arrival order: without this, fetching old history could
 * make a choice change on its own, because the older message arrived later and
 * won. Timestamp ties break by their order in the thread, the only order two
 * devices have in common. It is the rule that `engagementOf` already uses for
 * thumbs-ups, written here again because the two counts are disjoint by design.
 *
 * What stays out, and it is a choice: a reaction without `vote` is a thumbs-up
 * and does not go here, as a vote does not go in thumbs-ups. Both mechanisms
 * share the `t`, see `post.reaction` in the protocol, and cannot share the sum.
 */
export function votosDe(messages: ChatMessage[]): Map<string, Map<string, number>> {
  /** target → voter → { option chosen (or none), when } */
  const porAlvo = new Map<string, Map<string, { opcao: number | null; at: number }>>()

  for (const message of messages) {
    const { payload, sender } = message
    if (payload.t !== "post.reaction") continue
    if (!payload.target) continue
    // A reaction with no vote is a thumbs-up, and thumbs-ups are summed elsewhere.
    if (typeof payload.vote !== "number") continue

    const porPessoa = porAlvo.get(payload.target) ?? new Map<string, { opcao: number | null; at: number }>()
    const conhecido = porPessoa.get(sender)
    const at = payload.at ?? 0
    if (!conhecido || at >= conhecido.at) {
      porPessoa.set(sender, { opcao: payload.remove ? null : payload.vote, at })
    }
    porAlvo.set(payload.target, porPessoa)
  }

  const votos = new Map<string, Map<string, number>>()
  for (const [alvo, porPessoa] of porAlvo) {
    const escolhas = new Map<string, number>()
    for (const [quem, { opcao }] of porPessoa) if (opcao !== null) escolhas.set(quem, opcao)
    votos.set(alvo, escolhas)
  }
  return votos
}

/**
 * The votes of a poll, sorted by options THIS version knows.
 *
 * An index that does not fit the options is discounted here, and it is the
 * right place: the protocol schema does not know the vote's poll, and the
 * reader has the options in front. It comes from a newer version with more
 * options, or from an altered client; counting it in any option was worse than
 * not counting it.
 */
export function apurar(escolhas: Map<string, number> | undefined, opcoes: number, eu: string | null): Apuramento {
  const porOpcao: string[][] = Array.from({ length: opcoes }, () => [])
  let total = 0
  let minha: number | null = null
  for (const [quem, opcao] of escolhas ?? []) {
    if (opcao < 0 || opcao >= opcoes) continue
    porOpcao[opcao]?.push(quem)
    total += 1
    if (quem === eu) minha = opcao
  }
  return { porOpcao, total, minha }
}

/**
 * The vote written in full, to go in the message body or caption.
 *
 * **This is what saves the vote in a client that cannot draw it.** A vote
 * travels as an optional field, and an old client strips the field and shows
 * the text: without these lines, it would show an empty message. With them,
 * it reads the question and numbered options and can answer in words. It is
 * the same choice a channel invite makes, see `ChannelInvite` in the protocol.
 *
 * And it is also what goes into what you copy: copying the text of a line
 * gives the whole vote, not an empty string.
 */
export function corpoDaVotacao(votacao: Votacao): string {
  const linhas = votacao.options.map((opcao, indice) => strings.votacao.linhaDeOpcao(indice + 1, opcao))
  return [votacao.question, ...linhas].join("\n")
}

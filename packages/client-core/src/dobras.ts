/**
 * The folds of a channel's content, in one place (phase S1 of absolute sync,
 * `docs/planos/2026-10-20-sincronia-absoluta.md` §7).
 *
 * A fold reads a list of events and returns the state they create: the conversation with
 * edits, the wall, likes and comments, votes. Before they lived in the UI (`feedOf`,
 * `comEmendas`, `engagementOf`, `votosDe`) and each had its own ordering rule. Now the UI
 * and the core read the same ones. Two accounts with the same events must see the same state,
 * and the sync summary (S4) must measure what the screen shows.
 *
 * The rules, §7 of the plan:
 *
 * 1. Order is the SERVER's: the `seq` within the channel. One of our sends that does not
 *    yet have the echo `seq` (`-1`) comes after the largest `seq` seen when it left (`apos`,
 *    recorded in the send) or, without that mark, after the largest `seq` seen up to its
 *    position in the list.
 * 2. The sender is the authenticated MLS participant, never a payload field.
 * 3. An edit counts only if from the author. The latest by server order wins.
 * 4. A tombstone from the author is absorbing: after it, nothing about the target returns.
 *    A tombstone from someone with `moderar` (phase 3) is also absorbing, but does not remove
 *    the message: it hides the content and leaves the line, so you read "Message deleted by
 *    moderation" where it was.
 * 5. Timestamped state (votes, likes) wins by the author's timestamp, and server order breaks
 *    ties only among equal timestamps. A resend keeps the original timestamp, so it does not
 *    beat a newer change.
 *
 * Property test in `dobras.test.ts`: shuffling the input (keeping `seq`) always gives the
 * same output.
 */

/** The minimum a fold reads from an entry. Used by the vault and the UI. */
export interface EntradaDeDobra {
  seq: number
  sender: string
  /** The largest `seq` of the channel when this send of ours left. Only in sends without echo. */
  apos?: number | undefined
  channel?: string
  payload: { t: string }
}

/** Read a payload field without assuming its shape (the vault stores payloads raw). */
function campo(entrada: EntradaDeDobra, nome: string): unknown {
  return (entrada.payload as Record<string, unknown>)[nome]
}

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" ? valor : undefined
}

function numero(valor: unknown): number | undefined {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : undefined
}

// ------------------------------------------------------------------- ordem

/**
 * The sort key of each entry: the `seq`, or, in a send without echo, the largest
 * `seq` seen when it left.
 */
export function chavesDeOrdem(entradas: readonly EntradaDeDobra[]): number[] {
  let maior = -1
  return entradas.map((entrada) => {
    if (entrada.seq > maior) maior = entrada.seq
    if (entrada.seq >= 0) return entrada.seq
    return entrada.apos !== undefined && entrada.apos >= 0 ? entrada.apos : maior
  })
}

/**
 * The entries in server order, with our sends in the place they were said.
 *
 * Tiebreaker, in order: the key; an event with a real `seq` before a send of ours with
 * the same key (the send left AFTER seeing that `seq`); position in the list. Position is
 * the last word because it is the only thing two sends without a `seq` from the same device
 * have in common.
 */
export function porOrdemDoServidor<E extends EntradaDeDobra>(entradas: readonly E[]): E[] {
  const chaves = chavesDeOrdem(entradas)
  return entradas
    .map((entrada, indice) => ({ entrada, indice, chave: chaves[indice] ?? -1 }))
    .sort(
      (a, b) =>
        a.chave - b.chave ||
        (a.entrada.seq >= 0 ? 0 : 1) - (b.entrada.seq >= 0 ? 0 : 1) ||
        a.indice - b.indice,
    )
    .map((item) => item.entrada)
}

/**
 * Whether the proposal beats what is stored, in a timestamped record.
 *
 * A larger timestamp wins. On a tie, a larger server `seq` wins; an unknown `seq`
 * (`-1` or absent) loses to a known one; two unknowns give the win to the proposal, which is
 * what we always did (the most recent to arrive). Pure, so all the vault records (rooms,
 * categories, roles, assignments, banner) decide the same way.
 */
export function venceCarimbo(
  guardado: { at: number; seq?: number | undefined } | undefined,
  proposta: { at: number; seq?: number | undefined },
): boolean {
  if (!guardado) return true
  if (proposta.at !== guardado.at) return proposta.at > guardado.at
  const a = guardado.seq ?? -1
  const b = proposta.seq ?? -1
  if (a < 0 || b < 0) return b >= 0 || a < 0
  return b >= a
}

// ------------------------------------------------------------- emendas

/**
 * Who can delete other people's messages (the `moderar` power, phase 3).
 *
 * A question, not a list, like `podeAtender` for tickets: whoever answers it is `powersOf`,
 * which lives in the session and knows the channel foundation and roles. Absent means nobody,
 * which is what these folds always did.
 */
export interface OpcoesDaConversa {
  modera?: ((sender: string) => boolean) | undefined
}

/** The edits (`edit`, `redact`) of each target, already judged: author only, by server order. */
function emendasDe(
  ordenadas: readonly EntradaDeDobra[],
  autorDe: (alvo: string) => string | undefined,
  modera?: (sender: string) => boolean,
): {
  apagadas: Set<string>
  moderadas: Set<string>
  edicoes: Map<string, { body: string; editedAt: number }>
} {
  const apagadas = new Set<string>()
  const moderadas = new Set<string>()
  const edicoes = new Map<string, { body: string; editedAt: number }>()
  for (const entrada of ordenadas) {
    const t = entrada.payload.t
    if (t !== "edit" && t !== "redact") continue
    const alvo = texto(campo(entrada, "target"))
    if (!alvo) continue
    const autor = autorDe(alvo)
    /*
      The tombstone of who moderates, on the message of ANOTHER person.

      Judged against the MLS-authenticated sender, like everything here, and against
      the roles this device knows NOW: whoever loses the power loses the tombstones they
      left, and messages return. This is the same reading the ticket board applies to
      `atender`, and the cost is the same: two devices with different roles see different
      things, and neither is wrong.

      Without an original there is nothing to hide, and the tombstone waits for it, like
      the author's: the message can arrive later, through recovered history.
    */
    if (t === "redact" && autor !== undefined && autor !== entrada.sender && modera?.(entrada.sender)) {
      moderadas.add(alvo)
      continue
    }
    // Without an original, there is nothing to edit; and you do not edit someone else's work.
    if (autor !== entrada.sender) continue
    if (t === "redact") {
      apagadas.add(alvo)
      continue
    }
    // Server order wins for the last one; two sends from us without `seq` follow
    // the order they left in (see `porOrdemDoServidor`).
    edicoes.set(alvo, { body: texto(campo(entrada, "body")) ?? "", editedAt: numero(campo(entrada, "editedAt")) ?? 0 })
  }
  return { apagadas, moderadas, edicoes }
}

/**
 * What remains of a message deleted by moderation: the row, without content.
 *
 * Text, attachments, cards, mentions and votes go away. Everything else stays
 * (room, `id`, date, ticket mark), so the row stays in place and the ticket
 * board keeps counting what it counted. `moderada` is the mark the interface
 * reads to write "Message deleted by moderation".
 *
 * Text stays in each member's vault, encrypted as always: this is what every
 * honest app shows, not an erasure. A modified app shows everything.
 */
function semConteudo<E extends EntradaDeDobra>(dita: E): E {
  const { poll: _votacao, editedAt: _editada, ...resto } = dita.payload as Record<string, unknown>
  return {
    ...dita,
    payload: { ...resto, body: "", attachments: [], links: [], mentions: [], moderada: true } as unknown as E["payload"],
  }
}

/**
 * The conversation with the author's own edits applied.
 *
 * Returns only the `message`, in the order they arrived (the interface sorts the
 * timeline itself). An edited message stays in the same place. A message deleted
 * by the author goes away. One deleted by moderation stays, without content
 * (`semConteudo`).
 */
export function dobrarConversa<E extends EntradaDeDobra>(entradas: readonly E[], opcoes: OpcoesDaConversa = {}): E[] {
  const ditas = entradas.filter((entrada) => entrada.payload.t === "message")
  const autor = new Map<string, string>()
  for (const dita of ditas) {
    const id = texto(campo(dita, "id"))
    if (id && !autor.has(id)) autor.set(id, dita.sender)
  }
  const { apagadas, moderadas, edicoes } = emendasDe(
    porOrdemDoServidor(entradas),
    (alvo) => autor.get(alvo),
    opcoes.modera,
  )
  return ditas
    .filter((dita) => !apagadas.has(texto(campo(dita, "id")) ?? ""))
    .map((dita) => {
      // Moderation beats editing: what was hidden does not come back if the author
      // rewrites it. It is the same rule as the author's tombstone, which is absorptive.
      if (moderadas.has(texto(campo(dita, "id")) ?? "")) return semConteudo(dita)
      const edicao = edicoes.get(texto(campo(dita, "id")) ?? "")
      if (!edicao) return dita
      return { ...dita, payload: { ...dita.payload, body: edicao.body, editedAt: edicao.editedAt } }
    })
}

// ------------------------------------------------------------------ mural

/** Tags in a text: `#palavra`, no duplicates, up to thirty. */
export function etiquetasDe(text: string): string[] {
  return [...new Set([...text.matchAll(/#([\p{L}\p{N}_]{1,32})/gu)].map((match) => match[1] as string))].slice(0, 30)
}

function temAnexos(entrada: EntradaDeDobra): boolean {
  const media = campo(entrada, "media")
  const links = campo(entrada, "links")
  return (Array.isArray(media) && media.length > 0) || (Array.isArray(links) && links.length > 0)
}

/**
 * A post by `id` and author, no matter how many times it was said.
 *
 * The first one stays. The exception is photos: the vault dumps old media, and
 * a repost can bring images that the stored copy has already lost. When the
 * stored one is empty and the next one has something, the next one stays.
 */
function colapsarCopias<E extends EntradaDeDobra>(posts: readonly E[]): E[] {
  const porChave = new Map<string, E>()
  for (const post of posts) {
    const chave = `${post.sender} ${texto(campo(post, "id")) ?? ""}`
    const guardada = porChave.get(chave)
    if (!guardada) {
      porChave.set(chave, post)
      continue
    }
    if (temAnexos(guardada) || !temAnexos(post)) continue
    porChave.set(chave, post)
  }
  return [...porChave.values()]
}

/**
 * The feed: posts, most recent first, with the author's edits.
 *
 * `donoDoFeed(canal)` tells who owns each channel's feed, or `null` if the
 * channel is not a feed. A post counts only in the author's feed: followers of
 * someone have a place in their feed and can write there, but cannot post in the
 * owner's name.
 *
 * The final order is by the author's `postedAt`, and a post's place does not
 * change with an edit: boosting what you edit was a sign of highlight.
 */
export function dobrarMural<E extends EntradaDeDobra>(entradas: readonly E[], donoDoFeed: (canal: string) => string | null): E[] {
  const posts = colapsarCopias(
    entradas.filter(
      (entrada) =>
        entrada.payload.t === "post" &&
        entrada.channel !== undefined &&
        donoDoFeed(entrada.channel) === entrada.sender,
    ),
  )
  const autor = new Map<string, string>()
  for (const post of posts) {
    const id = texto(campo(post, "id"))
    if (id && !autor.has(id)) autor.set(id, post.sender)
  }
  const { apagadas, edicoes } = emendasDe(porOrdemDoServidor(entradas), (alvo) => autor.get(alvo))
  return posts
    .filter((post) => !apagadas.has(texto(campo(post, "id")) ?? ""))
    .map((post) => {
      const edicao = edicoes.get(texto(campo(post, "id")) ?? "")
      if (!edicao) return post
      return {
        ...post,
        payload: { ...post.payload, caption: edicao.body, tags: etiquetasDe(edicao.body), editedAt: edicao.editedAt },
      }
    })
    .sort((a, b) => (numero(campo(b, "postedAt")) ?? 0) - (numero(campo(a, "postedAt")) ?? 0))
}

// ----------------------------------------------------- likes and comments

/** The only two votes that exist. Thumbs up, thumbs down. */
export const GOSTO = "👍"
export const NAO_GOSTO = "👎"

export type Vote = "up" | "down"

export interface PostComment {
  id: string
  sender: string
  body: string
  postedAt: number
}

export interface PostEngagement {
  up: number
  down: number
  /** This account's vote, so the thumb shows loaded. */
  mine: Vote | null
  comments: PostComment[]
}

export const NO_ENGAGEMENT: PostEngagement = { up: 0, down: 0, mine: null, comments: [] }

function voteOf(emoji: unknown): Vote | null {
  if (emoji === GOSTO) return "up"
  if (emoji === NAO_GOSTO) return "down"
  return null
}

/**
 * Likes, dislikes and comments on each post, by its `id`.
 *
 * One vote per person per post: the higher timestamp of the voter wins, and
 * server order breaks ties. A comment counts once per author and `id`. A comment
 * only goes away if the author deletes it, and the tombstone holds even if it
 * arrives before the comment.
 *
 * A poll vote (numeric `vote`) is not a thumbs vote: it counts in `dobrarVotos`.
 */
export function dobrarEnvolvimento(entradas: readonly EntradaDeDobra[], me: string | null): Map<string, PostEngagement> {
  const ordenadas = porOrdemDoServidor(entradas)
  /** target → author → { vote, when } */
  const votes = new Map<string, Map<string, { vote: Vote | null; at: number }>>()
  const comments = new Map<string, PostComment[]>()
  /** comment id → who asked to delete it. */
  const redactedBy = new Map<string, Set<string>>()
  const vistos = new Set<string>()

  for (const entrada of ordenadas) {
    const { sender } = entrada
    const t = entrada.payload.t
    const target = texto(campo(entrada, "target"))
    if (!target) continue

    if (t === "redact") {
      const askers = redactedBy.get(target) ?? new Set<string>()
      askers.add(sender)
      redactedBy.set(target, askers)
      continue
    }

    if (t === "post.reaction") {
      if (typeof campo(entrada, "vote") === "number") continue
      const remove = campo(entrada, "remove") === true
      const vote = remove ? null : voteOf(campo(entrada, "emoji"))
      // An emoji that is not a thumbs vote is not a vote.
      if (vote === null && !remove) continue
      const perPerson = votes.get(target) ?? new Map<string, { vote: Vote | null; at: number }>()
      const known = perPerson.get(sender)
      const at = numero(campo(entrada, "at")) ?? 0
      // Server order: at the same timestamp, the one that arrives later wins.
      if (!known || at >= known.at) perPerson.set(sender, { vote, at })
      votes.set(target, perPerson)
      continue
    }

    if (t === "post.comment") {
      const id = texto(campo(entrada, "id"))
      const body = texto(campo(entrada, "body"))
      if (!id || body === undefined) continue
      // The same comment twice (vault and network, or resend) is one.
      // By author too: the same `id` from another person is a different comment.
      const chave = `${sender} ${id}`
      if (vistos.has(chave)) continue
      vistos.add(chave)
      const list = comments.get(target) ?? []
      list.push({ id, sender, body, postedAt: numero(campo(entrada, "postedAt")) ?? 0 })
      comments.set(target, list)
    }
  }

  const byPost = new Map<string, PostEngagement>()
  for (const [target, perPerson] of votes) {
    let up = 0
    let down = 0
    let mine: Vote | null = null
    for (const [address, { vote }] of perPerson) {
      if (vote === "up") up += 1
      if (vote === "down") down += 1
      if (address === me) mine = vote
    }
    byPost.set(target, { up, down, mine, comments: [] })
  }
  for (const [target, list] of comments) {
    const kept = list.filter((entry) => !redactedBy.get(entry.id)?.has(entry.sender))
    const current = byPost.get(target) ?? { up: 0, down: 0, mine: null, comments: [] }
    // In write order, like a conversation. The timestamp is from who wrote it.
    byPost.set(target, { ...current, comments: kept.sort((a, b) => a.postedAt - b.postedAt) })
  }
  return byPost
}

/**
 * Votes in each poll: target → voter → option.
 *
 * Same rule as thumbs: the voter's higher timestamp wins, and server order
 * breaks ties. Removing the vote (`remove`) leaves the person with no choice.
 */
export function dobrarVotos(entradas: readonly EntradaDeDobra[]): Map<string, Map<string, number>> {
  const porAlvo = new Map<string, Map<string, { opcao: number | null; at: number }>>()
  for (const entrada of porOrdemDoServidor(entradas)) {
    if (entrada.payload.t !== "post.reaction") continue
    const alvo = texto(campo(entrada, "target"))
    const vote = numero(campo(entrada, "vote"))
    if (!alvo || vote === undefined) continue
    const porPessoa = porAlvo.get(alvo) ?? new Map<string, { opcao: number | null; at: number }>()
    const conhecido = porPessoa.get(entrada.sender)
    const at = numero(campo(entrada, "at")) ?? 0
    if (!conhecido || at >= conhecido.at) {
      porPessoa.set(entrada.sender, { opcao: campo(entrada, "remove") === true ? null : vote, at })
    }
    porAlvo.set(alvo, porPessoa)
  }
  const votos = new Map<string, Map<string, number>>()
  for (const [alvo, porPessoa] of porAlvo) {
    const escolhas = new Map<string, number>()
    for (const [quem, { opcao }] of porPessoa) if (opcao !== null) escolhas.set(quem, opcao)
    votos.set(alvo, escolhas)
  }
  return votos
}

// ---------------------------------------------------- identity and key

/**
 * Event key to prevent storing it twice: `tipo|autor|id`.
 *
 * Only for events with `id`. Events without `id` (profile, roles, rooms) have
 * their own vault record and don't go through here. The author is in the key
 * on purpose: the `id` comes from the sender, and without the author a member
 * could hide another person's message by publishing first with their `id`.
 */
export function chaveDoEvento(entrada: { sender: string; payload: { t: string } }): string | null {
  const id = (entrada.payload as Record<string, unknown>)["id"]
  if (typeof id !== "string" || id === "") return null
  return `${entrada.payload.t}|${entrada.sender}|${id}`
}

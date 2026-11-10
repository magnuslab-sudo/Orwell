import { dobrarConversa, dobrarMural, etiquetasDe, type OpcoesDaConversa } from "@enclave/client-core"
import type { ConnectionState, Profile } from "../bridge.js"
import type { ChatMessage } from "../types.js"
import { eImagem } from "./ficheiros.js"
import { canalDoMuralNaInterface, fichaNaInterface, tipoNaInterface } from "./tipoDoCanal.js"
import { strings } from "../strings.js"

/**
 * Posts, newest first, with edits and deletions folded in. Time is the only
 * ordering rule the app applies-a post keeps its original place even after
 * an edit, because bumping edited posts would be a ranking signal.
 *
 * An edit or redaction only counts when it comes from the post's own author
 * (the authenticated sender, never a field in the payload): any member of a
 * feed channel can *send* the payload, but no one gets to rewrite someone
 * else's words. The last edit in server order (`seq`) wins; the new caption's
 * #tags replace the old ones, exactly as they would on a fresh post.
 *
 * The fold lives in the core (`dobrarMural`, in `dobras.ts`) since phase S1 of
 * absolute sync: the screen and the sync summary read the same.
 *
 * A post only counts in the feed it was signed for: it must arrive on a feed
 * channel, and the sender must be that feed's owner. Following someone seats
 * you in their feed and lets you write there-that is how comments reach
 * them-so without this check anyone you follow could put a post of their own
 * in your feed, and it would show up for every one of your followers. The
 * sender is authenticated either way, so this was never forged authorship; it
 * was writing in someone else's house. The server cannot enforce this: it
 * relays ciphertext and cannot tell a post from a comment.
 *
 * **The same post stated twice is one post.** The wall is restated on each new
 * feed entry (`republishPosts`, in the core), because everything published
 * before someone joined the group will never be readable by them. The
 * republish travels with the original `id` and `postedAt`, and it is here-the
 * only place that knows what goes on screen-that copies become one again. It
 * is not a housekeeping detail: without it the owner would see each post twice,
 * and React's list would get two equal `key` for the same card.
 */
export function feedOf(messages: ChatMessage[]): ChatMessage[] {
  return dobrarMural(messages, (channel) => (isFeed(channel) ? feedOwnerOf(channel) : null))
}

/**
 * Messages in a conversation, with edits from the author applied.
 *
 * The fold lives in the core (`dobrarConversa`, in `dobras.ts`), from phase S1 of
 * absolute sync. Only from the author, and the author is the sender authenticated
 * by MLS, never a payload field. The last edit by server order wins. An edited
 * message stays in the SAME place in the conversation.
 *
 * Delete is a request, not a deletion. The message leaves here and leaves the
 * screen of whoever fulfills the request; those who already read it, read it, and
 * a modified client can simply ignore it. The interface says this in words before
 * anyone taps it.
 *
 * `modera` is the question of phase 3: who can delete other people's messages.
 * With it, that person's tombstone stays in line with no content, marked
 * `moderada`. Without it, only the author's tombstones count.
 */
export function comEmendas(messages: ChatMessage[], opcoes: OpcoesDaConversa = {}): ChatMessage[] {
  return dobrarConversa(messages, opcoes)
}

export function donationsOf(profile: Profile | undefined): { kind: string; label: string; value: string }[] {
  return (profile?.donations ?? []).filter((entry) => entry.value.trim().length > 0)
}

/** Tags live in the payload, so the client extracts them once, on device. */
export function extractTags(text: string): string[] {
  return etiquetasDe(text)
}

/** Only the posts carrying a given tag; `null` means no filter at all. */
export function filterByTag(posts: ChatMessage[], tag: string | null): ChatMessage[] {
  if (!tag) return posts
  return posts.filter((post) => post.payload.tags?.includes(tag) ?? false)
}

/** What kind of post this is, for the profile's by-type sections: an image
 * post is "fotos" even when captioned; a link card without media is
 * "links"; words alone are "texto". */
export type PostKind = "fotos" | "texto" | "links" | "ficheiros"

export function postKindOf(post: ChatMessage): PostKind {
  const media = post.payload.media ?? []
  /**
   * A PHOTO is a photo; a PDF is not.
   *
   * This used to be `media.length > 0 → "fotos"`, and with file attachments it
   * started lying: a post that was only a document appeared in the photos section
   * and vanished from view for whoever went looking for it. ONE image is enough
   * for the post to be photos, that is what the eye sees first, and a PDF
   * hanging next to a photograph does not change what the post is.
   *
   * The question "is this an image?" is the same one the conversation asks, and
   * it is the same function, `eImagem`, which decides by `mediaType` and never
   * by `kind`, because vault dump throws out `kind` and an old post would change
   * sections as it aged.
   */
  if (media.some(eImagem)) return "fotos"
  if (media.length > 0) return "ficheiros"
  if ((post.payload.links?.length ?? 0) > 0) return "links"
  return "texto"
}

/** A person's own feed channel is plumbing; it never appears in the sidebar. */
export function isFeed(channel: string): boolean {
  return tipoNaInterface(channel) === "mural"
}

/**
 * Someone's wall, by the channel record (1.0 "Arca", slice 3).
 *
 * Until 0.9 it was derived from the address (`!feed-<id>`). With opaque address
 * (D1) only those who received the owner's secret know it, and the interface asks
 * the channel records the bridge gave it: the wall-type channel with this owner.
 * Empty when there is none: a wall we do not have (yet) is in no channel, and
 * the caller compares with the list of channels.
 */
export function feedChannelOf(address: string): string {
  return canalDoMuralNaInterface(address) ?? ""
}

/**
 * The owner of a wall, by the channel record (`lib/tipoDoCanal.ts`). Empty when
 * the channel is not a wall, or when the record does not know the owner: the
 * caller already asked `isFeed` first.
 */
export function feedOwnerOf(channel: string): string {
  const ficha = fichaNaInterface(channel)
  return ficha.tipo === "mural" ? (ficha.dono ?? "") : ""
}

/** A direct channel between exactly two people, named after the sorted pair. */
export function isDirect(channel: string): boolean {
  return tipoNaInterface(channel) === "directa"
}

/**
 * Is someone administering someone else in this channel?
 *
 * **In a two-person conversation there is not.** Both can do everything there is
 * to do, and "make administrator" means nothing: there are no third parties to
 * moderate, no one to expel, and naming the other person gives them nothing they
 * do not already have. Offering the gesture was worse than useless, it taught
 * that a private conversation has hierarchy, and the first person to try it would
 * think they had just given someone power over them.
 *
 * Not in a feed either, and for a similar reason: a feed is conduit, not place.
 * It has no members to govern or roles to hand out.
 *
 * Pure and in one place only, because this is decided on three sides, the
 * person's menu, the roles section inside the profile, and whoever assembles the
 * two. Three copies of the same rule would diverge at the first reorganization,
 * which is exactly when no one is looking at this line.
 *
 * **This is what is OFFERED, not refusal.** Real refusal lives in the core, which
 * trusts no screen: hiding a box does not stop anyone from calling the bridge.
 */
export function admiteAdministracao(channel: string | null): boolean {
  return channel !== null && !isDirect(channel) && !isFeed(channel)
}

/**
 * The other person in a direct channel, reconstructed from its name: the id
 * carries both account ids, and the one that is not mine is theirs. Null for
 * anything that is not a DM — or a DM I am somehow not part of.
 */
/**
 * A new channel that does not yet know how to announce itself, so it waits.
 *
 * A direct conversation announces itself by the NAME of who is on the other side,
 * and that comes from `dmPeerAddress`, which needs our own address to know which
 * of the two sides is the other. The channel list arrives before that address is
 * set, with the app closed when the friend request came in, it always does, and
 * without it the direct was announced as if it were a channel: "You were added to
 * #Ana", because of a friend request.
 *
 * Two things broke, and the second is worse. The sentence lies about the nature
 * of the thing; and the wrong type escapes the rule that exists to prevent two
 * notifications of the same event, which only knows how to silence a `dm-new`
 * when there is already a `friend-request` from the same channel. Both arrived.
 *
 * True means WAIT, not discard: the channel stays out of what is marked seen and
 * is reconsidered when the address arrives. Discard would silence the
 * notification forever, which is swapping a lie for silence.
 */
export function directaPorResolver(channel: string, peer: string | null): boolean {
  return isDirect(channel) && peer === null
}

export function dmPeerAddress(channel: string, me: string | null): string | null {
  if (!me) return null
  // The pair comes from the channel record (`lib/tipoDoCanal.ts`), not from the name.
  const ficha = fichaNaInterface(channel)
  if (ficha.tipo !== "directa" || !ficha.par || ficha.par === me) return null
  return ficha.par
}

export interface FriendRequest {
  sender: string
  channel: string
  sentAt: number
  note?: string | undefined
}

/**
 * Open friend requests, derived from the timeline rather than kept as state:
 * a request from someone else stands until my own `friend.accept` lands in
 * the same channel after it. One per person — the newest ask wins.
 */
export function friendRequestsOf(messages: ChatMessage[], me: string | null): FriendRequest[] {
  const accepted = new Map<string, number>()
  for (const message of messages) {
    if (message.payload.t === "friend.accept" && message.sender === me) {
      const at = message.payload.acceptedAt ?? 0
      accepted.set(message.channel, Math.max(accepted.get(message.channel) ?? 0, at))
    }
  }

  const open = new Map<string, FriendRequest>()
  for (const message of messages) {
    if (message.payload.t !== "friend.request" || message.sender === me || !me) continue
    const sentAt = message.payload.sentAt ?? 0
    if (sentAt <= (accepted.get(message.channel) ?? 0)) continue
    const known = open.get(message.sender)
    if (!known || sentAt > known.sentAt) {
      open.set(message.sender, { sender: message.sender, channel: message.channel, sentAt, note: message.payload.note })
    }
  }
  return [...open.values()].sort((a, b) => b.sentAt - a.sentAt)
}

/**
 * Everyone who should be reading my feed by now, judged from the timeline:
 * people whose requests I accepted, and people who accepted mine (mutual
 * friendship owes them a follow-back). The shell checks this against the
 * feed's real member list on unlock and quietly re-invites the missing —
 * which heals friendships made before mutuality shipped, or accepted while
 * one side was offline.
 */
export function owedFollowersOf(messages: ChatMessage[], me: string | null): Set<string> {
  const owed = new Set<string>()
  if (!me) return owed

  const requestersByChannel = new Map<string, Set<string>>()
  for (const message of messages) {
    if (message.payload.t !== "friend.request" || message.sender === me) continue
    const set = requestersByChannel.get(message.channel) ?? new Set<string>()
    set.add(message.sender)
    requestersByChannel.set(message.channel, set)
  }

  for (const message of messages) {
    if (message.payload.t !== "friend.accept") continue
    if (message.sender !== me) {
      owed.add(message.sender)
    } else {
      for (const requester of requestersByChannel.get(message.channel) ?? []) owed.add(requester)
    }
  }
  return owed
}

/**
 * The circle, judged by cryptographic fact rather than remembered events.
 *
 * Either direction counts: a feed of theirs on this device, or a seat of
 * theirs in mine. Deriving friendship from friend.accept messages alone put
 * real friends in "Outras pessoas" the moment that history aged out of
 * memory — the relationship outlives the announcement of it.
 */
export function friendsOf(channels: string[], myFeedMembers: string[], me: string | null): Set<string> {
  const friends = lugaresDeFeedTrocados(channels, myFeedMembers, me)
  if (!me) return friends
  // A private channel between exactly two people is a relationship by
  // construction; nobody opens one with a stranger by accident.
  for (const channel of channels) {
    const peer = dmPeerAddress(channel, me)
    if (peer) friends.add(peer)
  }
  return friends
}

/**
 * Only the cryptographic fact: who did this device exchange feed slots with.
 *
 * The HARD half of `friendsOf`, separated from it so it can be asked alone. The
 * other half, the direct conversation counting as a relationship, matters for
 * drawing the circle and does not matter for deciding who can write to whom: a
 * friend request opens the direct conversation BEFORE there is any friendship
 * (see `requestFriend`), so by that standard everyone you ask is already a
 * friend, and whoever refuses stays one.
 *
 * Here only the two facts enter that require a signed MLS commit: a feed from
 * this person that this device has, or a place of theirs in mine. Neither
 * happens without acceptance, and that is why they serve as long memory of a
 * friendship whose `friend.accept` already left the list of messages in hand.
 */
export function lugaresDeFeedTrocados(
  channels: string[],
  myFeedMembers: string[],
  me: string | null,
): Set<string> {
  const circulo = new Set<string>()
  if (!me) return circulo
  for (const channel of channels) {
    if (!isFeed(channel)) continue
    const owner = feedOwnerOf(channel)
    if (owner !== me) circulo.add(owner)
  }
  for (const member of myFeedMembers) if (member !== me) circulo.add(member)
  return circulo
}


/**
 * When this device last saw each person do anything — post, message, edit.
 * Deliberately derived and local: there is no presence beacon to subscribe
 * to, because a server that broadcasts who is online is an activity log.
 */
/**
 * The dot a person wears, from what is actually known about them.
 *
 * Two independent facts: whether the server says they are connected, and the
 * activity they published. Busy is a choice and outranks the connection —
 * someone busy is still there. An invisible person is simply not announced,
 * so they arrive here as "not connected" and read as offline, which is the
 * whole point of the setting.
 */
export function presenceKindOf(
  online: boolean,
  activity: "online" | "ocupado" | "ausente" | undefined,
): "active" | "away" | "busy" | "idle" {
  if (!online) return "idle"
  if (activity === "ausente") return "away"
  return activity === "ocupado" ? "busy" : "active"
}

/**
 * Your own dot, which can never come from the presence map.
 *
 * The gateway announces people to their channel-mates — nobody is announced
 * to themselves — so looking yourself up in that map always returned nothing
 * and painted you offline while everyone else showed green. Yours is derived
 * from the two things this device knows for certain: whether the socket is up
 * and what you chose to appear as. Grey-when-invisible is the one honest case
 * of seeing yourself offline, and it is labelled so it cannot be misread.
 */
export function selfPresenceOf(
  connection: ConnectionState,
  activity: "online" | "ocupado" | "ausente" | "invisivel",
): "active" | "away" | "busy" | "idle" {
  if (connection !== "online") return "idle"
  if (activity === "ocupado") return "busy"
  if (activity === "ausente") return "away"
  if (activity === "invisivel") return "idle"
  return "active"
}

/** Ten minutes of local silence turns the dot grey. Local, not a radar. */
export const PRESENCE_WINDOW_MS = 10 * 60_000

export function presenceOf(
  lastActivity: Map<string, number>,
  address: string,
  now: number = Date.now(),
): "active" | "idle" {
  return now - (lastActivity.get(address) ?? 0) < PRESENCE_WINDOW_MS ? "active" : "idle"
}

/**
 * The time of a payload, whatever it is.
 *
 * Each type carries its own with a name of its own, `sentAt` in a message,
 * `postedAt` in a post, `editedAt` in an edit, and whoever orders a mixed list
 * needs to treat them as one. Pulled from `lastActivityOf`, which had it written
 * by hand: two copies of this list would diverge the day a new payload brought
 * another name.
 */
export function stampOf(payload: ChatMessage["payload"]): number {
  return payload.sentAt ?? payload.postedAt ?? payload.editedAt ?? payload.redactedAt ?? payload.acceptedAt ?? 0
}

export function lastActivityOf(messages: ChatMessage[]): Map<string, number> {
  const seen = new Map<string, number>()
  for (const message of messages) {
    const at = stampOf(message.payload)
    if (at > (seen.get(message.sender) ?? 0)) seen.set(message.sender, at)
  }
  return seen
}

export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "canal"
  )
}

export function serverOf(address: string | null): string {
  return address?.slice(address.indexOf(":") + 1) ?? "localhost:8448"
}

export function shortName(channel: string): string {
  return channel.replace(/^!/, "").split(":")[0] ?? channel
}

/**
 * An address shortened to what is said of it aloud: the first word.
 *
 * `@milsinda-odreto-viddyvox-pofletum:orwell.pt` becomes `milsinda`.
 *
 * Used to cut to six characters with dots, `milsin…`, and that was the best
 * you could do while an address was base32: cutting a string with no joints
 * always gives you a broken piece. With four words there is somewhere to cut
 * without breaking anything, and the difference is between a piece you spell out
 * and a word you say.
 *
 * What you lose: the first word comes from 20 bits, against the 30 of the old
 * six characters. In a room of twenty people that is about 0.02% chance of two
 * sharing the first word, and when it happens, what is at risk is they look
 * alike, not that they get confused: this never serves to verify anyone. Whoever
 * wants to confirm with whom they are talking has the full address in the line
 * title, in the profile, and the security number for the case for real.
 *
 * Only appears where there is no profile name, it is what serves as name while
 * the person's profile has not arrived, and that is why readable beats exact
 * here.
 */
/**
 * The resource for who has no name: the first word of the address, with the first
 * letter capitalized. `@ginvodra-sastybis-dirgybus-boblytum:orwell.pt` becomes
 * "Ginvodra", and the same for addresses on other servers.
 *
 * Order from the owner on November 4, 2026. Between October 27 and that day the
 * resource was "Sem nome" (ids were not shown), and with the wave of Reddit
 * accounts the common channel filled with identical lines: "Sem nome" does not
 * tell anyone apart. The first word does, and it is not the full address.
 *
 * **Collision.** When two accounts on the same screen share the first word, both
 * get the second (`Ginvodra Sastybis`). The caller gives the words that repeat
 * on that screen (`palavrasRepetidas`); without them, one word only.
 *
 * This never serves to verify anyone, as `shortAddress` already said: the full
 * address is in the profile and in the copy button. And it never gets mixed up
 * with a chosen name: whoever draws the name asks `vemDoEndereco` and draws it
 * in italic and secondary color (`NomeDePessoa`).
 *
 * Without a person's address (or with one with no local part), "Sem nome", which
 * is the only case where there is nothing left to say. The name and signature fit
 * where you expect a `nameFor`.
 */
export function nomeEmFalta(endereco?: string, repetidas?: ReadonlySet<string>): string {
  const palavras = palavrasDoEndereco(endereco)
  const primeira = palavras[0]
  if (primeira === undefined) return strings.profile.noName
  const segunda = palavras[1]
  if (segunda !== undefined && repetidas?.has(primeira)) return `${maiuscula(primeira)} ${maiuscula(segunda)}`
  return maiuscula(primeira)
}

/**
 * The first words that more than one account here shares, so `nomeEmFalta` can
 * add the second. Only counts distinct accounts: the same address twice is not a
 * collision. The caller passes only accounts whose name comes from the address;
 * those with a chosen name do not show the word and do not collide with anyone.
 */
export function palavrasRepetidas(enderecos: Iterable<string>): ReadonlySet<string> {
  const contasPorPalavra = new Map<string, Set<string>>()
  for (const endereco of enderecos) {
    const primeira = palavrasDoEndereco(endereco)[0]
    if (primeira === undefined) continue
    const contas = contasPorPalavra.get(primeira) ?? new Set<string>()
    contas.add(endereco)
    contasPorPalavra.set(primeira, contas)
  }
  const repetidas = new Set<string>()
  for (const [palavra, contas] of contasPorPalavra) if (contas.size > 1) repetidas.add(palavra)
  return repetidas
}

/**
 * Whether this name is what `nomeEmFalta` draws from this address, in one word or
 * two. This is how screens decide on the discreet style, without a second name
 * resolver.
 *
 * The edge case: whoever chooses for themself the first word of their own address
 * ("Ginvodra" in `@ginvodra-…`) also appears discreet. It is the same text, and
 * saying it comes from the address stays true. Whoever chooses the word from
 * ANOTHER person's address appears in normal style, and that is the difference
 * that matters.
 */
export function vemDoEndereco(nome: string, endereco: string | null | undefined): boolean {
  if (!endereco || palavrasDoEndereco(endereco).length === 0) return false
  if (nome === nomeEmFalta(endereco)) return true
  const primeira = palavrasDoEndereco(endereco)[0]!
  return nome === nomeEmFalta(endereco, new Set([primeira]))
}

/**
 * The words of the local part of a person's address, in lowercase: `@a-b:x.pt`
 * gives `["a", "b"]`. Only person addresses (`@…`); the server, with or without
 * port, does not count. Anything else has no words.
 */
function palavrasDoEndereco(endereco: string | undefined): string[] {
  if (!endereco?.startsWith("@")) return []
  const fim = endereco.indexOf(":")
  const local = endereco.slice(1, fim < 0 ? undefined : fim)
  return local
    .toLowerCase()
    .split("-")
    .filter((palavra) => palavra !== "")
}

function maiuscula(palavra: string): string {
  return palavra.charAt(0).toUpperCase() + palavra.slice(1)
}

export function shortAddress(address: string): string {
  const local = address.replace(/^@/, "").split(":")[0] ?? address
  return local.split("-")[0] ?? local
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url.slice(0, 40)
  }
}

export function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case "online":
      return strings.common.connectionOnline
    case "connecting":
      return strings.common.connectionConnecting
    case "reconnecting":
      return strings.common.connectionReconnecting
    default:
      return strings.common.connectionOffline
  }
}

export function formatTime(sentAt: number | undefined): string {
  if (!sentAt) return ""
  return new Date(sentAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })
}

/**
 * How long ago, the way a person would say it: "agora mesmo", "há 5 min",
 * "há 2 h", "ontem", and past that, the absolute date, because "há 9 dias"
 * makes everybody do arithmetic. Pure on purpose: `now` is injectable so tests
 * pin the clock. The absolute stamp belongs in the element's `title`.
 */
export function formatRelative(at: number | undefined, now: number = Date.now()): string {
  if (!at) return ""
  const diff = now - at
  // A post from "the future" is clock skew between devices, not time travel.
  if (diff < 60_000) return "agora mesmo"
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 24) return `há ${hours} h`
  const date = new Date(at)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return "ontem"
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(
    "pt-PT",
    sameYear ? { day: "2-digit", month: "short" } : { day: "2-digit", month: "short", year: "numeric" },
  )
}

/** dd/mm/aa — for the edit disclaimer, where the full stamp lives in `title`. */
export function formatShortDate(at: number | undefined): string {
  if (!at) return ""
  return new Date(at).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "2-digit" })
}

export function formatStamp(at: number | undefined): string {
  if (!at) return ""
  const date = new Date(at)
  const today = new Date().toDateString() === date.toDateString()
  return today
    ? `hoje, ${date.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}`
    : date.toLocaleString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { argon2id } from "@noble/hashes/argon2.js"
import { fromBase64, toBase64, type CorpoDaDenuncia, type Motivo } from "@enclave/protocol"
import { chavesDeOrdem, chaveDoEvento, venceCarimbo } from "./dobras.js"
import { comCabecalho, semCabecalho, versaoDoFicheiro, type VersaoDoFicheiroDoCofre } from "./cabecalhoDoCofre.js"
import { registarFicha, type FichaDoCanal, type FichaQueChega } from "./tipoDoCanal.js"

/**
 * The encrypted local store, with the platform swapped out behind an interface.
 *
 * The encryption itself is identical everywhere, same Argon2id parameters, same
 * XChaCha20-Poly1305, same file format, because a vault written by the desktop
 * app and one written by the browser tab should be equally hard to open. Only
 * *where the bytes live* and *whether the OS can hold the key* differ.
 */

export interface StoredProfile {
  displayName: string
  /**
   * The chosen state, published in the profile (phase 1h). Absent is "online".
   * "invisible" is neither stored nor published: being invisible means stopping
   * being announced by the server (`setVisible`), and there is no state saying so.
   */
  activity?: "online" | "ocupado" | "ausente"
  statusText?: string
  bio?: string
  /** Optional, unverified, and never transmitted outside an MLS group. */
  email?: string
  donations: { kind: string; label: string; value: string }[]
  /** Data URL. Small by policy; anything large belongs in an attachment. */
  avatarDataUrl?: string
  updatedAt: number
}

/**
 * A payload as persisted. Shape-compatible with the protocol's `Payload`, but
 * typed loosely on purpose: attachments may have been replaced by an eviction
 * marker, and a vault written by a newer client must still open in this one.
 */
export type StoredPayload = { t: string } & Record<string, unknown>

/**
 * One decrypted message, kept in plaintext inside the encrypted vault.
 *
 * This is the only place history can live. The server's backfill cannot restore
 * what was already read: `receive()` consumed those ratchet generations, so
 * events at or below `lastSeq` are permanently undecryptable. Forward secrecy
 * is the feature; this store is its honest cost.
 */
export interface StoredChatMessage {
  /**
   * Server sequence, or -1 for our own sends (which never round-trip).
   *
   * Exception since 20/10/2026: our sends of the book (friendships and invites)
   * wait for the server echo and get its `seq`. See `#sendPayload`.
   */
  seq: number
  sender: string
  /** Sender-claimed timestamp, used for media eviction order. */
  at: number
  payload: StoredPayload
  /**
   * In a send of ours still without the echo's `seq`: the highest `seq` on this
   * channel when it went out. It is its ordering key until the echo arrives
   * (phase S1, see `dobras.ts`). It leaves when the real `seq` arrives.
   */
  apos?: number
  /**
   * An act from the friendship book that came in the pairing snapshot and that
   * this device never deciphered. It goes into the folds and nowhere else: not
   * the anchor, not recovery (see `estadoDoCanal`).
   */
  herdado?: true
  /**
   * Arrived by report (phase S4), and the `seq` was told by whoever reported it,
   * unsigned. It orders the timeline, but does not own the `seq`: the server
   * event with that `seq` wins it, and the reported one becomes `seq` -1 with the
   * marker for the order right before it. It leaves when the server confirms the
   * event.
   */
  relatada?: true
}

/** The freshest profile payload a peer published, kept so names survive reload. */
export interface StoredPeerProfile {
  at: number
  payload: StoredPayload
  /**
   * The `seq` of the event that wrote this version, when known. Breaks a tie
   * between two equal timestamps (`venceCarimbo`, in `dobras.ts`). Absent in an
   * old vault.
   */
  seq?: number
  /** Who wrote this version: the sender authenticated by MLS. For the summary (S4). */
  por?: string
  /**
   * This version came from a sibling device (the pairing snapshot or the account
   * channel), not from the person themselves: it has the name, personal message
   * and state, but not the picture, bio or support methods from this version. The
   * profile request (F10) treats it as missing, so whoever is connected publishes
   * the full profile. It leaves when this person's profile arrives with the same
   * version or higher (`upsertDirectory` replaces the entry).
   */
  parcial?: true
}

/** What an attachment becomes once its bytes are evicted. The text around it stays. */
export interface EvictedMedia {
  evicted: true
  name: string
  mediaType: string
}

export interface VaultContents {
  /** Ed25519 account key, base64url. The account *is* this key. */
  signingPrivateKey: string
  /**
   * Ed25519 of the DEVICE, base64url. Signs MLS leaves and the login challenge.
   *
   * Stored next to the account key and not derived from it: deriving would give
   * the same leaf key to two devices of the same person, and revoking one would
   * revoke both. Today there is one device per account and the two are born
   * together, but the vault already stores them separately, it is the account
   * key that authorizes devices, and the one that some day will not be on all of
   * them.
   */
  deviceSigningPrivateKey: string
  /**
   * The PUBLIC account key, base64url, in a PAIRED DEVICE vault.
   *
   * A vault has one of two forms. The vault that created the account (or
   * imported it) has `signingPrivateKey`, and this field stays empty because the
   * public key comes from the private. A paired device's vault does NOT have the
   * private key: it has this public one, the `deviceCert` that the account signed
   * over its `deviceSigningPrivateKey`, and nothing else from the account.
   * `loadIdentity` reads both forms; `emparelharComoConvidado` writes the second
   * and never the first. Empty by default, and a vault from before this still
   * opens.
   */
  accountPublicKey: string
  /** The account's signature over this device's key (`signDeviceCert`), base64url. Only in a paired device vault. */
  deviceCert: string
  homeserver: string
  /**
   * Serialised MLS group state per channel.
   *
   * The most sensitive thing here: these blobs hold live epoch secrets, so
   * whoever reads them can read the channel until its next commit.
   */
  groups: Record<string, string>
  /** Published key packages whose private halves we still need for a Welcome. */
  pendingKeyPackages: {
    wire: string
    initPrivateKey: string
    hpkePrivateKey: string
    signaturePrivateKey: string
  }[]
  profile: StoredProfile
  /**
   * Invite codes this device minted, by hash.
   *
   * The only local evidence that an incoming join request traces back to an act
   * of ours. The server registers codes for anyone who asks, so its say-so
   * cannot be the basis for committing a stranger into a group.
   */
  mintedInvites: Record<string, { channel: string; createdAt: number }>
  /**
   * Last event sequence number applied, per channel.
   *
   * The anchor for catching up after a disconnect. Missing it is not a cosmetic
   * loss of history: a membership commit issued while this device was offline
   * would never be applied, leaving the group permanently on an old epoch with
   * every later message undecryptable.
   */
  lastSeq: Record<string, number>
  /**
   * The in-app notification log: things that happened to this account, kept
   * so a bell seen on one launch is still explained on the next. Local only —
   * no read receipts leave the device.
   */
  notifications: StoredNotification[]
  /**
   * Welcomes this device could not open, as "channel|digest".
   *
   * A welcome is sealed to one key package; if the private half is gone the
   * invitation is unopenable for ever. Remembering the exact bytes lets a
   * *newer* welcome for the same channel still be tried, while the dead one
   * is skipped in silence instead of shouting the same error at every login.
   */
  deadWelcomes: string[]
  /**
   * Last repair attempt per "address|channel", epoch millis.
   *
   * The circle repair re-invites people who should be reading a feed but are
   * not. Every attempt claims one of their 20 key packages, so an unattended
   * reconnect loop could drain the pool of someone who never comes online.
   * This is the brake.
   */
  repairAttempts: Record<string, number>
  /**
   * The profile version this device last published, per channel.
   *
   * The profile was republished on every connection and on every epoch change,
   * to every channel, whether or not anything had changed. With an avatar inside
   * it, that is around 124 KB a time, and it was responsible for essentially the
   * whole size of a live server's database — 157 MB of 159 MB after a single day,
   * growing about 18 MB an hour with four accounts on it. It also pushed real
   * messages, and pending friend requests, out of the capped timeline.
   *
   * Persisted rather than kept in memory so that a restart does not republish
   * everything all over again.
   */
  publishedProfileAt: Record<string, number>
  /**
   * Which round of profile repair this device has already completed.
   *
   * `publishedProfileAt` does what it should, not republish what already went
   * out, but assumes "went out" means "arrived". There was a version where it
   * did not: whoever invited someone applied their own commit locally and never
   * republished the profile, so the invitee kept seeing the address instead of
   * the name, and it stayed that way forever, because on this side the profile
   * showed as published. A vault in that situation does not repair itself.
   *
   * This is the way to force it once: while the stored number is less than
   * `RONDA_DE_REPARACAO`, the next connection republishes the profile on all
   * channels and writes the number. Absent means zero, which is what all old
   * vaults say without needing migration.
   *
   * To repeat the repair some day, increment the constant. Do not do this
   * lightly: a profile with a picture runs to about 124 KB, and one round costs
   * that times the number of channels, for each person.
   */
  profileRepairRound?: number
  /**
   * How far the SFrame counter has gone for each of our keys, with headroom.
   *
   * Keyed by `canal|keyId`, which is what identifies the material: the media
   * key derives from the channel epoch and our leaf index, and neither changes
   * when the app closes and reopens.
   *
   * It exists because a newly built `SframeSender` would start counting at zero
   * and repeat, with the same key, every nonce from the previous call. In
   * AES-GCM a repeated nonce reveals the XOR of the two texts and lets you forge
   * authenticated frames. The symptom we saw was different and even more visible:
   * `SframeReceiver` rejects counters that are too far behind, so reloading the
   * app mid-call made you mute to the others.
   *
   * The stored value is the END of the reserved block, not the counter in use.
   * On startup we read it, jump to it, and immediately save the end of the next
   * block: a crash mid-call loses the whole block instead of repeating a single
   * counter. See `RESERVA_SFRAME` in `call.ts`.
   */
  sframeReservas?: Record<string, number>
  /**
   * The `seq` of the Welcome that gave us our place, per channel.
   *
   * What comes before it is from before us, and there is one case where you
   * cannot read that from the epoch: a channel remade by someone who lost the
   * state restarts the epochs, and what is left of the old group arrives with
   * epochs HIGHER than ours. Without this, recovery for someone re-admitted
   * would take each old event for a missing commit and stop at the first. In the
   * vault, not in memory, because that recovery can be interrupted by a reload.
   *
   * **A limit that is not just this field's.** The server numbers each channel
   * from the highest stored `seq`; if retention (30 days) deletes ALL events of
   * a silent channel, numbering restarts at 0. From then on this number stays
   * above the new ones, and a true epoch gap with `seq` below it would be taken
   * for "before the place". But `lastSeq` suffers the same and worse, recovery
   * asks after the old anchor and sees nothing, and you cannot fix that from
   * here without the server saying it restarted. Written here for whoever touches
   * retention: the fix is on the server (never restart numbering, or announce it),
   * and this field follows the anchor.
   */
  seatSince?: Record<string, number>
  /**
   * Channels where this device lost its place and does not yet have another, with
   * the time we learned it (F3 of sync audit, 20/10/2026).
   *
   * A Welcome that does not open is a lost place, and whoever lost it is the only
   * one who knows: on the other side the person still stands in the tree. The
   * request for a new place (`channel.rejoin.request`) went out once, if at all,
   * and got lost with the connection. In the vault, to be repeated on every
   * connection and when the peer appears, until a Welcome that opens arrives,
   * spaced out and only for thirty days (M1). A number alone is the first
   * version's form (just the time). Absent in an old vault: nothing to request.
   */
  lugaresPorPedir?: Record<string, number | { desde: number; tentativas: number; proxima: number }>
  /**
   * Channels we were removed from by someone else's commit, with the timestamp (C1 from
   * the 20/10/2026 revision).
   *
   * The group and keys are gone; the HISTORY stays. Only the person can delete history, by
   * calling `forgetChannel`. A Welcome that opens the same channel removes it from here and
   * the history continues where it was.
   */
  canaisArquivados?: Record<string, number>
  /**
   * Actions in the address book (friendships and invites) that went out and still have no echo, by
   * the SHA-256 hash of the encrypted bytes (I3 from the 20/10/2026 revision).
   *
   * The address book is only saved with the echo's `seq`. An echo that arrived after the
   * receipt deadline, or never arrived in real time, left the action on the server and out of
   * the vault of who made it. The hash lets recovery recognize it by the bytes.
   * Expires in thirty days, with the server's retention.
   */
  /**
   * Who left each channel by their own request (`member.left`), by
   * "channel|address", with the timestamp (I6 from the 20/10/2026 revision). Repair of
   * direct channels reads this to avoid seating someone who left.
   */
  saidasHonradas?: Record<string, number>
  /**
   * Who this account blocked, by address, with the timestamp (phase 3 of the friendships plan,
   * 20/10/2026). Absent in an older vault, and absence means `{}`.
   *
   * Blocking is a decision made on THIS device: what we send out from here (the friendship cut,
   * leaving their feed) reaches everyone, but the filter on what comes in lives here and only here.
   * Two devices on the same account do not share the list. See `docs/PENDENTES.md`.
   */
  blocked?: Record<string, number>
  /**
   * The list of friends each account chose to show on their profile, by author
   * (`friends.shown`, phase 5). Our own entry is the choice we made.
   *
   * The most recent `updatedAt` from the AUTHOR themselves wins, like the profile: the list is
   * theirs and only they write it, and we only accept it from their feed.
   */
  shownFriends?: Record<string, { shown: string[]; updatedAt: number }>
  /**
   * How many consecutive `friends.shown` updates came in on my feed with no other event between,
   * and whether there is a saved list waiting to go out. In the vault, not just in memory, so
   * a reload does not lose the count (a 0.5.x client keeps counting on its side) or the
   * pending list. See `setShownFriends` in the core.
   */
  listasSeguidas?: number
  listaPorEnviar?: boolean
  livroPorConfirmar?: Record<string, { channel: string; payload: StoredPayload; at: number }>
  /**
   * Our messages sent outside the address book that went out and still have no echo `seq`,
   * by the SHA-256 hash of the encrypted bytes (S1, §7.2 of the plan).
   *
   * Unlike the address book, these are saved right away, with `seq` -1 (the screen is optimistic).
   * The echo replaces -1 with the server's `seq` (`confirmarSeq`). This hash lets recovery
   * recognize the message by the bytes when the real-time echo is lost (a connection drop,
   * a page reload). `chave` is the `chaveDoEvento` of the saved entry. Expires in thirty days,
   * with the server's retention, and has a cap (`ENVIOS_POR_CONFIRMAR_MAX`).
   */
  enviosPorConfirmar?: Record<string, { channel: string; chave: string; at: number }>
  /**
   * Who this device has already told what belongs to them, per channel: the accounts
   * that were there when the re-send of our own completed fully (S1). The next connection
   * only repeats where there is an account not here.
   */
  reenviadoPara?: Record<string, string[]>
  /**
   * Channels where the re-send of our own did not finish: either not all leaves had announced
   * (§4.6), or a message failed. Runs when the last one announces, or on the next pass if we
   * already know. Only excluded is the feed wall, which always goes out (that is what 0.6.0 already did).
   */
  reenvioPorFazer?: string[]
  /**
   * F10: accounts with no name that this device has already requested profiles for, per
   * channel. The request only repeats when someone with no name appears who is not here: each
   * request is an MLS message, and a request every ten minutes to someone who never replies
   * (a 0.5.7) would burn ratchet generations for anyone offline.
   */
  perfisPedidos?: Record<string, string[]>
  /** When this device announced, in each channel, that it deduplicates re-sends (§4.6). */
  reenvioAnunciado?: Record<string, number>
  /**
   * The devices that announced, in each channel, that they deduplicate re-sends, by
   * device key, with the timestamp (§4.6 of the plan). The re-send of comments and tickets
   * only runs in a channel where all leaves are here: a 0.5.7 client never announces, and
   * stored each re-send as a new entry.
   */
  capacidadesNoCanal?: Record<string, Record<string, number>>
  /**
   * The devices that said, in each channel, that they read the 1.2 permissions model
   * (`CAPACIDADE_PERMISSOES`), by device key, with the timestamp. Role delegation is only
   * offered in a channel where all leaves are here (decision D13). Optional, no migration.
   */
  conhecemPermissoes?: Record<string, Record<string, number>>
  /** When this device said, in each channel, that it reads the permissions model. */
  permissoesAnunciadas?: Record<string, number>
  /**
   * When an event from each device in each channel was last opened, by device key
   * (§4.6, finding 13 from the 0.7.0 revision). With `canalObservadoDesde`, this is what
   * tells a dead leaf (silent for `FOLHA_CALADA_MS`) from a live 0.6.0 that has not announced
   * yet: the dead leaf stops blocking re-sends, the live one keeps blocking. Updated at most
   * once per hour per device, and capped per channel.
   */
  aparelhoVistoNoCanal?: Record<string, Record<string, number>>
  /** Since when this device observes each channel for the purpose above. */
  canalObservadoDesde?: Record<string, number>
  /**
   * F10: the accounts that were in each channel when our profile went out there last.
   * A request for profiles only gets a reply if there is an account in the channel that
   * is not here: without this, any member would put all accounts publishing their profile
   * (up to 124 KB with avatar) in a loop.
   */
  perfilPublicadoPara?: Record<string, string[]>
  /** F10: when we last replied to a request for profiles in each channel. At most once a day. */
  perfisDadosEm?: Record<string, number>
  /**
   * Events that the anchor passed WITHOUT BEING ABLE TO READ, by channel.
   * The gaps.
   *
   * **It exists because the anchor lied.** An event from an epoch this device
   * has already left behind won't open, persistent secrecy, and until 5 de
   * October 2026 `"lido"` was the rule: the anchor would skip over it and it
   * was never requested again, with the bytes still on the server. A message
   * lost in silence, and that's how the owner lost his.
   *
   * The anchor keeps moving forward, and must keep moving: stopping at it
   * puts recovery in a loop on the same event, which is the old defect. What
   * changes is that what was lost gets NAMED and COUNTED here, and gets
   * requested again in later connections, one at a time, few per connection.
   *
   * In the vault and not in memory because the question this answers is "what
   * hasn't this device read", and that survives closing the app.
   *
   * `minuto` is the `receivedAtMinute` that the server put on the event, and it's what
   * the gap expires by: the server keeps events `retentionDays` days (announced in
   * `hello.ok`), and requesting what it already deleted is asking forever for what
   * never comes. See `PODA_DE_LACUNAS` and `LACUNAS_POR_CANAL`.
   */
  lacunas?: Record<string, { seq: number; minuto: number }[]>
  /**
   * Our commits that went out and still have no verdict from the server, per channel.
   *
   * Each one with the group it produces, in base64 like `groups`, and with the Welcome
   * from an admission. The group in `groups` stays in the epoch before, which is the truth
   * until the server says yes; if the commit shows up in recovery, the echo was lost, the
   * page reloaded, it is recognized by the bytes and applied. As sensitive as `groups`:
   * it is epoch state.
   */
  pendingCommits?: Record<
    string,
    { commit: string; base: string; group: string; welcome?: string | undefined; recipient?: string | undefined }[]
  >
  /**
   * The last server restart this device has already recognized.
   *
   * The server does not know MLS groups exist, the keys live here, so it has no way
   * to say "this channel is not yours anymore". When its storage is wiped, the state we
   * have saved here becomes orphaned: we think we are members of channels whose peers and
   * history disappeared, and from then on nothing decrypts. Keeping the mark that we already
   * saw a restart lets the app drop that state once, on its own, instead of relying on a
   * button, and a button like that, always at hand, would be a trivial way to erase someone
   * else's history.
   */
  serverResetAtMinute?: number
  /**
   * The minute this identity was created.
   *
   * Only exists in vaults created after the account cut. The absence of the field is
   * information: it means the identity is older than the mechanism, and therefore older
   * than any cut the server might declare.
   */
  identityCreatedAtMinute?: number
  /**
   * The ownership generation of this device on the server (`auth.finish`, in the protocol).
   *
   * An imported file is a COPY of the device that exported it: same key, same leaf in each
   * channel. The server only lets the copy with the highest generation speak; this is what
   * the server gave this vault on the last login.
   */
  posseDoAparelho?: number
  /**
   * This vault came from an imported file and has not yet claimed ownership: the
   * random mark of this import. Set by `importVault`, cleared by the session when the
   * server responds with the new generation. Until then, each login asks for it again with
   * the same mark: a login that crashes halfway does not leave the old copy with ownership,
   * and two connections from this copy do not close each other (see `auth.finish` in the protocol).
   */
  assumirPosse?: string
  /** The one-shot peer bootstrap already ran on this device. */
  bootstrapDone?: boolean
  /**
   * The decrypted conversation, per channel: the common messages, capped at
   * `HISTORY_MAX_PER_CHANNEL`. Since vault version 2, what decides state is not here:
   * it is in `estadoDoCanal`. Anyone wanting both lists together, in server order,
   * reads `entradasDoCanal`.
   */
  history: Record<string, StoredChatMessage[]>
  /**
   * The state ledger of each channel (phase S2 of absolute sync, 20/10/2026).
   *
   * The events that decide STATE, outside the capped list of messages: friendships
   * and invites, posts, comments, likes and votes, edits and tombstones, and ticket
   * messages. Before they lived in `history` and the 400 cap took them with the messages:
   * a channel with conversation lost the wall, the tombstone of a deleted post and tickets
   * (S0, scenario "vault at cap").
   *
   * Events not the folded form: the folds (`dobras.ts`, `tickets.ts`, the friendships)
   * already read events, and storing the folded form was a second rule to keep equal to
   * the first. It has its own caps, by type (`TECTOS_DO_ESTADO`).
   *
   * What has its own record stays there: rooms, categories, roles, administrators, founder,
   * banner, pinned, and profiles.
   */
  estadoDoCanal: Record<string, StoredChatMessage[]>
  /**
   * The bytes of post videos, by SHA-256 (26/10/2026). See `guardarVideo`. Absent in
   * an older vault: no video stored.
   */
  videos?: Record<string, VideoGuardado>
  /** Latest profile payload seen per address, so names survive a reload. */
  directory: Record<string, StoredPeerProfile>
  /**
   * How each channel presents itself: real name, description and icon.
   *
   * Same mechanics as `directory` for the same reason, the name has to be on screen before
   * the network responds, or the sidebar would flicker the raw identifier on each startup.
   * The difference is the subject: here it is the channel not the sender, so who can write
   * does not resolve by itself and is left to the roles.
   */
  spaceMeta: Record<string, StoredPeerProfile>
  /**
   * Who founded each channel, and who they appointed.
   *
   * In the vault and not just in memory, because the founder record arrives once and never
   * again: it is consumed during catch-up and from then on it does not return. Stored only in
   * memory, an F5 would erase it, the channel would look like it had no owner again and would
   * offer itself to whoever got there. That is how it happened.
   */
  channelFounder: Record<string, { address: string; seq: number; payload?: StoredPayload }>
  /**
   * Who administers each channel, in the two-state format that existed before named roles.
   * Read-only from here on.
   *
   * Still consulted for a person who `channelMemberRoles` says nothing about yet, that is
   * what keeps a vault saved before roles from knowing who is in charge, with no migration
   * and without a channel waking up with no owner. Once a `role.assign` arrives for someone,
   * the new entry wins, and this one stops being read for that person.
   */
  channelAdmins: Record<string, string[]>
  /**
   * The roles defined in each channel. Foreign key is the channel, internal key is the
   * role id, same structure as `channelRooms`, for the same reason: the list has to be
   * on screen before the connection opens, or the role name for each person would flicker
   * on each startup.
   *
   * The most recent write wins, like everything that describes the channel not a person.
   * A deleted role stays here with `removed`, because disappearing without a trace is
   * indistinguishable from never arriving.
   */
  channelRoles: Record<string, Record<string, StoredPeerProfile>>
  /**
   * What roles each person has in each channel. Channel, then address.
   *
   * The whole list, not a change: `role.assign` brings the full set, and an empty list
   * means "none". Storing changes would require having seen them all, and whoever joins
   * the channel halfway never saw them.
   */
  channelMemberRoles: Record<string, Record<string, string[]>>
  /**
   * The timestamp of each role assignment in `channelMemberRoles`: the `assignedAt` from
   * whoever assigned it, the event's `seq` and who wrote it (F11 from the sync audit, phase S1).
   * Channel, then address.
   *
   * The highest timestamp wins, and `seq` breaks ties (`venceCarimbo`). Before, the last to arrive
   * won, and the re-send of `republishAuthority` brought the time NOW: a change on the way lost
   * to a re-send of an old version. Absent in an older vault: the first assignment to arrive wins,
   * as before.
   */
  channelMemberRolesAt?: Record<string, Record<string, { at: number; seq?: number; por?: string; autoria?: unknown }>>
  /**
   * The rooms of each channel, for the same reason as the name: they have to be on screen
   * before the connection opens. Foreign key is the channel, internal key is the room id.
   */
  channelRooms: Record<string, Record<string, StoredPeerProfile>>
  /**
   * The categories declared in each channel. The internal key is the name, which is also
   * the identity here, see `channel.category` in the protocol.
   *
   * Same structure and same reason as `channelRooms`: the sidebar draws before the connection
   * opens, and a category that only appeared later would make the list jump in front of whoever
   * was looking at it.
   */
  channelCategories: Record<string, Record<string, StoredPeerProfile>>
  /**
   * Per channel, everyone whose events this device has actually opened.
   *
   * The only proof that somebody's seat works is that something they sealed
   * to the group came out again. Reading that from the chat history instead,
   * as `seat` once did, makes every feed reader look permanently inert:
   * readers of a feed never post to it, and the one thing they do send into
   * it — their profile, republished on each epoch — is filed in the directory
   * rather than the timeline. Healthy members therefore looked dead, and
   * re-seating a healthy member rekeys the group and takes every earlier post
   * away from them for good.
   */
  transmitters: Record<string, string[]>
  /**
   * The highest version of the device manifest this device has seen, per address. The
   * anti-rollback anchor.
   *
   * The server keeps the manifest of each account and serves the newest it has, but can serve
   * an old one, before a revocation, to someone who never saw the new one (docs/THREAT-MODEL.md).
   * It cannot forge it because it does not sign it; what it can do is stay silent about the new
   * version. This is what catches that silence: a manifest with a version below what is here is
   * rejected, no matter where it comes from. It does not yet decide admissions (that is the claim
   * in bundle, in the next section); today it keeps our published version and the version of
   * whoever we read.
   *
   * Absent in a vault before this, and absence reads as "never seen any", which is the truth.
   */
  deviceManifests: Record<string, number>

  // ------------------------------------------- the account state (phase 5, F13)
  //
  // What passes between devices on the same account, by the pairing snapshot and by the
  // account channel. All optional: an older vault opens with them absent, and `#adopt` saves
  // them by spreading. The merge rule is the one in `estado.ts` in the protocol: the highest
  // timestamp per key wins.

  /** The time of last read for each channel. Used to be `enclave.lastRead` from `localStorage`. */
  lidas?: Record<string, number>
  /** Interface preferences, per key, with the time of the choice. The core does not interpret them. */
  preferencias?: Record<string, { valor: string; at: number }>
  /**
   * The archive that the PERSON made (`arquivar`, `desarquivar`), per channel, with the timestamp.
   *
   * This is not `canaisArquivados`: that is what was left from channels we were removed from,
   * with this device's history. This is an organization mark, and also stores the unarchive
   * (`arquivado: false`) so the merge knows which of the two actions came last.
   */
  arquivo?: Record<string, { arquivado: boolean; at: number }>
  /**
   * When each account was unlocked, by address: the other half of `blocked`
   * for device merging. Without it, an unlock on the phone loses to the older
   * lock that the computer still has.
   */
  desbloqueados?: Record<string, number>
  /**
   * The friendship ledger from the pairing snapshot, by channel.
   *
   * Only in a version 1 vault. Since version 2 these events live in the channel
   * state book (`estadoDoCanal`), marked as `herdado`, and the migration clears
   * this field on open. It stays in the type for the migration to read.
   */
  livroHerdado?: Record<string, { seq: number; sender: string; t: string; sentAt?: number; note?: string; withdrawn?: true }[]>
  /**
   * Devices in this account that announced they know about the account channel,
   * by device key, with the time we learned it. This is the roster of who joins:
   * a leaf that didn't announce itself (an old 0.5.7 client) doesn't appear.
   */
  aparelhosComEstado?: Record<string, number>
  /**
   * Of the devices above, those that said they have the account key, with the
   * time of the last signal. Decides who creates the account channel (I4): the
   * one with the lowest device key. See `CAPACIDADE_CHAVE_DE_CONTA`.
   */
  aparelhosComChave?: Record<string, number>
  /** Some flags changed without reaching the account channel: the next connection sends the whole state. */
  estadoPorEnviar?: boolean
  /**
   * What each channel is, by channel (1.0 "Arca", slice 2): `tipo` ("directa",
   * "mural", "sala", "conta"), the pair of the directa, and the owner of the
   * mural. With opaque addresses the address says nothing, and this is where the
   * session and UI read it (`tipoDoCanal.ts`). Arrives with the first saved
   * group in the channel (`Session.#escreverGrupos`) and never changes: a
   * channel does not change type.
   */
  fichasDosCanais?: Record<string, FichaDoCanal>
  /**
   * The secret of the mural for this account (32 bytes, base64url), slice 3.
   * The address of the mural is `moradaDoMural(segredo, servidor)`. Whoever
   * has the account key derives it from there (`Session.#segredoDoMural`); a
   * paired device receives it in the snapshot, in the account channel, or in
   * a sibling's profile.
   */
  segredoDoMural?: string
  /**
   * The address of the account channel (slice 3). Whoever has the account key
   * calculates it (`moradaDaConta`); a paired device receives it at pairing.
   */
  moradaDaConta?: string
  /**
   * The mural secret of each account that told us about it, by address (D1).
   * Arrives in the `mural` field of the profile, which only goes to directa
   * channels and group channels (never to the common room). In a separate map
   * from `directory`: the same profile arrives without `mural` through another
   * channel, with the same version, and `directory` keeps the latest copy.
   */
  muraisDosOutros?: Record<string, string>
  /**
   * The authorship of each member's profile, as it arrived in each channel
   * (phase 1 of 1.1, the portrait in Welcome). Channel, then address.
   *
   * A profile signature binds to the channel, and `directory` keeps a copy per
   * person, the latest from any channel: without it, the inviter wouldn't have
   * the means to prove a third party's name in this channel. We store only the
   * authorship (roughly 200 bytes), the version (`u`, the `updatedAt`), and
   * whether the profile carried the mural secret (`mural`): the profile rebuilds
   * from `directory` and is verified before it goes out, and what doesn't verify
   * doesn't go.
   */
  autoriasDosPerfis?: Record<string, Record<string, AutoriaDoPerfilNoCanal>>
  /**
   * The history between devices in the account (1.0 "Arca", 29/10/2026): what
   * this device already pulled from a sibling, and what's missing. Absent in
   * an older vault: nothing to pull. See `historico/historico.ts` in the core.
   */
  historico?: EstadoDoHistorico
  /**
   * The reports that arrived at this device as founder, by channel
   * (`docs/planos/denuncias-design.md`, §6.2). Opened and verified here, when
   * reading the mailbox (`Session.recolherDenuncias`). No info about who reported.
   */
  denuncias?: Record<string, DenunciaRecebida[]>
  /**
   * The mailbox ids already saved (or that didn't open), to tell the server:
   * they go in the next request, and the server deletes them. In the vault, not
   * in memory: after a restart, the same copy won't come back.
   */
  caixaVista?: string[]
  /**
   * The copies to the founder that the server has for this account and that
   * this device doesn't open (no account key), by id, with each one's channel.
   * Rewritten on each mailbox read; an id leaves when the report arrives from
   * a sibling through the account channel. Only for the UI to say how many are
   * waiting, not "Nobody reported anything". In the vault: after a restart,
   * the section knows about it before the first read.
   */
  copiasPorAbrir?: Record<string, string>
  /**
   * The decisions this account made about reports (art. 16, no. 5 of the DSA),
   * one per mailbox id (`numeroLocal`, `d-<n>`). Written only when the decision
   * arrives, on mailbox read (`Session.recolherDenuncias`). `dia` is the UTC
   * day the report arrived at the server.
   */
  denunciasFeitas?: DenunciaFeita[]
}

/** A report this account made, with the decision that arrived. */
export interface DenunciaFeita {
  numeroLocal: string
  canal: string
  /** UTC, `YYYY-MM-DD`. */
  dia: string
  decisao?: "suspensa" | "sem-accao"
}

/** A message from a report received, as the founder reads it. */
export interface ItemDaDenunciaRecebida {
  autor: string
  /** UTC, `YYYY-MM-DD`, from the author's `sentAt`. */
  dia: string
  /** UTC, `HH:MM`, from the author's `sentAt`. Never the time the report arrived. */
  hora: string
  texto: string
  /** Only the name, type, and size. Never the bytes. */
  anexos: { name: string; mediaType: string; byteLength?: number }[]
  /** The authorship checks out, and the device speaks for the author's account. Verified on this device. */
  verificada: boolean
  denunciada: boolean
}

/** A report copy opened by the founder. From the report, only the day. */
export interface DenunciaRecebida {
  /** The mailbox id. */
  id: string
  canal: string
  sala?: string
  /** UTC, `YYYY-MM-DD`. */
  dia: string
  motivo: Motivo
  nota: string
  denunciado: string
  alvo: CorpoDaDenuncia["alvo"]
  /** By the author's order (`sentAt`), never by seq. */
  itens: ItemDaDenunciaRecebida[]
  lida: boolean
}

/** Ver `autoriasDosPerfis`. */
export interface AutoriaDoPerfilNoCanal {
  u: number
  autoria: unknown
  mural?: true
}

/** A heavy thing missing from a sibling: the bytes of an entry, a video, or a profile with portrait. */
export type ItemDeMediaDoIrmao = { c: string; e: string } | { v: string } | { a: string }

/** A channel in the history plan. `cursor` is the sort key of the last entry pulled; `null` is the start. */
export interface CanalNoPlano {
  total: number
  feitas: number
  cursor: number | null
  /** The summary of the channel on the sibling, when the plan was made. Ends up in `trazidos` at the finish. */
  resumo: string
  fim?: true
}

/**
 * The state of history between devices, in the vault: resumable after a
 * connection drop or closing the app.
 */
export interface EstadoDoHistorico {
  /** This vault was born in a pairing and hasn't yet pulled the sibling's full history. */
  inicial?: { desde: number }
  /** What is being pulled. Leaves when it finishes. */
  plano?: {
    comecou: number
    canais: Record<string, CanalNoPlano>
    /** The phase for media: absent until we ask for the list; `porTrazer` shrinks. */
    media?: { total: number; feitas: number; porTrazer: ItemDeMediaDoIrmao[] }
  }
  /**
   * Per channel, the summary of the sibling we already pulled. A sibling with
   * the same summary has nothing new for this device, even if this one has
   * extra things.
   */
  trazidos?: Record<string, string>
  /**
   * Per channel, the first place in the ACCOUNT, as the sibling has it (the
   * marker "You joined here"). `null`: the account has had the channel from
   * the start, and there is no marker. Wins over this device's place, which is
   * that of a new device.
   */
  lugares?: Record<string, { seq: number; em: number } | null>
}

export interface StoredNotification {
  id: string
  kind: "room-added" | "dm-new" | "friend-request" | "friend-accept" | "dm-message" | "channel-join"
  at: number
  /** The person behind it, when there is one. */
  actor?: string
  /** The channel to open when clicked, when there is one. */
  channel?: string
  read: boolean
}

export function newVaultContents(): VaultContents {
  return {
    signingPrivateKey: "",
    deviceSigningPrivateKey: "",
    accountPublicKey: "",
    deviceCert: "",
    homeserver: "",
    groups: {},
    pendingKeyPackages: [],
    profile: { displayName: "", donations: [], updatedAt: 0 },
    mintedInvites: {},
    lastSeq: {},
    history: {},
    estadoDoCanal: {},
    directory: {},
    spaceMeta: {},
    channelFounder: {},
    channelAdmins: {},
    channelRoles: {},
    channelMemberRoles: {},
    channelRooms: {},
    channelCategories: {},
    notifications: [],
    deadWelcomes: [],
    repairAttempts: {},
    publishedProfileAt: {},
    transmitters: {},
    deviceManifests: {},
  }
}

/**
 * Note that this device opened an event from `address` in `channel`.
 *
 * Bounded per channel: this answers "is this member alive?", so a busy room
 * never grows it without limit. Idempotent, and the newest arrival wins the
 * tail so an active member is never the one dropped.
 */
export function noteTransmitter(contents: VaultContents, channel: string, address: string): void {
  // Defensive against a vault written before this field existed: `#adopt`
  // fills it in, but this also runs over contents handed in by callers.
  contents.transmitters ??= {}
  const seen = contents.transmitters[channel] ?? []
  contents.transmitters[channel] = [...seen.filter((who) => who !== address), address].slice(-TRANSMITTERS_PER_CHANNEL)
}

/** Has this device ever opened an event `address` sealed to `channel`? */
export function hasTransmitted(contents: VaultContents, channel: string, address: string): boolean {
  return (contents.transmitters?.[channel] ?? []).includes(address)
}

/**
 * Does this device know anything at all about who is alive in `channel`?
 *
 * A vault written before this field existed knows nothing about any channel,
 * and "I have no evidence" must never be read as "they are dead" — that would
 * make the very first repair pass after an upgrade re-seat every healthy
 * reader at once, which is the exact harm this record exists to prevent.
 * Evidence arrives on its own within minutes, so waiting for it costs nothing.
 */
export function hasTransmitterEvidence(contents: VaultContents, channel: string): boolean {
  return (contents.transmitters?.[channel]?.length ?? 0) > 0
}

/** Enough for any real room; a cap so a busy channel cannot grow the vault. */
export const TRANSMITTERS_PER_CHANNEL = 256

/**
 * Record the version of a device manifest we just saw, if it doesn't go backwards.
 *
 * @returns `false` if `version` is less than the last one seen from this
 * address: it's an old manifest, and the caller doesn't use it. Equal is not
 * going backwards, it's the same manifest again, and it's fine.
 */
export function noteDeviceManifest(contents: VaultContents, address: string, version: number): boolean {
  // Defensive like `noteTransmitter`: `#adopt` fills the field, but this also
  // runs over content delivered by the caller.
  contents.deviceManifests ??= {}
  const vista = contents.deviceManifests[address]
  if (vista !== undefined && version < vista) return false
  // Delete and put back: an object's keys keep insertion order, and that order
  // makes "first" the oldest when the cap cuts it.
  delete contents.deviceManifests[address]
  contents.deviceManifests[address] = version
  for (const antigo of Object.keys(contents.deviceManifests).slice(0, -MANIFESTOS_LEMBRADOS)) {
    delete contents.deviceManifests[antigo]
  }
  return true
}

/**
 * How many manifest anchors the vault stores, and the oldest leaves.
 *
 * A cap because a vault that grows with every address ever read is
 * `transmitters` without `TRANSMITTERS_PER_CHANNEL`. The newest, not "only
 * those who share a channel", because it's the simplest thing that solves it,
 * and because someone about to be invited doesn't yet share a channel: it's
 * precisely before the invite that the anchor matters. Losing an address's
 * anchor is losing the anti-rollback defense for it, and be warned: five
 * hundred twelve is far more people than a server this size knows.
 */
export const MANIFESTOS_LEMBRADOS = 512

/** The highest version of the manifest from this address that this device has seen, if any. */
export function deviceManifestSeen(contents: VaultContents, address: string): number | undefined {
  return contents.deviceManifests?.[address]
}

/** How long before the same (person, channel) repair may be tried again. */
export const REPAIR_COOLDOWN_MS = 6 * 3_600_000

/** Pure: may this repair run now? Unknown pairs always may. */
export function mayRepair(
  attempts: Record<string, number>,
  address: string,
  channel: string,
  now: number = Date.now(),
  cooldownMs: number = REPAIR_COOLDOWN_MS,
): boolean {
  const last = attempts[`${address}|${channel}`]
  return last === undefined || now - last >= cooldownMs
}

// ------------------------------------------------------------------ history
//
// Pure mutations over `VaultContents`, kept out of `Session` so the cap and
// eviction rules can be tested without a socket or a ratchet in sight. Every
// one of these runs *inside* an existing `vault.update` mutation — they never
// trigger a write of their own.

/**
 * Hard cap per channel. Beyond it, the oldest messages fall off.
 *
 * The ledger (friendships and invites) stays out of this account and has its
 * own cap: see `LEDGER_MAX_PER_CHANNEL` and `ehDoLivro`.
 */
export const HISTORY_MAX_PER_CHANNEL = 400
/** How many newest entries from each room in a channel keep the bytes of their media. See `foraDaJanelaDeMedia`. */
export const HISTORY_MEDIA_RECENT = 40
/** Total media bytes tolerated across all channels before eviction starts. */
export const HISTORY_MEDIA_BUDGET_BYTES = 4_000_000

/** The payload arrays that can carry base64 media: `message.attachments`, `post.media`. */
const MEDIA_KEYS = ["attachments", "media"] as const

/**
 * `post.links`, which loads bytes in another way and so gets its own step.
 *
 * An attachment is an object whose bytes are in `inline`, or at most in a `url`
 * that starts with `data:`. A link card is nothing like that: the thumbnail is
 * the string `thumbnail` in there, and the `url` beside it is the page, never a
 * `data:`. `carriesBytes` looked for the two things a card doesn't have, and
 * concluded that a post with 400 KB of thumbnails weighed zero, they stayed in
 * the vault forever, without counting against any limit.
 *
 * The dump is different too. A dumped attachment becomes a marker because the
 * name and type are what's left of it; a dumped card leaves everything but the
 * image, the address, title, description, and site still read, and a card
 * without a thumbnail is already a normal state, that of someone who posted a
 * link that had no image at all. So here we remove the field and don't put a
 * marker in its place.
 */
const LINK_KEY = "links"

/** Bytes the card thumbnail is using. Zero if it has none. */
function thumbnailBytes(item: unknown): number {
  if (typeof item !== "object" || item === null) return 0
  const thumbnail = (item as Record<string, unknown>).thumbnail
  return typeof thumbnail === "string" ? thumbnail.length : 0
}

function carriesBytes(item: unknown): item is Record<string, unknown> {
  if (typeof item !== "object" || item === null) return false
  const record = item as Record<string, unknown>
  if (record.evicted === true) return false
  return (
    (typeof record.inline === "string" && record.inline.length > 0) ||
    (typeof record.url === "string" && record.url.startsWith("data:"))
  )
}

function bytesOf(item: Record<string, unknown>): number {
  const inline = typeof item.inline === "string" ? item.inline.length : 0
  const url = typeof item.url === "string" && item.url.startsWith("data:") ? item.url.length : 0
  return inline + url
}

/** Media bytes one stored entry is holding. Zero once evicted. */
export function entryMediaBytes(entry: StoredChatMessage): number {
  let total = 0
  for (const key of MEDIA_KEYS) {
    const list = entry.payload[key]
    if (!Array.isArray(list)) continue
    for (const item of list) if (carriesBytes(item)) total += bytesOf(item)
  }
  const links = entry.payload[LINK_KEY]
  if (Array.isArray(links)) for (const item of links) total += thumbnailBytes(item)
  return total
}

/** Replace an entry's media with markers. The words survive; the bytes do not. */
export function evictEntryMedia(entry: StoredChatMessage): void {
  for (const key of MEDIA_KEYS) {
    const list = entry.payload[key]
    if (!Array.isArray(list)) continue
    entry.payload[key] = list.map((item): unknown =>
      carriesBytes(item)
        ? ({
            evicted: true,
            name: typeof item.name === "string" ? item.name : "",
            mediaType: typeof item.mediaType === "string" ? item.mediaType : "",
          } satisfies EvictedMedia)
        : item,
    )
  }

  const links = entry.payload[LINK_KEY]
  if (!Array.isArray(links)) return
  // New map instead of deleting from the existing one: what the vault stores
  // might be the same reference that something else already read, and eviction
  // must never reach back and mutate it. See `appendHistory`, which clones for
  // the same reason.
  entry.payload[LINK_KEY] = links.map((item): unknown => {
    if (thumbnailBytes(item) === 0) return item
    const card = { ...(item as Record<string, unknown>) }
    delete card.thumbnail
    return card
  })
}

/**
 * A copy of the payload without media over `limit` characters per item (the
 * cross-device history): large attachments become markers, like in eviction,
 * and large thumbnails are dropped. Small ones stay: they go with the text
 * already, and large ones go later, in the background (`juntarMediaDoIrmao`).
 * Returns whether anything was removed.
 */
export function semMediaPesada(payload: StoredPayload, limite: number): { payload: StoredPayload; tirou: boolean } {
  const copia = structuredClone(payload)
  let tirou = false
  for (const key of MEDIA_KEYS) {
    const list = copia[key]
    if (!Array.isArray(list)) continue
    copia[key] = list.map((item): unknown => {
      if (!carriesBytes(item) || bytesOf(item) <= limite) return item
      tirou = true
      return {
        evicted: true,
        name: typeof item.name === "string" ? item.name : "",
        mediaType: typeof item.mediaType === "string" ? item.mediaType : "",
      } satisfies EvictedMedia
    })
  }
  const links = copia[LINK_KEY]
  if (Array.isArray(links)) {
    copia[LINK_KEY] = links.map((item): unknown => {
      if (thumbnailBytes(item) <= limite) return item
      tirou = true
      const card = { ...(item as Record<string, unknown>) }
      delete card.thumbnail
      return card
    })
  }
  return { payload: copia, tirou }
}

/**
 * The bytes of a video post, in the vault.
 *
 * Outside entries, in a map by SHA-256: the video attachment in the `post`
 * carries no bytes (see `video.ts` in the protocol), and the same video in two
 * posts is one. `b64` is base64url, like the rest of the vault; `at` is the
 * time it was stored.
 */
export interface VideoGuardado {
  b64: string
  at: number
}

/** The bytes a stored video takes up in the vault, in characters. */
function pesoDoVideo(video: VideoGuardado): number {
  return video.b64.length
}

/**
 * Store the bytes of a video, within the media budget.
 *
 * **Counts in the same budget as photos** (`HISTORY_MEDIA_BUDGET_BYTES`)
 * and **evicts first** when the budget overflows: a video weighs what dozens
 * of photos weigh, and evicting it frees more with less loss. From the evicted
 * video everything in the `post` remains: the name, duration, and thumbnail.
 *
 * A video larger than the entire budget does not enter: it would enter and
 * leave in the same write, and cost the write. It stays in the session memory
 * (`VideosDaSessao`). Returns whether it was stored.
 */
export function guardarVideo(contents: VaultContents, sha: string, b64: string, at: number): boolean {
  if (!videoCabeNoCofre(contents, b64.length)) return false
  contents.videos = { ...contents.videos, [sha]: { b64, at } }
  enforceMediaBudget(contents)
  return contents.videos?.[sha] !== undefined
}

/**
 * Whether a video of `characters` in base64 fits in the vault alongside photos.
 *
 * Stored videos do not count: they evict first to make room. Photos count: if
 * the video does not fit alongside them, it would enter, evict all old videos,
 * and leave in the same write. Refusing early keeps old videos where they are.
 * Also prevents passing a 25 MB base64 video that will not fit (`videos.ts`).
 */
export function videoCabeNoCofre(contents: VaultContents, caracteres: number): boolean {
  if (caracteres > HISTORY_MEDIA_BUDGET_BYTES) return false
  let fotografias = 0
  for (const list of [...Object.values(contents.history), ...Object.values(contents.estadoDoCanal ?? {})]) {
    for (const entry of list) fotografias += entryMediaBytes(entry)
  }
  return caracteres + fotografias <= HISTORY_MEDIA_BUDGET_BYTES
}

/** Delete the bytes of a video from the vault (the send was cancelled, or the post deleted). Returns whether they were there. */
export function apagarVideo(contents: VaultContents, sha: string): boolean {
  if (!contents.videos || !Object.hasOwn(contents.videos, sha)) return false
  // New map instead of deleting from the existing one, for the same reason as `evictEntryMedia`.
  const ficam = { ...contents.videos }
  delete ficam[sha]
  contents.videos = ficam
  return true
}

/** The bytes of a stored video in the vault, in base64url, or `null`. */
export function videoNoCofre(contents: VaultContents, sha: string): string | null {
  const videos = contents.videos
  if (!videos || !Object.hasOwn(videos, sha)) return null
  return videos[sha]?.b64 ?? null
}

function enforceMediaBudget(contents: VaultContents): void {
  const carriers: StoredChatMessage[] = []
  let total = 0
  // Videos count first and evict first: oldest first.
  const videos = Object.entries(contents.videos ?? {}).sort(([, a], [, b]) => a.at - b.at)
  for (const [, video] of videos) total += pesoDoVideo(video)
  // The two lists: posts with photos live in the state book.
  for (const list of [...Object.values(contents.history), ...Object.values(contents.estadoDoCanal ?? {})]) {
    for (const entry of list) {
      const bytes = entryMediaBytes(entry)
      if (bytes > 0) {
        carriers.push(entry)
        total += bytes
      }
    }
  }
  if (total <= HISTORY_MEDIA_BUDGET_BYTES) return

  // Videos before photos. New map instead of deleting from the existing one,
  // for the same reason as `evictEntryMedia`.
  if (videos.length > 0) {
    const ficam = { ...contents.videos }
    for (const [sha, video] of videos) {
      if (total <= HISTORY_MEDIA_BUDGET_BYTES) break
      total -= pesoDoVideo(video)
      delete ficam[sha]
    }
    contents.videos = ficam
    if (total <= HISTORY_MEDIA_BUDGET_BYTES) return
  }

  // Oldest first, by the sender-claimed timestamp: the newest images are the
  // ones someone is most likely to still be looking at.
  carriers.sort((a, b) => a.at - b.at)
  for (const entry of carriers) {
    if (total <= HISTORY_MEDIA_BUDGET_BYTES) break
    total -= entryMediaBytes(entry)
    evictEntryMedia(entry)
  }
}

/**
 * How many entries of the book (friendships and invites) a channel stores, apart
 * from the cap.
 *
 * The book does not count toward `HISTORY_MAX_PER_CHANNEL`, but has its own cap:
 * without one, someone sharing a channel with us could fill our vault with
 * repeated requests. Two hundred is way above what a real friendship writes
 * (a handful of actions in a lifetime), and whoever fills it only confuses the
 * ties with whoever is in that channel, which in a direct message is themselves.
 */
export const LEDGER_MAX_PER_CHANNEL = 200

/**
 * The caps of the state book, by type and by channel (phase S2, §6.2 of the plan).
 *
 * Each with its own reason:
 *
 * - `book` (friendships and invites): `LEDGER_MAX_PER_CHANNEL`, above.
 * - `post`: one thousand posts per channel. Arrivals get a wall, not a
 *   biography, and a text post weighs about 130 bytes in the vault (S0).
 * - `comment` and `like`: five thousand per channel. A live feed does this over
 *   years, and five thousand comments weigh about 0.8 MB (S0, 162 bytes each).
 * - `ticket`: two thousand ticket messages per channel (opens, decisions,
 *   responses). A real board closes long before this.
 * - `edit` (edits and tombstones): two thousand per channel. Edits evict first;
 *   a tombstone only evicts after all edits, and never while the target is in
 *   either list: the tombstone is what keeps the target from returning.
 *
 * Above each cap, the oldest of that type evicts, by server order. The byte
 * cap from the plan (2 MB per channel) does not apply here: measuring it on
 * every write cost more than it saved, and the per-type caps already enforce
 * it (worst case measured in S0, 1,000 posts and 5,000 comments, is 1.4 MB).
 */
export const TECTOS_DO_ESTADO = {
  livro: LEDGER_MAX_PER_CHANNEL,
  publicacao: 1_000,
  comentario: 5_000,
  gosto: 5_000,
  ticket: 2_000,
  emenda: 2_000,
} as const

export type TipoDoEstado = keyof typeof TECTOS_DO_ESTADO

/**
 * Whether this entry is from the book: a friendship action or an invite to a
 * channel.
 *
 * These are the entries that `foldFriendTies` and `foldInviteTies` extract from
 * to find who has standing in what. Cutting them with messages erased
 * friendships (F1 of the 2026-10-20 audit). The form matches what folds read
 * (`isFriendPayload`, `isInvitePayload`), written here so the vault does not
 * depend on the protocol for four names.
 */
export function ehDoLivro(entry: StoredChatMessage): boolean {
  const tipo = entry.payload["t"]
  if (tipo === "friend.request" || tipo === "friend.accept" || tipo === "friend.decline" || tipo === "friend.remove") {
    return true
  }
  if (tipo !== "message") return false
  // Same rule as `isInvitePayload` in the protocol (M4): present means present.
  return entry.payload["invite"] !== undefined || entry.payload["inviteReply"] !== undefined
}

/**
 * Which part of the state book this entry belongs to, or `null` if it is chat.
 *
 * A message is state only if it is an invite (book) or belongs to a ticket.
 * An `edit` or `redact` is state always, even over a chat message: the
 * tombstone must survive the cap, or the original resent would return.
 */
export function tipoDoEstado(entry: StoredChatMessage): TipoDoEstado | null {
  if (ehDoLivro(entry)) return "livro"
  switch (entry.payload["t"]) {
    case "post":
      return "publicacao"
    case "post.comment":
      return "comentario"
    case "post.reaction":
      return "gosto"
    case "edit":
    case "redact":
      return "emenda"
    case "message":
      return entry.payload["ticket"] !== undefined ? "ticket" : null
    default:
      return null
  }
}

/**
 * Entries from the book that change nothing in state, and evict first (I4).
 *
 * A friendship action identical to the previous one from the same sender in the
 * same channel, with no other friendship action in between, does not change the
 * fold: asking when already asked, accepting when already accepted, refusing or
 * undoing again. This is exactly what the repeat of the last action (F4) writes.
 * Cutting by position would evict the original request first and leave two
 * hundred repeated accepts, and without the request the fold refuses the accept:
 * the friendship vanished from too much confirmation.
 *
 * By server order, with our sends in the place they were said (the rule from
 * `dobras.ts`). Invites do not count here: each is about a channel and do not
 * repeat by design.
 */
function redundantesDoLivro(list: readonly StoredChatMessage[]): Set<StoredChatMessage> {
  const redundantes = new Set<StoredChatMessage>()
  let anterior: StoredChatMessage | undefined
  for (const entrada of porOrdem(list)) {
    const tipo = entrada.payload["t"]
    if (typeof tipo !== "string" || !tipo.startsWith("friend.")) continue
    if (anterior && anterior.sender === entrada.sender && anterior.payload["t"] === tipo) redundantes.add(entrada)
    else anterior = entrada
  }
  return redundantes
}

/** A list by server order, without changing it (the rule from `dobras.ts`). */
function porOrdem(list: readonly StoredChatMessage[]): StoredChatMessage[] {
  const chaves = chavesDeOrdem(list)
  return list
    .map((entrada, indice) => ({ entrada, indice, chave: chaves[indice] ?? -1 }))
    .sort((a, b) => a.chave - b.chave || a.indice - b.indice)
    .map((item) => item.entrada)
}

/**
 * Trim chat to the last `HISTORY_MAX_PER_CHANNEL`, without changing the order.
 *
 * In a version 2 vault the list holds only chat. A state entry still there
 * (written by hand in a test, or by an old path) does not count and does not
 * evict: its place is the state book, and the migration takes it.
 */
function apararConversa(list: StoredChatMessage[]): void {
  let comuns = 0
  for (const entry of list) if (tipoDoEstado(entry) === null) comuns += 1
  let tirar = Math.max(0, comuns - HISTORY_MAX_PER_CHANNEL)
  if (tirar === 0) return
  let escrita = 0
  for (const entry of list) {
    if (tirar > 0 && tipoDoEstado(entry) === null) {
      tirar -= 1
      continue
    }
    list[escrita++] = entry
  }
  list.length = escrita
}

/** The `id`s still stored in a channel: what a tombstone must keep blocking. */
function alvosGuardados(contents: VaultContents, channel: string): Set<string> {
  const alvos = new Set<string>()
  for (const list of [contents.history[channel] ?? [], contents.estadoDoCanal?.[channel] ?? []]) {
    for (const entry of list) {
      const t = entry.payload["t"]
      if (t === "edit" || t === "redact") continue
      const id = entry.payload["id"]
      if (typeof id === "string") alvos.add(id)
    }
  }
  return alvos
}

/**
 * The ticket messages to remove for the book to return to cap (finding 10 from
 * the 0.7.0 review), from a list already by server order.
 *
 * Cutting the oldest message would evict opens first: a ticket with replies and
 * no open stays without subject and without owner, and without owner only the
 * responder can touch it (`ticketsOf`). So, in this order:
 *
 * 1. closed tickets, whole, oldest touched first;
 * 2. simple replies to open ones (no subject, state, or responder), oldest first:
 *    the board stays the same, only the chat shortens;
 * 3. open tickets, whole, oldest touched first.
 *
 * An open never evicts alone. Closed is the last state said to be `closed`,
 * regardless of who said it: this decides what stores, not what shows.
 */
function ticketsParaSair(ordenadas: readonly StoredChatMessage[], excesso: number): Set<StoredChatMessage> {
  const marcaDe = (entry: StoredChatMessage): Record<string, unknown> =>
    (entry.payload["ticket"] ?? {}) as Record<string, unknown>
  const porTicket = new Map<string, { entradas: StoredChatMessage[]; ultima: number; fechado: boolean }>()
  ordenadas.forEach((entry, posicao) => {
    if (tipoDoEstado(entry) !== "ticket") return
    const marca = marcaDe(entry)
    const id = typeof marca["id"] === "string" ? marca["id"] : `sem-id|${posicao}`
    const ticket = porTicket.get(id) ?? { entradas: [], ultima: posicao, fechado: false }
    ticket.entradas.push(entry)
    ticket.ultima = posicao
    if (typeof marca["state"] === "string") ticket.fechado = marca["state"] === "closed"
    porTicket.set(id, ticket)
  })
  const sair = new Set<StoredChatMessage>()
  const inteiros = (fechados: boolean): void => {
    const tickets = [...porTicket.values()].filter((t) => t.fechado === fechados).sort((a, b) => a.ultima - b.ultima)
    for (const ticket of tickets) {
      if (sair.size >= excesso) return
      for (const entry of ticket.entradas) sair.add(entry)
    }
  }
  inteiros(true)
  for (const entry of ordenadas) {
    if (sair.size >= excesso) break
    if (sair.has(entry) || tipoDoEstado(entry) !== "ticket") continue
    const marca = marcaDe(entry)
    const simples = marca["subject"] === undefined && marca["state"] === undefined && marca["assignee"] === undefined
    if (simples && typeof marca["id"] === "string" && porTicket.get(marca["id"])?.fechado === false) sair.add(entry)
  }
  if (sair.size < excesso) inteiros(false)
  return sair
}

/**
 * Trim the state book to the caps for each type, without changing the order.
 *
 * First what changes nothing (repeats in the friendship book); then, by type,
 * oldest by server order. In edits, edits evict before tombstones, and a
 * tombstone whose target is still stored does not evict.
 */
function apararEstado(contents: VaultContents, channel: string): void {
  const list = contents.estadoDoCanal?.[channel]
  if (!list) return
  const contagem: Record<TipoDoEstado, number> = { livro: 0, publicacao: 0, comentario: 0, gosto: 0, ticket: 0, emenda: 0 }
  for (const entry of list) {
    const tipo = tipoDoEstado(entry)
    if (tipo) contagem[tipo] += 1
  }
  const excesso = (tipo: TipoDoEstado): number => Math.max(0, contagem[tipo] - TECTOS_DO_ESTADO[tipo])
  if ((Object.keys(contagem) as TipoDoEstado[]).every((tipo) => excesso(tipo) === 0)) return

  const sair = new Set<StoredChatMessage>()
  const marcar = (entry: StoredChatMessage, tipo: TipoDoEstado): void => {
    sair.add(entry)
    contagem[tipo] -= 1
  }
  if (excesso("livro") > 0) {
    for (const entry of redundantesDoLivro(list)) if (excesso("livro") > 0) marcar(entry, "livro")
  }
  const ordenadas = porOrdem(list)
  // Tickets evict as whole tickets, not by oldest message: see `ticketsParaSair`.
  if (excesso("ticket") > 0) for (const entry of ticketsParaSair(ordenadas, excesso("ticket"))) marcar(entry, "ticket")
  const alvos = excesso("emenda") > 0 ? alvosGuardados(contents, channel) : new Set<string>()
  // Three passes: edits, then tombstones (only if still over), then the rest.
  for (const fase of ["edit", "redact", "resto"] as const) {
    for (const entry of ordenadas) {
      if (sair.has(entry)) continue
      const tipo = tipoDoEstado(entry)
      if (!tipo || excesso(tipo) === 0) continue
      if (tipo === "emenda") {
        if (entry.payload["t"] !== fase) continue
        const alvo = entry.payload["target"]
        if (fase === "redact" && typeof alvo === "string" && alvos.has(alvo)) continue
      } else if (fase !== "resto") {
        continue
      }
      marcar(entry, tipo)
    }
  }
  if (sair.size === 0) return
  // In place, like `apararConversa`: the caller might be holding the list.
  let escrita = 0
  for (const entry of list) if (!sair.has(entry)) list[escrita++] = entry
  list.length = escrita
}

/** The room of an entry: the `room` tag, or the default room (`""`). */
function salaDaEntrada(entry: StoredChatMessage): string {
  const sala = entry.payload["room"]
  return typeof sala === "string" ? sala : ""
}

/**
 * Entries in a list that fall OUTSIDE the media window: those not among the
 * `HISTORY_MEDIA_RECENT` most recent messages in their room.
 *
 * **Per room, not by the channel's entire list.** The rooms in a community are
 * tags (`room`) inside a single MLS channel, so they share the channel's two
 * lists. Counted by the list, the window was for all rooms together: 41 messages
 * in the "announcements" room would take the thumbnail of a video said in the
 * "chat" room out of the vault, and it would never come back (owner report on
 * 3/11/2026: "YouTube thumbnails show in private messages but not in community
 * rooms"). A direct is one room only, and stays as it was. The global budget
 * (`HISTORY_MEDIA_BUDGET_BYTES`) stays the limit for everything.
 */
function foraDaJanelaDeMedia(list: readonly StoredChatMessage[]): Set<StoredChatMessage> {
  const fora = new Set<StoredChatMessage>()
  const vistas = new Map<string, number>()
  for (let index = list.length - 1; index >= 0; index--) {
    const entry = list[index]
    if (!entry) continue
    const sala = salaDaEntrada(entry)
    const n = (vistas.get(sala) ?? 0) + 1
    vistas.set(sala, n)
    if (n > HISTORY_MEDIA_RECENT) fora.add(entry)
  }
  return fora
}

function enforceHistoryLimits(contents: VaultContents, channel: string): void {
  const conversa = contents.history[channel]
  if (conversa) apararConversa(conversa)
  apararEstado(contents, channel)
  // The media window is by list and by room: the 40 most recent in each room
  // of the chat and book (the posts) store the bytes.
  for (const list of [contents.history[channel], contents.estadoDoCanal?.[channel]]) {
    if (!list) continue
    for (const entry of foraDaJanelaDeMedia(list)) evictEntryMedia(entry)
  }
  enforceMediaBudget(contents)
}

/** The list this entry lives in: the state book or the chat. */
function listaDe(contents: VaultContents, channel: string, entry: StoredChatMessage): StoredChatMessage[] {
  if (tipoDoEstado(entry) !== null) {
    contents.estadoDoCanal ??= {}
    return (contents.estadoDoCanal[channel] ??= [])
  }
  return (contents.history[channel] ??= [])
}

/**
 * Append one entry to a channel's history and enforce every limit in the same
 * mutation: the per-channel cap, the per-channel media window, and the global
 * media budget. The entry is cloned on the way in, so later evictions can
 * never reach back and mutate a payload the UI is still rendering.
 *
 * **Route to the right list.** State entries go to the state book
 * (`estadoDoCanal`), outside the message cap; conversation entries go to
 * `history`. See `tipoDoEstado`.
 *
 * **Don't store what's already stored** (S1, §7.4 of the plan). Two keys, and
 * either one is enough:
 *
 * - the server's `seq`, which is unique in the channel: the same event fetched
 *   twice (live and recovery, or on a `backfillBefore` page);
 * - `tipo|autor|id` (`chaveDoEvento`), for what is resent with a new `seq`:
 *   wall republishes, comment resends, likes, votes and own tickets, outbox.
 *   Without this, each resend would be a new entry, the screen would show
 *   duplicates, and the cap would fill with what was already there. A tombstone
 *   doesn't repeat, and that's how a deleted post came back.
 *
 * By author too, not just by `id`: the `id` comes from the sender, and an `id`
 * repeated by someone else is a different message. Without the author in the
 * key, one member could hide another's message by publishing first with their
 * `id`.
 *
 * What gets lost, stated in full: a republish can bring photos that the stored
 * copy already lost to the media budget, and keeping the stored copy means
 * losing them. See `colapsarCopias` in `dobras.ts`, which picks the copy with
 * media among those in view.
 */
export function appendHistory(contents: VaultContents, channel: string, entry: StoredChatMessage): void {
  if (entry.seq >= 0) {
    const ocupada = entradaComSeq(contents, channel, entry.seq)
    const ocupacao = ocupada ? cederSeqRelatado(ocupada, entry) : "cede"
    if (ocupacao === "confirmou-com-bytes") enforceHistoryLimits(contents, channel)
    if (ocupacao !== "cede") return
  }
  const list = listaDe(contents, channel, entry)
  const guardada = jaGuardada(list, entry)
  if (guardada === "confirmou-com-bytes") enforceHistoryLimits(contents, channel)
  if (guardada !== "nova") return
  list.push({ ...entry, payload: structuredClone(entry.payload) })
  enforceHistoryLimits(contents, channel)
}

/** The entry with this `seq` in either list. */
function entradaComSeq(contents: VaultContents, channel: string, seq: number): StoredChatMessage | undefined {
  return (
    (contents.history[channel] ?? []).find((entrada) => entrada.seq === seq) ??
    (contents.estadoDoCanal?.[channel] ?? []).find((entrada) => entrada.seq === seq)
  )
}

/** Whether this channel's `seq` is already in either list. */
function seqGuardado(contents: VaultContents, channel: string, seq: number): boolean {
  return entradaComSeq(contents, channel, seq) !== undefined
}

/**
 * A server event arrives with a `seq` that a report already holds (S4, review
 * 6). A report's `seq` is told by who reports and is not signed: it cannot
 * delete the real event at that `seq`, which is the case if a report lands on a
 * gap that recovery fills later.
 *
 * - Another event: the reported one yields the `seq` (gets -1 and the order mark
 *   right before it) and the server one enters. Returns `"cede"`.
 * - The same event (same key): the server confirmed the report, which stops being
 *   reported, and gets the bytes from the server copy (`confirmarRelato`). Nothing
 *   to append.
 * - The occupant is not reported, or the arrival is also a report: the `seq` is
 *   already taken, as always. Returns `"tomada"`.
 */
function cederSeqRelatado(ocupada: StoredChatMessage, chega: StoredChatMessage): "cede" | Confirmacao {
  if (!ocupada.relatada || chega.relatada) return "tomada"
  const chave = chaveDoEvento(chega)
  if (chave !== null && chave === chaveDoEvento(ocupada)) return confirmarRelato(ocupada, chega)
  const seq = ocupada.seq
  ocupada.seq = -1
  ocupada.apos = seq - 1
  return "cede"
}

/**
 * What happened to an entry already stored, when another copy of the same event
 * arrives. `"confirmou-com-bytes"`: the payload changed, and the caller must
 * enforce the vault limits again.
 */
type Confirmacao = "tomada" | "confirmou" | "confirmou-com-bytes"

/**
 * The server confirms a stored report: the event from the same author, same `id`,
 * arriving via MLS.
 *
 * The server `seq` stays, that is the real one (the report's is not signed). And
 * the bytes from the server copy too, if it brings more than the reported one.
 * A report goes without bytes on purpose (`payloadSemBytes`): without the card
 * thumbnail, which authorship does not sign, and with attachments as markers.
 * In a community the report might arrive before the server event, and keeping it
 * meant staying forever without the video thumbnail, which no one sends on request
 * (owner report with 1.1.0: "the app still has no YouTube thumbnails in
 * communities"). The server copy is the original, from the sender authenticated
 * by MLS, and is the same message (the key has the author): the whole payload
 * swaps. Still one entry.
 *
 * Only in confirmation: after it, a republish or a new report find an entry that
 * is no longer reported, and change nothing.
 */
function confirmarRelato(guardada: StoredChatMessage, chega: StoredChatMessage): Confirmacao {
  if (!guardada.relatada || chega.relatada || chega.seq < 0) return "tomada"
  guardada.seq = chega.seq
  delete guardada.apos
  delete guardada.relatada
  if (entryMediaBytes(chega) <= entryMediaBytes(guardada)) return "confirmou"
  // A new copy, not the same one changed, for the reason in `evictEntryMedia`.
  guardada.payload = structuredClone(chega.payload)
  return "confirmou-com-bytes"
}

/**
 * Whether this entry is one the list already has: same type, same author, same `id`.
 * `"nova"` if not.
 *
 * A stored report and the same event arriving from the server: keep the stored
 * one, with the server's `seq` and bytes (`confirmarRelato`).
 */
function jaGuardada(list: readonly StoredChatMessage[], entry: StoredChatMessage): "nova" | Confirmacao {
  const chave = chaveDoEvento(entry)
  if (chave === null) return "nova"
  const guardada = list.find((item) => chaveDoEvento(item) === chave)
  if (!guardada) return "nova"
  return confirmarRelato(guardada, entry)
}

/**
 * Merge a recovered page of *older* messages in front of what is stored.
 * Deduplicated by `seq` and by `chaveDoEvento`, each entry to its own list,
 * then run through the same limits as any append.
 */
export function mergeOlderHistory(contents: VaultContents, channel: string, older: StoredChatMessage[]): void {
  if (older.length === 0) return
  contents.estadoDoCanal ??= {}
  const conversa = contents.history[channel] ?? []
  const estado = contents.estadoDoCanal[channel] ?? []
  const porSeq = new Map([...conversa, ...estado].filter((entry) => entry.seq >= 0).map((entry) => [entry.seq, entry]))
  const known = new Set(porSeq.keys())
  // A report that holds the `seq` of an event on this page yields it (see `cederSeqRelatado`).
  let comBytes = false
  for (const item of older) {
    const ocupada = item.seq >= 0 ? porSeq.get(item.seq) : undefined
    if (!ocupada) continue
    const ocupacao = cederSeqRelatado(ocupada, item)
    if (ocupacao === "cede") known.delete(item.seq)
    if (ocupacao === "confirmou-com-bytes") comBytes = true
  }
  const frescasConversa: StoredChatMessage[] = []
  const frescasEstado: StoredChatMessage[] = []
  for (const entry of older.filter((item) => item.seq >= 0 && !known.has(item.seq)).sort((a, b) => a.seq - b.seq)) {
    const doEstado = tipoDoEstado(entry) !== null
    const guardadas = doEstado ? estado : conversa
    const frescas = doEstado ? frescasEstado : frescasConversa
    // Compared against what is stored and against what this screen already brought:
    // the screen can have the original and the repost both inside it.
    const nestas = jaGuardada(guardadas, entry)
    if (nestas === "confirmou-com-bytes") comBytes = true
    if (nestas !== "nova" || jaGuardada(frescas, entry) !== "nova") continue
    known.add(entry.seq)
    frescas.push({ ...entry, payload: structuredClone(entry.payload) })
  }
  if (frescasConversa.length === 0 && frescasEstado.length === 0) {
    if (comBytes) enforceHistoryLimits(contents, channel)
    return
  }
  if (frescasConversa.length > 0) contents.history[channel] = [...frescasConversa, ...conversa]
  if (frescasEstado.length > 0) contents.estadoDoCanal[channel] = [...frescasEstado, ...estado]
  enforceHistoryLimits(contents, channel)
}

/**
 * Entries that a SIBLING device had in a channel, for this device's vault (the
 * cross-device history, 1.0 "Arca"). Returns how many went in.
 *
 * Not `mergeOlderHistory`: that puts a server page ahead of what is stored, and
 * only accepts real `seq` values. A sibling also has what came after this
 * device's position (what this device missed while offline) and account sends
 * that never got an echo (`seq` -1 with `apos`). So here each entry goes to its
 * place by sort key, and entries already here don't change order among
 * themselves.
 *
 * **No duplicates** (same rule as `appendHistory`): the server `seq`, and
 * `tipo|autor|id` (`chaveDoEvento`). A send with no echo and no `id` has no
 * key, and doesn't go in: without a key, each repeated transfer made a copy.
 *
 * **Tombstones stay.** A tombstone (`redact`) comes with the rest of the state
 * book, and folds hide the target, as always. A tombstone this device has and
 * the sibling doesn't hides the original that the sibling sends.
 *
 * **The vault cap wins at the end**, like any write (`enforceHistoryLimits`):
 * 400 messages per channel, the state book caps, the window, and the media
 * budget.
 */
export function fundirEntradasDoIrmao(contents: VaultContents, channel: string, entradas: readonly StoredChatMessage[]): number {
  contents.estadoDoCanal ??= {}
  const listas = { conversa: contents.history[channel] ?? [], estado: contents.estadoDoCanal[channel] ?? [] }
  const seqs = new Set([...listas.conversa, ...listas.estado].filter((entrada) => entrada.seq >= 0).map((entrada) => entrada.seq))
  const chaves = new Set<string>()
  for (const entrada of [...listas.conversa, ...listas.estado]) {
    const chave = chaveDoEvento(entrada)
    if (chave !== null) chaves.add(chave)
  }
  const novas = { conversa: [] as StoredChatMessage[], estado: [] as StoredChatMessage[] }
  for (const entrada of entradas) {
    if (entrada.seq >= 0 && seqs.has(entrada.seq)) {
      /*
        An entry in the state book that this device only has inherited from the
        snapshot (the short form, which it never decrypted): the sibling has the
        full event, and that one stays in its place.
      */
      if (!entrada.herdado) {
        const herdada = listas.estado.find((item) => item.herdado && item.seq === entrada.seq && item.payload.t === entrada.payload.t)
        if (herdada) {
          herdada.payload = structuredClone(entrada.payload)
          herdada.sender = entrada.sender
          herdada.at = entrada.at
          delete herdada.herdado
          continue
        }
      }
      // The same event is already here. If what is here is a telemetry report without
      // echo, the sibling's `seq` confirms it: the sibling received it from the server.
      const chave = chaveDoEvento(entrada)
      if (chave !== null) {
        const guardada = [...listas.conversa, ...listas.estado].find((item) => item.relatada && chaveDoEvento(item) === chave)
        if (guardada && guardada.seq === entrada.seq && !entrada.relatada) delete guardada.relatada
      }
      continue
    }
    const chave = chaveDoEvento(entrada)
    if (chave === null && entrada.seq < 0) continue
    if (chave !== null && chaves.has(chave)) {
      // A send from this account that stayed here without echo, and that the sibling
      // saw with the server's `seq`: it gets that one (what `confirmarSeq` does with
      // the echo).
      if (entrada.seq >= 0 && confirmarSeq(contents, channel, chave, entrada.seq)) seqs.add(entrada.seq)
      continue
    }
    if (entrada.seq >= 0) seqs.add(entrada.seq)
    if (chave !== null) chaves.add(chave)
    const copia: StoredChatMessage = { ...entrada, payload: structuredClone(entrada.payload) }
    // The sibling already judged what came from them. These marks are from the sibling's vault.
    delete copia.relatada
    ;(tipoDoEstado(copia) !== null ? novas.estado : novas.conversa).push(copia)
  }
  const entraram = novas.conversa.length + novas.estado.length
  if (entraram === 0) return 0
  if (novas.conversa.length > 0) contents.history[channel] = intercalarPorOrdem(listas.conversa, novas.conversa)
  if (novas.estado.length > 0) contents.estadoDoCanal[channel] = intercalarPorOrdem(listas.estado, novas.estado)
  enforceHistoryLimits(contents, channel)
  return entraram
}

/**
 * Put `new` into `stored` by sort key, without changing the order of stored
 * entries among themselves. An old send without echo and without `apos` has the
 * key of where it sits (the largest `seq` before it): it gains `apos` with it,
 * so it does not change key by having new entries in front. The version 2
 * migration did the same.
 */
function intercalarPorOrdem(guardadas: StoredChatMessage[], novas: StoredChatMessage[]): StoredChatMessage[] {
  const chavesGuardadas = chavesDeOrdem(guardadas)
  guardadas.forEach((entrada, indice) => {
    if (entrada.seq < 0 && entrada.apos === undefined) entrada.apos = chavesGuardadas[indice] ?? -1
  })
  const chavesNovas = chavesDeOrdem(novas)
  const ordenadas = novas
    .map((entrada, indice) => ({ entrada, chave: chavesNovas[indice] ?? -1, indice }))
    .sort((a, b) => a.chave - b.chave || a.indice - b.indice)
  const juntas: StoredChatMessage[] = []
  let i = 0
  for (const { entrada, chave } of ordenadas) {
    // A new entry comes after stored entries with smaller or equal key: in a tie,
    // what this device already showed comes first.
    while (i < guardadas.length && (chavesGuardadas[i] ?? -1) <= chave) juntas.push(guardadas[i++] as StoredChatMessage)
    juntas.push(entrada)
  }
  while (i < guardadas.length) juntas.push(guardadas[i++] as StoredChatMessage)
  return juntas
}

/**
 * The media bytes that a sibling has from an entry this vault stores without
 * them (the history between devices). Only what is missing here enters: a
 * dumped attachment (the `evicted` marker), or a card thumbnail that is not
 * there. The text and the rest of the entry stay as they are here. Returns
 * whether anything changed.
 *
 * After, the vault's media budget rules, as in any write.
 */
export function juntarMediaDoIrmao(contents: VaultContents, channel: string, chave: string, payload: StoredPayload): boolean {
  let mudou = false
  for (const list of [contents.history[channel] ?? [], contents.estadoDoCanal?.[channel] ?? []]) {
    const entrada = list.find((item) => chaveDoEvento(item) === chave)
    if (!entrada) continue
    const proximo = structuredClone(entrada.payload)
    for (const key of MEDIA_KEYS) {
      const aqui = proximo[key]
      const la = payload[key]
      if (!Array.isArray(aqui) || !Array.isArray(la)) continue
      proximo[key] = aqui.map((item: unknown, indice) => {
        const doIrmao: unknown = la[indice]
        if (carriesBytes(item) || !carriesBytes(doIrmao)) return item
        const marca = item as Record<string, unknown>
        // Same attachment: same name and same type. Different, and leave it alone.
        if (marca["name"] !== doIrmao["name"] || marca["mediaType"] !== doIrmao["mediaType"]) return item
        mudou = true
        return structuredClone(doIrmao)
      })
    }
    const cartoesAqui = proximo[LINK_KEY]
    const cartoesLa = payload[LINK_KEY]
    if (Array.isArray(cartoesAqui) && Array.isArray(cartoesLa)) {
      proximo[LINK_KEY] = cartoesAqui.map((cartao: unknown, indice) => {
        const doIrmao: unknown = cartoesLa[indice]
        if (thumbnailBytes(cartao) > 0 || thumbnailBytes(doIrmao) === 0) return cartao
        const deLa = doIrmao as Record<string, unknown>
        if (typeof cartao !== "object" || cartao === null || (cartao as Record<string, unknown>)["url"] !== deLa["url"]) return cartao
        mudou = true
        return { ...(cartao as Record<string, unknown>), thumbnail: deLa["thumbnail"] }
      })
    }
    // A new copy, not the same one changed, for the reason in `evictEntryMedia`.
    if (mudou) entrada.payload = proximo
    break
  }
  if (mudou) enforceHistoryLimits(contents, channel)
  return mudou
}

/**
 * If the entry with this key is here without the bytes the sibling has, and fits
 * in the vault's media window (the `HISTORY_MEDIA_RECENT` most recent ones in
 * its room, in its list: `foraDaJanelaDeMedia`). Outside the window, the bytes
 * would enter and leave in the same write: do not request them.
 */
export function faltaMediaDaEntrada(contents: VaultContents, channel: string, chave: string, bytesNoIrmao: number): boolean {
  for (const list of [contents.history[channel] ?? [], contents.estadoDoCanal?.[channel] ?? []]) {
    const entrada = list.find((item) => chaveDoEvento(item) === chave)
    if (!entrada) continue
    if (foraDaJanelaDeMedia(list).has(entrada)) return false
    return entryMediaBytes(entrada) < bytesNoIrmao
  }
  return false
}

/**
 * The two lists of a channel together, by server order: the conversation and the
 * state book.
 *
 * A merge, not a sort: each list stays in its order and only interleaves by sort
 * key (`chavesDeOrdem`). In a tie the conversation comes first. Returns the vault
 * entries (not copies): whoever wants to change them, clone.
 */
export function entradasDoCanal(contents: VaultContents, channel: string): StoredChatMessage[] {
  const a = contents.history[channel] ?? []
  const b = contents.estadoDoCanal?.[channel] ?? []
  if (b.length === 0) return [...a]
  if (a.length === 0) return [...b]
  const ka = chavesDeOrdem(a)
  const kb = chavesDeOrdem(b)
  const juntas: StoredChatMessage[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && (ka[i] ?? -1) <= (kb[j] ?? -1))) juntas.push(a[i++] as StoredChatMessage)
    else juntas.push(b[j++] as StoredChatMessage)
  }
  return juntas
}

/** The channels with something stored, in one of the two lists. */
export function canaisComEntradas(contents: VaultContents): string[] {
  return [...new Set([...Object.keys(contents.history), ...Object.keys(contents.estadoDoCanal ?? {})])]
}

/**
 * The `seq` of the echo of a send of ours: the entry stored with `-1` becomes the
 * server's `seq` (S1, §7.2 of the plan).
 *
 * Search in both lists for an entry from `sender` without `seq`, with the same
 * `chaveDoEvento`. If the `seq` is already stored (the echo arrived via two paths),
 * do nothing. Returns whether anything changed.
 */
export function confirmarSeq(contents: VaultContents, channel: string, chave: string, seq: number): boolean {
  if (seq < 0 || seqGuardado(contents, channel, seq)) return false
  for (const list of [contents.estadoDoCanal?.[channel] ?? [], contents.history[channel] ?? []]) {
    const entrada = list.find((guardada) => guardada.seq < 0 && chaveDoEvento(guardada) === chave)
    if (!entrada) continue
    entrada.seq = seq
    delete entrada.apos
    return true
  }
  return false
}

/**
 * Whether the event with this `chaveDoEvento` is already stored with the server's
 * `seq`.
 *
 * So the send does not mark in `enviosPorConfirmar` a resend of what already has
 * `seq` (finding 5 from the 0.7.0 review): its echo changes nothing (whoever
 * receives deduplicates by key), and the mark only wasted the mark limit, which a
 * resend of hundreds of entries filled above the new sends waiting.
 */
export function chaveConfirmada(contents: VaultContents, channel: string, chave: string): boolean {
  for (const list of [contents.estadoDoCanal?.[channel] ?? [], contents.history[channel] ?? []]) {
    if (list.some((guardada) => guardada.seq >= 0 && chaveDoEvento(guardada) === chave)) return true
  }
  return false
}

/** Forget everything a channel stores, in both lists. */
export function esquecerEntradas(contents: VaultContents, channel: string): void {
  delete contents.history[channel]
  if (contents.estadoDoCanal) delete contents.estadoDoCanal[channel]
}

/**
 * The migration from version 1 to 2 of the vault: the state book leaves `history`.
 *
 * Once, when opening an old vault, and idempotent (running twice changes nothing).
 * For each channel:
 *
 * 1. Our sends without `seq` gain the `apos` mark, taken from the ENTIRE list
 *    before it is split. After the split, their sort key would be taken only from
 *    the half where they stay, and would change.
 * 2. State entries move to `estadoDoCanal`, in the same order.
 * 3. The `livroHerdado` from the pairing enters the same book, marked as
 *    `inherited`. An inherited entry with the same `seq` and `t` as an entry
 *    already stored is the same entry seen twice, and counts as one.
 *
 * Nothing is lost: what was in `history` now sits in one of the two lists.
 *
 * **One channel at a time, and a broken channel does not block the others**
 * (finding 15 from the 0.7.0 review). This runs inside `#adopt`, before the
 * vault opens: an entry that does not read (a `null`, a missing `payload`)
 * threw, and the entire vault stopped opening because of one line. The channel
 * that fails stays as it was, and the rest migrates. The list swap only happens
 * at the end of each channel: an error halfway does not leave half the channel
 * on each side.
 */
export function migrarParaLivroDeEstado(contents: VaultContents): void {
  contents.estadoDoCanal ??= {}
  const livros = contents.estadoDoCanal
  for (const [channel, list] of Object.entries(contents.history)) {
    try {
      if (!list.some((entrada) => tipoDoEstado(entrada) !== null)) continue
      const chaves = chavesDeOrdem(list)
      const conversa: StoredChatMessage[] = []
      const estado = [...(livros[channel] ?? [])]
      const apos = new Map<StoredChatMessage, number>()
      list.forEach((entrada, indice) => {
        if (entrada.seq < 0 && entrada.apos === undefined) apos.set(entrada, chaves[indice] ?? -1)
        if (tipoDoEstado(entrada) !== null) estado.push(entrada)
        else conversa.push(entrada)
      })
      for (const [entrada, marca] of apos) entrada.apos = marca
      contents.history[channel] = conversa
      livros[channel] = estado
    } catch {
      // Stays as it was: reads with today's rules, and the conversation does not get lost.
    }
  }
  const herdadosPorJuntar: Record<string, EntradaHerdada[]> = {}
  for (const [channel, herdados] of Object.entries(contents.livroHerdado ?? {})) {
    try {
      juntarHerdados(contents, channel, herdados)
    } catch {
      herdadosPorJuntar[channel] = herdados
    }
  }
  if (Object.keys(herdadosPorJuntar).length > 0) contents.livroHerdado = herdadosPorJuntar
  else delete contents.livroHerdado
}

/**
 * The book of friendships from a pairing, for the state book of this device.
 * Ahead of what is there, because it was said before this device had a place.
 * Without duplicating what is already stored with the same `seq` and `t`.
 */
export function juntarHerdados(contents: VaultContents, channel: string, herdados: readonly EntradaHerdada[]): void {
  contents.estadoDoCanal ??= {}
  const guardadas = [...(contents.history[channel] ?? []), ...(contents.estadoDoCanal[channel] ?? [])]
  const vistos = new Set(guardadas.filter((entrada) => entrada.seq >= 0).map((entrada) => `${entrada.seq}|${entrada.payload.t}`))
  const novos: StoredChatMessage[] = []
  for (const herdado of herdados) {
    const chave = `${herdado.seq}|${herdado.t}`
    if (herdado.seq >= 0 && vistos.has(chave)) continue
    vistos.add(chave)
    novos.push({
      seq: herdado.seq,
      sender: herdado.sender,
      at: herdado.sentAt ?? 0,
      herdado: true,
      payload: {
        t: herdado.t,
        ...(herdado.sentAt !== undefined ? { sentAt: herdado.sentAt } : {}),
        ...(herdado.note !== undefined ? { note: herdado.note } : {}),
        ...(herdado.withdrawn ? { withdrawn: true } : {}),
      },
    })
  }
  if (novos.length === 0) return
  contents.estadoDoCanal[channel] = [...novos, ...(contents.estadoDoCanal[channel] ?? [])]
  apararEstado(contents, channel)
}

/**
 * A role assignment (`role.assign`), if it beats the one stored (F11).
 *
 * The full list of roles for the person, not a change. It beats on the larger
 * timestamp of who assigned it (`assignedAt`), and the server's `seq` breaks ties
 * (`venceCarimbo`). Without a stored timestamp (old vault), the arriving one
 * wins, as before. The authority of who assigned is from the caller (`#mandaEm`).
 *
 * @returns whether it was saved.
 */
export function aplicarAtribuicao(
  contents: VaultContents,
  channel: string,
  address: string,
  roles: readonly string[],
  carimbo: { at: number; seq: number; por: string; autoria?: unknown },
): boolean {
  const carimbos = contents.channelMemberRolesAt?.[channel] ?? {}
  if (!venceCarimbo(carimbos[address], carimbo)) return false
  const doCanal = contents.channelMemberRoles[channel] ?? {}
  doCanal[address] = [...new Set(roles)]
  contents.channelMemberRoles[channel] = doCanal
  // The authorship of who assigned (phase 1 of 1.1): the payload is remade with the timestamp and verified in the portrait.
  carimbos[address] = {
    at: carimbo.at,
    ...(carimbo.seq >= 0 ? { seq: carimbo.seq } : {}),
    por: carimbo.por,
    ...(carimbo.autoria !== undefined ? { autoria: structuredClone(carimbo.autoria) } : {}),
  }
  contents.channelMemberRolesAt = { ...contents.channelMemberRolesAt, [channel]: carimbos }
  return true
}

/** Keep the freshest profile per address, compared by the sender's own clock. */
export function upsertDirectory(contents: VaultContents, address: string, payload: StoredPayload, at: number): void {
  // The mural secret (D1), separate and before storing the version: see `muraisDosOutros`.
  const mural = (payload as { mural?: unknown }).mural
  if (typeof mural === "string" && /^[A-Za-z0-9_-]{43}$/.test(mural)) {
    contents.muraisDosOutros = { ...contents.muraisDosOutros, [address]: mural }
  }
  const current = contents.directory[address]
  if (current && current.at > at) return
  contents.directory[address] = { at, payload: structuredClone(payload) }
}

/** A profile of another person, as it travels between the account's devices. See `PerfilDeOutraPessoa` in the protocol. */
export interface PerfilDeOutraQueViaja {
  displayName: string
  statusText?: string | undefined
  activity?: string | undefined
  updatedAt: number
}

/**
 * The profiles of other people this vault knows, for the siblings (profiles
 * between devices). Without portraits, newest version first, up to the limit.
 *
 * Only with version stated by the person (`updatedAt` greater than zero): a
 * profile without it stayed in the directory with the time it arrived, and that
 * time would tell a sibling a version the person never wrote. Without our own
 * address: our profile travels separately (`PerfilDaConta`).
 */
export function perfisParaOsIrmaos(contents: VaultContents, eu: string, tecto: number): Record<string, PerfilDeOutraQueViaja> {
  const perfis: [string, PerfilDeOutraQueViaja][] = []
  for (const [address, guardado] of Object.entries(contents.directory)) {
    if (address === eu) continue
    const perfil = perfilQueViaja(guardado.payload)
    if (perfil) perfis.push([address, perfil])
  }
  perfis.sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  return Object.fromEntries(perfis.slice(0, Math.max(0, tecto)))
}

/** What from a stored `profile` payload travels between devices, or `null` if there is no name or version. */
export function perfilQueViaja(payload: StoredPayload): PerfilDeOutraQueViaja | null {
  const nome = payload["displayName"]
  const versao = payload["updatedAt"]
  if (typeof nome !== "string" || nome.length === 0 || nome.length > 64) return null
  if (typeof versao !== "number" || !Number.isInteger(versao) || versao <= 0) return null
  const estado = payload["statusText"]
  const activity = payload["activity"]
  return {
    displayName: nome,
    ...(typeof estado === "string" && estado.length <= 128 ? { statusText: estado } : {}),
    ...(typeof activity === "string" && /^[a-z][a-z0-9]{1,23}$/.test(activity) ? { activity } : {}),
    updatedAt: versao,
  }
}

/**
 * The profiles a sibling reported, in the directory (profiles between devices).
 * Returns the addresses that changed.
 *
 * Only a version GREATER than the stored one enters. At the same version, what is
 * here already is at least as good (came from the person themselves, with the
 * portrait) and does not swap for a copy without it. What the new version does
 * not say (the portrait, the bio, the email, the support channels) stays from the
 * previous version: a new name with an old portrait is better than a new name
 * with no portrait, and the full profile of the person, when it arrives, replaces
 * everything (the same version reaches `upsertDirectory`, which swaps the entire
 * entry). It stays `partial` until then.
 */
export function fundirPerfisDeOutros(
  contents: VaultContents,
  eu: string,
  perfis: Readonly<Record<string, PerfilDeOutraQueViaja>>,
): string[] {
  const mudaram: string[] = []
  for (const [address, perfil] of Object.entries(perfis)) {
    if (address === eu || !perfil.displayName || !(perfil.updatedAt > 0)) continue
    const actual = contents.directory[address]
    if (actual && actual.at >= perfil.updatedAt) continue
    // The authorship of the previous version also leaves: it signed another version,
    // and a profile remade with it would not verify (the portrait from Welcome, phase
    // 1 of 1.1).
    const { statusText: _estado, activity: _actividade, autoria: _autoria, ...anterior }: Record<string, unknown> = actual?.payload ?? {}
    contents.directory[address] = {
      at: perfil.updatedAt,
      payload: {
        donations: [],
        ...structuredClone(anterior),
        t: "profile",
        displayName: perfil.displayName,
        ...(perfil.statusText !== undefined ? { statusText: perfil.statusText } : {}),
        ...(perfil.activity !== undefined ? { activity: perfil.activity } : {}),
        updatedAt: perfil.updatedAt,
      },
      parcial: true,
    }
    mudaram.push(address)
  }
  return mudaram
}

/** Same, for the presentation of a channel. See `spaceMeta`. */
export function upsertSpaceMeta(contents: VaultContents, channel: string, payload: StoredPayload, at: number): void {
  const current = contents.spaceMeta[channel]
  if (current && current.at > at) return
  contents.spaceMeta[channel] = { at, payload: structuredClone(payload) }
}

/** Where the ciphertext lives, and whether the platform can hold a key for us. */
export interface VaultBackend {
  read(): Promise<Uint8Array | null>
  write(bytes: Uint8Array): Promise<void>
  clear(): Promise<void>
  /** True when `wrapKey`/`unwrapKey` can be used instead of a passphrase. */
  readonly supportsOsProtection: boolean
  wrapKey?(key: Uint8Array): Promise<Uint8Array>
  unwrapKey?(wrapped: Uint8Array): Promise<Uint8Array>
  /**
   * Where this platform stores the remembered session. Missing: does not store,
   * and the "Remember session" checkbox does not appear. See `MemoriaDaSessao`.
   */
  readonly memoria?: MemoriaDaSessao
}

/**
 * The remembered session: the VAULT KEY (the 32 bytes from Argon2id), stored in
 * a separate record, next to the vault and outside it, wrapped by the platform.
 * Never the passphrase.
 *
 * What this guarantees, and the `vault.memoria.test.ts` tests pin down:
 *
 * - the record does not live inside the `VaultFile`, and remembering or
 *   forgetting never writes to the vault;
 * - `exportVault` does not see it: the account file never carries the key;
 * - it is always the CURRENT key of the vault. Everything that changes the key
 *   (`create`, `importVault`, `confirmarProvisorio`) deletes it, and `destroy`
 *   does too;
 * - without it, or with a record that no longer opens the vault, the gate asks
 *   for the password as it always did.
 *
 * The envelope is from the platform: `safeStorage` on the desktop (Keychain on
 * macOS, DPAPI on Windows), a non-extractable AES-GCM `CryptoKey` in the browser.
 * See `docs/THREAT-MODEL.md`, "The session can be remembered".
 */
export interface MemoriaDaSessao {
  /** How the key is wrapped. For diagnostics and threat model only. */
  readonly via: "safeStorage" | "webcrypto"
  /** The platform has, NOW, somewhere to store securely. */
  disponivel(): Promise<boolean>
  /** There is a stored record. Does not open it. */
  existe(): Promise<boolean>
  guardar(chave: Uint8Array): Promise<void>
  /** The stored key, or `null` without a record or with a record that no longer opens. */
  ler(): Promise<Uint8Array | null>
  /** Deletes the record. No record, does nothing. */
  apagar(): Promise<void>
}

/**
 * What the bridges answer to `vault.status()`. See `Vault.estado`.
 *
 * `protection` is from THIS vault (read from the plaintext envelope, without
 * decrypting), not from the device: it is what `supportsOsProtection` never said
 * (finding 9 from `docs/PENDENTES.md`). `memoriaDisponivel` and `sessaoMemorizada`
 * only exist when the platform knows how to remember.
 */
export interface EstadoDoCofre {
  exists: boolean
  supportsOsProtection: boolean
  versao?: VersaoDoFicheiroDoCofre
  protection?: "os" | "passphrase"
  memoriaDisponivel?: boolean
  sessaoMemorizada?: boolean
}

interface VaultFile {
  version: number
  protection: "os" | "passphrase"
  salt?: string
  nonce: string
  ciphertext: string
  wrappedKey?: string
}

/**
 * The version of the vault file format.
 *
 * It was written on each save and never read anywhere: a number that only served
 * to give the impression there was a migration path. There was not: a vault saved
 * by a future version was opened the same way, read with today's rules, and saved
 * again with this number on top.
 *
 * While the format was only an encrypted blob with all fields inside, the cost of
 * that was small: `#adopt` copies what it does not know and returns it intact at
 * the next save. It stops being small on the day the format changes SHAPE, and
 * that is what is proposed in `docs/PENDENTES.md`, with history leaving the blob
 * for its own pieces. That day, an old client opening a new vault reads
 * `history: {}`, concludes there is no history, and saves that conclusion over
 * what was there. The whole conversation, erased by an old version that did
 * nothing but fail to understand what it saw.
 *
 * So: backward it opens (that is what `#adopt` does, and that is the migration
 * that exists); forward it refuses, with a message that says what to do.
 */
export const VERSAO_DO_COFRE = 2

/*
  Version 2 (20/10/2026, phase S2 of absolute sync): the state book
  (`estadoDoCanal`) leaves `history`. A version 1 vault opens and migrates on
  opening (`migrarParaLivroDeEstado`, in `#adopt`), and saves as 2 at the next
  write. A version 1 bundle refuses a version 2 vault, which is why the number
  goes up: it read `history` without the book and saved over the mural,
  friendships and tickets.
*/

/**
 * The version of this file, or the refusal to read it.
 *
 * A vault without the field counts as the initial format: absence is before the
 * mechanism, never after.
 */
function versaoLegivel(file: VaultFile): number {
  const versao = typeof file.version === "number" ? file.version : 1
  if (versao > VERSAO_DO_COFRE) {
    throw new Error("this vault was written by a newer version of the app")
  }
  return versao
}

/*
  base64url without padding, for vault encryption (S2, 20/10/2026).

  Same encoding as `toBase64`/`fromBase64` in the protocol, byte by byte (there
  is a test comparing them). The protocol one builds the string one character at
  a time: in a 3 MB vault that was 47 of the 57 ms per write, measured on the
  bench (`scripts/medir-cofre.mjs`), and 57 ms per open. Here we write to a
  `Uint8Array` and decode all at once. For vault encryption only: the rest of
  the protocol uses small strings, where the difference does not show.
*/
const ALFABETO_BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
const CODIGOS_BASE64 = Uint8Array.from(ALFABETO_BASE64, (letra) => letra.charCodeAt(0))
const VALORES_BASE64 = (() => {
  const valores = new Int16Array(128).fill(-1)
  for (let i = 0; i < ALFABETO_BASE64.length; i++) valores[ALFABETO_BASE64.charCodeAt(i)] = i
  // The protocol one also accepts the standard alphabet.
  valores["+".charCodeAt(0)] = 62
  valores["/".charCodeAt(0)] = 63
  return valores
})()

/** Bytes to base64url without padding. Same as `toBase64` in the protocol. */
export function bytesParaBase64(bytes: Uint8Array): string {
  const inteiros = Math.floor(bytes.length / 3)
  const resto = bytes.length % 3
  const saida = new Uint8Array(inteiros * 4 + (resto === 0 ? 0 : resto + 1))
  let j = 0
  for (let i = 0; i < inteiros * 3; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number)
    saida[j++] = CODIGOS_BASE64[n >>> 18] as number
    saida[j++] = CODIGOS_BASE64[(n >>> 12) & 63] as number
    saida[j++] = CODIGOS_BASE64[(n >>> 6) & 63] as number
    saida[j++] = CODIGOS_BASE64[n & 63] as number
  }
  if (resto > 0) {
    const a = bytes[inteiros * 3] as number
    const b = resto === 2 ? (bytes[inteiros * 3 + 1] as number) : 0
    saida[j++] = CODIGOS_BASE64[a >>> 2] as number
    saida[j++] = CODIGOS_BASE64[((a & 3) << 4) | (b >>> 4)] as number
    if (resto === 2) saida[j++] = CODIGOS_BASE64[(b & 15) << 2] as number
  }
  return new TextDecoder().decode(saida)
}

/**
 * base64url (or standard, with or without padding) to bytes. Same as `fromBase64`
 * in the protocol, except the error message: an invalid character means a
 * corrupted vault file, and we use the message the vault already has for that.
 */
export function base64ParaBytes(texto: string): Uint8Array {
  let fim = texto.indexOf("=")
  if (fim < 0) fim = texto.length
  const saida = new Uint8Array(Math.floor((fim * 6) / 8))
  let bits = 0
  let valor = 0
  let j = 0
  for (let i = 0; i < fim; i++) {
    const codigo = texto.charCodeAt(i)
    const indice = codigo < 128 ? (VALORES_BASE64[codigo] as number) : -1
    if (indice < 0) throw new Error("the vault file is damaged", { cause: { base64: i } })
    valor = ((valor << 6) | indice) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      saida[j++] = (valor >>> bits) & 0xff
    }
  }
  return saida
}

/**
 * Argon2id parameters.
 *
 * Sized so one guess costs ~64 MiB and a noticeable fraction of a second. The
 * point is not to make a good passphrase better; it is to make a mediocre one
 * expensive to attack offline once someone has the file.
 */
const KDF = { t: 3, m: 65_536, p: 4, dkLen: 32 } as const

/** The Argon2id parameters, as `KDF` fixes them. */
export interface ParametrosDoKdf {
  t: number
  m: number
  p: number
  dkLen: number
}

/**
 * How the vault key is derived, and why this can be swapped out.
 *
 * **What changes is WHERE the computation runs, never WHAT it computes.** The
 * parameters still come from here (`KDF`, right above) and travel as an argument:
 * whoever replaces this function receives them and does not choose them. An
 * implementation that derives a different key than `@noble` will not open any
 * existing vault, that is the silent disaster this design prevents, and there
 * is a test on the web host side comparing them byte for byte.
 *
 * The reason is mobile. Argon2id costs 64 MiB and three rounds by design, which
 * on a phone is one to seven seconds, and running on the main thread, that is
 * one to seven seconds of frozen screen, indistinguishable from a crashed app.
 * The web host passes through here a derivation that runs in a Worker: the same
 * work, the same key, on another thread.
 */
export type DerivarChaveDoCofre = (
  frase: string,
  sal: Uint8Array,
  parametros: ParametrosDoKdf,
) => Promise<Uint8Array>

/** The default derivation: right here, on this thread, with `@noble/hashes`. */
const derivarAqui: DerivarChaveDoCofre = async (frase, sal, parametros) =>
  argon2id(new TextEncoder().encode(frase), sal, parametros)

/** A write requested by `Vault.updateEmBreve` and not yet done. */
interface GravacaoAdiada {
  promessa: Promise<void>
  resolver: () => void
  rejeitar: (erro: unknown) => void
  temporizador: ReturnType<typeof setTimeout>
}

export class Vault {
  #backend: VaultBackend
  #key: Uint8Array | null = null
  // Annotated, not inferred: `new Uint8Array(16)` narrows to
  // `Uint8Array<ArrayBuffer>`, which then rejects the decoded salt.
  #salt: Uint8Array = new Uint8Array(16)
  #protection: "os" | "passphrase" = "passphrase"
  #contents: VaultContents = newVaultContents()
  /**
   * The open vault is TEMPORARY: it lives in memory only, and what is on disk
   * is something else (the account this device already had). See `criarProvisorio`.
   */
  #provisorio = false

  #derivar: DerivarChaveDoCofre

  /**
   * No `derivar` means derivation on this thread, which is what has always been
   * done and what the desktop app still does. See `DerivarChaveDoCofre`.
   */
  constructor(backend: VaultBackend, derivar: DerivarChaveDoCofre = derivarAqui) {
    this.#backend = backend
    this.#derivar = derivar
  }

  get supportsOsProtection(): boolean {
    return this.#backend.supportsOsProtection
  }

  get unlocked(): boolean {
    return this.#key !== null
  }

  get contents(): VaultContents {
    if (!this.#key) throw new Error("vault is locked")
    return this.#contents
  }

  async exists(): Promise<boolean> {
    return (await this.#backend.read()) !== null
  }

  /**
   * The version of the file on disk, from the plaintext header alone, or `null`
   * if there is no file. Never decrypts and never derives: this is what the gate
   * checks before asking for the passphrase, so a beta vault never reaches
   * `unlock`. See `cabecalhoDoCofre.ts`.
   */
  async versaoNoDisco(): Promise<VersaoDoFicheiroDoCofre | null> {
    const raw = await this.#backend.read()
    return raw === null ? null : versaoDoFicheiro(raw)
  }

  /**
   * What the bridges return to `vault.status()`, in a read of the header alone
   * and nothing else. It lives here, not in each bridge, so the web and desktop
   * apps say exactly the same thing (the parity that 1j made with the temporary).
   */
  async estado(): Promise<EstadoDoCofre> {
    const raw = await this.#backend.read()
    const versao = raw === null ? null : versaoDoFicheiro(raw)
    const protection = raw === null || versao !== "orwv2" ? undefined : proteccaoEmClaro(raw)
    const memoria = this.#backend.memoria
    return {
      exists: versao !== null,
      supportsOsProtection: this.supportsOsProtection,
      ...(versao !== null ? { versao } : {}),
      ...(protection ? { protection } : {}),
      ...(memoria
        ? { memoriaDisponivel: await memoria.disponivel().catch(() => false), sessaoMemorizada: await memoria.existe().catch(() => false) }
        : {}),
    }
  }

  // ------------------------------------------------ the remembered session

  /**
   * Remember the session on this device: store the ACTUAL key of the open vault
   * in the platform registry. Does not write to the vault.
   *
   * Only for a vault with passphrase: an `os` vault opens by itself, and a
   * temporary one is not yet the vault of this device.
   */
  async memorizar(): Promise<void> {
    if (!this.#key || this.#provisorio) throw new Error("vault is locked")
    if (this.#protection !== "passphrase") throw new Error("this vault has no passphrase to remember")
    const memoria = this.#backend.memoria
    if (!memoria || !(await memoria.disponivel())) throw new Error("this device cannot remember the session")
    await memoria.guardar(this.exportSessionKey())
  }

  /**
   * Open the vault with the remembered session, if there is one. `false` when
   * there is no record, when the vault is not passphrase-protected, or when the
   * record no longer opens this vault; in that last case the record is erased,
   * so the gate does not try an old key again.
   *
   * A vault of a different version or from the beta throws, like `unlock`: that
   * is the error the gate must show, not the passphrase.
   */
  async abrirMemorizada(): Promise<boolean> {
    const memoria = this.#backend.memoria
    if (!memoria) return false
    const chave = await memoria.ler().catch(() => null)
    if (!chave) return false
    try {
      await this.unlockWithKey(chave)
      return true
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : ""
      if (mensagem === "wrong passphrase, or the vault is damaged" || mensagem === "this vault needs the system keychain") {
        await memoria.apagar().catch(() => {})
        return false
      }
      if (mensagem === "no vault to open") return false
      throw erro
    }
  }

  /**
   * An `os` vault (system keychain only, no passphrase) becomes a passphrase
   * vault in one write: the new key derives from the passphrase with a new salt,
   * and the content is saved sealed by it. A failed write leaves the vault as it
   * was, open and `os`.
   *
   * This is F3's convergence: after this, "Sign out" signs out for real, and
   * the vault can go in an account file without asking for another passphrase.
   */
  async definirPalavraPasse(frase: string): Promise<void> {
    if (!this.#key || this.#provisorio) throw new Error("vault is locked")
    if (this.#protection !== "os") throw new Error("this vault already has a passphrase")
    const nova = await this.#derivarChaveNova(frase)
    // Derivation yielded to the event loop: someone may have locked in the meantime.
    if (!this.#key || this.#provisorio || this.#protection !== "os") {
      nova.key.fill(0)
      throw new Error("vault is locked")
    }
    const antiga = { key: this.#key, salt: this.#salt, protection: this.#protection }
    this.#adoptarChave(nova)
    try {
      await this.#persist()
    } catch (erro) {
      this.#adoptarChave(antiga)
      nova.key.fill(0)
      throw erro
    }
    antiga.key.fill(0)
    await this.#largarMemoria()
  }

  /** Forget the remembered session. Does not lock or touch the vault. */
  async esquecerSessao(): Promise<void> {
    await this.#backend.memoria?.apagar()
  }

  /** A memory that stopped working (the vault key changed): erase it, without throwing. */
  async #largarMemoria(): Promise<void> {
    await this.#backend.memoria?.apagar().catch(() => {})
  }

  /**
   * The seal of the file on disk, or the refusal to read it. A file without the
   * `orwv2` header is from the beta and stops here, before any key: 1.0 never
   * reads a beta vault.
   */
  #lerFicheiro(raw: Uint8Array): VaultFile {
    const json = semCabecalho(raw)
    if (json === null) throw new Error("this vault is from the beta")
    return JSON.parse(json) as VaultFile
  }

  async create(passphrase: string | null, initial = newVaultContents()): Promise<void> {
    await this.#chaveNova(passphrase)
    this.#provisorio = false
    this.#contents = initial
    try {
      await this.#persist()
      // A new vault has a new key: any memory that was there belonged to another.
      await this.#largarMemoria()
    } catch (erro) {
      /**
       * An account that never made it to disk does not stay open in memory.
       *
       * This is the only place in the vault where undo is safe, and so the only
       * place where we do it: an instant before nothing existed, so there is no
       * cryptographic progress here to lose, unlike `update`, where memory stays
       * ahead of disk on purpose (see the comment down there).
       *
       * Without this, a failed write, full storage, locked file, would leave
       * `unlocked` saying yes and `exists()` saying no, about the same vault.
       * Anyone who went ahead would have an identity that lived only in RAM:
       * keys, groups and messages that vanished on close, with nothing to say so.
       */
      this.lock()
      throw erro
    }
  }

  /** The key of a vault that does not yet exist: from the system (`null`) or derived from the passphrase. */
  async #chaveNova(passphrase: string | null): Promise<void> {
    this.#adoptarChave(await this.#derivarChaveNova(passphrase))
  }

  /**
   * The new key computed WITHOUT touching the open vault. Derivation is the slow
   * step (Argon2id, one second or more); whoever asks for it before releasing
   * the current vault does not go that whole time without an open vault. See
   * `criarProvisorio`.
   */
  async #derivarChaveNova(
    passphrase: string | null,
  ): Promise<{ key: Uint8Array; salt: Uint8Array; protection: "os" | "passphrase" }> {
    if (passphrase === null) {
      if (!this.#backend.supportsOsProtection) {
        throw new Error("this platform cannot protect a vault without a passphrase")
      }
      return { key: crypto.getRandomValues(new Uint8Array(32)), salt: this.#salt, protection: "os" }
    }
    const salt = crypto.getRandomValues(new Uint8Array(16))
    return { key: await this.#derivar(passphrase, salt, KDF), salt, protection: "passphrase" }
  }

  #adoptarChave(nova: { key: Uint8Array; salt: Uint8Array; protection: "os" | "passphrase" }): void {
    this.#key = nova.key
    this.#salt = nova.salt
    this.#protection = nova.protection
  }

  /**
   * A new vault, open and NOT touching disk: the one from pairing that will
   * replace this device's account (core 1j, "Sign in with another account").
   *
   * While it is temporary, every `update` stays in memory and the disk file
   * stays the old account's, untouched. There are two ways out, and only two:
   *
   * - `confirmarProvisorio()`, after the new account is proven (the certificate
   *   arrived and the session connected with it): write the temporary over the
   *   old one in a single write, like `importVault`. There is no instant when
   *   the device is left without an account.
   * - `descartarProvisorio()` (or `lock()`), when pairing fails or the person
   *   leaves: memory clears and disk did not change. The old account opens as
   *   before.
   *
   * The old order was reversed: delete the account from here BEFORE the link,
   * because the core needed an empty vault. An expired link, a network drop or
   * a "No" from the other side left the device without an account at all.
   */
  async criarProvisorio(passphrase: string | null): Promise<void> {
    // Derivation first, with the current vault still open: "Merge accounts"
    // (phase 8.2) calls this with the old account's session running, and the swap,
    // from here down, has no wait in the middle.
    const nova = await this.#derivarChaveNova(passphrase)
    this.lock()
    this.#adoptarChave(nova)
    this.#contents = newVaultContents()
    this.#provisorio = true
  }

  /** The open vault lives in memory only, and the disk one is something else. */
  get provisorio(): boolean {
    return this.#provisorio && this.#key !== null
  }

  /**
   * The temporary becomes this device's vault: a write over the old one. A failed
   * write leaves it temporary (and the old one on disk), and throws: whoever calls
   * does not tell the other device it is ready.
   */
  async confirmarProvisorio(): Promise<void> {
    if (!this.provisorio) return
    this.#provisorio = false
    try {
      await this.#persist()
    } catch (erro) {
      this.#provisorio = true
      throw erro
    }
    // This device's account became another, with another key. Whoever wants to
    // remember the new one asks again (`memorizar`).
    await this.#largarMemoria()
  }

  /** Release the temporary. Disk did not change, and the old account opens as before. */
  descartarProvisorio(): void {
    if (this.#provisorio) this.lock()
  }

  async unlock(passphrase?: string): Promise<void> {
    const raw = await this.#backend.read()
    if (!raw) throw new Error("no vault to open")

    const file = this.#lerFicheiro(raw)
    // Before touching the key: a vault of a version this app does not know does
    // not open, so it is not rewritten with old rules.
    versaoLegivel(file)
    this.#provisorio = false
    this.#protection = file.protection

    if (file.protection === "os") {
      if (!file.wrappedKey || !this.#backend.unwrapKey) {
        throw new Error("this vault needs the system keychain")
      }
      this.#key = await this.#backend.unwrapKey(fromBase64(file.wrappedKey))
    } else {
      if (passphrase === undefined) throw new Error("this vault needs a passphrase")
      if (!file.salt) throw new Error("the vault file is damaged", { cause: { falta: "salt" } })
      this.#salt = fromBase64(file.salt)
      this.#key = await this.#derivar(passphrase, this.#salt, KDF)
    }

    let plaintext: Uint8Array
    try {
      plaintext = xchacha20poly1305(this.#key, fromBase64(file.nonce)).decrypt(base64ParaBytes(file.ciphertext))
    } catch {
      // Wipe the derived key before reporting failure, so a wrong passphrase
      // does not leave usable material behind.
      this.#key.fill(0)
      this.#key = null
      throw new Error("wrong passphrase, or the vault is damaged")
    }

    this.#adopt(JSON.parse(new TextDecoder().decode(plaintext)) as Partial<VaultContents>)
  }

  /** Merge decrypted contents over defaults, so a vault written before a
   * field existed still opens. */
  #adopt(stored: Partial<VaultContents>): void {
    const defaults = newVaultContents()
    this.#contents = {
      ...defaults,
      ...stored,
      groups: stored.groups ?? {},
      pendingKeyPackages: stored.pendingKeyPackages ?? [],
      profile: { ...defaults.profile, ...stored.profile },
      mintedInvites: stored.mintedInvites ?? {},
      lastSeq: stored.lastSeq ?? {},
      history: stored.history ?? {},
      estadoDoCanal: stored.estadoDoCanal ?? {},
      directory: stored.directory ?? {},
      notifications: stored.notifications ?? [],
      deadWelcomes: stored.deadWelcomes ?? [],
      repairAttempts: stored.repairAttempts ?? {},
      publishedProfileAt: stored.publishedProfileAt ?? {},
      ...(stored.profileRepairRound !== undefined ? { profileRepairRound: stored.profileRepairRound } : {}),
      ...(stored.sframeReservas !== undefined ? { sframeReservas: stored.sframeReservas } : {}),
      ...(stored.lacunas !== undefined ? { lacunas: stored.lacunas } : {}),
      ...(stored.serverResetAtMinute !== undefined ? { serverResetAtMinute: stored.serverResetAtMinute } : {}),
      ...(stored.identityCreatedAtMinute !== undefined
        ? { identityCreatedAtMinute: stored.identityCreatedAtMinute }
        : {}),
      transmitters: stored.transmitters ?? {},
      deviceManifests: stored.deviceManifests ?? {},
      ...(stored.bootstrapDone ? { bootstrapDone: true } : {}),
    }
    // The migration from version 1 (the state book outside `history`). Idempotent:
    // in a version 2 vault it finds nothing to change.
    migrarParaLivroDeEstado(this.#contents)
  }

  /**
   * The derived vault key, copied out for a host that wants to survive a page
   * reload without re-asking for the passphrase.
   *
   * Deliberately explicit rather than automatic: where the copy goes is the
   * host's decision and the host's risk. The web host puts it in
   * sessionStorage — per-tab, gone when the tab closes — never anywhere
   * durable, and never the passphrase itself.
   */
  exportSessionKey(): Uint8Array {
    if (!this.#key) throw new Error("vault is locked")
    const copy = new Uint8Array(this.#key.length)
    copy.set(this.#key)
    return copy
  }

  /** Open with a previously exported key: same decrypt, same failure paths,
   * minus the Argon2id work — which is what makes a reload instant. */
  async unlockWithKey(key: Uint8Array): Promise<void> {
    const raw = await this.#backend.read()
    if (!raw) throw new Error("no vault to open")

    const file = this.#lerFicheiro(raw)
    versaoLegivel(file)
    if (file.protection !== "passphrase") throw new Error("this vault needs the system keychain")
    this.#provisorio = false
    if (file.salt) this.#salt = fromBase64(file.salt)
    this.#protection = file.protection
    this.#key = key

    let plaintext: Uint8Array
    try {
      plaintext = xchacha20poly1305(this.#key, fromBase64(file.nonce)).decrypt(base64ParaBytes(file.ciphertext))
    } catch {
      this.#key.fill(0)
      this.#key = null
      throw new Error("wrong passphrase, or the vault is damaged")
    }
    this.#adopt(JSON.parse(new TextDecoder().decode(plaintext)) as Partial<VaultContents>)
  }

  /**
   * Change the content and write it, in that order, and the order is the call.
   *
   * The obvious reading is that it is backwards: the change goes to memory before
   * the write happens, so a failed write leaves memory ahead of disk. That was the
   * proposal from the audit, and it was measured and REJECTED. The reason is all
   * in whoever calls this.
   *
   * What comes through here is not a preference you can forget: it is the MLS
   * state after the ratchet has run, and the anchor `lastSeq` that says how far
   * we have read. Neither can be undone. A received message consumed generations
   * that do not come back; restoring the old anchor makes the client ask again
   * for an event it can no longer decrypt, and a few of those declare the channel
   * deaf and fire repair, which erases history. Undoing here would be, in the
   * best case, losing what `#drainRecords` already pulled from `Session`'s queues;
   * in the worst, trading a full disk for a deleted conversation.
   *
   * So memory stays optimistic on purpose, and whoever handles the failure knows
   * what it means: `Session.flush` restores the dirty marks and the next write
   * takes it all. The test that fixes this contract is in `vault.test.ts`, and
   * it exists precisely so the inversion is not done blind again.
   *
   * See `docs/PENDENTES.md`, "O cofre: o que se corrigiu e o que se recusou".
   */
  async update(mutate: (contents: VaultContents) => void): Promise<void> {
    if (!this.#key) throw new Error("vault is locked")
    mutate(this.#contents)
    // A deferred write that has not yet left goes in this one: what it held is
    // already in the content, and this write takes the whole thing.
    const adiada = this.#tirarAdiada()
    try {
      await this.#persist()
    } catch (erro) {
      adiada?.rejeitar(erro)
      throw erro
    }
    adiada?.resolver()
  }

  /**
   * `update` with the deferred and shared write: the change goes straight to
   * memory, and the disk gets it on the next write, at most `JANELA_DA_GRAVACAO_MS`
   * later. All changes in that window come out in one write.
   *
   * **Why** (slow-after-enter, 4/11/2026). Each write is the entire vault: JSON,
   * XChaCha20-Poly1305 in JS and base64, on the page thread (web) or main process
   * (desktop). About 6 ms per MB on an M4. The session wrote once per live event,
   * and one entry in `!984` is about 115 events (the cascade of assignments,
   * rooms and categories): with a 13 MB vault, 116 writes and 7 s of CPU per
   * entry, in tasks of 60 to 160 ms in a row. That was the freeze.
   *
   * **What stays.** The disk always has a consistent snapshot of memory at one
   * instant: the anchor (`lastSeq`) and the groups the mutation serializes go
   * into the content together, like before. A crash in the window leaves the disk
   * at the old snapshot, with the old anchor, and recovery asks the server for
   * those events again: the same as a crash between an event and its write. So
   * this is only for what the server replenishes. What it does not (our sends,
   * SFrame counters, key packages, unconfirmed commits) still uses `update`, which
   * writes now and carries what is deferred.
   */
  updateEmBreve(mutate: (contents: VaultContents) => void): Promise<void> {
    if (!this.#key) return Promise.reject(new Error("vault is locked"))
    mutate(this.#contents)
    if (this.#adiada) return this.#adiada.promessa
    let resolver!: () => void
    let rejeitar!: (erro: unknown) => void
    const promessa = new Promise<void>((sim, nao) => {
      resolver = sim
      rejeitar = nao
    })
    const temporizador = setTimeout(() => void this.gravarAdiada().catch(() => {}), Vault.JANELA_DA_GRAVACAO_MS)
    this.#adiada = { promessa, resolver, rejeitar, temporizador }
    return promessa
  }

  /** The limit on wait time for a deferred write. See `updateEmBreve`. */
  static JANELA_DA_GRAVACAO_MS = 1_000

  /** There is a deferred write to do. */
  get gravacaoAdiada(): boolean {
    return this.#adiada !== null
  }

  /** Write now what is deferred. With nothing deferred, do nothing. */
  async gravarAdiada(): Promise<void> {
    const adiada = this.#tirarAdiada()
    if (!adiada) return
    try {
      await this.#persist()
    } catch (erro) {
      adiada.rejeitar(erro)
      throw erro
    }
    adiada.resolver()
  }

  #adiada: GravacaoAdiada | null = null

  #tirarAdiada(): GravacaoAdiada | null {
    const adiada = this.#adiada
    if (!adiada) return null
    this.#adiada = null
    clearTimeout(adiada.temporizador)
    return adiada
  }

  async #persist(): Promise<void> {
    if (!this.#key) throw new Error("vault is locked")
    // Temporary: memory is the vault, and disk holds the old account until
    // `confirmarProvisorio`. See `criarProvisorio`.
    if (this.#provisorio) return

    const nonce = crypto.getRandomValues(new Uint8Array(24))
    const plaintext = new TextEncoder().encode(JSON.stringify(this.#contents))
    const ciphertext = xchacha20poly1305(this.#key, nonce).encrypt(plaintext)

    const file: VaultFile = {
      version: VERSAO_DO_COFRE,
      protection: this.#protection,
      nonce: toBase64(nonce),
      ciphertext: bytesParaBase64(ciphertext),
      ...(this.#protection === "passphrase" ? { salt: toBase64(this.#salt) } : {}),
      ...(this.#protection === "os" && this.#backend.wrapKey
        ? { wrappedKey: toBase64(await this.#backend.wrapKey(this.#key)) }
        : {}),
    }

    await this.#backend.write(comCabecalho(JSON.stringify(file)))
  }

  /**
   * The account as a file: the encrypted vault, wrapped in a small envelope.
   *
   * Never plaintext, what leaves here is exactly what sits on disk, still
   * sealed by the passphrase. An OS-protected vault (whose key lives in a
   * keychain that cannot travel) must hand a passphrase in, and the export is
   * re-encrypted under it. The file IS the account: whoever holds it plus the
   * passphrase holds everything, and the UI says so in as many words.
   */
  async exportVault(passphrase?: string): Promise<Uint8Array> {
    // With an open provisional, the file on disk is the OLD account: exporting it
    // now would give the wrong account to the caller.
    if (this.#provisorio) throw new Error("vault is locked")
    // The account file leaves the disk: first what is still only in memory.
    await this.gravarAdiada()
    const raw = await this.#backend.read()
    if (!raw) throw new Error("no vault to open")
    const file = this.#lerFicheiro(raw)

    let payload: VaultFile
    if (file.protection === "passphrase") {
      payload = { ...file }
      delete payload.wrappedKey
    } else {
      // The keychain does not travel; re-seal the live contents under the
      // passphrase chosen for the journey.
      if (!this.#key) throw new Error("vault is locked")
      if (!passphrase) throw new Error("an export passphrase is required")
      const salt = crypto.getRandomValues(new Uint8Array(16))
      const key = await this.#derivar(passphrase, salt, KDF)
      const nonce = crypto.getRandomValues(new Uint8Array(24))
      const ciphertext = xchacha20poly1305(key, nonce).encrypt(
        new TextEncoder().encode(JSON.stringify(this.#contents)),
      )
      key.fill(0)
      payload = {
        version: VERSAO_DO_COFRE,
        protection: "passphrase",
        salt: toBase64(salt),
        nonce: toBase64(nonce),
        ciphertext: bytesParaBase64(ciphertext),
      }
    }

    // The account file has the same header as the vault: that is why 1.0
    // refuses a file exported by 0.9.x without decrypting it.
    return comCabecalho(
      JSON.stringify({ format: "enclave-vault", formatVersion: 1, exportedAt: Date.now(), vault: payload }),
    )
  }

  /**
   * Adopt an exported account onto this device, replacing whatever is here.
   *
   * The passphrase is verified by actually decrypting before a single byte is
   * written, so a typo can never destroy the local vault. The caller owns the
   * are-you-sure ceremony; by the time this runs, the decision is made.
   */
  async importVault(data: Uint8Array, passphrase: string): Promise<void> {
    // The header first, before any key. An account file without
    // it is from 0.9.x: say that and nothing else, without deriving the phrase and without
    // decrypting (1.0 never reads a beta vault). A file that is not even
    // an account continues to say what it always said.
    const json = semCabecalho(data)
    if (json === null) {
      if (pareceEnvelopeDeConta(new TextDecoder().decode(data))) {
        throw new Error("this account file is from the beta")
      }
      throw new Error("this is not an enclave account file")
    }
    let envelope: { format?: string; formatVersion?: number; vault?: VaultFile }
    try {
      envelope = JSON.parse(json) as {
        format?: string
        formatVersion?: number
        vault?: VaultFile
      }
    } catch {
      throw new Error("this is not an enclave account file")
    }
    if (envelope.format !== "enclave-vault" || envelope.formatVersion !== 1 || !envelope.vault) {
      throw new Error("this is not an enclave account file")
    }
    const file = envelope.vault
    if (file.protection !== "passphrase" || !file.salt || !file.nonce || !file.ciphertext) {
      throw new Error("this is not an enclave account file")
    }
    // The envelope has its own version (`formatVersion`, verified above) and the
    // vault inside has its own. They are different things: an envelope of this
    // version can carry a vault from tomorrow, and writing over the
    // local one without knowing how to read it would swap a readable account for one that this
    // device can never open again.
    versaoLegivel(file)

    // Prove the passphrase against the import before touching local state.
    const key = await this.#derivar(passphrase, fromBase64(file.salt), KDF)
    let plaintext: Uint8Array
    try {
      plaintext = xchacha20poly1305(key, fromBase64(file.nonce)).decrypt(base64ParaBytes(file.ciphertext))
    } catch {
      key.fill(0)
      throw new Error("wrong passphrase, or the vault is damaged")
    }

    /*
      The imported copy claims ownership of the device on first login
      (`assumirPosse`). Without this the device that exported it would keep speaking for the
      account with the same key and the same MLS sheet, and the two copies would break
      each other's channels (`scripts/e2e-exportar-importar.mjs`, October 27
      2026). Re-sealed with the same key and a new nonce: the file's
      passphrase stays the one that opens this vault.
    */
    let selado: VaultFile
    try {
      const conteudo = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<VaultContents>
      conteudo.assumirPosse = toBase64(crypto.getRandomValues(new Uint8Array(18)))
      const nonce = crypto.getRandomValues(new Uint8Array(24))
      const cifrado = xchacha20poly1305(key, nonce).encrypt(new TextEncoder().encode(JSON.stringify(conteudo)))
      selado = { ...file, nonce: toBase64(nonce), ciphertext: bytesParaBase64(cifrado) }
    } catch {
      throw new Error("this is not an enclave account file")
    } finally {
      key.fill(0)
      plaintext.fill(0)
    }

    this.lock()
    await this.#backend.write(comCabecalho(JSON.stringify(selado)))
    await this.#largarMemoria()
  }

  lock(): void {
    // A deferred recording has no key left to send it. What it held is what the
    // server restores (see `updateEmBreve`), and whoever was waiting for it does not
    // hang.
    this.#tirarAdiada()?.resolver()
    // Overwrite before dropping the reference. JS cannot guarantee the page was
    // not already copied, but leaving a live key in a long-running process is
    // strictly worse than trying.
    this.#key?.fill(0)
    this.#key = null
    this.#contents = newVaultContents()
    this.#provisorio = false
  }

  /** Irreversibly discard the account. There is no server-side copy. */
  async destroy(): Promise<void> {
    this.lock()
    // Memory first: if `clear` fails halfway, no key from a
    // vault that the person asked to delete stays behind.
    await this.#largarMemoria()
    await this.#backend.clear()
  }
}

/**
 * The protection of an `orwv2` vault, read from the envelope in clear without decrypting anything.
 * `undefined` when the envelope will not read: whoever decides what to do with that is
 * the `unlock`, with its error.
 */
function proteccaoEmClaro(raw: Uint8Array): "os" | "passphrase" | undefined {
  try {
    const json = semCabecalho(raw)
    if (json === null) return undefined
    const file = JSON.parse(json) as Partial<VaultFile> | null
    return file?.protection === "os" || file?.protection === "passphrase" ? file.protection : undefined
  } catch {
    return undefined
  }
}

/** A JSON with the wrapper of an account file, without looking at the vault inside. */
function pareceEnvelopeDeConta(texto: string): boolean {
  try {
    const envelope = JSON.parse(texto) as { format?: unknown } | null
    return typeof envelope === "object" && envelope !== null && envelope.format === "enclave-vault"
  } catch {
    return false
  }
}

// ------------------------------------------------ the account state (phase 5)

/*
  The merge of marks that move between devices. Pure functions on the content,
  so the snapshot of pairing and the deltas of the account channel go
  through the same lines, and can be tested without any session.
  
  The newest mark wins by key. In a timestamp tie, a fixed rule decides (lock and archive win; in preferences, the higher value), so
  two devices that receive the same two gestures in reverse order end up
  in the same place. Each function returns the keys that changed: empty means "nothing to
  save, nothing to alert".
  */

/** Read: the newest timestamp per channel. */
export function fundirLidas(contents: VaultContents, lidas: Readonly<Record<string, number>>): string[] {
  const mudaram: string[] = []
  for (const [channel, at] of Object.entries(lidas)) {
    if (!Number.isFinite(at) || at <= (contents.lidas?.[channel] ?? -1)) continue
    contents.lidas = { ...contents.lidas, [channel]: at }
    mudaram.push(channel)
  }
  return mudaram
}

/** Archive: the newest mark per channel; in a tie, archiving wins. */
export function fundirArquivo(
  contents: VaultContents,
  arquivo: Readonly<Record<string, { arquivado: boolean; at: number }>>,
): string[] {
  const mudaram: string[] = []
  for (const [channel, marca] of Object.entries(arquivo)) {
    const actual = contents.arquivo?.[channel]
    const ganha =
      actual === undefined || marca.at > actual.at || (marca.at === actual.at && marca.arquivado && !actual.arquivado)
    if (!ganha) continue
    contents.arquivo = { ...contents.arquivo, [channel]: { arquivado: marca.arquivado, at: marca.at } }
    mudaram.push(channel)
  }
  return mudaram
}

/** Preferences: the newest choice per key; in a tie, the higher value. */
export function fundirPreferencias(
  contents: VaultContents,
  preferencias: Readonly<Record<string, { valor: string; at: number }>>,
): string[] {
  const mudaram: string[] = []
  for (const [chave, marca] of Object.entries(preferencias)) {
    const actual = contents.preferencias?.[chave]
    const ganha = actual === undefined || marca.at > actual.at || (marca.at === actual.at && marca.valor > actual.valor)
    if (!ganha) continue
    contents.preferencias = { ...contents.preferencias, [chave]: { valor: marca.valor, at: marca.at } }
    mudaram.push(chave)
  }
  return mudaram
}

/**
 * Lock as marks: `blocked` (locked, with the time) and `desbloqueados`
 * (unlocked, with the time), one mark per address, the newest.
 */
export function marcasDeBloqueio(contents: VaultContents): Record<string, { bloqueado: boolean; at: number }> {
  const marcas: Record<string, { bloqueado: boolean; at: number }> = {}
  for (const [address, at] of Object.entries(contents.blocked ?? {})) marcas[address] = { bloqueado: true, at }
  for (const [address, at] of Object.entries(contents.desbloqueados ?? {})) {
    const bloqueio = marcas[address]
    if (bloqueio === undefined || at > bloqueio.at) marcas[address] = { bloqueado: false, at }
  }
  return marcas
}

/**
 * Lock: the newest mark per address; in a tie, locking wins.
 *
 * Only writes the marks. What a lock DOES (cut the friendship, leave the feed)
 * the device where the person tapped does, and it is MLS state that reaches everyone;
 * what this device gains is the filter of what comes in, which reads `blocked`.
 */
export function fundirBloqueio(
  contents: VaultContents,
  bloqueio: Readonly<Record<string, { bloqueado: boolean; at: number }>>,
): { bloqueados: string[]; desbloqueados: string[] } {
  const actuais = marcasDeBloqueio(contents)
  const bloqueados: string[] = []
  const desbloqueados: string[] = []
  for (const [address, marca] of Object.entries(bloqueio)) {
    const actual = actuais[address]
    const ganha =
      actual === undefined || marca.at > actual.at || (marca.at === actual.at && marca.bloqueado && !actual.bloqueado)
    if (!ganha) continue
    const { [address]: _bloqueado, ...outrosBloqueados } = contents.blocked ?? {}
    const { [address]: _desbloqueado, ...outrosDesbloqueados } = contents.desbloqueados ?? {}
    if (marca.bloqueado) {
      contents.blocked = { ...outrosBloqueados, [address]: marca.at }
      contents.desbloqueados = outrosDesbloqueados
      if (actual?.bloqueado !== true) bloqueados.push(address)
    } else {
      contents.blocked = outrosBloqueados
      contents.desbloqueados = { ...outrosDesbloqueados, [address]: marca.at }
      if (actual?.bloqueado === true) desbloqueados.push(address)
    }
  }
  return { bloqueados, desbloqueados }
}

/** The list of friends that THIS account shows, if the arriving one is newer. */
export function fundirAmigosMostrados(
  contents: VaultContents,
  eu: string,
  lista: { shown: readonly string[]; updatedAt: number },
): boolean {
  const actual = contents.shownFriends?.[eu]
  if (actual !== undefined && actual.updatedAt >= lista.updatedAt) return false
  contents.shownFriends = { ...contents.shownFriends, [eu]: { shown: [...new Set(lista.shown)], updatedAt: lista.updatedAt } }
  return true
}

/**
 * What to pick from a large map to fit in the feed cap: the newest marks. An old mark
 * that falls out is a stale read, not a loss: any channel with activity has a recent one.
 */
export function maisRecentes<T>(mapa: Readonly<Record<string, T>>, tecto: number, carimbo: (valor: T) => number): Record<string, T> {
  const entradas = Object.entries(mapa)
  if (entradas.length <= tecto) return { ...mapa }
  return Object.fromEntries(entradas.sort((a, b) => carimbo(b[1]) - carimbo(a[1])).slice(0, tecto))
}

/** An entry from the inherited ledger, as the snapshot brings it. */
export type EntradaHerdada = NonNullable<VaultContents["livroHerdado"]>[string][number]

/**
 * The pairing snapshot, applied to a vault of a freshly born device. The marks merge (in an empty vault, it is copying); the ledger of
 * friendships goes into the state ledger of each channel, marked as inherited.
 */
export function aplicarEstadoDeConta(
  contents: VaultContents,
  eu: string,
  estado: {
    amizades: Readonly<
      Record<
        string,
        readonly { seq: number; sender: string; t: string; sentAt?: number | undefined; note?: string | undefined; withdrawn?: true | undefined }[]
      >
    >
    bloqueio: Readonly<Record<string, { bloqueado: boolean; at: number }>>
    amigosMostrados?: { shown: readonly string[]; updatedAt: number } | undefined
    arquivo: Readonly<Record<string, { arquivado: boolean; at: number }>>
    lidas: Readonly<Record<string, number>>
    preferencias: Readonly<Record<string, { valor: string; at: number }>>
    perfil?: PerfilQueChega | undefined
    fichas?: Readonly<Record<string, FichaQueChega>> | undefined
    segredoDoMural?: string | undefined
    moradaDaConta?: string | undefined
    perfis?: Readonly<Record<string, PerfilDeOutraQueViaja>> | undefined
  },
): void {
  /*
    The history comes next, from device to device, without asking (owner's
    decision on 29/10/2026, "I want it out"): the mark tells the session to ask the
    sibling for it as soon as it enters the account channel. See `historico/historico.ts`.
  */
  contents.historico = { ...contents.historico, inicial: { desde: Date.now() } }
  // The profile first: the new device is born with it, before publishing anything (phase 1e).
  if (estado.perfil) adoptarPerfil(contents, estado.perfil)
  // The opaque addresses (slice 3): this device cannot calculate them.
  for (const [canal, ficha] of Object.entries(estado.fichas ?? {})) registarFicha(contents, canal, ficha)
  if (estado.segredoDoMural && !contents.segredoDoMural) contents.segredoDoMural = estado.segredoDoMural
  if (estado.moradaDaConta && !contents.moradaDaConta) contents.moradaDaConta = estado.moradaDaConta
  // The names of other people, so the first screen does not show them as "No name".
  if (estado.perfis) fundirPerfisDeOutros(contents, eu, estado.perfis)
  fundirLidas(contents, estado.lidas)
  fundirArquivo(contents, estado.arquivo)
  fundirPreferencias(contents, estado.preferencias)
  fundirBloqueio(contents, estado.bloqueio)
  if (estado.amigosMostrados) fundirAmigosMostrados(contents, eu, estado.amigosMostrados)
  // The ledger of friendships goes into the state ledger of each channel, marked as
  // inherited (phase S2). It was `livroHerdado`, separate; now it is the same ledger.
  for (const [channel, entradas] of Object.entries(estado.amizades)) {
    juntarHerdados(
      contents,
      channel,
      entradas.map((entrada) => ({
        seq: entrada.seq,
        sender: entrada.sender,
        t: entrada.t,
        ...(entrada.sentAt !== undefined ? { sentAt: entrada.sentAt } : {}),
        ...(entrada.note !== undefined ? { note: entrada.note } : {}),
        ...(entrada.withdrawn ? { withdrawn: true as const } : {}),
      })),
    )
  }
}

/** A profile from another device: the one from the snapshot, or read from a `profile` payload. */
export interface PerfilQueChega {
  displayName: string
  /** The chosen state (phase 1h). Only in the `profile` payload; the snapshot does not carry it. */
  activity?: string | undefined
  statusText?: string | undefined
  bio?: string | undefined
  email?: string | undefined
  donations: readonly { kind: string; label: string; value: string }[]
  avatarDataUrl?: string | undefined
  updatedAt: number
}

/**
 * The profile that came from another device of the account, adopted if it is newer
 * (phase 1e). Returns whether the vault changed.
 *
 * The highest `updatedAt` wins, as in all account state. With two
 * exceptions, and both protect the primary portrait:
 * - a profile with no name is not adopted: there is nothing to show, and adopting it
 *   would erase what this device has;
 * - a local profile with no name does not count as a profile: it is from a device just
 *   paired, and may have a recent `updatedAt` with nothing (the interface
 *   writes the state of activity to it). It loses to any profile with a name.
 */
export function adoptarPerfil(contents: VaultContents, perfil: PerfilQueChega): boolean {
  if (!perfil.displayName) return false
  const local = contents.profile
  if (local.displayName && perfil.updatedAt <= local.updatedAt) return false
  /*
    The chosen state comes with the sibling's profile (phase 1h). Whoever adopts
    republishes the profile in channels with the SAME version (`updatedAt`); with its
    state instead of this one, the two identical copies in version would say
    different states, and each person would end up with the one that arrived first. This way
    the last chosen state in the account holds across any device.
  */
  const escolhido = perfil.activity === "ocupado" || perfil.activity === "ausente" ? perfil.activity : undefined
  contents.profile = {
    displayName: perfil.displayName,
    ...(escolhido ? { activity: escolhido } : {}),
    donations: perfil.donations.map((entrada) => ({ kind: entrada.kind, label: entrada.label, value: entrada.value })),
    ...(perfil.statusText !== undefined ? { statusText: perfil.statusText } : {}),
    ...(perfil.bio !== undefined ? { bio: perfil.bio } : {}),
    ...(perfil.email !== undefined ? { email: perfil.email } : {}),
    ...(perfil.avatarDataUrl !== undefined ? { avatarDataUrl: perfil.avatarDataUrl } : {}),
    updatedAt: perfil.updatedAt,
  }
  return true
}

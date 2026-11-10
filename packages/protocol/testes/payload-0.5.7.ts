// The payload schema from 0.5.7, as released (git show bb23e7a:packages/protocol/src/payload.ts).
// For compatibility tests only: it lives outside src/, so it is in neither tsc -b nor dist/.
// @ts-nocheck
import { z } from "zod"

/**
 * The plaintext layer — everything here lives *inside* an MLS application
 * message and is never visible to any server.
 *
 * Compare with Discord's message object, where author, guild, channel name,
 * mentions, reactions, attachment filenames, and edit history are all server-side
 * records. Here they are group state, and the server holds only opaque bytes.
 */

/** Milliseconds since epoch, as claimed by the sender's clock. */
const Timestamp = z.number().int().nonnegative()

/** Sender-generated, unique per message. Used for replies, edits and dedup. */
const MessageId = z.string().min(8).max(64)

/**
 * Bytes written as text, in the same alphabet as the rest of the protocol.
 *
 * Here the narrowness is safe, unlike `NarrowName`: this is not vocabulary
 * that grows, it is an encoding that is either right or fails to decode.
 * Rejecting at the sender what the receiver could never decode catches the
 * defect where someone can see it.
 */
const Base64Url = z.string().min(1).regex(/^[A-Za-z0-9_-]+$/, "expected unpadded base64url")

/**
 * A category name chosen from a list that will grow over time.
 *
 * **Why not `z.enum` of today's list.** A `z.enum` does not just drop a value
 * it does not know: it rejects the ENTIRE payload, and a rejected payload is
 * silently discarded, counts as an ignored event, and a run of them marks the
 * channel deaf (see `DEAF_FAILURES` in the core), which triggers a reseat and
 * takes the history with it. One future value would cost the whole profile,
 * the whole message or the whole post, all to avoid drawing one icon.
 * Decoration must never kill structure. `ROLE_COLOURS` already made this
 * argument, and this type applies it where it was missing.
 *
 * **What this prevents, then.** Garbage, and nothing else. A free string here
 * would accept an entire `style`, a `url(...)`, or half a megabyte of junk in
 * a field whose content is always a word. The reader still judges the value
 * against the list it knows and treats the rest as absent. That is where the
 * decision belongs, because that is where the version knows what it can draw.
 *
 * **The limits are loose on purpose**, and more than `colour`'s: a colour is
 * always a short word and always a word, a file format is not. A future name
 * that does not pass here is a rejected payload, that is, the same bug again,
 * only rarer and so harder to find. Digits went in for exactly that reason, not
 * by taste: the first name made up in earnest to test this was `modelo3d`, and
 * the earlier version of this format rejected it. If an example picked at
 * random did not fit, the real ones would not either.
 *
 * The rule for whoever adds a name to the list this field draws from: one word
 * only, starting with a letter, ASCII lowercase and digits, up to twenty four
 * characters. No spaces, no hyphens, no dots: `liberapay` and `kofi` already
 * show the convention. A compound name is written as one word.
 *
 * **When NOT to use this.** When the list names a structural choice in the
 * product and not a thing in the world. Then we define the number of cases,
 * not reality, so it does not grow by itself. See `channel.meta.kind`, which
 * stays closed for that reason and says so where it is defined.
 */
const NarrowName = z.string().regex(/^[a-z][a-z0-9]{1,23}$/)

/**
 * An account address, `@<id>:<servidor>`, written as text.
 *
 * Format only, and strict: no spaces, a `@` at the front and a `:` as separator.
 * Real validation (the server, the key digest) is done by `parseAddress`, which
 * whoever uses the address calls; here we only stop an address field from
 * carrying anything else, or half a megabyte of noise.
 */
const UserAddressText = z
  .string()
  .max(320)
  .regex(/^@[^\s:@]+:[^\s@]+$/)

export const Attachment = z.object({
  /**
   * Where the blob sits. Content-addressed, so the store cannot tamper with it.
   *
   * Empty when the bytes are carried inline instead — see `inline`.
   */
  url: z.string().max(2048).default(""),
  /**
   * The image itself, as a data URL, for anything small enough to inline.
   *
   * Carrying bytes in the message costs bandwidth, but it means a picture is
   * protected by exactly the same key as the words around it, with no second
   * system to get wrong and no blob store that learns who fetched what and when.
   * Larger files belong in the encrypted store, which is the `url` path.
   */
  inline: z.string().max(4_000_000).optional(),
  /** XChaCha20-Poly1305 key for the blob. Absent for inline attachments. */
  key: z.string().default(""),
  nonce: z.string().default(""),
  /** BLAKE3 of the ciphertext, checked before decryption. */
  digest: z.string().default(""),
  /**
   * What this is, so a client can choose a player without sniffing bytes or
   * trusting a file extension.
   *
   * `image` · `video` · `audio` · `document` · `other`. Narrow name and not
   * `z.enum`, see `NarrowName`. An `Attachment` travels inside messages,
   * posts, avatars and channel icons, so a future format rejected here would not
   * cost just the thumbnail: it would cost the entire message, the entire post
   * or the entire profile. The `other` that already exists proves this list was
   * written to grow, and whoever reads a name it does not know treats it as
   * `other`, which is what `other` always meant.
   */
  kind: NarrowName.default("other"),
  /** Filename and MIME type are sender-supplied metadata, encrypted like the rest. */
  name: z.string().max(255),
  mediaType: z.string().max(128),
  /** Seconds, for audio and video. */
  duration: z.number().nonnegative().optional(),
  byteLength: z.number().int().nonnegative(),
  /** Tiny inline preview, already encrypted as part of this payload. */
  blurhash: z.string().max(64).optional(),
})
export type Attachment = z.infer<typeof Attachment>

/**
 * A shared link, with whatever context the sender chose to include.
 *
 * `kind` lets a client lay a video out differently from an article without
 * inspecting the URL against a list of known hosts — and without ever embedding
 * the third party's player, which would load their scripts and their trackers
 * into a page that is otherwise sealed.
 */
/**
 * The powers a role can grant, and their nature.
 *
 * `expulsar` stands alone on the cryptography side: once done, it cuts the leaf
 * from the MLS tree and advances the epoch, and no one undoes it. The others
 * are convention that honest clients apply. Exported from here, not copied to
 * each layer, because the interface must separate the two and a second
 * hand-written list would end up disagreeing with this one.
 *
 * `eliminar` came last and is the most serious on the list: it ends the channel
 * for everyone, posting `space.removed`. It deserves its own entry instead of
 * riding along with `renomear`: whoever tidies the sidebar is not, for that
 * reason, the one who decides the channel stops existing. And it is assignable,
 * which is the half of the request that "only the admin" did not meet: the
 * founder and whoever has `admin` get it for free, as they get every power, and
 * any role can carry it.
 *
 * Despite its weight, it is convention like the other three: an altered client
 * ignores the tombstone and keeps what it had. The role editor note says so,
 * and must keep saying it.
 *
 * `fixar` is the lightest of all: it puts a message at the top of the room, and
 * takes it down. Convention like the others, with the quirk that it is the only
 * one whose undo is the SAME gesture: unpinning does not repair damage, it is
 * the other half of the power. It is not in `IRREVERSIBLE_POWERS` for this
 * reason, and not in `CRYPTOGRAPHIC_POWERS` because the room key is the channel
 * key: whoever is there reads the pinned message whether it is pinned or not.
 * Pinning tidies, it does not protect.
 *
 * `atender` is the newest, and it governs ticket rooms: claim a ticket, say
 * what state it is in, and close it. Convention like `convidar`, `renomear` and
 * `mover`: an altered client writes any state it wants, and what stops that
 * from counting is every honest client refusing to count what came from
 * someone without the power. See `ticketsOf`, in the core, which is where that
 * filtering happens.
 *
 * Whoever opened the ticket changes the state of THEIR ticket without needing
 * the power. It is not an exception to the rule, it is the scope of it:
 * `atender` is the power to touch OTHER people's tickets, and whoever filed the
 * complaint never needed permission to say it is resolved.
 *
 * Always add at the end. The order of this list is the order powers appear on
 * screen, and `powersOf` filters by it.
 */
export const POWERS = ["expulsar", "convidar", "renomear", "mover", "eliminar", "fixar", "atender"] as const
export type Power = (typeof POWERS)[number]

/** The ones the cipher guarantees. Everything else is worth what clients make of it. */
export const CRYPTOGRAPHIC_POWERS: readonly Power[] = ["expulsar"]

/**
 * The ones that, once used, do not come undone, by cryptography or by effect.
 *
 * It is not the same question as `CRYPTOGRAPHIC_POWERS`, and that is why it is
 * another list. That one asks what the cipher guarantees against an altered
 * client; this one asks what happens to clients that obey. `expulsar` advances the
 * epoch and locks out whoever left; `eliminar` posts the tombstone and every
 * honest client drops the channel and deletes what it had of it. Neither has an
 * inverse gesture.
 *
 * It exists for one decision only, and it is written in `powersOf`: in a channel
 * whose founding is unknown, grant what can be undone and deny what cannot. The
 * person adding a power to `POWERS` must decide here whether it can be undone,
 * and silence counts as "yes", which is the answer that risks granting too much.
 * So: decide, do not leave it blank.
 *
 * `atender` was decided and stays out: a closed ticket reopens, a claimed
 * ticket is released, and a ticket's state is always the latest statement of
 * someone with the authority to make it. Nothing `atender` does stays done
 * forever.
 */
export const IRREVERSIBLE_POWERS: readonly Power[] = ["expulsar", "eliminar"]

/**
 * The colours a role can have. Names, and never values.
 *
 * **Names and not `#rrggbb`, because whoever picks the colour does not know
 * where it will be read.** A hand-picked hex is chosen against the picker's
 * own background, and the same text later shows up in an 11px sub-line, in a
 * lighter card and in a property sheet. Publishing the name leaves the choice
 * of pixel to whoever has the background in front of them, and that is what
 * lets us measure contrast once, for all surfaces, instead of hoping for the
 * best with each new role. The table of values lives in the interface
 * (`roleColours.ts`), with the measurements.
 *
 * **Closed, for the reason of `POWERS`:** a colour invented by a client is a
 * colour no other client can guarantee is legible, and small illegible text is
 * lost information with no symptom.
 *
 * **But the schema is NOT a `z.enum` of this, and it is deliberate.** A
 * `z.enum` would make a future colour reject the entire payload, and a
 * discarded `role.define` does not lose a colour, it loses the role: the name,
 * the powers and the very existence of it vanish from the old client, which
 * cannot even edit or delete it. Decoration must never kill structure. The
 * field is a narrow-format string, and it is on READ that an unknown colour
 * becomes absent, the same safe filtering that `rolesOf` already does for a
 * power this version does not know.
 *
 * This argument was written here and also applied to half a dozen fields that
 * were still `z.enum`, `powers` first. It was moved into `NarrowName`, where it
 * lives now, with the criterion for when to use it and when not.
 *
 * Intentionally no neutral tone: a grey would be indistinguishable from a role
 * with no colour, which is the normal case and must keep reading as no choice.
 *
 * Add at the end, like in `POWERS`.
 */
export const ROLE_COLOURS = ["rosa", "coral", "ambar", "lima", "menta", "turquesa", "ceu", "lilas"] as const
export type RoleColour = (typeof ROLE_COLOURS)[number]

/**
 * How long a typing indicator lasts, counted from when it is sent.
 *
 * It lives here, not in the interface, because whoever WRITES the `until` field
 * and whoever READS it to clear the indicator are different layers: two hosts
 * build the payload, and the interface is what expires it. Two copies of the number
 * would end up disagreeing, and the symptom would be a flickering indicator or
 * one stuck with no visible cause anywhere.
 *
 * Six seconds: longer than the four-second retransmit window, so a delayed
 * packet does not clear the indicator for someone still typing; shorter than
 * ten, so whoever closes the laptop mid-sentence vanishes before anyone notices.
 * See `hooks/useTyping.ts` for the send rate.
 */
export const TYPING_TTL_MS = 6_000

/**
 * The minimum interval between nudges, requested by the owner.
 *
 * Five seconds. It lives here for the same reason as the timeout above: the
 * sender throttles itself by it, and the receiver rejects by it. Two layers, one
 * number. Without a throttle, the buzz goes back to what it was on MSN, a cheap
 * way to annoy someone; with it, it still serves to get the attention of someone
 * distracted, which is what it is for.
 */
export const BUZZ_INTERVAL_MS = 5_000

/**
 * How old a nudge can be and still be felt.
 *
 * Unlike the typing indicator, a buzz carries no deadline: it is an instant,
 * not a state. But a replay that slipped past the cutoff must not shake
 * someone's screen with a nudge from yesterday, so the receiver compares `at`
 * with its own clock. Thirty seconds: long enough for clock skew and slow
 * networks, short enough that nothing from another session gets through.
 */
export const BUZZ_MAX_AGE_MS = 30_000

export const LinkCard = z.object({
  url: z.string().max(2048),
  /**
   * `link` · `video` · `image` · `post`. Narrow name and not `z.enum`, see
   * `NarrowName`.
   *
   * It is the most exposed of all: a `LinkCard` travels in every message and
   * every post that carries an address, so a future type (a `stream`, a
   * `pdf`, a `map`) rejected here would throw away the text the person wrote
   * around it. Whoever reads a name it does not know draws the card as `link`,
   * which is the general case and the default.
   */
  kind: NarrowName.default("link"),
  title: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  /** Site name as the sender saw it. Never resolved by the reader. */
  siteName: z.string().max(100).optional(),
  /** Small inline thumbnail, encrypted with the rest of the payload. */
  thumbnail: z.string().max(400_000).optional(),
})
export type LinkCard = z.infer<typeof LinkCard>

/**
 * An image picked and ALREADY COMPRESSED, waiting to go into a message.
 *
 * It is not a wire type: it is the form the compose box hands to the host,
 * which expands it to `Attachment` before encrypting. It lives here, not in the
 * interface, for a practical reason: the Electron main process builds the
 * message and does not load React, so it cannot import the interface to know
 * what form to expect. A second hand-written declaration would end up
 * disagreeing with this one, and the symptom would be an image that sends from
 * the browser but not from the computer, or the other way around.
 */
export interface OutgoingImage {
  /** The bytes, as a data URL: that is how they travel inside the encrypted message. */
  dataUrl: string
  name: string
  mediaType: string
  /** Real image bytes. Never the length of the base64 string. */
  bytes: number
}

/**
 * A file that is NOT an image, picked and waiting to go into a message.
 *
 * The form is exactly that of `OutgoingImage` (bytes as data URL, name, type,
 * size), so it is an alias, not a second declaration: two copies of the
 * same format would end up disagreeing, and the one that disagreed would break
 * sending on one side or the other.
 *
 * What changes is the path to here, and that is why the field is different. An
 * image passes through the compressor before being encrypted; a PDF goes through
 * no compressor, because it already comes compressed and recompressing it only
 * makes it grow. Calling the field that carries a `zip` `images` would be
 * writing a lie that the next person to read this would believe.
 */
export type OutgoingFile = OutgoingImage

/** What travels with message text: images, files, cards, and mentions. */
export interface MessageExtras {
  images?: OutgoingImage[]
  /** Attachments that are not images. See `OutgoingFile`. */
  files?: OutgoingFile[]
  links?: LinkCard[]
  /**
   * The addresses named in the message, already resolved by the sender.
   *
   * They arrive ready and are not looked up in the body, for the reason the
   * payload's `mentions` field already gave: routing a notification must
   * never need to run a regex over the text. See `mentions.ts` in the interface,
   * where names are swapped for addresses on send.
   */
  mentions?: string[]
  /**
   * The poll this message is, when it is one.
   *
   * The body is still sent and carries the question and options in full (see `Poll`).
   * Optional like everything else here: a text box that knows nothing of polls
   * still builds messages without touching this field.
   */
  poll?: Poll
}

/**
 * An invite to a channel, inside the private message that announces it.
 *
 * Not its own payload type, and the reason is survival, not housekeeping. A `t`
 * the receiver does not know fails validation, gets dropped whole, counts as an
 * ignored event, and a run of them marks the channel deaf, which triggers a
 * reseat and takes the history with it (forward secrecy). An optional field inside
 * `message` does not run that risk: an old client strips the field it does not
 * know (that is what `z.object` does by default) and shows the message, with
 * the text the inviter wrote. The invitee learns they were invited, even
 * without a button to tap.
 *
 * And it settles, along the way, where this has to show up: the Friends
 * conversation list and
 * the conversation itself only draw `message` payloads. An invite that was
 * something else would reach the vault and never reach anyone's eyes.
 */
export const ChannelInvite = z.object({
  /** The channel being invited to. */
  channel: z.string().max(200),
  /** The channel name as the inviter sees it. Display only. */
  name: z.string().max(100).optional(),
  /** The clock of the inviter. See `INVITE_TTL_MS`. */
  at: Timestamp,
})
export type ChannelInvite = z.infer<typeof ChannelInvite>

/** The response to an invite, by the same path and for the same reason. */
export const ChannelInviteReply = z.object({
  channel: z.string().max(200),
  accepted: z.boolean(),
  at: Timestamp,
})
export type ChannelInviteReply = z.infer<typeof ChannelInviteReply>

/**
 * How long an address-based invite stays live: fourteen days.
 *
 * An invite is not a key left waiting in a lock: it is a standing order given
 * to the inviter's device, which must commit the Add without the inviter being
 * there. Accepted three months later, it would admit someone to a channel that
 * is no longer the one they were shown: different people, different talk, and
 * maybe no longer what the inviter wants.
 *
 * Fourteen days: generous for someone on holiday or with the app on an old
 * phone, short enough that the channel's membership has not changed meanwhile.
 * Anyone who wants more time invites again: it is a one-click gesture.
 *
 * The deadline is measured against the invite timestamp. On the receiving side
 * that is the other person's clock, and it is for display only; on the
 * admitting side it is the timestamp that device wrote itself, and that one decides.
 */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000

/**
 * A poll: a question and the options that answer it.
 *
 * **Not a new `t`, and the reason is always the same in this file.** A `t` the
 * receiver does not know fails the whole union, the payload is dropped in
 * silence, counts as an ignored event, and a run of ignored events marks the
 * channel deaf, which triggers a reseat and takes the history with it (forward
 * secrecy). So a poll travels as an OPTIONAL field of things that already exist:
 * of `message`, in chat, and of `post`, on the board. Whoever does not know it
 * strips the field (that is what `z.object` does by default) and is left with
 * the text around it.
 *
 * **And the text around it is written to stand alone.** Whoever publishes the poll
 * writes the question and the options also in the message body (or in the post
 * caption), numbered, so a client that cannot draw this still shows what is
 * being asked and what the answers are. It cannot vote with one click, but it knows
 * what is happening and can answer in words: the same choice `ChannelInvite`
 * makes, and for the same reason.
 *
 * **`.catch(undefined)` where this is used, and it is the piece that
 * makes these limits safe.** An optional field with a tight schema inside can
 * still kill the whole payload: if the poll does not validate, the `z.object`
 * holding it fails with it. With the catch, an unreadable poll (from a future
 * version with more options, or from an altered client) counts as no poll, and
 * the message still passes with the text inside. **Decoration must never kill the
 * structure**, and here that is enforced in code instead of promised.
 *
 * The price, stated whole: the sender also loses an invalid poll in silence,
 * because `encodePayload` validates with this same schema. So the sender's check
 * happens BEFORE, where there is a person to tell: the poll creation sheet
 * (`NovaVotacao.tsx`) requires the question and two options before it even
 * enables the button. The catch stays to protect only the read side, where
 * there is no one to warn.
 *
 * What is NOT here, and it is a decision, not an oversight:
 *
 * - **No secret field.** In an MLS group everyone decrypts everything the group
 *   says: a vote traveling as a group event is readable by any member, and a
 *   `secret: true` field would be a promise the cipher does not keep. Votes are
 *   attributable, the interface says so in words, and whoever wants a truly
 *   secret vote needs encryption this product does not have. See
 *   `post.reaction.vote`.
 * - **No deadline or close.** There is no shared clock (each payload timestamp
 *   is only what the sender's clock claims), and without an arbiter a deadline
 *   would close at different instants on each screen, accepting on one device a
 *   vote another refuses. A poll stays open while it exists. What it would take to
 *   close it for real is in `docs/PENDENTES.md`.
 * - **No multiple choice.** One vote per person, and that is exactly why
 *   counting needs no counter at all (see `post.reaction.vote`).
 */
export const Poll = z.object({
  /** The question. One line, and it names the poll across the whole interface. */
  question: z.string().min(1).max(300),
  /**
   * The possible answers, in reading order.
   *
   * **Order is the identifier**: a vote names the INDEX of the option, never the
   * text. Text repeats ("Yes" twice by accident) and does not compare well
   * between versions; an index is exact and fits in a number. It is safe because
   * a poll cannot be edited: there is no path in this protocol that touches the
   * options after publishing, and `edit` only touches the body and caption.
   *
   * Two at minimum, because a question with one answer is not a question. Ten
   * at most, which is what fits on a card without it becoming a form.
   */
  options: z.array(z.string().min(1).max(120)).min(2).max(10),
})
export type Poll = z.infer<typeof Poll>

/**
 * How many messages a room can have pinned at the same time.
 *
 * A cap, not a preference: the list travels inside the `channel.meta` of the
 * room, and the `channel.meta` is republished to each person who enters the
 * channel (see `republishRooms`). Whatever is pinned is paid for once per room
 * and per arrival.
 *
 * Twenty, with the maths done: twenty entries of `PINNED_BODY_MAX` give a bit over
 * twenty kilobytes in the worst case, and the normal case is sentences. It is
 * the order of magnitude of a message with a small image, and one order of
 * magnitude below the 124 kB avatars that once filled a real server's database. Above
 * this it stops being a list someone reads and becomes a second history with
 * another name.
 */
export const MAX_PINNED = 20

/**
 * The default room, as it is before anyone publishes anything to it.
 *
 * The empty identifier is not a pretty name for a room: it is literally the
 * missing `room` field that all messages from before rooms have, and being empty
 * is why the move to the rooms model needed no migration. It always exists, even
 * without any `channel.meta` to declare it.
 *
 * **It is here, not in the interface, because it stopped being interface-only.**
 * While the default room was only drawn, the factory name could live next to the
 * drawing. Pinning a message in it requires PUBLISHING the `channel.meta` it never
 * had, and a `channel.meta` without a name fails the schema, and one with the
 * wrong name renames the room for everyone when pinning. Both ends need the same
 * value, and two hand-written copies would end up disagreeing: the symptom would
 * be the room changing name, or place in the sidebar, at the first pinned
 * message.
 *
 * Negative `position`: while it is still the factory default it shows at the
 * top, and it follows the published order once someone drags it. Republishing
 * it with zero would send it to the middle of the others without anyone having
 * touched it.
 */
export const DEFAULT_ROOM = { room: "", name: "geral", position: -1 } as const

/**
 * How many names fit, at most, in the list of who is being viewed (`aVer`).
 *
 * **Exported because it must be READ by whoever writes it.** The schema refuses a
 * list bigger than this, and `encodePayload` does `Payload.parse`, so going over
 * the cap is not a truncated field, it is an exception rising from inside the
 * presence announcement. Whoever serializes the list cuts it at this number, and
 * the number must be the SAME: two constants written by hand, one here and one
 * in `call.ts`, would disagree the day someone changed one, and the way they
 * would disagree is the call breaking in silence at the seventeenth name.
 *
 * Sixteen because it is the cap of a call like this, and because the list names
 * people whose screen you are watching: half a dozen is the real case.
 */
export const TECTO_DO_AVER = 16

/**
 * The room the presence question claims to be in, which is no room at all.
 *
 * **This is the guard that protects 0.3.3 clients, and it lives here because it is
 * protocol.** The question ("who is in the room?") travels as a `voice.leave`
 * so an old client can receive it without choking (see `quemEsta`, below). In an
 * old client it reads as a goodbye, and a goodbye removes the person from the
 * call roster. The absent `room` reads as `""`, which is exactly the room of a
 * channel call or a direct chat: in those cases a question from one of our devices would
 * erase the OTHER device of the same account from the screen of whoever was
 * there, because rosters are indexed by ACCOUNT address not device address.
 *
 * With a room that cannot exist, the old client's room filter discards it before
 * it reaches the roster, the leave sound and the presence map. Nothing is lost
 * when it discards it: it cannot answer the question anyway.
 *
 * **It cannot collide with a real room, and it does not:** the room identifiers this
 * software generates are `forum-word-word` or `contio-word-word` (see
 * `roomIdFromBytes` in `names.ts`), and the empty string is the default room.
 * The `?` does not appear in any of them, and there is no interface that lets
 * you type a room identifier by hand.
 *
 * **And it is RESERVED on input, on the two remote paths where an arbitrary room
 * identifier enters.** No interface writing it is not the same as no path: the
 * list of rooms in a channel comes from `channel.meta` messages from other
 * members (`upsertRoom` in `session.ts`), and the `voice.move` is obeyed
 * without checking the room exists (`Call.handleSignal`). Both reject it. In a
 * 0.4.0 nothing would be lost by obeying (the sentinel is just an empty room),
 * but whoever went there would start announcing with `room: "?quem"`, and to a
 * 0.3.3 victim in the same room those announcements read as the goodbye this
 * constant exists to prevent.
 *
 * A 0.4.0 client handles the question BEFORE the room filter, as it handles the
 * `voice.move`, and so it still answers it. See `Call.handleSignal`.
 */
export const SALA_DA_PERGUNTA = "?quem"

/**
 * How far the saved text of a pinned message goes.
 *
 * **The copy is not decoration, it is the only way a pinned message exists for
 * whoever arrives.** The original body was encrypted in an earlier epoch and
 * forward secrecy guarantees whoever joined later will never open it; and even
 * for whoever was already there, the channel history has a cap and drops the
 * oldest: pin a message in January, come back in March, and you get a list of
 * identifiers pointing to nothing. Saving the text next to the identifier is
 * what makes "pinned" mean something two months later.
 *
 * One thousand characters, and the identifier always travels: whoever has the
 * original message in the vault reads it in full from there, and the copy is
 * what is left for whoever does not have it. An excerpt is honest; the lie would
 * be an empty list.
 */
export const PINNED_BODY_MAX = 1_000

/**
 * A pinned message in a room: who sent it, what they said, and who pinned it.
 *
 * `sender` and `body` are a COPY made by whoever pins it, not an authenticated
 * quote. MLS authenticates the sender of `channel.meta`, that is, who pinned
 * it. Whoever has the original message prefers it. The `id` is what links them,
 * which is why it travels even when the text travels too. The copy is what remains
 * for people who don't have the original, which is everyone who arrived later.
 *
 * `pinnedBy` is explicit, not inferred from the sender. The list is republished
 * by whoever runs the room when someone joins the channel. At that point the
 * sender is the republisher. Without this field, republishing would rewrite the
 * authorship of every pin to the republisher's name.
 */
export const PinnedMessage = z.object({
  id: MessageId,
  /** Address of whoever wrote the message. */
  sender: z.string().max(128),
  /** The text, up to `PINNED_BODY_MAX`. Empty is valid: a message with images only. */
  body: z.string().max(PINNED_BODY_MAX),
  sentAt: Timestamp,
  pinnedAt: Timestamp,
  /** Address of whoever pinned it. See above for why it is not taken from the sender. */
  pinnedBy: z.string().max(128),
})
export type PinnedMessage = z.infer<typeof PinnedMessage>

/**
 * A ticket, inside the message it belongs to.
 *
 * **Optional field inside `message`, never a new `t`.** It follows the path of
 * `ChannelInvite`, for the same survival reason: a `t` the receiver doesn't
 * know fails validation, gets discarded in full, counts as an ignored event,
 * and a series of them marks the channel deaf, triggering a reseat that takes
 * the history with it (forward secrecy). An optional field carries no such risk: an
 * old client strips what it doesn't know (that's what `z.object` does by
 * default) and shows the message.
 *
 * **This decides how the body is written.** For someone who doesn't know this
 * field, the body is everything left, so the body says what happened, in full,
 * on its own: "Closed the ticket.", not a blank line waiting for a label that
 * will never be drawn. A ticket in an old client reads as what it always was
 * underneath: a conversation.
 *
 * **One flag, not three event types.** Every ticket message carries `id`, which
 * links it to the others. What sets it apart is what it carries ON TOP of
 * that. With `subject`, it opens; with `state` or `assignee`, it decides;
 * with nothing else, it's a reply. Three optional fields in one object instead
 * of three different objects, because all three happen in the same place and
 * the same message can do two at once: taking a ticket says who will
 * handle it AND that it's now in progress.
 *
 * **Whoever opened it and whoever wrote it are always the sender authenticated
 * by MLS**, never a field inside here. `assignee` is the only person named, and
 * they're named by someone else: that's what "taking the ticket" means.
 */
export const TicketMark = z.object({
  /** The ticket this message belongs to. Chosen by whoever opens it. */
  id: MessageId,
  /**
   * The subject, present only in the message that opens the ticket.
   *
   * The first message is what names it, and the name doesn't repeat on every
   * line. Repeating it would let two versions of it travel and force a choice
   * between them. Whoever wants to change the subject changes it where it was
   * said, which is an edit. See `edit`, and see what's left to do in
   * `docs/PENDENTES.md`.
   */
  subject: z.string().max(120).optional(),
  /**
   * The state this message declares. Absent means "don't change the state".
   *
   * `open` · `working` · `closed`. **Narrow name, not `z.enum`**, see
   * `NarrowName`, and see what `powers` and `colour` already decided for the
   * same reason: a state invented by a later version can't reject the message,
   * because rejecting it here would cost the TEXT the person wrote, all to avoid
   * painting a label. Decoration can never kill structure.
   *
   * The reader judges the value against the list it knows and treats the rest
   * as absent: it keeps the previous state instead of inventing one. The
   * decision belongs there, because that's where the version knows what it can
   * draw.
   */
  state: NarrowName.optional(),
  /**
   * Who takes over. Empty string releases the ticket; absent doesn't change it.
   *
   * Empty and absent are different on purpose, and the distinction is the same
   * one `colour` already makes: absent is "this message doesn't talk about it",
   * empty is "this message says there's nobody". Without the difference,
   * releasing a ticket would be indistinguishable from replying to it.
   */
  assignee: z.string().max(64).optional(),
  /** The clock of whoever wrote this, so the most recent state wins. */
  at: Timestamp,
})
export type TicketMark = z.infer<typeof TicketMark>

/**
 * The states a ticket passes through, in order.
 *
 * Lives here, next to the field, for the same reason as `POWERS` and
 * `ROLE_COLOURS`: whoever writes the state and whoever draws it are different
 * layers, and two hand-written lists end up disagreeing. The schema is NOT a
 * `z.enum` of this, see `state` to understand why.
 *
 * Three, not four. A separate "resolved" from "closed" would force users to
 * pick between them every time they close one, and the difference is about
 * process, not outcome. Whoever needs it has roles and subjects to express it.
 * Add to the END, like the other lists.
 */
export const TICKET_STATES = ["open", "working", "closed"] as const
export type TicketState = (typeof TICKET_STATES)[number]

export const Payload = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("message"),
    /**
     * The room, inside the channel, that this belongs to.
     *
     * Absent is the default room, and that's what all messages written before
     * rooms existed look like, on purpose, so they don't disappear.
     */
    room: z.string().max(64).optional(),
    id: MessageId,
    sentAt: Timestamp,
    body: z.string().max(16_000),
    /** Message being replied to, by id. Resolved entirely client-side. */
    replyTo: MessageId.optional(),
    attachments: z.array(Attachment).max(10).default([]),
    /**
     * Link cards, composed by whoever SENDS them.
     *
     * The same rule that already applies in posts, for the same reason, see
     * the long comment in `post.links`. The reader never talks to the site. If
     * the preview were built on the reader's side, everyone who opened the
     * conversation would hand their IP address to the link owner without
     * clicking anything. Here the pixels travel inside the encrypted message.
     *
     * Four, like in posts: a message with five cards isn't a message anymore,
     * and each thumbnail counts against the same byte limit as attachments.
     */
    links: z.array(LinkCard).max(4).default([]),
    /**
     * Addresses this message mentions. Kept in the payload rather than parsed
     * from the body so that notification routing never needs a server-side
     * regex over plaintext.
     */
    mentions: z.array(z.string()).max(64).default([]),
    /**
     * This message is an invite to a channel.
     *
     * The body stays the body, written to read on its own: someone who doesn't
     * know this field reads a sentence saying what happened. See
     * `ChannelInvite`.
     */
    invite: ChannelInvite.optional(),
    /** This message is a reply to an invite. See `ChannelInviteReply`. */
    inviteReply: ChannelInviteReply.optional(),
    /**
     * This message is a poll.
     *
     * The body stays the body and carries the question and options written in
     * full: someone who doesn't know this field reads the poll as text and
     * answers in words. See `Poll`, where the rest of the argument is.
     *
     * `.catch(undefined)` because an unreadable poll can't take the message
     * down with it. That's the difference between losing a card and losing the
     * sentence.
     */
    poll: Poll.optional().catch(undefined),
    /**
     * This message belongs to a ticket and might decide something about it.
     * See `TicketMark`.
     */
    ticket: TicketMark.optional(),
  }),

  z.object({ t: z.literal("edit"), id: MessageId, target: MessageId, editedAt: Timestamp, body: z.string().max(16_000) }),

  /**
   * A tombstone, not a deletion. Members who already received the message can
   * honour it; the protocol cannot make bytes on someone else's disk disappear,
   * and claiming otherwise would be the kind of promise this project should not
   * make. What it *does* guarantee is that the server never held the plaintext.
   */
  z.object({ t: z.literal("redact"), id: MessageId, target: MessageId, redactedAt: Timestamp }),

  z.object({ t: z.literal("reaction"), target: MessageId, emoji: z.string().max(32), remove: z.boolean().default(false) }),

  /**
   * Typing and presence are opt-in per space and default to off. They are the
   * highest-frequency, lowest-value signal in a chat app and the easiest way to
   * build a minute-by-minute activity profile of a person.
   *
   * `until` is a DEADLINE, not a state. That choice is what makes the indicator
   * work. If someone closes their laptop mid-sentence, they never send a
   * "stopped typing" message. If the end depended on a second message, they'd
   * stay typing on everyone else's screen forever. With a deadline, silence
   * clears the indicator on the reader's side on its own, without waiting for
   * anything.
   *
   * Never enters any history. The session's `#recordPayload` has no branch for
   * this, and `#applyEvent` cuts it before it reaches the conversation line.
   * Storing a signal like this would fill the 400 slots per channel and push
   * real messages out of the vault.
   *
   * The sending pace is the sender's job. An event per keystroke would give the
   * server (which reads nothing) the exact rhythm of who's typing. See
   * `useTyping.ts` in the interface, where the numbers are chosen and
   * explained.
   */
  /**
   * A nudge, the MSN Messenger nudge.
   *
   * Shakes the other person's window and plays a sound. It works because it's
   * physical: not a notification asking for attention, but a tap on the
   * shoulder of someone distracted. It only makes sense between two people
   * (thirty nudges at once aren't a nudge, they're an alarm), but that's an
   * interface rule, not a schema rule: here only the intent travels.
   *
   * **Ephemeral, like the typing signal, and for the same reason taken
   * further.** A stored buzz would take one of the slots history has for what
   * was said. Worse: it would REPLAY on backfill. Someone opening the
   * conversation the next day would get all the previous day's nudges at once,
   * shaking their screen. The cut is in `#applyEvent`, before the vault and
   * before the conversation.
   *
   * `at` is the clock of whoever sends it, so the receiver can reject an
   * absurdly old nudge that a replay might have let through. Not a cryptographic
   * defense: the same caution as the typing signal's deadline.
   */
  z.object({ t: z.literal("buzz"), at: Timestamp }),

  z.object({
    t: z.literal("typing"),
    /**
     * The room, inside the channel, where someone is typing.
     *
     * Absent is the default room, like in `message`. Without this, someone
     * typing in a room would appear typing in all other rooms in the same
     * channel: there is only one cryptographic group, and this field is what
     * separates the conversations.
     */
    room: z.string().max(64).optional(),
    until: Timestamp,
  }),

  /**
   * A person's profile.
   *
   * Every field here is inside the ciphertext, which is what makes it safe to
   * offer the things a normal signup form asks for. On a conventional service,
   * a display name and an email address are rows in an operator's table — the
   * two values that turn an account into a person and make it subpoena-able.
   * Here they are group state: your contacts can see them, the server cannot,
   * and there is no global directory to correlate across communities.
   *
   * Consequences worth stating: none of this is verified, and none of it is
   * recoverable. There is no confirmation email because there is nobody to send
   * it. The email field is a way to tell people how to reach you off-platform,
   * not a credential and not a recovery path.
   */
  z.object({
    t: z.literal("profile"),
    /**
     * Write stops at 32 (see `NAME_MAX` in the editor), but read accepts 64.
     *
     * It's not an oversight. Tightening the read limit at the same time as the
     * write limit would reject profiles of people who already have a longer
     * name, and a rejected payload gets discarded in full and in silence,
     * counts as an ignored event, and several in a row mark the channel deaf
     * (see `DEAF_FAILURES`). Shrinking a read limit always risks that. Shrinking
     * the write limit risks nothing.
     */
    displayName: z.string().max(64),
    /**
     * Chosen activity state, shown by members' clients as the dot's colour.
     * `online` · `ocupado`. "invisivel" is not published as a state, an
     * invisible person simply stops being announced by the gateway, so there is
     * nothing to say here.
     *
     * Narrow name, not `z.enum`, see `NarrowName`. A future state (an
     * `ausente`, the most obvious one missing) rejected here would not cost the
     * colour of a dot: it would cost the entire profile of whoever published it
     * (name, portrait, biography and support links), and the old client would
     * see that person as someone who never filled anything in. Absent is already the normal
     * case, and an unknown name reads as absent.
     */
    activity: NarrowName.optional(),
    avatar: Attachment.optional(),
    statusText: z.string().max(128).optional(),
    bio: z.string().max(1000).optional(),
    /** Optional and unverified. Shown to members, never sent to a server. */
    email: z.string().max(254).optional(),
    /**
     * How to support this person. Kept as structured entries rather than free
     * text so a client can render them without parsing links out of a bio —
     * and so no request ever leaves the app to a payment provider's tracker.
     */
    donations: z
      .array(
        z.object({
          /**
           * `url` · `iban` · `paypal` · `kofi` · `liberapay` · `bitcoin` ·
           * `monero` · `other`. Narrow name, not `z.enum`, see `NarrowName`.
           *
           * This list ages faster than any other in the file: payment methods
           * come and go on a rhythm that's not ours. And the price of a new
           * name was absurdly out of proportion: the entire profile rejected because
           * someone added a line saying how to receive five euros. Whoever reads
           * a name it doesn't know shows the entry as `other`, with the label
           * the person wrote.
           */
          kind: NarrowName,
          label: z.string().max(48),
          value: z.string().max(256),
        }),
      )
      .max(8)
      .default([]),
    updatedAt: Timestamp,
  }),

  /**
   * How a channel presents itself: name, description and icon.
   *
   * The name that goes here is the real name, with capitals, accents and spaces.
   * The channel identifier stays as it always was, lowercase with hyphens, because
   * it is the MLS group key and changing it would mean changing groups. One is the
   * address, the other is the label.
   *
   * `updatedAt` decides between concurrent writes, like in the profile: the most
   * recent wins. Unlike the profile, the subject is not the sender, it is the
   * channel, so who can write this is not self-evident and is a matter of roles
   * (phase 3). Until then, any member can.
   */
  z.object({
    t: z.literal("space.meta"),
    name: z.string().max(100),
    topic: z.string().max(1024).optional(),
    icon: Attachment.optional(),
    updatedAt: Timestamp,
  }),

  /**
   * The channel is over. The tombstone marks the entire channel, not a single room.
   *
   * **What this does:** an honest client that receives it drops the channel: group,
   * history and recovery anchor, exactly what it would drop if the person had left.
   * It stops appearing and does not come back.
   *
   * **What this does NOT do, and no text can pretend it does:** delete other people's
   * messages. They are encrypted in each person's vault, the server never had them
   * in the clear, and whoever deletes the channel has no way to reach them. An
   * altered client ignores this tombstone and keeps everything it already had. This
   * is the product's premise working against whoever invokes it, and it is honest
   * that it should be this way.
   *
   * Own payload, not a `removed` in `space.meta`, for two reasons that add up. The
   * first is what made the categories split: `space.meta` carries the channel icon
   * embedded, and you do not republish an image to say one word. The second is
   * deeper: `removed` in `space.meta` was a reversible field in a message that gets
   * rewritten. All it took was one client that had not seen it renaming the channel,
   * with a newer timestamp and `removed` at its default value, to resurrect it. Here
   * there is no default value to fall back to: the tombstone can only be stated, and
   * once stated it cannot be undone.
   *
   * No `expulsion` goes with it, deliberately. Expelling everyone advances the
   * epoch and closes whatever comes next, but nothing comes after this, so it
   * protects nothing. And it would cost: the tombstone travels INSIDE the group, so
   * anyone expelled before reading it would be left out without ever knowing why, and
   * would see an expulsion where there was the end of a channel.
   */
  z.object({ t: z.literal("space.removed"), removedAt: Timestamp }),

  /**
   * "I left this channel: remove my leaf."
   *
   * The twin of `friend.remove`, generalized to any channel, and it exists for the
   * reason this line was written: **MLS does not let anyone remove
   * themselves.** A commit that removes the leaf of whoever signs it is invalid
   * (RFC 9420 §12.2, proposal list), so leaving for real always requires ANOTHER
   * member to make the commit. Without this, leaving was a local gesture: the
   * channel disappeared from the screen of whoever left and the leaf stayed in the
   * tree for everyone, with the epoch frozen, meaning whoever left could read
   * everything that came next if they had kept the keys.
   *
   * That is why deleting the account used to leave the person visible in channels:
   * `Vault.destroy()` cleaned the vault and nothing else.
   *
   * **What this is, exactly:** an encrypted request to the client of whoever stays,
   * authenticated by MLS. No one can issue it in anyone else's name, because whoever
   * receives it only removes the leaf of the SENDER. Whoever honors it makes a
   * commit, and that commit is what advances the epoch and closes the future to
   * whoever left. The cryptographic guarantee comes from the commit; this is what
   * asks for it.
   *
   * **What this does NOT do:** delete what has already been said. Leaving counts
   * going forward, like an expulsion, and calling it something else would be a lie.
   */
  z.object({ t: z.literal("member.left"), leftAt: Timestamp }),

  /**
   * A room inside a channel: name, category, type and order.
   *
   * The room is NOT its own cryptographic group, it is a division inside the
   * channel's group, and the `room` label on messages is what separates them.
   * Anyone in the channel has the keys to all public rooms: hiding a room is
   * organization, not security, and that has to be stated where people read it.
   *
   * Real cryptographic separation exists in restricted rooms, which are their own
   * groups, and those continue to be channels like they always were.
   *
   * `room` is a short identifier, chosen by the creator and never shown: the name
   * changes, the identifier does not, or renaming a room would lose its messages.
   */
  z.object({
    t: z.literal("channel.meta"),
    /** The room identifier within the channel. Not an address. */
    room: z.string().max(64),
    name: z.string().max(100),
    topic: z.string().max(1024).optional(),
    /** The name of the category it belongs to. Empty means uncategorized. */
    category: z.string().max(64).default(""),
    /**
     * Whether the room is for text or for voice.
     *
     * **Closed `z.enum`, and it is the only one that survives in this file.** The
     * criterion that decided the others is in `NarrowName`: open the list when it
     * names things in the world that keep appearing without asking permission, like
     * file formats, link types, payment methods, presence states. Close it when it
     * names a structural choice of ours, whose number of cases is set by the product
     * and not by reality.
     *
     * This is the second kind. A room either carries application messages or carries
     * a WebRTC call, and that fork is what all voice signaling assumes: `voice.join`
     * and the rest exist on one side and not the other. A "forum" or an "announcements"
     * room are text rooms with a different layout, and a "lounge" is a voice room
     * with different rules: they ask for a display field, not a third `kind`.
     *
     * **What it costs if this reading is wrong, for whoever comes next.** An unknown
     * `kind` rejects the entire `channel.meta`, and with it go the name, category,
     * position and, what matters, the tombstone `removed`. A rejected tombstone
     * resurrects the room, because silence does not propagate. Whoever adds a third
     * value must, in the same change, swap this for `NarrowName`. The alternative is
     * watching deleted rooms come back on their own.
     */
    kind: z.enum(["text", "voice"]).default("text"),
    /**
     * How the room is READ. Absent is the usual conversation.
     *
     * This is the "display field" that the `kind` comment above tells you to use
     * instead of a third type, and the first room that needed it was tickets, which
     * is literally the case it anticipated: it carries application messages like any
     * text room, and what changes is the layout you read them in.
     *
     * **Why it was not a new `kind`, stated in full.** It is not just that the
     * `removed` tombstone dies with a rejected `channel.meta`. It is that swapping
     * that `z.enum` for an open format today would not save anyone: the clients out
     * there have the `z.enum` they already downloaded, and THEIR validation decides
     * what happens to a room we publish. Today's schema only protects whoever comes
     * next. A new field protects both sides, and protects them now.
     *
     * **What a client that does not know it sees:** a text room, with the ticket
     * conversation inside, in messages whose body reads on its own. It loses the layout
     * and loses nothing of what was said, which is the right degradation, and it is
     * what `voice.join.muted` already chose.
     *
     * **Narrow name, not `z.enum`**, unlike the `kind` above, and the difference is
     * what `NarrowName` explains: `kind` names a fork of ours with two branches
     * (application messages or WebRTC); this list names ways to display, and those
     * keep appearing: a forum, an announcements board, a board. Whoever reads a display
     * they do not know draws the usual conversation, which is what absent already
     * means.
     *
     * Optional, and no `.default()`: a default value would write a choice no one
     * made in all rooms that already exist.
     */
    layout: NarrowName.optional(),
    position: z.number().int().default(0),
    /** Closed: stops appearing, without deleting what was said there. */
    closed: z.boolean().default(false),
    /**
     * Deleted: the room ceases to exist and does not come back.
     *
     * A tombstone, not an absence, for the same reason `removed` exists in roles:
     * **silence does not propagate**. Simply stopping publishing the room would cause
     * the earlier `channel.meta`, still stored in everyone's vaults, to resurrect it
     * on the next start. You have to say it died, with a timestamp newer than the one
     * that created it.
     *
     * What this does NOT do, and no text can pretend it does: delete messages. The
     * messages are encrypted in each person's vault, the server never had them in the
     * clear, and whoever deletes the room has no way to reach them. What happens is
     * that their `room` label stops naming a room, and the interface reads them in the
     * default room, which is where all messages without a label already fall. See
     * `visible` in `App.tsx`.
     */
    removed: z.boolean().default(false),
    /**
     * The messages pinned in this room. See `PinnedMessage` and `MAX_PINNED`.
     *
     * **Optional field in a form that already exists, never a new `t`**, for the
     * reason always written out in `voice.join.muted`: a `t` the old client does not
     * know fails the entire union, the payload is discarded in silence, counts as an
     * ignored event, and consecutive ignored events mark the channel deaf and trigger
     * the repair that DELETES HISTORY. A field it does not know costs it nothing on
     * read: it still sees the room, it just does not know something is pinned
     * there.
     *
     * **ABSENT IS NOT AN EMPTY LIST, and it is the decision that makes this feature
     * fit here.** Absent means "this does not talk about pins"; an empty list means
     * "nothing is pinned". It is the opposite of the rule in `channel.category.roles`,
     * and the difference is not taste: pinning and organizing the room are gestures
     * of different people, with different responsibilities, and the same form carries
     * both. Without this distinction, renaming the room, or closing it, or dragging it
     * to another category would unpin everything in silence, and whoever renamed it
     * would never know. The reader keeps what it knew until someone tells it
     * otherwise; see `#drainRecords` in the core, where the rule is enforced.
     *
     * And it is also what spares the old client from knowing about it: it republishes
     * the `channel.meta` without the field, and the pin survives that republication
     * instead of dying in it.
     */
    pinned: z.array(PinnedMessage).max(MAX_PINNED).optional(),
    updatedAt: Timestamp,
  }),

  /**
   * A channel category: that it exists, and the order it is read in.
   *
   * A category is still, above all, the name written in the `category` field of each
   * room, which fills it. What this record adds is the only thing that field cannot
   * say: that the category EXISTS even with no room declaring it, and the order the
   * categories are read in.
   *
   * Without it, creating an empty category was impossible to express: there was
   * nowhere to write it, and it only came to exist when the first room landed there.
   * That forced you to create room and category in one gesture, and they are two
   * gestures.
   *
   * Not in `space.meta` on purpose, even though it is tempting. `space.meta` carries
   * the channel icon embedded, and republishing it with every category change would
   * send the whole image to everyone each time someone organized the sidebar. Replicated
   * icons once made up almost the entire database of a real server; we do not
   * repeat the mistake for schema convenience.
   *
   * `category` is both the name and the key, unlike rooms and roles, where the
   * identifier and the label are different things. It is deliberate and follows from
   * the model: two categories with the same name ARE the same category, because what
   * defines them is the text the rooms carry. Changing the name was already rewriting
   * that text in all rooms, and it still is.
   *
   * `removed` because silence does not propagate, like in `role.define` and like in
   * the room tombstone.
   *
   * `roles` is the most recent addition and the easiest to misread: it says who SEES
   * the rooms in this category, never who REACHES them. See the field, where the
   * difference is written out in full: the difference between organizing and
   * protecting.
   */
  z.object({
    t: z.literal("channel.category"),
    category: z.string().max(64),
    position: z.number().int().default(0),
    /**
     * Which roles see the rooms in this category. Empty means everyone.
     *
     * **Organization, not security, and the schema cannot pretend otherwise.** Anyone
     * in the channel has the keys to ALL public rooms: the room is not its own
     * cryptographic group, it is a label inside the channel's group (see `channel.meta`,
     * which already says it). A hidden room still gets messages encrypted with the key
     * everyone has, and an altered client reads them with no effort. What this does is
     * remove lines from the list of those who do not need them, which is useful, and
     * that is all.
     *
     * Real separation is still a separate channel, which is a separate group, with a
     * separate MLS tree. Whoever needs to hide conversations from channel members needs
     * that, not this, and the interface has to say so where the gesture happens.
     *
     * **Empty is the normal case and has to stay that way.** An empty list means
     * "everyone", never "no one": the opposite reading would make all categories
     * already published, which do not have this field, disappear from everyone's screen
     * the first time someone opens the new app.
     *
     * Roles by identifier, not by address, like in `role.assign`: the role is the label
     * and people enter and leave it. A list of addresses here would force you to
     * rewrite the category every time someone joined.
     *
     * Sixteen, the same cap as `role.assign`: a channel with more than sixteen roles
     * deciding a single category is not a rule anyone reads.
     */
    roles: z.array(z.string().max(32)).max(16).default([]),
    removed: z.boolean().default(false),
    updatedAt: Timestamp,
  }),

  /**
   * Roles are enforced by every client independently, from group state. A server
   * that cannot read the group also cannot be the one to enforce permissions —
   * so a compromised server can drop messages, but it cannot grant itself admin.
   */
  /**
   * A channel role: name and the responsibilities it grants.
   *
   * Empty `powers` is the case the owner asked for first and the easiest to
   * lose: a role that grants no management power and only says that this person
   * has access to the channel. It's not a list waiting to be filled in; it's the
   * thing itself.
   *
   * **The four responsibilities are not equal, and the interface must say so.**
   * `expulsar` removes the leaf from the MLS tree, advances the epoch, and the
   * person who leaves truly cannot read anything that follows: it's
   * cryptography, and even a modified client cannot undo it. `convidar`,
   * `renomear`, and `mover` are convention enforced by honest clients: a
   * modified client invites anyway, ignores the new name anyway, and refuses to
   * be moved anyway. Promising all four with the same face is promising
   * protection where there is only organization, the same care already written
   * for public rooms in `channel.meta`.
   *
   * Withholding a responsibility is never cryptographic, `expulsar` included:
   * any member can commit a removal, and what stops it from happening is each
   * honest client refusing to show the button and refusing to accept the
   * result. The difference is in the EFFECT: a successful expulsion is
   * irreversible; the other three are only what clients make of them.
   *
   * `role` is the identifier within the channel and never changes; `name` is
   * the label and changes freely. Same distinction as between a room id and its
   * name, for the same reason: renaming a role must not unname anyone.
   *
   * `removed` exists because silence does not propagate. A role that deleted
   * itself by ceasing to publish would stay alive on every device that had
   * already saved it, with the powers it had.
   */
  z.object({
    t: z.literal("role.define"),
    role: z.string().min(1).max(32),
    name: z.string().max(48),
    /**
     * The role's responsibilities, by name. See `POWERS`.
     *
     * **Narrow format, not `z.enum(POWERS)`**, exactly like `colour` right
     * below, for the reason spelled out there in full. `POWERS` grows by design
     * (`eliminar` came in last), and an `enum` would make a future power reject
     * the entire payload: the old client would not lose a power, it would lose
     * the role itself, the name, the powers it already knew (`expulsar`
     * included), and its very existence, left unable to edit or delete it.
     *
     * **And the `enum` saved nothing.** Who decides what a role grants is
     * `rolesOf`, which filters by `POWERS` and never returns a name this
     * version does not know: the filtering happens on read, and it must happen
     * there: the reader's filter runs only after the payload reaches the vault,
     * and an `enum` would reject it before that. Refusing here did not protect
     * against granting the unknown; it protected against storing a role.
     *
     * The cap was `POWERS.length`, which was the same flaw in another form: six
     * powers from a future version did not fit in a version that knows five.
     * Thirty-two is a fixed number, unlinked from the list size.
     */
    powers: z.array(NarrowName).max(32).default([]),
    /**
     * The role's color, by name. See `ROLE_COLOURS`, which explains why it is
     * a name and not an `#rrggbb`.
     *
     * **Optional, and absence is the normal case.** No `.default()`: a default
     * would write a choice nobody made to every role that already exists, and
     * "no color" must stay "no color", never black, never transparent, never
     * the first color in the list. New field, not new `t`, for the same reason:
     * an unknown `t` in an old client feeds the cascade of multiple ignored
     * events in a row that marks the channel deaf.
     *
     * **Narrow format, not `z.enum(ROLE_COLOURS)`.** What this field must
     * prevent is garbage: a free string here would accept an entire `style`, a
     * `url(...)`, or half a megabyte of nothing, and what reaches the screen is
     * chosen by a name. Lowercase ASCII and sixteen characters is enough to name
     * a color and not enough for anything else. The `enum` would be narrower
     * and worse: a future color would reject the payload, and a discarded
     * `role.define` takes the entire role with it. It is the reader that
     * discards what it does not know.
     */
    colour: z
      .string()
      .regex(/^[a-z]{3,16}$/)
      .optional(),
    /** Order in the list. Pure presentation: grants no authority. */
    position: z.number().int().default(0),
    removed: z.boolean().default(false),
    definedAt: Timestamp,
  }),

  /**
   * What roles this person holds in this channel.
   *
   * The whole list, not a change: the latest from someone with authority wins, and an
   * empty list means "none". An incremental format would require all clients to
   * have seen every step, and whoever joins the channel midway never saw them.
   *
   * `admin` is the built-in role, which grants all four responsibilities and
   * also the power to manage roles. It is not defined or deleted, and it is
   * what keeps channels created before this working without migration.
   */
  z.object({
    t: z.literal("role.assign"),
    subject: z.string(),
    roles: z.array(z.string().max(32)).max(16),
    assignedAt: Timestamp,
  }),

  // ----------------------------------------------------------------- voice
  //
  // Call signalling travels as ordinary encrypted application messages rather
  // than through a signalling server. That is not just tidiness: SDP and ICE
  // candidates carry codec fingerprints, network topology and host addresses,
  // and "who is in a call with whom, right now" is among the most sensitive
  // metadata a chat service holds. Routing it through MLS means the homeserver
  // sees participation in a channel it already knew about, and nothing more.

  /**
   * Announce presence in the call. Peers answer with `voice.offer`.
   *
   * `sframe` advertises whether this participant's engine can encrypt media
   * frames above the transport. It has to be negotiated rather than assumed:
   * Chromium exposes insertable streams, Firefox does not, and a sender that
   * encrypts to a receiver that cannot decrypt produces perfect silence —
   * every frame arrives, fails its tag check, and is discarded.
   */
  /**
   * `alone` says the person announcing has no active connection.
   *
   * It serves to tell apart two things that fit in the same frame and want the
   * opposite. Reloading the page never sends `voice.leave`: on the other side
   * the connection keeps saying it is alive for thirty-odd seconds until ICE
   * admits it died, and the announcement of the person returning must tear it
   * down to start fresh. But the same frame is also the answer the highest
   * address broadcasts to each arrival, so the lowest can offer, and that
   * reaches people already connected to it. Without this distinction, either
   * the return does not connect, or everyone entering breaks every good
   * connection in the room.
   */
  /**
   * `muted` says the microphone of the person announcing is muted.
   *
   * Optional field in an existing frame, and NEVER a new `t`: the choice is
   * deliberate and the opposite of what seemed tidier. An old client receiving an
   * unknown `t` fails the entire union, discards the payload in silence, counts
   * it as an ignored event, and several ignored events in a row mark the
   * channel deaf: the cascade that erased history once. These schemas are not
   * `strict()`, so a field the old client does not know is dropped on read at
   * no cost: it keeps hearing the call, just without knowing who is muted.
   *
   * Absent means "unknown", not "speaking". An old client never sends it, and
   * assuming `false` would put on screen the claim that the person is speaking,
   * which is precisely the lie this field exists to undo.
   */
  z.object({
    t: z.literal("voice.join"),
    /**
     * The voice room within the channel that this call belongs to.
     *
     * Absent is the channel call, what all prior signaling looks like, and
     * what lets an old version talk to a new one without both going deaf. Two
     * voice rooms in the same channel are two separate calls, and this field is
     * what separates them.
     */
    room: z.string().max(64).optional(),
    at: Timestamp,
    video: z.boolean().default(false),
    sframe: z.boolean().default(false),
    alone: z.boolean().default(false),
    muted: z.boolean().optional(),
    /**
     * Which LIFE of this person this announcement belongs to.
     *
     * A new value each time they join the call, same across all frames of that
     * join. The receiver compares with what it saved: different value is a new
     * session, and what was left from the previous one dies no matter its state;
     * same value is the same announcement repeated, and nothing moves.
     *
     * It exists because `alone` is not enough. `alone` says "I have no
     * peer", which is true both for someone just joining and someone still
     * negotiating, and the difference between the two is the difference between
     * cleaning a phantom and breaking a good negotiation in half. Without this
     * distinction, a peer that was not connected survived the cleanup and
     * blocked the offer forever: the person reentering vanished to that person
     * and to no one else.
     *
     * It is not a secret or an identity: it is a serial number for a join,
     * read only by those already in the group. Whoever fakes it only gets a
     * connection to themselves remade.
     */
    joinId: z.string().max(64).optional(),
    /**
     * Who this announcement is asking to remake the connection.
     *
     * `alone` answers "I have no peer" when the question that matters is "do I
     * still have YOU?". With two people both questions have the same answer;
     * with three they stop, and that is when the difference started costing a
     * call.
     *
     * The case, measured: the connection between two people dies on one side
     * only (a network drop, the connection timer firing). Whoever loses it cleans
     * it and reannounces, but with the same `joinId`, because they did not
     * rejoin anywhere: the network fell out from under them. On the other side,
     * the same `joinId` triggers no cleanup, `alone` is false because there is
     * still a third peer, and the offer gives up first because the dead
     * connection still has a local description. Three guards cancel each other,
     * and one person sees the other "connecting" forever while hearing the third
     * fine.
     *
     * Whoever sees themselves in this list knows their connection no longer
     * exists on the other side, and tears it down. It is the only missing piece,
     * and it cannot be inferred from any other field.
     *
     * It reveals nothing the reader does not already know: it only reaches those
     * in the channel, and names people in the same call as the reader. The cap exists
     * because a mesh this size does not grow past half a dozen people.
     */
    reparar: z.array(z.string().max(128)).max(16).optional(),
    /**
     * This person is sharing their screen right now.
     *
     * Optional field in an existing frame, for the third time and for the same
     * reason as always: a new `t`, `voice.screen`, would fail the entire
     * union in an old client, the payload would be discarded, count as an
     * ignored event, and ignored events in a row mark the channel deaf and
     * trigger the repair that wipes history.
     *
     * This field, not the arrival of a track, decides whether a shared screen
     * is shown. The video transceiver reserved for this exists on EVERY
     * connection, with or without sharing (see `#buildPeer`), so the other side
     * always gets a track in that slot: muted, empty, waiting. Drawing it
     * without this would put a black rectangle on everyone's screen all the
     * time.
     *
     * Absent is "not sharing", and here that reading is safe unlike `muted`: an
     * old client too old to know the field is also old enough to not share
     * anything.
     */
    screen: z.boolean().optional(),
    /**
     * The identifier of the `MediaStream` that carries the screen when it travels with one.
     *
     * The honest caveat, and the reason this field is optional instead of the
     * backbone of the feature: with a reserved transceiver and `replaceTrack`,
     * the track goes on air WITHOUT `msid` (the `msid` is fixed when the sender is
     * created by `addTrack(faixa, stream)`, and changing it afterwards requires
     * renegotiation, which is exactly what this feature refuses to do). On the
     * other end, `event.streams` arrives empty and there
     * is no id to compare.
     *
     * It stays because it is not always so: a client that renegotiates (none today,
     * maybe tomorrow) puts the `msid` on the wire, and then the comparison is exact
     * and does not depend on m-line position. The reader uses it when it matches,
     * and falls back to the transceiver position when it does not. See `ontrack` in `call.ts`.
     */
    screenStream: z.string().max(128).optional(),
    /**
     * The person announcing is on a version that talks to the SFU, not the mesh.
     *
     * Optional field in an existing frame, for the fourth time and for the
     * usual reason: a new `t` would fail the entire union in an old client,
     * the payload would be discarded, count as an ignored event, and ignored
     * events in a row mark the channel deaf and trigger the repair that WIPES
     * HISTORY. What changes between clients goes in fields, never in types.
     *
     * **Absent means "mesh", and here the reading is safe**, unlike `muted`: an
     * old client too old to know the field is, by construction, a client that
     * only knows peer-to-peer negotiation. There is no third option to infer.
     *
     * It exists for one reason only, and it is a UI reason: **there is no
     * interoperability between a mesh client and an SFU client in the same
     * call** (see `docs/PLANO_SFU.md`, section 3). The mesh one offers and the
     * SFU one never answers, because it has no one to answer to. Without this
     * field, what you saw was "connecting…" for thirty seconds and then nothing,
     * the exact symptom of a network outage, pointing the wrong way. With it,
     * the mesh client can say on screen that the other person is on a version
     * it cannot reach, and that the fix is to reload. An honest sentence
     * instead of a spinning clock.
     *
     * Nobody sends it today: it is born now, within the full restart window,
     * because a field declared late does not help the version already out there,
     * and what will send it is the `call-sfu.ts` of Phase 2. It is not a secret
     * or authority: it says which transport engine the other end uses, something
     * the first media packet would reveal anyway.
     */
    sfu: z.boolean().optional(),
    /**
     * Whose screen is this person watching.
     *
     * Optional field in a frame that already exists, for the sixth time and for
     * the usual reason: a new `t` would fail the entire union in an old client,
     * the payload would be discarded, count as an ignored event, and consecutive
     * ignored events declare the channel deaf and trigger a repair that DELETES
     * HISTORY. What changes between clients is expressed in fields, never in types.
     *
     * It exists because of the mirror-image gap in the owner's request on October 5,
     * 2026: he asked that someone's screen only be seen by choice, and the same
     * piece has another side: **the sharer does not know who is watching.** With the
     * choice in place, it becomes information that is genuinely missing: before
     * this everyone watched, and knowing who watched said nothing.
     *
     * **Not read from the SFU, which is why it travels here.** The server knows
     * who consumes what, but the sharer has no way to ask it: there is no frame
     * that says it, and inventing one would make the server answer about people
     * instead of relaying frames. Each person's client states what it CHOSE, which
     * is the honest answer: it is a claim by whoever makes it, not a server
     * record.
     *
     * It reveals nothing that the reader does not already know, by the same reasoning
     * as `reparar`: it only reaches those in the channel, and names people in the
     * same call. The cap is the same and for the same reason: a call of this
     * nature does not exceed half a dozen shared screens at once.
     *
     * Absent means "did not say", and reads as not watching: a client too old to
     * know this field is also too old to choose, because the screen always
     * arrives in it. The reading errs on the safe side: the sharer sees "0 watching"
     * instead of counting people who chose nothing.
     *
     * **The cap is `TECTO_DO_AVER`, and whoever writes the list must read it.**
     * `encodePayload` does `Payload.parse`: a list larger than this is not a
     * rejected field, it is an exception rising from inside the presence
     * announcement: that is, the call stopping its announcement and, at 160 s,
     * everyone removing us from the roster. See the constant, where this is
     * written in full.
     */
    aVer: z.array(z.string().max(128)).max(TECTO_DO_AVER).optional(),
  }),
  z.object({
    t: z.literal("voice.leave"),
    at: Timestamp,
    room: z.string().max(64).optional(),
    /**
     * "I am not in the call: who is?"
     *
     * Someone opening the app in the middle of a call sees no one inside, and it
     * is not a design defect: the list is made from `voice.join` messages this
     * device HEARD, and joins sent earlier are not recovered in the catch-up:
     * voice signaling only counts live, on purpose (see `session.ts`). Until now
     * the answer was to wait for the heartbeat of whoever was there, which comes
     * every 50 seconds. The owner reported it twice: "some people do not see who is in
     * the room before they enter".
     *
     * The server warns others when someone arrives, and those in the call answer
     * that warning (`Call.reafirmarPresenca`), but **someone arriving invisible is
     * not announced**, and rightly so: invisible is invisible (`#announcePresence`,
     * in the gateway). The missing half is the symmetric one: whoever arrives ASKS.
     * One round trip instead of 50 seconds, and it works while invisible, because
     * the question is ours and not an announcement of ours.
     *
     * **Optional field in a frame that already exists, for the fifth time and for
     * the usual reason:** a new `t`, `voice.who`, would fail the entire union in
     * an old client, the payload would be discarded, count as an ignored event,
     * and consecutive ignored events declare the channel deaf and trigger a repair
     * that DELETES HISTORY. What changes between clients is expressed in fields,
     * never in types.
     *
     * **And it is `voice.leave` that carries it because `voice.leave` already
     * states exactly the premise of the question: whoever asks is not in the call.**
     * An old client reads it as someone's goodbye, and this is where the first
     * version of this got it wrong: the goodbye of someone who "was never there"
     * would be harmless, but **rosters are indexed by ACCOUNT address, not by
     * device**, and a device that asks may have the OTHER device of the same
     * account in that call. In that case the question erased it from the roster
     * of those there, with the leave sound playing, until the next heartbeat.
     *
     * **The guard is the room: the question claims to come from
     * `SALA_DA_PERGUNTA`**, which cannot be any room identifier. An old client's
     * room filter discards it before the roster, before the sound and before the
     * presence map, and nothing is lost, because it does not know how to answer
     * it. See the constant, which explains why it does not collide.
     *
     * Measured in `call.quem-esta.test.ts`, including with a reader that plays
     * the 0.3.3 order (room filter before goodbye), which goes red without the
     * sentinel. And run against dist 0.3.3 for real in
     * `scripts/e2e-cliente-antigo.mjs`, where the question with the call's room
     * REMOVES people from the roster (the defect, measured), and the
     * question as it comes out of this code removes no one.
     *
     * The premise must be true, and that is why someone in a call in THIS channel
     * does not ask: `voice.leave` is channel-wide in the reader's roster, and
     * asking from inside would erase us from the others' screen until our next
     * heartbeat. See `Call.perguntarQuemEsta`.
     *
     * Absent means "this is a goodbye for real", which is what all `voice.leave`
     * in the world up to now have been.
     */
    quemEsta: z.boolean().optional(),
  }),

  /**
   * WebRTC offer/answer, addressed to one member.
   *
   * `to` is honoured by clients, not enforced by a server — everyone in the
   * group can decrypt it. That is acceptable because a group member is already
   * trusted with the call's media keys; it is not a confidentiality boundary,
   * only a routing hint.
   */
  /**
   * **`voice.offer`, `voice.answer` and `voice.ice` never leave this union. Ever.**
   *
   * The move to SFU stops EMITTING them (with an SFU there is one connection per
   * client, negotiated with the server, not with peers), and the next
   * temptation is to delete the schemas along with the code that produced them.
   * It is the same cascade through the back door: a client that no longer knows
   * these `t` treats signaling from an old client as an unknown type, fails the
   * entire union, discards the payload, counts it as an ignored event, and
   * consecutive ignored events declare the channel deaf and trigger a repair that
   * DELETES HISTORY. Someone in an old version trying to call another then starts
   * deleting the history of those who already updated.
   *
   * The cost of keeping them is a dozen dead lines with this comment above. The
   * cost of removing them is measured in lost conversations. It is not a hard
   * comparison.
   */
  /**
   * `sframe` rides here as well as in `voice.join`, and the redundancy is the
   * whole point.
   *
   * A join is only heard by whoever is *already* in the call. The peer who
   * joined first never hears the newcomer's announcement, and when that first
   * peer holds the lower address it offers immediately without re-announcing
   * itself. The answerer then builds its connection believing the offerer
   * cannot do SFrame, while the offerer is already encrypting every frame.
   * Both directions then arrive intact and decode to nothing — measured, not
   * guessed: the answerer produced 860 959 concealed samples out of 1 616 160,
   * and the offerer 1 706 packets and exactly zero samples. Carrying the
   * capability in the offer means whoever builds a connection always knows
   * what the other side will put on the wire, whatever the join order was.
   */
  z.object({
    t: z.literal("voice.offer"),
    /**
     * The voice room within the channel that this call belongs to.
     *
     * Absent is the channel call, what all prior signaling looks like, and
     * what lets an old version talk to a new one without both going deaf. Two
     * voice rooms in the same channel are two separate calls, and this field is
     * what separates them.
     */
    room: z.string().max(64).optional(),
    to: z.string(),
    sdp: z.string().max(64_000),
    sframe: z.boolean().optional(),
    /**
     * Whether the offerer is bringing video.
     *
     * Travels for the same reason as `sframe`: the answerer may never have heard
     * the `voice.join` of the offerer, and without this would assume THEIR OWN
     * video state to describe the other person. Today it is not seen because the
     * interface reads the track list instead of this field, which means the field
     * was simply lying without consequence, and a field that lies ends up being
     * trusted by someone.
     */
    video: z.boolean().optional(),
    /**
     * Whether the offerer is muted. See `muted` in `voice.join`.
     *
     * Travels here for the third time for the same reason as `sframe` and
     * `video`: an announcement is only heard by those ALREADY in the call, and
     * whoever arrives mid-call never heard anyone's. Without this, joining a call
     * showed everyone talking until each one touched their microphone, and
     * someone who had been there muted for ten minutes appeared to the newcomer as if
     * answering them.
     */
    muted: z.boolean().optional(),
    /**
     * Which session of the offerer this offer is from. See `joinId` in `voice.join`.
     *
     * Travels here because the announcement may never have arrived: whoever
     * re-enters with the smaller address offers immediately, without waiting for
     * anything. Without the field in the offer, whoever receives reuses the pair
     * from the previous session and plants a remote description on a connection
     * whose ICE agent on the other side no longer exists: it connects to nothing,
     * and says it is connecting until it gives up.
     */
    joinId: z.string().max(64).optional(),
    /**
     * Whether the offerer is already sharing the screen. See `screen` in `voice.join`.
     *
     * Travels here for the reason that made `sframe`, `video` and `muted` travel:
     * an announcement is only heard by those ALREADY in the call. Someone joining
     * mid-share never heard anyone's announcement, and without this would receive
     * the screen track with nothing telling it that was a screen.
     */
    screen: z.boolean().optional(),
    /** See `screenStream` in `voice.join`, including the caveat about `msid`. */
    screenStream: z.string().max(128).optional(),
  }),
  z.object({
    t: z.literal("voice.answer"),
    /**
     * The voice room within the channel that this call belongs to.
     *
     * Absent is the channel call, what all prior signaling looks like, and
     * what lets an old version talk to a new one without both going deaf. Two
     * voice rooms in the same channel are two separate calls, and this field is
     * what separates them.
     */
    room: z.string().max(64).optional(),
    to: z.string(),
    sdp: z.string().max(64_000),
    sframe: z.boolean().optional(),
    /**
     * Whether the answerer is muted. See `muted` in `voice.join`.
     *
     * The symmetric of the offer field, not a redundancy: the offerer may also
     * never have heard the announcement from the other side. This is the case of
     * someone in a call receiving someone who enters. The answer is the first
     * thing that person tells it about themselves.
     */
    muted: z.boolean().optional(),
    /**
     * Which session of the answerer this answer is from. See `joinId` in
     * `voice.join`.
     *
     * The symmetric of the offer field: the offerer may also be talking to the
     * ghost of a previous session of the answerer.
     */
    joinId: z.string().max(64).optional(),
    /**
     * Whether the answerer is already sharing the screen. See `screen` in
     * `voice.join`.
     *
     * The symmetric of the offer field, not a redundancy: the offerer may never
     * have heard the announcement from the other side. This is the case of
     * someone already in a call receiving someone entering while sharing.
     */
    screen: z.boolean().optional(),
    /** See `screenStream` in `voice.join`, including the caveat about `msid`. */
    screenStream: z.string().max(128).optional(),
  }),
  z.object({
    t: z.literal("voice.ice"),
    /**
     * The voice room within the channel that this call belongs to.
     *
     * Absent is the channel call, what all prior signaling looks like, and
     * what lets an old version talk to a new one without both going deaf. Two
     * voice rooms in the same channel are two separate calls, and this field is
     * what separates them.
     */
    room: z.string().max(64).optional(),
    to: z.string(),
    candidate: z.string().max(2000),
    sdpMid: z.string().max(64).nullable(),
    sdpMLineIndex: z.number().int().nullable(),
  }),

  /** Announces the SFrame key id this member will encrypt media under. */
  z.object({ t: z.literal("voice.key"), keyId: z.number().int().nonnegative(), rotatedAt: Timestamp }),

  /**
   * Ask someone's client to switch voice rooms.
   *
   * **Convention, not cryptography.** It has the same standing as `convidar` and
   * `renomear`, and the opposite of `expulsar`: whoever receives this is the CLIENT
   * of the person being moved, and it is that client that leaves one call and enters
   * another. An altered client ignores the request and stays where it is, and
   * nothing in this layer stops it: the only thing the cipher guarantees here
   * is that only channel members can send and read it. See `POWERS` and
   * `CRYPTOGRAPHIC_POWERS`: the interface that offers this must say what its
   * nature is.
   *
   * It is not session transfer. The call belongs to the ROOM, so moving means
   * leaving one and entering another: the WebRTC connections from the first
   * die and new ones are born, like in any entry.
   *
   * `room` empty is the default room of the channel, as in all voice signaling.
   * `subject` is who is moved, not who moves: who moves is the sender, whom MLS
   * already authenticates.
   */
  z.object({
    t: z.literal("voice.move"),
    subject: z.string(),
    room: z.string().max(64),
    at: Timestamp,
  }),

  // ---------------------------------------------------------------- social
  //
  // A person's feed is just another MLS group: they own it, their followers are
  // members. Posting is an application message; following is being added to the
  // group. No separate subsystem, no separate trust model — and no server-side
  // record of who follows whom beyond the routing metadata a channel already has.

  z.object({
    t: z.literal("post"),
    /**
     * The room, inside the channel, that this belongs to.
     *
     * Absent is the default room, and that's what all messages written before
     * rooms existed look like, on purpose, so they don't disappear.
     */
    room: z.string().max(64).optional(),
    id: MessageId,
    postedAt: Timestamp,
    /**
     * The name the publisher gave to the post, if they gave one.
     *
     * Exists because a list needs one line per post, and a line needs a name.
     * Without a title, someone reading the list sees the start of the caption:
     * that is a presentation choice, not data to carry, so there is no field here
     * with the first words cut off.
     *
     * Optional on purpose: requiring a title would turn a text box into a
     * formality, and most posts have no name.
     */
    title: z.string().max(120).optional(),
    caption: z.string().max(4200),
    /** Usually one image; carousels allowed. Encrypted like any attachment. */
    media: z.array(Attachment).max(10).default([]),
    /**
     * Link cards, composed by the *sender*.
     *
     * Every other product builds these on the reading side: your client fetches
     * the page to render a preview, which tells that site — and anyone watching
     * the connection — that you are reading a particular post at a particular
     * moment. It is a read receipt handed to a third party who was never part of
     * the conversation.
     *
     * Here the person posting supplies the preview, because they had already
     * visited the page. Readers fetch nothing, ever, and a card with no title is
     * shown as a bare domain rather than triggering a lookup.
     */
    links: z.array(LinkCard).max(4).default([]),
    /**
     * Free-text tags, kept in the payload rather than parsed from the caption.
     * They are searchable on-device and invisible to the server.
     */
    tags: z.array(z.string().max(32)).max(30).default([]),
    /**
     * Sender-declared. There is deliberately no engagement counter, no reach
     * figure and no ranking signal anywhere in this type: the feed is ordered
     * by `postedAt` and nothing else, so there is no quantity for a client to
     * optimise against and no reason to collect the behavioural data that
     * feeding a ranker would require.
     */
    altText: z.string().max(1000).optional(),
    /**
     * This post is a poll.
     *
     * The same field `message` carries, for the same reason and with the same
     * catch. The caption plays the role of the body here: it carries the question
     * and the options in full, so whoever cannot draw the card can read them all
     * the same.
     *
     * And there is one more reason for it to be INSIDE `post` and not beside it:
     * `republishPosts` re-sends the whole board to each person who enters the
     * feed, because nothing published before they had a place in the group will be
     * readable to them. A poll traveling separately would not go in that
     * reemission, and someone arriving would see the post without the poll it is.
     */
    poll: Poll.optional().catch(undefined),
  }),

  /**
   * A comment on a post, sent to the feed of whoever published it.
   *
   * Goes to the author's group because that is where the people who read the
   * post are, and the same membership that already gives access to it gives
   * access to the comment. There is no comment box on any server: whoever has no
   * place in the group does not receive the bytes, and whoever has it could
   * already read them another way.
   *
   * Whoever commented is the authenticated sender, never a field in here.
   */
  z.object({
    t: z.literal("post.comment"),
    id: MessageId,
    target: MessageId,
    postedAt: Timestamp,
    body: z.string().max(2200),
  }),

  /**
   * A like or dislike, tied to a member, never a counter.
   *
   * The difference is not a matter of tidiness. A counter is a number the group must
   * agree to increment, and agreeing without a server requires either a shared
   * clock or an arbiter; one vote per person resolves on each device from the
   * messages there, and two people with different histories reach different totals
   * without either being wrong.
   *
   * `id` so that a reaction is a distinct entry in history like any other message:
   * without it, two of our reactions in the same channel would be indistinguishable,
   * because our sends never gain `seq`.
   *
   * `at` so that each person's most recent vote wins. Without a timestamp, the order
   * would be arrival order, which shifts with the network and makes a thumbs up flip
   * on its own when recovering old history.
   */
  z.object({
    t: z.literal("post.reaction"),
    id: MessageId,
    target: MessageId,
    emoji: z.string().max(32),
    at: Timestamp,
    remove: z.boolean().default(false),
    /**
     * The vote in a poll: the INDEX of the chosen option, counted from zero.
     *
     * **Why a vote is a reaction.** A vote is exactly what this payload already
     * describes: one person's mark on a message, one per person, with a timestamp
     * for the most recent to win, and no counter at all. The alternative was a new
     * `t`, and a new `t` rejects the entire union in an old client, the payload is
     * discarded, counts as an ignored event, and consecutive ignored events declare
     * the channel deaf and trigger the repair that wipes history. This travels in a
     * `t` that every client in production already knows, and the extra field is
     * thrown away by anyone who doesn't know it.
     *
     * **`emoji` goes empty when this is filled**, and that's what makes an old
     * client ignore the vote instead of counting it as a thumbs up: its `engagementOf`
     * already discards a reaction whose emoji is not a thumbs up. The rule on read
     * must be the same both ways, and it is: a reaction with `vote` does not count
     * for thumbs, one without `vote` does not count for the poll.
     *
     * **Valid in any channel, not just a feed.** The payload name speaks of posts
     * because that's where it was born; what it describes is one person's mark on a
     * message id, and a poll in a conversation needs exactly that. Reusing it is what
     * avoids the new `t`.
     *
     * **The vote is visible, and must be.** In an MLS group everyone decrypts
     * everything the group says: whoever is in the channel sees this event, knows who
     * it came from (the sender comes authenticated by MLS and never from a field in
     * here) and knows which option they voted for. There is nothing here the
     * cipher could hide, so there is no field that pretends to.
     *
     * And there is a second reason, which is technical and points the same way:
     * **it is the identity of who votes that makes the count secure**. Votes arrive as
     * events, and the same event arrives more than once, from the vault and the
     * network, from the catch-up and the re-send. The count is a table from
     * voter to option, so the same vote stated ten times is still one vote. An
     * anonymous vote would have no way to be deduplicated, and the real choice would
     * not be between secrecy and transparency: it would be between transparency and
     * counting wrong.
     *
     * `remove` takes away the vote, as it takes away a thumbs up.
     *
     * `.catch(undefined)` for the reason of `Poll`: an absurd index means no vote,
     * never loss of the payload. An index that does not fit the poll's options is
     * discarded by the reader, which has the options in front of it.
     */
    vote: z.number().int().nonnegative().optional().catch(undefined),
  }),

  // ------------------------------------------------------------------ rooms

  /**
   * Who founded a room, and may therefore close it.
   *
   * Sent once, by the founder, as the room's first message. Every client
   * records the author from the authenticated sender — never from a field
   * inside the payload — so a later member cannot claim the role by asserting
   * it. There is no server-side ownership record because there is no server
   * that could enforce one.
   */
  z.object({ t: z.literal("room.created"), name: z.string().max(100), createdAt: Timestamp }),

  /**
   * The founder is closing the room.
   *
   * A request, honoured by clients, not an erasure. Members who already hold
   * the history keep it — the protocol cannot reach into someone else's disk,
   * and a "delete for everyone" that quietly fails would be worse than one that
   * says what it does. What it does guarantee is that the room disappears from
   * every honest client and no further messages are accepted into it.
   */
  z.object({ t: z.literal("room.closed"), closedAt: Timestamp, reason: z.string().max(280).optional() }),

  // ---------------------------------------------------------------- friends

  /**
   * A friend request, and its answer.
   *
   * Friendship here is symmetric membership of each other's feeds: accepting
   * means adding them to yours, which is an MLS commit. The payloads below are
   * the conversation around that, sent into whatever channel the two already
   * share.
   */
  z.object({ t: z.literal("friend.request"), sentAt: Timestamp, note: z.string().max(280).optional() }),
  z.object({ t: z.literal("friend.accept"), acceptedAt: Timestamp }),
  z.object({
    t: z.literal("friend.decline"),
    declinedAt: Timestamp,
    /**
     * "I'm withdrawing my request", not "I refuse yours".
     *
     * The same message works for both gestures because both close a request and
     * neither grants access to anything; what changes is WHICH request closes. Without
     * the field, whoever sends closes the other's request (refusal). With it, they
     * close their own (cancellation). See `foldFriendTies`.
     *
     * New field and not new `t`, by house rule: an unknown `t` in an old client is
     * a rejected payload, and consecutive rejects declare the channel deaf. Client
     * 0.5.x does not know the field, throws it away (schemas are not `strict()`) and
     * reads a refusal of a request it never made: a no-op. The cost of that is in
     * `docs/PENDENTES.md`.
     */
    withdrawn: z.boolean().optional(),
  }),

  /**
   * End a friendship.
   *
   * A friendship is two slots, one in each feed, and only the owner of a feed can
   * remove someone from theirs. Whoever ends it removes the other's slot from their
   * own feed (that is a commit, and a fact) and sends this so the client on the
   * other side removes ours. A friendship ended halfway is worse than none: the
   * interface says it ended and access continues.
   *
   * Stated so we don't promise too much: whoever already got posts keeps them.
   * Leaving an MLS group applies to the future, and calling it something else would
   * be lying.
   */
  z.object({ t: z.literal("friend.remove"), removedAt: Timestamp }),

  /**
   * The list of friends the person CHOSE to show in their profile, to friends.
   *
   * **The only new `t` for friendships, and with reason.** The house rule is new
   * field and not new `t`, and there is almost always a payload that already carries
   * the field. Not here. The `profile` goes to every room the person belongs to, and
   * a friends list cannot go to a room of thirty strangers: it must travel only in
   * the feed of whoever shows it, where the friends are and no one else. A `post` is
   * something else (it enters the board, has comments, reactions and a tombstone), and a
   * list disguised as a post would appear as a post in all old clients.
   *
   * **The cost in an old client is small, and measured.** It rejects this payload
   * and counts it as ignored; five ignored in a row, with thirty seconds between
   * first and last, declare the channel deaf (`DEAF_FAILURES`). The window limits
   * duration, not rate: five changes spread across a quiet feed would be enough. So the
   * core batches the changes (only the last goes out) and stops at three in a row
   * until another event appears in the feed, which resets the old client's count.
   * `scripts/e2e-cliente-antigo.mjs` measures both sides: without the fix the old
   * client asks for a new place, with it it does not.
   *
   * **Opt-in.** Nobody publishes this without choosing it, and an empty list is how
   * you stop showing it.
   *
   * **A feed is for friends.** Whoever sits there without being a friend (an old
   * follower, an ex-friend whose removal failed) would read the list; the client
   * removes them from the feed before sending it, and if it cannot, it does not send
   * it. And it does not go out at each change: only the last one, with a delay, and
   * never more than three in a row without another event in the feed (see
   * `setShownFriends` in the core). There is no comparison to the list of who reads
   * it ("mutual friends"): the owner's decision, and the core does not offer it.
   *
   * Five hundred is the read limit, ample: a larger list is not a friends list
   * anyone will read, and each address weighs on the same byte limit.
   */
  z.object({
    t: z.literal("friends.shown"),
    shown: z.array(UserAddressText).max(500),
    updatedAt: Timestamp,
  }),

  /**
   * Ask to follow someone.
   *
   * Sent into *their* feed group is impossible — we are not a member yet — so
   * this travels as a direct message to their inbox channel. Acceptance is the
   * author adding us to the feed group, which is an MLS commit and therefore
   * something no server can forge.
   */
  z.object({ t: z.literal("follow.request"), requestedAt: Timestamp, note: z.string().max(280).optional() }),

  // --------------------------------------------------------------- aparelhos

  /**
   * An account saying that one of its devices is no longer its device.
   *
   * **No one issues this yet.** It is born now, not when there is someone to
   * issue it, for a calendar reason: a `t` the receiver does not know is an
   * entire rejected payload, and consecutive rejected payloads declare the
   * channel deaf (see `DEAF_FAILURES` in the core), which asks for a new seat
   * and takes the history with it. Declared inside the full-reset window, there
   * is no client out there it could deafen; declared later, it would cost
   * exactly that.
   *
   * **Why it carries a signature, if MLS already authenticates the sender.** MLS
   * authenticates the LEAF, and a leaf is a device. Without an account signature,
   * a stolen device could revoke its siblings and stay alone speaking for the
   * person: revocation would become a weapon for the very party it exists to
   * disarm. The receiver verifies `sig` against the ACCOUNT key in the credential
   * of whoever sent it, the same chain already validated to admit the leaf.
   *
   * Honesty the interface must repeat when this gets used: revocation cuts reading
   * from the next epoch on. What the device already had, it keeps.
   */
  z.object({
    t: z.literal("device.revoke"),
    /** Ed25519 public key of the revoked device, base64url, 43 characters. */
    device: Base64Url.max(64),
    revokedAt: Timestamp,
    /** From the account key, over `deviceRevocationMessage`. 86 characters. */
    sig: Base64Url.max(128),
  }),
])
export type Payload = z.infer<typeof Payload>

/**
 * Encode a payload for the wire.
 *
 * The parse is not paranoia about our own types: `decodePayload` validates on the
 * far side and a rejected payload is silently dropped there, counted as an ignored
 * event, and several in a row declare a channel deaf. A sender that writes a field
 * the receiver will refuse must fail HERE, where someone can act on it, rather
 * than degrade a stranger's channel. This is exactly how a 2 KB cap on an avatar
 * field went unnoticed while it broke every profile on the server.
 */
export function encodePayload(payload: Payload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(Payload.parse(payload)))
}

export function decodePayload(bytes: Uint8Array): Payload {
  return Payload.parse(JSON.parse(new TextDecoder().decode(bytes)))
}

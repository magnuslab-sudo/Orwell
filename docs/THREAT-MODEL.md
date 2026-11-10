# Threat model

This document says what Orwell protects and what it does not. A privacy
product that only lists its strengths is marketing. If the code breaks a claim
made here, that is a bug: SECURITY.md says how to tell me.

Paths are relative to the repository root. Identifiers are cited as they are in
the code, mostly in Portuguese.

## Who we defend against

- **The homeserver operator.** Curious at best, hostile at worst: breached,
  compelled by a court, or nosy. The main adversary, because it is the one every
  centralised chat asks you to trust.
- **A peer homeserver.** It carries federated traffic and should learn less than
  your own server.
- **A network observer.** An ISP, a hostile Wi-Fi, a national gateway.
- **A removed member.** Someone who was in a channel and no longer is.
- **Opportunistic malware** that copies profile folders. The desktop app resists
  it even with the session remembered: the key is wrapped by `safeStorage`
  (Keychain, DPAPI), so a copied folder does not open. The browser does not.

## Who we do not defend against

- **Code running as you while your vault is open.** Your device must read your
  messages, so anything running as you can too.
- **A member you let in.** They can screenshot and republish what they see.
- **A compromised client build.** Installers are unsigned and builds are not
  reproducible yet. The web build is as trustworthy as the server that serves
  it, on every load.
- **A global passive adversary.** We pad and round timestamps but send no cover
  traffic, so timing correlation can still show that two people talk.

## What is protected

1. **Content.** Messages, posts, reactions, replies, profiles, room names,
   attachments and call media are end-to-end encrypted. The server forwards
   ciphertext it cannot open.
2. **One MLS group per channel** (`ts-mls`). A seat in one channel is no key to
   another.
3. **Forward secrecy and post-compromise security** for keys in transit. A
   removed member reads nothing from the next epoch on.
4. **Post-quantum key exchange** for new sessions: the default suite is
   `MLS_256_XWING_CHACHA20POLY1305_SHA512_Ed25519` (`packages/crypto/src/suite.ts`).
5. **Opaque channel addresses.** The database does not name who talks to whom or
   what a room is called.
6. **No identity data.** An account is a hash of a key. No name, email, phone or
   password hash on the server.
7. **The server cannot invent a device or a member.** Every client checks the
   chain from account key to device key itself.
8. **Signed authorship.** Content one member repeats for another cannot be
   altered, moved to another channel, or used to leak history from before a
   seat.
9. **Call media stays encrypted through the SFU** (SFrame).
10. **The local vault** is sealed by a passphrase through Argon2id. There is no
    recovery, so nothing on the server can unlock it.
11. **Retention is the operator's dial:** 30 days by default, 0 supported.

## What the server sees

Meant to be exhaustive against `apps/server/src/db.ts`. A change that adds to it
adds a line here.

| The server learns | Why | Mitigation |
|---|---|---|
| An opaque account id and its Ed25519 public key | Logins must be verified | A hash of a key, linked to no person and to nothing on other servers |
| A key per device, its first-login minute, and so the device count (max four, `APARELHOS_POR_CONTA`) | Key packages belong to devices | No last-seen column. Which device is online when is visible live |
| Each account's signed device manifest | Inviters must know which devices to admit | The server cannot forge it, but can serve an old one. See "Accounts and devices" |
| Which device each waiting key package belongs to | Inviters ask for one per device | Inviters check bundles against the signed manifest. Leaving a device out is delay, not exclusion |
| Which opaque addresses each account subscribes to, and who first claimed each (`channel_claims`) | Offline delivery needs a queue | Addresses cannot be inverted. Co-membership stays visible, and a two-subscriber channel is very likely a direct conversation |
| Ciphertext and its size | It stores and forwards it | Every message is padded to at least 512 bytes. Short messages look alike; longer ones show their size |
| That an account sent to a channel, to the minute | It assigns sequence numbers | Kept as long as events. Live, the gateway sees who sends where |
| Commits per channel (`channel_epochs`) | One commit per epoch | A count from the clear MLS header. Retention keeps it on purpose; `scripts/limpar-servidor.mjs` wipes it |
| Which peer servers a channel reaches | Federation must route | Never the membership list |
| Pairing boxes, ephemeral signals, vault entries | See their sections | Memory only, or no author on disk |
| Invite records, including short codes in the clear | It manages invites | See "Invites" |
| The app version (`hello.versao`) | Minimum version check | Never written down |
| IP addresses and connection times; in calls, who is with whom and who speaks | It is a server; the SFU forwards packets | Not logged by default. See "Calls" |

**It never has:** message text, the author of a stored message, display names,
avatars, topics, reactions, mentions, read receipts, typing, attachment names or
bytes, voice or video, or a password hash.

**One exception, handed over, not taken: abuse reports.** A reporter's device
decrypts the reported messages and sends them in the clear to
`<data>/denuncias/`, outside the database. See "Abuse reports".

## Channel addresses

From 1.0 every channel id is `!<40 base32 characters>:<server>` (200 bits), and
the shape says nothing about the channel (`packages/protocol/src/ids.ts`). A
direct conversation is a hash of `X25519(A, B)`, which both sides compute and
the server, holding only public keys, cannot. A feed is a hash of a secret the
owner shares inside the encrypted profile, so only friends and co-members can
find it; there is no public feed. A room is 25 random bytes, its name inside the
encrypted state. The account channel is a hash of the account private key. The
common room keeps the address the server announces.

**Opaque addresses protect against the disk, not a live operator.** A stolen
backup or a court order on the database no longer yields a social graph. An
operator watching the running gateway still sees which account writes in which
channel, and when. Closing that needs sealed sender or private information
retrieval; neither is built. Sender anonymity therefore holds against everyone
except the sender's own homeserver.

**History: the channel id was not opaque up to 0.9.x.** Ids were `!dm-<a>.<b>`,
`!feed-<owner>` and `!<room name>`, so any database or backup from that era
names who talked to and followed whom, and retention 0 did not help, because the
pairs live in `subscriptions`. Keep such copies as sensitive or destroy them.
The 1.0 server refuses the old shapes.

**A leaked address is a ticket to metadata.** Addresses cannot be guessed but
can leak (a seized device, a log, a screenshot). Whoever holds one can found
that channel first if it does not exist yet. For an existing channel the address
alone gets nobody in, but a dishonest server can serve its traffic to anyone:
timing and volume, never content. A leaked feed address shows the owner's
posting rhythm for the life of the account. Keeping addresses out of logs is the
clients' job.

## Accounts and devices

**An account id is 80 bits of hash, and that is a security parameter.** The
first 80 bits of SHA-256 over the account key, written as four words
(`ACCOUNT_ID_WORDS`; `names.ts` is a bijection, so the words are those bits).
There is no PKI: a credential is accepted when its address is the hash of its
key, so a second preimage could speak as another member and inherit roles stored
by address. At 10^8 keys per second per GPU, 80 bits costs about 3.8x10^8
GPU-years (60 bits would be about 365). The server binds address to key at first
login, and safety numbers compare whole keys, so what remains is credentials
presented directly: the common room, invite joins and federation. There is no
shorter nickname layer on purpose: a short name is cheap to grind.

**The device manifest can be rolled back.** Each account signs a list of its
device keys with an increasing version (`packages/protocol/src/manifest.ts`).
The server cannot alter it but can keep serving an old one, for example from
before a revocation. Clients remember the highest version seen per address (up
to 512 addresses, in the vault) and refuse lower ones. A client that never met
the account, or whose memory an older build dropped, could accept a revoked
device. Inviters admit only devices in the manifest they verified, and the
in-group `device.revoke` message is the other half of the defence.

**Revocation cuts reading from the next epoch.** Only a device with the account
key can revoke (`packages/client-core/src/revogacao.ts`). The server then refuses
that device's login and key packages and never lets a manifest add it back, and
its leaf is removed from every channel. What it already had, it keeps. Online,
it is told `device-revoked` and erases its remembered session.

**Pairing.** The device with the account key shows a 32-byte secret as a QR code
and as a link fragment. Both devices meet in a server box named by a hash of the
secret and exchange keys encrypted under a key derived from it.

- **The QR authenticates nothing.** Whoever photographs it can take the phone's
  place. The defence is six words over the box id and both device keys
  (`palavrasDoSas`); a third connection burns the box. **Nothing is signed or
  published until a person confirms the words match on both screens.** A server
  in the middle never has the secret.
- **A paired device never holds the account key.** It cannot certify devices,
  sign a manifest or revoke, which is what makes revoking a stolen phone stick.
  The cost: losing the device with the account key loses the account's
  authority.
- **A paired device cannot start a conversation with someone new** (Error 609),
  because a direct address needs the account private key.
- **A new device reads from the commit that seated it.** Importing a vault file
  into a second device instead of pairing breaks channels for good.

**The session can be remembered.** The person can keep the vault key (the
Argon2id output, never the passphrase) on the device. The box is on by default.
Desktop: `sessao.enc` wrapped by `safeStorage`. Web: wrapped by a
non-extractable `CryptoKey` in IndexedDB, which page scripts can use but not
read, and a copied browser profile opens the account (the protection class of a
web chat token). Anyone using the device unlocked gets in, and the session does
not expire on idle. The passphrase is never stored, the vault stays sealed by
it, exports never carry the key, and import, pairing, deletion and "Sign out"
erase the record. Safari on iPhone may wipe storage after seven days unused, so
the app asks for persistent storage. Without remembering, the web build keeps
the key per tab in `sessionStorage` (`apps/web/src/bridge.ts`).

**Where the passphrase can rest.** The unlock screen is a real password form, so
the OS password manager may save it, behind the device unlock. The app asks; it
does not decide. The web build also passes it to a key-derivation Worker that is
terminated after each call (`apps/web/src/kdf.ts`).

**Several accounts on one device keep their names in clear:** a small list with
an opaque id and display name each (`contas.json`, or `orwell.contas` in
`localStorage`). The vaults stay sealed. One account, no list.

## Ephemeral channel signals

`channel.sinal` carries a sync summary or a request for missing items. The
server sees the channel, the sending account, the time, the size (padded by the
client) and how many connections received it. The content is encrypted with a
key exported from the MLS epoch, and the sending device is inside it. Signals
are never written, queued, backfilled or federated. The server counts only
per-minute totals for the whole process, in memory (`Gateway.metricasDoSinal`).
What they add is sync rhythm, which follows connects and joins the server
already sees; one elected member sends the periodic summary. Ceilings are in
`TECTOS_DO_SINAL` (`apps/server/src/config.ts`). A removed member can still send
signals, but receivers drop them: it has no key for the current epoch.

## Encrypted vault on the server

The server side of an encrypted state store (`cofre.*`) exists: channel state
(rooms, roles, profiles) and account state, so a newcomer can read it with
nobody online. Never conversation. **No client uses it yet**; this is what the
server will learn when one does.

- **Stored:** scope (`canal:` or `conta:` plus address), an opaque HMAC key,
  version, ciphertext, tombstone flag, minute of write. **No author column**;
  the writer is seen live for rate limiting only, so a live observer learns who
  writes.
- **Leaks to whoever holds the disk:** entry counts per channel (roughly rooms,
  roles and members, so small and large communities differ), sizes in 1 KiB
  buckets, and when and how often each entry changed.
- **Weakness:** a removed member keeps its subscription and can fill the scope
  with junk up to the ceiling, blocking honest writes. Tying writes to the
  current epoch is planned, not built.
- **A malicious server** can withhold, roll back, delete or reorder: versions
  are not signed. Clients verify authorship inside entries, resolve conflicts by
  the inner timestamp, and remember the highest version seen. Worst case: delay
  or incomplete state.
- **Ceilings** (`TECTOS_DO_COFRE`): 64 KiB per entry, 4096 entries, 16 MiB per
  channel, 2 MiB per account, 120 writes and 60 reads per minute. Not federated.
  Entries live until rewritten or swept (`ENCLAVE_COFRE_GC_DIAS`, off by
  default).

## Content sync between accounts

Members converge by repeating to each other what they hold.

**Signed authorship.** Reportable events carry `autoria`, a device-key Ed25519
signature over a domain label, the channel, the author's address and the
canonical payload (`packages/protocol/src/autoria.ts`), checked against the
author's leaf or chain and manifest. It proves that this device wrote exactly
this for exactly this channel. It does not prove when, the order (`seq` is the
relayer's word and only ever used to refuse), that the author still agrees, or
who was first. **The price: content copied out of a group proves on its own who
wrote it.** Orwell was never deniable, since MLS signs every message, but that
proof needed the group context; `autoria` is portable. It covers messages too.

**What the server sees.** Repeated items travel as ordinary MLS messages,
indistinguishable from a typing signal, but larger, and shortly after a join or
reconnect (a full snapshot of a mid-sized channel is about 0.6 MB). Disk use per
channel is counted in memory without ids. Sends above 600 per account per minute
are refused with `rate-limited`.

**A dishonest relayer can** withhold (others are asked after 15 seconds, so this
is delay while one honest holder is online), misplace an item through `seq`
(no access gained), or replay a signal within an epoch (extra work within
ceilings). **It cannot** alter an item, give history from before the receiver's
seat, revive a deleted item, replace what the receiver holds, or bypass a block.

**Revoked devices.** Items signed by a revoked device are refused whatever date
they claim. **Open edge:** if the author's account was deleted and its manifest
no longer exists, a device revoked without the manifest saying so passes.

**Accepted risk: wall tombstones.** A dishonest member we elected can mark a real
message tombstone as "of the wall". The receiver keeps a divergence that never
closes and learns that tombstone's metadata (id, author, date, never content)
from before its seat.

**The founding has no arbiter.** If two members signed a `room.created` for one
channel, devices can disagree on who the founder is, and so on who holds founder
powers. The server knows who claimed the channel and does not decide.

**Attachments on request.** Late joiners get metadata and the signed hash `m`.
Bytes come when opened, from one elected member, within 4 MiB per minute and
16 MiB per channel per day, checked against `m` so they cannot be swapped. A
relayer can claim to have them and send nothing; the requester tries three
members. The server sees a larger event, not which file.

## Abuse reports

Code: `apps/server/src/denuncia.ts`, `denuncia-prova.ts`, `pedido-assinado.ts`,
`packages/client-core/src/denuncia-construir.ts`. A report goes to the server in
the clear for a person to read, and optionally as a sealed copy to the channel's
founder, through the server, which cannot open it.

- **The server learns** the reporter's address (from the signed request, so the
  decision can reach them), time, reason, note, reported person, channel and
  room, up to 16 items with authors, text and `autoria`, an optional contact, and
  the app version. Files live in `<data>/denuncias/` (mode `0700`) until 90 days
  after closing (`ENCLAVE_DENUNCIAS_DIAS`), longer during a suspension or review.
- **The founder learns** the same content with only the UTC day, without the
  reporter's address, device, version or contact, and without the reporter's
  own messages or sequence gaps. They still learn that someone reported, which in
  a small channel may reveal who. The sheet says so before sending.
- **No founder copy** for direct conversations, the common room, a founder who
  is the reported person or has left, or a reporter not subscribed. The response
  looks the same. The reporter's client checks the founder key the server gives
  against the founder's address and leaf, so the server cannot swap it.
- **The seal** (`packages/crypto/src/selo.ts`): ephemeral X25519, HKDF-SHA256,
  XChaCha20-Poly1305, no sender. Only a device with the account key opens it,
  then shares it with its sibling devices over the account channel. Delivery is
  delayed by a random 1 to 6 hours (`ENCLAVE_DENUNCIA_ATRASO_HORAS`) so it
  cannot be matched to who was online.
- **Proof.** The server checks each item's signature and chain with no group
  key. "Verified" means the item verifies, its author is the reported person and
  it matches the target. Anything else is marked `nao-verificada`, never refused.
- **The server strips attachments itself**, keeping only name, type and size, so
  reported abuse material never lands on its disk.
- **Suspension** is only ever done by a person (`scripts/denuncias.mjs`), never by
  a count. It blocks every frame but `ping`, new logins and key packages, is
  reversible, and shows the person the reason and how to ask for review.
- **Signed HTTP requests** (so a suspended account can still read its notice):
  address, device key, time, nonce, route and body, 15-minute window, per-hour
  caps (5 reports per address, 20 per IP). Replies are uniform: `200 {}` after a
  random delay whether or not the person exists or a copy was made.
- **Alerts.** The server sends none. It writes `denuncias/fila.json` with counts,
  reasons and dates, never content, for the operator's tooling.

**Known limits:** a captured request can be replayed once within 15 minutes of a
restart (nonces are in memory); the 200,000-entry nonce map can be filled by
many accounts, locking report routes for up to 30 minutes; a malicious reporter
controls the text and attachment names in the sealed copy (unverified items say
so); only the first device of the reporter's account to read the inbox stores
the decision; attachment `byteLength` is unsigned; an edited message is reported
as its signed original; two operators using the script at once can overwrite
each other; and a suspension stops an account, not a person.

## Invites

A link is `https://<homeserver>/app/convite#<channel>/<code>`, with a 24-byte
bearer code. A member's device admits, not the server.

- **The secret is in the fragment**, which browsers never send: the server and
  its logs see `GET /app/convite` only. Links with a path or query are refused
  (`parseInviteLink`). Previewers spend nothing.
- **A database copy cannot redeem.** The server keeps `sha256(code)` and
  `code_key`, a public key derived from the code; redeeming must be signed with
  the private half (`apps/server/src/resgate-por-prova.test.ts`).
- **Short links are the weak spot.** `invites.short_code` is stored in the clear,
  so whoever reads the table can resolve every short code to its channel. A slow
  hash is planned. The invite seal (names, fixed 552 bytes) is encrypted under a
  key from the code.
- **Redeeming is a request, not a seat.** The request goes to connected members
  and nothing about the redeemer is stored. A seat comes only from a Welcome sent
  by a seated member. The server cannot check that Welcome is real MLS, but such
  a member could leak the ciphertext anyway.
- **Ceilings** per minute: 12 per account, 30 per invite, 60 per channel, 600 per
  server; key packages capped at 8 KiB. `invite.list` and `invite.revoke` have
  none, but need a seat.
- **History.** The web build replaces the URL before anything else runs
  (`apps/web/src/convite-arranque.ts`). In practice history ends up clean, but no
  specification promises it. Not covered: the chat where the link was sent, and
  browser extensions.
- **In-app browsers** (Instagram, Facebook, TikTok) inject scripts that can read
  the fragment. Nothing in the app prevents that.
- **The pending invite sits in `sessionStorage`**, the same exposure as the
  session key, until accepted, declined or invalid.
- **A click never joins.** Joining reveals your address, so the app asks first.
- **The channel name in that dialog is unverified sender text.** A real invite
  to one channel can be labelled as another. Names are cleaned and capped, the
  dialog says who wrote them, and the app warns once if a different channel
  appears.
- **Only your own homeserver's links are redeemed**, so invites do not work
  across servers. The desktop app does not open https links; paste them.

The real bound is short expiry and a use limit (default: one day, one person). A
code admits to one channel and is not an account credential.

## Calls

Media is encrypted with SFrame (`packages/crypto/src/sframe.ts`) under keys from
the MLS exporter, on every engine. A client that cannot encrypt does not join
through the SFU.

- **The SFU terminates DTLS-SRTP, not the content** (`apps/server/src/media.ts`).
  It exists so joining a call does not show your IP to every participant, as a
  mesh does.
- **It sees** RTP headers, packet sizes and timing, the SFrame header (epoch,
  leaf index, counter), the VP8 payload descriptor (keyframe flag, picture ids),
  and whether a stream is microphone, camera or screen. **It never sees** codec
  bytes: the whole frame is encrypted.
- **Who speaks is visible.** Silence sends about 2.5 packets per second instead
  of 50, so packet rate shows who talks and for how long. Voice, screen audio
  and music use constant bitrate (`cbr=1`), so packet sizes do not leak speech.
  **Limit:** in a mesh call with a 1.0.8 or older client, that client receives
  variable bitrate. Through the SFU this does not happen.
- **Call setup** is a recognisable burst of same-sized encrypted events.

## Links and YouTube

A YouTube link draws a card that is a plain link: a click opens a new tab (or
the system browser on desktop) with no referrer and no opener. Nothing is
embedded (`frame-src 'none'`). Reading a conversation makes zero requests to
Google, because the thumbnail travels inside the encrypted message
(`scripts/e2e-volume-youtube.mjs`).

Writing a link fetches its title and thumbnail automatically. On desktop the app
fetches it and the homeserver learns nothing. **On the web the homeserver
fetches it** (`apps/server/src/link-preview.ts`), **so it learns which videos an
account writes, and when, including ones never sent.** The code keeps no log,
but that is a property of the code, not a guarantee against an operator.

## The web build

**The Service Worker has no cache.** `apps/web/public/sw.js` exists only for
Android notifications: no `fetch` or `push` handler, no Cache API, no imports, no
URLs, so it cannot pin old code (`apps/web/src/pwa.test.ts`,
`scripts/verificar-pwa.mjs`). Its CSP blocks the network but not the Cache API;
the test does that. Deleting the file does not uninstall it: publish a worker
that unregisters itself instead.

**Notifications through it persist outside the vault** until dismissed. It is
used only where a normal notification fails (Chrome on Android). `tag` and
`data` carry only a random token. With "show content" on, the body names who
wrote and where. There is no Web Push, so Apple and Google see no wake-ups.

**iOS Lockdown Mode** disables Service Workers and IndexedDB (from WebKit source,
not yet seen on a device). If so, the web app does not work in that mode.

## Server integrity limits

**One commit per epoch trusts a header the server cannot verify.** To stop
groups splitting, the server accepts one commit per epoch, read from the clear
MLS header. A seated member can forge one with the exact epoch, after which
every real commit is refused: nobody can be added, removed or re-keyed, though
messages flow. The way out is the operator's:
`ORWELL_EPOCH=<n> scripts/destrancar-canal.mjs '<channel>'`, with the epoch from
a real member. It records nothing about who ran it. A real fix needs a protocol
change.

**Federation does not extend that rule:** two servers can each accept a
different commit and split the group. Federation has never run between two
servers in production.

**Federation replay protection** spends a nonce only after the signature checks,
atomically. Per-minute ceilings per origin and in total. Not covered: the CPU
cost of bad signatures, and a valid envelope replayed within two minutes, which
is refused but counts against its origin.

**One account per socket.** A second login on a signed-in socket closes it
(`already-authenticated`), so one account cannot inherit another's seats.

**Slow readers are cut** above 64 MiB queued (`Gateway.FILA_MAXIMA_BYTES`) and
catch up by backfill.

**A removed member keeps its subscription.** The server does not learn of
expulsions, by design. The removed member still receives ciphertext and can
send, but has no key for the new epoch.

## Common room

`ENCLAVE_COMMON_ROOM` names a room the server announces. Any account may ask to
join, a member's client answers automatically with no human asked, and
registration is open and free. **Anyone at all can be reading the common room
within seconds of deciding to.**

- Treat everything said there as public. Encryption protects it from the
  operator and the network, not from a stranger who asked in.
- Everyone is in it, so presence tells every member when every account connects.
  That is the account list `directory.list` refuses to give, by another door.
- Junk seats accumulate; nothing removes them.
- A member can make it unreadable: undecryptable frames trigger re-seating,
  which rekeys the group.

The gateway enforces the gap between asking and everything else (`#mayAsk`
against `#mayReach`, `apps/server/src/gateway.ts`): a non-admitted account cannot
read stored ciphertext, list invites, write, or see presence. Taking the room's
group info gives a two-minute seat that accepts only an external commit and
receives nothing. A garbage frame with a valid external-commit header can still
take the epoch, as above.

The client accepts a common room only on its own homeserver and only if it is a
room, not a direct conversation, feed or account channel. A server naming some
other private room it routes cannot be caught by the client alone.

## Other known limits

- **Removal is forward-only.** A removed member keeps what it already received.
- **Redaction is a request.** Nothing erases bytes from someone else's disk.
- **Local history is protected only by the vault**, as strong as the passphrase
  or OS store behind it.
- **Post-quantum protection covers new sessions only**, not anything exchanged
  under the classical fallback suite.
- **Live presence is relayed to channel-mates.** Memory only, no history, not
  federated.
- **Subscriptions are social-graph data.** Fixing that needs private information
  retrieval or blinded tokens.
- **The browser keeps the identity key in the page.** The desktop app keeps it
  out of the renderer.

## Design decisions that follow

- **No account recovery:** it would mean holding what restores access.
- **Per-channel groups:** key possession, not a server, enforces who reads what.
- **Roles are client-enforced:** a hostile server can drop messages, not promote
  itself.
- **No request logging by default:** an access log is an activity record.
- **Chronological feed:** no ranker, no reason to collect behaviour.
- **Remembering the session is a box, not a mode:** the passphrase always opens
  the vault.

## Operator responsibilities

If you run your own server (`infra/.env.example`, `infra/docker-compose.yml`,
`infra/Caddyfile`):

- **Retention.** `ENCLAVE_RETENTION_DAYS` (default 30, 0 keeps nothing beyond
  live delivery) is your main dial. It deletes events and their timing, not
  subscriptions or `channel_epochs`.
- **Federation is off by default.** An empty `ENCLAVE_FEDERATION_ALLOWLIST` means
  off, not open. Name only peers you trust: a peer's signature proves nothing,
  because its key comes from the peer.
- **Common room is off by default.** Read "Common room" before setting it.
- **Community mode is off by default.** `ENCLAVE_COMMUNITY_MODE=true` lets every
  account see which accounts exist. Only where everyone already knows each other.
- **Logging.** `ENCLAVE_LOG=debug` logs requests; do not leave it on. Your proxy
  and host keep their own logs with IPs and times.
- **Calls.** Without an SFU port, calls use a mesh, which shows participants'
  IPs to each other. Without your own TURN (`ENCLAVE_TURN_URLS`), clients use a
  public STUN server, which sees the time and IP of every call.
- **Abuse reports** are plaintext files in `<data>/denuncias/`. Decide on purpose
  whether backups include them and who can read them.
- **Pre-1.0 databases** hold a readable social graph. Protect or destroy them.
- **Locked channels** (a forged commit) can only be unlocked by you.
- **Your web users run whatever your server sends them.**

## Reporting a vulnerability

Read SECURITY.md. In short: write to orwell.eu@proton.me before telling anyone
else, and do not open a public issue for anything that exposes messages,
accounts or a server. Things admitted here are not findings, but an argument
that the reasoning is wrong is welcome.

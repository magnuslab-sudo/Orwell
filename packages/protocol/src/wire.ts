import { sha256 } from "@noble/hashes/sha2.js"
import { z } from "zod"
import { toBase64 } from "./canonical.js"
import { APARELHOS_POR_CONTA } from "./identity.js"
import { CodigoCurto } from "./ligacao-curta.js"
import { DeviceManifestWire, RevogadosNoManifesto } from "./manifest.js"
import { PAIR_ID_PATTERN, PAIR_PAYLOAD_MAX_CHARS } from "./pair.js"
import { SELO_DO_CONVITE_MAX_CARACTERES } from "./selo-do-convite.js"

/**
 * The client <-> homeserver gateway.
 *
 * The governing rule for this file: if a field is not required to *route* a
 * message, it does not belong on the wire in plaintext. Everything a Discord
 * payload carries in the clear — author, display name, reply target, mention
 * list, reactions, attachment names, message body — is inside `ciphertext`
 * here, and the server has no key for it.
 *
 * What the server unavoidably learns is enumerated in docs/THREAT-MODEL.md.
 * Do not add a field here without adding it there too.
 */

export const PROTOCOL_VERSION = 1

/**
 * The capability that says "this server routes media through an SFU".
 *
 * A constant, not the string `"sfu"` written on both sides, because this is a
 * contract between different processes: the server announces it in `hello.ok`
 * and the client decides from it which call engine to build. One typo on one
 * side gives no compile error, only a client stuck in mesh against an
 * SFU-ready server, or worse, the reverse.
 *
 * **Server first, client second, never reversed.** A new client against an old
 * server does not see the capability and behaves exactly as today: mesh,
 * end-to-end, not one line different. It is the same rule as device chain
 * restart, and it is what lets Phase 1 deploy without any client out there
 * noticing.
 *
 * And **announce what exists, never what is planned**: a server declaring this
 * without a media worker running sends everyone to negotiate with a closed gate.
 * See `declararSfu` in the gateway: the capability comes from real engine
 * state, not a constant or environment variable.
 */
export const CAPACIDADE_SFU = "sfu"

/**
 * The capability that says "this server stores device manifests and accepts
 * more than one device per account".
 *
 * A constant for the same reason as `CAPACIDADE_SFU`: it is a contract between
 * the server, announcing it in `hello.ok`, and the client, who sends
 * `manifest.publish` and `manifest.get` only to servers that announce it.
 * Against a server that does not announce it, the client sends neither and
 * behaves as before this existed: an unknown `t` is a rejected frame, not worth
 * learning at the cost of one.
 *
 * **Server first, client second, always.** The reverse, an old client against
 * this server, does not see the capability, does not understand it, and nothing
 * changes: no server path reads the device table or manifest to decide anything.
 * This is what makes this slice deployable without breaking 0.2.2 clients.
 */
export const CAPACIDADE_APARELHOS = "devices"

/**
 * The capability that says "this server serves key packages bundled, one per
 * device from the manifest, when the client asks".
 *
 * A constant separate from `CAPACIDADE_APARELHOS`, and the reason is production:
 * `devices` is announced unconditionally by the 0.2.3 server, which stores
 * manifests but does not bundle. A client asking `bundle: true` to that server
 * got one packet with no `keyPackages`, and the difference between "does not
 * know" and "no more devices" was lost. With its own capability the client
 * knows when the bundled reply is the complete reply.
 *
 * **The client REQUESTS the bundle, never offered.** A `keypackage.claim`
 * without `bundle: true` uses exactly one packet, against this server and any
 * other. If the server offered bundle to whoever did not ask, each invite made
 * by a 0.2.3 client would burn one packet per device of the invitee, and the
 * pool of twenty would drain four times faster, in silence, because that client
 * only knows how to read the single.
 */
export const CAPACIDADE_BUNDLE = "keypackage-bundle"

/**
 * The capability that says "this server has pairing boxes": accepts `pair.open`
 * from an authenticated account, `pair.join` from a connection WITHOUT an
 * account, and relays `pair.send` between them without reading.
 *
 * A constant for the usual reason. And the usual rule: **server first, client
 * second.** A client that does not hear this does not show the add device
 * button or send a `pair.*` frame, because against a 0.2.4 server each one is
 * a `bad-frame`. The reverse, a 0.2.4 client against this server, does not see
 * the capability, does not understand it, and nothing changes: no server path
 * decides anything from having boxes.
 */
export const CAPACIDADE_EMPARELHAMENTO = "pairing"

/**
 * The capability that says "this server routes ephemeral channel signals"
 * (`channel.sinal`): a frame encrypted by the client, which the server passes to
 * other members connected at that moment and does not store.
 *
 * **Announced in both directions, and the client's announcement decides
 * delivery.** The server announces it in `hello.ok`; the client announces it in
 * `hello.capabilities`. The server only delivers `channel.sinal` to connections that announced it, and only accepts `channel.sinal` from them. A client 0.5.7 or 0.6.0 does not
 * announce it, and so never receives a frame it doesn't know about: for them, nothing
 * changes. It's the rule as always: server first, client second.
 *
 * What it's for: digests and requests for sync between accounts
 * (`docs/planos/2026-10-20-sincronia-absoluta.md`, section 4.5). They're small, only valid while true,
 * and should not pass through the MLS ratchet or stay 30 dias on the server.
 *
 * **What the server sees:** the channel, who sends, when, and the size. Not the
 * content: it travels encrypted with a key exported from the MLS epoch, which the server
 * doesn't have. See `docs/THREAT-MODEL.md`, "Ephemeral channel signals".
 */
export const CAPACIDADE_SINAL_EFEMERO = "sinal-efemero"

/**
 * The PROTOCOL limit for the content of a `channel.sinal`, in
 * base64url characters as it travels.
 *
 * It's the schema limit, and protects the parser: a frame larger than this is `bad-frame`. The
 * limit the server actually applies is lower and comes from the operator
 * (`TECTOS_DO_SINAL.maxBytes` in `apps/server/src/config.ts`, 16 KiB by
 * default). The two exist separately on purpose: above the operator's limit,
 * the sender gets `channel.sinal.rejected` with `sinal-too-large` and knows what
 * happened; above this one, it only gets `bad-frame`.
 *
 * 64 KiB is enough for any signal on the plane: the largest is a list of keys of
 * 6 bytes from a bucket (section 4.2, level 2), and a thousand keys are 8 KiB in base64.
 */
export const SINAL_MAX_CARACTERES = 64 * 1024

/**
 * The room card entry limit (`channel.groupinfo.put`), in base64 characters.
 *
 * The card is the `GroupInfo` with the whole tree, and the tree grows with who
 * is there: about 2.9 KB per leaf, measured from real sessions on 3/11/2026.
 * The limit was 262 144 characters (196 KB, ~68 leaves), and the Orwell
 * channel broke it that day with 108 accounts: each member's `put` was rejected
 * as `bad-frame`, the server lost the card, and each join depended on a member
 * being connected. 8 MiB is ~2 000 leaves, below the frame limit
 * (`MAX_FRAME_BYTES`, 12 MiB, on the server).
 */
export const CARTAO_MAX_CARACTERES = 8 * 1024 * 1024

/**
 * The capability that says "this client understands rejection of a send for
 * rate limiting" (`channel.rejected` with `reason: "rate-limited"` and
 * `retryAfterMs`).
 *
 * The server has a limit on sends per account per minute
 * (`Gateway.ENVIOS_POR_MINUTO`). Until 21/10/2026 a send above the limit was
 * dropped IN SILENCE: the client held it as sent, nobody received it, and a
 * sync report that fell in the same minute was also lost (S6 of absolute sync:
 * 1.800 sends from one account in a row and 45% of likes and all votes never
 * arrived).
 *
 * Only those who announce this get the new `channel.rejected`: an old client
 * reading any `channel.rejected` it does not know reads it as "this room no
 * longer exists" and advises the person to leave. They get an `error` with
 * code `rate-limited`, which goes to diagnostics and changes nothing.
 */
export const CAPACIDADE_ENVIO_RECUSADO = "envio-recusado"

/**
 * The server arbitrates the start of a direct conversation (phase 1g, 28/10/2026).
 *
 * `channel.claim` on a `!dm-a.b` is only valid for one of the two accounts in
 * the name: the other account gets `mine: false` without claiming anything. A
 * client that hears this capability claims the start BEFORE creating the
 * direct group, and whoever loses waits for the Welcome from who won. Without
 * it, both sides opening the direct at the same moment created two MLS groups
 * with the same name.
 *
 * A client that does not hear it creates the direct as before, without
 * claiming: an earlier server let any account claim a `!dm-`, and whoever
 * claimed first left both sides waiting.
 *
 * The rule for the `!dm-a.b` form is server-only (`gateway.ts`, through slice 3
 * removal). The client knows a channel is a direct by the vault card
 * (`tipoDoCanal` in core, 1.0 slice 2), not by the form.
 */
export const CAPACIDADE_ESTREIA_DA_DIRECTA = "estreia-da-directa"

/**
 * The server accepts opaque addresses (`!<40 base32>:<servidor>`, see
 * `eMoradaOpaca`) and arbitrates their first use by whoever requests it first (1.0
 * "Arca", section 4).
 *
 * An opaque address doesn't name anyone, so the server doesn't apply name
 * guards to it (`!dm-a.b` only for `a` or `b`, `!feed-x` only for `x`): its
 * `channel.claim` belongs to whoever requests it first, like in a room. Doesn't
 * need another guard because 200 bits can't be guessed. A client that
 * derives opaque addresses (section 3) only uses them on a server that announces this; on
 * an older server, an opaque one was treated the same way, but by accident
 * not by promise.
 */
export const CAPACIDADE_MORADAS_OPACAS = "moradas-opacas"

/**
 * The server gives each invite a short code and resolves it (1.0 "Arca",
 * slice 4; see `ligacao-curta.ts`).
 *
 * With it, `invite.created` brings `codigoCurto`, `invite.list.result` brings
 * each invite's code, and `invite.resolve` replies with `invite.resolved` or
 * `invite.unresolved`. A client that does not hear it shows the long link, as
 * always.
 */
export const CAPACIDADE_LIGACOES_CURTAS = "ligacoes-curtas"

/**
 * The server stores the invite seal and returns it (1.0 "Arca", section 5c; see
 * `selo-do-convite.ts`).
 *
 * With it, the `invite.create` stores the `selo`, the `invite.resolved` brings the invite
 * seal, and `invite.selo` (via `codeHash`, for the long connection) responds
 * with `invite.selo.result`. The client sends the seal always: a server that doesn't
 * know it drops it on read. Without it, the client doesn't ask, and the
 * invite request says "a channel".
 */
export const CAPACIDADE_SELO_DO_CONVITE = "selo-do-convite"

/**
 * The server verifies the proof of the code in `invite.redeem` (1.0 "Arca", slice 2;
 * see `prova-do-convite.ts`).
 *
 * An invite created with `codeKey` redeems only with a valid `proof`: the
 * `codeHash` alone, which is in the database, no longer suffices. An invite without
 * `codeKey` (created by a 0.9.x client) continues to redeem by hash until
 * the cutoff; with `ENCLAVE_SO_MORADAS_OPACAS` that path closes. The client sends
 * `codeKey` and `proof` always: a server that does not know them strips them when reading.
 */
export const CAPACIDADE_RESGATE_POR_PROVA = "resgate-por-prova"

/**
 * The error code that rejects a client below the server's minimum version
 * (1.0 "Arca", slice 4).
 *
 * It comes in the fatal `error` that answers `hello`, and the connection closes after.
 * The app translates the code in its catalog; the server's message is for those who do not
 * know it (0.9 in cache), who show it as is. A stable code: it never changes meaning
 * and is never reused.
 */
export const CODIGO_VERSAO_ANTIGA = "versao-antiga"

/**
 * The error codes that reject a `channel.sinal`. Stable keys: the interface
 * translates each one in its error catalog, and a code never changes meaning
 * and is never reused.
 *
 * - `sinal-not-announced`: the connection did not announce `CAPACIDADE_SINAL_EFEMERO`
 *   in `hello`. The sender must be able to receive.
 * - `sinal-no-seat`: the connection is not subscribed to this channel.
 * - `sinal-too-large`: the signal exceeds the operator's limit, or costs alone
 *   more than the channel's outbound limit (a large signal in a channel with many
 *   members connected). Waiting does not help: a smaller signal is needed.
 * - `sinal-rate-limited`: this connection exceeded the signals-per-minute limit.
 * - `sinal-channel-busy`: the channel exceeded the outbound bytes-per-minute limit.
 *   Multiple members sending at once; waiting helps.
 */
export const CODIGOS_DE_RECUSA_DO_SINAL = [
  "sinal-not-announced",
  "sinal-no-seat",
  "sinal-too-large",
  "sinal-rate-limited",
  "sinal-channel-busy",
] as const
export type CodigoDeRecusaDoSinal = (typeof CODIGOS_DE_RECUSA_DO_SINAL)[number]

/**
 * Where a stream comes from: the microphone, the camera, or the screen.
 *
 * **This is what replaces the reserved transceiver of the mesh.** In a peer-to-peer
 * connection, screen sharing is distinguished from the camera by PLACE: each pair is born
 * with an `m-line` only for the screen, and `replaceTrack` puts and removes the image
 * from there without renegotiating. With an SFU there are no places, there are producers,
 * and two video producers from the same sender are indistinguishable by `kind`. Without
 * this field, the receiver does not know which of the two to put on stage and which to
 * put on the person's card, and what you see is someone's screen inside a 190 by 128
 * rectangle with the edges cut off, or their face at full screen.
 *
 * **Optional, and absence is read by `kind`:** audio is microphone, video is
 * camera. This is what a Phase 2 client writes, it only produces audio, and never
 * sent this field, and it is the house default for everything added to the wire:
 * a new field can never change the meaning of what is already there.
 *
 * **What it protects against someone lying, spelled out:** nothing, and it does not need to.
 * A client that declares `camara` while sharing the screen hits the camera bandwidth limit,
 * which is tighter, the lie costs them. One that declares `ecra` while sending their face
 * occupies the only screen slot for that call, and it is annoying for those already in the
 * channel, not a violation of anything. The limits that stand up to an adversarial client
 * are the others: the transport's `setMaxIncomingBitrate` and the participant cap.
 */
export const FonteDeMedia = z.enum(["microfone", "camara", "ecra", "musica"])
export type FonteDeMedia = z.infer<typeof FonteDeMedia>

/**
 * How many people can be on the call and still fit on screen, with SFU.
 *
 * **The old number was six, and came from MESH.** Whoever shared sent the
 * image once PER PERSON: at six people that was five streams, 12,5 Mbps of home
 * uplink, and what happened when it did not fit was not a warning, the entire
 * call choked, voice included, because the output queue is shared. That physics
 * died with SFU: whoever shares sends ONE stream, whether there are two people
 * or twenty, and it fits on any home connection with room to spare.
 *
 * **The bottleneck moved: it became the SERVER OUTPUT**, and the count is
 * `saída = bitrate × número de espectadores`. Twenty is where it caps, since 3
 * of November 2026 (it was eleven, against an output of ~50 Mbit/s that had never
 * been measured). With the most expensive call the product lets run at twenty,
 * measured in load test (`docs/planos/limites-media-relatorio.md`):
 *
 *   2 ecrs with audio   2 × 19 espectadores × 2,56 Mbit/s  =  97 Mbit/s
 *   4 cs         4 × 19 × 1,2 Mbit/s                =  91 Mbit/s
 *   voice            20 × 19, 4 a active and 16 em DTX     =   4 Mbit/s
 *                                                         ---------
 *                     measured on the wire, with headers:       209 Mbit/s
 *
 * against a measured output of 300 a 745 Mbit/s (`docs/planos/depois-da-1-0.md`,
 * "VPS bandwidth"), shared with magnuslab.pt. The 25 a same call measures 265
 * Mbit/s, and the 30 mede 323: it passes the lowest measured output. Twenty leaves
 * headroom for the website and for broadcasts. The CPU handles it: ~61 % of
 * a VPS core, estimated.
 *
 * The cap is set when the screen starts, not when someone joins later. A call at
 * 20 com with both screens up that grows to 50 passa of 500
 * Mbit/s: that is the gap the report leaves written down, for the decision.
 *
 * It lives in the protocol, not on the server, because BOTH sides need it and
 * need the same one: the server to refuse, and the client to draw the button
 * grayed out BEFORE anyone clicks it. An open selector already lit the OS
 * recording indicator, and closing it after is asking the screen from someone
 * to do nothing with it. Written in both places, they would diverge, and
 * divergence here is the UI offering what the server refuses.
 */
export const PESSOAS_COM_ECRA = 20

/**
 * The encoding cap for a camera, in bits per second.
 *
 * **1,2 Mbps since 18 August, and the number was MEASURED.** It was 600 kbps, with the
 * note "600 kbps is 720p at a low frame rate or 480p at a normal frame rate",  * a note nobody had ever measured, while the settings screen offered "720p" to
 * whoever wanted it. What 600 kbps gives, measured in `scripts/sfu-prova-720p/` with a 1280×720 a 30 e
 * camera on the product path (VP8, an encoder, `maxBitrate`):
 *
 * | cap | still scene | moving scene |
 * |---|---|---|
 * | 600 kbps | 1280×720, QP 45 | **960×540**, QP 91, limit `bandwidth` |
 * | 1200 kbps | 1280×720, QP 36 | 960×540, QP 62 |
 * | 1500 kbps | 1280×720, QP 33 | 960×540, QP 58 |
 * | 2000 kbps | 1280×720, QP 33 (and only 1,37 Mbps used) | 960×540, QP 57 |
 *
 * Two things come out of this. First: the 600 kbps "720p" on the settings
 * screen is a label, not a resolution, when the person moves, Chrome drops on
 * its own to 540p and tells no one. Second: above 1,2
 * Mbps the encoder stops asking for more (at the 2 Mbps cap it holds 1,37 e the QP
 * does not drop), so 1,2 is where the curve has already given almost all it had to give.
 *
 * **What this number did NOT do was grow the budget.** The server output is
 * `bitrate × quem consome × quantas câmaras`, and cameras per call dropped
 * from four to two in the same pass: 4 × 600 kbps and 2 × 1,2 Mbps are the same
 * budget, to the bit. See `CAMARAS_POR_AMBITO` in `apps/server/src/media.ts`,
 * where the whole math is and what it cost.
 *
 * It lives here for the same reason as `PESSOAS_COM_ECRA`, and the reason here is even more
 * direct: **the client declares this number and the server refuses it.** A cap of
 * 1,2 Mbps on the server and 1,3 no on the client gives a camera that never
 * connects, with a refusal that tells the truth about a disagreement no one sees.
 */
export const TECTO_DA_CAMARA = 1_200_000

/**
 * The encoding ceiling for a shared screen, in bits per second.
 *
 * The same 2.5 Mbps that the mesh already used, and there it was the ceiling for
 * whoever sent N copies, here it is the one for whoever sends one. Below around
 * 300 kbps the text becomes unreadable, and an unreadable screen is not sharing.
 * Since 2 November 2026 the screen requests 30 frames per second (it was 15)
 * within this same ceiling: when it does not fit, the encoder sacrifices frame rate
 * and keeps sharpness (`detail`).
 */
export const TECTO_DO_ECRA = 2_500_000

/**
 * The AUDIO ceiling for a shared screen, in bits per second.
 *
 * Screen audio is music, a video, or system audio, not voice: it goes in stereo
 * Opus at 64 kbps, which is the rate where music stops sounding like a phone call.
 * Voice stays at 32 kbps mono as always.
 *
 * **Counts inside `TECTO_DO_ECRA`, not on top of it.** Whoever shares with audio
 * lowers the image by this number, and the entire screen (image and audio) still
 * fits within the ceiling that the server's outbound math already made.
 */
export const TECTO_DO_SOM_DO_ECRA = 64_000

/**
 * The scope identifier for a call: the digest of `(canal, sala)`.
 *
 * It lives here, next to the schema that validates its shape, because it is a
 * contract between processes that never speak directly: **two clients in the same
 * room must arrive at the same digest**, or they fall into different routers and
 * cannot hear each other, with the call saying it is connected on both sides,
 * which is the most expensive bug this layer can produce. A second copy of this
 * count in another file is a divergence waiting to happen.
 *
 * **Why a digest and not the room name.** The channel the server already knows,  * it routes everything else by it. The ROOM inside the channel travels encrypted
 * in MLS payloads (`voice.join.room`) and the server never sees it; but it needs to
 * separate two calls in the same channel, or people in two different voice rooms
 * hear each other. The digest separates without naming.
 *
 * **What it is NOT: a secret.** It is minimization, and we say so plainly because
 * appearances deceive: a normal room name, "general", "voice", has a digest
 * any curious server calculates in milliseconds. What it guarantees is that the
 * name does not travel and does not end up stored in a server map by accident.
 *
 * **The length in front of the channel, not `canal|sala`.** With the separator
 * alone, `("#a|b:x", "c")` and `("#a", "b:x|c")` digest to the same thing: two
 * different calls in the same router. Channel names on this platform do not
 * carry `|` today, but the design cannot depend on a ban that is not written
 * anywhere. It is the same reasoning, and the same shape, as
 * `chaveDeAmbito` in the gateway, where it is already written out in full.
 *
 * The default room is the empty string, as everywhere in `call.ts`, and has
 * its own scope: it is a room like any other, not a special case.
 */
export function ambitoDaChamada(channel: string, room: string): string {
  return toBase64(sha256(new TextEncoder().encode(`${channel.length}:${channel}:${room}`)))
}

const Base64 = z.string().regex(/^[A-Za-z0-9_-]*$/, "expected unpadded base64url")

/** The seal of the invite on the wire, with a cap. See `selo-do-convite.ts`. */
const SeloDoConvite = Base64.max(SELO_DO_CONVITE_MAX_CARACTERES)

/**
 * The maximum size of an MLS key package, in bytes (INV-02, external audit
 * of 1.1.0).
 *
 * Measured 4/11/2026 with serious math (device with chain, suite
 * `MLS_256_XWING_CHACHA20POLY1305_SHA512_Ed25519`): 2,834 to 2,850 bytes. The bulk
 * is the two X-Wing keys (the init key and the leaf key, 1,216 bytes each). Eight KiB
 * is roughly triple, and a larger post-quantum suite fits without touching here.
 * Until now the only ceiling was the frame's, 12 MiB, and each redemption
 * was broadcast to all connected members of the channel.
 */
export const TAMANHO_MAXIMO_DO_KEY_PACKAGE = 8 * 1024

/** A key package on the wire: base64url without padding, up to `TAMANHO_MAXIMO_DO_KEY_PACKAGE` bytes. */
const KeyPackageNoFio = Base64.max(Math.ceil((TAMANHO_MAXIMO_DO_KEY_PACKAGE * 4) / 3))
const Address = z.string().min(3).max(255)

/** The identifier of a pairing box: 22 base64url characters, nothing more. See `pair.ts`. */
const PairId = z.string().regex(PAIR_ID_PATTERN, "expected a 22-char base64url pair id")

/**
 * The encrypted content of a `pair.send`. The server does not read it, and the
 * schema does not try to read it: it only measures the size, so a box does not
 * become a tunnel. See `PAIR_PAYLOAD_MAX_CHARS`.
 *
 * **A string, not `unknown`.** It is always the base64 of the AEAD: `cifrarPairPayload`
 * produces nothing else and `decifrarPairPayload` refuses anything not a string.
 * Measuring the size with `JSON.stringify` would force the server to serialize
 * what was sent BEFORE the authentication gate, and a twelve-MiB object
 * would cost CPU before anyone proved who they are. `z.string().max()` measures what
 * is already there.
 */
const PairPayloadOpaco = z.string().max(PAIR_PAYLOAD_MAX_CHARS, "pair payload too large")

/** Payload classes the server routes differently. It still cannot read any of them. */
export const EnvelopeKind = z.enum([
  /** MLS PrivateMessage carrying a chat payload. */
  "application",
  /** MLS Commit/Proposal — membership and epoch changes. Fanned out to all, ordered. */
  "handshake",
  /** MLS Welcome — delivered only to the joining member. */
  "welcome",
])
export type EnvelopeKind = z.infer<typeof EnvelopeKind>

// ---------------------------------------------------------------- client -> server

// ------------------------------------------------ Phase M2: full frame on request

/**
 * The capability that says "this server accepts `sfu.keyframe`".
 *
 * Only with it announced does the client send the request: an earlier server
 * would refuse the frame with a `bad-frame`, and the request is not worth a refusal.
 * Announced with `CAPACIDADE_SFU`, never without it.
 */
export const CAPACIDADE_SFU_FOTOGRAMA_CHAVE = "sfu-keyframe"

/**
 * "The image I receive on this consumer broke: ask the sender for a keyframe."
 *
 * The VIEWER is the one who knows the decoder is lost (`freezeCount` climbing
 * in the receiver's `getStats`, or a video frame that did not open and then
 * opened again). The server only forwards: `consumer.requestKeyFrame()`,
 * which mediasoup translates to a PLI for the sender. It reads nothing from the image.
 *
 * No response and no `ref`, on purpose: one extra request is silently ignored (the
 * limit per consumer is one per second, see `MotorDeMedia.pedirFotogramaChave`),
 * and a response per request was traffic doubling for something that needs no
 * confirmation. The consumer must be OURS: the engine requires the owner's transport,
 * as in `sfu.pause`.
 */
export const SfuKeyframe = z.object({
  t: z.literal("sfu.keyframe"),
  transport: z.string().max(64),
  consumer: z.string().max(64),
  /** Accepted by the common shape of requested `sfu.*` frames, and ignored: no response. */
  ref: z.string().max(64).optional(),
})

/** The frames of the pre-vault client. The exported union (`ClientFrame`) joins them with the vault's, at the end of this file. */
const TramasDoClienteSemCofre = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("hello"),
    version: z.literal(PROTOCOL_VERSION),
    /**
     * What this client guarantees, said by itself.
     *
     * `commit-after-echo`: applies its commit only after the server accepts it.
     * A client that applies before (earlier than 13/9/2026) ends up alone in a branch
     * when it loses the race, and if the server accepted its next commit
     * or card, it would make that branch official and lock the room for everyone.
     * Without this guarantee the server discards its commits, cards and Welcomes,
     * IN SILENCE, and the card fetch gets the empty response: the old client would
     * read any `channel.rejected` as "this room no longer exists" and would advise
     * the person to leave. Optional so old clients can keep connecting and talking.
     */
    capabilities: z.array(z.string().max(64)).max(32).optional(),
    /**
     * The app version, as `package.json` says it (`1.0.0`).
     *
     * It exists so the 1.0 cutoff server rejects beta clients with a message instead
     * of letting them speak a language it no longer understands (see
     * `CODIGO_VERSAO_ANTIGA`). Optional: an old client does not send it, and it only
     * counts as old on a server that has a minimum version set. What it teaches the
     * operator, and the threat model says so: what version of the app each connection
     * runs. The server does not keep it; it reads it in `hello` and forgets it.
     */
    versao: z.string().max(32).optional(),
  }),

  /**
   * Step 1 of login: ask for a nonce to sign. No secret is ever transmitted.
   *
   * The public key travels with the address because the address is a *truncated
   * hash* of that key and therefore not invertible. The server does not have to
   * trust the key: it recomputes the account id from it and compares. A wrong
   * key simply fails to match the address the client asked for.
   *
   * **`accountKey` and `deviceCert` are the chain, and optional.** With them,
   * `signingKey` is the device key and the server validates one more link: the
   * address is the hash of `accountKey`, and `deviceCert` is that account's
   * signature over this device. Without them, `signingKey` is the account key
   * itself and verification is the usual direct check, still sufficient proof
   * because it requires the account key in hand.
   *
   * Optional, not a new `t` by house rules: a field one side does not know is
   * ignored, a `t` one side does not know is a rejected frame. The two must come
   * together; a partial chain is rejected rather than silently treated as absent,
   * because treating it as absent would yield an error about the wrong key and
   * send you looking in the wrong place.
   */
  z.object({
    t: z.literal("auth.begin"),
    address: Address,
    signingKey: Base64,
    accountKey: Base64.optional(),
    deviceCert: Base64.optional(),
  }),
  /**
   * Step 2: prove possession of the signing key presented at `auth.begin`.
   *
   * **`posse` and `assumirPosse`: which copy of a device speaks for it.**
   * Importing an account file makes a COPY of the device that exported it: the
   * same device key and the same MLS leaf in each channel. The server does not
   * distinguish the two by key, and two linked copies consume the same ratchet
   * and break channels (measured 27 October 2026 in
   * `scripts/e2e-exportar-importar.mjs`). So each device has a GENERATION of
   * possession on the server: the copy just imported asks for the next one
   * (`assumirPosse`), and a copy presenting with a generation below the current
   * one is rejected as revoked. That is what makes the interface statement true:
   * "the old device can no longer use it."
   *
   * Here and not in `auth.begin`: raising the generation takes possession from
   * the other copy, and only whoever already proved the key can do it. Optional
   * by house rules: a client that does not know them presents with generation zero.
   *
   * `assumirPosse` carries a random stamp, drawn at the moment of import. The
   * same copy can open two connections at once (a `connect` that overrides
   * another, see `Session.connect`), and both ask for possession; with the same
   * stamp the server gives them the same generation instead of one closing the
   * other. Another import of the same file draws another stamp, and that one
   * raises it.
   */
  z.object({
    t: z.literal("auth.finish"),
    signature: Base64,
    posse: z.number().int().min(0).max(2_147_483_647).optional(),
    assumirPosse: z.string().min(16).max(64).optional(),
  }),

  z.object({ t: z.literal("channel.subscribe"), channels: z.array(z.string()).max(512) }),
  z.object({ t: z.literal("channel.unsubscribe"), channels: z.array(z.string()).max(512) }),

  z.object({
    t: z.literal("channel.send"),
    channel: z.string(),
    kind: EnvelopeKind,
    ciphertext: Base64,
    /** Present only for `welcome`: the single member allowed to fetch it. */
    recipient: Address.optional(),
    /** Client-chosen, so the sender can match its own echo. Never persisted. */
    ref: z.string().max(64).optional(),
  }),

  /**
   * Fetch stored events for a channel.
   *
   * `afterSeq` walks *forwards* and is what catching up after a disconnect
   * needs. It is not a convenience: MLS commits missed while offline leave the
   * client stranded on an old epoch, and every later message then decrypts to
   * nothing — permanently, and silently. `beforeSeq` walks backwards for
   * scrolling through history.
   */
  z.object({
    t: z.literal("channel.backfill"),
    channel: z.string(),
    /** Exclusive lower bound. `-1` means "from the very first event". */
    afterSeq: z.number().int().min(-1).optional(),
    beforeSeq: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),

  /**
   * Publish single-use MLS KeyPackages so others can add us to a group offline.
   *
   * `replace` discards our previously published, still-unclaimed packages. A
   * client that has lost the private halves — a fresh install, a restored
   * backup — must say so, because a package it cannot answer is worse than no
   * package at all: the invitation is accepted by the server, consumed, and
   * then silently never joins.
   */
  z.object({
    t: z.literal("keypackage.publish"),
    packages: z.array(KeyPackageNoFio).min(1).max(100),
    replace: z.boolean().default(false),
    /**
     * The public key of the DEVICE that signs the leaves of these packets.
     *
     * Optional because a 0.2.3 client does not send it. The server stores it
     * alongside each packet to serve them by device (`claim` with `bundle`),
     * and checks it against the key that did the login when the chain came: the
     * two must be the same, because the same key signs the challenge and the
     * leaves. When missing, the server uses the login key with chain, which
     * proves the same fact; without chain, it ends up with no device (`NULL`).
     */
    device: Base64.optional(),
  }),
  /**
   * Consume one KeyPackage for a user. Single-use: replay would break FS.
   *
   * `bundle: true` asks for one packet per device from the account manifest, all
   * in the same response (`keypackage.claimed.keyPackages`), with the manifest
   * on the side so the inviter can check that each packet is from a device the
   * account declared. Without `bundle`, one packet and nothing else: see
   * `CAPACIDADE_BUNDLE` for why it is asked and never offered. Against an old
   * server the field is discarded by its schema (no `z.object` in the flow is
   * `.strict()`) and one packet comes, no error or delay.
   *
   * `devices`: only these devices from the manifest, in base64url. This is what
   * the inviter sends when the account already has leaves in the channel and
   * only some are missing: asking for the full bundle would waste one packet
   * from each device already present, and a claimed packet never goes back to
   * the pool. Devices outside the manifest are ignored. Without `devices`, all
   * from the manifest.
   */
  z.object({
    t: z.literal("keypackage.claim"),
    address: Address,
    bundle: z.boolean().default(false),
    devices: z.array(Base64).max(APARELHOS_POR_CONTA).optional(),
  }),

  /**
   * Register an invite code for a channel.
   *
   * The server is given a hash, never the code itself, so a breach of its
   * database does not hand anyone a working invite. It stores the policy —
   * when the code stops working, and how many times it may be used — because
   * enforcing that is routing, not access: the server still cannot admit
   * anybody. Only a member holding group keys can do that.
   */
  z.object({
    t: z.literal("invite.create"),
    channel: z.string(),
    codeHash: Base64,
    /** Unix seconds, or null for a code that never expires on its own. */
    expiresAt: z.number().int().positive().nullable(),
    /** null for unlimited. */
    maxUses: z.number().int().positive().nullable(),
    /**
     * The PUBLIC key of the proof, derived from the code (`chaveDaProvaDoConvite`).
     * With it, redeem asks for `prova` and `codeHash` alone is no longer enough.
     * Optional: a 0.9.x client does not send it. See `CAPACIDADE_RESGATE_POR_PROVA`.
     */
    codeKey: Base64.optional(),
    /**
     * The channel name (and the inviter's name), encrypted with a key that only
     * comes from the code (`selarNomeDoConvite`). The server stores it without
     * reading it. See `CAPACIDADE_SELO_DO_CONVITE`.
     */
    selo: SeloDoConvite.optional(),
  }),
  z.object({ t: z.literal("invite.revoke"), codeHash: Base64 }),
  z.object({ t: z.literal("invite.list"), channel: z.string() }),

  /**
   * Present an invite code, together with a key package to be added with.
   *
   * The server matches the hash, checks the policy, and forwards the request to
   * the channel's members. It cannot complete the join itself.
   */
  z.object({
    t: z.literal("invite.redeem"),
    codeHash: Base64,
    keyPackage: KeyPackageNoFio,
    /**
     * The signature with the key derived from the code over the request
     * (`provarCodigoDoConvite`). Proves the caller has the link, not just the
     * `codeHash` that is in the database. See `CAPACIDADE_RESGATE_POR_PROVA`.
     */
    prova: Base64.optional(),
  }),

  /**
   * Resolve the short code of a link `orwell.pt/c#<código>`.
   *
   * Responds with `invite.resolved` (the channel and the `codeHash`, which is what the
   * `invite.redeem` asks for next) or `invite.unresolved`. Does not spend a use:
   * spending a use is up to `invite.redeem`, and whoever only looks at the link did not
   * enter anywhere. Through the gateway not HTTP, so the code never lives in a
   * URL path (which ends up in proxy logs) and the cap is on us.
   */
  z.object({ t: z.literal("invite.resolve"), codigo: CodigoCurto }),

  /**
   * Request the seal of an invite by `codeHash`: this is the long-link path,
   * which has no short code (1.0 "Arca", slice 5c). Responds with
   * `invite.selo.result`. Does not consume a use. The seal only opens with the
   * code, and the `codeHash` (256 bits) is not guessable. See
   * `CAPACIDADE_SELO_DO_CONVITE`.
   */
  z.object({ t: z.literal("invite.selo"), codeHash: Base64 }),

  /**
   * Ask the gateway to stop (or resume) announcing this connection to the
   * people who share channels with us.
   *
   * Deliberately narrow: it changes what the server TELLS OTHERS, never what
   * the server itself knows — it has to know we are connected to deliver
   * anything at all, and the UI says so rather than selling invisibility as
   * something it is not.
   */
  z.object({ t: z.literal("presence.set"), visible: z.boolean() }),

  /**
   * "Send me my pending invitations again."
   *
   * The server cannot know which welcomes a client consumed, so it re-sends
   * them at every handshake — but a client that has just cleared a welcome it
   * had written off needs them NOW, without dropping the socket. Costs one
   * lookup and hands back only what the caller was already entitled to.
   */
  z.object({ t: z.literal("welcome.resync") }),

  /**
   * "I can no longer read this channel — somebody give me a new seat."
   *
   * The out-of-band half of the repair, and it has to be out-of-band: a
   * client that cannot decrypt the channel cannot ask for help INSIDE it,
   * and the healthy members have no way to notice, because the broken
   * member's old leaf still sits in their tree looking perfectly fine. So
   * the request travels as plaintext routing metadata instead.
   *
   * What the server learns: that an account already subscribed to a channel
   * wants back in. It knew the subscription; it learns nothing about content
   * and nothing about anyone else. Nothing is stored.
   */
  z.object({ t: z.literal("channel.rejoin.request"), channel: z.string() }),

  /**
   * "Who else has an account on this server?"
   *
   * Answered only when the operator turned community mode on. It is a real
   * change of posture — on a public server it would be indefensible — and it
   * exists for the small, private, everyone-knows-everyone deployment this
   * was built for. The answer carries addresses and nothing else: no names,
   * no profiles, no activity.
   */
  z.object({ t: z.literal("directory.list") }),

  z.object({ t: z.literal("voice.leave"), channel: z.string() }),
  /** Opaque WebRTC signalling relayed to the SFU. Media itself stays E2EE. */
  z.object({ t: z.literal("voice.signal"), channel: z.string(), payload: z.unknown() }),

  /**
   * "Which STUN and TURN servers should I use for this call?"
   *
   * Asked over the authenticated gateway rather than served from an HTTP route,
   * because the answer carries a credential and because an unauthenticated
   * endpoint that hands out relay credentials is an open proxy with extra steps.
   * The shared TURN secret never leaves the server: what the client receives is
   * a username and an HMAC over it, valid for minutes.
   *
   * Without this the client fell back to a hardcoded public STUN server, which
   * told a third party the IP address and exact time of every call in a product
   * whose entire argument is that no third party learns anything — and, being
   * STUN only, could not connect two people behind symmetric NAT or CGNAT at all.
   */
  z.object({ t: z.literal("ice.servers") }),

  // ------------------------------------------------------------------ SFU
  //
  // Media signaling lives on THIS plane, not in MLS payloads, and there is only
  // one reason: with SFU you negotiate with the SERVER, and the server is not a
  // group member, it cannot read an encrypted payload. It is the same plane where
  // `ice.servers` already lives, for the same reason.
  //
  // The two tolerances, checked in code before writing this, because security of
  // the deployment depends on them:
  //
  //  - **Old server, new client:** the gateway validates with Zod and responds
  //    with non-fatal `bad-frame` to an unknown `t`. In practice it does not
  //    happen, because the client only speaks SFU if `hello.ok` announces
  //    `CAPACIDADE_SFU`, and an old server does not. Server first, client after.
  //  - **Old client, new server:** the client does NOT validate with Zod, it does
  //    `JSON.parse` with cast and dispatches by `frame.t`, and an unknown type
  //    drops to the ground without counting for anything. And anyway these frames
  //    only go out in response to requests an old client never makes.

  /**
   * "Let me into the call in this room, and tell me what it speaks."
   *
   * The first frame of any SFU call. The server validates the CHANNEL with
   * the `#mayReach` as always, the same key that holds history and live cipher,    * and returns the router's RTP capabilities and the streams already there.
   *
   * **`channel` in clear and `scope` in digest, and the asymmetry is the design.** The
   * channel the server already knows: it routes everything else by it, and it
   * knows how to decide who enters on it. The ROOM inside the channel travels
   * encrypted in MLS payloads (`voice.join.room`) and the server never sees it, but it
   * needs to separate two calls in the same channel, or people in two different
   * voice rooms hear each other. A digest solves both: it separates without naming.
   *
   * **What stops a forged `scope` from linking two channels:** the router
   * key is the PAIR `(canal, scope)`, not `scope` alone. See `chaveDeAmbito` in the
   * gateway. Without it, two people from different channels who sent the same
   * digest would fall into the same router and hear each other, a hole that no
   * digest validation would catch, because the digest is chosen by whoever sends it.
   *
   * **What the digest is NOT: a secret.** It is minimization, and it is honest to
   * say so: a normal room name ("general", "voice") has a digest any curious
   * server calculates in milliseconds. What it guarantees is that the name does
   * not travel and does not end up anywhere by accident. If Phase 2 quiser wants
   * it to be truly opaque, derive it from group material instead of digesting
   * the name, and then it must derive it from something STABLE across epochs,
   * never from the current epoch exporter: a scope that changed with each
   * person's entry would put the whole room in a new router each `commit`, and
   * the call would break every time someone joined.
   */
  z.object({
    t: z.literal("sfu.scope.join"),
    channel: z.string(),
    /**
     * The digest of `canal|sala`, in base64url without padding.
     *
     * Fixed length of 43 caracteres, that of a SHA-256, not a maximum. It is
     * the only way the SCHEMA prevents the obvious slip: with a `max(64)`,
     * a client that sent the room name in clear would pass validation, and the
     * server would end up with the name stored in a map and no one would notice.
     */
    scope: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "expected a base64url SHA-256 digest"),
    /** See `ref` in `sfu.transport.create`. */
    ref: z.string().max(64).optional(),
  }),

  /** "I am out of this call." Drops transports, producers, and consumers. */
  z.object({ t: z.literal("sfu.scope.leave"), channel: z.string(), scope: z.string().max(64) }),

  /**
   * "Make me a transport so I can talk (or listen)."
   *
   * Two per call, one each direction, because that is how `mediasoup-client`
   * works: one `RTCPeerConnection` to send and another to receive. A second
   * request for the same direction is rejected rather than replacing the first,    * see `criarTransporte` in `media.ts`.
   *
   * `ref` is the tag the client picks to match the response to the request, on
   * the pattern of `ref` in `channel.send` and for the same reason: this gateway
   * has no request identifiers, and the alternative was to match by response
   * shape. With two transports being born at once, matching by shape is a race,    * and it is the class of bug the switch to SFU exists to end, not to repeat
   * elsewhere.
   */
  z.object({
    t: z.literal("sfu.transport.create"),
    channel: z.string(),
    scope: z.string().max(64),
    direction: z.enum(["envio", "recepcao"]),
    ref: z.string().max(64).optional(),
  }),

  /** The DTLS handshake: the parameters the client generated on its side. */
  z.object({
    t: z.literal("sfu.transport.connect"),
    transport: z.string().max(64),
    /** `DtlsParameters` from mediasoup. Opaque to the schema; the engine reads it. */
    dtlsParameters: z.unknown(),
    ref: z.string().max(64).optional(),
  }),

  /**
   * "I am going to put this stream in the call."
   *
   * `rtpParameters` is opaque here and validated by mediasoup, who knows the
   * shape, repeating it in Zod would maintain two schemas for the same object
   * and guarantee they diverged. What this server READS in it is one thing alone:
   * the declared `maxaveragebitrate`, to compare it against the budget. See
   * `#orcamentoExcedido`.
   */
  z.object({
    t: z.literal("sfu.produce"),
    transport: z.string().max(64),
    kind: z.enum(["audio", "video"]),
    rtpParameters: z.unknown(),
    /**
     * Where this stream comes from. See `FonteDeMedia`, absent reads by `kind`.
     *
     * The server READS this for two things, and neither is trust: pick the
     * bandwidth cap that applies to this stream, and tell other clients what to
     * do with it when it arrives. A screen and a camera are both `kind: "video"`,
     * and without this word the second video from one person is indistinguishable
     * from the first.
     */
    fonte: FonteDeMedia.optional(),
    ref: z.string().max(64).optional(),
  }),

  /**
   * "This stream is done", a producer, without leaving the call.
   *
   * The plan had a generic `sfu.close` and Phase 1 did not write it, with the
   * right reason for the time: closing a transport is what `sfu.scope.leave`
   * already does, and the path calls end for real is the socket falling. **Stopping
   * screen share is the case that was missing**, and it is another kind: the call
   * goes on, the transport goes on, the microphone goes on, what dies is one of
   * three producers.
   *
   * Without this, `producer.close()` on the client side deleted the image and the
   * server kept announcing to newcomers a stream that no longer exists, never
   * sending `sfu.producer.closed` to those watching. What was seen was the last
   * frame frozen on everyone's screen, forever, no error anywhere, the same
   * failure the track's `onended` exists to prevent on our side.
   *
   * Closes OUR producer and only ours: the engine checks the owner, as with all
   * frames that name an object instead of a channel.
   */
  z.object({
    t: z.literal("sfu.produce.close"),
    producer: z.string().max(64),
    ref: z.string().max(64).optional(),
  }),

  /** "I want to hear that stream." Born paused; see `sfu.resume`. */
  z.object({
    t: z.literal("sfu.consume"),
    transport: z.string().max(64),
    producer: z.string().max(64),
    rtpCapabilities: z.unknown(),
    ref: z.string().max(64).optional(),
  }),

  /**
   * "I installed the decrypt: send."
   *
   * Without this frame there is no call, and it is not a formality: the consumer
   * is born paused because there is a gap between `consume` and installing the
   * transform that decrypts, and anything in that gap arrives encrypted at the
   * decoder, which reads it as noise.
   */
  z.object({
    t: z.literal("sfu.resume"),
    transport: z.string().max(64),
    consumer: z.string().max(64),
    ref: z.string().max(64).optional(),
  }),

  /**
   * "I can't see it anymore: stop sending it to me."
   *
   * The counterpart to `sfu.resume`, and the missing piece that makes "Stop watching"
   * in screen sharing actually save bandwidth for real, which is the whole point.
   *
   * **What was missing and what it cost.** Closing the consumer on the client side
   * stops decryption and rendering, nothing more: the server kept forwarding the image
   * to a transport that no longer reads it. Each "Watch → Stop watching → Watch" cycle
   * left behind a consumer forwarding to no one, two `sfu.*` frames per cycle against
   * a three-hundred-per-minute cap, which means nearly one hundred fifty orphaned consumers
   * per minute, each at 2.5 Mbps of server outbound, charged to an authenticated member.
   *
   * **Pause instead of close, and that difference is the entire reason to exist.** A paused
   * consumer does not send RTP (that's what `consume({ paused: true })` already guarantees
   * between consumption and installing decryption), but it CONTINUES TO EXIST: the next
   * "Watch" is a `sfu.resume` on the same object, with decryption already installed and
   * no `sfu.consume` roundtrip. Closing forced a re-consume, and the close is what leaked
   * resources.
   *
   * **Added to the wire, for the usual reason:** an old client never sends it, and a server
   * that does not know it rejects it, the image keeps arriving, as it did before this change.
   *
   * **And what that rejection costs, stated in full, because it is nothing.** An old server's
   * rejection is the generic `bad-frame`, which comes WITHOUT `ref`: nothing matches the request,
   * so `sfuPausar` hangs the full fifteen-second timeout, and the `aVer` that tells the sharer
   * we stopped watching only goes out when it expires, the announcement is delayed on purpose,
   * to not lie about our state while the image still arrives. The stage on this side closes
   * instantly, which is the person's gesture; what delays is the message said to others, and
   * against a server that cannot even pause bandwidth, it was already running anyway. Acceptable
   * degradation, and written here instead of left for discovery when connecting a new client
   * to an old server and measuring fifteen seconds.
   *
   * Pauses a consumer that belongs to us and only us: the engine requires the transport of the
   * owner, as with all frames that name an object instead of a channel.
   */
  z.object({
    t: z.literal("sfu.pause"),
    transport: z.string().max(64),
    consumer: z.string().max(64),
    ref: z.string().max(64).optional(),
  }),

  /** "The image I get through this consumer broke: ask for a keyframe." See `SfuKeyframe`. */
  SfuKeyframe,

  z.object({ t: z.literal("ping") }),
  /** Request to be put in charge of creating a channel. See `channel.claim.result`. */
  z.object({ t: z.literal("channel.claim"), channel: z.string() }),

  /**
   * Leave the common room entry card on the server.
   *
   * A `GroupInfo` with external initialization that lets anyone arriving enter on their own
   * (see `publishableGroupInfo` in the cryptographic core). Published by a member, and the
   * server only accepts it for the channel it itself announces as common: for any other channel
   * this would be a door key left under the mat, because whoever picks it up enters without
   * an invite from anyone.
   */
  z.object({ t: z.literal("channel.groupinfo.put"), channel: z.string(), info: z.string().max(CARTAO_MAX_CARACTERES) }),

  /**
   * Retrieve that card, and remove it for good.
   *
   * `take` not `get`, on purpose: the server delivers it ONCE and deletes it. The card is valid
   * for the epoch it describes, and two people entering with the same one produce two commits
   * for the same epoch, of which the room only accepts one. Whoever lost that race would end up
   * with a group with the right name and nobody else inside, with no warning at all. See
   * `channel.groupinfo`.
   */
  z.object({ t: z.literal("channel.groupinfo.take"), channel: z.string() }),

  /**
   * "Go read this page and tell me the title and image it declares."
   *
   * Requested over the authenticated channel, not over HTTP, for the same reason as
   * `ice.servers`: an open route that fetches addresses of the requester's choosing is an
   * open proxy with extra steps, and here we need to account for where the machine hits
   * before it hits anywhere. This is also what makes it possible to rate-limit by account,
   * which is what stops this from being a traffic amplifier with our server's identity.
   *
   * Only the publisher's device requests it, and only when the site refused to be read by it,    * the reader never gets here, and that is the part of the promise that stays intact. The cost,
   * accepted: the server sees what links get published. It is not logged anywhere, and cannot be.
   */
  z.object({ t: z.literal("link.preview"), url: z.string().max(2048) }),

  /**
   * Publish the device manifest for THIS ACCOUNT.
   *
   * The server only keeps it if the signature closes, if the address is the one from the
   * authenticated connection, and if the version is higher than what it already has; it responds
   * with `manifest.published`. It is not a new `t` by accident: against an old server the client
   * never sends it, because the old server does not announce `CAPACIDADE_APARELHOS` (see the rule there).
   *
   * What the server learns: the public keys of a account's devices, which it already learned
   * one by one at login (table `devices`), and now with the account's word instead of the
   * server's observation.
   *
   * `revoke`: the devices that this manifest REVOKES, not just removes. Only counts what leaves
   * the manifest itself (`aparelhosRevogados`). Without the field, what leaves can come back:
   * it is the cap from a 0.5.7 client that does not send it. A server without
   * `CAPACIDADE_REVOGACAO` discards it by schema.
   */
  z.object({ t: z.literal("manifest.publish"), manifest: DeviceManifestWire, revoke: RevogadosNoManifesto.optional() }),

  /**
   * Request the manifest of any account on this server. Responds with `manifest.result`,
   * with `null` if it never published one.
   *
   * Any account, not just your own, because that is what it exists for: whoever is about to
   * invite someone needs to know which devices to admit, and does not yet share a channel with
   * that person. It is the same openness as `keypackage.claim`, and it is CHEAPER to abuse
   * than it, and here is why: a claim spends a key package from the asked-for person, and the
   * victim sees invites that never arrive; a `manifest.get` consumes nothing, nobody notices it,
   * and it returns to the asker how many devices the account has and when it added them
   * (`addedAt`, `signedAt`). The server sees who asks about whom and does not log it. Restricting
   * this to those who share a channel, or to those with a claimed key package, is being considered
   * for the next slice (docs/PENDENTES.md).
   */
  z.object({ t: z.literal("manifest.get"), address: Address }),

  /**
   * Open a pairing box. **Requires authenticated account**: it is the device that HAS the account
   * (the computer) that opens it, because it is the one that will sign the certificate. The
   * `pairId` is the digest of the secret (`pairIdDe`); the secret never comes on the wire.
   * Responds with `pair.opened`, or `pair.rejected` (`exists`: there is already a box with this
   * id; `rate-limited`; `full`: the server is at its global box cap).
   *
   * What the server learns: that this account wanted to add a device, and when. Nothing persists:
   * boxes live in memory and die in ten minutes or when either of the two connections closes.
   */
  z.object({ t: z.literal("pair.open"), pairId: PairId }),

  /**
   * Join a pairing box. **The only content frame that passes without authentication**, because
   * the phone does not have an account yet: it only has the secret, read from the QR code.
   * Counted by connection not by account (there is no account), and a box only takes two
   * connections: the third gets `pair.rejected` `full`, and the box is notified with `pair.closed`
   * `intruder`, because someone else had the secret. A box that does not exist is `pair.rejected`
   * `unknown`.
   */
  z.object({ t: z.literal("pair.join"), pairId: PairId }),

  /**
   * An encrypted payload for the other side of the box. The server forwards it and does not
   * read it; it only measures it. Only to whoever is in the box: from another connection it is
   * `unauthenticated` fatal, like any frame out of place.
   */
  z.object({ t: z.literal("pair.send"), pairId: PairId, payload: PairPayloadOpaco }),

  /** Close the box. The other side receives `pair.closed` `closed`. */
  z.object({ t: z.literal("pair.close"), pairId: PairId }),

  /**
   * An ephemeral signal for the other members of this channel who are connected right now.
   * See `CAPACIDADE_SINAL_EFEMERO`.
   *
   * `sinal`: bytes encrypted by the client, in base64url. The server does not read them:
   * it measures the size and forwards. It does not store, does not repeat to anyone offline,
   * does not enter recovery or federation.
   *
   * `ref`: chosen by the client to match a rejection with the send. Never goes out to other
   * members. No response when all goes well.
   *
   * Only from a connection that announced the capability and is subscribed to the channel.
   * A rejection is `channel.sinal.rejected`, never fatal on first try.
   */
  z.object({
    t: z.literal("channel.sinal"),
    channel: z.string().max(255),
    sinal: Base64.min(1).max(SINAL_MAX_CARACTERES),
    ref: z.string().max(64).optional(),
  }),
])
export type ClientFrame = z.infer<typeof ClientFrame>

// ---------------------------------------------------------------- server -> client

/** The server frames from before the vault. The exported union (`ServerFrame`) adds the vault's frames at the end of this file. */
const TramasDoServidorSemCofre = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("hello.ok"),
    version: z.literal(PROTOCOL_VERSION),
    server: z.string(),
    capabilities: z.array(z.string()),
    /**
     * Does the common room have an entry card waiting for someone to arrive?
     *
     * It exists so a member can know if the door is set without having to publish theirs at every
     * connection: the card carries the whole tree, and resending it habitually is traffic that
     * grows with the number of people inside. False signals that someone needs to put it back,
     * and the first member to connect replaces it.
     */
    commonRoomGroupInfo: z.boolean().optional(),
    /**
     * Minute when this server's storage was last restarted, if ever.
     *
     * A client holds group state that the server has no way to know about, the keys live in
     * its vault. If the storage is wiped, that state becomes orphaned: the client thinks it is
     * a member of channels whose history and peers have vanished, and from then on nothing
     * decrypts, neither messages nor call signaling, which travels inside the group.
     *
     * Declaring the marker here lets the client understand on its own that the world has changed,
     * instead of relying on someone pushing a button, and a button always available would be a
     * trivial way to erase someone else's history with brief device access.
     */
    resetAtMinute: z.number().int().nonnegative().optional(),
    /**
     * Minute from which only newly created accounts are valid.
     *
     * A client whose identity is older than this is speaking of an account the server no longer
     * recognizes. Unlike `resetAtMinute`, which only invalidates rooms, this one invalidates the
     * vault itself.
     */
    accountsResetAtMinute: z.number().int().nonnegative().optional(),
    /**
     * How many days this server keeps events before deleting them. Zero is
     * "deliver only, do not store".
     *
     * Announced so the client does not have to guess the archive window. Today it
     * is informational; what will read it is epoch key sharing across devices
     * (docs/PLANO_MULTIDISPOSITIVO.md, §3.4), which keeps keys for `min(30, isto)` days:
     * keeping keys for ciphertext the server has already deleted pays the full
     * price of weakening forward secrecy and buys nothing. Absent in a server
     * before this.
     */
    retentionDays: z.number().int().nonnegative().optional(),
    /**
     * The room everyone on this server enters, if the operator set one.
     *
     * The server announces the name; it does not create it or join it, because it does not have
     * the group keys. Whoever creates it is whoever arrives first, arbitrated by `channel.claim`.
     */
    commonRoom: z.string().optional(),
  }),

  z.object({ t: z.literal("auth.challenge"), nonce: Base64 }),
  /** `posse`: this device's possession generation on the server (see `auth.finish`). */
  z.object({ t: z.literal("auth.ok"), address: Address, posse: z.number().int().min(0).optional() }),

  z.object({
    t: z.literal("channel.event"),
    channel: z.string(),
    /** Per-channel monotonic counter. Gives total order without trusting clocks. */
    seq: z.number().int().nonnegative(),
    kind: EnvelopeKind,
    ciphertext: Base64,
    /**
     * Server receipt time, rounded to the minute. Full-precision timestamps are
     * a traffic-analysis gift and the client does not need them: real ordering
     * comes from `seq`, and the true send time is inside the ciphertext.
     */
    receivedAtMinute: z.number().int().nonnegative(),
    ref: z.string().optional(),
  }),

  z.object({
    t: z.literal("channel.backfill.page"),
    channel: z.string(),
    events: z.array(
      z.object({
        seq: z.number().int().nonnegative(),
        kind: EnvelopeKind,
        ciphertext: Base64,
        receivedAtMinute: z.number().int().nonnegative(),
      }),
    ),
    /** True when more remain past this page, so the client keeps asking. */
    more: z.boolean().default(false),
  }),

  /**
   * The response to a `keypackage.claim`. Always responds, with `null` when there is no package.
   *
   * `keyPackage` is the standard singular: the most recent one claimed. A 0.2.3 client reads
   * this and nothing else.
   *
   * `keyPackages` and `manifest` only come when the request brought `bundle: true`: one package
   * per device in the manifest (from the requests in `devices`, if they came) that had a package
   * to claim, each with the key of the device the server assigned it to, and the manifest as the
   * server stores it, for the inviter to verify (signature, and anti-rollback against the version
   * it already saw). Absence of a device from the list is not an error: it is the partial-failure
   * policy (those with packages enter, the rest repair via `seat`). When the bundle comes empty
   * and `keyPackage` does not, the singular is a package from an unknown device (published before
   * the server kept devices), and the inviter decides for it what it decides for the others:
   * the credential chain and the manifest. `manifest: null` means the account never published one.
   */
  z.object({
    t: z.literal("keypackage.claimed"),
    address: Address,
    keyPackage: Base64.nullable(),
    // No more than devices per account: a server sending more is trying to waste commits with
    // packages the manifest does not cover.
    keyPackages: z.array(z.object({ deviceKey: Base64, keyPackage: Base64 })).max(APARELHOS_POR_CONTA).optional(),
    manifest: DeviceManifestWire.nullable().optional(),
  }),
  z.object({ t: z.literal("keypackage.low"), remaining: z.number().int().nonnegative() }),

  z.object({
    t: z.literal("invite.created"),
    channel: z.string(),
    codeHash: Base64,
    /**
     * The short code for this invite, for the link `orwell.pt/c#<código>`. Only
     * from a server with `CAPACIDADE_LIGACOES_CURTAS`.
     */
    codigoCurto: CodigoCurto.optional(),
  }),
  z.object({
    t: z.literal("invite.list.result"),
    channel: z.string(),
    invites: z.array(
      z.object({
        codeHash: Base64,
        expiresAt: z.number().int().nullable(),
        maxUses: z.number().int().nullable(),
        uses: z.number().int().nonnegative(),
        /** The short code, if the invite has one (pre-1.0 ones do not). */
        codigoCurto: CodigoCurto.optional(),
      }),
    ),
  }),
  /**
   * Delivered to channel members: somebody redeemed a valid code.
   *
   * `codeHash` is echoed back so a member can check it against the codes it
   * personally minted. Without it, the server's word is the only evidence the
   * invite was legitimate — and the server accepts `invite.create` from anyone,
   * so its word is worth nothing here. A member must never commit a stranger
   * into a group on the strength of a request it cannot trace to its own act.
   */
  z.object({
    t: z.literal("invite.request"),
    channel: z.string(),
    address: Address,
    keyPackage: KeyPackageNoFio,
    codeHash: Base64,
  }),
  /**
   * `rate-limited` (INV-02): above the redemption caps (per account, per invite, per channel,
   * server-wide). No usage was spent. A 1.2.0 or older client does not know it and says "that
   * invite no longer exists"; it does not enter, as it would not anyway, and that phrase is the
   * only thing wrong.
   */
  z.object({ t: z.literal("invite.rejected"), reason: z.enum(["unknown", "expired", "exhausted", "rate-limited"]) }),

  /**
   * The short code resolved: the invite's channel and the `codeHash` you use to request entry
   * (`invite.redeem`). The server never had the invite code itself, and will not get it: the
   * `codeHash` is what the door asks.
   */
  z.object({
    t: z.literal("invite.resolved"),
    codigo: CodigoCurto,
    channel: z.string(),
    codeHash: Base64,
    /** The invite's seal, if whoever created it sent one (slice 5c). */
    selo: SeloDoConvite.optional(),
  }),
  /**
   * The response to `invite.selo`. No `selo` when the invite does not exist, is no longer
   * valid, or was created without a seal: for that question, all three give "a channel".
   */
  z.object({ t: z.literal("invite.selo.result"), codeHash: Base64, selo: SeloDoConvite.optional() }),
  /**
   * The short code opens nothing. `rate-limited` is the cap (per account or server-wide):
   * waiting a minute fixes it. The other three are from `invite.rejected`, for the same reason.
   */
  z.object({
    t: z.literal("invite.unresolved"),
    codigo: CodigoCurto,
    reason: z.enum(["unknown", "expired", "exhausted", "rate-limited"]),
  }),

  z.object({ t: z.literal("voice.signal"), channel: z.string(), payload: z.unknown() }),

  /**
   * Live presence: this address connected or disconnected.
   *
   * Sent only to people who share at least one channel with the subject —
   * never broadcast — and never persisted: the server relays the fact and
   * keeps no record of it. This is a deliberate, user-chosen widening of the
   * metadata the server handles (see docs/THREAT-MODEL.md): who is online is
   * now something the server tells your channel-mates, while you are online.
   */
  z.object({ t: z.literal("presence"), address: Address, online: z.boolean() }),

  /** Somebody in this channel lost their seat and is asking for a new one. */
  z.object({ t: z.literal("channel.rejoin"), channel: z.string(), address: Address }),

  /** Local accounts, in community mode. Empty when the mode is off. */
  z.object({ t: z.literal("directory.list.result"), addresses: z.array(Address) }),

  /**
   * ICE servers for a call, with a credential that expires in minutes.
   *
   * Empty when the operator has not configured a TURN server, in which case the
   * client falls back to a public STUN and calls only connect on forgiving
   * networks.
   */
  /**
   * Who was put in charge of creating the requested channel.
   *
   * `mine` is true for whoever won the race and therefore must create the group. Whoever loses
   * gets the winner's address and asks them for entry.
   *
   * `empty` says whether the channel is truly brand new. Without it, `mine` alone would tell
   * whoever has the claim recorded to create the group, including someone who meanwhile lost
   * their group state and therefore would create a SECOND MLS group with the same identifier,
   * leaving everyone inside deaf. It is the silent collision this room exists to solve, repeated
   * from the other side. Missing on a server older than this, and the client treats absence as
   * "I do not know, I do not create".
   */
  z.object({
    t: z.literal("channel.claim.result"),
    channel: z.string(),
    owner: z.string(),
    mine: z.boolean(),
    empty: z.boolean().optional(),
  }),

  /**
   * How many members heard an entry request.
   *
   * The request was a frame with no response: it went out, and whoever sent it never knew if it
   * reached anyone or no one. A request broadcast to zero connections was indistinguishable from
   * a request handled, and that indistinction made all the failure of this path silent, the
   * person saw "request sent" and stayed out with no hint anywhere.
   */
  z.object({ t: z.literal("channel.rejoin.sent"), channel: z.string(), ouviram: z.number().int().nonnegative() }),

  /**
   * The common room's entry card, or nothing if there is none.
   *
   * `info` absent is the honest answer to three situations the requester cannot tell apart and
   * does not need to: the room does not exist yet, the card was already taken by someone else,
   * or it was never placed there. In all cases the path is the same, and it is the old one:
   * ask members for entry and try again.
   */
  z.object({ t: z.literal("channel.groupinfo"), channel: z.string(), info: z.string().optional() }),

  /**
   * The server refused to forward what was sent to this channel.
   *
   * It exists because the refusal was silent. A client whose place the server no longer
   * recognizes, because storage was wiped, because the group diverged, because it never got
   * admitted, kept writing to the void, with everything looking fine on its side: the message
   * entered local history, the screen said yes, and nothing went out. Someone took control of
   * such a channel and spent ten minutes not knowing nobody had heard them.
   */
  z.object({
    t: z.literal("channel.rejected"),
    channel: z.string(),
    /**
     * `stale-epoch`: a commit for an epoch the channel has already left behind. The server
     * accepts ONE commit per epoch, the first to arrive, and refuses the others, because two
     * commits for the same epoch split the group in two branches that never read each other
     * (common room, 12/9/2026: epochs 12, 16 and 17 at the same time). The epoch travels in
     * clear in the MLS header; the server does not decrypt anything to read it.
     *
     * `stale-groupinfo`: an entry card from an epoch earlier than the channel's. Publishing it
     * would open another branch for the next arrival.
     *
     * `update-required`: reserved, and today the server does NOT send it, connections without
     * `commit-after-echo` are handled silently. See `hello.capabilities`.
     *
     * `rate-limited`: the account exceeded the send cap per minute. The send was NOT stored or
     * delivered; `retryAfterMs` says when there is room. Only to those who announced
     * `CAPACIDADE_ENVIO_RECUSADO`.
     */
    reason: z.enum(["no-seat", "stale-epoch", "stale-groupinfo", "update-required", "rate-limited"]),
    /** Echo of the rejected send's `ref`, so the sender knows which one it was. */
    ref: z.string().max(64).optional(),
    /** With `rate-limited`: how many ms until the cap lets another send through. */
    retryAfterMs: z.number().int().nonnegative().optional(),
    /** With `stale-epoch` and `stale-groupinfo`: the epoch the channel is at for the server. */
    epoch: z.number().int().nonnegative().optional(),
  }),

  z.object({
    t: z.literal("ice.servers.result"),
    servers: z
      .array(
        z.object({
          urls: z.array(z.string().max(256)).max(8),
          username: z.string().max(256).optional(),
          credential: z.string().max(256).optional(),
        }),
      )
      .max(8),
  }),

  /**
   * What the page declared about itself.
   *
   * `url` is the one that was requested, not the final one, because it is how the client
   * recognizes the response to the request it made, a redirect would change the key in the
   * middle. `ok: false` brings `reason` and nothing else: the refusal does not say whether the
   * address was private, did not resolve, or took too long, because the difference between those
   * responses is a map of the internal network drawn from outside.
   *
   * The image comes as bytes, not as an address. Sending the address would force the client to
   * fetch it from the site, which is exactly what this path exists to avoid, and what sets this
   * apart from a normal preview.
   */
  z.object({
    t: z.literal("link.preview.result"),
    url: z.string().max(2048),
    ok: z.boolean(),
    reason: z.string().max(200).optional(),
    finalUrl: z.string().max(2048).optional(),
    title: z.string().max(200).optional(),
    description: z.string().max(500).optional(),
    siteName: z.string().max(100).optional(),
    /** Data URL. The client shrinks it before publishing. */
    image: z.string().max(3_000_000).optional(),
  }),

  // ------------------------------------------------------------------ SFU

  /**
   * You entered the call: what is it speaking with, and who is already speaking.
   *
   * `producers` brings the streams that already existed. Without them, late arrivals would only
   * hear whoever spoke AFTER they did, the classic failure of joining a room and finding it
   * empty while everyone is talking.
   */
  z.object({
    t: z.literal("sfu.scope.joined"),
    channel: z.string(),
    scope: z.string(),
    /** `RtpCapabilities` of the router, for the client's `device.load()`. */
    rtpCapabilities: z.unknown(),
    producers: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(["audio", "video"]),
        /**
         * Who owns this stream.
         *
         * We send the ADDRESS, not the MLS sheet index, because the server does not
         * read the tree and will never know the index. The client already knows the
         * addresses of everyone on the call, they come in the encrypted roster from
         * `voice.join`, and it is the client's job to match address to sheet, which
         * is where the information lives.
         *
         * And we add nothing to what the server already knows: who is on a call with
         * whom is the cost we accept from this architecture, written out in detail in
         * section 5 of the plan and intended for the THREAT-MODEL in Phase 4.
         */
        address: Address,
        /**
         * Where the stream comes from, as the producer declared it.
         *
         * Echoed, not invented: the server does not look inside anything and has no
         * way to know if a video is a face or a monitor. Absent is what a Phase 2
         * producer had, there was only audio, and we read it from `kind`.
         */
        fonte: FonteDeMedia.optional(),
      }),
    ),
    ref: z.string().optional(),
  }),

  z.object({
    t: z.literal("sfu.transport.created"),
    transport: z.string(),
    direction: z.enum(["envio", "recepcao"]),
    iceParameters: z.unknown(),
    iceCandidates: z.unknown(),
    dtlsParameters: z.unknown(),
    ref: z.string().optional(),
  }),

  z.object({ t: z.literal("sfu.transport.connected"), transport: z.string(), ref: z.string().optional() }),
  z.object({ t: z.literal("sfu.produced"), producer: z.string(), ref: z.string().optional() }),
  /** O produtor fechou. Ver `sfu.produce.close`. */
  z.object({ t: z.literal("sfu.produce.closed"), producer: z.string(), ref: z.string().optional() }),

  z.object({
    t: z.literal("sfu.consumed"),
    consumer: z.string(),
    producer: z.string(),
    kind: z.enum(["audio", "video"]),
    rtpParameters: z.unknown(),
    ref: z.string().optional(),
  }),

  z.object({ t: z.literal("sfu.resumed"), consumer: z.string(), ref: z.string().optional() }),

  /** The response to `sfu.pause`: the server stopped forwarding that stream. */
  z.object({ t: z.literal("sfu.paused"), consumer: z.string(), ref: z.string().optional() }),

  /** Someone started talking on this call. Everyone already there will consume it. */
  z.object({
    t: z.literal("sfu.producer.new"),
    channel: z.string(),
    scope: z.string(),
    producer: z.string(),
    kind: z.enum(["audio", "video"]),
    address: Address,
    /** Microphone, camera, or screen, echoed from the producer. See `FonteDeMedia`. */
    fonte: FonteDeMedia.optional(),
  }),

  /** That stream ended, the person left, muted the mic, or the network dropped. */
  z.object({
    t: z.literal("sfu.producer.closed"),
    channel: z.string(),
    scope: z.string(),
    producer: z.string(),
  }),

  /**
   * A rejection from the media engine, with the physical reason spelled out.
   *
   * Its own frame, not the generic `error`, for two reasons that add up: the
   * `error` fatal closes the connection, and nothing here deserves closing one,    * a full call is no reason to tear down someone's chat; and the `ref` lets the
   * client link the rejection to the exact request that caused it, instead of
   * showing it loose on the screen.
   *
   * `message` is for reading, and states the PHYSICAL reason, "this call already
   * has sixteen people, which is what the server connection can handle", in the
   * same format that `LIMITE_DE_PARTILHA` already uses on the client. A rejection
   * that does not explain the physics is indistinguishable from a crash, and sends
   * the person retrying forever.
   */
  z.object({
    t: z.literal("sfu.error"),
    code: z.string().max(64),
    message: z.string().max(500),
    ref: z.string().optional(),
  }),

  /**
   * The device manifest for an account, or `null` if it never published one.
   *
   * As the server has it: it stores what the signature and version let it store,
   * and does not rewrite it. The receiver verifies it the same way
   * (`verifyDeviceManifest`) and compares the version with the last one it saw
   * from this account, because a server may serve an old manifest, before a
   * revocation, to someone who never saw the new one. It cannot serve one the
   * account did not sign.
   */
  z.object({ t: z.literal("manifest.result"), address: Address, manifest: DeviceManifestWire.nullable() }),

  /**
   * The verdict of a `manifest.publish`. One frame only, with `ok`, following the
   * pattern of `link.preview.result`: the client waits for one kind of response,
   * and two possible frames would be two waits where one hung.
   *
   * The reasons: those from `verifyDeviceManifest` (format, duplicate key, address
   * that is not the key digest, signature), plus two from the server. `not-yours`:
   * the manifest address is not the one on the connection, and an account does not
   * publish on behalf of another no matter how well signed. `stale-version`: the
   * version is not greater than the stored one, and the server never goes backward
   * or stays in place: republishing the same version is refused, so a race between
   * two devices of the same account has one winner, not two. `revoked-device`: the
   * manifest lists a device that an earlier manifest from the account already
   * removed; revoking is forever (see `CAPACIDADE_REVOGACAO`). A 0.5.7 client does
   * not validate server frames against the pattern, so the new value does not break it.
   */
  z.object({
    t: z.literal("manifest.published"),
    address: Address,
    version: z.number().int().positive(),
    ok: z.boolean(),
    reason: z
      .enum(["bad-shape", "duplicate-device", "key-mismatch", "bad-signature", "not-yours", "stale-version", "revoked-device"])
      .optional(),
  }),

  /** The vault is open and waiting for the second device. */
  z.object({ t: z.literal("pair.opened"), pairId: PairId }),
  /** The vault has both connections. It goes to both sides: the signal to exchange device keys. */
  z.object({ t: z.literal("pair.joined"), pairId: PairId }),
  /** A payload from the other side, exactly as is: the server did not open it. */
  z.object({ t: z.literal("pair.message"), pairId: PairId, payload: PairPayloadOpaco }),
  /**
   * The vault ended. `closed`: the other side closed it; `peer-left`: the other
   * side's connection dropped; `expired`: ten minutes passed; `intruder`: a third
   * connection tried to join, and because that means someone else has the secret,
   * the vault is burned for both.
   */
  z.object({
    t: z.literal("pair.closed"),
    pairId: PairId,
    reason: z.enum(["closed", "peer-left", "expired", "intruder"]),
  }),
  /** A `pair.open` or `pair.join` that did not happen. Never fatal: the person can try again. */
  z.object({
    t: z.literal("pair.rejected"),
    pairId: PairId,
    reason: z.enum(["exists", "unknown", "full", "rate-limited"]),
  }),

  /**
   * An ephemeral signal from another member of the channel. Only reaches connections
   * that announced `CAPACIDADE_SINAL_EFEMERO` in `hello`.
   *
   * `from`: the account that sent it, as the server authenticated it. Not the device:
   * the receiver knows the device from the signature inside `sinal`. `sinal`: the
   * bytes as they came, untouched.
   */
  z.object({
    t: z.literal("channel.sinal"),
    channel: z.string(),
    from: Address,
    sinal: Base64,
  }),

  /**
   * A `channel.sinal` the server did not forward. Only to the sender, and it is the
   * only response a signal gets.
   *
   * `code`: one of the keys from `CODIGOS_DE_RECUSA_DO_SINAL`. `message` states the
   * physical reason in English, for logs. `retryAfterMs`: with
   * `sinal-rate-limited` and `sinal-channel-busy`, how long until the bucket has
   * space. Without it, waiting does not help.
   *
   * Does not close the connection. Whoever keeps sending after repeated rejections
   * gets `error` `sinal-abuse`, fatal (see `TECTOS_DO_SINAL.recusasAteFechar`).
   */
  z.object({
    t: z.literal("channel.sinal.rejected"),
    channel: z.string(),
    code: z.enum(CODIGOS_DE_RECUSA_DO_SINAL),
    message: z.string().max(500),
    ref: z.string().max(64).optional(),
    retryAfterMs: z.number().int().nonnegative().optional(),
  }),

  z.object({ t: z.literal("error"), code: z.string(), message: z.string(), fatal: z.boolean().default(false) }),
  z.object({ t: z.literal("pong") }),
])
export type ServerFrame = z.infer<typeof ServerFrame>

export function parseClientFrame(raw: unknown): ClientFrame {
  return ClientFrame.parse(raw)
}

export function parseServerFrame(raw: unknown): ServerFrame {
  return ServerFrame.parse(raw)
}

// ------------------------------------------------- the encrypted vault (phase 3a)
//
// One block only, at the end of the file, on purpose: vault frames join the
// unions here below, and whoever adds frames to the other unions does not touch
// these lines. See `docs/planos/estado-cifrado-plano.md`, phase 3a.

/**
 * The capability that says "this server holds the encrypted vault" (`cofre.*`).
 *
 * Both directions, like `CAPACIDADE_SINAL_EFEMERO`: the server announces it in
 * `hello.ok`, and the client using it announces it in `hello`. Only a connection
 * that announced it receives frames `cofre.*` and only it can send them. A client
 * 1.0.x does not announce it, and never sees a frame it does not know (its schema would reject it).
 *
 * **What the server holds is ciphertext.** Each entry comes encrypted by the client
 * with a key the server does not have (K_canal or K_conta, phase 3b and 5), under
 * an opaque logical key (HMAC under the same key), and padded to multiples of
 * `COFRE_BALDE_BYTES`. The server stores, versions, applies caps and serves to
 * whoever has access. It makes no authority decisions: that is for the clients.
 */
export const CAPACIDADE_COFRE_CIFRADO = "cofre-cifrado"

/** The padding bucket: the contents of an entry always measure a multiple of this, in bytes. */
export const COFRE_BALDE_BYTES = 1024

/**
 * The cap of the PROTOCOL for entry contents, in bytes already decrypted from
 * base64. The operator can lower it (`TECTOS_DO_COFRE` on the server), never
 * raise it: the pattern refuses first.
 */
export const COFRE_ENTRADA_MAX_BYTES = 64 * 1024

/** The same cap in base64url characters without padding, as it travels. */
export const COFRE_CONTEUDO_MAX_CARACTERES = Math.ceil((COFRE_ENTRADA_MAX_BYTES * 4) / 3)

/** Entries per `cofre.put`. 64 entries of 64 KiB are 5.4 MiB of frame: below the 12 MiB gateway cap. */
export const COFRE_ENTRADAS_POR_TRAMA = 64

/**
 * The key of an entry: 22 base64url characters (16 bytes of an HMAC under the
 * vault key). Opaque on purpose: a logical name (`sala:geral`) never goes on the
 * wire. The pattern does not let any other form through.
 */
export const COFRE_CHAVE_PATTERN = /^[A-Za-z0-9_-]{22}$/

/**
 * A vault scope: `canal:<morada>` or `conta:<endereço>`. The server
 * stores and counts by scope, and by scope decides who reads and writes:
 * `canal:` whoever has access to the channel, `conta:` the account itself only.
 */
export const COFRE_ESCOPO_PATTERN = /^(canal|conta):[^\s]{1,255}$/

/**
 * The rejection codes for an entire `cofre.*` frame (`cofre.rejected`).
 * Keys are stable: a code never changes meaning or is reused.
 *
 * - `cofre-nao-anunciado`: the connection did not announce `CAPACIDADE_COFRE_CIFRADO`.
 * - `cofre-sem-lugar`: scope `canal:` of a channel where this account has no
 *   space, or scope `conta:` of a different account.
 * - `cofre-ritmo`: this account passed the cap for writes or reads per minute.
 *   `retryAfterMs` says when there is space.
 *
 * Whoever insists after repeated rejections gets `error` `cofre-abuso`, fatal.
 */
export const CODIGOS_DE_RECUSA_DO_COFRE = ["cofre-nao-anunciado", "cofre-sem-lugar", "cofre-ritmo"] as const
export type CodigoDeRecusaDoCofre = (typeof CODIGOS_DE_RECUSA_DO_COFRE)[number]

/** The code of the `error` fatal that closes whoever does not stop being rejected on the vault. */
export const CODIGO_COFRE_ABUSO = "cofre-abuso"

/**
 * The reasons for rejecting ONE entry, within a result that accepted or rejected
 * the others. Keys are stable.
 *
 * - `versao`: the `versaoEsperada` is not the current version (the CAS failed).
 *   Comes with `versao`, the current one (0 when the key does not exist).
 * - `tecto`: the entry passes the cap per entry, or does not fit in the scope
 *   (entries or bytes).
 * - `acolchoamento`: the contents do not measure a multiple of `COFRE_BALDE_BYTES`.
 * - `inexistente`: a `cofre.del` of a key that does not exist or is already a tombstone.
 * - `chave-de-escrita`: reserved for phase 3c (the write signed by the epoch key).
 *   The phase 3a server never uses it.
 */
export const RAZOES_DE_RECUSA_DA_ENTRADA = ["versao", "tecto", "acolchoamento", "inexistente", "chave-de-escrita"] as const
export type RazaoDeRecusaDaEntrada = (typeof RAZOES_DE_RECUSA_DA_ENTRADA)[number]

const EscopoDoCofre = z.string().max(262).regex(COFRE_ESCOPO_PATTERN, "expected canal:<morada> or conta:<endereço>")
const ChaveDoCofre = z.string().regex(COFRE_CHAVE_PATTERN, "expected a 22-char base64url key")
const VersaoDoCofre = z.number().int().nonnegative()
const RefDoCofre = z.string().max(64).optional()

/** The `cofre.*` frames from the client. Only from a connection that announced the capability. */
const TramasDoCofreDoCliente = [
  /**
   * Write entries to a vault.
   *
   * `versaoEsperada`: CAS. Absent, always writes. Present, writes only if the
   * current version of the key is this one (0 = the key does not exist). Each
   * accepted entry gets a new version of the scope; rejected ones change nothing.
   * Response: `cofre.put.result`. Rejection of the entire frame: `cofre.rejected`.
   */
  z.object({
    t: z.literal("cofre.put"),
    escopo: EscopoDoCofre,
    entradas: z
      .array(
        z.object({
          chave: ChaveDoCofre,
          conteudo: Base64.min(1).max(COFRE_CONTEUDO_MAX_CARACTERES),
          versaoEsperada: VersaoDoCofre.optional(),
        }),
      )
      .min(1)
      .max(COFRE_ENTRADAS_POR_TRAMA),
    ref: RefDoCofre,
  }),

  /**
   * Read what changed in a vault since a version. `desdeVersao: 0` is everything.
   * Response: `cofre.entradas`, in pages (`mais`).
   */
  z.object({ t: z.literal("cofre.get"), escopo: EscopoDoCofre, desdeVersao: VersaoDoCofre, ref: RefDoCofre }),

  /**
   * Delete an entry. It becomes a tombstone with a version, so the reader by delta
   * knows it left. `versaoEsperada` as in `cofre.put`.
   * Response: `cofre.del.result`.
   */
  z.object({
    t: z.literal("cofre.del"),
    escopo: EscopoDoCofre,
    chave: ChaveDoCofre,
    versaoEsperada: VersaoDoCofre.optional(),
    ref: RefDoCofre,
  }),
] as const

/** The `cofre.*` frames from the server. Only to connections that announced the capability. */
const TramasDoCofreDoServidor = [
  /** The result of a `cofre.put`: the accepted ones with the new version, the rejected with the reason. */
  z.object({
    t: z.literal("cofre.put.result"),
    escopo: z.string(),
    aceites: z.array(z.object({ chave: z.string(), versao: VersaoDoCofre })),
    recusadas: z.array(
      z.object({ chave: z.string(), razao: z.enum(RAZOES_DE_RECUSA_DA_ENTRADA), versao: VersaoDoCofre.optional() }),
    ),
    versaoGlobal: VersaoDoCofre,
    ref: RefDoCofre,
  }),

  /**
   * A page of what changed in a vault.
   *
   * `completo`: this read is the entire vault, not a delta (asked for since 0, or
   * since a version before tombstones the server already pruned). The receiver
   * joins the pages and replaces what it had: what does not come no longer exists.
   * `ate`: the highest version this page covers; with `mais`, the next page asks
   * with `desdeVersao: ate`. Without `mais`, `ate` is the `versaoGlobal`.
   */
  z.object({
    t: z.literal("cofre.entradas"),
    escopo: z.string(),
    versaoGlobal: VersaoDoCofre,
    completo: z.boolean(),
    ate: VersaoDoCofre,
    mais: z.boolean(),
    entradas: z.array(z.object({ chave: z.string(), versao: VersaoDoCofre, conteudo: Base64 })),
    lapides: z.array(z.object({ chave: z.string(), versao: VersaoDoCofre })),
    ref: RefDoCofre,
  }),

  /** The result of a `cofre.del`: the version of the tombstone, or the reason for rejection. */
  z.object({
    t: z.literal("cofre.del.result"),
    escopo: z.string(),
    chave: z.string(),
    versao: VersaoDoCofre.optional(),
    razao: z.enum(RAZOES_DE_RECUSA_DA_ENTRADA).optional(),
    versaoGlobal: VersaoDoCofre,
    ref: RefDoCofre,
  }),

  /**
   * The versions of the vaults that matter to this connection: after `auth.ok`
   * (the one for the account itself), after each `channel.subscribe` (those for
   * subscribed channels), and when another connection writes to one of them. Only
   * the scopes that have a vault; a missing scope is at version 0. The client asks
   * `cofre.get` only when the version went up: the read aligns with what the
   * server already knows and does not teach it an extra request.
   */
  z.object({
    t: z.literal("cofre.versoes"),
    cofres: z.array(z.object({ escopo: z.string(), versaoGlobal: VersaoDoCofre })),
  }),

  /** An entire `cofre.*` frame rejected. Never fatal on first. See `CODIGOS_DE_RECUSA_DO_COFRE`. */
  z.object({
    t: z.literal("cofre.rejected"),
    escopo: z.string(),
    code: z.enum(CODIGOS_DE_RECUSA_DO_COFRE),
    message: z.string().max(500),
    ref: RefDoCofre,
    retryAfterMs: z.number().int().nonnegative().optional(),
  }),
] as const

export const ClientFrame = z.discriminatedUnion("t", [...TramasDoClienteSemCofre.options, ...TramasDoCofreDoCliente])
export const ServerFrame = z.discriminatedUnion("t", [...TramasDoServidorSemCofre.options, ...TramasDoCofreDoServidor])

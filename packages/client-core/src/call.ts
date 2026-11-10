import {
  ambitoDaChamada,
  PESSOAS_COM_ECRA,
  SALA_DA_PERGUNTA,
  TECTO_DA_MUSICA,
  TECTO_DO_AVER,
  TECTO_DO_NOME_DA_MUSICA,
  TECTO_DO_SOM_DO_ECRA,
  type FonteDeMedia,
  type FonteDoFluxo,
  type Payload,
  type UserAddress,
} from "@enclave/protocol"
import {
  ehCifraDoEmissorEmFalta,
  limiteDoRelatorio,
  MotorSfu,
  RECUSA_DO_SFU_GENERICA,
  type DispositivoDeMedia,
  type LimiteDeVideo,
  type SinalizacaoSfu,
} from "./call-sfu.js"
import { ControloDeVoz, type EstadoDoAudio } from "./audio/controlo.js"
import { VigiaDoMicrofone, type MorteDoMicrofone, type SaudeDoMicrofone } from "./audio/vigia-do-microfone.js"
import { Emitter } from "./emitter.js"
import { chaveDoErroDoBrowser } from "./erros-do-browser.js"
import { CifraDeMedia, cifraDeMediaEmFalta, type MaterialDeChave } from "./media-sframe.js"

/**
 * A refusal or failure mid-call, stated as an `error` event.
 *
 * An SFU refusal already brings the key (see `RecusaDoSfu`) and the code in `cause`.
 * A browser error gets its own key (see `erros-do-browser.ts`). The rest
 * gets the `recurso` key, which says the step that failed, with the raw message
 * in `cause`. Without `recurso` it goes raw, and the interface shows it with "Error 900"
 * and the message below, so it can be reported.
 *
 * Exported because the bridges (web and Electron) catch call failures that
 * happen outside it, and have to state them the same way.
 */
export function erroDaChamada(
  erro: unknown,
  recurso?: string,
): { detail: string; cause?: Readonly<Record<string, unknown>> } {
  // The server refusal and ours (448) state themselves as they are: the key is the message.
  if (ehRecusaDoSfu(erro) || ehCifraDoEmissorEmFalta(erro)) {
    return { detail: erro.message, ...(causaSimples(erro.cause) ? { cause: erro.cause } : {}) }
  }
  const chave = chaveDoErroDoBrowser(erro)
  const mensagem = String((erro as Error)?.message ?? erro)
  if (chave !== null) return { detail: chave, cause: { nome: String((erro as Error)?.name ?? ""), mensagem } }
  return recurso === undefined ? { detail: mensagem } : { detail: recurso, cause: { detalhe: mensagem } }
}

/**
 * Is it an SFU refusal? By `name`, not by `instanceof`.
 *
 * In the desktop app the session lives in the main process, and the refusal
 * reaches the renderer remade by the IPC envelope: an `Error` with the same name,
 * the same key and the same `cause`, but without the class.
 */
function ehRecusaDoSfu(erro: unknown): erro is Error {
  return erro instanceof Error && erro.name === "RecusaDoSfu"
}

function causaSimples(causa: unknown): causa is Readonly<Record<string, unknown>> {
  return typeof causa === "object" && causa !== null && !Array.isArray(causa) && !(causa instanceof Error)
}

/**
 * Voice and video, as a full mesh between participants.
 *
 * No SFU. For the sizes a channel call actually reaches — a handful of people —
 * a mesh needs no server at all, and media travels directly between peers
 * instead of through a box that could be compelled to keep it. The cost is
 * upload bandwidth: each participant sends their stream once per peer, so this
 * degrades past roughly six people. An SFU is the answer beyond that, and
 * SFrame below is what makes introducing one safe when the time comes.
 *
 * Signalling rides inside MLS application messages, so the homeserver never
 * learns who is in a call with whom — only that members of a channel it already
 * knows about exchanged some ciphertext.
 */

export interface Participant {
  address: UserAddress
  stream: MediaStream | null
  /** True once ICE has actually connected, not merely been negotiated. */
  connected: boolean
  video: boolean
  /** False when the platform could not apply SFrame. See `mediaIsE2EE`. */
  encrypted: boolean
  /**
   * This person's microphone is muted, as far as they told us.
   *
   * Do not confuse with the `muted` of a `<video>` element, which is the opposite
   * of this seen from our side: that is our decision not to hear someone,
   * this is their decision not to speak. So the interface that draws it
   * calls it `micCalado`, two identical names for two opposite things in the same
   * component is how you swap one for the other.
   *
   * `false` until they tell us otherwise. An old client never sends the
   * field, and in that case there is no mark on screen: saying "they are speaking"
   * would be making it up, and the mark only appears for what was actually
   * said.
   */
  micMuted: boolean
  /**
   * The screen this person is sharing, or nothing.
   *
   * `null` covers two cases the interface does not need to tell apart: not
   * sharing, and sharing but the image has not arrived yet.
   *
   * **Only different from `null` while they SAY they are sharing.** The
   * screen slot is reserved on all connections, with or without sharing (see
   * `#buildPeer`), so a stream always arrives at that position, silent and
   * empty. Drawing the stream instead of the declaration would put a black rectangle
   * on everyone's screen for the entire call. See `screen` in the protocol.
   *
   * **And it is `null` also while we have not REQUESTED it.** See `ecraOferecido`.
   */
  screen: MediaStream | null
  /**
   * This person is sharing a screen, whether we asked to see it or not.
   *
   * Request from the owner on October 5, 2026: when someone shares the screen, others
   * should enter the stream only if they want to. The declaration and the stream
   * were the same question for whoever draws; they are now two, because there is a state
   * in between, offered and not accepted.
   *
   * `ecraOferecido && screen === null` is the pending offer: it is the bar with
   * "is sharing the screen" and the "Watch" button. With stream, it is the stage.
   */
  ecraOferecido: boolean
  /**
   * This person is viewing our screen, as far as they told us.
   *
   * The symmetric hole of the request, and the same piece: the sharer did not know who
   * was viewing. Each person's client says in the announcement who is viewing
   * the screen (`aVer`, in `voice.join`), and that is what we read here.
   *
   * `false` until they say otherwise, like `micMuted`: an old client
   * never sends the field, and in that case we assert nothing.
   */
  aVerONossoEcra: boolean
  /**
   * This person says they are viewing the screen of (the `aVer` in their roster).
   *
   * For the sharer's card to count who is viewing (the eye next to the
   * "LIVE" badge, owner, 2 November 2026), and not just who sees OURS.
   * It is the same field that already travels in each person's `voice.join`: the server
   * did not change. Optional because test doubles do not bring it; absent, they said
   * nothing.
   */
  aVer?: readonly string[] | undefined
  /**
   * The music this person is playing in the call, or nothing. Phase 9.
   *
   * Apart from `stream` for the listener to give it its own volume, separate from
   * voice (it is music, not their voice). On the mesh the music slot exists
   * always between two new clients, and so the stream only shows while
   * they SAY they are playing (`aTocar`), like the screen.
   *
   * Optional, and absent reads as `null`: the `Call` always writes it, and
   * the existing participant doubles (tests, the dock) stay valid.
   */
  musica?: MediaStream | null
  /** The name of what they are playing, as they said it. See `aTocar` in the protocol. */
  aTocar?: string | null
}

/**
 * OUR music in the call: what is playing, or nothing.
 *
 * `null` is not sharing music. `aTocar: null` is sharing and
 * paused (the producer is standing; silence does not waste bandwidth, by DTX).
 */
export type EstadoDaMusica = { aTocar: string | null } | null

export type CallEvents = {
  participants: { participants: Participant[] }
  local: { stream: MediaStream | null }
  /**
   * OUR screen, when it starts and when it ends.
   *
   * Separate from `local` because they are two captures with different lifespans: the
   * camera and microphone are born and die with the call, and the screen enters and leaves
   * as many times as you want. Sent as `null` when sharing ends,
   * including when the one ending it is the browser's own button and not the
   * app-see `#ecra` and the track's `onended`.
   */
  screen: { stream: MediaStream | null }
  /**
   * OUR screen sound: going out, muted, or none.
   *
   * The "Sharing system sound" signal and the "Mute screen sound" gesture
   * read it. See `somDoEcra` and `setSomDoEcraCalado`.
   */
  "screen-sound": { estado: EstadoDoSomDoEcra }
  /** OUR music: started, changed name, went silent, or ended. */
  music: { estado: EstadoDaMusica }
  ended: { channel: string }
  /**
   * A call error for the screen.
   *
   * `detail` is a KEY from the interface's error catalog (`codigosDeErro.ts`),
   * in English and with no data inside; the data (how many people, the name of the
   * browser error, the raw message) goes in `cause`. A sentence built here, in
   * Portuguese with numbers, would reach the screen as "Error 900".
   */
  error: { detail: string; cause?: Readonly<Record<string, unknown>> | undefined }
  /**
   * Call mechanics, for local diagnostics logging.
   *
   * A call that does not connect is indistinguishable, from outside, from a call
   * that connects and brings no media, from one that never negotiated, and from one that
   * negotiated with someone who already left. Without this the only information that
   * arrived was "appears to be connecting and disappears", and the difference between
   * those causes is the difference between completely different fixes.
   *
   * Mechanics only: states, candidate types, counts. Never IP addresses,
   * never SDP, never anything decrypted.
   */
  diagnostic: { code: string; detail?: string | undefined }
  /**
   * This account just moved voice rooms by someone with that
   * responsibility.
   *
   * It exists so the interface can say so. A call that changes under the feet
   * of someone speaking, with no signal at all, is the same as a failure-
   * and since this is convention and not cryptography, whoever moved has a right to
   * know who asked and where to.
   */
  moved: { channel: string; room: string; by: string }
  /**
   * This account just got disconnected from the call by someone with `move`
   * ("Disconnect from call", like in Discord). The `ended` still goes out; this is
   * for the interface to say who did it.
   */
  desligado: { channel: string; by: string }
  /**
   * The voice chain changed: profile, stages, strength, preview, or who is
   * suppressing noise. See `Call.audio` and `audio/controlo.ts`.
   */
  audio: EstadoDoAudio
}

/**
 * Everything the call layer needs from the outside world.
 *
 * Deliberately not the `Session` itself. WebRTC only exists where there is a
 * DOM, which on desktop is the renderer — the one process we keep the identity
 * key out of. Talking through this interface lets the same call code run in the
 * browser (backed directly by a Session) and in Electron (backed by IPC to the
 * main process), without the renderer ever needing more than per-epoch media
 * keys.
 */
export interface CallBridge {
  readonly selfAddress: UserAddress
  /** Send a `voice.*` payload into the channel, encrypted like any message. */
  sendSignal(channel: string, payload: Payload): Promise<void>
  /**
   * Media key material for one participant in the channel's current epoch, or
   * null when they are not a member.
   *
   * `folha` picks that person's device (the `senderId` of the frame). See
   * `Session.mediaKey`: the key is per device since 1.0.6, so two devices
   * of the same account never repeat nonces.
   */
  mediaKey(channel: string, address: UserAddress, folha?: number): Promise<MediaKeyMaterial | null>
  /**
   * Where this device can start counting frames with this key.
   *
   * Reserves a block and returns its start, saving the end somewhere it survives
   * the next launch. Without this, a sender built after the app
   * closed would restart at zero with the SAME key-the epoch and device index
   * do not change when a window closes-and would repeat all nonces from the
   * previous call. See `SframeSender` and `sframeReservas` in the vault.
   */
  reservarContadorSframe(channel: string, keyId: number): Promise<number>
  /**
   * How to build the worker where media cipher runs, when the host knows how.
   *
   * It is what opens the SFU to Firefox and Safari. Neither has
   * `createEncodedStreams`; both have `RTCRtpScriptTransform`, which does the same
   * work on another thread-and another thread needs a file that only the
   * host's packager knows how to make. A host that leaves it out still ciphers
   * by insertable streams if the engine has them, and falls back to mesh if it has
   * neither one nor the other. See `cifraDeMediaEmFalta`.
   */
  criarWorkerDeCifra?(): Worker
  /**
   * Can this host give the SCREEN SOUND?
   *
   * In the browser the answer is from the system picker: it has the checkbox "Share
   * audio from tab" (or "from system", on Windows), and a share without sound is
   * the person's choice. So absent means "yes, the browser decides".
   *
   * In Electron the picker is ours and has no checkbox: system sound
   * comes when the operating system gives it (Windows always; macOS 14.2 or later,
   * with permission), and it does not come elsewhere. `false` makes the call
   * tell the person that sharing will be silent, instead of letting them discover it
   * from others. See `apps/client/src/main/ecra.ts`.
   */
  somDoEcraDisponivel?(): boolean | Promise<boolean>
  /**
   * Tell the host a call is starting or ending, *before* media is requested.
   *
   * Electron denies microphone and camera by default and only opens them while
   * a call is live. Without this hook the gate can only be raised once media has
   * already been obtained — which is a deadlock, because obtaining it is the
   * thing the gate is blocking. Hosts with no permission model may omit it.
   */
  setMediaActive?(active: boolean): Promise<void>
  /**
   * Is this room the channel's AFK room? (2/11/2026)
   *
   * Asked on each entry, like `suportaSfu`: the mark lives in
   * `channel.meta`, which belongs to the session, and changes without the call knowing. In the AFK room the
   * call is presence only: no microphone, no SFU, no negotiation, no screen and
   * no music. Absent means "never AFK", which is what an old host does.
   * See `#entrarSemVoz`.
   */
  salaAfk?(channel: string, room: string): boolean | Promise<boolean>
  /**
   * STUN and TURN servers for this call, from our own homeserver.
   *
   * Credentials are minted per session and expire in minutes, so the shared TURN
   * secret never leaves the server. Hosts that cannot ask (or servers that offer
   * nothing) fall back to a public STUN, which works on forgiving networks and
   * fails on symmetric NAT — see `FALLBACK_ICE_SERVERS`.
   */
  iceServers?(): Promise<RTCIceServer[]>
  /**
   * The path to the SFU of this server, when it has one.
   *
   * **Absent is the mesh**, without exception, and that is what makes a new client
   * against an old server behave exactly like the old client:
   * the same peer-to-peer negotiation, line by line. It is the rule of the device chain restart-server first, client after-and it is what
   * lets us put this live without anyone out there noticing.
   *
   * The question is asked at `join` time, not at bridge building, and the
   * reason is written in `apps/web/src/bridge.ts`: the capability only has
   * an answer after `hello.ok`, and the bridge is set up before there is a connection.
   * Reading the capability then always gave "no".
   */
  sfu?: SinalizacaoSfu & {
    /**
     * Does this server announce the `sfu` capability? See `Session.suportaSfu`.
     *
     * **It may respond with a promise, and it is because of the installed app.**
     * In the browser the session is in the same process and the answer is immediate; in
     * Electron it lives in the main process, on the other side of the IPC, and there is no
     * synchronous read that reaches it. There were two ways out: a mirror on the
     * renderer, updated by notice-which goes stale exactly in the window that
     * this getter exists to catch, the server reversal one, and it is born false
     * again on every renderer reload with the session already connected-or ask
     * for real at the moment of decision. It is the second, and it is what forces the `await` on
     * the side of the one asking.
     */
    suportaSfu(): boolean | Promise<boolean>
    /** The `mediasoup-client` of the host. Injected because only the host has it. */
    criarDispositivo(): DispositivoDeMedia
  }
}

/**
 * The material of a media key.
 *
 * The public name stays here-it is what the bridges import-and the form moved
 * to live with the cipher, in `media-sframe.ts`, when it left this file. An
 * alias, not a second declaration: two equal forms written in two places
 * diverge the day someone adds a field to one of them.
 */
export type MediaKeyMaterial = MaterialDeChave

/**
 * Does the MESH cipher media frames in this engine. It does not answer for the SFU.
 *
 * Insertable streams are non-standard but exist in Chromium, which covers
 * Electron and the browser where this product lives. Where they are missing, the mesh call
 * still runs, protected by hop-by-hop DTLS-SRTP-which in a mesh is
 * truly end-to-end, because there are no hops in between. That is why
 * the mesh is happy with this question: the answer changes what the mesh does
 * (`encodedInsertableStreams` in the constructor, `sframe:` in `voice.join`), and nothing
 * else.
 *
 * **What this does NOT answer, and the distinction cost a lie on the screen.** The
 * SFU path is not decided here: it is decided in `cifraDeMediaEmFalta`, which
 * knows TWO paths-this one, and the `RTCRtpScriptTransform` that Firefox and
 * WebKit have and which was measured on 18 August 2026, frame by frame. A
 * Firefox with SFU ciphers everything and this function answers `false`. For months the
 * call card footer read this function and wrote over it: *"in this
 * environment the extra cipher layer is not possible"*. Anyone wanting to know what
 * a CALL is doing does not ask a module capability: they ask the streams, which bring
 * `encrypted` per person. See `notaDaChamada`, in
 * the interface.
 */
export function mediaIsE2EE(): boolean {
  return typeof RTCRtpSender !== "undefined" && "createEncodedStreams" in RTCRtpSender.prototype
}

/** Evaluated once: it depends on the engine, not on any call. */
const mediaE2EE = mediaIsE2EE()

interface Peer {
  connection: RTCPeerConnection
  stream: MediaStream | null
  connected: boolean
  video: boolean
  encrypted: boolean
  /** Whether this peer's engine can do SFrame. Advertised in `voice.join`. */
  supportsSframe: boolean
  /**
   * The screen that arrived in the reserved slot, whether or not it is being shown.
   *
   * Saved even while the peer declares no sharing: the track arrives
   * the instant the connection settles, long before there is an image in it, and
   * throwing it away forced waiting for a renegotiation that does not exist. Who
   * decides if this is seen is `screen` in their announcement. See `Participant.screen`.
   */
  screen: MediaStream | null
  /**
   * The sender of the screen slot, and the endpoint where sharing comes in.
   *
   * `replaceTrack` on this sender does not generate new SDP and does not touch the state
   * machine: that is it, and only that, which lets you share the screen in this
   * repository without opening renegotiation. See `#reservarLugarDoEcra`.
   */
  ecra: RTCRtpSender | null
  /**
   * The transceiver of that slot, to recognize what comes through it.
   *
   * `msid` identification does not work alone: a track put by
   * `replaceTrack` travels WITHOUT `msid`, and on the other side `event.streams` arrives
   * empty. Position is what is left, and it is exact between two clients of this
   * version because both reserve the slot before everything else.
   */
  ecraTransceiver: RTCRtpTransceiver | null
  /**
   * The sender of the screen sound slot, or nothing.
   *
   * An audio m-line extra, only between two clients that said `ecraSom`.
   * The offerer creates it AFTER the local tracks (otherwise the
   * microphone's `addTrack` would find it empty and voice would go through it); the answerer adopts the
   * transceiver that the offer created. See `#reservarLugarDoSom` and
   * `#adoptarLugaresDoOutro`.
   */
  ecraSom: RTCRtpSender | null
  ecraSomTransceiver: RTCRtpTransceiver | null
  /** The screen sound from this peer, saved until the image arrives. */
  somDoEcra: MediaStreamTrack | null
  /**
   * The sender of the MUSIC slot, or nothing. Phase 9.
   *
   * Another audio m-line, only between two clients that said `musica` and
   * `ecraSom`. Reserved BEFORE the screen sound slot, so the screen sound
   * stays the last audio m-line (that is how a 0.8 client
   * recognizes it). Music is the second-to-last. See `midDaMusica`.
   */
  musica: RTCRtpSender | null
  musicaTransceiver: RTCRtpTransceiver | null
  /** The music arriving from this peer, through its slot. */
  musicaQueChega: MediaStream | null
}

/**
 * Fallback only, for local development against a server that offers nothing.
 *
 * A public STUN server is a third party told the IP address and the exact moment
 * of every call, by a product whose whole argument is that no third party learns
 * anything. In production the homeserver hands out its own STUN and TURN over the
 * authenticated gateway — see `CallBridge.iceServers`. Google's is what remains
 * when there is no server to ask, and it is a development convenience, not a
 * design choice.
 */
const FALLBACK_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }]

/**
 * How often to ask for ICE servers again.
 *
 * Half the server's `ENCLAVE_TURN_TTL` (600 s), so that no connection
 * is ever born with a credential at the end of its validity.
 */
const ICE_REFRESH_MS = 300_000

/**
 * How long a peer may sit in "connecting" before we say so.
 *
 * Long enough for a slow mobile handover, short enough that a call which will
 * never traverse does not pretend to be trying.
 */
const CONNECT_TIMEOUT_MS = 25_000

/**
 * How long an announcement heard before we enter stays valid.
 *
 * Short on purpose. This exists for one case only: two people entering the
 * same call nearly at the same time, where one announces while the other
 * has not yet entered. That distance is measured in seconds.
 *
 * It used to be ten minutes, on the excuse that an old announcement did no harm
 * because the connection would die in timeout. It does: offering to someone who left
 * puts a "connecting" card on screen that lasts 25 seconds and disappears with an error, for
 * a person nobody invited. It was reported as a failure countless times.
 */
const HEARD_WINDOW_MS = 45_000

/**
 * How often someone in a voice room reaffirms that they are there.
 *
 * Exported because it has a twin right below: `PRESENCA_VALIDA_MS` is the
 * window in which a presence still counts, and it is DERIVED from this number instead
 * of written by hand. The bug of 18 August 2026 was exactly one of
 * these two halves asserting things about the other with no link between
 * them: the window said, in a comment, that "someone in a call reannounces
 * every five seconds", and there was no beat to meet it.
 *
 * **The number is a trade-off with the server's disk.** A `voice.join` is a
 * message ciphered like the others: the server keeps it for the whole retention-thirty days, today-without being able to know it is disposable. At the rate of
 * negotiation, five seconds, an afternoon of talk was thousands of records
 * per person. This way it is seventy-two per hour, and that is what you pay so the
 * sidebar of someone outside can tell the truth.
 */
export const PRESENCA_REAFIRMADA_MS = 50_000

/**
 * Until when a reaffirmed presence still counts.
 *
 * **It lived in `packages/ui/src/lib/presenca.ts`, and moved here because
 * it got two readers.** The screen uses it for the sidebar-who is in each voice room, seen from outside; the core uses it for the roster INSIDE the
 * call, which expires by the same measure (`#varrerRoster`). The `ui` imports
 * `client-core` and not the other way, so the home of the constant could only be
 * here; `presenca.ts` reexports it so anyone reading it from there stays reading it
 * from there. It is the shortest path for both halves to expire by the SAME
 * number instead of by two similar numbers-which is the failure that the comment
 * on `PRESENCA_REAFIRMADA_MS` tells.
 *
 * Three beats, not one: a bad network can eat two in a row without erasing from
 * the screen someone who is really in a call. Intentionally long, because what
 * removes someone from there is not this clock-it is the `voice.leave` from whoever
 * says goodbye and the server's presence notice for whoever disconnected without saying
 * goodbye (`desligouSeDoServidor`), both immediate. This is just the safety net
 * for the case where neither arrived.
 */
export const PRESENCA_VALIDA_MS = PRESENCA_REAFIRMADA_MS * 3 + 10_000

/**
 * This frame is the question "who is in the room?", not a goodbye.
 *
 * A function, not a `payload.quemEsta === true` written in four places: whoever
 * asks it must be recognized by the core (to answer) and by both
 * bridges (to NOT count it as anyone's departure on the screen's presence map), and
 * four copies of a condition this heavy are three too many. See
 * `quemEsta` in `voice.leave`, in the protocol, for why a field and not a `t`.
 */
export function ehPerguntaDePresenca(payload: Payload): boolean {
  return payload.t === "voice.leave" && payload.quemEsta === true
}

/**
 * Maximum uplink budget for screen sharing.
 *
 * The mesh is peer-to-peer: the sharer sends the image once PER PERSON. At five
 * peers, a screen at 2.5 Mbps is 12.5 Mbps uplink, which exceeds what the vast
 * majority of home connections in Portugal can provide. And when the link cannot
 * handle it, there is no warning: the entire call chokes, audio included,
 * because the outgoing queue is shared.
 *
 * Five megabits is chosen to fit on a typical home connection with call audio
 * still intact. Divided among peers, with a cap and floor.
 */
const ORCAMENTO_DE_SUBIDA = 5_000_000

/** Above this, you gain no visible sharpness on a shared screen. */
const TECTO_DO_ECRA = 2_500_000

/**
 * Below this, text becomes unreadable, and an unreadable screen is not sharing.
 *
 * Better to keep a lower quality than keep dividing: with many people, it is
 * better for the image to run at a frame rate the network cannot sustain and
 * the codec to drop frames than to deliver a gray blur to everyone. The
 * participant cap exists precisely to prevent this case.
 */
const PISO_DO_ECRA = 300_000

/**
 * The uplink cap for screen, based on how many peers will receive it.
 *
 * Exported so it can be measured: the math is the entire justification for the
 * participant cap, and a calculation that only exists inside a private method
 * cannot be verified without staging a call.
 */
export function tectoDoEcra(pares: number, comSom = false): number {
  /*
    Screen audio counts WITHIN the cap, not on top of it: with audio, the image
    drops by the audio's 64 kbps. What each peer receives from screen (image and
    audio) still fits in the same uplink calculation. The floor stays the floor:
    below it, text is unreadable, with or without audio.
  */
  const som = comSom ? TECTO_DO_SOM_DO_ECRA : 0
  if (pares <= 0) return TECTO_DO_ECRA - som
  const base = Math.min(TECTO_DO_ECRA, Math.round(ORCAMENTO_DE_SUBIDA / pares))
  return Math.max(PISO_DO_ECRA, base - som)
}

/**
 * The m-lines of an SDP description, in order: the type and `mid` of each.
 *
 * Parsed by hand, not by a library: two lines per section (`m=` and `a=mid:`),
 * and a dependency for this would outweigh the code.
 */
function linhasDeMedia(sdp: string | undefined): { tipo: string; mid: string | null }[] {
  if (!sdp) return []
  const linhas: { tipo: string; mid: string | null }[] = []
  for (const linha of sdp.split(/\r?\n/)) {
    if (linha.startsWith("m=")) linhas.push({ tipo: linha.slice(2).split(" ")[0] ?? "", mid: null })
    else if (linha.startsWith("a=mid:") && linhas.length > 0) linhas[linhas.length - 1]!.mid = linha.slice(6).trim()
  }
  return linhas
}

/**
 * The `mid` of the screen slot: the first m-line, when it is video.
 *
 * All versions reserve the screen slot BEFORE any other track (see
 * `#buildPeer`), so in any offer from this system it is first.
 */
export function primeiroMidDeVideo(sdp: string | undefined): string | null {
  const primeiro = linhasDeMedia(sdp)[0]
  return primeiro?.tipo === "video" ? primeiro.mid : null
}

/**
 * The `mid` of the screen audio slot: the last audio m-line, when there are two
 * or more (the first is always the microphone). See `#reservarLugarDoSom`.
 */
export function ultimoMidDeAudio(sdp: string | undefined): string | null {
  const audios = linhasDeMedia(sdp).filter((linha) => linha.tipo === "audio")
  return audios.length >= 2 ? (audios[audios.length - 1]?.mid ?? null) : null
}

/**
 * The `mid` of the MUSIC slot: the second-to-last audio m-line, when there are
 * three or more (microphone, music, screen audio). See `#reservarLugarDaMusica`.
 */
export function midDaMusica(sdp: string | undefined): string | null {
  const audios = linhasDeMedia(sdp).filter((linha) => linha.tipo === "audio")
  return audios.length >= 3 ? (audios[audios.length - 2]?.mid ?? null) : null
}

/**
 * The same SDP description, with `usedtx=1` in all Opus codecs (Phase M1).
 *
 * **Measured November 2, 2026** (`scripts/e2e-limiar-microfone.mjs`): over SFU,
 * `usedtx=1` comes from the router and producer `codecOptions`; in mesh, nobody
 * asked for it, and the negotiated fmtp was only `minptime=10;useinbandfec=1`.
 * Opus was encoding silence all the time: 50 packets per second, 23.6 kbps, on
 * each peer-to-peer link. Chrome turns on the encoder's DTX when the OTHER side's
 * description asks for it, so each side writes it in its own (offer and answer).
 * An older client that reads it also starts using DTX; one that does not write
 * it leaves us without DTX for that peer, as before.
 *
 * Only the Opus fmtp changes. A line that already says `usedtx` stays as is.
 */
export function comDtxNoOpus(sdp: string): string {
  return comParametroNoOpus(sdp, "usedtx", "1")
}

/**
 * What mesh writes in its description: DTX and constant bitrate (`cbr=1`) in
 * all Opus codecs (November 3, 2026).
 *
 * In variable bitrate, Opus makes voice packets sized to fit the audio, and the
 * sequence of sizes leaks information about speech even when the voice is
 * encrypted (Wright et al., "Spot me if you can", 2008). With `cbr=1`, all
 * voice frames leave the same size; DTX still cuts silence. It becomes visible
 * who is speaking and when, nothing more. It is the same mechanism as `usedtx`:
 * Chrome reads `cbr` in the OTHER side's description and sets up the sender's
 * encoder.
 *
 * Applies to all Opus in the connection, including screen audio and music: screen
 * audio often carries speech (a video, another call), and over SFU, `cbr=1`
 * comes from the router, which has a single Opus. See `docs/planos/voz-cbr-relatorio.md`.
 */
export function comDtxECbrNoOpus(sdp: string): string {
  return comParametroNoOpus(comDtxNoOpus(sdp), "cbr", "1")
}

/**
 * Add `chave=valor` to the fmtp of each Opus in the description. A line that already
 * states the `chave` (with any value) stays as is; an Opus without fmtp gets one,
 * right after its rtpmap. The rest of the description does not change.
 */
function comParametroNoOpus(sdp: string, chave: string, valor: string): string {
  if (!sdp) return sdp
  const fim = sdp.includes("\r\n") ? "\r\n" : "\n"
  const linhas = sdp.split(/\r?\n/)
  const opus = new Set<string>()
  for (const linha of linhas) {
    const tipo = /^a=rtpmap:(\d+) opus\/48000/i.exec(linha)?.[1]
    if (tipo) opus.add(tipo)
  }
  if (opus.size === 0) return sdp
  const jaDiz = new RegExp(`(^|;)\\s*${chave}=`)
  const comFmtp = new Set<string>()
  const saida = linhas.map((linha) => {
    const fmtp = /^a=fmtp:(\d+) (.*)$/.exec(linha)
    if (!fmtp || !opus.has(fmtp[1]!)) return linha
    comFmtp.add(fmtp[1]!)
    return jaDiz.test(fmtp[2]!) ? linha : `${linha};${chave}=${valor}`
  })
  const final: string[] = []
  for (const linha of saida) {
    final.push(linha)
    const tipo = /^a=rtpmap:(\d+) opus\/48000/i.exec(linha)?.[1]
    if (tipo && !comFmtp.has(tipo)) final.push(`a=fmtp:${tipo} ${chave}=${valor}`)
  }
  return final.join(fim)
}

/** Our screen audio: going out, muted by us, or none. */
export type EstadoDoSomDoEcra = "a-sair" | "calado" | null

export class Call extends Emitter<CallEvents> {
  #peers = new Map<UserAddress, Peer>()
  /** What each peer said it can do, from their `voice.join`. */
  #peerSframe = new Map<UserAddress, boolean>()
  /**
   * The last microphone state each peer declared.
   *
   * A separate map, not a field on `Peer`, because the state arrives before the
   * peer exists, and sometimes without ever existing: a `voice.join` from someone
   * with the higher address does not build any link on our side, it only asks us
   * to offer. Stored by address, what we heard stays there when the link is born,
   * three awaits later. Same pattern as `#peerSframe`, for the same reason.
   *
   * Absent means "unknown", and that is how an old client that cannot say
   * anything about this stays.
   */
  #peerMuted = new Map<UserAddress, boolean>()
  /**
   * Which generation of each peer we have built for them.
   *
   * Stored by address, like everything else about a person rather than a link.
   * A value different from what we have here means the person left and came back,
   * and what we built for them no longer matches anything on their side. See
   * `#novaVidaDe`.
   */
  #peerJoinId = new Map<UserAddress, string>()
  /**
   * Our identifier for this entry in the call.
   *
   * Born in each `#join` and unchanged until the next one, that is what makes
   * it useful: the announcement repeated every five seconds carries the same
   * value, and only a new entry changes it. Null outside a call, when there is
   * no generation to identify.
   */
  #joinId: string | null = null
  #local: MediaStream | null = null

  /**
   * The screen THIS account is sharing, or none.
   *
   * Its own field, not a track inside `#local`, and the difference is not just
   * organization. `#local` is the call capture: born in `#join`, dies in
   * `#leave`, and each track was added to all links with `addTrack`. The screen
   * has a different life, it enters and exits the same call as many times as
   * the person wants, and travels through a reserved slot with `replaceTrack`,
   * which is what avoids renegotiation. Putting it in `#local` would make
   * `setMuted`, `setCameraOff`, and the gain processor pass over it, and would
   * make `getVideoTracks()[0]` unable to tell if it was looking at a camera or
   * a screen.
   *
   * Cleared in `#join` and in `#leave`, like the capture: a screen that
   * survived the call would be someone's screen going live after disconnecting,
   * the worst bug this file could have.
   */
  #ecra: MediaStream | null = null
  /**
   * The screen audio that is going out, or none.
   *
   * The audio track from `getDisplayMedia`, as it came: does NOT go through the
   * voice chain (it is music or system sound, and noise reduction would eat it)
   * or through the muted microphone: muting the microphone does not mute shared
   * video. Null when the person did not enable audio, or when the system did not
   * provide it.
   */
  #somDoEcra: MediaStreamTrack | null = null
  /**
   * What loops back to the sharer: image ONLY.
   *
   * The stage plays screen audio from others. Not ours: playing the audio we are
   * capturing would hear it twice, and with system audio it would loop. So the
   * `screen` event carries a stream with no audio.
   */
  #ecraVisto: MediaStream | null = null

  /**
   * Who declared they are sharing screen, and with what stream.
   *
   * Stored by address, not in `Peer`, for the usual reason in this class: the
   * declaration arrives before the peer exists, and sometimes without ever
   * existing. Same pattern as `#peerSframe` and `#peerMuted`.
   *
   * Absent means "not sharing". Unlike the microphone, that read is safe here: a
   * client too old to know the field is too old to share anything.
   */
  #peerScreen = new Map<UserAddress, boolean>()
  #peerScreenStream = new Map<UserAddress, string>()
  /**
   * Who said they know screen audio in mesh (`ecraSom` in `voice.join`).
   *
   * Compatibility guard: an old client that received the extra m-line would read
   * the track without a stream as the person's voice and stop hearing them. Only
   * those here get offered that slot. See `ecraSom` in the protocol.
   */
  #peerEcraSom = new Map<UserAddress, boolean>()
  /**
   * Who said they know MUSIC in mesh (`musica` in `voice.join` or offer).
   *
   * Same guard as `#peerEcraSom`: an old client that received the extra m-line
   * would read it as the person's voice. See `musica` in the protocol.
   */
  #peerMusica = new Map<UserAddress, boolean>()
  /** What each person said they are playing. Absent means not playing. See `aTocar`. */
  #peerATocar = new Map<UserAddress, string>()
  /**
   * OUR music, the outgoing track: comes from the player (`musica.ts`), not the microphone.
   *
   * Not ours: the player opens and stops it. So no output from this class calls
   * `stop()` on it; we just forget it. Does not go through the voice chain, and
   * muting the microphone does not affect it.
   */
  #musica: MediaStreamTrack | null = null
  /** The name of what is playing, or none (paused). Only valid with `#musica`. */
  #aTocar: string | null = null

  /**
   * Who each person said they are viewing the screen from. See `aVer` in the protocol.
   *
   * Only `voice.join` carries it, so we store it by person instead of reading it
   * from the payload at draw time: the announcement is the heartbeat, the offer
   * and answer do not come in the same frame, and the renderer asks at any time.
   * Absent means they did not say anything.
   *
   * Exists for mesh; over SFU the same thing lives in the roster (`#rosterSfu`),
   * with the timestamp that makes it expire. Two stores because they are two
   * rosters, same split that `micMuted` already has.
   */
  #peerAVer = new Map<UserAddress, readonly string[]>()

  /**
   * Whose screen we chose to view. See `aceitarEcra`.
   *
   * Owner request, October 5, 2026: *when someone shares their screen, others
   * should only join the stream if they want to.* Before this it was automatic,
   * and anyone receiving took 2.5 Mbps forced with nowhere to refuse, no
   * simulcast or layers, so no small version to ask for.
   *
   * **The choice lives here, only here**, with two readers serving it: the SFU
   * engine asks for it before consuming (`verOEcraDe`), and the announcement
   * tells the sharer (`aVer`, in `voice.join`). Storing it also in the engine
   * would have the same choice in two places, and one would drift.
   *
   * Per PERSON, not per producer: whoever views someone's screen sees what they
   * share, and a restarted share is the same choice. Clears on each entry,
   * because the choice is for this call.
   *
   * **AND PRUNE when someone leaves, which is the missing half.** This counts
   * distinct people who have already shared and been accepted, not people
   * present: a permanent room with turnover can see dozens in an afternoon. At
   * the seventeenth, `aVer` would exceed the schema's `.max(TECTO_DO_AVER)`,
   * `encodePayload` would throw from inside `#anunciar`, `reafirmarPresenca`
   * would swallow the error in a diagnostic, none of our `voice.join`
   * announcements would go out, and at 160 seconds everyone would remove us from
   * their roster (`#varrerRoster`, their side): invisible and inaudible, still
   * sending media, with no way to recover without leaving and rejoining.
   *
   * Pruning is in `#esquecerEscolhaDeEcra`, called from everywhere a person
   * stops being in this call.
   */
  #ecrasAceites = new Set<UserAddress>()

  /**
   * The capture being opened, so anyone who needs it can wait.
   *
   * `#join` publishes `#channel` and `#room` BEFORE asking for the microphone,
   * and must: they are how we know which call any arriving signal belongs to. But
   * capture takes time, a round trip over IPC to open the permission gate, the
   * `getUserMedia`, and the system dialog if it is the first time.
   *
   * In that window, an arriving signal would build a peer with
   * `this.#local?.getTracks() ?? []`, an empty list: a link with not a single
   * track, with local description set, which the guard in `#offer` would then
   * refuse to rebuild forever. The call would settle, the card would go green,
   * and no sound would flow, "shows as connected but I stop hearing". It
   * happens often: anyone in `#perdidos` announces every five seconds, so with
   * three or more people there is almost always someone announcing while the
   * microphone opens.
   *
   * Waiting is better than refusing: the signal does not get lost, and the peer
   * is born complete a few milliseconds later.
   */
  #capturaEmCurso: Promise<void> | null = null
  /**
   * What to do with audio and video when opening capture.
   *
   * Left outside and not read from here: the core knows nothing of storage or
   * preferences, and the UI knows what the person chose.
   */
  audioSettings: {
    noiseSuppression?: boolean
    echoCancellation?: boolean
    autoGainControl?: boolean
    /**
     * Which microphone to open. Empty or absent means "whatever the system picks".
     *
     * Requested with `exact`, not `ideal`: an explicit choice the browser can
     * silently ignore is not a choice, it is a suggestion, and the person would
     * think they turned off a microphone they are actually using. The cost of
     * `exact` is capture failing when the device disappears, which is why we
     * request again without it right after: see `#capture`.
     */
    inputDeviceId?: string
  } | null = null

  /**
   * Audio options applied to the track that is ALREADY going out.
   *
   * `audioSettings` was read once, when opening capture, and never again. Changing
   * noise suppression mid-call did nothing: the microphone was requested with old
   * options and stayed that way until someone disconnected. On the side that
   * changed it, the toggle just did not work.
   *
   * `applyConstraints` changes the live track without rebuilding it, so without
   * cutting audio or touching any links. The CHOSEN microphone is left out on
   * purpose: switching devices mid-call forces rebuilding the track on every
   * peer, and that is another thing, bigger, that nobody asked for.
   *
   * Fails silently by design. Not all browsers let you change this live, and a
   * failure here cannot take down a call because of a preference, whoever changed
   * it will hear the difference in the next call, which is the existing behavior.
   */
  async aplicarSomAoVivo(): Promise<void> {
    // The RAW track, straight from the microphone: with a chain in between, `#local`
    // is the track that comes out, and constraints on that do not reach anyone.
    const faixa = (this.#capturaCrua ?? this.#local)?.getAudioTracks()[0]
    if (!faixa) return
    await faixa
      .applyConstraints(this.#tratamentoNativo(this.audio.temCadeia))
      .catch(() => {
        this.emit("diagnostic", { code: "som-ao-vivo-recusado", detail: "applyConstraints" })
      })
  }

  videoQuality: "auto" | "360p" | "720p" | "1080p" = "auto"

  /**
   * Which camera to open. Empty means "whatever the system picks".
   *
   * Requested with `exact`, for the same reasons as the microphone
   * (`inputDeviceId`): a choice the browser can swap silently is not a choice.
   * And with the same recovery path: if the chosen camera is gone, capture opens
   * whatever is available and says "camera-chosen-is-gone" in the diagnostic,
   * instead of leaving the person without a call because of a missing device.
   * Next to `videoQuality`, not inside `audioSettings`, because it is video;
   * the bridge writes it from preferences (phase 4 of 0.9).
   */
  videoDeviceId = ""

  /**
   * How much to amplify the microphone. 1 is the capture as the system provides it.
   *
   * Away from 1, the track goes through a `GainNode`, so the value 1 is not
   * "neutral gain", it is **no chain at all**. The default capture stays exactly
   * as it always was, and only users who move the slider enter the new path. An
   * `AudioContext` that is always born would be cleaner on paper and more costly
   * in reality: an audio processor running, lighting up the microphone, to make
   * no difference.
   */
  inputGain = 1

  /**
   * Process the microphone before sending: cut everything below the voice.
   *
   * Lives next to `inputGain`, not inside `audioSettings`, because they are
   * different things: those are requests to the browser, which fulfills them as
   * it can; this is our work, on this machine, on the signal coming from here.
   * The browser's suppressor keeps doing its job, this cuts something else, and
   * both add up without interfering.
   *
   * When enabled, the processing chain starts with gain at 1: that's the only
   * reason an `AudioContext` exists without anyone touching the volume. See
   * `#comTratamento`.
   */
  filtroDeMicrofone = false

  /**
   * Stay silent, and stay silent in the next call.
   *
   * Stored here and not inferred from tracks because outside a call there are
   * no tracks: someone who mutes before entering had nowhere to say it, and the
   * choice died at the click. A track starts active, so the next capture would
   * open with the microphone live, the person thinks they are muted and is
   * speaking to the room.
   */
  #muted = false

  /** What the microphone is doing, for whoever designs the button. */
  get muted(): boolean {
    return this.#muted
  }

  /**
   * We are in the AFK room of the channel: presence and nothing more. See
   * `#entrarSemVoz`.
   *
   * Decided in `join` by the bridge (`salaAfk`) and not by the interface, so it
   * works no matter where the entry comes from: a click, the AFK timer, or a
   * `voice.move` from a moderator.
   */
  #afk = false

  get emSalaAfk(): boolean {
    return this.#afk
  }

  #channel: string | null = null
  /**
   * The voice room within the channel. Empty means the channel call.
   *
   * Two voice rooms in the same channel are two calls: signals from one cannot
   * reach the other, or whoever enters one is offered to whoever is in the other
   * and both collapse into one. This field separates them, and absent means the
   * channel call, what all the signaling before this looks like, so an old and
   * a new version don't go deaf to each other.
   */
  #room = ""
  #video = false

  /**
   * Media cipher, above the transport.
   *
   * Moved from this file to `media-sframe.ts` in step 1 of Phase 2 of
   * `docs/PLANO_SFU.md`, and moved whole: one sender per key shared by all
   * tracks and all pairs, one pair of receivers per person, the derivation
   * queue and the counter reserve. The reason for the move is not tidiness, it
   * is that the SFU engine needs exactly the same encryption, and the
   * alternative was a second copy to diverge with.
   *
   * What stayed here is what belongs to the MESH: who the peers are, and
   * therefore who the receivers are maintained for. See `rekey`.
   *
   * **Survives the call, on purpose.** Not cleared in `#leave`: a second call
   * in the same MLS epoch reuses the same key, and a new sender would restart
   * the counter at zero, repeating all the nonces the first one already spent.
   */
  /*
   * Declared here and built in the constructor, not initialized on this line:
   * a field initializer runs BEFORE the `bridge` property exists, and what the
   * cipher would receive was `undefined`, with the failure showing only at the
   * first key derivation, far from here.
   */
  readonly #cifra: CifraDeMedia

  /**
   * The SFU engine, while this call is over SFU. Null means mesh.
   *
   * Born in each `#join` and dies in each `#leave`, not at construction of this
   * object: the capability only responds after `hello.ok`, and a server
   * downgrade to a version without SFU must close the gate by itself in the next
   * call. See `CallBridge.sfu`.
   *
   * **This field is the entire gate.** Null, everything that follows in this
   * file is the same mesh code without a line different; not null, the
   * peer-to-peer negotiation branches never run.
   */
  #motor: MotorSfu | null = null

  /**
   * Who is in the call over SFU, by the encrypted roster.
   *
   * With mesh, who is in the call is who has a live `RTCPeerConnection`, the
   * `#peers` map is both the question and the answer. With SFU there is no
   * per-person connection, and the question now has one source only: the
   * `voice.join`/`voice.leave` that already travel encrypted inside the MLS.
   * The server does not read them, and that is why the list still comes from
   * there instead of from the gateway, which knows who is in the call but should
   * not be who tells us.
   *
   * **Dated, and that is what prevents the eternal person.** A source that only
   * grows with `voice.join` and only shrinks with `voice.leave` keeps forever
   * whoever never actually said goodbye, and nobody says goodbye by closing a
   * tab, reloading the page or losing the network. With mesh there was a safety
   * net without noticing: the connection with that person dropped, and the drop
   * was the warning. With SFU the connection is just one, to the server, and it
   * does not drop because someone left.
   *
   * The timestamp is when the announcement REACHED us, not the `at` inside it:
   * this way expiry is all measured on the same clock, and two computers with
   * different times do not expel anyone. It is the same as the screen does with
   * outside presences (`presencasVivas`, in `packages/ui`), and now in the same
   * window, `PRESENCA_VALIDA_MS`.
   */
  #rosterSfu = new Map<
    UserAddress,
    {
      video: boolean
      micMuted: boolean
      screen: boolean
      aVer: readonly string[]
      /** What the person said they are playing. See `aTocar` in the protocol. */
      aTocar: string | null
      quando: number
    }
  >()
  /** ICE candidates that arrived before their peer had a remote description. */
  #pendingIce = new Map<UserAddress, RTCIceCandidateInit[]>()
  /** Per-peer give-up timers, so a call that cannot traverse says so. */
  #connectTimers = new Map<UserAddress, ReturnType<typeof setTimeout>>()
  /**
   * ICE servers, with the time they were requested.
   *
   * TURN credentials last minutes (`ENCLAVE_TURN_TTL`, 600 s today). A call
   * lasting more than that, or an app open since the previous call, created new
   * connections with dead credentials: no retransmission, therefore no pairs
   * that need it.
   */
  #ice: { servers: RTCIceServer[]; em: number } | null = null
  /**
   * Peers we are already making an offer to.
   *
   * Marked BEFORE the first await, and that is why it exists. Testing
   * `localDescription` looks equivalent and is not: between creating the
   * connection and setting the local description there are three awaits, and
   * two announcements of the same peer arriving in that window both pass the
   * test. The result is two offers, two answers, and the second one fails with
   * "cannot set remote answer in state stable", the connection dies and the
   * participant disappears from the screen.
   */
  #offering = new Set<UserAddress>()

  /**
   * One answer at a time per person, as there was for offers.
   *
   * `#offer` had a guard and `#answer` did not, and the asymmetry cost this:
   * two offers from the same peer handled at the same time, bridges invoke
   * `handleSignal` without serialization, interleaved
   * `setRemoteDescription`/`createAnswer`/`setLocalDescription` on the SAME
   * connection. The second hit "cannot set local answer when createAnswer has
   * not been called", the error went up to the bridge and became a toast, and
   * one side was left without an answer.
   *
   * Reported by the owner on August 14, 2026, with the full signature: failure
   * at the second connection, works at the third, and happens both ways. Works
   * at the third because the second offer arrives after the first is done.
   */
  #answering = new Set<UserAddress>()
  /**
   * While we are alone in the call, we announce ourselves again.
   *
   * A single announcement does not survive any time difference: whoever enters
   * an ongoing call lost the announcement of who is there, and whoever is there
   * has no reason to repeat it. Observed live: two announcements on the server,
   * one from each side, no offer between them, and both seeing "waiting for
   * someone to enter".
   */
  #announceTimer: ReturnType<typeof setInterval> | null = null
  /**
   * The heartbeat that keeps our presence alive for those NOT in the call.
   *
   * It is something else than `#announceTimer`, and mixing the two up is the
   * bug reported on August 18, 2026: *"call does not show, users enter as if
   * everything was empty"*.
   *
   * `#announceTimer` serves negotiation: it repeats the announcement while a
   * peer is missing and **stops at the first one**, because from then on there
   * is nothing left to negotiate. With SFU it does not even start. Except the
   * sidebar for everyone, the list of who is in each voice room, is built
   * from those same `voice.join`, and dated: `presencasVivas` throws away
   * everything not reaffirmed in the window. With the announcement stopping,
   * the list emptied itself while people kept talking, and nothing filled it
   * again.
   *
   * This one beats slowly and never stops while the call lasts. It is what
   * makes the `presencasVivas` window a true statement instead of a promise
   * nobody keeps.
   */
  #batimentoTimer: ReturnType<typeof setInterval> | null = null
  /**
   * The timer that suspects the presence of OTHERS, and the pair of the one
   * above.
   *
   * The heartbeat tells the world we are here; this asks, at the same pace, who
   * stopped saying so. See `#comecarVarrimento`.
   */
  #varrimentoTimer: ReturnType<typeof setInterval> | null = null
  /** Scheduled reaffirmation, to bundle a block arrival in one announcement. */
  #reafirmacaoTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * Who we owe an attempt: peers that fell without leaving.
   *
   * The announcement repeater stopped as soon as there was one peer, and the
   * repair of `#drop` only ran for whoever ended with zero. The two conditions
   * together saved a call of two people and abandoned one of three: whoever
   * loses a connection and keeps another has one peer, and never tries again.
   * The other side, for the same reason, does not either. It is the "the third
   * one keeps ringing".
   *
   * Leaves here when the connection with that person closes, when they announce
   * themselves again (come to negotiate again), or when they say they left, in
   * that case there is nothing to recover.
   *
   * **Keeps TWO things, and telling them apart cost a family of bugs.** A `Set`
   * mixed them:
   *
   *   `espera`, someone announced themselves, we are on the side waiting for
   *              the offer, and it has not arrived yet. There was never a
   *              connection with them.
   *   `caiu`  , the connection we had with them died (connection timer,
   *              `failed`/`closed`, or a key that did not derive).
   *
   * The two make the periodic announcement keep going, and for that they are
   * the same thing. For the `reparar` field they are not: see `#anunciar`.
   */
  #perdidos = new Map<UserAddress, "espera" | "caiu">()
  /**
   * Peer builds in progress, by address.
   *
   * `#createPeer` checks `#peers` and fills it three awaits later. An offer and
   * an answer arriving in that window, the normal case in a mesh, where
   * everyone talks at once, build two RTCPeerConnection for the same person.
   * One gets the negotiation and connects; the other never receives a candidate,
   * stays in "connecting" until timeout, and disappears from the screen. Measured
   * live: four connections for two participants, two connected and two orphaned.
   */
  #creating = new Map<UserAddress, Promise<Peer | null>>()
  /**
   * Announcements heard while we were not yet in the call.
   *
   * A `voice.join` is only handled by those already in a call. If two people
   * enter seconds apart, each one's announcement arrives before the other has
   * entered, and both are discarded, and as nobody announces again, both end up
   * in call, alone, looking at "waiting for someone to enter". Keeping what we
   * heard solves the race without extra traffic.
   */
  #heardBeforeJoining = new Map<string, { from: UserAddress; payload: Payload; at: number }[]>()

  /**
   * The voice chain: noise reduction and filters, before the cipher and before
   * the track goes out to WebRTC. The interface reads and changes here. See
   * `audio/README.md`.
   */
  readonly audio: ControloDeVoz

  constructor(private readonly bridge: CallBridge) {
    super()
    this.audio = new ControloDeVoz({
      abrirMicrofone: () => this.#abrirMicrofoneParaPrevia(),
      ganhoDeEntrada: () => this.inputGain,
      fecharMicrofone: async (captura) => {
        for (const faixa of captura.getTracks()) faixa.stop()
        // The Electron gate only closes if no call needs it.
        if (!this.#channel) await this.bridge.setMediaActive?.(false)
      },
      // The raw capture of the call, so the preview does not open the microphone
      // again (see `capturaDaChamada` in the controller).
      capturaDaChamada: () => (this.#channel ? (this.#capturaCrua ?? this.#local) : null),
      aoMudarNativo: () => void this.aplicarSomAoVivo(),
      aoMudar: (estado) => this.emit("audio", estado),
      aoDiagnosticar: (code, detail) => this.emit("diagnostic", detail === undefined ? { code } : { code, detail }),
    })
    this.#cifra = new CifraDeMedia(bridge, (code, detail) =>
      this.emit("diagnostic", detail === undefined ? { code } : { code, detail }),
    )
  }

  get channel(): string | null {
    return this.#channel
  }

  get active(): boolean {
    return this.#channel !== null
  }

  get localStream(): MediaStream | null {
    return this.#local
  }

  /**
   * How long it takes a round trip to the PEER, in milliseconds.
   *
   * Inside a call there really is a connection to another person, and that is
   * the distance that matters, not the server's, which here only served to
   * introduce them. The number comes from the named `candidate-pair`, which is
   * the path where media is actually passing; the other candidate pairs are
   * paths that were tried and did not work, and their average describes nothing.
   *
   * In a call with multiple people it returns the WORST, not the average: whoever
   * has the bad connection is who arrives late to the conversation, and an
   * average where three good connections hide one terrible one says everything
   * is fine to someone hearing choppy audio.
   *
   * `null` while there is no measurement, before the connection settles, or in
   * a browser that does not give the stat. Do not invent a zero.
   *
   * **In an SFU call it returns `null`, and that is the right answer, not a
   * failure.** There is no peer: there is a connection to the server. The
   * distance that exists in that call is measured with
   * `medirLatenciaAoSfu`, which is another question and has another name on
   * purpose, calling "peer" the hop to the server would give a true number
   * with a false label.
   */
  async measureLatency(): Promise<number | null> {
    const medidas: number[] = []
    for (const [, peer] of this.#peers) {
      if (peer.connection.connectionState !== "connected") continue
      const stats = await peer.connection.getStats().catch(() => null)
      if (!stats) continue
      // Collect first and decide later: `forEach` over the report
      // delivers untyped records, and narrowing inside the callback does not survive
      // leaving it.
      const doPar: number[] = []
      stats.forEach((report: { type?: string; nominated?: boolean; currentRoundTripTime?: number }) => {
        if (report.type !== "candidate-pair" || report.nominated !== true) return
        if (typeof report.currentRoundTripTime === "number") doPar.push(report.currentRoundTripTime * 1000)
      })
      if (doPar.length > 0) medidas.push(Math.max(...doPar))
    }
    if (medidas.length === 0) return null
    return Math.round(Math.max(...medidas))
  }

  /**
   * How long it takes a round trip to the SFU, when the call goes through it.
   *
   * `null` outside an SFU call, in the mesh there is no hop to the server to
   * measure, because media does not go through it, and `null` while the
   * connection is settling. See `MotorSfu.latencia` for what is read and why.
   *
   * Exists separate from `measureLatency` because it measures something else:
   * that one measures to WHO hears us, this one to the server that forwards. In
   * an SFU call only the second exists, and whoever designs labels it as server.
   */
  async medirLatenciaAoSfu(): Promise<number | null> {
    return (await this.#motor?.latencia()) ?? null
  }

  /**
   * The image coming from here is being capped, and why. See `LimiteDeVideo`.
   *
   * **Responds in both paths, and it had to.** It is the mesh that suffers this
   * first: whoever shares sends one copy per person, and a home uplink with
   * three peers hits the limit well before an SFU does. Reading only the SFU
   * path would read the less constrained half, and leave silent exactly the
   * situation where resolution drops the most.
   *
   * In the mesh the read is per PEER and the worst is returned: each connection
   * has its own encoder and its own limit, and a person on a bad network does
   * not lower the image for others. What is drawn is the worst because that is
   * the worst the person wants to know, if someone is seeing them badly, they
   * want to know it.
   *
   * `null` outside a call, with no image going out, or with the image going out
   * whole.
   */
  async medirLimiteDeVideo(): Promise<LimiteDeVideo | null> {
    if (this.#motor) return this.#motor.limiteDeVideo()

    let pior: LimiteDeVideo | null = null
    for (const [, peer] of this.#peers) {
      if (peer.connection.connectionState !== "connected") continue
      const stats = await peer.connection.getStats().catch(() => null)
      if (!stats) continue
      const limite = limiteDoRelatorio(stats)
      if (!limite) continue
      if (pior === null || (pior.razao === "cpu" && limite.razao === "bandwidth")) pior = limite
    }
    return pior
  }

  // ------------------------------------------------------------------ join

  /**
   * Joins and leaves run one at a time, whatever the interface does.
   *
   * Two joins in flight together — a double-click, or a click while a slow
   * `getUserMedia` is still being granted — both passed the guard below, both
   * opened a capture, and the second overwrote `#local` with the first still
   * running. Nothing then held a reference to those tracks, so nothing could
   * ever stop them: the microphone light stayed on after the call ended. On an
   * app whose whole argument is that the device is yours, a microphone nobody
   * can turn off is not a glitch.
   */
  #queue: Promise<unknown> = Promise.resolve()

  async join(channel: string, options: { video?: boolean; room?: string } = {}): Promise<void> {
    const run = this.#queue.catch(() => {}).then(() => this.#join(channel, options))
    this.#queue = run.catch(() => {})
    return run
  }

  /**
   * The raw capture, when gain replaced it, and the processor that handles it.
   *
   * Kept because stopping the tracks of `#local` does not work: with gain in
   * the middle, `#local` are the tracks that EXIT the processor, and stopping
   * them does not touch the microphone, which stays open, light on, until the
   * page dies. This is the point where we disconnect what is actually recording.
   */
  #capturaCrua: MediaStream | null = null
  #processador: AudioContext | null = null

  /**
   * What we ask the browser for: echo cancellation, native suppressor and
   * automatic gain. With capture going through our chain, the native suppressor
   * and gain stay as the chain says (see `restricoesNativas`).
   */
  #tratamentoNativo(comCadeia: boolean): {
    echoCancellation: boolean
    noiseSuppression: boolean
    autoGainControl: boolean
  } {
    const audio = this.audioSettings ?? {}
    const pedido = {
      noiseSuppression: audio.noiseSuppression ?? true,
      autoGainControl: audio.autoGainControl ?? true,
    }
    return {
      echoCancellation: audio.echoCancellation ?? true,
      ...(comCadeia ? this.audio.restricoesNativas(pedido) : pedido),
    }
  }

  /** The microphone for the preview of the chain, outside a call. */
  async #abrirMicrofoneParaPrevia(): Promise<MediaStream> {
    if (!this.#channel) await this.bridge.setMediaActive?.(true)
    const tratamento = this.#tratamentoNativo(true)
    const escolhido = this.audioSettings?.inputDeviceId
    try {
      if (escolhido) {
        return await navigator.mediaDevices
          .getUserMedia({ audio: { ...tratamento, deviceId: { exact: escolhido } }, video: false })
          .catch(() => navigator.mediaDevices.getUserMedia({ audio: tratamento, video: false }))
      }
      return await navigator.mediaDevices.getUserMedia({ audio: tratamento, video: false })
    } catch (erro) {
      if (!this.#channel) await this.bridge.setMediaActive?.(false)
      throw erro
    }
  }

  /**
   * Run the capture through the processing pipeline and return what comes out.
   *
   * The microphone stays the same; what changes is what goes out from here to
   * the peers. Video tracks pass through unchanged, an audio processor has
   * nothing to say about them, and return to the same `MediaStream`, or the
   * camera would disappear when someone adjusted the volume.
   *
   * The chain, in order, and each stage for its reason:
   *
   * 1. **High-pass filter at 80 Hz**, only when enabled. Below the voice there
   *    is no voice: there is fan noise, air conditioning, desk rumble and breath
   *    from the speaker blowing across the microphone. Comes BEFORE the gain on
   *    purpose, because amplifying rumble just to cut it later wastes headroom
   *    on what we were going to throw away anyway.
   * 2. **Gain**, which is the choice of someone who knows their microphone is
   *    quiet.
   * 3. **Limiter, and this one is not optional.** A 2× gain on normal speech
   *    pushes past the signal ceiling, and what comes out is not louder speech:
   *    it is torn speech, which the other side hears as friction or static.
   *    The distortion was OURS, made here, not from the speaker's microphone.
   *    Reported by the owner on September 13, 2026. Holds the peaks and lets
   *    the rest through.
   *
   * Context is taken back at the start: an `AudioContext` is born suspended when
   * there is no recent gesture, and a suspended context delivers a SILENT track
   * to peers. Unexpected and not requested, if the host rejects it, the call
   * goes on and the next gesture resolves it.
   */
  #comTratamento(bruto: MediaStream): MediaStream {
    const audio = bruto.getAudioTracks()
    if (audio.length === 0) return bruto
    try {
      const contexto = new AudioContext()
      const entrada = contexto.createMediaStreamSource(new MediaStream(audio))
      const ganho = contexto.createGain()
      // A cap of 2: above that what you gain in volume you lose in distortion,
      // and what was quiet becomes loud AND bad.
      ganho.gain.value = Math.max(0, Math.min(2, this.inputGain))

      /*
        A limiter, not a real compressor: hard knee, high ratio and short
        attack, to bite only on what would exceed the cap. Someone speaking as
        they always have does not hear it working.
      */
      const limitador = contexto.createDynamicsCompressor()
      limitador.threshold.value = -3
      limitador.knee.value = 0
      limitador.ratio.value = 20
      limitador.attack.value = 0.003
      limitador.release.value = 0.25

      const saida = contexto.createMediaStreamDestination()
      if (this.filtroDeMicrofone) {
        const passaAlto = contexto.createBiquadFilter()
        passaAlto.type = "highpass"
        passaAlto.frequency.value = 80
        entrada.connect(passaAlto).connect(ganho)
      } else {
        entrada.connect(ganho)
      }
      ganho.connect(limitador).connect(saida)

      void contexto.resume().catch(() => {})

      this.#capturaCrua = bruto
      this.#processador = contexto
      const tratado = new MediaStream([...saida.stream.getAudioTracks(), ...bruto.getVideoTracks()])
      return tratado
    } catch {
      // A browser without usable `AudioContext` is not a reason to drop the call:
      // you get the capture as it came, which is what you had before.
      this.emit("diagnostic", { code: "ganho-de-entrada-indisponivel" })
      return bruto
    }
  }

  /**
   * Truly mute the microphone when the gain is mid-way. See `#capturaCrua`.
   *
   * `guardar` is the capture that a move takes to the new room: the processing
   * undoes and redoes on entry, the microphone stays open. See `voice.move`.
   */
  #largarGanho(guardar: MediaStream | null = null): void {
    this.audio.largarCaptura()
    for (const track of this.#capturaCrua?.getTracks() ?? []) if (!guardar?.getTracks().includes(track)) track.stop()
    this.#capturaCrua = null
    void this.#processador?.close().catch(() => {})
    this.#processador = null
  }

  /**
   * The capture that a move carried from one room to the other, between exit
   * and entry. Only exists inside a `#join` with `manterCaptura`.
   */
  #capturaGuardada: MediaStream | null = null

  // ------------------------------------------------------- the microphone that dies silent

  /**
   * The watcher for the call microphone (4/11/2026). See `audio/vigia-do-microfone.ts`.
   *
   * Turns on when the call capture is ready and turns off on exit. Reads the
   * RAW track (what comes from the device), the audio context it passes through
   * and the tick of the worklet in the voice chain. When it spots a death, the
   * `Call` opens the microphone again and swaps the track in the sender, without
   * leaving.
   */
  readonly #vigiaDoMicrofone = new VigiaDoMicrofone(
    () => this.#saudeDoMicrofone(),
    (morte, detalhe) => void this.#microfoneMorreu(morte, detalhe),
  )

  /** When the microphone died, in the last minute. See `MORTES_DO_MICROFONE_POR_MINUTO`. */
  #mortesDoMicrofone: number[] = []

  /**
   * The waits before each attempt to reopen the microphone. The first is right
   * now: the person is speaking into nothing. The ones after give time for a
   * device that is coming back (Windows restarting the audio service, Bluetooth
   * headphones switching profiles).
   */
  static readonly REABERTURAS_DO_MICROFONE_MS: readonly number[] = [0, 1_000, 2_000, 4_000]

  /**
   * How many deaths in a minute we recover from. A microphone that dies more
   * than this is not having a hiccup: something is killing it, and reopening it
   * without pause is a loop nobody asked for. Stop, and tell them (452).
   */
  static readonly MORTES_DO_MICROFONE_POR_MINUTO = 4

  #saudeDoMicrofone(): SaudeDoMicrofone | null {
    const faixa = (this.#capturaCrua ?? this.#local)?.getAudioTracks()[0] ?? null
    if (!faixa) return null
    const cadeia = this.audio.saudeDaCadeia
    return { faixa, contexto: cadeia?.contexto ?? this.#processador, cadeia }
  }

  /**
   * The microphone died silent: open it again, on the same device, without
   * leaving.
   *
   * Each cause gets its code in the log (`call-microfone-terminou`, `-calado`,
   * `-contexto-parado`, `-cadeia-rebentou`, `-cadeia-parada`), so the next
   * report from the owner says what happened. Then `call-microfone-recuperado`
   * with the time it took, or `-nao-reabriu` for each failed attempt and
   * `-desistiu` at the end, with 412 on the screen (same as capture that won't
   * open on entry). The call always stays: you still hear without a microphone.
   */
  async #microfoneMorreu(morte: MorteDoMicrofone, detalhe: string): Promise<void> {
    const vida = this.#joinId
    if (!this.#channel || vida === null) return
    this.emit("diagnostic", detalhe ? { code: `call-microfone-${morte}`, detail: detalhe } : { code: `call-microfone-${morte}` })

    const inicio = Date.now()
    this.#mortesDoMicrofone = this.#mortesDoMicrofone.filter((quando) => inicio - quando < 60_000)
    this.#mortesDoMicrofone.push(inicio)
    if (this.#mortesDoMicrofone.length > Call.MORTES_DO_MICROFONE_POR_MINUTO) {
      this.emit("diagnostic", { code: "call-microfone-em-ciclo", detail: `${this.#mortesDoMicrofone.length} em 60 s` })
      this.emit("error", { detail: "the microphone keeps stopping" })
      return
    }

    let ultimo: unknown = null
    for (const espera of Call.REABERTURAS_DO_MICROFONE_MS) {
      if (espera > 0) await new Promise((pronto) => setTimeout(pronto, espera))
      if (this.#joinId !== vida || !this.#channel) return
      try {
        // In the queue of entries and exits: an exit mid-way cannot see half a swap.
        const trocou = this.#queue.catch(() => {}).then(() => this.#reabrirMicrofone(vida))
        this.#queue = trocou.catch(() => {})
        if (!(await trocou)) return
        this.emit("diagnostic", { code: "call-microfone-recuperado", detail: `${morte} · ${Date.now() - inicio} ms` })
        this.#vigiaDoMicrofone.ligar()
        return
      } catch (erro) {
        ultimo = erro
        this.emit("diagnostic", {
          code: "call-microfone-nao-reabriu",
          detail: `${(erro as Error)?.name ?? "erro"}: ${String((erro as Error)?.message ?? erro)}`,
        })
      }
    }
    this.emit("diagnostic", { code: "call-microfone-desistiu" })
    this.emit("error", {
      detail: "could not open the microphone",
      cause: {
        nome: String((ultimo as Error)?.name ?? ""),
        mensagem: String((ultimo as Error)?.message ?? ultimo),
        chave: chaveDoErroDoBrowser(ultimo),
      },
    })
  }

  /**
   * Open the microphone again and put the new track in the place of the old
   * one.
   *
   * The same device (`exact`), and if it no longer exists, whatever there is,
   * noted in the log like on entry (`microfone-escolhido-sumiu`). The same
   * processing (voice chain, or gain and filter). The same silence, if the
   * person was muted. The camera is untouched: it is the same track as before.
   *
   * On the wire, the new track enters the SAME sender (`replaceTrack`): via SFU
   * through the engine's `trocarFaixaDoMicrofone`, on the mesh to each peer. The
   * cipher hangs on the sender, so the new track leaves encrypted from the first
   * frame, no new producer or new offer.
   *
   * @returns `false` if the call changed state in the meantime (and the new
   * capture was already dropped).
   */
  async #reabrirMicrofone(vida: string): Promise<boolean> {
    const comCadeia = this.audio.ativa
    const tratamento = this.#tratamentoNativo(comCadeia)
    const escolhido = this.audioSettings?.inputDeviceId
    let bruto: MediaStream
    if (escolhido) {
      try {
        bruto = await navigator.mediaDevices.getUserMedia({ audio: { ...tratamento, deviceId: { exact: escolhido } }, video: false })
      } catch {
        this.emit("diagnostic", { code: "microfone-escolhido-sumiu", detail: escolhido })
        bruto = await navigator.mediaDevices.getUserMedia({ audio: tratamento, video: false })
      }
    } else {
      bruto = await navigator.mediaDevices.getUserMedia({ audio: tratamento, video: false })
    }
    const crua = bruto.getAudioTracks()[0]
    if (this.#joinId !== vida || !this.#channel || !crua) {
      for (const faixa of bruto.getTracks()) faixa.stop()
      // An audio capture with no audio track: counts as one that did not open.
      if (!crua && this.#joinId === vida) throw new Error("could not open the microphone")
      return false
    }

    const video = this.#local?.getVideoTracks() ?? []
    const velhaSaida = this.#local?.getAudioTracks()[0] ?? null
    const velhasCruas = (this.#capturaCrua ?? this.#local)?.getAudioTracks() ?? []
    // The gain and filter from the old capture, if they existed. The voice chain
    // drops inside `tratarCaptura`.
    void this.#processador?.close().catch(() => {})
    this.#processador = null

    let saida: MediaStreamTrack = crua
    const tratada = comCadeia ? await this.audio.tratarCaptura(bruto, this.inputGain) : null
    if (tratada) {
      saida = tratada.getAudioTracks()[0] ?? crua
    } else {
      if (comCadeia) await crua.applyConstraints(this.#tratamentoNativo(false)).catch(() => {})
      if (this.inputGain !== 1 || this.filtroDeMicrofone) saida = this.#comTratamento(bruto).getAudioTracks()[0] ?? crua
    }

    saida.enabled = !this.#muted
    this.#capturaCrua = saida === crua ? null : new MediaStream([crua, ...video])
    this.#local = new MediaStream([saida, ...video])

    if (this.#motor) {
      await this.#motor.trocarFaixaDoMicrofone(saida)
    } else {
      for (const peer of this.#peers.values()) {
        const emissor = peer.connection.getSenders?.().find((cada) => cada.track === velhaSaida)
        if (emissor) await emissor.replaceTrack(saida)
      }
    }
    for (const faixa of velhasCruas) if (faixa !== crua) faixa.stop()
    if (velhaSaida && velhaSaida !== saida) velhaSaida.stop()

    this.emit("local", { stream: this.#local })
    return true
  }

  async #join(
    channel: string,
    options: { video?: boolean; room?: string } = {},
    transicao: { manterCaptura?: boolean } = {},
  ): Promise<void> {
    /**
     * Clicking the room you are already in is not joining again: it is doing
     * nothing.
     *
     * The sidebar calls this on every click in a voice room, and the join
     * starts with `#leave(true)`, so the click from someone already there
     * sent a `voice.leave`, closed the producers in the router, stopped the
     * capture, and joined from scratch. For the others, the person VANISHED
     * and REAPPEARED because of a click with no intention behind it; and while
     * remounting did not exist, what stayed on their screen was "connecting"
     * forever. It is the same mechanics as a socket drop, with a finger instead
     * of a network.
     *
     * **The comparison includes video on purpose.** Being in voice and asking
     * for video in the SAME room is a different request, and that one still
     * redoes the join as it did. What we refuse here is only the request that
     * is strictly the same as the state you are already in.
     *
     * If someone really wants to redo a call that went bad, they disconnect and
     * join: a gesture that says what they want, instead of a click that did
     * not.
     */
    if (this.#channel === channel && this.#room === (options.room ?? "") && this.#video === (options.video ?? false)) {
      this.emit("diagnostic", { code: "call-entrada-repetida" })
      return
    }

    /**
     * The first line of the join in the log, before anything that can fail.
     *
     * **Written because there was none.** On August 17, 2026 the owner
     * copied the diagnostics right after a call that did not join, and there
     * was not a single `call-` line in it: the join broke before the engine
     * even existed, and everything the call knows to say about itself came out
     * after that. A log that only speaks when things go right describes exactly
     * the cases nobody needs to investigate.
     *
     * Sits at the top on purpose, before the media gate, before
     * `getUserMedia`, before the SFU. What it says on its own is "there was an
     * attempt, at this time"; what comes next says which way it went and where
     * it died. An attempt with nothing after it is already an answer: it died
     * in capture.
     *
     * Mechanics and nothing else, like all the rest of the log: whether voice
     * or video, and whether in a room. **The room name does not go**, the
     * person who wrote it made a choice, and a log copied into a conversation
     * does not carry text that someone wrote.
     */
    this.emit("diagnostic", {
      code: "call-entrada",
      detail: `${options.video ? "vídeo" : "voz"}${options.room ? " numa sala" : ""}`,
    })

    if (this.#channel) await this.#leave(true, transicao.manterCaptura === true)
    const guardada = this.#capturaGuardada
    this.#capturaGuardada = null
    // Belt and braces: whatever the state machine believes, no capture this
    // object opened outlives the start of the next one. The screen goes in too:
    // the share was from the call that ended, and sending the monitor to a room
    // you left is showing it to someone who never asked for it.
    for (const track of this.#local?.getTracks() ?? []) track.stop()
    this.#largarGanho()
    // The screen by the same rule, and with more reason than the microphone:
    // a share that crossed into another room was someone's screen going to people
    // who never asked for it.
    this.#largarEcra()
    // And music by the same reason: it was for the room that ended.
    this.#largarMusica()

    this.#channel = channel
    // The cipher now derives from this call's channel. Before it read `#channel`
    // from inside; now that it is a separate object, whoever enters tells it where
    // we are, and it is the same line in both engines.
    this.#cifra.canal = channel
    this.#room = options.room ?? ""
    this.#video = options.video ?? false
    /**
     * New life, new number, and before any announcement goes out.
     *
     * Random, not a counter: a counter restarted on each page reload, which is
     * precisely the case this has to catch, the second life of someone who
     * reloaded would be called "1" again and mixed up with the first, which is
     * the entire failure.
     */
    this.#joinId = novoJoinId()

    this.#afk = this.#room !== "" && (await this.bridge.salaAfk?.(channel, this.#room)) === true
    if (this.#afk) {
      for (const track of guardada?.getTracks() ?? []) track.stop()
      await this.#entrarSemVoz(channel)
      return
    }

    /*
      From here on there is a call and no microphone yet, and anyone building
      a peer in this window has to wait. See `#capturaEmCurso`.
    */
    let capturaPronta!: () => void
    let capturaFalhou!: (erro: unknown) => void
    this.#capturaEmCurso = new Promise<void>((resolver, rejeitar) => {
      capturaPronta = resolver
      capturaFalhou = rejeitar
    })
    // Whoever is waiting handles the failure on their own; without this, a
    // capture rejected with no one listening would be an unhandled rejection
    // going up to the process.
    this.#capturaEmCurso.catch(() => {})

    // Open the permission gate first, or the request below is refused by the
    // very policy meant to protect it.
    await this.bridge.setMediaActive?.(true)

    try {
      // Requested at the moment of joining, never at startup. "Is my microphone
      // live" should have an answer the user just chose.
      /**
       * Audio processing happens on the speaker's machine.
       *
       * These three things are done by the browser, here, before a single byte
       * goes out, and that is why they can be turned on without caveats. Almost
       * everything else that improves audio involves sending the voice to a
       * server, which in this product is not an option.
       *
       * Configurable because they get in the way in real cases: the suppressor
       * eats the start of words in quiet voices, and auto gain makes silence
       * breathe in large rooms.
       */
      const audio = this.audioSettings ?? {}
      // With the voice chain on the way, the native suppressor is not asked for:
      // see `#tratamentoNativo` and `audio/controlo.ts`.
      const comCadeia = this.audio.ativa
      const tratamento = this.#tratamentoNativo(comCadeia)
      /**
       * The fallback when the chosen device no longer exists.
       *
       * Headphones unplugged between two calls, a webcam that came out of USB:
       * the saved ID no longer points to anything, and an `exact` on it makes
       * the entire capture FAIL. Without this, the person could not join any
       * call because of a device that no longer exists, and with nothing on
       * the screen linking the two together.
       *
       * Try the choice for real, and only if that fails do we open what there
       * is, dropping one device at a time: camera first, then microphone, then
       * both. That way the log says which one disappeared, and the other choice
       * still gets honoured. In this order, because the opposite, always asking
       * with `ideal`, never fails and never honours: the browser would pick on
       * its own and no one would know the choice had been set aside. The saved
       * choice is not erased here: whoever made it can plug the device back in,
       * and forgetting it because it is unplugged once would be deciding for
       * them.
       */
      const semCamaraEscolhida = this.#video ? videoConstraints(this.videoQuality) : false
      const camaraEscolhida = this.#video && this.videoDeviceId ? this.videoDeviceId : ""
      // In "auto" the `videoConstraints` returns `true`, which takes no fields: the
      // `exact` goes alone, and the browser picks the quality.
      const comCamara: MediaTrackConstraints | boolean = camaraEscolhida
        ? {
            ...(typeof semCamaraEscolhida === "object" ? semCamaraEscolhida : {}),
            deviceId: { exact: camaraEscolhida },
          }
        : semCamaraEscolhida
      const comMicrofone: MediaTrackConstraints = audio.inputDeviceId
        ? { ...tratamento, deviceId: { exact: audio.inputDeviceId } }
        : tratamento
      // The capture that came from a move stays as is: it is the same microphone,
      // with the same permission, and processing redoes on top of it.
      const abrir = (a: MediaTrackConstraints, v: MediaTrackConstraints | boolean): Promise<MediaStream> =>
        guardada ? Promise.resolve(guardada) : navigator.mediaDevices.getUserMedia({ audio: a, video: v })

      try {
        this.#local = await abrir(comMicrofone, comCamara)
      } catch (erro) {
        const avisoDaCamara = { code: "camara-escolhida-sumiu", detail: camaraEscolhida }
        const avisoDoMicrofone = { code: "microfone-escolhido-sumiu", detail: audio.inputDeviceId ?? "" }
        const tentativas: Array<{
          audio: MediaTrackConstraints
          video: MediaTrackConstraints | boolean
          avisos: Array<{ code: string; detail: string }>
        }> = []
        if (camaraEscolhida) tentativas.push({ audio: comMicrofone, video: semCamaraEscolhida, avisos: [avisoDaCamara] })
        if (audio.inputDeviceId) tentativas.push({ audio: tratamento, video: comCamara, avisos: [avisoDoMicrofone] })
        if (camaraEscolhida && audio.inputDeviceId) {
          tentativas.push({ audio: tratamento, video: semCamaraEscolhida, avisos: [avisoDaCamara, avisoDoMicrofone] })
        }
        let ultimo: unknown = erro
        let aberto: MediaStream | undefined
        for (const tentativa of tentativas) {
          try {
            aberto = await abrir(tentativa.audio, tentativa.video)
          } catch (outro) {
            ultimo = outro
            continue
          }
          for (const aviso of tentativa.avisos) this.emit("diagnostic", aviso)
          break
        }
        if (!aberto) throw ultimo
        this.#local = aberto
      }

      /**
       * The voice chain, before the track leaves for WebRTC and before the
       * cipher.
       *
       * If it does not start (browser without `AudioWorklet`, or a failure to
       * set it up), the call goes the old way, and the native suppressor is
       * asked for on the raw track: nobody ends up worse off than they were.
       */
      const bruto = this.#local
      const tratada = comCadeia ? await this.audio.tratarCaptura(bruto, this.inputGain) : null
      if (tratada) {
        this.#capturaCrua = bruto
        this.#local = tratada
      } else {
        if (comCadeia) {
          await bruto
            .getAudioTracks()[0]
            ?.applyConstraints(this.#tratamentoNativo(false))
            .catch(() => {})
        }
        if (this.inputGain !== 1 || this.filtroDeMicrofone) this.#local = this.#comTratamento(bruto)
      }
      // There are tracks: whoever was waiting to build a peer can go ahead.
      capturaPronta()
    } catch (error) {
      capturaFalhou(error)
      this.#capturaEmCurso = null
      this.#channel = null
      this.#cifra.canal = null
      this.#room = ""
      // The phrase below goes to the screen and stays there. The log carries the
      // error name, which is what tells a refused permission apart from a device
      // that disappeared mid-way, two failures with the same phrase and opposite
      // fixes.
      this.emit("diagnostic", {
        code: "call-captura-falhou",
        detail: `${(error as Error)?.name ?? "erro"}: ${String((error as Error)?.message ?? error)}`,
      })
      await this.bridge.setMediaActive?.(false)
      // The browser error name goes in `cause`: it is what makes the phrase say
      // "permission" for a refusal and "another application" for a busy microphone.
      this.emit("error", {
        detail: this.#video ? "could not open the camera or the microphone" : "could not open the microphone",
        cause: {
          nome: String((error as Error)?.name ?? ""),
          mensagem: String((error as Error)?.message ?? error),
          chave: chaveDoErroDoBrowser(error),
        },
      })
      throw error
    }

    /**
     * Silence applies to the capture before it is offered to anyone.
     *
     * Here and not in the interface: tracks are born active, and waiting for a
     * component to react to `local` left the muted speaker's voice in the air
     * during that window, short, but long enough to say out loud what you were
     * going to say before turning the microphone on.
     */
    this.setMuted(this.#muted)

    this.emit("local", { stream: this.#local })
    // The capture is ready: the watcher now watches for its silent death.
    if (this.#local?.getAudioTracks().length) this.#vigiaDoMicrofone.ligar()

    /**
     * The fork, and it is the only one in the file.
     *
     * From here down, with an SFU engine, not a line of mesh runs: no
     * announcement repeating to serve as recovery, no echo stored to answer, no
     * offer to build. None of that makes sense when a server is routing, the
     * periodic announcement existed because a lost `voice.join` left two people
     * waiting for each other, and with SFU the gateway is who introduces them,
     * with `sfu.producer.new`.
     *
     * The `voice.join` still goes out, and still is the roster: who is in the
     * call, muted or not, sharing or not. It stopped firing negotiation.
     */
    /*
      The `await` is not decoration: without it this is always true.

      The desktop bridge answers with a promise, because its session is on the
      other side of IPC, and a promise is an object, and an object is always
      true. Without this word, the installed application joined via SFU against
      ALL servers, including ones with no media engine at all: the call
      negotiates with a port that does not exist and never connects. It is the
      exact opposite of what this gate exists to guarantee.
    */
    const servidorEncaminha = (await this.bridge.sfu?.suportaSfu()) === true

    /**
     * The second half of the gate: the server knows how to route, and we know
     * how to encrypt?
     *
     * **These are two questions, not one, and the second was missing.** With an
     * SFU, media crosses a machine that belongs to neither side: without SFrame
     * on top, whoever routes hears. On the mesh there is no such jump, DTLS-SRTP
     * is end-to-end because there are no ends in between -, and that is why the
     * same lack of cipher is bearable on one path and not the other.
     *
     * And it was not just a matter of privacy: without this question the join
     * BROKE. `createEncodedStreams` does not exist on Firefox or Safari, and
     * the call would mount all the way to the producer to find that out, the
     * error rose from inside the `join`, the engine came down, and what the
     * person saw was the call appear and disappear in milliseconds. Reported in
     * production on August 17, 2026, with both symptoms: the error on startup
     * and the flicker of whoever joined next.
     *
     * Falling back to mesh is the right answer, not a patch: it is the path
     * this client knows how to take without media cipher, it is what these
     * engines were using yesterday, and the `voice.join` still tells the truth
     * about what we can do (`sframe: mediaE2EE`) so the other side does not
     * encrypt against a wall.
     */
    const semCifra = cifraDeMediaEmFalta(this.bridge.criarWorkerDeCifra?.bind(this.bridge))
    if (servidorEncaminha && semCifra) {
      this.emit("diagnostic", { code: "call-sfu-sem-cifra-de-media", detail: semCifra })
    }

    /*
      The path this call takes, decided at the moment we choose it.

      It differs from `call-sfu-ligado`, and we need both: that one says the
      engine started, this one says what we picked. Everything that can go wrong
      mounting the SFU fits between them, and without the first half a failure
      there reads as if we never tried.

      And it answers the question the UI cannot: two people in the same room can
      be on different paths, one in Chrome via SFU, the other in Firefox via mesh
      , and without this written down there is no way to know which one we are
      seeing.
    */
    this.emit("diagnostic", {
      code: "call-caminho",
      detail: servidorEncaminha ? (semCifra ? "malha: sem cifra de media" : "sfu") : "malha: servidor sem sfu",
    })

    /*
      Before the fork, and it guarantees both paths lead through it.

      Presence in a voice room has nothing to do with where media goes: someone
      outside looking at the sidebar sees the same thing in an SFU call and in a
      mesh call. Putting it inside one of the branches was writing the bug again
      , that is how the SFU path ended up without any periodic announcement and
      the list of who is in the call started emptying out after forty-five
      seconds.
    */
    this.#comecarBatimento(channel)
    // Its pair: while we reaffirm our presence, we distrust the others at the same
    // rate. Up here for the same reason as the heartbeat.
    this.#comecarVarrimento(channel)

    if (servidorEncaminha && !semCifra) {
      await this.#entrarPorSfu(channel)
      await this.#anunciar(channel)
      return
    }

    await this.#anunciar(channel)
    this.#comecarAnuncio(channel)

    // Anyone who was here and announced before we entered will never do it again.
    //
    // Answering an echo is an extra, and an extra cannot break the entry. It runs
    // inside the promise of `join`, and a negotiation that fails, a malformed ICE
    // server from the homeserver breaks right in the constructor, would make
    // `join()` reject with the call already running: the UI closes the panel,
    // `#channel` is set, capture stays open, and the mic light goes off by closing
    // the tab.
    const ouvidos = this.#heardBeforeJoining.get(channel) ?? []
    this.#heardBeforeJoining.delete(channel)
    const agora = Date.now()
    for (const eco of ouvidos) {
      if (agora - eco.at > HEARD_WINDOW_MS) continue
      try {
        await this.handleSignal(channel, eco.from, eco.payload)
      } catch (error) {
        // Stated, never swallowed: anyone who did not call must know they did not call.
        this.emit("error", erroDaChamada(error, "call signalling failed"))
      }
    }
  }

  /**
   * An announcement, with the truth about our state.
   *
   * `alone` is calculated at send time and never assumed: it is the difference
   * between "I have no connection at all, offer me one" and "I am answering so
   * you will offer". See `voice.join` in the protocol.
   *
   * `muted` travels for the same reason: whoever announces says everything the
   * other side needs to know to draw them without guessing.
   */
  /**
   * Join the AFK room: be there, and nothing else (2/11/2026).
   *
   * "The room is like any other but it does not receive text, and there is no
   * voice" (the owner). Others see us in the room list, and that is all that
   * gets set up:
   *
   * - **no microphone**: we do not open capture, nor the host media gate. The
   *   announcement says `muted: true` always (see `#anunciar`);
   * - **no SFU**: we do not enter the scope, there are no transports or
   *   producers. The server has no way to refuse media here because it does not
   *   know what room this is (the flag travels encrypted in `channel.meta`, and
   *   the scope is a digest). The rule is on the client, and that is why it
   *   lives in the core and not in the UI;
   * - **no mesh**: we offer it to no one, and offers that arrive (from a client
   *   1.0.6 that does not know the flag) we ignore. See `#sinalSemVoz`.
   *
   * The heartbeat and the sweep run as in any call: they are what keep presence
   * alive in the list of the others.
   */
  async #entrarSemVoz(channel: string): Promise<void> {
    this.#video = false
    this.#capturaEmCurso = null
    this.#local = null
    this.emit("local", { stream: null })
    this.emit("diagnostic", { code: "call-caminho", detail: "afk: sem voz" })
    this.#comecarBatimento(channel)
    this.#comecarVarrimento(channel)
    await this.#anunciar(channel)
    this.#announce()
    // Anyone who was here and announced before we entered goes into the roster.
    const ouvidos = this.#heardBeforeJoining.get(channel) ?? []
    this.#heardBeforeJoining.delete(channel)
    const agora = Date.now()
    for (const eco of ouvidos) {
      if (agora - eco.at > HEARD_WINDOW_MS) continue
      this.#sinalSemVoz(eco.from, eco.payload)
    }
  }

  /**
   * Voice signaling in the AFK room: roster, never negotiation.
   *
   * The same roster as SFU (`#rosterSfu`), with the same sweep by expiry,
   * because it is the same question: who is here, with no media in the way.
   */
  #sinalSemVoz(from: UserAddress, payload: Payload): void {
    if (payload.t === "voice.join") {
      const novo = !this.#rosterSfu.has(from)
      this.#rosterSfu.set(from, {
        video: false,
        micMuted: true,
        screen: false,
        aVer: [],
        aTocar: null,
        quando: Date.now(),
      })
      this.#announce()
      // Answer anyone arriving, like in SFU: our announcement went out before they
      // had ears. Only to newcomers, to avoid ping-pong.
      if (novo && this.#channel) {
        void this.#anunciar(this.#channel).catch((erro: unknown) => {
          this.emit("error", erroDaChamada(erro, "could not announce you in the call"))
        })
      }
      return
    }
    if (payload.t === "voice.leave") {
      this.#rosterSfu.delete(from)
      this.#announce()
      return
    }
    if (payload.t === "voice.offer") this.emit("diagnostic", { code: "call-afk-oferta-ignorada", detail: from })
  }

  async #anunciar(channel: string): Promise<void> {
    const caidos = [...this.#perdidos].filter(([, estado]) => estado === "caiu").map(([quem]) => quem)
    /*
      Who we are seeing, INTERSECTED with who is present.

      Computed here and not pruned at the exit gates, and the difference is who
      pays for the error. The pruning used to live at the `#drop` gate, which
      runs in four ICE failure paths where the person STAYS, a repair request, a
      new life for the same pair, the connection clock ticking, the connection
      falling to `failed`. On a bad network, which is the terrain of this app,
      anyone watching a screen had to hit "View" again after each hiccup: on a
      `failed` the connection resumes and the image comes back by itself, and what
      did not come back was the choice.

      Here presence is KNOWN, and the set can no longer name absent people even
      if a new gate forgets to prune. The two rosters go to the question because
      they are two paths: `#rosterSfu` in the server one, `#peers` in the mesh.
    */
    const aVer = [...this.#ecrasAceites]
      .filter((quem) => this.#rosterSfu.has(quem) || this.#peers.has(quem))
      .slice(0, TECTO_DO_AVER)
    await this.bridge.sendSignal(channel, {
      t: "voice.join",
      at: Date.now(),
      video: this.#video,
      sframe: mediaE2EE,
      alone: this.#peers.size === 0,
      /*
        Who we are seeing, for whoever shares the knowledge.
        
        Only goes out when there is someone: the field is optional and an empty
        list on the wire would be bytes saying "nothing" in each heartbeat,
        seventy-two times an hour per person. Absent already reads as seeing no
        one.
        
        Goes in the announcement and not in its own frame because that is what
        makes it arrive: the announcement is the heartbeat, so the answer
        reaffirms itself to anyone joining midway. Its own frame sent once would
        be lost to anyone arriving after.
        
        **Capped at the schema limit, and this is a belt over the suspenders.**
        The intersection up there already limits it to what a call has in people,
        and a call has sixteen. But the price of a wrong count is not an
        incomplete list: it is `encodePayload` calling `Payload.parse`, throwing,
        `#anunciar` breaking, no `voice.join` of ours going out, and at 160s
        everyone dropping us from the roster, invisible and inaudible, still
        sending media, with no recovery except leaving and entering again. Between
        truncating and that there is no comparison to make. `TECTO_DO_AVER` is
        read and not repeated: two copies of the same number would disagree on
        the day someone changed one.
        */
      ...(aVer.length > 0 ? { aVer } : {}),
      /*
        Who we ask to remake the connection, and it is the field that was
        missing.
        
        `alone` answers "I have no peer at all"; the question that matters is
        "do I still have YOU?". With two people both give the same answer, with
        three they stop, and that is where the difference cost a call.
        
        **Only those who FELL, not those we are waiting for.** This list used to
        come whole from `#perdidos`, which stores two states with the same name
        (see there). Asking for repair says "the connection you think you have
        with me is dead, throw it away", and only those who had a connection
        that died know that. About those we are only waiting for we know nothing:
        what they have, at that instant, is the offer our own announcement just
        asked them for, fresh born. Telling them to throw it away was destroying
        the repair we asked for.
        
        Reproduced on 16 August 2026 with browsers for real, and written by the
        product log in fifteen milliseconds: two `call-reparar-pedido` from the
        same pair, the second breaking the connection the first told to build. One
        extra connection per person in each setup of three, and the principle of
        "keep connecting until it breaks" when the thing repeats.
        */
      ...(caidos.length > 0 ? { reparar: caidos } : {}),
      // In the AFK room the microphone does not exist, and we always say muted.
      muted: this.#muted || this.#afk,
      ...(this.#joinId ? { joinId: this.#joinId } : {}),
      ...(this.#room ? { room: this.#room } : {}),
      ...this.#oQueDizemosDoEcra(),
      // We know how to send and receive screen audio in the mesh. See `#peerEcraSom`.
      ecraSom: true,
      // And music. See `#peerMusica`.
      musica: true,
      ...this.#oQueDizemosDaMusica(),
    })
  }

  /** What we say about our music: the name, only while it plays. See `aTocar`. */
  #oQueDizemosDaMusica(): { aTocar?: string } {
    if (!this.#musica || !this.#aTocar) return {}
    return { aTocar: this.#aTocar }
  }

  /**
   * What we say about our screen, in the three frames that already exist.
   *
   * Omitted entirely when there is no sharing, not set to `false`: a missing
   * field is what an old client writes, and that is how the newer one keeps
   * looking like it while there is nothing to add.
   *
   * `screenStream` goes in knowing the other side will almost never be able to
   * compare it, the track travels without `msid` because `replaceTrack` does
   * not write it. It stays for the reason in the schema: whoever renegotiates
   * one day has there an exact id that does not depend on positions.
   */
  #oQueDizemosDoEcra(): { screen?: true; screenStream?: string } {
    if (!this.#ecra) return {}
    return { screen: true, screenStream: this.#ecra.id }
  }

  /**
   * Repeat the announcement while there is not a single peer.
   *
   * A single announcement does not survive any time difference. Anyone joining a
   * call that is already running missed the announcement of anyone there, they
   * arrived before there were ears, and anyone there has no reason to repeat
   * it. The result is what was seen live: two announcements on the server, one
   * from each side, and no offer between them.
   *
   * Stops at the first peer or at the end of a minute, to not leave an empty
   * room talking to itself. Also runs after we lose the last peer, a network
   * drop takes both connections down at once, and without this no one announces
   * again: the two stay in the same call, alone, forever.
   */
  #comecarAnuncio(channel: string): void {
    this.#stopAnnouncing()
    let restantes = 12
    this.#announceTimer = setInterval(() => {
      // Stops when we owe nothing to nobody: either there is already a peer and no
      // one missing, or we have burned through the twelve tries. `#perdidos` is what
      // tells "I am accompanied" from "I am accompanied AND someone is missing", and
      // that difference did not exist.
      const acompanhado = this.#peers.size > 0 && this.#perdidos.size === 0
      if (this.#channel !== channel || acompanhado || restantes-- <= 0) {
        this.#stopAnnouncing()
        return
      }
      void this.#anunciar(channel).catch((erro: unknown) => {
        // It was `catch(() => {})`, and this is the mechanism that should recover a
        // lost connection: if the announcement does not go out, no one notices and the
        // person stays seeing "connecting" with nothing, nowhere, saying why.
        this.emit("diagnostic", { code: "call-anuncio-falhou", detail: String((erro as Error)?.message ?? erro) })
      })
    }, 5000)
  }

  /** How long we wait before reaffirming, to batch arrivals together. */
  static readonly REAFIRMACAO_ADIADA_MS = 400

  /**
   * Minimum interval between two presence queries on the SAME channel.
   *
   * The trigger for the query is the connection coming back, and a shaky socket
   * comes back many times in a row: without this, each comeback cost one MLS
   * message per channel, twenty channels, twenty encrypted messages, logged in
   * `events` and routed to all members, most for channels with no call at all.
   *
   * **The heartbeat, not a number apart.** The query exists so we do not wait
   * for the heartbeat of `PRESENCA_REAFIRMADA_MS`; two queries within one
   * heartbeat cannot say more than the first plus the heartbeat already coming.
   * Shorter would not buy information; longer would leave a real reconnect
   * without an immediate answer.
   */
  static readonly PERGUNTA_MINIMO_MS = PRESENCA_REAFIRMADA_MS

  /**
   * When we last queried in each channel.
   *
   * Per channel and not one clock only: queries go out in a batch, but a channel
   * we just entered was never queried and cannot inherit the wait from another.
   * It lives as long as this object, which is as long as the app is open, a
   * page reload is a new query, and that is what we want.
   */
  #perguntasFeitas = new Map<string, number>()

  /**
   * The presence heartbeat, which lasts as long as the call does.
   *
   * No stop condition at all, unlike `#comecarAnuncio`: this one does not serve
   * the negotiation, it serves anyone outside looking at the sidebar. While
   * there is a call, there is someone who needs to know it exists.
   */
  #comecarBatimento(channel: string): void {
    this.#pararBatimento()
    this.#batimentoTimer = setInterval(() => {
      // The join can have broken after this started, `#entrarPorSfu` breaks the join
      // on purpose, and a clean exit will have stopped it. The guard is the same in
      // both cases and costs nothing.
      if (this.#channel !== channel) {
        this.#pararBatimento()
        return
      }
      void this.#anunciar(channel).catch((erro: unknown) => {
        this.emit("diagnostic", { code: "call-batimento-falhou", detail: String((erro as Error)?.message ?? erro) })
      })
    }, PRESENCA_REAFIRMADA_MS)
  }

  #pararBatimento(): void {
    if (this.#batimentoTimer) clearInterval(this.#batimentoTimer)
    this.#batimentoTimer = null
    if (this.#reafirmacaoTimer) clearTimeout(this.#reafirmacaoTimer)
    this.#reafirmacaoTimer = null
  }

  /**
   * The roster sweep: anyone who does not reaffirm in a long time is not here.
   *
   * The twin of `#comecarBatimento`, and the reason it is the twin and not a
   * line inside it: that one ANNOUNCES our presence, this one DISTRUSTS theirs.
   * At the same rate because it is the same clock both measure, their heartbeat
   * reaches us at the rate ours goes out.
   *
   * Starts before the fork in `#join`, with the heartbeat, and for the same
   * reason written there: presence has nothing to do with where media goes, and
   * putting this inside one of the branches left the SFU path with no safety net.
   * In a mesh call the roster is empty and the sweep has nothing to do, which is
   * the right behavior, anyone leaving a mesh tears the connection down, and
   * the fall is the warning.
   */
  #comecarVarrimento(channel: string): void {
    this.#pararVarrimento()
    this.#varrimentoTimer = setInterval(() => {
      if (this.#channel !== channel) {
        this.#pararVarrimento()
        return
      }
      this.#varrerRoster()
    }, PRESENCA_REAFIRMADA_MS)
  }

  #pararVarrimento(): void {
    if (this.#varrimentoTimer) clearInterval(this.#varrimentoTimer)
    this.#varrimentoTimer = null
  }

  /**
   * Drop from the roster anyone who does not reaffirm within the window.
   *
   * `now - when`, never the other way: a future timestamp is clock drift
   * between two computers, and distrusting it throws out of the call someone who
   * is really there. It is the same math, and for the same reason written, as
   * `presencasVivas` in `packages/ui/src/lib/presenca.ts`, and now with the
   * same window, which moved here to not have two.
   *
   * Announces once, only if anything changed. A sweep that announced every time
   * would be a redraw of the whole call at each heartbeat, for nothing.
   */
  #varrerRoster(): void {
    if (this.#rosterSfu.size === 0) return
    const agora = Date.now()
    let mudou = false
    for (const [quem, estado] of this.#rosterSfu) {
      if (agora - estado.quando <= PRESENCA_VALIDA_MS) continue
      this.#rosterSfu.delete(quem)
      // Anyone who expired from the roster left the call, and with them goes our
      // choice to watch their screen: three heartbeats without a `voice.join` from
      // them and their card already vanished from everyone's screen.
      this.#esquecerEscolhaDeEcra(quem)
      /*
        And here, only here, we also close the tap on the server.

        **It is the only gate where the consumer can outlive the choice.** In the
        other three media dies with whoever left, and the server says so: a
        `voice.leave` pulls a `sfu.scope.leave` behind, and a connection that
        falls pulls the gateway's `#largarMedia`, in both cases a
        `sfu.producer.closed` arrives and the engine drops the consumer by itself.
        This gate is the exception: what expired was the ENCRYPTED roster, and
        the media connection can be alive and the producer forwarding. Without
        this pause a consumer at 2.5 Mbps with no choice naming it would stay,         and with our `aVer` already saying we are not watching them, so whoever
        shares does not know either.

        Best effort and without stalling the sweep: the frame already goes inside
        a `try/catch` that reduces it to logging, and with no consumer to pause
        no frame reaches the server. With `catch` still, and for the reason of
        always in this file: this runs outside any `await`, and an uncaught
        rejection here does not fail a sweep, it climbs to the top of the
        renderer.
      */
      void this.#motor?.largarEcraDe(quem).catch((erro: unknown) => {
        this.emit("diagnostic", { code: "call-ecra-caducado-nao-pausou", detail: `${quem} · ${(erro as Error).message}` })
      })
      mudou = true
      // Logged: a person who vanishes from everyone's screen without hitting
      // disconnect is something someone will ask about eventually.
      this.emit("diagnostic", { code: "call-presenca-caducou", detail: quem })
    }
    if (mudou) this.#announce()
  }

  /**
   * This person left the call: the choice to watch their screen is no one's.
   *
   * A function and not a `delete` written four places, because there are four
   * gates by which you LEAVE a call, the announced goodbye, in both paths
   * (`voice.leave`, in mesh's `handleSignal` and in `#sinalPorSfu`), roster
   * expiry (`#varrerRoster`) and the server telling us someone disconnected
   * without saying goodbye (`desligouSeDoServidor`).
   *
   * **`#drop` is not one of them, and it already was.** It also runs when a
   * mesh connection remakes, and there the person stays: pruning there cost the
   * choice at each network hiccup. What it protected, the set naming absent
   * people, became an intersection with both rosters inside `#anunciar`, where
   * presence is known. See `#ecrasAceites`.
   *
   * **Does not touch the engine, and `#varrerRoster` does it from its gate.** By
   * these three, the consumer dies with the producer and the server says so
   * (`sfu.producer.closed` → `produtorFechado`): asking for a pause here to a
   * stream from someone already gone was a frame to the void. Roster expiry is
   * the exception, there the media connection can be alive, and the pause is
   * written there, with the reason at length.
   */
  #esquecerEscolhaDeEcra(address: UserAddress): void {
    this.#ecrasAceites.delete(address)
  }

  /**
   * Someone joined: tell them we are here.
   *
   * The heartbeat alone solves the problem with a delay of up to one beat, and
   * a delay like that is the difference between opening the app and seeing the
   * conversation happening, or opening the app and seeing an empty server. That
   * is what makes it immediate.
   *
   * **Who joins is announced by the server, and it is the only source with no
   * race condition.** The presence announcement goes out the moment the other
   * side SUBSCRIBES to the channel, so it already has ears up when this
   * responds. An announcement triggered by epoch change arrives earlier than
   * that and can slip past them: the server only forwards it to those already
   * subscribed, and voice signals are not recovered in the catch-up (`aoVivo`,
   * in `session.ts`). That is why both triggers exist, and why this one can be
   * trusted.
   *
   * Delayed by a fraction of a second, and that is what stops the storm: a
   * server coming back brings twenty people at once, and without this each one
   * would send twenty announcements if anyone were on a call. With this, it is
   * one.
   */
  reafirmarPresenca(): void {
    const channel = this.#channel
    if (!channel) return
    if (this.#reafirmacaoTimer) return
    this.#reafirmacaoTimer = setTimeout(() => {
      this.#reafirmacaoTimer = null
      if (this.#channel !== channel) return
      void this.#anunciar(channel).catch((erro: unknown) => {
        this.emit("diagnostic", { code: "call-reafirmacao-falhou", detail: String((erro as Error)?.message ?? erro) })
      })
    }, Call.REAFIRMACAO_ADIADA_MS)
  }

  /**
   * Ask who is on a call in each of these channels.
   *
   * The other half of voice presence, and the one that closes three gaps at
   * once. The list of who is in a room is made from the `voice.join` messages
   * this device HEARD, and those who left before we connected are not recovered
   * in the catch-up, voice signaling is live only, on purpose. What existed
   * was the server presence warning to make whoever is there re-announce, and
   * that warning has a condition: **whoever joins invisibly is not announced to
   * anyone**. It is right, and we do not change it. We change the other side:
   * whoever joins asks.
   *
   *  - the invisible one learns who is there;
   *  - whoever reloaded the page stops waiting for the 50 s heartbeat;
   *  - whoever opens the app in the middle of a call sees the room full in one
   *    round trip.
   *
   * **The question is asked from a room that does not exist**, and that is the
   * guard that protects clients that do not know it. It travels as a
   * `voice.leave` (see `quemEsta`, in the protocol), and in a 0.3.3 client a
   * `voice.leave` removes the person from the call roster, **and rosters are
   * indexed by ACCOUNT address, not device.** With no room, the absent `room`
   * reads as `""`, which is exactly the room of a channel call or direct
   * conversation: the laptop waking up erased the phone of the same account
   * from the screen of whoever was on that call, with output audio playing, and
   * only the next heartbeat brought it back, up to 50 seconds later. With
   * `SALA_DA_PERGUNTA`, the old client's room filter discards it before the
   * roster, before the audio and before the presence map, and nothing is lost:
   * it does not know how to answer anyway. A 0.4.0 client handles it BEFORE the
   * room filter, like `voice.move`, and so it keeps answering.
   *
   * **We do not ask in the channel where we are already on a call.** We already
   * know who is there, and the question asserts that we are not, the premise
   * must be true. (The sentinel is enough to keep the question from erasing us
   * from anyone else's screen; this guard exists as the premise, not as the
   * defense.)
   *
   * **At most one per channel every `PERGUNTA_MINIMO_MS`.** The trigger is the
   * connection coming back, and a socket reconnecting comes back many times:
   * with twenty channels, each return cost twenty MLS messages, encrypted,
   * logged in `events`, forwarded to all members -, most of them for channels
   * where no call is happening. Two questions within one heartbeat cannot say
   * more than the first one plus the heartbeat that is coming.
   *
   * Fire and forget, a question that does not go out breaks nothing, because
   * the 50 second heartbeat is still there as a safety net; what it does is not
   * wait for it.
   */
  perguntarQuemEsta(channels: readonly string[]): void {
    const agora = Date.now()
    for (const channel of channels) {
      if (channel === this.#channel) continue
      const ultima = this.#perguntasFeitas.get(channel)
      if (ultima !== undefined && agora - ultima < Call.PERGUNTA_MINIMO_MS) continue
      this.#perguntasFeitas.set(channel, agora)
      void this.bridge
        .sendSignal(channel, {
          t: "voice.leave",
          at: Date.now(),
          room: SALA_DA_PERGUNTA,
          quemEsta: true,
        })
        .catch((erro: unknown) => {
          // Said and not swallowed, like all signaling in this file. It is not a user
          // error: no feature fails because of it, we just wait for the heartbeat
          // again.
          this.emit("diagnostic", {
            code: "call-pergunta-falhou",
            detail: `${channel} · ${String((erro as Error)?.message ?? erro)}`,
          })
        })
    }
  }

  /**
   * Someone lost the server connection: remove them from the call, now.
   *
   * The flip side of `reafirmarPresenca`, and it has been waiting to be wired
   * since day one. The gateways heard the presence warning from the gateway and
   * used only half of it, the `online: true` made the call re-announce, and
   * the `online: false` was read and thrown away. The comment in
   * `packages/ui/src/lib/presenca.ts` already promised this half in writing
   * ("the presence warning from the server of someone who disconnected without
   * saying goodbye"), and it never reached the roster INSIDE the call: it
   * cleaned the sidebar of those outside and left the person on the screen of
   * those inside.
   *
   * **It is the only immediate warning that exists for those who do not say
   * goodbye.** Closing the tab, reloading, putting the laptop to sleep, or
   * losing the network does not send any `voice.leave`. And what the server
   * announces when the socket drops, `sfu.producer.closed`, closes the
   * STREAMS, not the person: without this they stay in the roster without a
   * stream, which is exactly how you draw someone who joined and has not yet
   * spoken. A "connecting" card forever.
   *
   * Only the SFU roster, on purpose: in the mesh the `RTCPeerConnection` with
   * that person is in charge, and its drop is already the warning, changing
   * that would give two answers to the same question.
   *
   * Removing someone not on the call is harmless and SILENT: almost everyone
   * who disconnects from the server was not on any call, and an announcement
   * for each one would redraw the call on the screen for no reason. Same reason
   * `semAPessoa` returns the original map.
   */
  desligouSeDoServidor(address: UserAddress): void {
    if (!this.#rosterSfu.delete(address)) return
    // For the same reason as in `#varrerRoster`: they left the call, so our choice
    // to see their screen stops counting for `aVer`. See `#esquecerEscolhaDeEcra`.
    this.#esquecerEscolhaDeEcra(address)
    this.#announce()
  }

  /**
   * The server connection came back: rebuild the media path of this call.
   *
   * **A socket drop takes the call with it, and nobody noticed.** The gateway,
   * when the socket dies, drops EVERYTHING that connection had in the media
   * engine, scope, transports and producers (`#largarMedia`, from `#drop`).
   * The session reconnects by itself and rebuilds what it can: authenticates,
   * subscribes, recovers what it lost. **Nothing rebuilt the media.** The
   * transports on this side kept pointing to objects that no longer exist on
   * the other, and there is no way to find that out from here: an SFU transport
   * has no one listening to its connection state, in the mesh there is, and
   * that is why the drop is the warning itself there.
   *
   * What you saw was exactly this, and it is asymmetric on purpose: whoever
   * reconnected stays in the encrypted roster of everyone, the presence
   * heartbeat knows nothing of media and comes back out, but their producer
   * died in the router and no one recreates it. They reappear on other screens
   * **without a stream**, which is how you draw someone who joined and has not
   * yet spoken: "connecting…", forever, while the others keep hearing each
   * other.
   *
   * Only the SFU path. In a mesh call the drop of each connection is the
   * warning, and whoever fixes it is the periodic announcement with `reparar`
   *, changing that here would give two answers to the same question.
   *
   * Through the QUEUE, like `join` and `leave`: this tears down and rebuilds
   * the entire call, and mixing it with an entry or exit in the middle is the
   * family of races the queue exists to prevent.
   */
  async ligacaoVoltou(): Promise<void> {
    const run = this.#queue.catch(() => {}).then(() => this.#refazerMedia())
    this.#queue = run.catch(() => {})
    return run
  }

  async #refazerMedia(): Promise<void> {
    const channel = this.#channel
    const motor = this.#motor
    // No call means nothing to redo, and no engine means the call is mesh.
    if (!channel || !motor) return

    this.emit("diagnostic", { code: "call-sfu-refazer", detail: motor.ambito ?? "" })

    /*
     * The old engine is dropped ENTIRELY, we do not try to repair it from
     * inside.
     *
     * Its two transports negotiate against objects the server already closed,
     * and there is no frame that brings them back: a mediasoup transport does
     * not reconnect, it is recreated. The `sfu.scope.leave` it sends lands on a
     * scope this connection is no longer in, and it is harmless.
     */
    motor.sair()
    this.#motor = null
    /*
     * The ROSTER is not cleared, and it is deliberate.
     *
     * The temptation is to clear it: it describes the call that died, and
     * whoever left during the drop had no way to tell us. But clearing it
     * leaves us blind until the next heartbeat for each person,      * `PRESENCA_REAFIRMADA_MS`, and during that time the call draws as empty
     * with everyone in it. Whoever really left drops by itself through
     * expiration (`#varrerRoster`), which is exactly the mechanism that exists
     * for warnings that did not arrive.
     */

    try {
      await this.#entrarPorSfu(channel)
    } catch (erro) {
      /*
       * It was not rebuilt. `#entrarPorSfu` already dropped everything the entry
       * opened, and what is left is to tell the screen the call ended: it dropped
       * it like a handoff, and a handoff does not emit `ended`, the panel would
       * stay open over a call that no longer exists.
       */
      const detalhe = String((erro as Error)?.message ?? erro)
      this.emit("diagnostic", { code: "call-sfu-refazer-falhou", detail: detalhe })
      /*
       * And told to the screen, not just the log.
       *
       * The panel closes with `ended`, and a panel that disappears by itself is
       * the worst way to deliver news: whoever was talking has no idea if they
       * hung up by mistake, got kicked, or the network fell. The message says
       * what happened and what to do.
       */
      // The reason, not the mechanics: the mechanics already went to diagnostics
      // right above, and a message built from it mixed the two languages on screen.
      // The call was already set up and it dropped: "did not set up" (401) was
      // false.
      this.emit("error", { detail: "the call dropped and did not come back" })
      this.emit("ended", { channel })
      return
    }

    await this.#voltarAPartilharOEcra()
    await this.#voltarAPartilharAMusica()
    // After the screen, never before: this announcement says `screen` from
    // `#ecra`, and sending it first would light the badge next to our name over a
    // share that had no path yet, or that already will not have one.
    await this.#anunciar(channel)
  }

  /**
   * The screen we were sharing, put in the new engine.
   *
   * The capture survived the drop, it is a browser object, not a connection,    * and with it the OS recording badge, lit. Its producer is what died in the
   * router. Without this half, whoever was sharing was left with the system
   * indicator on, with `voice.join` saying `screen: true` to everyone, and the
   * stage of the others empty waiting for an image that no longer had any path.
   *
   * **The refusal is an exit, not a warning.** Someone may have started
   * sharing during our drop, and the server takes only one screen: in that case
   * drop the capture instead of leaving it on feeding nothing. A recording
   * indicator over a share that does not exist is the worst of the two
   * failures.
   */
  async #voltarAPartilharOEcra(): Promise<void> {
    const faixa = this.#ecra?.getVideoTracks()[0]
    const motor = this.#motor
    if (!faixa || !motor) return

    try {
      if (await motor.partilharEcra(faixa, this.#somDoEcra)) return
    } catch (erro) {
      // The refusal reason (see `RecusaDoSfu`); the server's physical message goes
      // in `cause`, for diagnostics.
      this.emit("error", erroDaChamada(erro, "could not share the screen"))
    }
    this.emit("diagnostic", { code: "call-ecra-nao-voltou" })
    this.#largarEcra()
  }

  /**
   * The music we were playing, put in the new engine. See
   * `#voltarAPartilharOEcra`.
   *
   * The player keeps playing (it is local), and the producer died with the
   * router. A refusal here stops the call music and says so: the "Playing"
   * signal cannot stay lit over a track that no longer comes out.
   */
  async #voltarAPartilharAMusica(): Promise<void> {
    const faixa = this.#musica
    const motor = this.#motor
    if (!faixa || !motor) return
    try {
      if (await motor.partilharMusica(faixa)) return
    } catch (erro) {
      this.emit("error", erroDaChamada(erro))
    }
    this.emit("diagnostic", { code: "call-musica-nao-voltou" })
    this.#largarMusica()
  }

  async leave(): Promise<void> {
    const run = this.#queue.catch(() => {}).then(() => this.#leave())
    this.#queue = run.catch(() => {})
    return run
  }

  /**
   * @param aTransitar when this is the first half of an entry into another
   * room, not an exit. Exit and handoff drop the same resources, but only the
   * exit is an end, and `ended` is what tells the screen to close the call.
   * Emitted in a handoff, it would arrive after the new room interface was
   * already up and erase it: the call would appear and vanish in an instant.
   *
   * It is the same trap as phantom connections that erased their successor: an
   * end event that does not say which life is ending.
   */
  /**
   * @param manterCaptura (only with `aTransitar`) the microphone stays open for
   * the entry that follows: it is the move. See `#capturaGuardada`.
   */
  async #leave(aTransitar = false, manterCaptura = false): Promise<void> {
    const channel = this.#channel
    // Captured before being cleaned: the exit has to go to the room being left,
    // and cleanup happens below.
    const sala = this.#room
    if (!channel) return

    // Before stopping anything: a track we stopped is not a death.
    this.#vigiaDoMicrofone.desligar()
    this.#mortesDoMicrofone = []

    // The SFU engine drops both transports and tells the server it is leaving.
    // Done BEFORE everything else: as long as it exists, `#announce` draws from
    // the roster, and clearing the roster first put an empty call on screen in the
    // middle of falling apart.
    this.#motor?.sair()
    this.#motor = null
    this.#rosterSfu.clear()
    this.#afk = false

    for (const [, peer] of this.#peers) peer.connection.close()
    this.#peers.clear()

    for (const timer of this.#connectTimers.values()) clearTimeout(timer)
    this.#connectTimers.clear()
    this.#stopAnnouncing()
    // The presence heartbeat ends the call, not the negotiation: they are two
    // clocks with different lives, and that difference is why they exist.
    this.#pararBatimento()
    // And the sweep with it. A surviving sweep is an `#announce` of a call that
    // already ended, the family of the phantom connection that erased its
    // successor, and the reason `ended` takes everything that beats with it.
    this.#pararVarrimento()
    if (this.#microfoneTimer) {
      clearTimeout(this.#microfoneTimer)
      this.#microfoneTimer = null
    }
    this.#pendingIce.clear()
    this.#offering.clear()
    // We owe nothing to anyone after leaving: the missing retries were of this
    // call, and it is over.
    this.#perdidos.clear()
    this.#creating.clear()
    this.#ice = null
    // What each pair knows how to do is said at each entry, and a capability
    // saved from the previous call may no longer apply, the same person may have
    // come back in another browser. Guessing wrong to "cannot encrypt" costs a
    // call protected only by transport; guessing wrong the other way costs a call
    // perfectly silent.
    this.#peerSframe.clear()
    // For the same reason: the microphone of whoever was there is a fact of the
    // call that ended. Saving it for the next one would put a muted badge on
    // someone who joined speaking.
    this.#peerMuted.clear()
    // And the same for whoever was sharing: the share was from that call. Saving
    // it would put an open screen spot in the next call, waiting for an image no
    // one will send.
    this.#peerScreen.clear()
    this.#peerScreenStream.clear()
    this.#peerAVer.clear()
    // Their music was from this call, like their screen.
    this.#peerMusica.clear()
    this.#peerATocar.clear()
    // And OUR choice to see or not see, which is from the call that ended. Saved
    // for the next one, someone else's screen would open without them asking, // which is exactly what this slice came to undo.
    this.#ecrasAceites.clear()
    // The lives of others are from this call. Ours ends here, and the next entry
    // will have another: that is what makes those who stayed clean up what we have
    // now.
    this.#peerJoinId.clear()
    this.#joinId = null
    // The no-retransmission warning is per call. Saving it forever meant that the
    // afternoon's second call, with the same problem, said nothing to anyone.
    this.#semRetransmissaoAvisado = false

    // The SFrame sender and receivers deliberately OUTLIVE the call, and are
    // discarded only when the key changes (see `#sharedSender`). Clearing them
    // here would rebuild the exact bug this change exists to fix: a second call
    // in the same MLS epoch reuses the same key, and a fresh sender restarts its
    // counter at zero, repeating every nonce the first call already used.
    // Keeping the receivers likewise keeps their replay windows meaningful.

    const guardar = aTransitar && manterCaptura ? (this.#capturaCrua ?? this.#local) : null
    for (const track of this.#local?.getTracks() ?? []) if (!guardar?.getTracks().includes(track)) track.stop()
    this.#largarGanho(guardar)
    this.#capturaGuardada = guardar
    // Without announcing anything: the `voice.leave` that goes out below already
    // says everything there is to say, and an entry announcement sent in the
    // middle of an exit would set up a call that is falling apart.
    this.#largarEcra()
    this.#largarMusica()
    this.#local = null
    this.#channel = null
    // Just the channel, never the keys: the sender and receivers survive the call
    // on purpose, for the reason written above, a second call in the same epoch
    // reuses the same key, and a new sender would restart the counter at zero.
    this.#cifra.canal = null
    this.#room = ""

    this.emit("local", { stream: null })
    this.#announce()

    // Close the gate again: the device should be unreachable the moment the
    // call ends, not merely unused. Not in a move: the microphone stays open
    // for the new room, and the entry opens the gate again right after.
    if (!guardar) await this.bridge.setMediaActive?.(false)

    try {
      await this.bridge.sendSignal(channel, {
        t: "voice.leave",
        at: Date.now(),
        ...(sala ? { room: sala } : {}),
      })
    } catch {
      // Offline. Peers will time out their connections.
    }
    if (!aTransitar) this.emit("ended", { channel })
  }

  /**
   * Mute, with or without a call running.
   *
   * Outside a call there are no tracks to change and the cycle does not run: it
   * stays just the choice recorded, which is what `#join` will apply to the new
   * capture. That is why this method never rejects or complains about being
   * called without a call.
   */
  setMuted(muted: boolean): void {
    const mudou = this.#muted !== muted
    this.#muted = muted
    for (const track of this.#local?.getAudioTracks() ?? []) track.enabled = !muted

    /**
     * Those on the call learn about the change instantly, not at the next
     * negotiation.
     *
     * A repeated `voice.join` for already-connected pairs is harmless by design:
     * `#createPeer` returns the existing pair, and `#offer` gives up right away
     * because the connection already has a `localDescription`. `alone` is
     * recalculated on send, so it stays truthful.
     *
     * Only when it changes, not on every call to this method: `#join` calls it
     * with the value already there to apply mute to the new capture, and without
     * this guard an announcement would come out immediately before the join
     * announcement. Saying nothing when nothing changed is also the truth.
     */
    if (mudou && this.#channel) this.#anunciarMicrofone(this.#channel)
  }

  /** How many times the microphone status is announced. See `#anunciarMicrofone`. */
  static readonly TENTATIVAS_DO_MICROFONE = 3

  /** The delay between attempts. */
  static readonly ESPERA_DO_MICROFONE_MS = 1_200

  #microfoneTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * The microphone state, announced more than once.
   *
   * It was announced ONCE, the instant it changed, and that was the only
   * delivery. If that frame got lost, a reconnect in the middle, a socket
   * closing, the server rejecting due to capacity, the mute flag stayed wrong
   * for everyone **forever**, with no retry and no signal. From the viewer's
   * side, a person speaking with the mute icon on, or the opposite.
   *
   * Owner's report on August 14, 2026: "I'm hearing a user whose mute icon is
   * active... it's unpredictable". Unpredictable is the right word for a frame
   * that gets lost sometimes and other times doesn't.
   *
   * Three spaced attempts. A repeated `voice.join` is harmless by design,    * `#createPeer` returns the existing pair and `#offer` gives up right away -,
   * so the cost of retrying is a small frame, and the cost of not retrying is
   * someone drawn wrong for the rest of the call.
   *
   * The next attempt reads `this.#muted` at send time, not the value when it was
   * scheduled: someone who taps the button twice fast doesn't end up with two
   * retries that disagree with each other.
   */
  #anunciarMicrofone(channel: string, tentativa = 1): void {
    if (this.#microfoneTimer) {
      clearTimeout(this.#microfoneTimer)
      this.#microfoneTimer = null
    }
    void this.#anunciar(channel).catch((erro: unknown) => {
      this.emit("diagnostic", { code: "call-anuncio-mudo-falhou", detail: String((erro as Error)?.message ?? erro) })
    })
    if (tentativa >= Call.TENTATIVAS_DO_MICROFONE) return
    this.#microfoneTimer = setTimeout(() => {
      this.#microfoneTimer = null
      // Only while the call stays the same: retrying on a channel that already left
      // is talking about a call that ended.
      if (this.#channel === channel) this.#anunciarMicrofone(channel, tentativa + 1)
    }, Call.ESPERA_DO_MICROFONE_MS)
  }

  setCameraOff(off: boolean): void {
    for (const track of this.#local?.getVideoTracks() ?? []) track.enabled = !off
  }

  // ----------------------------------------------------------------- screen

  /**
   * How many people can be on the call for screen sharing to still work.
   *
   * The mesh is peer-to-peer with no server replicating anything: whoever shares
   * sends the image once PER PERSON. At six, that's five streams; at
   * 2.5 Mbps each, 12.5 Mbps upload, which is above what a home connection in
   * Portugal usually delivers. What happens when it can't deliver is not a
   * warning: it's the entire call choking, voice included, because the outgoing
   * queue is the same.
   *
   * Refusing with a sentence that explains why is better than a call that
   * collapses in silence and leaves everyone blaming the app.
   *
   * Static so the interface can draw the button off BEFORE anyone taps it,
   * instead of offering it and refusing next.
   */
  static readonly LIMITE_DE_PARTILHA = 6

  /** Whether this account is sharing the screen right now. */
  get sharingScreen(): boolean {
    return this.#ecra !== null
  }

  /**
   * Whether the call that is running NOW accepts screen sharing.
   *
   * For the same reason `LIMITE_DE_PARTILHA` is static: the interface draws
   * with this before anyone taps, instead of offering the button and refusing
   * after.
   *
   * **On an SFU call the ROUTER answers**, and the answer comes via the
   * `rtpCapabilities` that `sfu.scope.joined` brought: a Phase 2 homeserver
   * negotiates Opus and nothing else, and against one of those there is no path
   * for video. While the SFU path had not negotiated video, this was `false`
   * whenever there was an engine, sharing through it opened the system picker,
   * lit the OS recording indicator and announced `screen: true` to everyone
   * without delivering a single pixel.
   *
   * Outside a call it is `true`, and that is the right answer: no media engine
   * is chosen, and the choice is made only on the next `join`.
   */
  get podePartilharEcra(): boolean {
    if (this.#afk) return false
    return this.#motor === null || this.#motor.podeVideo
  }

  /**
   * How many people fit on the running call for the screen to still fit.
   *
   * **These are two numbers because they are two different physics, and the
   * interface has to state the right one.** On the mesh the cap is the UPLOAD
   * of whoever shares: the screen goes straight to each person, and at six
   * that is five copies at 2.5 Mbps. With SFU whoever shares sends one copy,
   * and the bottleneck moves to the SERVER OUTPUT, the same interface that
   * serves everything else that machine has.
   *
   * Outside a call it returns the mesh one, which is the default engine until
   * the next `join` asks the server.
   */
  get tectoDePartilha(): number {
    return this.#motor ? PESSOAS_COM_ECRA : Call.LIMITE_DE_PARTILHA
  }

  /** Our screen, for anyone who wants to draw it back to whoever is sharing. */
  get screenStream(): MediaStream | null {
    return this.#ecraVisto
  }

  /** Our screen audio: going out, muted, or none. See `screen-sound`. */
  get somDoEcra(): EstadoDoSomDoEcra {
    if (!this.#somDoEcra) return null
    return this.#somDoEcra.enabled ? "a-sair" : "calado"
  }

  /**
   * Mute (or unmute) the screen audio without stopping the share.
   *
   * `enabled = false` on the track and nothing else. The same track is in place
   * of the audio for each pair (mesh) and in the SFU producer, and a disabled
   * track sends silence: no renegotiation, no new producer, no announcement.
   * The microphone is not touched, and muting the microphone does not mute this.
   */
  setSomDoEcraCalado(calado: boolean): void {
    const som = this.#somDoEcra
    if (!som || som.enabled === !calado) return
    som.enabled = !calado
    this.emit("diagnostic", { code: calado ? "call-ecra-som-calado" : "call-ecra-som-ligado" })
    this.emit("screen-sound", { estado: this.somDoEcra })
  }

  /**
   * Drop the screen capture without saying anything to anyone.
   *
   * The local half of stopping the share: stop the tracks (which erases the OS
   * recording indicator), forget the stream, and tell the interface there is
   * nothing to show anymore. Whoever wants to stop sharing properly calls
   * `stopScreenShare`, which does this AND notifies the peers.
   *
   * It exists separately because `#join` and `#leave` need this half and not
   * the other: leaving the call already sends `voice.leave`, and a join
   * announcement sent in the middle of leaving would boot up a call that is
   * falling apart.
   */
  #largarEcra(): void {
    const fluxo = this.#ecra
    if (!fluxo) return
    this.#ecra = null
    const tinhaSom = this.#somDoEcra !== null
    this.#somDoEcra = null
    this.#ecraVisto = null
    if (tinhaSom) this.emit("screen-sound", { estado: null })
    for (const faixa of fluxo.getTracks()) {
      // Turn off before stopping: `stop()` fires `ended`, and our own handler would
      // call `stopScreenShare` again from here.
      faixa.onended = null
      faixa.stop()
    }
    this.emit("screen", { stream: null })
  }

  /**
   * Put the screen image in a peer's reserved slot.
   *
   * `replaceTrack` and nothing more: it does not generate SDP, does not fire
   * negotiation, does not touch the state machine. It is a track swap within an
   * m-line that was negotiated in the first offer.
   *
   * Cipher goes first, and it is a refusal not a warning: a screen that came out
   * in the clear to a peer expecting SFrame would arrive, fail the tag and get
   * dropped frame by frame, black image, no error, from the viewer's side.
   * Better not to send and say so.
   */
  async #porEcraNoPar(peerAddress: UserAddress, peer: Peer): Promise<void> {
    const faixa = this.#ecra?.getVideoTracks()[0]
    const emissor = peer.ecra
    if (!faixa || !emissor) return

    const querCifra = mediaE2EE && peer.supportsSframe
    if (querCifra && !(await this.#protectSender(emissor))) {
      this.emit("diagnostic", { code: "call-ecra-sem-cifra", detail: peerAddress })
      return
    }

    try {
      await emissor.replaceTrack(faixa)
    } catch (erro) {
      this.emit("diagnostic", {
        code: "call-ecra-nao-entrou",
        detail: `${peerAddress} · ${String((erro as Error)?.message ?? erro)}`,
      })
      return
    }
    await this.#limitarSaidaDoEcra(emissor)
    await this.#porSomNoPar(peerAddress, peer)
  }

  /**
   * Put the screen audio in its place, encrypted like the voice.
   *
   * The same refusal as the image: audio in the clear to a peer expecting
   * SFrame would get dropped packet by packet, in silence. And with no voice
   * chain: the track goes as `getDisplayMedia` gave it.
   */
  async #porSomNoPar(peerAddress: UserAddress, peer: Peer): Promise<void> {
    const faixa = this.#somDoEcra
    const emissor = peer.ecraSom
    if (!faixa || !emissor) return

    if (mediaE2EE && peer.supportsSframe && !(await this.#protectSender(emissor))) {
      this.emit("diagnostic", { code: "call-ecra-som-sem-cifra", detail: peerAddress })
      return
    }
    try {
      await emissor.replaceTrack(faixa)
    } catch (erro) {
      this.emit("diagnostic", {
        code: "call-ecra-som-nao-entrou",
        detail: `${peerAddress} · ${String((erro as Error)?.message ?? erro)}`,
      })
      return
    }
    try {
      const parametros = emissor.getParameters()
      const codificacoes = parametros.encodings ?? []
      for (const codificacao of codificacoes) codificacao.maxBitrate = TECTO_DO_SOM_DO_ECRA
      if (codificacoes.length > 0) await emissor.setParameters(parametros)
    } catch (erro) {
      this.emit("diagnostic", { code: "call-ecra-som-tecto-recusado", detail: String((erro as Error)?.message ?? erro) })
    }
  }

  /** Take the image out of its reserved slot, leaving the slot open. */
  async #tirarEcraDoPar(peerAddress: UserAddress, peer: Peer): Promise<void> {
    if (peer.ecraSom) {
      try {
        await peer.ecraSom.replaceTrack(null)
      } catch (erro) {
        this.emit("diagnostic", { code: "call-ecra-som-nao-saiu", detail: `${peerAddress} · ${String((erro as Error)?.message ?? erro)}` })
      }
    }
    const emissor = peer.ecra
    if (!emissor) return
    try {
      // `null` not close the transceiver: closing it would change the SDP, which is
      // precisely what we don't do here. The slot sits empty, waiting for the next
      // share.
      await emissor.replaceTrack(null)
    } catch (erro) {
      this.emit("diagnostic", {
        code: "call-ecra-nao-saiu",
        detail: `${peerAddress} · ${String((erro as Error)?.message ?? erro)}`,
      })
    }
  }

  /**
   * Start sharing the screen. `false` when it did not start, whatever the
   * reason.
   *
   * Returns a boolean and does not throw: the normal path of not sharing is
   * someone tapping cancel on the system dialog, and an exception would force
   * the caller to tell "they didn't want to" from an error `name`. The caller
   * only needs to know whether the button should light up.
   *
   * **Canceling is not an error, and is not announced as one.** `NotAllowedError`
   * is what the browser returns when closing the picker, and `AbortError` when
   * the page loses focus halfway. Either of those turning into a red message was
   * the product complaining to someone who changed their mind.
   *
   * What is STATED and not promised, so it doesn't get discovered by trial:
   * system audio only exists on Windows, because on macOS the system does not
   * hand it over without an extension installed; and on a MESH call on an engine
   * without `insertable streams` (Safari, Firefox) the entire call runs without
   * the extra cipher layer, share included. See `docs/PENDENTES.md`.
   *
   * "On mesh" is not a detail thrown in: on SFU those two engines encrypt,
   * through the `RTCRtpScriptTransform` that `caminhoDaCifra` knows, and the
   * share goes encrypted like everything else. Without that word, this sentence
   * repeated the lie that the call card footer was writing on the screen. See
   * `mediaIsE2EE`, above.
   */
  async startScreenShare(): Promise<boolean> {
    const canal = this.#channel
    if (!canal) {
      this.emit("error", { detail: "you are not in a call" })
      return false
    }
    if (this.#ecra) return true
    // In the AFK room there is no screen, and the rejection comes before the system selector.
    if (this.#afk) {
      this.emit("error", { detail: "the afk room has no voice and no text" })
      return false
    }

    /*
      The refusal comes BEFORE touching `getDisplayMedia`, and order is
      everything: an open picker has already lit the OS recording indicator, and
      closing it next is asking for the screen from someone to do nothing with it.
      See `podePartilharEcra`.
    */
    if (!this.podePartilharEcra) {
      this.emit("error", { detail: "this call server carries only voice" })
      this.emit("diagnostic", { code: "call-ecra-sem-caminho" })
      return false
    }

    /*
     * The cap on participants, and there are TWO caps because there are two different physical setups.
     *
     * In mesh, the number comes from the uplink of whoever shares: the screen goes straight to each
     * person, so six people means five copies, 12,5 Mbps of home uplink, and when it fails the result is not a warning-
     * the entire call chokes, voice and all, because the output queue is shared.
     *
     * With SFU the sharer sends ONE copy, whether there are two people or twenty, and it fits
     * any home connection with headroom. The bottleneck moved: now it is the SERVER output, `2,5 Mbps × espectadores`, shared with everything
     * else that machine serves. See `PESSOAS_COM_ECRA` in the protocol, where
     * the math is written, and the cap with the same name in `media.ts`, which is what
     * actually refuses-this one exists so the refusal happens BEFORE the system
     * selector opens.
     */
    const pessoas = this.#motor ? this.#rosterSfu.size + 1 : this.#peers.size + 1
    if (pessoas > this.tectoDePartilha) {
      // The sentence states the reason, and the reason is physical. Without it, this
      // is a product refusing on a whim; with it, whoever reads it knows what the
      // alternative would cost.
      this.emit("error", {
        detail: "the call is too large to share a screen",
        cause: { pessoas, tecto: this.tectoDePartilha, caminho: this.#motor ? "servidor" : "directo" },
      })
      return false
    }

    const media = navigator.mediaDevices as MediaDevices & {
      getDisplayMedia?: (constraints: unknown) => Promise<MediaStream>
    }
    if (typeof media.getDisplayMedia !== "function") {
      this.emit("error", { detail: "this device cannot share the screen from the app" })
      return false
    }

    let fluxo: MediaStream
    try {
      fluxo = await media.getDisplayMedia({
        video: {
          /*
            Thirty frames per second, capped at Full HD.

            It was fifteen until November 2, 2026, thinking of text and code,
            which change in jumps. The owner wants 30 ("I want 30 fps"): a game
            or a video at 15 stutters. The 2.5 Mbit/s cap does not change, and
            the `detail` hint (below) tells the encoder that when the network
            tightens, sacrifice smoothness not sharpness: text stays readable.
            Voice has priority over screen (`prioridade.ts`).
          */
          frameRate: { ideal: 30, max: 30 },
          width: { max: 1920 },
          height: { max: 1080 },
        },
        /*
          SCREEN AUDIO, requested. It was `audio: false`, and that was the bug of
          October 26, 2026: "screen shares are not transmitting audio". The
          request closed the door before everything else.

          Requesting does not obligate: the browser picker shows the box "Share
          audio from this tab" (or "from system", on Windows and ChromeOS) and
          the person chooses. Without the box checked the share comes out silent,
          and that is their choice, not an error.

          No processing: it is music, a video or system audio, not voice. Echo
          cancellation and noise reduction eat music, and automatic gain flattens
          it.
        */
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          /* Audio from THIS PAGE outside system audio: without this, loopback picks up
             the call voice that this window plays, and others hear themselves back
             with delay. It is a TRACK restriction (Screen Capture; Chrome 140+,
             Windows and macOS), and that is why it lives here: at the top of the
             request, where it was until 11/2/2026, Chrome ignored it. A browser
             that does not know it ignores it too, without refusing capture. */
          restrictOwnAudio: true,
          /* The shared tab keeps playing for whoever shares it. It is the default
             value, and it is written so no one changes it without knowing it mutes
             the video of whoever is showing it. */
          suppressLocalAudioPlayback: false,
        },
        /* Our own window out of the list: sharing the app inside the app is the
           infinite mirror, and no one chooses it on purpose. */
        selfBrowserSurface: "exclude",
        /* Switch windows in the middle without stopping and restarting the share. */
        surfaceSwitching: "include",
        /* The SYSTEM audio box when sharing a full screen (Windows and ChromeOS;
           macOS does not hand it to Chrome) and when sharing a window, where
           Chrome can offer it. A member that the browser does not know is ignored. */
        systemAudio: "include",
        windowAudio: "system",
      })
    } catch (erro) {
      const nome = (erro as { name?: string })?.name ?? ""
      if (nome === "NotAllowedError" || nome === "AbortError") {
        this.emit("diagnostic", { code: "call-ecra-cancelado", detail: nome })
        return false
      }
      this.emit("error", { detail: "could not share the screen", cause: { nome } })
      this.emit("diagnostic", { code: "call-ecra-recusado", detail: nome || String(erro) })
      return false
    }

    /*
      Is the call still the same?

      The system picker stays open as long as the person wants, and in that time
      the call can be dropped or the room changed. Without this guard, the
      capture stayed alive and alone, with the OS recording indicator on over a
      call that no longer exists.
    */
    if (this.#channel !== canal) {
      for (const faixa of fluxo.getTracks()) faixa.stop()
      this.emit("diagnostic", { code: "call-ecra-fora-de-tempo" })
      return false
    }

    const faixa = fluxo.getVideoTracks()[0]
    if (faixa) {
      /*
        `detail`: readability over smoothness.

        The hint tells the encoder what to sacrifice when the network tightens.
        With `motion` it lowers sharpness and keeps smoothness, which in a film
        is right and on a text screen gives letters that don't read. With
        `detail` it is the opposite: the image jumps and the letters stay letters.
      */
      ;(faixa as MediaStreamTrack & { contentHint?: string }).contentHint = "detail"
      /*
        The BROWSER'S stop button, which is what almost everyone uses.
        
        Chrome puts a bar on top of everything with "Stop sharing", and whoever
        taps it does not go through a single line of our code. Without this, the
        app kept saying it was sharing, the peers kept the slot open, and on the
        other side the last frame stayed frozen forever.
        */
      faixa.onended = () => {
        this.emit("diagnostic", { code: "call-ecra-parado-pelo-sistema" })
        void this.stopScreenShare().catch(() => {
          // The share was already dropped locally; what can fail here is the
          // announcement, and periodic re-announcement handles that.
        })
      }
    }

    this.#ecra = fluxo
    const som = await this.#somDoEcraDe(fluxo)
    // If the share was dropped while asking the host, it is done. Only then
    // save the audio: saved before, it would go back to the slot that
    // `#largarEcra` cleared, and a stopped track would say "outgoing".
    if (this.#ecra !== fluxo) return false
    this.#somDoEcra = som
    this.#ecraVisto = new MediaStream(fluxo.getVideoTracks())
    this.emit("screen", { stream: this.#ecraVisto })
    if (this.#somDoEcra) this.emit("screen-sound", { estado: this.somDoEcra })
    this.emit("diagnostic", { code: "call-ecra-inicio", detail: `pares=${this.#peers.size}` })

    /*
     * And here the two architectures break apart for good.
     *
     * On the mesh, the image goes into the reserved slot of EACH peer, with
     * `replaceTrack` and no renegotiation, the slot was negotiated in the first
     * offer precisely for this. With SFU it is a new producer on the transport
     * that already exists, and the server tells those watching: one copy up, N
     * down, and nobody renegotiating anything.
     *
     * A server refusal (the call is too big, there is already a screen) comes up
     * from here as an exception, and gets caught with its physical sentence
     * intact: it is what the person reads. And the capture stops, leaving it
     * alive was the OS recording indicator on over a share that does not exist.
     */
    if (this.#motor) {
      if (!faixa) {
        // A capture with no video track does not exist in practice, and if it did
        // there would be nothing to send. Dropping is better than announcing an empty
        // share to everyone.
        this.#largarEcra()
        this.emit("diagnostic", { code: "call-ecra-sem-faixa" })
        return false
      }
      try {
        await this.#motor.partilharEcra(faixa, this.#somDoEcra)
        // A server before screen audio rejects it, and the image follows without it.
        // It is logged (`sfu-ecra-som-recusado`, in the engine).
        if (this.#somDoEcra && !this.#motor.aEnviarSomDoEcra) {
          this.emit("diagnostic", { code: "call-ecra-som-sem-servidor" })
          // The signal "Sharing system audio" cannot lie: the audio does not go out.
          this.#somDoEcra = null
          this.emit("screen-sound", { estado: null })
        }
      } catch (erro) {
        this.#largarEcra()
        this.emit("error", erroDaChamada(erro, "could not share the screen"))
        this.emit("diagnostic", { code: "call-ecra-recusado-pelo-servidor", detail: String((erro as Error)?.message ?? erro) })
        return false
      }
    } else {
      for (const [address, peer] of this.#peers) await this.#porEcraNoPar(address, peer)
    }
    // The announcement is what makes the other side draw. The track alone isn't
    // enough: see `screen` in the protocol.
    await this.#anunciar(canal)
    return true
  }

  /**
   * The audio track from a screen capture, if there is one. `null` when there isn't.
   *
   * Three cases, all reported:
   *
   *  1. **No audio came from the browser.** The selector checkbox unchecked, or a
   *     browser that doesn't provide audio. Reports error 445.
   *  2. **An already ended track arrived.** What Electron does on macOS when
   *     "Record screen and system audio" permission is missing: the track is born
   *     `ended` and never delivers a sample, with no error for JavaScript
   *     (desktopCapturer documentation). Sending it would share silence and
   *     pretend audio existed.
   *  3. **No audio came and the host says it can't provide it** (Electron off
   *     Windows and macOS 14.2+). The user needs to know others see the
   *     screen without hearing it.
   *
   * In all three cases sharing CONTINUES, just changed: losing the image due to
   * missing audio was trading silent sharing for no sharing.
   */
  async #somDoEcraDe(fluxo: MediaStream): Promise<MediaStreamTrack | null> {
    const som = fluxo.getAudioTracks()[0] ?? null
    if (som && som.readyState === "ended") {
      this.emit("diagnostic", { code: "call-ecra-som-terminado" })
      this.emit("error", { detail: "the system did not give the screen sound" })
      return null
    }
    if (som) {
      // Hint to the encoder: this is music, not speech. Without it, Chrome may treat
      // the track as voice and cut what it thinks is noise.
      ;(som as MediaStreamTrack & { contentHint?: string }).contentHint = "music"
      return som
    }
    /*
      1. **In the browser, no audio.** Chrome only gives audio when the selector
      checkbox is checked, and the checkbox can't be checked by code: it's
      checked on a tab, unchecked on full screen, barely exists on a window,
      and Firefox and Safari don't provide audio at all. This was the case
      "their choice, nothing to say", and the owner saw silent sharing without
      knowing why (2/11/2026). Sharing continues; the user learns how to send
      audio.
      */
    if (!this.bridge.somDoEcraDisponivel) {
      this.emit("diagnostic", { code: "call-ecra-som-sem-caixa" })
      this.emit("error", { detail: "the browser did not give the screen sound" })
      return null
    }
    let disponivel = true
    try {
      disponivel = (await this.bridge.somDoEcraDisponivel()) ?? true
    } catch {
      // A bridge that doesn't respond is no reason to warn: silence persists,
      // which was the earlier behavior.
    }
    if (!disponivel) {
      this.emit("diagnostic", { code: "call-ecra-som-indisponivel" })
      this.emit("error", { detail: "this system cannot share the screen sound" })
    }
    return null
  }

  /**
   * Stop sharing and tell everyone watching.
   *
   * Called by the app button and also by the BROWSER button, which is the path
   * easily forgotten: when someone clicks "Stop sharing" in the bar Chrome puts
   * above everything, it doesn't go through any of our code. Without the track's
   * `onended`, the app kept saying "you're sharing", peers kept the slot open,
   * and the rectangle on the other side froze on the last frame. See `startScreenShare`.
   */
  async stopScreenShare(): Promise<void> {
    if (!this.#ecra) return
    this.#largarEcra()
    if (this.#motor) {
      // With SFU there's no slot to empty: the producer dies, and that's what
      // tells the server to tell watchers it's over.
      await this.#motor.pararEcra()
    } else {
      for (const [address, peer] of this.#peers) await this.#tirarEcraDoPar(address, peer)
    }
    this.emit("diagnostic", { code: "call-ecra-fim" })
    // The announcement stops carrying `screen`, and the absence is what says it ended.
    if (this.#channel) await this.#anunciar(this.#channel)
  }

  /** Our music in the call. See `EstadoDaMusica` and the `music` event. */
  get musica(): EstadoDaMusica {
    return this.#musica ? { aTocar: this.#aTocar } : null
  }

  /**
   * Start sharing MUSIC: a stereo track from the player. Stage 9.
   *
   * A second track, like screen audio, and independent of it and the microphone:
   * the DJ speaks and plays at the same time, and muting the microphone doesn't
   * stop the music. With SFU it's its own producer (source `musica`, Opus stereo
   * at 64 kbps, encrypted like the others); in mesh it goes via each peer's
   * reserved slot.
   *
   * The track does NOT go through the voice chain: it comes from a
   * `MediaStreamAudioDestinationNode` from the player (`musica.ts`), never from
   * `getUserMedia`. And the track stays from the player: stopping sharing doesn't
   * stop it.
   *
   * @param aTocar the name of what's playing, for the "Now playing: …" signal.
   * @returns `false` when it didn't start; the reason goes through `error`.
   */
  async partilharMusica(faixa: MediaStreamTrack, aTocar: string | null = null): Promise<boolean> {
    const canal = this.#channel
    if (!canal) {
      this.emit("error", { detail: "you are not in a call" })
      return false
    }
    if (faixa.kind !== "audio") return false
    if (this.#afk) {
      this.emit("error", { detail: "the afk room has no voice and no text" })
      return false
    }
    if (this.#musica === faixa) {
      this.mudarATocar(aTocar)
      return true
    }
    if (this.#musica) await this.pararMusica()
    // Hint to the encoder: this is music. Without it Chrome may treat the track
    // as voice and cut what it thinks is noise.
    ;(faixa as MediaStreamTrack & { contentHint?: string }).contentHint = "music"
    this.#musica = faixa
    this.#aTocar = nomeCortado(aTocar)

    if (this.#motor) {
      let noAr: boolean
      try {
        noAr = await this.#motor.partilharMusica(faixa)
      } catch (erro) {
        // Encryption isn't ready (448): music won't send without it.
        if (this.#musica === faixa) {
          this.#musica = null
          this.#aTocar = null
        }
        this.emit("error", erroDaChamada(erro))
        this.emit("diagnostic", { code: "call-musica-sem-cifra" })
        return false
      }
      if (!noAr) {
        // The server didn't take it (today: a gateway without `musica` on the wire). The
        // call continues; music stays on this device only.
        if (this.#musica === faixa) {
          this.#musica = null
          this.#aTocar = null
        }
        this.emit("error", { detail: "this call server does not carry music" })
        this.emit("diagnostic", { code: "call-musica-recusada-pelo-servidor" })
        return false
      }
    } else {
      for (const [address, peer] of this.#peers) await this.#porMusicaNoPar(address, peer)
    }
    // Dropped while producing: the output already said what there was to say.
    if (this.#musica !== faixa) return false
    this.emit("diagnostic", { code: "call-musica-inicio", detail: `pares=${this.#peers.size}` })
    this.emit("music", { estado: this.musica })
    await this.#anunciar(canal)
    return true
  }

  /**
   * What's playing changed (the queue advanced), or it paused (`null`).
   *
   * Doesn't touch the track: the player plays the next track on the SAME node,
   * and listeners don't see a new producer. Only the announcement changes.
   */
  mudarATocar(aTocar: string | null): void {
    if (!this.#musica) return
    const nome = nomeCortado(aTocar)
    if (nome === this.#aTocar) return
    this.#aTocar = nome
    this.emit("music", { estado: this.musica })
    if (this.#channel) void this.#anunciar(this.#channel).catch(() => {})
  }

  /** Stop sharing music. The track belongs to the player and stays theirs. */
  async pararMusica(): Promise<void> {
    if (!this.#musica) return
    this.#largarMusica()
    if (this.#motor) await this.#motor.pararMusica()
    else for (const [address, peer] of this.#peers) await this.#tirarMusicaDoPar(address, peer)
    this.emit("diagnostic", { code: "call-musica-fim" })
    if (this.#channel) await this.#anunciar(this.#channel)
  }

  /** The local half of stopping music: forget it and tell the UI. */
  #largarMusica(): void {
    if (!this.#musica) return
    this.#musica = null
    this.#aTocar = null
    this.emit("music", { estado: null })
  }

  /**
   * View the screen this person is offering.
   *
   * Request from the owner on October 5, 2026: *when someone shares their
   * screen, others should only join the stream if they want to.* It was automatic
   *, any new producer was consumed without looking at the source, and receiving
   * meant 2.5 Mbps forced on you with no way to refuse: there's no simulcast or
   * layers, so no small screen version to ask for.
   *
   * **With SFU, this is what costs bandwidth, and it only costs it now.** The
   * producer was announced but not consumed; the consumer is born here.
   *
   * **In mesh, bandwidth was already spent** and this just says display it: the
   * screen comes through the direct connection with whoever shares, whose sender
   * can't not be created from here. Saving it there is simulcast and layers,
   * which is outside this scope.
   *
   * The announcement goes out right after, and that's what tells the sharer they
   * gained a viewer. See `aVer` in the protocol.
   */
  async aceitarEcra(address: UserAddress): Promise<void> {
    if (this.#ecrasAceites.has(address)) {
      // We already said yes; what might not have happened is consumption, if the
      // earlier one failed and the offer went back on the list (see `#depoisDeFalharConsumo`
      // in the engine). Asking again is harmless with no pending offers.
      if (this.#motor) await this.#motor.consumirOfertasDe(address)
      return
    }
    // The choice BEFORE consuming: the engine reads it via `verOEcraDe`, and if
    // the order were reversed it would refuse the producer and put it back on the
    // offer list.
    this.#ecrasAceites.add(address)
    this.emit("diagnostic", { code: "call-ecra-aceite", detail: address })
    if (this.#motor) await this.#motor.consumirOfertasDe(address)
    this.#announce()
    if (this.#channel) await this.#anunciar(this.#channel)
  }

  /**
   * Stop viewing this person's screen.
   *
   * Serves both responses, and on purpose: refuse an offer you never accepted
   * and stop viewing what you were already seeing are the same choice stated in
   * the same place, I don't want to see this. Two methods for the same state
   * were two paths to keep it in sync.
   *
   * What this saves with SFU is written in `largarEcraDe` in the engine: the
   * consumer PAUSES, and a paused consumer receives no RTP, so the server's
   * output for this viewer stops for real, not just the decryption on this side.
   * In mesh there's nothing to save and this just hides it.
   *
   * **Expected, not triggered.** The frame that closes the tap goes to the
   * server, and the announcement telling others we're not viewing goes after: an
   * `aVer` without the person's name while their image was still arriving was
   * our own announcement lying about our state.
   */
  async recusarEcra(address: UserAddress): Promise<void> {
    if (!this.#ecrasAceites.delete(address)) {
      // We hadn't even accepted it. Do we store the refusal anyway? No: the offer
      // shows up on its own in the next announcement from whoever's sharing, and a
      // stored "no" would make a new offer never show.
      return
    }
    this.emit("diagnostic", { code: "call-ecra-largado", detail: address })
    await this.#motor?.largarEcraDe(address)
    this.#announce()
    if (this.#channel) await this.#anunciar(this.#channel)
  }

  /**
   * The upload cap for this sender, based on how many peers there are now.
   *
   * `setParameters` doesn't renegotiate: it changes what the encoder does, not
   * what the SDP says. That's why it fits here and renegotiation doesn't.
   *
   * The object must be what came from `getParameters()`, with the
   * `transactionId` intact, and the NUMBER of encodings can't change. That's why
   * we only overwrite what's already there, and a sender with no encoding gets
   * no cap and the fact logged, instead of getting a made-up list the browser
   * would reject.
   */
  async #limitarSaidaDoEcra(emissor: RTCRtpSender): Promise<void> {
    const tecto = tectoDoEcra(this.#peers.size, this.#somDoEcra !== null)
    try {
      const parametros = emissor.getParameters()
      const codificacoes = parametros.encodings ?? []
      if (codificacoes.length === 0) {
        this.emit("diagnostic", { code: "call-ecra-sem-tecto", detail: `${tecto}` })
        return
      }
      for (const codificacao of codificacoes) codificacao.maxBitrate = tecto
      await emissor.setParameters(parametros)
    } catch (erro) {
      this.emit("diagnostic", {
        code: "call-ecra-tecto-recusado",
        detail: String((erro as Error)?.message ?? erro),
      })
    }
  }

  /**
   * Redistribute the upload budget when the number of peers changes.
   *
   * Someone joining or leaving mid-share changes the whole picture: the same
   * screen that fit two peers won't fit five. Without this, the cap stuck at
   * whatever it was when sharing started, and the call choked as the room grew.
   */
  async #reajustarTectoDoEcra(): Promise<void> {
    for (const [, peer] of this.#peers) {
      if (peer.ecra) await this.#limitarSaidaDoEcra(peer.ecra)
    }
  }

  // ------------------------------------------------------------ signalling

  /** Feed every `voice.*` payload from the session here. */
  /**
   * Take one signalling frame.
   *
   * Deliberately NOT serialised through `#queue`. Signalling is inherently
   * re-entrant — answering an offer sends an answer, which the peer handles,
   * which may send more — and a shared queue turns that into a deadlock the
   * moment a transport delivers synchronously.
   *
   * Ordering is instead enforced where it actually matters: `#pendingIce` holds
   * candidates until their peer has a remote description, which is the race this
   * needed protecting from. `#answer` awaits four times, and a `voice.ice`
   * landing inside that window used to be discarded in silence — fatal when the
   * peer's whole candidate list arrives in that window, which is exactly what
   * happens on the restrictive networks that most need every candidate.
   */
  async handleSignal(channel: string, from: UserAddress, payload: Payload): Promise<void> {
    if (from === this.bridge.selfAddress) return

    /**
     * Be moved to another voice room.
     *
     * Handled before the room filter because the `room` in this frame is the
     * DESTINATION not the origin: filtering it like the others would drop exactly
     * the only request that matters.
     *
     * It's an exit and an entry, not a transfer: the call belongs to the room,
     * and `#join` already undoes the previous one. And it's voluntary obedience
     *, this client obeys the request because it chose to; another client ignores
     * it and stays put. See `voice.move` in the protocol.
     *
     * **Who sends it was already checked** before the request reached here: the
     * session drops `voice.move` from anyone without `move` on this channel
     * (2/11/2026). From here on it's obeyed without asking the user anything,
     * like in Discord.
     */
    if (payload.t === "voice.move") {
      if (payload.subject !== this.bridge.selfAddress) return
      // Moving only makes sense for someone actually in this call. Outside it
      // would drag them into a conversation they didn't ask for.
      if (channel !== this.#channel) return
      /*
        The room the mover says we left (1.2). The mover only needed power in
        THAT room; if we're not there, the request is about a different situation
        (it arrived late, or it's from a modified client choosing the room that
        suits them) and we don't obey it. Without the field (a 1.0.x or 1.1.0),
        like before.
        */
      if (payload.de !== undefined && payload.de !== this.#room) return
      /*
        "Hang up". Before the gatekeeper's refusal, because that travels with it:
        it's what keeps an old client where they are.
      */
      if (payload.desligar === true) {
        await this.leave()
        this.emit("desligado", { channel, by: from })
        return
      }
      /*
        And never to the QUESTION ROOM, which is a reserved identifier.

        This branch obeys the `room` it gets without checking the room exists,
        and it's one of two remote paths where an arbitrary identifier comes in.
        In a 0.4.0 nothing would be lost by obeying, the gatekeeper is just an
        empty room. But whoever went there would start announcing with
        `room: "?quem"`, and for a victim 0.3.3 in the same room those
        announcements read like the goodbye that the original bug was: the user's
        other device deleted from the screen. See `SALA_DA_PERGUNTA`.
      */
      if (payload.room === SALA_DA_PERGUNTA) return
      if (payload.room === this.#room) return
      // Read before entering: `#join` rewrites all state, and whoever had video
      // still has video on the other side.
      const comVideo = this.#video
      const destino = payload.room
      /*
        With the SAME capture (2/11/2026). Moving was exiting and entering from
        scratch, and the entry opened the microphone again with a `getUserMedia`
        with no user gesture. In a browser that didn't store permission (Firefox
        by default, Safari) that was the browser dialog asking for permission:
        whoever was moved had to click "Allow" for the change to take. For the
        AFK room nothing is stored: there's no voice there (`#entrarSemVoz`).
      */
      const paraAfk = destino !== "" && (await this.bridge.salaAfk?.(channel, destino)) === true
      const run = this.#queue
        .catch(() => {})
        .then(() => this.#join(channel, { room: destino, video: comVideo }, { manterCaptura: !paraAfk }))
      this.#queue = run.catch(() => {})
      await run
      this.emit("moved", { channel, room: destino, by: from })
      return
    }

    /**
     * "Who's in the room?", and the answer is the announcement that already exists.
     *
     * Handled before the room filter, like `voice.move` and for the exact same
     * reason: whoever's asking isn't in any room, so the `room` in this frame
     * isn't the origin, it's at most the room they're asking about. Filtering it
     * like the others would drop exactly the question.
     *
     * The answer goes by channel not by room: whoever's asking wants to know if
     * there's a conversation happening on this channel, and WHICH room it's in is
     * what the answer tells them. `#anunciar` carries it, and it already says
     * everything, the room, the microphone, the screen.
     *
     * **`reafirmarPresenca` not `#anunciar` directly**, because of the 400 ms
     * delay there: a server coming back brings twenty people at once, and without
     * that delay it would be twenty replies from each person in a call. With it,
     * it's one. And because the question reaches ALL channel members: without the
     * delay, those in a call would all reply at the same instant.
     *
     * Whoever's not in a call replies nothing, and that's what keeps this from
     * being an oracle: the question travels encrypted inside the channel, so only
     * members send and hear it, and the answer doesn't say more than the 50-second
     * heartbeat already told those same people.
     */
    if (ehPerguntaDePresenca(payload)) {
      if (channel === this.#channel) this.reafirmarPresenca()
      return
    }

    /**
     * Signals from another voice room aren't from this call.
     *
     * Without this, two voice rooms on the same channel collapse into one: whoever
     * enters one is announced to whoever's in the other, both offer, and they all
     * end up in the same call despite the screen showing two. Missing from both
     * sides is the channel's call, which is what the earlier signaling looks like.
     */
    const salaDoSinal = (payload as { room?: string }).room ?? ""
    if (salaDoSinal !== this.#room) return

    if (channel !== this.#channel) {
      // We're not in this call yet. A recent announcement is stored to be handled
      // the moment we enter; the rest is useless outside the call it belongs to.
      if (payload.t === "voice.join") {
        const fila = this.#heardBeforeJoining.get(channel) ?? []
        fila.push({ from, payload, at: Date.now() })
        this.#heardBeforeJoining.set(channel, fila.slice(-16))
      }
      return
    }

    // In the AFK room, the roster and nothing else. See `#sinalSemVoz`.
    if (this.#afk) {
      this.#sinalSemVoz(from, payload)
      return
    }

    // With SFU, the roster and nothing else. See `#sinalPorSfu`.
    if (this.#sinalPorSfu(from, payload)) return

    switch (payload.t) {
      case "voice.join": {
        // First of all: if this is a fresh life for this person, what we had set
        // up for them doesn't match anything and dies now. The rest of this branch
        // works on clean state, including the `#peerSframe` right below, which
        // otherwise would be written and erased by cleanup in the same step.
        this.#novaVidaDe(from, payload.joinId)

        /**
         * Someone announcing with no peer can't have a live connection with us.
         *
         * Whoever reloads the page never sends `voice.leave`, and ICE takes
         * thirty-some seconds to admit the connection died. In that window their
         * return fell into an `#offer` that gave up at the head, the old
         * connection still has `localDescription`, and they saw "waiting for
         * someone to join" while on the other side their card stayed on screen.
         *
         * `connected` is required on purpose. A repeated announcement from someone
         * still negotiating with us is their timer firing before the answer
         * arrives: redoing the connection there would leave the answer in flight
         * to a connection that no longer exists, and negotiation never settled.
         */
        /**
         * They're saying the connection with us died. They know better than we do.
         *
         * A connection can die on one side and stay alive on the other for a long
         * time, ICE takes thirty-some seconds to admit what already happened, and
         * a network drop isn't symmetric. Whoever lost it cleaned up what they had
         * and owes us a try; this side has a connection with local description,
         * seemingly good, which makes the next offer give up at the head and never
         * try again.
         *
         * This was what we were missing, and you couldn't guess it from any other
         * field: same `joinId` (they didn't rejoin), `alone` false (they still have
         * the third person). With two people `alone` saved the situation by accident,
         * which is why the bug only showed up with three or more.
         */
        if (payload.reparar?.includes(this.bridge.selfAddress)) {
          this.emit("diagnostic", { code: "call-reparar-pedido", detail: from })
          /*
            "left" not "failed", and the difference is between a fix and an
            endless loop.
            
            "failed" puts the person in `#perdidos`, meaning we mark that we owe
            them a try, and our next announcement would ask THEM for the repair
            they just asked us for. Both sides cleaning each other in ping-pong,
            forever. Caught by two timeouts that ran out as soon as this went in.
            
            The cleanup here is orderly: the connection is over, we know it from
            whoever was on the other side, and renegotiation starts again right
            after in this same frame. If THAT fails, the connection timer handles
            it, like it always has.
            */
          this.#drop(from, "saiu")
        }

        const actual = this.#peers.get(from)
        if (payload.alone && actual?.connected) this.#drop(from)

        /**
         * Recorded AFTER `#drop`, and the order is not housekeeping.
         *
         * `#drop` forgets everything known about this pair, that is what it must
         * do, because whoever leaves takes their state with them. Written before, what this
         * frame brings would be erased next by cleanup; written after,
         * cleanup takes what was old and keeps what this announcement just
         * said, which is the most recent that exists.
         *
         * The microphone was already on the right side of this rule. The CIPHER was not: it was
         * written up there, before `#drop`, and so could disappear
         * with it. The pair born next would get `supportsSframe: false`
         * about someone who encrypts everything, a connection that settles, shows the
         * green card and lets nothing through.
         *
         * HONESTLY: this is the same trap as the microphone, fixed by
         * symmetry with it, and it is NOT proven that this is what the owner saw on 13
         * August 2026 ("appears connected but I stop hearing and
         * vice-versa"). The test in `call.cifra-reentrada.test.ts` does not fail
         * when the old order is restored: there is another path that sets the value
         * before it matters. Left for the usual reason, a field read
         * before the cleanup that erases it is a trap waiting for someone.
         */
        this.#peerSframe.set(from, payload.sframe)
        // After `#drop`, like the cipher: written before, cleanup would remove it.
        this.#peerEcraSom.set(from, payload.ecraSom === true)
        this.#peerMusica.set(from, payload.musica === true)
        this.#notarATocar(from, payload.aTocar)
        this.#notarMuted(from, payload.muted)
        // Who they chose to see, so our side can say "N watching".
        // After `#drop` for the same reason as the three neighbors: written
        // before, cleanup would remove it.
        this.#peerAVer.set(from, payload.aVer ?? [])
        // After `#drop` for the same reason as the two above: written
        // before, it was erased by cleanup and the peer was born without knowing
        // that a screen was already arriving.
        this.#notarEcra(from, payload.screen, payload.screenStream)

        // They announced: they are coming to negotiate again, so we no longer owe
        // them the attempt that went undone.
        this.#perdidos.delete(from)

        if (this.bridge.selfAddress < from) {
          this.emit("diagnostic", { code: "call-ofereco", detail: from })
          await this.#offer(from, payload.video)
        } else {
          /**
           * We wait for their offer, and waiting without a deadline is not a plan.
           *
           * The peer with the larger address does not offer: they announce and wait.
           * In that half of the cases no pair is created, and where there is no pair
           * there is no connection timer: the network could consume that offer and
           * nothing in this object would notice.
           *
           * With two people it still worked, the one without a pair announces again
           * every five seconds. With three it stopped working, because a single live
           * connection silences the periodic announcement: the person saw the other in
           * "connecting" while hearing the third just fine. The owner reported this on
           * August 13, 2026: "whenever there are 3+ members it doesn't connect so
           * seamlessly", and the asymmetry is his, we lose the one on the wrong side
           * of the address comparison.
           *
           * Recording the wait in `#perdidos` closes the gap: it tells "I am connected"
           * from "I am connected AND someone is missing", and the periodic announcement
           * already reads that difference. It leaves the list when the pair is created
           * (see `#createPeer`), and goes back if the connection fails later (see
           * `#drop`).
           *
           * What fixes this today is the other side's connection timer, and it takes
           * 25 seconds to give up: twenty five seconds watching someone in "connecting"
           * during a live call. This does not replace that path, it shortens it for
           * the case where both sides announced.
           *
           * **And the response goes ONLY to those we don't have yet, which is the
           * difference between linear and exponential.** It was outside that condition,
           * and answered all address announcements from smaller addresses, connected or
           * not. Each response is itself an announcement, which triggers all the larger
           * ones to respond, whose responses trigger the even larger ones: joining a
           * room of n people produced **2ⁿ−1** `voice.join` calls. Measured in the
           * harness, 3 people → 7 announcements, 5 → 31, 6 → 63, and each is a
           * message encrypted by MLS, passed through the queue by channel
           * (`#umDeCadaVezNoGrupo`) and multiplied by recipients: 315 messages to set
           * up a call of six.
           *
           * For those we already have a pair with there is nothing to say: if we have
           * them, they have us. And whoever joins keeps being served by everyone,
           * because at that moment nobody has a pair with them.
           */
          if (!this.#peers.has(from)) {
            this.emit("diagnostic", { code: "call-espero-oferta", detail: from })
            // "waiting", not "failed": there was never a connection with them, so
            // there is nothing on their side that we know to be dead. See
            // `reparar` in `#anunciar`.
            this.#perdidos.set(from, "espera")
            this.#comecarAnuncio(channel)
            // Announce ourselves so the peer with the lower address starts.
            await this.#anunciar(channel)
          }
        }
        return
      }

      case "voice.leave":
        this.#drop(from)
        /*
          And our choice to see their screen, which `#drop` no longer carries.

          This is the real exit from the mesh, they said they were leaving -, so
          this is where the pruning must be, not at the `#drop` door, which also
          runs on repairs when the person stays. Without this line, someone who
          left and came back would find their screen accepted without anyone asking
          for it this time. See `#esquecerEscolhaDeEcra`.
        */
        this.#esquecerEscolhaDeEcra(from)
        return

      case "voice.offer":
        if (payload.to !== this.bridge.selfAddress) return
        // Before `#answer`: whoever re-enters with the smaller address offers
        // without announcing, and without this we would answer with the peer from
        // the previous life, a remote description in a connection whose ICE agent
        // on the other side no longer exists.
        this.#novaVidaDe(from, payload.joinId)
        // The offer carries what the offerer can do. Without this the answerer
        // was guessing from a `voice.join` it may never have heard — and half
        // the time it guessed "no SFrame" about a peer that was encrypting
        // everything, producing a connected, perfectly silent call.
        if (payload.sframe !== undefined) this.#peerSframe.set(from, payload.sframe)
        // Whoever enters mid-call never heard anyone's announcement: it is here,
        // and only here, that they learn who was already there silent.
        this.#notarMuted(from, payload.muted)
        // And who was already there sharing. Before `#answer`, so the connection
        // is born knowing what to expect from the reserved slot.
        this.#notarEcra(from, payload.screen, payload.screenStream)
        // The offer brings the sound screen's position: whoever brings it knows what it is.
        if (payload.ecraSom === true) this.#peerEcraSom.set(from, true)
        // The offer dictates the layout of THIS connection: with or without music slot.
        this.#peerMusica.set(from, payload.musica === true)
        this.#notarATocar(from, payload.aTocar)
        await this.#answer(from, payload.sdp, payload.video, payload.ecraSom === true)
        return

      case "voice.answer": {
        /**
         * An answer meant for a connection already replaced is not applied to
         * the wrong one: the browser refuses it (the new connection did not make
         * that offer) and the `catch` below swallows it. The hypothesis was
         * raised that a transaction identifier in the payload would be needed;
         * it is not. What remains is the new connection left without an answer,
         * and re-announcement handles that.
         */
        if (payload.to !== this.bridge.selfAddress) return
        // Before the peer guard: what the answer says about their microphone
        // holds even if the connection it belongs to no longer exists. The state
        // is of the PERSON, and it is by address that we store it.
        this.#notarMuted(from, payload.muted)
        // Same for the screen, and for the same reason: sharing is of the person,
        // not of the connection that brought it.
        this.#notarEcra(from, payload.screen, payload.screenStream)
        this.#notarATocar(from, payload.aTocar)
        /*
          The answer says what whoever answered can do, and it travels in the
          payload from the start, only nobody read it. Whoever offers learned
          the peer's cipher only from their `voice.join`, and whoever enters
          mid-call may never have heard any announcement. The `voice.offer` is
          already read this way (see above); this was the half that was missing.
          
          It is also not proven that it was the cause of the report: the
          mutation that disables it does not make any test fail. It stays
          because a field that the protocol carries and the client ignores is
          information rotting.
          */
        if (payload.sframe !== undefined) this.#peerSframe.set(from, payload.sframe)
        const peer = this.#peers.get(from)
        if (!peer) return
        // There is only one answer to apply. A second, from a repeated offer, or
        // from a peer that resent, arrives with the connection already `stable`,
        // and the browser refuses it with "cannot set remote answer in state
        // stable". Letting that error propagate would crash the entire call and the
        // participant would vanish from the screen; repetition is harmless and we
        // ignore it.
        //
        // Caught by the error and not by `signalingState`, on purpose: the exposed
        // state varies between engines, and what matters is the result.
        try {
          await peer.connection.setRemoteDescription({ type: "answer", sdp: payload.sdp })
        } catch (error) {
          const detalhe = String((error as Error)?.message ?? "")
          if (/stable|wrong state|InvalidStateError/i.test(detalhe)) return
          throw error
        }
        /**
         * The life of whoever answered, recorded AFTER the response succeeds.
         *
         * It was before the pair guard, and that is the opposite of what this
         * mechanism exists to do: a late response, from a pair life that was already
         * replaced, would write the old `joinId` over the good one. The next
         * announcement from that person would be compared against a stale number,
         * `#novaVidaDe` would conclude "new life", and drop the GOOD connection,          * self-inflicting exactly the fault that `joinId` exists to fix.
         *
         * You only reach here with the response accepted by the browser, that is,
         * with the connection it belongs to still valid. What we record is which
         * life we ended up connected with, which is what the next announcement needs
         * to compare.
         *
         * NOT PROVEN by test: the scenario we set up passes with and without the
         * order swapped, because to bite it would need an announcement with the
         * pair's real `joinId`, which the harness does not know. It stands by reading,
         * which here is unambiguous, writing the life before knowing if the response
         * works is recording a life that may not be ours.
         */
        this.#vidaQueRespondeu(from, payload.joinId)
        await this.#drainIce(from)
        return
      }

      case "voice.ice": {
        if (payload.to !== this.bridge.selfAddress) return
        const peer = this.#peers.get(from)
        const candidate = {
          candidate: payload.candidate,
          sdpMid: payload.sdpMid,
          sdpMLineIndex: payload.sdpMLineIndex,
        }

        // Candidates that arrive before the remote description are HELD, not
        // dropped. The old comment said ICE would recover from the ones that
        // follow, which is only true if more follow: a peer behind a restrictive
        // NAT may send its whole (short) list inside that window, and then the
        // call sits at "connecting" forever with nothing left to recover from.
        if (!peer || !peer.connection.remoteDescription) {
          const held = this.#pendingIce.get(from) ?? []
          held.push(candidate)
          this.#pendingIce.set(from, held)
          return
        }

        try {
          await peer.connection.addIceCandidate(candidate)
        } catch {
          // Malformed or already applied. Nothing to do.
        }
        return
      }

      default:
        return
    }
  }

  /**
   * A new life for someone kills what remains of the old one.
   *
   * It is the fix for the fault we saw like this: rejoin a call and disappear
   * for ONE person only, with the others seeing everyone. Two guards canceled
   * each other out, cleaning the old pair required `connected`, and the offer
   * gave up at the top if there was a pair with a local description. A pair that
   * was not connected (negotiating, or in `disconnected`, which is where ICE sits
   * for half a minute when someone closes the tab) would slip between the two:
   * it survived the cleanup and blocked the offer forever. Someone whose
   * connection was already in `failed` would clean it and reconnect without
   * noticing, and that is the asymmetry.
   *
   * `alone` did not work for this and still does not: it says "I have no pair",
   * which is equally true for someone who just joined and someone still
   * negotiating. The join identifier separates both cases without guessing, it
   * changes when, and only when, the person joins again.
   *
   * Without `joinId` we conclude nothing. An old client does not send it, and a
   * missing field can never hurt a call that works today: we fall back to the
   * usual heuristic, with its usual limits.
   *
   * Called BEFORE everything else in each frame, and the order follows this
   * class's custom: `#drop` forgets everything we knew about the pair, so what
   * this frame brings must be written after it. See `#notarMuted`.
   */
  #novaVidaDe(peerAddress: UserAddress, joinId: string | undefined): void {
    if (joinId === undefined) return
    const conhecida = this.#peerJoinId.get(peerAddress)
    if (conhecida !== undefined && conhecida !== joinId) {
      this.emit("diagnostic", { code: "call-vida-nova", detail: peerAddress })
      this.#drop(peerAddress)
    }
    // After `#drop`, which clears this map like it clears the others.
    this.#peerJoinId.set(peerAddress, joinId)
  }

  /**
   * The life of whoever ANSWERED one of our offers. Recorded, never dropped.
   *
   * The difference from `#novaVidaDe` is direction, and it is all. An announcement
   * or an offer arrive from outside and may refer to a connection that no longer
   * exists on our side. A response is the acceptance of a connection we
   * ourselves proposed moments ago: the connection we have is theirs, no matter
   * which life they accepted it from, and dropping it here was throwing away the
   * only good negotiation in flight. What we gain is learning which life we ended
   * up connected with, so the next announcement is compared against the truth and
   * not against a number that is stale.
   */
  #vidaQueRespondeu(peerAddress: UserAddress, joinId: string | undefined): void {
    if (joinId === undefined) return
    this.#peerJoinId.set(peerAddress, joinId)
  }

  /**
   * Record what a peer said about their microphone, and tell the screen.
   *
   * `undefined` is not `false`. An old enough client not to know the field
   * sends nothing, and writing `false` for them would put on the screen the
   * claim that the person is speaking, worse than saying nothing, because it
   * looks like information. In that case it stays what we already knew about
   * them, which is the most recent thing ever said.
   *
   * Only announces when the value actually changes: each offer, answer and
   * announcement passes through here, and a `participants` emit from each of
   * them would redraw the list several times per negotiation, with no
   * difference at all.
   */
  #notarMuted(peerAddress: UserAddress, muted: boolean | undefined): void {
    if (muted === undefined) return
    if (this.#peerMuted.get(peerAddress) === muted) return
    this.#peerMuted.set(peerAddress, muted)
    this.#announce()
  }

  /**
   * Record that a peer declared screen sharing, and tell the screen.
   *
   * The declaration and the image arrive by different paths and in different
   * orders: this comes via signaling, the track comes via `ontrack`, and
   * either can arrive first. So both halves are stored apart and joined only
   * in `#announce`, whoever waits for the other does not lose what they
   * already have.
   *
   * `undefined` is "said nothing", and here that is "not sharing": unlike
   * the microphone, there is no client that shares without saying so. The
   * field is only omitted when there is no sharing, and that is why the
   * absence is written as `false` instead of ignored, without it, whoever
   * stopped sharing would keep sharing forever on the screens of others.
   */
  #notarEcra(peerAddress: UserAddress, screen: boolean | undefined, screenStream: string | undefined): void {
    if (screenStream !== undefined) this.#peerScreenStream.set(peerAddress, screenStream)
    else this.#peerScreenStream.delete(peerAddress)

    const agora = screen === true
    if ((this.#peerScreen.get(peerAddress) ?? false) === agora) return
    this.#peerScreen.set(peerAddress, agora)
    this.emit("diagnostic", { code: agora ? "call-ecra-do-par" : "call-ecra-do-par-fim", detail: peerAddress })
    this.#announce()
  }

  /**
   * What this person said they are playing. Absent means not playing (or paused).
   *
   * Written as `false` not omitted, for the reason in `#notarEcra`: the field
   * is only left out when not playing, and without this someone who paused would
   * keep playing forever on the screens of the others.
   */
  #notarATocar(peerAddress: UserAddress, aTocar: string | undefined): void {
    const antes = this.#peerATocar.get(peerAddress)
    if (antes === aTocar) return
    if (aTocar === undefined) this.#peerATocar.delete(peerAddress)
    else this.#peerATocar.set(peerAddress, aTocar)
    this.#announce()
  }

  async #offer(peerAddress: UserAddress, peerVideo: boolean): Promise<void> {
    // One offer per peer, and the mark is set before any await.
    if (this.#offering.has(peerAddress)) return
    if (this.#peers.get(peerAddress)?.connection.localDescription) return
    this.#offering.add(peerAddress)

    try {
      const peer = await this.#createPeer(peerAddress, peerVideo)
      if (!peer) return
      // Music place comes BEFORE screen audio: the screen sound becomes the last audio m-line,
      // as a 0.8 client expects. See `#reservarLugarDaMusica`.
      if (this.#peerEcraSom.get(peerAddress) === true && this.#peerMusica.get(peerAddress) === true) {
        await this.#reservarLugarDaMusica(peerAddress, peer)
      }
      // The screen sound slot, only for those who said they can read it.
      if (this.#peerEcraSom.get(peerAddress) === true) await this.#reservarLugarDoSom(peerAddress, peer)
      const criada = await peer.connection.createOffer()
      // DTX and constant bitrate in mesh: see `comDtxECbrNoOpus`.
      const offer = { type: criada.type, sdp: comDtxECbrNoOpus(criada.sdp ?? "") }
      await peer.connection.setLocalDescription(offer)
      await this.#signal({
        t: "voice.offer",
        to: peerAddress,
        sdp: offer.sdp,
        sframe: mediaE2EE,
        video: this.#video,
        // Read at send time: between the announcement and the offer there is room
        // for a microphone button click, and it is the offer that reaches whoever
        // just entered.
        muted: this.#muted,
        // What life of ours is this offer from. Whoever re-enters with the smaller
        // address offers without announcing to anyone: without this here, the other
        // side would answer with the peer from the previous life.
        ...(this.#joinId ? { joinId: this.#joinId } : {}),
        ...(this.#room ? { room: this.#room } : {}),
        // Whoever enters mid-sharing never heard any announcement: the offer is
        // the first thing we tell them about the screen.
        ...this.#oQueDizemosDoEcra(),
        // This offer carries the screen sound slot (the last audio m-line).
        ...(peer.ecraSomTransceiver ? { ecraSom: true } : {}),
        // And the music one (the second-to-last), and what we are playing.
        ...(peer.musicaTransceiver ? { musica: true } : {}),
        ...this.#oQueDizemosDaMusica(),
      })
    } finally {
      // The mark protects the construction window and nothing else. Leaving it
      // set after the offer goes out made it mean "I do not care about this
      // person anymore": whoever reloaded the page and re-announced would hit it
      // and never be served again. From here on deduplication is done by the
      // connection itself, with its `localDescription`.
      this.#offering.delete(peerAddress)
    }
  }

  async #answer(peerAddress: UserAddress, sdp: string, peerVideo?: boolean, comSom = false): Promise<void> {
    // One at a time per person, and the mark is set before any await, like
    // in `#offer`. See `#answering`.
    if (this.#answering.has(peerAddress)) {
      this.emit("diagnostic", { code: "call-resposta-a-meio", detail: peerAddress })
      return
    }
    this.#answering.add(peerAddress)
    try {
      await this.#answerInterno(peerAddress, sdp, peerVideo, comSom)
    } finally {
      this.#answering.delete(peerAddress)
    }
  }

  async #answerInterno(peerAddress: UserAddress, sdp: string, peerVideo?: boolean, comSom = false): Promise<void> {
    // The video is of WHOEVER OFFERS, not ours. See `voice.offer.video`.
    const peer = this.#peers.get(peerAddress) ?? (await this.#createPeer(peerAddress, peerVideo ?? this.#video))
    if (!peer) return
    await peer.connection.setRemoteDescription({ type: "offer", sdp })
    // Before the answer: it is what tells the other side we also send on it.
    await this.#adoptarLugaresDoOutro(peerAddress, peer, sdp, comSom)
    const criada = await peer.connection.createAnswer()
    // DTX and constant bitrate in mesh: see `comDtxECbrNoOpus`.
    const answer = { type: criada.type, sdp: comDtxECbrNoOpus(criada.sdp ?? "") }
    /*
      Is this still the connection for this person?

      Between `createAnswer` and `setLocalDescription` there can be a `#drop`
      , an ICE fall, a new life announcement, and the connection may have
      been replaced. Putting the answer in the successor is the same error
      with another name: it never made that offer.
    */
    if (this.#peers.get(peerAddress) !== peer) {
      this.emit("diagnostic", { code: "call-resposta-fora-de-tempo", detail: peerAddress })
      return
    }
    await peer.connection.setLocalDescription(answer)
    await this.#signal({
      t: "voice.answer",
      to: peerAddress,
      sdp: answer.sdp,
      sframe: mediaE2EE,
      // The other side may never have heard our announcement, that is the case
      // of someone already in the call when we entered. The answer is the first
      // thing we tell them about us.
      muted: this.#muted,
      ...(this.#joinId ? { joinId: this.#joinId } : {}),
      ...(this.#room ? { room: this.#room } : {}),
      // The mirror case: the offerer may have never heard our announcement, and we
      // might have been sharing before they joined.
      ...this.#oQueDizemosDoEcra(),
      ...this.#oQueDizemosDaMusica(),
    })
    await this.#drainIce(peerAddress)
  }

  /** Apply candidates that were held while the peer had no remote description. */
  async #drainIce(peerAddress: UserAddress): Promise<void> {
    const held = this.#pendingIce.get(peerAddress)
    if (!held) return
    this.#pendingIce.delete(peerAddress)
    const peer = this.#peers.get(peerAddress)
    if (!peer) return
    for (const candidate of held) {
      try {
        await peer.connection.addIceCandidate(candidate)
      } catch {
        // One bad candidate must not stop the rest.
      }
    }
  }

  /**
   * Give up out loud instead of sitting at "connecting" forever.
   *
   * Without a TURN server a peer behind symmetric NAT or CGNAT — which is most
   * mobile networks and a good deal of home fibre — never produces a usable
   * candidate pair. The call then stayed in "connecting" with no timeout, no
   * retry and no message, which is indistinguishable to the user from a call
   * that is merely slow.
   */
  #armConnectTimeout(peerAddress: UserAddress, connection: RTCPeerConnection): void {
    const existing = this.#connectTimers.get(peerAddress)
    if (existing) clearTimeout(existing)
    this.#connectTimers.set(
      peerAddress,
      setTimeout(() => {
        this.#connectTimers.delete(peerAddress)
        const peer = this.#peers.get(peerAddress)
        // Same issue: a timer set by a connection that was already replaced cannot
        // sentence the one that took its place.
        if (!peer || peer.connected || peer.connection !== connection) return
        // Distinguish the two causes; they tell different stories to the reader. No
        // remote description means no one answered the offer, almost always because
        // they left the call. Remote description means there was a conversation and
        // the network blocked it. Before this always said "network", a night of
        // debugging was spent fixing a TURN that was working fine.
        const semResposta = !peer.connection.remoteDescription
        // Put the address in `cause`, not in the message: a full address doesn't fit
        // on screen.
        this.emit("error", {
          detail: semResposta ? "that person did not answer the call" : "the network blocks the call to that person",
          cause: { pessoa: peerAddress },
        })
        // Giving up on this attempt is not giving up on the person: they go into
        // `#perdidos`, and that's what makes the announcement restart even though
        // other pairs are alive. Before, in a three-person call, this is where the
        // third person got stuck "calling" for the rest of the call.
        this.#drop(peerAddress, "falhou")
      }, CONNECT_TIMEOUT_MS),
    )
  }

  /**
   * ICE servers for a new peer connection, cached for the life of the call.
   *
   * Cached because TURN credentials are short-lived and minted per request, and
   * a mesh creates one connection per participant: asking once per call keeps
   * every peer on the same credential and the same expiry.
   */
  /**
   * Without relay, a call connects to some peers and not others.
   *
   * This cached the result of the first attempt for the rest of the call,
   * including failed results. A client that hit a transient error fetching
   * servers stayed for the rest of the call with public STUN and no TURN:
   * connecting to whoever it reached directly and never to anyone needing
   * relay. Witnessed live, two of three people connected to the third and
   * never to each other. No warning either: the call just said "calling" until
   * it gave up.
   *
   * Now a bad result is not cached, the credential refreshes before expiry, and
   * missing relay is reported to people in the call.
   */
  async #iceServers(): Promise<RTCIceServer[]> {
    const agora = Date.now()
    if (this.#ice && agora - this.#ice.em < ICE_REFRESH_MS) return this.#ice.servers

    // No homeserver to ask (tests, development), so we fall back to public STUN.
    // In production the bridge always offers this method.
    if (!this.bridge.iceServers) return FALLBACK_ICE_SERVERS

    let offered: RTCIceServer[] | undefined
    try {
      offered = await this.bridge.iceServers()
    } catch {
      offered = undefined
    }

    if (offered && offered.length > 0) {
      this.#ice = { servers: offered, em: agora }
      const temTurn = offered.some((server) =>
        (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) => String(url).startsWith("turn")),
      )
      if (!temTurn) this.#avisarSemRetransmissao()
      return offered
    }

    // Don't cache this: the next call asks again.
    this.#avisarSemRetransmissao()
    return FALLBACK_ICE_SERVERS
  }

  #semRetransmissaoAvisado = false

  #avisarSemRetransmissao(): void {
    if (this.#semRetransmissaoAvisado) return
    this.#semRetransmissaoAvisado = true
    this.emit("error", { detail: "no relay server for the call" })
  }

  async #signal(payload: Payload): Promise<void> {
    if (!this.#channel) return
    try {
      await this.bridge.sendSignal(this.#channel, payload)
    } catch (error) {
      this.emit("error", erroDaChamada(error, "call signalling failed"))
    }
  }

  // ----------------------------------------------------------------- peers

  /** `null` when the call ended or changed while this was being built. */
  async #createPeer(peerAddress: UserAddress, peerVideo: boolean): Promise<Peer | null> {
    const existing = this.#peers.get(peerAddress)
    if (existing) return existing
    // One build at a time per person: arriving mid-way waits on the same promise
    // instead of starting another connection in parallel.
    const emCurso = this.#creating.get(peerAddress)
    if (emCurso) return emCurso

    // This person's expected attempt is happening now: they're no longer missing.
    // If they fail to connect, the connection timer returns them to `#perdidos`,
    // see `#drop`.
    this.#perdidos.delete(peerAddress)
    /**
     * A serial number for this build, and that's what makes it cancellable.
     *
     * `#drop` clears `#creating`, but couldn't cancel the build already
     * underway, and it only writes to `#peers` at the end, after waiting for
     * ICE servers. A person who left during that window was RESURRECTED by
     * their own build: their card reappeared on screen, the twenty-five-second
     * timer started for a call no one would answer, and the reannouncement
     * chased someone who wasn't there anymore.
     *
     * The guard that existed compared the CHANNEL, and that doesn't catch this
     * case: someone who leaves a room and comes back to the same room has the
     * same channel on both sides of the window. A number per build catches it,
     * because it belongs to this build alone.
     *
     * HONESTLY: the scenario set up to prove this passes with and without the
     * guard, so either the path has another defense we didn't spot, or the test
     * doesn't simulate the right loss. It stays for the usual reason: an
     * async operation that writes shared state without checking if it's still
     * current is the family of bugs that already cost this file the phantom
     * connections and the `joinId`.
     */
    const serie = ++this.#serieDaConstrucao
    this.#construcoes.set(peerAddress, serie)
    const promessa = this.#buildPeer(peerAddress, peerVideo, serie)
    this.#creating.set(peerAddress, promessa)
    try {
      return await promessa
    } finally {
      this.#creating.delete(peerAddress)
      if (this.#construcoes.get(peerAddress) === serie) this.#construcoes.delete(peerAddress)
    }
  }

  /** Each build gets a number, and only the current one can write. */
  #serieDaConstrucao = 0

  /** The current build for each person. See `#createPeer`. */
  #construcoes = new Map<UserAddress, number>()

  async #buildPeer(peerAddress: UserAddress, peerVideo: boolean, serie = 0): Promise<Peer | null> {
    // Which call this started in. `#iceServers()` below is a request to the
    // homeserver with the network in between, and signaling doesn't go through the
    // `join`/`leave` queue, on purpose, because sharing a queue with it is a
    // deadlock. The window is therefore real and measures in seconds.
    /*
      Capture first, if still opening.

      Without this a connection was born with no tracks whenever a signal
      arrived during `getUserMedia`, and the `#offer` guard refused to rebuild
      it later. See `#capturaEmCurso`. The failure is swallowed on purpose: if
      capture didn't work, the channel guard right after returns `null` anyway,
      because `#join` clears `#channel` on failure.
    */
    await this.#capturaEmCurso?.catch(() => {})

    const canal = this.#channel

    // Both ends must be able to do it, or neither should. Encrypting to a peer
    // that cannot decrypt does not degrade the call — it silences it.
    const wantsE2EE = mediaE2EE && (this.#peerSframe.get(peerAddress) ?? false)
    const servidores = await this.#iceServers()

    /**
     * Disconnecting mid-build cannot let the connection be born.
     *
     * `#leave` clears `#peers`, and a connection that only subscribes after
     * that goes into a map no one will clean up: the next `#leave` exits at
     * the top with `if (!channel) return`. Its timer fires 25 seconds later
     * with "no answer" over a call the user hung up, and the phantom moves to
     * the next call, where `#peers.size > 0` silences the reannouncement and
     * nobody connects to anybody.
     */
    if (this.#channel !== canal || canal === null) return null

    const temTurn = servidores.some((s) =>
      (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => String(u).startsWith("turn")),
    )
    this.emit("diagnostic", {
      code: "call-peer-new",
      detail: `ice=${servidores.length} turn=${temTurn ? "sim" : "NAO"} e2ee=${wantsE2EE ? "sim" : "nao"}`,
    })
    const connection = new RTCPeerConnection({
      iceServers: servidores,
      // Non-standard, Chromium-only, and the switch that makes SFrame possible.
      ...(wantsE2EE ? { encodedInsertableStreams: true } : {}),
    } as RTCConfiguration)

    const peer: Peer = {
      connection,
      stream: null,
      screen: null,
      ecra: null,
      ecraTransceiver: null,
      ecraSom: null,
      ecraSomTransceiver: null,
      somDoEcra: null,
      musica: null,
      musicaTransceiver: null,
      musicaQueChega: null,
      connected: false,
      video: peerVideo,
      encrypted: false,
      supportsSframe: this.#peerSframe.get(peerAddress) ?? false,
    }
    /*
      Are we still the build that counts for this person?

      If they left while we were waiting for ICE servers, `#drop` already
      cleaned everything that concerned them, and writing now would put them
      back on the list without them being here. Closing the connection that was
      just opened is what prevents the capture and timer from outliving it.
    */
    if (serie !== 0 && this.#construcoes.get(peerAddress) !== serie) {
      this.emit("diagnostic", { code: "call-construcao-caducou", detail: peerAddress })
      connection.close()
      return null
    }

    this.#peers.set(peerAddress, peer)
    /**
     * Silence the announcement only when we owe nothing to nobody.
     *
     * It was unconditional: building the pair for one person silenced the
     * announcement owed to SOMEONE ELSE. A connection about to be born silenced
     * one still waiting to be born, and whoever was on the wrong side of the
     * address comparison, the one waiting for the offer instead of making it,
     * stayed waiting for a reannouncement that never came again.
     *
     * HONESTLY: this is an invariant correction, and **not proven** to be what
     * the owner reported on August 14th ("two connect, the third enters and
     * keeps calling"). The scenario set up to reproduce it passes with and
     * without this line, so either the path is elsewhere or it's missing a loss
     * the test doesn't simulate. It stays for the usual reason: a place that
     * ignores the invariant the rest of the class respects is a bug waiting for
     * someone, whether it's causing this or not.
     *
     * The condition becomes the same as the timer (see `#comecarAnuncio`): we
     * have the pair AND we owe no attempt. It's the invariant the rest of the
     * class already uses, and this was the only place ignoring it.
     */
    if (this.#perdidos.size === 0) this.#stopAnnouncing()

    /**
     * Is this connection still the one that counts for this person?
     *
     * `close()` doesn't deliver state immediately: it schedules it. A connection
     * that failed and was replaced speaks again after it dies, and the handlers
     * below work by ADDRESS: the delayed report from the old connection would
     * drop the successor, which was fine. Measured in production: 128 signaling
     * messages and 19 SDPs in a minute in a three-person room, each failure
     * spawning the next. That's why this guard is on every handler of this
     * connection.
     */
    const ehActual = (): boolean => this.#peers.get(peerAddress)?.connection === connection

    /**
     * The place on screen, reserved BEFORE any track. And before, not after.
     *
     * This decision structures the entire screen sharing, and exists so we
     * don't touch a single line of negotiation. This repository has no
     * renegotiation and has two guards that prevent it on purpose: negotiation
     * is the most scarred part of the project, with duplicate offers and
     * phantom connections that killed the successor. Throwing
     * `onnegotiationneeded` into the middle of a new feature was the single
     * biggest risk this work could run.
     *
     * A transceiver created here goes into the FIRST offer, with everything
     * else. Sharing becomes `replaceTrack` on this sender, which doesn't make
     * a new SDP, doesn't fire negotiation, and doesn't touch the state machine.
     * The price is an extra m-line on every connection, including ones that
     * never share anything.
     *
     * **First, and that's the subtlety.** The order of m-lines is the order
     * transceptors are born, and both sides must agree on which one is the
     * screen. If this came after the local tracks, a call where ONE has a
     * camera and the other doesn't would misalign: whoever has no camera puts
     * the screen on the first video m-line, whoever has one puts the camera
     * there. Reserved before everything, it's the first video on both sides,
     * whether they have a camera or not. It's the only position that survives
     * the asymmetry.
     */
    const reservado = this.#reservarLugarDoEcra(connection)
    peer.ecraTransceiver = reservado
    peer.ecra = reservado?.sender ?? null

    for (const track of this.#local?.getTracks() ?? []) {
      const sender = connection.addTrack(track, this.#local as MediaStream)
      if (wantsE2EE) peer.encrypted = await this.#protectSender(sender)
    }

    connection.ontrack = (event) => {
      if (!ehActual()) return
      if (this.#chegouPeloLugarDaMusica(peerAddress, event, connection)) {
        // Music goes to its own stream: the listener gives it a separate volume, and
        // the person's card keeps playing just voice.
        peer.musicaQueChega = new MediaStream([event.track])
      } else if (this.#chegouPeloLugarDoSom(peerAddress, event, connection)) {
        // Screen audio goes to the SCREEN stream, next to the image: the stage plays
        // it, and "Stop watching" that removes the stage removes the sound with it.
        peer.somDoEcra = event.track
        if (peer.screen && !peer.screen.getTrackById(event.track.id)) peer.screen.addTrack(event.track)
      } else {
        const chegou = event.streams[0] ?? new MediaStream([event.track])
        if (this.#chegouPeloLugarDoEcra(peerAddress, event, reservado, connection)) {
          peer.screen = chegou
          if (peer.somDoEcra && !chegou.getTrackById(peer.somDoEcra.id)) chegou.addTrack(peer.somDoEcra)
        } else peer.stream = chegou
      }
      if (wantsE2EE) void this.#protectReceiver(event.receiver, peerAddress)
      this.#announce()
    }

    connection.onicecandidate = (event) => {
      if (!ehActual()) return
      if (!event.candidate) return
      void this.#signal({
        t: "voice.ice",
        ...(this.#room ? { room: this.#room } : {}),
        to: peerAddress,
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
      })
    }

    connection.onicegatheringstatechange = () => {
      if (!ehActual()) return
      this.emit("diagnostic", { code: "call-ice-gather", detail: connection.iceGatheringState })
    }
    connection.oniceconnectionstatechange = () => {
      if (!ehActual()) return
      this.emit("diagnostic", { code: "call-ice", detail: connection.iceConnectionState })
    }

    connection.onconnectionstatechange = () => {
      if (!ehActual()) return
      this.emit("diagnostic", { code: "call-conn", detail: connection.connectionState })
      peer.connected = connection.connectionState === "connected"
      if (peer.connected) {
        const timer = this.#connectTimers.get(peerAddress)
        if (timer) clearTimeout(timer)
        this.#connectTimers.delete(peerAddress)
        // We paid what we owed this person: the connection closed.
        this.#perdidos.delete(peerAddress)
      }
      if (connection.connectionState === "failed" || connection.connectionState === "closed") {
        // Failure, not exit: we still owe them an attempt. Without this, in a
        // three-person call, someone who drops on one side is never looked for again.
        this.#drop(peerAddress, "falhou")
        return
      }
      /**
       * `disconnected` rearmed the timer, and without this it was a dead end.
       *
       * The connection timer is cleared the FIRST time the connection settles
       * and never rearmed. After that only `failed` and `closed` gave any way
       * back, but a connection can drop to `disconnected` and stay there: a
       * network change, Wi-Fi to mobile data, an intermittent consent check.
       * Chromium doesn't always escalate that to `failed` in time, and there
       * are reports of never escalating.
       *
       * In that state the person stays with `connected: false`, no timer, not
       * in `#perdidos`, and no reannouncement: "calling" indefinitely, which
       * is what the owner reported on August 14th, "keeps calling until it
       * drops".
       *
       * Rearming gives it the same window as any new connection: if it comes
       * back on its own, the timer clears again when it settles; if not, the
       * timer fires, the person goes to `#perdidos`, and the reannouncement
       * looks for them. Which is what already happens to everyone else.
       */
      if (connection.connectionState === "disconnected" && !this.#connectTimers.has(peerAddress)) {
        this.emit("diagnostic", { code: "call-disconnected", detail: peerAddress })
        this.#armConnectTimeout(peerAddress, connection)
      }
      this.#announce()
    }

    this.#armConnectTimeout(peerAddress, connection)

    /*
      And if we're already sharing when this connection is born, the image
      comes in right away.
      
      Without this, someone joining mid-share saw a reserved empty slot until
      the sharer stopped and started again. The announcement already told them
      there's a screen (`#oQueDizemosDoEcra` travels in the offer and answer);
      the track was missing, and it doesn't come by itself.
      */
    if (this.#ecra) await this.#porEcraNoPar(peerAddress, peer)
    // One more pair receiving the image means less upload for each. See
    // `tectoDoEcra`.
    if (this.#ecra) await this.#reajustarTectoDoEcra()

    return peer
  }

  /**
   * Reserve the screen slot in a connection being born.
   *
   * `null` when the engine doesn't have `addTransceiver`, which in practice
   * means a test, because every engine this product supports has it. A call
   * without a reserved slot is still a perfectly normal call: it just can't
   * share the screen, and that's stated in diagnostics instead of discovered
   * when someone hits a button that does nothing.
   */
  #reservarLugarDoEcra(connection: RTCPeerConnection): RTCRtpTransceiver | null {
    const motor = connection as RTCPeerConnection & {
      addTransceiver?: (kind: string, init?: RTCRtpTransceiverInit) => RTCRtpTransceiver
    }
    if (typeof motor.addTransceiver !== "function") {
      this.emit("diagnostic", { code: "call-sem-lugar-para-ecra" })
      return null
    }
    try {
      // `sendrecv` both ways: the one who reserves wants to send their screen and
      // receive the other's on the same m-line, without ever renegotiating.
      return motor.addTransceiver("video", { direction: "sendrecv" })
    } catch (erro) {
      this.emit("diagnostic", {
        code: "call-reserva-de-ecra-falhou",
        detail: String((erro as Error)?.message ?? erro),
      })
      return null
    }
  }

  /**
   * What came in, is it a screen or a camera?
   *
   * Two answers, and the order between them is the honest part of this.
   *
   * The first is `msid`, which is what the protocol carries in
   * `screenStream` and what would be correct: compare the id of the incoming stream with
   * the id the peer announced. **Today it almost never works**, and we need to say it:
   * a track put down by `replaceTrack` travels WITHOUT `msid`-the `msid`
   * is set when the sender comes from a `addTrack(faixa, fluxo)`, and changing it
   * requires renegotiation, which this feature does not do. On the receiver side, `event.streams` arrives empty.
   *
   * The second is position, and it is what works: the screen occupies the first
   * video transceiver on both sides, reserved before everything else (see
   * `#buildPeer`). What comes through it is the screen.
   *
   * The cost of the second appears with an OLD client that reserves no slot:
   * its camera lands in our screen slot, and because it also never
   * declares `screen`, what you see is a camera that does not appear. Voice call
   * stays intact, video lost between versions. It is written in `PENDENTES.md`.
   */
  #chegouPeloLugarDoEcra(
    peerAddress: UserAddress,
    event: RTCTrackEvent,
    reservado: RTCRtpTransceiver | null,
    connection?: RTCPeerConnection,
  ): boolean {
    // Audio never goes through the screen slot, and discarding it up front saves
    // the next two checks. Handled carefully because `track` is the only field of
    // this event that test harnesses don't need to set up to exercise the rest:
    // an `undefined` here is a test, not a browser.
    const faixa = (event as { track?: MediaStreamTrack }).track
    if (faixa && faixa.kind !== "video") return false
    const anunciado = this.#peerScreenStream.get(peerAddress)
    const chegou = event.streams[0]
    if (anunciado !== undefined && chegou !== undefined) return chegou.id === anunciado
    const transceptor = (event as { transceiver?: RTCRtpTransceiver }).transceiver
    if (reservado !== null && transceptor === reservado) return true
    /*
      And the OTHER person's screen slot, from the responder's side.
      
      Measured in Chromium on October 26, 2026: the responder never receives
      anything on the transceiver they reserved. JSEP rule 5.10 only associates
      an m-line from the offer to a transceiver created by `addTrack`, and the
      reserved slot is born from `addTransceiver`. The browser creates a new
      transceiver for the first m-line, and the screen from the offerer comes
      through IT. Without this rule, the offerer's screen fell into the person's
      stream and was stomped by voice.
      
      Only without stream (`msid`): a track with a stream is a camera put by
      `addTrack`, and that's how it keeps going to the card.
      */
    if (chegou !== undefined || !transceptor || !connection) return false
    const mid = (transceptor as { mid?: string | null }).mid
    return typeof mid === "string" && mid === primeiroMidDeVideo(connection.remoteDescription?.sdp)
  }

  /**
   * Is this that arrived the SOUND of the screen?
   *
   * Only between clients that said `ecraSom`. An old client never negotiates
   * that slot, and this question answers no.
   *
   * **By `mid` first.** The sound slot is the last m-line of audio (the first
   * is the microphone; see `ultimoMidDeAudio`). Reading the missing `msid`
   * isn't enough: Firefox gives a synthetic stream to a track that arrives
   * without `msid`, and the screen sound would end up on the person's card,
   * over their voice. Missing stream stays only for when there's no `mid` to
   * read.
   */
  #chegouPeloLugarDoSom(peerAddress: UserAddress, event: RTCTrackEvent, connection?: RTCPeerConnection): boolean {
    if (this.#peerEcraSom.get(peerAddress) !== true) return false
    const faixa = (event as { track?: MediaStreamTrack }).track
    if (!faixa || faixa.kind !== "audio") return false
    const mid = (event as { transceiver?: RTCRtpTransceiver }).transceiver?.mid
    const doSom = ultimoMidDeAudio(connection?.remoteDescription?.sdp)
    if (typeof mid === "string" && doSom !== null) return mid === doSom
    return (event.streams?.length ?? 0) === 0
  }

  /**
   * Is this that arrived the MUSIC? Only by `mid`, and only from whoever said
   * `musica`.
   *
   * Without `mid` there's no guessing: missing stream is already the hint for
   * screen sound, and two reads of the same hint would swap one for the other.
   * A browser of this age always gives `mid` after negotiating.
   */
  #chegouPeloLugarDaMusica(peerAddress: UserAddress, event: RTCTrackEvent, connection?: RTCPeerConnection): boolean {
    if (this.#peerMusica.get(peerAddress) !== true) return false
    const faixa = (event as { track?: MediaStreamTrack }).track
    if (!faixa || faixa.kind !== "audio") return false
    const mid = (event as { transceiver?: RTCRtpTransceiver }).transceiver?.mid
    const daMusica = midDaMusica(connection?.remoteDescription?.sdp)
    return typeof mid === "string" && daMusica !== null && mid === daMusica
  }

  /**
   * Reserve the MUSIC slot, from the offerer's side.
   *
   * After the local tracks, for the reason in `#reservarLugarDoSom` (`addTrack`
   * reuses an empty transceiver of the same type), and BEFORE the sound slot:
   * that way the screen sound stays the last m-line of audio, and music the
   * second-to-last. See `midDaMusica`.
   */
  async #reservarLugarDaMusica(peerAddress: UserAddress, peer: Peer): Promise<void> {
    if (peer.musicaTransceiver || peer.ecraSomTransceiver) return
    const motor = peer.connection as RTCPeerConnection & {
      addTransceiver?: (kind: string, init?: RTCRtpTransceiverInit) => RTCRtpTransceiver
    }
    if (typeof motor.addTransceiver !== "function") return
    try {
      const lugar = motor.addTransceiver("audio", { direction: "sendrecv" })
      peer.musicaTransceiver = lugar
      peer.musica = lugar.sender
    } catch (erro) {
      this.emit("diagnostic", { code: "call-reserva-da-musica-falhou", detail: String((erro as Error)?.message ?? erro) })
      return
    }
    if (this.#musica) await this.#porMusicaNoPar(peerAddress, peer)
  }

  /**
   * Put our music in its slot, encrypted like voice. See `#porSomNoPar`.
   *
   * The same refusal: clear music for a peer expecting SFrame was thrown away
   * packet by packet, in silence. No voice chain at all, and without touching
   * the SDP: in the mesh Opus follows what the connection negotiated (like
   * screen sound), with a 64 kbps ceiling on the sender.
   */
  async #porMusicaNoPar(peerAddress: UserAddress, peer: Peer): Promise<void> {
    const faixa = this.#musica
    const emissor = peer.musica
    if (!faixa || !emissor) return

    if (mediaE2EE && peer.supportsSframe && !(await this.#protectSender(emissor))) {
      this.emit("diagnostic", { code: "call-musica-sem-cifra", detail: peerAddress })
      return
    }
    try {
      await emissor.replaceTrack(faixa)
    } catch (erro) {
      this.emit("diagnostic", {
        code: "call-musica-nao-entrou",
        detail: `${peerAddress} · ${String((erro as Error)?.message ?? erro)}`,
      })
      return
    }
    try {
      const parametros = emissor.getParameters()
      const codificacoes = parametros.encodings ?? []
      for (const codificacao of codificacoes) codificacao.maxBitrate = TECTO_DA_MUSICA
      if (codificacoes.length > 0) await emissor.setParameters(parametros)
    } catch (erro) {
      this.emit("diagnostic", { code: "call-musica-tecto-recusado", detail: String((erro as Error)?.message ?? erro) })
    }
  }

  /** Remove the music from its slot, leaving the slot standing. No renegotiation. */
  async #tirarMusicaDoPar(peerAddress: UserAddress, peer: Peer): Promise<void> {
    if (!peer.musica) return
    try {
      await peer.musica.replaceTrack(null)
    } catch (erro) {
      this.emit("diagnostic", { code: "call-musica-nao-saiu", detail: `${peerAddress} · ${String((erro as Error)?.message ?? erro)}` })
    }
  }

  /**
   * Reserve the screen audio slot on the side of the caller offering the media.
   *
   * After the local tracks, and the order matters: `addTrack` reuses any empty
   * transceiver of the same type (as measured in Chromium), and a slot created
   * before the microphone would route voice through it. Created after, it becomes
   * the last audio m-line, and that is how the answerer finds it.
   */
  async #reservarLugarDoSom(peerAddress: UserAddress, peer: Peer): Promise<void> {
    if (peer.ecraSomTransceiver) return
    const motor = peer.connection as RTCPeerConnection & {
      addTransceiver?: (kind: string, init?: RTCRtpTransceiverInit) => RTCRtpTransceiver
    }
    if (typeof motor.addTransceiver !== "function") return
    try {
      const lugar = motor.addTransceiver("audio", { direction: "sendrecv" })
      peer.ecraSomTransceiver = lugar
      peer.ecraSom = lugar.sender
    } catch (erro) {
      this.emit("diagnostic", { code: "call-reserva-do-som-falhou", detail: String((erro as Error)?.message ?? erro) })
      return
    }
    if (this.#somDoEcra) await this.#porSomNoPar(peerAddress, peer)
  }

  /**
   * On the answerer side: send through the slots that the offer brought.
   *
   * The transceiver we reserved when building is never associated (see
   * `#chegouPeloLugarDoEcra`), so our screen had no way out. The slots that
   * work are the ones the offer created: the first m-line (the screen image)
   * and, with `ecraSom`, the last audio (the sound). Setting them to `sendrecv`
   * BEFORE answering is what makes the answer say we also send through there.
   *
   * We only adopt a transceiver without a track: if it has a track it is our
   * microphone or our camera, and those stay where they are.
   */
  async #adoptarLugaresDoOutro(peerAddress: UserAddress, peer: Peer, sdp: string, comSom: boolean): Promise<void> {
    const ligacao = peer.connection as RTCPeerConnection & { getTransceivers?: () => RTCRtpTransceiver[] }
    if (typeof ligacao.getTransceivers !== "function") return
    const todos = ligacao.getTransceivers()
    const adoptar = (mid: string | null): RTCRtpTransceiver | null => {
      if (mid === null) return null
      const lugar = todos.find((t) => t.mid === mid)
      if (!lugar || lugar.sender.track) return null
      try {
        lugar.direction = "sendrecv"
      } catch {
        return null
      }
      return lugar
    }

    const imagem = adoptar(primeiroMidDeVideo(sdp))
    if (imagem && imagem !== peer.ecraTransceiver) {
      peer.ecraTransceiver = imagem
      peer.ecra = imagem.sender
      if (this.#ecra) await this.#porEcraNoPar(peerAddress, peer)
    }

    // Music first, through the second-to-last audio: that is the offer design.
    // Only with sound alongside, because sound signals that this design exists.
    if (comSom && this.#peerMusica.get(peerAddress) === true && !peer.musicaTransceiver) {
      const musica = adoptar(midDaMusica(sdp))
      if (musica) {
        peer.musicaTransceiver = musica
        peer.musica = musica.sender
        if (this.#musica) await this.#porMusicaNoPar(peerAddress, peer)
      }
    }

    if (comSom && !peer.ecraSomTransceiver) {
      const som = adoptar(ultimoMidDeAudio(sdp))
      if (som) {
        peer.ecraSomTransceiver = som
        peer.ecraSom = som.sender
        if (this.#somDoEcra) await this.#porSomNoPar(peerAddress, peer)
      }
    }
  }

  /**
   * @param motivo why this pair is leaving.
   *
   *   `saiu`   , said it was leaving, or their life ended and another is
   *               coming. Nothing to recover: if they return, they announce.
   *   `falhou` , the connection never closed, or it dropped. This is the only
   *               case where we owe a repair attempt, and that is what
   *               `#perdidos` counts.
   */
  #drop(peerAddress: UserAddress, motivo: "saiu" | "falhou" = "saiu"): void {
    /*
      Written down, not just done.
      
      A call that falls apart is a sequence of `#drop`, and until now that
      sequence left no trace. On the side of the person living through it
      showed as "the card disappeared"; on this side nothing remained. The
      diagnostic log exists, has a cap, mechanical storage, and no content,
      and the person copies it with a button, it just needed the call to
      speak to it.
      */
    this.emit("diagnostic", {
      code: motivo === "falhou" ? "call-drop-falhou" : "call-drop-saiu",
      detail: `${peerAddress} · restam ${this.#peers.size - (this.#peers.has(peerAddress) ? 1 : 0)}`,
    })
    // "falhou" is the only state that lets us ask the other side for a repair:
    // only here was there a connection, and only here do we know it died. See
    // `#perdidos`.
    if (motivo === "falhou") this.#perdidos.set(peerAddress, "caiu")
    else this.#perdidos.delete(peerAddress)
    const timer = this.#connectTimers.get(peerAddress)
    if (timer) clearTimeout(timer)
    this.#connectTimers.delete(peerAddress)
    this.#pendingIce.delete(peerAddress)
    this.#peerSframe.delete(peerAddress)
    // Whoever leaves takes their microphone state with them. Returning means
    // stating it again, and until they do, nothing is said about it.
    this.#peerMuted.delete(peerAddress)
    // And takes the screen they were sharing: without this, the card of whoever
    // dropped would keep saying "sharing" about a connection that no longer exists.
    this.#peerScreen.delete(peerAddress)
    this.#peerScreenStream.delete(peerAddress)
    // And tell again what it knew about screen audio: repeat it in the next offer.
    this.#peerEcraSom.delete(peerAddress)
    // And about the music, and what was playing: whoever leaves plays nothing.
    this.#peerMusica.delete(peerAddress)
    this.#peerATocar.delete(peerAddress)
    // And takes what they said they were viewing: whoever leaves views nothing.
    this.#peerAVer.delete(peerAddress)
    /*
      And does NOT take our choice to view their screen. That pruning was here
once, and it left.
      
      `#drop` is not a departure: it also runs when a mesh connection remakes,       a repair request, a new life for the same pair, the connection clock
      ticking, the connection falling to `failed`, and in those four cases the
      person STAYS. In a poor network, which is the ground this app stands on,
      someone viewing a screen had to press "View" again with each hiccup: in a
      `failed` the connection resumes and the image comes back by itself, and
      what did not come back was the choice.

      What the pruning here protected, the set growing until the announcement
      fails the schema, is now protected where presence is KNOWN: `aVer` is
      intersected with the two rosters inside `#anunciar`. The set can no
      longer name the absent even if a gate forgets, and the gates that stayed
      are the ones that are real departures. See `#esquecerEscolhaDeEcra`.
    */
    // And carry the session this peer belonged to: what comes next is from another one.
    this.#peerJoinId.delete(peerAddress)
    this.#offering.delete(peerAddress)
    this.#answering.delete(peerAddress)
    this.#creating.delete(peerAddress)
    // And invalidates any construction in progress: without this it would finish
    // and write to `#peers` someone who just left. See `#createPeer`.
    this.#construcoes.delete(peerAddress)
    // The SFrame receiver stays: the peer's counter does not restart when they
    // reconnect within the same epoch, so neither should our replay window.

    const peer = this.#peers.get(peerAddress)
    if (peer) {
      peer.connection.close()
      this.#peers.delete(peerAddress)
    }

    /**
     * Announce again. And not just when left alone.
     *
     * Being left with no pairs in the middle of a call cannot be the end of it:
     * a network drop takes both connections down at the same time, each side
     * tears down its own, and both stayed in the same call, alone, forever.
     *
     * **But the condition was `#peers.size === 0`, and that only saves calls
     * with two people.** With three, whoever loses ONE connection and keeps the
     * other has one pair, does not re-announce, and never tries again; the
     * other side, for the exact same reason, does not either. Both give up in
     * silence while still hearing the third, which is, word for word, the
     * report: only two hear each other and the third stays "calling" forever.
     *
     * So the rule becomes "do I owe a repair attempt to someone", and a clean
     * departure owes nothing. See `#perdidos`.
     */
    if (this.#channel && (this.#peers.size === 0 || this.#perdidos.size > 0)) {
      this.#comecarAnuncio(this.#channel)
    }

    // One fewer pair receiving the image is more bandwidth for each of those
    // who stay. See `tectoDoEcra`.
    if (this.#ecra) void this.#reajustarTectoDoEcra()

    // Announce ALWAYS, even if there has never been a connection with this
    // person. When someone drops a call that never established, whoever stayed
    // had no pair to remove, and the old early `return` left the interface
    // showing a call that no longer exists.
    this.#announce()
  }

  #announce(): void {
    if (this.#afk) {
      // Presence without media: whoever is on the roster is here, and there is
      // nothing more to connect. `connected` true so the screen does not stay
      // on "calling".
      this.emit("participants", {
        participants: [...this.#rosterSfu].map(([address]) => ({
          address,
          stream: null,
          connected: true,
          video: false,
          encrypted: mediaE2EE,
          micMuted: true,
          screen: null,
          ecraOferecido: false,
          aVerONossoEcra: false,
          aVer: [],
          musica: null,
          aTocar: null,
        })),
      })
      return
    }
    const motor = this.#motor
    if (motor) {
      this.#anunciarPorSfu(motor)
      return
    }

    this.emit("participants", {
      participants: [...this.#peers].map(([address, peer]) => ({
        address,
        stream: peer.stream,
        connected: peer.connected,
        video: peer.video,
        encrypted: peer.encrypted,
        micMuted: this.#peerMuted.get(address) ?? false,
        /*
          The track shows only while the person SAYS they are sharing.
          
          The two halves arrive by different paths: the declaration through
          signaling, the image through `ontrack`. And the track always arrives,
          with or without sharing, because its slot is reserved on all
          connections. Drawing the track instead of the declaration would put
          a black rectangle on everyone's screen during the entire call.
          
          And now also only while we have ASKED for it. In the mesh the image
          already arrived, the connection is direct, the sender owns it, and
          there is no consumer that might not exist: **the bandwidth is spent.**
          What the choice does here is only not to show on screen what nobody
          asked to see, which is the owner's request fulfilled by the half that
          still remains. Saving bandwidth in the mesh is simulcast and layers,
          and that is outside this slice.
          */
        screen:
          this.#peerScreen.get(address) === true && this.#ecrasAceites.has(address) ? peer.screen : null,
        ecraOferecido: this.#peerScreen.get(address) === true,
        aVerONossoEcra: (this.#peerAVer.get(address) ?? []).includes(this.bridge.selfAddress),
        aVer: this.#peerAVer.get(address) ?? [],
        // The music slot always arrives (muted). It shows only while it SAYS it is
        // playing, for the same reason as the screen.
        musica: this.#peerATocar.has(address) ? peer.musicaQueChega : null,
        aTocar: this.#peerATocar.get(address) ?? null,
      })),
    })
  }

  // ---------------------------------------------------------------- sframe
  //
  // What remains here is the MESH talking to the cipher, not the cipher:
  // the keys, the two-key window, the counter reserve, and the transforms live
  // in `media-sframe.ts` since step 1 of Phase 2 (`docs/PLANO_SFU.md`). This
  // block only knows who the peers are.

  #stopAnnouncing(): void {
    if (this.#announceTimer) clearInterval(this.#announceTimer)
    this.#announceTimer = null
  }

  /**
   * The channel epoch changed: rotate the media keys.
   *
   * `Session.mediaKey` derives from the MLS exporter of the current epoch, and
   * the note there promises that someone removed from the channel mid-call does
   * not decrypt what comes next. It was not true. The SFrame sender was chosen
   * once, when the track was added to the connection, and the `TransformStream`
   * that encrypts each frame got stuck to it, a removal advanced the epoch and
   * did not change a single byte of what went on the wire. Whoever had been
   * removed kept hearing everything, with the key they already had, until
   * someone hung up.
   *
   * Nobody has to warn anybody: both sides apply the same commit and derive the
   * same new key on their own. What differs is the instant, and so the old key
   * keeps decrypting what was already on the wire, see the two-key window in
   * `media-sframe.ts`.
   *
   * And whoever lost a leaf in the channel tree leaves the call. Rotating the
   * key stopped them from hearing; the connection stayed up, with their
   * microphone reaching here and their card on everyone's screen.
   *
   * **The list of whom to rotate for is `#peers`, and that is what changes
   * with SFU.** With an SFU there is no `#peers`: there is one connection only,
   * to the server, and several streams arriving through it, the list becomes
   * the encrypted roster. So the mesh delivers it to the cipher, not the cipher
   * fetching it.
   */
  async rekey(channel: string): Promise<void> {
    if (!this.#channel || channel !== this.#channel) return

    /**
     * A new epoch is new people in the channel, and new people do not know
     * there is a call.
     *
     * The same logic that makes the core republish the profile, roles, and
     * rooms when the group grows: everything said before someone had a place
     * was encrypted in an epoch they will never have, and nobody says it again.
     * The announcement of being in a voice room is of that family.
     *
     * Here and nowhere else because this is the only path where both bridges
     * already connect to the epoch change. **It is the cheap trigger, not the
     * trust one:** the reason is in `reafirmarPresenca`, and it is what makes
     * the other exist.
     */
    this.reafirmarPresenca()

    /**
     * With SFU, the list is the roster, and this is where you see the whole
     * difference.
     *
     * The two-key window is the same and does not change a line: each frame
     * declares its `keyId`, the receiver keeps the key in use and the one
     * before, and the SFU forwards frames from any epoch because it never knew
     * what an epoch is. What changes is whom to rotate for. The roster is not
     * pruned here: `voice.leave` or a socket drop is what removes the seat, and
     * a re-seat (drop the leaf in one commit, give another in the next) would
     * erase from screen someone who is right there in the call.
     *
     * **But the media of whoever has NO leaf at all stops now** (SEC-03, external
     * audit for 1.1.0). Until 1.2.0 this only wrote the log line: their old key
     * stayed cached in both decipher engines, their consumer kept playing, and
     * the server (which knows nothing of MLS) kept sending us their voice and
     * image. Now the cipher forgets their keys (with the worker ACK), and the
     * engine removes them from what we hear and see and pauses their consumers
     * on the server, whatever the roster presence. In a re-seat, the next commit
     * gives them the key back and `protegerOsSemChave` opens the same consumer
     * again.
     */
    const motor = this.#motor
    if (motor) {
      for (const address of await this.#cifra.rodar(motor.emissores())) {
        this.emit("diagnostic", { code: "call-fora-do-canal", detail: address })
        if (motor === this.#motor) await motor.revogar(address)
      }
      // And whoever was waiting for the key and just got it with this commit now
      // hears themselves: the decipher hangs now and the server opens the tap.
      // Without this they would stay silent until they left and came back (3/11/2026).
      if (motor === this.#motor) await motor.protegerOsSemChave()
      // And our sources waiting for the cipher try now, without waiting for the
      // clock: the new key might be ours (4/11/2026).
      if (motor === this.#motor) motor.cifraPodeTerMudado()
      // And the missing consumes (a server refusal of time) try now: a new epoch
      // is often someone who just entered or came back.
      if (motor === this.#motor) motor.acordarConsumos("epoch")
      return
    }

    // With no key of our own nothing is concluded about anyone: a channel this
    // device has not yet set up returns `null` for everyone, and throwing away
    // the call because of that would be worse than the failure. That is what the
    // empty `rodar` list says.
    for (const address of await this.#cifra.rodar(this.#peers.keys())) {
      this.emit("diagnostic", { code: "call-fora-do-canal", detail: address })
      /*
        "falhou", not a clean departure.
        
        This runs when we cannot derive a media key for someone, and the most
        common reason is not that they left the channel: it is the group tree
        being half a step behind on this side, in the middle of a commit. The
        window is short and real.
        
        With the default reason, "saiu", the person was erased from `#perdidos`,
        and with that the only way back died: no signal reached the other side
        (no `voice.leave`, no ICE drop), so they keep seeing us connected while
        we already erased them. It was the only `#drop` in the file that threw
        away a pair without any repair.
        
        As "falhou", we owe them a repair attempt: the periodic announcement
        starts again and brings their name in `reparar`, which is what makes the
        other side clean up the dead connection and negotiate again. If they
        really did leave the channel, they do not answer, and the result is the
        same as before, only now because there is no answer, not because of our
        call over a doubt.
        */
      this.#drop(address, "falhou")
    }
  }

  // ------------------------------------------------------------------- sfu

  /**
   * Lift the call by SFU: one connection to the server, nothing else.
   *
   * A failure here brings down the entry on purpose, and that is the difference
   * from the mesh echo, which is an extra and cannot bring down anything.
   * Without transport there is no call at all, leaving `#channel` set with the
   * capture open and nothing passing through gave the worst failure possible:
   * the screen says you are in a call, the microphone is on, and you neither
   * hear nor are heard.
   */
  /** When media remade because sending did not connect, at the last moment. See `aoEnvioParado`. */
  #envioParadoEm: number[] = []

  /** How many times per minute media remakes because sending does not connect. */
  static readonly REFAZERES_DO_ENVIO_POR_MINUTO = 3

  async #entrarPorSfu(channel: string): Promise<void> {
    const sfu = this.bridge.sfu
    if (!sfu) return

    const refazer = (code: string): void => {
      if (motor !== this.#motor) return
      const agora = Date.now()
      this.#envioParadoEm = this.#envioParadoEm.filter((quando) => agora - quando < 60_000)
      this.#envioParadoEm.push(agora)
      if (this.#envioParadoEm.length > Call.REFAZERES_DO_ENVIO_POR_MINUTO) {
        this.emit("diagnostic", { code: "call-sfu-envio-desistiu" })
        this.emit("error", { detail: "the call media failed" })
        return
      }
      this.emit("diagnostic", { code })
      void this.ligacaoVoltou()
    }
    const motor = new MotorSfu({
      sinalizacao: sfu,
      cifra: this.#cifra,
      criarDispositivo: () => sfu.criarDispositivo(),
      aoDiagnosticar: (code, detail) =>
        this.emit("diagnostic", detail === undefined ? { code } : { code, detail }),
      aoMudar: () => this.#announce(),
      verOEcraDe: (quem) => this.#ecrasAceites.has(quem),
      // The call continues: only the rejected gesture stays undone, and the user sees why.
      aoRecusar: (erro) => this.emit("error", erroDaChamada(erro)),
      /*
        Voice tried the cipher to the cap and gave up (448). Only here the call
        drops, and drops as it did at first until 1.3.0: without encrypted voice
        there is no call through SFU (see the end of `#entrarPorSfu`).
      */
      /*
        The send transport did not connect, or dropped: media remakes, as in a
        reconnect, without releasing the capture (`ligacaoVoltou`). With a cap:
        a network that never lets you connect never stays remaking forever.
      */
      aoEnvioParado: () => refazer("call-sfu-envio-parado"),
      /*
        The server no longer knows our receive transport (4/11/2026): media
        remakes through the same path and with the same cap.
      */
      aoRecepcaoPerdida: () => refazer("call-sfu-recepcao-parada"),
      aoPerderAVoz: (erro) => {
        if (motor !== this.#motor) return
        this.emit("diagnostic", { code: "call-sfu-voz-sem-cifra" })
        this.emit("error", erroDaChamada(erro))
        void this.leave()
      },
    })
    this.#motor = motor

    try {
      await motor.entrar(
        channel,
        ambitoDaChamada(channel, this.#room),
        this.#local?.getAudioTracks()[0] ?? null,
        // The camera, when the call is with video. It comes from the same capture as
        // the voice, it is the `getUserMedia` of always, and the engine only sends
        // it on the air if the router takes it.
        this.#local?.getVideoTracks()[0] ?? null,
      )
      this.emit("diagnostic", { code: "call-sfu-ligado", detail: motor.ambito ?? "" })
    } catch (erro) {
      // Drop everything before going up: an engine halfway leaves transports
      // standing in the server worker and a `#channel` that lies to the interface.
      this.#motor = null
      motor.sair()

      /**
       * What tears down, and what it tells. The two halves were missing.
       *
       * **What used to tear down was only the engine.** This block closed the transports
       * and threw, and everything else stayed up: `#channel` posted, capture
       * open, media gate open, microphone light on. The screen
       * closed the panel because the promise of `join` rejected-and that was it, only that, the
       * "appears and disappears": the interface cleaning itself over a call that the core still
       * thought it had. `#leave(true)`
       * releases everything the input opened; `true` because this never became
       * a real call, and `ended` is the end of one that did.
       *
       * **And what it told was the raw error.** The interface shows the message it
       * gets, and what it got was `createEncodedStreams is not a
       * function`-which is correct, the exact phrase the owner reported word for
       * word, and says nothing to someone who just wanted to talk to someone. The whole thing goes
       * to the log with a proper name, and to the screen goes a sentence.
       */
      const detalhe = String((erro as Error)?.message ?? erro)
      this.emit("diagnostic", { code: "call-sfu-entrada-falhou", detail: detalhe })
      // A cleanup that fails cannot eat the explanation of who told it to do it:
      // it stays said, with the half it belongs to, and the sentence goes on.
      await this.#leave(true).catch((falha: unknown) => {
        this.emit("diagnostic", {
          code: "call-sfu-entrada-falhou",
          detail: `largar: ${String((falha as Error)?.message ?? falha)}`,
        })
      })
      // A server refusal with a specific reason ("call is full", "you have too many
      // calls") means what it says: do not retry (401), because you will be refused
      // again.
      if (ehRecusaDoSfu(erro) && erro.message !== RECUSA_DO_SFU_GENERICA) {
        throw new Error(erro.message, { cause: erro.cause })
      }
      /*
        Voice was not encrypted, so it did not go through (SEC-02). Report it as
        is (448), and the call does not form: without encrypted voice there is no
        SFU call.
        
        Do not fall back to mesh, and this is intentional. Anyone already in the
        room is on the SFU, and a mesh offer client ignores mesh offers
        (`call-sfu-oferta-de-malha`): mesh would give a call where nobody hears
        anybody, with all cards standing. Exit and say so, that is the truth.
        */
      if (ehCifraDoEmissorEmFalta(erro)) throw new Error(erro.message, { cause: erro.cause })
      // The mechanism already went to diagnostics; it also goes in `cause`, so
      // anyone catching the error without listening to the event knows what happened.
      throw new Error("the call could not be set up on this server", { cause: { detalhe } })
    }
  }

  /**
   * An SFU notification: someone started or stopped speaking in this call.
   *
   * It comes from the session `sfu` event through the bridge, the same path
   * where `voice` already comes. This is the only part of the call that the
   * SERVER tells us instead of being told by the encrypted roster. It must be
   * this way: only the router knows when a new stream appears, so only it can
   * route it.
   *
   * Outside an SFU call it does nothing. A notification can arrive after you
   * leave, the socket is faster than the exit, and handling it would resurrect
   * half a call.
   */
  async handleSfuAviso(aviso: {
    t: "producer.new" | "producer.closed"
    channel: string
    scope: string
    producer: string
    address?: UserAddress
    /** With music: see `FONTE_DA_MUSICA` in the protocol. */
    fonte?: FonteDoFluxo
  }): Promise<void> {
    const motor = this.#motor
    if (!motor) return
    if (aviso.t === "producer.closed") {
      motor.produtorFechado(aviso.producer)
      return
    }
    if (!aviso.address) return
    await motor.produtorNovo(aviso.channel, aviso.scope, aviso.producer, aviso.address, aviso.fonte)
  }

  /**
   * Voice signaling when there is SFU: roster, never negotiation.
   *
   * @returns whether this frame was handled here, and if so, mesh does not
   * touch it.
   *
   * `voice.offer`/`voice.answer`/`voice.ice` from an old client falls here and
   * is ignored, which is the only honest behavior: there is no interoperability
   * between a mesh client and an SFU client in the same call, and answering it
   * would set up a second connection to the same person. The schemas stay in the
   * protocol forever, removing them would make these frames count as unknown,
   * and ignored frames in a row mark the channel as dead and trigger repair,
   * which clears history.
   */
  #sinalPorSfu(from: UserAddress, payload: Payload): boolean {
    const motor = this.#motor
    if (!motor) return false

    if (payload.t === "voice.join") {
      const novo = !this.#rosterSfu.has(from)
      this.#rosterSfu.set(from, {
        video: payload.video === true,
        micMuted: payload.muted === true,
        screen: payload.screen === true,
        // Who they chose to watch. Absent means they said nothing, and it reads as
        // watching nobody. See `aVer` in the protocol.
        aVer: payload.aVer ?? [],
        aTocar: payload.aTocar ?? null,
        // Each announcement is also a reaffirmation: the heartbeat sends one of these
        // every `PRESENCA_REAFIRMADA_MS` for `PRESENCA_REAFIRMADA_MS` while the call
        // lasts, and that refreshes the timestamp. Anyone who stopped sending them
        // stopped being there. See `#varrerRoster`.
        quando: Date.now(),
      })
      this.#announce()

      /**
       * Answer whoever arrives, because they did not hear our announcement.
       *
       * Our `voice.join` went out when we entered, before there were listeners
       * on the other side. It is the same timing difference that `#comecarAnuncio`
       * describes in mesh, and that is solved there by repeating the announcement
       * every five seconds. Here there is no periodic announcement on purpose, and
       * the reason written for removing it had a hole: "the gateway introduces
       * people" applies to STREAMS (`sfu.producer.new`) and not to the roster,
       * which still travels encrypted and is what `#anunciarPorSfu` draws.
       *
       * Without this answer, the second to enter receives the media from whoever
       * was already there, decrypts it all, and does not touch it: a stream
       * without a person in the roster does not draw, and without a card on the
       * screen there is no element to touch. Measured in the app on August 16,
       * 2026, 674 frames received, 674 decrypted, and "waiting for someone to
       * enter" on screen.
       *
       * **Only to whoever is new, and this prevents ping-pong.** The answer is a
       * `voice.join` like any other, and an announcement that always generated
       * another announcement would put two clients sending frames to each other
       * forever, until the cap on `sfu.*` per minute closes the call. Anyone
       * already in the roster already heard us; do not repeat.
       */
      if (novo && this.#channel) {
        void this.#anunciar(this.#channel).catch((erro: unknown) => {
          this.emit("error", erroDaChamada(erro, "could not announce you in the call"))
        })
      }
      /*
        An announcement from this person is a signal for their sound (4/11/2026,
        #984): if consuming their stream failed due to a timeout refusal, try
        now; if there is no stream and no consumer for them, ask the server who
        is in the call.
        */
      void motor.pessoaAnunciou(from).catch((erro: unknown) => {
        this.emit("diagnostic", { code: "sfu-ressincronizar-falhou", detail: String((erro as Error)?.message ?? erro) })
      })
      return true
    }

    if (payload.t === "voice.leave") {
      this.#rosterSfu.delete(from)
      // And our choice to watch their screen, which belonged to this call and to
      // them. See `#esquecerEscolhaDeEcra`.
      this.#esquecerEscolhaDeEcra(from)
      this.#announce()
      return true
    }

    // An offer from a mesh client. It goes in the log, because the other person
    // will see "calling" until they give up, and someone will ask why.
    if (payload.t === "voice.offer" || payload.t === "voice.answer" || payload.t === "voice.ice") {
      if (payload.t === "voice.offer") this.emit("diagnostic", { code: "call-sfu-oferta-de-malha", detail: from })
      return true
    }

    return false
  }

  /**
   * What the interface draws when the call is SFU.
   *
   * The list comes from the encrypted roster and the streams come from the
   * engine, and the two halves match by address. A person in the roster with no
   * stream is someone in the call who has not spoken yet, and it draws, because
   * they are there; a stream with no person in the roster does not draw, because
   * the roster is the source of truth for who belongs, and the gateway does not
   * decide that.
   */
  #anunciarPorSfu(motor: MotorSfu): void {
    const fluxos = new Map(motor.fluxos().map((cada) => [cada.address, cada]))
    this.emit("participants", {
      participants: [...this.#rosterSfu].map(([address, estado]) => ({
        address,
        stream: fluxos.get(address)?.stream ?? null,
        // With SFU there is no ICE state per person: there is one connection, to the
        // server. Whoever is in the roster is in the call, and what is missing is
        // sound, which the absence of a stream already says. Also whoever has a stream
        // (the camera, an old consumer) but whose voice is missing: "connected" only
        // for those you hear (4/11/2026). The card says "in call, no sound yet".
        connected: fluxos.has(address) && !motor.somEmFaltaDe(address),
        video: estado.video,
        /*
          Whoever has a stream brings a fact; whoever does not brings a
          capability.
          
          The `?? mediaE2EE` is what is left when there is no stream to talk
          about, and it is a statement about the ENGINE, not about this person,           in Firefox over SFU it is `false` in an entirely encrypted call. Anyone
          reading this field must cross it with the `connected` right next to it:
          without a stream, `encrypted` is not a fact. That is what `notaDaChamada`
          does in the interface, and that is why the footer stopped lying.
          */
        encrypted: fluxos.get(address)?.encrypted ?? mediaE2EE,
        micMuted: estado.micMuted,
        /*
         * The screen, when it exists, and both halves must agree.
         *
         * The stream comes from the engine; the `screen: true` from the encrypted
         * roster is what LIGHTS the badge next to the name. Drawing the stage
         * from the roster alone would give a black rectangle until the stream
         * arrives; from the stream alone would give a stage of someone the server
         * introduced and the roster has not yet confirmed. Here the stage follows
         * the stream, which is what you see.
         *
         * And the stream now only exists if we REQUESTED it: a screen producer
         * is not consumed without choice (see `#consumir` in the engine). That is
         * why `ecraOferecido` next to it, it lights the bar with the "Watch"
         * button, and it comes from the roster, which knows there is a screen to
         * offer.
         */
        screen: fluxos.get(address)?.ecra ?? null,
        ecraOferecido: estado.screen,
        /*
          Is she watching OUR screen?

          Read from her roster, not from the server: the SFU knows who consumes
          what, and whoever shares has no way to ask. What shows is what each
          person SAID they chose, which is a statement from whoever makes it, not
          a record by anyone. See `aVer` in the protocol.
        */
        aVerONossoEcra: estado.aVer.includes(this.bridge.selfAddress),
        aVer: estado.aVer,
        // With SFU the producer only exists while she shares music: the stream is the
        // fact, and the name comes from the roster.
        musica: fluxos.get(address)?.musica ?? null,
        aTocar: estado.aTocar,
      })),
    })
  }

  async #protectSender(sender: RTCRtpSender): Promise<boolean> {
    return this.#cifra.protegerEmissor(sender)
  }

  async #protectReceiver(receiver: RTCRtpReceiver, peerAddress: UserAddress): Promise<boolean> {
    return this.#cifra.protegerReceptor(receiver, peerAddress)
  }
}

/**
 * The name of what is playing, ready for the announcement: no spaces around it,
 * and cut at the schema cap. A longer name would make `Payload.parse` throw
 * inside the announcement, and the call would stop announcing. Empty is nothing.
 */
function nomeCortado(nome: string | null): string | null {
  const limpo = nome?.trim() ?? ""
  if (limpo.length === 0) return null
  return limpo.length > TECTO_DO_NOME_DA_MUSICA ? `${limpo.slice(0, TECTO_DO_NOME_DA_MUSICA - 1)}…` : limpo
}

/**
 * An identifier for this call entry.
 *
 * `getRandomValues` and not `randomUUID`: the latter is only offered by the
 * browser in secure contexts, and this also runs inside Electron from `file://`.
 * A missing `randomUUID` would not give a bad identifier, it would throw an
 * exception in the middle of `#join`, which is the entire call failing to open.
 * Swapping a failure of "I do not see a person" for "I cannot enter" would be a
 * bad trade.
 *
 * Twelve bytes is enough: this only has to tell apart two entries in a row from
 * the same person, not resist anyone. It is not secret, it is not identity, and
 * anyone who fakes it only manages to make themselves redo a connection to
 * themselves.
 */
function novoJoinId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** Resolution requested from the browser. It gives what it can, never more than this. */
function videoConstraints(quality: "auto" | "360p" | "720p" | "1080p"): MediaTrackConstraints {
  switch (quality) {
    case "360p":
      return { width: { ideal: 640 }, height: { ideal: 360 } }
    case "720p":
      return { width: { ideal: 1280 }, height: { ideal: 720 } }
    case "1080p":
      return { width: { ideal: 1920 }, height: { ideal: 1080 } }
    default:
      // Without asking, the browser chooses based on the camera and the network.
      return true as unknown as MediaTrackConstraints
  }
}

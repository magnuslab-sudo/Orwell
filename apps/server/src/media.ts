import {
  PESSOAS_COM_ECRA,
  TECTO_DA_CAMARA,
  TECTO_DA_MUSICA,
  TECTO_DO_ECRA,
  TECTO_DO_SOM_DO_ECRA,
  type FonteDeMedia,
  type FonteDoFluxo,
} from "@enclave/protocol"
import * as mediasoup from "mediasoup"
import type { types } from "mediasoup"
import {
  CUSTO_DA_VOZ_NO_FIO,
  ORCAMENTO_DE_VIDEO_MBPS,
  OrcamentoDeSaida,
  RESERVA_DA_VOZ_MBPS,
  linhaDaSaida,
  type FaixaDeSaida,
  type LeituraDaSaida,
} from "./orcamento-de-saida.js"

/**
 * The media engine: an RTP relay that never opens what it routes.
 *
 * This is Phase 1 of `docs/PLANO_SFU.md`, and it is the first time media
 * crosses this process. The orphaned comment that was in `config.ts`,  * "Where the SFU lives. Media never touches this process.", described the
 * old architecture; the decision of August 15, 2026 inverted it, by
 * the IP argument: in a mesh, two clients only talk directly if they know
 * where the other is, and in a platform built on privacy it takes one person
 * in a call to discover their location.
 *
 * **What this file does not have, and cannot start having, is a media key.**
 * Each client↔server leg is standard WebRTC with DTLS-SRTP, and that
 * cipher, the transport one, ends here, like in any SFU. What is inside
 * is not audio: it is an SFrame frame, encrypted with a key that
 * comes from the MLS exporter of the channel's epoch and that this process does not have nor
 * ever asked for (see `packages/crypto/src/sframe.ts`). The RTP header stays
 * readable, and that is what lets us fragment, drop and reorder without a
 * single content key. Discord decodes streams on the server; we
 * do not. Phase 0 measured it: the 40 packets the router captured from what
 * it routed all opened with the sender's key, in another process, the one that
 * has it (`scripts/sfu-prova/README.md`).
 *
 * **And what this file does not know is who belongs to what.** There is no model of
 * rooms, identities or permissions here, that is why the piece is mediasoup
 * and not LiveKit. The gateway does the admitting, with its
 * `#mayReach` as always and the MLS tree behind it. This engine receives a
 * scope key already validated and an owner mark already authenticated, and the only
 * thing it does with them is keep them from mixing. The caps here are
 * PHYSICAL, how much this machine can handle -, never policy-based.
 */

/**
 * Which direction the media goes on this transport.
 *
 * mediasoup would let you produce and consume on the same `WebRtcTransport`, and the
 * proof of Phase 0 does exactly that, because it is a lab skeleton. The
 * real client cannot: the `mediasoup-client` makes one send transport and
 * one receive transport, each with its own `RTCPeerConnection`, and it is on these
 * objects that the product cipher hangs.
 *
 * Knowing which is which is not housekeeping. It is what allows:
 *  - setting the incoming bandwidth cap on the transport where bandwidth enters, and
 *    not on one that never receives anything;
 *  - refusing a `produce` on a receive transport, which is client incoherence
 *    and not a request to handle;
 *  - having at most one of each per connection and per scope, which makes
 *    `(âmbito, sentido)` a key sufficient for the client to match the response
 *    with the request.
 */
export type Sentido = "envio" | "recepcao"

/** What the client needs to bring up its side of the transport. */
export interface ParametrosDoTransporte {
  id: string
  iceParameters: types.IceParameters
  iceCandidates: types.IceCandidate[]
  dtlsParameters: types.DtlsParameters
}

/** A live producer in a scope, as the gateway announces it to others. */
export interface ProdutorNoAmbito {
  id: string
  kind: types.MediaKind
  /** The mark of who produces it. Opaque to the engine; the gateway knows what it is. */
  dono: string
  /**
   * Microphone, camera or screen, declared by the producer, echoed to the listener.
   *
   * Never inferred from anything visible in the stream: this engine does not open what
   * it routes, and has no way to know if a video is a face or a monitor. See
   * `FonteDeMedia` in the protocol, including what it buys against liars.
   */
  fonte: FonteDeMedia
}

/**
 * A producer as this engine stores it: with the full source, music included.
 *
 * Separate from `ProdutorNoAmbito` because that is what goes out to the gateway, and the
 * gateway writes it on the wire, which does not yet know `musica` (see
 * `FONTE_DA_MUSICA` in the protocol). The conversion is `paraOFio`, in both directions.
 */
interface ProdutorGuardado extends Omit<ProdutorNoAmbito, "fonte"> {
  fonte: FonteDoFluxo
}

/**
 * The source as the wire knows it.
 *
 * While `wire.ts` does not have `musica`, the gateway refuses an `sfu.produce` with
 * it before it gets here, and this conversion never sees one. The tests
 * of this engine see it, because they call it without a gateway. When the wire gets it, both
 * types are the same and this stops converting anything.
 */
function paraOFio(fonte: FonteDoFluxo): FonteDeMedia {
  return fonte as FonteDeMedia
}

/**
 * A refusal with a physical reason, not a random exception.
 *
 * The plan requires that each cap refuse "with a message that states the physical reason,
 * like `LIMITE_DE_PARTILHA` already does today". For that the refusal has to
 * cross the engine→gateway→client boundary with the message intact, and a
 * generic `Error` does not cross: the gateway would have to translate it, and translation is
 * where the message is lost and becomes "internal error".
 *
 * `codigo` is for the client to decide; `message` is for the person to read.
 */
export class RecusaDeMedia extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem)
    this.name = "RecusaDeMedia"
  }
}

/**
 * The router's codecs: Opus for voice, VP8 for camera and screen.
 *
 * **Video landed in Phase 3, and landed with caps, not without them.** While the
 * router only negotiated Opus, a `produce` of video was refused because no
 * codec matched, and that refusal was the cap at work: nothing on this
 * machine was sized to serve 720p to a room. What changed was not
 * the machine, it was the numbers, which became written down (`TECTO_DA_CAMARA`,
 * `TECTO_DO_ECRA`, `PESSOAS_COM_ECRA`) and applied at producer admission.
 *
 * **VP8 and only VP8, and since August 18 the reason is different, harder, and measured.**
 * What was written here was that H.264 would bring `profile-level-id` and
 * `packetization-mode` to match, and would bring "the temptation to serve Safari,
 * which has no insertable streams and therefore no media cipher at all". The
 * second half fell away: Safari GAINED media cipher on that date, through
 * `RTCRtpScriptTransform` in a worker, measured on all three engines. The reason that remains
 * is not about negotiation or tidiness:
 *
 * **Full-frame cipher does not survive H.264's packetizer, on any engine.**
 * Measured with the codec forced and the same cipher running
 * (`scripts/sfu-script-transform-por-motor.mjs`):
 *
 * | engine | codec | encrypted | decrypted | packets | frames |
 * |---|---|---|---|---|---|
 * | WebKit | VP8 | 86 | 90 | 107 | 86 |
 * | WebKit | H.264 | 85 | 0 | **1** | 0 |
 * | Chromium | VP8 | 90 | 97 | 112 | 89 |
 * | Chromium | H.264 | 90 | 0 | **15** | 0 |
 *
 * H.264 (RFC 6184) splits a frame by SCANNING the bitstream for NALU start codes;
 * encrypted there are none, and the packetizer cannot split the frame, one packet comes out. VP8
 * (RFC 7741) puts its own descriptor at the front, written from what the encoder said, and treats
 * the payload as opaque. That is why the same cipher passes on one and collapses on the other.
 *
 * **Adding H.264 to this list wipes video from everyone, and silently**: the
 * frames keep being encrypted and counted, and what is missing is from the wire. Anyone who really wants it
 * must first leave the codec header in the clear, another wire format, and content bytes
 * visible to this process. Two tests guard this in `media.test.ts`, one by the list and one by the mechanism.
 * VP9 and AV1 would be legitimate by this standard; H.265 is not.
 *
 * **What the SFU does with the payload stays nothing.** VP8 here is a name
 * in a list, not a capability to look inside: what goes in the payload is
 * an SFrame frame encrypted with the epoch key, and the VP8 payload descriptor that
 * the router needs to read is written by the browser's RTP packetizer AFTER
 * our transformation. That is why cipher and routing coexist
 * without knowing each other.
 *
 * `x-google-start-bitrate` tells the Chrome encoder where to START, and it is
 * not a cap: starting at 300 kbps of default makes the first seconds of a shared
 * screen unreadable while congestion control climbs by trial and error.
 *
 * The parameters are not decoration, and not tuning for later, they are the
 * difference between fitting and not fitting on a two-core machine shared
 * with the website:
 *
 *  - `usedtx=1` (discontinuous transmission), and it is the biggest of all. In a conversation
 *    each person speaks maybe a quarter of the time. Without DTX Opus sends
 *    encoded silence all the time; with DTX it stops sending when nobody speaks.
 *    It cuts about seventy percent of voice traffic and what you hear does not
 *    change.
 *  - `maxaveragebitrate=32000` and `sprop-stereo=0`. Spoken voice at 24-32 kbps
 *    mono is indistinguishable from 64 kbps stereo, and is half. With DTX on top,
 *    a four-person room goes from ~600 kbps outbound to around one hundred.
 *
 *  - `cbr=1` (constant bitrate, 3/11/2026). In variable bitrate each voice packet
 *    has the size the sound asks for, and the sequence of sizes lets you guess
 *    sentences with encrypted voice (Wright et al., "Spot me if you can").
 *    In CBR all voice packets have the same size; DTX still
 *    cuts silence, and only who speaks and when becomes visible. This is the only
 *    place where it is asked in the SFU: mediasoup-client does not have `opusCbr`, and the
 *    response it builds for send starts from these parameters
 *    (`RemoteAnswerMediaSection`), which is the fmtp that Chrome reads to
 *    set up the encoder. It applies to all Opus (voice, screen audio,
 *    music): the router has one. See `docs/planos/voz-cbr-relatorio.md`.
 *
 * **They have to be on both sides**, here and in the producer's `codecOptions` on
 * the client: Chrome ignores them if only in the router. See `scripts/sfu-prova/pagina.js`,
 * where Phase 0 put them running, and point 4 of "what Phase 1 can assume".
 *
 * `channels: 2` stays: mediasoup requires it for Opus. What decides that it encodes
 * mono is `sprop-stereo=0`.
 */
/*
 * `RouterRtpCodecCapability` and not `RtpCodecCapability`: the difference between the
 * two is `preferredPayloadType`, required in the second and optional in the
 * first, when it is missing, mediasoup picks one. It is the right type for what
 * you declare to a router, and the compiler caught the swap right away.
 */
const CODECS: types.RouterRtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    parameters: { useinbandfec: 1, usedtx: 1, cbr: 1, "sprop-stereo": 0, maxaveragebitrate: 32000 },
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: { "x-google-start-bitrate": 600 },
  },
]

/**
 * How many connections fit in a scope.
 *
 * **Fifty since 3 November 2026, and the number was MEASURED.** It was
 * sixteen, counted against an output of ~50 Mbit/s that no one had measured.
 * The measured output of the VPS is 300 a 745 Mbit/s (`docs/planos/depois-da-1-0.md`,
 * "VPS Bandwidth"), and the load test (`scripts/sfu-carga/`, report in
 * `docs/planos/limites-media-relatorio.md`) measured what fifty costs:
 *
 *   50 pessoas, 10 a speaking and 40 em DTX     2 450 consumidores   36 Mbit/s
 *                                          29 400 pacotes/s     ~56 % of one VPS core
 *   50 pessoas, all speaking (worst case)  122 500 pacotes/s   165 Mbit/s
 *                                                               more than one core
 *
 * **What closes here is the processor, not the bandwidth.** Voice costs per PACKET, and
 * there are `pessoas × (pessoas − 1)` streams: the number grows with the square. The worst
 * case in theory, everyone speaking at once, does not happen in conversation
 * (the plan counts on DTX cutting to one fifth, and those are the 10 a speaking);
 * at 60 (12 a speaking) the realistic case measures ~67 % of one core, and the headroom is gone.
 *
 * It is counted by CONNECTION and not by account, on purpose: two tabs of the same
 * person are two streams and cost twice. The cap exists to protect the
 * network interface, and the interface does not know how to tell tabs apart.
 */
export const PARTICIPANTES_POR_AMBITO = 50

/**
 * How many scopes one connection can have open at the same time.
 *
 * A person is in one call at a time. The number is not 1 because `voice.move`,  * switching voice rooms without leaving the call, passes through an instant with
 * both scopes open, and a cap of 1 would turn a feature that exists into a
 * refusal. Four gives headroom for that and for re-entry on top of a scope that
 * has not yet cleaned up, and it remains a cap: without one, an automated client
 * would open a thousand routers with a thousand frames.
 */
export const AMBITOS_POR_LIGACAO = 4

/**
 * How many producers fit in one send transport.
 *
 * Five: microphone, camera, screen image, screen audio, and music. It was one
 * while Phase 1 carried only voice, three after screen gained audio, and four
 * after music (October 2026): screen audio is its own producer with source `ecra`
 * and audio kind, and music is another with source `musica`. Neither passes
 * through the voice chain.
 *
 * **We change it here, not in the client**, and it is the same argument as always:
 * a cap asked of the client is not a cap. Four is the right number for the same
 * reason five is not ten. Each source has its place (`#lugarDaFonte`), and a
 * sixth producer can only be a second camera or a second screen, which nobody has
 * and which would double the person's output for nothing in return.
 */
export const PRODUTORES_POR_TRANSPORTE = 5

/**
 * How many cameras fit in a call, at the same time.
 *
 * **Four since 3 November 2026.** It was two since 18 August, when
 * they dropped from four so that the 720p would be 720p (`TECTO_DA_CAMARA` of 600
 * kbit/s to 1,2 Mbit/s) against a slice of ~50 Mbit/s that had never been
 * measured. The VPS output was measured (300 a 745 Mbit/s), and the camera runs at 1,2
 * Mbit/s: four come back without losing quality from any of them.
 *
 * The count is `bitrate × quem consome × quantas câmaras`, and the worst case the
 * product lets you set up is this, measured in the load test
 * (`docs/planos/limites-media-relatorio.md`):
 *
 *   50 pessoas, 4 c cameras, 10 a speaking    4 × 49 × 1,2 Mbit/s + voice = 290 Mbit/s
 *                                        ~77 % of one VPS core (estimated)
 *   50 pessoas, 2 c cameras, 10 a speaking    163 Mbit/s, ~66 % of one core
 *
 * **What costs is the people, not the cameras.** From two to four cameras at 50
 * people the worker rises from ~66 % to ~77 %; the voice of fifty already counts for ~56 %.
 * The 290 Mbit/s are below the lowest measurement of the output (301), and it is the rare case
 * of a full call with four cameras connected.
 *
 * **Two and not one** still holds true for the same reason: a two-person call
 * with video has two cameras.
 *
 * **More than four calls for simulcast**, not a bigger number: whoever sees a person
 * in miniature does not need to receive 720p, and that is what the output pays for today
 * (section 6 do plan, and the M3 in `docs/planos/estado-cifrado-plano.md`).
 */
export const CAMARAS_POR_AMBITO = 4

/**
 * How many screens are shared at the same time in one call.
 *
 * **Two since November 3, 2026.** It was one, because 2 × 10 × 2.5 Mbit/s was
 * 50 Mbit/s, the whole slice of an output that was not measured. With measured
 * output (300 to 745 Mbit/s), two screens fit, and the cap on people who share
 * them (`PESSOAS_COM_ECRA`, 20) is what stops the math from running away:
 *
 *   20 people, 4 cameras, 2 screens with audio, 4 speaking
 *       (4 × 1.2 + 2 × 2.5) × 19 + voice = 209 Mbit/s, ~61 % of a VPS core
 *
 * measured in the load test with EVERYONE seeing both screens, which is more than
 * the product actually uses: a screen is consumed only by those who hit "View".
 */
export const ECRAS_POR_AMBITO = 2

/*
 * `TECTO_DA_CAMARA` and `TECTO_DO_ECRA` live in the PROTOCOL, not here.
 *
 * It is not just tidiness: it is the client that declares these numbers in the
 * encoding and this server that refuses them when they exceed the cap. Written on
 * both sides, a cap of 1.2 Mbps here and 1.3 there would give a camera that never
 * turns on, with a refusal telling the truth about a disagreement nobody sees. The
 * plan in section 7 set 1.5 Mbps for up to four people and 600 kbps above that;
 * here it is 1.2 always, and the difference is deliberate. A cap that changes with
 * who is in the room must be reapplied on every entry and exit, which is the kind
 * of work that the move to SFU existed to wipe out (`#reajustarTectoDoEcra`, in
 * the mesh).
 */

/**
 * The inbound bandwidth cap per transport, in bits per second.
 *
 * It was 128 000 when only voice went through one transport. Now three flows go
 * through it, and the number must cover all three summed. It is a TRANSPORT cap,
 * and the three producers of one person share it:
 *
 *   screen       2 500 000
 *   camera       1 200 000   (it was 600 000 until 720p became 720p)
 *   microphone      60 000   (32 kbps Opus is 50-60 on the wire)
 *              ---------
 *              3 760 000   and so 5 000 000, with headroom paying for
 *                          retransmissions and congestion control probing
 *
 * **It rose with the camera, and it had to.** Staying at 4 000 000 with the
 * camera at 1.2 Mbps left 240 kbps of headroom for everything. A tight inbound
 * cap does not save the server anything: what it pays for is output, and one
 * person's input is one only, whether there are two in the call or fifty. Tightening
 * it to the exact sum is buying a call that cuts itself off on normal networks in
 * exchange for bandwidth that was not in question.
 *
 * Tightening it to the exact sum would give a call that cuts itself off on normal
 * networks, which is the most expensive way to find out that you saved too much
 * bandwidth.
 *
 * **What this is and what it is not.** It is the only cap in this list that
 * resists a lying client: it applies on the transport, on the server side, and
 * does not depend on the client declaring anything. The codec `maxaveragebitrate`
 * and the budget check in `#orcamentoExcedido` catch wrong config and honest
 * clients; to an adversarial client only this and the participant cap say no.
 *
 * **And until Phase 3 it had never been seen to bite**, because a 32 kbps Opus
 * stream never comes close to 128 000: a cap you never reach refuses nothing. With
 * a screen at 2.5 Mbps under it, it becomes measurable. That is what
 * `scripts/sfu-prova-fase3/tecto.mjs` measures, by difference against this line.
 */
export const BANDA_DE_ENTRADA_POR_TRANSPORTE = 5_000_000

/**
 * The cap that a codec declaration can request, in bits per second.
 *
 * Double the `maxaveragebitrate=32000` that the router announces. A client that
 * asks for more than this is misconfigured or pushing its luck, and either way
 * the answer is the same and is spelled out in full.
 */
export const ORCAMENTO_DE_CODEC = 64_000

/**
 * What each source can declare it will request, in bits per second.
 *
 * A map, not three conditionals scattered around: the source picks its cap in one
 * place only, and a new source without a cap becomes a compile error instead of a
 * flow with no cap.
 *
 * The two video numbers are the encoding caps themselves, with no headroom, unlike
 * audio: the Opus `maxaveragebitrate` describes the codec and the wire cost is
 * higher, while a video encoding `maxBitrate` is the target the encoder chases.
 * Declaring more than the cap is declaring that you will exceed it.
 */
const ORCAMENTO_POR_FONTE: Record<Exclude<FonteDoFluxo, "musica">, number> = {
  microfone: ORCAMENTO_DE_CODEC,
  camara: TECTO_DA_CAMARA,
  ecra: TECTO_DO_ECRA,
}

/**
 * What SCREEN AUDIO can declare, in bits per second.
 *
 * Double the client cap (`TECTO_DO_SOM_DO_ECRA`), for the same reason that
 * `ORCAMENTO_DE_CODEC` is double the 32 kbps of voice: the Opus `maxaveragebitrate`
 * describes the codec, and the wire cost is higher.
 */
export const ORCAMENTO_DO_SOM_DO_ECRA = 2 * TECTO_DO_SOM_DO_ECRA

/**
 * What MUSIC can declare, in bits per second: same as screen audio.
 *
 * The same math (double the client cap, `TECTO_DA_MUSICA`), because it is the
 * same stereo Opus at 64 kbps. It gets its own name so the refusal message can say
 * "music", and so the two numbers can diverge one day without anyone having to
 * separate them by hand.
 */
export const ORCAMENTO_DA_MUSICA = 2 * TECTO_DA_MUSICA

/** The budget of one flow: the source decides, and the screen decides too by kind. */
function orcamentoDe(fonte: FonteDoFluxo, kind: types.MediaKind): number {
  if (fonte === "musica") return ORCAMENTO_DA_MUSICA
  return fonte === "ecra" && kind === "audio" ? ORCAMENTO_DO_SOM_DO_ECRA : ORCAMENTO_POR_FONTE[fonte]
}

/**
 * What consuming this flow costs on the server output, and in which band.
 *
 * Video counts by the producer cap (screen 2.5 Mbit/s, camera 1.2), which is the
 * encoder target. Audio counts by the wire cost: voice at ~35 kbit/s, screen audio
 * and music by the client cap. See `OrcamentoDeSaida`.
 */
function custoNaSaida(fonte: FonteDoFluxo, kind: types.MediaKind): { faixa: FaixaDeSaida; bits: number } {
  if (kind === "video") return { faixa: "video", bits: fonte === "ecra" ? TECTO_DO_ECRA : TECTO_DA_CAMARA }
  if (fonte === "microfone") return { faixa: "voz", bits: CUSTO_DA_VOZ_NO_FIO }
  return { faixa: "voz", bits: fonte === "musica" ? TECTO_DA_MUSICA : TECTO_DO_SOM_DO_ECRA }
}

/** The budget refusal. The message is for the log; the client translates by code. */
function servidorCheio(leitura: LeituraDaSaida): RecusaDeMedia {
  const uso = Math.round(leitura.video.uso / 1_000_000)
  const tecto = Math.round(leitura.video.tecto / 1_000_000)
  return new RecusaDeMedia(
    "servidor-cheio",
    `o servidor já envia ${uso} de ${tecto} Mbit/s de vídeo, somadas todas as chamadas: mais uma transmissão degradava todas, a voz incluída`,
  )
}

/** The name of one flow in a refusal message: "already sending …", "the cap for …". */
function nomeDoFluxo(fonte: FonteDoFluxo, kind: types.MediaKind, artigo: boolean): string {
  if (fonte === "microfone") return artigo ? "o microfone" : "voz"
  if (fonte === "camara") return "a câmara"
  if (fonte === "musica") return "a música"
  return kind === "audio" ? "o som do ecrã" : "o ecrã"
}

/**
 * How often the server requests a keyframe from whoever is sharing the screen.
 *
 * **The safety net for pixelated screen share** (November 2, 2026). The cause was
 * the encrypted VP8 header: the SFU and Chrome read the SFrame header as VP8, treated
 * differential frames as key, and the receiver never asked for a keyframe (PLI) because
 * nothing appeared to be missing. Measured with `scripts/sfu-prova-ecra/`: with encryption,
 * ONE keyframe in 12 s of sharing and the image falling apart top to bottom; without
 * encryption or with the header in clear, clean image. The fix is in the encryption
 * (`bytesEmClaroDoVp8`). This stays below it, for two reasons:
 *
 *  - a 1.0.5 sender in a call with the new server keeps encrypting the header, and
 *    its receivers never ask: only a request from outside saves it;
 *  - the screen is the only flow where the viewer starts partway through and where
 *    a loss stays on screen for a long time (still text does not refresh itself).
 *
 * Three seconds: a keyframe of the screen at 1080p measured 34 to 42 KB, so it costs
 * about 100 kbit/s alongside the 2.5 Mbit/s cap. Only while someone is watching (a
 * resumed consumption); a screen nobody watches costs nothing.
 */
export const INTERVALO_DA_CHAVE_DO_ECRA = 3000

/**
 * The minimum interval between two keyframe requests from the SAME consumer (Phase M2).
 *
 * The viewer requests (`sfu.keyframe`) when the decoder gets lost. One second is
 * enough for the image to come back in less than one, and it is the cap that a
 * tampered client cannot pass: a keyframe of the screen at 1080p measured 34 to
 * 42 KB, and requests without a cap would make the sender output only keyframes
 * (its spike and the server output multiplied by viewers). The client already
 * restrains itself at the same pace; this line is what counts against those who
 * do not.
 */
export const INTERVALO_DO_FOTOGRAMA_CHAVE_PEDIDO = 1000

interface Ambito {
  chave: string
  router: types.Router
  /** The connections that came in, and the transports of each. */
  membros: Map<string, Set<string>>
  produtores: Map<string, ProdutorGuardado>
  fechado: boolean
}

interface RegistoDeTransporte {
  transporte: types.WebRtcTransport
  chaveDoAmbito: string
  dono: string
  sentido: Sentido
  /**
   * The producers of this transport, by object and not just by id.
   *
   * It was a `Set<string>` while nobody needed to close a producer without closing
   * the transport underneath. Stop sharing the screen: that is exactly this. The
   * call goes on, the microphone goes on. To do it you need the object in hand.
   * See `fecharProdutor`.
   */
  produtores: Map<string, { produtor: types.Producer; fonte: FonteDoFluxo }>
  consumidores: Map<string, types.Consumer>
}

export interface OpcoesDoMotor {
  /** The unique port, UDP and TCP. */
  porto: number
  /** The address to announce in ICE candidates. Empty uses the listen address. */
  anunciarIp: string
  /** Which interface to listen on. `0.0.0.0` in Docker, `127.0.0.1` in tests. */
  escutarEm?: string
  /** The interval of the screen keyframe, in ms. Only tests change it. See `INTERVALO_DA_CHAVE_DO_ECRA`. */
  intervaloDaChaveDoEcra?: number
  /**
   * The output budget of the entire server, in bits per second. Default
   * `ORCAMENTO_DE_VIDEO_MBPS` and `RESERVA_DA_VOZ_MBPS`. See `OrcamentoDeSaida`.
   */
  orcamentoDeSaida?: { videoBps: number; reservaDaVozBps: number }
  /** Where to write engine log lines. Default, stderr. */
  registar?: (linha: string) => void
}

export class MotorDeMedia {
  #worker: types.Worker
  #webRtcServer: types.WebRtcServer
  /** Scopes being born or already born, by promise. See `#ambito`. */
  #ambitos = new Map<string, Promise<Ambito>>()
  /** The same, resolved, for those who need to look without waiting. */
  #ambitosResolvidos = new Map<string, Ambito>()
  #transportes = new Map<string, RegistoDeTransporte>()
  #fechado = false
  /** The consumers of each screen image, so the keyframe clock can pick who to ask. */
  #consumosDoEcra = new Map<string, Set<types.Consumer>>()
  /** The keyframe clocks, one per screen image. */
  #relogiosDoEcra = new Map<string, ReturnType<typeof setInterval>>()
  /** How many keyframes were requested per screen image. For tests and for the log. */
  #chavesPedidas = new Map<string, number>()
  readonly #intervaloDaChaveDoEcra: number
  /** The summed output of all calls. See `OrcamentoDeSaida`. */
  readonly #orcamento: OrcamentoDeSaida
  /**
   * The key of each consumer's reserve, and what it costs. The reserve leaves on
   * pause and returns on `resume`; entry here leaves only when the consumer closes.
   */
  #reservasDosConsumidores = new Map<string, { chave: string; produtor: string; faixa: FaixaDeSaida; bits: number }>()
  /** For the keys of reserves made before the consumer has an id. */
  #reservasFeitas = 0

  private constructor(worker: types.Worker, webRtcServer: types.WebRtcServer, opcoes: OpcoesDoMotor) {
    this.#worker = worker
    this.#webRtcServer = webRtcServer
    this.#intervaloDaChaveDoEcra = opcoes.intervaloDaChaveDoEcra ?? INTERVALO_DA_CHAVE_DO_ECRA
    const registar = opcoes.registar ?? ((linha: string) => void process.stderr.write(`${linha}\n`))
    this.#orcamento = new OrcamentoDeSaida(
      opcoes.orcamentoDeSaida?.videoBps ?? ORCAMENTO_DE_VIDEO_MBPS * 1_000_000,
      opcoes.orcamentoDeSaida?.reservaDaVozBps ?? RESERVA_DA_VOZ_MBPS * 1_000_000,
      // Voice passes through the same; it is said so the operator knows the reserve is short.
      (leitura) => registar(`enclave: a voz passou da reserva de saída, e continua a passar: ${linhaDaSaida(leitura)}`),
    )

    /**
     * The worker is a subprocess, and a subprocess dies.
     *
     * When it dies, all routers, transports, and producers die with it on the native
     * side. On the Node side, our maps would fill with objects that no longer
     * represent anything, and the worst that could happen next was `hello.ok`
     * continuing to announce the `sfu` capability to clients who would then negotiate
     * with a closed port. That is why the gateway reads `estaDePe()` at each `hello`
     * instead of keeping a boolean decided at startup: the truth changes, and it
     * changes without asking anyone.
     */
    worker.on("died", () => {
      this.#ambitos.clear()
      this.#ambitosResolvidos.clear()
      this.#transportes.clear()
      this.#reservasDosConsumidores.clear()
      this.#orcamento.limpar()
    })
  }

  /**
   * Start the media engine: one worker, one `WebRtcServer`, one port.
   *
   * **ONE worker, not one per core.** Everyone's recipe is
   * `numWorkers = os.cpus().length` and it's wrong on this machine: the VPS has two
   * cores and eight GB, shared with nginx, Postgres, bots and
   * magnuslab.pt. One worker leaves an entire core for them. The
   * dominant cost of an SFU is network, not CPU, one worker handles hundreds of voice
   * flows -, and the wrong scale only shows up on a bad day. This is written here because
   * this is where someone would change it without thinking.
   *
   * **Measured on November 3, 2026** (`scripts/sfu-carga/`, report in
   * `docs/planos/limites-media-relatorio.md`): one worker takes ~115,000 packets
   * per second at 72% of an M4 core, giving ~55,000 at 70% of a VPS core,
   * estimated. At that point ~400 Mbit/s is already leaving, which is the measured
   * output of the machine. A second worker would take the core from the site and databases to
   * serve bandwidth the network card no longer has, and it would not help a large
   * call: a router lives in one worker only.
   *
   * A `WebRtcServer` with two `listenInfos`, UDP and TCP with the SAME number,    * multiplexes all transports on a single port. Phase 0 proved this and
   * it's what makes UFW two rules. TCP is the way out for networks that
   * block UDP, and it's why coturn is no longer needed
   * to cross NAT.
   *
   * All transports in this file are born with `webRtcServer`, and it must
   * stay that way: a `createWebRtcTransport` without it would get a port
   * from the worker's range (10000-59999 by default), which UFW does not open, and the
   * symptom would be a call that negotiates entirely successfully and never connects.
   */
  static async arrancar(opcoes: OpcoesDoMotor): Promise<MotorDeMedia> {
    const escuta = opcoes.escutarEm ?? "0.0.0.0"

    /*
     * Listening on all interfaces without saying what to announce is a silent call.
     *
     * Without `announcedAddress`, mediasoup puts the LISTEN address in the
     * ICE candidates, and `0.0.0.0` is not a place where someone can send.
     * The failure mode is the worst there is, because it is completely silent: the server
     * starts, `hello.ok` announces the `sfu` capability, clients choose the
     * SFU, both transports are created, ICE goes to `failed`, and what the person
     * sees is a call set up with everyone silent. No line on
     * startup, no error on the client.
     *
     * It's the Docker configuration, `bindHost` different from `127.0.0.1`, with
     * `ENCLAVE_SFU_ANNOUNCED_IP` forgotten, and section 6 of `docs/PLANO_SFU.md`
     * already said that this address is required. Nothing required it until now.
     *
     * Refusing is better than starting: whoever hits this in `app.ts` writes the
     * reason and leaves calls in MESH, without announcing the capability. A mesh
     * call is a call; a call through an SFU no one can reach is
     * nothing. And fail BEFORE creating the worker, an orphaned worker is a
     * subprocess consuming memory forever.
     */
    if (!opcoes.anunciarIp && (escuta === "0.0.0.0" || escuta === "::")) {
      throw new Error(
        `o motor de media escuta em ${escuta} e não tem endereço para anunciar: ` +
          "põe ENCLAVE_SFU_ANNOUNCED_IP com o IP público desta máquina. " +
          "Sem ele os candidatos ICE saem com o endereço de escuta, para onde nenhum cliente sabe enviar, " +
          "e as chamadas montam-se mudas.",
      )
    }

    const worker = await mediasoup.createWorker({ logLevel: "warn" })
    // Empty `announcedAddress` must be ABSENT, not an empty string: mediasoup
    // treats the empty string as an address to announce and ICE
    // candidates come out with no address at all.
    const anunciado = opcoes.anunciarIp ? { announcedAddress: opcoes.anunciarIp } : {}
    try {
      const webRtcServer = await worker.createWebRtcServer({
        listenInfos: [
          { protocol: "udp", ip: escuta, port: opcoes.porto, ...anunciado },
          { protocol: "tcp", ip: escuta, port: opcoes.porto, ...anunciado },
        ],
      })
      return new MotorDeMedia(worker, webRtcServer, opcoes)
    } catch (erro) {
      // An orphaned worker is a subprocess consuming memory forever. The
      // common case here is the port in use, which on a shared machine is
      // exactly what you expect to happen one day.
      worker.close()
      throw erro
    }
  }

  /**
   * Is the media engine running?
   *
   * This is the predicate, not an environment variable, that decides whether
   * `hello.ok` announces the `sfu` capability, because announcing a capability is
   * a promise, and a client that hears it stops building the mesh.
   */
  estaDePe(): boolean {
    return !this.#fechado && !this.#worker.closed
  }

  /** The worker's pid, so startup can say it out loud. */
  get pid(): number {
    return this.#worker.pid
  }

  // ------------------------------------------------------------------ scopes

  /**
   * The scope, created at the first arrival and reused by all the others.
   *
   * The map holds the PROMISE, not the resolved scope, and this is not style: two
   * clients entering the same call at the same instant both enter here
   * before any `await` resolves, and with a map of resolved values they
   * would create two routers for the same key. The second router would be orphaned, and
   * an orphaned router is not just memory: **a consumer can only consume a
   * producer from the SAME router**, so half the room would not hear the other
   * half, with no error anywhere.
   */
  async #ambito(chave: string): Promise<Ambito> {
    const existente = this.#ambitos.get(chave)
    if (existente) return existente

    const criacao = (async (): Promise<Ambito> => {
      const router = await this.#worker.createRouter({ mediaCodecs: CODECS })
      const ambito: Ambito = { chave, router, membros: new Map(), produtores: new Map(), fechado: false }
      // The resolved map exists for SYNCHRONOUS reads, `sairDoAmbito` and counting
      // scopes of a connection, which cannot wait for a promise without opening a
      // window where two requests cross.
      this.#ambitosResolvidos.set(chave, ambito)
      return ambito
    })()

    this.#ambitos.set(chave, criacao)
    try {
      return await criacao
    } catch (erro) {
      // A failed creation cannot stay in the map: everyone asking for
      // this scope after would get the same failure, forever.
      this.#ambitos.delete(chave)
      throw erro
    }
  }

  /**
   * Enter a scope and receive what is needed to negotiate with it.
   *
   * `chave` is already validated by the gateway and carries the channel inside, see
   * `chaveDeAmbito` in the gateway, and why the channel must be part of
   * it. Here it is an opaque string, and that is how we want it: this engine does not know
   * what a channel is and has no way to find out.
   */
  async entrar(chave: string, dono: string): Promise<{ rtpCapabilities: types.RtpCapabilities; produtores: ProdutorNoAmbito[] }> {
    this.#exigirDePe()

    const jaMeus = this.#ambitosDe(dono)
    if (jaMeus.size >= AMBITOS_POR_LIGACAO && !jaMeus.has(chave)) {
      throw new RecusaDeMedia(
        "demasiados-ambitos",
        `esta ligação já está em ${AMBITOS_POR_LIGACAO} chamadas ao mesmo tempo`,
      )
    }

    const ambito = await this.#ambitoVivo(chave)

    if (!ambito.membros.has(dono) && ambito.membros.size >= PARTICIPANTES_POR_AMBITO) {
      throw new RecusaDeMedia(
        "chamada-cheia",
        `esta chamada já tem ${PARTICIPANTES_POR_AMBITO} pessoas, que é o que a ligação do servidor aguenta com a voz de toda a gente a passar por ele`,
      )
    }

    if (!ambito.membros.has(dono)) ambito.membros.set(dono, new Set())

    return {
      rtpCapabilities: ambito.router.rtpCapabilities,
      // Latecomers must catch producers that already exist, otherwise they only
      // hear whoever speaks after them.
      produtores: [...ambito.produtores.values()].map((cada) => ({ ...cada, fonte: paraOFio(cada.fonte) })),
    }
  }

  /**
   * A scope that is live, not one that the last member to leave is closing.
   *
   * **The race:** `entrar` waits for the scope and only then subscribes to it.
   * In that wait, the last member can exit, and `#talvezFecharAmbito` closes the
   * router for someone with no one left, without knowing that someone is arriving at
   * the same instant. The arrival would be subscribed to a dead scope and would receive
   * `rtpCapabilities` from a closed router: it loaded the device with them and the
   * `sfu.transport.create` next was rejected with "this connection did not join
   * this call", about a call it had just joined and heard yes to. The call would not set up and the message sent you looking in the wrong place.
   *
   * This engine CANNOT assume that requests arrive one at a time: the gateway
   * dispatches each frame with a `void this.#dispatch(...)`, and two sockets that
   * speak at the same time cross paths here.
   *
   * **Retry and do not wait:** a closed scope is already out of the map
   * (`#talvezFecharAmbito` removes it), so the next loop builds a
   * new router instead of finding the same corpse. Three loops is a cap and
   * not a tuning, each one needs an exit of the last member to fall
   * within the creation of a router, and three in a row is not a race, it is a
   * fault elsewhere that must be reported instead of spinning here forever.
   */
  async #ambitoVivo(chave: string): Promise<Ambito> {
    for (let volta = 0; volta < 3; volta++) {
      const ambito = await this.#ambito(chave)
      if (!ambito.fechado) return ambito
    }
    throw new RecusaDeMedia(
      "ambito-instavel",
      "esta chamada está a ser fechada e reaberta ao mesmo tempo: tenta outra vez",
    )
  }

  /** The scopes this connection entered. */
  #ambitosDe(dono: string): Set<string> {
    const chaves = new Set<string>()
    for (const [chave, ambito] of this.#ambitosResolvidos) {
      if (ambito.membros.has(dono)) chaves.add(chave)
    }
    return chaves
  }

  // --------------------------------------------------------------- transportes

  /**
   * A transport in one direction in a scope.
   *
   * One per direction per connection and per scope. A second request in the same
   * direction is rejected instead of replacing the first: replacing would leave the
   * client with two transports and one of them receiving media that no one
   * can decode, and the pair `(âmbito, sentido)` would no longer identify one thing only.
   */
  async criarTransporte(chave: string, dono: string, sentido: Sentido): Promise<ParametrosDoTransporte> {
    this.#exigirDePe()
    // The scope is read from the RESOLVED map, not created here. `#ambito` would create
    // a router for the requested key and only afterwards would we discover that the
    // requester never joined the call, and that router would stay forever: zero
    // members, so `#talvezFecharAmbito` never reaches it, and each rejected
    // request left another behind. One router per rejected frame is a
    // memory leak in the worker at socket speed.
    //
    // And it is the right order by itself: a transport is only created in a call that
    // has already been joined, and joining is what makes the scope exist.
    const ambito = this.#ambitosResolvidos.get(chave)
    const meus = ambito?.membros.get(dono)
    if (!ambito || !meus) {
      throw new RecusaDeMedia("fora-do-ambito", "esta ligação não entrou nesta chamada")
    }

    for (const id of meus) {
      if (this.#transportes.get(id)?.sentido === sentido) {
        throw new RecusaDeMedia("transporte-repetido", `esta ligação já tem um transporte de ${sentido} nesta chamada`)
      }
    }

    const transporte = await ambito.router.createWebRtcTransport({
      webRtcServer: this.#webRtcServer,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    })

    // The cap goes on the transport through which the bandwidth ENTERS. On a
    // receiving one it would do nothing: what leaves here is decided by us.
    if (sentido === "envio") {
      await transporte.setMaxIncomingBitrate(BANDA_DE_ENTRADA_POR_TRANSPORTE)
    }

    this.#transportes.set(transporte.id, {
      transporte,
      chaveDoAmbito: chave,
      dono,
      sentido,
      produtores: new Map(),
      consumidores: new Map(),
    })
    meus.add(transporte.id)

    return {
      id: transporte.id,
      iceParameters: transporte.iceParameters,
      iceCandidates: transporte.iceCandidates,
      dtlsParameters: transporte.dtlsParameters,
    }
  }

  /** The DTLS handshake, with the parameters the client generated. */
  async ligarTransporte(dono: string, id: string, dtlsParameters: types.DtlsParameters): Promise<void> {
    const registo = this.#meuTransporte(dono, id)
    await registo.transporte.connect({ dtlsParameters })
  }

  /**
   * Is the transport mine?
   *
   * The question looks like paranoia because the gateway already only passes here identifiers
   * it read from its own structures. This is the second lock, and it exists because
   * the first is a line of code someone can reorder: a transport identifier is
   * guessable enough to be worth the effort, and without this
   * check an `sfu.produce` with someone else's id puts media in
   * their call in their name.
   */
  #meuTransporte(dono: string, id: string): RegistoDeTransporte {
    const registo = this.#transportes.get(id)
    if (!registo || registo.dono !== dono) {
      throw new RecusaDeMedia("transporte-desconhecido", "esse transporte não existe nesta ligação")
    }
    return registo
  }

  // ----------------------------------------------------------------- produzir

  /**
   * The source of this stream, with the absence read by `kind`.
   *
   * A Phase 2 client never sends `fonte`, audio only, and reading
   * the absence must keep serving it. Audio without a source is a microphone;
   * video without a source is a camera, which is what a client that could produce
   * video without knowing this word would be sending.
   *
   * **Incoherence is rejected instead of corrected.** A `kind: "video"` with
   * `fonte: "microfone"` is not a mistake to straighten silently: it is a
   * client asking for one thing under the name of another, and fixing their hand would give them
   * the cap of a source that is not theirs.
   */
  #fonteDe(kind: types.MediaKind, fonte: FonteDoFluxo | undefined): FonteDoFluxo {
    if (fonte === undefined) return kind === "audio" ? "microfone" : "camara"
    // Screen is the only source with both `kind`: image and sound of the screen.
    if (fonte === "ecra") return fonte
    // Music is sound only: video with its name would be a camera outside the cap.
    const esperado = fonte === "microfone" || fonte === "musica" ? "audio" : "video"
    if (kind !== esperado) {
      throw new RecusaDeMedia(
        "fonte-incoerente",
        `um fluxo de ${kind} não pode vir de ${fonte === "microfone" ? "um microfone" : fonte === "camara" ? "uma câmara" : "uma música"}`,
      )
    }
    return fonte
  }

  /**
   * Put media in the scope.
   *
   * Rejections before mediasoup sees the request, each one with its physical reason:
   *
   *  1. **The direction.** Not produced on a receiving transport.
   *  2. **Source coherence.** See `#fonteDe`.
   *  3. **Four producers per sending transport**, which are the four things
   *     a person can put in a call (microphone, camera, screen image and screen audio)
   *    , and one of each, because the second camera from the same person is bandwidth
   *     doubled with nothing in return.
   *  4. **Call caps**, which is where video differs from voice: voice
   *     fits in any realistic scenario on this platform and video does not. See
   *     `CAMARAS_POR_AMBITO`, `ECRAS_POR_AMBITO` and `PESSOAS_COM_ECRA`.
   *  5. **The declared budget.** See `#orcamentoExcedido`, and the
   *     honest caveat written there about what this check does not catch.
   *     With screen audio in the air, the image from the same screen counts with
   *     `TECTO_DO_ECRA − TECTO_DO_SOM_DO_ECRA`: the two together fit in the screen
   *     cap, and not over it.
   *  6. **The server output budget** (`servidor-cheio`), video only.
   *     See `OrcamentoDeSaida`.
   */
  async produzir(
    dono: string,
    transporteId: string,
    kind: types.MediaKind,
    rtpParameters: types.RtpParameters,
    fonteDeclarada?: FonteDoFluxo,
  ): Promise<{ id: string; ambito: string; fonte: FonteDeMedia }> {
    this.#exigirDePe()
    const registo = this.#meuTransporte(dono, transporteId)

    if (registo.sentido !== "envio") {
      throw new RecusaDeMedia("sentido-errado", "não se produz num transporte de recepção")
    }

    const fonte = this.#fonteDe(kind, fonteDeclarada)

    if (registo.produtores.size >= PRODUTORES_POR_TRANSPORTE) {
      throw new RecusaDeMedia("demasiados-produtores", `um transporte de envio leva ${PRODUTORES_POR_TRANSPORTE} fluxos de cada vez`)
    }

    for (const existente of registo.produtores.values()) {
      // Source AND `kind`: image and sound of the same screen are two flows.
      if (existente.fonte !== fonte || existente.produtor.kind !== kind) continue
      // A second camera from the same person doubles their output to everyone
      // and adds nothing you see. And two microphones are the same voice twice, half
      // a second apart, you hear it as echo and search in the wrong place.
      throw new RecusaDeMedia("fonte-repetida", `esta ligação já está a enviar ${nomeDoFluxo(fonte, kind, true)} nesta chamada`)
    }

    const ambito = await this.#ambito(registo.chaveDoAmbito)
    this.#exigirTectoDaFonte(ambito, fonte, kind, dono)

    const pedido = this.#orcamentoExcedido(rtpParameters, fonte, kind)
    if (pedido === null && fonte === "ecra" && kind === "audio") {
      // Sound comes after the image: the image already on air is what had to
      // drop the 64 kbps of it. An image declared at full cap plus sound
      // would exceed `TECTO_DO_ECRA`.
      const tectoDaImagem = TECTO_DO_ECRA - TECTO_DO_SOM_DO_ECRA
      for (const existente of registo.produtores.values()) {
        if (existente.fonte !== "ecra" || existente.produtor.kind !== "video") continue
        const imagem = this.#orcamentoExcedido(existente.produtor.rtpParameters, "ecra", "video", tectoDaImagem)
        if (imagem !== null) {
          throw new RecusaDeMedia(
            "acima-do-orcamento",
            `a imagem do ecrã pede ${Math.round(imagem / 1000)} kbps, e com o som o tecto da imagem é ${Math.round(tectoDaImagem / 1000)} kbps: a imagem e o som juntos cabem nos ${Math.round(TECTO_DO_ECRA / 1000)} kbps do ecrã`,
          )
        }
      }
    }
    if (pedido !== null) {
      const tecto = orcamentoDe(fonte, kind)
      throw new RecusaDeMedia(
        "acima-do-orcamento",
        `este fluxo pede ${Math.round(pedido / 1000)} kbps e o tecto para ${nomeDoFluxo(fonte, kind, false)} é ${Math.round(tecto / 1000)} kbps: a saída do servidor é o gargalo de uma chamada, e é partilhada com o resto da máquina`,
      )
    }

    // 6. The SERVER budget, all calls added up. A new video counts at least the first
    // viewer: if even that does not fit, it does not go up. It only checks; whoever reserves
    // is the consumption. Voice never comes here.
    if (kind === "video" && !this.#orcamento.cabeVideo(custoNaSaida(fonte, kind).bits)) {
      throw servidorCheio(this.#orcamento.ler())
    }

    const produtor = await registo.transporte.produce({ kind, rtpParameters })

    registo.produtores.set(produtor.id, { produtor, fonte })
    ambito.produtores.set(produtor.id, { id: produtor.id, kind, dono, fonte })

    // `transportclose` fires when the transport closes under the producer
    //, including when the worker dies. Without this, the scope would keep announcing a
    // producer to arrivals that no longer exists, and the new client would wait
    // for media that never comes.
    produtor.on("transportclose", () => {
      ambito.produtores.delete(produtor.id)
      registo.produtores.delete(produtor.id)
    })

    if (fonte === "ecra" && kind === "video") this.#ligarRelogioDoEcra(produtor)

    // The scope comes back with the identifier because the gateway
    // announces the flow to the others, and it has no way to know what call a transport
    // belongs to without keeping a second map saying the same thing. Source
    // comes back for the same reason: whoever echoes it is the gateway, and it may
    // have been inferred here instead of sent.
    return { id: produtor.id, ambito: registo.chaveDoAmbito, fonte: paraOFio(fonte) }
  }

  /**
   * The caps of the CALL, which are the ones that say how much leaves this server.
   *
   * The other caps in `produzir` are per connection, how many streams a person
   * sends. These are per scope, and it is in them that the SFU physics lives: the output is
   * `bitrate × espectadores`, and it is what saturates the interface that serves
   * magnuslab.pt. See the math in `CAMARAS_POR_AMBITO` and in
   * `PESSOAS_COM_ECRA`.
   *
   * The microphone has no cap here on purpose: who limits it is
   * `PARTICIPANTES_POR_AMBITO`, because everyone in a call has one and voice
   * fits in any realistic scenario on this platform.
   */
  #exigirTectoDaFonte(ambito: Ambito, fonte: FonteDoFluxo, kind: types.MediaKind, dono: string): void {
    if (fonte === "microfone") return

    /*
      Music comes in WITHOUT image, and that is the whole difference from screen sound.

      One per person, and what guarantees it is the `source-repeated` of `produce`: each
      connection has one sending transport per scope (`transport-repeated`).
      It has no people cap of its own, like voice: 64 kbps to ten viewers
      are 0.64 Mbps, a fraction of the share in section 7 of `docs/PLANO_SFU.md`, and
      it is the same count as one more person speaking nonstop. One per person, not
      one per call: two DJs playing at the same time is the room's choice,
      and the volume on whoever hears solves it.
    */
    if (fonte === "musica") return

    /*
      Screen sound comes after the image of the SAME owner, only after it.

      It does not count as one more screen (the stage still shows one), and it has
      no people cap of its own: the screen cap already covers it, and its 64 kbps
      count inside `TECTO_DO_ECRA` (see `TECTO_DO_SOM_DO_ECRA`). Without the
      image in front, a "screen sound" was a second voice with another name,
      escaping the queue and the voice cap.
    */
    if (fonte === "ecra" && kind === "audio") {
      const temImagem = [...ambito.produtores.values()].some(
        (produtor) => produtor.dono === dono && produtor.fonte === "ecra" && produtor.kind === "video",
      )
      if (!temImagem) {
        throw new RecusaDeMedia("ecra-som-sem-imagem", "o som do ecrã só entra com a imagem do ecrã da mesma pessoa")
      }
      return
    }

    let camaras = 0
    let ecras = 0
    for (const produtor of ambito.produtores.values()) {
      if (produtor.fonte === "camara") camaras++
      // Only the IMAGE counts as a screen: sound goes with it and does not take the stage.
      else if (produtor.fonte === "ecra" && produtor.kind === "video") ecras++
    }

    if (fonte === "camara" && camaras >= CAMARAS_POR_AMBITO) {
      throw new RecusaDeMedia(
        "camaras-a-mais",
        `já vão ${CAMARAS_POR_AMBITO} câmaras nesta chamada, que é o que a ligação do servidor aguenta: cada câmara é enviada a toda a gente, e a conta cresce com o quadrado das pessoas`,
      )
    }

    if (fonte === "ecra") {
      if (ecras >= ECRAS_POR_AMBITO) {
        throw new RecusaDeMedia(
          "ecra-ocupado",
          `já há ${ECRAS_POR_AMBITO} ecrãs a ser partilhados nesta chamada, que é o que a saída do servidor aguenta: cada ecrã é enviado a toda a gente que o vê`,
        )
      }
      if (ambito.membros.size > PESSOAS_COM_ECRA) {
        throw new RecusaDeMedia(
          "chamada-grande-de-mais-para-ecra",
          `já são ${ambito.membros.size} nesta chamada, e o ecrã sai do servidor uma vez para cada pessoa: acima de ${PESSOAS_COM_ECRA} isso é mais banda do que esta máquina tem para dar sem estragar o que mais aqui corre`,
        )
      }
    }
  }

  /**
   * Close ONE producer, leaving the call on its feet.
   *
   * @returns the scope key and closed producers, so the gateway can
   * tell the others. Closing the screen IMAGE also closes the screen SOUND from
   * the same transport, and both go in the list: sound without image was a
   * second voice with another name, outside the voice cap, which
   * `#exigirTectoDaFonte` refuses on entry and which cannot stay orphaned here.
   *
   * Stopping screen share is this, not a leave: the transport stays, the
   * microphone stays, and one of three producers dies. Without this path the client
   * would close the producer their side and the server would keep announcing a
   * flow to arrivals that no longer exists, never telling whoever was watching that
   * it ended, the last frame frozen on everyone's screen, forever.
   */
  async fecharProdutor(dono: string, produtorId: string): Promise<{ ambito: string; fechados: string[] }> {
    const registo = [...this.#transportes.values()].find(
      (cada) => cada.dono === dono && cada.produtores.has(produtorId),
    )
    if (!registo) {
      throw new RecusaDeMedia("produtor-desconhecido", "esse fluxo não existe nesta ligação")
    }

    const entrada = registo.produtores.get(produtorId)
    const fechados = [produtorId]
    // Image brings sound with it. Sound first, so no one hears
    // a screen that no longer shows.
    if (entrada?.fonte === "ecra" && entrada.produtor.kind === "video") {
      for (const [id, outro] of registo.produtores) {
        if (outro.fonte === "ecra" && outro.produtor.kind === "audio") fechados.unshift(id)
      }
    }

    const ambito = this.#ambitosResolvidos.get(registo.chaveDoAmbito)
    for (const id of fechados) {
      const cada = registo.produtores.get(id)
      registo.produtores.delete(id)
      ambito?.produtores.delete(id)
      // Closing the producer closes its consumers everywhere, and that is what
      // makes `producerclose` fire the other side.
      cada?.produtor.close()
    }
    this.#libertarConsumosDe(fechados)
    return { ambito: registo.chaveDoAmbito, fechados }
  }

  /**
   * Give back to the budget, right now, the bandwidth of these producers' consumption.
   *
   * A producer's `close` reaches the consumption of OTHER transports by a
   * notification from the worker, after whoever closed has moved on: between
   * the two the counter lied, and a viewer in another call could
   * be refused for bandwidth already not leaving. The consumption `observer` frees
   * again when the notification arrives, and freeing twice does not subtract
   * anything.
   */
  #libertarConsumosDe(produtores: Iterable<string>): void {
    const mortos = new Set(produtores)
    for (const reserva of this.#reservasDosConsumidores.values()) {
      if (mortos.has(reserva.produtor)) this.#orcamento.libertar(reserva.chave)
    }
  }

  /**
   * What this flow declares it will request in bandwidth, if it declares too much.
   *
   * @returns the bits per second requested when they exceed the cap, or `null`.
   *
   * **What this check catches:** a misconfigured client, or a build that lost
   * the `codecOptions` along the way, requesting 128 kbps stereo in a room sized
   * for 32 mono. That's the likely case and why it exists: to catch it early,
   * with a message that states the number.
   *
   * **What it does NOT catch, and we say this to avoid confusion:** a client that
   * simply omits the field, or declares 32 and sends 200. The declaration comes
   * from the client and the client can lie. Against that, what works is the
   * `setMaxIncomingBitrate` on the transport, which is on the server and asks
   * no permission, that's why it exists, not as redundancy for this line.
   *
   * The absence of the field is ACCEPTED on purpose: a client that declares
   * nothing receives the `maxaveragebitrate=32000` that the router announces,
   * which is the value we wanted. Rejecting the absence would break honest
   * clients without catching anyone.
   *
   * **In video the field is different, and the reason is the codec.** Opus
   * declares the rate within the codec parameters (`maxaveragebitrate`); VP8
   * has no place to say it, and the ENCODING says it, `encodings[].maxBitrate`,
   * which is what the encoder pursues. Two different places saying the same
   * thing about different codecs, and reading only one left video with no check
   * at all.
   */
  #orcamentoExcedido(
    rtpParameters: types.RtpParameters,
    fonte: FonteDoFluxo,
    kind: types.MediaKind,
    tecto: number = orcamentoDe(fonte, kind),
  ): number | null {

    for (const codec of rtpParameters.codecs ?? []) {
      const declarado = codec.parameters?.["maxaveragebitrate"]
      if (declarado === undefined) continue
      const bits = Number(declarado)
      if (Number.isFinite(bits) && bits > tecto) return bits
    }

    for (const codificacao of rtpParameters.encodings ?? []) {
      const bits = codificacao.maxBitrate
      if (typeof bits === "number" && Number.isFinite(bits) && bits > tecto) return bits
    }

    return null
  }

  // ----------------------------------------------------------------- consumir

  /**
   * Listen to a producer in the SAME scope.
   *
   * Verifying that the producer belongs to the transport's scope is the heart
   * of separating calls, and it's not a formality: without it, a producer ID
   * picked up elsewhere would let someone consume a call from a channel they
   * never entered. Mediasoup alone prevents none of this, different routers
   * would refuse because they're different routers, but two scopes in the SAME
   * channel share the worker and the error would be silent. The gateway
   * validates the channel; this line validates the room within it.
   *
   * **Born paused, always.** Between `consume` and the installation of the
   * decryption transform there is a gap, and frames that pass in that gap
   * arrive encrypted at the decoder, which reads them as noise. The client
   * resumes when ready, with `resume`. Not tuning: it's what prevents the
   * decoder from receiving ciphertext, and it's point 5 of what Phase 0 said
   * to assume.
   */
  async consumir(
    dono: string,
    transporteId: string,
    produtorId: string,
    rtpCapabilities: types.RtpCapabilities,
  ): Promise<{ id: string; produtor: string; kind: types.MediaKind; rtpParameters: types.RtpParameters; pausado: boolean }> {
    this.#exigirDePe()
    const registo = this.#meuTransporte(dono, transporteId)

    if (registo.sentido !== "recepcao") {
      throw new RecusaDeMedia("sentido-errado", "não se consome num transporte de envio")
    }

    const ambito = await this.#ambito(registo.chaveDoAmbito)
    if (!ambito.produtores.has(produtorId)) {
      throw new RecusaDeMedia("produtor-desconhecido", "esse fluxo não existe nesta chamada")
    }

    if (!ambito.router.canConsume({ producerId: produtorId, rtpCapabilities })) {
      throw new RecusaDeMedia("incompativel", "este dispositivo não sabe ler o que aquele está a enviar")
    }

    /*
      The outgoing budget: a new video viewer only enters if there's room.
      
      The reserve is made BEFORE the `await`, not after: two consumes at the
      same time would both pass a dry-run check, and the second would enter
      over the cap. The consumer is born paused, but reserves already: the
      `resume` comes next, and refusing it there was refusing a consume already
      accepted.
      */
    const produtorGuardado = ambito.produtores.get(produtorId)!
    const custo = custoNaSaida(produtorGuardado.fonte, produtorGuardado.kind)
    const chaveDaReserva = `consumo-${++this.#reservasFeitas}`
    if (!this.#orcamento.reservar(chaveDaReserva, custo.faixa, custo.bits)) {
      throw servidorCheio(this.#orcamento.ler())
    }

    let consumidor: types.Consumer
    try {
      consumidor = await registo.transporte.consume({ producerId: produtorId, rtpCapabilities, paused: true })
    } catch (erro) {
      this.#orcamento.libertar(chaveDaReserva)
      throw erro
    }

    // The `observer` sees all closes: the producer's, the transport's (outgoing,
    // connection drop) and the worker's. The reserve goes back here.
    this.#reservasDosConsumidores.set(consumidor.id, { chave: chaveDaReserva, produtor: produtorId, ...custo })
    consumidor.observer.once("close", () => {
      this.#orcamento.libertar(chaveDaReserva)
      this.#reservasDosConsumidores.delete(consumidor.id)
    })

    registo.consumidores.set(consumidor.id, consumidor)
    consumidor.on("transportclose", () => registo.consumidores.delete(consumidor.id))
    consumidor.on("producerclose", () => registo.consumidores.delete(consumidor.id))

    // Screen image consumes are tied to the keyframe clock.
    const consumosDoEcra = this.#consumosDoEcra.get(produtorId)
    if (consumosDoEcra) {
      consumosDoEcra.add(consumidor)
      consumidor.observer.once("close", () => consumosDoEcra.delete(consumidor))
    }

    return {
      id: consumidor.id,
      produtor: consumidor.producerId,
      kind: consumidor.kind,
      rtpParameters: consumidor.rtpParameters,
      // Read from the consumer and returned, rather than taken for granted: **a
      // guarantee you cannot measure is not a guarantee.** A test that only checked
      // that `resume` works would pass with `paused: true` removed, and the next
      // failure would be ciphertext reaching everyone's decoder, which sounds like
      // noise and you search for it for hours in the wrong place.
      pausado: consumidor.paused,
    }
  }

  /** Resume a consumer, after the client has installed decryption. */
  async retomar(dono: string, transporteId: string, consumidorId: string): Promise<void> {
    const registo = this.#meuTransporte(dono, transporteId)
    const consumidor = registo.consumidores.get(consumidorId)
    if (!consumidor) throw new RecusaDeMedia("consumidor-desconhecido", "esse fluxo não existe neste transporte")
    // After a "stop watching" the reserve left, and the next "watch" is a new
    // viewer: it reserves again, and is refused if there's no room. The first
    // `resume` after `consume` already has reserve and passes without check.
    const reserva = this.#reservasDosConsumidores.get(consumidorId)
    if (reserva && !this.#orcamento.reservar(reserva.chave, reserva.faixa, reserva.bits)) {
      throw servidorCheio(this.#orcamento.ler())
    }
    await consumidor.resume()
  }

  /**
   * Stop forwarding a flow, leaving the consumer running.
   *
   * **The counterpart to `resume`, and it's what makes "stop watching" save
   * bandwidth.** A paused consumer sends no RTP, it's the same guarantee that
   * `consume({ paused: true })` up there exists to give between the consume
   * and the decryption install, so this cuts the server's output to this
   * viewer until they ask again.
   *
   * Pause and don't close, on purpose: the object stays, with decryption
   * already installed on the client side, and the next "watch" is a `resume`
   * instead of a new `consume`. Closing was what left a stray consumer for each
   * watch-and-stop cycle. See `sfu.pause` in the protocol.
   *
   * The same owner and same transport that `resume` demands: an ID picked up
   * elsewhere doesn't mute someone else's screen.
   */
  async pausar(dono: string, transporteId: string, consumidorId: string): Promise<void> {
    const registo = this.#meuTransporte(dono, transporteId)
    const consumidor = registo.consumidores.get(consumidorId)
    if (!consumidor) throw new RecusaDeMedia("consumidor-desconhecido", "esse fluxo não existe neste transporte")
    await consumidor.pause()
    // Paused sends nothing: its bandwidth goes back to the budget.
    const reserva = this.#reservasDosConsumidores.get(consumidorId)
    if (reserva) this.#orcamento.libertar(reserva.chave)
  }

  /**
   * Request a keyframe from the sender, on behalf of the viewer (`sfu.keyframe`).
   *
   * Just forwards: mediasoup sends a PLI to the sender, and the keyframe that
   * comes back goes to all consumers of that stream. The stream itself is never read.
   *
   * Guards in order: the transport belongs to the owner (`#meuTransporte`, same
   * lock as `pause`), the consumer belongs to that transport, it is VIDEO (audio
   * has no keyframes), it is running (paused streams get nothing, and `resume`
   * already requests one), and the last request from it was at least
   * `INTERVALO_DO_FOTOGRAMA_CHAVE_PEDIDO` ago.
   *
   * @returns whether the request went through. `false` is silently ignored by the gateway:
   * one extra request deserves no reply.
   */
  pedirFotogramaChave(dono: string, transporteId: string, consumidorId: string, agora = Date.now()): boolean {
    const registo = this.#meuTransporte(dono, transporteId)
    const consumidor = registo.consumidores.get(consumidorId)
    if (!consumidor || consumidor.kind !== "video") return false
    if (consumidor.closed || consumidor.paused || consumidor.producerPaused) return false
    const ultimo = this.#fotogramasChavePedidos.get(consumidor)
    if (ultimo !== undefined && agora - ultimo < INTERVALO_DO_FOTOGRAMA_CHAVE_PEDIDO) return false
    this.#fotogramasChavePedidos.set(consumidor, agora)
    this.#chavesPedidasPorQuemVe++
    consumidor.requestKeyFrame().catch(() => {
      // A consume that closed between the guard and the request: no image to save.
    })
    return true
  }

  /** The last request from each consumer. Weak: dies with the consumer. */
  #fotogramasChavePedidos = new WeakMap<types.Consumer, number>()
  #chavesPedidasPorQuemVe = 0

  /** How many keyframes were sent at the viewer's request. Tests only. */
  get chavesPedidasPorQuemVe(): number {
    return this.#chavesPedidasPorQuemVe
  }

  // ------------------------------------------------------------------- exits

  /**
   * Exit a scope, dropping everything in it.
   *
   * @returns the producers that died, so the gateway can announce them.
   */
  async sairDoAmbito(dono: string, chave: string): Promise<string[]> {
    const ambito = this.#ambitosResolvidos.get(chave)
    if (!ambito) return []

    const meus = ambito.membros.get(dono)
    const mortos: string[] = []
    if (meus) {
      for (const id of meus) {
        const registo = this.#transportes.get(id)
        if (!registo) continue
        for (const produtorId of registo.produtores.keys()) {
          ambito.produtores.delete(produtorId)
          mortos.push(produtorId)
        }
        // Closing the transport closes the producers and consumers below it;
        // it's the only call that must happen.
        registo.transporte.close()
        this.#transportes.delete(id)
      }
      this.#libertarConsumosDe(mortos)
      ambito.membros.delete(dono)
    }

    await this.#talvezFecharAmbito(ambito)
    return mortos
  }

  /** Drop everything a connection has, in all scopes. See `#drop`. */
  async sair(dono: string): Promise<{ chave: string; produtores: string[] }[]> {
    const saldo: { chave: string; produtores: string[] }[] = []
    for (const chave of [...this.#ambitosDe(dono)]) {
      const produtores = await this.sairDoAmbito(dono, chave)
      saldo.push({ chave, produtores })
    }
    return saldo
  }

  /**
   * The router shuts down when the last MEMBER leaves, not when the last
   * transport closes.
   *
   * The difference between these two rules reveals a bug: between `entrar` and the first
   * `criarTransporte` there is a scope with one member and zero transports. The "last transport"
   * rule would close the router when the first person joined a call. The first to
   * enter a room could never negotiate, and only the first-which causes a bug that
   * disappears when two people try at the same time and returns when testing alone.
   */
  async #talvezFecharAmbito(ambito: Ambito): Promise<void> {
    if (ambito.membros.size > 0 || ambito.fechado) return
    ambito.fechado = true
    this.#ambitos.delete(ambito.chave)
    this.#ambitosResolvidos.delete(ambito.chave)
    ambito.router.close()
  }

  // --------------------------------------------- the screen keyframe clock

  /**
   * One clock per screen frame, tied to the producer's lifetime.
   *
   * The producer closes via three paths (`fecharProdutor`, transport closing,
   * worker dying) and the `observer` sees all three.
   */
  #ligarRelogioDoEcra(produtor: types.Producer): void {
    if (this.#intervaloDaChaveDoEcra <= 0) return
    this.#consumosDoEcra.set(produtor.id, new Set())
    const relogio = setInterval(() => this.#pedirChaveDoEcra(produtor.id), this.#intervaloDaChaveDoEcra)
    // A clock does not keep the process alive: the server closes when told.
    relogio.unref?.()
    this.#relogiosDoEcra.set(produtor.id, relogio)
    produtor.observer.once("close", () => {
      clearInterval(relogio)
      this.#relogiosDoEcra.delete(produtor.id)
      this.#consumosDoEcra.delete(produtor.id)
    })
  }

  /**
   * Request a keyframe from ONE consume that is watching.
   *
   * One is enough: mediasoup sends the PLI to the producer, and the keyframe
   * that comes back is forwarded to all consumes of that image. Requesting
   * from each would ask for the same thing N times (mediasoup dedupes them, but
   * there's no reason to give it the work). No consume resumed, no request.
   */
  #pedirChaveDoEcra(produtorId: string): void {
    const consumos = this.#consumosDoEcra.get(produtorId)
    if (!consumos) return
    for (const consumo of consumos) {
      if (consumo.closed || consumo.paused || consumo.producerPaused) continue
      this.#chavesPedidas.set(produtorId, (this.#chavesPedidas.get(produtorId) ?? 0) + 1)
      consumo.requestKeyFrame().catch(() => {
        // A consume that closed between the read and the request. Next tick picks another.
      })
      return
    }
  }

  /** How many keyframes this screen image's clock requested. */
  chavesPedidasDoEcra(produtorId: string): number {
    return this.#chavesPedidas.get(produtorId) ?? 0
  }

  /** Close the engine and the subprocess with it. */
  async fechar(): Promise<void> {
    for (const relogio of this.#relogiosDoEcra.values()) clearInterval(relogio)
    this.#relogiosDoEcra.clear()
    this.#fechado = true
    this.#ambitos.clear()
    this.#ambitosResolvidos.clear()
    this.#transportes.clear()
    this.#worker.close()
    this.#reservasDosConsumidores.clear()
    this.#orcamento.limpar()
  }

  /** The video budget for admissions ahead. See `QuotaGuard`. */
  definirOrcamentoDeVideo(bits: number): void {
    this.#orcamento.definirTectoDoVideo(bits)
  }

  /**
   * The outgoing capacity reserved now, summed across all calls. Numbers only.
   *
   * Read by periodic logging in `app.ts` and by tests.
   */
  saida(): LeituraDaSaida {
    return this.#orcamento.ler()
  }

  #exigirDePe(): void {
    if (!this.estaDePe()) {
      throw new RecusaDeMedia("sem-motor", "o motor de media deste servidor não está de pé")
    }
  }

  // ------------------------------------------------------------ for tests

  /** How many scopes are open. Tests only. */
  get ambitosAbertos(): number {
    return this.#ambitosResolvidos.size
  }

  /** How many transports are open. Tests only. */
  get transportesAbertos(): number {
    return this.#transportes.size
  }

  /**
   * The statistics that the WORKER has for this transport. Tests only.
   *
   * It exists for one reason only, and it's worth saying: `setMaxIncomingBitrate`
   * is the only cap on this list that survives a client lying, and no one had
   * seen it applied before. A test that only checked that the method call
   * doesn't blow up would pass with the line deleted, the method is async and
   * returns `void`, and a resolved promise proves nothing.
   *
   * These statistics come from the other side of the subprocess, from the C++
   * that forwards packets. Reading the cap HERE is reading it where it actually
   * came to exist, not in a variable of ours saying yes.
   */
  async estatisticasDoTransporte(id: string): Promise<types.WebRtcTransportStat[]> {
    const registo = this.#transportes.get(id)
    if (!registo) throw new RecusaDeMedia("transporte-desconhecido", "esse transporte não existe")
    return registo.transporte.getStats()
  }
}

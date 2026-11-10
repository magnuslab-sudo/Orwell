import {
  TECTO_DA_CAMARA,
  TECTO_DA_MUSICA,
  TECTO_DO_ECRA,
  TECTO_DO_SOM_DO_ECRA,
  type FonteDeMedia,
  type FonteDoFluxo,
  type UserAddress,
} from "@enclave/protocol"
import { aplicarPrioridade, prioridadeDoFluxo } from "./prioridade.js"
import type { CifraDeMedia } from "./media-sframe.js"
import { VigiaDoFotogramaChave, type AmostraDoReceptor, type MotivoDoPedido } from "./fotograma-chave.js"

/**
 * Call through an SFU: ONE connection, not N.
 *
 * This is Phase 2 of `docs/PLANO_SFU.md`, and lives alongside the mesh instead of replacing it.
 * The mesh doesn't disappear here, it gates on the `sfu` capability that `hello.ok` announces,
 * and a server that doesn't announce it keeps the exact same behavior, line by line. Removal is Phase 4,
 * with one condition: the SFU works first.
 *
 * **What disappears by design.** With an SFU there's one send transport and one receive transport, nothing more.
 * No `#buildPeer` per pair, no address comparison to decide who offers, no `joinId` as a lifetime serial number,
 * no `#perdidos` or mesh repair. All that scar tissue existed to manage N concurrent negotiations,
 * and at three there were two, where the whole bug family lived ("the third stays calling").
 * Here there's one negotiation, with the server, and the category has nowhere left to live.
 *
 * **What does NOT change, and that's what matters.** The cipher is the same: `CifraDeMedia`,
 * the same object the mesh uses, with the key coming from the MLS exporter of the epoch
 * and the two-key window intact. The SFU never knew what an epoch was, and still doesn't,  * it forwards frames from any `keyId` and the receiver decides what opens. What changes is the object
 * the transformation grabs onto: the `rtpSender` from a `mediasoup-client` producer
 * instead of from a peer-to-peer connection.
 *
 * **Assembly order is not arbitrary**, and two rules govern it:
 *
 *  1. **Decryption hooks before the stream moves.** The consumer is born paused server-side on purpose,
 *     and only resumes after the transformation is attached. Anything that passed in the gap
 *     arrived encrypted at the decoder, which reads it as noise, and noise is indistinguishable
 *     from a fault to the listener.
 *  2. **Each request carries its own tag.** The two transports are born at the same time
 *     and the two responses are indistinguishable by form. See `#pedirSfu` in the session.
 */

/** What this engine needs from the gateway. The session implements it. */
export interface SinalizacaoSfu {
  sfuEntrarNoAmbito(
    channel: string,
    scope: string,
  ): Promise<{
    rtpCapabilities: unknown
    producers: { id: string; kind: "audio" | "video"; address: UserAddress; fonte?: FonteDoFluxo | undefined }[]
  }>
  sfuSairDoAmbito(channel: string, scope: string): void
  sfuCriarTransporte(
    channel: string,
    scope: string,
    direction: "envio" | "recepcao",
  ): Promise<{ id: string; iceParameters: unknown; iceCandidates: unknown; dtlsParameters: unknown }>
  sfuLigarTransporte(transport: string, dtlsParameters: unknown): Promise<void>
  /**
   * `source` speaks the wire language (`FonteDeMedia`), and bridges pass it as
   * it comes. Music travels here with the name `musica` before the wire knows it
   * (see `FONTE_DA_MUSICA` in the protocol): the gateway refuses the frame, and
   * the engine says so (`sfu-musica-recusada`).
   */
  sfuProduzir(transport: string, kind: "audio" | "video", rtpParameters: unknown, fonte?: FonteDeMedia): Promise<string>
  sfuFecharProdutor(producer: string): Promise<void>
  sfuConsumir(
    transport: string,
    producer: string,
    rtpCapabilities: unknown,
  ): Promise<{ id: string; producerId: string; kind: "audio" | "video"; rtpParameters: unknown }>
  sfuRetomar(transport: string, consumer: string): Promise<void>
  /**
   * Stop receiving a flow without closing it. See `sfu.pause` in the protocol.
   *
   * It is in the spec because it is what makes "stop watching" a saving of
   * bandwidth and not just decryption: without this frame, the server keeps
   * routing the image to a transport that no longer reads it.
   */
  sfuPausar(transport: string, consumer: string): Promise<void>
  /**
   * Ask the sender of this consumer for a keyframe (Phase M2, `sfu.keyframe`).
   *
   * No response, and a no-op against a server that does not announce
   * `CAPACIDADE_SFU_FOTOGRAMA_CHAVE`: whoever implements decides that. Optional
   * because an old bridge does not have it, and the call stays the same without it.
   */
  sfuPedirFotogramaChave?(transport: string, consumer: string): void
}

/**
 * The server HEARD the request, understood it, and said no.
 *
 * The distinction that this type exists to carry is the only thing that separates a request
 * worth retrying from one that is not, and until now it was lost along
 * the way: the `sfu.error` arrives with a `code` and a message, and the session rejected
 * the request with a `new Error(frase)`, the message intact, the code thrown away.
 * On this side the error was indistinguishable from a timeout.
 *
 * **A refusal is a RESPONSE, but not every response is final** (4/11/2026,
 * #984). Until 1.3.0 none repeated. But a request that reaches the server
 * out of time (the thread stuck a few seconds, the producer rebuilt in the meantime)
 * gets a true response about a state that has passed: "that stream does not
 * exist", "that transport does not exist". The person had no sound until they left and
 * came back. Now only refusals that do not change by waiting are final
 * (`RECUSAS_FINAIS_DO_CONSUMO`); the others retry with growing delay and
 * with a cap, and a new code too (the cap is what stops the loop).
 *
 * The `message` is the KEY in the error catalog that corresponds to the code (see
 * `CHAVES_DAS_RECUSAS_DO_SFU`), not the server message. The server message
 * comes in Portuguese and with numbers in it, and the interface translates by the exact key:
 * in raw form, each refusal reached the screen as "Error 900". The message is not
 * lost: it stays in `frase` and in `cause`, for diagnosis. The `cause` is what
 * crosses the Electron IPC; a custom property does not cross.
 */
export class RecusaDoSfu extends Error {
  /** The exact phrase from the server, word for word. */
  readonly frase: string

  constructor(
    readonly codigo: string,
    frase: string,
  ) {
    super(chaveDaRecusaDoSfu(codigo), { cause: { codigo, frase } })
    this.name = "RecusaDoSfu"
    this.frase = frase
  }
}

/** The error catalog key for the sender cipher that did not get ready (448). */
export const ERRO_DA_CIFRA_DO_EMISSOR = "the call media could not be encrypted"

/**
 * A source was not published because its cipher did not get ready (SEC-02).
 *
 * Not a server refusal: this client refusing to put media on the wire without
 * SFrame. The producer never got active (or was closed here and on the server
 * before there was RTP). By `name`, like `RecusaDoSfu`, because that is how you
 * recognize it after IPC. The source goes in `cause`.
 */
export class CifraDoEmissorEmFalta extends Error {
  constructor(readonly fonte: string) {
    super(ERRO_DA_CIFRA_DO_EMISSOR, { cause: { fonte } })
    this.name = "CifraDoEmissorEmFalta"
  }
}

/** Is it a `CifraDoEmissorEmFalta`? By `name`, which crosses IPC. */
export function ehCifraDoEmissorEmFalta(erro: unknown): erro is Error {
  return erro instanceof Error && erro.name === "CifraDoEmissorEmFalta"
}

/**
 * The code of each SFU refusal that tells the person who tried something, and the
 * error catalog key.
 *
 * Codes come from the server (`apps/server/src/media.ts`, `gateway.ts`). The ones
 * not here are mechanics (a transport that does not exist, a flow that died already)
 * and fall into the generic key: the person has nothing to do with them, and the
 * code stays in `cause` for diagnosis.
 */
export const CHAVES_DAS_RECUSAS_DO_SFU: Readonly<Record<string, string>> = {
  "ecra-ocupado": "someone already shares a screen in this call",
  "chamada-grande-de-mais-para-ecra": "the call is too large to share a screen",
  "camaras-a-mais": "the call has the maximum of cameras",
  "chamada-cheia": "the call is full",
  "servidor-cheio": "the server is full of broadcasts",
  "demasiados-ambitos": "this device is in too many calls",
  "demasiados-pedidos": "too many call requests",
  "sem-sfu": "this server does not relay call media",
  "fora-da-chamada": "join the call first",
  "sem-lugar": "this device has no seat in this channel",
}

/** The generic key for an SFU refusal not in the table. */
export const RECUSA_DO_SFU_GENERICA = "the call server refused the request"

export function chaveDaRecusaDoSfu(codigo: string): string {
  return Object.hasOwn(CHAVES_DAS_RECUSAS_DO_SFU, codigo) ? CHAVES_DAS_RECUSAS_DO_SFU[codigo]! : RECUSA_DO_SFU_GENERICA
}

/**
 * The refusals of a consumption that are truly final: waiting does not change the
 * answer.
 *
 * - `incompativel`: this device does not read the codec of that producer.
 * - `sentido-errado`: a consumption asked on a send transport (our bug).
 * - `sem-lugar`, `fora-da-chamada`: this connection is not in the channel or the call.
 * - `servidor-cheio`: the server output budget, with the cap in the phrase.
 * - `sem-sfu`: this server does not route media.
 * - `demasiados-ambitos`, `chamada-cheia`: caps of the connection and the room.
 *
 * Everything else can be timing and retries with a cap: `produtor-desconhecido`
 * (the producer was not there yet, or was remade), `consumidor-desconhecido` (the
 * `sfu.resume` of a consumer the server already dropped), `transporte-desconhecido`
 * (the receive transport changed), `interno`, `ambito-instavel`,
 * `demasiados-pedidos` and any code this client does not know yet.
 */
export const RECUSAS_FINAIS_DO_CONSUMO: ReadonlySet<string> = new Set([
  "incompativel",
  "sentido-errado",
  "sem-lugar",
  "fora-da-chamada",
  "servidor-cheio",
  "sem-sfu",
  "demasiados-ambitos",
  "chamada-cheia",
])

/** The code of an SFU refusal, also after IPC (goes in `cause`). `null` if not a refusal. */
export function codigoDaRecusaDoSfu(erro: unknown): string | null {
  if (!(erro instanceof Error) || erro.name !== "RecusaDoSfu") return null
  const causa = erro.cause as { codigo?: unknown } | undefined
  return typeof causa?.codigo === "string" ? causa.codigo : "desconhecido"
}

/**
 * A consumption failure for the log: the refusal with the code and server phrase,
 * not just the catalog key ("the call server refused the request" did not say which
 * of eight refusals it was).
 */
export function descreverFalhaDoSfu(erro: unknown): string {
  const codigo = codigoDaRecusaDoSfu(erro)
  const mensagem = String((erro as Error)?.message ?? erro)
  if (codigo === null) return mensagem
  const frase = ((erro as Error).cause as { frase?: unknown } | undefined)?.frase
  return `${mensagem} (${codigo}${typeof frase === "string" && frase ? `: ${frase}` : ""})`
}

/*
 * The slice of `mediasoup-client` this engine depends on.
 *
 * Written by hand, not imported from the library, for two reasons that add up. The
 * first is testing: without it, measuring setup order would need a browser, and what
 * you want to measure, that decryption is installed BEFORE `resume`, is call order,
 * not media passing. The second is the boundary: `client-core` runs in the browser
 * and the Electron renderer, and a tight slice is what makes explicit how much of
 * the library this code needs. Six methods.
 */
export interface DispositivoDeMedia {
  load(opcoes: { routerRtpCapabilities: unknown }): Promise<void>
  readonly rtpCapabilities: unknown
  /**
   * Does this router negotiate this?
   *
   * The question that decides if screen sharing exists in this call, and the
   * answer comes from the SERVER, from the overlap between the codecs it announced
   * in `scope.joined` and the ones this device knows how to use. A Phase 2 server
   * only negotiates Opus, and on one of those `canProduce("video")` is false: the
   * button draws as off instead of opening the system selector, lighting the
   * recording mark, and delivering no pixel. See `MotorSfu.podeVideo`.
   */
  canProduce(kind: "audio" | "video"): boolean
  createSendTransport(opcoes: ParametrosDoTransporte): TransporteDeMedia
  createRecvTransport(opcoes: ParametrosDoTransporte): TransporteDeMedia
}

export interface ParametrosDoTransporte {
  id: string
  iceParameters: unknown
  iceCandidates: unknown
  dtlsParameters: unknown
  additionalSettings?: Record<string, unknown>
}

export interface TransporteDeMedia {
  readonly id: string
  on(
    evento: "connect",
    ouvinte: (dados: { dtlsParameters: unknown }, feito: () => void, falhou: (erro: Error) => void) => void,
  ): void
  on(
    evento: "produce",
    ouvinte: (
      dados: { kind: "audio" | "video"; rtpParameters: unknown; appData: Record<string, unknown> },
      feito: (resultado: { id: string }) => void,
      falhou: (erro: Error) => void,
    ) => void,
  ): void
  produce(opcoes: {
    track: MediaStreamTrack
    codecOptions?: Record<string, unknown>
    /**
     * The encoding cap, and here is where it is set for video.
     *
     * Opus declares the rate inside codec parameters; VP8 has nowhere to declare
     * it, and whoever declares it is the encoding. This number is what the server
     * reads and refuses when it exceeds the source cap, see `#orcamentoExcedido`
     * in `media.ts`.
     */
    encodings?: { maxBitrate?: number }[]
    /**
     * What this producer is, for who created it.
     *
     * It travels to the transport `produce` event and from there to the gateway. It
     * is the natural place for the source with mediasoup, in the mesh the same role
     * was of the reserved transceiver, which does not exist here.
     */
    appData?: Record<string, unknown>
    /**
     * **Who owns the track: us, or whoever gave it to us.**
     *
     * `mediasoup-client` assumes by default that it owns it (`stopTracks = true`)
     * and STOPS the track when the producer dies, which includes closing the transport over it.
     * The track is not its: it's born from `getUserMedia` in `call.ts`, which opens it,
     * mutes it, and stops it.
     *
     * It's in the signature, not hidden inside `#produzir`, because it's an OWNERSHIP clause
     * between this engine and whoever delivers media to it, and a clause you don't see in the type
     * is one you lose on the first rewrite.
     */
    stopTracks?: boolean
    /**
     * Where the cipher hangs, BEFORE there is a packet (SEC-02).
     *
     * The `mediasoup-client` calls this synchronously right after `addTransceiver`,
     * before the offer, DTLS and the producer on the server (see `handlers/Chrome111.js`,
     * `Firefox120.js`, `Safari12.js`). It is the only moment that hanging the
     * transform guarantees no encoded frame escapes it.
     */
    onRtpSender?: (emissor: RTCRtpSender) => void
  }): Promise<ProdutorDeMedia>
  consume(opcoes: {
    id: string
    producerId: string
    kind: "audio" | "video"
    rtpParameters: unknown
  }): Promise<ConsumidorDeMedia>
  /**
   * The stats of the connection under this transport.
   *
   * Optional in the spec because not every test double needs it, and because a
   * transport that never closed DTLS has no candidate pair to give. See
   * `MotorSfu.latencia`.
   */
  getStats?(): Promise<RTCStatsReport>
  close(): void
}

export interface ProdutorDeMedia {
  readonly id: string
  readonly rtpSender?: RTCRtpSender | undefined
  /**
   * Swap the track this producer sends without a new producer or a new offer.
   *
   * It is the `Producer.replaceTrack` of `mediasoup-client`, which calls
   * `RTCRtpSender.replaceTrack`. The cipher hangs on the SENDER not the track:
   * the new track goes through the same transform, with the same key and same
   * counter. Optional because not every test double needs it.
   */
  replaceTrack?(opcoes: { track: MediaStreamTrack | null }): Promise<void>
  close(): void
}

/**
 * The image leaving here is being cut down, and why.
 *
 * The browser lowers resolution by itself when throughput does not reach or the
 * processor does not keep up, and says so in `qualityLimitationReason` of the
 * `outbound-rtp`. With no one reading that field the drop happens **silently**:
 * the person appears to others at 360p with the menu saying 720p, and what she
 * concludes is that the product is bad, not that her network is bad. Measured in
 * `scripts/sfu-prova-720p/`, which is where this field was read for the first time.
 *
 * **Only two reasons, and it is a choice.** The standard defines four values,  * `none`, `bandwidth`, `cpu`, `other`. The first two are not said (one because
 * there is nothing to say, and `other` because you do not know what it is: saying
 * "your image went down for another reason" is worse than saying nothing, because
 * there is no gesture on the other side of that phrase). Left are the two a person
 * can do something about: change networks, or close what is eating the machine.
 */
export interface LimiteDeVideo {
  /** The word from the browser itself, of the two you say to someone. */
  razao: "bandwidth" | "cpu"
  /**
   * The height actually leaving, in lines.
   *
   * `0` when the browser has not declared it yet, which happens in the first
   * reports of a sender just born. Zero is absence, never a measure, and whoever
   * draws must treat it as such: "540 lines" is information, "0 lines" is a lie
   * dressed as a number.
   */
  altura: number
}

/**
 * The worst limit from a stats report, or `null` if there is none.
 *
 * Lives outside both classes because both read the same thing over different
 * objects: `MotorSfu` over the `RTCRtpSender` of each producer, the mesh over the
 * `RTCPeerConnection` of each pair. Written twice would diverge at the first
 * change, and the read is the part that must be the same in both paths, else
 * the same bad network tells two stories.
 *
 * `bandwidth` beats `cpu` when both appear: different flows complaining about
 * different things, and the network is what the product knows how to explain and
 * what a person can change.
 */
export function limiteDoRelatorio(stats: RTCStatsReport): LimiteDeVideo | null {
  let achado: LimiteDeVideo | null = null
  // Collect first and decide later, like in `latencia`: `forEach` over the report
  // gives records with no type, and narrowing inside the callback does not survive
  // leaving it.
  stats.forEach(
    (registo: { type?: string; kind?: string; qualityLimitationReason?: string; frameHeight?: number }) => {
      if (registo.type !== "outbound-rtp") return
      // Missing `kind` is a report from a sender that only carries video, the one
      // from the camera producer's `RTCRtpSender`. In an `RTCPeerConnection` with
      // both voice and video it's there, and without this guard the audio line would slip in.
      if (registo.kind !== undefined && registo.kind !== "video") return
      const razao = registo.qualityLimitationReason
      if (razao !== "bandwidth" && razao !== "cpu") return
      const altura = typeof registo.frameHeight === "number" ? registo.frameHeight : 0
      if (achado === null || (achado.razao === "cpu" && razao === "bandwidth")) achado = { razao, altura }
    },
  )
  return achado
}

/**
 * An incoming stream from this engine's perspective: who it's from and what state it's in.
 *
 * Named instead of written out by hand wherever it appears, because there are three places
 * and the third copy would already diverge: the input gets stored in the map, rewritten on
 * pause, and read on resume.
 */
interface ConsumoInstalado {
  address: UserAddress
  fonte: FonteDoFluxo
  consumidor: ConsumidorDeMedia
  /** False when the platform failed to install decryption. See `mediaIsE2EE`. */
  encrypted: boolean
  /**
   * No media key for this person yet, so the stream is stalled.
   *
   * Consumer mounted on our side and PAUSED on the server side, waiting for the key: the
   * person has no leaf in our channel tree yet (the commit that seats them hasn't arrived).
   * No key means no decryption attached, and a receiver without decryption would hand
   * encrypted frames to the decoder forever: the person muted with "connected" under their
   * name (owner report, November 3, 2026). So the stream doesn't enter the audio mix and
   * doesn't count as connected, and `protegerOsSemChave` completes the setup when the key
   * arrives.
   *
   * Since SEC-02 (4/11/2026) it also covers decryption that the PLATFORM rejected and the
   * consumer with no receiver: stalled and out of the audio mix, because we only hear what
   * opened with the speaker's key.
   */
  semChave: boolean
  /**
   * The person left the channel's MLS tree: their keys were forgotten, the stream left the
   * audio mix and display, and the server was told to pause.
   *
   * SEC-03 (external audit for 1.1.0). Decryption stays attached to the receiver (asking for
   * streams again would throw `InvalidStateError`), which is why a re-seat (no leaf in one
   * commit, another in the next) becomes audible on the SAME consumer: `protegerOsSemChave`
   * resets the chain, waits for the worker ACK, then tells it to resume. See `revogar`.
   */
  revogado: boolean
  /**
   * The server stopped routing this stream, and the consumer is still running.
   *
   * This is the state that "Stop viewing" leaves a screen in: the person's banner left the
   * stream, the tap is closed on the server, and the next "View" is a `sfu.resume` instead of
   * a new `sfu.consume`. See `largarEcraDe`.
   */
  pausado: boolean
}

export interface ConsumidorDeMedia {
  readonly id: string
  readonly producerId: string
  readonly track: MediaStreamTrack
  readonly rtpReceiver?: RTCRtpReceiver | undefined
  close(): void
}

/**
 * The settings that turn on insertable streams in the connection constructor.
 *
 * `encodedInsertableStreams` is not in the standard's `RTCConfiguration`, it's a Chromium
 * extension, and `mediasoup-client` spreads `additionalSettings` inside the handler's
 * `new RTCPeerConnection({...})`. Phase 0 proved it by difference, not by reading: without it,
 * `createEncodedStreams()` throws `InvalidStateError`. See `scripts/sfu-prova/README.md`, question 1.
 *
 * **Goes in BOTH transports.** In the send transport for encryption, in the receive transport
 * for decryption. Missing from one gives a call where you speak protected and hear noise, or
 * the opposite, and both halves are different objects with different `RTCPeerConnection`s.
 */
export const AJUSTES_DE_CIFRA = { encodedInsertableStreams: true } as const

/**
 * Codec options stated from the sender side.
 *
 * The same two caps that the router announces, repeated here, and the repetition is not
 * careless: **only on the router, Chrome ignores them.** Measured in Phase 0 and written
 * in point 4 of its findings.
 *
 *  - `opusDtx` is the biggest one. In a conversation each person speaks maybe a quarter
 *    of the time; without discontinuous transmission Opus sends encoded silence all the
 *    time. Cuts nearly seventy percent of voice traffic and what you hear doesn't change.
 *  - `opusStereo: false` and 32 kbps. Speech at 24-32 kbps mono is indistinguishable from
 *    64 kbps stereo, and it's half.
 *
 * Constant bitrate (`cbr=1`, 3/11/2026) isn't here because `mediasoup-client` has no
 * `opusCbr`: it comes from the router's Opus (`CODECS` in `apps/server/src/media.ts`), which
 * is where the send transport response starts before these options touch it. Tested in
 * `apps/server/src/media.cbr.test.ts` and measured in `scripts/e2e-voz-cbr.mjs`.
 *
 * The cap that can survive a lying client is not this, it's the server-side send transport's
 * `setMaxIncomingBitrate`. This is an honest client's best effort; that one is physics.
 */
export const OPCOES_DE_CODEC = {
  opusStereo: false,
  opusDtx: true,
  opusFec: true,
  opusMaxAverageBitrate: 32_000,
  opusPtime: 20,
} as const

/**
 * The encoding cap for each source on the sender side.
 *
 * The numbers live in the protocol because the SERVER refuses them when they exceed it, and
 * disagreement between the two sides gives a stream that never connects with a rejection
 * telling the truth about a divergence nobody sees.
 *
 * The microphone is not here: its rate is declared inside the codec, in `OPCOES_DE_CODEC`
 * above, because that's how Opus states it.
 */
/**
 * The Opus for SCREEN AUDIO: stereo, 64 kbps.
 *
 * Screen audio is music, a video, or system sound. The Opus for voice (mono, 32 kbps) makes
 * that sound like a phone call. DTX stays (silence doesn't use bandwidth) and FEC stays (one
 * loss doesn't pop). Doesn't go through the voice chain: no noise reduction or gate on a stream
 * that isn't voice.
 */
export const OPCOES_DO_SOM_DO_ECRA = {
  opusStereo: true,
  opusDtx: true,
  opusFec: true,
  opusMaxAverageBitrate: TECTO_DO_SOM_DO_ECRA,
  opusPtime: 20,
} as const

/**
 * The SCREEN IMAGE cap, with or without audio alongside.
 *
 * Audio counts inside the screen cap, not on top of it: with audio, the image drops by its
 * 64 kbps, and the whole screen still fits in the `TECTO_DO_ECRA` that the server's outgoing
 * tally already accounted for.
 */
/**
 * The Opus for MUSIC: same as screen audio, stereo at 64 kbps.
 *
 * Apart from `OPCOES_DO_SOM_DO_ECRA` only in the cap, which has its own name in the protocol
 * (`TECTO_DA_MUSICA`). DTX stays: paused music uses no bandwidth while the producer is still up.
 */
export const OPCOES_DA_MUSICA = { ...OPCOES_DO_SOM_DO_ECRA, opusMaxAverageBitrate: TECTO_DA_MUSICA } as const

export function tectoDaImagemDoEcra(comSom: boolean): number {
  return comSom ? TECTO_DO_ECRA - TECTO_DO_SOM_DO_ECRA : TECTO_DO_ECRA
}

export const TECTO_POR_FONTE: Record<"camara" | "ecra", number> = {
  camara: TECTO_DA_CAMARA,
  ecra: TECTO_DO_ECRA,
}

/** An incoming stream, already decrypted, and who it's from. */
export interface FluxoRecebido {
  address: UserAddress
  /**
   * The person: their microphone and camera in the same stream.
   *
   * Together because that's how they're drawn, a card with a face and a voice, and because
   * the card's `<video>` element plays both at once. Splitting them would force the interface
   * to have two elements per person and sync them.
   */
  stream: MediaStream
  /**
   * Their screen, if they're sharing it. Null means they're not.
   *
   * Separate from the rest, not an extra banner in the same stream: the stage shows the screen
   * in `contain` and the grid shows faces in `cover`, which on a 16:9 screen would crop right
   * where the tab bar and editor sidebar live. Two different places on the screen with opposite
   * drawing rules, so they're two streams.
   */
  ecra: MediaStream | null
  /**
   * The music they're playing, if they are. Null means they're not.
   *
   * Separate from the person for the same reason as the screen: whoever's listening gives it
   * its own volume, separate from the voice, and one element could only play both at the same
   * volume.
   */
  musica: MediaStream | null
  /** False when the platform failed to install decryption. See `mediaIsE2EE`. */
  encrypted: boolean
}

export interface DependenciasDoMotorSfu {
  sinalizacao: SinalizacaoSfu
  cifra: CifraDeMedia
  criarDispositivo: () => DispositivoDeMedia
  /** Local recording mechanics. Never keys, never anything decrypted. */
  aoDiagnosticar: (code: string, detail?: string) => void
  /** Something changed in the audio mix: time for the interface to redraw. */
  aoMudar: () => void
  /**
   * Do we want to view this person's screen?
   *
   * Feature request from the owner on October 5, 2026: *when someone shares their screen,
   * others should only enter the stream if they choose to.* Until now we consumed any new
   * producer without looking at the source, and whoever received it took 2.5 Mbps forced,    * there's no simulcast or layers (see `media.ts`), so no small version of the screen to
   * request, with nowhere to refuse.
   *
   * **A predicate, not a set inside here**, because the choice belongs to the `Call`: it's
   * the one that states it in the announce (`aVer`, in `voice.join`), it's the one that
   * applies it too in the mesh where there are no consumers, and two copies of a choice
   * diverge at the first distraction. The engine asks; whoever answered is who decided.
   *
   * Only the SCREEN goes through here. Camera and voice stay exactly as they were: consent
   * to see them is entering the call, and that doesn't change.
   */
  verOEcraDe: (address: UserAddress) => boolean
  /**
   * A refusal the person must read, in a gesture that doesn't drop the call.
   *
   * Today only the server outgoing budget one (`servidor-cheio`), in the three gestures where
   * it happens: putting the camera on when joining, "View" a screen for the first time, and
   * "View" again after "Stop viewing". Screen sharing doesn't go through here: its refusal
   * surfaces as an exception to `Call`.
   */
  aoRecusar?: (erro: Error) => void
  /**
   * The microphone gave up on encryption for good: attempts are over (448).
   *
   * Only voice reaches here, because only voice drops the call: without encrypted voice there's
   * no SFU call (see `entrar`). The caller leaves the call and tells it. Other sources give up
   * via `aoRecusar` or the exception, as before.
   */
  aoPerderAVoz?: (erro: Error) => void
  /**
   * The voice send transport didn't connect in time, or fell to `failed`: our voice isn't
   * getting out, with no error. The caller remakes the media (`Call.ligacaoVoltou`).
   * See `PRAZO_DO_ENVIO_MS`.
   */
  aoEnvioParado?: () => void
  /**
   * The server says, consume after consume, that our receive transport doesn't exist
   * (`transporte-desconhecido`), even after we ask it who's in the call: our transport is
   * no longer the server's. The caller remakes the media, as in `aoEnvioParado`.
   */
  aoRecepcaoPerdida?: () => void
}

/** The server's outgoing budget refusal? By the code in `cause`, which crosses the IPC. */
function ehServidorCheio(erro: unknown): erro is Error {
  if (!(erro instanceof Error) || erro.name !== "RecusaDoSfu") return false
  const causa = erro.cause as { codigo?: unknown } | undefined
  return causa?.codigo === "servidor-cheio"
}

export class MotorSfu {
  #canal: string | null = null
  #ambito: string | null = null
  #dispositivo: DispositivoDeMedia | null = null
  #envio: TransporteDeMedia | null = null
  #recepcao: TransporteDeMedia | null = null
  /**
   * The incoming streams, by producer: it's the producer that dies, not the person.
   *
   * `pausado` is the state that "Stop viewing" leaves a screen in: the consumer exists, with
   * decryption installed, and the server sends it nothing. Stored in the record instead of
   * inferred from the absence of the banner in the stream, because whoever reads this list
   * asks two different things, "what's coming in?" (`fluxos`) and "what's already set up?"
   * (`consumirOfertasDe`), and one of them would answer wrong from the other.
   */
  #consumidores = new Map<string, ConsumoInstalado>()

  /**
   * Our producers, by source.
   *
   * Three at most: microphone, camera, and screen. By source, not in a list, because the
   * questions asked of it are all by source, "am I sharing yet?", "close the screen and
   * leave the rest", and a list would force searching inside what was put there.
   */
  #produtores = new Map<FonteDeMedia, ProdutorDeMedia>()
  /**
   * The screen audio producer, separate from the others.
   *
   * Its source is `ecra`, like the image, because that's what an old client reads to put it
   * in the screen stream (behind "View", with "Stop viewing" pausing it). In a map by source
   * the two would step on each other.
   */
  #somDoEcra: ProdutorDeMedia | null = null
  /**
   * The MUSIC producer, separate from the others. See `partilharMusica`.
   *
   * Out of the source map because the map speaks the wire language (`FonteDeMedia`), which
   * still doesn't know about `musica`. And it lives alone: doesn't depend on image or
   * microphone, and muting the mic doesn't touch it.
   */
  #musica: ProdutorDeMedia | null = null

  /**
   * Each person's streams, kept ALIVE between announcements.
   *
   * A new `MediaStream` on each read would force the interface to swap the element's
   * `srcObject` at every roster change, and swapping a video's `srcObject` restarts it: with
   * audio you hear a pop, with a shared screen the image flickers off and back every time
   * someone joins or leaves. Objects are mutable (`addTrack`/`removeTrack`) and that's what
   * keeps their identity while content changes.
   */
  #fluxosPorPessoa = new Map<UserAddress, { pessoa: MediaStream; ecra: MediaStream; musica: MediaStream }>()
  /**
   * The producers being consumed or already consumed.
   *
   * `sfu.producer.new` can arrive twice for the same thing, once in `scope.joined` and again
   * by the notice, if the person starts producing at the exact moment we join. Consuming the
   * same producer twice gives two streams of the same voice playing at once, half a second
   * apart, which sounds like an echo and gets blamed on the wrong place for hours.
   */
  #aConsumir = new Set<string>()

  /**
   * The offered screens and pending viewing: producer → who it's from.
   *
   * A screen producer isn't consumed until someone asks for it, and that's the common case
   * for efficiency: whoever doesn't press "View" doesn't receive a bit. We keep the ID because
   * the gateway announce (`sfu.producer.new`) arrives ONCE: throwing it away left the offer
   * with no way to be accepted until the person restarts sharing.
   *
   * An offer may have a PAUSED consumer behind it, the state that "Stop viewing" leaves a
   * screen you were already watching. See `largarEcraDe`.
   */
  #ofertasDeEcra = new Map<string, UserAddress>()

  /**
   * The streams announced before there was a way to hear them.
   *
   * **This is where "connecting" from this phase was born.** Between `sfu.scope.join`
   * answering and both transports being up there are two round trips to the server, and the
   * gateway doesn't know about it: whoever joins the call in that window is announced with a
   * `sfu.producer.new` like any other. The engine found itself without a receive transport
   * and threw the notice away silently, and there's no second chance, because `sfu.scope.joined`
   * had already been answered BEFORE that producer existed and the gateway announces each
   * stream exactly once. The person stays in the roster without a stream, exactly like someone
   * who joined and hasn't spoken yet: "connecting…", forever.
   *
   * Two people hitting the voice room a second apart are enough for this, which is what
   * happens when a meeting starts.
   */
  #anunciadosCedo: { produtorId: string; address: UserAddress; fonte?: FonteDoFluxo | undefined }[] = []

  /**
   * Producers the server already marked dead, so they don't come back.
   *
   * A `sfu.producer.closed` can arrive while the `sfu.consume` for that same producer is
   * still in flight: the notice looks for the consumer, doesn't find it, doesn't exist yet,    * and gave up without a trace. The consume would follow and install a consumer for a dead
   * producer: card saying "connected" with a banner that's never going to play anything, and
   * the notice that should clean it up already passed and won't come back.
   *
   * A tombstone, not a cleanup: mediasoup producer IDs are UUIDs and never repeat, so marking
   * one dead can't refuse anything legitimate later. Grows with whoever leaves and dies with
   * the call.
   */
  #mortos = new Set<string>()

  /**
   * This engine's generation number, so an abandoned setup knows it is.
   *
   * `entrar` has five waits in the middle, and `sair` can interrupt one: the person hits
   * disconnect before the call finishes mounting. Without this, the join would proceed and
   * write the transports AFTER the leave cleaned them up, two open transports fed by the mic,
   * in a call we already left.
   *
   * A counter, not a boolean: between leave and the next wait fits a new join, and a "we're
   * leaving" wiped out by it would let the old setup write over the new.
   */
  #geracao = 0

  constructor(private readonly deps: DependenciasDoMotorSfu) {
    // Someone's video decryption came back: their image needs a keyframe.
    deps.cifra.aoVoltarOVideo = (address) => this.#videoVoltou(address)
  }

  get activo(): boolean {
    return this.#canal !== null
  }

  /** The current scope, for whoever needs to match notices to this call. */
  get ambito(): string | null {
    return this.#ambito
  }

  /**
   * Does this call carry video?
   *
   * The question is the SERVER's, not ours: a Phase 2 homeserver announces a router with
   * only Opus, and `device.load()` crosses it with what this device can do. `canProduce("video")`
   * is the result of that crossing, and it's the only honest answer, asking the `sfu`
   * capability from `hello.ok` said "there is SFU", which is something else.
   *
   * False outside a call, because there's no router to ask. Whoever draws the share button
   * handles the absence of a call separately; see `Call.podePartilharEcra`.
   */
  get podeVideo(): boolean {
    return this.#dispositivo?.canProduce("video") ?? false
  }

  /** Whether we're sharing the screen through this engine. */
  get aPartilharEcra(): boolean {
    return this.#produtores.has("ecra")
  }

  /** Whether screen audio is routed through this engine. */
  get aEnviarSomDoEcra(): boolean {
    return this.#somDoEcra !== null
  }

  /** Whether our music is routed through this engine. */
  get aTocarMusica(): boolean {
    return this.#musica !== null
  }

  /**
   * Join the call and put our voice in it.
   *
   * The order is fixed and cannot be changed:
   *
   *  1. `sfu.scope.join` first, always, `device.load()` needs the router's
   *     `rtpCapabilities` BEFORE any transport exists, and this is where the
   *     server admits us with the usual `#mayReach` check.
   *  2. Both transports, each with its own label.
   *  3. Our producer, with the cipher attached to `rtpSender`.
   *  4. Only then the streams that were already there.
   *
   * Step 4 comes after step 3 on purpose: a call where you hear before you
   * speak is better than one where you speak before you hear, but what really
   * decides the order is this, if `produce` fails, we consume nothing and drop
   * everything, rather than end up halfway through a call pretending to work.
   */
  async entrar(
    canal: string,
    ambito: string,
    faixa: MediaStreamTrack | null,
    camara: MediaStreamTrack | null = null,
  ): Promise<void> {
    this.#canal = canal
    this.#ambito = ambito
    // This mount has a generation number, and it uses that number to know whether it still matters when it returns from each wait. See `#geracao`.
    const geracao = ++this.#geracao
    const aindaNesta = (): boolean => geracao === this.#geracao
    // The cipher derives from this call's channel, and the caller tells it where we are. Without this line there is no key and everything mounts the same way, transports standing, streams arriving, nothing decrypted: a silent call with all lights green.
    this.deps.cifra.canal = canal

    const { rtpCapabilities, producers } = await this.deps.sinalizacao.sfuEntrarNoAmbito(canal, ambito)
    // Nothing built yet: leaving here just drops the request and nothing else.
    if (!aindaNesta()) return

    const dispositivo = this.deps.criarDispositivo()
    await dispositivo.load({ routerRtpCapabilities: rtpCapabilities })
    this.#dispositivo = dispositivo

    // Both at the same time: they are independent, and doing them one at a time would cost two round trips to the server on every call start. The label exists because they are born together.
    const [envio, recepcao] = await Promise.all([
      this.#criarTransporte(dispositivo, canal, ambito, "envio"),
      this.#criarTransporte(dispositivo, canal, ambito, "recepcao"),
    ])
    if (!aindaNesta()) {
      // The exit ran while these two were being born and did not find them to close: they are ours, and we close them here. Leaving them open means the microphone feeds a call we have left.
      envio.close()
      recepcao.close()
      return
    }
    this.#envio = envio
    this.#recepcao = recepcao
    // A thread stuck during the call may have lost server notifications. See `VIGIA_DA_THREAD_MS`.
    this.#vigiarAThread()

    /*
     * The voice, and a cipher that fails does not bring the call down (4/11/2026).
     *
     * Up to 1.3.0 a cipher that was not ready on the first try made joining fail
     * with 448, and the person exited. The owner: "if the cipher fails, you must
     * try again". Now the first attempt is here, as always, and if the cipher
     * fails the engine keeps mounting (you hear who is there) while the voice
     * retries in the background (`#insistirNaCifra`). The guarantee does not
     * change: no producer goes up without the cipher attached, because each
     * attempt is a complete `#produzir`. Only when the attempts run out does the
     * voice give up and the call drops with 448 (`aoPerderAVoz`).
     */
    this.#faixaDoMicrofone = faixa
    if (faixa) {
      try {
        await this.#produzir(faixa, "microfone")
      } catch (erro) {
        if (!ehCifraDoEmissorEmFalta(erro)) throw erro
        void this.#insistirNaCifra(() => this.#faixaDoMicrofone, "microfone", {}, geracao).then(
          () => this.deps.aoMudar(),
          (desistiu: unknown) => {
            if (geracao === this.#geracao) this.deps.aoPerderAVoz?.(desistiu as Error)
          },
        )
      }
    }
    if (!aindaNesta()) return
    /*
     * Camera after voice, and only if the router accepts it.
     *
     * This is the order we want when the network cannot handle both: in a voice
     * call with video, what cannot be missing is the voice. And the `podeVideo`
     * guard is what prevents an entire call from failing to mount against a Phase
     * 2 server, without it, `produce` would be rejected, `entrar` would crash,
     * and someone who had turned on their camera would end up with no call at all
     * instead of no camera.
     */
    if (camara && this.podeVideo) {
      try {
        try {
          await this.#produzir(camara, "camara")
        } catch (erro) {
          if (!ehCifraDoEmissorEmFalta(erro)) throw erro
          // The camera retries like the voice, in the background. When it gives up, it falls on its own and says 448, like before.
          void this.#insistirNaCifra(() => camara, "camara", {}, geracao).then(
            () => this.deps.aoMudar(),
            (desistiu: unknown) => {
              if (geracao !== this.#geracao) return
              this.deps.aoDiagnosticar("sfu-camara-recusada", String((desistiu as Error)?.message ?? desistiu))
              this.deps.aoRecusar?.(desistiu as Error)
            },
          )
        }
      } catch (erro) {
        /*
         * The camera is the only source whose rejection does NOT bring down the
         * call, and it is the same reason `podeVideo` above already explains: the
         * person who turned on their camera ends up without a camera, not without
         * a call.
         *
         * The guard above only covers a router that does not negotiate video. We
         * needed the other half, the server refuses due to room caps
         * (`camaras-a-mais`, `acima-do-orcamento`), and those depend on who is
         * there: between two times we join, the second camera slot may have been
         * taken by someone else. This is what happens when you come back from a
         * reconnection, and the cost was the entire call failing to mount.
         *
         * The voice does not get this treatment, and it is deliberate: a call
         * where no one speaks is not a call, and mounting it pretending is worse
         * than not mounting it.
         */
        this.deps.aoDiagnosticar("sfu-camara-recusada", String((erro as Error)?.message ?? erro))
        // The camera that did not get encrypted is also reported: the person turned it on and others cannot see it (448).
        if (ehServidorCheio(erro) || ehCifraDoEmissorEmFalta(erro)) this.deps.aoRecusar?.(erro)
      }
    }
    if (!aindaNesta()) return

    for (const produtor of producers) {
      await this.#consumir(produtor.id, produtor.address, produtor.fonte)
    }

    /*
     * And whoever started speaking while this was mounting.
     *
     * It comes AFTER the `scope.joined` list because it is newer than that, and
     * duplication costs nothing: `#aConsumir` already prevents us from consuming
     * the same producer twice, and a producer can be in both lists when someone
     * joins at the exact moment we did.
     */
    await this.#consumirOsQueEsperam()

    this.deps.aoMudar()
  }

  /**
   * Consume the notifications that caught the engine mid-mount.
   *
   * Reads the list on each pass instead of traversing it once: consuming is
   * async, and a new notification may arrive while we consume the previous one.
   * The spiral is not infinite because from here on there is a receive transport,
   * and with it `#consumir` stops storing anything.
   */
  async #consumirOsQueEsperam(): Promise<void> {
    while (this.#anunciadosCedo.length > 0) {
      for (const espera of this.#anunciadosCedo.splice(0)) {
        await this.#consumir(espera.produtorId, espera.address, espera.fonte)
      }
    }
  }

  /**
   * @param dispositivo the device for this mount, passed by hand and not read from the field.
   *
   * The difference is a race: `sair` clears `#dispositivo`, and this method
   * returns from a wait. Read from the field, an exit in the middle would make
   * this throw "the media device is not ready", and the transport in the OTHER
   * direction, which already existed, would stay open because `Promise.all`
   * would reject before anyone could close it. The mount works on what it built
   * itself; the generation decides whether it still matters.
   */
  async #criarTransporte(
    dispositivo: DispositivoDeMedia,
    canal: string,
    ambito: string,
    sentido: "envio" | "recepcao",
  ): Promise<TransporteDeMedia> {
    const parametros = await this.deps.sinalizacao.sfuCriarTransporte(canal, ambito, sentido)

    const opcoes: ParametrosDoTransporte = { ...parametros, additionalSettings: { ...AJUSTES_DE_CIFRA } }
    const transporte = sentido === "envio" ? dispositivo.createSendTransport(opcoes) : dispositivo.createRecvTransport(opcoes)

    /*
     * `connect` fires ONCE, when DTLS needs to be closed, and it is lazy:
     * `mediasoup-client` only emits it on the first `produce` or `consume`. A
     * receive transport where we never consume anything never connects, and that
     * is the design, there is nothing to carry.
     */
    transporte.on("connect", ({ dtlsParameters }, feito, falhou) => {
      this.deps.sinalizacao
        .sfuLigarTransporte(transporte.id, dtlsParameters)
        .then(() => feito())
        .catch((erro: unknown) => falhou(erro as Error))
    })

    if (sentido === "envio") {
      transporte.on("produce", ({ kind, rtpParameters, appData }, feito, falhou) => {
        /*
         * The source comes in the producer's `appData`, not from a variable we own.
         *
         * `mediasoup-client` emits this event once per `produce`, and with three
         * producers being born close together, microphone and camera on entry,
         * screen when someone presses the button, a variable saying "what I am
         * producing now" is a race waiting to happen: the screen declared as a
         * camera hits the wrong cap and ends up on someone else's card. The
         * `appData` travels with the producer it belongs to.
         */
        const fonte = appData["fonte"]
        this.deps.sinalizacao
          // `as FonteDeMedia`: music is not yet in the thread's `FonteDeMedia`. See the comment in `sfuProduzir`, in `SinalizacaoSfu`.
          .sfuProduzir(transporte.id, kind, rtpParameters, typeof fonte === "string" ? (fonte as FonteDeMedia) : undefined)
          .then((id) => feito({ id }))
          .catch((erro: unknown) => falhou(erro as Error))
      })
    }

    return transporte
  }

  /**
   * The waits between attempts to set up a producer's cipher, in order.
   *
   * They grow so a slow cipher (the key arriving in the next commit, a worker
   * waking up late) has time without the person waiting longer than needed: the
   * first retry is half a second later. The cap is seven attempts in about 23.5
   * seconds; after that the source gives up and says 448. A change of epoch, or
   * the key arriving, wakes the wait early (`cifraPodeTerMudado`). Mutable only
   * for tests to shorten it.
   */
  static ESPERAS_DA_CIFRA_MS: readonly number[] = [500, 1_000, 2_000, 4_000, 8_000, 8_000]

  /** Who is sleeping waiting for the cipher. `cifraPodeTerMudado` wakes them. */
  readonly #despertadores = new Set<() => void>()

  /**
   * The voice track that the engine publishes, or will publish once the cipher is ready.
   *
   * Read on each attempt, not fixed on the first: the track can be swapped in
   * the meantime by microphone recovery (`trocarFaixaDoMicrofone`).
   */
  #faixaDoMicrofone: MediaStreamTrack | null = null

  /**
   * The key may have arrived: sources waiting for the cipher try now.
   *
   * `Call` calls this on each epoch change, which is when the key arrives for
   * whoever just joined (and ours, when it was us).
   */
  cifraPodeTerMudado(): void {
    for (const acordar of [...this.#despertadores]) acordar()
  }

  #esperarPelaCifra(ms: number): Promise<void> {
    return new Promise((pronto) => {
      const acordar = (): void => {
        clearTimeout(relogio)
        this.#despertadores.delete(acordar)
        pronto()
      }
      const relogio = setTimeout(acordar, ms)
      this.#despertadores.add(acordar)
    })
  }

  /**
   * Put a source on air, and if the cipher is not ready, try again.
   *
   * Each attempt is a complete `#produzir`, with its three guarantees: the
   * cipher ready before `produce`, attached to `onRtpSender`, and the producer
   * closed here and on the server if the sender did not get protected. That is
   * why a retry never lets an unencrypted packet out: it only retries what was
   * already safe to do once.
   *
   * What is reported, and where:
   *
   *  - `sfu-emissor-cifra-a-repetir` on each wait (the UI shows notification
   *    449 while one is pending);
   *  - `sfu-emissor-cifra-recuperada` when a retry publishes;
   *  - `sfu-emissor-cifra-desistiu` when attempts run out, then
   *    `CifraDoEmissorEmFalta` rises (448), as it did on the first try up to 1.3.0.
   *
   * @param jaFalhou the first attempt already ran from the caller (and failed
   * due to the cipher). Start with the wait.
   * @returns the producer, or `null` if the call changed its state or the track
   * stopped existing in the meantime.
   */
  async #insistirNaCifra(
    faixa: () => MediaStreamTrack | null,
    fonte: FonteDoFluxo,
    opcoes: { somDoEcra?: boolean; tectoDaImagem?: number },
    geracao: number,
    jaFalhou = true,
  ): Promise<ProdutorDeMedia | null> {
    const rotulo = opcoes.somDoEcra ? "ecra-som" : fonte
    const esperas = MotorSfu.ESPERAS_DA_CIFRA_MS
    const total = esperas.length + 1
    let tentativa = jaFalhou ? 1 : 0
    for (;;) {
      if (tentativa > 0) {
        const espera = esperas[tentativa - 1]
        if (espera === undefined) {
          this.deps.aoDiagnosticar("sfu-emissor-cifra-desistiu", `${rotulo} · ${total}/${total}`)
          throw new CifraDoEmissorEmFalta(rotulo)
        }
        this.deps.aoDiagnosticar("sfu-emissor-cifra-a-repetir", `${rotulo} · ${tentativa + 1}/${total} · ${espera} ms`)
        await this.#esperarPelaCifra(espera)
      }
      const actual = faixa()
      if (geracao !== this.#geracao || !actual || actual.readyState === "ended") {
        if (tentativa > 0) this.deps.aoDiagnosticar("sfu-emissor-cifra-largada", rotulo)
        return null
      }
      try {
        const produtor = await this.#produzir(actual, fonte, opcoes)
        if (tentativa > 0) this.deps.aoDiagnosticar("sfu-emissor-cifra-recuperada", `${rotulo} · ${tentativa + 1}/${total}`)
        return produtor
      } catch (erro) {
        if (!ehCifraDoEmissorEmFalta(erro)) throw erro
        tentativa++
      }
    }
  }

  /**
   * Swap the voice track mid-call, without a new producer (4/11/2026).
   *
   * It is half the engine in microphone recovery (`Call`): capture died
   * (device gone, `AudioContext` stopped, voice chain broken), `Call` opens
   * another, and the new track enters the SAME producer. The cipher
   * transformation hangs on the producer, not the track: the new track comes
   * out encrypted from the first frame, with the same key and counter.
   *
   * With no producer (voice still waiting for the cipher), just store the
   * track: the next attempt publishes it.
   *
   * @returns `false` if the producer refused the swap.
   */
  async trocarFaixaDoMicrofone(faixa: MediaStreamTrack): Promise<boolean> {
    this.#faixaDoMicrofone = faixa
    const produtor = this.#produtores.get("microfone")
    if (!produtor) return true
    try {
      if (produtor.replaceTrack) await produtor.replaceTrack({ track: faixa })
      else if (produtor.rtpSender) await produtor.rtpSender.replaceTrack(faixa)
      else return false
      return true
    } catch (erro) {
      this.deps.aoDiagnosticar("sfu-microfone-nao-trocou", String((erro as Error)?.message ?? erro))
      return false
    }
  }

  /**
   * Put a source on air, and only encrypted (SEC-02, external audit at 1.1.0).
   *
   * **Cipher is a condition to publish.** Up to 1.2.0 the order was `produce()`
   * then the cipher, and both failures (no `rtpSender`, or `protegerEmissor`
   * saying no) only wrote a line in the log and returned the producer ACTIVE,
   * no SFrame: media the server could read. And even on the right path there
   * were frames between `produce()` and the transformation.
   *
   * Now there are three steps, and none are skipped:
   *
   *  1. `prepararEmissor` BEFORE `produce`: key, counter, and via the worker,
   *     the other side's installed key with ACK. If it fails, there is no
   *     producer.
   *  2. The transformation attaches to `onRtpSender`, synchronously, before the
   *     offer, DTLS and the producer on the server: the first frame already goes
   *     through it. If the platform refuses here, the track leaves the producer
   *     right away (`replaceTrack(null)`), and with no track the encoder does
   *     not produce anything.
   *  3. If the producer did not get protected (refusal in step 2, or a handler
   *     that never called `onRtpSender`), the producer closes here and on the
   *     server before entering the engine's counts, and `CifraDoEmissorEmFalta`
   *     rises.
   *
   * The caller decides what to do with the exception: the microphone drops the
   * entry, other sources fall on their own and the person reads 448 (see `entrar`,
   * `partilharEcra`, `#produzirSomDoEcra`, `partilharMusica`).
   */
  async #produzir(
    faixa: MediaStreamTrack,
    fonte: FonteDoFluxo,
    opcoes: { somDoEcra?: boolean; tectoDaImagem?: number } = {},
  ): Promise<ProdutorDeMedia | null> {
    const envio = this.#envio
    if (!envio) throw new Error("the call has no send path")
    const rotulo = opcoes.somDoEcra ? "ecra-som" : fonte

    if (!(await this.deps.cifra.prepararEmissor())) {
      this.deps.aoDiagnosticar("sfu-emissor-recusado-sem-cifra", rotulo)
      throw new CifraDoEmissorEmFalta(rotulo)
    }

    let emissor: RTCRtpSender | null = null
    let protegido = false
    const produtor = await envio.produce({
      track: faixa,
      /*
       * The track is not ours, and `mediasoup-client` assumes it is.
       *
       * By default it STOPS the track when the producer dies, and closing a
       * transport kills the producers under it: `sair()` closed both transports
       * and with them the microphone from `call.ts`, the one who opened it with
       * `getUserMedia`, mutes it and stops it.
       *
       * **While exiting a call always meant dropping capture, this did not show
       * up.** It started showing when the engine could be dropped with the call
       * standing, reconnection (`Call.ligacaoVoltou`), and what you saw was
       * the next mount crashing with `track ended` and the call ending on its own.
       * Measured in `scripts/sfu-prova-quatro/`, with the homeserver dead and
       * brought back: all four people lost the call.
       */
      stopTracks: false,
      // Opus options only have effect on audio, and sending them in a video producer is noise in a message; the video cap is where it has no room in the codec and goes in the encoding.
      ...(fonte === "microfone"
        ? { codecOptions: { ...OPCOES_DE_CODEC } }
        : fonte === "musica"
          ? { codecOptions: { ...OPCOES_DA_MUSICA } }
          : opcoes.somDoEcra
            ? { codecOptions: { ...OPCOES_DO_SOM_DO_ECRA } }
            : { encodings: [{ maxBitrate: opcoes.tectoDaImagem ?? TECTO_POR_FONTE[fonte] }] }),
      appData: { fonte },
      // Step 2. Synchronously: nothing here can wait, because after this line the handler creates the offer and the thread can go.
      onRtpSender: (nascido) => {
        emissor = nascido
        protegido = this.deps.cifra.pendurarNoEmissor(nascido)
        if (!protegido) {
          // With no track the encoder does not produce any frame, encrypted or not. It stays in the connection's operation queue BEFORE the offer.
          void nascido.replaceTrack?.(null)?.catch?.(() => {})
        }
      },
    })

    if (!protegido) {
      // Step 3. Null sender means the handler never called `onRtpSender`.
      this.deps.aoDiagnosticar(emissor ? "sfu-emissor-sem-cifra" : "sfu-sem-rtpsender", rotulo)
      void produtor.rtpSender?.replaceTrack?.(null)?.catch?.(() => {})
      produtor.close()
      try {
        await this.deps.sinalizacao.sfuFecharProdutor(produtor.id)
      } catch (erro) {
        // The transport may have fallen underneath. The local producer already closed.
        this.deps.aoDiagnosticar("sfu-emissor-nao-fechou", `${rotulo} · ${String((erro as Error)?.message ?? erro)}`)
      }
      throw new CifraDoEmissorEmFalta(rotulo)
    }

    if (fonte === "musica") this.#musica = produtor
    else if (opcoes.somDoEcra) this.#somDoEcra = produtor
    else this.#produtores.set(fonte, produtor)

    const rtpSender = produtor.rtpSender ?? emissor
    if (rtpSender) {
      // Voice ahead of video when the network tightens (2/11/2026). See `prioridade.ts`.
      if (!(await aplicarPrioridade(rtpSender, prioridadeDoFluxo(rotulo)))) {
        this.deps.aoDiagnosticar("sfu-sem-prioridade", rotulo)
      }
      this.#vigiarTransporte(rtpSender.transport, "envio")
      if (fonte === "microfone") this.#vigiarLigacaoDoEnvio(rtpSender.transport)
    }
    return produtor
  }

  /**
   * Put the screen in the call, encrypted like everything else.
   *
   * **This is where screen sharing with SFU differs from full mesh.** In mesh,
   * sharing meant putting the image in each peer's reserved spot with
   * `replaceTrack`, one m-line per peer, negotiated in the first offer, because
   * a renegotiation mid-call was the family of races this file exists to avoid.
   * Here it is a new producer in a transport that already exists: exactly the
   * renegotiation mesh could not do and SFU does for free, with `mediasoup-client`
   * handling the SDP and the server notifying who is listening.
   *
   * @returns `false` when it did not work, with the reason already in the log.
   * A server refusal, the call is too big, there is already a screen, rises as
   * an exception and is caught here: the caller needs to know if the button stays
   * lit, and the server's physical message goes to whoever reads it on screen.
   */
  async partilharEcra(faixa: MediaStreamTrack, som: MediaStreamTrack | null = null): Promise<boolean> {
    if (this.#produtores.has("ecra")) return true
    if (!this.podeVideo) {
      this.deps.aoDiagnosticar("sfu-sem-video")
      return false
    }

    // Image first: the server only accepts sound after the same person's image (`ecra-som-sem-imagem`). With sound, the image drops its 64 kbps. A cipher that is not ready retries before the share fails with 448 (`#insistirNaCifra`). The person reads notification 449 while waiting.
    const imagem = await this.#insistirNaCifra(
      () => faixa,
      "ecra",
      { tectoDaImagem: tectoDaImagemDoEcra(som !== null) },
      this.#geracao,
      false,
    )
    if (som && imagem) await this.#produzirSomDoEcra(som, imagem)
    this.deps.aoMudar()
    return true
  }

  /**
   * Screen sound, as its own producer. A refusal does NOT undo the share.
   *
   * A server before October 2026 refuses it (`fonte-incoerente`), and the image
   * is already on air: losing the image because of sound was trading a silent
   * share for no share at all. It is logged.
   *
   * **The share/stop race.** The sound `produce` takes one server round trip. If
   * the person stops sharing in that window (or shares something else), `pararEcra`
   * already ran and did not see this sound. It arrives later, with no image in
   * front: it closes here, locally and on the server.
   */
  async #produzirSomDoEcra(som: MediaStreamTrack, imagem: ProdutorDeMedia): Promise<void> {
    let produtor: ProdutorDeMedia | null
    try {
      produtor = await this.#insistirNaCifra(() => som, "ecra", { somDoEcra: true }, this.#geracao, false)
    } catch (erro) {
      this.#somDoEcra = null
      this.deps.aoDiagnosticar("sfu-ecra-som-recusado", String((erro as Error)?.message ?? erro))
      // The image stays encrypted; sound does not go out without cipher, and the person knows it.
      if (ehCifraDoEmissorEmFalta(erro)) this.deps.aoRecusar?.(erro)
      return
    }
    if (!produtor || this.#produtores.get("ecra") === imagem) return

    if (this.#somDoEcra === produtor) this.#somDoEcra = null
    try {
      await this.deps.sinalizacao.sfuFecharProdutor(produtor.id)
    } catch (erro) {
      // The server may have already closed it with the image (`produtor-desconhecido`).
      this.deps.aoDiagnosticar("sfu-ecra-som-nao-fechou", String((erro as Error)?.message ?? erro))
    }
    produtor.close()
  }

  /**
   * Put MUSIC in the call: its own producer, source `musica`, encrypted.
   *
   * Phase 9 of `docs/planos/definicoes-0-9.md`. Independent of everything else:
   * does not ask for image (the server accepts it on its own), does not go
   * through the voice chain (the track comes from the player, `musica.ts`, not
   * the microphone), and does not die when the microphone is muted. Stereo Opus
   * at 64 kbps (`OPCOES_DA_MUSICA`).
   *
   * **A refusal does NOT bring down the call**, like the camera: whoever wanted
   * to play music ends up without music, not without a call. The most likely
   * refusal today is a gateway that does not yet know `musica` (see
   * `FONTE_DA_MUSICA`), and it is logged.
   *
   * @returns `true` when music is on air (or already was).
   */
  async partilharMusica(faixa: MediaStreamTrack): Promise<boolean> {
    if (this.#musica) return true
    if (!this.#envio) return false
    const geracao = this.#geracao
    let produtor: ProdutorDeMedia | null
    try {
      produtor = await this.#insistirNaCifra(() => faixa, "musica", {}, geracao, false)
    } catch (erro) {
      this.#musica = null
      this.deps.aoDiagnosticar("sfu-musica-recusada", String((erro as Error)?.message ?? erro))
      // Raise the cipher so `Call` reports 448 instead of "the server won't take audio".
      if (ehCifraDoEmissorEmFalta(erro)) throw erro
      return false
    }
    // The call changed while the `produce` was in flight: the transport carrying it
    // has closed, and the producer with it. Don't pretend it's live.
    if (geracao !== this.#geracao || !produtor) {
      this.#musica = null
      return false
    }
    this.deps.aoMudar()
    return true
  }

  /**
   * Remove audio from the call, leaving the call itself intact.
   *
   * Same order as `pararEcra`: server first (it tells listeners it's done), then
   * the local object.
   */
  async pararMusica(): Promise<void> {
    const produtor = this.#musica
    if (!produtor) return
    this.#musica = null
    try {
      await this.deps.sinalizacao.sfuFecharProdutor(produtor.id)
    } catch (erro) {
      this.deps.aoDiagnosticar("sfu-musica-nao-fechou", String((erro as Error)?.message ?? erro))
    }
    produtor.close()
    this.deps.aoMudar()
  }

  /**
   * Remove the screen from the call, leaving the call itself intact.
   *
   * Two halves, both necessary: close the producer on our side (which stops the
   * encoder) and tell the server (which is what makes the `sfu.producer.closed`
   * reach everyone watching). Without the second, the server would keep
   * announcing to newcomers a stream that no longer exists, and watchers would
   * be stuck with the last frame frozen forever.
   *
   * Order matters: server first, then the local object. Close it first and you
   * lose the identifier the message needs to carry.
   */
  async pararEcra(): Promise<void> {
    const produtor = this.#produtores.get("ecra")
    if (!produtor) return
    this.#produtores.delete("ecra")

    // Audio goes with video: audio first, so no one hears a screen that no longer shows.
    const som = this.#somDoEcra
    this.#somDoEcra = null
    if (som) {
      try {
        await this.deps.sinalizacao.sfuFecharProdutor(som.id)
      } catch (erro) {
        this.deps.aoDiagnosticar("sfu-ecra-som-nao-fechou", String((erro as Error)?.message ?? erro))
      }
      som.close()
    }

    try {
      await this.deps.sinalizacao.sfuFecharProdutor(produtor.id)
    } catch (erro) {
      // The server might have crashed, or the call might have ended underneath. Capture
      // still has to stop either way-it's what lights the OS recording badge, and
      // leaving it alive because of a frame that never made it is the worse of the two failures.
      this.deps.aoDiagnosticar("sfu-ecra-nao-fechou", String((erro as Error)?.message ?? erro))
    }

    produtor.close()
    this.deps.aoMudar()
  }

  /**
   * Listen to someone, with decryption installed BEFORE the stream starts.
   *
   * The order of this method is the most important guarantee in this file, and
   * that's why `retomar` is the last line: the consumer is born paused on the
   * server, decryption is installed, and only then do we start it. Swap the order
   * and you get no error-you get half a second of noise in everyone's ear each
   * time someone joins, traced to the wrong place.
   */
  async #consumir(produtorId: string, address: UserAddress, fonteDeclarada?: FonteDoFluxo): Promise<void> {
    // A producer the server already marked dead is not pursued: the `consume` would be
    // rejected, and all you gain is a round trip to the server and a log line saying
    // something failed that was always going to fail.
    if (this.#mortos.has(produtorId)) return
    // Consuming the same producer twice plays the same voice twice with half a second
    // lag. See `#aConsumir`.
    if (this.#aConsumir.has(produtorId)) return

    /*
      A screen is only consumed if we ask for it.
      
      Here, and before `#aConsumir`, on purpose: not consuming is the cheapest
      optimization-no server request, no consumer, no decryption-and it's the
      common case, because most people in a call don't ask to see anyone's screen.
      
      For those who asked and then didn't want to, there's `largarEcraDe`, which
      PAUSES the consumer: a paused consumer sends no RTP, so the faucet closes
      there too. What we don't do is close it, which would leave a consumer
      orphaned for each cycle of watching and not watching.
      
      The offer stays saved so the "Watch" button can accept it later. Outside the
      `ecra` source nothing changes: camera and audio consume as always, and
      consent to see them is just joining the call.
      */
    if (fonteDeclarada === "ecra" && !this.deps.verOEcraDe(address)) {
      this.#ofertasDeEcra.set(produtorId, address)
      this.deps.aoMudar()
      return
    }

    const recepcao = this.#recepcao
    const dispositivo = this.#dispositivo
    if (!recepcao || !dispositivo) {
      // No way to listen yet. Save it, never throw it away: the gateway announces each
      // stream once only. See `#anunciadosCedo`.
      //
      // Outside a call we save nothing-a late warning about a call that already ended
      // can't hang around for the next one.
      if (this.#canal !== null) {
        this.#anunciadosCedo.push({ produtorId, address, fonte: fonteDeclarada })
        // A cap, like the `#heardBeforeJoining` in `call.ts` has its own: this list fills
        // with what the SERVER sends, and a boundless list is a memory leak at socket
        // speed. Sixteen people with three sources each is the most a scope can produce;
        // we keep the LATEST, because a recent announcement describes the call better.
        if (this.#anunciadosCedo.length > 48) this.#anunciadosCedo.splice(0, this.#anunciadosCedo.length - 48)
      }
      return
    }
    this.#aConsumir.add(produtorId)

    /*
      THE FIRST attempt is waited for by the caller; retries are not.

      `entrar` consumes producers from `scope.joined` one by one, with `await` on
      each. Retrying here with waits in between would let a broken producer hold
      the entire entry for tens of seconds-and in that time no one is heard, not
      even the people who are fine. Retries run on their own, on the clock, and
      no one waits for them.
    */
    await this.#umConsumo(recepcao, dispositivo, produtorId, address, fonteDeclarada, 0)
  }

  /**
   * How long we wait between one consume attempt and the next.
   *
   * **The length of this list is the number of retries, by design:** two constants
   * (how many times, and how far apart) can disagree without anyone noticing.
   * Six attempts total, in about 30 s.
   *
   * **Why retry at all.** The gateway announces each producer ONCE
   * (`sfu.producer.new`), and there's no second chance: the `sfu.scope.joined`
   * was answered before that producer even existed. A `sfu.consume` that gets lost
   * or arrives at the server out of time would leave the person without audio on
   * the screen of whoever asked for it for the rest of the call.
   *
   * **Why these numbers.** Until 1.3.0 they were 1 and 3 s, just for network loss.
   * Since refusals by time also retry now (4/11/2026), the wait has to give an
   * in-between server state (a rebuilt producer, a reconnection on the other side)
   * time to settle: 1, 2, 4, 8 and 15 s. The first second still fits inside the
   * twelve seconds of patience the interface has (`PACIENCIA_MS`, in
   * `lib/estadoDaChamada.ts`). At the end, the attempt doesn't die: it waits for
   * a signal (`acordarConsumos`). The cost on the gateway's cap (300 `sfu.*`
   * frames per minute per account) is six requests per producer in 30 s.
   */
  static readonly ESPERAS_DO_CONSUMO_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 15_000]

  /**
   * Failed consumes that we still want, by producer.
   *
   * `tentativa` is the NEXT attempt (0 is the first). `relogio` is the wait in
   * progress; `null` when we've exhausted all waits, and then the entry sleeps
   * until a signal: an announcement from the person (`pessoaAnunciou`,
   * `produtorNovo`), an epoch change, the receive transport coming back, or the
   * server list (`ressincronizar`). It's also what the interface reads to not say
   * "connected" for someone we still can't hear (`somEmFaltaDe`).
   */
  /** Producers the server rejected for good: the list (`ressincronizar`) won't ask for them again. */
  #recusadosDeVez = new Set<string>()

  #emFalta = new Map<
    string,
    {
      address: UserAddress
      fonte: FonteDoFluxo | undefined
      tentativa: number
      relogio: ReturnType<typeof setTimeout> | null
      /** How many `unknown-transport` refusals in a row. Two means rebuild the media. */
      transporteDesconhecido: number
      /** The last refusal was for a producer, consumer or transport the server doesn't know. */
      perguntarALista: boolean
    }
  >()

  /**
   * Scheduled retries, so leaving doesn't leave work running.
   *
   * The generation alone already guarantees correctness-a retry that wakes in a
   * call that isn't its own sees the number changed and does nothing. This is the
   * other half: leaving a call should not leave clocks running in it.
   */
  #repeticoes = new Set<ReturnType<typeof setTimeout>>()

  /** A consume attempt. Failing here is decided in `#depoisDeFalhar`. */
  async #umConsumo(
    recepcao: TransporteDeMedia,
    dispositivo: DispositivoDeMedia,
    produtorId: string,
    address: UserAddress,
    fonteDeclarada: FonteDoFluxo | undefined,
    tentativa: number,
  ): Promise<void> {
    /*
      The choice is RE-READ on each attempt, not just the first.
      
      The guard lived only in `#consumir`, and retries don't go through there:
      they enter via `#tentarOutraVez` and land here directly. Between the failure
      and the retry a whole second fits, and in that second fits "Stop watching"-
      which at that instant finds no consumer to drop because it doesn't exist yet,
      so it does nothing. The retry woke, installed the consumer, and the stage
      opened with 2.5 Mbps flowing in while our own `aVer` said we weren't watching.
      
      And the producer LEAVES `#aConsumir`: it's the brake on repeated consume, and
      leaving it there would make the next "Watch" do nothing. The offer goes back
      to the list for the same reason as always-the producer stays alive on the other
      side and the gateway won't announce it again.
      */
    if (fonteDeclarada === "ecra" && !this.deps.verOEcraDe(address)) {
      this.#aConsumir.delete(produtorId)
      this.#ofertasDeEcra.set(produtorId, address)
      this.deps.aoMudar()
      return
    }

    // Which call is this attempt from. Between one retry and the next a leave and a
    // new join fit, and what gets decided next has to know if it still talks about
    // the call it was born in. See `#geracao`.
    const geracao = this.#geracao

    const partiu = Date.now()
    try {
      const params = await this.deps.sinalizacao.sfuConsumir(recepcao.id, produtorId, dispositivo.rtpCapabilities).finally(
        () => {
          /*
            A response that takes longer than the thread's watch tolerance is a
            thread stuck elsewhere: on desktop the session lives in the main
            process (the vault in 1.3.0 froze it there), and the renderer, where
            this engine is, notices nothing on its clock. What we do is the same:
            ask the server who's in the call.
          */
          const demorou = Date.now() - partiu
          if (demorou >= MotorSfu.THREAD_PRESA_MS && geracao === this.#geracao) {
            this.deps.aoDiagnosticar("sfu-resposta-lenta", `sfu.consume · ${demorou} ms`)
            void this.ressincronizar("resposta lenta")
          }
        },
      )
      const consumidor = await recepcao.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      })

      /*
       * The producer might have died while this was in flight.
       *
       * The death notice arrived, looked for the consumer and found none-because
       * it's this one, and didn't exist yet. Installing it now is hanging a corpse:
       * the badge says "connected", the banner never touches anything, and the
       * notice that should have cleaned it up already passed and won't come back.
       * See `#mortos`.
       */
      if (this.#mortos.has(produtorId)) {
        consumidor.close()
        return
      }

      /*
       * The source, with absence read by `kind`.
       *
       * A Phase 2 server never sends it-it only relayed audio-and video without
       * a source can only be a camera, because the screen had no path before this
       * phase. Inventing a "screen" here would put someone's face on stage.
       */
      const fonte: FonteDoFluxo = fonteDeclarada ?? (params.kind === "audio" ? "microfone" : "camara")

      let encrypted = false
      let semChave = false
      if (consumidor.rtpReceiver) {
        encrypted = await this.deps.cifra.protegerReceptor(consumidor.rtpReceiver, address)
        if (!encrypted) {
          /*
            No cipher because of a missing KEY, or because of the platform?

            Two different failures. The platform one (no insertable streams, mute
            worker) was already logged by the cipher and won't fix itself: the
            stream continues as it always did, marked unencrypted. The key one
            resolves when the commit seating the person arrives, and until then the
            stream stays paused on the server. See `semChave`.
          */
          const faltaAChave = !(await this.deps.cifra.receptorDe(address))
          this.deps.aoDiagnosticar(faltaAChave ? "sfu-receptor-sem-chave" : "sfu-receptor-sem-cifra", address)
          /*
            And both stay paused on the server (SEC-02, the receiver side). Until
            1.2.0 the platform one went to what we hear, marked unencrypted: a
            receiver without decryption plays what the server sends it, and a server
            sending clear media on behalf of this person was heard as them. Now we
            only hear what opened with their key. The platform one retries on each
            commit, like the key one.
          */
          semChave = true
        }
      } else {
        // No receiver means nowhere to hang the decryption: it stays paused forever.
        this.deps.aoDiagnosticar("sfu-sem-rtpreceiver", address)
        semChave = true
      }

      this.#consumidores.set(produtorId, { address, fonte, consumidor, encrypted, semChave, revogado: false, pausado: false })
      this.#vigiarTransporte(consumidor.rtpReceiver?.transport, "recepcao")
      if (semChave) this.#consumoRecuperado(produtorId, tentativa)
      if (semChave) {
        // Neither stream nor resume: setup ends in `protegerOsSemChave`, on the next
        // commit or the next clock retry.
        this.#agendarReceptoresSemChave(true)
        this.deps.aoMudar()
        return
      }
      await this.#abrirConsumo(recepcao, produtorId, address, fonte, consumidor)
      this.#consumoRecuperado(produtorId, tentativa)
    } catch (erro) {
      // A person we can't hear can't bring down the call with everyone else. What
      // happens next-retry or give up and say so-is decided in one place, because
      // it's a policy, not a line.
      this.#depoisDeFalharConsumo(erro, produtorId, address, fonteDeclarada, tentativa, geracao)
    }
  }

  /**
   * The second half of setup that starts the stream: what we hear, and the faucet.
   *
   * Split from `#umConsumo` so setup can finish later, when the key of the
   * speaker arrives after the consume (`protegerOsSemChave`). Order is as always:
   * decryption is already hung when the server gets the `sfu.resume`.
   */
  async #abrirConsumo(
    recepcao: TransporteDeMedia,
    produtorId: string,
    address: UserAddress,
    fonte: FonteDoFluxo,
    consumidor: ConsumidorDeMedia,
  ): Promise<void> {
    this.#arrumarFluxo(address, fonte, consumidor.track)
    this.#vigiarFaixa(consumidor.track, address, fonte)

    // And only now. See the comment in `#umConsumo`.
    await this.deps.sinalizacao.sfuRetomar(recepcao.id, consumidor.id)
    if (fonte === "ecra" && consumidor.track.kind === "video") this.#vigiarImagemDoEcra(produtorId, address, "novo")
    if (consumidor.track.kind === "video") this.#vigiarFotogramaChave(produtorId)
    this.deps.aoMudar()
  }

  /**
   * Finish setup for those waiting on the key (`semChave`).
   *
   * Called by `Call` every time the channel epoch changes, right after rotation:
   * that's when the tree changes, and that's how the leaf of someone seated after
   * their consume was set up arrives. Order is the normal setup order-decryption
   * hangs on a receiver that's seen no frames yet, because the server keeps it
   * paused, and only then comes the `sfu.resume`.
   *
   * A consumer that died in the meantime, or a call that changed hands, is left
   * alone: the map is re-read after each `await`.
   *
   * @returns how many got protected now.
   */
  /**
   * The clock for receivers without decryption: retry without waiting for a commit.
   *
   * Until 1.3.0 only the next commit retried (`Call.rekey`). A commit can take
   * time, and a decryption that failed for platform reasons (the worker that
   * didn't confirm in time) can pass on its own. The waits are the sender's
   * (`ESPERAS_DA_CIFRA_MS`); when they run out, commits take over, like before.
   * A new receiver without a key restarts the count.
   */
  #relogioDosReceptores: ReturnType<typeof setTimeout> | null = null
  #tentativaDosReceptores = 0

  #agendarReceptoresSemChave(recomecar = false): void {
    if (recomecar) this.#tentativaDosReceptores = 0
    if (this.#relogioDosReceptores) return
    const espera = MotorSfu.ESPERAS_DA_CIFRA_MS[this.#tentativaDosReceptores]
    if (espera === undefined) return
    const geracao = this.#geracao
    this.#relogioDosReceptores = setTimeout(() => {
      this.#relogioDosReceptores = null
      if (geracao !== this.#geracao) return
      this.#tentativaDosReceptores++
      void this.protegerOsSemChave()
        .then(() => {
          const faltam = [...this.#consumidores.values()].some((entrada) => entrada.semChave)
          if (faltam && geracao === this.#geracao) this.#agendarReceptoresSemChave()
        })
        .catch((erro: unknown) => this.deps.aoDiagnosticar("sfu-receptor-nao-retomou", String((erro as Error)?.message ?? erro)))
    }, espera)
  }

  async protegerOsSemChave(): Promise<number> {
    const recepcao = this.#recepcao
    if (!recepcao) return 0
    const geracao = this.#geracao
    let protegidos = 0
    for (const [produtorId, entrada] of [...this.#consumidores]) {
      if (!entrada.semChave && !entrada.revogado) continue
      const receptor = entrada.consumidor.rtpReceiver
      if (!receptor) continue
      // No key: decryption hangs now. Revoked: it's already there, just missing the
      // chain (with worker ACK). See `revogar`.
      const pronto = entrada.semChave
        ? await this.deps.cifra.protegerReceptor(receptor, entrada.address)
        : await this.deps.cifra.receptorPronto(entrada.address)
      if (!pronto) continue
      const actual = this.#consumidores.get(produtorId)
      if (geracao !== this.#geracao || actual?.consumidor !== entrada.consumidor) continue
      this.#consumidores.set(produtorId, { ...actual, encrypted: true, semChave: false, revogado: false })
      protegidos++
      this.deps.aoDiagnosticar("sfu-receptor-protegido-depois", entrada.address)
      // A screen the person stopped wanting to see in the meantime stays protected
      // and paused, like others who stopped watching: the next "Watch" resumes it.
      if (actual.pausado) continue
      try {
        await this.#abrirConsumo(recepcao, produtorId, entrada.address, entrada.fonte, entrada.consumidor)
      } catch (erro) {
        this.deps.aoDiagnosticar("sfu-receptor-nao-retomou", `${entrada.address} · ${String((erro as Error)?.message ?? erro)}`)
      }
    }
    return protegidos
  }

  /** A consume that was missing opened: say so, and the interface stops counting it. */
  #consumoRecuperado(produtorId: string, tentativa: number): void {
    const entrada = this.#emFalta.get(produtorId)
    if (!entrada) return
    if (entrada.relogio) clearTimeout(entrada.relogio)
    this.#emFalta.delete(produtorId)
    this.deps.aoDiagnosticar("sfu-consumo-recuperado", `${produtorId} · ${entrada.address} · tentativa ${tentativa + 1}`)
    this.deps.aoMudar()
  }

  /** Drop a missing consume (the producer died, or the refusal was final). */
  #largarEmFalta(produtorId: string): void {
    const entrada = this.#emFalta.get(produtorId)
    if (!entrada) return
    if (entrada.relogio) clearTimeout(entrada.relogio)
    this.#emFalta.delete(produtorId)
    this.deps.aoMudar()
  }

  /**
   * A consume failed: retry, or give up and say so?
   *
   * **Give up when there's no one left, or when the answer is final.** No one left:
   * the producer was marked dead, or the call changed hands. Final: a refusal in
   * `RECUSAS_FINAIS_DO_CONSUMO` (the device that won't read the codec, the
   * connection with no room in the channel, the server is full).
   *
   * **Retry everything else, with growing wait** (`ESPERAS_DO_CONSUMO_MS`): network
   * loss (timeout, socket down) and refusals that might be due to time (4/11/2026,
   * #984). A refusal of a producer or consumer the server doesn't know also asks
   * it who's in the call (`ressincronizar`): if the producer is no longer in the
   * list, it died and won't be pursued; if it is, the retry will find it.
   *
   * At the end of the waits the entry doesn't die: it sleeps until a signal (see `#emFalta`).
   */
  #depoisDeFalharConsumo(
    erro: unknown,
    produtorId: string,
    address: UserAddress,
    fonteDeclarada: FonteDoFluxo | undefined,
    tentativa: number,
    geracao: number,
  ): void {
    const razao = descreverFalhaDoSfu(erro)
    const codigo = codigoDaRecusaDoSfu(erro)
    const total = MotorSfu.ESPERAS_DO_CONSUMO_MS.length + 1
    // Each refusal is logged with the code and phrase from the server, even the ones we retry.
    if (codigo !== null) this.deps.aoDiagnosticar("sfu-consumo-recusado", `${produtorId} · ${razao} · ${tentativa + 1}/${total}`)

    // New call, or none: `exit` already cleaned everything; what's there now belongs to a different lifecycle.
    if (geracao !== this.#geracao) return

    /*
      Check the code, not `instanceof`: in the desktop app the refusal arrives at the
      renderer remade by the IPC envelope, without the class (same care as `ehRecusaDoSfu`
      in `call.ts`). The code goes in `cause`.
    */
    const final = codigo !== null && RECUSAS_FINAIS_DO_CONSUMO.has(codigo)
    if (final || this.#mortos.has(produtorId)) {
      // The server list never asks again for what it refused permanently. See `ressincronizar`.
      if (final) this.#recusadosDeVez.add(produtorId)
      // Its place on screen stays silent, which is the truth, and better than the whole call
      // dropping. The identifier goes in the line because in a sixteen-person call the phrase
      // alone doesn't say who we're talking about.
      this.#aConsumir.delete(produtorId)
      this.#largarEmFalta(produtorId)
      this.deps.aoDiagnosticar("sfu-consumo-falhou", `${produtorId} · ${razao}`)
      /*
        A screen goes back to the offer list. `consumirOfertasDe` removes the offer
        BEFORE consuming, and without this a consumption that failed completely would
        take the offer with it: the "View" bar stayed lit by the roster, and tapping it
        did nothing for the rest of the call (October 18, 2026). Only if the producer
        still exists: a screen already closed has no offer to restore.
      */
      if (fonteDeclarada === "ecra" && !this.#mortos.has(produtorId)) {
        this.#ofertasDeEcra.set(produtorId, address)
        // The "View" was refused because the server is full: the person tapped and must know why.
        if (ehServidorCheio(erro)) this.deps.aoRecusar?.(erro)
        this.deps.aoMudar()
      }
      return
    }

    const anterior = this.#emFalta.get(produtorId)
    if (anterior?.relogio) clearTimeout(anterior.relogio)
    const entrada = {
      address,
      fonte: fonteDeclarada,
      tentativa: tentativa + 1,
      relogio: null as ReturnType<typeof setTimeout> | null,
      transporteDesconhecido: codigo === "transporte-desconhecido" ? (anterior?.transporteDesconhecido ?? 0) + 1 : 0,
      perguntarALista: false,
    }
    this.#emFalta.set(produtorId, entrada)
    if (!anterior) {
      // Once per missing consumption, not per attempt: it's the line the interface
      // turns into alert 453 (voice only, see `avisoDaChamada`).
      this.deps.aoDiagnosticar("sfu-consumo-em-falta", `${address} · ${fonteDeclarada ?? "?"} · ${produtorId}`)
      this.deps.aoMudar()
    }

    // The server says it doesn't know the producer, consumer, or transport: before the
    // next attempt we ask it who's in the call (see `#tentarOutraVez`). Not now: the
    // refusal may come from inside `entrar`, and entry finishes before we ask anything.
    entrada.perguntarALista =
      codigo === "produtor-desconhecido" || codigo === "consumidor-desconhecido" || codigo === "transporte-desconhecido"
    // The receive transport here is no longer the one there: twice in a row means redoing the media.
    if (entrada.transporteDesconhecido >= 2) {
      entrada.transporteDesconhecido = 0
      this.deps.aoDiagnosticar("sfu-recepcao-perdida", `${produtorId} · ${this.#recepcao?.id ?? "?"}`)
      this.deps.aoRecepcaoPerdida?.()
    }

    const espera = MotorSfu.ESPERAS_DO_CONSUMO_MS[tentativa]
    // Outside a wait, the producer leaves `#aConsumir`: it's the throttle on repeated
    // consumption, and a signal (or a repeated `producer.new`) must be able to start the next attempt.
    if (espera === undefined) {
      this.#aConsumir.delete(produtorId)
      this.deps.aoDiagnosticar("sfu-consumo-falhou", `${produtorId} · ${razao} · à espera de um sinal`)
      return
    }

    // During the wait the producer stays in `#aConsumir`, and it's what stops a repeated
    // `sfu.producer.new` from starting a second stream on the same flow.
    this.deps.aoDiagnosticar("sfu-consumo-a-repetir", `${produtorId} · ${tentativa + 1}/${total} · ${espera} ms · ${razao}`)
    entrada.relogio = setTimeout(() => {
      entrada.relogio = null
      this.#repeticoes.delete(relogio)
      void this.#tentarOutraVez(produtorId, geracao)
    }, espera)
    const relogio = entrada.relogio
    this.#repeticoes.add(relogio)
  }

  /**
   * The next attempt at a failed consumption, already outside the timeout of the first requester.
   *
   * Rereads the transport and device instead of pulling from the previous attempt:
   * between the two an exit can fit. With `catch`, not bare: this runs outside any `await`,
   * and an uncaught rejection bubbles to the top of the renderer.
   */
  async #tentarOutraVez(produtorId: string, geracao: number): Promise<void> {
    if (geracao !== this.#geracao) return
    let entrada = this.#emFalta.get(produtorId)
    if (!entrada) return
    // Marked already, so a signal arriving during the list query doesn't start another one.
    this.#aConsumir.add(produtorId)
    try {
      if (entrada.perguntarALista) {
        entrada.perguntarALista = false
        await this.ressincronizar(`recusa de ${produtorId}`)
        // The list may have said it died (and `produtorFechado` dropped it).
        if (geracao !== this.#geracao) return
        entrada = this.#emFalta.get(produtorId)
        if (!entrada) return
      }
      const recepcao = this.#recepcao
      const dispositivo = this.#dispositivo
      if (this.#mortos.has(produtorId) || !recepcao || !dispositivo) {
        this.#aConsumir.delete(produtorId)
        this.#largarEmFalta(produtorId)
        return
      }
      await this.#umConsumo(recepcao, dispositivo, produtorId, entrada.address, entrada.fonte, entrada.tentativa)
    } catch (erroSolto: unknown) {
      this.#aConsumir.delete(produtorId)
      this.deps.aoDiagnosticar("sfu-consumo-falhou", `${produtorId} · ${descreverFalhaDoSfu(erroSolto)}`)
    }
  }

  /**
   * A signal that a failed consumption can go now: try immediately, without waiting for the timer.
   *
   * The signals: an epoch change (`Call.rekey`), the receive transport coming back,
   * a thread freeze that ended, and this person's announcements (`pessoaAnunciou`,
   * `produtorNovo`). An attempt in progress doesn't duplicate. A woken attempt counts
   * as the next in the sequence, so signals don't move the count backward.
   *
   * @param address only this person's; without it, all of them.
   * @param soOsQueDormem only those that have exhausted their waits: the server list
   *   doesn't shorten a wait in progress, else every refusal (which queries the list)
   *   would cancel the growing wait.
   * @returns how many woke up.
   */
  acordarConsumos(motivo: string, address?: UserAddress, soOsQueDormem = false): number {
    let acordados = 0
    for (const [produtorId, entrada] of [...this.#emFalta]) {
      if (address !== undefined && entrada.address !== address) continue
      if (soOsQueDormem && (entrada.relogio !== null || this.#aConsumir.has(produtorId))) continue
      // An attempt in flight: in `#aConsumir` without a timer.
      if (this.#aConsumir.has(produtorId) && entrada.relogio === null) continue
      if (entrada.relogio) {
        clearTimeout(entrada.relogio)
        this.#repeticoes.delete(entrada.relogio)
        entrada.relogio = null
      }
      acordados++
      void this.#tentarOutraVez(produtorId, this.#geracao)
    }
    if (acordados > 0) this.deps.aoDiagnosticar("sfu-consumo-acordado", `${motivo} · ${acordados}`)
    return acordados
  }

  /**
   * This person announced themselves on the roster (`voice.join`): is their sound still missing?
   *
   * Wakes failed consumptions of theirs. And if there are none, but also no flow
   * from them and no consumption on the way, their producer announcement got lost
   * (or was never requested): ask the server who's in the call. With a cap
   * (`#ressincronizar` has a minimum interval), because the roster reaffirms itself
   * now and then.
   */
  async pessoaAnunciou(address: UserAddress): Promise<void> {
    if (!this.activo) return
    if (this.acordarConsumos("voice.join", address) > 0) return
    const temFluxo = [...this.#consumidores.values()].some((entrada) => entrada.address === address)
    if (temFluxo) return
    await this.ressincronizar("voice.join sem som")
  }

  /** Is this person's sound missing (a consumption of their voice failed and we're still trying)? */
  somEmFaltaDe(address: UserAddress): boolean {
    for (const entrada of this.#emFalta.values()) {
      if (entrada.address === address && (entrada.fonte === undefined || entrada.fonte === "microfone")) return true
    }
    return false
  }

  /** The minimum interval between two queries to the server about who's in the call. */
  static readonly INTERVALO_DA_RESSINCRONIZACAO_MS = 2_000

  #ressincronizacao: Promise<void> | null = null
  #ultimaRessincronizacao = 0

  /**
   * Ask the server who's in the call, and fix what we hear based on that.
   *
   * It's a `sfu.scope.join` again: the server already has us in scope, and the
   * response (`sfu.scope.joined`) brings the list of live producers. It changes nothing
   * over there, nor in the thread: it's the same frame as always, any SFU server already
   * handles it. With it:
   *
   * 1. a failed consumption whose producer isn't in the list died: gravestone it, and
   *    don't chase it anymore;
   * 2. a consumer of ours whose producer isn't in the list missed the death notice
   *    (`sfu.producer.closed`): close it, so the person doesn't stay "connected" with
   *    a dead track;
   * 3. a producer in the list that isn't ours and we're not hearing missed the
   *    announcement (`sfu.producer.new`): consume it. Except those the server already
   *    refused permanently (`RECUSAS_FINAIS_DO_CONSUMO`): the answer would be the same.
   *
   * Point 2 only looks at consumers that already existed when the query went out:
   * one born in between is from a producer the response may not yet know.
   */
  async ressincronizar(motivo: string): Promise<void> {
    if (this.#ressincronizacao) return this.#ressincronizacao
    const espera = this.#ultimaRessincronizacao + MotorSfu.INTERVALO_DA_RESSINCRONIZACAO_MS - Date.now()
    const geracao = this.#geracao
    this.#ressincronizacao = (async () => {
      if (espera > 0) {
        await new Promise<void>((pronto) => {
          // A clean exit clears the timers: the promise must end anyway.
          const acabar = (): void => {
            this.#aoSair.delete(acabar)
            pronto()
          }
          const relogio = setTimeout(() => {
            this.#repeticoes.delete(relogio)
            acabar()
          }, espera)
          this.#repeticoes.add(relogio)
          this.#aoSair.add(acabar)
        })
      }
      if (geracao !== this.#geracao) return
      await this.#ressincronizarJa(motivo, geracao)
    })().finally(() => {
      this.#ressincronizacao = null
    })
    return this.#ressincronizacao
  }

  /** Whoever waits for a timer the exit cleared: wakes, sees the new generation, and leaves. */
  readonly #aoSair = new Set<() => void>()

  async #ressincronizarJa(motivo: string, geracao: number): Promise<void> {
    const canal = this.#canal
    const ambito = this.#ambito
    if (!canal || !ambito || !this.#recepcao) return
    this.#ultimaRessincronizacao = Date.now()
    const consumidoresAntes = new Map([...this.#consumidores].map(([produtorId, entrada]) => [produtorId, entrada.consumidor]))
    let producers: { id: string; address: UserAddress; fonte?: FonteDoFluxo | undefined }[]
    try {
      ;({ producers } = await this.deps.sinalizacao.sfuEntrarNoAmbito(canal, ambito))
    } catch (erro) {
      this.deps.aoDiagnosticar("sfu-ressincronizar-falhou", `${motivo} · ${descreverFalhaDoSfu(erro)}`)
      return
    }
    if (geracao !== this.#geracao) return

    const vivos = new Map(producers.map((produtor) => [produtor.id, produtor]))
    const nossos = new Set(
      [...this.#produtores.values(), this.#somDoEcra, this.#musica].filter((cada) => cada !== null).map((cada) => cada!.id),
    )
    let mortos = 0
    let novos = 0

    for (const produtorId of [...this.#emFalta.keys()]) {
      if (vivos.has(produtorId)) continue
      mortos++
      this.deps.aoDiagnosticar("sfu-consumo-falhou", `${produtorId} · o servidor já não tem este fluxo`)
      this.produtorFechado(produtorId)
    }
    for (const [produtorId, consumidor] of consumidoresAntes) {
      if (vivos.has(produtorId) || this.#consumidores.get(produtorId)?.consumidor !== consumidor) continue
      mortos++
      this.produtorFechado(produtorId)
    }
    for (const produtor of producers) {
      if (nossos.has(produtor.id) || this.#mortos.has(produtor.id) || this.#recusadosDeVez.has(produtor.id)) continue
      if (this.#consumidores.has(produtor.id) || this.#aConsumir.has(produtor.id) || this.#emFalta.has(produtor.id)) continue
      if (this.#ofertasDeEcra.has(produtor.id)) continue
      novos++
      await this.#consumir(produtor.id, produtor.address, produtor.fonte)
      if (geracao !== this.#geracao) return
    }
    this.deps.aoDiagnosticar(
      "sfu-ressincronizado",
      `${motivo} · ${producers.length} no servidor · ${novos} novos · ${mortos} mortos · ${this.#emFalta.size} em falta`,
    )
    // Those left missing, with no more waits, that the server still has: try now.
    this.acordarConsumos(`lista do servidor (${motivo})`, undefined, true)
    this.deps.aoMudar()
  }

  /**
   * How often the thread watchdog checks the wall clock.
   *
   * A stuck thread (the vault writing 11 MB per event, in 1.3.0) doesn't run any
   * timer: when it unsticks, the watchdog sees much more time passed than it asked.
   * In that time server notices may have been lost, or responses about a state already
   * gone arrived, and so we ask the server who's in the call (`ressincronizar`) and
   * wake failed consumptions.
   */
  static readonly VIGIA_DA_THREAD_MS = 2_000
  /** The delay from which a watchdog cycle counts as a stuck thread. */
  static readonly THREAD_PRESA_MS = 4_000

  #vigiaDaThread: ReturnType<typeof setInterval> | null = null

  #vigiarAThread(): void {
    this.#pararVigiaDaThread()
    let ultima = Date.now()
    this.#vigiaDaThread = setInterval(() => {
      const agora = Date.now()
      const atraso = agora - ultima - MotorSfu.VIGIA_DA_THREAD_MS
      ultima = agora
      if (atraso < MotorSfu.THREAD_PRESA_MS) return
      this.deps.aoDiagnosticar("sfu-thread-presa", `${Math.round(atraso + MotorSfu.VIGIA_DA_THREAD_MS)} ms`)
      void this.ressincronizar("thread presa")
    }, MotorSfu.VIGIA_DA_THREAD_MS)
  }

  #pararVigiaDaThread(): void {
    if (this.#vigiaDaThread) clearInterval(this.#vigiaDaThread)
    this.#vigiaDaThread = null
  }

  /** A new flow appeared in the call. Comes from the session's `sfu` event. */
  async produtorNovo(
    canal: string,
    ambito: string,
    produtorId: string,
    address: UserAddress,
    fonte?: FonteDoFluxo,
  ): Promise<void> {
    // The notice is from the gateway and reaches those in scope; confirming anyway is cheap
    // and stops a notice from an earlier call, still in flight, from putting a flow into the next call.
    if (canal !== this.#canal || ambito !== this.#ambito) return
    // The same person started producing again: a failed consumption of theirs can go now.
    this.acordarConsumos("producer.new", address)
    await this.#consumir(produtorId, address, fonte)
  }

  /*
    A public `ofertasDeEcra()` used to be here, and left because it had no readers:
    whoever draws the "sharing screen" bar with the "View" button reads `ecraOferecido`,
    which comes from the encrypted ROSTER (see `#anunciarPorSfu` in `call.ts`), the
    roster knows there's a screen offering, not this list, which is bookkeeping of producer
    IDs. The only readers were tests, and they switched to measuring what the engine DOES:
    if it consumes, if it resumes, if it pauses.
  */

  /**
   * Now we want to watch: open the tap on what was offered from this person.
   *
   * Called by `Call` AFTER the choice is recorded, `verOEcraDe` is read inside there,
   * by `#consumir` and by `#umConsumo`, and swapping the order this wouldn't consume
   * anything and there'd be no notice it didn't.
   *
   * **Two doors, the difference is what already exists on the server side.** An offer
   * never accepted has no consumer: consume it. An offer already being watched has a
   * PAUSED consumer, that's the state `largarEcraDe` leaves it in -, and then just
   * resume it: one server roundtrip instead of two, and the decryption is already set
   * up at the receiver from the first time.
   *
   * A `MediaStream` with one track is a stage; with no tracks it's a black rectangle.
   * So whoever draws waits for `aoMudar`, not for this method to return.
   */
  async consumirOfertasDe(address: UserAddress): Promise<void> {
    // A "View" of a screen whose consumption is missing (a timeout refusal waiting for
    // retry) is a signal: try now, and whoever tapped waits for it.
    for (const [produtorId, entrada] of [...this.#emFalta]) {
      if (entrada.address !== address || entrada.fonte !== "ecra") continue
      if (this.#aConsumir.has(produtorId) && entrada.relogio === null) continue
      if (entrada.relogio) {
        clearTimeout(entrada.relogio)
        this.#repeticoes.delete(entrada.relogio)
        entrada.relogio = null
      }
      await this.#tentarOutraVez(produtorId, this.#geracao)
    }
    const pendentes = [...this.#ofertasDeEcra].filter(([, quem]) => quem === address).map(([produtor]) => produtor)
    // Removed BEFORE consuming: `#consumir` puts the offer back in the list when the choice
    // says no, and leaving them there gave eternal offer of a producer already being consumed.
    for (const produtor of pendentes) this.#ofertasDeEcra.delete(produtor)
    for (const produtor of pendentes) {
      // The ENTRY of the consumption, not a boolean: what decides between resume and consume
      // is whether a consumer of this producer already exists. The name `pausado` was here and
      // read like the entry's `pausado` field, which is something else, and that name confusion
      // is what hides this family of bugs (see the second half of `largarEcraDe`).
      const instalado = this.#consumidores.get(produtor)
      if (instalado) await this.#retomarEcra(produtor, instalado)
      else await this.#consumir(produtor, address, "ecra")
    }
  }

  /**
   * Get a paused screen consumer running again.
   *
   * The track is the SAME, that's why it goes back to the flow instead of being born
   * new: `#tirarDoFluxo` only took it out of the `MediaStream`, never stopped it.
   *
   * If the server refuses, the consumer stays where it was and the offer goes back in
   * the list, the "View" button must still exist, or the person gets a stage that won't
   * open and nothing to tap.
   *
   * **And the choice is REREAD after the `await`, like in `#umConsumo`.** If "Stop watching"
   * runs inside the `sfu.resume` round, the thread out of here is `resume` → `pause`,    * server stays paused, and the next line would write `pausado: false` over it, giving
   * the track back to the stage: a frozen rectangle with no picture arriving, and "Stop
   * watching" inert, because `recusarEcra` from `call.ts` goes first when the choice
   * `delete` returns `false`. A dead end in the call, with nothing on screen to explain it.
   *
   * Reachable with TWO shares of the same account on two devices: `largarEcraDe` pauses
   * one by one, and between one pause and the next a "View" fits. The generation goes for
   * the same reason as always, between request and response an exit and a new entry fit.
   */
  async #retomarEcra(produtorId: string, entrada: ConsumoInstalado): Promise<void> {
    // Without a key we don't resume: would be the tap open for a receiver with no decryption.
    // It stays requested, and `protegerOsSemChave` opens it when the key arrives.
    if (entrada.semChave || entrada.revogado) {
      this.#consumidores.set(produtorId, { ...entrada, pausado: false })
      return
    }
    const recepcao = this.#recepcao
    if (!recepcao) {
      this.#ofertasDeEcra.set(produtorId, entrada.address)
      return
    }
    // Which call is this resume from. Read BEFORE the request, compared after.
    const geracao = this.#geracao
    try {
      await this.deps.sinalizacao.sfuRetomar(recepcao.id, entrada.consumidor.id)
    } catch (erro) {
      this.#ofertasDeEcra.set(produtorId, entrada.address)
      this.deps.aoDiagnosticar("sfu-ecra-nao-retomou", `${produtorId} · ${String((erro as Error)?.message ?? erro)}`)
      if (ehServidorCheio(erro)) this.deps.aoRecusar?.(erro)
      this.deps.aoMudar()
      return
    }
    /*
      New call, or choice undone while this was in flight.

      The offer goes back in the list, the server was already told to pause by whoever
      undid the choice, and what can't happen is the track going back to the stage.
      In the new call we return nothing: `exit` already cleaned the whole list, and
      what went in now belonged to a different lifecycle.
    */
    if (geracao !== this.#geracao) return
    if (!this.deps.verOEcraDe(entrada.address)) {
      this.#ofertasDeEcra.set(produtorId, entrada.address)
      this.deps.aoMudar()
      return
    }
    this.#consumidores.set(produtorId, { ...entrada, pausado: false })
    this.#arrumarFluxo(entrada.address, entrada.fonte, entrada.consumidor.track)
    if (entrada.consumidor.track.kind === "video") {
      this.#vigiarImagemDoEcra(produtorId, entrada.address, "retomado")
      this.#vigiarFotogramaChave(produtorId)
    }
    this.deps.aoMudar()
  }

  /**
   * Stop watching this person's screen: close the tap on the SERVER.
   *
   * **Pause, not close, and the difference is all the savings.** A paused consumer
   * sends no RTP, it's the same guarantee the `consume({ paused: true })` from `media.ts`
   * gives between consumption and decryption setup -, so the server output for this viewer
   * stops outright. Closing the consumer just from here saved nothing: the worker kept
   * routing the picture to a transport that no longer reads it, and each "View → Stop →
   * View" cycle left a consumer behind routing to nobody.
   *
   * And pausing instead of closing has a second bonus: the object stays, decryption
   * installed, and the next "View" is a `sfu.resume` instead of a new `sfu.consume`.
   * See `sfu.pause` in the protocol, and `#retomarEcra` next door.
   *
   * The track leaves the flow and the stage closes, that's what you see. The offer
   * goes back in the list, so the "View" button can accept it again: the producer
   * stays alive over there, and the gateway won't announce it again.
   */
  async largarEcraDe(address: UserAddress): Promise<void> {
    /*
      Two moves, and the order is the person's gesture.

      First the stage closes and the screen redraws; only then do we go to the server.
      Whoever tapped "Stop watching" must see the picture vanish instantly, not at the
      end of a server roundtrip, which may take time, and may not arrive. What we lose
      if the frame fails is bandwidth savings, and that goes in the log; what we can't
      lose is the gesture.
    */
    const largados: { produtorId: string; consumidor: ConsumidorDeMedia }[] = []
    for (const [produtorId, entrada] of [...this.#consumidores]) {
      if (entrada.address !== address || entrada.fonte !== "ecra") continue
      this.#tirarDoFluxo(entrada.address, entrada.fonte, entrada.consumidor.track)
      this.#consumidores.set(produtorId, { ...entrada, pausado: true })
      this.#ofertasDeEcra.set(produtorId, address)
      largados.push({ produtorId, consumidor: entrada.consumidor })
    }
    if (largados.length === 0) return
    this.deps.aoMudar()

    const recepcao = this.#recepcao
    if (!recepcao) return
    for (const { produtorId, consumidor } of largados) {
      /*
        Reread on each round, it's the other half of the `#retomarEcra` fix.
        
        With two shares of the same account on two devices, this pauses one by one,         and between one pause and the next a "View" fits, which resumes both. Pausing
        the second after that was telling the server to close a tap the person just
        reopened: a frozen rectangle stayed on the stage, no picture arriving, this side's
        state saying it's watching. Whoever is no longer marked paused is because someone
        resumed them, and that request is newer than this one.
        */
      if (!this.#consumidores.get(produtorId)?.pausado) continue
      try {
        await this.deps.sinalizacao.sfuPausar(recepcao.id, consumidor.id)
      } catch (erro) {
        // Said and never swallowed: the stage closed, but the server-side pipeline kept running.
        // That's the kind of thing you only find out about on the bill.
        this.deps.aoDiagnosticar("sfu-ecra-nao-pausou", `${produtorId} · ${String((erro as Error)?.message ?? erro)}`)
      }
    }
  }

  /**
   * This person left the MLS tree of the channel: stop listening and watching right now.
   *
   * SEC-03 (external audit of 1.1.0). Called by `Call` for each person
   * that the rotation marks as removed (no leaf in the current tree), whatever
   * their roster presence is: presence lasts 160 s and the server knows nothing
   * of MLS, and until now the consumer kept playing and the server kept forwarding.
   * The keys were already forgotten by the cipher (`rodar`); this closes the other
   * two gates:
   *
   *  1. what we hear and see: their tracks exit the stream right now, before
   *     any round-trip to the server;
   *  2. the tap: `sfu.pause` for each consumer that was running. If the server
   *     refuses, the consumer closes here, and anything it still sends lands
   *     in a stopped receiver.
   *
   * Pause, not close, so a rejoin can be heard again: see `revogado`.
   */
  async revogar(address: UserAddress): Promise<void> {
    const aPausar: { produtorId: string; consumidor: ConsumidorDeMedia }[] = []
    let mudou = false
    for (const [produtorId, entrada] of [...this.#consumidores]) {
      if (entrada.address !== address || entrada.revogado) continue
      // Was running on the server: neither waiting for the key nor a screen to see.
      const aAndar = !entrada.semChave && !entrada.pausado
      this.#tirarDoFluxo(entrada.address, entrada.fonte, entrada.consumidor.track)
      this.#pararVigiaDoEcra(produtorId)
      this.#pararVigiaDoFotograma(produtorId)
      this.#consumidores.set(produtorId, { ...entrada, revogado: true })
      if (aAndar) aPausar.push({ produtorId, consumidor: entrada.consumidor })
      mudou = true
    }
    if (!mudou) return
    this.deps.aoDiagnosticar("sfu-revogado", address)
    this.deps.aoMudar()

    const recepcao = this.#recepcao
    for (const { produtorId, consumidor } of aPausar) {
      let razao = "sem transporte de recepção"
      if (recepcao) {
        try {
          await this.deps.sinalizacao.sfuPausar(recepcao.id, consumidor.id)
          continue
        } catch (erro) {
          razao = String((erro as Error)?.message ?? erro)
        }
      }
      if (this.#consumidores.get(produtorId)?.consumidor !== consumidor) continue
      consumidor.close()
      this.#consumidores.delete(produtorId)
      this.#aConsumir.delete(produtorId)
      this.deps.aoDiagnosticar("sfu-revogado-fechado", `${produtorId} · ${razao}`)
    }
  }

  /**
   * A stream ended: the person left, went silent, stopped sharing, or lost network.
   *
   * The tombstone always stays, and it's the missing half: this notice can arrive
   * while the `sfu.consume` of the same producer is still in flight, and in that case
   * there's no consumer to close here, there's one being born elsewhere. See
   * `#mortos`, that's where it will be read.
   */
  produtorFechado(produtorId: string): void {
    this.#mortos.add(produtorId)
    // A consumption from a dead producer is no longer wanted.
    if (this.#emFalta.has(produtorId)) {
      this.#largarEmFalta(produtorId)
      this.#aConsumir.delete(produtorId)
    }
    // An offer that no longer exists is not offered. Someone who stopped sharing
    // before anyone accepted would leave a "Watch" in the banner that went nowhere:
    // `#consumir` would refuse the dead producer, silently.
    if (this.#ofertasDeEcra.delete(produtorId)) this.deps.aoMudar()
    const entrada = this.#consumidores.get(produtorId)
    if (!entrada) return
    this.#pararVigiaDoFotograma(produtorId)
    entrada.consumidor.close()
    this.#consumidores.delete(produtorId)
    this.#aConsumir.delete(produtorId)
    this.#tirarDoFluxo(entrada.address, entrada.fonte, entrada.consumidor.track)
    this.deps.aoMudar()
  }

  /**
   * Put a track that arrived on the correct stream from this person.
   *
   * Screen apart; microphone and camera together. See `FluxoRecebido`.
   */
  #arrumarFluxo(address: UserAddress, fonte: FonteDoFluxo, faixa: MediaStreamTrack): void {
    let fluxos = this.#fluxosPorPessoa.get(address)
    if (!fluxos) {
      fluxos = { pessoa: new MediaStream(), ecra: new MediaStream(), musica: new MediaStream() }
      this.#fluxosPorPessoa.set(address, fluxos)
    }
    fluxoDaFonte(fluxos, fonte).addTrack(faixa)
  }

  /**
   * Remove a track that ended, and clean up the person when nothing is left.
   *
   * Cleanup matters: without it, a person who leaves and returns finds their
   * old stream, empty, but there, and the interface draws them a card with
   * a video element that will never play anything.
   */
  #tirarDoFluxo(address: UserAddress, fonte: FonteDoFluxo, faixa: MediaStreamTrack): void {
    const fluxos = this.#fluxosPorPessoa.get(address)
    if (!fluxos) return
    fluxoDaFonte(fluxos, fonte).removeTrack(faixa)
    if (
      fluxos.pessoa.getTracks().length === 0 &&
      fluxos.ecra.getTracks().length === 0 &&
      fluxos.musica.getTracks().length === 0
    ) {
      this.#fluxosPorPessoa.delete(address)
    }
  }

  /**
   * What is arriving, per PERSON, for the interface to draw.
   *
   * Per person and not per producer, that's the change video brought: one
   * person can have three streams arriving at once and only one card on screen.
   * The drawer gets the whole person, voice, face, and their screen separately.
   */
  fluxos(): FluxoRecebido[] {
    const porPessoa = new Map<UserAddress, FluxoRecebido>()
    for (const entrada of this.#consumidores.values()) {
      // A paused consumer is not arriving: the server sends it nothing and
      // its track left the stream. Counting it here would make a screen that stopped
      // being seen weigh on the person's `encrypted`, a security marker talking about
      // a stream that does not exist. See `largarEcraDe`.
      if (entrada.pausado) continue
      // Nor what waits for the key: nothing is arriving, and the person
      // can't appear as connected just because the consumer exists. See `semChave`.
      if (entrada.semChave) continue
      // Nor who left the channel (SEC-03). See `revogar`.
      if (entrada.revogado) continue
      const fluxos = this.#fluxosPorPessoa.get(entrada.address)
      if (!fluxos) continue
      const ja = porPessoa.get(entrada.address)
      porPessoa.set(entrada.address, {
        address: entrada.address,
        stream: fluxos.pessoa,
        ecra: fluxos.ecra.getTracks().length > 0 ? fluxos.ecra : null,
        musica: fluxos.musica.getTracks().length > 0 ? fluxos.musica : null,
        /*
         * A clear stream among three encrypted ones makes the whole person
         * unencrypted, not the other way around. The "protected" mark must describe
         * the worst of the parts: a face seen in clear is not protected because
         * the voice next to it is encrypted.
         */
        encrypted: (ja?.encrypted ?? true) && entrada.encrypted,
      })
    }
    return [...porPessoa.values()]
  }

  /**
   * How long a round-trip to the SFU takes, in milliseconds.
   *
   * **This is a different distance, and the name must say so.** In a mesh there is a
   * connection to each person and the interesting question is "how long until WHO
   * hears me"; with an SFU there's no connection to anyone, there's one to the
   * server, and the path to the other person is this hop plus theirs, which this
   * device cannot measure. We return what we measured, and the drawer labels it
   * as server. Doubling it would give a number shaped like a measurement.
   *
   * The value comes from the NAMED `candidate-pair`, which is the path where the
   * media is actually flowing; the other pairs are attempted paths that did not work,
   * and their average describes nothing. It's the same reading that mesh does, on
   * a different object.
   *
   * Both transports answer the question, and we return the WORST: they are
   * separate connections, each with its own ICE, and they may settle on different
   * paths. The inbound one has stats only after someone is consumed, its DTLS
   * is lazy, and in a solo call it answers empty, which is the truth not a failure.
   *
   * `null` while there is no measurement. Do not invent a zero.
   */
  async latencia(): Promise<number | null> {
    const medidas: number[] = []

    for (const transporte of [this.#envio, this.#recepcao]) {
      if (!transporte?.getStats) continue
      const stats = await transporte.getStats().catch(() => null)
      if (!stats) continue
      // Collect first and decide later: `forEach` over the report
      // delivers untyped records, and narrowing inside the callback does not survive
      // leaving it.
      const doTransporte: number[] = []
      stats.forEach((registo: { type?: string; nominated?: boolean; currentRoundTripTime?: number }) => {
        if (registo.type !== "candidate-pair" || registo.nominated !== true) return
        if (typeof registo.currentRoundTripTime === "number") doTransporte.push(registo.currentRoundTripTime * 1000)
      })
      if (doTransporte.length > 0) medidas.push(Math.max(...doTransporte))
    }

    if (medidas.length === 0) return null
    return Math.round(Math.max(...medidas))
  }

  /**
   * Is the image we are sending being capped? See `LimiteDeVideo`.
   *
   * Ask the PRODUCERS not the transport: the transport says the path
   * (latency comes from it), and quality limiting is from the encoder,
   * which lives in a sender. The two image sources, camera and screen, both
   * answer the question, because they share the same uplink and either one
   * could be the one being capped.
   *
   * `null` is "nothing to report": no image leaving, no stats yet,
   * or leaving whole. We don't distinguish "I don't know" from "it's fine", and
   * that's on purpose, both show the same thing on screen, which is silence, and
   * one more state here would be one more state to draw.
   */
  async limiteDeVideo(): Promise<LimiteDeVideo | null> {
    let pior: LimiteDeVideo | null = null
    for (const fonte of ["camara", "ecra"] as const) {
      const emissor = this.#produtores.get(fonte)?.rtpSender
      if (!emissor?.getStats) continue
      const stats = await emissor.getStats().catch(() => null)
      if (!stats) continue
      const limite = limiteDoRelatorio(stats)
      if (!limite) continue
      if (pior === null || (pior.razao === "cpu" && limite.razao === "bandwidth")) pior = limite
    }
    return pior
  }

  // ------------------------------------------------- diagnostics of what arrives

  /*
   * Investigated on 2 November 2026: "I stop hearing others until I leave and
   * rejoin". The proven cause was the key (see `vigia-da-decifra.ts`). These two
   * watchers notice nothing: they write to the log what sets the other hypotheses
   * apart next time, without touching the media path.
   *
   *  - a track that goes silent is one where PACKETS DO NOT ARRIVE (transport,
   *    SFU, or the sender); decryption failing does not silence it, because packets
   *    arrive and the frame is discarded. The two failures now have different names
   *    in the log;
   *  - transport that falls and never returns, without the gateway socket falling
   *    (`call-sfu-refazer` covers only that), is logged with the browser state.
   */

  /**
   * How long a track must be silent before we report it.
   *
   * With DTX, Opus sends a comfort packet every 400 ms even in silence,
   * and a track of someone just quiet does not go silent. Three seconds keeps
   * the line for the real case, not for each network pause.
   */
  static readonly FAIXA_MUDA_MS = 3000

  #vigiarFaixa(faixa: MediaStreamTrack, address: UserAddress, fonte: FonteDoFluxo): void {
    // Test doubles have no events; an engine without them does not either.
    if (typeof faixa.addEventListener !== "function") return
    const rotulo = `${address} · ${fonte}`
    let relogio: ReturnType<typeof setTimeout> | null = null
    let dita = false
    faixa.addEventListener("mute", () => {
      if (relogio) return
      relogio = setTimeout(() => {
        relogio = null
        if (!faixa.muted || faixa.readyState === "ended") return
        dita = true
        this.deps.aoDiagnosticar("sfu-faixa-sem-pacotes", rotulo)
      }, MotorSfu.FAIXA_MUDA_MS)
    })
    faixa.addEventListener("unmute", () => {
      if (relogio) clearTimeout(relogio)
      relogio = null
      if (!dita) return
      dita = false
      this.deps.aoDiagnosticar("sfu-faixa-com-pacotes", rotulo)
    })
    faixa.addEventListener("ended", () => {
      if (relogio) clearTimeout(relogio)
      relogio = null
    })
  }

  /*
   * The image on the screen of someone watching themselves (2 November of 2026).
   *
   * The log from 1.0.5 said `call-ecra-aceite` and nothing more: the pixelated
   * screen share left no trace. The proven cause was the VP8
   * header encrypted (see `bytesEmClaroDoVp8`); this stays for the next image fault to
   * tell apart without guessing:
   *
   *  - `sfu-ecra-a-ver` · address · new|resumed: started to see;
   *  - `sfu-ecra-primeira-chave` · address · N ms: the first key frame
   *    decoded after that (without it there is no full image);
   *  - `sfu-ecra-sem-chave` · address · N s: none arrived by the end of
   *    `SEM_CHAVE_DO_ECRA_MS`;
   *  - `sfu-ecra-imagem`, from 30 em 30 s: resolution, frame rate, bitrate, and what
   *    changed in key frames, requests (PLI), lost packets, dropped
   *    frames and freezes. An image that breaks up with no PLI is the
   *    portrait of the fault from 2 November.
   *
   * Only numbers from `getStats`, never image or key.
   */

  /** How often the screen receiver is read. */
  static readonly AMOSTRA_DO_ECRA_MS = 500
  /** How long we wait for the first keyframe before reporting it missing. */
  static readonly SEM_CHAVE_DO_ECRA_MS = 5000
  /** How often the image state is written. */
  static readonly RESUMO_DO_ECRA_MS = 30_000

  /** The image watchers, per screen producer. */
  #vigiasDoEcra = new Map<string, ReturnType<typeof setInterval>>()

  #pararVigiaDoEcra(produtorId: string): void {
    const relogio = this.#vigiasDoEcra.get(produtorId)
    if (relogio !== undefined) clearInterval(relogio)
    this.#vigiasDoEcra.delete(produtorId)
  }

  #vigiarImagemDoEcra(produtorId: string, address: UserAddress, como: "novo" | "retomado"): void {
    this.#pararVigiaDoEcra(produtorId)
    this.deps.aoDiagnosticar("sfu-ecra-a-ver", `${address} · ${como}`)
    const entrada = this.#consumidores.get(produtorId)
    const receptor = entrada?.consumidor.rtpReceiver
    if (!entrada || !receptor || typeof receptor.getStats !== "function") return

    const geracao = this.#geracao
    const inicio = Date.now()
    type Amostra = { t: number; chaves: number; bytes: number; pli: number; perdidos: number; largados: number; congelamentos: number }
    const ler = async (): Promise<(Amostra & { largura?: number; altura?: number; fps?: number }) | null> => {
      const relatorio = await receptor.getStats().catch(() => null)
      if (!relatorio) return null
      // `forEach`, not `values()`: this package's `lib.dom` does not give iterators to `RTCStatsReport`.
      const linhas: Record<string, unknown>[] = []
      relatorio.forEach((linha: Record<string, unknown>) => linhas.push(linha))
      for (const linha of linhas) {
        if (linha.type !== "inbound-rtp" || (linha.kind !== undefined && linha.kind !== "video")) continue
        const n = (campo: string): number => (typeof linha[campo] === "number" ? (linha[campo] as number) : 0)
        return {
          t: Date.now(),
          chaves: n("keyFramesDecoded"),
          bytes: n("bytesReceived"),
          pli: n("pliCount"),
          perdidos: n("packetsLost"),
          largados: n("framesDropped"),
          congelamentos: n("freezeCount"),
          largura: n("frameWidth"),
          altura: n("frameHeight"),
          fps: n("framesPerSecond"),
        }
      }
      return null
    }

    // The baseline: the counters are from the whole receiver, and a resumed screen
    // already brings the keyframes from before the pause.
    let base: Amostra | null = null
    let resumo: Amostra | null = null
    let primeiraDita = false
    let semChaveDita = false
    let ocupado = false
    const relogio = setInterval(() => {
      const actual = this.#consumidores.get(produtorId)
      if (geracao !== this.#geracao || !actual || actual.pausado || actual.consumidor !== entrada.consumidor) {
        this.#pararVigiaDoEcra(produtorId)
        return
      }
      if (ocupado) return
      ocupado = true
      void ler()
        .then((amostra) => {
          if (!amostra || this.#vigiasDoEcra.get(produtorId) !== relogio) return
          base ??= como === "novo" ? { ...amostra, chaves: 0 } : amostra
          resumo ??= base
          if (!primeiraDita && amostra.chaves > base.chaves) {
            primeiraDita = true
            this.deps.aoDiagnosticar("sfu-ecra-primeira-chave", `${address} · ${amostra.t - inicio} ms`)
          } else if (!primeiraDita && !semChaveDita && amostra.t - inicio >= MotorSfu.SEM_CHAVE_DO_ECRA_MS) {
            semChaveDita = true
            this.deps.aoDiagnosticar("sfu-ecra-sem-chave", `${address} · ${Math.round((amostra.t - inicio) / 1000)} s`)
          }
          if (amostra.t - resumo.t >= MotorSfu.RESUMO_DO_ECRA_MS) {
            const segundos = (amostra.t - resumo.t) / 1000
            this.deps.aoDiagnosticar(
              "sfu-ecra-imagem",
              `${address} · ${amostra.largura}x${amostra.altura} · ${amostra.fps} fps · ` +
                `${Math.round(((amostra.bytes - resumo.bytes) * 8) / segundos / 1000)} kbps · ` +
                `chaves +${amostra.chaves - resumo.chaves} · pli +${amostra.pli - resumo.pli} · ` +
                `perdidos +${amostra.perdidos - resumo.perdidos} · largados +${amostra.largados - resumo.largados} · ` +
                `congelamentos +${amostra.congelamentos - resumo.congelamentos}`,
            )
            resumo = amostra
          }
        })
        .finally(() => {
          ocupado = false
        })
    }, MotorSfu.AMOSTRA_DO_ECRA_MS)
    this.#vigiasDoEcra.set(produtorId, relogio)
  }

  // ------------------------------------------ the keyframe on demand (M2)

  /**
   * How often the receiver for each image is read, for the request.
   *
   * Half a second, the screen watcher's rhythm: broken image comes back in under
   * a second, and one `getStats` per image every 500 ms is not heavy. The REQUESTS
   * have a different rhythm, with a cap: see `VigiaDoFotogramaChave`.
   */
  static readonly AMOSTRA_DO_FOTOGRAMA_MS = 500

  /** Per consumed video producer: the sample clock and the watcher that decides. */
  #vigiasDoFotograma = new Map<string, { relogio: ReturnType<typeof setInterval>; vigia: VigiaDoFotogramaChave }>()

  #pararVigiaDoFotograma(produtorId: string): void {
    const vigia = this.#vigiasDoFotograma.get(produtorId)
    if (vigia) clearInterval(vigia.relogio)
    this.#vigiasDoFotograma.delete(produtorId)
  }

  /** Request now, if the watcher allows. A paused consumer, from another call, or with no one asking, does not request. */
  #pedirFotogramaChave(produtorId: string, motivo: MotivoDoPedido | null): void {
    if (!motivo) return
    const entrada = this.#consumidores.get(produtorId)
    const recepcao = this.#recepcao
    const pedir = this.deps.sinalizacao.sfuPedirFotogramaChave
    if (!entrada || entrada.pausado || !recepcao || !pedir) return
    pedir.call(this.deps.sinalizacao, recepcao.id, entrada.consumidor.id)
    this.deps.aoDiagnosticar("sfu-fotograma-chave-pedido", `${entrada.address} · ${entrada.fonte} · ${motivo}`)
  }

  #vigiarFotogramaChave(produtorId: string): void {
    this.#pararVigiaDoFotograma(produtorId)
    const entrada = this.#consumidores.get(produtorId)
    const receptor = entrada?.consumidor.rtpReceiver
    if (!entrada || !receptor || typeof receptor.getStats !== "function" || !this.deps.sinalizacao.sfuPedirFotogramaChave) return

    const geracao = this.#geracao
    const vigia = new VigiaDoFotogramaChave()
    let ocupado = false
    const relogio = setInterval(() => {
      const actual = this.#consumidores.get(produtorId)
      if (geracao !== this.#geracao || !actual || actual.pausado || actual.consumidor !== entrada.consumidor) {
        this.#pararVigiaDoFotograma(produtorId)
        return
      }
      if (ocupado) return
      ocupado = true
      void receptor
        .getStats()
        .then((relatorio) => {
          if (this.#vigiasDoFotograma.get(produtorId)?.relogio !== relogio) return
          // `forEach`, not `values()`: this package's `lib.dom` does not give iterators to `RTCStatsReport`.
          const linhas: Record<string, unknown>[] = []
          relatorio.forEach((linha: Record<string, unknown>) => linhas.push(linha))
          const linha = linhas.find((l) => l.type === "inbound-rtp" && (l.kind === undefined || l.kind === "video"))
          if (!linha) return
          const n = (campo: string): number | undefined => (typeof linha[campo] === "number" ? (linha[campo] as number) : undefined)
          const amostra: AmostraDoReceptor = {}
          if (n("freezeCount") !== undefined) amostra.congelamentos = n("freezeCount")!
          if (n("frameDecodeErrors") !== undefined) amostra.errosDeDescodificacao = n("frameDecodeErrors")!
          if (n("pliCount") !== undefined) amostra.pli = n("pliCount")!
          if (n("keyFramesDecoded") !== undefined) amostra.chaves = n("keyFramesDecoded")!
          this.#pedirFotogramaChave(produtorId, vigia.amostra(amostra, Date.now()))
        })
        .catch(() => {
          // A receiver that closed between the tick and the read: the next tick stops the clock.
        })
        .finally(() => {
          ocupado = false
        })
    }, MotorSfu.AMOSTRA_DO_FOTOGRAMA_MS)
    this.#vigiasDoFotograma.set(produtorId, { relogio, vigia })
  }

  /** Video decryption for this person came back: each of their images being watched requests. */
  #videoVoltou(address: UserAddress): void {
    for (const [produtorId, entrada] of this.#consumidores) {
      if (entrada.address !== address || entrada.pausado || entrada.consumidor.track.kind !== "video") continue
      const vigia = this.#vigiasDoFotograma.get(produtorId)?.vigia
      if (vigia) this.#pedirFotogramaChave(produtorId, vigia.videoVoltou(Date.now()))
    }
  }

  /** The transports already watched: one listener per transport, not per stream. */
  #transportesVigiados = new WeakSet<object>()

  /**
   * How long the voice send transport has to reach `connected`.
   *
   * A normal entry connects in under a second (measured on localhost and in
   * production from the owner's logs). Eight seconds is very slow network, or
   * a transport that will never connect: the producer exists on the server, the
   * microphone measures here, and no packet leaves (report from 4/11/2026, 14:15).
   */
  static readonly PRAZO_DO_ENVIO_MS = 8_000

  #vigiarLigacaoDoEnvio(dtls: RTCDtlsTransport | null | undefined): void {
    if (!dtls) return
    const geracao = this.#geracao
    const relogio = setTimeout(() => {
      this.#repeticoes.delete(relogio)
      if (geracao !== this.#geracao || dtls.state === "connected") return
      this.deps.aoDiagnosticar(
        "sfu-envio-sem-ligacao",
        `dtls ${dtls.state} · ice ${dtls.iceTransport?.state ?? "?"} · ${MotorSfu.PRAZO_DO_ENVIO_MS} ms`,
      )
      this.deps.aoEnvioParado?.()
    }, MotorSfu.PRAZO_DO_ENVIO_MS)
    this.#repeticoes.add(relogio)
  }

  #vigiarTransporte(dtls: RTCDtlsTransport | null | undefined, sentido: "envio" | "recepcao"): void {
    if (!dtls || typeof dtls.addEventListener !== "function" || this.#transportesVigiados.has(dtls)) return
    this.#transportesVigiados.add(dtls)
    const geracao = this.#geracao
    // Only what deviates from the norm: `connecting` and `connected` are everyday life.
    dtls.addEventListener("statechange", () => {
      if (dtls.state === "failed" || dtls.state === "closed") {
        this.deps.aoDiagnosticar("sfu-transporte-estado", `${sentido} · dtls ${dtls.state}`)
      }
      // A send that fails partway through is our voice stopped: it gets remade. `closed` is
      // our own exit, and the generation has already changed.
      if (sentido === "envio" && dtls.state === "failed" && geracao === this.#geracao) this.deps.aoEnvioParado?.()
    })
    const ice = dtls.iceTransport
    if (ice && typeof ice.addEventListener === "function") {
      let caiu = false
      ice.addEventListener("statechange", () => {
        if (ice.state === "disconnected" || ice.state === "failed") {
          caiu = true
          this.deps.aoDiagnosticar("sfu-transporte-estado", `${sentido} · ice ${ice.state}`)
        } else if (caiu && (ice.state === "connected" || ice.state === "completed")) {
          caiu = false
          this.deps.aoDiagnosticar("sfu-transporte-estado", `${sentido} · ice ${ice.state}`)
          // Receive came back: what failed while it was down tries now.
          if (sentido === "recepcao" && geracao === this.#geracao) {
            this.acordarConsumos("recepcao-voltou")
            void this.ressincronizar("recepcao-voltou")
          }
        }
      })
    }
  }

  /** Who we are listening to, so key rotation knows who to rotate. */
  emissores(): UserAddress[] {
    return [...new Set([...this.#consumidores.values()].map((entrada) => entrada.address))]
  }

  /**
   * Drop everything.
   *
   * Closing the transports closes the producers and consumers under them,    * it's the only call that must happen from the `mediasoup-client` side. The
   * `sfu.scope.leave` is the clean exit; the path where calls actually end
   * is the socket falling, and the server's `#drop` handles that.
   */
  sair(): void {
    const canal = this.#canal
    const ambito = this.#ambito
    // Fresh assembly: one still in progress learns it is no longer relevant, and
    // drops what it built instead of overwriting it here.
    this.#geracao++

    this.#envio?.close()
    this.#recepcao?.close()
    this.#envio = null
    this.#recepcao = null
    this.#dispositivo = null
    this.#consumidores.clear()
    this.#aConsumir.clear()
    // The offers are from this call, like gravestones: the identifiers in the next
    // call are different, and a list that survived would show the screen of
    // someone who is no longer here.
    this.#ofertasDeEcra.clear()
    // And the repetition timers. The generation already silenced them; this is for
    // a call that ended without leaving work marked by it. See `#repeticoes`.
    for (const relogio of this.#repeticoes) clearTimeout(relogio)
    this.#repeticoes.clear()
    this.#emFalta.clear()
    this.#recusadosDeVez.clear()
    this.#pararVigiaDaThread()
    for (const acordar of [...this.#aoSair]) acordar()
    this.#aoSair.clear()
    if (this.#relogioDosReceptores) clearTimeout(this.#relogioDosReceptores)
    this.#relogioDosReceptores = null
    this.#anunciadosCedo.length = 0
    // The screen image watchers too: they belong to this call.
    for (const produtorId of [...this.#vigiasDoEcra.keys()]) this.#pararVigiaDoEcra(produtorId)
    for (const produtorId of [...this.#vigiasDoFotograma.keys()]) this.#pararVigiaDoFotograma(produtorId)
    // The gravestones are from this call: in the next one the identifiers are
    // different, and a set that kept growing forever was a leak by another name.
    this.#mortos.clear()
    // The producers die with the transport that carries them; what remains is our
    // list, and a list that survived the call would say we are sharing the screen
    // in the next call, before it has one.
    this.#produtores.clear()
    this.#somDoEcra = null
    this.#musica = null
    this.#faixaDoMicrofone = null
    // Whoever was waiting for the cipher wakes up, sees the new generation and clears it.
    this.cifraPodeTerMudado()
    this.#fluxosPorPessoa.clear()
    this.#canal = null
    this.#ambito = null
    // Only the channel, never the keys: the sender and receivers survive the call
    // on purpose. A second call in the same MLS epoch reuses the same key, and a
    // new sender would restart the counter at zero, repeating all the nonces the
    // first one already spent.
    this.deps.cifra.canal = null

    if (canal && ambito) this.deps.sinalizacao.sfuSairDoAmbito(canal, ambito)
  }
}

/**
 * The stream for a person where a track from this source goes.
 *
 * The screen and music aside; the microphone and camera together. See
 * `FluxoRecebido`. In one place only because there are two readers (cleanup and
 * removal), and two copies of the same rule diverge at the first new source.
 */
function fluxoDaFonte(
  fluxos: { pessoa: MediaStream; ecra: MediaStream; musica: MediaStream },
  fonte: FonteDoFluxo,
): MediaStream {
  if (fonte === "ecra") return fluxos.ecra
  if (fonte === "musica") return fluxos.musica
  return fluxos.pessoa
}

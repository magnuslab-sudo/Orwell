import { bytesEmClaroDoVp8, importSframeKey, readHeader, SframeReceiver, SframeSender } from "@enclave/crypto"
import type { UserAddress } from "@enclave/protocol"
import type {
  ChaveParaWorker,
  Contagens,
  OpcoesDaTransformacao,
  OrdemDeCifra,
  RespostaDeCifra,
} from "./media-sframe-worker.js"
import { VigiaDaDecifra, type AvisoDaDecifra } from "./vigia-da-decifra.js"

/**
 * Media cipher, above the transport, same for mesh and SFU.
 *
 * This was a private block at the end of `call.ts`, and it came out whole in
 * step 1 of Phase 2 of `docs/PLANO_SFU.md`. It came out for a precise reason:
 * with two call engines side by side, the alternative was to duplicate the
 * encryption, and a second copy of key derivation, counter reserve, and the
 * double-key window is a second copy to diverge from. What changes between the
 * two engines is the OBJECT the transformation hangs onto (the `RTCRtpSender`
 * of a peer connection, or the one from `mediasoup-client`); the encryption
 * doesn't change a line, and that's what this file makes literal.
 *
 * **What the SFU changes here, and only this:** the list of who receivers are
 * kept for. In mesh, who walks that list is the peer-connection map; with SFU
 * there's one link to the server, and several streams coming through it, the
 * list becomes the encrypted roster that `voice.join`/`voice.leave` already
 * maintain. That's why `rodar()` gets the list from outside instead of
 * fetching it: the engine knows who's in the call, and this object doesn't
 * have, and shouldn't have, an opinion on that.
 *
 * The key comes from the MLS exporter of the channel's epoch, and the SFU never
 * knew what an epoch is.
 */

/** The material of a media key, as the session delivers it. */
export interface MaterialDeChave {
  keyId: number
  senderId: number
  material: Uint8Array
}

/**
 * What encryption needs from the world, a narrow slice of `CallBridge`.
 *
 * Narrow on purpose: an encryption that received the full bridge would gain
 * access to the microphone, signaling, and the Electron gate, and none of that
 * is its business. What it needs to know is where the key comes from and where
 * the counter starts.
 */
export interface FonteDeChaves {
  /** Our address, to tell our key apart from others. */
  readonly selfAddress: UserAddress
  /**
   * A person's key in the current epoch. `device` picks the device: it is the
   * `senderId` the frame declares. Without it, our sheet (for us) or the
   * person's first one. See `Session.mediaKey`.
   */
  mediaKey(channel: string, address: UserAddress, folha?: number): Promise<MaterialDeChave | null>
  reservarContadorSframe(channel: string, keyId: number): Promise<number>
  /**
   * How to build a worker for encryption, when the host knows how.
   *
   * **Comes from HOST, not from here, for the same reason `mediasoup-client`
   * comes.** A worker is born from a file the bundler must know, `vite` on
   * web, the renderer bundler on Electron, and this package compiles to `dist`
   * with no bundler. A `new Worker(new URL(...))` written here would resolve
   * against `dist` of `client-core` and not against the application bundle: at
   * best it does not bundle, at worst it bundles a second copy of encryption.
   *
   * Optional because not every host has one, and a host without a worker can
   * still encrypt by insertable streams. Anyone with NEITHER keeps out of SFU
   *, see `cifraDeMediaEmFalta`.
   */
  criarWorkerDeCifra?(): Worker
}

/**
 * An order not yet written, without the number that identifies it, `#ordenar` puts it.
 *
 * Distributes over the union, and normal `Omit` does not: `Omit<A | B, "eco">`
 * ends up with keys COMMON to `A` and `B` and throws out the rest, which here
 * would erase the key, address, and chain. The compiler said it in hard-to-read
 * form ("'chave' does not exist"), and the temptation was to answer with an `as`.
 */
type OrdemSemEco = OrdemDeCifra extends infer Cada ? (Cada extends OrdemDeCifra ? Omit<Cada, "eco"> : never) : never

/** Shapes for the non-standard insertable-streams API. */
interface EncodedFrame {
  data: ArrayBuffer
  /** Only on video frames (`RTCEncodedVideoFrame`). Audio does not have it. */
  type?: string
}

/**
 * How many bytes from the front of this frame go unencrypted.
 *
 * Video frames carry the VP8 header unencrypted (see `bytesEmClaroDoVp8` in
 * `@enclave/crypto`): without it, the SFU and Chrome read the SFrame header as
 * if it were VP8 and misread keyframes, which was the pixelated screen share of
 * November 2, 2026. The router only negotiates VP8 (see
 * `apps/server/src/media.ts`), so a video frame is VP8.
 *
 * Video is distinguished from audio by the PRESENCE of `type`, which only
 * `RTCEncodedVideoFrame` has, in all three engines. Audio stays in the old
 * format, which a 1.0.5 client can still open.
 */
export function bytesEmClaroDoFrame(frame: { type?: string }, bytes: Uint8Array): number {
  return "type" in frame ? bytesEmClaroDoVp8(bytes) : 0
}

/**
 * The largest audio frame that is only a silence marker (DTX), in bytes.
 *
 * With DTX, Opus delivers a 0 to 2 byte frame every 20 ms during silence:
 * just the TOC byte, no audio (the Opus decoder treats a frame of 1 byte or
 * less as "lost" and does PLC/comfort). Without encryption, the browser's RTP
 * sender recognizes them and does not send them; with encryption each one gets
 * a header and tag (27 bytes) and goes on the wire. Measured on 2 November 2026
 * with `scripts/e2e-limiar-microfone.mjs`: in silence, 47.5 of 50 frames per
 * second had 2 bytes or less, and 50 packets per second went out with 28.6 bytes
 * of payload each. The other 2.5 per second are the comfort frame that Opus
 * refreshes every 400 ms, and those have audio (background noise) and proceed.
 */
export const MAIOR_QUADRO_DE_SILENCIO = 2

/**
 * Is this frame a silence marker that does not get encrypted or sent?
 *
 * Audio only: a video frame (with `type`) never gets dropped here, no matter
 * how small. **Nothing changes at the receiver**: it still refuses every frame
 * that does not open. What changes is the sender not putting on the wire a
 * frame that has no audio, which is what the browser does without encryption.
 * RTP sequence numbers are assigned after this transformation, so the receiver
 * sees no gaps: it sees the time jump from any DTX and does comfort.
 */
export function quadroDeSilencio(frame: { type?: string }, bytes: Uint8Array): boolean {
  return !("type" in frame) && bytes.byteLength <= MAIOR_QUADRO_DE_SILENCIO
}

interface TransformStreamPair {
  readable: ReadableStream<EncodedFrame>
  writable: WritableStream<EncodedFrame>
}

/** A media endpoint where encryption hangs, if this engine knows how to open it. */
type PontaDeMedia = { createEncodedStreams?: () => TransformStreamPair }

/**
 * How this engine knows to encrypt media. `none` is what closes the SFU gate.
 *
 *  - `insertable`, `createEncodedStreams`, from Chromium. Not standard,
 *    delivers streams to the main thread, and is the path in production since
 *    Phase 2.
 *  - `worker`, `RTCRtpScriptTransform`, which is the standard and exists in
 *    ALL THREE engines. The transformation runs on another thread, so it needs
 *    a worker that the host knows how to create.
 */
export type CaminhoDaCifra = "insertable" | "worker" | "nenhum"

/*
 * Read from the prototype, not from an instance: it is the question you can ask
 * without a call set up, which is exactly the point, decide BEFORE. The
 * `createEncodedStreams` is not in `lib.dom` because it is not in the standard,
 * so the type has to be stated here by hand. It was one of these `as` casts,
 * written as if the method always existed, that let the bug of 17 August pass.
 */
const temInsertable = (classe: unknown): boolean =>
  typeof (classe as { prototype?: PontaDeMedia } | undefined)?.prototype?.createEncodedStreams === "function"

/**
 * The property where the standard transformation hangs.
 *
 * You ask for the PROPERTY, not just the constructor. `RTCRtpScriptTransform`
 * existing says you can build the transformation; it does not say there is a
 * place to put it, and those are two different things. Measured on all three
 * engines on 18 August: on all three it is a setter on both prototypes
 * (`scripts/sfu-script-transform-por-motor.mjs`).
 */
const temTransform = (classe: unknown): boolean =>
  typeof classe !== "undefined" && "transform" in ((classe as { prototype: object }).prototype ?? {})

/**
 * Which of the two paths works for this engine, decided without a call set up.
 *
 * **Chromium has BOTH, and you pick `insertable`.** This is not aesthetic
 * preference: it is the path that Phase 2 and Phase 3 measured in production,
 * frame by frame, and swapping it for another on an engine that already works
 * is to risk the only platform that enters by SFU today to solve the problem on
 * two others. The `worker` comes in where there is no alternative, which is
 * precisely where there is nothing to lose.
 *
 * **One function, two readers, and that is the property that matters.** The
 * guard (`cifraDeMediaEmFalta`) and `CifraDeMedia` both call THIS. If they were
 * two separate decisions they could disagree, and how that disagreement fails is
 * the bug of 17 August all over again: the gate says it knows how to encrypt,
 * setup discovers halfway that it does not, and the call flickers.
 */
export function caminhoDaCifra(criarWorkerDeCifra?: (() => Worker) | undefined): CaminhoDaCifra {
  if (temInsertable(typeof RTCRtpSender === "undefined" ? undefined : RTCRtpSender) &&
      temInsertable(typeof RTCRtpReceiver === "undefined" ? undefined : RTCRtpReceiver)) {
    return "insertable"
  }
  if (
    typeof RTCRtpScriptTransform !== "undefined" &&
    temTransform(typeof RTCRtpSender === "undefined" ? undefined : RTCRtpSender) &&
    temTransform(typeof RTCRtpReceiver === "undefined" ? undefined : RTCRtpReceiver) &&
    typeof criarWorkerDeCifra === "function"
  ) {
    return "worker"
  }
  return "nenhum"
}

/**
 * What this engine is missing to encrypt media, or `null` when nothing is
 * missing.
 *
 * **You ask about BOTH sides, not one.** `mediaIsE2EE()` looks only at the
 * `RTCRtpSender`, which is what the mesh needs to announce; here encryption
 * installs on both sender and receiver, and missing on one side gives a call
 * where you speak protected and hear noise, worse than no encryption at all,
 * because it looks like a failure.
 *
 * **Measured, not read.** On 17 August 2026 with `scripts/sfu-cifra-por-motor.mjs`;
 * on 18 with `scripts/sfu-script-transform-por-motor.mjs`, which counts OPEN
 * frames on the other side and brings a swapped key as a control:
 *
 * | engine | `createEncodedStreams` | `RTCRtpScriptTransform` (voice) |
 * |---|---|---|
 * | Chromium 151 | on both prototypes | 300 encrypted → 300 open |
 * | Firefox 153 | does not exist | 299 encrypted → 299 open |
 * | WebKit 26.5 (Safari) | does not exist | 303 encrypted → 303 open |
 *
 * So the answer stopped being a question and became two: **one of the two paths
 * is enough**. An engine without insertable streams that has `RTCRtpScriptTransform`
 * AND a host that knows how to create the worker can encrypt, and enters by SFU
 * like any other.
 *
 * Asked at every entry and never stored in a module. Not because the engine
 * changes mid-call, it is that a value read at the instant the file loads
 * cannot be exercised in a test without dynamic imports, and a guard that
 * cannot be measured is a guard you do not know exists.
 */
export function cifraDeMediaEmFalta(criarWorkerDeCifra?: (() => Worker) | undefined): string | null {
  if (caminhoDaCifra(criarWorkerDeCifra) !== "nenhum") return null

  const emFalta: string[] = []
  if (typeof RTCRtpSender === "undefined" || !temInsertable(RTCRtpSender)) emFalta.push("RTCRtpSender")
  if (typeof RTCRtpReceiver === "undefined" || !temInsertable(RTCRtpReceiver)) emFalta.push("RTCRtpReceiver")

  /*
   * The two gaps have different names because they call for different fixes.
   * An engine without `RTCRtpScriptTransform` is an old engine and there is
   * nothing to do; an engine that has it and does not enter is THIS code badly
   * wired, the host did not pass `criarWorkerDeCifra`, and that distinction
   * is the difference between shrugging and going to fix it.
   */
  const porqueNaoOWorker =
    typeof RTCRtpScriptTransform === "undefined"
      ? "sem RTCRtpScriptTransform"
      : typeof criarWorkerDeCifra !== "function"
        ? "há RTCRtpScriptTransform, mas o host não sabe criar o worker da cifra"
        : "o RTCRtpScriptTransform não tem onde se pendurar"

  return `sem createEncodedStreams: ${emFalta.join(", ")}; ${porqueNaoOWorker}`
}

/** Two media keys are the same key when the material is the same. */
export function mesmoMaterial(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export class CifraDeMedia {
  /**
   * The channel whose key is in use, or nothing outside a call.
   *
   * Written by the engine on entry and cleared on exit. It is what tells apart
   * "no key" from "no call", and both lead to the same silence with opposite
   * causes.
   */
  canal: string | null = null

  /**
   * The sender in use, with the material it came from.
   *
   * Identified by MATERIAL, not by `keyId`. `keyId` is the epoch truncated to
   * 16 bits and each channel has its own MLS group: two channels in the same
   * epoch give the same number with completely different keys, and reusing the
   * sender between them would put on the air frames encrypted with the previous
   * channel's key, received, failed on the tag, thrown away, call silent with
   * no error anywhere. Comparing material gets it right both ways: same key
   * reuses the counter, which is what stops repeating a nonce; different key
   * starts fresh, which is what stops encrypting with the wrong key.
   */
  #sframeSender: { chave: ChaveParaWorker; sender: SframeSender; inicio: number } | null = null

  /**
   * Per sender, the key in use and the previous one.
   *
   * Two, not one, because rotation is not simultaneous on both sides, each
   * applies the commit when it receives it. Keeping only the new key would cut
   * audio during that gap: frames already in flight would fail the `keyId`
   * check and be thrown away in silence, with both faces on screen and the call
   * saying it is connected.
   */
  #sframeReceivers = new Map<UserAddress, { chave: ChaveParaWorker; receiver: SframeReceiver }[]>()

  /**
   * Senders to whom encryption has already been applied.
   *
   * `createEncodedStreams()` delivers a sender's streams ONCE; the second time
   * Chromium throws `InvalidStateError`. Swapping a transceiver's track with
   * `replaceTrack` keeps the same sender and brings it back here, and without
   * this mark the exception would bubble up mid-call setup, what you would see
   * is a person who simply does not enter.
   *
   * A `WeakSet`, not a `Set`: the key is the sender itself, which dies with its
   * connection, and nothing here can keep it alive.
   */
  #protegidos = new WeakSet<RTCRtpSender>()

  /**
   * Decryption failures per sender, from the main thread side.
   *
   * With `worker`, the counter is the worker, with its own guard, and alerts
   * come by message to `#aoAvisoDaDecifra`. Both paths end in the same place.
   */
  #vigia = new VigiaDaDecifra((aviso) => this.#aoAvisoDaDecifra(aviso))

  /**
   * Who listens for video decryption to come back (Phase M2).
   *
   * A person whose video frames failed decryption and opened again: the key came
   * back, but the decoder lost the sequence and the picture stays broken until
   * the next keyframe. The listener (the `MotorSfu`) asks for one via
   * `sfu.keyframe`. Once per stop, not per frame.
   */
  aoVoltarOVideo: ((address: UserAddress) => void) | null = null

  /** Who has video frames failing decryption right now. See `aoVoltarOVideo`. */
  #videoPerdido = new Set<UserAddress>()

  #videoAbriu(address: UserAddress): void {
    if (this.#videoPerdido.delete(address)) this.aoVoltarOVideo?.(address)
  }

  /** Who has a key request in flight (person and leaf), so there is not two for the same sender. */
  #aRecuperar = new Set<string>()

  /** The gaps already said in the log, per person and `keyId`: one line per gap. */
  #faltasDitas = new Set<string>()

  constructor(
    private readonly fonte: FonteDeChaves,
    /** Local recording mechanics. Never keys, never anything decrypted. */
    private readonly aoDiagnosticar: (code: string, detail?: string) => void = () => {},
  ) {}

  /**
   * The sender of the key in use, built on first use and reused after.
   *
   * @returns `undefined` when there is no key, and in that case nothing gets
   * encrypted, which is a call without media encryption that the interface has
   * to say, never a call with clear frames passing as encrypted.
   */
  async emissor(): Promise<SframeSender | undefined> {
    return this.#emFila(async () => {
      const canal = this.canal
      if (!canal) return undefined
      const material = await this.fonte.mediaKey(canal, this.fonte.selfAddress)
      if (!material) return undefined

      const actual = this.#sframeSender
      if (actual && mesmoMaterial(actual.chave.material, material.material)) return actual.sender

      /**
       * The counter does not start at zero: it starts where the reserve says.
       *
       * This object is new at each app start, and the key is not: it derives from
       * the channel's epoch and our leaf index, both of which survive closing the
       * window. Zero at the start repeated all nonces from the previous call, in
       * AES-GCM that reveals the XOR of the two texts and lets you forge
       * authenticated frames.
       *
       * And it was also the silence you saw: `SframeReceiver` refuses counters
       * way too far back, so anyone who reloaded the app mid-call stayed mute to
       * whoever stayed, with the connection still up.
       *
       * **A failure to reserve does not get fixed with a borrowed counter.** The
       * sender that would exist here belongs, by design, to ANOTHER key, the
       * comparison above returns it intact when the material is the same. Lending
       * it the counter is the bug this block exists to stop, with a different
       * number. No safe counter means no sender: the result is a call protected
       * only by transport, and the interface says so. That is bad, and much less
       * bad than a confidentiality break that nobody sees and cannot be undone.
       */
      let inicio: number
      try {
        inicio = await this.fonte.reservarContadorSframe(canal, material.keyId)
      } catch (erro) {
        this.aoDiagnosticar("sframe-reserva-falhou", String((erro as Error)?.message ?? erro))
        return undefined
      }

      const chave: ChaveParaWorker = {
        keyId: material.keyId,
        senderId: material.senderId,
        material: material.material,
      }
      const sender = new SframeSender(await importSframeKey(material.material, material.keyId, material.senderId), inicio)
      this.#sframeSender = { chave, sender, inicio }

      /*
       * The new key goes to the worker in the SAME step it is born.
       *
       * An epoch rotation is a change in who is on the channel, and on the
       * `worker` side frames never pass through here: without this line, the
       * main thread would rotate the key and the worker would keep encrypting
       * with the old one, whoever was removed from the channel would keep
       * hearing the call, which is exactly what rotation exists to stop.
       * Best-effort on purpose: anyone who NEEDS the key there before wire goes
       * up is `protegerEmissor`, and it checks.
       *
       * **Without waiting for the reply, and that is deliberate.** This runs
       * inside call entry, and `protegerEmissor` next sends the same key and
       * THAT waits. Waiting here too would put two five-second timeouts in
       * series on the path for entry: a silent worker would take ten seconds to
       * give up instead of five, and that is ten seconds with the microphone on
       * and the panel open.
       */
      if (this.#worker) void this.#pousarEmissor()
      return sender
    })
  }

  /**
   * Ensure a receiver for a sender, keeping the previous key alongside.
   *
   * @returns whether this person is still a member of the channel, which is the
   * question `mediaKey` answers with `null`.
   */
  async receptorDe(address: UserAddress, folha?: number): Promise<boolean> {
    return this.#emFila(async () => {
      const canal = this.canal
      if (!canal) return false

      /*
       * One entry per LEAF of the person, not one per person.
       *
       * Two devices of the same account in the same call each encrypt with their
       * leaf's key (see `Session.mediaKey`), and the frame says which one in
       * `senderId`. Without `leaf` you ask for the leaf the person has NOW and
       * rotate every leaf you already know about from them.
       *
       * **The leaf now always enters, and it was the bug of 3 November 2026.**
       * You asked only by leaves already known, and a person re-seated in a
       * channel with gaps in the tree changes leaf (MLS gives the empty one
       * furthest left). The old leaf is not theirs anymore, the session answers
       * `null` for that, and this says "no longer a member" of someone in the
       * tree: their receiver lost encryption and rotation took them out of the
       * channel, at every room entry, until you reloaded the app
       * (`media-sframe.folha-mudou.rede.test.ts`).
       */
      const cadeia = this.#sframeReceivers.get(address) ?? []
      const alvos: (number | undefined)[] =
        folha !== undefined ? [folha] : [undefined, ...new Set(cadeia.map((cada) => cada.chave.senderId))]

      let membro = false
      let nova = cadeia
      for (const alvo of alvos) {
        const material = await (alvo === undefined
          ? this.fonte.mediaKey(canal, address)
          : this.fonte.mediaKey(canal, address, alvo))
        if (!material) continue
        membro = true
        const daFolha = nova.find((cada) => cada.chave.senderId === material.senderId)
        if (daFolha && mesmoMaterial(daFolha.chave.material, material.material)) continue

        const chave: ChaveParaWorker = {
          keyId: material.keyId,
          senderId: material.senderId,
          material: material.material,
        }
        const receiver = new SframeReceiver(await importSframeKey(material.material, material.keyId, material.senderId))
        // The key in use and the previous one, PER LEAF: rotation is not simultaneous
        // on both sides, and in between there are still frames with the old key in flight.
        const porFolha = new Map<number, number>()
        nova = [{ chave, receiver }, ...nova].filter((cada) => {
          const vistas = (porFolha.get(cada.chave.senderId) ?? 0) + 1
          porFolha.set(cada.chave.senderId, vistas)
          return vistas <= 2
        })
      }
      if (nova !== cadeia) {
        this.#sframeReceivers.set(address, nova)
        // The new chain goes to the worker, for the same reason as the sender: with
        // `worker`, it is the one who decrypts, and a rotation that does not get there
        // leaves the person hearing silence from the next commit on. Without waiting, like
        // the sender: whoever needs a guarantee is `protegerReceptor`.
        if (this.#worker) void this.#pousarReceptor(address)
      }
      return membro
    })
  }

  /**
   * What the decryption guard saw, on either path.
   *
   * Only mechanics in the log: address, `keyId` and counts. Never a key, never
   * a decrypted byte. The `keyId` is the epoch truncated to 16 bits and goes in
   * the clear header of each frame; it is nobody's secret.
   */
  #aoAvisoDaDecifra(aviso: AvisoDaDecifra): void {
    if (aviso.t === "pedir-chave") {
      void this.#recuperarChave(aviso.address, aviso.keyId, aviso.senderId)
    } else if (aviso.t === "parada") {
      this.aoDiagnosticar("sframe-decifra-parada", `${aviso.address} · ${aviso.motivo} · ${aviso.falhas} frames`)
    } else {
      this.aoDiagnosticar("sframe-decifra-voltou", `${aviso.address} · ${aviso.falhas} frames perdidos`)
    }
  }

  /**
   * Frames arrived from this person with a `keyId` that their chain does not have.
   *
   * **This is recovery from the bug of 2 November 2026.** Each person's chain
   * only updated at two moments: when their consumer installs and when `rodar`
   * passes through them. An epoch rotation that fell mid-install (the key
   * request already went out with the old epoch and `MotorSfu` has not yet
   * counted it in `emissores()`) left the chain one epoch behind, and nothing
   * touched it again until exit and re-entry. Here you ask the session for the
   * key again, which is exactly what re-entry did.
   *
   * If the session does not yet have the frame's epoch (it is THIS device that
   * is behind), it does not resolve now; you say it once, and the guard asks
   * again while failures keep going.
   */
  async #recuperarChave(address: UserAddress, keyId: number, senderId?: number): Promise<void> {
    // Per sender (person and leaf): two devices of the same account recover in
    // parallel, each with their own key.
    const emissor = `${address}|${senderId ?? "-"}`
    if (this.#aRecuperar.has(emissor)) return
    this.#aRecuperar.add(emissor)
    try {
      const temAChave = (): boolean =>
        this.#sframeReceivers
          .get(address)
          ?.some((entrada) => entrada.chave.keyId === keyId && (senderId === undefined || entrada.chave.senderId === senderId)) ?? false
      // A rotation might have arrived between the frame and here.
      if (temAChave()) return
      await this.receptorDe(address, senderId)
      if (temAChave()) {
        this.aoDiagnosticar("sframe-chave-recuperada", `${address} · keyId ${keyId}`)
        return
      }
      const falta = `${address}|${keyId}`
      if (this.#faltasDitas.has(falta)) return
      this.#faltasDitas.add(falta)
      const nossa = this.#sframeReceivers.get(address)?.[0]?.chave.keyId
      this.aoDiagnosticar("sframe-chave-em-falta", `${address} · keyId ${keyId} · a nossa ${nossa ?? "nenhuma"}`)
    } catch (erro) {
      this.aoDiagnosticar("sframe-chave-em-falta", `${address} · keyId ${keyId} · ${String((erro as Error)?.message ?? erro)}`)
    } finally {
      this.#aRecuperar.delete(emissor)
    }
  }

  /**
   * The epoch changed: rotate our key and every person's on the list.
   *
   * @param roster who is on the call. It comes from outside because the engine
   * knows who it is, on the mesh it is the connection map, with SFU it is the
   * encrypted roster.
   * @returns who lost their key, meaning who is no longer a channel member.
   *
   * With no key of our own, nothing is concluded about anyone: a channel this
   * device has not yet set up returns `null` for everyone, and throwing the
   * call away because of that is worse than the failure. So the list from
   * outside comes empty in that case, not full.
   */
  async rodar(roster: Iterable<UserAddress>): Promise<UserAddress[]> {
    if (!(await this.emissor())) return []

    /*
     * The roster AND every person we keep a key for (SEC-03, external audit at
     * 1.1.0). Anyone who left the roster (presence expired, roster was pruned)
     * but whose chain stayed here kept valid keys forever, because you only
     * rotated whoever came on the list.
     */
    const fora: UserAddress[] = []
    for (const address of new Set([...roster, ...this.#sframeReceivers.keys()])) {
      if (await this.receptorDe(address)) continue
      fora.push(address)
      /*
       * No leaves in the current tree, and we have keys (so the group is set up):
       * this is a confirmed removal, and all its keys are forgotten in both
       * decipherers. Until now the chain stayed, and both decipherers accepted any
       * cached key that matched `keyId` and `senderId`: frames it kept enciphering
       * with the old key would open.
       *
       * Anyone who CHANGED leaves doesn't reach here: `receptorDe` asks for the
       * current leaf, and it has one (the fix from 3/11/2026). The two-key window,
       * old and new, is only for those who stay in the tree.
       */
      await this.esquecer(address)
    }
    return fora
  }

  /**
   * Forget all receive keys for this person in both decipherers.
   *
   * The local map and the worker in the same operation, with the worker's ACK:
   * when this returns, no frame from this person opens in any thread. In the key
   * queue, don't restore the chain over a `receptorDe` in flight.
   *
   * @returns `false` if the worker didn't confirm. The local map is already
   * clean, and the caller cuts the flow anyway (see `MotorSfu.revogar`).
   */
  async esquecer(address: UserAddress): Promise<boolean> {
    return this.#emFila(async () => {
      const tinha = this.#sframeReceivers.delete(address)
      this.#videoPerdido.delete(address)
      if (!this.#worker || !tinha) return true
      const confirmado = await this.#ordenar({ t: "esquecer", address })
      if (!confirmado) this.aoDiagnosticar("sframe-esquecer-sem-ack", address)
      return confirmado
    })
  }

  /**
   * Attach encipherment to a media sender.
   *
   * Two halves in sequence: `prepararEmissor` (the async part) and
   * `pendurarNoEmissor` (the sync part). The mesh uses this because there the
   * sender is born before there's a negotiated connection. The SFU calls both
   * halves separately so the second fits in `onRtpSender` (see
   * `MotorSfu.#produzir`).
   *
   * @returns whether it got protected. `false` when there's no key, and the
   * engine must tell the UI instead of hiding it.
   */
  async protegerEmissor(sender: RTCRtpSender): Promise<boolean> {
    if (this.#protegidos.has(sender)) return true
    if (!(await this.prepararEmissor())) return false
    return this.pendurarNoEmissor(sender)
  }

  /**
   * Everything the sender needs BEFORE there is a sender: key, counter and,
   * via the worker path, the installed key on the other side with ACK.
   *
   * **This is the half that can wait, and waits before `produce`** (SEC-02,
   * external audit of 1.1.0). Until 1.2.0 encipherment hung AFTER the producer
   * existed: between `produce()` and the transform, plaintext packets could fit,
   * and a failure here (no key, silent worker) left the producer active and
   * without SFrame. Done first, a failure means the producer never born.
   *
   * The worker is born BEFORE the key: `emissor()` pushes the key to the worker
   * if it exists, creating it later left the first key with no one to receive it.
   */
  async prepararEmissor(): Promise<boolean> {
    const porWorker = this.#oCaminho() === "worker"
    const worker = porWorker ? this.#garantirWorker() : null
    if (porWorker && !worker) return false
    if (!(await this.emissor())) return false
    /*
     * Wait for the ACK before any frame can reach the transform: when the first
     * arrives, the key is already installed on the other side of the boundary.
     * This closes point 5 of section 11 of the plan.
     */
    if (worker && !(await this.#pousarEmissor())) return false
    return true
  }

  /**
   * Attach the transform to a sender, SYNCHRONOUSLY, with the key already
   * prepared.
   *
   * Synchronous on purpose: this is what fits in `onRtpSender` of
   * `mediasoup-client`, which hands the sender right after `addTransceiver`,
   * before the offer, DTLS, and the server producer. Hung there, no packet
   * escapes it.
   *
   * @returns whether it got protected. Without `prepararEmissor` first, the
   * worker path has no worker and returns `false`; the insertable streams path
   * hangs anyway, but doesn't encipher anything until there's a key (throws
   * frames away).
   */
  pendurarNoEmissor(sender: RTCRtpSender): boolean {
    if (this.#protegidos.has(sender)) return true

    if (this.#oCaminho() === "worker") {
      const worker = this.#worker
      if (!worker) return false
      if (!this.#pendurar(sender, { papel: "emissor" }, worker, "emissor")) return false
      this.#protegidos.add(sender)
      return true
    }

    const streams = this.#abrirFluxos(sender, "emissor")
    // Nothing got protected, and the flag would lie: anyone trying again has to be
    // able to try for real.
    if (!streams) return false
    this.#protegidos.add(sender)

    void streams.readable
      .pipeThrough(
        new TransformStream({
          // The sender is read each frame, not fixed here. Fixing it would tie this
          // connection to the key from the moment it was born, and an epoch rotation
          //, which is a change of who is in the channel, would not change a single
          // byte of what goes out. See `rodar`.
          transform: async (frame: EncodedFrame, controller) => {
            const sframe = this.#sframeSender?.sender
            // No key means nothing gets sent. A plaintext frame deciphers to noise on the
            // other side, and noise is indistinguishable from failure for whoever listens.
            if (!sframe) return
            const bytes = new Uint8Array(frame.data) as Uint8Array<ArrayBuffer>
            // DTX: the silence marker doesn't go out (see `quadroDeSilencio`).
            if (quadroDeSilencio(frame, bytes)) return
            frame.data = (await sframe.encrypt(bytes, bytesEmClaroDoFrame(frame, bytes))).buffer
            controller.enqueue(frame)
          },
        }),
      )
      .pipeTo(streams.writable)
      .catch(() => {
        // The pipeline ends when the sender is closed. Not an error.
      })

    return true
  }

  /**
   * This person's chain restored and confirmed by the worker for a receiver
   * that ALREADY has the decipher hung (a revoked consumption, see
   * `MotorSfu.revogar`).
   *
   * Both transforms read the chain each frame, so just restoring it is enough.
   * The ACK ensures the worker has it before the server resumes.
   */
  async receptorPronto(address: UserAddress): Promise<boolean> {
    if (!(await this.receptorDe(address))) return false
    if (this.#oCaminho() === "worker") return this.#pousarReceptor(address)
    return true
  }

  /** Attach the decipher to a receiver, picking the key per frame. */
  async protegerReceptor(receiver: RTCRtpReceiver, address: UserAddress): Promise<boolean> {
    const porWorker = this.#oCaminho() === "worker"
    const worker = porWorker ? this.#garantirWorker() : null
    if (porWorker && !worker) return false

    if (!(await this.receptorDe(address))) return false

    if (worker) {
      if (!(await this.#pousarReceptor(address))) return false
      return this.#pendurar(receiver, { papel: "receptor", address }, worker, "receptor")
    }

    const streams = this.#abrirFluxos(receiver, "receptor")
    if (!streams) return false

    void streams.readable
      .pipeThrough(
        new TransformStream({
          transform: async (frame: EncodedFrame, controller) => {
            const bytes = new Uint8Array(frame.data) as Uint8Array<ArrayBuffer>
            // The receiver is picked by the `keyId` that the frame itself declares, not by
            // the key in use now. Both sides rotate when each receives the commit, never at
            // the same instant, and in between there are always frames from the old key
            // still in flight.
            const cabecalho = readHeader(bytes)
            // And by the LEAF it declares: two devices of the same person have different
            // keys (see `receptorDe`).
            const sframe = cabecalho
              ? this.#sframeReceivers
                  .get(address)
                  ?.find((entrada) => entrada.chave.keyId === cabecalho.keyId && entrada.chave.senderId === cabecalho.senderId)
                  ?.receiver
              : undefined
            const plain = await sframe?.decrypt(bytes)
            // A frame that fails to decrypt is dropped, not passed through. A
            // decoder fed ciphertext produces noise, and noise the user hears is
            // indistinguishable to them from a working call.
            if (!plain) {
              // Thrown away, but COUNTED: that's what gives a path back to a chain without
              // the key in use. See `vigia-da-decifra.ts`.
              if (!cabecalho) this.#vigia.falhou(address, "sem-cabecalho")
              else if (!sframe) this.#vigia.falhou(address, "sem-chave", cabecalho.keyId, cabecalho.senderId)
              else this.#vigia.falhou(address, "recusado", cabecalho.keyId, cabecalho.senderId)
              if ("type" in frame) this.#videoPerdido.add(address)
              return
            }
            this.#vigia.abriu(address, cabecalho?.senderId)
            if ("type" in frame) this.#videoAbriu(address)
            frame.data = plain.buffer
            controller.enqueue(frame)
          },
        }),
      )
      .pipeTo(streams.writable)
      .catch(() => {
        // Receiver closed.
      })

    return true
  }

  /**
   * The encoded streams from one endpoint, or `null` with the reason written.
   *
   * **This method exists because a call to a method that might not exist was
   * written as if it always did.** It was an `as unknown as` declaring
   * `createEncodedStreams(): TransformStreamPair` on an object that half the
   * engines don't have, the compiler believed it, and what the person saw was
   * `createEncodedStreams is not a function` climbing up inside the call entry
   * and unwinding it halfway. This was the production bug of 17 August 2026
   * with the SFU connected.
   *
   * The two failures are different and get different names because they answer
   * different questions for whoever reads the log:
   *
   *  - **doesn't exist**, the engine has no insertable streams (Firefox,
   *    Safari). With a guard at the entry this should never reach here; if it
   *    does, the guard is broken, and the log has to say so.
   *  - **threw**, exists and refused. `InvalidStateError` is what Chromium
   *    throws when the `RTCPeerConnection` wasn't built with
   *    `encodedInsertableStreams`, or when the streams for this sender have
   *    already been requested once. That's another failure, in another place,
   *    and mixing them up cost the whole hunt.
   *
   * In neither case does this throw: the caller decides what to do with a
   * `false`, and none of the paths that call this can break in the middle.
   */
  #abrirFluxos(ponta: RTCRtpSender | RTCRtpReceiver, qual: "emissor" | "receptor"): TransformStreamPair | null {
    const abrir = (ponta as unknown as PontaDeMedia).createEncodedStreams
    if (typeof abrir !== "function") {
      this.aoDiagnosticar("sframe-sem-insertable-streams", qual)
      return null
    }
    try {
      return abrir.call(ponta)
    } catch (erro) {
      this.aoDiagnosticar("sframe-cifra-recusada", `${qual}: ${String((erro as Error)?.message ?? erro)}`)
      return null
    }
  }

  // ------------------------------------------------------- the worker path

  /**
   * Where this encipherment works, decided ONCE.
   *
   * Once, not each call, for a security reason not a cost reason: `insertable`
   * enciphers in the main thread and `worker` enciphers in the other, both with
   * the SAME key and the SAME reserved counter. Switching between them halfway
   * through a call put two senders spending the same nonces, which in AES-GCM
   * reveals the XOR of the texts and lets you forge authenticated frames. The
   * engine doesn't change under your feet; neither does the decision.
   */
  #caminho: CaminhoDaCifra | null = null

  #oCaminho(): CaminhoDaCifra {
    this.#caminho ??= caminhoDaCifra(this.fonte.criarWorkerDeCifra?.bind(this.fonte))
    return this.#caminho
  }

  /**
   * The encipherment worker, one per object, created on first need.
   *
   * **It outlives the call, like the rest of this object.** It holds the SFrame
   * sender, and a new sender would restart the counter where the reserve left
   * it, repeating every nonce the last call already spent with the same key.
   * That's the same reason `#sframeSender` doesn't get cleaned in `#leave`.
   */
  #worker: Worker | null = null

  /** Orders waiting for a response, by the number they got. */
  #aEsperaDeEco = new Map<number, (resposta: RespostaDeCifra) => void>()
  #proximoEco = 1

  #garantirWorker(): Worker | null {
    if (this.#worker) return this.#worker
    const criar = this.fonte.criarWorkerDeCifra
    if (!criar) return null
    try {
      const worker = criar.call(this.fonte)
      worker.addEventListener("message", (evento: MessageEvent) => {
        const resposta = evento.data as RespostaDeCifra | undefined
        // The worker watchdog alerts don't respond to any order: they come on their
        // own when it sees frames failing.
        if (resposta?.t === "aviso") {
          this.#aoAvisoDaDecifra(resposta.aviso)
          return
        }
        if (resposta?.t === "video-voltou") {
          this.aoVoltarOVideo?.(resposta.address)
          return
        }
        if (!resposta || typeof resposta.eco !== "number") return
        const aguardar = this.#aEsperaDeEco.get(resposta.eco)
        if (!aguardar) return
        this.#aEsperaDeEco.delete(resposta.eco)
        aguardar(resposta)
      })
      this.#worker = worker
      return worker
    } catch (erro) {
      this.aoDiagnosticar("sframe-worker-nao-nasceu", String((erro as Error)?.message ?? erro))
      return null
    }
  }

  /**
   * Send an order to the worker and wait for it to say it did it.
   *
   * **With a timer, and the timer isn't caution.** This runs inside the call
   * entry: a worker that never responds, a script file that didn't load, an
   * error in its startup, would leave the `join` hanging forever, with the
   * microphone on and the panel open. After the time, what we know is that we
   * can't encipher, and can't encipher answers with `false`, which is a call
   * without SFU, not a call that blinks.
   */
  async #ordenar(ordem: OrdemSemEco, segundos = 5): Promise<boolean> {
    const worker = this.#worker
    if (!worker) return false
    const eco = this.#proximoEco++
    return new Promise<boolean>((resolve) => {
      const cronometro = setTimeout(() => {
        this.#aEsperaDeEco.delete(eco)
        this.aoDiagnosticar("sframe-worker-mudo", `${ordem.t}: sem resposta em ${segundos}s`)
        resolve(false)
      }, segundos * 1000)
      this.#aEsperaDeEco.set(eco, () => {
        clearTimeout(cronometro)
        resolve(true)
      })
      try {
        worker.postMessage({ ...ordem, eco } as OrdemDeCifra)
      } catch (erro) {
        clearTimeout(cronometro)
        this.#aEsperaDeEco.delete(eco)
        this.aoDiagnosticar("sframe-worker-recusou", String((erro as Error)?.message ?? erro))
        resolve(false)
      }
    })
  }

  /** The key in use for the worker. It reuses it if it's the same. */
  async #pousarEmissor(): Promise<boolean> {
    const actual = this.#sframeSender
    if (!actual) return false
    return this.#ordenar({ t: "emissor", chave: actual.chave, contador: actual.inicio })
  }

  /** This person's key chain for the worker, the current one and the previous. */
  async #pousarReceptor(address: UserAddress): Promise<boolean> {
    const cadeia = this.#sframeReceivers.get(address)
    if (!cadeia) return false
    return this.#ordenar({ t: "receptor", address, chaves: cadeia.map((entrada) => entrada.chave) })
  }

  /**
   * Attach the standard transform to an endpoint.
   *
   * Doesn't throw here for the same reason as `#abrirFluxos`: the caller
   * decides what to do with a `false`, and none of the paths that call this
   * can break in the middle of the call setup.
   */
  #pendurar(
    ponta: RTCRtpSender | RTCRtpReceiver,
    opcoes: OpcoesDaTransformacao,
    worker: Worker,
    qual: "emissor" | "receptor",
  ): boolean {
    try {
      ponta.transform = new RTCRtpScriptTransform(worker, opcoes)
      return true
    } catch (erro) {
      this.aoDiagnosticar("sframe-transform-recusada", `${qual}: ${String((erro as Error)?.message ?? erro)}`)
      return false
    }
  }

  /**
   * How many frames the worker enciphered, opened and refused. Only tests and
   * benches look.
   *
   * It exists because with `worker` frames DO NOT go through the main thread:
   * without this, there's no way from here to know if anything managed to open,
   * and a bench that can't count measures impressions.
   */
  async contagensDoWorker(): Promise<Contagens | null> {
    const worker = this.#worker
    if (!worker) return null
    const eco = this.#proximoEco++
    return new Promise<Contagens | null>((resolve) => {
      const cronometro = setTimeout(() => {
        this.#aEsperaDeEco.delete(eco)
        resolve(null)
      }, 5000)
      this.#aEsperaDeEco.set(eco, (resposta) => {
        clearTimeout(cronometro)
        resolve(resposta.t === "contagens" ? resposta.contagens : null)
      })
      worker.postMessage({ t: "contar", eco } as OrdemDeCifra)
    })
  }

  /** Where this encipherment is working. For the log and for tests. */
  get caminho(): CaminhoDaCifra {
    return this.#oCaminho()
  }

  /**
   * Media keys, one derivation at a time.
   *
   * `emissor()` decides whether a sender already exists AFTER waiting for
   * `mediaKey` and `importSframeKey`, and two connections being born at the
   * same time, the normal case of someone joining a call that already has two
   * people, fit entirely in that wait. Both found the field empty, both built a
   * sender, and both started the counter at zero with the SAME key. The SFrame
   * nonce is salt XOR counter: two different frames with the same nonce in
   * AES-GCM reveal the XOR of the plaintexts and give the GHASH subkey, with
   * which you forge authenticated frames.
   *
   * Measured by the construction counter: two, where there can only be one.
   * None of this was visible from outside, the second sender replaced the
   * first and the counter sequence looked sound again.
   *
   * The queue costs nothing: one derivation per key change, not per frame.
   */
  #chaves: Promise<unknown> = Promise.resolve()

  #emFila<T>(tarefa: () => Promise<T>): Promise<T> {
    const corrida = this.#chaves.then(tarefa, tarefa)
    this.#chaves = corrida.then(
      () => {},
      () => {},
    )
    return corrida
  }

  // ------------------------------------------------------------ for tests

  /** How many receivers stay for this person. Only tests look. */
  receptoresDe(address: UserAddress): number {
    return this.#sframeReceivers.get(address)?.length ?? 0
  }
}

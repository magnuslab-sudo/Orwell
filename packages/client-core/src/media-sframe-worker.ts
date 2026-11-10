import { importSframeKey, readHeader, SframeReceiver, SframeSender } from "@enclave/crypto"
import type { UserAddress } from "@enclave/protocol"
import { bytesEmClaroDoFrame, mesmoMaterial, quadroDeSilencio } from "./media-sframe.js"
import { VigiaDaDecifra, type AvisoDaDecifra } from "./vigia-da-decifra.js"

/**
 * Media cipher on the INSIDE of the worker.
 *
 * `RTCRtpScriptTransform` is the standard gate to transform encoded frames,
 * and it's the only one that exists in all three engines, measured on August 18,
 * 2026 with `scripts/sfu-script-transform-por-motor.mjs`, which counts decoded frames
 * on the other side rather than impressions. The `createEncodedStreams` that
 * Chromium has doesn't exist in Firefox or Safari, and without this gate those two
 * engines would be left out of the SFU, meaning no calling at all on a network behind
 * CGNAT, which is the issue that prompted this task.
 *
 * **The difference that drives the design: this runs on another thread.**
 * `createEncodedStreams` delivers the streams to the main thread, where
 * `CifraDeMedia` already has the key in hand. `RTCRtpScriptTransform` delivers them to
 * a Worker, and frames NEVER pass through the main thread. The cipher must
 * live here, and the key must arrive by message.
 *
 * **What crosses the boundary, and what doesn't.** Key material crosses,  * 28 bytes from an epoch and a sender, the same slice that already
 * crosses the bridge to the Electron renderer (see `deriveSframeKeyMaterial`).
 * Nothing from MLS crosses: not group state, not channel secrets, not
 * who's in it. The policy, where the key comes from, when it rotates, who is still
 * a member, where the counter starts, stays entirely in `CifraDeMedia`, on the
 * main thread. This file is the arm, not the head.
 *
 * **The rule this file cannot break: no key means nothing goes out.** A
 * cleartext frame decrypts to noise on the other side, and noise looks like
 * a fault to whoever listens. It's the same rule as the main thread, written
 * twice because there are two places where a frame can escape.
 */

/** An encoded frame, as both ends deliver it. */
interface FrameCodificado {
  data: ArrayBuffer
  /** Only in video frames. See `bytesEmClaroDoFrame`. */
  type?: string
}

/**
 * The slice of `RTCRtpScriptTransformer` that this depends on.
 *
 * Written by hand, not taken from `lib.webworker`, for a build reason not a preference:
 * this package builds with `lib: ["ES2023", "DOM"]`, and adding `WebWorker` puts two
 * declarations of `self` at odds in all the other files. Three properties cost less
 * than that, and it makes explicit how much of the API this code uses.
 */
interface Transformador {
  readonly readable: ReadableStream<FrameCodificado>
  readonly writable: WritableStream<FrameCodificado>
  readonly options: unknown
}

/** What's said when building the transform. Travels by structured clone. */
export type OpcoesDaTransformacao = { papel: "emissor" } | { papel: "receptor"; address: UserAddress }

/** The key material, as it crosses the boundary. */
export interface ChaveParaWorker {
  keyId: number
  senderId: number
  material: Uint8Array
}

/**
 * The orders that the main thread sends to the worker.
 *
 * Each carries an `eco`, and the worker returns it when done. It's not decoration:
 * it lets `CifraDeMedia` WAIT for the key to be installed before hanging the transform,  * and that's how the window of frames without a key closes for real, instead of
 * observing that in practice nothing went out.
 */
export type OrdemDeCifra =
  | { t: "emissor"; eco: number; chave: ChaveParaWorker; contador: number }
  | { t: "receptor"; eco: number; address: UserAddress; chaves: readonly ChaveParaWorker[] }
  | { t: "esquecer"; eco: number; address: UserAddress }
  | { t: "contar"; eco: number }

/** What the worker replies with. Always with the `eco` from the order that prompted it. */
export type RespostaDeCifra =
  | { t: "pronto"; eco: number }
  | { t: "contagens"; eco: number; contagens: Contagens }
  /**
   * No `eco`, because it doesn't reply to any order: the worker saying frames are failing.
   * Frames don't pass through the main thread, and without this `CifraDeMedia`
   * would never know it has to ask for the key again.
   */
  | { t: "aviso"; aviso: AvisoDaDecifra }
  /**
   * No `eco`, like the warning: VIDEO frames from this person opened again after
   * failing (Phase M2). See `CifraDeMedia.aoVoltarOVideo`.
   */
  | { t: "video-voltou"; address: UserAddress }

/**
 * What passed through the cipher, for anyone measuring.
 *
 * It exists for the same reason as `receptoresDe()` in `CifraDeMedia`: frames
 * don't pass through the main thread, and without it there's nowhere a dashboard, or
 * a production diagnostic, can tell if anything opened at all. It counts, and
 * never stores a byte of anything.
 */
export interface Contagens {
  cifrados: number
  /** DTX silence markers that didn't encrypt or go out. See `quadroDeSilencio`. */
  silencios: number
  abertos: number
  /** Rejected frames: no header, no key for that `keyId`, or tag doesn't close. */
  falhados: number
}

/** The worker scope, in the narrow slice this uses. */
export interface EscopoDoWorker {
  onrtctransform: ((evento: { transformer: Transformador }) => void) | null
  addEventListener(tipo: "message", ouvinte: (evento: { data: unknown }) => void): void
  postMessage(mensagem: RespostaDeCifra): void
}

/**
 * Set the cipher to work inside a worker.
 *
 * @param escopo the worker's `self`. Passed in from outside, not read from within,
 * so tests can exercise this without any browser, it's the only way to measure
 * message order and key reuse instead of asserting them.
 */
export function servirCifraDeMedia(escopo: EscopoDoWorker): void {
  /**
   * The sender in use, with the material it came from.
   *
   * Identified by MATERIAL, exactly as in the main thread, and for a reason
   * that's even sharper here: rebuilding the sender with the same key puts the counter
   * back where the reserve left it, and every nonce already used gets spent again.
   * In AES-GCM a repeated nonce leaks the XOR of the two texts and lets you forge
   * authenticated frames.
   *
   * The main thread only sends a new order when the key changes, but "only sends when"
   * is a promise about another file, and this is the line where the damage would happen.
   * It's compared here.
   */
  let emissor: { material: Uint8Array; sender: SframeSender } | null = null

  /**
   * Per person, the key in use and the previous one.
   *
   * Storing material next to the receiver isn't just housekeeping: it lets you
   * REUSE the `SframeReceiver` when the key didn't change. A new receiver
   * brings an empty replay window, and the window is what tells an honest late frame
   * from a replayed one. Throwing it away at each rotation opened a replay window
   * at every membership change.
   */
  const receptores = new Map<UserAddress, { keyId: number; senderId: number; material: Uint8Array; receiver: SframeReceiver }[]>()

  const contagens: Contagens = { cifrados: 0, silencios: 0, abertos: 0, falhados: 0 }

  // The same watch as the main thread, with warnings crossing the boundary.
  const vigia = new VigiaDaDecifra((aviso) => escopo.postMessage({ t: "aviso", aviso }))
  // Who has video frames failing to decrypt. See `video-voltou`.
  const videoPerdido = new Set<UserAddress>()

  /**
   * One order at a time.
   *
   * `message` handlers fire in order, but the bodies are async, `importSframeKey`
   * waits, and two orders back-to-back would interleave. Two epoch rotations one
   * after the other left the FIRST key installed, because the second reached the end
   * first. It's the same queue, and the same reason, as `#emFila` in `CifraDeMedia`.
   */
  let fila: Promise<unknown> = Promise.resolve()
  const emFila = (tarefa: () => Promise<void>): void => {
    fila = fila.then(tarefa, tarefa)
  }

  const aplicar = async (ordem: OrdemDeCifra): Promise<void> => {
    if (ordem.t === "emissor") {
      if (!emissor || !mesmoMaterial(emissor.material, ordem.chave.material)) {
        emissor = {
          material: ordem.chave.material,
          sender: new SframeSender(
            await importSframeKey(ordem.chave.material, ordem.chave.keyId, ordem.chave.senderId),
            ordem.contador,
          ),
        }
      }
    } else if (ordem.t === "receptor") {
      const cadeia = receptores.get(ordem.address) ?? []
      const nova: { keyId: number; senderId: number; material: Uint8Array; receiver: SframeReceiver }[] = []
      for (const chave of ordem.chaves) {
        const jaExiste = cadeia.find((entrada) => mesmoMaterial(entrada.material, chave.material))
        nova.push(
          jaExiste ?? {
            keyId: chave.keyId,
            senderId: chave.senderId,
            material: chave.material,
            receiver: new SframeReceiver(await importSframeKey(chave.material, chave.keyId, chave.senderId)),
          },
        )
      }
      receptores.set(ordem.address, nova)
    } else if (ordem.t === "esquecer") {
      receptores.delete(ordem.address)
    }

    escopo.postMessage(
      ordem.t === "contar" ? { t: "contagens", eco: ordem.eco, contagens: { ...contagens } } : { t: "pronto", eco: ordem.eco },
    )
  }

  escopo.addEventListener("message", (evento) => {
    const ordem = evento.data as OrdemDeCifra | undefined
    if (!ordem || typeof ordem.eco !== "number") return
    emFila(() => aplicar(ordem))
  })

  const cifrar = async (frame: FrameCodificado, controlador: TransformStreamDefaultController<FrameCodificado>) => {
    // The sender is read at each frame, not pinned when the transform was born:
    // an epoch rotation has to change what goes out without unmounting anything.
    // It's the same reason as the note in `CifraDeMedia.protegerEmissor`.
    const sender = emissor?.sender
    if (!sender) return
    const bytes = new Uint8Array(frame.data) as Uint8Array<ArrayBuffer>
    // DTX: the silence marker doesn't go out (see `quadroDeSilencio`).
    if (quadroDeSilencio(frame, bytes)) {
      contagens.silencios++
      return
    }
    frame.data = (await sender.encrypt(bytes, bytesEmClaroDoFrame(frame, bytes))).buffer
    contagens.cifrados++
    controlador.enqueue(frame)
  }

  const decifrar =
    (address: UserAddress) => async (frame: FrameCodificado, controlador: TransformStreamDefaultController<FrameCodificado>) => {
      const bytes = new Uint8Array(frame.data) as Uint8Array<ArrayBuffer>
      // The key is chosen by the `keyId` that the FRAME ITSELF declares, not the one
      // in use now: both sides rotate when they each get the commit, never at the same
      // instant, and there are always frames from the old key in flight between.
      const cabecalho = readHeader(bytes)
      const receptor = cabecalho
        ? receptores
            .get(address)
            ?.find((entrada) => entrada.keyId === cabecalho.keyId && entrada.senderId === cabecalho.senderId)?.receiver
        : undefined
      const aberto = await receptor?.decrypt(bytes)
      if (!aberto) {
        // Thrown away, never let through. A decoder fed ciphertext produces noise, and
        // noise looks like a fault to whoever listens.
        contagens.falhados++
        if (!cabecalho) vigia.falhou(address, "sem-cabecalho")
        else if (!receptor) vigia.falhou(address, "sem-chave", cabecalho.keyId, cabecalho.senderId)
        else vigia.falhou(address, "recusado", cabecalho.keyId, cabecalho.senderId)
        if ("type" in frame) videoPerdido.add(address)
        return
      }
      vigia.abriu(address, cabecalho?.senderId)
      if ("type" in frame && videoPerdido.delete(address)) escopo.postMessage({ t: "video-voltou", address })
      frame.data = aberto.buffer
      contagens.abertos++
      controlador.enqueue(frame)
    }

  escopo.onrtctransform = (evento) => {
    const transformador = evento.transformer
    const opcoes = transformador.options as OpcoesDaTransformacao | undefined
    if (!opcoes) return
    void transformador.readable
      .pipeThrough(
        new TransformStream<FrameCodificado, FrameCodificado>({
          transform: opcoes.papel === "emissor" ? cifrar : decifrar(opcoes.address),
        }),
      )
      .pipeTo(transformador.writable)
      .catch(() => {
        // The pipeline ends when the endpoint closes. It's not an error.
      })
  }
}

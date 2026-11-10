/**
 * Prepare a video for publishing on the publisher's device.
 *
 * **No transcoding.** The file goes as is: MP4, WebM or MOV, up to the protocol
 * limit (`VIDEO_MAX_BYTES`, `VIDEO_MAX_SEGUNDOS`). Shrinking a video in the
 * browser is possible with WebCodecs (decode, resize and encode again,
 * frame by frame), but it takes minutes of CPU on a phone and changes what the
 * person chose. That is for later.
 *
 * What we do here: read the duration and dimensions from an off-screen `<video>`,
 * grab the frame at 1 s for the thumbnail and shrink it like photos
 * (`compressImage`, budget `poster`). All before sending, to reject at the gate
 * what does not fit.
 */

import { ERROS_DO_VIDEO } from "@enclave/client-core"
import { VIDEO_MAX_BYTES, VIDEO_MAX_SEGUNDOS, VIDEO_TIPOS, videoAceite } from "@enclave/protocol"
import { compressImage, IMAGE_BUDGETS, type CompressDeps } from "./images.js"

/** The stable error message for a video this device cannot read. See `codigosDeErro.ts`. */
export const ERRO_VIDEO_ILEGIVEL = "could not read this video"

/** What the file picker button accepts. */
export const ACEITA_VIDEO = VIDEO_TIPOS.join(",")

/** How long we wait for a `<video>` that says nothing. */
const PRAZO_MS = 15_000

/** The instant for the thumbnail: 1 s, or halfway through a shorter video. */
export function instanteDaMiniatura(duracao: number): number {
  return Math.min(1, duracao / 2)
}

/**
 * The type of a video file. Some phones deliver the file with no type;
 * we then read the extension, and only for the three accepted types.
 */
export function tipoDoVideo(ficheiro: { type: string; name?: string }): string {
  if (ficheiro.type) return ficheiro.type
  const nome = (ficheiro.name ?? "").toLowerCase()
  if (nome.endsWith(".mp4") || nome.endsWith(".m4v")) return "video/mp4"
  if (nome.endsWith(".webm")) return "video/webm"
  if (nome.endsWith(".mov")) return "video/quicktime"
  return ""
}

/** Validate what we know without reading the file: the type and size. Throws the stable error. */
export function validarAntesDeLer(ficheiro: { type: string; name?: string; size: number }): string {
  const tipo = tipoDoVideo(ficheiro)
  if (!videoAceite(tipo)) throw new Error("this video format is not accepted", { cause: { tipo } })
  if (ficheiro.size > VIDEO_MAX_BYTES) throw new Error("the video is too large", { cause: { max: VIDEO_MAX_BYTES } })
  return tipo
}

/** "1:05", "12:00". Videos here do not go past 90 seconds, but the math works for more. */
export function formatarDuracao(segundos: number): string {
  const total = Math.max(0, Math.round(segundos))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

export interface VideoLido {
  duration: number
  largura: number
  altura: number
  /** The thumbnail, already downsized, as an image data URL. */
  poster: string
}

export interface DepsDoVideo {
  criarVideo?: () => HTMLVideoElement
  criarCanvas?: () => HTMLCanvasElement
  urlDe?: (blob: Blob) => string
  largar?: (url: string) => void
  /** For tests: the photo compressor, with its doubles. */
  comprimir?: (blob: Blob) => Promise<{ dataUrl: string }>
  prazoMs?: number
}

/** Wait for a `<video>` event, or fail on error and timeout. */
function esperarPor(video: HTMLVideoElement, evento: string, prazoMs: number): Promise<void> {
  return new Promise((resolver, rejeitar) => {
    const acabar = (falhou: boolean): void => {
      clearTimeout(prazo)
      video.removeEventListener(evento, bem)
      video.removeEventListener("error", mal)
      if (falhou) rejeitar(new Error("could not read this video"))
      else resolver()
    }
    const bem = (): void => acabar(false)
    const mal = (): void => acabar(true)
    const prazo = setTimeout(mal, prazoMs)
    video.addEventListener(evento, bem)
    video.addEventListener("error", mal)
  })
}

/**
 * Read a video: the duration, dimensions and thumbnail. Throws
 * `ERRO_VIDEO_ILEGIVEL` if this browser cannot open it, and `ERROS_DO_VIDEO.longo` if
 * it goes past the duration cap.
 */
export async function lerVideo(ficheiro: Blob, deps: DepsDoVideo = {}): Promise<VideoLido> {
  const video = (deps.criarVideo ?? (() => document.createElement("video")))()
  const urlDe = deps.urlDe ?? ((blob: Blob) => URL.createObjectURL(blob))
  const largar = deps.largar ?? ((url: string) => URL.revokeObjectURL(url))
  const prazoMs = deps.prazoMs ?? PRAZO_MS
  video.muted = true
  video.playsInline = true
  video.preload = "auto"
  const url = urlDe(ficheiro)
  try {
    const metadados = esperarPor(video, "loadedmetadata", prazoMs)
    video.src = url
    await metadados
    let duracao = video.duration
    /*
      A WebM recorded by `MediaRecorder` does not bring the duration in the
      header: Chromium says `Infinity` until someone plays through to the end.
      Seeking to the end forces it to measure, and the duration becomes accurate.
    */
    if (duracao === Infinity) {
      const mediu = esperarPor(video, "durationchange", prazoMs)
      video.currentTime = Number.MAX_SAFE_INTEGER
      await mediu
      duracao = video.duration
    }
    if (!Number.isFinite(duracao) || duracao <= 0) throw new Error("could not read this video")
    if (duracao > VIDEO_MAX_SEGUNDOS) throw new Error("the video is too long", { cause: { max: VIDEO_MAX_SEGUNDOS } })

    const procurou = esperarPor(video, "seeked", prazoMs)
    video.currentTime = instanteDaMiniatura(duracao)
    await procurou

    const largura = video.videoWidth
    const altura = video.videoHeight
    if (largura <= 0 || altura <= 0) throw new Error("could not read this video")
    // Drawn at thumbnail size already: a 4K frame as PNG would weigh megabytes
    // just to be decoded and shrunk afterward.
    const escala = Math.min(1, IMAGE_BUDGETS.poster.maxSide / Math.max(largura, altura))
    const canvas = (deps.criarCanvas ?? (() => document.createElement("canvas")))()
    canvas.width = Math.max(1, Math.round(largura * escala))
    canvas.height = Math.max(1, Math.round(altura * escala))
    const contexto = canvas.getContext("2d")
    if (!contexto) throw new Error("could not read this video")
    contexto.drawImage(video, 0, 0, canvas.width, canvas.height)
    const fotograma = await new Promise<Blob | null>((resolver) => canvas.toBlob(resolver, "image/png"))
    if (!fotograma) throw new Error("could not read this video")
    const comprimir = deps.comprimir ?? ((blob: Blob) => compressImage(blob, IMAGE_BUDGETS.poster, {} as CompressDeps))
    const { dataUrl } = await comprimir(fotograma)
    return { duration: duracao, largura, altura, poster: dataUrl }
  } finally {
    largar(url)
    video.removeAttribute("src")
  }
}

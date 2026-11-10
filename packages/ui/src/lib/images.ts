/**
 * Compress images before encrypting them.
 *
 * **Before encrypting, and on the sender's device.** This isn't housekeeping: once
 * encrypted, an image is noise that nobody can reduce, not the server, which is
 * exactly the point. A normal product shrinks photos on the server side because it
 * can read them; that's out of the question here, so the work must happen here, on
 * the device, or not at all.
 *
 * Why this exists, stated with the real numbers that justify it: 512 KB avatars
 * replicated per channel nearly consumed an entire database on a real server. Each
 * member republishes the profile in every channel with each membership change, so an
 * image costs (people × channels), not one copy. That's why the channel icon was
 * capped at 256 KB and link thumbnails at 100 KB. A limit that only rejects the file
 * pushes the problem to the person; compressing solves it.
 *
 * What passes unchanged: a file that ALREADY fits the budget and already has the
 * right dimensions. Recoding a 20 KB PNG to JPEG only makes it worse, loses
 * transparency and gains artifacts, and an animated GIF that fits keeps animating,
 * which recoding would kill. Compress everything; don't damage what was already fine.
 *
 * Animated GIF has its own cap (`maxBytesAnimado`) in avatar and icon: passes intact
 * up to it, no matter the long side, because redrawing it smaller is recoding it, and
 * recoding kills animation. Above the cap it recodes like any image, stops moving, and
 * whoever chose it is warned (`animacaoPerdida`, `avisoDeAnimacaoPerdida`).
 */

import { formatarBytes } from "./ficheiros.js"
import { strings } from "../strings.js"

/** A budget: how far the image can grow, in pixels and bytes. */
export interface ImageBudget {
  /** Longest side, in pixels. Above this the image is redrawn smaller. */
  maxSide: number
  /** Result cap, in image bytes, not in data URL characters. */
  maxBytes: number
  /**
   * Cap for a GIF that passes intact and animated, in bytes. Above
   * `maxBytes` and above `maxSide` if needed: what costs per channel is weight,
   * not pixels. Without this field, a GIF follows the rule of any image.
   */
  maxBytesAnimado?: number
}

/**
 * The budgets, in one place.
 *
 * Each one is worth what it costs to REPLICATE, not what it costs to view. An avatar
 * is the most expensive image here despite being smallest on screen, because it
 * travels again for every channel and every membership change.
 */
/**
 * The cap for an animated GIF in avatar and icon: 160 KB.
 *
 * Owner decision on October 27, 2026 (phase 1c of the 0.9 settings plan). The math is
 * the same, people × channels: the profile goes out again for every channel and every
 * membership change. In a community of 50 people with 20 channels each, 160 KB avatars
 * take about 160 MB, against 96 MB at 96 KB, and every membership change in a 50-person
 * channel resends 8 MB instead of 4.8. That's two-thirds more for a face that moves,
 * far from the 512 KB that filled a database. Higher, a two or three-second GIF would
 * fit better, but cost grows with every channel, not with who chose it. The protocol
 * accepts up to 512 KB: the cap is ours, not the wire's.
 */
const GIF_ANIMADO_MAX_BYTES = 160_000

export const IMAGE_BUDGETS = {
  /**
   * Avatar. Goes out once per channel the person belongs to, and again whenever
   * membership in one changes. 96 KB at 256 px is a sharp face at the size it's
   * drawn (40 px, 56 px in editor) with room for dense screens, and one eighth
   * of what 512 KB used to cost.
   */
  avatar: { maxSide: 256, maxBytes: 96 * 1024, maxBytesAnimado: GIF_ANIMADO_MAX_BYTES },
  /** Channel icon. One copy per channel, not per person: half the cost. */
  icon: { maxSide: 256, maxBytes: 96 * 1024, maxBytesAnimado: GIF_ANIMADO_MAX_BYTES },
  /**
   * Link thumbnail. Aligned with `THUMBNAIL_MAX_CHARS` in the feed (100,000 data
   * URL characters ≈ 75 KB of image): under 72 KB, the card fits the protocol
   * field even after base64.
   */
  thumbnail: { maxSide: 480, maxBytes: 72 * 1024 },
  /**
   * Image in a conversation message. Lives in the channel history, which holds 400
   * items, and shares the same byte cap as everything else. 400 KB at 1600 px is a
   * photo that looks good full-screen without being a camera file.
   */
  chat: { maxSide: 1600, maxBytes: 400 * 1024 },
  /** Post image. Like the message: they're the same on the wire. */
  post: { maxSide: 1600, maxBytes: 400 * 1024 },
  /**
   * Thumbnail of a video: the frame at 1 s. Goes inside the `post` and stays in
   * the vault of whoever follows even after the video bytes leave, so it's small:
   * 640 px is enough for phone width, and 48 KB fits comfortably in the 200,000
   * characters of the protocol (`POSTER_MAX_CARACTERES`).
   */
  poster: { maxSide: 640, maxBytes: 48 * 1024 },
} as const satisfies Record<string, ImageBudget>

export interface CompressedImage {
  /** A imagem pronta a entrar no payload. */
  dataUrl: string
  /** Image bytes, already without base64 bloat. */
  bytes: number
  width: number
  height: number
  /** False when the file already fit and passed unchanged. */
  recoded: boolean
  /**
   * True when an animated GIF above `maxBytesAnimado` came in and a still image
   * came out. Only in budgets with that cap: in others, a recoded GIF has no
   * promise of animation to break.
   */
  animacaoPerdida?: boolean
}

/**
 * The quality ladder.
 *
 * Stepping down quality is always better than stepping down size: a photo at
 * 1600 px with artifacts reads fine; the same at 400 px without artifacts doesn't
 * show anyone's face. Only when the ladder runs out does the long side shrink.
 */
const QUALIDADES = [0.82, 0.7, 0.58, 0.46] as const

/** How many times the long side can be cut in half before giving up. */
const CORTES_MAX = 3

/**
 * How many bytes a data URL actually carries.
 *
 * base64 costs four characters for every three bytes, and the trailing `=` doesn't
 * count as data. Without this account, every budget would measure 33 % too high and
 * images would come out smaller than they needed to be.
 */
export function dataUrlBytes(dataUrl: string): number {
  const virgula = dataUrl.indexOf(",")
  if (virgula < 0) return 0
  const base64 = dataUrl.slice(virgula + 1)
  const enchimento = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - enchimento)
}

function blobParaDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(String(leitor.result))
    leitor.onerror = () => reject(new Error("unreadable image"))
    leitor.readAsDataURL(blob)
  })
}

/**
 * WebP when the engine knows how to write it, JPEG when it doesn't.
 *
 * WebP keeps transparency, which JPEG discards, and a logo without transparency
 * gets a white rectangle, and comes out about 30 % smaller at the same apparent
 * quality. Where it doesn't exist, JPEG is the only universal fallback: PNG has no
 * quality control and a photo in PNG is larger than the original.
 *
 * Memoized because the answer doesn't change during the page's life, and finding out
 * costs drawing a canvas.
 */
let formatoPreferido: string | null = null

function melhorFormato(criarCanvas: () => HTMLCanvasElement): string {
  if (formatoPreferido) return formatoPreferido
  try {
    const canvas = criarCanvas()
    canvas.width = 1
    canvas.height = 1
    formatoPreferido = canvas.toDataURL("image/webp").startsWith("data:image/webp") ? "image/webp" : "image/jpeg"
  } catch {
    formatoPreferido = "image/jpeg"
  }
  return formatoPreferido
}

/** For tests only: forget what was detected about this engine. */
export function resetFormatoDetectado(): void {
  formatoPreferido = null
}

export interface CompressDeps {
  /** Decode the bytes. Injected because jsdom has no decoder. */
  decode?: (blob: Blob) => Promise<{ width: number; height: number; close?: () => void }>
  createCanvas?: () => HTMLCanvasElement
  /** Draw the sized bitmap. Separated so it can be observed. */
  draw?: (canvas: HTMLCanvasElement, bitmap: unknown, width: number, height: number) => void
}

/**
 * Compress an image to fit within budget.
 *
 * Returns a data URL ready to go into the payload, images travel this way,
 * inside the encrypted message, not in a blob store that would record who
 * fetched what and when.
 *
 * Fails with a message in Portuguese when there is no image decoder and the
 * file does not fit: an image that comes out too large is rejected by the
 * receiver in full and silently, and three rejections in a row mark the
 * channel as deaf. Better to show an error in the composer.
 */
export async function compressImage(
  file: Blob,
  budget: ImageBudget,
  deps: CompressDeps = {},
): Promise<CompressedImage> {
  const criarCanvas = deps.createCanvas ?? (() => document.createElement("canvas"))
  const decode =
    deps.decode ??
    (typeof createImageBitmap === "function"
      ? /**
         * `from-image`, and written by hand instead of left to the engine.
         *
         * A mobile phone photo is stored landscape with an EXIF tag saying how
         * much to rotate it. Whoever decodes without asking for the orientation
         * gets the pixels as stored and draws them that way, and the damage is
         * permanent, because reencoding throws the tag away and nothing is left
         * to say how to straighten it later.
         *
         * Losing the tag is, in fact, the only good thing reencoding does
         * without being asked: the location where the photo was taken and the
         * camera model go with it, and nobody intends to share those when
         * sharing a photo.
         *
         * The spec default is already this, but it was not always, and writing
         * it costs a line against a bug that only shows up in mobile phone
         * photos and one engine at a time.
         */
        async (blob: Blob) => createImageBitmap(blob, { imageOrientation: "from-image" })
      : undefined)

  /** A GIF that fits under the animated cap passes as is: see `maxBytesAnimado`. */
  const gifQueAnima =
    file.type === "image/gif" && budget.maxBytesAnimado !== undefined && file.size <= budget.maxBytesAnimado
  const gifQueParou = file.type === "image/gif" && budget.maxBytesAnimado !== undefined && !gifQueAnima

  // No decoder means there is nothing to do but let through what already fits.
  if (!decode) {
    if (file.size <= budget.maxBytes || gifQueAnima) {
      const dataUrl = await blobParaDataUrl(file)
      return { dataUrl, bytes: dataUrlBytes(dataUrl), width: 0, height: 0, recoded: false }
    }
    throw new Error("this device cannot shrink images")
  }

  let bitmap: { width: number; height: number; close?: () => void }
  try {
    bitmap = await decode(file)
  } catch {
    throw new Error("this is not an image this device can read")
  }

  try {
    const maiorLado = Math.max(bitmap.width, bitmap.height)

    /** The file as it came in, wrapped in what this function returns. */
    const intacta = async (): Promise<CompressedImage> => {
      const dataUrl = await blobParaDataUrl(file)
      return {
        dataUrl,
        bytes: dataUrlBytes(dataUrl),
        width: bitmap.width,
        height: bitmap.height,
        recoded: false,
      }
    }

    // Already fits, and at the right dimensions: comes out as it went in. This is
    // what keeps an animated GIF animating and a PNG with transparency transparent.
    if (file.size <= budget.maxBytes && maiorLado <= budget.maxSide) return await intacta()
    // A GIF under its cap, even at 480 px: redrawing it at 256 would be
    // reencoding, and the animation would die to save pixels that cost nothing.
    if (gifQueAnima) return await intacta()

    /**
     * The swap only happens if it pays off.
     *
     * We get here with an image that fit in bytes but not in pixels, a text
     * screenshot, a diagram, anything PNG compresses well because it is flat.
     * Redrawing it at 1600 px in JPEG can give a file LARGER than what came
     * in, plus artifacts around the letters: worse on both counts that matter.
     *
     * A compressor that only knows how to compress is damage waiting to happen.
     * The rule is simple and measurable: if the result is not smaller than the
     * original, and the original already fit, keep the original.
     */
    const melhorDasDuas = async (recodificada: CompressedImage): Promise<CompressedImage> => {
      if (file.size > budget.maxBytes) return recodificada
      if (recodificada.bytes < file.size) return recodificada
      return await intacta()
    }

    const formato = melhorFormato(criarCanvas)
    let escala = Math.min(1, budget.maxSide / Math.max(1, maiorLado))
    let ultima: CompressedImage | null = null

    for (let corte = 0; corte <= CORTES_MAX; corte++) {
      const largura = Math.max(1, Math.round(bitmap.width * escala))
      const altura = Math.max(1, Math.round(bitmap.height * escala))
      const canvas = criarCanvas()
      canvas.width = largura
      canvas.height = altura

      if (deps.draw) {
        deps.draw(canvas, bitmap, largura, altura)
      } else {
        const contexto = canvas.getContext("2d")
        if (!contexto) throw new Error("this device cannot shrink images")
        contexto.drawImage(bitmap as CanvasImageSource, 0, 0, largura, altura)
      }

      for (const qualidade of QUALIDADES) {
        const dataUrl = canvas.toDataURL(formato, qualidade)
        const bytes = dataUrlBytes(dataUrl)
        ultima = {
          dataUrl,
          bytes,
          width: largura,
          height: altura,
          recoded: true,
          ...(gifQueParou ? { animacaoPerdida: true } : {}),
        }
        if (bytes <= budget.maxBytes) return await melhorDasDuas(ultima)
      }

      // The ladder ran out at this size. Cutting the longer side in half gives
      // four times fewer pixels, which is the jump quality cannot make.
      escala /= 2
    }

    if (ultima) {
      throw new Error("this image is too large even after compression")
    }
    throw new Error("could not compress this image")
  } finally {
    bitmap.close?.()
  }
}

/**
 * The warning for a GIF that froze or came out empty.
 *
 * Reencoding silently meant the user picked a face that moves and saw, for no
 * reason they could tell, a still face. The message says the size, the cap, and
 * what happened, so they can pick a lighter GIF. Here and not in both editors
 * (profile and channel icon): the same message in two places is the same
 * message drifting apart.
 */
export function avisoDeAnimacaoPerdida(
  original: { size: number },
  imagem: CompressedImage,
  budget: ImageBudget,
): string | null {
  if (!imagem.animacaoPerdida || budget.maxBytesAnimado === undefined) return null
  return strings.common.gifParado(formatarBytes(original.size), formatarBytes(budget.maxBytesAnimado))
}

/**
 * What the compression did, in bytes and in a message.
 *
 * Returns null when there is nothing to say, images that passed untouched, or
 * that did not shrink. A line saying "reduced from 300 kB to 300 kB" is noise,
 * and repeated noise is how you teach someone not to read all the lines.
 *
 * Lives here, next to the compressor, and is the only function in this file
 * that speaks Portuguese to a user: both composer boxes need the exact same
 * message, and keeping it in two is keeping it in none.
 */
export function resumoDaReducao(
  originais: readonly { size: number }[],
  finais: readonly { bytes: number }[],
): string | null {
  const antes = originais.reduce((total, file) => total + file.size, 0)
  const depois = finais.reduce((total, imagem) => total + imagem.bytes, 0)
  if (finais.length === 0 || depois >= antes) return null
  return finais.length === 1
    ? strings.common.imageShrunk(formatarBytes(antes), formatarBytes(depois))
    : strings.common.imagesShrunk(finais.length, formatarBytes(antes), formatarBytes(depois))
}

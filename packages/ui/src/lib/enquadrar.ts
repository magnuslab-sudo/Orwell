/**
 * Frame an image before compressing: the math of the crop, and the crop itself.
 *
 * Request from the owner and community (November 2, 2026, item 4 of
 * `docs/planos/depois-da-1-0.md`): when choosing a profile photo, move and
 * zoom inside a circle before saving; the same for the channel icon
 * (rounded-corner square) and for a post cover (16:10).
 *
 * **Geometry lives here, away from the screen.** The component (`components/Enquadrar.tsx`)
 * only translates gestures into calls to these functions; what gets cropped comes out here, and
 * that is what tests prove without any browser. Math hidden in an `onPointerMove`
 * can only be tested by dragging by hand.
 *
 * **State is the center of the crop, in image pixels, and a zoom level.** Zoom 1 is
 * the largest crop of the requested shape that fits in the image (what an
 * `object-fit: cover` would show); zoom 2 is half the width of that. Storing the
 * center, not an offset on screen, means the result does not depend on the
 * size the component was drawn at: the same choice on a phone and a desktop
 * gives the same image.
 *
 * **The crop never goes outside the image.** No empty bands around a face:
 * the center locks so the crop always fits entirely within existing
 * pixels. It is the same behavior as apps people already know, and avoids a decision
 * (what color is the empty space?) that nobody asked for.
 */

import { compressImage, type CompressDeps, type CompressedImage, type ImageBudget } from "./images.js"

/** The three frames. Circle shape is same as square: only the mask changes. */
export type FormaDoEnquadramento = "circulo" | "quadrado" | "capa"

/** Width over height, by shape. The cover is the feed frame, 16:10. */
export const PROPORCAO_DA_FORMA: Record<FormaDoEnquadramento, number> = {
  circulo: 1,
  quadrado: 1,
  capa: 16 / 10,
}

/**
 * The highest zoom level. Eight times is enough to go from a group photo to
 * a face; beyond that is just magnifying camera noise.
 */
export const ZOOM_MAXIMO = 8

/**
 * The shortest side a crop can have, in image pixels. Below this
 * the result is a blur, and a small image hits the zoom ceiling before eight.
 */
const LADO_MINIMO_DO_RECORTE = 32

/** What the user chose: where the crop center is, and how much they zoomed. */
export interface Enquadramento {
  zoom: number
  /** Center of the crop, in image pixels. */
  cx: number
  cy: number
}

/** The image region that comes out, in image pixels. */
export interface Recorte {
  sx: number
  sy: number
  sw: number
  sh: number
}

/** The image being framed, only the measurements the math needs. */
export interface Medidas {
  largura: number
  altura: number
}

/** The crop at zoom 1: the largest rectangle of the ratio that fits in the image. */
function recorteBase({ largura, altura }: Medidas, proporcao: number): { sw: number; sh: number } {
  if (largura / altura > proporcao) return { sw: altura * proporcao, sh: altura }
  return { sw: largura, sh: largura / proporcao }
}

/** The highest zoom for this image: eight, or less if it is small. */
export function zoomMaximo(medidas: Medidas, proporcao: number): number {
  const { sw, sh } = recorteBase(medidas, proporcao)
  return Math.max(1, Math.min(ZOOM_MAXIMO, Math.min(sw, sh) / LADO_MINIMO_DO_RECORTE))
}

function entre(valor: number, minimo: number, maximo: number): number {
  return Math.min(maximo, Math.max(minimo, valor))
}

/** Enforce a frame within the rules: zoom in range, crop inside the image. */
export function limitar(estado: Enquadramento, medidas: Medidas, proporcao: number): Enquadramento {
  const zoom = entre(Number.isFinite(estado.zoom) ? estado.zoom : 1, 1, zoomMaximo(medidas, proporcao))
  const base = recorteBase(medidas, proporcao)
  const sw = base.sw / zoom
  const sh = base.sh / zoom
  return {
    zoom,
    cx: entre(estado.cx, sw / 2, medidas.largura - sw / 2),
    cy: entre(estado.cy, sh / 2, medidas.altura - sh / 2),
  }
}

/** On open: zoom 1, at center. It is what `object-fit: cover` already showed. */
export function enquadramentoInicial(medidas: Medidas): Enquadramento {
  return { zoom: 1, cx: medidas.largura / 2, cy: medidas.altura / 2 }
}

/** The image region this frame crops. */
export function recorteDe(estado: Enquadramento, medidas: Medidas, proporcao: number): Recorte {
  const certo = limitar(estado, medidas, proporcao)
  const base = recorteBase(medidas, proporcao)
  const sw = base.sw / certo.zoom
  const sh = base.sh / certo.zoom
  return { sx: certo.cx - sw / 2, sy: certo.cy - sh / 2, sw, sh }
}

/**
 * Drag the image by (dx, dy) screen pixels, in a frame of this width.
 *
 * The image follows the finger: dragging right shows what is on the
 * left, so the crop center moves opposite the gesture.
 */
export function arrastar(
  estado: Enquadramento,
  dx: number,
  dy: number,
  larguraDaMoldura: number,
  medidas: Medidas,
  proporcao: number,
): Enquadramento {
  const { sw } = recorteDe(estado, medidas, proporcao)
  const pixelsPorPonto = sw / Math.max(1, larguraDaMoldura)
  return limitar(
    { ...estado, cx: estado.cx - dx * pixelsPorPonto, cy: estado.cy - dy * pixelsPorPonto },
    medidas,
    proporcao,
  )
}

/**
 * Zoom to `zoom`, keeping the point `foco` still under the mouse or fingers.
 *
 * `foco` ranges from 0 to 1 within the frame (0.5 and 0.5 is the middle, which is what
 * the bar and keyboard use). Without a focus point, the mouse wheel always zoomed the center and
 * the user had to drag after to get back to the face they were pointing at.
 */
export function ampliar(
  estado: Enquadramento,
  zoom: number,
  foco: { fx: number; fy: number },
  medidas: Medidas,
  proporcao: number,
): Enquadramento {
  const antes = recorteDe(estado, medidas, proporcao)
  // The image point under the focus, before zooming.
  const px = antes.sx + foco.fx * antes.sw
  const py = antes.sy + foco.fy * antes.sh
  const novoZoom = entre(zoom, 1, zoomMaximo(medidas, proporcao))
  const base = recorteBase(medidas, proporcao)
  const sw = base.sw / novoZoom
  const sh = base.sh / novoZoom
  // The new center that keeps that point in the same place on the frame.
  return limitar(
    { zoom: novoZoom, cx: px + sw * (0.5 - foco.fx), cy: py + sh * (0.5 - foco.fy) },
    medidas,
    proporcao,
  )
}

/**
 * The size of the output image, in pixels.
 *
 * The longer side caps at `maxSide` from the budget, and the image never grows: a
 * 120 px crop comes out 120 px, because zooming on device only wastes bytes
 * drawing the same blur bigger. Height comes from width and ratio, not
 * from a second rounding: an avatar must be square to the pixel.
 */
export function tamanhoDeSaida(recorte: Recorte, proporcao: number, maxSide: number): { largura: number; altura: number } {
  const escala = Math.min(1, maxSide / Math.max(recorte.sw, recorte.sh))
  const largura = Math.max(1, Math.round(recorte.sw * escala))
  return { largura, altura: Math.max(1, Math.round(largura / proporcao)) }
}

/**
 * Does the crop capture the whole image? Half a pixel of slack, due to
 * floating-point math.
 */
export function recorteEInteiro(recorte: Recorte, medidas: Medidas): boolean {
  return (
    recorte.sx < 0.5 &&
    recorte.sy < 0.5 &&
    Math.abs(recorte.sw - medidas.largura) < 0.5 &&
    Math.abs(recorte.sh - medidas.altura) < 0.5
  )
}

/**
 * A GIF that stays animated: do not frame it, center it as-is.
 *
 * Cropping an animated GIF means decoding and re-encoding every
 * frame, and the browser cannot write GIF: it would need a library and
 * color quantization for each frame. Worse, though, is the cap. A GIF
 * 256 px wide with two seconds of video rarely fits in 160 KB after re-encoding,
 * and above the cap it stops anyway (`lib/images.ts`). Letting users frame it
 * would, most of the time, trade the animation for the frame without them noticing.
 *
 * So a GIF under the animated cap passes as-is, and the frame
 * shows it centered, which is the crop `object-fit: cover` already does everywhere it appears. A GIF
 * above the cap will stop: that one frames like any image.
 */
export function gifQueFicaAnimado(ficheiro: Blob, budget: ImageBudget): boolean {
  return ficheiro.type === "image/gif" && budget.maxBytesAnimado !== undefined && ficheiro.size <= budget.maxBytesAnimado
}

/** Does this device know how to crop? Without a decoder or local storage, there is no component. */
export function podeEnquadrar(): boolean {
  return typeof createImageBitmap === "function" && typeof URL.createObjectURL === "function"
}

export interface CortarDeps {
  decode?: (blob: Blob) => Promise<{ width: number; height: number; close?: () => void }>
  createCanvas?: () => HTMLCanvasElement
  /** Draw the crop on canvas. Separate so tests can see what is asked for. */
  draw?: (canvas: HTMLCanvasElement, bitmap: unknown, recorte: Recorte, largura: number, altura: number) => void
  /** From canvas to a file. Injectable because jsdom has no `toBlob`. */
  toBlob?: (canvas: HTMLCanvasElement) => Promise<Blob>
  /** The compressor. Defaults to the one in `lib/images.ts`, with the same caps. */
  comprimir?: (blob: Blob, budget: ImageBudget, deps?: CompressDeps) => Promise<CompressedImage>
}

/**
 * Crop and compress by the caps in `images.ts`.
 *
 * The crop comes out as PNG, lossless, and that PNG goes into the standard compressor. This way
 * the quality ladder, WebP with transparency, and the "if it fits already, pass it through" are
 * the same for any image: a small transparent logo stays transparent, and a photo shrinks to fit.
 * Re-encoding once more in a lossless format does no harm.
 *
 * When the user did not touch anything and the image already had the right shape, the
 * crop is the whole image, and the original file passes through: a PNG that already fit
 * is not redrawn, and a GIF under the cap keeps moving.
 */
export async function cortarImagem(
  ficheiro: Blob,
  recorte: Recorte,
  forma: FormaDoEnquadramento,
  budget: ImageBudget,
  deps: CortarDeps = {},
): Promise<CompressedImage> {
  const comprimir = deps.comprimir ?? compressImage
  if (gifQueFicaAnimado(ficheiro, budget)) return comprimir(ficheiro, budget)

  const decode =
    deps.decode ??
    (typeof createImageBitmap === "function"
      ? // Same EXIF orientation the compressor and component use: the region the
        // user chose is the region that comes out.
        async (blob: Blob) => createImageBitmap(blob, { imageOrientation: "from-image" })
      : undefined)
  if (!decode) throw new Error("this device cannot shrink images")

  let bitmap: { width: number; height: number; close?: () => void }
  try {
    bitmap = await decode(ficheiro)
  } catch {
    throw new Error("this is not an image this device can read")
  }

  let png: Blob
  try {
    const medidas = { largura: bitmap.width, altura: bitmap.height }
    if (recorteEInteiro(recorte, medidas)) return await comprimir(ficheiro, budget)

    const proporcao = PROPORCAO_DA_FORMA[forma]
    const { largura, altura } = tamanhoDeSaida(recorte, proporcao, budget.maxSide)
    const canvas = (deps.createCanvas ?? (() => document.createElement("canvas")))()
    canvas.width = largura
    canvas.height = altura
    if (deps.draw) {
      deps.draw(canvas, bitmap, recorte, largura, altura)
    } else {
      const contexto = canvas.getContext("2d")
      if (!contexto) throw new Error("this device cannot shrink images")
      contexto.imageSmoothingQuality = "high"
      contexto.drawImage(bitmap as CanvasImageSource, recorte.sx, recorte.sy, recorte.sw, recorte.sh, 0, 0, largura, altura)
    }
    png = await (deps.toBlob ?? paraPng)(canvas)
  } finally {
    bitmap.close?.()
  }

  const imagem = await comprimir(png, budget)
  // A GIF above the cap stopped, as it would have without the component. The warning
  // (`avisoDeAnimacaoPerdida`) depends on this flag, which PNG no longer carries.
  if (ficheiro.type === "image/gif" && budget.maxBytesAnimado !== undefined) return { ...imagem, animacaoPerdida: true }
  return imagem
}

function paraPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("could not compress this image"))), "image/png")
  })
}

/**
 * A data URL back to a file, to frame an image that is already in the
 * draft of a post.
 *
 * By hand, with `atob`, not with `fetch(dataUrl)`: the app's desktop security policy
 * limits `fetch`, and an image already in memory needs no network.
 */
export function dataUrlParaBlob(dataUrl: string): Blob {
  const virgula = dataUrl.indexOf(",")
  const cabeca = dataUrl.slice(5, virgula)
  const tipo = cabeca.split(";")[0] || "application/octet-stream"
  const dados = dataUrl.slice(virgula + 1)
  if (!cabeca.includes(";base64")) return new Blob([decodeURIComponent(dados)], { type: tipo })
  const binario = atob(dados)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return new Blob([bytes], { type: tipo })
}

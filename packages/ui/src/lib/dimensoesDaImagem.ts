import type { CSSProperties } from "react"

/**
 * The width and height of an image, read from the `data:` URL header.
 *
 * **Why it exists.** An image in a message arrives as bytes inside encrypted
 * text, with no dimensions alongside. Until it decodes, the browser does not
 * know what height it has and draws it as zero. The conversation opens at the
 * bottom, the image decodes, the line grows, and whoever opened the room ends
 * up hundreds of pixels above the end (measured November 4, 2026: 416 to 861 px
 * at 1920x1080). With dimensions in `<img width height>`, the browser reserves
 * the right box on the first draw and nothing moves after.
 *
 * **How.** Just the header: PNG (IHDR), GIF (logical screen), WebP (VP8, VP8L
 * and VP8X) and JPEG (the first SOF, with Exif orientation). The base64 reads
 * in chunks, at the place each byte is, and never whole: a 60 KB APP1 in a
 * phone JPEG skips by length, without decoding.
 *
 * Reads by content, not by declared type, which is what the sender writes.
 * A format we do not know (AVIF), an address, or corrupted bytes give null:
 * the image then stays as it was, with no reserved box, and the conversation
 * corrects the position when it finishes loading (see `Timeline`).
 */
export interface Dimensoes {
  largura: number
  altura: number
}

/**
 * The natural width and aspect ratio, for the conversation spacer (`screens.css`,
 * `.message-media .post-images .image-open::before`) to ask for the right width
 * before the image decodes. In the wall no rule reads them, and they stay inert.
 */
export function reserva(d: Dimensoes | null): CSSProperties | undefined {
  if (!d) return undefined
  // Custom properties: React's type does not know them by name.
  return { "--imagem-largura": `${d.largura}px`, "--imagem-proporcao": d.largura / d.altura } as CSSProperties
}

/** The cap for what we look for in a JPEG: a SOF after this is a strange file. */
const JPEG_MAX_PROCURA = 512 * 1024

export function dimensoesDaImagem(src: string | undefined): Dimensoes | null {
  if (!src || !src.startsWith("data:")) return null
  const virgula = src.indexOf(",")
  if (virgula < 0 || !src.slice(0, virgula).endsWith(";base64")) return null
  const leitor = new LeitorBase64(src, virgula + 1)
  try {
    const d = png(leitor) ?? gif(leitor) ?? webp(leitor) ?? jpeg(leitor)
    if (!d || d.largura <= 0 || d.altura <= 0) return null
    return d
  } catch {
    return null
  }
}

/**
 * Asked for a byte past the end. Never reaches the screen: `dimensoesDaImagem`
 * catches it and responds null, and so it needs no code or message.
 */
class ForaDosBytes extends Error {}

/** Random access to bytes of a base64, without decoding it whole. */
class LeitorBase64 {
  private readonly bloco = new Map<number, Uint8Array>()

  constructor(
    private readonly texto: string,
    private readonly inicio: number,
  ) {}

  get comprimento(): number {
    return Math.floor(((this.texto.length - this.inicio) * 3) / 4)
  }

  /** The bytes [from, from + n). Raises if the base64 is invalid or short. */
  bytes(desde: number, n: number): Uint8Array {
    // Blocks of 3 KB aligned to 3 bytes (4 characters): each decodes once.
    const TAMANHO = 3072
    const saida = new Uint8Array(n)
    for (let i = 0; i < n; ) {
      const posicao = desde + i
      const indice = Math.floor(posicao / TAMANHO)
      let bloco = this.bloco.get(indice)
      if (!bloco) {
        const primeiro = this.inicio + (indice * TAMANHO * 4) / 3
        const pedaco = this.texto.slice(primeiro, primeiro + (TAMANHO * 4) / 3)
        if (pedaco.length === 0) throw new ForaDosBytes()
        const binario = atob(pedaco)
        bloco = new Uint8Array(binario.length)
        for (let j = 0; j < binario.length; j++) bloco[j] = binario.charCodeAt(j)
        this.bloco.set(indice, bloco)
      }
      const dentro = posicao - indice * TAMANHO
      if (dentro >= bloco.length) throw new ForaDosBytes()
      const quantos = Math.min(n - i, bloco.length - dentro)
      saida.set(bloco.subarray(dentro, dentro + quantos), i)
      i += quantos
    }
    return saida
  }

  u8(em: number): number {
    return this.bytes(em, 1)[0] ?? 0
  }

  be16(em: number): number {
    const b = this.bytes(em, 2)
    return ((b[0] ?? 0) << 8) | (b[1] ?? 0)
  }

  be32(em: number): number {
    const b = this.bytes(em, 4)
    return (((b[0] ?? 0) << 24) | ((b[1] ?? 0) << 16) | ((b[2] ?? 0) << 8) | (b[3] ?? 0)) >>> 0
  }

  le16(em: number): number {
    const b = this.bytes(em, 2)
    return (b[0] ?? 0) | ((b[1] ?? 0) << 8)
  }

  le24(em: number): number {
    const b = this.bytes(em, 3)
    return (b[0] ?? 0) | ((b[1] ?? 0) << 8) | ((b[2] ?? 0) << 16)
  }

  igual(em: number, assinatura: number[]): boolean {
    if (em + assinatura.length > this.comprimento) return false
    const b = this.bytes(em, assinatura.length)
    return assinatura.every((valor, i) => b[i] === valor)
  }
}

function png(l: LeitorBase64): Dimensoes | null {
  // Assinatura, comprimento do primeiro bloco, e "IHDR".
  if (!l.igual(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || !l.igual(12, [0x49, 0x48, 0x44, 0x52])) return null
  return { largura: l.be32(16), altura: l.be32(20) }
}

function gif(l: LeitorBase64): Dimensoes | null {
  if (!l.igual(0, [0x47, 0x49, 0x46, 0x38])) return null
  return { largura: l.le16(6), altura: l.le16(8) }
}

function webp(l: LeitorBase64): Dimensoes | null {
  if (!l.igual(0, [0x52, 0x49, 0x46, 0x46]) || !l.igual(8, [0x57, 0x45, 0x42, 0x50])) return null
  if (l.igual(12, [0x56, 0x50, 0x38, 0x58])) return { largura: l.le24(24) + 1, altura: l.le24(27) + 1 }
  if (l.igual(12, [0x56, 0x50, 0x38, 0x4c])) {
    if (l.u8(20) !== 0x2f) return null
    const b = l.bytes(21, 4)
    const bits = ((b[0] ?? 0) | ((b[1] ?? 0) << 8) | ((b[2] ?? 0) << 16) | ((b[3] ?? 0) << 24)) >>> 0
    return { largura: (bits & 0x3fff) + 1, altura: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (l.igual(12, [0x56, 0x50, 0x38, 0x20])) {
    if (!l.igual(23, [0x9d, 0x01, 0x2a])) return null
    return { largura: l.le16(26) & 0x3fff, altura: l.le16(28) & 0x3fff }
  }
  return null
}

function jpeg(l: LeitorBase64): Dimensoes | null {
  if (!l.igual(0, [0xff, 0xd8])) return null
  let orientacao = 1
  let em = 2
  const fim = Math.min(l.comprimento, JPEG_MAX_PROCURA)
  while (em + 4 <= fim) {
    if (l.u8(em) !== 0xff) return null
    const marcador = l.u8(em + 1)
    // Padding between segments: several 0xFF in a row are allowed.
    if (marcador === 0xff) {
      em += 1
      continue
    }
    const tamanho = l.be16(em + 2)
    if (tamanho < 2) return null
    // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC), which are not frames.
    if (marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc) {
      const altura = l.be16(em + 5)
      const largura = l.be16(em + 7)
      return orientacao >= 5 && orientacao <= 8 ? { largura: altura, altura: largura } : { largura, altura }
    }
    if (marcador === 0xe1 && l.igual(em + 4, [0x45, 0x78, 0x69, 0x66, 0, 0])) {
      orientacao = orientacaoExif(l, em + 10) ?? orientacao
    }
    // Scan start without SOF before it: not a readable JPEG.
    if (marcador === 0xda) return null
    em += 2 + tamanho
  }
  return null
}

/** Tag 0x0112 from IFD0, starting from the TIFF header in `tiff`. */
function orientacaoExif(l: LeitorBase64, tiff: number): number | null {
  const intel = l.igual(tiff, [0x49, 0x49])
  if (!intel && !l.igual(tiff, [0x4d, 0x4d])) return null
  const u16 = (em: number): number => (intel ? l.le16(em) : l.be16(em))
  const u32 = (em: number): number => (intel ? (l.le16(em) | (l.le16(em + 2) << 16)) >>> 0 : l.be32(em))
  const ifd = tiff + u32(tiff + 4)
  const entradas = u16(ifd)
  for (let i = 0; i < Math.min(entradas, 64); i++) {
    const entrada = ifd + 2 + i * 12
    if (u16(entrada) === 0x0112) return u16(entrada + 8)
  }
  return null
}

import { describe, expect, it } from "vitest"
import { dimensoesDaImagem } from "./dimensoesDaImagem.js"

/**
 * The dimensions read from the header, without decoding the image.
 *
 * The headers are written here by hand, byte by byte, from the specs: a test
 * that generated the image with the same logic that reads it would only prove
 * the logic agrees with itself.
 */
const dataUrl = (tipo: string, bytes: number[]): string =>
  `data:${tipo};base64,${Buffer.from(Uint8Array.from(bytes)).toString("base64")}`

const be16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff]
const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const le16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff]
const le24 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]
const le32 = (n: number): number[] => [...le16(n & 0xffff), ...le16(n >>> 16)]

function png(largura: number, altura: number): number[] {
  return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(largura), ...be32(altura), 8, 6, 0, 0, 0, 0, 0, 0, 0]
}

function gif(largura: number, altura: number): number[] {
  return [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...le16(largura), ...le16(altura), 0, 0, 0]
}

/** A JPEG with an APP0, optionally an APP1 Exif with orientation, and the SOF0. */
function jpeg(largura: number, altura: number, orientacao?: number, preenchimentoApp1 = 0): number[] {
  const app0 = [0xff, 0xe0, ...be16(16), 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
  let app1: number[] = []
  if (orientacao !== undefined) {
    // TIFF big-endian: header, IFD0 with one entry (0x0112, SHORT, 1).
    const tiff = [0x4d, 0x4d, 0, 42, ...be32(8), ...be16(1), ...be16(0x0112), ...be16(3), ...be32(1), ...be16(orientacao), 0, 0, ...be32(0)]
    const corpo = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, ...new Array<number>(preenchimentoApp1).fill(0)]
    app1 = [0xff, 0xe1, ...be16(corpo.length + 2), ...corpo]
  }
  const sof0 = [0xff, 0xc0, ...be16(17), 8, ...be16(altura), ...be16(largura), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
  return [0xff, 0xd8, ...app0, ...app1, ...sof0, 0xff, 0xd9]
}

function webpVp8x(largura: number, altura: number): number[] {
  return [0x52, 0x49, 0x46, 0x46, ...le32(30), 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, ...le32(10), 0, 0, 0, 0, ...le24(largura - 1), ...le24(altura - 1)]
}

function webpVp8l(largura: number, altura: number): number[] {
  const bits = (largura - 1) | ((altura - 1) << 14)
  return [0x52, 0x49, 0x46, 0x46, ...le32(30), 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, ...le32(10), 0x2f, ...le32(bits >>> 0)]
}

function webpVp8(largura: number, altura: number): number[] {
  return [0x52, 0x49, 0x46, 0x46, ...le32(30), 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, ...le32(10), 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(largura), ...le16(altura)]
}

describe("dimensoesDaImagem", () => {
  it("lê um PNG", () => {
    expect(dimensoesDaImagem(dataUrl("image/png", png(640, 360)))).toEqual({ largura: 640, altura: 360 })
  })

  it("lê um GIF", () => {
    expect(dimensoesDaImagem(dataUrl("image/gif", gif(320, 240)))).toEqual({ largura: 320, altura: 240 })
  })

  it("lê um JPEG simples", () => {
    expect(dimensoesDaImagem(dataUrl("image/jpeg", jpeg(1600, 1200)))).toEqual({ largura: 1600, altura: 1200 })
  })

  it("troca largura e altura quando o Exif diz que a fotografia está deitada", () => {
    // The browser applies orientation (`image-orientation: from-image`): the
    // reserved box must be that of the image as seen, not as stored.
    expect(dimensoesDaImagem(dataUrl("image/jpeg", jpeg(4032, 3024, 6)))).toEqual({ largura: 3024, altura: 4032 })
    expect(dimensoesDaImagem(dataUrl("image/jpeg", jpeg(4032, 3024, 1)))).toEqual({ largura: 4032, altura: 3024 })
  })

  it("salta um APP1 grande sem descodificar o que está dentro dele", () => {
    expect(dimensoesDaImagem(dataUrl("image/jpeg", jpeg(800, 600, 8, 40_000)))).toEqual({ largura: 600, altura: 800 })
  })

  it("lê os três sabores de WebP", () => {
    expect(dimensoesDaImagem(dataUrl("image/webp", webpVp8x(1600, 1200)))).toEqual({ largura: 1600, altura: 1200 })
    expect(dimensoesDaImagem(dataUrl("image/webp", webpVp8l(900, 1400)))).toEqual({ largura: 900, altura: 1400 })
    expect(dimensoesDaImagem(dataUrl("image/webp", webpVp8(1280, 720)))).toEqual({ largura: 1280, altura: 720 })
  })

  it("não inventa: um formato que não conhece, um endereço ou lixo dão nulo", () => {
    expect(dimensoesDaImagem(undefined)).toBeNull()
    expect(dimensoesDaImagem("https://exemplo.pt/a.png")).toBeNull()
    expect(dimensoesDaImagem("data:image/avif;base64,AAAAHGZ0eXBhdmlm")).toBeNull()
    expect(dimensoesDaImagem("data:image/png;base64,isto-nao-e-base64")).toBeNull()
    expect(dimensoesDaImagem(dataUrl("image/jpeg", [0xff, 0xd8, 0xff, 0xe0, 0, 2]))).toBeNull()
    expect(dimensoesDaImagem(dataUrl("image/png", png(0, 10)))).toBeNull()
  })

  it("lê pelo conteúdo e não pelo tipo declarado, que quem envia escolhe", () => {
    expect(dimensoesDaImagem(dataUrl("image/jpeg", png(10, 20)))).toEqual({ largura: 10, altura: 20 })
  })
})

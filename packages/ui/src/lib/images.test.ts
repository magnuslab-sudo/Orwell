import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  avisoDeAnimacaoPerdida,
  compressImage,
  dataUrlBytes,
  IMAGE_BUDGETS,
  resetFormatoDetectado,
  type CompressDeps,
} from "./images.js"

/**
 * Compression is the difference between a server that holds up and one that doesn't.
 *
 * 512 KB avatars replicated per channel nearly consumed an entire database on a real
 * server, and that's the hole these assertions plug. What we prove here: that a large
 * image comes out small, that an image already fitting isn't damaged needlessly, and
 * that failure happens in the send buffer, not silently on the receive end, an
 * oversized payload is discarded entirely on the other side, and three discards mark
 * the channel as deaf.
 */

/**
 * A fake canvas with a predictable output size.
 *
 * jsdom can't draw, and installing a graphics engine to prove budget arithmetic would
 * trade a fast test for a slow one. What matters is the LADDER: quality drops before
 * size, and size drops when quality runs out.
 */
function canvasFalso(bytesPorPixelAQualidadeUm = 0.5): () => HTMLCanvasElement {
  return () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => undefined }),
      toDataURL(tipo?: string, qualidade?: number): string {
        // Format detection asks for webp with a 1×1 canvas.
        if (qualidade === undefined) return `data:${tipo ?? "image/png"};base64,AA==`
        const bytes = Math.max(4, Math.round(canvas.width * canvas.height * bytesPorPixelAQualidadeUm * qualidade))
        // Four base64 characters for every three bytes.
        return `data:${tipo ?? "image/jpeg"};base64,${"A".repeat(Math.ceil(bytes / 3) * 4)}`
      },
    }
    return canvas as unknown as HTMLCanvasElement
  }
}

function deps(largura: number, altura: number, bytesPorPixel = 0.5): CompressDeps {
  return {
    decode: async () => ({ width: largura, height: altura }),
    createCanvas: canvasFalso(bytesPorPixel),
    draw: () => undefined,
  }
}

/** A file with the size requested of it, and nothing inside that matters. */
function ficheiro(bytes: number, tipo = "image/png"): Blob {
  return new Blob([new Uint8Array(bytes)], { type: tipo })
}

beforeEach(() => resetFormatoDetectado())

describe("dataUrlBytes", () => {
  it("conta os bytes a sério e não os caracteres", () => {
    // Without this account, every budget would measure 33 % too high, base64
    // costs four characters for every three bytes.
    expect(dataUrlBytes("data:image/png;base64,AAAA")).toBe(3)
    expect(dataUrlBytes("data:image/png;base64,AAA=")).toBe(2)
    expect(dataUrlBytes("data:image/png;base64,AA==")).toBe(1)
  })

  it("uma coisa que não é data URL vale zero em vez de rebentar", () => {
    expect(dataUrlBytes("")).toBe(0)
    expect(dataUrlBytes("não é nada disto")).toBe(0)
  })
})

describe("compressImage", () => {
  it("uma imagem que já cabe passa intacta — é o que salva os GIF e a transparência", async () => {
    // Recoding a small PNG to JPEG loses transparency and gains artifacts; recoding
    // an animated GIF kills the animation. What already fits the budget has nothing
    // to gain from being touched.
    const original = ficheiro(10_000, "image/gif")
    const saida = await compressImage(original, IMAGE_BUDGETS.chat, deps(400, 300))
    expect(saida.recoded).toBe(false)
    expect(saida.dataUrl.startsWith("data:image/gif")).toBe(true)
  })

  it("uma imagem grande de mais em bytes é recomprimida até caber", async () => {
    const saida = await compressImage(ficheiro(4_000_000, "image/jpeg"), IMAGE_BUDGETS.chat, deps(1200, 900))
    expect(saida.recoded).toBe(true)
    expect(saida.bytes).toBeLessThanOrEqual(IMAGE_BUDGETS.chat.maxBytes)
  })

  it("uma imagem grande de mais em pixels é redesenhada dentro do lado máximo", async () => {
    // 4000×3000 is any phone photo. Comes out at 1600 on the long side,
    // aspect ratio intact, a stretched image would be worse than a large one.
    const saida = await compressImage(ficheiro(8_000_000, "image/jpeg"), IMAGE_BUDGETS.chat, deps(4000, 3000, 0.02))
    expect(Math.max(saida.width, saida.height)).toBeLessThanOrEqual(IMAGE_BUDGETS.chat.maxSide)
    expect(saida.width / saida.height).toBeCloseTo(4 / 3, 1)
  })

  it("a qualidade desce antes do tamanho: uma imagem que cabe a 1600 px fica a 1600 px", async () => {
    // The opposite, shrink first, would give an unrecognizable face in
    // a photo that only needed lower quality.
    const saida = await compressImage(ficheiro(3_000_000, "image/jpeg"), IMAGE_BUDGETS.chat, deps(1600, 1600, 0.2))
    expect(saida.width).toBe(1600)
    expect(saida.bytes).toBeLessThanOrEqual(IMAGE_BUDGETS.chat.maxBytes)
  })

  it("esgotada a escada de qualidade, o lado maior corta-se a meio", async () => {
    // An image too dense to fit at 1600 px on worst quality must shrink,
    // otherwise the only outcome would be rejection.
    const saida = await compressImage(ficheiro(9_000_000, "image/jpeg"), IMAGE_BUDGETS.chat, deps(1600, 1600, 2))
    expect(saida.width).toBeLessThan(1600)
    expect(saida.bytes).toBeLessThanOrEqual(IMAGE_BUDGETS.chat.maxBytes)
  })

  it("um avatar de 512 KB — o que encheu a base de dados — sai abaixo dos 96 KB", async () => {
    const saida = await compressImage(ficheiro(512 * 1024, "image/jpeg"), IMAGE_BUDGETS.avatar, deps(1024, 1024, 0.2))
    expect(saida.bytes).toBeLessThanOrEqual(IMAGE_BUDGETS.avatar.maxBytes)
    expect(Math.max(saida.width, saida.height)).toBeLessThanOrEqual(256)
  })

  it("o que não é imagem falha com uma frase, não com um payload que o receptor deita fora", async () => {
    await expect(
      compressImage(ficheiro(9_000, "application/pdf"), IMAGE_BUDGETS.chat, {
        decode: () => Promise.reject(new Error("not an image")),
        createCanvas: canvasFalso(),
        draw: () => undefined,
      }),
    ).rejects.toThrow("this is not an image this device can read")
  })

  it("não devolve pior do que recebeu: o que já cabia em bytes fica como está", async () => {
    // The case is a text screenshot or diagram: four thousand pixels on a side
    // and one hundred kilobytes, because PNG loves flat surfaces. Redrawing it
    // at 1600 px in JPEG gives a LARGER image with artifacts over the letters, // worse on both counts that matter. Shrinking what's already fine is how a
    // compressor becomes damage.
    const diagrama = ficheiro(100_000, "image/png")
    const saida = await compressImage(diagrama, IMAGE_BUDGETS.chat, deps(4000, 3000, 0.5))
    expect(saida.recoded).toBe(false)
    expect(saida.bytes).toBe(100_000)
    expect(saida.dataUrl.startsWith("data:image/png")).toBe(true)
  })

  it("mas troca na mesma quando a troca compensa", async () => {
    // The other side of the same rule: a 100 KB phone photo at 4000 px that comes
    // out at 24 KB after redrawing is a good trade, and it must happen.
    const fotografia = ficheiro(100_000, "image/jpeg")
    const saida = await compressImage(fotografia, IMAGE_BUDGETS.chat, deps(4000, 3000, 0.01))
    expect(saida.recoded).toBe(true)
    expect(saida.bytes).toBeLessThan(100_000)
  })

  it("pede a orientação da fotografia ao descodificador, senão os telemóveis saem deitados", async () => {
    // A phone photo is saved landscape with an EXIF tag saying "rotate this 90°".
    // Someone drawing the bitmap on a canvas without asking for orientation draws
    // the pixels as stored, flips the photo, and flips it for good: recoding throws
    // the EXIF tag away, which is the privacy advantage of this step, because with
    // it goes location and camera model, and then there's no way to straighten it.
    const pedidos: unknown[] = []
    vi.stubGlobal("createImageBitmap", (blob: Blob, opcoes?: unknown) => {
      pedidos.push(opcoes)
      return Promise.resolve({ width: 4000, height: 3000, close: () => undefined })
    })
    try {
      await compressImage(ficheiro(4_000_000, "image/jpeg"), IMAGE_BUDGETS.chat, {
        createCanvas: canvasFalso(0.02),
        draw: () => undefined,
      })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(pedidos).toEqual([{ imageOrientation: "from-image" }])
  })

  it("sem descodificador, o que cabe passa e o que não cabe é recusado aqui", async () => {
    // An environment without `createImageBitmap` can't shrink anything. Letting it
    // through anyway would send a message the other side discards entirely and silently.
    const semDecoder: CompressDeps = { createCanvas: canvasFalso(), draw: () => undefined }
    const pequena = await compressImage(ficheiro(1_000), IMAGE_BUDGETS.chat, semDecoder)
    expect(pequena.recoded).toBe(false)
    await expect(compressImage(ficheiro(2_000_000), IMAGE_BUDGETS.chat, semDecoder)).rejects.toThrow()
  })
})

/**
 * The animated GIF in avatar and icon (phase 1c, owner decision on October 27,
 * 2026).
 *
 * A GIF up to 160 kB passes intact, even larger than 256 px: redrawing it would
 * recode it, and the animation would die. Above that it stops, and we say so. Other
 * images don't change: a large PNG or JPEG in pixels still gets redrawn at 256 px.
 */
describe("compressImage — o GIF animado", () => {
  it("um GIF leve e grande em pixels passa intacto, e animado", async () => {
    const original = ficheiro(150 * 1024, "image/gif")
    for (const orcamento of [IMAGE_BUDGETS.avatar, IMAGE_BUDGETS.icon]) {
      const saida = await compressImage(original, orcamento, deps(480, 480))
      expect(saida.recoded).toBe(false)
      expect(saida.dataUrl.startsWith("data:image/gif")).toBe(true)
      expect(saida.width).toBe(480)
      expect(saida.animacaoPerdida).toBeUndefined()
      expect(avisoDeAnimacaoPerdida(original, saida, orcamento)).toBeNull()
    }
  })

  it("no limite exacto, o GIF ainda passa", async () => {
    const saida = await compressImage(ficheiro(160_000, "image/gif"), IMAGE_BUDGETS.avatar, deps(300, 300))
    expect(saida.recoded).toBe(false)
  })

  it("um GIF pesado fica parado, e a frase diz o peso e o máximo", async () => {
    const original = ficheiro(400_000, "image/gif")
    const saida = await compressImage(original, IMAGE_BUDGETS.avatar, deps(480, 480))
    expect(saida.recoded).toBe(true)
    expect(saida.animacaoPerdida).toBe(true)
    expect(saida.bytes).toBeLessThanOrEqual(IMAGE_BUDGETS.avatar.maxBytes)
    expect(Math.max(saida.width, saida.height)).toBeLessThanOrEqual(IMAGE_BUDGETS.avatar.maxSide)
    expect(avisoDeAnimacaoPerdida(original, saida, IMAGE_BUDGETS.avatar)).toBe(
      "O GIF tem 400 kB. Para ficar animado, o máximo é 160 kB. Ficou parado.",
    )
  })

  it("sem descodificador, um GIF dentro do tecto passa, e um acima é recusado", async () => {
    const semDecoder: CompressDeps = { createCanvas: canvasFalso(), draw: () => undefined }
    const leve = await compressImage(ficheiro(150 * 1024, "image/gif"), IMAGE_BUDGETS.avatar, semDecoder)
    expect(leve.recoded).toBe(false)
    await expect(compressImage(ficheiro(200 * 1024, "image/gif"), IMAGE_BUDGETS.avatar, semDecoder)).rejects.toThrow()
  })

  it("PNG e JPEG não mudam: grandes em pixels, são redesenhados a 256 px", async () => {
    for (const tipo of ["image/png", "image/jpeg"]) {
      const saida = await compressImage(ficheiro(50 * 1024, tipo), IMAGE_BUDGETS.avatar, deps(480, 480, 0.1))
      expect(saida.recoded).toBe(true)
      expect(Math.max(saida.width, saida.height)).toBe(256)
      expect(saida.animacaoPerdida).toBeUndefined()
    }
    // And a PNG between 96 and 160 KB doesn't get the GIF exemption.
    const pesado = await compressImage(ficheiro(150 * 1024, "image/png"), IMAGE_BUDGETS.avatar, deps(200, 200, 2))
    expect(pesado.recoded).toBe(true)
    expect(pesado.bytes).toBeLessThanOrEqual(IMAGE_BUDGETS.avatar.maxBytes)
  })

  it("noutros orçamentos, um GIF recodificado não promete animação nenhuma", async () => {
    const saida = await compressImage(ficheiro(4_000_000, "image/gif"), IMAGE_BUDGETS.chat, deps(1200, 900))
    expect(saida.recoded).toBe(true)
    expect(saida.animacaoPerdida).toBeUndefined()
  })
})

describe("orçamentos", () => {
  it("a miniatura de link cabe no campo do protocolo depois de base64", async () => {
    // The `LinkCard.thumbnail` field accepts 400,000 characters and the feed squeezes
    // it to 100,000. A byte budget larger than that would produce cards the sender
    // writes and the receiver rejects, with no error on either side.
    const caracteresDepoisDeBase64 = Math.ceil(IMAGE_BUDGETS.thumbnail.maxBytes / 3) * 4
    expect(caracteresDepoisDeBase64).toBeLessThanOrEqual(100_000)
  })

  it("o avatar não é mais generoso do que o ícone de canal", async () => {
    // The avatar travels per person AND per channel; the icon only per channel. If the
    // avatar ever gets fatter than the icon, it was by mistake.
    expect(IMAGE_BUDGETS.avatar.maxBytes).toBeLessThanOrEqual(IMAGE_BUDGETS.icon.maxBytes)
  })
})

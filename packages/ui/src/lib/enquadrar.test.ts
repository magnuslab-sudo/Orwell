import { describe, expect, it, vi } from "vitest"
import {
  ampliar,
  arrastar,
  cortarImagem,
  dataUrlParaBlob,
  enquadramentoInicial,
  limitar,
  PROPORCAO_DA_FORMA,
  recorteDe,
  tamanhoDeSaida,
  zoomMaximo,
  type Recorte,
} from "./enquadrar.js"
import { IMAGE_BUDGETS, type CompressedImage } from "./images.js"

/**
 * The account from the crop, no browser.
 *
 * What comes out of a frame decides here: the image area and the result size. The test
 * with real pixels (the right area in a four-color PNG) is in the script
 * `scripts/retratar-enquadrar.mjs`, which runs on Chromium.
 */

const LARGA = { largura: 1000, altura: 500 }
const ALTA = { largura: 400, altura: 800 }
const UM = PROPORCAO_DA_FORMA.circulo
const CAPA = PROPORCAO_DA_FORMA.capa

describe("enquadrar: a zona que se recorta", () => {
  it("ao abrir, o círculo apanha o maior quadrado ao centro, como o object-fit: cover", () => {
    const r = recorteDe(enquadramentoInicial(LARGA), LARGA, UM)
    expect(r).toEqual({ sx: 250, sy: 0, sw: 500, sh: 500 })
  })

  it("a capa é 16:10: numa imagem alta, a largura inteira e uma faixa ao meio", () => {
    const r = recorteDe(enquadramentoInicial(ALTA), ALTA, CAPA)
    expect(r.sw).toBe(400)
    expect(r.sh).toBe(250)
    expect(r.sx).toBe(0)
    expect(r.sy).toBe(275)
  })

  it("arrastar para a direita mostra o que está à esquerda, à escala da moldura", () => {
    // Frame 272 px wide showing 500 px of the image: 136 px on screen maps to 250 px of the image.
    const depois = arrastar(enquadramentoInicial(LARGA), 136, 0, 272, LARGA, UM)
    expect(recorteDe(depois, LARGA, UM).sx).toBeCloseTo(0)
  })

  it("o recorte nunca sai da imagem, por muito que se arraste", () => {
    const longe = arrastar(enquadramentoInicial(LARGA), -5000, 5000, 272, LARGA, UM)
    const r = recorteDe(longe, LARGA, UM)
    expect(r.sx + r.sw).toBeCloseTo(1000)
    expect(r.sy).toBe(0)
  })

  it("ampliar deixa o ponto do foco parado na moldura", () => {
    const antes = limitar({ zoom: 2, cx: 500, cy: 250 }, LARGA, UM)
    const ra = recorteDe(antes, LARGA, UM)
    const foco = { fx: 0.25, fy: 0.75 }
    const ponto = { x: ra.sx + foco.fx * ra.sw, y: ra.sy + foco.fy * ra.sh }
    const depois = ampliar(antes, 4, foco, LARGA, UM)
    const rd = recorteDe(depois, LARGA, UM)
    expect(rd.sw).toBeCloseTo(125)
    expect(rd.sx + foco.fx * rd.sw).toBeCloseTo(ponto.x)
    expect(rd.sy + foco.fy * rd.sh).toBeCloseTo(ponto.y)
  })

  it("o zoom pára nos oito, ou antes numa imagem pequena", () => {
    expect(zoomMaximo(LARGA, UM)).toBe(8)
    expect(zoomMaximo({ largura: 100, altura: 100 }, UM)).toBeCloseTo(100 / 32)
    expect(ampliar(enquadramentoInicial(LARGA), 50, { fx: 0.5, fy: 0.5 }, LARGA, UM).zoom).toBe(8)
    expect(ampliar(enquadramentoInicial(LARGA), 0.2, { fx: 0.5, fy: 0.5 }, LARGA, UM).zoom).toBe(1)
  })
})

describe("enquadrar: o tamanho do que sai", () => {
  it("o avatar e o ícone param nos 256 px, e saem quadrados ao pixel", () => {
    expect(tamanhoDeSaida({ sx: 0, sy: 0, sw: 500, sh: 500 }, UM, IMAGE_BUDGETS.avatar.maxSide)).toEqual({
      largura: 256,
      altura: 256,
    })
  })

  it("um recorte pequeno não cresce: ampliar no aparelho só gastava bytes", () => {
    expect(tamanhoDeSaida({ sx: 0, sy: 0, sw: 120, sh: 120 }, UM, 256)).toEqual({ largura: 120, altura: 120 })
  })

  it("a capa pára nos 1600 px de largura, e a altura sai da proporção", () => {
    expect(tamanhoDeSaida({ sx: 0, sy: 0, sw: 3200, sh: 2000 }, CAPA, IMAGE_BUDGETS.post.maxSide)).toEqual({
      largura: 1600,
      altura: 1000,
    })
    expect(tamanhoDeSaida({ sx: 0, sy: 0, sw: 999, sh: 624.4 }, CAPA, 1600)).toEqual({ largura: 999, altura: 624 })
  })
})

describe("enquadrar: o corte", () => {
  const resultado: CompressedImage = { dataUrl: "data:image/webp;base64,AAAA", bytes: 3, width: 256, height: 256, recoded: true }

  function montar(medidas = LARGA) {
    const desenhos: { recorte: Recorte; largura: number; altura: number; canvas: { width: number; height: number } }[] = []
    const png = new Blob([new Uint8Array(10)], { type: "image/png" })
    const comprimir = vi.fn(async () => resultado)
    const close = vi.fn()
    const deps = {
      decode: vi.fn(async () => ({ width: medidas.largura, height: medidas.altura, close })),
      createCanvas: () => ({ width: 0, height: 0 }) as unknown as HTMLCanvasElement,
      draw: (canvas: HTMLCanvasElement, _bitmap: unknown, recorte: Recorte, largura: number, altura: number) =>
        desenhos.push({ recorte, largura, altura, canvas: { width: canvas.width, height: canvas.height } }),
      toBlob: vi.fn(async () => png),
      comprimir,
    }
    return { deps, desenhos, png, comprimir, close }
  }

  it("desenha a zona escolhida no tamanho do orçamento, e comprime o PNG pelos tectos", async () => {
    const { deps, desenhos, png, comprimir, close } = montar()
    const ficheiro = new File([new Uint8Array(500_000)], "cara.jpg", { type: "image/jpeg" })
    const recorte = recorteDe(ampliar(enquadramentoInicial(LARGA), 2, { fx: 0, fy: 0 }, LARGA, UM), LARGA, UM)
    const imagem = await cortarImagem(ficheiro, recorte, "circulo", IMAGE_BUDGETS.avatar, deps)

    expect(desenhos).toEqual([{ recorte: { sx: 250, sy: 0, sw: 250, sh: 250 }, largura: 250, altura: 250, canvas: { width: 250, height: 250 } }])
    expect(comprimir).toHaveBeenCalledWith(png, IMAGE_BUDGETS.avatar)
    expect(imagem).toBe(resultado)
    expect(close).toHaveBeenCalled()
  })

  it("sem mexer numa imagem que já tinha a forma certa, passa o ficheiro original", async () => {
    const quadrada = { largura: 300, altura: 300 }
    const { deps, desenhos, comprimir } = montar(quadrada)
    const ficheiro = new File([new Uint8Array(20_000)], "logo.png", { type: "image/png" })
    await cortarImagem(ficheiro, recorteDe(enquadramentoInicial(quadrada), quadrada, UM), "quadrado", IMAGE_BUDGETS.icon, deps)
    expect(desenhos).toEqual([])
    expect(comprimir).toHaveBeenCalledWith(ficheiro, IMAGE_BUDGETS.icon)
  })

  it("um GIF dentro do tecto dos animados não é descodificado: passa como está", async () => {
    const { deps, comprimir } = montar()
    const gif = new File([new Uint8Array(150_000)], "cara.gif", { type: "image/gif" })
    await cortarImagem(gif, { sx: 0, sy: 0, sw: 10, sh: 10 }, "circulo", IMAGE_BUDGETS.avatar, deps)
    expect(deps.decode).not.toHaveBeenCalled()
    expect(comprimir).toHaveBeenCalledWith(gif, IMAGE_BUDGETS.avatar)
  })

  it("um GIF acima do tecto enquadra-se, fica parado, e leva a marca do aviso", async () => {
    const { deps, desenhos } = montar()
    const gif = new File([new Uint8Array(400_000)], "cara.gif", { type: "image/gif" })
    const imagem = await cortarImagem(gif, recorteDe(enquadramentoInicial(LARGA), LARGA, UM), "circulo", IMAGE_BUDGETS.avatar, deps)
    expect(desenhos).toHaveLength(1)
    expect(imagem.animacaoPerdida).toBe(true)
  })

  it("um ficheiro que não se lê dá a frase do compressor", async () => {
    const { deps } = montar()
    deps.decode.mockRejectedValueOnce(new Error("x"))
    await expect(
      cortarImagem(new Blob(["x"], { type: "image/png" }), { sx: 0, sy: 0, sw: 1, sh: 1 }, "capa", IMAGE_BUDGETS.post, deps),
    ).rejects.toThrow("this is not an image this device can read")
  })
})

describe("dataUrlParaBlob", () => {
  it("devolve os mesmos bytes e o mesmo tipo", async () => {
    const blob = dataUrlParaBlob("data:image/png;base64,AAEC/w==")
    expect(blob.type).toBe("image/png")
    // jsdom's Blob has no `arrayBuffer`: it reads the same way the rest of the app does, via FileReader.
    const bytes = await new Promise<ArrayBuffer>((resolve) => {
      const leitor = new FileReader()
      leitor.onload = () => resolve(leitor.result as ArrayBuffer)
      leitor.readAsArrayBuffer(blob)
    })
    expect([...new Uint8Array(bytes)]).toEqual([0, 1, 2, 255])
  })
})

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { IMAGE_BUDGETS, type CompressedImage, type ImageBudget } from "../lib/images.js"
import type { FormaDoEnquadramento, Recorte } from "../lib/enquadrar.js"
import { strings } from "../strings.js"
import { Enquadrar } from "./Enquadrar.js"

/**
 * The crop sheet: gestures reach the account, and "Cancel" changes nothing.
 *
 * jsdom does not load images or measure anything. Image dimensions are entered
 * by hand in the `load` event, and the frame uses the default width (272 px).
 * With a 1000 × 500 image in the circle, the frame shows 500 px of the image:
 * each screen pixel equals 500/272 image pixels.
 */

const RESULTADO: CompressedImage = { dataUrl: "data:image/webp;base64,AAAA", bytes: 3, width: 256, height: 256, recoded: true }

/*
  jsdom has no PointerEvent, and without it `fireEvent.pointerMove` arrives
  without coordinates. A MouseEvent with pointer number and type works for the sheet.
*/
beforeAll(() => {
  if ("PointerEvent" in window) return
  class PointerEventDeTeste extends MouseEvent {
    pointerId: number
    pointerType: string
    constructor(tipo: string, init: PointerEventInit = {}) {
      super(tipo, init)
      this.pointerId = init.pointerId ?? 0
      this.pointerType = init.pointerType ?? "mouse"
    }
  }
  Object.assign(window, { PointerEvent: PointerEventDeTeste })
})

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:imagem")
  URL.revokeObjectURL = vi.fn()
})

afterEach(cleanup)

function abrir({
  forma = "circulo",
  ficheiro = new File([new Uint8Array(500_000)], "cara.jpg", { type: "image/jpeg" }),
  budget = IMAGE_BUDGETS.avatar,
  medidas = { largura: 1000, altura: 500 },
}: { forma?: FormaDoEnquadramento; ficheiro?: File; budget?: ImageBudget; medidas?: { largura: number; altura: number } } = {}) {
  const cortar = vi.fn(async (_f: Blob, _r: Recorte) => RESULTADO)
  const onGuardar = vi.fn()
  const onCancelar = vi.fn()
  render(
    <Enquadrar ficheiro={ficheiro} forma={forma} budget={budget} onGuardar={onGuardar} onCancelar={onCancelar} cortar={cortar} />,
  )
  const img = document.querySelector<HTMLImageElement>(".enquadrar-moldura img")
  if (!img) throw new Error("sem imagem")
  Object.defineProperty(img, "naturalWidth", { value: medidas.largura })
  Object.defineProperty(img, "naturalHeight", { value: medidas.altura })
  fireEvent.load(img)
  const palco = screen.getByRole("group", { name: strings.enquadrar.moldura })
  return { cortar, onGuardar, onCancelar, palco }
}

/** Press "Save" and return the zone that went to the crop. */
async function guardar(cortar: ReturnType<typeof abrir>["cortar"]): Promise<Recorte> {
  fireEvent.click(screen.getByRole("button", { name: strings.enquadrar.guardar }))
  await vi.waitFor(() => expect(cortar).toHaveBeenCalled())
  return cortar.mock.calls[0]![1]
}

const ESCALA = 500 / 272

describe("Enquadrar: a folha", () => {
  it("abre com o título da forma, ao centro, e guarda o recorte inicial", async () => {
    const { cortar, onGuardar } = abrir()
    expect(screen.getByRole("heading", { name: "Enquadrar a fotografia" })).toBeTruthy()
    const recorte = await guardar(cortar)
    expect(recorte).toEqual({ sx: 250, sy: 0, sw: 500, sh: 500 })
    await vi.waitFor(() => expect(onGuardar).toHaveBeenCalledWith(RESULTADO))
  })

  it("arrastar com o rato move o recorte ao contrário do gesto", async () => {
    const { cortar, palco } = abrir()
    fireEvent.pointerDown(palco, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(palco, { pointerId: 1, pointerType: "mouse", clientX: 150, clientY: 100 })
    fireEvent.pointerUp(palco, { pointerId: 1, pointerType: "mouse", clientX: 150, clientY: 100 })
    // After release, moving the mouse no longer drags.
    fireEvent.pointerMove(palco, { pointerId: 1, pointerType: "mouse", clientX: 400, clientY: 100 })
    const recorte = await guardar(cortar)
    expect(recorte.sx).toBeCloseTo(250 - 50 * ESCALA)
    expect(recorte.sy).toBe(0)
  })

  it("a pinça de dois dedos amplia pelo afastamento", async () => {
    const { cortar, palco } = abrir()
    fireEvent.pointerDown(palco, { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 100 })
    fireEvent.pointerDown(palco, { pointerId: 2, pointerType: "touch", clientX: 140, clientY: 100 })
    fireEvent.pointerMove(palco, { pointerId: 2, pointerType: "touch", clientX: 180, clientY: 100 })
    expect(palco.dataset.zoom).toBe("2.00")
    const recorte = await guardar(cortar)
    expect(recorte.sw).toBeCloseTo(250)
  })

  it("a roda do rato amplia, e a barra também", async () => {
    const { cortar, palco } = abrir()
    fireEvent.wheel(palco, { deltaY: -100, clientX: 0, clientY: 0 })
    expect(Number(palco.dataset.zoom)).toBeCloseTo(Math.exp(0.15), 2)

    fireEvent.change(screen.getByLabelText(strings.enquadrar.ampliar), { target: { value: "4" } })
    expect(palco.dataset.zoom).toBe("4.00")
    const recorte = await guardar(cortar)
    expect(recorte.sw).toBeCloseTo(125)
  })

  it("o teclado: setas movem, mais e menos ampliam", async () => {
    const { cortar, palco } = abrir()
    fireEvent.keyDown(palco, { key: "+" })
    expect(palco.dataset.zoom).toBe("1.10")
    fireEvent.keyDown(palco, { key: "-" })
    expect(palco.dataset.zoom).toBe("1.00")
    fireEvent.keyDown(palco, { key: "ArrowLeft" })
    fireEvent.keyDown(palco, { key: "ArrowLeft", shiftKey: true })
    const recorte = await guardar(cortar)
    // Left arrow moves the image left: the crop moves right.
    expect(recorte.sx).toBeCloseTo(250 + (8 + 40) * ESCALA)
  })

  it("a moldura é o primeiro sítio do foco, para o teclado servir logo", () => {
    const { palco } = abrir()
    expect(document.activeElement).toBe(palco)
  })

  it('"Cancelar" e o Escape fecham sem cortar nada', () => {
    const { cortar, onCancelar, onGuardar, palco } = abrir()
    fireEvent.keyDown(palco, { key: "ArrowRight" })
    fireEvent.click(screen.getByRole("button", { name: strings.common.cancel }))
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onCancelar).toHaveBeenCalledTimes(2)
    expect(cortar).not.toHaveBeenCalled()
    expect(onGuardar).not.toHaveBeenCalled()
  })

  it("um GIF animado dentro do tecto não se move nem amplia, e a folha diz porquê", async () => {
    const gif = new File([new Uint8Array(120_000)], "cara.gif", { type: "image/gif" })
    const { cortar, palco } = abrir({ ficheiro: gif })
    expect(screen.getByText(strings.enquadrar.gifFixo)).toBeTruthy()
    expect((screen.getByLabelText(strings.enquadrar.ampliar) as HTMLInputElement).disabled).toBe(true)
    fireEvent.pointerDown(palco, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(palco, { pointerId: 1, pointerType: "mouse", clientX: 200, clientY: 100 })
    fireEvent.keyDown(palco, { key: "+" })
    const recorte = await guardar(cortar)
    expect(recorte).toEqual({ sx: 250, sy: 0, sw: 500, sh: 500 })
  })

  it("a capa é 16:10, com o título dela", async () => {
    const { cortar } = abrir({ forma: "capa", budget: IMAGE_BUDGETS.post, medidas: { largura: 1600, altura: 1600 } })
    expect(screen.getByRole("heading", { name: "Enquadrar a capa" })).toBeTruthy()
    const recorte = await guardar(cortar)
    expect(recorte).toEqual({ sx: 0, sy: 300, sw: 1600, sh: 1000 })
  })

  it("um erro no corte fica na folha, e a folha não fecha", async () => {
    const { cortar, onGuardar } = abrir()
    cortar.mockRejectedValueOnce(new Error("this image is too large even after compression"))
    fireEvent.click(screen.getByRole("button", { name: strings.enquadrar.guardar }))
    expect(await screen.findByText(/demasiado grande/)).toBeTruthy()
    expect(onGuardar).not.toHaveBeenCalled()
  })
})

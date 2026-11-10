import { describe, expect, it, vi } from "vitest"
import { VIDEO_MAX_BYTES } from "@enclave/protocol"
import { codigoDoErro } from "./codigosDeErro.js"
import { traduzirErro } from "../strings.js"
import {
  ACEITA_VIDEO,
  formatarDuracao,
  instanteDaMiniatura,
  lerVideo,
  tipoDoVideo,
  validarAntesDeLer,
} from "./videos.js"

describe("antes de ler", () => {
  it("aceita só MP4, WebM e MOV, e lê a extensão quando o ficheiro vem sem tipo", () => {
    expect(ACEITA_VIDEO).toBe("video/mp4,video/webm,video/quicktime")
    expect(tipoDoVideo({ type: "", name: "Praia.MOV" })).toBe("video/quicktime")
    expect(tipoDoVideo({ type: "", name: "a.webm" })).toBe("video/webm")
    expect(tipoDoVideo({ type: "", name: "a.avi" })).toBe("")
    expect(validarAntesDeLer({ type: "video/mp4", size: 10 })).toBe("video/mp4")
    expect(() => validarAntesDeLer({ type: "video/x-msvideo", size: 10 })).toThrow("this video format is not accepted")
    expect(() => validarAntesDeLer({ type: "video/mp4", size: VIDEO_MAX_BYTES + 1 })).toThrow("the video is too large")
  })

  it("cada recusa tem código próprio e uma frase com o tecto", () => {
    const codigos = [
      "the video is too large",
      "the video is too long",
      "this video format is not accepted",
      "the video upload was cancelled",
      "could not read this video",
    ].map(codigoDoErro)
    expect(codigos).toEqual([508, 509, 510, 511, 512])
    const grande = new Error("the video is too large", { cause: { max: VIDEO_MAX_BYTES } })
    expect(traduzirErro(grande)).toContain("25 MB")
    expect(traduzirErro(grande)).toContain("508")
  })

  it("a duração em minutos e segundos, e a miniatura a 1 s (ou a meio de um vídeo mais curto)", () => {
    expect(formatarDuracao(0)).toBe("0:00")
    expect(formatarDuracao(65.4)).toBe("1:05")
    expect(formatarDuracao(90)).toBe("1:30")
    expect(instanteDaMiniatura(30)).toBe(1)
    expect(instanteDaMiniatura(1.2)).toBe(0.6)
  })
})

/** A fake `<video>`: fires the events the browser would fire. */
class VideoFalso extends EventTarget {
  muted = false
  playsInline = false
  preload = ""
  videoWidth = 1920
  videoHeight = 1080
  #duracao: number
  #src = ""
  pedidos: number[] = []
  constructor(
    duracao: number,
    readonly medida = duracao,
    readonly falha = false,
  ) {
    super()
    this.#duracao = duracao
  }
  get duration(): number {
    return this.#duracao
  }
  set src(valor: string) {
    this.#src = valor
    setTimeout(() => this.dispatchEvent(new Event(this.falha ? "error" : "loadedmetadata")), 0)
  }
  get src(): string {
    return this.#src
  }
  set currentTime(valor: number) {
    this.pedidos.push(valor)
    if (this.#duracao === Infinity) {
      this.#duracao = this.medida
      setTimeout(() => this.dispatchEvent(new Event("durationchange")), 0)
      return
    }
    setTimeout(() => this.dispatchEvent(new Event("seeked")), 0)
  }
  removeAttribute(): void {}
}

function canvasFalso(): { canvas: HTMLCanvasElement; desenhos: number[][] } {
  const desenhos: number[][] = []
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: (_v: unknown, x: number, y: number, w: number, h: number) => desenhos.push([x, y, w, h]) }),
    toBlob: (feito: (blob: Blob | null) => void) => feito(new Blob(["png"], { type: "image/png" })),
  } as unknown as HTMLCanvasElement
  return { canvas, desenhos }
}

describe("lerVideo", () => {
  const deps = (video: VideoFalso, canvas: HTMLCanvasElement) => ({
    criarVideo: () => video as unknown as HTMLVideoElement,
    criarCanvas: () => canvas,
    urlDe: () => "blob:teste",
    largar: vi.fn(),
    comprimir: async () => ({ dataUrl: "data:image/webp;base64,AAAA" }),
    prazoMs: 1_000,
  })

  it("lê a duração, procura o fotograma a 1 s, desenha-o a 640 px e devolve a miniatura reduzida", async () => {
    const video = new VideoFalso(30)
    const { canvas, desenhos } = canvasFalso()
    const d = deps(video, canvas)
    const lido = await lerVideo(new Blob(["x"]), d)
    expect(lido).toEqual({ duration: 30, largura: 1920, altura: 1080, poster: "data:image/webp;base64,AAAA" })
    expect(video.pedidos).toEqual([1])
    expect(desenhos[0]).toEqual([0, 0, 640, 360])
    expect(d.largar).toHaveBeenCalledWith("blob:teste")
  })

  it("um WebM sem duração no cabeçalho (Infinity) é medido antes", async () => {
    const video = new VideoFalso(Infinity, 4)
    const { canvas } = canvasFalso()
    const lido = await lerVideo(new Blob(["x"]), deps(video, canvas))
    expect(lido.duration).toBe(4)
    expect(video.pedidos).toEqual([Number.MAX_SAFE_INTEGER, 1])
  })

  it("recusa o que passa dos 90 s, e o que este browser não abre", async () => {
    const { canvas } = canvasFalso()
    await expect(lerVideo(new Blob(["x"]), deps(new VideoFalso(91), canvas))).rejects.toThrow("the video is too long")
    await expect(lerVideo(new Blob(["x"]), deps(new VideoFalso(5, 5, true), canvas))).rejects.toThrow("could not read this video")
  })
})

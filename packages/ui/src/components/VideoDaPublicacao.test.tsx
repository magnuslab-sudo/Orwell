import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { BridgeContext } from "../App.js"
import type { DesfechoDoAnexo, EnclaveBridge, EstadoDoVideo, EventoDoVideo } from "../bridge.js"
import { strings } from "../strings.js"
import type { MediaItem } from "../types.js"
import { AnexosDoItem } from "./AnexoAPedido.js"
import { Carrossel } from "./Carrossel.js"
import { FileAttachments, separarAnexos } from "./FileAttachments.js"
import { PostImages } from "./PostImages.js"
import { moradaDeTeste } from "../../testes/moradas.js"

const MURAL_ANA = moradaDeTeste("mural ana", "s")

/** The video of a post, in the grid and in the carousel. */

const SHA = "A".repeat(43)
const POSTER = "data:image/webp;base64,UklGRg=="
const VIDEO: MediaItem = {
  name: "praia.mp4",
  mediaType: "video/mp4",
  duration: 12,
  byteLength: 3_000_000,
  poster: POSTER,
  partes: { n: 3, sha256: SHA, bytes: 1_048_576 },
}
const FOTO: MediaItem = { name: "a.png", mediaType: "image/png", inline: "data:image/png;base64,iVBORw0KGgo=" }

let criados: Blob[] = []
beforeEach(() => {
  criados = []
  // jsdom has no `createObjectURL`: a stub that stores what you give it.
  URL.createObjectURL = vi.fn((blob: Blob) => {
    criados.push(blob)
    return `blob:teste/${criados.length}`
  })
  URL.revokeObjectURL = vi.fn()
  HTMLMediaElement.prototype.play = vi.fn(async () => {})
  // jsdom also has no `pause`: the player stops when it drops the bytes.
  HTMLMediaElement.prototype.pause = vi.fn()
})
afterEach(cleanup)

interface Ponte {
  estado: EstadoDoVideo
  bytes: Uint8Array | null
  pedir?: (id: unknown) => Promise<DesfechoDoAnexo>
}

function montar(ponte: Ponte, lista: MediaItem[] = [VIDEO], comCarrossel = false) {
  const ouvintes = new Set<(evento: EventoDoVideo) => void>()
  const video = {
    publicar: vi.fn(),
    cancelar: vi.fn(),
    estado: vi.fn(async () => ponte.estado),
    bytes: vi.fn(async () => ponte.bytes),
  }
  const bridge = {
    video,
    ...(ponte.pedir ? { anexo: { pedir: vi.fn(ponte.pedir) } } : {}),
    on: {
      video: (ouvinte: (evento: EventoDoVideo) => void) => {
        ouvintes.add(ouvinte)
        return () => ouvintes.delete(ouvinte)
      },
    },
  } as unknown as EnclaveBridge
  render(
    <BridgeContext.Provider value={bridge}>
      <AnexosDoItem.Provider value={{ channel: MURAL_ANA, alvo: "post-1", lista }}>
        {comCarrossel ? <Carrossel media={lista} /> : <PostImages media={lista} />}
      </AnexosDoItem.Provider>
    </BridgeContext.Provider>,
  )
  const emitir = (evento: EventoDoVideo): void => {
    act(() => {
      for (const ouvinte of ouvintes) ouvinte(evento)
    })
  }
  return { video, bridge, emitir }
}

async function tocar(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: strings.social.videoPlay("praia.mp4", "0:12") }))
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

describe("VideoDaPublicacao", () => {
  it("mostra a miniatura e o botão de tocar, sem leitor e sem reprodução automática", () => {
    montar({ estado: { fase: "pronto" }, bytes: new Uint8Array([1, 2, 3]) })
    expect(document.querySelector(".video-tocar img")?.getAttribute("src")).toBe(POSTER)
    expect(document.querySelector("video")).toBeNull()
    expect(screen.getByText("0:12")).toBeTruthy()
  })

  it("ao tocar, abre um <video controls playsinline preload=none> a partir de um blob: com o tipo do vídeo", async () => {
    const { video } = montar({ estado: { fase: "pronto" }, bytes: new Uint8Array([1, 2, 3]) })
    await tocar()
    expect(video.bytes).toHaveBeenCalledWith(SHA)
    const leitor = document.querySelector("video")!
    expect(leitor.getAttribute("src")).toBe("blob:teste/1")
    expect(leitor.hasAttribute("controls")).toBe(true)
    expect(leitor.hasAttribute("playsinline")).toBe(true)
    expect(leitor.getAttribute("preload")).toBe("none")
    expect(leitor.hasAttribute("autoplay")).toBe(false)
    expect(criados[0]?.type).toBe("video/mp4")
  })

  it("um tipo que não é de vídeo não toca, nem num blob:", async () => {
    const lista = [{ ...VIDEO, mediaType: "text/html" }]
    montar({ estado: { fase: "pronto" }, bytes: new Uint8Array([1]) }, lista)
    // Not a video: a file, drawn in the file row (grid does nothing).
    expect(document.querySelector(".video-da-publicacao")).toBeNull()
    expect(criados).toHaveLength(0)
  })

  it("enquanto chega, diz a parte; pronto, toca", async () => {
    const ponte: Ponte = { estado: { fase: "a-receber", feitas: 1, de: 3 }, bytes: null }
    const { emitir } = montar(ponte)
    emitir({ sha: SHA, fase: "a-receber", feitas: 2, de: 3 })
    expect(screen.getByRole("status").textContent).toBe(strings.social.videoReceiving(2, 3))
    emitir({ sha: "B".repeat(43), fase: "a-receber", feitas: 3, de: 9 })
    expect(screen.getByRole("status").textContent).toBe(strings.social.videoReceiving(2, 3))
    emitir({ sha: SHA, fase: "pronto" })
    expect(screen.queryByRole("status")).toBeNull()
    ponte.estado = { fase: "pronto" }
    ponte.bytes = new Uint8Array([9])
    await tocar()
    expect(document.querySelector("video")).not.toBeNull()
  })

  it("sem os bytes: diz que não está neste aparelho e pede aos outros membros (S5), na posição certa", async () => {
    const ponte: Ponte = {
      estado: { fase: "sem-bytes" },
      bytes: null,
      pedir: async () => {
        ponte.estado = { fase: "pronto" }
        ponte.bytes = new Uint8Array([7, 7])
        return { ok: true, anexo: VIDEO as Record<string, unknown> }
      },
    }
    const { bridge } = montar(ponte, [FOTO, VIDEO])
    await tocar()
    expect(screen.getByRole("status").textContent).toBe(strings.social.videoNotHere)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.sincronia.anexoPedir }))
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(bridge.anexo?.pedir).toHaveBeenCalledWith({ channel: MURAL_ANA, alvo: "post-1", indice: 1 })
    expect(document.querySelector("video")?.getAttribute("src")).toMatch(/^blob:/)
  })

  it("se ninguém o tem, diz a frase do limite, e o botão fica para tentar outra vez", async () => {
    montar({ estado: { fase: "sem-bytes" }, bytes: null, pedir: async () => ({ ok: false, motivo: "ninguem" }) })
    await tocar()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.sincronia.anexoPedir }))
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(screen.getByRole("status").textContent).toBe(strings.social.videoNobody)
    expect(screen.getByRole("button", { name: strings.sincronia.anexoPedir })).toBeTruthy()
  })

  it("no carrossel, junto com as fotografias, e o arrasto nos controlos não passa de fotografia", async () => {
    montar({ estado: { fase: "pronto" }, bytes: new Uint8Array([1]) }, [VIDEO, FOTO], true)
    await tocar()
    const leitor = document.querySelector("video")!
    const palco = document.querySelector(".carrossel-palco")!
    fireEvent.pointerDown(leitor, { clientX: 300 })
    fireEvent.pointerUp(palco, { clientX: 100 })
    expect(document.querySelector("video")).not.toBeNull()
    expect(screen.getByText("1/2")).toBeTruthy()
  })
})

describe("compatibilidade: um vídeo sem partes (como um cliente 0.8.0 o guarda)", () => {
  it("é um ficheiro: a linha mostra o nome", () => {
    const antigo: MediaItem = { name: "praia.mp4", mediaType: "video/mp4" }
    const { imagens, ficheiros } = separarAnexos([antigo])
    expect(imagens).toHaveLength(0)
    render(<FileAttachments files={ficheiros} />)
    expect(screen.getByText("praia.mp4")).toBeTruthy()
  })
})

describe("VideoDaPublicacao — revisão de 26/10/2026 (recomendação 13)", () => {
  it("o primeiro play() sai no gesto, antes de os bytes chegarem (iOS)", async () => {
    let entregar: (bytes: Uint8Array) => void = () => {}
    const { video } = montar({ estado: { fase: "pronto" }, bytes: null })
    video.bytes.mockImplementation(() => new Promise<Uint8Array | null>((resolver) => (entregar = resolver)))
    const play = HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>
    play.mockClear()
    fireEvent.click(screen.getByRole("button", { name: strings.social.videoPlay("praia.mp4", "0:12") }))
    // Still within the gesture: no `await` has passed yet.
    expect(play).toHaveBeenCalledTimes(1)
    const doGesto = play.mock.contexts[0] as HTMLVideoElement
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve()
      entregar(new Uint8Array([1, 2, 3]))
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })
    // The player on screen is the same element the gesture touched.
    expect(document.querySelector("video")).toBe(doGesto)
    expect(doGesto.getAttribute("src")).toBe("blob:teste/1")
  })

  it("acabado o vídeo, o blob: é revogado e volta a miniatura", async () => {
    montar({ estado: { fase: "pronto" }, bytes: new Uint8Array([1, 2, 3]) })
    await tocar()
    const leitor = document.querySelector("video")!
    act(() => {
      leitor.dispatchEvent(new Event("ended"))
    })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:teste/1")
    expect(document.querySelector("video")).toBeNull()
    expect(document.querySelector(".video-tocar img")).not.toBeNull()
  })

  it("em pausa mais de um minuto, larga os bytes; a tocar outra vez antes disso, não", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      montar({ estado: { fase: "pronto" }, bytes: new Uint8Array([1, 2, 3]) })
      await tocar()
      const leitor = document.querySelector("video")!
      act(() => {
        leitor.dispatchEvent(new Event("pause"))
        vi.advanceTimersByTime(30_000)
        leitor.dispatchEvent(new Event("play"))
        vi.advanceTimersByTime(60_000)
      })
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      act(() => {
        leitor.dispatchEvent(new Event("pause"))
        vi.advanceTimersByTime(60_000)
      })
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:teste/1")
      expect(document.querySelector("video")).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("ao sair do ecrã, larga os bytes", async () => {
    const vigias: { chamar: (entradas: { isIntersecting: boolean }[]) => void }[] = []
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(chamar: (entradas: { isIntersecting: boolean }[]) => void) {
          vigias.push({ chamar })
        }
        observe(): void {}
        disconnect(): void {}
      },
    )
    try {
      montar({ estado: { fase: "pronto" }, bytes: new Uint8Array([1, 2, 3]) })
      await tocar()
      expect(vigias).toHaveLength(1)
      act(() => vigias[0]!.chamar([{ isIntersecting: false }]))
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:teste/1")
      expect(document.querySelector("video")).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("ao desmontar, o blob: é revogado", async () => {
    montar({ estado: { fase: "pronto" }, bytes: new Uint8Array([1, 2, 3]) })
    await tocar()
    cleanup()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:teste/1")
  })
})

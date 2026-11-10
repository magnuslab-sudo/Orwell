import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { strings } from "../../strings.js"
import { ScreenStage } from "./ScreenStage.js"

/**
 * Full screen for screen sharing. Requested by the owner on November 2, 2026:
 * "I want a full-screen option for screen sharing".
 *
 * A button in the corner of the stage and double-clicking the screen put the
 * stage in full screen; the same button, double-click, or Escape take it out.
 * On iPhone, where only `<video>` goes full screen, the stage uses the system
 * player.
 */

afterEach(cleanup)
vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

function fluxo(): MediaStream {
  const imagem = { kind: "video", id: "v" }
  return {
    id: "ecra",
    getTracks: () => [imagem],
    getVideoTracks: () => [imagem],
    getAudioTracks: () => [],
  } as unknown as MediaStream
}

const palco = (): HTMLElement => document.querySelector(".call-palco") as HTMLElement
const video = (): HTMLVideoElement => document.querySelector(".call-palco video") as HTMLVideoElement

let emEcraInteiro: Element | null = null
const pedir = vi.fn(function (this: Element) {
  emEcraInteiro = this
  document.dispatchEvent(new Event("fullscreenchange"))
  return Promise.resolve()
})
const sair = vi.fn(() => {
  emEcraInteiro = null
  document.dispatchEvent(new Event("fullscreenchange"))
  return Promise.resolve()
})

beforeEach(() => {
  emEcraInteiro = null
  pedir.mockClear()
  sair.mockClear()
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => emEcraInteiro })
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => true })
  Object.defineProperty(document, "exitFullscreen", { configurable: true, value: sair })
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: pedir })
})

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen")
  Reflect.deleteProperty(document, "fullscreenElement")
  Reflect.deleteProperty(document, "fullscreenEnabled")
  Reflect.deleteProperty(document, "exitFullscreen")
})

describe("o ecrã inteiro no palco", () => {
  it("o botão põe o palco inteiro em ecrã inteiro, e o mesmo botão tira-o", async () => {
    render(<ScreenStage stream={fluxo()} label="Ecrã da Ana" />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.call.ecraInteiro }))
    })
    expect(pedir).toHaveBeenCalledTimes(1)
    expect(pedir.mock.contexts[0]).toBe(palco())
    const saida = screen.getByRole("button", { name: strings.call.sairDoEcraInteiro })
    await act(async () => {
      fireEvent.click(saida)
    })
    expect(sair).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: strings.call.ecraInteiro })).toBeTruthy()
  })

  it("o duplo clique no ecrã entra e sai do ecrã inteiro", async () => {
    render(<ScreenStage stream={fluxo()} label="Ecrã da Ana" />)
    await act(async () => {
      fireEvent.doubleClick(video())
    })
    expect(pedir).toHaveBeenCalledTimes(1)
    await act(async () => {
      fireEvent.doubleClick(video())
    })
    expect(sair).toHaveBeenCalledTimes(1)
  })

  it('sair pelo Esc (o browser tira o ecrã inteiro) volta a mostrar "Ver em ecrã inteiro"', async () => {
    render(<ScreenStage stream={fluxo()} label="Ecrã da Ana" />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.call.ecraInteiro }))
    })
    await act(async () => {
      emEcraInteiro = null
      document.dispatchEvent(new Event("fullscreenchange"))
    })
    expect(screen.getByRole("button", { name: strings.call.ecraInteiro })).toBeTruthy()
  })

  it("no iPhone, sem ecrã inteiro de elemento, usa o leitor do sistema", async () => {
    Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen")
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => false })
    const leitor = vi.fn()
    Object.defineProperty(HTMLVideoElement.prototype, "webkitEnterFullscreen", { configurable: true, value: leitor })
    try {
      render(<ScreenStage stream={fluxo()} label="Ecrã da Ana" />)
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: strings.call.ecraInteiro }))
      })
      expect(leitor).toHaveBeenCalledTimes(1)
    } finally {
      Reflect.deleteProperty(HTMLVideoElement.prototype, "webkitEnterFullscreen")
    }
  })

  it("sem nenhuma maneira de ecrã inteiro, o botão não aparece", () => {
    Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen")
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => false })
    render(<ScreenStage stream={fluxo()} label="Ecrã da Ana" />)
    expect(screen.queryByRole("button", { name: strings.call.ecraInteiro })).toBeNull()
  })
})

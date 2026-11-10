import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { strings } from "../../strings.js"
import { ScreenStage } from "./ScreenStage.js"

/**
 * The stage plays the screen audio: half of the fix for the bug on 26/10/2026.
 *
 * The stage `<video>` was `muted` always. Even with the screen audio reaching
 * the stream, no one heard it. These tests fail with the earlier stage.
 */

afterEach(cleanup)
const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

function fluxo(comSom: boolean, somMudo = false): MediaStream {
  const imagem = { kind: "video", id: "v" }
  const som = { kind: "audio", id: "a", muted: somMudo }
  const faixas = comSom ? [imagem, som] : [imagem]
  return {
    id: "ecra",
    getTracks: () => faixas,
    getVideoTracks: () => [imagem],
    getAudioTracks: () => (comSom ? [som] : []),
  } as unknown as MediaStream
}

const videoDoPalco = (): HTMLVideoElement => document.querySelector(".call-palco video") as HTMLVideoElement

describe("o som do ecrã no palco", () => {
  it("toca quando o ecrã traz som, com volume próprio", () => {
    render(<ScreenStage stream={fluxo(true)} label="Ecrã da Ana" />)

    expect(videoDoPalco().muted).toBe(false)
    const cursor = screen.getByRole("slider", { name: strings.call.screenSoundVolume })
    fireEvent.change(cursor, { target: { value: "40" } })
    expect(videoDoPalco().volume).toBeCloseTo(0.4)
  })

  it("fica calado, e sem cursor, quando o ecrã não traz som (o nosso, por exemplo)", () => {
    render(<ScreenStage stream={fluxo(false)} label="O teu ecrã" />)

    expect(videoDoPalco().muted).toBe(true)
    expect(screen.queryByRole("slider")).toBeNull()
  })

  it("uma faixa de som sem pacotes (a malha, quando quem partilha não deu som) não acende o cursor", () => {
    render(<ScreenStage stream={fluxo(true, true)} label="Ecrã da Ana" />)

    expect(videoDoPalco().muted).toBe(true)
    expect(screen.queryByRole("slider")).toBeNull()
  })

  /*
    Bug reported on 2/11/2026 by the owner: "in the browser when screen sharing
    is active, audio doesn't play and this should not be an option". The stage
    was muted and showed a button "Unmute screen audio". Now there's no button:
    audio unmutes automatically on the next interaction the user makes on the
    page.
    */
  it("se o browser recusar o som sem um gesto, a imagem continua, SEM botão, e o som fica à espera", async () => {
    // The first playback (silent) passes; the second, with audio, is rejected.
    play.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new DOMException("sem gesto", "NotAllowedError"))
    render(<ScreenStage stream={fluxo(true)} label="Ecrã da Ana" />)

    await vi.waitFor(() => expect(videoDoPalco().muted).toBe(true))
    expect(screen.queryByRole("button")).toBeNull()
    // The cursor stays: moving it is the gesture that turns on audio.
    expect(screen.getByRole("slider", { name: strings.call.screenSoundVolume })).toBeTruthy()
  })

  it("o próximo gesto em QUALQUER sítio da página liga o som, com o play() dentro do gesto", async () => {
    play.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new DOMException("sem gesto", "NotAllowedError"))
    render(<ScreenStage stream={fluxo(true)} label="Ecrã da Ana" />)
    await vi.waitFor(() => expect(videoDoPalco().muted).toBe(true))

    play.mockClear()
    let calarNoPlay: boolean | null = null
    play.mockImplementationOnce(function (this: HTMLMediaElement) {
      calarNoPlay = this.muted
      return Promise.resolve()
    })
    fireEvent.pointerDown(document.body)
    // Synchronous: `play()` ran BEFORE the gesture ended, already without `muted`.
    expect(play).toHaveBeenCalledTimes(1)
    expect(calarNoPlay).toBe(false)
    expect(videoDoPalco().muted).toBe(false)
  })

  it("uma tecla também serve de gesto, e um gesto a mais depois do som ligado não faz nada", async () => {
    play.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new DOMException("sem gesto", "NotAllowedError"))
    render(<ScreenStage stream={fluxo(true)} label="Ecrã da Ana" />)
    await vi.waitFor(() => expect(videoDoPalco().muted).toBe(true))

    play.mockClear()
    fireEvent.keyDown(document, { key: "a" })
    expect(play).toHaveBeenCalledTimes(1)
    expect(videoDoPalco().muted).toBe(false)

    fireEvent.pointerDown(document.body)
    expect(play).toHaveBeenCalledTimes(1)
  })

  it("se o gesto também não chegar, volta a calar-se e espera pelo seguinte", async () => {
    play.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new DOMException("sem gesto", "NotAllowedError"))
    render(<ScreenStage stream={fluxo(true)} label="Ecrã da Ana" />)
    await vi.waitFor(() => expect(videoDoPalco().muted).toBe(true))

    play.mockRejectedValueOnce(new DOMException("sem gesto", "NotAllowedError")).mockResolvedValueOnce(undefined)
    fireEvent.pointerDown(document.body)
    await vi.waitFor(() => expect(videoDoPalco().muted).toBe(true))

    play.mockClear()
    fireEvent.pointerDown(document.body)
    expect(play).toHaveBeenCalledTimes(1)
    expect(videoDoPalco().muted).toBe(false)
  })

  it("o palco desmontado larga os ouvintes do gesto", async () => {
    play.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new DOMException("sem gesto", "NotAllowedError"))
    const { unmount } = render(<ScreenStage stream={fluxo(true)} label="Ecrã da Ana" />)
    await vi.waitFor(() => expect(videoDoPalco().muted).toBe(true))
    unmount()

    play.mockClear()
    fireEvent.pointerDown(document.body)
    expect(play).not.toHaveBeenCalled()
  })

  it("o cursor diz o volume por extenso a quem ouve o ecrã", () => {
    render(<ScreenStage stream={fluxo(true)} label="Ecrã da Ana" />)
    const cursor = screen.getByRole("slider", { name: strings.call.screenSoundVolume })
    expect(cursor.getAttribute("aria-valuetext")).toBe("100 %")
    fireEvent.change(cursor, { target: { value: "40" } })
    expect(cursor.getAttribute("aria-valuetext")).toBe("40 %")
  })
})

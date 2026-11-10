import { afterEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { EnclaveBridge } from "../../bridge.js"
import type { SocialDraft, VideoNoRascunho } from "../../types.js"
import { BridgeContext } from "../../App.js"
import { ToastProvider } from "../../components/Toast.js"
import { ConfirmarProvider } from "../../hooks/useConfirmar.js"
import { strings } from "../../strings.js"
import { Social } from "./Social.js"

/** The compositor with a video: the video review from 26/10/2026 (finding 5 and recommendation 11). */

afterEach(cleanup)

function videoNoRascunho(bytes: number): VideoNoRascunho {
  return {
    // The jsdom Blob does not have `arrayBuffer`: that is all we need.
    ficheiro: { arrayBuffer: async () => new ArrayBuffer(4) } as unknown as Blob,
    name: "praia.mp4",
    mediaType: "video/mp4",
    bytes,
    duration: 12,
    poster: "data:image/webp;base64,UklGRg==",
  }
}

function montar(video: VideoNoRascunho) {
  // The post keeps coming out: sending the parts is not finished yet.
  const publicar = vi.fn(() => new Promise<{ ok: boolean; id: string }>(() => {}))
  const bridge = {
    social: { post: vi.fn().mockResolvedValue({ ok: true }) },
    video: { publicar, cancelar: vi.fn(), estado: vi.fn(), bytes: vi.fn() },
    on: { video: () => () => {} },
  } as unknown as EnclaveBridge
  function Harness(): React.JSX.Element {
    const [draft, setDraft] = useState<SocialDraft>({ caption: "a praia", images: [], links: [], video })
    return (
      <BridgeContext.Provider value={bridge}>
        <ToastProvider>
          <ConfirmarProvider>
            <Social
              circleSize={0}
              feed={[]}
              messages={[]}
              me="@me:s"
              connection="online"
              connectionDetail={null}
              nameFor={(sender) => sender}
              directory={new Map()}
              draft={draft}
              onDraft={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            />
          </ConfirmarProvider>
        </ToastProvider>
      </BridgeContext.Provider>
    )
  }
  render(<Harness />)
  return { publicar }
}

describe("Social — o vídeo no compositor", () => {
  it("dois Ctrl+Enter seguidos publicam uma vez só (achado 5)", async () => {
    const { publicar } = montar(videoNoRascunho(3_200_000))
    const legenda = screen.getByPlaceholderText(strings.social.placeholder)
    await act(async () => {
      fireEvent.keyDown(legenda, { key: "Enter", ctrlKey: true })
      fireEvent.keyDown(legenda, { key: "Enter", ctrlKey: true })
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    // And another after React draws the `busy`: also not.
    await act(async () => {
      fireEvent.keyDown(legenda, { key: "Enter", ctrlKey: true })
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(publicar).toHaveBeenCalledTimes(1)
  })

  it("um vídeo que não cabe no cofre diz-se antes de publicar (recomendação 11)", () => {
    montar(videoNoRascunho(3_200_000))
    expect(screen.getByText(strings.social.videoOnlyThisSession)).toBeTruthy()
  })

  it("um vídeo que cabe não leva o aviso", () => {
    montar(videoNoRascunho(1_000_000))
    expect(screen.queryByText(strings.social.videoOnlyThisSession)).toBeNull()
  })

  it("durante o envio, fechar a página pede confirmação (recomendação 11)", async () => {
    const adicionados: string[] = []
    const original = window.addEventListener.bind(window)
    const espia = vi.spyOn(window, "addEventListener").mockImplementation((tipo, ouvinte, opcoes) => {
      adicionados.push(tipo)
      original(tipo, ouvinte, opcoes)
    })
    try {
      const ouvintes: ((evento: { fase: string; feitas: number; de: number; sha: string }) => void)[] = []
      const publicar = vi.fn(() => new Promise<{ ok: boolean; id: string }>(() => {}))
      const bridge = {
        social: { post: vi.fn() },
        video: { publicar, cancelar: vi.fn(), estado: vi.fn(), bytes: vi.fn() },
        on: {
          video: (ouvinte: (typeof ouvintes)[number]) => {
            ouvintes.push(ouvinte)
            return () => {}
          },
        },
      } as unknown as EnclaveBridge
      function Harness(): React.JSX.Element {
        const [draft, setDraft] = useState<SocialDraft>({ caption: "x", images: [], links: [], video: videoNoRascunho(10) })
        return (
          <BridgeContext.Provider value={bridge}>
            <ToastProvider>
              <ConfirmarProvider>
                <Social
                  circleSize={0}
                  feed={[]}
                  messages={[]}
                  me="@me:s"
                  connection="online"
                  connectionDetail={null}
                  nameFor={(sender) => sender}
                  directory={new Map()}
                  draft={draft}
                  onDraft={(patch) => setDraft((current) => ({ ...current, ...patch }))}
                />
              </ConfirmarProvider>
            </ToastProvider>
          </BridgeContext.Provider>
        )
      }
      render(<Harness />)
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: strings.social.publish }))
        for (let i = 0; i < 10; i++) await Promise.resolve()
      })
      act(() => {
        for (const ouvinte of ouvintes) ouvinte({ sha: "A".repeat(43), fase: "a-enviar", feitas: 1, de: 3 })
      })
      expect(adicionados).toContain("beforeunload")
      const evento = new Event("beforeunload", { cancelable: true })
      window.dispatchEvent(evento)
      expect(evento.defaultPrevented).toBe(true)
    } finally {
      espia.mockRestore()
    }
  })
})

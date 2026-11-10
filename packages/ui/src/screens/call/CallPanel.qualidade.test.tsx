import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { LimiteDeVideo } from "@enclave/client-core"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import type { Participant } from "@enclave/client-core"
import { CallPanel } from "./CallPanel.js"

/**
 * Resolution dropping, seen from where the person is.
 *
 * The `qualityLimitationReason` has existed in stats since the beginning and
 * nobody read it. The symptom is not an error: it is the ABSENCE of one. The
 * image drops from 720p to 540p, others see a blurry person, and that person
 * still sees the menu saying 720p with no explanation for the difference. What
 * they conclude is that the product is bad, not that their network is bad.
 *
 * What we measure here is what is SEEN on the person's own card, and what we do
 * NOT ask about when there is no video going out.
 */

afterEach(cleanup)

// jsdom has no media pipeline; the boxes only need `play()` not to crash.
vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

const perfil = { displayName: "Eu", donations: [] } as unknown as Profile

/** A stream with a video track: that is what makes the panel start asking. */
function comCamara(): MediaStream {
  const faixa = { kind: "video", enabled: true, stop: () => {} }
  return {
    id: "local",
    getTracks: () => [faixa],
    getVideoTracks: () => [faixa],
    getAudioTracks: () => [],
  } as unknown as MediaStream
}

/** And one with voice only, which is the overwhelming majority of calls on this product. */
function soVoz(): MediaStream {
  const faixa = { kind: "audio", enabled: true, stop: () => {} }
  return {
    id: "local",
    getTracks: () => [faixa],
    getVideoTracks: () => [],
    getAudioTracks: () => [faixa],
  } as unknown as MediaStream
}

/**
 * The engine, with quality reading and a count of how many times we asked for it.
 *
 * The count is the half you do not see on the screen and that matters anyway:
 * polling every four seconds on a voice call is `getStats()` on every pair,
 * repeated forever, feeding a warning that can never fire.
 */
function motor(limite: LimiteDeVideo | null): EnclaveBridge["call"] & { perguntas: () => number } {
  let perguntas = 0
  return {
    setMuted: () => {},
    setCameraOff: () => {},
    podePartilharEcra: true,
    tectoDePartilha: 6,
    active: true,
    medirLimiteDeVideo: async () => {
      perguntas += 1
      return limite
    },
    perguntas: () => perguntas,
  } as unknown as EnclaveBridge["call"] & { perguntas: () => number }
}

function painel(overrides: Partial<React.ComponentProps<typeof CallPanel>> = {}): React.JSX.Element {
  return (
    <CallPanel
      call={motor(null)}
      channel="!geral:s"
      participants={[{ address: "@ana:s", connected: true, stream: null, screen: null } as Participant]}
      localStream={null}
      screenStream={null}
      selfLabel="Eu"
      selfProfile={perfil}
      nameFor={() => "Ana"}
      directory={new Map()}
      onToggleMic={() => {}}
      onToggleSound={() => {}}
      onLeave={() => {}}
      {...overrides}
    />
  )
}

describe("a resolução a descer, no cartão de quem a sofre", () => {
  it("diz a causa quando a rede aperta", async () => {
    render(painel({ call: motor({ razao: "bandwidth", altura: 540 }), localStream: comCamara() }))

    // The phrase is about the network, not the product. The line count came out in
    // review STE100 on 20/10/2026: "lines" is jargon.
    await waitFor(() => expect(screen.getByText("imagem reduzida: rede lenta")).toBeTruthy())
  })

  it("distingue a rede da máquina, porque são dois gestos diferentes", async () => {
    render(painel({ call: motor({ razao: "cpu", altura: 360 }), localStream: comCamara() }))

    // Switching networks gives back no CPU, and closing tabs gives back no bandwidth.
    // One phrase for both would send half the people to do the wrong thing.
    await waitFor(() => expect(screen.getByText("imagem reduzida: aparelho lento")).toBeTruthy())
  })

  it("sem a altura declarada, a frase vale à mesma e não inventa um zero", async () => {
    render(painel({ call: motor({ razao: "bandwidth", altura: 0 }), localStream: comCamara() }))

    // The first reports from a sender do not bring `frameHeight`. "0 lines" would be
    // a lie dressed up as a number.
    await waitFor(() => expect(screen.getByText("imagem reduzida: rede lenta")).toBeTruthy())
  })

  it("com a imagem a sair inteira, o cartão diz o que sempre disse", async () => {
    const call = motor(null)
    const { container } = render(painel({ call, localStream: comCamara() }))

    await waitFor(() => expect(call.perguntas()).toBeGreaterThan(0))
    expect(screen.getByText("tu")).toBeTruthy()
    /*
      The search is INSIDE the cards, and the difference is not cosmetic.

      This was `screen.queryByText(/imagem/)` on the whole page, and it passed by
      accident: the call footer said "Protected in transit" in jsdom, where there
      is no `RTCRtpSender`, the phrase the panel wrote by mistake to whoever
      encrypts via `RTCRtpScriptTransform`. Once the footer's lie was fixed, the
      phrase there started talking about sound and IMAGE, and this test turned red
      without anything in video quality changing. A test that depends on a phrase
      that is not its own is a test that measures something else.
    */
    const estados = [...container.querySelectorAll(".call-chip-state")].map((cada) => cada.textContent ?? "")
    expect(estados.filter((texto) => texto.includes("imagem"))).toEqual([])
  })

  it("numa chamada de voz não pergunta uma única vez", async () => {
    const call = motor({ razao: "bandwidth", altura: 540 })
    render(painel({ call, localStream: soVoz() }))

    // One turn of the event loop: if polling started, it started here.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(call.perguntas()).toBe(0)
    expect(screen.getByText("tu")).toBeTruthy()
  })

  it("mas pergunta quando o que sai é o ECRÃ e não a câmara", async () => {
    const call = motor({ razao: "bandwidth", altura: 540 })
    // Screen sharing is the more expensive of the two, 2.5 Mbps against 1.2, so
    // it is the first to be cut. Reading only the camera left silent the exact source
    // that drops the most.
    render(painel({ call, localStream: soVoz(), screenStream: comCamara() }))

    await waitFor(() => expect(screen.getByText("imagem reduzida: rede lenta")).toBeTruthy())
  })
})

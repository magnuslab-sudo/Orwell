import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { montarWebAudioFalso, vozFalsa } from "../../hooks/vozFalsa.js"
import { CallPanel } from "./CallPanel.js"

/**
 * Our ring follows the gate when "Microphone Sensitivity" is set to manual
 * (2/11/2026).
 *
 * Our card measures the input of the chain (`call.audio.medir()`), which comes
 * BEFORE the gate. In automatic mode it stays that way (the gate silences low
 * speech and the ring should not stay quiet while sound is coming in). With the
 * manual line, nothing below it goes out to others, and our ring does not light
 * up either: `anelDb` at -120. The ring of the person hearing us follows the
 * track that arrives, which is digital silence.
 */

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

let audio: ReturnType<typeof montarWebAudioFalso>
beforeEach(() => {
  audio = montarWebAudioFalso()
})
afterEach(() => {
  cleanup()
  audio.desmontar()
})

const perfil = { displayName: "Eu", donations: [] } as unknown as Profile

function painel(medida: { entradaDb: number; anelDb: number }) {
  const eu = vozFalsa("eu", 100)
  const call = {
    setMuted: () => {},
    setCameraOff: () => {},
    audio: { medir: () => ({ saidaDb: -120, ruidoEstimadoDb: -60, cpuMs: 0, portaoDb: -40, vozAtiva: false, ...medida }) },
  } as unknown as EnclaveBridge["call"]
  return render(
    <CallPanel
      call={call}
      channel="!geral:s"
      participants={[]}
      localStream={eu.stream}
      selfLabel="Eu"
      selfProfile={perfil}
      nameFor={(sender) => sender}
      directory={new Map()}
      onToggleMic={() => {}}
      onToggleSound={() => {}}
      onLeave={() => {}}
    />,
  )
}

const nossoNivel = (container: HTMLElement): number =>
  Number(container.querySelector<HTMLElement>(".call-chip")?.style.getPropertyValue("--voz") || "0")

describe("o anel do nosso cartão e a linha manual", () => {
  it("no automático acende com a entrada, como antes", () => {
    const { container } = painel({ entradaDb: -20, anelDb: -20 })
    audio.correrUm()
    expect(nossoNivel(container)).toBeGreaterThan(0.5)
  })

  it("com a linha acima do nível, o anel não acende, mesmo com som na faixa", () => {
    const { container } = painel({ entradaDb: -20, anelDb: -120 })
    for (let i = 0; i < 5; i++) audio.correrUm()
    expect(nossoNivel(container)).toBe(0)
  })
})

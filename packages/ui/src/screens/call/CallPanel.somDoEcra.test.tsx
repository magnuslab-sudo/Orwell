import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Call, type EstadoDoSomDoEcra, type Participant } from "@enclave/client-core"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import type { UserAddress } from "@enclave/protocol"
import { strings } from "../../strings.js"
import { CallPanel } from "./CallPanel.js"

/**
 * Our screen sound, seen by whoever is sharing: the indicator and the gesture
 * to mute it.
 *
 * System sound always went out, without choice or indicator. Now there is an
 * indicator ("Now sharing system sound") while it goes out, and a button next to
 * "Stop sharing" that mutes it without stopping the share. The engine's twin
 * actually changes state and emits `screen-sound`, like `Call`.
 */

afterEach(cleanup)
vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

const perfil = { displayName: "Eu", donations: [] } as unknown as Profile

function fluxoDeEcra(id: string): MediaStream {
  const faixa = { kind: "video", enabled: true, stop: () => {} }
  return {
    id,
    getTracks: () => [faixa],
    getVideoTracks: () => [faixa],
    getAudioTracks: () => [],
  } as unknown as MediaStream
}

function participante(address: string): Participant {
  return {
    address: address as UserAddress,
    connected: true,
    stream: null,
    screen: null,
    video: false,
    encrypted: true,
    micMuted: false,
    ecraOferecido: false,
    aVerONossoEcra: false,
  }
}

/** The engine with screen sound: a state, an event, and the gesture. */
function motorComSom(inicial: EstadoDoSomDoEcra): {
  call: EnclaveBridge["call"]
  emitir: (estado: EstadoDoSomDoEcra) => void
} {
  let estado = inicial
  const ouvintes: ((evento: { estado: EstadoDoSomDoEcra }) => void)[] = []
  const emitir = (novo: EstadoDoSomDoEcra): void => {
    estado = novo
    for (const ouvinte of ouvintes) ouvinte({ estado })
  }
  const call = {
    setMuted: () => {},
    setCameraOff: () => {},
    podePartilharEcra: true,
    tectoDePartilha: Call.LIMITE_DE_PARTILHA,
    get somDoEcra() {
      return estado
    },
    setSomDoEcraCalado: (calado: boolean) => emitir(calado ? "calado" : "a-sair"),
    on: (evento: string, ouvinte: (carga: { estado: EstadoDoSomDoEcra }) => void) => {
      if (evento === "screen-sound") ouvintes.push(ouvinte)
      return () => {}
    },
  }
  return { call: call as unknown as EnclaveBridge["call"], emitir }
}

function painel(call: EnclaveBridge["call"], screenStream: MediaStream | null): React.JSX.Element {
  return (
    <CallPanel
      call={call}
      channel="!geral:s"
      participants={[participante("@ana:s")]}
      localStream={null}
      screenStream={screenStream}
      selfLabel="Eu"
      selfProfile={perfil}
      nameFor={() => "Ana"}
      directory={new Map()}
      onToggleMic={() => {}}
      onToggleSound={() => {}}
      onLeave={() => {}}
    />
  )
}

describe("o nosso som do ecrã, no painel", () => {
  it('a partilhar com som: o sinal diz que sai, e o botão está ao lado de "Parar de partilhar"', () => {
    const { call } = motorComSom("a-sair")
    render(painel(call, fluxoDeEcra("meu")))

    expect(screen.getByRole("status").textContent).toContain(strings.call.screenSoundSharing)
    const botoes = [...document.querySelectorAll<HTMLElement>(".call-barra button")]
    const parar = botoes.findIndex((botao) => botao.dataset["ecra"] === "1")
    expect(botoes[parar + 1]?.getAttribute("aria-label")).toBe(strings.call.screenSoundMute)
  })

  it("calar muda o sinal e o botão, sem parar a partilha", () => {
    const { call } = motorComSom("a-sair")
    render(painel(call, fluxoDeEcra("meu")))

    fireEvent.click(screen.getByRole("button", { name: strings.call.screenSoundMute }))

    expect(screen.getByRole("status").textContent).toContain(strings.call.screenSoundMutedSelf)
    const ligar = screen.getByRole("button", { name: strings.call.screenSoundUnmute })
    expect(ligar.getAttribute("aria-pressed")).toBe("false")
    // The share continues: the screen button stays on.
    expect(document.querySelector<HTMLElement>("[data-ecra='1']")?.getAttribute("aria-pressed")).toBe("true")
  })

  it("sem som do ecrã não há sinal nem botão", () => {
    const { call } = motorComSom(null)
    render(painel(call, fluxoDeEcra("meu")))
    expect(screen.queryByText(strings.call.screenSoundSharing)).toBeNull()
    expect(screen.queryByRole("button", { name: strings.call.screenSoundMute })).toBeNull()
  })

  it("o sinal sai quando o motor diz que o som acabou", () => {
    const { call, emitir } = motorComSom("a-sair")
    render(painel(call, fluxoDeEcra("meu")))
    act(() => emitir(null))
    expect(screen.queryByText(strings.call.screenSoundSharing)).toBeNull()
  })
})

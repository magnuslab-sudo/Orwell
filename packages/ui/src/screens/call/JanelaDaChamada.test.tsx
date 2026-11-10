import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Participant } from "@enclave/client-core"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { strings } from "../../strings.js"
import { CallDock } from "./CallDock.js"
import { CallPanel } from "./CallPanel.js"

/**
 * The Discord-style call window (components `ChamadaVoz` and `ChamadaEcra`).
 *
 * What ties here is the structure the components need and what a tree test can
 * see: the mode, the header and its gestures with `aria-pressed`, the grid
 * with one card per person, the control bar with name and status, the focused
 * screen with cards in a queue, and the "Connected · room" card in the sidebar.
 * Geometry (the grid filling, the queue above, the 390 px) is measured in a
 * real browser: `scripts/retratar-midnight.mjs`.
 */

afterEach(cleanup)

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

function participant(address: string, extra: Partial<Participant> = {}): Participant {
  return { address, connected: true, stream: null, ...extra } as Participant
}

const perfil = { displayName: "Eu", donations: [] } as unknown as Profile

/** jsdom has no `MediaStream`: a screen stream is what the stage reads from it. */
function fluxo(id: string): MediaStream {
  return { id, getTracks: () => [], getVideoTracks: () => [], getAudioTracks: () => [] } as unknown as MediaStream
}

const motor = {
  setMuted: () => {},
  setCameraOff: () => {},
  tectoDePartilha: 6,
  podePartilharEcra: true,
  medirLimiteDeVideo: () => Promise.resolve(null),
  startScreenShare: vi.fn(() => Promise.resolve(true)),
  stopScreenShare: vi.fn(() => Promise.resolve()),
  aceitarEcra: vi.fn(() => Promise.resolve()),
  recusarEcra: vi.fn(() => Promise.resolve()),
} as unknown as EnclaveBridge["call"]

function painel(overrides: Partial<React.ComponentProps<typeof CallPanel>> = {}): React.JSX.Element {
  return (
    <CallPanel
      call={motor}
      channel="!nexo:s"
      participants={[participant("@kaori:s"), participant("@ruben:s", { micMuted: true })]}
      localStream={null}
      selfLabel="Vesna"
      selfProfile={perfil}
      nameFor={(quem) => (quem === "@kaori:s" ? "Kaori" : "Rúben")}
      directory={new Map()}
      onToggleMic={() => {}}
      onToggleSound={() => {}}
      onLeave={() => {}}
      modo="sala"
      titulo="voz"
      {...overrides}
    />
  )
}

describe("a janela da chamada", () => {
  it("na sala de voz, a chamada tem nome próprio e ocupa o modo sala", () => {
    const { container } = render(painel())
    const janela = screen.getByRole("region", { name: strings.call.vistaAria("voz") })
    expect(janela.classList.contains("call-sala")).toBe(true)
    expect(container.querySelector(".call-titulo")?.textContent).toBe("voz")
    expect(container.querySelector(".call-meta")?.textContent).toContain(strings.call.people(3))
  })

  it("o mosaico tem um cartão por pessoa, nós incluídos, num grupo com nome", () => {
    render(painel())
    const grupo = screen.getByRole("group", { name: strings.call.pessoasNaChamada })
    expect(grupo.querySelectorAll(".call-person")).toHaveLength(3)
    // The muted microphone mark stays on Ruben's card, and only his.
    expect(grupo.querySelectorAll(".call-person-marcas .mic-off-badge")).toHaveLength(1)
  })

  it("a barra de controlo tem nome, e cada botão diz o estado por aria-pressed", () => {
    render(painel({ micMuted: true }))
    const barra = screen.getByRole("toolbar", { name: strings.call.controlos })
    const microfone = screen.getByRole("button", { name: strings.call.micAria(true) })
    expect(barra.contains(microfone)).toBe(true)
    expect(microfone.getAttribute("aria-pressed")).toBe("false")
    expect(screen.getByRole("button", { name: strings.call.soundAria(false) }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: strings.call.screenAria(false) }).getAttribute("aria-pressed")).toBe("false")
    // Leave is last, and has no state: it is a gesture.
    const sair = screen.getByRole("button", { name: strings.call.leave })
    expect(sair.hasAttribute("aria-pressed")).toBe(false)
    expect([...barra.querySelectorAll("button")].at(-1)).toBe(sair)
  })

  it("os gestos do cabeçalho: abrir numa janela, ver só o palco e a conversa da sala", async () => {
    const popOut = vi.fn()
    const soPalco = vi.fn()
    const conversa = vi.fn()
    render(painel({ onPopOut: popOut, onSoPalco: soPalco, soPalco: true, onConversa: conversa, conversaAberta: false }))
    await userEvent.click(screen.getByRole("button", { name: strings.call.popOut }))
    expect(popOut).toHaveBeenCalledTimes(1)
    const palco = screen.getByRole("button", { name: strings.call.soPalco })
    expect(palco.getAttribute("aria-pressed")).toBe("true")
    await userEvent.click(palco)
    expect(soPalco).toHaveBeenCalledTimes(1)
    const botaoDaConversa = screen.getByRole("button", { name: strings.call.conversaDaSala })
    expect(botaoDaConversa.getAttribute("aria-pressed")).toBe("false")
    await userEvent.click(botaoDaConversa)
    expect(conversa).toHaveBeenCalledTimes(1)
  })

  it("sem os gestos, o cabeçalho não desenha botões mortos", () => {
    render(painel({ modo: "faixa" }))
    expect(screen.queryByRole("button", { name: strings.call.soPalco })).toBeNull()
    expect(screen.queryByRole("button", { name: strings.call.conversaDaSala })).toBeNull()
    expect(screen.getByRole("region", { name: strings.call.vistaAria("voz") }).classList.contains("call-faixa")).toBe(true)
  })

  it("um ecrã partilhado vai para o foco, e os cartões passam a fila por cima dele", () => {
    const ecra = fluxo("ecra-da-kaori")
    const { container } = render(
      painel({ participants: [participant("@kaori:s", { screen: ecra, ecraOferecido: true }), participant("@ruben:s")] }),
    )
    const corpo = container.querySelector(".call-corpo")
    expect(corpo?.classList.contains("com-foco")).toBe(true)
    expect(screen.getByRole("region", { name: strings.call.screenOf("Kaori") })).toBeTruthy()
    // The card of the person sharing gets the mark, and it is the one in focus.
    expect(container.querySelector(".call-person.em-foco .screen-badge")).toBeTruthy()
    // "Stop viewing" lives on the stage, above the screen.
    const parar = screen.getByRole("button", { name: strings.call.screenStopWatchingAria("Kaori") })
    expect(container.querySelector(".call-palco-gestos")?.contains(parar)).toBe(true)
  })

  it("quem partilha vê, no palco, quantos estão a ver", () => {
    render(painel({ screenStream: fluxo("ecra-nosso"), participants: [participant("@kaori:s", { aVerONossoEcra: true })] }))
    expect(screen.getByText(strings.call.screenViewers(1))).toBeTruthy()
  })

  it("a oferta de um ecrã por ver já marca o cartão de quem partilha", () => {
    const { container } = render(painel({ participants: [participant("@kaori:s", { ecraOferecido: true })] }))
    expect(container.querySelectorAll(".call-people .screen-badge")).toHaveLength(1)
    expect(screen.getByRole("button", { name: strings.call.verATransmissaoDe("Kaori") })).toBeTruthy()
  })
})

describe('o cartão "Ligado · sala" da barra lateral', () => {
  const doca = (overrides: Partial<React.ComponentProps<typeof CallDock>> = {}): React.JSX.Element => (
    <CallDock
      variante="lateral"
      channel="!nexo:s"
      channelLabel="nexo"
      roomLabel="voz"
      participants={[participant("@kaori:s")]}
      localStream={null}
      nameFor={(quem) => quem}
      onBack={() => {}}
      onLeave={() => {}}
      onToggleMic={() => {}}
      {...overrides}
    />
  )

  it("diz onde se está ligado, volta à chamada, e não tem o microfone nem a saída", async () => {
    const voltar = vi.fn()
    const sair = vi.fn()
    render(doca({ onBack: voltar, onLeave: sair }))
    // "Connected" on top; below, only "Channel · Room" (owner request, 27 October
    // 2026, commit 5a3b061). See `CallDock.estado.test.tsx`.
    expect(screen.getByText(strings.callDock.ligado)).toBeTruthy()
    expect(document.querySelector(".call-dock.lateral .call-dock-where")?.textContent).toBe("nexo · voz")
    const lateral = screen.getByRole("complementary", { name: strings.callDock.ongoing })
    expect(lateral.classList.contains("lateral")).toBe(true)
    // The microphone is in the account bar, at the bottom (owner, 27 October 2026):
    // the card does not draw it, even with `onToggleMic` passed.
    expect(screen.queryByRole("button", { name: strings.call.micAria(false) })).toBeNull()
    expect(screen.queryByRole("button", { name: strings.call.micAria(true) })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: strings.callDock.back }))
    expect(voltar).toHaveBeenCalledTimes(1)
    // The exit comes from the control panel since P1 (28 October 2026): the fifth
    // button in the row, with the same name. See `CartaoDaConta.test.tsx`.
    expect(screen.queryByRole("button", { name: strings.call.leave })).toBeNull()
    expect(sair).not.toHaveBeenCalled()
  })

  it("toca o som quando é o dono dele, e cala-se quando o painel está no ecrã", () => {
    const { container, rerender } = render(doca())
    expect(container.querySelectorAll(".call-dock-audio video")).toHaveLength(2)
    rerender(doca({ comAudio: false }))
    expect(container.querySelector(".call-dock-audio")).toBeNull()
  })
})

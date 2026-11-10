import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Participant } from "@enclave/client-core"
import { strings } from "../../strings.js"
import { CallDock, clamp, POSITION_KEY, readPosition } from "./CallDock.js"
import { moradaDeTeste } from "../../../testes/moradas.js"

const DM_ANA_ME = moradaDeTeste("directa ana me", "s")

afterEach(cleanup)

// jsdom has no media pipeline; the tiles only need play() to not explode.
vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

/** jsdom has no PointerEvent: a MouseEvent with pointerId grafted on is what
 * React's onPointer* handlers actually receive in these tests. */
function firePointer(
  element: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: { pointerId: number; clientX?: number; clientY?: number },
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  })
  Object.defineProperty(event, "pointerId", { value: init.pointerId })
  element.dispatchEvent(event)
}

function participant(address: string, connected = true): Participant {
  return { address, connected, stream: null } as Participant
}

describe("CallDock", () => {
  it("mostra a sala, a contagem, e mantém um elemento de som por pessoa", () => {
    render(
      <CallDock
        channel="!geral:s"
        channelLabel="geral"
        participants={[participant("@ana:s"), participant("@rui:s", false)]}
        localStream={null}
        nameFor={(sender) => sender}
        onBack={() => {}}
        onLeave={() => {}}
      />,
    )

    expect(screen.getByText("geral")).toBeTruthy()
    // Only connected peers count, plus yourself.
    expect(screen.getByText(strings.call.people(2))).toBeTruthy()
    // Tiles exist for audio: one per participant, plus the local one.
    expect(document.querySelectorAll(".call-dock-audio video")).toHaveLength(3)
  })
})

/**
 * The dock stops floating without saying where it is.
 *
 * The owner's report was this: a card saying there is a call, without saying WHICH.
 * With two voice rooms open on the same channel, or with the call continuing
 * while reading another channel, hanging up was a leap in the dark.
 *
 * Here we check what the person is reading, not what a component arrived: the three
 * things the card now says, from top to bottom.
 */
describe("CallDock — o que a doca diz, de cima para baixo", () => {
  it("diz o estado, depois onde a chamada decorre, e tem por onde desligar", () => {
    render(
      <CallDock
        channel="!lagar:s"
        channelLabel="Lagar do Zé"
        roomLabel="pátio"
        participants={[participant("@ana:s")]}
        localStream={null}
        nameFor={(sender) => sender}
        onBack={() => {}}
        onLeave={() => {}}
      />,
    )

    expect(screen.getByText(strings.callDock.emChamada)).toBeTruthy()
    expect(screen.getByText(strings.callDock.ondeComSala("Lagar do Zé", "pátio"))).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.call.leave })).toBeTruthy()

    // And in this order: the state before the place. A card that says where first
    // and then what forces you to read all of it to know if there is a call.
    const linhas = [...document.querySelectorAll(".call-dock-lines > *")].map((linha) => linha.textContent ?? "")
    expect(linhas[0]).toContain(strings.callDock.emChamada)
    expect(linhas[1]).toBe(strings.callDock.ondeComSala("Lagar do Zé", "pátio"))
  })

  it("numa conversa directa diz só com quem, porque não há sala nenhuma", () => {
    render(
      <CallDock
        channel={DM_ANA_ME}
        channelLabel="Ana"
        participants={[participant("@ana:s")]}
        localStream={null}
        nameFor={(sender) => sender}
        onBack={() => {}}
        onLeave={() => {}}
      />,
    )

    expect(screen.getByText("Ana")).toBeTruthy()
    // No bar separating anything: a conversation between two people has no
    // rooms, and drawing one showed the wrong model.
    expect(document.querySelector(".call-dock-where")?.textContent).toBe("Ana")
  })

  /**
   * Screen sharing DOES NOT EXIST in the product (it is Phase 3).
   *
   * This test holds both halves: the dock does not announce today something that
   * does not exist, and the day it does will not need to be rewritten. If someone
   * turns on the line by accident, the first half fails.
   */
  it("não anuncia partilha de ecrã enquanto ninguém a ligar", () => {
    const doca = (aPartilharEcra: boolean): React.JSX.Element => (
      <CallDock
        channel="!lagar:s"
        channelLabel="Lagar do Zé"
        roomLabel="pátio"
        aPartilharEcra={aPartilharEcra}
        participants={[]}
        localStream={null}
        nameFor={(sender) => sender}
        onBack={() => {}}
        onLeave={() => {}}
      />
    )

    const { unmount } = render(doca(false))
    expect(screen.queryByText(strings.callDock.aPartilharEcra)).toBeNull()
    expect(screen.getByText(strings.callDock.emChamada)).toBeTruthy()
    unmount()

    render(doca(true))
    expect(screen.getByText(strings.callDock.aPartilharEcra)).toBeTruthy()
    expect(screen.queryByText(strings.callDock.emChamada)).toBeNull()
  })
})

describe("CallDock — os dois botões", () => {
  it("voltar e desligar chamam os respectivos callbacks", async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    const onLeave = vi.fn()
    render(
      <CallDock
        channel="!geral:s"
        channelLabel="geral"
        participants={[]}
        localStream={null}
        nameFor={(sender) => sender}
        onBack={onBack}
        onLeave={onLeave}
      />,
    )

    await user.click(screen.getByRole("button", { name: strings.callDock.back }))
    expect(onBack).toHaveBeenCalledOnce()
    await user.click(screen.getByRole("button", { name: strings.call.leave }))
    expect(onLeave).toHaveBeenCalledOnce()
  })
  it("na caixa lateral fica só o voltar: o microfone e o desligar estão na fila do painel", () => {
    const { container } = render(
      <CallDock
        variante="lateral"
        channel="!geral:s"
        channelLabel="geral"
        participants={[]}
        localStream={null}
        nameFor={(sender) => sender}
        onBack={() => {}}
        onLeave={() => {}}
        micMuted
        onToggleMic={() => {}}
      />,
    )
    const botoes = [...container.querySelectorAll("button")].map((botao) => botao.getAttribute("aria-label"))
    // Until P1 (October 28, 2026) they were back and hang up. Hang up is
    // now the fifth button in the panel queue: see `CartaoDaConta.test.tsx`.
    expect(botoes).toEqual([strings.callDock.back])
  })
})

describe("CallDock — desligar o som cala também a doca", () => {
  /**
   * The dock plays sound when the panel is off screen, which is most of the time
   * it exists. If it did not know about muted sound, the identity card said
   * "no sound" and sound came out, and the person clicked again with no effect,
   * thinking the app is broken.
   */
  const doca = (soundOff: boolean): React.JSX.Element => (
    <CallDock
      channel="!geral:s"
      channelLabel="geral"
      participants={[participant("@ana:s"), participant("@rui:s")]}
      localStream={null}
      nameFor={(sender) => sender}
      soundOff={soundOff}
      onBack={() => {}}
      onLeave={() => {}}
    />
  )

  const mudas = (container: HTMLElement): boolean[] =>
    [...container.querySelectorAll<HTMLVideoElement>(".call-dock-audio video")].map((caixa) => caixa.muted)

  it("com som, as vozes que chegam ouvem-se", () => {
    // The first box is ours, always changes; the other two are the voices.
    expect(mudas(render(doca(false)).container)).toEqual([true, false, false])
  })

  it("sem som, ficam todas mudas", () => {
    expect(mudas(render(doca(true)).container)).toEqual([true, true, true])
  })
})

describe("CallDock — arrastável (matemática pura: jsdom não entrega pointer events)", () => {
  it("clamp prende ao viewport e nunca devolve coordenadas inválidas", () => {
    expect(clamp({ x: -500, y: -500 })).toEqual({ x: 8, y: 8 })
    // 72 and not 56: the dock gained a second line (channel and room), and with the
    // old value dragging it down hid exactly that. 272 and not 240: the waveform
    // added 26 pixels on the left, and what went out of bounds when dragging right
    // was the hang up button.
    expect(clamp({ x: 99_999, y: 99_999 })).toEqual({
      x: Math.max(8, window.innerWidth - 272),
      y: Math.max(8, window.innerHeight - 72),
    })
    expect(clamp({ x: Number.NaN, y: Number.NaN })).toEqual({ x: 8, y: 8 })
  })

  it("a posição lembrada volta clampada; lixo na sessão é ignorado", () => {
    sessionStorage.setItem(POSITION_KEY, JSON.stringify({ x: -50, y: 40 }))
    expect(readPosition()).toEqual({ x: 8, y: 40 })
    sessionStorage.setItem(POSITION_KEY, "{lixo")
    expect(readPosition()).toBeNull()
    sessionStorage.removeItem(POSITION_KEY)
    expect(readPosition()).toBeNull()
  })
})

describe("CallDock — a música calada no painel fica calada na doca", () => {
  it("a doca toca a música de quem não se calou, e cala a de quem se calou", () => {
    localStorage.setItem("enclave.prefs", JSON.stringify({ musicasCaladas: ["@ana:s"] }))
    const musica = { id: "m", getTracks: () => [], getAudioTracks: () => [] } as unknown as MediaStream
    const ana = { address: "@ana:s", connected: true, stream: null, musica } as unknown as Participant
    const rui = { address: "@rui:s", connected: true, stream: null, musica } as unknown as Participant
    const { container } = render(
      <CallDock
        channel="!geral:s"
        participants={[ana, rui]}
        localStream={null}
        nameFor={(sender) => sender}
        onBack={() => {}}
        onLeave={() => {}}
      />,
    )
    const elementos = [...container.querySelectorAll<HTMLAudioElement>("audio[data-musica='1']")]
    expect(elementos.map((elemento) => elemento.muted)).toEqual([true, false])
    localStorage.clear()
  })
})

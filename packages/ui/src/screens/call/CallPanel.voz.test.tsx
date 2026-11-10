import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import type { Participant } from "@enclave/client-core"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { montarWebAudioFalso, semVoz, vozFalsa, type VozFalsa } from "../../hooks/vozFalsa.js"
import { CallPanel } from "./CallPanel.js"

/**
 * The card of whoever is speaking.
 *
 * ## The gap this closes
 *
 * The voice meter existed since August 13, 2026 and measured well. What it
 * produced was drawn in a ring around the VIDEO BOX, and the video box row is
 * hidden with zero height while nobody turns on a camera, which is the vast
 * majority of calls on this product. In other words: measured sixty times a
 * second, per person, to paint something inside a zero-height element.
 *
 * What you saw in those calls was this row of cards, and in it whoever was
 * speaking looked the same as whoever was silent. The data existed; it wasn't
 * anywhere on screen.
 *
 * ## What these tests measure
 *
 * The value the meter writes (`--voz`, from 0 to 1) on the element where
 * the drawing happens. Not an implementation detail: it's the meter's only
 * output, it's what the CSS reads, and it's the difference between a card that
 * responds and one that doesn't. The real drawing, that the ring shows, that
 * the bars move, that nothing shifts with reduced motion, is tested in a
 * browser in `scripts/medir-voz-visivel.mjs`, because jsdom doesn't apply
 * stylesheets.
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

function participante(address: string, voz: VozFalsa | null, extra: Partial<Participant> = {}): Participant {
  return { address, connected: true, stream: voz?.stream ?? null, ...extra } as Participant
}

function painel(overrides: Partial<React.ComponentProps<typeof CallPanel>> = {}): React.JSX.Element {
  return (
    <CallPanel
      call={{ setMuted: () => {}, setCameraOff: () => {} } as unknown as EnclaveBridge["call"]}
      channel="!geral:s"
      participants={[]}
      localStream={null}
      selfLabel="Eu"
      selfProfile={perfil}
      nameFor={(sender) => sender}
      directory={new Map()}
      onToggleMic={() => {}}
      onToggleSound={() => {}}
      onLeave={() => {}}
      {...overrides}
    />
  )
}

/** The level written on each card, in the order they appear on screen. */
const niveis = (container: HTMLElement): string[] =>
  [...container.querySelectorAll<HTMLElement>(".call-chip")].map((cartao) => cartao.style.getPropertyValue("--voz"))

/** And the same on the video boxes, where the ring used to live alone. */
const niveisDasCaixas = (container: HTMLElement): string[] =>
  [...container.querySelectorAll<HTMLElement>(".tile")].map((caixa) => caixa.style.getPropertyValue("--voz"))

describe("o cartão da chamada responde a quem fala", () => {
  it("numa chamada só de voz, o cartão de quem fala acende e o de quem está calado não", () => {
    const ana = vozFalsa("ana", 100)
    const rui = vozFalsa("rui", 0)
    const { container } = render(
      painel({ participants: [participante("@ana:s", ana), participante("@rui:s", rui)] }),
    )

    // Before any frame there is nothing written: the value comes from the measurement.
    expect(niveis(container)).toEqual(["", "", ""])

    audio.correrUm()

    // Our card first (no local stream), then Ana and Rui.
    expect(niveis(container)).toEqual(["", "1.000", "0.000"])
  })

  it("e desce quando a pessoa se cala, sem piscar a cada sílaba", () => {
    const ana = vozFalsa("ana", 100)
    const { container } = render(painel({ participants: [participante("@ana:s", ana)] }))

    audio.correrUm()
    expect(niveis(container)[1]).toBe("1.000")

    // The person stops mid-sentence.
    ana.falar(0)

    // A silence frame does not erase the card: pauses between words span tenths of
    // a second, and a card that tracks them strobes.
    audio.correrUm()
    expect(Number(niveis(container)[1])).toBeGreaterThan(0.5)

    for (let i = 0; i < 200; i++) audio.correrUm()
    expect(niveis(container)[1]).toBe("0.000")
  })

  it("o nosso próprio cartão responde ao nosso microfone", () => {
    // It is the only card that can say "the microphone is picking up" before someone
    // on the other end confirms it.
    const eu = vozFalsa("eu", 100)
    const { container } = render(painel({ localStream: eu.stream }))

    audio.correrUm()
    expect(niveis(container)[0]).toBe("1.000")
  })

  it("com o microfone desligado não mede nem desenha onda nenhuma", () => {
    /*
      Two things, and both matter. Measuring would mean drawing a card that
      waves around someone who chose to stay silent; and a still wave next to
      the "microphone off" mark would say the same thing twice, the second time
      in a shape that hints it can still move.
    */
    const ana = vozFalsa("ana", 100)
    const { container } = render(
      painel({ participants: [participante("@ana:s", ana, { micMuted: true })] }),
    )

    audio.correrUm()

    expect(niveis(container)[1]).toBe("")
    const cartaoDaAna = container.querySelectorAll(".call-chip")[1]!
    expect(cartaoDaAna.querySelector(".onda")).toBeNull()
  })

  it("desligar o som cala o nosso cartão, porque cala o nosso microfone", () => {
    // No sound means the microphone mutes by default (see `escolherAudio`). A
    // waving card in that state was the wave lying.
    const eu = vozFalsa("eu", 100)
    const { container } = render(painel({ localStream: eu.stream, soundOff: true }))

    audio.correrUm()
    expect(niveis(container)[0]).toBe("")
  })

  it("uma pessoa ainda a ligar-se não tem stream, e o cartão fica em repouso", () => {
    const { container } = render(
      painel({ participants: [participante("@ana:s", null, { connected: false })] }),
    )

    audio.correrUm()
    expect(niveis(container)[1]).toBe("")
    // But the wave is there: it draws silence, not its absence.
    expect(container.querySelectorAll(".call-chip")[1]?.querySelector(".onda")).toBeTruthy()
  })

  it("um stream só de vídeo não inventa nível nenhum", () => {
    const { container } = render(painel({ participants: [participante("@ana:s", null, { stream: semVoz() })] }))

    audio.correrUm()
    expect(niveis(container)[1]).toBe("")
  })
})

/**
 * The cost, which is the other half of this work.
 *
 * This runs on every participant in every call. A video box hidden with zero
 * height has no ring to draw, and measuring it meant spending an analyzer and
 * one cycle per person to paint what no one can see.
 */
describe("não se mede o que ninguém vê", () => {
  it("numa chamada só de voz as caixas de vídeo não medem: quem mostra é o cartão", () => {
    const ana = vozFalsa("ana", 100)
    const { container } = render(painel({ participants: [participante("@ana:s", ana)] }))

    audio.correrUm()

    // The card shows. The boxes, hidden with zero height, stay silent.
    expect(niveis(container)[1]).toBe("1.000")
    expect(niveisDasCaixas(container)).toEqual(["", ""])
  })

  it("com uma câmara ligada a imagem vai para o cartão, e só o cartão mede", () => {
    // From the call window in Discord style to the visual phase, the camera shows
    // on the person's card in the grid. The boxes stay hidden playing sound, and a
    // second measurement would pay for a ring no one sees.
    const ana = vozFalsa("ana", 100, { video: true })
    const { container } = render(painel({ participants: [participante("@ana:s", ana, { video: true })] }))

    audio.correrUm()

    expect(niveis(container)[1]).toBe("1.000")
    expect(niveisDasCaixas(container)).toEqual(["", ""])
    expect(container.querySelectorAll(".call-chip video.call-chip-camara")).toHaveLength(1)
  })
})

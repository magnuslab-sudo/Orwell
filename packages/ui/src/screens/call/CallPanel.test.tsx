import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { Participant } from "@enclave/client-core"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { strings } from "../../strings.js"
import { CallPanel } from "./CallPanel.js"

/**
 * The call panel SHOWS the microphone and sound; it never decides them.
 *
 * This is the line these tests keep. The panel had its own `useState`, and with
 * the same two buttons on the identity card in the sidebar that gave two sources
 * of truth for the same fact, one button saying "muted" next to another saying
 * it is no worse than having no button at all.
 */

afterEach(cleanup)

// jsdom has no media pipeline; the boxes only need `play()` not to crash.
vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

function participant(address: string, connected = true): Participant {
  return { address, connected, stream: null } as Participant
}

/** The same pair, with the microphone off on his side. */
function calado(address: string): Participant {
  return { address, connected: true, stream: null, micMuted: true } as Participant
}

const perfil = { displayName: "Eu", donations: [] } as unknown as Profile

function painel(overrides: Partial<React.ComponentProps<typeof CallPanel>> = {}): React.JSX.Element {
  return (
    <CallPanel
      call={{ setMuted: () => {}, setCameraOff: () => {} } as unknown as EnclaveBridge["call"]}
      channel="!geral:s"
      participants={[participant("@ana:s")]}
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

/** The microphone button is the first of the controls; the sound button comes right after. */
const controlos = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>(".call-controls .call-btn"),
]

describe("CallPanel — o microfone e o som vêm de fora", () => {
  it("desenha o estado que recebe, e não um seu", () => {
    const { container } = render(painel({ micMuted: true }))
    expect(controlos(container)[0]?.classList.contains("off")).toBe(true)
  })

  it("clicar não muda nada por si: chama quem manda", () => {
    const onToggleMic = vi.fn()
    const { container } = render(painel({ onToggleMic }))
    const mic = controlos(container)[0]!
    fireEvent.click(mic)
    expect(onToggleMic).toHaveBeenCalledTimes(1)
    // The screen stays exactly as it was. Before, the local `useState` changed it
    // here, and the sidebar kept saying the opposite.
    expect(mic.classList.contains("off")).toBe(false)
  })

  it("o mesmo estado dá a mesma cara nos dois botões que o mostram", () => {
    // Without sound, the microphone is muted by drag: both red.
    const { container } = render(painel({ micMuted: false, soundOff: true }))
    const [mic, som] = controlos(container)
    expect(mic?.classList.contains("off")).toBe(true)
    expect(som?.classList.contains("off")).toBe(true)
    // And it says why, instead of leaving the person to think they made a mistake.
    expect(mic?.getAttribute("data-tip")).toBe(strings.call.micBySound)
  })

  it("a escolha da pessoa não é apagada por o som estar desligado", () => {
    // `micMuted` is still her choice; the panel just combines the two.
    const { container } = render(painel({ micMuted: false, soundOff: false }))
    expect(controlos(container)[0]?.classList.contains("off")).toBe(false)
  })

  it("sem som, as vozes que chegam ficam mudas — e o nosso eco continua mudo", () => {
    const { container } = render(painel({ soundOff: true }))
    const caixas = [...container.querySelectorAll<HTMLVideoElement>(".call-video video")]
    // The first is ours, always changes: hearing your own microphone is a loop.
    expect(caixas[0]?.muted).toBe(true)
    expect(caixas[1]?.muted).toBe(true)
  })

  it("com som, as vozes que chegam ouvem-se", () => {
    const { container } = render(painel({ soundOff: false }))
    const caixas = [...container.querySelectorAll<HTMLVideoElement>(".call-video video")]
    expect(caixas[0]?.muted).toBe(true)
    expect(caixas[1]?.muted).toBe(false)
  })

  it("os ícones são desenhados, e o de desligado é outro desenho", () => {
    const ligado = render(painel({ micMuted: false, soundOff: false })).container
    const tracosLigado = controlos(ligado).map((b) => b.querySelectorAll("svg *").length)
    cleanup()
    const calado = render(painel({ micMuted: true, soundOff: true })).container
    const tracosCalado = controlos(calado).map((b) => b.querySelectorAll("svg *").length)
    // One stroke extra on each: the bar. Never opacity playing the role of state.
    expect(tracosCalado[0]).toBeGreaterThan(tracosLigado[0]!)
    expect(tracosCalado[1]).toBeGreaterThan(tracosLigado[1]!)
  })

  it("sem quem os trate, os controlos de áudio não aparecem", () => {

    const { container } = render(painel({ onToggleMic: undefined, onToggleSound: undefined }))
    // What is left is the off; everything else would go from here to nowhere.
    expect(controlos(container).some((b) => b.classList.contains("hangup"))).toBe(true)
    expect(controlos(container)).toHaveLength(1)
  })
})

/**
 * Whoever is muted sees themselves, and sees themselves on the card, which is
 * what exists.
 *
 * Video boxes stay hidden while nobody turns on a camera, and the overwhelming
 * majority of calls never turn one on. A badge that only lived there would leave
 * the entire defect unfixed in the normal call.
 */
describe("CallPanel — quem tem o microfone desligado", () => {
  const marcas = (container: HTMLElement): HTMLElement[] => [
    ...container.querySelectorAll<HTMLElement>(".call-people .mic-off-badge"),
  ]

  it("a pessoa calada leva a marca, a que fala não leva nada", () => {
    const { container } = render(painel({ participants: [calado("@ana:s"), participant("@rui:s")] }))
    // Two people on the call, one badge. Never a "grayed out" badge on the other:
    // a state drawn in gray is indistinguishable from a broken screen.
    expect(marcas(container)).toHaveLength(1)
  })

  it("a marca diz de quem é, para quem ouve o ecrã", () => {
    const { container } = render(
      painel({ participants: [calado("@ana:s")], nameFor: () => "Ana", micMuted: false, soundOff: false }),
    )
    expect(marcas(container)[0]?.getAttribute("aria-label")).toBe(strings.call.micOffOf("Ana"))
  })

  it("é um desenho, e não uma letra nem um emoji", () => {
    const { container } = render(painel({ participants: [calado("@ana:s")] }))
    const svg = marcas(container)[0]?.querySelector("svg")
    expect(svg).toBeTruthy()
    // `currentColor` and not a color baked into the stroke: the icon has to turn
    // with the theme, like everything else in this product. The glyph moved from
    // stroke to solid, so the color is no longer in a `stroke` of the `<svg>`: it
    // is in each piece. Outside the mask (which is black and white by definition)
    // everything that paints has to paint with `currentColor`.
    const pintadas = [...(svg?.querySelectorAll("rect, path") ?? [])].filter((peca) => !peca.closest("mask"))
    expect(pintadas.length).toBeGreaterThan(0)
    for (const peca of pintadas) {
      const tintas = [peca.getAttribute("fill"), peca.getAttribute("stroke")].filter((t) => t !== null && t !== "none")
      expect(tintas.length).toBeGreaterThan(0)
      for (const tinta of tintas) expect(tinta).toBe("currentColor")
    }
  })

  it("o nosso próprio cartão leva a marca quando somos nós os calados", () => {
    const { container } = render(painel({ participants: [participant("@ana:s")], micMuted: true }))
    expect(marcas(container)).toHaveLength(1)
    expect(marcas(container)[0]?.getAttribute("aria-label")).toBe(strings.call.micOffOf("Eu"))
  })

  it("desligar o SOM não põe marca nenhuma em ninguém", () => {
    /**
     * The confusion the name `muted` caused once, now caught by a test. Without
     * sound, the boxes of others go quiet, but that is OUR decision not to listen
     * to them, and drawing it as if it were their decision not to speak would tell
     * everyone that the room went silent.
     */
    const { container } = render(painel({ participants: [participant("@ana:s")], soundOff: true }))
    const caixas = [...container.querySelectorAll<HTMLElement>(".call-video .tile")]
    // Ana's box is mute…
    expect(caixas[1]?.querySelector("video")?.muted).toBe(true)
    // …and has no badge: she did not say she went quiet.
    expect(caixas[1]?.querySelector(".tile-mic-off")).toBeNull()

    // Ours is another story: without sound, the microphone is muted by drag, and
    // that IS a fact about us that others will see on their side.
    expect(caixas[0]?.querySelector(".tile-mic-off")).toBeTruthy()
    expect(marcas(container)).toHaveLength(1)
  })

  it("a caixa de vídeo de quem está calado leva a mesma marca", () => {
    const { container } = render(painel({ participants: [calado("@ana:s")], nameFor: () => "Ana" }))
    const naCaixa = [...container.querySelectorAll<HTMLElement>(".call-video .tile-mic-off")]
    // Two: ours (nothing) and Ana's. Just hers.
    expect(naCaixa).toHaveLength(1)
    expect(naCaixa[0]?.getAttribute("aria-label")).toBe(strings.call.micOffOf("Ana"))
  })
})


describe("CallPanel — o menu da pessoa nos cartões (fase 3)", () => {
  it('clique direito no cartão da Ana abre o menu, e "Silenciar para mim" silencia-a', () => {
    localStorage.clear()
    const nada = (): void => {}
    const { container } = render(
      painel({
        menuDaPessoa: () => ({
          pessoa: {
            ehEuProprio: false,
            ehAmigo: true,
            canal: "!geral:s",
            canalAdmiteAdministracao: true,
            podeGerirPapeis: false,
            ehFundador: false,
            jaEhAdministrador: false,
            accoes: {
              verPerfil: nada,
              copiarEndereco: nada,
              mensagem: nada,
              chamada: nada,
              pedirAmizade: nada,
              aceitarAmizade: nada,
              desfazerAmizade: nada,
              convidarParaCanal: nada,
              alternarAdministrador: nada,
              expulsar: nada,
            },
          },
          podeMover: false,
          salaActual: "",
          salasDeVoz: [],
          mover: nada,
        }),
      }),
    )
    const cartoes = container.querySelectorAll<HTMLElement>(".call-chip")
    fireEvent.contextMenu(cartoes[1] as HTMLElement, { clientX: 5, clientY: 5 })
    expect(screen.getByText(strings.userMenu.profile)).toBeTruthy()
    fireEvent.click(screen.getByText(strings.call.menuSilence))
    expect(screen.getByText(strings.call.silenced)).toBeTruthy()
  })

  it("sem o contexto, o cartão não tem menu", () => {
    const { container } = render(painel())
    expect(container.querySelector(".call-chip .botao-mais")).toBeNull()
  })
})

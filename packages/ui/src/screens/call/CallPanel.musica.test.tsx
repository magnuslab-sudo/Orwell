import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Call, type EstadoDaMusica, type Participant } from "@enclave/client-core"
import type { UserAddress } from "@enclave/protocol"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { strings } from "../../strings.js"
import { CallPanel } from "./CallPanel.js"

/**
 * Music on the call panel: the button, the indicator, and the volume for the
 * listener. Phase 9.
 *
 * Three sides of the same thing. The person playing sees "Share audio" next to
 * "Share screen", and the indicator "Now playing: …" while playing. The listener
 * sees the same indicator on the player's card, and has a separate volume control
 * for the music and for that person's voice: changing one does not change the other.
 */

afterEach(cleanup)
beforeEach(() => localStorage.clear())
vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

const perfil = { displayName: "Eu", donations: [] } as unknown as Profile

function fluxo(id: string): MediaStream {
  const faixa = { kind: "audio", id: `${id}-faixa`, enabled: true, stop: () => {} }
  return {
    id,
    getTracks: () => [faixa],
    getVideoTracks: () => [],
    getAudioTracks: () => [faixa],
  } as unknown as MediaStream
}

function participante(address: string, extra: Partial<Participant> = {}): Participant {
  return {
    address: address as UserAddress,
    connected: true,
    stream: fluxo(`voz-${address}`),
    screen: null,
    video: false,
    encrypted: true,
    micMuted: false,
    ecraOferecido: false,
    aVerONossoEcra: false,
    ...extra,
  }
}

/** The engine, with or without music. `musica` changes via the event, like in `Call`. */
function motor(opcoes: { comMusica?: boolean; inicial?: EstadoDaMusica } = {}) {
  let estado: EstadoDaMusica = opcoes.inicial ?? null
  const ouvintes = new Set<(evento: { estado: EstadoDaMusica }) => void>()
  const emitir = (novo: EstadoDaMusica): void => {
    estado = novo
    for (const ouvinte of ouvintes) ouvinte({ estado })
  }
  const base = {
    setMuted: () => {},
    setCameraOff: () => {},
    podePartilharEcra: true,
    tectoDePartilha: Call.LIMITE_DE_PARTILHA,
    startScreenShare: async () => true,
    on: (evento: string, ouvinte: (carga: { estado: EstadoDaMusica }) => void) => {
      if (evento !== "music") return () => {}
      ouvintes.add(ouvinte)
      return () => ouvintes.delete(ouvinte)
    },
  }
  const comMusica = {
    ...base,
    get musica() {
      return estado
    },
    partilharMusica: async () => true,
    mudarATocar: (aTocar: string | null) => emitir({ aTocar }),
    pararMusica: async () => emitir(null),
  }
  return { call: (opcoes.comMusica === false ? base : comMusica) as unknown as EnclaveBridge["call"], emitir }
}

function painel(call: EnclaveBridge["call"], participants: Participant[] = [participante("@ana:s")]): React.JSX.Element {
  return (
    <CallPanel
      call={call}
      channel="!geral:s"
      participants={participants}
      localStream={null}
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

describe('"Partilhar áudio" na barra', () => {
  it('está ao lado de "Partilhar ecrã", e abre a folha com as fontes', () => {
    render(painel(motor().call))
    const botoes = [...document.querySelectorAll<HTMLElement>(".call-barra button")]
    const ecra = botoes.findIndex((botao) => botao.dataset["ecra"] === "1")
    expect(botoes[ecra + 1]?.dataset["musica"]).toBe("1")
    expect(botoes[ecra + 1]?.getAttribute("aria-label")).toBe(strings.musica.partilharAudioAria(false))

    fireEvent.click(botoes[ecra + 1]!)
    const folha = screen.getByRole("dialog")
    expect(folha.textContent).toContain(strings.musica.fonte("ficheiros"))
    expect(folha.textContent).toContain(strings.leitorDeMusica.adicionarFicheiros)
  })

  it("um motor sem música não mostra o botão", () => {
    render(painel(motor({ comMusica: false }).call))
    expect(document.querySelector("[data-musica='1']")).toBeNull()
  })

  it('a tocar: o botão fica aceso, e o sinal "A tocar: …" aparece no painel e no nosso cartão', () => {
    const { call, emitir } = motor()
    render(painel(call))
    act(() => emitir({ aTocar: "Abertura" }))

    expect(document.querySelector("[data-musica='1']")?.getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("status").textContent).toContain(strings.musica.aTocar("Abertura"))
    const nosso = document.querySelector(".call-person .call-chip-musica")
    expect(nosso?.textContent).toContain(strings.musica.aTocar("Abertura"))

    act(() => emitir({ aTocar: null }))
    expect(screen.getByRole("status").textContent).toContain(strings.musica.emPausa)
    act(() => emitir(null))
    expect(screen.queryByText(strings.musica.emPausa)).toBeNull()
  })
})

describe("a música de outra pessoa", () => {
  it("o cartão dela diz o que toca, e a música toca num elemento só dela", () => {
    const musica = fluxo("musica-da-ana")
    render(painel(motor().call, [participante("@ana:s", { musica, aTocar: "Fado" })]))

    const cartoes = [...document.querySelectorAll(".call-person")]
    expect(cartoes[1]?.querySelector(".call-chip-musica")?.textContent).toContain(strings.musica.aTocar("Fado"))
    // In the footer, on the line that scrolls when it does not fit (the `Andante`), and the card knows it has one.
    expect(cartoes[1]?.querySelector(".call-chip-musica .andante-caixa")?.textContent).toContain("Fado")
    expect(cartoes[1]?.querySelector(".call-chip")?.classList.contains("com-rodape")).toBe(true)
    expect(cartoes[0]?.querySelector(".call-chip")?.classList.contains("com-rodape")).toBe(false)
    const elementos = [...document.querySelectorAll<HTMLAudioElement>("audio[data-musica='1']")]
    expect(elementos).toHaveLength(1)
    expect(elementos[0]?.srcObject).toBe(musica)
  })

  it("o volume da música é à parte do da voz: mexer num não mexe no outro", () => {
    render(painel(motor().call, [participante("@ana:s", { musica: fluxo("musica-da-ana"), aTocar: "Fado" })]))
    const daMusica = screen.getByLabelText(strings.musica.volumeDaMusica("Ana")) as HTMLInputElement
    const daVoz = screen.getByLabelText(strings.call.volumeOf("Ana")) as HTMLInputElement

    fireEvent.change(daMusica, { target: { value: "0.3" } })

    const elemento = document.querySelector<HTMLAudioElement>("audio[data-musica='1']")!
    expect(elemento.volume).toBeCloseTo(0.3)
    expect(daVoz.value).toBe("1")
    // And the voice did not get muted: the "muted by you" badge is voice only.
    expect(document.querySelector(".silenced-badge")).toBeNull()

    fireEvent.change(daVoz, { target: { value: "0" } })
    expect(elemento.volume).toBeCloseTo(0.3)
  })

  it('"Silenciar a música" cala só a música; o cursor guarda o valor; "Ouvir a música" devolve-a', () => {
    render(painel(motor().call, [participante("@ana:s", { musica: fluxo("musica-da-ana"), aTocar: "Fado" })]))
    const daMusica = screen.getByLabelText(strings.musica.volumeDaMusica("Ana")) as HTMLInputElement
    fireEvent.change(daMusica, { target: { value: "0.3" } })
    const elemento = document.querySelector<HTMLAudioElement>("audio[data-musica='1']")!

    fireEvent.click(screen.getByRole("button", { name: strings.musicaNaChamada.silenciarDe("Ana") }))
    expect(elemento.muted).toBe(true)
    expect(daMusica.value).toBe("0.3")
    expect(screen.getByText(strings.musicaNaChamada.silenciada)).toBeTruthy()
    // The voice did not mute: no badge, no volume.
    expect(document.querySelector(".silenced-badge")).toBeNull()
    expect((screen.getByLabelText(strings.call.volumeOf("Ana")) as HTMLInputElement).value).toBe("1")
    // Stored on the device.
    expect(JSON.parse(localStorage.getItem("enclave.prefs") ?? "{}").musicasCaladas).toEqual(["@ana:s"])

    const ouvir = screen.getByRole("button", { name: strings.musicaNaChamada.ouvirDe("Ana") })
    expect(ouvir.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(ouvir)
    expect(elemento.muted).toBe(false)
    expect(elemento.volume).toBeCloseTo(0.3)
  })

  it("sem música a chegar não há cursor de música nem elemento", () => {
    render(painel(motor().call, [participante("@ana:s")]))
    expect(screen.queryByLabelText(strings.musica.volumeDaMusica("Ana"))).toBeNull()
    expect(document.querySelector("audio[data-musica='1']")).toBeNull()
    expect(document.querySelector(".call-chip-musica")).toBeNull()
    expect(screen.queryByRole("button", { name: strings.musicaNaChamada.silenciarDe("Ana") })).toBeNull()
  })
})

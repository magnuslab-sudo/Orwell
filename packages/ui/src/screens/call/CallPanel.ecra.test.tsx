import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Call, type Participant } from "@enclave/client-core"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { PESSOAS_COM_ECRA, type UserAddress } from "@enclave/protocol"
import { strings } from "../../strings.js"
import { CallPanel } from "./CallPanel.js"

/**
 * Screen sharing, seen from where the person is.
 *
 * What these tests measure is what you SEE: the button that appears and
 * disappears as the call accepts it, the screen that takes over the stage
 * when someone shares, the label that says whose it is, and the mark next to
 * the name of who is sharing.
 *
 * They do not measure `toHaveBeenCalled` on the engine: the harness wires the
 * button to a `Call` that actually changes state, and the assertion is about
 * the screen that comes out of it. A button wired to the wrong method, or a
 * stage that never appears, fail here.
 */

afterEach(cleanup)

// jsdom has no media pipeline; the boxes only need `play()` not to crash.
vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

const perfil = { displayName: "Eu", donations: [] } as unknown as Profile

/** A stream with a video track, which is what a shared screen is. */
function fluxoDeEcra(id: string): MediaStream {
  const faixa = { kind: "video", enabled: true, stop: () => {} }
  return {
    id,
    getTracks: () => [faixa],
    getVideoTracks: () => [faixa],
    getAudioTracks: () => [],
  } as unknown as MediaStream
}

/**
 * A full participant, with no `as` cast.
 *
 * The `as Participant` that was here was a type conversion, and a conversion is
 * a silent compiler: two new fields in the type, `ecraOferecido` and
 * `aVerONossoEcra`, slipped in without complaint, and the assertions passed
 * because a missing field reads as `undefined`, which happened to be what they
 * expected. Without the `as`, the field that the type gains tomorrow will break
 * here, and that is exactly where it should break.
 *
 * The only `as` that stays is on the address, and it is a different thing:
 * `UserAddress` is a branded string, and a brand only comes from whoever
 * validates it, writing a literal address in a test either goes through here
 * or through a `parse`, and a `parse` would only measure itself.
 */
function participante(address: string, extra: Partial<Participant> = {}): Participant {
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
    ...extra,
  }
}

/**
 * The call engine, with the two values the panel asks it for.
 *
 * `tectoDePartilha` is the second, and it is not decoration: the number depends
 * on the ENGINE of the call, six in the mesh, where the screen goes directly
 * to each person, and the cap of the SFU when there is a media server
 * replicating it. A tuple that did not give this would make the panel read
 * `undefined` and always draw the button as off.
 */
function motor(podePartilharEcra = true, tectoDePartilha = Call.LIMITE_DE_PARTILHA): EnclaveBridge["call"] {
  return {
    setMuted: () => {},
    setCameraOff: () => {},
    podePartilharEcra,
    tectoDePartilha,
  } as unknown as EnclaveBridge["call"]
}

function painel(overrides: Partial<React.ComponentProps<typeof CallPanel>> = {}): React.JSX.Element {
  return (
    <CallPanel
      call={motor()}
      channel="!geral:s"
      participants={[participante("@ana:s")]}
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

const palco = (): HTMLElement | null => document.querySelector(".call-palco")
const botaoDeEcra = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('.call-controls [data-ecra="1"]')

describe("CallPanel — o palco de quem partilha", () => {
  it("sem partilha nenhuma não há palco: a chamada de voz não ganha um rectângulo preto", () => {
    render(painel())
    expect(palco()).toBeNull()
  })

  it("o ecrã de outra pessoa ocupa o palco, e o rótulo diz de quem é", () => {
    const ecra = fluxoDeEcra("ecra-da-ana")
    render(painel({ participants: [participante("@ana:s", { screen: ecra })] }))

    expect(palco()).not.toBeNull()
    expect(screen.getByText(strings.call.screenOf("Ana"))).toBeTruthy()
    // And it is THAT stream hanging on the element, not any other: without this,
    // a stage wired to the wrong stream would pass anyway.
    expect(palco()?.querySelector("video")).toHaveProperty("srcObject", ecra)
  })

  it("o nosso ecrã vai a palco quando mais ninguém partilha, com o nome que se diz a nós", () => {
    const meu = fluxoDeEcra("ecra-nosso")
    render(painel({ screenStream: meu }))

    expect(screen.getByText(strings.call.screenSelf)).toBeTruthy()
    expect(palco()?.querySelector("video")).toHaveProperty("srcObject", meu)
  })

  it("com dois a partilhar, o palco é do OUTRO: o nosso já o temos à frente", () => {
    const dela = fluxoDeEcra("ecra-da-ana")
    const meu = fluxoDeEcra("ecra-nosso")
    render(painel({ participants: [participante("@ana:s", { screen: dela })], screenStream: meu }))

    expect(screen.getByText(strings.call.screenOf("Ana"))).toBeTruthy()
    expect(screen.queryByText(strings.call.screenSelf)).toBeNull()
    expect(palco()?.querySelector("video")).toHaveProperty("srcObject", dela)
  })

  it("o palco é mudo: um ecrã não traz som, e um elemento a tocar duas vezes traz eco", () => {
    render(painel({ participants: [participante("@ana:s", { screen: fluxoDeEcra("ecra-da-ana") })] }))
    expect(palco()?.querySelector("video")?.muted).toBe(true)
  })
})

/**
 * An offer to share the screen, and the choice to view it.
 *
 * Request from the owner on 5 October 2026: *when someone shares the screen,
 * others should join the stream only if they want to.* The stage used to open
 * on its own and bring 2.5 Mbps with it, there is no simulcast or layers, so
 * there is no small version to request, and there was nowhere to refuse.
 *
 * What we measure here is the screen: the "LIVE" card instead of the stage
 * (the bar at the top went out on 2 November 2026, "A with the C"), the gesture
 * that takes the right address to the core, and the count on both sides of the
 * share. What the SFU is told to route is measured in `call.sfu-quatro.test.ts`,
 * which is where the bandwidth shows up.
 */
describe("CallPanel — o ecrã que se vê por escolha", () => {
  const oferta = (): HTMLElement | null => document.querySelector(".call-chip.ao-vivo-convida")

  it("uma partilha que não pedimos é um cartão ao vivo, e não um palco", () => {
    render(painel({ participants: [participante("@ana:s", { ecraOferecido: true })] }))

    expect(palco(), "o palco abriu-se sem ninguém o pedir").toBeNull()
    expect(oferta()).not.toBeNull()
    expect(oferta()?.querySelector(".ao-vivo-selo")?.textContent).toContain(strings.call.aoVivo)
    // The invite says whose it is: "View the stream" alone does not say view what.
    expect(screen.getByRole("button", { name: strings.call.verATransmissaoDe("Ana") })).toBeTruthy()
    // The top bar does not exist anymore: the gesture is in the card.
    expect(document.querySelector(".call-oferta-ecra")).toBeNull()
  })

  it("clicar no cartão de quem partilha abre a partilha", () => {
    const aceitou: string[] = []
    const call = { ...motor(), aceitarEcra: async (quem: string) => void aceitou.push(quem) } as unknown as EnclaveBridge["call"]
    render(painel({ call, participants: [participante("@ana:s", { ecraOferecido: true })] }))
    fireEvent.click(oferta() as HTMLElement)
    expect(aceitou).toEqual(["@ana:s"])
  })

  it("o olho conta quem diz estar a ver aquele ecrã, e nós quando o estamos a ver", () => {
    const ana = "@ana:s" as UserAddress
    const { rerender } = render(
      painel({
        participants: [
          participante("@ana:s", { ecraOferecido: true }),
          participante("@rui:s", { aVer: [ana] }),
          participante("@zé:s", { aVer: [] }),
        ],
      }),
    )
    expect(screen.getByRole("img", { name: strings.call.screenViewers(1) })).toBeTruthy()

    rerender(
      painel({
        participants: [participante("@ana:s", { ecraOferecido: true, screen: fluxoDeEcra("e") }), participante("@rui:s", { aVer: [ana] })],
      }),
    )
    // We do too, and the invite goes out: already on the stage.
    expect(screen.getByRole("img", { name: strings.call.screenViewers(2) })).toBeTruthy()
    expect(oferta()).toBeNull()
  })

  it("carregar em Ver pede ao núcleo o ecrã DAQUELA pessoa", () => {
    const aceitou: string[] = []
    // `as unknown` in the middle: spreading a `Call` loses its private fields,
    // and the compiler refuses the direct cast. It is the same workaround that
    // `motor()` above does.
    const call = {
      ...motor(),
      aceitarEcra: async (quem: string) => void aceitou.push(quem),
    } as unknown as EnclaveBridge["call"]
    render(
      painel({
        call,
        participants: [participante("@ana:s", { ecraOferecido: true }), participante("@rui:s", { ecraOferecido: true })],
        nameFor: (quem: string) => (quem === "@ana:s" ? "Ana" : "Rui"),
      }),
    )

    fireEvent.click(screen.getByRole("button", { name: strings.call.verATransmissaoDe("Rui") }))
    // The address, not the row index: with two offers, a button wired to the first
    // would ask for the wrong screen and nothing on the screen would report it.
    expect(aceitou).toEqual(["@rui:s"])
  })

  it('com o fluxo em mão o palco abre, e a barra dá lugar ao "Parar de ver"', () => {
    const ecra = fluxoDeEcra("ecra-da-ana")
    render(painel({ participants: [participante("@ana:s", { ecraOferecido: true, screen: ecra })] }))

    expect(palco()).not.toBeNull()
    expect(oferta(), "a oferta ficou a oferecer o que já se está a ver").toBeNull()
    expect(screen.getByRole("button", { name: strings.call.screenStopWatchingAria("Ana") })).toBeTruthy()
  })

  it('e "Parar de ver" larga aquela pessoa', () => {
    const recusou: string[] = []
    // `as unknown` in the middle: spreading a `Call` loses its private fields,
    // and the compiler refuses the direct cast. It is the same workaround that
    // `motor()` above does.
    const call = {
      ...motor(),
      recusarEcra: async (quem: string) => void recusou.push(quem),
    } as unknown as EnclaveBridge["call"]
    render(painel({ call, participants: [participante("@ana:s", { ecraOferecido: true, screen: fluxoDeEcra("e") })] }))

    fireEvent.click(screen.getByRole("button", { name: strings.call.screenStopWatchingAria("Ana") }))
    expect(recusou).toEqual(["@ana:s"])
  })

  it("duas ofertas são dois cartões ao vivo: nenhum se come o outro", () => {
    render(
      painel({
        participants: [participante("@ana:s", { ecraOferecido: true }), participante("@rui:s", { ecraOferecido: true })],
      }),
    )
    expect(document.querySelectorAll(".call-chip.ao-vivo-convida")).toHaveLength(2)
  })

  it("quem partilha vê quantos estão a ver, e o zero diz-se", () => {
    /*
      The symmetric hole of the request, and of the same piece: whoever shares did
      not know who is watching. Sharing a screen that nobody sees is precisely
      what you want to know before talking to it for ten minutes, so zero shows
      up instead of staying silent.
    */
    const meu = fluxoDeEcra("ecra-nosso")
    const { rerender } = render(painel({ screenStream: meu, participants: [participante("@ana:s")] }))
    expect(screen.getByText(strings.call.screenViewers(0))).toBeTruthy()

    rerender(
      painel({
        screenStream: meu,
        participants: [participante("@ana:s", { aVerONossoEcra: true }), participante("@rui:s")],
      }),
    )
    expect(screen.getByText(strings.call.screenViewers(1))).toBeTruthy()
    expect(screen.queryByText(strings.call.screenViewers(0))).toBeNull()
  })

  it("sem partilharmos nada, não há contagem nenhuma a fazer", () => {
    render(painel({ participants: [participante("@ana:s", { aVerONossoEcra: true })] }))
    expect(screen.queryByText(strings.call.screenViewers(1))).toBeNull()
  })
})

/**
 * The mark of who is sharing, next to the name.
 *
 * The stage shows ONE screen. In a call where two people are sharing, or where
 * whoever is sharing is not who is on stage, the list of people is the only
 * place where the fact appears in full.
 */
describe("CallPanel — quem está a partilhar", () => {
  const marcas = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".call-people .screen-badge")]

  it("a marca é de quem partilha, e diz o nome para quem ouve o ecrã", () => {
    render(painel({ participants: [participante("@ana:s", { screen: fluxoDeEcra("e") }), participante("@rui:s")] }))

    expect(marcas()).toHaveLength(1)
    expect(marcas()[0]?.getAttribute("aria-label")).toBe(strings.call.sharingOf("Ana"))
  })

  it("e o nosso próprio cartão leva-a quando somos nós a partilhar", () => {
    render(painel({ participants: [participante("@ana:s")], screenStream: fluxoDeEcra("meu") }))

    expect(marcas()).toHaveLength(1)
    expect(marcas()[0]?.getAttribute("aria-label")).toBe(strings.call.sharingOf("Eu"))
  })

  it("ninguém a partilhar, marca nenhuma", () => {
    render(painel())
    expect(marcas()).toHaveLength(0)
  })
})

describe("CallPanel — o botão de partilhar", () => {
  /**
   * The harness that makes the button worth something.
   *
   * A `Call` pretending but with real state: sharing puts a stream, stopping
   * removes it, and the panel redraws with what came out of it. That is why the
   * assertions below are about the screen and not about a spy, a button wired
   * to the wrong method does not make the stage appear, and a `toHaveBeenCalled`
   * would not catch it.
   */
  function Arnes({ podePartilhar = true }: { podePartilhar?: boolean }): React.JSX.Element {
    const [ecra, setEcra] = useState<MediaStream | null>(null)
    const call = {
      setMuted: () => {},
      setCameraOff: () => {},
      podePartilharEcra: podePartilhar,
      tectoDePartilha: Call.LIMITE_DE_PARTILHA,
      startScreenShare: async (): Promise<boolean> => {
        setEcra(fluxoDeEcra("ecra-nosso"))
        return true
      },
      stopScreenShare: async (): Promise<void> => setEcra(null),
    } as unknown as EnclaveBridge["call"]

    return painel({ call, screenStream: ecra, participants: [] })
  }

  it("carregar põe o nosso ecrã em palco; carregar outra vez tira-o", async () => {
    render(<Arnes />)
    expect(palco()).toBeNull()

    fireEvent.click(botaoDeEcra()!)
    // Sharing is asynchronous: we wait for React to track the new state.
    expect(await screen.findByText(strings.call.screenSelf)).toBeTruthy()

    fireEvent.click(botaoDeEcra()!)
    await vi.waitFor(() => expect(palco()).toBeNull())
  })

  it("o botão diz o que vai fazer, e muda quando o estado muda", async () => {
    render(<Arnes />)
    expect(botaoDeEcra()?.getAttribute("data-tip")).toBe(strings.call.shareScreen)
    expect(botaoDeEcra()?.getAttribute("aria-label")).toBe(strings.call.screenAria(false))

    fireEvent.click(botaoDeEcra()!)
    await screen.findByText(strings.call.screenSelf)

    expect(botaoDeEcra()?.getAttribute("data-tip")).toBe(strings.call.stopScreen)
    expect(botaoDeEcra()?.getAttribute("aria-label")).toBe(strings.call.screenAria(true))
  })

  it("numa chamada que não aceita partilha o botão não se oferece, e diz-se porquê", () => {
    render(<Arnes podePartilhar={false} />)

    // No offer and refuse after: see `Call.podePartilharEcra`.
    expect(botaoDeEcra()).toBeNull()
    expect(screen.getByText(strings.call.shareScreenBySfu)).toBeTruthy()
  })

  it("acima do tecto de participantes também não se oferece, e a razão é outra", () => {
    // Seven people: six pairs plus us, one over `LIMITE_DE_PARTILHA`.
    const gente = Array.from({ length: 6 }, (_, i) => participante(`@p${i}:s`))
    render(painel({ participants: gente }))

    expect(botaoDeEcra()).toBeNull()
    expect(screen.getByText(strings.call.shareScreenByPeople(6))).toBeTruthy()
    // And the right reason: the physics of the cap is not the server's.
    expect(screen.queryByText(strings.call.shareScreenBySfu)).toBeNull()
  })


  it("numa chamada por SFU o tecto é outro, e a frase também", () => {
    /*
     * Seven people in an SFU call: above the MESH cap and well below the
     * server's. With the mesh constant read here, which is what was written,      * the button would disappear from someone who fit perfectly, with a phrase
     * about the rise of whoever is sharing that in this call does not blow up
     * anything.
     */
    const gente = Array.from({ length: 6 }, (_, i) => participante(`@p${i}:s`))
    render(painel({ call: motor(true, PESSOAS_COM_ECRA), participants: gente }))

    expect(botaoDeEcra()).not.toBeNull()
  })

  it("e acima do tecto do SFU diz o limite, e não fala da subida de quem partilha", () => {
    const gente = Array.from({ length: PESSOAS_COM_ECRA }, (_, i) => participante(`@p${i}:s`))
    render(painel({ call: motor(true, PESSOAS_COM_ECRA), participants: gente }))

    expect(botaoDeEcra()).toBeNull()
    expect(screen.getByText(strings.call.shareScreenByPeople(PESSOAS_COM_ECRA, true))).toBeTruthy()
    // In this call the screen does not go straight to anyone. Talking about the
    // rise of whoever is sharing would send you looking for the fault in the home
    // connection.
    expect(strings.call.shareScreenByPeople(PESSOAS_COM_ECRA, true)).not.toMatch(/subida/)
  })

  it("a seis ainda cabe: o tecto é o limite, e não um a menos", () => {
    const gente = Array.from({ length: 5 }, (_, i) => participante(`@p${i}:s`))
    render(painel({ participants: gente }))
    expect(botaoDeEcra()).not.toBeNull()
  })

  /**
   * The host that has to speak first, which is the installed app.
   *
   * There, between the click and the capture are two things: the macOS
   * permission, and someone choosing the window. Both live in
   * `usePartilhaDeEcra`, and the panel does not know about either, it gets a
   * gesture and calls it instead of going to the engine. With the gesture wired
   * to the engine by mistake, or not wired to anything, screen sharing in the
   * installed app goes back to what it was: a button that does nothing and says
   * nothing.
   */
  it("com anfitrião que trata do pedido, o botão passa por ele e não abre captura nenhuma", async () => {
    function ArnesComAnfitriao(): React.JSX.Element {
      const [ecra, setEcra] = useState<MediaStream | null>(null)
      const [aPedir, setAPedir] = useState(false)
      const call = {
        setMuted: () => {},
        setCameraOff: () => {},
        podePartilharEcra: true,
        tectoDePartilha: Call.LIMITE_DE_PARTILHA,
        // If the button calls this, the stage appears, and the test sees it.
        startScreenShare: async (): Promise<boolean> => {
          setEcra(fluxoDeEcra("ecra-do-motor"))
          return true
        },
        stopScreenShare: async (): Promise<void> => setEcra(null),
      } as unknown as EnclaveBridge["call"]

      return (
        <>
          {aPedir && <p>o anfitrião foi chamado</p>}
          {painel({ call, screenStream: ecra, participants: [], onShareScreen: () => setAPedir(true) })}
        </>
      )
    }

    render(<ArnesComAnfitriao />)
    fireEvent.click(botaoDeEcra()!)

    expect(await screen.findByText("o anfitrião foi chamado")).toBeTruthy()
    // And the engine stayed quiet: no stage, no capture behind the permission gate.
    expect(palco()).toBeNull()
  })

  /**
   * STOP never goes through the host, and that is on purpose.
   *
   * There is no permission to ask in order to stop doing a thing. If the stop
   * button went through the same path, a permission sheet open in the middle
   * would leave the person sharing with no way to undo it.
   */
  it("parar de partilhar continua a ir direito ao motor, mesmo com anfitrião ligado", async () => {
    function ArnesAPartilhar(): React.JSX.Element {
      const [ecra, setEcra] = useState<MediaStream | null>(fluxoDeEcra("ecra-nosso"))
      const [pedidos, setPedidos] = useState(0)
      const call = {
        setMuted: () => {},
        setCameraOff: () => {},
        podePartilharEcra: true,
        tectoDePartilha: Call.LIMITE_DE_PARTILHA,
        startScreenShare: async (): Promise<boolean> => true,
        stopScreenShare: async (): Promise<void> => setEcra(null),
      } as unknown as EnclaveBridge["call"]

      return (
        <>
          <p>pedidos ao anfitrião: {pedidos}</p>
          {painel({ call, screenStream: ecra, participants: [], onShareScreen: () => setPedidos((n) => n + 1) })}
        </>
      )
    }

    render(<ArnesAPartilhar />)
    expect(screen.getByText(strings.call.screenSelf)).toBeTruthy()

    fireEvent.click(botaoDeEcra()!)

    await vi.waitFor(() => expect(palco()).toBeNull())
    expect(screen.getByText("pedidos ao anfitrião: 0")).toBeTruthy()
  })
})

/**
 * The stage does not crop what it shows, and the mosaic keeps cropping.
 *
 * Read from the style file because jsdom applies no stylesheets: a test that
 * only checked the class name would follow any rename and always say yes. What
 * matters is the rule.
 *
 * Both halves are needed. A 16:9 screen inside a 190x128 box with `cover` loses
 * the edges, which on a shared screen is where the tab bar and the editor
 * sidebar live. And the mosaic of FACES still wants `cover`, because a face
 * with black bars on both sides is worse than a cropped face.
 */
describe("o palco mostra o ecrã inteiro", () => {
  function estilos(): string {
    const meu = expect.getState().testPath
    if (!meu) throw new Error("sem caminho do teste: não há folha de estilo para ler")
    // src/screens/call/ → src/styles/
    return readFileSync(join(dirname(meu), "..", "..", "styles", "screens.css"), "utf8")
  }

  /** The body of a selector block, so we can assert what it says. */
  function regra(css: string, selector: string): string {
    const inicio = css.indexOf(`\n${selector} {`)
    if (inicio < 0) throw new Error(`não há regra para ${selector}`)
    return css.slice(inicio, css.indexOf("}", inicio))
  }

  it("o vídeo do palco cabe inteiro, e o do mosaico continua a preencher", () => {
    const css = estilos()
    expect(regra(css, ".call-palco video")).toContain("object-fit: contain")
    expect(regra(css, ".tile video")).toContain("object-fit: cover")
  })
})

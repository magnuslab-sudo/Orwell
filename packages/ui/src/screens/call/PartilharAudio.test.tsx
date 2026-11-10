import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { LeitorDeMusica, type EstadoDaMusica } from "@enclave/client-core"
import type { EnclaveBridge } from "../../bridge.js"
import { leitorDaChamada, useMusicaDaChamada } from "../../hooks/useMusicaDaChamada.js"
import { anfitriaoDoAgente, fontesDeAudioDoAnfitriao, type Anfitriao } from "../../lib/fontesDeAudio.js"
import { strings } from "../../strings.js"
import { readPrefs } from "../../hooks/usePrefs.js"
import { formatarTempo, PartilharAudio, SinalDaMusica } from "./PartilharAudio.js"

/**
 * The "Share audio" sheet, from the person's view. Phase 9.
 *
 * The player is real (`LeitorDeMusica`), with sound swapped for fakes, and the
 * call is a fake that records what it is asked. What is measured is what is
 * SEEN (the sources, the reason phrase, the list, what is playing) and what
 * comes from the click.
 */

afterEach(cleanup)

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
const ELECTRON_WINDOWS = `${CHROME_WINDOWS} Electron/33.0.0`

function porque(anfitriao: Anfitriao): Record<string, string | null> {
  return Object.fromEntries(fontesDeAudioDoAnfitriao(anfitriao).map((cada) => [cada.fonte, cada.porque]))
}

describe("o que o anfitrião sabe dar", () => {
  it("lê o sistema e o motor do agente", () => {
    expect(anfitriaoDoAgente(CHROME_MAC, false)).toEqual({ secretaria: false, sistema: "macos", motor: "chromium" })
    expect(anfitriaoDoAgente(FIREFOX_LINUX, false)).toEqual({ secretaria: false, sistema: "linux", motor: "firefox" })
    expect(anfitriaoDoAgente(SAFARI_MAC, false)).toEqual({ secretaria: false, sistema: "macos", motor: "safari" })
    expect(anfitriaoDoAgente(ELECTRON_WINDOWS, true)).toEqual({ secretaria: true, sistema: "windows", motor: "chromium" })
  })

  it("as quatro fontes estão feitas: o que fica desligado é só a plataforma", () => {
    const activas = (agente: string) =>
      fontesDeAudioDoAnfitriao(anfitriaoDoAgente(agente, agente.includes("Electron"))).map((cada) => [cada.fonte, cada.activa])
    expect(activas(CHROME_WINDOWS)).toEqual([
      ["ficheiros", true],
      ["separador", true],
      ["sistema", true],
      ["janela", false],
    ])
    expect(activas(CHROME_MAC)).toEqual([
      ["ficheiros", true],
      ["separador", true],
      ["sistema", false],
      ["janela", false],
    ])
    expect(activas(ELECTRON_WINDOWS)).toEqual([
      ["ficheiros", true],
      ["separador", true],
      ["sistema", true],
      ["janela", true],
    ])
    for (const agente of [FIREFOX_LINUX, SAFARI_MAC]) {
      expect(activas(agente).filter(([, activa]) => activa)).toEqual([["ficheiros", true]])
    }
  })

  it('nenhuma fonte diz "ainda não", em nenhum anfitrião', () => {
    for (const agente of [CHROME_MAC, FIREFOX_LINUX, SAFARI_MAC, CHROME_WINDOWS, ELECTRON_WINDOWS]) {
      const fontes = fontesDeAudioDoAnfitriao(anfitriaoDoAgente(agente, agente.includes("Electron")))
      expect(fontes.map((cada) => cada.porque)).not.toContain("ainda-nao")
    }
  })

  it("Firefox e Safari: o browser não dá o separador; fora do Windows o sistema é só na app", () => {
    expect(porque(anfitriaoDoAgente(FIREFOX_LINUX, false))).toEqual({
      ficheiros: null,
      separador: "separador-sem-browser",
      sistema: "sistema-so-na-app",
      janela: "janela-sem-browser",
    })
    expect(porque(anfitriaoDoAgente(SAFARI_MAC, false)).separador).toBe("separador-sem-browser")
  })

  it("Chromium no Windows dá separador e sistema; a janela continua a dizer porque não", () => {
    expect(porque(anfitriaoDoAgente(CHROME_WINDOWS, false))).toEqual({
      ficheiros: null,
      separador: null,
      sistema: null,
      janela: "janela-sem-browser",
    })
  })

  it("a app de secretária: tudo é da plataforma, menos o Linux", () => {
    expect(porque({ secretaria: true, sistema: "macos", motor: "chromium" })).toEqual({
      ficheiros: null,
      separador: null,
      sistema: null,
      janela: null,
    })
    expect(porque({ secretaria: true, sistema: "linux", motor: "chromium" })).toMatchObject({
      sistema: "sistema-linux",
      janela: "janela-linux",
    })
  })
})

// ------------------------------------------------------------ a folha

/** The fake sound: a context, an element, and a track. */
function leitorFalso(): LeitorDeMusica {
  const faixa = { kind: "audio", id: "faixa-do-leitor", stop: vi.fn() }
  const no = { connect: () => {} }
  return new LeitorDeMusica({
    criarContexto: () =>
      ({
        state: "running",
        resume: async () => {},
        close: async () => {},
        destination: {},
        createMediaElementSource: () => no,
        createMediaStreamDestination: () => ({ ...no, channelCount: 2, stream: { getAudioTracks: () => [faixa], getTracks: () => [faixa] } }),
        createGain: () => ({ ...no, gain: { value: 1 } }),
      }) as unknown as AudioContext,
    criarElemento: () =>
      ({ play: async () => {}, pause: () => {}, removeAttribute: () => {}, src: "" }) as unknown as HTMLAudioElement,
    criarUrl: () => "blob:x",
    largarUrl: () => {},
    aleatorio: () => 0,
  })
}

/** The fake call: records what it is asked and emits `music` like `Call` does. */
function chamadaFalsa(opcoes: { recusa?: boolean } = {}) {
  let estado: EstadoDaMusica = null
  const ouvintes = new Set<(evento: { estado: EstadoDaMusica }) => void>()
  const emitir = (novo: EstadoDaMusica): void => {
    estado = novo
    for (const ouvinte of ouvintes) ouvinte({ estado })
  }
  const pedidos: string[] = []
  const call = {
    get musica() {
      return estado
    },
    partilharMusica: vi.fn(async (faixa: MediaStreamTrack, aTocar: string | null) => {
      pedidos.push(`partilhar ${faixa.id} ${aTocar}`)
      if (opcoes.recusa) return false
      emitir({ aTocar })
      return true
    }),
    mudarATocar: (aTocar: string | null) => {
      pedidos.push(`a tocar ${aTocar}`)
      emitir({ aTocar })
    },
    pararMusica: async () => {
      pedidos.push("parar")
      emitir(null)
    },
    on: (evento: string, ouvinte: (carga: { estado: EstadoDaMusica }) => void) => {
      if (evento !== "music") return () => {}
      ouvintes.add(ouvinte)
      return () => ouvintes.delete(ouvinte)
    },
  }
  return { call: call as unknown as EnclaveBridge["call"], pedidos }
}

function Arnes({ call, agente = CHROME_MAC }: { call: EnclaveBridge["call"]; agente?: string }): React.JSX.Element {
  const musica = useMusicaDaChamada(call)
  return (
    <PartilharAudio
      musica={musica}
      fontes={fontesDeAudioDoAnfitriao(anfitriaoDoAgente(agente, false))}
      onFechar={() => {}}
    />
  )
}

function montar(opcoes: { recusa?: boolean; agente?: string } = {}) {
  const chamada = chamadaFalsa(opcoes)
  const leitor = leitorDaChamada(chamada.call, leitorFalso)
  render(<Arnes call={chamada.call} {...(opcoes.agente ? { agente: opcoes.agente } : {})} />)
  return { ...chamada, leitor }
}

function escolher(nomes: string[]): void {
  const entrada = screen.getByLabelText(strings.musica.escolherFicheiros, { selector: "input" }) as HTMLInputElement
  const ficheiros = nomes.map((nome) => new File(["x"], nome))
  fireEvent.change(entrada, { target: { files: ficheiros } })
}

function nomesNaLista(): string[] {
  return [...document.querySelectorAll(".audio-faixa-titulo")].map((cada) => cada.textContent ?? "")
}

describe('a folha "Partilhar áudio"', () => {
  it('mostra as quatro fontes; só "Ficheiros ou lista" se escolhe, e as outras dizem porquê', () => {
    montar({ agente: FIREFOX_LINUX })
    const fontes = [...document.querySelectorAll<HTMLElement>(".audio-fonte")]
    expect(fontes.map((cada) => cada.querySelector(".audio-fonte-nome")?.textContent)).toEqual([
      strings.musica.fonte("ficheiros"),
      strings.musica.fonte("separador"),
      strings.musica.fonte("sistema"),
      strings.musica.fonte("janela"),
    ])
    expect(fontes.map((cada) => cada.querySelector("input")?.disabled)).toEqual([false, true, true, true])
    expect(fontes[1]?.textContent).toContain(strings.musica.porqueNao("separador-sem-browser"))
    expect(fontes[1]?.textContent).toContain("Este browser não dá o áudio de um separador.")
    expect(fontes[2]?.textContent).toContain("Só na app de secretária, em Windows e macOS 14.2 ou mais.")
  })

  it("escolher ficheiros põe-nos na lista pelo nome; um que não é áudio fica de fora", () => {
    montar()
    escolher(["01 Abertura.mp3", "capa.jpg", "02 Fado.flac"])
    expect(nomesNaLista()).toEqual(["01 Abertura", "02 Fado"])
    expect(screen.queryByText(strings.musica.nenhumAudio)).toBeNull()
  })

  it("só ficheiros que não são áudio: diz-se, em vez de não fazer nada", () => {
    montar()
    escolher(["capa.jpg"])
    expect(screen.getByRole("alert").textContent).toBe(strings.musica.nenhumAudio)
  })

  it('"Tocar" toca e põe a música na chamada com o nome; o que toca está marcado', async () => {
    const { pedidos } = montar()
    escolher(["01 Abertura.mp3", "02 Fado.mp3"])
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.musica.tocar }))
    })
    expect(pedidos).toContain("partilhar faixa-do-leitor 01 Abertura")
    const actual = document.querySelector('[aria-current="true"] .audio-faixa-titulo')
    expect(actual?.textContent).toBe("01 Abertura")
    expect(screen.getByRole("button", { name: strings.musica.pausar })).toBeTruthy()
  })

  it("saltar anuncia a faixa seguinte; pausar deixa de anunciar o nome", async () => {
    const { pedidos } = montar()
    escolher(["01 Abertura.mp3", "02 Fado.mp3"])
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.musica.tocar }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.musica.saltar }))
    })
    expect(pedidos).toContain("a tocar 02 Fado")
    expect(document.querySelector('[aria-current="true"] .audio-faixa-titulo')?.textContent).toBe("02 Fado")

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.musica.pausar }))
    })
    expect(pedidos.at(-1)).toBe("a tocar null")
  })

  it("baralhar muda a ordem do que falta; tirar da lista tira", async () => {
    montar()
    escolher(["a.mp3", "b.mp3", "c.mp3", "d.mp3"])
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.musica.baralhar }))
    })
    expect(nomesNaLista()).toEqual(["a", "c", "d", "b"])
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.musica.remover("d") }))
    })
    expect(nomesNaLista()).toEqual(["a", "c", "b"])
  })

  it("carregar no nome de uma faixa toca essa", async () => {
    const { pedidos } = montar()
    escolher(["a.mp3", "b.mp3"])
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.musica.tocarEsta("b") }))
    })
    expect(pedidos).toContain("partilhar faixa-do-leitor b")
  })

  it('"Parar" tira a música da chamada e deixa a lista', async () => {
    const { pedidos, leitor } = montar()
    escolher(["a.mp3"])
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.musica.tocar }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.musica.pararAria }))
    })
    expect(pedidos.at(-1)).toBe("parar")
    expect(leitor.estado.aTocar).toBe(false)
    expect(nomesNaLista()).toEqual(["a"])
    // No music on the call, so "Stop" stays in the transport, disabled.
    expect((screen.getByRole("button", { name: strings.musica.pararAria }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("uma chamada que não leva a música: o leitor pára, para o DJ não ficar a ouvir sozinho", async () => {
    const { leitor } = montar({ recusa: true })
    escolher(["a.mp3"])
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.musica.tocar }))
    })
    expect(leitor.estado.aTocar).toBe(false)
  })

  it('"Volume da emissão" muda o que sai, guarda-se no aparelho, e diz-se no sinal', async () => {
    localStorage.clear()
    const { leitor } = montar()
    const cursor = screen.getByRole("slider", { name: new RegExp(`^${strings.musicaNaChamada.volumeDaEmissao}`) })
    expect((cursor as HTMLInputElement).value).toBe("100")
    fireEvent.change(cursor, { target: { value: "40" } })
    expect(leitor.volumeDaEmissao).toBe(0.4)
    expect(readPrefs().volumeDaEmissao).toBe(0.4)
    // The "Volume for you" did not change.
    expect(leitor.volumeLocal).toBe(1)
    const sinal = render(<SinalDaMusica musica={{ aTocar: "Fado" }} volumeDaEmissao={0.4} />)
    expect(sinal.container.querySelector(".call-musica")?.textContent).toContain(strings.musicaNaChamada.emissaoA(40))
    localStorage.clear()
  })

  it("o visor diz o tempo em dígitos e o nome da faixa no letreiro; repetir é um interruptor", async () => {
    montar()
    escolher(["01 Abertura.mp3"])
    const visor = screen.getByRole("region", { name: strings.leitorDeMusica.visor })
    expect(visor.querySelector(".audio-visor-digitos")?.textContent).toBe("0:00")
    expect(visor.querySelector(".audio-visor-fantasma")?.textContent).toBe("8:88")
    expect(visor.querySelector(".audio-visor-letreiro")?.textContent).toContain("1. 01 Abertura")
    const repetir = screen.getByRole("button", { name: strings.leitorDeMusica.repetir })
    expect(repetir.getAttribute("aria-pressed")).toBe("false")
    await act(async () => {
      fireEvent.click(repetir)
    })
    expect(repetir.getAttribute("aria-pressed")).toBe("true")
  })

  it("as outras fontes vão para o rodapé, depois da lista", () => {
    montar()
    const rodape = document.querySelector(".audio-fontes-rodape")
    const lista = document.querySelector(".audio-lista")
    expect(rodape?.querySelectorAll(".audio-fonte")).toHaveLength(4)
    expect(lista && rodape ? lista.compareDocumentPosition(rodape) & Node.DOCUMENT_POSITION_FOLLOWING : 0).toBeTruthy()
  })
})

describe("formatarTempo", () => {
  it("minutos e segundos, e horas só quando há", () => {
    expect(formatarTempo(0)).toBe("0:00")
    expect(formatarTempo(222.7)).toBe("3:42")
    expect(formatarTempo(3725)).toBe("1:02:05")
    expect(formatarTempo(Number.NaN)).toBe("0:00")
  })
})

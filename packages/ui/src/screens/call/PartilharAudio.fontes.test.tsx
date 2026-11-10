import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { LeitorDeMusica, type EstadoDaMusica } from "@enclave/client-core"
import type { EnclaveBridge } from "../../bridge.js"
import { leitorDaChamada, useMusicaDaChamada } from "../../hooks/useMusicaDaChamada.js"
import { anfitriaoDoAgente, fontesDeAudioDoAnfitriao } from "../../lib/fontesDeAudio.js"
import { registarAppDoDj } from "../../lib/pedidoDoDj.js"
import { strings } from "../../strings.js"
import { PartilharAudio } from "./PartilharAudio.js"

/**
 * The audio sources captured on the "Share audio" sheet: tab, system, and
 * window.
 *
 * The `getDisplayMedia` and the browser's `AudioContext` are doubles in
 * `globalThis`, and the rest is the real path: the sheet, the hook, the core
 * (`capturarSomDaFonte`) and a fake call. What is measured is what is seen and
 * what reaches the call.
 */

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
const ELECTRON_WINDOWS = `${CHROME_WINDOWS} Electron/43.0.0`

interface Faixa {
  kind: string
  id: string
  label: string
  readyState: string
  stop: ReturnType<typeof vi.fn>
  addEventListener: (nome: string, ouvinte: () => void) => void
  terminar: () => void
  /** The spectrum on the sheet reads a clone. */
  clone: () => Faixa
}

function faixa(kind: string, id: string, label = ""): Faixa {
  const ouvintes: (() => void)[] = []
  const f: Faixa = {
    kind,
    id,
    label,
    readyState: "live",
    stop: vi.fn(() => {
      f.readyState = "ended"
    }),
    addEventListener: (nome, ouvinte) => {
      if (nome === "ended") ouvintes.push(ouvinte)
    },
    terminar: () => {
      f.readyState = "ended"
      for (const ouvinte of ouvintes) ouvinte()
    },
    clone: () => faixa(kind, `${id}-clone`),
  }
  return f
}

const fluxo = (faixas: Faixa[]) => ({
  getTracks: () => faixas,
  getAudioTracks: () => faixas.filter((f) => f.kind === "audio"),
  getVideoTracks: () => faixas.filter((f) => f.kind === "video"),
})

/** The fake browser: what the selector returns, and what was asked of it. */
let devolve: () => Faixa[] = () => []
let pedidos: Record<string, unknown>[] = []
let saidas: Faixa[] = []
let somDoBrowser: Faixa | null = null

beforeEach(() => {
  pedidos = []
  saidas = []
  somDoBrowser = null
  devolve = () => {
    somDoBrowser = faixa("audio", "som-do-browser")
    return [faixa("video", "imagem", "Rádio - YouTube"), somDoBrowser]
  }
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getDisplayMedia: vi.fn(async (pedido: Record<string, unknown>) => {
        pedidos.push(pedido)
        return fluxo(devolve())
      }),
    },
  })
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running"
      resume = async () => {}
      close = async () => {}
      createMediaStreamSource = () => ({ connect: () => {} })
      createGain = () => ({ gain: { value: 1 }, connect: () => {} })
      createMediaStreamDestination = () => {
        const saida = faixa("audio", `destino-${saidas.length + 1}`)
        saidas.push(saida)
        return { channelCount: 1, stream: { getAudioTracks: () => [saida] } }
      }
    },
  )
  vi.stubGlobal("MediaStream", class {
    constructor(readonly faixas: unknown[]) {}
    getAudioTracks() {
      return this.faixas
    }
    getTracks() {
      return this.faixas
    }
  })
})

afterEach(() => {
  cleanup()
  registarAppDoDj(null)
  vi.unstubAllGlobals()
})

function leitorFalso(): LeitorDeMusica {
  const saida = faixa("audio", "faixa-do-leitor")
  const no = { connect: () => {} }
  return new LeitorDeMusica({
    criarContexto: () =>
      ({
        state: "running",
        resume: async () => {},
        close: async () => {},
        destination: {},
        createMediaElementSource: () => no,
        createMediaStreamDestination: () => ({ ...no, channelCount: 2, stream: { getAudioTracks: () => [saida], getTracks: () => [saida] } }),
        createGain: () => ({ ...no, gain: { value: 1 } }),
      }) as unknown as AudioContext,
    criarElemento: () => ({ play: async () => {}, pause: () => {}, removeAttribute: () => {}, src: "" }) as unknown as HTMLAudioElement,
    criarUrl: () => "blob:x",
    largarUrl: () => {},
    aleatorio: () => 0,
    lerDuracao: async () => null,
  })
}

function chamadaFalsa(opcoes: { afk?: boolean } = {}) {
  let estado: EstadoDaMusica = null
  const ouvintes = new Set<(evento: { estado: EstadoDaMusica }) => void>()
  const emitir = (novo: EstadoDaMusica): void => {
    estado = novo
    for (const ouvinte of ouvintes) ouvinte({ estado })
  }
  const registo: string[] = []
  const call = {
    emSalaAfk: opcoes.afk === true,
    get musica() {
      return estado
    },
    partilharMusica: vi.fn(async (f: MediaStreamTrack, aTocar: string | null) => {
      registo.push(`partilhar ${f.id} ${aTocar}`)
      emitir({ aTocar })
      return true
    }),
    mudarATocar: (aTocar: string | null) => {
      registo.push(`a tocar ${aTocar}`)
      emitir({ aTocar })
    },
    pararMusica: vi.fn(async () => {
      registo.push("parar")
      emitir(null)
    }),
    on: (evento: string, ouvinte: (carga: { estado: EstadoDaMusica }) => void) => {
      if (evento !== "music") return () => {}
      ouvintes.add(ouvinte)
      return () => ouvintes.delete(ouvinte)
    },
  }
  return { call: call as unknown as EnclaveBridge["call"], registo }
}

function Arnes({ call, agente }: { call: EnclaveBridge["call"]; agente: string }): React.JSX.Element {
  const musica = useMusicaDaChamada(call)
  const secretaria = agente.includes("Electron")
  return (
    <PartilharAudio
      musica={musica}
      fontes={fontesDeAudioDoAnfitriao(anfitriaoDoAgente(agente, secretaria))}
      secretaria={secretaria}
      onFechar={() => {}}
    />
  )
}

function montar(opcoes: { afk?: boolean; agente?: string } = {}) {
  const chamada = chamadaFalsa(opcoes)
  const leitor = leitorDaChamada(chamada.call, leitorFalso)
  render(<Arnes call={chamada.call} agente={opcoes.agente ?? CHROME_WINDOWS} />)
  return { ...chamada, leitor }
}

function escolherFonte(fonte: "separador" | "sistema" | "janela"): void {
  fireEvent.click(screen.getByRole("radio", { name: new RegExp(strings.musica.fonte(fonte)) }))
}

async function partilhar(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: strings.musica.escolherFonte }))
  })
}

describe("as fontes capturadas, na folha", () => {
  it('escolher "Som do sistema" diz o que fazer antes do clique: o ecrã inteiro e a caixa', () => {
    montar()
    escolherFonte("sistema")
    expect(screen.getByText(strings.musica.notaDaFonte("sistema", false))).toBeTruthy()
    expect(screen.getByText(/marca a caixa "Partilhar também o áudio do sistema"/)).toBeTruthy()
  })

  it("separador: pede o separador ao browser, e o som vai para a faixa da MÚSICA com o nome dele", async () => {
    const { call, registo } = montar()
    escolherFonte("separador")
    await partilhar()
    expect(pedidos).toHaveLength(1)
    expect(pedidos[0]).toMatchObject({ video: { displaySurface: "browser" }, preferCurrentTab: false })
    expect((pedidos[0]?.["audio"] as Record<string, unknown>)?.["restrictOwnAudio"]).toBe(true)
    expect(call.partilharMusica).toHaveBeenCalledTimes(1)
    // The destination track (with transmit gain), not the browser's.
    expect(registo).toContain("partilhar destino-1 Rádio - YouTube")
    expect(document.querySelector(".audio-fonte-no-ar")?.textContent).toBe(strings.musica.aPartilharFonte("Rádio - YouTube"))
  })

  it('sem nome do separador, o anúncio diz de onde vem: "Som do sistema"', async () => {
    devolve = () => {
      somDoBrowser = faixa("audio", "som")
      return [faixa("video", "imagem", "screen:0:0"), somDoBrowser]
    }
    const { registo } = montar()
    escolherFonte("sistema")
    await partilhar()
    expect(registo).toContain(`partilhar destino-1 ${strings.musica.origem("sistema")}`)
  })

  it('o "Parar de partilhar" do browser tira a música da chamada, limpa', async () => {
    const { call } = montar()
    escolherFonte("separador")
    await partilhar()
    await act(async () => {
      somDoBrowser?.terminar()
    })
    expect(call.pararMusica).toHaveBeenCalled()
    expect(call.musica).toBeNull()
    expect(saidas[0]?.stop).toHaveBeenCalled()
    expect(document.querySelector(".audio-fonte-no-ar")).toBeNull()
  })

  it('"Parar este som" pára a captura (a marca de gravação apaga-se) e a música', async () => {
    const { call } = montar()
    escolherFonte("separador")
    await partilhar()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.musica.pararFonte }))
    })
    expect(somDoBrowser?.stop).toHaveBeenCalled()
    expect(call.musica).toBeNull()
  })

  it("sem som (a caixa por marcar): Erro 480, e nada vai para a chamada", async () => {
    devolve = () => [faixa("video", "imagem")]
    const { call } = montar()
    escolherFonte("sistema")
    await partilhar()
    expect(call.partilharMusica).not.toHaveBeenCalled()
    const alerta = screen.getByRole("alert").textContent ?? ""
    expect(alerta).toContain("480")
    expect(alerta).toContain("A fonte não deu som.")
  })

  it("cancelar o selector não diz nada", async () => {
    ;(navigator.mediaDevices.getDisplayMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error("x"), { name: "NotAllowedError" }),
    )
    const { call } = montar()
    escolherFonte("separador")
    await partilhar()
    expect(call.partilharMusica).not.toHaveBeenCalled()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("na sala AFK, o selector nem abre (Erro 470)", async () => {
    montar({ afk: true })
    escolherFonte("separador")
    await partilhar()
    expect(pedidos).toHaveLength(0)
    expect(screen.getByRole("alert").textContent).toContain("470")
  })

  it('uma emissão de cada vez: a captura tira os ficheiros do ar, e "Tocar" tira a captura', async () => {
    const { call, registo, leitor } = montar()
    act(() => {
      leitor.acrescentar([new File(["x"], "01 Abertura.mp3")])
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.musica.tocar }))
    })
    expect(registo).toContain("partilhar faixa-do-leitor 01 Abertura")
    escolherFonte("separador")
    await partilhar()
    expect(leitor.estado.aTocar).toBe(false)
    expect(registo.slice(-2)).toEqual(["parar", "partilhar destino-1 Rádio - YouTube"])
    // Adding files while capture is live does not change the broadcast announcement.
    act(() => {
      leitor.acrescentar([new File(["x"], "02 Fado.mp3")])
    })
    expect(registo.at(-1)).toBe("partilhar destino-1 Rádio - YouTube")

    escolherFonte("ficheiros" as never)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.musica.tocar }))
    })
    expect(somDoBrowser?.stop).toHaveBeenCalled()
    expect(registo.at(-1)).toBe("partilhar faixa-do-leitor 01 Abertura")
    expect(call.musica).toEqual({ aTocar: "01 Abertura" })
  })
})

describe("as fontes capturadas, na app de secretária", () => {
  it("a janela está ligada, e a folha diz o limite: vai o som do sistema inteiro, com a voz da chamada", () => {
    registarAppDoDj({ somDoSistema: async () => true, gravacaoNegada: async () => false })
    montar({ agente: ELECTRON_WINDOWS })
    escolherFonte("janela")
    expect(screen.getByText(strings.musica.notaDaFonte("janela", true))).toBeTruthy()
    expect(screen.getByText(strings.musica.ecoNaApp)).toBeTruthy()
  })

  it("um sistema sem som do sistema: Erro 481, sem abrir captura nenhuma", async () => {
    registarAppDoDj({ somDoSistema: async () => false, gravacaoNegada: async () => false })
    montar({ agente: ELECTRON_WINDOWS })
    escolherFonte("sistema")
    await partilhar()
    expect(pedidos).toHaveLength(0)
    expect(screen.getByRole("alert").textContent).toContain("481")
  })

  it("o macOS já recusou gravar o ecrã: Erro 484, com o caminho das Definições, sem abrir captura", async () => {
    registarAppDoDj({ somDoSistema: async () => true, gravacaoNegada: async () => true })
    montar({ agente: ELECTRON_WINDOWS })
    escolherFonte("janela")
    await partilhar()
    expect(pedidos).toHaveLength(0)
    const alerta = screen.getByRole("alert").textContent ?? ""
    expect(alerta).toContain("484")
    expect(alerta).toContain("Gravação de ecrã e áudio do sistema")
  })
})

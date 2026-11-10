import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EstadoDoAudio } from "@enclave/client-core"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { ConfiguracoesDeVoz } from "./ConfiguracoesDeVoz.js"

afterEach(cleanup)

/**
 * Settings › Voice, against a fake `call.audio`.
 *
 * What is tied together: the screen draws what the engine says (not its own memory),
 * each action reaches the right API, and an API rejection reaches the screen with a code.
 */
function ponte(inicial: Partial<EstadoDoAudio> = {}) {
  let estado: EstadoDoAudio = {
    perfil: "normal",
    etapas: { passaAlto: true, supressao: true, gate: true, compressor: true, deEsser: true },
    forca: 1,
    previa: false,
    motor: "modelo",
    ...inicial,
  }
  let ouvinte: ((novo: EstadoDoAudio) => void) | null = null
  const mudar = (novo: Partial<EstadoDoAudio>): void => {
    estado = { ...estado, ...novo }
    act(() => ouvinte?.(estado))
  }
  const audio = {
    estado: () => estado,
    medir: vi.fn(() => ({ entradaDb: -24, saidaDb: -21, ruidoEstimadoDb: -58, cpuMs: 0.07 })),
    definirPerfil: vi.fn(async (perfil: EstadoDoAudio["perfil"]) => mudar({ perfil })),
    definirEtapa: vi.fn(async (etapa: keyof EstadoDoAudio["etapas"], ligada: boolean) =>
      mudar({ etapas: { ...estado.etapas, [etapa]: ligada } }),
    ),
    definirForcaDaSupressao: vi.fn(async (forca: number) => mudar({ forca })),
    previa: vi.fn(async (ligada: boolean) => mudar({ previa: ligada })),
  }
  const bridge = {
    call: {
      audio,
      on: (evento: string, fn: (novo: EstadoDoAudio) => void) => {
        if (evento === "audio") ouvinte = fn
        return () => {
          ouvinte = null
        }
      },
    },
  } as unknown as EnclaveBridge
  return { bridge, audio, mudar }
}

function montar(bridge: EnclaveBridge): void {
  render(
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <ConfiguracoesDeVoz />
      </ToastProvider>
    </BridgeContext.Provider>,
  )
}

describe("Configurações › Voz", () => {
  it("os quatro perfis, com uma frase cada, e o escolhido marcado", () => {
    const { bridge } = ponte()
    montar(bridge)
    const grupo = screen.getByRole("radiogroup", { name: strings.settings.voz.perfil })
    const radios = [...grupo.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    expect(radios).toHaveLength(4)
    expect(radios.find((radio) => radio.checked)?.value).toBe("normal")
    for (const perfil of ["desligado", "leve", "normal", "maximo"] as const) {
      expect(screen.getByText(strings.settings.voz.perfis[perfil].frase)).toBeTruthy()
    }
  })

  it("escolher um perfil chama a API, e o ecrã segue o que o motor diz", async () => {
    const { bridge, audio } = ponte()
    montar(bridge)
    await userEvent.click(screen.getByLabelText(new RegExp(strings.settings.voz.perfis.leve.nome)))
    expect(audio.definirPerfil).toHaveBeenCalledWith("leve")
    expect(screen.getByDisplayValue("leve")).toHaveProperty("checked", true)
  })

  it("os perfis e o motor num cartão, o teste noutro, e sem interruptores de etapa", () => {
    // Stages and strength left the screen in 0.9: the four profiles remain. The engine
    // still stores them (see the component header).
    const { bridge } = ponte()
    montar(bridge)
    expect(screen.getByRole("heading", { name: strings.settings.voz.perfil })).toBeTruthy()
    expect(screen.getByRole("heading", { name: strings.settings.voz.teste })).toBeTruthy()
    expect(screen.queryAllByRole("switch")).toHaveLength(0)
  })

  it('o que vem de fora (o "Cancelar eco") entra no cartão da redução de ruído', () => {
    const { bridge } = ponte()
    render(
      <BridgeContext.Provider value={bridge}>
        <ToastProvider>
          <ConfiguracoesDeVoz>
            <p>eco aqui</p>
          </ConfiguracoesDeVoz>
        </ToastProvider>
      </BridgeContext.Provider>,
    )
    const cartao = screen.getByRole("heading", { name: strings.settings.voz.perfil }).closest("section")
    expect(cartao?.textContent).toContain("eco aqui")
  })

  it('"Ouvir-me" é um botão premido ou não, com a nota dos auscultadores', async () => {
    const { bridge, audio } = ponte()
    montar(bridge)
    const ouvir = screen.getByRole("button", { name: strings.settings.voz.ouvirMe })
    expect(ouvir.getAttribute("aria-pressed")).toBe("false")
    expect(screen.getByText(strings.settings.voz.ouvirMeNota)).toBeTruthy()
    await userEvent.click(ouvir)
    expect(audio.previa).toHaveBeenCalledWith(true)
    expect(screen.getByRole("button", { name: strings.settings.voz.ouvirMe }).getAttribute("aria-pressed")).toBe("true")
  })

  it("o medidor mostra a entrada, a saída e o ruído, com o número escrito", () => {
    const { bridge } = ponte()
    montar(bridge)
    const medidores = screen.getAllByRole("meter")
    expect(medidores.map((medidor) => medidor.getAttribute("aria-valuenow"))).toEqual(["-24", "-21", "-58"])
  })


  it("uma recusa da API chega ao ecrã com código", async () => {
    const { bridge, audio } = ponte()
    audio.previa.mockRejectedValueOnce(new Error("audio-preview-failed", { cause: { nome: "NotAllowedError" } }))
    montar(bridge)
    await userEvent.click(screen.getByRole("button", { name: strings.settings.voz.ouvirMe }))
    expect(await screen.findByText(/Erro 439/)).toBeTruthy()
  })

  it("um anfitrião sem a cadeia diz-o, em vez de desenhar interruptores mortos", () => {
    render(
      <BridgeContext.Provider value={{ call: { on: () => () => {} } } as unknown as EnclaveBridge}>
        <ToastProvider>
          <ConfiguracoesDeVoz />
        </ToastProvider>
      </BridgeContext.Provider>,
    )
    expect(screen.getByText(strings.settings.voz.indisponivel)).toBeTruthy()
    expect(screen.queryAllByRole("switch")).toHaveLength(0)
  })
})

/**
 * With a live call, the test says it uses the same microphone, and leaving the screen
 * with "Hear myself" on turns it off: others hear themselves as before.
 */
describe("Configurações › Voz, com a chamada viva", () => {
  it("diz que o teste usa o microfone da chamada, e só quando há chamada", () => {
    const { bridge } = ponte()
    render(
      <BridgeContext.Provider value={bridge}>
        <ToastProvider>
          <ConfiguracoesDeVoz emChamada />
        </ToastProvider>
      </BridgeContext.Provider>,
    )
    expect(screen.getByText(strings.settings.testeNaChamada)).toBeTruthy()
    cleanup()
    montar(ponte().bridge)
    expect(screen.queryByText(strings.settings.testeNaChamada)).toBeNull()
  })

  it('sair do ecrã com o "Ouvir-me" ligado desliga-o', async () => {
    const { bridge, audio } = ponte({ previa: true })
    render(
      <BridgeContext.Provider value={bridge}>
        <ToastProvider>
          <ConfiguracoesDeVoz emChamada />
        </ToastProvider>
      </BridgeContext.Provider>,
    )
    cleanup()
    expect(audio.previa).toHaveBeenCalledWith(false)
  })
})

/**
 * The test tells in words whether the microphone picks up. The sentences and patience came
 * from `MedidorDeEntrada`, which left in 0.9: one meter remains.
 */
describe("Configurações › Voz, a conclusão por palavras", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function montarCom(bridge: EnclaveBridge, emChamada = false): void {
    render(
      <BridgeContext.Provider value={bridge}>
        <ToastProvider>
          <ConfiguracoesDeVoz emChamada={emChamada} />
        </ToastProvider>
      </BridgeContext.Provider>,
    )
  }

  it("com o microfone fechado, diz como se abre", () => {
    const { bridge } = ponte()
    montarCom(bridge)
    expect(screen.getByText(strings.settings.entradaParada)).toBeTruthy()
  })

  it("com a prévia ligada e voz, diz que apanha e que é este o microfone", () => {
    vi.useFakeTimers()
    const { bridge, audio } = ponte({ previa: true })
    audio.medir.mockReturnValue({ entradaDb: -90, saidaDb: -120, ruidoEstimadoDb: -90, cpuMs: 0 })
    montarCom(bridge)
    expect(screen.getByText(strings.settings.entradaAEscutar)).toBeTruthy()
    audio.medir.mockReturnValue({ entradaDb: -30, saidaDb: -28, ruidoEstimadoDb: -60, cpuMs: 0 })
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByText(strings.settings.entradaApanha)).toBeTruthy()
  })

  it("em silêncio espera cinco segundos, diz que nada apanha, e desdiz-se com voz", () => {
    vi.useFakeTimers()
    const { bridge, audio } = ponte({ previa: true })
    audio.medir.mockReturnValue({ entradaDb: -90, saidaDb: -120, ruidoEstimadoDb: -90, cpuMs: 0 })
    montarCom(bridge)
    act(() => vi.advanceTimersByTime(4_000))
    expect(screen.getByText(strings.settings.entradaAEscutar)).toBeTruthy()
    act(() => vi.advanceTimersByTime(1_500))
    expect(screen.getByText(strings.settings.entradaSemSinal)).toBeTruthy()
    audio.medir.mockReturnValue({ entradaDb: -30, saidaDb: -28, ruidoEstimadoDb: -60, cpuMs: 0 })
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByText(strings.settings.entradaApanha)).toBeTruthy()
  })

  it("fora da chamada, a prévia fecha-se sozinha ao fim de um minuto, e diz-o", () => {
    vi.useFakeTimers()
    const { bridge, audio } = ponte({ previa: true })
    montarCom(bridge)
    act(() => vi.advanceTimersByTime(59_000))
    expect(audio.previa).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(2_000))
    expect(audio.previa).toHaveBeenCalledTimes(1)
    expect(audio.previa).toHaveBeenCalledWith(false)
    expect(screen.getByText(strings.settings.entradaEsgotado)).toBeTruthy()
  })

  it('numa chamada mede sem "Ouvir-me" e não fecha nada: o microfone é da chamada', () => {
    vi.useFakeTimers()
    const { bridge, audio } = ponte()
    montarCom(bridge, true)
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByText(strings.settings.entradaApanha)).toBeTruthy()
    act(() => vi.advanceTimersByTime(120_000))
    expect(audio.previa).not.toHaveBeenCalled()
  })
})

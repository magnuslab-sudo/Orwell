import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { SensibilidadeDoMicrofone } from "./SensibilidadeDoMicrofone.js"
import { SettingsScreen } from "./SettingsScreen.js"

/**
 * Settings › Voice › "Microphone sensitivity" (owner, 2/11/2026).
 *
 * The critical part: factory default is automatic and opens nothing; in manual it
 * shows the line above a meter that reads the gate level, opens the microphone only
 * while the card is visible, closes it on exit, and says in a phrase with codes
 * when permission is denied. The line reaches the bridge in the same gesture.
 */

afterEach(cleanup)
beforeEach(() => localStorage.clear())

/** The texts, read at the moment: a top constant would stay locked to the startup language. */
const t = () => strings.settings.sensibilidade

function ponte(portaoDb = -30) {
  const audio = {
    medir: vi.fn(() => ({ entradaDb: -25, saidaDb: -21, ruidoEstimadoDb: -60, cpuMs: 0, portaoDb, vozAtiva: true, anelDb: -25 })),
    medidor: vi.fn(async (_ligado: boolean) => {}),
    // The noise reduction card reads the engine state.
    estado: () => ({
      perfil: "normal",
      etapas: { passaAlto: true, supressao: true, gate: true, compressor: true, deEsser: true },
      forca: 1,
      previa: false,
      motor: "modelo",
    }),
    previa: vi.fn(async () => {}),
  }
  const bridge = { call: { audio, on: () => () => {} } } as unknown as EnclaveBridge
  return { bridge, audio }
}

function montar(bridge: EnclaveBridge, props: Partial<React.ComponentProps<typeof SensibilidadeDoMicrofone>> = {}) {
  const onMudar = vi.fn()
  const vista = render(
    <BridgeContext.Provider value={bridge}>
      <SensibilidadeDoMicrofone automatica={false} limiar={-50} onMudar={onMudar} {...props} />
    </BridgeContext.Provider>,
  )
  return { onMudar, ...vista }
}

const camada = (container: HTMLElement, classe: string): number =>
  Number(container.querySelector<HTMLElement>(classe)?.style.transform.match(/scaleX\(([\d.e-]+)\)/)?.[1] ?? NaN)

describe("sensibilidade do microfone", () => {
  it("automática: um interruptor ligado, sem barra, e o microfone fica fechado", async () => {
    const { bridge, audio } = ponte()
    const { onMudar } = montar(bridge, { automatica: true })
    const interruptor = screen.getByRole("switch", { name: t().automatica })
    expect(interruptor.getAttribute("aria-checked")).toBe("true")
    expect(screen.queryByRole("slider")).toBeNull()
    expect(screen.queryByRole("meter")).toBeNull()
    expect(audio.medidor).not.toHaveBeenCalled()

    await userEvent.click(interruptor)
    expect(onMudar).toHaveBeenCalledWith({ sensibilidadeAutomatica: false })
  })

  it("manual: a barra mostra a linha, e mexer nela manda a linha nova", () => {
    const { bridge } = ponte()
    const { onMudar } = montar(bridge)
    const barra = screen.getByRole("slider", { name: t().linha }) as HTMLInputElement
    expect(barra.min).toBe("-80")
    expect(barra.max).toBe("0")
    expect(barra.step).toBe("1")
    expect(barra.value).toBe("-50")
    expect(screen.getByText(t().nota)).toBeTruthy()
    fireEvent.change(barra, { target: { value: "-37" } })
    expect(onMudar).toHaveBeenCalledWith({ limiarDoMicrofone: -37 })
  })

  it("o medidor acende a verde acima da linha e fica cinzento abaixo", () => {
    vi.useFakeTimers()
    try {
      const { bridge, audio } = ponte(-30)
      const { container, rerender } = montar(bridge, { limiar: -50 })
      const medidor = screen.getByRole("meter", { name: t().nivel })
      expect(medidor.getAttribute("aria-valuenow")).toBe("-30")
      // Line at -50 of -80..0: 37.5%. Level at -30: 62.5%.
      expect(camada(container, ".sensibilidade-abaixo")).toBeCloseTo(0.375, 3)
      expect(camada(container, ".sensibilidade-acima")).toBeCloseTo((0.625 - 0.375) / 0.625, 3)

      // Above the level line: nothing green.
      rerender(
        <BridgeContext.Provider value={bridge}>
          <SensibilidadeDoMicrofone automatica={false} limiar={-20} onMudar={() => {}} />
        </BridgeContext.Provider>,
      )
      expect(camada(container, ".sensibilidade-acima")).toBe(0)
      expect(camada(container, ".sensibilidade-abaixo")).toBeCloseTo(0.625, 3)

      // Live: ten readings per second.
      audio.medir.mockReturnValue({ ...audio.medir(), portaoDb: -10 })
      act(() => vi.advanceTimersByTime(150))
      expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("-10")
    } finally {
      vi.useRealTimers()
    }
  })

  it("abre o microfone só em manual e só com o cartão montado, e larga-o ao sair", async () => {
    const { bridge, audio } = ponte()
    const { unmount, rerender } = montar(bridge, { automatica: true })
    expect(audio.medidor).not.toHaveBeenCalled()
    rerender(
      <BridgeContext.Provider value={bridge}>
        <SensibilidadeDoMicrofone automatica={false} limiar={-50} onMudar={() => {}} />
      </BridgeContext.Provider>,
    )
    expect(audio.medidor).toHaveBeenLastCalledWith(true)
    // Returning to automatic releases it.
    rerender(
      <BridgeContext.Provider value={bridge}>
        <SensibilidadeDoMicrofone automatica limiar={-50} onMudar={() => {}} />
      </BridgeContext.Provider>,
    )
    expect(audio.medidor).toHaveBeenLastCalledWith(false)
    rerender(
      <BridgeContext.Provider value={bridge}>
        <SensibilidadeDoMicrofone automatica={false} limiar={-50} onMudar={() => {}} />
      </BridgeContext.Provider>,
    )
    unmount()
    expect(audio.medidor).toHaveBeenLastCalledWith(false)
  })

  it("ao sair de uma chamada volta a pedir o microfone, para o medidor continuar", () => {
    const { bridge, audio } = ponte()
    const { rerender } = montar(bridge, { emChamada: true })
    expect(audio.medidor).toHaveBeenCalledTimes(1)
    rerender(
      <BridgeContext.Provider value={bridge}>
        <SensibilidadeDoMicrofone automatica={false} limiar={-50} emChamada={false} onMudar={() => {}} />
      </BridgeContext.Provider>,
    )
    expect(audio.medidor.mock.calls.map((c) => c[0])).toEqual([true, false, true])
  })

  it("com a permissão recusada, diz-o em frase com código", async () => {
    const { bridge, audio } = ponte()
    audio.medidor.mockRejectedValueOnce(new Error("audio-meter-denied", { cause: { nome: "NotAllowedError" } }))
    montar(bridge)
    const aviso = await screen.findByRole("alert")
    expect(aviso.textContent).toMatch(/Erro 491/)
    expect(aviso.textContent).toMatch(/permissão do microfone/)
  })

  it("nas Configurações › Voz, o interruptor e a barra chegam à ponte no mesmo gesto", async () => {
    const applyMediaPrefs = vi.fn()
    const { audio } = ponte()
    const bridge = { applyMediaPrefs, call: { audio, on: () => () => {} } } as unknown as EnclaveBridge
    render(
      <BridgeContext.Provider value={bridge}>
        <ToastProvider>
          <SettingsScreen
            address="@me:casa.pt"
            connection="online"
            connectionDetail={null}
            onLock={() => {}}
            micMuted={false}
            soundOff={false}
            onToggleMic={() => {}}
            onToggleSound={() => {}}
            seccao="media"
          />
        </ToastProvider>
      </BridgeContext.Provider>,
    )
    await userEvent.click(screen.getByRole("switch", { name: t().automatica }))
    expect(applyMediaPrefs.mock.calls.at(-1)?.[0]).toMatchObject({ sensibilidadeAutomatica: false, limiarDoMicrofone: -50 })
    fireEvent.change(screen.getByRole("slider", { name: t().linha }), { target: { value: "-44" } })
    expect(applyMediaPrefs.mock.calls.at(-1)?.[0]).toMatchObject({ sensibilidadeAutomatica: false, limiarDoMicrofone: -44 })
    expect(JSON.parse(localStorage.getItem("enclave.prefs") ?? "{}")).toMatchObject({
      sensibilidadeAutomatica: false,
      limiarDoMicrofone: -44,
    })
  })
})

describe("a folha do medidor", () => {
  const folha = (): string => {
    const meu = expect.getState().testPath
    if (!meu) throw new Error("sem caminho do teste")
    return readFileSync(join(dirname(meu), "..", "..", "styles", "screens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  }

  it("com movimento reduzido o medidor continua a mexer, mais devagar", () => {
    const normal = folha().match(/\.sensibilidade-abaixo,\s*\.sensibilidade-acima \{([^}]*)\}/)?.[1] ?? ""
    const lento = Number(normal.match(/transition:\s*transform\s+(\d+)ms/)?.[1])
    expect(lento).toBeGreaterThan(0)
    const blocos = [...folha().matchAll(/@media \(prefers-reduced-motion: reduce\) \{((?:(?!\n\})[\s\S])*)\n\}/g)].map((m) => m[1] ?? "")
    const doMedidor = blocos.find((b) => b.includes(".sensibilidade-acima")) ?? ""
    const reduzido = doMedidor.match(/transition:\s*transform\s+(\d+)ms\s+linear\s+!important/)
    expect(reduzido).not.toBeNull()
    expect(Number(reduzido![1])).toBeGreaterThan(lento)
    expect(doMedidor).not.toMatch(/none/)
  })
})

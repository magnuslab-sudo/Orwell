import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { readPrefs } from "../../hooks/usePrefs.js"
import { recordDiagnostic } from "../../lib/diagnostics.js"
import { VERSAO_DA_APP } from "../../lib/versao.js"
import { strings } from "../../strings.js"
import { SettingsScreen } from "./SettingsScreen.js"

/**
 * The new features of the 0.9 settings (phase 4), section by section. Each
 * point proves the gesture on screen and the choice saved in `usePrefs`.
 */

afterEach(cleanup)
beforeEach(() => localStorage.clear())

function montar(seccao: string, ponte: Partial<EnclaveBridge> = {}, extra: Record<string, unknown> = {}): void {
  const bridge = { applyMediaPrefs: vi.fn(), ...ponte } as unknown as EnclaveBridge
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
          seccao={seccao}
          {...extra}
        />
      </ToastProvider>
    </BridgeContext.Provider>,
  )
}

describe("Conta › Sessão: bloquear sozinho", () => {
  it('vem nos 15 min, e escolher "Nunca" ou "1 h" fica guardado', async () => {
    const user = userEvent.setup()
    montar("conta")
    expect(screen.getByRole("heading", { name: strings.definicoesNovas.sessao })).toBeTruthy()
    const quinze = screen.getByRole("button", { name: strings.definicoesNovas.tempoDeBloqueio(15) })
    expect(quinze.getAttribute("aria-pressed")).toBe("true")

    await user.click(screen.getByRole("button", { name: strings.definicoesNovas.tempoDeBloqueio(0) }))
    expect(readPrefs().bloqueioAutomatico).toBe(0)
    await user.click(screen.getByRole("button", { name: strings.definicoesNovas.tempoDeBloqueio(60) }))
    expect(readPrefs().bloqueioAutomatico).toBe(60)
    expect(
      screen.getByRole("button", { name: strings.definicoesNovas.tempoDeBloqueio(60) }).getAttribute("aria-pressed"),
    ).toBe("true")
  })

  it('"Terminar sessão" continua no mesmo cartão', () => {
    montar("conta")
    expect(screen.getByRole("button", { name: strings.settings.lockNow })).toBeTruthy()
  })
})

describe("Notificações › Pausar", () => {
  it('1 h guarda a hora de fim, mostra até quando, e "Retomar" acaba a pausa', async () => {
    const user = userEvent.setup()
    montar("avisos")
    const antes = Date.now()
    await user.click(screen.getByRole("button", { name: strings.definicoesNovas.duracaoDaPausa("1h") }))
    const pausaAte = readPrefs().pausaAte
    expect(pausaAte).toBeGreaterThanOrEqual(antes + 3_600_000)
    expect(pausaAte).toBeLessThan(antes + 3_600_000 + 5_000)
    expect(screen.getByRole("status").textContent).toMatch(/\d\d:\d\d/)

    await user.click(screen.getByRole("button", { name: strings.definicoesNovas.retomar }))
    expect(readPrefs().pausaAte).toBe(0)
    expect(screen.getByRole("button", { name: strings.definicoesNovas.duracaoDaPausa("8h") })).toBeTruthy()
  })

  it('"Até amanhã" diz amanhã na frase', async () => {
    const user = userEvent.setup()
    montar("avisos")
    await user.click(screen.getByRole("button", { name: strings.definicoesNovas.duracaoDaPausa("amanha") }))
    const fim = new Date(readPrefs().pausaAte)
    expect(fim.getHours()).toBe(8)
    expect(fim.getMinutes()).toBe(0)
  })
})

describe("Notificações › Avisar quando um amigo fica online (ponto 6)", () => {
  it("é um interruptor ligado de fábrica, mesmo sem permissão do browser, e desligá-lo fica guardado", async () => {
    const user = userEvent.setup()
    montar("avisos")
    const interruptor = screen.getByRole("switch", { name: strings.settings.avisarAmigosOnline })
    expect(interruptor.getAttribute("aria-checked")).toBe("true")
    await user.click(interruptor)
    expect(readPrefs().avisarAmigosOnline).toBe(false)
  })

  it('"Avisos de amigos": um interruptor por tipo, os novos ligados de fábrica, cada um guardado à parte', async () => {
    const user = userEvent.setup()
    montar("avisos")
    expect(screen.getByText(strings.settings.avisosDeAmigos)).toBeTruthy()
    const chaves = [
      [strings.settings.avisarAmigosNaVoz, "avisarAmigosNaVoz"],
      [strings.settings.avisarAmigosNoEcra, "avisarAmigosNoEcra"],
      [strings.settings.avisarAmigosNaComunidade, "avisarAmigosNaComunidade"],
    ] as const
    for (const [rotulo, chave] of chaves) {
      const interruptor = screen.getByRole("switch", { name: rotulo })
      expect(interruptor.getAttribute("aria-checked")).toBe("true")
      await user.click(interruptor)
      expect(readPrefs()[chave]).toBe(false)
    }
    // Turning off the new ones does not touch the online one.
    expect(readPrefs().avisarAmigosOnline).toBe(true)
  })
})

describe("Microfone e câmara › Entrar silenciado", () => {
  it("é um interruptor desligado de fábrica, e ligá-lo fica guardado", async () => {
    const user = userEvent.setup()
    montar("media")
    const interruptor = screen.getByRole("switch", { name: strings.definicoesNovas.entrarSilenciado })
    expect(interruptor.getAttribute("aria-checked")).toBe("false")
    await user.click(interruptor)
    expect(readPrefs().entrarSilenciado).toBe(true)
  })
})

describe("Microfone e câmara › Câmara", () => {
  const paragens: string[] = []
  function comCamaras(etiquetas: string[]): void {
    paragens.length = 0
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: async () =>
          etiquetas.map((label, i) => ({ kind: "videoinput", deviceId: `cam-${i}`, label })),
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: () => paragens.push("parou") }],
        })),
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    })
  }
  afterEach(() => {
    Reflect.deleteProperty(navigator, "mediaDevices")
    vi.restoreAllMocks()
  })

  it("escolher a câmara guarda-a e leva-a ao núcleo com as outras chaves", async () => {
    comCamaras(["FaceTime HD", "iPhone"])
    const user = userEvent.setup()
    const applyMediaPrefs = vi.fn()
    montar("media", { applyMediaPrefs })
    const lista = await screen.findByRole("combobox", { name: strings.definicoesNovas.camaraAparelho })
    await user.selectOptions(lista, "cam-1")
    expect(readPrefs().videoDeviceId).toBe("cam-1")
    expect(applyMediaPrefs.mock.calls.at(-1)?.[0]).toMatchObject({ videoDeviceId: "cam-1", videoQuality: "720p" })
  })

  it("sem nomes, diz o que falta em vez de mostrar uma lista que não se lê", async () => {
    comCamaras([""])
    montar("media")
    expect(await screen.findByText(strings.definicoesNovas.camarasSemNome)).toBeTruthy()
  })

  it("espelhar vem ligado; desligar escreve-o na raiz do documento", async () => {
    comCamaras([])
    const user = userEvent.setup()
    montar("media")
    const espelho = screen.getByRole("switch", { name: strings.definicoesNovas.espelhar })
    expect(espelho.getAttribute("aria-checked")).toBe("true")
    await user.click(espelho)
    expect(readPrefs().espelharCamara).toBe(false)
    expect(document.documentElement.dataset.espelho).toBe("nao")
  })

  it("a pré-visualização abre a câmara escolhida e pára-a ao fechar e ao sair", async () => {
    comCamaras(["FaceTime HD"])
    const user = userEvent.setup()
    montar("media")
    await user.click(screen.getByRole("button", { name: strings.definicoesNovas.previa }))
    await vi.waitFor(() => expect(document.querySelector("video.previa-da-camara.video-proprio")).toBeTruthy())
    await vi.waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true, audio: false }))
    await user.click(screen.getByRole("button", { name: strings.definicoesNovas.previaFechar }))
    expect(paragens).toEqual(["parou"])
    expect(document.querySelector("video.previa-da-camara")).toBeNull()

    await user.click(screen.getByRole("button", { name: strings.definicoesNovas.previa }))
    await vi.waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2))
    await Promise.resolve()
    cleanup()
    expect(paragens).toEqual(["parou", "parou"])
  })

  it("durante uma chamada não abre a câmara outra vez", () => {
    comCamaras(["FaceTime HD"])
    montar("media", {}, { microfoneDaChamada: {} as MediaStream })
    expect(screen.queryByRole("button", { name: strings.definicoesNovas.previa })).toBeNull()
    expect(screen.getByText(strings.definicoesNovas.previaEmChamada)).toBeTruthy()
  })
})

describe("Privacidade › Quem me pode encontrar", () => {
  it('"Toda a gente" de fábrica; escolher outra regra e esconder a presença fica guardado', async () => {
    const user = userEvent.setup()
    montar("privacidade")
    const todos = screen.getByRole("button", { name: strings.definicoesNovas.regraDosPedidos("todos") })
    expect(todos.getAttribute("aria-pressed")).toBe("true")
    await user.click(screen.getByRole("button", { name: strings.definicoesNovas.regraDosPedidos("amigos-de-amigos") }))
    expect(readPrefs().pedidosDeAmizade).toBe("amigos-de-amigos")
    await user.click(screen.getByRole("button", { name: strings.definicoesNovas.regraDosPedidos("ninguem") }))
    expect(readPrefs().pedidosDeAmizade).toBe("ninguem")

    const online = screen.getByRole("switch", { name: strings.definicoesNovas.mostrarOnline })
    expect(online.getAttribute("aria-checked")).toBe("true")
    await user.click(online)
    expect(readPrefs().mostrarOnline).toBe(false)
  })
})

describe("Ajuda › Enviar registo", () => {
  it("manda o mesmo texto do copiar, com a versão, e agradece", async () => {
    recordDiagnostic({ kind: "action", code: "teste-fase4", outcome: "ok" })
    const user = userEvent.setup()
    const enviar = vi.fn(async () => ({ ok: true as const }))
    montar("ajuda", { relato: { enviar } } as Partial<EnclaveBridge>)
    await user.click(screen.getByRole("button", { name: strings.definicoesNovas.enviarRegisto }))
    expect(enviar).toHaveBeenCalledTimes(1)
    const [pedido] = enviar.mock.calls[0] as unknown as [{ texto: string; versao: string }]
    expect(pedido.texto).toContain("teste-fase4")
    expect(pedido.versao).toBe(VERSAO_DA_APP)
    expect(await screen.findByText(strings.definicoesNovas.registoEnviado)).toBeTruthy()
  })

  it("uma recusa mostra o erro com o código", async () => {
    recordDiagnostic({ kind: "action", code: "teste-fase4", outcome: "ok" })
    const user = userEvent.setup()
    const enviar = vi.fn(async () => Promise.reject(new Error("too many logs sent")))
    montar("ajuda", { relato: { enviar } } as Partial<EnclaveBridge>)
    await user.click(screen.getByRole("button", { name: strings.definicoesNovas.enviarRegisto }))
    expect(await screen.findByText(/215/)).toBeTruthy()
  })

  it("sem ponte que saiba enviar, o botão não aparece", () => {
    montar("ajuda")
    expect(screen.queryByRole("button", { name: strings.definicoesNovas.enviarRegisto })).toBeNull()
  })
})

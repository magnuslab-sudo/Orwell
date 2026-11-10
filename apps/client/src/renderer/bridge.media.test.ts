import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Audio and video preferences reach the engine.
 *
 * THIS is the bridge where the bug lived, and the first test this package ever
 * had. Never implemented `applyMediaPrefs`: it created the `Call` and passed
 * it no options, no noise suppression, no gain, no chosen microphone, no video
 * quality. All of that existed in Settings, it was saved to disk, and died on
 * the way. In the installed app, those toggles never did anything, ever.
 *
 * Discovered on August 13, 2026 investigating "noise suppression is not
 * working", a complaint that was right and that nobody could confirm, because
 * the two bridges totaled eleven files with not a single test. Between the
 * core, which has thousands of them, and what a person sees, there was this
 * silent layer.
 *
 * What we lock down here is the contract, not the implementation: what comes
 * out of Settings must appear in the fields that `Call` reads when opening
 * capture. A bridge that writes them anywhere else fails this, which is the
 * goal.
 */

/** What the `Call` received. Filled in by the double below. */
const motor = {
  audioSettings: null as Record<string, unknown> | null,
  videoQuality: "auto" as string,
  videoDeviceId: "" as string,
  inputGain: 1 as number,
  filtroDeMicrofone: false,
  aoVivo: 0,
  /** What reached `call.audio.definirLimiar` (the microphone sensitivity). */
  limiares: [] as (number | null)[],
}

vi.mock("@enclave/client-core", () => ({
  Call: class {
    set audioSettings(valor: Record<string, unknown> | null) {
      motor.audioSettings = valor
    }
    get audioSettings(): Record<string, unknown> | null {
      return motor.audioSettings
    }
    set videoQuality(valor: string) {
      motor.videoQuality = valor
    }
    set videoDeviceId(valor: string) {
      motor.videoDeviceId = valor
    }
    set inputGain(valor: number) {
      motor.inputGain = valor
    }
    set filtroDeMicrofone(valor: boolean) {
      motor.filtroDeMicrofone = valor
    }
    readonly audio = {
      definirLimiar(db: number | null): void {
        if (db !== null && (db < -80 || db > 0)) throw new Error("audio-invalid-threshold")
        motor.limiares.push(db)
      },
      ligarPreferencias: () => () => {},
    }
    /** Applies the choice to the stream already on air. See `Call`. */
    async aplicarSomAoVivo(): Promise<void> {
      motor.aoVivo += 1
    }
    on(): () => void {
      return () => {}
    }
    emit(): void {}
    rekey(): Promise<void> {
      return Promise.resolve()
    }
  },
  Session: class {
    on(): () => void {
      return () => {}
    }
  },
  Vault: class {},
}))

vi.mock("@enclave/crypto", () => ({ kindOf: () => "application" }))
/* The Electron host, which doesn't exist in the test browser. */
Object.defineProperty(window, "enclaveHost", {
  value: new Proxy(
    {},
    {
      get: (_alvo, chave) => {
        if (chave === "on") return new Proxy({}, { get: () => () => () => {} })
        return new Proxy({}, { get: () => async () => ({}) })
      },
    },
  ),
  writable: true,
})

vi.mock("@enclave/ui", () => ({ registerSystemNoticeHost: () => {} }))

const { createDesktopBridge } = await import("./bridge.js")

beforeEach(() => {
  motor.audioSettings = null
  motor.videoQuality = "auto"
  motor.videoDeviceId = ""
  motor.inputGain = 1
  motor.filtroDeMicrofone = false
  motor.aoVivo = 0
  motor.limiares = []
})

describe("a ponte da secretária leva as preferências ao motor", () => {
  it("o supressor de ruído chega, e não fica pelo caminho", () => {
    const bridge = createDesktopBridge()

    bridge.applyMediaPrefs?.({ noiseSuppression: false, echoCancellation: true, autoGainControl: true })

    expect(motor.audioSettings).toMatchObject({ noiseSuppression: false })
  })

  it("um microfone escolhido viaja; um vazio é ausência de escolha e não viaja", () => {
    // Empty is not an identifier: it's the absence of choice. It must reach the core as absence, so it doesn't request an `exact` on "".
    const bridge = createDesktopBridge()

    bridge.applyMediaPrefs?.({ inputDeviceId: "abc" })
    expect(motor.audioSettings).toMatchObject({ inputDeviceId: "abc" })

    bridge.applyMediaPrefs?.({ inputDeviceId: "" })
    expect(motor.audioSettings).not.toHaveProperty("inputDeviceId")
  })

  it('a câmara escolhida chega ao núcleo, e vazia volta a "o que o sistema decidir"', () => {
    // Unlike the microphone, this is a simple engine field: empty is the absence of choice, and the core reads it that way. If missing, nothing changes.
    const bridge = createDesktopBridge()

    bridge.applyMediaPrefs?.({ videoDeviceId: "cam-1" })
    expect(motor.videoDeviceId).toBe("cam-1")

    bridge.applyMediaPrefs?.({ inputGain: 1.2 })
    expect(motor.videoDeviceId).toBe("cam-1")

    bridge.applyMediaPrefs?.({ videoDeviceId: "" })
    expect(motor.videoDeviceId).toBe("")
  })

  it("a qualidade de vídeo e o ganho chegam aos seus campos", () => {
    const bridge = createDesktopBridge()

    bridge.applyMediaPrefs?.({ videoQuality: "720p", inputGain: 1.5 })

    expect(motor.videoQuality).toBe("720p")
    expect(motor.inputGain).toBe(1.5)
  })

  it("o filtro do microfone chega ao campo que o núcleo lê", () => {
    const bridge = createDesktopBridge()

    bridge.applyMediaPrefs?.({ filtroDeMicrofone: true })

    expect(motor.filtroDeMicrofone).toBe(true)
  })

  it("e aplica à faixa que já está no ar, em vez de esperar pela chamada seguinte", () => {
    // Without this, toggling the suppressor mid-call did nothing: the microphone opened with the old options and stayed that way until someone hung up. From the toggle side, the switch was broken.
    const bridge = createDesktopBridge()

    bridge.applyMediaPrefs?.({ noiseSuppression: false })

    expect(motor.aoVivo).toBe(1)
  })

  it("a sensibilidade do microfone chega à cadeia: a linha em manual, nada (null) na automática", () => {
    const bridge = createDesktopBridge()

    bridge.applyMediaPrefs?.({ sensibilidadeAutomatica: false, limiarDoMicrofone: -42 })
    bridge.applyMediaPrefs?.({ sensibilidadeAutomatica: true, limiarDoMicrofone: -42 })
    // A broken line doesn't silence anyone: it falls back to automatic.
    bridge.applyMediaPrefs?.({ sensibilidadeAutomatica: false, limiarDoMicrofone: 9 })
    // An old interface that doesn't send it won't change it.
    bridge.applyMediaPrefs?.({ noiseSuppression: true })

    expect(motor.limiares).toEqual([-42, null, null])
  })
})

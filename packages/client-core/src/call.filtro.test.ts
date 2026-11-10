import type { Payload, UserAddress } from "@enclave/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Call, type CallBridge, type MediaKeyMaterial } from "./call.js"

/**
 * Microphone processing BEFORE the voice leaves here.
 *
 * There was a `GainNode` and nothing else. Gain up to 2× with nothing after it
 * is a signal that goes over the limit and is cut hard: what you hear on the
 * other side is not a louder voice, it is a torn voice, reported by the owner
 * on September 13, 2026 as "noise that sounds like extreme friction but is not".
 * Our own chain produces it, and the limiter removes it.
 *
 * What these tests establish:
 *
 * 1. **The chain only starts when there is reason for it.** Gain at 1 and
 *    filter off remain raw capture, with no `AudioContext`: an audio processor
 *    running to make no difference is a microphone light on in exchange for
 *    nothing.
 * 2. **With a chain, there is always a limiter at the end.** It is the only
 *    node that is not optional, because it is the only one that exists to
 *    contain what we do to the signal ourselves.
 * 3. **The high-pass filter comes with the filter**, and before the gain:
 *    amplifying the rumble and cutting it after is amplifying what would be
 *    thrown away.
 * 4. **The context is resumed.** An `AudioContext` born suspended, and it is
 *    born, without recent gesture, delivers a SILENT track to peers. It was
 *    the worst possible outcome of moving a volume slider.
 *
 * The order is stated as PATH not by node count: counting says there are four
 * pieces, and what matters is them being one after the other in the right
 * order. A test that only counted would pass with the limiter plugged in
 * beside it.
 */

// ------------------------------------------------------------------ duplos

interface NoFalso {
  tipo: string
  destinos: NoFalso[]
  connect: (destino: NoFalso) => NoFalso
}

function no(tipo: string, extra: Record<string, unknown> = {}): NoFalso {
  const criado: NoFalso = {
    tipo,
    destinos: [],
    connect(destino: NoFalso) {
      criado.destinos.push(destino)
      return destino
    },
    ...extra,
  } as NoFalso
  return criado
}

class ContextoFalso {
  static instancias: ContextoFalso[] = []
  static rebenta = false

  state = "suspended"
  retomado = 0
  fechado = false
  entrada: NoFalso | null = null
  destino = no("destination") as NoFalso & { stream: MediaStream }

  constructor() {
    if (ContextoFalso.rebenta) throw new Error("sem AudioContext neste ambiente")
    ContextoFalso.instancias.push(this)
    this.destino.stream = {
      getAudioTracks: () => [{ kind: "audio", enabled: true, stop: vi.fn() }],
      getTracks: () => [{ kind: "audio", enabled: true, stop: vi.fn() }],
      getVideoTracks: () => [],
    } as unknown as MediaStream
  }

  createMediaStreamSource(): NoFalso {
    this.entrada = no("source")
    return this.entrada
  }

  createGain(): NoFalso & { gain: { value: number } } {
    return no("gain", { gain: { value: 1 } }) as NoFalso & { gain: { value: number } }
  }

  createBiquadFilter(): NoFalso & { type: string; frequency: { value: number } } {
    return no("biquad", { type: "", frequency: { value: 0 } }) as NoFalso & { type: string; frequency: { value: number } }
  }

  createDynamicsCompressor(): NoFalso & Record<string, { value: number }> {
    return no("compressor", {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
    }) as NoFalso & Record<string, { value: number }>
  }

  createMediaStreamDestination(): NoFalso & { stream: MediaStream } {
    return this.destino
  }

  async resume(): Promise<void> {
    this.retomado += 1
    this.state = "running"
  }

  async close(): Promise<void> {
    this.fechado = true
  }
}

/** The sound path, from input to the end, like a readable sentence. */
function caminho(contexto: ContextoFalso): string {
  const tipos: string[] = []
  let actual = contexto.entrada
  while (actual) {
    tipos.push(actual.tipo)
    actual = actual.destinos[0] ?? null
  }
  return tipos.join("→")
}

/**
 * The `MediaStream` that the code builds to join what comes out of processing
 * to the video tracks. Node does not have it, and without it the chain broke
 * inside the `try` and this file measured the escape path instead of the normal
 * path.
 */
class MediaStreamFalso {
  private readonly faixas: { kind: string }[]
  constructor(faixas: { kind: string }[] = []) {
    this.faixas = [...faixas]
  }
  getTracks(): { kind: string }[] {
    return this.faixas
  }
  getAudioTracks(): { kind: string }[] {
    return this.faixas.filter((faixa) => faixa.kind === "audio")
  }
  getVideoTracks(): { kind: string }[] {
    return this.faixas.filter((faixa) => faixa.kind === "video")
  }
}

function fakeStream(): MediaStream {
  const audio = { kind: "audio", enabled: true, stop: vi.fn() }
  return {
    getTracks: () => [audio],
    getAudioTracks: () => [audio],
    getVideoTracks: () => [],
  } as unknown as MediaStream
}

class FakePeerConnection {
  localDescription: unknown = null
  ontrack: ((event: unknown) => void) | null = null
  onicecandidate: ((event: unknown) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  constructor(public config: unknown) {}
  addTrack(): unknown {
    return {}
  }
  async createOffer(): Promise<unknown> {
    return { type: "offer", sdp: "v=0\r\n" }
  }
  async setLocalDescription(): Promise<void> {}
  close(): void {}
}

const EU = "@eu:enclave.test" as UserAddress
const CANAL = "!geral:enclave.test"

function ponte(): CallBridge {
  return {
    selfAddress: EU,
    async sendSignal(_channel: string, _payload: Payload) {},
    async mediaKey(): Promise<MediaKeyMaterial | null> {
      return { keyId: 1, senderId: 0, material: new Uint8Array(28) }
    },
    async reservarContadorSframe(): Promise<number> {
      return 0
    },
  } as unknown as CallBridge
}

beforeEach(() => {
  ContextoFalso.instancias = []
  ContextoFalso.rebenta = false
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection)
  vi.stubGlobal("RTCRtpSender", class {})
  vi.stubGlobal("AudioContext", ContextoFalso)
  vi.stubGlobal("MediaStream", MediaStreamFalso)
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: async () => fakeStream() },
  })
})

// ------------------------------------------------------------------ testes

describe("a cadeia de tratamento do microfone", () => {
  it("não nasce quando não há nada a fazer ao som", async () => {
    const call = new Call(ponte())
    await call.join(CANAL)

    expect(ContextoFalso.instancias).toHaveLength(0)
  })

  it("com ganho, leva sempre limitador no fim", async () => {
    const call = new Call(ponte())
    call.inputGain = 2
    await call.join(CANAL)

    const contexto = ContextoFalso.instancias[0]
    expect(contexto).toBeDefined()
    expect(caminho(contexto as ContextoFalso)).toBe("source→gain→compressor→destination")
  })

  it("com filtro, o passa-alto vem antes do ganho", async () => {
    const call = new Call(ponte())
    call.filtroDeMicrofone = true
    await call.join(CANAL)

    const contexto = ContextoFalso.instancias[0] as ContextoFalso
    expect(caminho(contexto)).toBe("source→biquad→gain→compressor→destination")
  })

  it("e o passa-alto corta abaixo da voz, não dentro dela", async () => {
    const call = new Call(ponte())
    call.filtroDeMicrofone = true
    await call.join(CANAL)

    const contexto = ContextoFalso.instancias[0] as ContextoFalso
    const passaAlto = contexto.entrada?.destinos[0] as unknown as { type: string; frequency: { value: number } }
    expect(passaAlto.type).toBe("highpass")
    // Above here is male voice; below is fan hum, desk and wind.
    expect(passaAlto.frequency.value).toBeGreaterThanOrEqual(60)
    expect(passaAlto.frequency.value).toBeLessThanOrEqual(100)
  })

  it("retoma o contexto, para a faixa não sair muda", async () => {
    const call = new Call(ponte())
    call.filtroDeMicrofone = true
    await call.join(CANAL)

    expect((ContextoFalso.instancias[0] as ContextoFalso).retomado).toBeGreaterThan(0)
  })

  it("e um ambiente sem WebAudio não fica sem chamada", async () => {
    ContextoFalso.rebenta = true
    const call = new Call(ponte())
    call.filtroDeMicrofone = true
    const avisos: string[] = []
    call.on("diagnostic", (evento) => avisos.push(evento.code))

    await call.join(CANAL)

    expect(avisos).toContain("ganho-de-entrada-indisponivel")
    expect(call.localStream).not.toBeNull()
  })
})

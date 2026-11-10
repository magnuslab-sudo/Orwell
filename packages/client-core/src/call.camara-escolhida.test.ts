/**
 * The camera chosen in settings is the one the call opens.
 *
 * `videoDeviceId` arrives from the bridge (phase 4 of 0.9) and capture requests
 * it with `exact`, like the microphone. And with the same path back: if the
 * chosen camera no longer exists, the one available opens, the diagnostics say
 * which one vanished, and the other choice (the microphone) continues to be
 * honored.
 */
import type { Payload, UserAddress } from "@enclave/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Call, type CallBridge, type MediaKeyMaterial } from "./call.js"

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

function fluxo(): MediaStream {
  const audio = { kind: "audio", enabled: true, stop: vi.fn() }
  const video = { kind: "video", enabled: true, stop: vi.fn() }
  return {
    getTracks: () => [audio, video],
    getAudioTracks: () => [audio],
    getVideoTracks: () => [video],
  } as unknown as MediaStream
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

type Pedido = { audio: MediaTrackConstraints; video: MediaTrackConstraints | boolean }

/** The requests that reached `getUserMedia`, and which ones should fail. */
const captura = { pedidos: [] as Pedido[], recusar: (_pedido: Pedido): boolean => false }

function camaraPedida(pedido: Pedido | undefined): string | undefined {
  if (!pedido || typeof pedido.video !== "object") return undefined
  return (pedido.video.deviceId as { exact?: string } | undefined)?.exact
}

function microfonePedido(pedido: Pedido | undefined): string | undefined {
  return (pedido?.audio.deviceId as { exact?: string } | undefined)?.exact
}

beforeEach(() => {
  captura.pedidos = []
  captura.recusar = () => false
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection)
  vi.stubGlobal("RTCRtpSender", class {})
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async (pedido: Pedido) => {
        captura.pedidos.push(pedido)
        if (captura.recusar(pedido)) throw Object.assign(new Error("Requested device not found"), { name: "NotFoundError" })
        return fluxo()
      },
    },
  })
})

describe("a câmara escolhida", () => {
  it('vai com `exact`, e em "auto" vai sozinha', async () => {
    const call = new Call(ponte())
    call.videoDeviceId = "cam-1"
    await call.join(CANAL, { video: true })

    expect(captura.pedidos).toHaveLength(1)
    expect(camaraPedida(captura.pedidos[0])).toBe("cam-1")
    expect(captura.pedidos[0]?.video).toEqual({ deviceId: { exact: "cam-1" } })
  })

  it("leva a qualidade escolhida ao lado", async () => {
    const call = new Call(ponte())
    call.videoDeviceId = "cam-1"
    call.videoQuality = "720p"
    await call.join(CANAL, { video: true })

    expect(captura.pedidos[0]?.video).toEqual({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      deviceId: { exact: "cam-1" },
    })
  })

  it("sem escolha, a câmara é a do sistema", async () => {
    const call = new Call(ponte())
    await call.join(CANAL, { video: true })

    expect(captura.pedidos[0]?.video).toBe(true)
  })

  it("sem vídeo na chamada, a escolha não abre câmara nenhuma", async () => {
    const call = new Call(ponte())
    call.videoDeviceId = "cam-1"
    await call.join(CANAL)

    expect(captura.pedidos[0]?.video).toBe(false)
  })

  it("quando a câmara sumiu, abre a que houver, avisa, e o microfone escolhido fica", async () => {
    const call = new Call(ponte())
    call.videoDeviceId = "cam-sumida"
    call.audioSettings = { inputDeviceId: "mic-1" }
    captura.recusar = (pedido) => camaraPedida(pedido) === "cam-sumida"
    const avisos: string[] = []
    call.on("diagnostic", (aviso) => aviso.code.endsWith("-sumiu") && avisos.push(aviso.code))

    await call.join(CANAL, { video: true })

    expect(captura.pedidos).toHaveLength(2)
    expect(camaraPedida(captura.pedidos[1])).toBeUndefined()
    expect(microfonePedido(captura.pedidos[1])).toBe("mic-1")
    expect(avisos).toEqual(["camara-escolhida-sumiu"])
  })

  it("quando foi o microfone que sumiu, a câmara escolhida fica", async () => {
    const call = new Call(ponte())
    call.videoDeviceId = "cam-1"
    call.audioSettings = { inputDeviceId: "mic-sumido" }
    captura.recusar = (pedido) => microfonePedido(pedido) === "mic-sumido"
    const avisos: string[] = []
    call.on("diagnostic", (aviso) => aviso.code.endsWith("-sumiu") && avisos.push(aviso.code))

    await call.join(CANAL, { video: true })

    // First the camera is dropped (it fails, the microphone is what vanished), then
    // the microphone with the chosen camera: that is the one that opens.
    expect(captura.pedidos).toHaveLength(3)
    expect(camaraPedida(captura.pedidos[2])).toBe("cam-1")
    expect(microfonePedido(captura.pedidos[2])).toBeUndefined()
    expect(avisos).toEqual(["microfone-escolhido-sumiu"])
  })

  it("quando sumiram os dois, abre o que houver e avisa dos dois", async () => {
    const call = new Call(ponte())
    call.videoDeviceId = "cam-sumida"
    call.audioSettings = { inputDeviceId: "mic-sumido" }
    captura.recusar = (pedido) => camaraPedida(pedido) === "cam-sumida" || microfonePedido(pedido) === "mic-sumido"
    const avisos: string[] = []
    call.on("diagnostic", (aviso) => aviso.code.endsWith("-sumiu") && avisos.push(aviso.code))

    await call.join(CANAL, { video: true })

    expect(captura.pedidos).toHaveLength(4)
    expect(avisos).toEqual(["camara-escolhida-sumiu", "microfone-escolhido-sumiu"])
  })

  it("sem nada que largar, a falha chega inteira a quem ligou", async () => {
    const call = new Call(ponte())
    captura.recusar = () => true

    await expect(call.join(CANAL, { video: true })).rejects.toThrow("Requested device not found")
    expect(captura.pedidos).toHaveLength(1)
  })
})

import type { UserAddress } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  MotorSfu,
  type ConsumidorDeMedia,
  type DispositivoDeMedia,
  type SinalizacaoSfu,
  type TransporteDeMedia,
} from "./call-sfu.js"
import { CifraDeMedia } from "./media-sframe.js"

/**
 * The watchers for what arrives via the SFU (report from 2 November 2026).
 *
 * They observe nothing: they write to the log what distinguishes "packets do
 * not arrive" (track silent, transport down) from "they arrive and do not
 * decrypt" (the decryption, see `media-sframe.chave-perdida.test.ts`).
 */

const EU = "@eu:enclave.test" as UserAddress
const OUTRO = "@outro:enclave.test" as UserAddress

/** A track with events, like the browser's, and `muted` in the test's hands. */
class FaixaComEventos extends EventTarget {
  readonly kind = "audio"
  readonly id = "faixa-do-outro"
  enabled = true
  muted = false
  readyState: MediaStreamTrackState = "live"
  stop(): void {}
  ficarMuda(muda: boolean): void {
    this.muted = muda
    this.dispatchEvent(new Event(muda ? "mute" : "unmute"))
  }
}

class EstadoComEventos<E extends string> extends EventTarget {
  constructor(public state: E) {
    super()
  }
  mudar(estado: E): void {
    this.state = estado
    this.dispatchEvent(new Event("statechange"))
  }
}

function montar(mediaKey?: (address: UserAddress) => Promise<void>) {
  const faixa = new FaixaComEventos()
  const ice = new EstadoComEventos<RTCIceTransportState>("connected")
  const dtls = Object.assign(new EstadoComEventos<RTCDtlsTransportState>("connected"), { iceTransport: ice })
  const recepcao = { createEncodedStreams: () => ({ readable: new ReadableStream(), writable: new WritableStream() }), transport: dtls }

  const transporte = (id: string): TransporteDeMedia => ({
    id,
    on: () => {},
    produce: async () => ({ id: "p-eu", close: () => {} }),
    consume: async (opcoes): Promise<ConsumidorDeMedia> => ({
      id: opcoes.id,
      producerId: opcoes.producerId,
      track: faixa as unknown as MediaStreamTrack,
      rtpReceiver: recepcao as unknown as RTCRtpReceiver,
      close: () => {},
    }),
    close: () => {},
  })
  const dispositivo: DispositivoDeMedia = {
    load: async () => {},
    rtpCapabilities: {},
    canProduce: () => true,
    createSendTransport: (o) => transporte(o.id),
    createRecvTransport: (o) => transporte(o.id),
  }
  const sinalizacao: SinalizacaoSfu = {
    sfuEntrarNoAmbito: async () => ({ rtpCapabilities: {}, producers: [{ id: "p-outro", kind: "audio", address: OUTRO }] }),
    sfuSairDoAmbito: () => {},
    sfuCriarTransporte: async (_c, _a, sentido) => ({ id: `t-${sentido}`, iceParameters: {}, iceCandidates: [], dtlsParameters: {} }),
    sfuLigarTransporte: async () => {},
    sfuProduzir: async () => "p-eu",
    sfuFecharProdutor: async () => {},
    sfuConsumir: async (_t, produtor) => ({ id: `c-${produtor}`, producerId: produtor, kind: "audio", rtpParameters: {} }),
    sfuRetomar: async () => {},
    sfuPausar: async () => {},
  }
  const diagnosticos: { code: string; detail?: string }[] = []
  const cifra = new CifraDeMedia({
    selfAddress: EU,
    mediaKey: async (_canal, address) => {
      await mediaKey?.(address)
      return { keyId: 41, senderId: 1, material: new Uint8Array(32).fill(1) }
    },
    reservarContadorSframe: async () => 0,
  })
  const motor = new MotorSfu({
    sinalizacao,
    cifra,
    criarDispositivo: () => dispositivo,
    aoDiagnosticar: (code, detail) => diagnosticos.push(detail === undefined ? { code } : { code, detail }),
    aoMudar: () => {},
    verOEcraDe: () => false,
  })
  return { motor, faixa, ice, dtls, diagnosticos }
}

beforeEach(() => {
  class Ponta {
    createEncodedStreams(): unknown {
      return null
    }
  }
  vi.stubGlobal("RTCRtpSender", Ponta)
  vi.stubGlobal("RTCRtpReceiver", Ponta)
  vi.stubGlobal(
    "MediaStream",
    class {
      readonly faixas: MediaStreamTrack[] = []
      getTracks = (): MediaStreamTrack[] => [...this.faixas]
      addTrack = (faixa: MediaStreamTrack): void => void this.faixas.push(faixa)
      removeTrack = (): void => {}
    },
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("a faixa de quem se ouve", () => {
  it("muda por mais de três segundos fica escrita, e o regresso também", async () => {
    const { motor, faixa, diagnosticos } = montar()
    await motor.entrar("#c:s", "a".repeat(43), null)
    vi.useFakeTimers()

    // A brief pause is not a failure: the network breathes.
    faixa.ficarMuda(true)
    vi.advanceTimersByTime(1000)
    faixa.ficarMuda(false)
    vi.advanceTimersByTime(MotorSfu.FAIXA_MUDA_MS)
    expect(diagnosticos.filter((cada) => cada.code.startsWith("sfu-faixa"))).toEqual([])

    faixa.ficarMuda(true)
    vi.advanceTimersByTime(MotorSfu.FAIXA_MUDA_MS)
    faixa.ficarMuda(false)
    expect(diagnosticos.filter((cada) => cada.code.startsWith("sfu-faixa"))).toEqual([
      { code: "sfu-faixa-sem-pacotes", detail: `${OUTRO} · microfone` },
      { code: "sfu-faixa-com-pacotes", detail: `${OUTRO} · microfone` },
    ])
  })
})

describe("o transporte de recepção", () => {
  it("diz quando o ICE cai e quando volta, e quando o DTLS falha", async () => {
    const { motor, ice, dtls, diagnosticos } = montar()
    await motor.entrar("#c:s", "a".repeat(43), null)

    ice.mudar("checking")
    ice.mudar("disconnected")
    ice.mudar("connected")
    dtls.mudar("failed")

    expect(diagnosticos.filter((cada) => cada.code === "sfu-transporte-estado").map((cada) => cada.detail)).toEqual([
      "recepcao · ice disconnected",
      "recepcao · ice connected",
      "recepcao · dtls failed",
    ])
  })
})

describe("o passo 3 da corrida da chave", () => {
  /*
   * The proof in the engine that rotation passes by whoever is being set up:
   * while the OTHER's key request is in flight, `emissores()` does not count it,
   * and `rekey` rotates with that list. The rest of the run, with real frames,
   * is in `media-sframe.chave-perdida.test.ts`.
   */
  it("enquanto a chave de quem chega está a ser pedida, a rotação não o conta", async () => {
    let soltar!: () => void
    const retida = new Promise<void>((resolve) => {
      soltar = resolve
    })
    let perguntou = false
    const { motor } = montar(async (address) => {
      if (address !== OUTRO) return
      perguntou = true
      await retida
    })
    const entrada = motor.entrar("#c:s", "a".repeat(43), null)
    for (let volta = 0; volta < 200 && !perguntou; volta++) await new Promise((resolve) => setTimeout(resolve, 1))

    expect(perguntou).toBe(true)
    expect(motor.emissores()).toEqual([])

    soltar()
    await entrada
    expect(motor.emissores()).toEqual([OUTRO])
  })
})

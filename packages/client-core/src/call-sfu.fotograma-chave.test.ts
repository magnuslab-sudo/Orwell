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
 * Phase M2: the viewer requests a keyframe (`sfu.keyframe`) when the image
 * breaks, via the receiver's `getStats` (or through the decryption that comes
 * back), never in bursts. The test harness is from `call-sfu.imagem-do-ecra.test.ts`.
 */

const EU = "@eu:enclave.test" as UserAddress
const OUTRO = "@outro:enclave.test" as UserAddress

class Faixa extends EventTarget {
  readonly kind = "video"
  readonly id = "ecra-do-outro"
  enabled = true
  muted = false
  readyState: MediaStreamTrackState = "live"
  stop(): void {}
}

/** Receiver stats, modified by the test. */
const stats = {
  keyFramesDecoded: 0,
  framesDecoded: 0,
  bytesReceived: 0,
  pliCount: 0,
  packetsLost: 0,
  framesDropped: 0,
  freezeCount: 0,
  frameWidth: 1920,
  frameHeight: 1080,
  framesPerSecond: 15,
}

function montar({ comPedido = true }: { comPedido?: boolean } = {}) {
  const pedidos: { transport: string; consumer: string; t: number }[] = []
  const faixa = new Faixa()
  const recepcao = {
    createEncodedStreams: () => ({ readable: new ReadableStream(), writable: new WritableStream() }),
    getStats: async () => new Map([["in", { type: "inbound-rtp", kind: "video", timestamp: Date.now(), ...stats }]]),
  }
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
    sfuEntrarNoAmbito: async () => ({
      rtpCapabilities: {},
      producers: [{ id: "p-ecra", kind: "video", address: OUTRO, fonte: "ecra" }],
    }),
    sfuSairDoAmbito: () => {},
    sfuCriarTransporte: async (_c, _a, sentido) => ({ id: `t-${sentido}`, iceParameters: {}, iceCandidates: [], dtlsParameters: {} }),
    sfuLigarTransporte: async () => {},
    sfuProduzir: async () => "p-eu",
    sfuFecharProdutor: async () => {},
    sfuConsumir: async (_t, produtor) => ({ id: `c-${produtor}`, producerId: produtor, kind: "video", rtpParameters: {} }),
    sfuRetomar: async () => {},
    sfuPausar: async () => {},
    ...(comPedido ? { sfuPedirFotogramaChave: (transport: string, consumer: string) => void pedidos.push({ transport, consumer, t: Date.now() }) } : {}),
  }
  const diagnosticos: { code: string; detail?: string }[] = []
  const cifra = new CifraDeMedia({
    selfAddress: EU,
    mediaKey: async () => ({ keyId: 41, senderId: 1, material: new Uint8Array(32).fill(1) }),
    reservarContadorSframe: async () => 0,
  })
  let ver = true
  const motor = new MotorSfu({
    sinalizacao,
    cifra,
    criarDispositivo: () => dispositivo,
    aoDiagnosticar: (code, detail) => diagnosticos.push(detail === undefined ? { code } : { code, detail }),
    aoMudar: () => {},
    verOEcraDe: () => ver,
  })
  return { motor, cifra, pedidos, diagnosticos, deixarDeVer: () => (ver = false) }
}


/** Advance the fake clock and let the `getStats` promises settle. */
async function andar(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  Object.assign(stats, { keyFramesDecoded: 0, framesDecoded: 0, bytesReceived: 0, pliCount: 0, packetsLost: 0, framesDropped: 0, freezeCount: 0 })
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
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("o fotograma-chave a pedido de quem vê", () => {
  const AMOSTRA = MotorSfu.AMOSTRA_DO_FOTOGRAMA_MS

  it("a imagem congela: um pedido, pelo consumidor certo, e escrito no registo", async () => {
    const { motor, pedidos, diagnosticos } = montar()
    await motor.entrar("#c:s", "a".repeat(43), null)
    await andar(AMOSTRA * 2)
    expect(pedidos).toHaveLength(0)
    stats.freezeCount = 1
    await andar(AMOSTRA)
    expect(pedidos.map(({ transport, consumer }) => ({ transport, consumer }))).toEqual([{ transport: "t-recepcao", consumer: "c-p-ecra" }])
    expect(diagnosticos.find((d) => d.code === "sfu-fotograma-chave-pedido")?.detail).toBe(`${OUTRO} · ecra · congelou`)
  })

  it("com a imagem boa não pede nada", async () => {
    const { motor, pedidos } = montar()
    await motor.entrar("#c:s", "a".repeat(43), null)
    for (let i = 0; i < 20; i++) {
      stats.keyFramesDecoded++
      stats.framesDecoded += 15
      await andar(AMOSTRA)
    }
    expect(pedidos).toHaveLength(0)
  })

  it("não dispara em rajada: cinco segundos de contadores a subir dão no máximo cinco pedidos, a um segundo uns dos outros", async () => {
    const { motor, pedidos } = montar()
    await motor.entrar("#c:s", "a".repeat(43), null)
    await andar(AMOSTRA)
    for (let i = 0; i < 10; i++) {
      stats.freezeCount++
      stats.pliCount++
      await andar(AMOSTRA)
    }
    expect(pedidos.length).toBeGreaterThanOrEqual(4)
    expect(pedidos.length).toBeLessThanOrEqual(5)
    for (let i = 1; i < pedidos.length; i++) expect(pedidos[i]!.t - pedidos[i - 1]!.t).toBeGreaterThanOrEqual(1000)
  })

  it("um PLI do browser que não trouxe fotograma-chave é reforçado; um que trouxe, não", async () => {
    const { motor, pedidos } = montar()
    await motor.entrar("#c:s", "a".repeat(43), null)
    await andar(AMOSTRA)
    stats.pliCount = 1
    await andar(AMOSTRA)
    stats.keyFramesDecoded = 1
    await andar(AMOSTRA * 2)
    expect(pedidos).toHaveLength(0)
    stats.pliCount = 2
    await andar(AMOSTRA * 2)
    expect(pedidos).toHaveLength(1)
  })

  it("a decifra de vídeo que volta pede um", async () => {
    const { motor, cifra, pedidos, diagnosticos } = montar()
    await motor.entrar("#c:s", "a".repeat(43), null)
    await andar(AMOSTRA)
    cifra.aoVoltarOVideo?.(OUTRO)
    cifra.aoVoltarOVideo?.(OUTRO)
    expect(pedidos).toHaveLength(1)
    expect(diagnosticos.find((d) => d.code === "sfu-fotograma-chave-pedido")?.detail).toBe(`${OUTRO} · ecra · decifra-voltou`)
  })

  it("quem deixou de ver não pede", async () => {
    const { motor, pedidos, deixarDeVer } = montar()
    await motor.entrar("#c:s", "a".repeat(43), null)
    await andar(AMOSTRA)
    deixarDeVer()
    await motor.largarEcraDe(OUTRO)
    stats.freezeCount = 5
    await andar(AMOSTRA * 4)
    expect(pedidos).toHaveLength(0)
  })

  it("uma ponte sem o pedido não quebra nada", async () => {
    const { motor, cifra, diagnosticos } = montar({ comPedido: false })
    await motor.entrar("#c:s", "a".repeat(43), null)
    stats.freezeCount = 3
    await andar(AMOSTRA * 4)
    cifra.aoVoltarOVideo?.(OUTRO)
    expect(diagnosticos.filter((d) => d.code === "sfu-fotograma-chave-pedido")).toHaveLength(0)
  })
})

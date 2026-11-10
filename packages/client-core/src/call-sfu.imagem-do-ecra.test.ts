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
 * What someone who sees a screen writes in the log (2 November of 2026).
 *
 * The log that the owner sent from 1.0.5 said `call-ecra-aceite` and nothing else:
 * no line about video, and the fault (the image breaking up) was
 * silent. From now on it is written when you start to see, how long
 * it takes for the first key frame, and from 30 em 30 segundos the resolution,
 * frame rate, bitrate, key frames, requests (PLI), losses,
 * dropped frames and freezes. Only numbers, never the image itself.
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

function montar() {
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
  return { motor, diagnosticos, deixarDeVer: () => (ver = false) }
}

const doEcra = (diagnosticos: { code: string; detail?: string }[]) =>
  diagnosticos.filter((cada) => cada.code.startsWith("sfu-ecra-") && cada.code !== "sfu-ecra-som-recusado")

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

describe("a imagem do ecrã de quem se vê, no registo", () => {
  it("diz quando se começa a ver e quanto demorou o primeiro fotograma-chave", async () => {
    const { motor, diagnosticos } = montar()
    await motor.entrar("#c:s", "a".repeat(43), null)
    await andar(0)
    expect(doEcra(diagnosticos)[0]).toEqual({ code: "sfu-ecra-a-ver", detail: `${OUTRO} · novo` })

    await andar(MotorSfu.AMOSTRA_DO_ECRA_MS * 2)
    stats.keyFramesDecoded = 1
    await andar(MotorSfu.AMOSTRA_DO_ECRA_MS)
    const primeira = doEcra(diagnosticos).find((cada) => cada.code === "sfu-ecra-primeira-chave")
    expect(primeira?.detail).toMatch(new RegExp(`^${OUTRO} · \\d+ ms$`))
    // Once only.
    stats.keyFramesDecoded = 2
    await andar(MotorSfu.AMOSTRA_DO_ECRA_MS * 3)
    expect(doEcra(diagnosticos).filter((cada) => cada.code === "sfu-ecra-primeira-chave")).toHaveLength(1)
  })

  it("diz quando o primeiro fotograma-chave não chega", async () => {
    const { motor, diagnosticos } = montar()
    await motor.entrar("#c:s", "a".repeat(43), null)
    await andar(MotorSfu.SEM_CHAVE_DO_ECRA_MS + MotorSfu.AMOSTRA_DO_ECRA_MS)
    expect(doEcra(diagnosticos).map((cada) => cada.code)).toContain("sfu-ecra-sem-chave")
  })

  it("e de 30 em 30 segundos o estado da imagem, com as diferenças", async () => {
    const { motor, diagnosticos } = montar()
    await motor.entrar("#c:s", "a".repeat(43), null)
    stats.keyFramesDecoded = 1
    await andar(MotorSfu.AMOSTRA_DO_ECRA_MS)
    Object.assign(stats, { keyFramesDecoded: 11, framesDecoded: 450, bytesReceived: 30 * 250_000, pliCount: 3, packetsLost: 7, framesDropped: 2, freezeCount: 1 })
    await andar(MotorSfu.RESUMO_DO_ECRA_MS)
    const resumo = doEcra(diagnosticos).find((cada) => cada.code === "sfu-ecra-imagem")
    expect(resumo?.detail).toMatch(/1920x1080/)
    expect(resumo?.detail).toMatch(/chaves \+\d+/)
    expect(resumo?.detail).toMatch(/pli \+3/)
    expect(resumo?.detail).toMatch(/perdidos \+7/)
    expect(resumo?.detail).toMatch(/congelamentos \+1/)
  })

  it("e cala-se quando se deixa de ver", async () => {
    const { motor, diagnosticos, deixarDeVer } = montar()
    await motor.entrar("#c:s", "a".repeat(43), null)
    stats.keyFramesDecoded = 1
    await andar(MotorSfu.AMOSTRA_DO_ECRA_MS)
    deixarDeVer()
    await motor.largarEcraDe(OUTRO)
    const antes = doEcra(diagnosticos).length
    await andar(MotorSfu.RESUMO_DO_ECRA_MS * 2)
    expect(doEcra(diagnosticos).length).toBe(antes)
  })
})

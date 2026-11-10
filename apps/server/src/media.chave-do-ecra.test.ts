import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { types } from "mediasoup"
import { TECTO_DA_CAMARA, TECTO_DO_ECRA } from "@enclave/protocol"
import { INTERVALO_DA_CHAVE_DO_ECRA, MotorDeMedia } from "./media.js"

/**
 * The periodic screen keyframe, requested by the server.
 *
 * The cause of the pixelated screen sharing (2 November 2026) was the encrypted
 * VP8 header (see `bytesEmClaroDoVp8` in `@enclave/crypto`): with it in the
 * clear, the receiver asks for a keyframe again when it loses one. This is the
 * safety net underneath: the server asks the sender for one every `INTERVALO_DA_CHAVE_DO_ECRA`,
 * while someone is watching. It also serves a 1.0.5 sender in a call with new
 * clients, which still encrypts the header and whose receivers never ask.
 *
 * Against a real mediasoup worker, like the rest of `media.test.ts`. Without a
 * browser there is no RTP, so we count what the engine ASKS the consumer to do
 * (`requestKeyFrame`), not the frames; frames are counted in the
 * `scripts/sfu-prova-ecra/` test rig.
 */

const INTERVALO = 40
let motor: MotorDeMedia

beforeAll(async () => {
  motor = await MotorDeMedia.arrancar({ porto: 0, anunciarIp: "", escutarEm: "127.0.0.1", intervaloDaChaveDoEcra: INTERVALO })
})

afterAll(async () => {
  await motor?.fechar()
})

function videoDe(ssrc: number, maxBitrate: number): types.RtpParameters {
  return {
    codecs: [{ mimeType: "video/VP8", payloadType: 101, clockRate: 90000, parameters: {}, rtcpFeedback: [] }],
    headerExtensions: [],
    encodings: [{ ssrc, maxBitrate }],
    rtcp: { cname: "teste" },
  }
}

let contador = 0
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function montar(fonte: "ecra" | "camara") {
  const chave = `ambito-chave-${contador++}`
  const eu = `eu-${contador}`
  const outro = `outro-${contador}`
  await motor.entrar(chave, eu)
  const { rtpCapabilities } = await motor.entrar(chave, outro)
  const envio = await motor.criarTransporte(chave, eu, "envio")
  const tecto = fonte === "ecra" ? TECTO_DO_ECRA : TECTO_DA_CAMARA
  const { id: produtor } = await motor.produzir(eu, envio.id, "video", videoDe(9100 + contador, tecto), fonte)
  const recepcao = await motor.criarTransporte(chave, outro, "recepcao")
  const consumido = await motor.consumir(outro, recepcao.id, produtor, rtpCapabilities)
  return { produtor, eu, outro, recepcao, consumido }
}

describe("o fotograma-chave periódico do ecrã", () => {
  it("o intervalo de produção fica entre 2 e 4 segundos", () => {
    expect(INTERVALO_DA_CHAVE_DO_ECRA).toBeGreaterThanOrEqual(2000)
    expect(INTERVALO_DA_CHAVE_DO_ECRA).toBeLessThanOrEqual(4000)
  })

  it("pede um a cada intervalo enquanto alguém vê, e pára quando ninguém vê", async () => {
    const { produtor, outro, recepcao, consumido } = await montar("ecra")

    // Paused (as it is created, and as it stays after "Stop watching"): nothing.
    await esperar(INTERVALO * 4)
    expect(motor.chavesPedidasDoEcra(produtor)).toBe(0)

    await motor.retomar(outro, recepcao.id, consumido.id)
    await esperar(INTERVALO * 8)
    const aVer = motor.chavesPedidasDoEcra(produtor)
    expect(aVer).toBeGreaterThanOrEqual(4)

    await motor.pausar(outro, recepcao.id, consumido.id)
    await esperar(INTERVALO * 4)
    const depois = motor.chavesPedidasDoEcra(produtor)
    await esperar(INTERVALO * 4)
    expect(motor.chavesPedidasDoEcra(produtor)).toBe(depois)
  })

  it("e não toca na câmara", async () => {
    const { produtor, outro, recepcao, consumido } = await montar("camara")
    await motor.retomar(outro, recepcao.id, consumido.id)
    await esperar(INTERVALO * 5)
    expect(motor.chavesPedidasDoEcra(produtor)).toBe(0)
  })

  it("o relógio morre com o produtor", async () => {
    const { produtor, eu, outro, recepcao, consumido } = await montar("ecra")
    await motor.retomar(outro, recepcao.id, consumido.id)
    await esperar(INTERVALO * 3)
    await motor.fecharProdutor(eu, produtor)
    const fechado = motor.chavesPedidasDoEcra(produtor)
    await esperar(INTERVALO * 4)
    expect(motor.chavesPedidasDoEcra(produtor)).toBe(fechado)
  })
})

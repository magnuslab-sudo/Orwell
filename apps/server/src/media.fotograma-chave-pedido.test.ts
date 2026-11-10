import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { types } from "mediasoup"
import { TECTO_DO_ECRA } from "@enclave/protocol"
import { INTERVALO_DO_FOTOGRAMA_CHAVE_PEDIDO, MotorDeMedia, RecusaDeMedia } from "./media.js"

/**
 * Phase M2: the keyframe requested by whoever is WATCHING (`sfu.keyframe`).
 *
 * Against a real mediasoup worker, like `media.chave-do-ecra.test.ts`.
 * Without a browser there is no RTP: we count what the engine ASKS
 * (`requestKeyFrame`). The periodic screen timer is turned off here
 * (`intervaloDaChaveDoEcra: 0`) so the count covers only the requests.
 */

let motor: MotorDeMedia

beforeAll(async () => {
  motor = await MotorDeMedia.arrancar({ porto: 0, anunciarIp: "", escutarEm: "127.0.0.1", intervaloDaChaveDoEcra: 0 })
})

afterAll(async () => {
  await motor?.fechar()
})

const VP8 = (ssrc: number): types.RtpParameters => ({
  codecs: [{ mimeType: "video/VP8", payloadType: 101, clockRate: 90000, parameters: {}, rtcpFeedback: [] }],
  headerExtensions: [],
  encodings: [{ ssrc, maxBitrate: TECTO_DO_ECRA }],
  rtcp: { cname: "teste" },
})

const OPUS = (ssrc: number): types.RtpParameters => ({
  codecs: [{ mimeType: "audio/opus", payloadType: 100, clockRate: 48000, channels: 2, parameters: { usedtx: 1 }, rtcpFeedback: [] }],
  headerExtensions: [],
  encodings: [{ ssrc }],
  rtcp: { cname: "teste" },
})

let contador = 0

async function montar(kind: "audio" | "video" = "video") {
  const chave = `ambito-pedido-${contador++}`
  const eu = `eu-${contador}`
  const outro = `outro-${contador}`
  const intruso = `intruso-${contador}`
  await motor.entrar(chave, eu)
  await motor.entrar(chave, intruso)
  const { rtpCapabilities } = await motor.entrar(chave, outro)
  const envio = await motor.criarTransporte(chave, eu, "envio")
  const { id: produtor } = await motor.produzir(
    eu,
    envio.id,
    kind,
    kind === "video" ? VP8(9300 + contador) : OPUS(9300 + contador),
    kind === "video" ? "ecra" : "microfone",
  )
  const recepcao = await motor.criarTransporte(chave, outro, "recepcao")
  const doIntruso = await motor.criarTransporte(chave, intruso, "recepcao")
  const consumido = await motor.consumir(outro, recepcao.id, produtor, rtpCapabilities)
  return { outro, intruso, recepcao, doIntruso, consumido }
}

describe("o fotograma-chave a pedido de quem vê", () => {
  it("o tecto é de um por segundo por consumidor", () => {
    expect(INTERVALO_DO_FOTOGRAMA_CHAVE_PEDIDO).toBe(1000)
  })

  it("segue o primeiro pedido e corta os que chegam antes de passar um segundo", async () => {
    const { outro, recepcao, consumido } = await montar()
    await motor.retomar(outro, recepcao.id, consumido.id)
    const antes = motor.chavesPedidasPorQuemVe
    const t0 = 1_000_000
    expect(motor.pedirFotogramaChave(outro, recepcao.id, consumido.id, t0)).toBe(true)
    // A burst of ten in the same second: none goes through.
    for (let i = 1; i <= 10; i++) expect(motor.pedirFotogramaChave(outro, recepcao.id, consumido.id, t0 + i * 90)).toBe(false)
    expect(motor.pedirFotogramaChave(outro, recepcao.id, consumido.id, t0 + 999)).toBe(false)
    expect(motor.pedirFotogramaChave(outro, recepcao.id, consumido.id, t0 + 1000)).toBe(true)
    expect(motor.chavesPedidasPorQuemVe - antes).toBe(2)
  })

  it("um consumidor em pausa não pede (não está a receber nada)", async () => {
    const { outro, recepcao, consumido } = await montar()
    expect(motor.pedirFotogramaChave(outro, recepcao.id, consumido.id)).toBe(false)
    await motor.retomar(outro, recepcao.id, consumido.id)
    await motor.pausar(outro, recepcao.id, consumido.id)
    expect(motor.pedirFotogramaChave(outro, recepcao.id, consumido.id)).toBe(false)
  })

  it("o som não tem fotogramas-chave", async () => {
    const { outro, recepcao, consumido } = await montar("audio")
    await motor.retomar(outro, recepcao.id, consumido.id)
    expect(motor.pedirFotogramaChave(outro, recepcao.id, consumido.id)).toBe(false)
  })

  it("só o dono do consumidor pede: o transporte de outro é recusado, e um consumidor de outro transporte não existe", async () => {
    const { outro, intruso, recepcao, doIntruso, consumido } = await montar()
    await motor.retomar(outro, recepcao.id, consumido.id)
    const antes = motor.chavesPedidasPorQuemVe
    // The intruder with the other's transport: the lock of `#meuTransporte`.
    expect(() => motor.pedirFotogramaChave(intruso, recepcao.id, consumido.id)).toThrow(RecusaDeMedia)
    // The intruder with ITS OWN transport and the other's consumer: it does not belong to that transport.
    expect(motor.pedirFotogramaChave(intruso, doIntruso.id, consumido.id)).toBe(false)
    expect(motor.chavesPedidasPorQuemVe).toBe(antes)
    // And the owner can still ask.
    expect(motor.pedirFotogramaChave(outro, recepcao.id, consumido.id)).toBe(true)
  })
})

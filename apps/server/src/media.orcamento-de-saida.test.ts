import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { types } from "mediasoup"
import { TECTO_DA_CAMARA, TECTO_DO_ECRA } from "@enclave/protocol"
import { MotorDeMedia, RecusaDeMedia } from "./media.js"
import { CUSTO_DA_VOZ_NO_FIO } from "./orcamento-de-saida.js"

/**
 * The server's outgoing budget, against a real mediasoup worker.
 *
 * A small video budget (three screens, 7.5 Mbit/s) to hit the cap with few
 * consumers. What is measured: whoever arrives over the cap is refused with
 * `servidor-cheio` and whoever was already watching continues; pausing frees
 * capacity; and all close paths return the counter to zero. Voice is never
 * refused.
 */

const ORCAMENTO_DE_VIDEO = 3 * TECTO_DO_ECRA
const linhas: string[] = []
let motor: MotorDeMedia

beforeAll(async () => {
  motor = await MotorDeMedia.arrancar({
    porto: 0,
    anunciarIp: "",
    escutarEm: "127.0.0.1",
    intervaloDaChaveDoEcra: 0,
    orcamentoDeSaida: { videoBps: ORCAMENTO_DE_VIDEO, reservaDaVozBps: 2 * CUSTO_DA_VOZ_NO_FIO },
    registar: (linha) => linhas.push(linha),
  })
})

afterAll(async () => {
  await motor?.fechar()
})

beforeEach(() => {
  // Each test starts from a server with no outgoing traffic: that proves the previous one left no leaks.
  expect(motor.saida().video.uso).toBe(0)
  expect(motor.saida().voz.uso).toBe(0)
})

function videoDe(ssrc: number, maxBitrate: number): types.RtpParameters {
  return {
    codecs: [{ mimeType: "video/VP8", payloadType: 101, clockRate: 90000, parameters: {}, rtcpFeedback: [] }],
    headerExtensions: [],
    encodings: [{ ssrc, maxBitrate }],
    rtcp: { cname: "teste" },
  }
}

function vozDe(ssrc: number): types.RtpParameters {
  return {
    codecs: [
      {
        mimeType: "audio/opus",
        payloadType: 100,
        clockRate: 48000,
        channels: 2,
        parameters: { useinbandfec: 1, usedtx: 1, "sprop-stereo": 0 },
        rtcpFeedback: [],
      },
    ],
    headerExtensions: [],
    encodings: [{ ssrc }],
    rtcp: { cname: "teste" },
  }
}

let contador = 0

/** A call with one sender and `espectadores` people who are not yet consuming anything. */
async function chamada(espectadores: number) {
  const chave = `ambito-orcamento-${contador++}`
  const emissor = `emissor-${contador}`
  await motor.entrar(chave, emissor)
  const envio = await motor.criarTransporte(chave, emissor, "envio")
  const quemVe: { dono: string; recepcao: string; rtpCapabilities: types.RtpCapabilities }[] = []
  for (let i = 0; i < espectadores; i++) {
    const dono = `ve-${contador}-${i}`
    const { rtpCapabilities } = await motor.entrar(chave, dono)
    const recepcao = await motor.criarTransporte(chave, dono, "recepcao")
    quemVe.push({ dono, recepcao: recepcao.id, rtpCapabilities })
  }
  return { chave, emissor, envio: envio.id, quemVe }
}

async function recusa(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa
  } catch (erro) {
    expect(erro).toBeInstanceOf(RecusaDeMedia)
    return (erro as RecusaDeMedia).codigo
  }
  throw new Error("devia ter sido recusado")
}

describe("o orçamento de saída do servidor", () => {
  it("conta consumos e não fluxos, recusa só o espectador a mais, e quem via continua", async () => {
    const { chave, emissor, envio, quemVe } = await chamada(4)
    const { id: ecra } = await motor.produzir(emissor, envio, "video", videoDe(7100, TECTO_DO_ECRA), "ecra")
    // Producing only checks: nobody is watching, nothing goes out.
    expect(motor.saida().video.uso).toBe(0)

    const consumos = []
    for (const quem of quemVe.slice(0, 3)) {
      const consumo = await motor.consumir(quem.dono, quem.recepcao, ecra, quem.rtpCapabilities)
      await motor.retomar(quem.dono, quem.recepcao, consumo.id)
      consumos.push(consumo)
    }
    expect(motor.saida().video).toMatchObject({ uso: 3 * TECTO_DO_ECRA, fluxos: 3 })

    const quarto = quemVe[3]!
    expect(await recusa(motor.consumir(quarto.dono, quarto.recepcao, ecra, quarto.rtpCapabilities))).toBe("servidor-cheio")
    // The refusal did not take anything from anyone.
    expect(motor.saida().video).toMatchObject({ uso: 3 * TECTO_DO_ECRA, fluxos: 3 })
    await motor.retomar(quemVe[0]!.dono, quemVe[0]!.recepcao, consumos[0]!.id)

    // "Stop watching" frees capacity; the fourth one gets in; and "Watch" from whoever stopped counts as a new viewer.
    await motor.pausar(quemVe[0]!.dono, quemVe[0]!.recepcao, consumos[0]!.id)
    expect(motor.saida().video.uso).toBe(2 * TECTO_DO_ECRA)
    const doQuarto = await motor.consumir(quarto.dono, quarto.recepcao, ecra, quarto.rtpCapabilities)
    await motor.retomar(quarto.dono, quarto.recepcao, doQuarto.id)
    expect(await recusa(motor.retomar(quemVe[0]!.dono, quemVe[0]!.recepcao, consumos[0]!.id))).toBe("servidor-cheio")
    expect(motor.saida().video.uso).toBe(3 * TECTO_DO_ECRA)

    // Closing the screen closes its consumers for everyone, and the counter goes back to zero.
    await motor.fecharProdutor(emissor, ecra)
    expect(motor.saida().video).toMatchObject({ uso: 0, fluxos: 0 })

    for (const quem of [emissor, ...quemVe.map((cada) => cada.dono)]) await motor.sairDoAmbito(quem, chave)
  })

  it("recusa o vídeo novo que nem o primeiro espectador cabe, noutra chamada", async () => {
    const cheia = await chamada(3)
    const { id: ecra } = await motor.produzir(cheia.emissor, cheia.envio, "video", videoDe(7200, TECTO_DO_ECRA), "ecra")
    for (const quem of cheia.quemVe) await motor.consumir(quem.dono, quem.recepcao, ecra, quem.rtpCapabilities)
    expect(motor.saida().video.uso).toBe(ORCAMENTO_DE_VIDEO)

    const outra = await chamada(1)
    expect(await recusa(motor.produzir(outra.emissor, outra.envio, "video", videoDe(7201, TECTO_DA_CAMARA), "camara"))).toBe(
      "servidor-cheio",
    )

    // Voice gets in anyway, and is counted separately.
    const { id: voz } = await motor.produzir(outra.emissor, outra.envio, "audio", vozDe(7202), "microfone")
    const quem = outra.quemVe[0]!
    const consumo = await motor.consumir(quem.dono, quem.recepcao, voz, quem.rtpCapabilities)
    await motor.retomar(quem.dono, quem.recepcao, consumo.id)
    expect(motor.saida().voz).toMatchObject({ uso: CUSTO_DA_VOZ_NO_FIO, fluxos: 1 })
    expect(motor.saida().video.uso).toBe(ORCAMENTO_DE_VIDEO)

    // Leaving frees everything each person was consuming, in both calls.
    for (const dono of outra.quemVe.map((cada) => cada.dono)) await motor.sairDoAmbito(dono, outra.chave)
    expect(motor.saida().voz.uso).toBe(0)
    await motor.sairDoAmbito(outra.emissor, outra.chave)
    for (const dono of cheia.quemVe.map((cada) => cada.dono)) await motor.sairDoAmbito(dono, cheia.chave)
    expect(motor.saida().video.uso).toBe(0)
    await motor.sairDoAmbito(cheia.emissor, cheia.chave)
  })

  it("a voz passa da reserva, entra na mesma, e fica dito no registo", async () => {
    const { chave, emissor, envio, quemVe } = await chamada(3)
    const { id: voz } = await motor.produzir(emissor, envio, "audio", vozDe(7300), "microfone")
    linhas.length = 0
    for (const quem of quemVe) await motor.consumir(quem.dono, quem.recepcao, voz, quem.rtpCapabilities)
    expect(motor.saida().voz).toMatchObject({ uso: 3 * CUSTO_DA_VOZ_NO_FIO, fluxos: 3 })
    expect(linhas.filter((linha) => linha.includes("a voz passou da reserva"))).toHaveLength(1)

    // The sender leaves: its transport closes the producer, and the consumers with it.
    await motor.sairDoAmbito(emissor, chave)
    expect(motor.saida().voz.uso).toBe(0)
    for (const quem of quemVe) await motor.sairDoAmbito(quem.dono, chave)
  })

  it("a câmara conta 1,2 Mbit/s por espectador, e sair a meio não deixa fugas", async () => {
    const { chave, emissor, envio, quemVe } = await chamada(2)
    const { id: camara } = await motor.produzir(emissor, envio, "video", videoDe(7400, TECTO_DA_CAMARA), "camara")
    for (const quem of quemVe) await motor.consumir(quem.dono, quem.recepcao, camara, quem.rtpCapabilities)
    expect(motor.saida().video.uso).toBe(2 * TECTO_DA_CAMARA)
    // `sair` is what the gateway calls when the connection drops.
    await motor.sair(quemVe[0]!.dono)
    expect(motor.saida().video.uso).toBe(TECTO_DA_CAMARA)
    await motor.sair(emissor)
    expect(motor.saida().video.uso).toBe(0)
    await motor.sair(quemVe[1]!.dono)
    expect(motor.ambitosAbertos).toBe(0)
    void chave
  })
})

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { types } from "mediasoup"
import { TECTO_DA_MUSICA, TECTO_DO_ECRA, TECTO_DO_SOM_DO_ECRA } from "@enclave/protocol"
import { MotorDeMedia, ORCAMENTO_DA_MUSICA, ORCAMENTO_DO_SOM_DO_ECRA, RecusaDeMedia } from "./media.js"

/**
 * The MUSIC of a call: an audio producer with source `musica`.
 *
 * Phase 9 of `docs/planos/definicoes-0-9.md`: the DJ speaks and plays at the
 * same time. Screen sound was already a second track, but it only comes after
 * the screen image from the same person (`ecra-som-sem-imagem`). Music has no
 * image, so it has its own source. These tests fail with the old server: the
 * `#fonteDe` read `musica` as a video source and refused it.
 *
 * Against a real mediasoup worker, like `media.test.ts` and for the same
 * reason: a mock only proved we call what we invented for it.
 */

let motor: MotorDeMedia

beforeAll(async () => {
  motor = await MotorDeMedia.arrancar({ porto: 0, anunciarIp: "", escutarEm: "127.0.0.1" })
})

afterAll(async () => {
  await motor?.fechar()
})

/** Opus, as `mediasoup-client` declares it. `estereo` is the music one. */
function opusDe(ssrc: number, maxaveragebitrate?: number, estereo = false): types.RtpParameters {
  return {
    codecs: [
      {
        mimeType: "audio/opus",
        payloadType: 100,
        clockRate: 48000,
        channels: 2,
        parameters: {
          useinbandfec: 1,
          usedtx: 1,
          "sprop-stereo": estereo ? 1 : 0,
          ...(maxaveragebitrate !== undefined ? { maxaveragebitrate } : {}),
        },
        rtcpFeedback: [],
      },
    ],
    headerExtensions: [],
    encodings: [{ ssrc }],
    rtcp: { cname: "teste" },
  }
}

function imagemDe(ssrc: number, maxBitrate?: number): types.RtpParameters {
  return {
    codecs: [{ mimeType: "video/VP8", payloadType: 101, clockRate: 90000, parameters: {}, rtcpFeedback: [] }],
    headerExtensions: [],
    encodings: [{ ssrc, ...(maxBitrate !== undefined ? { maxBitrate } : {}) }],
    rtcp: { cname: "teste" },
  }
}

let contador = 0
const ambito = (): string => `musica-${contador++}`
const eu = (): string => `eu|${expect.getState().currentTestName ?? "solto"}`
const outro = (): string => `outro|${expect.getState().currentTestName ?? "solto"}`

async function emissor(chave: string, dono: string): Promise<string> {
  await motor.entrar(chave, dono)
  return (await motor.criarTransporte(chave, dono, "envio")).id
}

describe("a música", () => {
  it("entra SEM imagem, ao lado do microfone, e quem chega vê-a com a fonte dela", async () => {
    const chave = ambito()
    const transporte = await emissor(chave, eu())
    const voz = await motor.produzir(eu(), transporte, "audio", opusDe(9001), "microfone")
    const musica = await motor.produzir(eu(), transporte, "audio", opusDe(9002, TECTO_DA_MUSICA, true), "musica")
    expect(musica.id).toBeTruthy()
    expect(musica.fonte).toBe("musica")

    const { produtores } = await motor.entrar(chave, outro())
    expect(produtores.map((cada) => [cada.id, cada.fonte])).toEqual([
      [voz.id, "microfone"],
      [musica.id, "musica"],
    ])
  })

  it("tem o orçamento do som do ecrã: aceita no tecto, recusa acima, e a frase diz «a música»", async () => {
    expect(ORCAMENTO_DA_MUSICA).toBe(ORCAMENTO_DO_SOM_DO_ECRA)
    const chave = ambito()
    const transporte = await emissor(chave, eu())
    const recusa = await motor
      .produzir(eu(), transporte, "audio", opusDe(9010, ORCAMENTO_DA_MUSICA + 1000, true), "musica")
      .catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("acima-do-orcamento")
    expect((recusa as RecusaDeMedia).message).toContain("a música")
    await expect(
      motor.produzir(eu(), transporte, "audio", opusDe(9011, ORCAMENTO_DA_MUSICA, true), "musica"),
    ).resolves.toBeDefined()
  })

  it("o orçamento da música não passa para o microfone", async () => {
    const chave = ambito()
    const transporte = await emissor(chave, eu())
    const recusa = await motor
      .produzir(eu(), transporte, "audio", opusDe(9015, ORCAMENTO_DA_MUSICA), "microfone")
      .catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("acima-do-orcamento")
  })

  it("uma por pessoa: a segunda música da mesma ligação é recusada", async () => {
    const chave = ambito()
    const transporte = await emissor(chave, eu())
    await motor.produzir(eu(), transporte, "audio", opusDe(9020), "musica")
    const recusa = await motor.produzir(eu(), transporte, "audio", opusDe(9021), "musica").catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("fonte-repetida")
    expect((recusa as RecusaDeMedia).message).toContain("a música")
  })

  it("duas pessoas podem tocar ao mesmo tempo: é por pessoa, não por chamada", async () => {
    const chave = ambito()
    const [a, b] = [eu(), outro()]
    const ta = await emissor(chave, a)
    const tb = await emissor(chave, b)
    await motor.produzir(a, ta, "audio", opusDe(9030), "musica")
    await expect(motor.produzir(b, tb, "audio", opusDe(9031), "musica")).resolves.toBeDefined()
  })

  it("recusa um vídeo com o nome da música", async () => {
    const chave = ambito()
    const transporte = await emissor(chave, eu())
    const recusa = await motor.produzir(eu(), transporte, "video", imagemDe(9040), "musica").catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("fonte-incoerente")
  })

  it("convive com o ecrã e o som do ecrã, e não ocupa o lugar do ecrã de ninguém", async () => {
    const chave = ambito()
    const [a, b] = [eu(), outro()]
    const ta = await emissor(chave, a)
    const tb = await emissor(chave, b)
    // A plays music; B shares screen with sound. The cap of one screen per call
    // counts images, and music is not one.
    await motor.produzir(a, ta, "audio", opusDe(9050, TECTO_DA_MUSICA, true), "musica")
    await motor.produzir(b, tb, "video", imagemDe(9051, TECTO_DO_ECRA - TECTO_DO_SOM_DO_ECRA), "ecra")
    await expect(motor.produzir(b, tb, "audio", opusDe(9052, TECTO_DO_SOM_DO_ECRA, true), "ecra")).resolves.toBeDefined()
  })

  it("fechar a imagem do ecrã leva o som do ecrã e deixa a música", async () => {
    const chave = ambito()
    const transporte = await emissor(chave, eu())
    const musica = await motor.produzir(eu(), transporte, "audio", opusDe(9060), "musica")
    const imagem = await motor.produzir(eu(), transporte, "video", imagemDe(9061, TECTO_DO_ECRA - TECTO_DO_SOM_DO_ECRA), "ecra")
    const som = await motor.produzir(eu(), transporte, "audio", opusDe(9062, TECTO_DO_SOM_DO_ECRA), "ecra")

    expect((await motor.fecharProdutor(eu(), imagem.id)).fechados).toEqual([som.id, imagem.id])
    const { produtores } = await motor.entrar(chave, outro())
    expect(produtores.map((cada) => cada.id)).toEqual([musica.id])
  })

  it("«Parar» fecha só a música, e a pessoa pode voltar a tocar", async () => {
    const chave = ambito()
    const transporte = await emissor(chave, eu())
    const voz = await motor.produzir(eu(), transporte, "audio", opusDe(9070), "microfone")
    const musica = await motor.produzir(eu(), transporte, "audio", opusDe(9071), "musica")

    expect((await motor.fecharProdutor(eu(), musica.id)).fechados).toEqual([musica.id])
    const { produtores } = await motor.entrar(chave, outro())
    expect(produtores.map((cada) => cada.id)).toEqual([voz.id])
    await expect(motor.produzir(eu(), transporte, "audio", opusDe(9072), "musica")).resolves.toBeDefined()
  })
})

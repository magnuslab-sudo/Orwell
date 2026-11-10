import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { OPCOES_DA_MUSICA, OPCOES_DE_CODEC, OPCOES_DO_SOM_DO_ECRA } from "@enclave/client-core"
import * as ortc from "mediasoup-client/ortc"
import { RemoteSdp } from "mediasoup-client/handlers/sdp/RemoteSdp"
import type { RtpCapabilities } from "mediasoup-client/types"
import * as sdpTransform from "sdp-transform"
import { MotorDeMedia } from "./media.js"

/**
 * Constant bitrate in voice via SFU (3/11/2026), from the router to the fmtp
 * the browser reads.
 *
 * `mediasoup-client` does not have `opusCbr` in `codecOptions`. What gets
 * `cbr=1` to the Chrome encoder is the answer the client builds for its own
 * send transport: it starts from the Opus parameters of the ROUTER
 * (`getSendingRemoteRtpParameters`, `RemoteAnswerMediaSection`) and only then
 * do `codecOptions` touch it. That answer is what Chrome applies as the remote
 * description, and it is through the fmtp of the remote description that it
 * configures the encoder.
 *
 * This test runs the same path as `mediasoup-client` (the `ortc` and the real
 * `RemoteSdp`) over the capabilities of a real router. An update to
 * `mediasoup-client` that stops copying the router parameters, or someone who
 * fixes the codec object, breaks this here and not silently on the network.
 */

let motor: MotorDeMedia

beforeAll(async () => {
  motor = await MotorDeMedia.arrancar({ porto: 0, anunciarIp: "", escutarEm: "127.0.0.1" })
})

afterAll(async () => {
  await motor?.fechar()
})

/** What a Chromium announces for Opus in its send offer. */
const OFERTA_DO_CHROME = [
  "v=0",
  "o=- 1 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=mid:0",
  "a=sendonly",
  "a=rtpmap:111 opus/48000/2",
  "a=rtcp-fb:111 transport-cc",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=ssrc:1111 cname:ana",
  "",
].join("\r\n")

const LOCAL: RtpCapabilities = {
  codecs: [
    {
      kind: "audio",
      mimeType: "audio/opus",
      preferredPayloadType: 111,
      clockRate: 48000,
      channels: 2,
      parameters: { minptime: 10, useinbandfec: 1 },
      rtcpFeedback: [{ type: "transport-cc" }],
    },
  ],
  headerExtensions: [],
}

let ambitos = 0

async function fmtpDaResposta(codecOptions: Record<string, unknown>): Promise<Record<string, string | number>> {
  const { rtpCapabilities } = await motor.entrar(`cbr-${ambitos++}`, `ana-${ambitos}@exemplo.pt`)
  const estendidas = ortc.getExtendedRtpCapabilities(LOCAL, rtpCapabilities as RtpCapabilities, false)
  const oferta = ortc.getSendingRtpParameters("audio", estendidas)
  const resposta = ortc.getSendingRemoteRtpParameters("audio", estendidas)
  const remota = new RemoteSdp({
    iceParameters: { usernameFragment: "u", password: "p", iceLite: true },
    iceCandidates: [],
    dtlsParameters: { role: "auto", fingerprints: [{ algorithm: "sha-256", value: "00".repeat(32).match(/../g)!.join(":") }] },
  })
  remota.send({
    offerMediaObject: sdpTransform.parse(OFERTA_DO_CHROME).media[0]!,
    offerRtpParameters: oferta,
    answerRtpParameters: resposta,
    codecOptions,
  })
  const audio = sdpTransform.parse(remota.getSdp()).media.find((m) => m.type === "audio")!
  const payload = audio.rtp.find((r) => r.codec.toLowerCase() === "opus")!.payload
  const config = audio.fmtp.find((f) => f.payload === payload)?.config ?? ""
  return sdpTransform.parseParams(config)
}

describe("débito constante por SFU: o cbr=1 do router chega ao fmtp que o Chrome lê", () => {
  it("a voz: cbr=1 com DTX, mono e 32 kbps", async () => {
    const fmtp = await fmtpDaResposta(OPCOES_DE_CODEC)
    expect(fmtp).toMatchObject({ cbr: 1, usedtx: 1, stereo: 0, maxaveragebitrate: 32000, useinbandfec: 1 })
  })

  it("o som do ecrã e a música também (o router tem um Opus só)", async () => {
    expect(await fmtpDaResposta(OPCOES_DO_SOM_DO_ECRA)).toMatchObject({ cbr: 1, usedtx: 1, stereo: 1 })
    expect(await fmtpDaResposta(OPCOES_DA_MUSICA)).toMatchObject({ cbr: 1, usedtx: 1, stereo: 1 })
  })
})

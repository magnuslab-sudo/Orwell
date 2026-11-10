import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { types } from "mediasoup"
import { PESSOAS_COM_ECRA, TECTO_DA_CAMARA, TECTO_DO_ECRA, TECTO_DO_SOM_DO_ECRA } from "@enclave/protocol"
import {
  AMBITOS_POR_LIGACAO,
  CAMARAS_POR_AMBITO,
  MotorDeMedia,
  ORCAMENTO_DE_CODEC,
  ORCAMENTO_DO_SOM_DO_ECRA,
  PARTICIPANTES_POR_AMBITO,
  PRODUTORES_POR_TRANSPORTE,
  RecusaDeMedia,
  BANDA_DE_ENTRADA_POR_TRANSPORTE,
} from "./media.js"

/**
 * The media engine, tested against a real mediasoup worker.
 *
 * **There are no mocks here, on purpose.** A mock of mediasoup would prove only that
 * our code calls the methods we invented for it, the kind of test that passes on a false premise
 * and has already cost three deleted tests in this repository in one night. What matters is whether mediasoup's
 * `produce` accepts what we give it, whether `canConsume` says no to a
 * producer from another router, and whether the `announcedAddress` actually reaches the
 * ICE candidates. None of that can be faked.
 *
 * The cost is one subprocess per suite, closed in `afterAll`. If it does not close,
 * workers stay hung until the machine refuses: the
 * `close` in `app.ts` had to learn the same lesson.
 *
 * `porto: 0` lets the system choose. A fixed number here would be the trap
 * that `bindPort: 0` of `gateway.test.ts` already documents: a server left
 * sleeping on that port breaks the entire suite with EADDRINUSE, and what you see in
 * the end is "engine problem" with tests that never ran.
 */

let motor: MotorDeMedia

beforeAll(async () => {
  motor = await MotorDeMedia.arrancar({ porto: 0, anunciarIp: "", escutarEm: "127.0.0.1" })
})

afterAll(async () => {
  await motor?.fechar()
})

/**
 * RTP parameters of a voice stream, as a client would send them.
 *
 * Written by hand because there is no browser in this suite. mediasoup validates them
 * against the router's capabilities (that validation is what a passing
 * `produce` exercises), and `payloadType` does not have to match the router's:
 * the mapping is its job.
 */
function vozDe(ssrc: number, maxaveragebitrate?: number): types.RtpParameters {
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
          "sprop-stereo": 0,
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

/**
 * RTP parameters of a video stream, as `mediasoup-client` would send them.
 *
 * Video declares bitrate in a different place than audio, and that is why this helper exists
 * instead of a parameter in `vozDe`: Opus says it inside the codec parameters
 * (`maxaveragebitrate`) and VP8 has nowhere to say it: the ENCODING says it,
 * `encodings[].maxBitrate`. Reading only one of the two left video without any
 * bitrate check, which is exactly the stream that weighs thirty times more.
 */
function ecraDe(ssrc: number, maxBitrate?: number): types.RtpParameters {
  return {
    codecs: [{ mimeType: "video/VP8", payloadType: 101, clockRate: 90000, parameters: {}, rtcpFeedback: [] }],
    headerExtensions: [],
    encodings: [{ ssrc, ...(maxBitrate !== undefined ? { maxBitrate } : {}) }],
    rtcp: { cname: "teste" },
  }
}

/**
 * A new scope and owner per test.
 *
 * Owners too, not just scopes: with a shared `eu()`, the fifth test using it hits
 * `AMBITOS_POR_LIGACAO` and fails for a reason that has nothing to do with what it
 * measures. It happened while writing this suite (eleven tests failing with "this
 * connection is already in 4 calls"), and the lesson is the usual one: a test that
 * shares state measures the neighbor.
 */
let contador = 0
const ambito = (): string => `ambito-${contador++}`

/**
 * Two owners, unique per test, without each test having to invent them.
 *
 * The name of the current test is what separates them. It is free and does not get
 * forgotten: a manual counter gets forgotten, and the symptom is the next test
 * failing for a reason that is not its own.
 */
const eu = (): string => `eu|${expect.getState().currentTestName ?? "solto"}`
const outro = (): string => `outro|${expect.getState().currentTestName ?? "solto"}`

/** A free port, requested from the system and returned. See the single-port test. */
async function portoLivre(): Promise<number> {
  const { createSocket } = await import("node:dgram")
  const socket = createSocket("udp4")
  await new Promise<void>((pronto) => socket.bind(0, "127.0.0.1", pronto))
  const porto = socket.address().port
  await new Promise<void>((pronto) => socket.close(() => pronto()))
  return porto
}

describe("o motor levanta-se", () => {
  it("diz que está de pé, e diz o pid do worker", () => {
    expect(motor.estaDePe()).toBe(true)
    expect(motor.pid).toBeGreaterThan(0)
  })

  /**
   * Item 4 from the list of what Phase 0 left unproven.
   *
   * The Phase 0 proof runs entirely on `127.0.0.1`, where `announcedAddress` is not
   * needed, so its behavior remained an educated guess. Here we measure the MECHANISM:
   * the announced address replaces the listen address in ICE candidates, which is
   * the entire line Docker depends on.
   *
   * **What this still does NOT prove**, stated so no one reads too much into it: that
   * a client from outside crosses Docker's NAT and connects. That requires a
   * container with a bridge and a client on the outside, and remains unmeasured
   * (see `PENDENTES.md`). What stopped being a guess is that the field works and
   * where it comes out.
   */
  it("anuncia o endereço configurado nos candidatos ICE, e não o de escuta", async () => {
    const aparte = await MotorDeMedia.arrancar({ porto: 0, anunciarIp: "203.0.113.7", escutarEm: "127.0.0.1" })
    try {
      const chave = ambito()
      await aparte.entrar(chave, eu())
      const transporte = await aparte.criarTransporte(chave, eu(), "envio")
      expect(transporte.iceCandidates.length).toBeGreaterThan(0)
      for (const candidato of transporte.iceCandidates) {
        expect(candidato.address).toBe("203.0.113.7")
      }
    } finally {
      await aparte.fechar()
    }
  })

  /**
   * Listening on all interfaces without declaring what to announce is a silent call.
   *
   * **It is the same bug that took a day to diagnose in Firefox, and here it is
   * worse because it hits all engines.** With `escutarEm: "0.0.0.0"` and without
   * `anunciarIp`, mediasoup puts `0.0.0.0` in the ICE candidates, an address
   * where no client knows how to send. And it fails in the worst way there is: the
   * server starts, the `hello.ok` announces the `sfu` capability, all clients
   * pick the SFU, the transports are created, the ICE goes to `failed`, and what the
   * user sees is a call set up with everyone silent. Nothing at startup says so.
   *
   * This is exactly the Docker configuration (`bindHost` different from
   * `127.0.0.1`) with `ENCLAVE_SFU_ANNOUNCED_IP` forgotten. The plan says that
   * this address is required; until now nothing enforced it.
   *
   * Refusing to start is the right answer, not overzealousness: whoever catches this exception in the
   * `app.ts` already writes the reason and leaves the calls in mesh, without announcing the
   * capability. A mesh call is a call; a call through an SFU that
   * no one can reach is nothing.
   */
  it("recusa arrancar a escutar em 0.0.0.0 sem endereço a anunciar", async () => {
    await expect(MotorDeMedia.arrancar({ porto: 0, anunciarIp: "", escutarEm: "0.0.0.0" })).rejects.toThrow(
      /ENCLAVE_SFU_ANNOUNCED_IP/,
    )
  })

  /**
   * And it starts when told what to announce, which is the other half of the guard.
   *
   * Without this, the guard above would pass with an unconditional `throw` on `0.0.0.0`,
   * and Docker, which is exactly who listens on `0.0.0.0`, would have no SFU
   * at all.
   */
  it("arranca em 0.0.0.0 quando o endereço a anunciar está posto", async () => {
    const aparte = await MotorDeMedia.arrancar({ porto: 0, anunciarIp: "203.0.113.7", escutarEm: "0.0.0.0" })
    try {
      const chave = ambito()
      await aparte.entrar(chave, eu())
      const transporte = await aparte.criarTransporte(chave, eu(), "envio")
      for (const candidato of transporte.iceCandidates) {
        expect(candidato.address).toBe("203.0.113.7")
      }
    } finally {
      await aparte.fechar()
    }
  })

  /**
   * One port only, UDP and TCP with the same number.
   *
   * This is what makes UFW two rules instead of a range of ten thousand, and what
   * compose maps. The TCP is the fallback for networks that block UDP, and because
   * it exists, coturn is no longer needed to cross NAT.
   *
   * **The port must be explicit, and this test showed it.** With
   * `porto: 0` mediasoup picks a free number for EACH `listenInfo`, and
   * the two come out different: UDP on one, TCP on another. The property "one port only"
   * belongs to the configuration, not to the `WebRtcServer`. In production the
   * `ENCLAVE_SFU_PORT` is explicit and the property holds; an operator who left it
   * at zero would open two ports without knowing, and UFW would know only one.
   */
  it("serve UDP e TCP no mesmo porto, quando o porto é explícito", async () => {
    const porto = await portoLivre()
    const aparte = await MotorDeMedia.arrancar({ porto, anunciarIp: "", escutarEm: "127.0.0.1" })
    try {
      const chave = ambito()
      await aparte.entrar(chave, eu())
      const transporte = await aparte.criarTransporte(chave, eu(), "envio")
      const protocolos = new Set(transporte.iceCandidates.map((candidato) => candidato.protocol))
      const portos = new Set(transporte.iceCandidates.map((candidato) => candidato.port))
      expect(protocolos).toEqual(new Set(["udp", "tcp"]))
      expect(portos).toEqual(new Set([porto]))
    } finally {
      await aparte.fechar()
    }
  })

  /**
   * The two bandwidth-saving measures, read from the router and not from what was written.
   *
   * Without `usedtx=1` Opus sends encoded silence all the time, close to seventy
   * percent more traffic in a conversation, and on a machine shared with magnuslab.pt
   * that is bandwidth taken from the site. This test exists because the way to lose them
   * is someone "tidying up" the codec object, and nothing else in this suite would
   * notice.
   */
  it("anuncia Opus com DTX, mono e 32 kbps", async () => {
    const chave = ambito()
    const { rtpCapabilities } = await motor.entrar(chave, eu())
    const opus = rtpCapabilities.codecs?.find((codec) => codec.mimeType.toLowerCase() === "audio/opus")
    expect(opus).toBeDefined()
    expect(opus?.parameters).toMatchObject({ usedtx: 1, "sprop-stereo": 0, maxaveragebitrate: 32000 })
  })

  /**
   * Constant bitrate (3/11/2026). mediasoup-client does not have `opusCbr` in
   * `codecOptions`: the `cbr=1` reaches the browser's encoder because the answer
   * the client builds for its send transport starts from the router's Opus parameters
   * (`RemoteAnswerMediaSection`), and Chrome configures the encoder from the fmtp
   * in the remote description. Without this here, each voice packet goes back to having
   * the size of the sound, and no one would notice in this suite.
   */
  it("anuncia Opus em débito constante, sem largar o DTX", async () => {
    const chave = ambito()
    const { rtpCapabilities } = await motor.entrar(chave, eu())
    const opus = rtpCapabilities.codecs?.filter((codec) => codec.mimeType.toLowerCase() === "audio/opus") ?? []
    expect(opus).toHaveLength(1)
    expect(opus[0]?.parameters).toMatchObject({ cbr: 1, usedtx: 1 })
  })

  /**
   * Video arrived in Phase 3, and arrived with one codec only.
   *
   * This used to be "do not negotiate any video" while refusing video WAS the cap
   * working. What changed was not the machine: it was the numbers, which are now written down
   * and enforced at producer admission. What this test now guards is the other half:
   * that the router announces VP8 and nothing else.
   *
   * **The reason written here became obsolete twice, and the one that remains is harder
   * than both.** It used to say "an H.264 here would serve a Safari that has no
   * insertable streams and therefore would have no media encryption". Safari got media encryption
   * on August 18 (the `RTCRtpScriptTransform` in a worker, measured on all three engines),
   * so that reason fell. What replaces it is not about cleanup or negotiation: it is about
   * FORMAT PHYSICS, and it applies to all engines.
   *
   * **Full-frame encryption does not survive H.264's packetizer.** Measured on August 18
   * with `scripts/sfu-script-transform-por-motor.mjs`, with the codec forced and the same
   * frame passing through the same cipher:
   *
   * | engine | codec | encrypted | open | packets | images |
   * |---|---|---|---|---|---|
   * | WebKit | VP8 | 86 | 90 | 107 | 86 |
   * | WebKit | H.264 | 85 | 0 | **1** | 0 |
   * | Chromium | VP8 | 90 | 97 | 112 | 89 |
   * | Chromium | H.264 | 90 | 0 | **15** | 0 |
   *
   * H.264 (RFC 6184) splits a frame into packets by SCANNING the bitstream for NALU
   * start codes. Encrypted, there are none: the packetizer cannot split the frame and
   * out comes one packet. VP8 (RFC 7741) puts its own descriptor in front, written from
   * what the encoder said, and treats the payload as opaque: it splits it by size and
   * nothing else. That is why the same cipher passes on one and collapses on the other.
   *
   * **So this is not preference: it is what keeps encrypted video alive.** Adding
   * H.264 to this list (for hardware, for battery, to serve Safari better) erases video
   * for everyone, on all engines, and erases it silently: frames keep being encrypted
   * and counted, and what does not come out is off the wire. Anyone who really wants it
   * must first leave the codec header in the clear (another wire format, and content bytes
   * visible to the SFU), and that is a decision you do not make by adding a line to an
   * array.
   */
  it("negoceia VP8, e só VP8 — o H.264 apagaria o vídeo cifrado em todos os motores", async () => {
    const chave = ambito()
    const { rtpCapabilities } = await motor.entrar(chave, eu())
    const video = rtpCapabilities.codecs?.filter((codec) => codec.kind === "video") ?? []
    // mediasoup adds RTX (retransmission) codecs on top of the ones declared, and they
    // are not image codecs: counting them here would give a test that would fail on its
    // own the day the library changed strategy.
    const imagem = video.filter((codec) => !codec.mimeType.toLowerCase().endsWith("/rtx"))
    expect(imagem.map((codec) => codec.mimeType.toLowerCase())).toEqual(["video/vp8"])
  })

  /**
   * And the same guard driven by the MECHANISM, not the list.
   *
   * The test above fixes the exact list, and that is what we want today. This one says
   * WHY, in a way that survives someone adding VP9 or AV1, which are legitimate because
   * they also treat the payload as opaque, and still catches H.264 and H.265, which are
   * not. Without it, the day the list changes for a good reason sweeps away the test above
   * and the guard goes with it.
   */
  it("não anuncia codec nenhum cujo empacotador precise de LER o bitstream", async () => {
    const chave = ambito()
    const { rtpCapabilities } = await motor.entrar(chave, eu())
    /*
     * The ones that scan the bitstream to packetize, and so cannot carry a frame
     * encrypted in full. Measured, not assumed: see the table above and
     * `scripts/sfu-script-transform-por-motor.mjs`.
     */
    const QUE_LEEM_O_BITSTREAM = ["video/h264", "video/h265"]
    const anunciados = (rtpCapabilities.codecs ?? []).map((codec) => codec.mimeType.toLowerCase())
    expect(anunciados.filter((mime) => QUE_LEEM_O_BITSTREAM.includes(mime))).toEqual([])
  })
})

describe("o âmbito", () => {
  /**
   * The rule that sets this design apart from the obvious, and the bug it prevents.
   *
   * "Destroy the router when the last transport leaves" is the natural rule and
   * it is wrong: between `entrar` and the first `criarTransporte` there is a scope with
   * one member and ZERO transports. With the last-transport rule, the router
   * would close under the first person to arrive, and only the first, which gives
   * a bug that disappears when two people test at the same time.
   */
  it("sobrevive entre entrar e criar o primeiro transporte", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    expect(motor.ambitosAbertos).toBeGreaterThan(0)
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    expect(transporte.id).toBeTruthy()
  })

  it("fecha o router quando sai o último membro", async () => {
    const chave = ambito()
    const antes = motor.ambitosAbertos
    await motor.entrar(chave, eu())
    await motor.entrar(chave, outro())
    await motor.criarTransporte(chave, eu(), "envio")
    expect(motor.ambitosAbertos).toBe(antes + 1)

    await motor.sairDoAmbito(eu(), chave)
    expect(motor.ambitosAbertos).toBe(antes + 1)

    await motor.sairDoAmbito(outro(), chave)
    expect(motor.ambitosAbertos).toBe(antes)
  })

  it("larga os transportes de quem sai", async () => {
    const chave = ambito()
    const antes = motor.transportesAbertos
    await motor.entrar(chave, eu())
    await motor.criarTransporte(chave, eu(), "envio")
    await motor.criarTransporte(chave, eu(), "recepcao")
    expect(motor.transportesAbertos).toBe(antes + 2)
    await motor.sairDoAmbito(eu(), chave)
    expect(motor.transportesAbertos).toBe(antes)
  })

  /**
   * And it refuses WITHOUT leaving a trace.
   *
   * The count of open scopes is half the test, and it is the half that matters: the
   * earlier version of this function fetched the scope from the map that CREATES it, and
   * only then did it find out that the requester had not entered. The router ended up
   * with zero members, and a zero-member scope is never closed, because the one who
   * would close it is the last member leaving. One router per refused frame, at socket
   * speed.
   */
  it("recusa quem não entrou, e não deixa router nenhum para trás", async () => {
    const chave = ambito()
    const antes = motor.ambitosAbertos
    await expect(motor.criarTransporte(chave, "estranho", "envio")).rejects.toThrow(/não entrou/)
    expect(motor.ambitosAbertos).toBe(antes)
  })
})

describe("os tectos", () => {
  it(`deixa entrar ${PARTICIPANTES_POR_AMBITO} e recusa o seguinte com a razão física`, async () => {
    const chave = ambito()
    for (let i = 0; i < PARTICIPANTES_POR_AMBITO; i++) await motor.entrar(chave, `pessoa-${i}`)

    const recusa = await motor.entrar(chave, "a-mais").catch((erro: unknown) => erro)
    expect(recusa).toBeInstanceOf(RecusaDeMedia)
    expect((recusa as RecusaDeMedia).codigo).toBe("chamada-cheia")
    // The message must state the PHYSICS, not "limit reached": that is what separates
    // a refusal that makes sense from one that tells you to try again forever.
    expect((recusa as RecusaDeMedia).message).toContain(String(PARTICIPANTES_POR_AMBITO))
  })

  it("cabem 50 pessoas numa chamada, e a 51.ª é recusada", async () => {
    /*
     * The number written, not read from the constant: a test that reads
     * `PARTICIPANTES_POR_AMBITO` passes with whatever number is there, and what we
     * want kept is the 50 that the load test measured
     * (`docs/planos/limites-media-relatorio.md`). It was 16 until 3/11/2026.
     */
    const chave = ambito()
    for (let i = 0; i < 50; i++) await motor.entrar(chave, `${eu()}-${i}`)
    const recusa = await motor.entrar(chave, `${eu()}-51`).catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("chamada-cheia")
    expect((recusa as RecusaDeMedia).message).toContain("50 pessoas")
  })

  it("deixa reentrar quem já lá está, mesmo com a sala cheia", async () => {
    const chave = ambito()
    for (let i = 0; i < PARTICIPANTES_POR_AMBITO; i++) await motor.entrar(chave, `pessoa-${i}`)
    // A repeated `entrar` is what happens to someone who reloads the page. Refusing it
    // would lock the person out of their own call until someone leaves.
    await expect(motor.entrar(chave, "pessoa-0")).resolves.toBeDefined()
  })

  it(`recusa a ${AMBITOS_POR_LIGACAO + 1}ª chamada da mesma ligação`, async () => {
    const chaves = Array.from({ length: AMBITOS_POR_LIGACAO + 1 }, () => ambito())
    for (const chave of chaves.slice(0, AMBITOS_POR_LIGACAO)) await motor.entrar(chave, "ocupado")
    const recusa = await motor.entrar(chaves[AMBITOS_POR_LIGACAO] as string, "ocupado").catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("demasiados-ambitos")
  })

  it("recusa um segundo transporte do mesmo sentido", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    await motor.criarTransporte(chave, eu(), "envio")
    const recusa = await motor.criarTransporte(chave, eu(), "envio").catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("transporte-repetido")
    // And the one in the other direction keeps passing: they are two, not one.
    await expect(motor.criarTransporte(chave, eu(), "recepcao")).resolves.toBeDefined()
  })

  /**
   * The bandwidth cap, read from where it came to exist: inside the worker.
   *
   * Of all the caps in this file, this is the ONLY one that survives a client that
   * lies. The codec `maxaveragebitrate` and budget verification catch wrong config
   * and honest clients; against someone declaring 32 and sending 200, only this and
   * the participant cap say no.
   *
   * And until now no one had seen it applied, Phase 1 wrote the line and moved on.
   * A test that just checked the call does not break would pass with it deleted:
   * `setMaxIncomingBitrate` is async and returns `void`, and a resolved promise proves
   * nothing. So the number is read from `getStats()`, which comes from the other side
   * of the subprocess, from the C++ that routes the packets, not from a variable of
   * ours saying yes.
   *
   * **What this does NOT prove, and is said so no one confuses it:** that the cap
   * BITES. Biting is the worker sending REMB/TWCC to a real sender and the sender
   * lowering the rate, and that is not measured without a browser on the other side
   * trying to send too much. It is proven that the cap is applied to the right transport,
   * with the right number, on the server side. See `PENDENTES.md`.
   */
  it("aplica o tecto de banda no transporte de envio, e o worker confirma-o", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")

    const stats = await motor.estatisticasDoTransporte(transporte.id)
    expect(stats).not.toHaveLength(0)
    expect(stats[0]?.maxIncomingBitrate).toBe(BANDA_DE_ENTRADA_POR_TRANSPORTE)
  })

  it("e não o põe no de recepção, que não tem nada que limitar", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "recepcao")

    // What comes out here is decided by us: putting a cap on INCOMING would limit a path
    // where nothing comes in, and give the appearance of protection that is not where it
    // is needed.
    const stats = await motor.estatisticasDoTransporte(transporte.id)
    expect(stats[0]?.maxIncomingBitrate).toBeUndefined()
  })

  it("o tecto não depende de o cliente declarar nada", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")

    // A producer with no `maxaveragebitrate` at all passes the budget check on purpose: refusing
    // its absence would break honest clients without catching anyone. What holds it back is
    // the transport cap, which was already there before it produced.
    await motor.produzir(eu(), transporte.id, "audio", vozDe(9001))
    const stats = await motor.estatisticasDoTransporte(transporte.id)
    expect(stats[0]?.maxIncomingBitrate).toBe(BANDA_DE_ENTRADA_POR_TRANSPORTE)
  })
})

describe("produzir", () => {
  it("aceita voz num transporte de envio", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    const produzido = await motor.produzir(eu(), transporte.id, "audio", vozDe(1111))
    expect(produzido.id).toBeTruthy()
    expect(produzido.ambito).toBe(chave)
  })

  it("aceita vídeo, que era o que faltava para a partilha de ecrã existir", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    const produzido = await motor.produzir(eu(), transporte.id, "video", ecraDe(2222), "ecra")
    expect(produzido.id).toBeTruthy()
    expect(produzido.fonte).toBe("ecra")
  })

  it("recusa produzir num transporte de recepção", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "recepcao")
    const recusa = await motor.produzir(eu(), transporte.id, "audio", vozDe(3333)).catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("sentido-errado")
  })

  it(`leva ${PRODUTORES_POR_TRANSPORTE} fluxos por transporte de envio: o microfone, a câmara, a imagem e o som do ecrã, e a música`, async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    await motor.produzir(eu(), transporte.id, "audio", vozDe(4444), "microfone")
    await motor.produzir(eu(), transporte.id, "video", ecraDe(4445), "camara")
    const terceiro = await motor.produzir(eu(), transporte.id, "video", ecraDe(4446), "ecra")
    const quarto = await motor.produzir(eu(), transporte.id, "audio", vozDe(4449, TECTO_DO_SOM_DO_ECRA), "ecra")
    // Music is the fifth (phase 9): it enters without video, and takes no slot.
    const quinto = await motor.produzir(eu(), transporte.id, "audio", vozDe(4450, TECTO_DO_SOM_DO_ECRA), "musica")
    expect(terceiro.id).toBeTruthy()
    expect(quarto.fonte).toBe("ecra")
    expect(quinto.id).toBeTruthy()
    expect(PRODUTORES_POR_TRANSPORTE).toBe(5)
  })

  it("recusa a segunda câmara da mesma pessoa", async () => {
    // It is not the three-person cap biting, it is the repeated source. A second camera
    // doubles that person's output for everyone and adds nothing you see, and two
    // microphones are the same voice twice, half a second apart.
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    await motor.produzir(eu(), transporte.id, "video", ecraDe(4447), "camara")
    const recusa = await motor.produzir(eu(), transporte.id, "video", ecraDe(4448), "camara").catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("fonte-repetida")
  })

  it("recusa um fluxo que peça mais banda do que o orçamento", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    const recusa = await motor
      .produzir(eu(), transporte.id, "audio", vozDe(5555, ORCAMENTO_DE_CODEC * 2))
      .catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("acima-do-orcamento")
    expect((recusa as RecusaDeMedia).message).toContain("kbps")
  })

  /**
   * The absence of the field is accepted, and it is a decision, not an oversight.
   *
   * A client that declares nothing receives the `maxaveragebitrate=32000` that the
   * router announces, which is the value we wanted. Refusing the absence would break
   * honest clients without catching a single dishonest one: anyone who wants to exceed
   * the cap omits the field rather than declaring it.
   */
  it("aceita um fluxo que não declare banda nenhuma", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    await expect(motor.produzir(eu(), transporte.id, "audio", vozDe(6666))).resolves.toBeDefined()
  })
})

/**
 * The video caps, the ones that say how much LEAVES this server.
 *
 * Voice fits any realistic scenario on this platform: 16 streams of 32 kbps served
 * to 15 people is 7.7 Mbps in the theoretical worst case. Video does not: one screen at
 * 2.5 Mbps served to ten people is 25 Mbps on its own, half the slice that section 7 of
 * the plan gives Orwell on this machine. That is why these caps exist and the
 * microphone has none here.
 */
describe("os tectos do vídeo", () => {
  it("deduz a fonte pelo `kind` quando o cliente não a declara", async () => {
    // It is what a Phase 2 client sends: it only produced audio, and never knew this
    // word. Reading the absence as "camera" on top of a voice track would put the camera
    // cap on a microphone.
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    const produzido = await motor.produzir(eu(), transporte.id, "audio", vozDe(7001))
    expect(produzido.fonte).toBe("microfone")
  })

  it("recusa uma fonte que não bate certo com o `kind`", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    const recusa = await motor.produzir(eu(), transporte.id, "video", ecraDe(7002), "microfone").catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("fonte-incoerente")
  })

  it("aceita dois ecrãs na chamada e recusa o terceiro, com a razão física", async () => {
    // It was one screen per call until 3/11/2026; it has been two since the load test.
    const chave = ambito()
    const pessoas = ["a", "b", "c"].map((letra) => `${eu()}-${letra}`)
    for (const [indice, pessoa] of pessoas.entries()) {
      await motor.entrar(chave, pessoa)
      const transporte = await motor.criarTransporte(chave, pessoa, "envio")
      const feito = await motor.produzir(pessoa, transporte.id, "video", ecraDe(7010 + indice), "ecra").catch((erro: unknown) => erro)
      if (indice < 2) {
        expect((feito as { id: string }).id).toBeTruthy()
      } else {
        expect((feito as RecusaDeMedia).codigo).toBe("ecra-ocupado")
        // The message states the reason, and the reason is physical. Without it, this is a
        // product refusing on a whim.
        expect((feito as RecusaDeMedia).message).toContain("saída")
      }
    }
  })

  it(`recusa a câmara ${CAMARAS_POR_AMBITO + 1} da mesma chamada`, async () => {
    const chave = ambito()
    for (let numero = 0; numero <= CAMARAS_POR_AMBITO; numero++) {
      const pessoa = `${eu()}-${numero}`
      await motor.entrar(chave, pessoa)
      const transporte = await motor.criarTransporte(chave, pessoa, "envio")
      const feito = await motor.produzir(pessoa, transporte.id, "video", ecraDe(7100 + numero), "camara").catch((erro: unknown) => erro)
      if (numero < CAMARAS_POR_AMBITO) expect((feito as { id: string }).id).toBeTruthy()
      else expect((feito as RecusaDeMedia).codigo).toBe("camaras-a-mais")
    }
  })

  it("aceita quatro câmaras na chamada e recusa a quinta", async () => {
    // It was two until 3/11/2026. The number is hardcoded for the same reason as in the 50-person test.
    const chave = ambito()
    for (let numero = 0; numero < 5; numero++) {
      const pessoa = `${eu()}-${numero}`
      await motor.entrar(chave, pessoa)
      const transporte = await motor.criarTransporte(chave, pessoa, "envio")
      const feito = await motor.produzir(pessoa, transporte.id, "video", ecraDe(7150 + numero), "camara").catch((erro: unknown) => erro)
      if (numero < 4) expect((feito as { id: string }).id).toBeTruthy()
      else {
        expect((feito as RecusaDeMedia).codigo).toBe("camaras-a-mais")
        expect((feito as RecusaDeMedia).message).toContain("4 câmaras")
      }
    }
  })

  it("partilha o ecrã com 20 pessoas na chamada, e recusa-o com 21", async () => {
    // It was 11 until 3/11/2026. See `PESSOAS_COM_ECRA` in the protocol.
    const chave = ambito()
    for (let numero = 0; numero < 20; numero++) await motor.entrar(chave, `${eu()}-${numero}`)
    const primeiro = `${eu()}-0`
    const t1 = await motor.criarTransporte(chave, primeiro, "envio")
    const dele = await motor.produzir(primeiro, t1.id, "video", ecraDe(7250), "ecra")
    expect(dele.id).toBeTruthy()
    await motor.fecharProdutor(primeiro, dele.id)

    await motor.entrar(chave, `${eu()}-20`)
    const recusa = await motor.produzir(primeiro, t1.id, "video", ecraDe(7251), "ecra").catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("chamada-grande-de-mais-para-ecra")
    expect((recusa as RecusaDeMedia).message).toContain("acima de 20")
  })

  it(`recusa partilhar o ecrã numa chamada com mais de ${PESSOAS_COM_ECRA} pessoas`, async () => {
    /*
     * The cap that replaces the `LIMITE_DE_PARTILHA = 6` of the mesh, and replaces it
     * with a different physics entirely. There the number was the UPSTREAM of whoever shared:
     * one copy per person, 12.5 Mbps at six. Here whoever shares sends ONE stream
     * and the bottleneck moved to the server output: `2,5 Mbps × espectadores`.
     */
    const chave = ambito()
    for (let numero = 0; numero <= PESSOAS_COM_ECRA; numero++) await motor.entrar(chave, `${eu()}-${numero}`)

    const partilha = `${eu()}-0`
    const transporte = await motor.criarTransporte(chave, partilha, "envio")
    const recusa = await motor.produzir(partilha, transporte.id, "video", ecraDe(7200), "ecra").catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("chamada-grande-de-mais-para-ecra")
    expect((recusa as RecusaDeMedia).message).toContain(`${PESSOAS_COM_ECRA + 1}`)
  })

  it("recusa um ecrã que declare mais banda do que o tecto do ecrã", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    const recusa = await motor
      .produzir(eu(), transporte.id, "video", ecraDe(7300, TECTO_DO_ECRA * 2), "ecra")
      .catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("acima-do-orcamento")
  })

  it("recusa uma câmara com o orçamento do ECRÃ, que é maior", async () => {
    /*
     * The check that proves the budget is PER SOURCE and not a single number.
     * With a global cap, this would pass: 2.5 Mbps is below the screen cap.
     * One camera at 2.5 Mbps served to ten people is 25 Mbps from one person,
     * and four of them are this machine's entire budget.
     */
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    const recusa = await motor
      .produzir(eu(), transporte.id, "video", ecraDe(7301, TECTO_DO_ECRA), "camara")
      .catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("acima-do-orcamento")
    expect((recusa as RecusaDeMedia).message).toContain("câmara")
  })

  it("deixa a câmara passar com o tecto dela", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    await expect(
      motor.produzir(eu(), transporte.id, "video", ecraDe(7302, TECTO_DA_CAMARA), "camara"),
    ).resolves.toBeDefined()
  })
})

/**
 * Stop sharing without leaving the call.
 *
 * The case that `sfu.scope.leave` does not cover and that Phase 1 did not have: the call
 * stays open, the transport stays open, the microphone stays on, and one of
 * three producers dies.
 */
describe("fechar um produtor", () => {
  it("tira o fluxo da chamada e deixa o transporte de pé", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    await motor.produzir(eu(), transporte.id, "audio", vozDe(8001), "microfone")
    const ecra = await motor.produzir(eu(), transporte.id, "video", ecraDe(8002), "ecra")

    expect(await motor.fecharProdutor(eu(), ecra.id)).toEqual({ ambito: chave, fechados: [ecra.id] })

    // Proof that the stream actually left the call, not just from a map of ours:
    // anyone joining now must not be told about it. Without this, the new client
    // would wait for media that never arrives.
    const { produtores } = await motor.entrar(chave, outro())
    expect(produtores.map((cada) => cada.id)).not.toContain(ecra.id)
    expect(produtores).toHaveLength(1)

    // And the transport keeps serving: the microphone did not die with the screen, and
    // can share again without setting up the call again.
    await expect(motor.produzir(eu(), transporte.id, "video", ecraDe(8003), "ecra")).resolves.toBeDefined()
  })

  it("recusa fechar um fluxo de outra pessoa", async () => {
    // The second lock, same as `#meuTransporte`: a producer ID picked up elsewhere
    // would silence another person's screen.
    const chave = ambito()
    await motor.entrar(chave, eu())
    await motor.entrar(chave, outro())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    const meu = await motor.produzir(eu(), transporte.id, "video", ecraDe(8010), "ecra")

    const recusa = await motor.fecharProdutor(outro(), meu.id).catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("produtor-desconhecido")

    // And the stream stays alive, which is the half that matters: a refusal that
    // closed it would be worse than not refusing at all.
    const { produtores } = await motor.entrar(chave, `${outro()}-terceiro`)
    expect(produtores.map((cada) => cada.id)).toContain(meu.id)
  })

  it("liberta o lugar do ecrã para outra pessoa partilhar", async () => {
    // Two slots since 3/11/2026: with both full, the third waits.
    const chave = ambito()
    const primeiro = `${eu()}-1`
    const segundo = `${eu()}-2`
    const terceiro = `${eu()}-3`
    for (const pessoa of [primeiro, segundo, terceiro]) await motor.entrar(chave, pessoa)

    const t1 = await motor.criarTransporte(chave, primeiro, "envio")
    const t2 = await motor.criarTransporte(chave, segundo, "envio")
    const t3 = await motor.criarTransporte(chave, terceiro, "envio")
    const dele = await motor.produzir(primeiro, t1.id, "video", ecraDe(8020), "ecra")
    await motor.produzir(segundo, t2.id, "video", ecraDe(8023), "ecra")
    await expect(motor.produzir(terceiro, t3.id, "video", ecraDe(8021), "ecra")).rejects.toBeInstanceOf(RecusaDeMedia)

    await motor.fecharProdutor(primeiro, dele.id)
    await expect(motor.produzir(terceiro, t3.id, "video", ecraDe(8022), "ecra")).resolves.toBeDefined()
  })
})

describe("consumir, e a separação entre chamadas", () => {
  it("ouve um produtor do mesmo âmbito, e nasce em pausa", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    await motor.entrar(chave, outro())
    const envio = await motor.criarTransporte(chave, eu(), "envio")
    const { id: produtor } = await motor.produzir(eu(), envio.id, "audio", vozDe(7777))

    const recepcao = await motor.criarTransporte(chave, outro(), "recepcao")
    const { rtpCapabilities } = await motor.entrar(chave, outro())
    const consumido = await motor.consumir(outro(), recepcao.id, produtor, rtpCapabilities)

    expect(consumido.produtor).toBe(produtor)
    expect(consumido.kind).toBe("audio")
    // **A pause that is measured, not assumed.** It prevents the decoder from
    // receiving ciphertext in the gap between `consume` and cipher installation.
    // See point 5 of what Phase 0 asked us to assume.
    expect(consumido.pausado).toBe(true)
    // And resuming has to work, which is what the client does next.
    await expect(motor.retomar(outro(), recepcao.id, consumido.id)).resolves.toBeUndefined()
  })

  /**
   * And pause again, which is what a screen's "Stop viewing" now does.
   *
   * **Without this method, stopping viewing would not save any bandwidth.** The client
   * closed the consumer on its side and the worker kept routing the
   * image to a transport that no longer reads it, and each cycle of viewing and stopping
   * left a consumer behind, at 2.5 Mbps outbound, charged to an authenticated member.
   * See `sfu.pause`, in the protocol.
   *
   * Pause and do not close: the object stays, with decryption already installed on the
   * client side, and the next "View" is a `retomar` instead of a new `consumir`.
   */
  it("e pausa-se outra vez, sem perder o consumidor", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    await motor.entrar(chave, outro())
    const envio = await motor.criarTransporte(chave, eu(), "envio")
    const { id: produtor } = await motor.produzir(eu(), envio.id, "audio", vozDe(7778))

    const recepcao = await motor.criarTransporte(chave, outro(), "recepcao")
    const { rtpCapabilities } = await motor.entrar(chave, outro())
    const consumido = await motor.consumir(outro(), recepcao.id, produtor, rtpCapabilities)
    await motor.retomar(outro(), recepcao.id, consumido.id)

    await expect(motor.pausar(outro(), recepcao.id, consumido.id)).resolves.toBeUndefined()
    // And resume still works, which proves the consumer did not die: a
    // closed consumer cannot be resumed, and that was what forced us to re-consume.
    await expect(motor.retomar(outro(), recepcao.id, consumido.id)).resolves.toBeUndefined()
  })

  it("e não pausa um consumidor que não é deste transporte", async () => {
    // The same lock as `retomar`, for the same reason: a producer ID picked up
    // elsewhere cannot silence anyone else's screen.
    const chave = ambito()
    await motor.entrar(chave, eu())
    const recepcao = await motor.criarTransporte(chave, eu(), "recepcao")

    const recusa = await motor.pausar(eu(), recepcao.id, "c-de-outra-pessoa").catch((erro: unknown) => erro)
    expect(recusa).toBeInstanceOf(RecusaDeMedia)
    expect((recusa as RecusaDeMedia).codigo).toBe("consumidor-desconhecido")
  })

  /**
   * **The test that guards separation between calls.**
   *
   * A producer ID picked up elsewhere cannot grant access to
   * a call you did not join. The gateway validates the CHANNEL; this line in
   * the engine validates the room inside it, and without it, two rooms in the same channel
   * would share the worker and the error would be silent: media flowing between
   * calls that thought they were separate, without a single warning line.
   */
  it("recusa consumir um produtor de outro âmbito", async () => {
    const primeiro = ambito()
    const segundo = ambito()

    await motor.entrar(primeiro, eu())
    const envio = await motor.criarTransporte(primeiro, eu(), "envio")
    const { id: produtor } = await motor.produzir(eu(), envio.id, "audio", vozDe(8888))

    await motor.entrar(segundo, outro())
    const recepcao = await motor.criarTransporte(segundo, outro(), "recepcao")
    const { rtpCapabilities } = await motor.entrar(segundo, outro())

    const recusa = await motor.consumir(outro(), recepcao.id, produtor, rtpCapabilities).catch((erro: unknown) => erro)
    expect(recusa).toBeInstanceOf(RecusaDeMedia)
    expect((recusa as RecusaDeMedia).codigo).toBe("produtor-desconhecido")
  })

  /**
   * The second lock on transport ownership.
   *
   * The gateway only passes here IDs read from its own structures,
   * so this looks like paranoia. It is the lock that survives someone
   * reordering a line in the gateway: without it, an `sfu.produce` with another
   * person's ID would put media in their call, on their behalf.
   */
  it("recusa um transporte que é de outra ligação", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    await motor.entrar(chave, outro())
    const meu = await motor.criarTransporte(chave, eu(), "envio")

    const recusa = await motor.produzir(outro(), meu.id, "audio", vozDe(9999)).catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("transporte-desconhecido")
  })

  it("recusa consumir num transporte de envio", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const envio = await motor.criarTransporte(chave, eu(), "envio")
    const { id: produtor } = await motor.produzir(eu(), envio.id, "audio", vozDe(10101))
    const { rtpCapabilities } = await motor.entrar(chave, eu())
    const recusa = await motor.consumir(eu(), envio.id, produtor, rtpCapabilities).catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("sentido-errado")
  })

  it("dá a quem chega tarde os fluxos que já lá estavam", async () => {
    const chave = ambito()
    await motor.entrar(chave, "cedo")
    const envio = await motor.criarTransporte(chave, "cedo", "envio")
    const { id: produtor } = await motor.produzir("cedo", envio.id, "audio", vozDe(11111))

    const { produtores } = await motor.entrar(chave, "tarde")
    expect(produtores.map((cada) => cada.id)).toContain(produtor)
    expect(produtores.find((cada) => cada.id === produtor)?.dono).toBe("cedo")
  })
})

describe("o worker morre", () => {
  /**
   * Why `declararSfu` receives a PREDICATE and not a boolean.
   *
   * A mediasoup worker is a subprocess and subprocesses die. If the
   * `sfu` capability were decided at startup, `hello.ok` would still
   * promise it to clients who would then negotiate with a closed port, and the
   * fault would appear in the call, far from the line that lied.
   */
  it("deixa de estar de pé, e larga o que tinha", async () => {
    const morrer = await MotorDeMedia.arrancar({ porto: 0, anunciarIp: "", escutarEm: "127.0.0.1" })
    try {
      await morrer.entrar("qualquer", eu())
      await morrer.criarTransporte("qualquer", eu(), "envio")
      expect(morrer.estaDePe()).toBe(true)

      process.kill(morrer.pid, "SIGKILL")
      const prazo = Date.now() + 5000
      while (morrer.estaDePe() && Date.now() < prazo) await new Promise((pronto) => setTimeout(pronto, 25))

      expect(morrer.estaDePe()).toBe(false)
      expect(morrer.transportesAbertos).toBe(0)
      // And a new request is refused with a message, instead of crashing with a
      // mediasoup error about a closed channel.
      const recusa = await morrer.entrar("qualquer", outro()).catch((erro: unknown) => erro)
      expect((recusa as RecusaDeMedia).codigo).toBe("sem-motor")
    } finally {
      await morrer.fechar()
    }
  })
})

/**
 * Screen audio: an audio producer with source `ecra`.
 *
 * The October 26, 2026 defect ("screen shares are not transmitting audio")
 * was half caused here: `#fonteDe` refused any
 * `ecra` that was not video, with `fonte-incoerente`. These tests fail with the
 * previous server.
 */
describe("o som do ecrã", () => {
  it("aceita o som do ecrã depois da imagem da mesma pessoa", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    await motor.produzir(eu(), transporte.id, "audio", vozDe(8001), "microfone")
    await motor.produzir(eu(), transporte.id, "video", ecraDe(8002, TECTO_DO_ECRA - TECTO_DO_SOM_DO_ECRA), "ecra")
    const som = await motor.produzir(eu(), transporte.id, "audio", vozDe(8003, TECTO_DO_SOM_DO_ECRA), "ecra")
    expect(som.id).toBeTruthy()
    expect(som.fonte).toBe("ecra")
  })

  it("recusa o som do ecrã sem a imagem à frente", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    const recusa = await motor.produzir(eu(), transporte.id, "audio", vozDe(8010), "ecra").catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("ecra-som-sem-imagem")
  })

  it("recusa o som do ecrã de quem não partilha, mesmo com o ecrã de outro no ar", async () => {
    const chave = ambito()
    const [a, b] = ["a", "b"].map((letra) => `${eu()}-${letra}`) as [string, string]
    await motor.entrar(chave, a)
    await motor.entrar(chave, b)
    const ta = await motor.criarTransporte(chave, a, "envio")
    const tb = await motor.criarTransporte(chave, b, "envio")
    await motor.produzir(a, ta.id, "video", ecraDe(8020), "ecra")
    const recusa = await motor.produzir(b, tb.id, "audio", vozDe(8021), "ecra").catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("ecra-som-sem-imagem")
  })

  it("o som não conta como segundo ecrã", async () => {
    // The stage shows ONE screen; the audio goes with its image and takes no other slot.
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    await motor.produzir(eu(), transporte.id, "video", ecraDe(8030), "ecra")
    await expect(motor.produzir(eu(), transporte.id, "audio", vozDe(8031), "ecra")).resolves.toBeDefined()
  })

  it("recusa um segundo som do ecrã da mesma ligação", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    await motor.produzir(eu(), transporte.id, "video", ecraDe(8040), "ecra")
    await motor.produzir(eu(), transporte.id, "audio", vozDe(8041), "ecra")
    const recusa = await motor.produzir(eu(), transporte.id, "audio", vozDe(8042), "ecra").catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("fonte-repetida")
    expect((recusa as RecusaDeMedia).message).toContain("som do ecrã")
  })

  it("tem orçamento próprio: o dobro do tecto do cliente, e recusa acima", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    await motor.produzir(eu(), transporte.id, "video", ecraDe(8050), "ecra")
    const recusa = await motor
      .produzir(eu(), transporte.id, "audio", vozDe(8051, ORCAMENTO_DO_SOM_DO_ECRA + 1000), "ecra")
      .catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("acima-do-orcamento")
    expect((recusa as RecusaDeMedia).message).toContain("som do ecrã")
    await expect(
      motor.produzir(eu(), transporte.id, "audio", vozDe(8052, ORCAMENTO_DO_SOM_DO_ECRA), "ecra"),
    ).resolves.toBeDefined()
  })

  it("fechar a imagem fecha o som do mesmo ecrã, e devolve os dois", async () => {
    // Audio without video is refused at entry (`ecra-som-sem-imagem`). Without
    // this it would be orphaned at exit: a second voice, outside the voice cap, going
    // out to everyone after the stage closes.
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    const voz = await motor.produzir(eu(), transporte.id, "audio", vozDe(8070), "microfone")
    const imagem = await motor.produzir(eu(), transporte.id, "video", ecraDe(8071, TECTO_DO_ECRA - TECTO_DO_SOM_DO_ECRA), "ecra")
    const som = await motor.produzir(eu(), transporte.id, "audio", vozDe(8072, TECTO_DO_SOM_DO_ECRA), "ecra")

    expect(await motor.fecharProdutor(eu(), imagem.id)).toEqual({ ambito: chave, fechados: [som.id, imagem.id] })

    // Truly closed in mediasoup: anyone arriving no longer sees them, and the voice stays.
    const { produtores } = await motor.entrar(chave, outro())
    expect(produtores.map((cada) => cada.id)).toEqual([voz.id])
    // And the audio cannot be closed again: it no longer exists.
    const recusa = await motor.fecharProdutor(eu(), som.id).catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("produtor-desconhecido")
  })

  it("com som, a imagem conta com o tecto do ecrã menos o som", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    await motor.produzir(eu(), transporte.id, "video", ecraDe(8080, TECTO_DO_ECRA), "ecra")
    const recusa = await motor
      .produzir(eu(), transporte.id, "audio", vozDe(8081, TECTO_DO_SOM_DO_ECRA), "ecra")
      .catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("acima-do-orcamento")
    expect((recusa as RecusaDeMedia).message).toContain("imagem do ecrã")
  })

  it("fechar só o som deixa a imagem no ar", async () => {
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    const imagem = await motor.produzir(eu(), transporte.id, "video", ecraDe(8075, TECTO_DO_ECRA - TECTO_DO_SOM_DO_ECRA), "ecra")
    const som = await motor.produzir(eu(), transporte.id, "audio", vozDe(8076, TECTO_DO_SOM_DO_ECRA), "ecra")

    expect((await motor.fecharProdutor(eu(), som.id)).fechados).toEqual([som.id])
    const { produtores } = await motor.entrar(chave, outro())
    expect(produtores.map((cada) => cada.id)).toEqual([imagem.id])
  })

  it("o orçamento do som do ecrã não passa para o microfone", async () => {
    // The screen audio budget does not spread to the microphone.
    const chave = ambito()
    await motor.entrar(chave, eu())
    const transporte = await motor.criarTransporte(chave, eu(), "envio")
    const recusa = await motor
      .produzir(eu(), transporte.id, "audio", vozDe(8060, ORCAMENTO_DO_SOM_DO_ECRA), "microfone")
      .catch((erro: unknown) => erro)
    expect((recusa as RecusaDeMedia).codigo).toBe("acima-do-orcamento")
  })
})

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { MotorDeMedia } from "./media.js"

/**
 * Media engine races: whoever arrives at the same time as the last one exits.
 *
 * `media.test.ts` measures the engine handling one request at a time. This
 * measures it handling two that cross, which is the normal case and not the
 * exceptional one, because the gateway dispatches each frame with a
 * `void this.#dispatch(...)` and there is no queue between frames from
 * different sockets.
 *
 * The pattern is the same one `call.ts` already logs in comments: a
 * replaceable resource killed by a late report from an old resource.
 */

let motor: MotorDeMedia

beforeAll(async () => {
  motor = await MotorDeMedia.arrancar({ porto: 0, anunciarIp: "", escutarEm: "127.0.0.1" })
})

afterAll(async () => {
  await motor?.fechar()
})

describe("entrar num âmbito que o último a sair está a fechar", () => {
  /**
   * **The router shut down under whoever just entered.**
   *
   * `entrar` waits for the scope and only then subscribes to it. Between the
   * two, the last member can exit, and `#talvezFecharAmbito` closes the router
   * for anyone who has no one left, without knowing someone is arriving at
   * that instant.
   *
   * What comes out of this is worse than an error: `entrar` responds with the
   * `rtpCapabilities` of a dead router, the client loads the device with them,
   * and the next `sfu.transport.create` is refused with "this connection did
   * not enter this call", in a call it just entered and heard yes. The call
   * does not form and the message sends you looking in the wrong place.
   *
   * The two halves are tested: that you end up REALLY inside (there is a
   * transport), and that the scope you ended up in still exists.
   */
  it("quem entra fica com um âmbito vivo, e não com o que estava a morrer", async () => {
    const chave = `corrida-${Date.now().toString(36)}`

    // Whoever was there, alone: their exit is what closes the router.
    await motor.entrar(chave, "sai")

    // The two things crossing: the entry waits for the scope, and the exit
    // happens within that wait. No `await` between the two, on purpose.
    const entrada = motor.entrar(chave, "chega")
    await motor.sairDoAmbito("sai", chave)
    await entrada

    // Proof that the scope is usable: you only create a transport in a call you
    // entered, and in a router that still stands.
    const transporte = await motor.criarTransporte(chave, "chega", "envio")
    expect(transporte.id).toBeTruthy()

    await motor.sairDoAmbito("chega", chave)
  })

  /**
   * And the half you do not see: the two cannot end in DIFFERENT routers.
   *
   * It is the failure that the comment on `#ambito` already describes for
   * another race, "a consumer can only consume a producer from the SAME router,
   * so half the room could not hear the other half, with no error anywhere".
   * Here the gate is different: a closed scope that stays in the map, or one
   * that leaves the map with someone inside.
   */
  it("e quem entra a seguir cai no MESMO âmbito que ele", async () => {
    const chave = `corrida2-${Date.now().toString(36)}`

    await motor.entrar(chave, "sai")
    const entrada = motor.entrar(chave, "chega")
    await motor.sairDoAmbito("sai", chave)
    await entrada

    await motor.entrar(chave, "terceiro")

    const doPrimeiro = await motor.criarTransporte(chave, "chega", "envio")
    const doSegundo = await motor.criarTransporte(chave, "terceiro", "recepcao")

    // A producer from one is only consumed on the transport of another if both
    // are on the same router. That is the question, and it is the only way to ask it
    // from the outside.
    const { id: produtor } = await motor.produzir("chega", doPrimeiro.id, "audio", {
      codecs: [
        {
          mimeType: "audio/opus",
          payloadType: 100,
          clockRate: 48000,
          channels: 2,
          parameters: { usedtx: 1 },
          rtcpFeedback: [],
        },
      ],
      headerExtensions: [],
      encodings: [{ ssrc: 987_654 }],
      rtcp: { cname: "teste" },
    })

    const consumido = await motor.consumir("terceiro", doSegundo.id, produtor, {
      codecs: [
        {
          kind: "audio",
          mimeType: "audio/opus",
          preferredPayloadType: 100,
          clockRate: 48000,
          channels: 2,
          rtcpFeedback: [],
          parameters: {},
        },
      ],
      headerExtensions: [],
    })
    expect(consumido.produtor).toBe(produtor)

    await motor.sairDoAmbito("chega", chave)
    await motor.sairDoAmbito("terceiro", chave)
  })
})

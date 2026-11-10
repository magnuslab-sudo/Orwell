import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { MotorDeMedia } from "./media.js"

/**
 * Media engine races: someone arriving just as the last one leaves.
 *
 * `media.test.ts` measures the engine handling one request at a time. This
 * measures it handling two that cross, which is the normal case and not the
 * exceptional one, because the gateway dispatches each frame with a
 * `void this.#dispatch(...)` and there is no queue between frames from
 * different sockets.
 *
 * It is the same family of bugs `call.ts` already documents in comments: a
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
   * **The router closed under whoever just joined.**
   *
   * `entrar` waits for the scope and only then registers in it. The last
   * member's exit fits in between, and `#talvezFecharAmbito` closes the router
   * of a scope with nobody left, without knowing someone is arriving at
   * that instant.
   *
   * The result is worse than an error: `entrar` answers with the
   * `rtpCapabilities` of a dead router, the client loads the device with them,
   * and the next `sfu.transport.create` is refused with "this connection has
   * not joined this call", for a call it just joined and was told it had. The
   * call does not come up and the message points to the wrong place.
   *
   * Both halves are measured: that the connection REALLY ends up inside (there is
   * a transport), and that its scope still exists.
   */
  it("quem entra fica com um âmbito vivo, e não com o que estava a morrer", async () => {
    const chave = `corrida-${Date.now().toString(36)}`

    // Whoever was already there, alone: their exit is what closes the router.
    await motor.entrar(chave, "sai")

    // The two crossing: the join waits for the scope, and the exit
    // happens within that wait. No `await` between the two, on purpose.
    const entrada = motor.entrar(chave, "chega")
    await motor.sairDoAmbito("sai", chave)
    await entrada

    // Proof that the scope is usable: a transport can only be created in a call
    // one has joined, on a router that is still up.
    const transporte = await motor.criarTransporte(chave, "chega", "envio")
    expect(transporte.id).toBeTruthy()

    await motor.sairDoAmbito("chega", chave)
  })

  /**
   * And the half you do not see: the two must not end up on DIFFERENT routers.
   *
   * It is the failure that the comment on `#ambito` already describes for
   * another race, "a consumer can only consume a producer from the SAME router,
   * so half the room could not hear the other half, with no error anywhere".
   * Here the way in is different: a closed scope that stays in the map, or one
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

    // One side's producer can only be consumed on the other's transport if both
    // are on the same router. That is the question, and this is the only way to ask it
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

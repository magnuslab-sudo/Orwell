import { describe, expect, it } from "vitest"
import { ClientFrame, ServerFrame } from "./wire.js"

/**
 * The video vocabulary of the SFU: the source, and the close of a producer.
 *
 * Two things were added to the wire for video to pass, and both must follow the
 * house rule: **a new field is OPTIONAL, and its absence must still mean what it
 * already meant.** A Phase 2 client never sent `fonte`, it only produced audio,  * and must still be read without complaint, because the server validates with Zod
 * and a refused frame is a call that does not mount.
 *
 * The `sfu.produce.close` is new `t`, and this is safe only in this plan: it is the
 * gateway plan, where an unknown `t` gives non-fatal `bad-frame` on the server side
 * and falls through on the client side. In the MLS payload plan (`payload.ts`) a new
 * `t` fails the entire union, the payload counts as ignored, and repeated ignores
 * trigger the repair that deletes history. See `payload.sfu.test.ts`, where that
 * rule is stated as executable.
 */
describe("a fonte de um fluxo", () => {
  it("aceita as três fontes num `sfu.produce`, e ENTREGA-AS", () => {
    /*
     * The second half is what stores something. A `z.object` without the field
     * declared does not REFUSE an extra field: it silently drops it and returns
     * success. A test that only checked `success` would pass with the old schema,
     * on a frame that reached the engine with no source at all, and everyone's
     * screen would end up on the 190 by 128 card.
     */
    for (const fonte of ["microfone", "camara", "ecra"] as const) {
      const frame = ClientFrame.parse({ t: "sfu.produce", transport: "t1", kind: "video", rtpParameters: {}, fonte })
      expect(frame.t === "sfu.produce" && frame.fonte).toBe(fonte)
    }
  })

  it("continua a ler um `sfu.produce` SEM fonte, que é o que um cliente da Fase 2 manda", () => {
    // Fails the day someone makes `fonte` required, and the symptom would be
    // an old client unable to put voice on a call, with a `bad-frame` explaining
    // everything but why.
    const frame = ClientFrame.safeParse({ t: "sfu.produce", transport: "t1", kind: "audio", rtpParameters: {} })
    expect(frame.success).toBe(true)
    if (frame.success && frame.data.t === "sfu.produce") expect(frame.data.fonte).toBeUndefined()
  })

  it("recusa uma fonte inventada", () => {
    // The cap on a flow comes from here. A source that the schema let through would reach the engine with no cap selected.
    const frame = ClientFrame.safeParse({ t: "sfu.produce", transport: "t1", kind: "video", rtpParameters: {}, fonte: "webcam" })
    expect(frame.success).toBe(false)
  })

  it("não põe `fonte` por omissão — a ausência tem de sobreviver à validação", () => {
    /*
     * A `.default("camara")` here looked harmless and it is not: the server could no longer
     * tell "not said" apart from "said camera", and the rule of reading absence by `kind`,      * audio means microphone, would mark every old client's microphone as camera. With the
     * camera cap applied to a voice track.
     */
    const frame = ClientFrame.parse({ t: "sfu.produce", transport: "t1", kind: "audio", rtpParameters: {} })
    expect("fonte" in frame).toBe(false)
  })

  it("deixa o servidor ecoar a fonte a quem já está na chamada", () => {
    // `parse` and reading the field, not `safeParse().success`: an undeclared field is silently
    // discarded, and the test would pass anyway.
    const aviso = ServerFrame.parse({
      t: "sfu.producer.new",
      channel: "#geral:orwell.pt",
      scope: "abc",
      producer: "p1",
      kind: "video",
      address: "@alguem:orwell.pt",
      fonte: "ecra",
    })
    expect(aviso.t === "sfu.producer.new" && aviso.fonte).toBe("ecra")

    const entrada = ServerFrame.parse({
      t: "sfu.scope.joined",
      channel: "#geral:orwell.pt",
      scope: "abc",
      rtpCapabilities: {},
      producers: [{ id: "p1", kind: "video", address: "@alguem:orwell.pt", fonte: "ecra" }],
    })
    expect(entrada.t === "sfu.scope.joined" && entrada.producers[0]?.fonte).toBe("ecra")
  })

  it("lê um `sfu.scope.joined` com produtores SEM fonte", () => {
    // Forward tolerance: a Phase 2 server talking to a Phase 3 client. The field is optional on
    // both sides or it is not optional.
    const entrada = ServerFrame.safeParse({
      t: "sfu.scope.joined",
      channel: "#geral:orwell.pt",
      scope: "abc",
      rtpCapabilities: {},
      producers: [{ id: "p1", kind: "audio", address: "@alguem:orwell.pt" }],
    })
    expect(entrada.success).toBe(true)
  })
})

describe("fechar um produtor sem sair da chamada", () => {
  it("tem frame de pedido e frame de resposta", () => {
    expect(ClientFrame.safeParse({ t: "sfu.produce.close", producer: "p1" }).success).toBe(true)
    expect(ServerFrame.safeParse({ t: "sfu.produce.closed", producer: "p1" }).success).toBe(true)
  })

  it("leva a etiqueta, como todos os pedidos que esperam resposta", () => {
    // Without `ref` the client matched the response by SHAPE, and two stops at the same time, // the app button and the browser button, are two indistinguishable responses. That is the
    // race the label exists to end.
    const frame = ClientFrame.safeParse({ t: "sfu.produce.close", producer: "p1", ref: "s7" })
    expect(frame.success).toBe(true)
  })

  it("não é um `t` do plano dos payloads MLS", async () => {
    /*
     * The boundary you do not cross. A new `t` in `payload.ts` fails the whole union on an
     * old client: the payload is discarded, counts as ignored event, and consecutive ignored
     * events declare the channel deaf and trigger repair that DELETES HISTORY. Here is the
     * gateway plan, where an unknown `t` is a non-fatal `bad-frame`, and that is why this
     * frame can exist and a new `voice.*` cannot.
     */
    const { Payload } = await import("./payload.js")
    expect(Payload.safeParse({ t: "sfu.produce.close", producer: "p1" }).success).toBe(false)
  })
})

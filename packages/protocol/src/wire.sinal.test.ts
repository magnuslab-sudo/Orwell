import { describe, expect, it } from "vitest"
import {
  CAPACIDADE_SINAL_EFEMERO,
  CODIGOS_DE_RECUSA_DO_SINAL,
  ClientFrame,
  SINAL_MAX_CARACTERES,
  ServerFrame,
} from "./wire.js"

/**
 * The frame `channel.sinal` on the wire (absolute sync, phase S3).
 *
 * What is asserted: the request and response shape, the schema limit, and that the `hello`
 * of an old client with no capability still passes unchanged.
 */
const CANAL = "!sala:localhost"

describe("channel.sinal", () => {
  it("a capacidade tem o nome do contrato", () => {
    expect(CAPACIDADE_SINAL_EFEMERO).toBe("sinal-efemero")
  })

  it("do cliente: canal, bytes base64url e `ref` opcional", () => {
    const frame = ClientFrame.parse({ t: "channel.sinal", channel: CANAL, sinal: "AAEC", ref: "r1" })
    expect(frame).toStrictEqual({ t: "channel.sinal", channel: CANAL, sinal: "AAEC", ref: "r1" })
    expect(ClientFrame.safeParse({ t: "channel.sinal", channel: CANAL, sinal: "AAEC" }).success).toBe(true)
  })

  it("recusa um sinal vazio, fora de base64url, ou acima do tecto do protocolo", () => {
    expect(ClientFrame.safeParse({ t: "channel.sinal", channel: CANAL, sinal: "" }).success).toBe(false)
    expect(ClientFrame.safeParse({ t: "channel.sinal", channel: CANAL, sinal: "não é base64" }).success).toBe(false)
    expect(ClientFrame.safeParse({ t: "channel.sinal", channel: CANAL, sinal: "A".repeat(SINAL_MAX_CARACTERES) }).success).toBe(true)
    expect(ClientFrame.safeParse({ t: "channel.sinal", channel: CANAL, sinal: "A".repeat(SINAL_MAX_CARACTERES + 1) }).success).toBe(false)
  })

  it("do servidor: canal, quem enviou e os bytes, sem `ref`", () => {
    const frame = ServerFrame.parse({ t: "channel.sinal", channel: CANAL, from: "@ana:localhost", sinal: "AAEC", ref: "r1" })
    expect(frame).toStrictEqual({ t: "channel.sinal", channel: CANAL, from: "@ana:localhost", sinal: "AAEC" })
  })

  it("a recusa só aceita os códigos do catálogo", () => {
    for (const code of CODIGOS_DE_RECUSA_DO_SINAL) {
      expect(ServerFrame.safeParse({ t: "channel.sinal.rejected", channel: CANAL, code, message: "x" }).success).toBe(true)
    }
    expect(ServerFrame.safeParse({ t: "channel.sinal.rejected", channel: CANAL, code: "outro", message: "x" }).success).toBe(false)
    const comEspera = ServerFrame.parse({
      t: "channel.sinal.rejected",
      channel: CANAL,
      code: "sinal-rate-limited",
      message: "x",
      ref: "r1",
      retryAfterMs: 1200,
    })
    expect(comEspera.t === "channel.sinal.rejected" && comEspera.retryAfterMs).toBe(1200)
  })

  it("um `hello` sem capacidades, o de um cliente antigo, continua válido", () => {
    expect(ClientFrame.safeParse({ t: "hello", version: 1 }).success).toBe(true)
    expect(
      ClientFrame.safeParse({ t: "hello", version: 1, capabilities: ["commit-after-echo", CAPACIDADE_SINAL_EFEMERO] }).success,
    ).toBe(true)
  })
})

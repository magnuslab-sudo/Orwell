import { createChannel, encryptPayload } from "@enclave/crypto"
import { Attachment, generateIdentity, parseServerName, toBase64, type Payload } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import {
  bytesQueAindaCabem,
  caracteresDeDataUrl,
  FICHEIRO_MAX_BYTES,
  INLINE_MAX_CHARS,
  PAYLOAD_MAX_CHARS,
} from "./anexos.js"
import { MAX_SEALED_BYTES } from "./session.js"

const TIPO = "application/octet-stream"

/** A data URL of the right length, without wasting memory to fake real bytes. */
function dataUrl(bytes: number, mediaType = TIPO): string {
  return `data:${mediaType};base64,${"A".repeat(Math.ceil(bytes / 3) * 4)}`
}

/**
 * The largest file that the FRAME can hold, ignoring the schema ceiling.
 *
 * Exists only for tests in this file: in production you can never ignore
 * the schema, which is why `bytesQueAindaCabem` returns the minimum of both.
 */
function maxDaMoldura(): number {
  const prefixo = `data:${TIPO};base64,`.length
  return Math.floor((PAYLOAD_MAX_CHARS - prefixo) / 4) * 3
}

/**
 * A message that carries `total` characters of data URL, distributed across.
 *
 * Distributed because they HAVE to be: the frame ceiling sits above the
 * schema ceiling, and `encryptPayload` validates the payload before
 * encrypting it. A single attachment never hits eight and a half megabytes,
 // it hits the four million character `inline` ceiling first and is
 * rejected. This is the exact shape of the dangerous message the module
 * exists to refuse: multiple attachments, each valid per schema, together
 * above what the server reads.
 */
function mensagemCom(total: number): Payload {
  const pedacos: string[] = []
  for (let restante = total; restante > 0; ) {
    const pedaco = Math.min(restante, INLINE_MAX_CHARS)
    pedacos.push(`data:${TIPO};base64,${"A".repeat(pedaco - `data:${TIPO};base64,`.length)}`)
    restante -= pedaco
  }
  return {
    t: "message",
    id: "mensagem-de-medida-01",
    sentAt: 1_700_000_000_000,
    body: "",
    attachments: pedacos.map((inline) => ({
      url: "",
      inline,
      key: "",
      nonce: "",
      digest: "",
      kind: "document",
      // The longest name the schema allows: if the margin survives this case, it
      // survives any real message.
      name: "n".repeat(255),
      mediaType: TIPO,
      byteLength: 0,
    })),
    mentions: [],
    links: [],
  }
}

/** The sealed size, measured against the real cipher and not a formula. */
async function selado(payload: Payload): Promise<number> {
  const identidade = generateIdentity(parseServerName("enclave.test"))
  const grupo = await createChannel(identidade, "!geral:enclave.test")
  const resultado = await encryptPayload(grupo, payload)
  return toBase64(resultado.ciphertext).length
}

describe("caracteresDeDataUrl", () => {
  it("conta o mesmo que construir a data URL e medi-la", () => {
    for (const bytes of [0, 1, 2, 3, 4, 999, 100_000]) {
      expect(caracteresDeDataUrl(bytes, TIPO)).toBe(dataUrl(bytes).length)
    }
  })
})

describe("o tecto do esquema", () => {
  it("é o mesmo número que o protocolo aplica", () => {
    const base = {
      url: "",
      key: "",
      nonce: "",
      digest: "",
      kind: "document",
      name: "a.bin",
      mediaType: TIPO,
      byteLength: 1,
    }
    // Exactly at the ceiling it passes; one more character does not. If the
    // protocol changes the number, one of these two lines fails, which is the
    // point of having them.
    expect(() => Attachment.parse({ ...base, inline: "a".repeat(INLINE_MAX_CHARS) })).not.toThrow()
    expect(() => Attachment.parse({ ...base, inline: "a".repeat(INLINE_MAX_CHARS + 1) })).toThrow()
  })

  it("é o que manda no maior ficheiro de todos, com a mensagem vazia", () => {
    // Three megabytes of schema against six and a half of frame: schema wins.
    expect(FICHEIRO_MAX_BYTES).toBeLessThan(PAYLOAD_MAX_CHARS)
    expect(caracteresDeDataUrl(FICHEIRO_MAX_BYTES, TIPO)).toBeLessThanOrEqual(INLINE_MAX_CHARS)
    expect(caracteresDeDataUrl(FICHEIRO_MAX_BYTES + 3, TIPO)).toBeGreaterThan(INLINE_MAX_CHARS)
  })
})

describe("o tecto da moldura", () => {
  it("desconta o que a mensagem já leva, e o que devolve cabe na moldura", () => {
    // The frame is only the active ceiling once the schema is not: with an
    // empty message six and a half megabytes remain, and the schema cuts at
    // three. Here we fake a message that already uses most of it, so the
    // number being measured is truly the frame's.
    const jaGasto = PAYLOAD_MAX_CHARS - 2_000_000
    const bytes = bytesQueAindaCabem(jaGasto, TIPO)
    expect(bytes).toBeGreaterThan(0)
    expect(caracteresDeDataUrl(bytes, TIPO)).toBeLessThanOrEqual(PAYLOAD_MAX_CHARS - jaGasto)
  })

  it("uma mensagem no tecto sela mesmo abaixo do que o cliente aceita enviar", async () => {
    const tamanho = await selado(mensagemCom(PAYLOAD_MAX_CHARS))
    expect(tamanho).toBeLessThanOrEqual(MAX_SEALED_BYTES)
  }, 120_000)

  it("a reserva é folga e não sorte — mais um kilobyte ainda cabe, muito mais não", async () => {
    // Two measurements, and both matter. The first says the ceiling is not
    // at the edge by accident: above it there is margin, so the math does not
    // depend on an MLS header byte that changes with library version.
    const folga = await selado(mensagemCom(PAYLOAD_MAX_CHARS + 1024))
    expect(folga).toBeLessThanOrEqual(MAX_SEALED_BYTES)

    // The second says the margin is not absurd: burn through all of it and a
    // bit more goes over the ceiling. Without this, a ten-megabyte margin would
    // pass the first test and waste half the frame without anyone noticing.
    const excesso = await selado(mensagemCom(PAYLOAD_MAX_CHARS + 3 * RESERVA_MEDIDA))
    expect(excesso).toBeGreaterThan(MAX_SEALED_BYTES)
  }, 120_000)
})

/** The margin from `anexos.ts`, repeated here only so the test above can burn through it. */
const RESERVA_MEDIDA = 4096

describe("bytesQueAindaCabem", () => {
  it("encolhe à medida que a mensagem se enche, e chega a zero", () => {
    expect(bytesQueAindaCabem(0, TIPO)).toBe(FICHEIRO_MAX_BYTES)
    expect(bytesQueAindaCabem(PAYLOAD_MAX_CHARS - 3_000_000, TIPO)).toBeLessThan(FICHEIRO_MAX_BYTES)
    expect(bytesQueAindaCabem(PAYLOAD_MAX_CHARS, TIPO)).toBe(0)
    // Never negative: the caller compares it to file size, and a negative
    // number would pass for "fits" in a careless comparison.
    expect(bytesQueAindaCabem(PAYLOAD_MAX_CHARS + 1_000_000, TIPO)).toBe(0)
  })

  it("desconta o tipo, que também viaja dentro da data URL", () => {
    const curto = bytesQueAindaCabem(0, "text/csv")
    const comprido = bytesQueAindaCabem(0, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    expect(comprido).toBeLessThan(curto)
  })

  it("o que devolve cabe mesmo — reconvertido em caracteres, nunca passa", () => {
    for (const ocupado of [0, 1, 1_000_000, PAYLOAD_MAX_CHARS - 100]) {
      const bytes = bytesQueAindaCabem(ocupado, TIPO)
      if (bytes === 0) continue
      expect(caracteresDeDataUrl(bytes, TIPO)).toBeLessThanOrEqual(PAYLOAD_MAX_CHARS - ocupado)
      expect(caracteresDeDataUrl(bytes, TIPO)).toBeLessThanOrEqual(INLINE_MAX_CHARS)
    }
  })
})

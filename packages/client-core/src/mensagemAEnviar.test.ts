import { Payload } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import { mensagemAEnviar } from "./mensagemAEnviar.js"

/**
 * The message that both hosts (the browser and the desktop) send.
 *
 * It lived written twice, once in each host, with a comment saying they had to
 * match. A reply sent from the desktop and another from the browser had to arrive
 * identical to the same group: now it's the same function.
 */

const BASE = { id: "mensagem-1", sentAt: 1_000 }

describe("mensagemAEnviar", () => {
  it("uma mensagem simples, na sala por omissão, sem etiqueta de sala", () => {
    const payload = mensagemAEnviar("olá", undefined, undefined, BASE)
    expect(payload).toEqual({ t: "message", id: "mensagem-1", sentAt: 1_000, body: "olá", attachments: [], links: [], mentions: [] })
    expect(Payload.safeParse(payload).success).toBe(true)
  })

  it("leva a sala quando não é a por omissão", () => {
    expect(mensagemAEnviar("olá", "geral", undefined, BASE)).toMatchObject({ room: "geral" })
  })

  it("leva as menções e a votação", () => {
    const poll = { question: "Sim?", options: ["Sim", "Não"] }
    expect(mensagemAEnviar("olá", undefined, { mentions: ["@a:b"], poll }, BASE)).toMatchObject({ mentions: ["@a:b"], poll })
  })

  it("uma resposta leva o `replyTo`, e passa no esquema do protocolo", () => {
    const payload = mensagemAEnviar("eu vou", undefined, { replyTo: "original-1", mentions: ["@a:b"] }, BASE)
    expect(payload).toMatchObject({ replyTo: "original-1", mentions: ["@a:b"] })
    const lido = Payload.parse(payload)
    expect(lido.t === "message" && lido.replyTo).toBe("original-1")
  })

  it("sem resposta, o campo não vai no fio", () => {
    expect("replyTo" in mensagemAEnviar("olá", undefined, { mentions: [] }, BASE)).toBe(false)
  })

  it("imagens e ficheiros entram na mesma lista de anexos", () => {
    const payload = mensagemAEnviar(
      "",
      undefined,
      {
        images: [{ dataUrl: "data:image/png;base64,AA==", name: "a.png", mediaType: "image/png", bytes: 1 }],
        files: [{ dataUrl: "data:application/pdf;base64,AA==", name: "b.pdf", mediaType: "application/pdf", bytes: 1 }],
      },
      BASE,
    )
    expect(payload.attachments.map((anexo) => [anexo.name, anexo.kind])).toEqual([
      ["a.png", "image"],
      ["b.pdf", "document"],
    ])
  })
})

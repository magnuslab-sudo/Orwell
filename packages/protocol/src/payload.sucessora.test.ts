import { ed25519 } from "@noble/curves/ed25519.js"
import { describe, expect, it } from "vitest"
import { assinarAutoria, verificarAutoria } from "./autoria.js"
import { decodePayload, encodePayload, Payload } from "./payload.js"

/**
 * The `conta.sucessora` of phase 8.2 ("Merge accounts"): a `sucessora` field in
 * a `message`, and a `sucessao` field in the invite. No new `t`.
 *
 * The coexistence decision, proved here: a 0.9.4 client does not know the field,
 * strips it and reads the message as text. It doesn't reject anything, and so the
 * channel does not go deaf. See the comment on the field in `payload.ts`.
 */

const CANAL = "!sala:orwell.pt"
const ANA = "@ana:orwell.pt"
const DORA = "@dora:orwell.pt"

const sucessao = {
  t: "message",
  id: "m-sucessora-1",
  sentAt: 1_000,
  body: `Esta conta passou a ser ${DORA}.`,
  sucessora: { para: DORA, at: 1_000 },
}

/** The schema of `message` as 0.9.4 has it: without the two fields of this phase. */
function mensagemDa094(): { safeParse: (valor: unknown) => { success: boolean; data?: unknown } } {
  const opcoes = (Payload as unknown as { options: { shape: { t: { value: string } }; omit: (o: object) => unknown }[] }).options
  const mensagem = opcoes.find((opcao) => opcao.shape.t.value === "message")
  if (!mensagem) throw new Error("sem esquema de mensagem")
  return mensagem.omit({ sucessora: true }) as never
}

describe("a sucessão viaja numa mensagem", () => {
  it("atravessa a codificação com o campo inteiro", () => {
    const lido = decodePayload(encodePayload(Payload.parse(sucessao)))
    expect(lido.t).toBe("message")
    expect((lido as { sucessora?: unknown }).sucessora).toEqual({ para: DORA, at: 1_000 })
  })

  it("uma sucessão ilegível não reprova a mensagem: perde-se o campo, fica a frase", () => {
    const lido = Payload.parse({ ...sucessao, sucessora: { para: "não é endereço", at: 1 } }) as { body: string; sucessora?: unknown }
    expect(lido.sucessora).toBeUndefined()
    expect(lido.body).toContain(DORA)
  })

  it("um cliente 0.9.4 lê a mensagem, sem o campo, e não a reprova", () => {
    const comoA094 = mensagemDa094().safeParse(sucessao)
    expect(comoA094.success).toBe(true)
    expect(comoA094.data).not.toHaveProperty("sucessora")
    expect((comoA094.data as { body: string }).body).toBe(`Esta conta passou a ser ${DORA}.`)
  })

  it("o convite para quem sucedeu leva o endereço da conta antiga, e um convite sem ele fica igual", () => {
    const convite = Payload.parse({
      t: "message",
      id: "m-convite-1",
      sentAt: 1,
      body: "Convido-te para «Sala».",
      invite: { channel: CANAL, at: 1, name: "Sala", sucessao: ANA },
    }) as { invite?: { sucessao?: string } }
    expect(convite.invite?.sucessao).toBe(ANA)
    const simples = Payload.parse({ t: "message", id: "m-convite-2", sentAt: 1, body: "x", invite: { channel: CANAL, at: 1 } }) as {
      invite?: Record<string, unknown>
    }
    expect(simples.invite).toEqual({ channel: CANAL, at: 1 })
  })
})

describe("a sucessão é assinada pela secundária (autoria)", () => {
  const semente = new Uint8Array(32).fill(7)
  const assinar = (payload: Record<string, unknown>): Record<string, unknown> => ({
    ...payload,
    autoria: assinarAutoria({
      canal: CANAL,
      autor: ANA,
      payload,
      aparelho: ed25519.getPublicKey(semente),
      assinar: (m) => ed25519.sign(m, semente),
    }),
  })

  it("verifica como da Ana, e não como de outra conta nem noutro canal", () => {
    const assinado = assinar(Payload.parse(sucessao) as Record<string, unknown>)
    expect(verificarAutoria(CANAL, ANA, assinado).ok).toBe(true)
    expect(verificarAutoria(CANAL, DORA, assinado).ok).toBe(false)
    expect(verificarAutoria("!outra:orwell.pt", ANA, assinado).ok).toBe(false)
  })

  it("trocar o destino depois de assinado não verifica", () => {
    const assinado = assinar(Payload.parse(sucessao) as Record<string, unknown>)
    const trocado = { ...assinado, sucessora: { para: "@eva:orwell.pt", at: 1_000 } }
    expect(verificarAutoria(CANAL, ANA, trocado).ok).toBe(false)
  })

  it("o limite dito: relatada a uma 0.9.4, que despe o campo, a autoria não verifica lá", () => {
    const assinado = assinar(Payload.parse(sucessao) as Record<string, unknown>)
    const { sucessora: _despida, ...comoA094 } = assinado
    expect(verificarAutoria(CANAL, ANA, comoA094).ok).toBe(false)
  })

  it("uma mensagem sem o campo assina-se igual (a forma da 0.9.4)", () => {
    const normal = Payload.parse({ t: "message", id: "m-normal-9", sentAt: 1, body: "olá" }) as Record<string, unknown>
    expect(Object.keys(normal)).not.toContain("sucessora")
    expect(verificarAutoria(CANAL, ANA, assinar(normal)).ok).toBe(true)
  })
})

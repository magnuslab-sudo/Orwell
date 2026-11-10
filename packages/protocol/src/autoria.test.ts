import { ed25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  assinarAutoria,
  canonicoTolerante,
  formaAssinada,
  mensagemDaAutoria,
  RelatosNoFio,
  TIPOS_COM_AUTORIA,
  verificarAutoria,
} from "./autoria.js"
import { toBase64 } from "./canonical.js"
import { decodePayload, encodePayload, Payload } from "./payload.js"

/** A fixed device key, so the vectors do not change from run to run. */
const SEMENTE = new Uint8Array(32).map((_, i) => i + 1)
const APARELHO = ed25519.getPublicKey(SEMENTE)
const assinar = (mensagem: Uint8Array): Uint8Array => ed25519.sign(mensagem, SEMENTE)

const CANAL = "!lagar:orwell.pt"
const ANA = "@ana:orwell.pt"

const ANEXO = {
  url: "",
  inline: "data:image/png;base64,AAAA",
  key: "",
  nonce: "",
  digest: "",
  kind: "image",
  name: "foto.png",
  mediaType: "image/png",
  byteLength: 4,
  duration: 1.5,
}

/** One payload of each type with authorship, as it comes from the schema. */
function exemplos(): Record<string, unknown>[] {
  const id = "0123456789abcdef"
  return [
    { t: "message", id, sentAt: 1, body: "olá", attachments: [ANEXO] },
    { t: "edit", id: "edit-0123456789", target: id, editedAt: 2, body: "olá!" },
    { t: "redact", id: "redact-012345678", target: id, redactedAt: 3 },
    { t: "reaction", target: id, emoji: "👍" },
    { t: "post", id, postedAt: 4, caption: "mural", media: [ANEXO], links: [], tags: [] },
    { t: "post.comment", id: "comentario-0123", target: id, postedAt: 5, body: "bom" },
    { t: "post.reaction", id: "gosto-012345678", target: id, at: 6, emoji: "❤" },
    { t: "room.created", name: "Lagar", createdAt: 7 },
    { t: "role.define", role: "porteiro", name: "Porteiro", powers: ["convidar"], definedAt: 8 },
    { t: "role.assign", subject: "@bruno:orwell.pt", roles: ["porteiro"], assignedAt: 9 },
    { t: "channel.meta", room: "avisos", name: "Avisos", updatedAt: 10 },
    { t: "channel.category", category: "Geral", updatedAt: 11 },
    { t: "space.meta", name: "Lagar", updatedAt: 12 },
    { t: "profile", displayName: "Ana", updatedAt: 13, avatar: ANEXO },
  ].map((p) => Payload.parse(p) as Record<string, unknown>)
}

function comAutoria(payload: Record<string, unknown>, canal = CANAL, autor = ANA): Record<string, unknown> {
  return { ...payload, autoria: assinarAutoria({ canal, autor, payload, aparelho: APARELHO, assinar }) }
}

describe("a autoria (fase S4, §4.1)", () => {
  it("cobre todos os tipos de TIPOS_COM_AUTORIA, e o campo sobrevive ao fio", () => {
    const tipos = new Set<string>()
    for (const payload of exemplos()) {
      tipos.add(payload["t"] as string)
      const assinado = comAutoria(payload)
      // In and back: the schema has the field, or else decode would have dropped it.
      const lido = decodePayload(encodePayload(assinado as Payload)) as Record<string, unknown>
      expect(lido["autoria"]).toEqual(assinado["autoria"])
      expect(verificarAutoria(CANAL, ANA, lido)).toEqual({ ok: true, aparelho: toBase64(APARELHO) })
    }
    expect([...tipos].sort()).toEqual([...TIPOS_COM_AUTORIA].sort())
  })

  it("um vector fixo: a mensagem assinada e a assinatura não mudam", () => {
    const payload = Payload.parse({ t: "message", id: "0123456789abcdef", sentAt: 1, body: "olá" }) as Record<string, unknown>
    const mensagem = mensagemDaAutoria(CANAL, ANA, payload, [])
    expect(new TextDecoder().decode(mensagem)).toBe(
      'orwell-autoria-v1\0!lagar:orwell.pt\0@ana:orwell.pt\0{"m":[],"p":{"attachments":[],"body":"olá","id":"0123456789abcdef","links":[],"mentions":[],"sentAt":1,"t":"message"}}',
    )
    const autoria = assinarAutoria({ canal: CANAL, autor: ANA, payload, aparelho: APARELHO, assinar })
    // Ed25519 is deterministic: the same key and the same message give the same signature.
    expect(autoria.as).toBe(toBase64(ed25519.sign(mensagem, SEMENTE)))
    expect(autoria.ap).toBe("ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ")
  })

  it("recusa o payload alterado, outro canal e outro autor", () => {
    const [mensagem] = exemplos()
    const assinado = comAutoria(mensagem!)
    expect(verificarAutoria(CANAL, ANA, { ...assinado, body: "outra coisa" })).toEqual({ ok: false, razao: "assinatura-invalida" })
    expect(verificarAutoria("!outro:orwell.pt", ANA, assinado).ok).toBe(false)
    expect(verificarAutoria(CANAL, "@bruno:orwell.pt", assinado).ok).toBe(false)
    expect(verificarAutoria(CANAL, ANA, mensagem!)).toEqual({ ok: false, razao: "sem-autoria" })
    expect(verificarAutoria(CANAL, ANA, { ...mensagem!, autoria: { v: 2 } })).toEqual({ ok: false, razao: "autoria-ilegivel" })
  })

  it("um resumo de anexo trocado não verifica: os bytes ficam presos à assinatura", () => {
    const [mensagem] = exemplos()
    const assinado = comAutoria(mensagem!)
    const autoria = assinado["autoria"] as { m: string[] }
    const trocado = { ...autoria, m: [toBase64(sha256(new Uint8Array([1])))] }
    expect(verificarAutoria(CANAL, ANA, { ...assinado, autoria: trocado }).ok).toBe(false)
  })

  it("continua a verificar depois de o cofre despejar os bytes dos anexos", () => {
    const [mensagem] = exemplos()
    const assinado = comAutoria(mensagem!)
    // What `evictEntryMedia` leaves in place of the attachment.
    const despejado = { ...assinado, attachments: [{ evicted: true, name: "foto.png", mediaType: "image/png" }] }
    expect(verificarAutoria(CANAL, ANA, despejado).ok).toBe(true)
    // And the signed form is the same in both.
    expect(canonicoTolerante(formaAssinada(despejado))).toBe(canonicoTolerante(formaAssinada(assinado)))
  })

  it("mutação: sem o canal na mensagem, um relato passava de um canal para outro", () => {
    const [mensagem] = exemplos()
    const assinado = comAutoria(mensagem!)
    const a = mensagemDaAutoria(CANAL, ANA, assinado, [])
    const b = mensagemDaAutoria("!outro:orwell.pt", ANA, assinado, [])
    expect(toBase64(sha256(a))).not.toBe(toBase64(sha256(b)))
  })
})

describe("a autoria e os relatos num cliente 0.5.7 (§4.6)", () => {
  /**
   * The schemas as 0.5.7 reads them: without `autoria` and without `relatos`. Copied
   * from the form of those types in that version, with only the required fields.
   * They are not `strict()`, like no schema in the protocol: an extra field comes
   * out, and the payload passes.
   */
  const MensagemAntiga = z.object({ t: z.literal("message"), id: z.string(), sentAt: z.number(), body: z.string() })
  const ComentarioAntigo = z.object({
    t: z.literal("post.comment"),
    id: z.string(),
    target: z.string(),
    postedAt: z.number(),
    body: z.string(),
  })
  const PapelAntigo = z.object({ t: z.literal("role.assign"), subject: z.string(), roles: z.array(z.string()), assignedAt: z.number() })
  const TypingAntigo = z.object({ t: z.literal("typing"), room: z.string().max(64).optional(), until: z.number().int().nonnegative() })

  const noFio = (payload: Record<string, unknown>): unknown =>
    JSON.parse(new TextDecoder().decode(encodePayload(payload as Payload)))

  it("a autoria sai sem reprovar o payload", () => {
    const [mensagem, , , , , comentario, , , , atribuicao] = exemplos()
    for (const [esquema, payload] of [
      [MensagemAntiga, mensagem],
      [ComentarioAntigo, comentario],
      [PapelAntigo, atribuicao],
    ] as const) {
      const lido = esquema.safeParse(noFio(comAutoria(payload!)))
      expect(lido.success).toBe(true)
      expect(lido.data).not.toHaveProperty("autoria")
    }
  })

  it("o typing com relatos passa, sem os relatos, e nasce expirado", () => {
    const [mensagem] = exemplos()
    const relatos: RelatosNoFio = { v: 1, q: "pedido-1", itens: [{ s: 41, a: ANA, p: comAutoria(mensagem!) }] }
    const typing = { t: "typing", until: 0, relatos }
    // The new schema keeps them whole.
    expect((decodePayload(encodePayload(typing as Payload)) as { relatos?: unknown }).relatos).toEqual(relatos)
    const lido = TypingAntigo.safeParse(noFio(typing))
    expect(lido.success).toBe(true)
    expect(lido.data).toEqual({ t: "typing", until: 0 })
  })
})

describe("contra o esquema da 0.5.7 tal como saiu (commit bb23e7a)", () => {
  /**
   * The `payload.ts` from 0.5.7, copied unchanged to `testes/payload-0.5.7.ts`.
   * Imported by a computed path, so `tsc -b` does not pull it into `src/`.
   */
  type Antigo = { decodePayload: (bytes: Uint8Array) => Record<string, unknown> }
  async function esquemaAntigo(): Promise<Antigo> {
    const caminho = new URL("../testes/payload-0.5.7.ts", import.meta.url).href
    return (await import(/* @vite-ignore */ caminho)) as Antigo
  }

  it("lê cada tipo com autoria, sem a autoria, e sem reprovar", async () => {
    const { decodePayload: decodeAntigo } = await esquemaAntigo()
    for (const payload of exemplos()) {
      const lido = decodeAntigo(encodePayload(comAutoria(payload) as Payload))
      expect(lido["t"]).toBe(payload["t"])
      expect(lido).not.toHaveProperty("autoria")
    }
  })

  it("lê o typing com relatos como um typing expirado, sem os relatos", async () => {
    const { decodePayload: decodeAntigo } = await esquemaAntigo()
    const [mensagem] = exemplos()
    const typing = { t: "typing", until: 0, relatos: { v: 1, q: "x:1/1", itens: [{ s: 3, a: ANA, p: comAutoria(mensagem!) }] } }
    expect(decodeAntigo(encodePayload(typing as Payload))).toEqual({ t: "typing", until: 0 })
  })
})

import { describe, expect, it } from "vitest"
import {
  appendHistory,
  entryMediaBytes,
  evictEntryMedia,
  HISTORY_MEDIA_BUDGET_BYTES,
  type StoredChatMessage,
  type VaultContents,
} from "./vault.js"

/**
 * What happens to a DOCUMENT stored in the vault.
 *
 * The vault evicts media by budget, and link thumbnails were already kept out
 * of it, they weighed a lot but did not count, and stayed there forever. A
 * document in a message or post is much heavier than a thumbnail, so the
 * question had to be asked fresh instead of answered by analogy: does it count
 * toward the budget, and does it evict honestly?
 */

function documento(inline: string, nome = "contrato.pdf"): Record<string, unknown> {
  return {
    url: "",
    inline,
    key: "",
    nonce: "",
    digest: "",
    kind: "document",
    name: nome,
    mediaType: "application/pdf",
    byteLength: 1000,
  }
}

function entrada(seq: number, anexos: unknown[], chave: "attachments" | "media" = "attachments"): StoredChatMessage {
  return {
    channel: "!sala:s",
    seq,
    sender: "@a:s",
    at: seq,
    payload: {
      t: chave === "media" ? "post" : "message",
      id: `id-${seq}`,
      sentAt: seq,
      body: "veja isto",
      [chave]: anexos,
    },
  } as unknown as StoredChatMessage
}

const BYTES = `data:application/pdf;base64,${"A".repeat(200_000)}`

describe("um documento no cofre", () => {
  it("PESA na contabilidade do despejo, numa mensagem e numa publicação", () => {
    // `carriesBytes` looks for `inline`, and a document has it like an image does.
    // If someone changes that search to "images only" someday, this breaks, and
    // should break: a document that weighed zero would stay in the vault forever.
    expect(entryMediaBytes(entrada(1, [documento(BYTES)]))).toBe(BYTES.length)
    expect(entryMediaBytes(entrada(1, [documento(BYTES)], "media"))).toBe(BYTES.length)
  })

  it("despejado, o nome e o tipo sobrevivem e os bytes não", () => {
    const entry = entrada(1, [documento(BYTES)])
    evictEntryMedia(entry)
    const [anexo] = entry.payload.attachments as Record<string, unknown>[]
    expect(anexo).toEqual({ evicted: true, name: "contrato.pdf", mediaType: "application/pdf" })
    // Zero after eviction: otherwise the budget never dropped and the vault evicted
    // everything on every save.
    expect(entryMediaBytes(entry)).toBe(0)
  })

  it("o `kind` NÃO sobrevive — é por isso que a interface separa pelo `mediaType`", () => {
    // This is the fact that decides `separarAnexos` in the interface. A test on
    // `kind` sent all evicted images to the files list the day they got old.
    const entry = entrada(1, [documento(BYTES)])
    evictEntryMedia(entry)
    const [anexo] = entry.payload.attachments as Record<string, unknown>[]
    expect(anexo).not.toHaveProperty("kind")
    expect(anexo).not.toHaveProperty("byteLength")
    expect(anexo).toHaveProperty("mediaType", "application/pdf")
  })

  it("passado o orçamento, os documentos mais antigos são os primeiros a cair", () => {
    const contents = { history: {} } as unknown as VaultContents
    // Each one gets a quarter of the budget: five do not fit, and the oldest leaves.
    const pedaco = `data:application/pdf;base64,${"A".repeat(Math.floor(HISTORY_MEDIA_BUDGET_BYTES / 4))}`
    for (let seq = 1; seq <= 5; seq++) {
      appendHistory(contents, "!sala:s", entrada(seq, [documento(pedaco, `doc-${seq}.pdf`)]))
    }
    const guardadas = contents.history["!sala:s"] ?? []
    const anexoDe = (i: number): Record<string, unknown> =>
      (guardadas[i]?.payload.attachments as Record<string, unknown>[])[0] as Record<string, unknown>

    expect(anexoDe(0).evicted).toBe(true)
    // The name stays: the row says what it was, even without the bytes.
    expect(anexoDe(0).name).toBe("doc-1.pdf")
    // And the newest survived, which is the other half of the rule.
    expect(anexoDe(4).evicted).toBeUndefined()
  })
})

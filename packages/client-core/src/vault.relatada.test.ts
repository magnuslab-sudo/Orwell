import { describe, expect, it } from "vitest"
import { appendHistory, entradasDoCanal, mergeOlderHistory, newVaultContents, type StoredChatMessage } from "./vault.js"

/**
 * The `seq` of a report (phase S4) is stated by the caller and not signed. It
 * cannot own the `seq`: the server event with that number takes ownership (S4
 * review, finding 6).
 */

const CANAL = "!lagar:orwell.test"
const ANA = "@ana:orwell.test"
const BRUNO = "@bruno:orwell.test"

const mensagem = (seq: number, sender: string, id: string, extra: Partial<StoredChatMessage> = {}): StoredChatMessage => ({
  seq,
  sender,
  at: seq,
  payload: { t: "message", id, sentAt: seq, body: id },
  ...extra,
})

const resumo = (seq: number, sender: string, id: string) => ({ seq, sender, id })

describe("um relato em cima de um buraco, e depois o evento real", () => {
  it("ao vivo: o evento do servidor fica com o seq, e o relatado passa a -1 logo antes dele", () => {
    const c = newVaultContents()
    appendHistory(c, CANAL, mensagem(50, ANA, "relatada-00", { relatada: true }))
    appendHistory(c, CANAL, mensagem(50, BRUNO, "verdadeira0"))
    const entradas = entradasDoCanal(c, CANAL).map((e) => ({ ...resumo(e.seq, e.sender, e.payload["id"] as string), apos: e.apos, relatada: e.relatada }))
    expect(entradas).toContainEqual({ seq: 50, sender: BRUNO, id: "verdadeira0", apos: undefined, relatada: undefined })
    expect(entradas).toContainEqual({ seq: -1, sender: ANA, id: "relatada-00", apos: 49, relatada: true })
  })

  it("na recuperação (página antiga): o mesmo", () => {
    const c = newVaultContents()
    appendHistory(c, CANAL, mensagem(60, ANA, "depois-0000"))
    appendHistory(c, CANAL, mensagem(50, ANA, "relatada-00", { relatada: true }))
    mergeOlderHistory(c, CANAL, [mensagem(50, BRUNO, "verdadeira0"), mensagem(51, BRUNO, "outra-00000")])
    const porId = new Map(entradasDoCanal(c, CANAL).map((e) => [e.payload["id"], e]))
    expect(porId.get("verdadeira0")?.seq).toBe(50)
    expect(porId.get("outra-00000")?.seq).toBe(51)
    expect(porId.get("relatada-00")).toMatchObject({ seq: -1, apos: 49, relatada: true })
  })

  it("o mesmo evento a chegar do servidor confirma o relato, e o seq do servidor vence o dito", () => {
    const c = newVaultContents()
    appendHistory(c, CANAL, mensagem(50, ANA, "relatada-00", { relatada: true }))
    appendHistory(c, CANAL, mensagem(50, ANA, "relatada-00"))
    expect(entradasDoCanal(c, CANAL)).toHaveLength(1)
    expect(entradasDoCanal(c, CANAL)[0]!.relatada).toBeUndefined()
    // A reporter who stated the wrong seq: the server brings the event with the correct seq.
    appendHistory(c, CANAL, mensagem(70, BRUNO, "mentida-000", { relatada: true }))
    appendHistory(c, CANAL, mensagem(65, BRUNO, "mentida-000"))
    const mentida = entradasDoCanal(c, CANAL).filter((e) => e.payload["id"] === "mentida-000")
    expect(mentida).toHaveLength(1)
    expect(mentida[0]).toMatchObject({ seq: 65 })
    expect(mentida[0]!.relatada).toBeUndefined()
  })

  it("um evento do servidor continua dono do seq: um relato com o mesmo seq não o tira", () => {
    const c = newVaultContents()
    appendHistory(c, CANAL, mensagem(50, BRUNO, "verdadeira0"))
    appendHistory(c, CANAL, mensagem(50, ANA, "relatada-00", { relatada: true }))
    expect(entradasDoCanal(c, CANAL).map((e) => e.payload["id"])).toEqual(["verdadeira0"])
  })
})

/**
 * A report carries the card WITHOUT the thumbnail (the thumbnail is not signed:
 * `payloadSemBytes`). In a community, the report may arrive before the server
 * event. The server copy has the thumbnail and comes from the author,
 * authenticated by MLS: its bytes stay (report from owner with 1.1.0, "the app
 * still has no YouTube thumbnails in communities").
 */
describe("o relato antes do evento do servidor: a miniatura do servidor fica", () => {
  const MINIATURA = "data:image/jpeg;base64,/9j/miniatura"
  const VIDEO = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
  const cartao = (comMiniatura: boolean) => ({
    url: VIDEO,
    title: "Big Buck Bunny",
    siteName: "YouTube",
    ...(comMiniatura ? { thumbnail: MINIATURA } : {}),
  })
  const comVideo = (seq: number, comMiniatura: boolean, extra: Partial<StoredChatMessage> = {}): StoredChatMessage => ({
    seq,
    sender: BRUNO,
    at: seq,
    payload: { t: "message", id: "video-00001", sentAt: 1, body: `olha ${VIDEO}`, room: "conversa", links: [cartao(comMiniatura)] },
    ...extra,
  })
  const miniaturas = (c: ReturnType<typeof newVaultContents>) =>
    entradasDoCanal(c, CANAL).map((e) => (e.payload["links"] as { thumbnail?: string }[] | undefined)?.[0]?.thumbnail ?? null)

  it("ao vivo, com o mesmo seq: o relato fica confirmado e com a miniatura do servidor", () => {
    const c = newVaultContents()
    appendHistory(c, CANAL, comVideo(50, false, { relatada: true }))
    appendHistory(c, CANAL, comVideo(50, true))
    expect(entradasDoCanal(c, CANAL)).toHaveLength(1)
    expect(entradasDoCanal(c, CANAL)[0]!.relatada).toBeUndefined()
    expect(miniaturas(c)).toEqual([MINIATURA])
  })

  it("ao vivo, com o relato gravado sem seq (o seq estava ocupado): o mesmo", () => {
    const c = newVaultContents()
    appendHistory(c, CANAL, comVideo(-1, false, { relatada: true, apos: 49 }))
    appendHistory(c, CANAL, comVideo(52, true))
    expect(entradasDoCanal(c, CANAL)).toHaveLength(1)
    expect(entradasDoCanal(c, CANAL)[0]).toMatchObject({ seq: 52 })
    expect(miniaturas(c)).toEqual([MINIATURA])
  })

  it("na recuperação (página antiga): o mesmo", () => {
    const c = newVaultContents()
    appendHistory(c, CANAL, mensagem(60, ANA, "depois-0000"))
    appendHistory(c, CANAL, comVideo(50, false, { relatada: true }))
    mergeOlderHistory(c, CANAL, [comVideo(50, true)])
    expect(entradasDoCanal(c, CANAL)).toHaveLength(2)
    expect(miniaturas(c)).toContain(MINIATURA)
  })

  it("depois de confirmado, uma cópia nova do servidor não muda nada", () => {
    const c = newVaultContents()
    appendHistory(c, CANAL, comVideo(50, true))
    appendHistory(c, CANAL, comVideo(70, false))
    expect(entradasDoCanal(c, CANAL)).toHaveLength(1)
    expect(miniaturas(c)).toEqual([MINIATURA])
  })

  it("um relato sobre o que o servidor já trouxe não tira a miniatura", () => {
    const c = newVaultContents()
    appendHistory(c, CANAL, comVideo(50, true))
    appendHistory(c, CANAL, comVideo(50, false, { relatada: true }))
    appendHistory(c, CANAL, comVideo(-1, false, { relatada: true, apos: 49 }))
    expect(entradasDoCanal(c, CANAL)).toHaveLength(1)
    expect(miniaturas(c)).toEqual([MINIATURA])
  })

  it("o mesmo id dito por OUTRA pessoa não dá a miniatura dela ao relato", () => {
    const c = newVaultContents()
    appendHistory(c, CANAL, comVideo(-1, false, { relatada: true, apos: 49 }))
    appendHistory(c, CANAL, { ...comVideo(52, true), sender: ANA })
    const doBruno = entradasDoCanal(c, CANAL).find((e) => e.sender === BRUNO)
    expect(doBruno!.relatada).toBe(true)
    expect((doBruno!.payload["links"] as { thumbnail?: string }[])[0]!.thumbnail).toBeUndefined()
  })
})

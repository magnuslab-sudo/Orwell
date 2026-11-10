import { describe, expect, it } from "vitest"
import type { ChatMessage } from "../types.js"
import { juntarCopiaAoVivo } from "./mesmaMensagem.js"

const CANAL = "!adega:orwell.test"
const BRUNO = "@bruno:orwell.test"
const ANA = "@ana:orwell.test"
const MINIATURA = "data:image/jpeg;base64,/9j/miniatura"
const VIDEO = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"

const comVideo = (seq: number, comMiniatura: boolean, sender = BRUNO): ChatMessage => ({
  channel: CANAL,
  seq,
  sender,
  payload: {
    t: "message",
    id: "video-00001",
    sentAt: 1,
    body: `olha ${VIDEO}`,
    room: "conversa",
    links: [{ url: VIDEO, kind: "video", title: "Big Buck Bunny", ...(comMiniatura ? { thumbnail: MINIATURA } : {}) }],
  } as ChatMessage["payload"],
})

const miniaturaDe = (m: ChatMessage) => (m.payload.links?.[0] as { thumbnail?: string } | undefined)?.thumbnail

describe("a mesma mensagem duas vezes ao vivo: o relato e depois o servidor", () => {
  it("a cópia do servidor, com a miniatura, toma o lugar da do relato: uma linha só", () => {
    const antes = [comVideo(50, false)]
    const depois = juntarCopiaAoVivo(antes, comVideo(50, true))
    expect(depois).toHaveLength(1)
    expect(miniaturaDe(depois![0]!)).toBe(MINIATURA)
  })

  it("um relato depois da cópia do servidor não tira a miniatura", () => {
    const depois = juntarCopiaAoVivo([comVideo(50, true)], comVideo(50, false))
    expect(depois).toHaveLength(1)
    expect(miniaturaDe(depois![0]!)).toBe(MINIATURA)
  })

  it("a linha fica no sítio da primeira", () => {
    const outra: ChatMessage = { channel: CANAL, seq: 51, sender: ANA, payload: { t: "message", id: "outra", sentAt: 2, body: "oi" } }
    const depois = juntarCopiaAoVivo([comVideo(-1, false), outra], comVideo(50, true))
    expect(depois!.map((m) => m.payload.id)).toEqual(["video-00001", "outra"])
    expect(depois![0]!.seq).toBe(50)
  })

  it("o mesmo id dito por outra pessoa é outra mensagem", () => {
    expect(juntarCopiaAoVivo([comVideo(50, false)], comVideo(52, true, ANA))).toBeNull()
  })

  it("noutro canal, ou sem id, é nova", () => {
    expect(juntarCopiaAoVivo([comVideo(50, false)], { ...comVideo(50, true), channel: "!outro:orwell.test" })).toBeNull()
    const semId: ChatMessage = { channel: CANAL, seq: 9, sender: BRUNO, payload: { t: "friend.request" } }
    expect(juntarCopiaAoVivo([semId], { ...semId, seq: 10 })).toBeNull()
  })
})

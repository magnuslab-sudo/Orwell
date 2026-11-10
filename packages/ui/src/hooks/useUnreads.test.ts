import { beforeEach, describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"
import type { ChatMessage } from "../types.js"
import { LAST_READ_KEY, countUnreads, markRead, readLastRead, useUnreads, writeLastRead } from "./useUnreads.js"

beforeEach(() => localStorage.clear())

function message(channel: string, sender: string, sentAt: number): ChatMessage {
  return { channel, seq: 1, sender, payload: { t: "message", id: `${channel}-${sentAt}`, sentAt, body: "olá" } }
}

describe("readLastRead / writeLastRead", () => {
  it("sem nada guardado devolve um mapa vazio", () => {
    expect(readLastRead()).toEqual({})
  })

  it("faz roundtrip pelo localStorage", () => {
    writeLastRead({ "!sala:s": 123 })
    expect(localStorage.getItem(LAST_READ_KEY)).toBeTruthy()
    expect(readLastRead()).toEqual({ "!sala:s": 123 })
  })

  it("tolera JSON estragado e valores fora do domínio", () => {
    localStorage.setItem(LAST_READ_KEY, "{nem pensar")
    expect(readLastRead()).toEqual({})
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ "!a:s": "ontem", "!b:s": 7 }))
    expect(readLastRead()).toEqual({ "!b:s": 7 })
    localStorage.setItem(LAST_READ_KEY, "[1,2]")
    expect(readLastRead()).toEqual({})
  })
})

describe("countUnreads", () => {
  const me = "@eu:s"

  it("conta mensagens de outros, mais recentes do que a última leitura", () => {
    const messages = [message("!a:s", "@ela:s", 100), message("!a:s", "@ela:s", 200), message("!b:s", "@ela:s", 50)]
    const counts = countUnreads(messages, { "!a:s": 150, "!b:s": 0 }, null, me)
    expect(counts.get("!a:s")).toBe(1)
    expect(counts.get("!b:s")).toBe(1)
  })

  it("ignora o canal activo e as mensagens próprias", () => {
    const messages = [message("!a:s", "@ela:s", 100), message("!b:s", me, 100)]
    const counts = countUnreads(messages, {}, "!a:s", me)
    expect(counts.size).toBe(0)
  })

  it("ignora payloads que não são mensagens", () => {
    const post: ChatMessage = { channel: "!a:s", seq: 1, sender: "@ela:s", payload: { t: "post", postedAt: 100 } }
    expect(countUnreads([post], {}, null, me).size).toBe(0)
  })
})

describe("markRead", () => {
  it("marca com o agora, ou com a mensagem mais recente se um relógio andar adiantado", () => {
    const future = Date.now() + 60_000
    const marked = markRead({}, "!a:s", [message("!a:s", "@ela:s", future)])
    expect(marked["!a:s"]).toBe(future)

    const now = markRead({}, "!b:s", [])
    expect(now["!b:s"]).toBeGreaterThanOrEqual(Date.now() - 1000)
  })
})

describe("useUnreads", () => {
  const me = "@eu:s"

  it("abrir um canal limpa a contagem e persiste a marca", () => {
    const messages = [message("!a:s", "@ela:s", Date.now() - 1000)]

    const first = renderHook(({ active }) => useUnreads(messages, active, me), {
      initialProps: { active: null as string | null },
    })
    expect(first.result.current.counts.get("!a:s")).toBe(1)
    expect(first.result.current.total).toBe(1)

    act(() => first.rerender({ active: "!a:s" }))
    expect(first.result.current.total).toBe(0)
    first.unmount()

    // The marker survived: a new instance starts with no unread messages.
    const second = renderHook(() => useUnreads(messages, null, me))
    expect(second.result.current.total).toBe(0)
  })

  it("uma mensagem de outra pessoa num canal não activo conta; a própria não", () => {
    const { result, rerender } = renderHook(({ list }) => useUnreads(list, "!a:s", me), {
      initialProps: { list: [] as ChatMessage[] },
    })
    expect(result.current.total).toBe(0)

    act(() => rerender({ list: [message("!b:s", "@ela:s", Date.now()), message("!c:s", me, Date.now())] }))
    expect(result.current.counts.get("!b:s")).toBe(1)
    expect(result.current.counts.has("!c:s")).toBe(false)
    expect(result.current.total).toBe(1)
  })
})

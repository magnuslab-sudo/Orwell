import { beforeEach, describe, expect, it } from "vitest"
import {
  DIAGNOSTIC_CAP,
  appendDiagnostic,
  clearDiagnostics,
  diagnosticsSnapshot,
  formatDiagnostics,
  recordDiagnostic,
  shortActor,
  shortChannel,
  type DiagnosticEntry,
} from "./diagnostics.js"

beforeEach(clearDiagnostics)

describe("appendDiagnostic", () => {
  it("guarda os mais recentes e deita fora os antigos", () => {
    let list: DiagnosticEntry[] = []
    for (let index = 0; index < DIAGNOSTIC_CAP + 25; index++) {
      list = appendDiagnostic(list, { at: index, kind: "message" })
    }
    expect(list).toHaveLength(DIAGNOSTIC_CAP)
    expect(list[0]?.at).toBe(25)
    expect(list[list.length - 1]?.at).toBe(DIAGNOSTIC_CAP + 24)
  })
})

describe("encurtar", () => {
  it("um canal fica pelo nome, sem servidor", () => {
    expect(shortChannel("!geral:orwell.pt")).toBe("geral")
    expect(shortChannel("!abcdefghijklmnopqrstuvwxyz234567abcdefgh:orwell.pt")).toBe("abcdefghijklmnopqrstuvwxyz234567abcdefgh")
  })

  it("um endereço fica pelo princípio", () => {
    expect(shortActor("@k4x7m2pq8rtv3wyz5abc6def7g:orwell.pt")).toBe("@k4x7m2p…")
  })
})

describe("recordDiagnostic", () => {
  it("regista metadados e encurta o canal", () => {
    recordDiagnostic({ kind: "status", code: "channel-joined", channel: "!geral:orwell.pt", outcome: "log" })
    const [entry] = diagnosticsSnapshot()
    expect(entry?.channel).toBe("geral")
    expect(entry?.code).toBe("channel-joined")
    expect(entry?.at).toBeGreaterThan(0)
  })

  it("o instantâneo é uma cópia: ninguém edita o registo por acidente", () => {
    recordDiagnostic({ kind: "epoch", channel: "!a:b" })
    const snapshot = diagnosticsSnapshot()
    snapshot.push({ at: 0, kind: "message" })
    expect(diagnosticsSnapshot()).toHaveLength(1)
  })
})

describe("formatDiagnostics", () => {
  it("produz texto colável, com cabeçalho que diz o que é", () => {
    const text = formatDiagnostics(
      [
        { at: new Date(2026, 0, 1, 9, 5, 3, 7).getTime(), kind: "connection", code: "online" },
        { at: new Date(2026, 0, 1, 9, 5, 4, 0).getTime(), kind: "status", code: "welcome-dead", channel: "feed-b", outcome: "log" },
      ],
      { note: "só metadados", address: "@k4x7m2pq8rtv:orwell.pt", connection: "online", channels: 12 },
    )

    expect(text).toContain("Orwell — registo de diagnóstico")
    expect(text).toContain("só metadados")
    expect(text).toContain("conta: @k4x7m2p…")
    expect(text).toContain("canais: 12")
    expect(text).toContain("09:05:03.007  connection  online")
    expect(text).toContain("#feed-b  welcome-dead  →log")
  })

  it("nunca leva conteúdo de mensagens: só o tipo do payload", () => {
    // The shell records `payload.t`, never `payload.body` — the guarantee the
    // settings copy makes to the person pressing the button.
    recordDiagnostic({ kind: "message", channel: "!geral:x", code: "message" })
    const text = formatDiagnostics(diagnosticsSnapshot(), { note: "n" })
    expect(text).toContain("message  #geral  message")
    expect(text).not.toContain("body")
  })
})

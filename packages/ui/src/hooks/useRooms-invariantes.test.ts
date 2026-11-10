import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { EnclaveBridge } from "../bridge.js"
import type { ChatMessage } from "../types.js"
import { useRooms } from "./useRooms.js"
import type { QuemVe } from "../screens/chat/categorias.js"

afterEach(cleanup)

const CANAL = "!orwell:orwell.pt"

function ponte(
  rooms: () => { room: string; name: string; category: string; kind: string; position: number }[],
  categories?: () => { category: string; position: number; roles?: string[] }[],
): EnclaveBridge {
  return {
    channels: {
      rooms: () => rooms(),
      ...(categories ? { categories: () => categories() } : {}),
    },
  } as unknown as EnclaveBridge
}

function meta(payload: Record<string, unknown>): ChatMessage {
  return { channel: CANAL, seq: 1, sender: "@a:s", at: 1, payload } as unknown as ChatMessage
}

const NINGUEM: QuemVe = { papeis: [], administra: false }
const SOCIO: QuemVe = { papeis: ["socios"], administra: false }
const ADMIN: QuemVe = { papeis: [], administra: true }

const salaDireccao = { room: "r1", name: "actas", category: "Direcção", kind: "text", position: 1 }

describe("AUDITORIA — invariante 1: sem restrição é o caso normal", () => {
  it("categoria sem `roles` no cofre continua visível a quem não tem papel nenhum", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(
          () => [salaDireccao],
          () => [{ category: "Direcção", position: 1 }],
        ),
        CANAL,
        [],
        NINGUEM,
      ),
    )
    expect(result.current.groups.map((g) => g.category)).toContain("Direcção")
  })

  it("categoria com `roles: []` é de todos", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(
          () => [salaDireccao],
          () => [{ category: "Direcção", position: 1, roles: [] }],
        ),
        CANAL,
        [],
        NINGUEM,
      ),
    )
    expect(result.current.groups.find((g) => g.category === "Direcção")?.rooms).toHaveLength(1)
  })

  it("declaração por mensagem sem `roles` é de todos", () => {
    const { result } = renderHook(() =>
      useRooms(ponte(() => [salaDireccao]), CANAL, [
        meta({ t: "channel.category", category: "Direcção", position: 5, updatedAt: 3 }),
      ], NINGUEM),
    )
    expect(result.current.groups.map((g) => g.category)).toContain("Direcção")
  })

  it("restrição publicada e DEPOIS levantada volta a mostrar a categoria", () => {
    const { result } = renderHook(() =>
      useRooms(ponte(() => [salaDireccao]), CANAL, [
        meta({ t: "channel.category", category: "Direcção", position: 1, roles: ["direccao"], updatedAt: 3 }),
        meta({ t: "channel.category", category: "Direcção", position: 1, roles: [], updatedAt: 4 }),
      ], NINGUEM),
    )
    expect(result.current.groups.map((g) => g.category)).toContain("Direcção")
  })
})

describe("AUDITORIA — invariante 2: quem administra vê sempre", () => {
  it("categoria restrita a um papel que o administrador não tem continua na lista", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(
          () => [salaDireccao],
          () => [{ category: "Direcção", position: 1, roles: ["direccao"] }],
        ),
        CANAL,
        [],
        ADMIN,
      ),
    )
    const grupo = result.current.groups.find((g) => g.category === "Direcção")
    expect(grupo).toBeTruthy()
    expect(grupo?.rooms.map((s) => s.room)).toEqual(["r1"])
  })

  it("o administrador recebe os `roles` em `categories`, para os poder desfazer", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(
          () => [salaDireccao],
          () => [{ category: "Direcção", position: 1, roles: ["direccao"] }],
        ),
        CANAL,
        [],
        ADMIN,
      ),
    )
    expect(result.current.categories).toEqual([{ category: "Direcção", position: 1, roles: ["direccao"] }])
  })

  it("quem NÃO administra e não tem o papel não vê — o contra-caso", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(
          () => [salaDireccao],
          () => [{ category: "Direcção", position: 1, roles: ["direccao"] }],
        ),
        CANAL,
        [],
        NINGUEM,
      ),
    )
    expect(result.current.groups.map((g) => g.category)).not.toContain("Direcção")
  })

  it("quem tem o papel vê", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(
          () => [salaDireccao],
          () => [{ category: "Direcção", position: 1, roles: ["socios"] }],
        ),
        CANAL,
        [],
        SOCIO,
      ),
    )
    expect(result.current.groups.map((g) => g.category)).toContain("Direcção")
  })
})

describe("AUDITORIA — invariante 3: a sala por omissão nunca se esconde", () => {
  it("a sala por omissão dentro de uma categoria escondida continua na lista", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(
          () => [salaDireccao],
          () => [{ category: "Direcção", position: 1, roles: ["direccao"] }],
        ),
        CANAL,
        [meta({ t: "channel.meta", room: "", name: "recepção", category: "Direcção", updatedAt: 4 })],
        NINGUEM,
      ),
    )
    const todas = result.current.groups.flatMap((g) => g.rooms.map((s) => s.room))
    expect(todas).toContain("")
    // and the restricted room was indeed hidden
    expect(todas).not.toContain("r1")
  })

  it("a sala por omissão sobrevive mesmo quando a categoria escondida é a única", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(() => [], () => [{ category: "Direcção", position: 1, roles: ["direccao"] }]),
        CANAL,
        [meta({ t: "channel.meta", room: "", name: "recepção", category: "Direcção", updatedAt: 4 })],
        NINGUEM,
      ),
    )
    expect(result.current.groups.flatMap((g) => g.rooms.map((s) => s.room))).toContain("")
  })
})

describe("AUDITORIA — o que a lista esconde continua a existir", () => {
  it("`rooms` traz as salas escondidas, senão as mensagens delas caíam na sala por omissão", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(
          () => [salaDireccao],
          () => [{ category: "Direcção", position: 1, roles: ["direccao"] }],
        ),
        CANAL,
        [],
        NINGUEM,
      ),
    )
    expect(result.current.rooms.map((s) => s.room)).toContain("r1")
    expect(result.current.groups.flatMap((g) => g.rooms.map((s) => s.room))).not.toContain("r1")
  })

  it("sem `quemVe` não se esconde nada — o comportamento de sempre", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(
          () => [salaDireccao],
          () => [{ category: "Direcção", position: 1, roles: ["direccao"] }],
        ),
        CANAL,
        [],
      ),
    )
    expect(result.current.groups.map((g) => g.category)).toContain("Direcção")
  })
})

describe("AUDITORIA — arestas", () => {
  it("uma categoria escondida e VAZIA não deixa grupo fantasma", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(() => [], () => [{ category: "Direcção", position: 1, roles: ["direccao"] }]),
        CANAL,
        [],
        NINGUEM,
      ),
    )
    expect(result.current.groups.map((g) => g.category)).not.toContain("Direcção")
  })

  it("`categories` de quem NÃO administra também traz as escondidas", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(() => [], () => [{ category: "Direcção", position: 1, roles: ["direccao"] }]),
        CANAL,
        [],
        NINGUEM,
      ),
    )
    expect(result.current.categories.map((c) => c.category)).toEqual(["Direcção"])
  })

  it("`roles` inválidos no fio (não-array) lêem-se como vazio, e não escondem", () => {
    const { result } = renderHook(() =>
      useRooms(ponte(() => [salaDireccao]), CANAL, [
        meta({ t: "channel.category", category: "Direcção", position: 1, roles: "direccao", updatedAt: 3 }),
      ], NINGUEM),
    )
    expect(result.current.groups.map((g) => g.category)).toContain("Direcção")
  })

  it("uma sala de voz numa categoria escondida também sai da lista", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(
          () => [{ room: "v1", name: "Sala de estar", category: "Direcção", kind: "voice", position: 1 }],
          () => [{ category: "Direcção", position: 1, roles: ["direccao"] }],
        ),
        CANAL,
        [],
        NINGUEM,
      ),
    )
    expect(result.current.groups.flatMap((g) => g.rooms.map((s) => s.room))).not.toContain("v1")
  })
})

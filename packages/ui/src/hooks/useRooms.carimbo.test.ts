import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { ChannelRoom, EnclaveBridge } from "../bridge.js"
import type { ChatMessage } from "../types.js"
import { useRooms } from "./useRooms.js"

afterEach(cleanup)

/**
 * An old republish never overwrites what the vault already knows (3/11/2026, Orwell channel).
 *
 * Owner report: "text channel info disappears intermittently, it is happening in general".
 * Each entry to the common channel makes whoever is there republish the rooms and
 * categories to who just joined (`republishRooms`, `#revezarSalas`), with the
 * ORIGINAL timestamp of each. Who publishes them may have a stale vault (lost epochs on
 * a reseat): the room comes out with the old name, category, or "closed" status, and with
 * the old timestamp.
 *
 * The core discards it (`venceCarimbo`: loses to the newer timestamp). The
 * interface did not: it gave the vault timestamp 0, and any `channel.meta` in
 * memory would beat it. The room changed name, group, or vanished, and came back when
 * the correct republish passed or the page reloaded.
 */

const CANAL = "!984:orwell.pt"

function ponte(
  rooms: (ChannelRoom & { updatedAt?: number })[],
  categories: { category: string; position: number; roles?: string[]; updatedAt?: number; removed?: true }[] = [],
): EnclaveBridge {
  return {
    channels: { rooms: () => rooms, closedRooms: () => [], categories: () => categories },
  } as unknown as EnclaveBridge
}

function mensagem(payload: Record<string, unknown>): ChatMessage {
  return { channel: CANAL, seq: 7, sender: "@atrasado:orwell.pt", at: 1, payload } as unknown as ChatMessage
}

describe("useRooms e o carimbo do cofre", () => {
  it("uma sala republicada com o estado velho não tapa a do cofre", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte([{ room: "g", name: "general", category: "Conversa", kind: "text", position: 0, updatedAt: 2_000 }]),
        CANAL,
        [mensagem({ t: "channel.meta", room: "g", name: "geral-antigo", category: "", closed: true, updatedAt: 1_000 })],
      ),
    )
    expect(result.current.rooms.map((sala) => [sala.name, sala.category])).toContainEqual(["general", "Conversa"])
    expect(result.current.closed).toEqual([])
  })

  it("uma categoria republicada com o estado velho não tapa a do cofre", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(
          [{ room: "g", name: "general", category: "Conversa", kind: "text", position: 0, updatedAt: 2_000 }],
          [{ category: "Conversa", position: 0, roles: [], updatedAt: 2_000 }],
        ),
        CANAL,
        [mensagem({ t: "channel.category", category: "Conversa", position: 9, roles: ["mod"], removed: false, updatedAt: 1 })],
      ),
    )
    expect(result.current.categories).toEqual([{ category: "Conversa", position: 0, roles: [] }])
  })

  it("uma mudança mais recente do que o cofre continua a ver-se logo", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte([{ room: "g", name: "general", category: "", kind: "text", position: 0, updatedAt: 2_000 }]),
        CANAL,
        [mensagem({ t: "channel.meta", room: "g", name: "geral", category: "", updatedAt: 3_000 })],
      ),
    )
    expect(result.current.rooms.map((sala) => sala.name)).toContain("geral")
  })

  /*
    "Deleting a category does not delete it, even as admin" (PENDING, requests
    from 26/10, item 1). The core already stored the tombstone and it won
    (`categorias-apagar.test.ts`), but the interface did not see it: `categories` only
    brought live ones. An old republish of the category, or of a room that still
    named it, brought it back on screen until reload.
  */
  it("uma categoria apagada não volta por uma republicação de antes da lápide", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte([], [{ category: "Adega", position: 1, roles: [], updatedAt: 5_000, removed: true }]),
        CANAL,
        [mensagem({ t: "channel.category", category: "Adega", position: 1, roles: [], removed: false, updatedAt: 1_000 })],
      ),
    )
    expect(result.current.categories.map((c) => c.category)).not.toContain("Adega")
    expect(result.current.groups.map((g) => g.category)).not.toContain("Adega")
  })

  it("uma sala republicada de antes da lápide não traz a categoria apagada de volta", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(
          [{ room: "prensa", name: "prensa", category: "", kind: "text", position: 0, updatedAt: 1_000 }],
          [{ category: "Adega", position: 1, roles: [], updatedAt: 5_000, removed: true }],
        ),
        CANAL,
        [mensagem({ t: "channel.meta", room: "prensa", name: "prensa", category: "Adega", updatedAt: 1_000 })],
      ),
    )
    expect(result.current.rooms.find((sala) => sala.room === "prensa")?.category).toBe("")
    expect(result.current.groups.map((g) => g.category)).not.toContain("Adega")
  })

  it("a categoria criada outra vez depois da lápide volta a valer", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte([], [{ category: "Adega", position: 1, roles: [], updatedAt: 5_000, removed: true }]),
        CANAL,
        [mensagem({ t: "channel.category", category: "Adega", position: 2, roles: [], removed: false, updatedAt: 6_000 })],
      ),
    )
    expect(result.current.categories).toEqual([{ category: "Adega", position: 2, roles: [] }])
  })
})

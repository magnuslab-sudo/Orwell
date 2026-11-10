import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { EnclaveBridge } from "../bridge.js"
import type { ChatMessage } from "../types.js"
import { useRooms } from "./useRooms.js"

/**
 * The AFK marker in the room list (2/11/2026): from vault and stream, and only one.
 *
 * The sidebar draws what arrives by message before the vault is re-read,
 * and that is how the marker was lost in the first live test: the AFK
 * room appeared as a regular voice room.
 */

afterEach(cleanup)

const CANAL = "!casa:s"
const ponte = (rooms: unknown[]): EnclaveBridge => ({ channels: { rooms: () => rooms } }) as unknown as EnclaveBridge
const meta = (payload: Record<string, unknown>): ChatMessage =>
  ({ channel: CANAL, seq: 1, sender: "@a:s", at: 1, payload: { t: "channel.meta", category: "", position: 0, ...payload } }) as unknown as ChatMessage
const afkDe = (rooms: { room: string; afk?: { minutos: number } }[]): string[] => rooms.filter((sala) => sala.afk).map((sala) => sala.room)

describe("useRooms e a sala AFK", () => {
  it("a marca do cofre chega à lista", () => {
    const { result } = renderHook(() =>
      useRooms(ponte([{ room: "afk", name: "Dormir", category: "", kind: "voice", position: 0, afk: { minutos: 15 } }]), CANAL, []),
    )
    expect(result.current.rooms.find((sala) => sala.room === "afk")?.afk).toEqual({ minutos: 15 })
  })

  it("a marca acabada de chegar por mensagem também, antes de reler o cofre", () => {
    const { result } = renderHook(() =>
      useRooms(ponte([]), CANAL, [meta({ room: "afk", name: "Dormir", kind: "voice", afk: { minutos: 30 }, updatedAt: 5 })]),
    )
    expect(result.current.rooms.find((sala) => sala.room === "afk")?.afk).toEqual({ minutos: 30 })
  })

  it("uma marca numa sala de texto não conta", () => {
    const { result } = renderHook(() =>
      useRooms(ponte([]), CANAL, [meta({ room: "t", name: "Texto", kind: "text", afk: { minutos: 5 }, updatedAt: 5 })]),
    )
    expect(afkDe(result.current.rooms)).toEqual([])
  })

  it("duas marcadas: só a mais recente fica", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte([{ room: "velha", name: "Velha", category: "", kind: "voice", position: 0, afk: { minutos: 15 } }]),
        CANAL,
        [meta({ room: "nova", name: "Nova", kind: "voice", afk: { minutos: 5 }, updatedAt: 9 })],
      ),
    )
    expect(afkDe(result.current.rooms)).toEqual(["nova"])
  })

  it("republicar a sala sem a marca tira-a", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte([{ room: "afk", name: "Dormir", category: "", kind: "voice", position: 0, afk: { minutos: 15 } }]),
        CANAL,
        [meta({ room: "afk", name: "Dormir", kind: "voice", updatedAt: 9 })],
      ),
    )
    expect(afkDe(result.current.rooms)).toEqual([])
  })
})

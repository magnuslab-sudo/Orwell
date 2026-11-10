import { describe, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import { useSpaceMeta } from "./useSpaceMeta.js"
import type { EnclaveBridge } from "../bridge.js"
import type { ChatMessage } from "../types.js"

/**
 * The channel icon disappearing from the screen with no one touching it.
 *
 * This file pins half of a bug with two halves. The other half is in the core:
 * `Session.spaceMeta()` returned the channel view WITHOUT the timestamp it was
 * recorded with. Here below, the timestamp is the only thing that decides who
 * wins between the vault and what is in memory, and a missing timestamp reads
 * as zero, meaning it always loses.
 *
 * It is not hypothetical and does not need ill intent. `republishAuthority`
 * republishes the `space.meta` to new arrivals, and republishes it with the
 * ORIGINAL date, on purpose, to not beat a deletion on the way. Whoever
 * republishes is anyone who can edit the channel, with what they have in their
 * vault. A second admin who was offline when the icon was set republishes the
 * version they know: same name, no icon, older timestamp. The vault of the
 * receiver rejects it, the guard there compares timestamps for real. The screen
 * accepted it.
 *
 * And the screen is what decides what gets stored next, because the properties
 * sheet takes the initial value of the icon field from it. Seeing the old
 * message, the field opened empty; and saving anything from then on published a
 * `space.meta` without icon with today's date, which the vault of everyone
 * accepts, for being the newest. The icon died for all, and the one who killed
 * it was the person trying to change something else.
 */

/** A bridge with the minimum the hook touches: the view stored in the vault. */
function ponteCom(cofre: Record<string, { name: string; topic?: string; icon?: string; updatedAt?: number }>) {
  return { channels: { meta: (channel: string) => cofre[channel] ?? null } } as unknown as EnclaveBridge
}

/** A `space.meta` as it arrives at the message list in memory. */
function mensagemMeta(
  channel: string,
  payload: { name: string; icon?: string; updatedAt: number },
): ChatMessage {
  return {
    channel,
    seq: 1,
    sender: "@outro:exemplo",
    payload: {
      t: "space.meta",
      name: payload.name,
      ...(payload.icon ? { icon: { inline: payload.icon } } : {}),
      updatedAt: payload.updatedAt,
    },
  } as unknown as ChatMessage
}

const CANAL = "!lagar:exemplo"
const ICONE = "data:image/png;base64,AAAA"

describe("useSpaceMeta", () => {
  it("com dois canais ou mais, os nomes vêm todos do cofre (a chave juntava por um carácter e partia por outro)", () => {
    const ponte = ponteCom({ "!lagar:exemplo": { name: "Lagar", updatedAt: 1 }, "!adega:exemplo": { name: "Adega", updatedAt: 1 } })
    const { result } = renderHook(() => useSpaceMeta(ponte, ["!lagar:exemplo", "!adega:exemplo"], []))
    expect(result.current.spaceMeta.get("!lagar:exemplo")?.name).toBe("Lagar")
    expect(result.current.spaceMeta.get("!adega:exemplo")?.name).toBe("Adega")
  })

  it("não deixa uma republicação velha apagar o ícone que está no cofre", () => {
    // The vault knows the truth: icon set at 2000. This is the entry the reception
    // guard in the core already defended against the message below.
    const cofre = { [CANAL]: { name: "Lagar do Zé", icon: ICONE, updatedAt: 2000 } }
    // And in memory is the republication from a second admin who had not yet seen
    // the icon: same name, no icon, timestamp 1000.
    const velha = [mensagemMeta(CANAL, { name: "Lagar do Zé", updatedAt: 1000 })]

    const { result } = renderHook(() => useSpaceMeta(ponteCom(cofre), [CANAL], velha))

    expect(result.current.spaceMeta.get(CANAL)?.icon).toBe(ICONE)
  })

  it("deixa uma publicação nova apagar o ícone, que é o botão de remover a funcionar", () => {
    // The contrast, so the test above does not pass because everything is being
    // ignored: whoever removes the icon on purpose publishes with today's date, and
    // that wins.
    const cofre = { [CANAL]: { name: "Lagar do Zé", icon: ICONE, updatedAt: 1000 } }
    const nova = [mensagemMeta(CANAL, { name: "Lagar do Zé", updatedAt: 3000 })]

    const { result } = renderHook(() => useSpaceMeta(ponteCom(cofre), [CANAL], nova))

    expect(result.current.spaceMeta.get(CANAL)?.icon).toBeUndefined()
  })

  it("aceita o ícone que chega pelo fio quando o cofre ainda não o tem", () => {
    const cofre = { [CANAL]: { name: "Lagar do Zé", updatedAt: 1000 } }
    const comIcone = [mensagemMeta(CANAL, { name: "Lagar do Zé", icon: ICONE, updatedAt: 2000 })]

    const { result } = renderHook(() => useSpaceMeta(ponteCom(cofre), [CANAL], comIcone))

    expect(result.current.spaceMeta.get(CANAL)?.icon).toBe(ICONE)
  })
})

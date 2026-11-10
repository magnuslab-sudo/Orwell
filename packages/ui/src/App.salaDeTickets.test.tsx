import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

/**
 * Opening a ticket room must not silence the call in progress.
 *
 * Reported by the owner on September 13, 2026: "when a user goes to the ticket
 * room they exit the voice room". No one exits: `abrirSala` only joins a call
 * when the room is voice, and never calls `leave`. What happens is that
 * `TicketsScreen` takes the place of `ChatScreen`, and the `CallPanel` inside
 * it goes with it; the dock, which exists precisely to keep the call playing
 * when the panel is off screen, asked if the CHAT was on screen, and in a
 * ticket frame the chat is on screen, just with something else on top. No panel
 * and no dock means no single media element mounted: sound dies, cards vanish,
 * and from the inside this reads as having left.
 *
 * The guard is on FORM not on a component: while there is a call, there must be
 * somewhere to play it. Counting media elements says that and survives swapping
 * the dock for anything else; searching for `.call-dock` would pin the answer
 * to today's code.
 */

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

afterEach(cleanup)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const LAGAR = "!lagar:casa.pt"

let onCallParticipants: ((event: { participants: unknown[] }) => void) | null = null

function ponte(): EnclaveBridge {
  onCallParticipants = null
  return {
    vault: {
      status: async () => ({ exists: true, supportsOsProtection: true }),
      unlock: async () => ({ ok: true }),
      create: async () => ({ ok: true }),
      lock: async () => ({ ok: true }),
      destroy: async () => ({ ok: true }),
    },
    identity: {
      load: async () => ({ address: EU, accountId: "eu" }),
      create: async () => ({ address: EU, accountId: "eu" }),
    },
    session: {
      connect: async () => ({ ok: true }),
      capabilities: async () => ["mls"],
      setVisible: async () => ({ ok: true }),
    },
    channels: {
      list: async () => [LAGAR],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: vi.fn(async () => ({ ok: true })),
      declineChannelInvite: vi.fn(async () => ({ ok: true })),
      send: async () => ({ ok: true }),
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [EU, ANA],
      history: async () => [],
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      /* Two rooms: the one where people talk, and the frame that covers the screen.
         This is the minimal pair that reproduces the report. */
      rooms: () => [
        { room: "voz", name: "voz", category: "", kind: "voice", position: 0 },
        { room: "tickets", name: "tickets", category: "", kind: "text", position: 1, layout: "tickets" },
      ],
    },
    invites: {
      create: async () => "enclave://join/x/y#z",
      redeem: async () => ({ ok: true }),
      list: async () => [],
      revoke: async () => ({ ok: true }),
    },
    social: {
      post: async () => ({ ok: true }),
      acceptFollower: vi.fn().mockResolvedValue({ ok: true }),
      acceptFriend: vi.fn().mockResolvedValue({ ok: true }),
      declineFriend: vi.fn().mockResolvedValue({ ok: true }),
      unfriend: vi.fn().mockResolvedValue({ ok: true }),
      repairInvite: async () => ({ invited: true }),
      deadWelcomes: async () => [],
      feedChannel: async () => MURAL_EU,
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => ({}),
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    on: {
      message: () => () => {},
      epoch: () => () => {},
      status: () => () => {},
      connection: () => () => {},
      channels: () => () => {},
      presence: () => () => {},
      typing: () => () => {},
      buzz: () => () => {},
      callActivity: () => () => {},
    },
    call: {
      on: (nome: string, handler: (event: never) => void) => {
        if (nome === "participants") onCallParticipants = handler as never
        return () => {}
      },
      setMuted: () => {},
      setCameraOff: () => {},
      join: async () => ({ ok: true }),
      leave: async () => ({ ok: true }),
      tectoDePartilha: 6,
      podePartilharEcra: false,
    },
  } as unknown as EnclaveBridge
}

/** Click a room in the sidebar, by name. */
async function abrirSala(nome: RegExp): Promise<void> {
  const linha = [...document.querySelectorAll<HTMLElement>(".room-row")].find((row) => nome.test(row.textContent ?? ""))
  await act(async () => {
    ;(linha?.querySelector("button") ?? linha)?.click()
    await Promise.resolve()
  })
}

/** Open the channel, join the voice room, and put Ana talking there. */
async function comChamadaAberta(): Promise<void> {
  render(<App bridge={ponte()} />)
  await screen.findByRole("button", { name: strings.rail.chat })

  const canal = [...document.querySelectorAll(".channel-row")].find((row) => /lagar/.test(row.textContent ?? ""))
  await act(async () => {
    ;(canal?.querySelector("button") as HTMLElement).click()
    await Promise.resolve()
  })

  await abrirSala(/voz/i)
  await act(async () => {
    onCallParticipants?.({ participants: [{ address: ANA, connected: true, stream: null, video: false }] })
    await Promise.resolve()
  })
}

const elementosDeMedia = (): number => document.querySelectorAll("video").length

describe("uma sala de tickets aberta por cima de uma chamada", () => {
  it("deixa a chamada com onde tocar", async () => {
    await comChamadaAberta()
    expect(elementosDeMedia()).toBeGreaterThan(0)

    await abrirSala(/tickets/i)

    // The frame is in front, and the call goes on: whoever was talking still has a
    // place to be heard.
    expect(elementosDeMedia()).toBeGreaterThan(0)
  })

  it("e volta a mostrar o painel quando se regressa à conversa", async () => {
    await comChamadaAberta()
    await abrirSala(/tickets/i)
    await abrirSala(/voz/i)

    expect(elementosDeMedia()).toBeGreaterThan(0)
  })
})

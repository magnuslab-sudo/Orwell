import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { PREFS_KEY } from "./hooks/usePrefs.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

/**
 * Changing screen must not erase the microphone choice.
 *
 * The effect that sends preferences to the core runs on every view change and
 * sent four of the seven keys. The bridge does not merge: it writes over. So
 * every screen change erased the chosen microphone and the gain, and the next call
 * opened the system device with factory volume, while
 * Settings kept showing, with full confidence, the choice that no longer existed.
 *
 * The guard is over ALL calls and not over the last one: one incomplete call is enough
 * to leave the core state without the field, and it is the incomplete call that this file
 * exists to catch.
 */

afterEach(cleanup)

const EU = "@eu:casa.pt"
const FEED = moradaDeTeste("mural eu", "casa.pt")

let aplicadas: Record<string, unknown>[] = []

function ponte(): EnclaveBridge {
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
      list: async () => [FEED],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: vi.fn(async () => ({ ok: true })),
      declineChannelInvite: vi.fn(async () => ({ ok: true })),
      send: async () => ({ ok: true }),
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [EU],
      history: async () => [],
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
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
      feedChannel: async () => FEED,
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
    applyMediaPrefs: (next: Record<string, unknown>) => {
      aplicadas.push(next)
    },
    call: { on: () => () => {}, setMuted: () => {} },
  } as unknown as EnclaveBridge
}

beforeEach(() => {
  aplicadas = []
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      chosen: true,
      inputDeviceId: "mic-abc",
      inputGain: 1.5,
      filtroDeMicrofone: false,
      noiseSuppression: false,
    }),
  )
})

describe("as escolhas de microfone chegam ao núcleo e lá ficam", () => {
  it("desde o arranque, e outra vez a cada mudança de ecrã", async () => {
    render(<App bridge={ponte()} />)
    await screen.findByRole("button", { name: strings.rail.chat })

    await act(async () => {
      ;(screen.getByRole("button", { name: strings.rail.social }) as HTMLElement).click()
      await Promise.resolve()
    })

    expect(aplicadas.length).toBeGreaterThan(1)
    for (const chamada of aplicadas) {
      expect(chamada).toMatchObject({
        inputDeviceId: "mic-abc",
        inputGain: 1.5,
        filtroDeMicrofone: false,
        noiseSuppression: false,
      })
    }
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { playSound } from "./lib/sounds.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

/**
 * The sounds of people entering and leaving the room we are in, measured in the shell.
 *
 * The rule lives in `lib/sounds.ts` and already has its own tests. This measures the other
 * half, the one that broke live: what FEEDS the monitor. A correct rule with the wrong
 * list in front sounds as bad as a wrong rule.
 *
 * What was heard on 10 September 2026, with two accounts for real in a room
 * on the development server: Bruno enters, and Ana hears the entry tone and the exit tone
 * stuck together, 587,33 → 783,99 followed by 783,99 → 587,33 in the same clock instant.
 * A person announced as having left in the same second they arrived.
 *
 * The cause: the monitor was fed only by PAIRS from the call, and that list
 * always arrives after the announcement. Between `voice.join` and the negotiation yielding
 * a pair there is a moment when the person is already counted and is not yet anyone's pair;
 * any pair emission in that window read as an exit.
 */

vi.mock("./lib/sounds.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./lib/sounds.js")>()
  return { ...real, playSound: vi.fn(() => true) }
})

// jsdom has no media pipeline: without this, `play()` returns `undefined` and the
// `.catch` in `VideoTile` brings down the whole tree to `ErrorBoundary`.
vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

afterEach(() => {
  cleanup()
  desvioDoRelogio = 0
})

/**
 * The clock, advanced by hand after entering the room.
 *
 * `ROSTER_SETTLE_MS` silences the first three seconds on purpose: someone entering
 * a room with five people receives five announcements at once, all because of them.
 * A test that announces right after clicking falls within that window and
 * measures its silence, not the rule.
 */
let desvioDoRelogio = 0
const relogioReal = Date.now.bind(Date)
vi.spyOn(Date, "now").mockImplementation(() => relogioReal() + desvioDoRelogio)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const BRUNO = "@bruno:casa.pt"
const LAGAR = "!lagar:casa.pt"

let onCallParticipants: ((event: { participants: unknown[] }) => void) | null = null
let onCallActivity: ((event: { channel: string; from: string; joined: boolean; room: string }) => void) | null = null

function ponte(): EnclaveBridge {
  onCallParticipants = null
  onCallActivity = null
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
      members: async () => [EU, ANA, BRUNO],
      history: async () => [],
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      rooms: () => [{ room: "voz", name: "voz", category: "", kind: "voice", position: 0 }],
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
      callActivity: (handler: never) => {
        onCallActivity = handler as never
        return () => {}
      },
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

/** Open the app and enter the voice room, which is the normal gesture. */
async function naSalaDeVoz(): Promise<void> {
  render(<App bridge={ponte()} />)
  await screen.findByRole("button", { name: strings.rail.chat })

  const linha = [...document.querySelectorAll(".channel-row")].find((row) => /lagar/.test(row.textContent ?? ""))
  await act(async () => {
    ;(linha?.querySelector("button") as HTMLElement).click()
    await Promise.resolve()
  })
  const entrar = [...document.querySelectorAll<HTMLElement>(".room-row")].find((row) =>
    /voz/i.test(row.textContent ?? ""),
  )
  await act(async () => {
    ;(entrar?.querySelector("button") ?? entrar)?.click()
    await Promise.resolve()
  })
  // After the settlement window, an announcement becomes an entry again.
  desvioDoRelogio = 10_000
  vi.mocked(playSound).mockClear()
}

/** A room announcement, like what the bridge delivers. */
async function anuncio(from: string, joined: boolean): Promise<void> {
  await act(async () => {
    onCallActivity?.({ channel: LAGAR, from, joined, room: "voz" })
    await Promise.resolve()
  })
}

/** And the media connections this device has active at the next moment. */
async function pares(...quem: string[]): Promise<void> {
  await act(async () => {
    onCallParticipants?.({
      participants: quem.map((address) => ({ address, connected: true, stream: null, video: false })),
    })
    await Promise.resolve()
  })
}

const tocou = (): string[] => vi.mocked(playSound).mock.calls.map(([kind]) => kind)

describe("quem entra na sala onde estamos", () => {
  beforeEach(() => vi.mocked(playSound).mockClear())

  it("não é anunciado como tendo saído no instante em que chega", async () => {
    await naSalaDeVoz()
    // The announcement arrives first. The negotiation has not yet yielded any pair: it is this
    // interval, not a lab case, that produced the extra tone.
    await anuncio(BRUNO, true)
    await pares()

    expect(tocou()).not.toContain("voice-leave")
  })

  it("continua a ouvir-se chegar", async () => {
    await naSalaDeVoz()
    await anuncio(BRUNO, true)
    await pares()

    expect(tocou()).toContain("voice-join")
  })

  it("e a entrada de um não faz soar a saída de outro que estava a negociar", async () => {
    await naSalaDeVoz()
    await anuncio(ANA, true)
    await anuncio(BRUNO, true)
    // Only one of them managed to connect. The other is still announced, and
    // announced is not absent.
    await pares(ANA)

    expect(tocou()).not.toContain("voice-leave")
  })
})

describe("quem sai da sala onde estamos", () => {
  beforeEach(() => vi.mocked(playSound).mockClear())

  it("soa quando desaparece sem se despedir", async () => {
    await naSalaDeVoz()
    await anuncio(BRUNO, true)
    await pares(BRUNO)
    vi.mocked(playSound).mockClear()

    // Closed the tab: neither `voice.leave` nor any announcement expiring
    // yet. What changes is the list of active connections, and for the monitor,
    // the announcement must leave with it, or absence is never absence.
    await anuncio(BRUNO, false)
    await pares()

    expect(tocou()).toContain("voice-leave")
  })

  it("e soa uma vez só, não duas, quando se despediu antes de desaparecer", async () => {
    await naSalaDeVoz()
    await anuncio(BRUNO, true)
    await pares(BRUNO)
    vi.mocked(playSound).mockClear()

    await anuncio(BRUNO, false)
    await pares()

    expect(tocou().filter((kind) => kind === "voice-leave")).toHaveLength(1)
  })
})

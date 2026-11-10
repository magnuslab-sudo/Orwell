import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { PREFS_KEY } from "./hooks/usePrefs.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

/**
 * In a community, a report (S4) can arrive before the server event. The
 * session tells both copies to the interface: the one from the report comes without the card
 * thumbnail (it is not signed), the one from the server brings it. Owner report with 1.1.0:
 * "the app still has no YouTube thumbnails in communities". The card showed
 * with the title and the "play", and without the image.
 */

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true }))
})

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const LAGAR = "!lagar:casa.pt"

let setMuted = vi.fn()
let setVisible = vi.fn(async (_visivel: boolean) => ({ ok: true }))
/** The `on.message` for this run: friend requests arrive here. */
let emitir: ((mensagem: unknown) => void) | null = null

function ponte(sobre: Partial<Record<keyof EnclaveBridge, unknown>> = {}): EnclaveBridge {
  setMuted = vi.fn()
  setVisible = vi.fn(async (_visivel: boolean) => ({ ok: true }))
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
      setVisible,
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
      rooms: () => [
        { room: "voz", name: "voz", category: "", kind: "voice", position: 0 },
        { room: "conversa", name: "conversa", category: "", kind: "text", position: 1 },
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
      message: (tratar: (mensagem: unknown) => void) => {
        emitir = tratar
        return () => {}
      },
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
      on: () => () => {},
      setMuted: (calado: boolean) => setMuted(calado),
      setCameraOff: () => {},
      join: async () => ({ ok: true }),
      leave: async () => ({ ok: true }),
      tectoDePartilha: 6,
      podePartilharEcra: false,
    },
    ...sobre,
  } as unknown as EnclaveBridge
}

async function abrirCanal(): Promise<void> {
  await screen.findByRole("button", { name: strings.rail.chat })
  const canal = [...document.querySelectorAll(".channel-row")].find((row) => /lagar/.test(row.textContent ?? ""))
  await act(async () => {
    ;(canal?.querySelector("button") as HTMLElement).click()
    await Promise.resolve()
  })
}

async function abrirSala(nome: RegExp): Promise<void> {
  const linha = [...document.querySelectorAll<HTMLElement>(".room-row")].find((row) => nome.test(row.textContent ?? ""))
  await act(async () => {
    ;(linha?.querySelector("button") ?? linha)?.click()
    await Promise.resolve()
  })
}

const MINIATURA = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ"
const VIDEO = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
const doVideo = (seq: number, comMiniatura: boolean) => ({
  channel: LAGAR,
  seq,
  sender: ANA,
  payload: {
    t: "message",
    id: "video-00001",
    sentAt: 1_700_000_000_000,
    body: `olha-o-video ${VIDEO}`,
    room: "conversa",
    links: [{ url: VIDEO, kind: "video", title: "Big Buck Bunny", siteName: "YouTube", ...(comMiniatura ? { thumbnail: MINIATURA } : {}) }],
  },
})

async function chega(mensagem: unknown): Promise<void> {
  await act(async () => {
    emitir?.(mensagem)
    await Promise.resolve()
  })
}

const linhasDoVideo = () => [...document.querySelectorAll(".message")].filter((linha) => linha.textContent?.includes("olha-o-video"))

describe("o relato chega antes do evento do servidor, numa sala de comunidade", () => {
  it("fica uma linha só, e com a miniatura do servidor", async () => {
    render(<App bridge={ponte()} />)
    await abrirCanal()
    await abrirSala(/conversa/i)
    await chega(doVideo(7, false))
    await chega(doVideo(7, true))
    const linhas = linhasDoVideo()
    expect(linhas).toHaveLength(1)
    expect(linhas[0]!.querySelector(".facade-thumb")?.getAttribute("src")).toBe(MINIATURA)
  })

  it("ao contrário (o servidor primeiro): a miniatura fica", async () => {
    render(<App bridge={ponte()} />)
    await abrirCanal()
    await abrirSala(/conversa/i)
    await chega(doVideo(7, true))
    await chega(doVideo(7, false))
    const linhas = linhasDoVideo()
    expect(linhas).toHaveLength(1)
    expect(linhas[0]!.querySelector(".facade-thumb")?.getAttribute("src")).toBe(MINIATURA)
  })
})

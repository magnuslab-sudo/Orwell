import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { PREFS_KEY, readPrefs } from "./hooks/usePrefs.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

/**
 * The settings changes in 0.9 (phase 4) that live in `App.tsx`: what the saved
 * choice does to the call, presence, and friend requests.
 */

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

afterEach(cleanup)
beforeEach(() => localStorage.clear())

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

function guardar(prefs: Record<string, unknown>): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, ...prefs }))
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

describe("entrar nas chamadas com o microfone silenciado", () => {
  it("ligado, entrar na sala de voz cala o microfone, pelo caminho do cartão", async () => {
    guardar({ entrarSilenciado: true })
    render(<App bridge={ponte()} />)
    await abrirCanal()
    setMuted.mockClear()
    await abrirSala(/voz/i)
    expect(readPrefs().micMuted).toBe(true)
    expect(setMuted).toHaveBeenLastCalledWith(true)
  })

  it("desligado (de fábrica), entrar não mexe no microfone", async () => {
    render(<App bridge={ponte()} />)
    await abrirCanal()
    setMuted.mockClear()
    await abrirSala(/voz/i)
    expect(readPrefs().micMuted).toBe(false)
    expect(setMuted).not.toHaveBeenCalledWith(true)
  })
})

describe("Privacidade › Mostrar quando estou online", () => {
  it('desligado, a presença sai como invisível, com o estado "online" escolhido', async () => {
    guardar({ mostrarOnline: false })
    render(<App bridge={ponte()} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    expect(setVisible).toHaveBeenCalled()
    expect(setVisible.mock.calls.every(([visivel]) => visivel === false)).toBe(true)
  })

  it("ligado (de fábrica), mostra-se", async () => {
    render(<App bridge={ponte()} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    expect(setVisible).toHaveBeenLastCalledWith(true)
  })
})

describe("Privacidade › Quem me pode enviar pedidos de amizade", () => {
  const RUI = "@rui:longe.pt"
  const CONVERSA = moradaDeTeste("directa eu rui", "longe.pt")

  async function chegaPedidoDoRui(): Promise<void> {
    await screen.findByRole("button", { name: strings.rail.chat })
    await act(async () => {
      emitir?.({ channel: CONVERSA, seq: 1, sender: RUI, payload: { t: "friend.request", sentAt: 100 } })
      await Promise.resolve()
    })
  }

  it('"Toda a gente" (de fábrica): o pedido acende o sino', async () => {
    render(<App bridge={ponte()} />)
    await chegaPedidoDoRui()
    expect(screen.getByRole("button", { name: strings.notifCenter.bellWithCount(1) })).toBeTruthy()
  })

  it('"Ninguém": o pedido não acende o sino nem aparece na lista', async () => {
    guardar({ pedidosDeAmizade: "ninguem" })
    render(<App bridge={ponte()} />)
    await chegaPedidoDoRui()
    expect(screen.queryByRole("button", { name: strings.notifCenter.bellWithCount(1) })).toBeNull()
    await act(async () => {
      screen.getByRole("button", { name: strings.notifCenter.bell }).click()
      await Promise.resolve()
    })
    expect(document.querySelectorAll(".notif-list li")).toHaveLength(0)
  })

  it('"Amigos de amigos": quem partilha um canal cabe; um desconhecido não', async () => {
    guardar({ pedidosDeAmizade: "amigos-de-amigos" })
    // Rui is not in Lagar (only Ana): does not fit.
    render(<App bridge={ponte()} />)
    await chegaPedidoDoRui()
    expect(screen.queryByRole("button", { name: strings.notifCenter.bellWithCount(1) })).toBeNull()
    cleanup()

    // With Rui in Lagar, it fits.
    const comORui = ponte()
    ;(comORui.channels as { members: unknown }).members = async () => [EU, ANA, RUI]
    render(<App bridge={comORui} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    // Members load after the session is ready.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    await chegaPedidoDoRui()
    expect(await screen.findByRole("button", { name: strings.notifCenter.bellWithCount(1) })).toBeTruthy()
  })
})

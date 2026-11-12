import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { PREFS_KEY } from "./hooks/usePrefs.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

/**
 * The AFK room across the entire app (2/11/2026): if you are muted in a voice
 * room for the channel duration, you move to the AFK room automatically, see
 * why, and return with one click. The AFK room has no chat.
 *
 * The harness is `App.salaDeTickets.test.tsx`. Time is fake but advances on
 * its own (`shouldAdvanceTime`), so startup promises can run.
 */

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const LAGAR = "!lagar:casa.pt"
const MIN = 60_000

let onCallParticipants: ((event: { participants: unknown[] }) => void) | null = null
let entradas: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] })
  entradas = vi.fn(async () => ({ ok: true }))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
})

function silenciado(micMuted: boolean): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, micMuted, soundOff: false }))
}

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
        { room: "voz", name: "Conversa", category: "", kind: "voice", position: 0 },
        { room: "afk", name: "Dormir", category: "", kind: "voice", position: 1, afk: { minutos: 5 } },
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
      join: entradas,
      leave: async () => ({ ok: true }),
      tectoDePartilha: 6,
      podePartilharEcra: false,
    },
  } as unknown as EnclaveBridge
}

async function abrirSala(nome: RegExp): Promise<void> {
  const linha = [...document.querySelectorAll<HTMLElement>(".room-row")].find((row) => nome.test(row.textContent ?? ""))
  await act(async () => {
    ;(linha?.querySelector("button") ?? linha)?.click()
    await Promise.resolve()
  })
}

async function noCanal(): Promise<void> {
  render(<App bridge={ponte()} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  const canal = [...document.querySelectorAll(".channel-row")].find((row) => /lagar/.test(row.textContent ?? ""))
  await act(async () => {
    ;(canal?.querySelector("button") as HTMLElement).click()
    await Promise.resolve()
  })
}

const salasPedidas = (): string[] => entradas.mock.calls.map((chamada) => (chamada[1] as { room?: string } | undefined)?.room ?? "")

async function esperar(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
  })
}

describe("a sala AFK na aplicação", () => {
  it("a barra lateral marca a sala AFK", async () => {
    silenciado(false)
    await noCanal()
    const linha = [...document.querySelectorAll<HTMLElement>(".room-row")].find((row) => /Dormir/.test(row.textContent ?? ""))
    expect(linha?.classList.contains("sala-afk")).toBe(true)
    expect(linha?.querySelector(".marca-afk")?.textContent).toBe(strings.salaAfk.marca)
  })

  it('silenciado o tempo do canal, a chamada passa para a sala AFK, com aviso e "Voltar"', async () => {
    silenciado(true)
    await noCanal()
    await abrirSala(/Conversa/)
    expect(salasPedidas()).toEqual(["voz"])

    await esperar(5 * MIN - 1_000)
    expect(salasPedidas()).toEqual(["voz"])
    await esperar(1_000)
    expect(salasPedidas()).toEqual(["voz", "afk"])

    // The view was on the call and follows it: the notice appears in the panel.
    const aviso = await screen.findByText(strings.salaAfk.movido(5))
    expect(aviso).toBeTruthy()

    await act(async () => {
      screen.getByRole("button", { name: strings.salaAfk.voltarPara("Conversa") }).click()
      await Promise.resolve()
    })
    expect(salasPedidas()).toEqual(["voz", "afk", "voz"])
    expect(screen.queryByText(strings.salaAfk.movido(5))).toBeNull()
  })

  it("com o microfone ligado, nada acontece", async () => {
    silenciado(false)
    await noCanal()
    await abrirSala(/Conversa/)
    await esperar(60 * MIN)
    expect(salasPedidas()).toEqual(["voz"])
  })

  it("a sala AFK não tem conversa nem caixa de escrita, e o painel não tem voz", async () => {
    silenciado(false)
    await noCanal()
    await abrirSala(/Dormir/)
    await act(async () => {
      onCallParticipants?.({ participants: [{ address: ANA, connected: true, stream: null, video: false }] })
      await Promise.resolve()
    })
    expect(screen.getAllByText(strings.salaAfk.semVozNemTexto).length).toBeGreaterThan(0)
    expect(document.querySelector(".composer, textarea")).toBeNull()
    // In the call panel (the account banner at the bottom of the column has its own).
    const painel = document.querySelector<HTMLElement>(".call-barra")
    expect(painel).not.toBeNull()
    expect(painel?.querySelector(`[aria-label="${strings.call.micAria(false)}"]`)).toBeNull()
  })
})

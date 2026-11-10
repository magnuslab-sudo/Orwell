import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

/**
 * The call window in the shell (visual phase, agent H).
 *
 * A voice room call shows when THAT room is open, and there it
 * takes the main area. In another room on the same channel, whoever shows it and plays
 * the sound is the "Connected · room" card in the sidebar (wide screen) or the
 * compact bar that floats (narrow). There is always one sound owner, and only one.
 */

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

let largo = false
const matchMediaOriginal = window.matchMedia
afterEach(() => {
  cleanup()
  largo = false
  window.matchMedia = matchMediaOriginal
})

/** The `matchMedia` of jsdom does not exist: one that responds to the 840px breakpoint. */
function ecraLargo(): void {
  largo = true
  window.matchMedia = ((consulta: string) => ({
    matches: largo && consulta.includes("min-width: 841px"),
    media: consulta,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const LAGAR = "!lagar:casa.pt"

let onCallParticipants: ((event: { participants: unknown[] }) => void) | null = null
/** The `leave` of the bridge for this run: navigating can never call it. */
let sair: ReturnType<typeof vi.fn> = vi.fn()

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
      /* A voice room and a text one: the minimum pair for the Discord-like window. */
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
      leave: (sair = vi.fn(async () => ({ ok: true }))),
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


/** How many sound owners are there: the panel (`.call-video`) and the docks (`.call-dock-audio`). */
const donosDoSom = (): number => document.querySelectorAll(".call-video, .call-dock-audio").length

describe("a janela da chamada na concha", () => {
  it("na sala de voz, a chamada ocupa a área principal e esconde a conversa", async () => {
    await comChamadaAberta()
    expect(document.querySelector("section.call.call-sala")).toBeTruthy()
    expect(document.querySelector(".main.com-sala")).toBeTruthy()
    expect(donosDoSom()).toBe(1)
  })

  it("noutra sala, a chamada sai da área principal e a doca toca o som", async () => {
    await comChamadaAberta()
    await abrirSala(/conversa/i)
    expect(document.querySelector("section.call")).toBeNull()
    expect(document.querySelector(".call-dock:not(.lateral) .call-dock-audio")).toBeTruthy()
    expect(donosDoSom()).toBe(1)
  })

  it("em ecrã largo é o cartão da barra lateral, sempre à vista e com som só fora da sala", async () => {
    ecraLargo()
    await comChamadaAberta()
    const lateral = (): Element | null => document.querySelector(".sidebar .call-dock.lateral")
    expect(lateral()).toBeTruthy()
    expect(lateral()?.querySelector(".call-dock-audio")).toBeNull()
    expect(donosDoSom()).toBe(1)

    await abrirSala(/conversa/i)
    expect(lateral()?.querySelector(".call-dock-audio")).toBeTruthy()
    expect(document.querySelector(".call-dock:not(.lateral)")).toBeNull()
    expect(donosDoSom()).toBe(1)

    // Going back via the dock takes you to the ROOM of the call.
    await act(async () => {
      screen.getByRole("button", { name: strings.callDock.back }).click()
      await Promise.resolve()
    })
    expect(document.querySelector("section.call.call-sala")).toBeTruthy()
  })

  it('"Ver só o palco" esconde as barras, e o Esc devolve-as', async () => {
    await comChamadaAberta()
    await act(async () => {
      screen.getByRole("button", { name: strings.call.soPalco }).click()
      await Promise.resolve()
    })
    expect(document.querySelector(".app.so-palco")).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.call.soPalco }).getAttribute("aria-pressed")).toBe("true")
    fireEvent.keyDown(window, { key: "Escape" })
    expect(document.querySelector(".app.so-palco")).toBeNull()
  })

  /*
    Bug in 0.8.0, from the owner: "when users navigate to settings, the
    call disappears". Open Settings with the call live: the call does not
    end, the sound continues with one owner, and the call card is there.
  */
  it.each([
    ["estreito", false],
    ["largo", true],
  ])("em ecrã %s, abrir Configurações não larga a chamada nem o som", async (_nome, largoAqui) => {
    if (largoAqui) ecraLargo()
    await comChamadaAberta()
    await act(async () => {
      screen.getByRole("button", { name: strings.rail.settings }).click()
      await Promise.resolve()
    })
    expect(document.querySelector("section.call")).toBeNull()
    expect(sair).not.toHaveBeenCalled()
    expect(donosDoSom()).toBe(1)
    // Ana still has somewhere to tap: our box and hers.
    expect(document.querySelectorAll(".call-dock-audio video")).toHaveLength(2)
    const cartao = document.querySelector(largoAqui ? ".sidebar .call-dock.lateral" : ".call-dock:not(.lateral)")
    expect(cartao).toBeTruthy()

    // And the card takes you back to the call room.
    await act(async () => {
      screen.getByRole("button", { name: strings.callDock.back }).click()
      await Promise.resolve()
    })
    expect(document.querySelector("section.call.call-sala")).toBeTruthy()
    expect(donosDoSom()).toBe(1)
  })

  it('"Conversa da sala" devolve a conversa da sala de voz, com a chamada por cima', async () => {
    await comChamadaAberta()
    await act(async () => {
      screen.getByRole("button", { name: strings.call.conversaDaSala }).click()
      await Promise.resolve()
    })
    expect(document.querySelector(".main.com-sala")).toBeNull()
    expect(document.querySelector("section.call.call-faixa")).toBeTruthy()
  })
})

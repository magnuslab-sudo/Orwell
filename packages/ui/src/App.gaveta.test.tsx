import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ChannelRoom, ConnectionState, EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { APRESENTADOS_KEY } from "./hooks/usePrefs.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

afterEach(cleanup)

const EU = "@eu:casa.pt"
/** A channel with rooms: this is the one with more to say in the drawer. */
const LAGAR = "!lagar:casa.pt"
/** A channel with no rooms: just one conversation, and the drawer has nothing left to add. */
const ADEGA = "!adega:casa.pt"
/**
 * A channel from which no room has arrived yet: the vault has no declaration of
 * it. It is the common room for someone who just entered, before someone passes
 * the rooms to them (owner report, 2/11/2026).
 */
const VINHA = "!vinha:casa.pt"

/**
 * The channel drawer, by touch.
 *
 * This is the complaint Duarte brought from the phone: "you cannot see the
 * various channels or the rooms". No button was missing. What there was were
 * two halves canceling each other out: rooms in a channel draw below the OPEN
 * channel, and touching a channel CLOSED the drawer. Opening the drawer,
 * touching the channel to see its rooms, and the drawer left the screen before
 * the tree appeared. The natural reading of that is "this channel has no rooms".
 *
 * And the opposite was equally swapped: touching a ROOM closed nothing, and the
 * conversation opened behind an opaque 280px panel.
 *
 * What these tests bind is the entire path, both ways. In jsdom there are no
 * media queries, the drawer is always a drawer here, and what is observed is
 * the `open` class, which is the same one the CSS reads to make it slide. The
 * path at 390px with real touches is in `scripts/e2e-telemovel.mjs`.
 */
const SALAS: Record<string, ChannelRoom[]> = {
  [LAGAR]: [
    { room: "", name: "geral", category: "", kind: "text", position: 0 },
    { room: "prensa", name: "prensa", category: "", kind: "text", position: 1 },
  ],
  [ADEGA]: [{ room: "", name: "geral", category: "", kind: "text", position: 0 }],
}

let onConnection: ((payload: unknown) => void) | null = null

function ponte(): EnclaveBridge {
  onConnection = null
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
      list: async () => [LAGAR, ADEGA, VINHA],
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
      rooms: (channel: string) => SALAS[channel] ?? [],
      closedRooms: () => [],
      categories: () => [],
      mayEdit: () => false,
      rolesFor: () => [],
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
      connection: (handler: (payload: unknown) => void) => {
        onConnection = handler
        return () => {
          onConnection = null
        }
      },
      channels: () => () => {},
      presence: () => () => {},
      typing: () => () => {},
      buzz: () => () => {},
      callActivity: () => () => {},
    },
    call: { on: () => () => {}, setMuted: () => {} },
  } as unknown as EnclaveBridge
}

/** Is the drawer closed? It is the same class the CSS reads to make it slide. */
function gavetaAberta(): boolean {
  return document.querySelector(".sidebar")?.classList.contains("open") ?? false
}

/** The line of a channel, by the name that reads in it. */
function linhaDoCanal(nome: RegExp): HTMLElement {
  const linha = [...document.querySelectorAll(".channel-row")].find((row) => nome.test(row.textContent ?? ""))
  return linha?.querySelector("button.channel") as HTMLElement
}

/** Room names drawn in the tree, in order. */
function salasVisiveis(): string[] {
  return [...document.querySelectorAll(".room-tree .room-name")].map((nome) => nome.textContent ?? "")
}

async function abrirAplicacao(): Promise<ReturnType<typeof userEvent.setup>> {
  localStorage.setItem(APRESENTADOS_KEY, JSON.stringify([LAGAR, ADEGA, VINHA]))
  const user = userEvent.setup()
  render(<App bridge={ponte()} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  await act(async () => {
    onConnection?.({ state: "online" as ConnectionState })
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })
  return user
}

describe("a gaveta dos canais, ao dedo", () => {
  it("tocar num canal com salas mostra as salas e a gaveta FICA", async () => {
    const user = await abrirAplicacao()

    await user.click(screen.getByRole("button", { name: strings.rail.menu }))
    expect(gavetaAberta()).toBe(true)

    await user.click(linhaDoCanal(/lagar/))

    // Two halves of the complaint, measured together: the tree appeared, and it
    // appeared with the drawer still on screen so it could be tapped.
    expect(salasVisiveis()).toContain("prensa")
    expect(gavetaAberta()).toBe(true)
  })

  it("tocar numa sala fecha a gaveta: é o fim do percurso", async () => {
    const user = await abrirAplicacao()

    await user.click(screen.getByRole("button", { name: strings.rail.menu }))
    await user.click(linhaDoCanal(/lagar/))
    expect(gavetaAberta()).toBe(true)

    const prensa = [...document.querySelectorAll(".room-tree button.room")].find((botao) =>
      /prensa/.test(botao.textContent ?? ""),
    )
    await user.click(prensa as HTMLElement)

    expect(gavetaAberta()).toBe(false)
  })

  it("tocar num canal SEM salas fecha a gaveta: ele já não tem nada a dizer", async () => {
    const user = await abrirAplicacao()

    await user.click(screen.getByRole("button", { name: strings.rail.menu }))
    expect(gavetaAberta()).toBe(true)

    await user.click(linhaDoCanal(/adega/))

    expect(gavetaAberta()).toBe(false)
  })

  it("tocar num canal cujas salas ainda não chegaram deixa a gaveta aberta", async () => {
    /*
      Owner report on 2/11/2026: "rooms show on the phone but are not
      visually visible.. the column disappears". Someone enters the common room and taps
      it before the rooms arrive. The vault knows no room yet, and the
      rule reads this as "channel with no rooms" and closed the drawer. The rooms arrived
      an instant later, with the drawer already off screen.
    */
    const user = await abrirAplicacao()

    await user.click(screen.getByRole("button", { name: strings.rail.menu }))
    await user.click(linhaDoCanal(/vinha/))

    expect(gavetaAberta()).toBe(true)
  })

  it("e o hambúrguer continua a abrir e a fechar a gaveta", async () => {
    const user = await abrirAplicacao()
    const menu = screen.getByRole("button", { name: strings.rail.menu })

    await user.click(menu)
    expect(gavetaAberta()).toBe(true)
    await user.click(menu)
    expect(gavetaAberta()).toBe(false)
  })
})

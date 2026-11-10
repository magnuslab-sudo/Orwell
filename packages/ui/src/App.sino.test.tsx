import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

/**
 * The person's page, when it opens. It is the main region (`<main>`) that takes
 * the place of the destination; it is no longer a dialog.
 */
function paginaDaPessoa(): Promise<HTMLElement> {
  return vi.waitFor(() => {
    const pagina = document.querySelector<HTMLElement>("main.pagina-da-pessoa")
    if (!pagina) throw new Error("a página da pessoa ainda não abriu")
    return pagina
  })
}

afterEach(cleanup)

const EU = "@eu:casa.pt"
const LAGAR = "!lagar:casa.pt"

/**
 * The bell said "Nothing here. Good sign." when the vault refused to open.
 *
 * The notification list lives in the vault and is read once per unlock. If that
 * read fails, the shell does the right thing inside: it logs it, and does NOT
 * mark the list as loaded, that guard prevents the next write from putting a
 * one-item list on top of fifty. What it never did was say so. On screen, a
 * failed read and an empty vault looked the same, and the screen was the empty
 * vault one.
 *
 * This measures the connection: the bridge refuses, the bell opens, and what is
 * written there is the truth and not its opposite.
 */

function ponte(
  list: () => Promise<unknown[]>,
  emitRef?: { current: ((message: unknown) => void) | null },
  statusRef?: { current: ((status: unknown) => void) | null },
): EnclaveBridge {
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
      deafChannels: async () => [],
      feedChannel: async () => MURAL_EU,
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => ({}),
    },
    notifications: { list, save: async () => ({ ok: true }) },
    on: {
      message: (handler: (message: unknown) => void) => {
        if (emitRef) emitRef.current = handler
        return () => {}
      },
      epoch: () => () => {},
      status: (handler: (status: unknown) => void) => {
        if (statusRef) statusRef.current = handler
        return () => {}
      },
      connection: () => () => {},
      channels: () => () => {},
      presence: () => () => {},
      typing: () => () => {},
      buzz: () => () => {},
      callActivity: () => () => {},
    },
    call: { on: () => () => {}, setMuted: () => {} },
  } as unknown as EnclaveBridge
}

/** Open the app and tap the bell, like someone going to see what they missed. */
async function abrirSino(list: () => Promise<unknown[]>): Promise<void> {
  const user = userEvent.setup()
  render(<App bridge={ponte(list)} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  await user.click(screen.getByRole("button", { name: strings.notifCenter.bell }))
}

describe("o sino, quando o cofre não se deixa ler", () => {
  it("diz que não conseguiu ler, em vez de dizer que não há nada", async () => {
    await abrirSino(async () => Promise.reject(new Error("cofre fechado")))
    expect(await screen.findByText(strings.notifCenter.falhou)).toBeTruthy()
    expect(screen.queryByText(strings.notifCenter.empty)).toBeNull()
  })

  it("com o cofre a abrir e nada lá dentro, continua a ser bom sinal", async () => {
    await abrirSino(async () => [])
    expect(await screen.findByText(strings.notifCenter.empty)).toBeTruthy()
    expect(screen.queryByText(strings.notifCenter.falhou)).toBeNull()
  })
})

/**
 * The request that arrives while the vault is still being read.
 *
 * **This is the bug we caught using the app for real.** Account closed, friend
 * request sent, account opening: you heard the sound and the bell was empty.
 * Reloading did not bring it, on a later open the message comes from local
 * storage and does not go through the path that creates alerts. The request
 * existed only in the "Pending" tab in Friends, which is half of what the owner
 * asked for: "the visibility and interactivity of the friend request must be in
 * notifications (...) and in friends".
 *
 * The cause was not in the bell or the request: vault reading is asynchronous
 * and the catch delivers late messages in the same window, and the read was
 * writing its list ON TOP of what had arrived meanwhile.
 *
 * This reproduces the real race: vault reading takes time, and the message
 * arrives before it answers.
 */
describe("o sino e o que chega enquanto ele carrega", () => {
  const ANA = "@ana:casa.pt"
  const CONVERSA = moradaDeTeste("directa ana eu", "casa.pt")

  it("um pedido de amizade que chegue durante a leitura do cofre não se perde", async () => {
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    let abrirCofre: (() => void) | null = null
    const list = (): Promise<unknown[]> =>
      new Promise((resolve) => {
        abrirCofre = () => resolve([])
      })

    render(<App bridge={ponte(list, emitRef)} />)
    await screen.findByRole("button", { name: strings.rail.chat })

    // The catch delivers the request with the vault read still pending.
    await act(async () => {
      emitRef.current?.({
        channel: CONVERSA,
        seq: 1,
        sender: ANA,
        payload: { t: "friend.request", sentAt: 100 },
      })
    })
    await act(async () => {
      abrirCofre?.()
      await Promise.resolve()
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: strings.notifCenter.bellWithCount(1) }))
    // One line in the bell, not the empty screen we saw.
    expect(document.querySelectorAll(".notif-list li")).toHaveLength(1)
    expect(screen.queryByText(strings.notifCenter.empty)).toBeNull()
  })
})

/**
 * Tapping a friend request goes to the requests.
 *
 * The `friend-request` branch only changed the destination to Friends and left
 * the tab where it was. Anyone coming from "Everyone", or with a chat open, hit
 * a screen with no request in sight, and the tap looked like it did nothing.
 */
describe("o sino e o pedido de amizade", () => {
  const ANA = "@ana:casa.pt"
  const CONVERSA = moradaDeTeste("directa ana eu", "casa.pt")

  it("abre Amigos no separador Recebidos", async () => {
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    render(<App bridge={ponte(async () => [], emitRef)} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    await act(async () => {
      emitRef.current?.({ channel: CONVERSA, seq: 1, sender: ANA, payload: { t: "friend.request", sentAt: 100 } })
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: strings.notifCenter.bellWithCount(1) }))
    await user.click(document.querySelector(".notif-list li button") as HTMLElement)

    // Looked up by name: the Friends button in the bar is also lit.
    const pendentes = await screen.findByRole("button", { name: new RegExp(strings.people.tab.recebidos) })
    expect(pendentes.getAttribute("aria-current")).toBe("page")
  })
})

/**
 * The canceled request leaves the bell, with no news.
 *
 * On the other end comes a `status` with `code: "friend-withdrawn"` and the
 * `actor`. The `friend-request` entry for that person is no longer there: a
 * request that no longer exists has nothing to answer. And no new entry appears,
 * like in a refusal.
 */
describe("o sino e o pedido cancelado", () => {
  const ANA = "@ana:casa.pt"
  const CONVERSA = moradaDeTeste("directa ana eu", "casa.pt")

  it("friend-withdrawn tira o pedido dessa pessoa do sino", async () => {
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    const statusRef: { current: ((status: unknown) => void) | null } = { current: null }
    render(<App bridge={ponte(async () => [], emitRef, statusRef)} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    await act(async () => {
      emitRef.current?.({ channel: CONVERSA, seq: 1, sender: ANA, payload: { t: "friend.request", sentAt: 100 } })
    })
    expect(screen.getByRole("button", { name: strings.notifCenter.bellWithCount(1) })).toBeTruthy()

    await act(async () => {
      statusRef.current?.({
        detail: "friend request withdrawn",
        level: "info",
        code: "friend-withdrawn",
        route: "log",
        channel: CONVERSA,
        actor: ANA,
      })
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: strings.notifCenter.bell }))
    expect(document.querySelectorAll(".notif-list li")).toHaveLength(0)
  })
})

/** "Accepted" opens the profile of who accepted, not the feed. */
describe("o sino e a amizade aceite", () => {
  const ANA = "@ana:casa.pt"
  const CONVERSA = moradaDeTeste("directa ana eu", "casa.pt")

  it("carregar em friend-accept abre a página de perfil dessa pessoa", async () => {
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    render(<App bridge={ponte(async () => [], emitRef)} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    await act(async () => {
      emitRef.current?.({ channel: CONVERSA, seq: 1, sender: ANA, payload: { t: "friend.accept", acceptedAt: 100 } })
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: strings.notifCenter.bellWithCount(1) }))
    await user.click(document.querySelector(".notif-list li button") as HTMLElement)
    const pagina = await paginaDaPessoa()
    expect(screen.queryByRole("dialog")).toBeNull()
    // The page is Ana's: the full id is in the copy button, not in the text.
    // Without a profile, the name is the address word ("Ana"), not "No name" any
    // more (owner order on November 4, 2026).
    expect(pagina.textContent).not.toContain(ANA)
    expect(within(pagina).getByRole("button", { name: strings.copiarId.de("Ana") })).toBeTruthy()
  })
})

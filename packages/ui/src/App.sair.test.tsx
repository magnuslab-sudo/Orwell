import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const EU = "@eu:casa.pt"
const LAGAR = "!lagar:casa.pt"

/**
 * "Leave channel" leaves the channel for real.
 *
 * It called `channels.forget`, which only erased the channel from this device:
 * the leaf stayed in the MLS tree and others kept seeing the person in the list
 * forever. Now it calls `channels.leave`, which publishes the exit. Without
 * connection the exit does not go out, and the UI offers to forget from this
 * device only, with the notice that says what that means.
 */

function ponte(leave: ReturnType<typeof vi.fn>, forget: ReturnType<typeof vi.fn>): EnclaveBridge {
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
      forget,
      leave,
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
    call: { on: () => () => {}, setMuted: () => {} },
  } as unknown as EnclaveBridge
}

/** Open the channel menu and tap "Leave channel". */
async function sairPeloMenu(
  leave: ReturnType<typeof vi.fn>,
  forget: ReturnType<typeof vi.fn>,
): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  render(<App bridge={ponte(leave, forget)} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  const linha = [...document.querySelectorAll(".channel-row")].find((row) => /lagar/.test(row.textContent ?? ""))
  fireEvent.contextMenu(linha?.querySelector("button") as HTMLElement)
  await user.click(screen.getByRole("menuitem", { name: strings.menu.leave }))
  return user
}

/**
 * Reply to the "Confirm" with this title: with the verb, or Cancel.
 * Returns the body of the question, which is what some tests read.
 */
async function responder(
  user: ReturnType<typeof userEvent.setup>,
  titulo: string,
  botao: string,
): Promise<string> {
  const pergunta = await screen.findByRole("alertdialog", { name: titulo })
  const corpo = pergunta.textContent ?? ""
  await user.click(within(pergunta).getByRole("button", { name: botao }))
  return corpo
}

describe("sair do canal", () => {
  it("chama leave e não forget", async () => {
    const leave = vi.fn().mockResolvedValue({ ok: true })
    const forget = vi.fn().mockResolvedValue({ ok: true })
    const user = await sairPeloMenu(leave, forget)
    // Nothing goes out before the "yes": the question is open and nobody called anything.
    expect(leave).not.toHaveBeenCalled()
    await responder(user, strings.chat.leaveTitle, strings.menu.leave)

    await waitFor(() => expect(leave).toHaveBeenCalledWith(LAGAR))
    expect(forget).not.toHaveBeenCalled()
    expect(await screen.findByText(strings.chat.left)).toBeTruthy()
  })

  it("nunca usa o confirm nativo, que no Electron bloqueia a janela", async () => {
    const nativo = vi.spyOn(window, "confirm")
    const leave = vi.fn().mockResolvedValue({ ok: true })
    const forget = vi.fn().mockResolvedValue({ ok: true })
    const user = await sairPeloMenu(leave, forget)
    await responder(user, strings.chat.leaveTitle, strings.menu.leave)

    await waitFor(() => expect(leave).toHaveBeenCalled())
    expect(nativo).not.toHaveBeenCalled()
  })

  it("quem desiste no aviso não sai", async () => {
    const leave = vi.fn().mockResolvedValue({ ok: true })
    const forget = vi.fn().mockResolvedValue({ ok: true })
    const user = await sairPeloMenu(leave, forget)
    await responder(user, strings.chat.leaveTitle, strings.confirmar.cancelar)

    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(leave).not.toHaveBeenCalled()
    expect(forget).not.toHaveBeenCalled()
  })

  it("sem ligação, oferece sair só deste aparelho com o aviso de forget", async () => {
    const leave = vi.fn().mockRejectedValue(new Error("the server did not confirm the send"))
    const forget = vi.fn().mockResolvedValue({ ok: true })
    const user = await sairPeloMenu(leave, forget)
    await responder(user, strings.chat.leaveTitle, strings.menu.leave)

    // The second notice says why it failed, with a code, and what forgetting means.
    const segundo = await responder(user, strings.chat.leaveOfflineTitle, strings.chat.leaveOnlyHereAction)
    expect(segundo).toContain("Erro 205")
    expect(segundo).toContain(strings.chat.leaveOffline)
    await waitFor(() => expect(forget).toHaveBeenCalledWith(LAGAR))
    // And what got done was forget, not leave: the message cannot say "you left".
    expect(await screen.findByText(strings.chat.forgottenHere)).toBeTruthy()
    expect(screen.queryByText(strings.chat.left)).toBeNull()
  })

  it("sem ligação, quem recusa o segundo aviso fica com o canal", async () => {
    const leave = vi.fn().mockRejectedValue(new Error("the server did not confirm the send"))
    const forget = vi.fn().mockResolvedValue({ ok: true })
    const user = await sairPeloMenu(leave, forget)
    await responder(user, strings.chat.leaveTitle, strings.menu.leave)
    await responder(user, strings.chat.leaveOfflineTitle, strings.confirmar.cancelar)

    expect(leave).toHaveBeenCalledOnce()
    expect(forget).not.toHaveBeenCalled()
  })
})

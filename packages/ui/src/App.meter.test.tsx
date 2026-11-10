import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

afterEach(cleanup)

const EU = "@eu:casa.pt"
const LAGAR = "!lagar:casa.pt"
const QUEM = "@ana:casa.pt"

/**
 * "Add already": the mode of the invite sheet that does not ask permission.
 *
 * It was its own entry in the channel menu ("Add to channel"), with its own prompt.
 * It became one of three modes of `ConvidarSheet`, opened by the entry "Invite...".
 * What this file catches stays the same: the gesture reaches the core with the channel
 * FROM THE MENU, and the app says what it did.
 *
 * The story of the two bugs that made it exist stays, because that is why
 * it exists:
 *
 * Two bugs on the same path, both born with the feature and both invisible
 * to whoever reads the code from outside.
 *
 * **The entry had no text.** `menuItems.ts` asked for `strings.menu.seat`, and
 * the phrase was written in `chat.seat`, which nobody reads. A missing key is
 * `undefined`, and `undefined` in JSX does not crash or write anything: the menu
 * drew a clickable line in white. It is caught in `menuItems.test.ts`.
 *
 * **And the gesture fired before there was a promise.** The `onSubmit` called
 * `bridge.people.repairInvite`, and `bridge.people` does not exist. It is not a request
 * that fails and shows the error: it is a `TypeError` thrown inside the handler, before
 * there is a promise to hang a `catch` on. The sheet closed, nothing happened,
 * and the only mark was a red line in the console. The `typecheck` said it two commits
 * ago, and it was red.
 *
 * This file measures the edge that matters to whoever uses it: type an address,
 * confirm, and the app DOES something and SAYS it did.
 */

function ponte(repairInvite: ReturnType<typeof vi.fn>): EnclaveBridge {
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
      // The responsibility that makes the entry appear in the menu.
      mayInvite: () => true,
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
      repairInvite,
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

/** Open the channel menu by right-click, like you do live. */
async function menuDoCanal(repairInvite: ReturnType<typeof vi.fn>): Promise<void> {
  render(<App bridge={ponte(repairInvite)} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  const linha = [...document.querySelectorAll(".channel-row")].find((row) => /lagar/.test(row.textContent ?? ""))
  fireEvent.contextMenu(linha?.querySelector("button") as HTMLElement)
}

/** From the channel menu to the sheet, in "Add already" mode, with the address written. */
async function meter(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("menuitem", { name: strings.menu.invite }))
  const modos = screen.getByRole("group", { name: strings.convidar.modosLabel })
  await user.click(within(modos).getByRole("button", { name: strings.convidar.modoMeter }))
  await user.type(screen.getByLabelText(strings.prompts.personLabel), QUEM)
  const accao = document.querySelector(".convidar .sheet-actions") as HTMLElement
  await user.click(within(accao).getByRole("button", { name: strings.convidar.meterAccao }))
}

describe("meter alguém no canal", () => {
  it("a entrada do menu tem palavras, e a folha tem o modo", async () => {
    const user = userEvent.setup()
    const repairInvite = vi.fn().mockResolvedValue({ invited: true, outcome: "invited" })
    await menuDoCanal(repairInvite)
    // Searched by NAME and not by position: an entry with no text does not
    // get found this way, and that was exactly what was on screen.
    await user.click(screen.getByRole("menuitem", { name: strings.menu.invite }))
    const modos = screen.getByRole("group", { name: strings.convidar.modosLabel })
    expect(within(modos).getByRole("button", { name: strings.convidar.modoMeter })).toBeTruthy()
  })

  it("escrever o endereço e confirmar chega mesmo ao núcleo", async () => {
    const user = userEvent.setup()
    const repairInvite = vi.fn().mockResolvedValue({ invited: true, outcome: "invited" })
    await menuDoCanal(repairInvite)

    await meter(user)

    // `force` true: add is the gesture that does not ask the rate limiter.
    expect(repairInvite).toHaveBeenCalledWith(LAGAR, QUEM, true)
  })

  it("e a aplicação diz o que aconteceu, em vez de fechar a folha em silêncio", async () => {
    const user = userEvent.setup()
    const repairInvite = vi.fn().mockResolvedValue({ invited: true, outcome: "invited" })
    await menuDoCanal(repairInvite)

    await meter(user)

    expect(await screen.findByText(strings.prompts.seatDone)).toBeTruthy()
  })

  it("quem já lá estava lê-o dito assim, e não como se tivesse entrado agora", async () => {
    const user = userEvent.setup()
    const repairInvite = vi.fn().mockResolvedValue({ invited: false, outcome: "live" })
    await menuDoCanal(repairInvite)

    await meter(user)

    expect(await screen.findByText(strings.prompts.seatAlready)).toBeTruthy()
  })

  it("um pedido recusado é dito, e não engolido", async () => {
    const user = userEvent.setup()
    const repairInvite = vi.fn().mockRejectedValue(new Error("não tens a responsabilidade de convidar"))
    await menuDoCanal(repairInvite)

    await meter(user)

    expect(await screen.findByText(/responsabilidade de convidar/)).toBeTruthy()
  })
})

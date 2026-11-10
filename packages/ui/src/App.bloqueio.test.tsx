import { moradaDeTeste } from "../testes/moradas.js"
import type { FichaDoCanal } from "@enclave/client-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"

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

const MEU_FEED = moradaDeTeste("mural eu", "casa.pt")
/** The card of each channel (1.0 "Arca", slice 6b), for the false bridge to give to the interface. */
const FICHAS = (): Record<string, FichaDoCanal> => ({
  [CONVERSA]: { tipo: "directa", par: "@ana:casa.pt" },
  [MEU_FEED]: { tipo: "mural", dono: "@eu:casa.pt" },
})
const LAGAR = "!lagar:casa.pt"
const ANA = "@ana:casa.pt"
const CONVERSA = moradaDeTeste("directa ana eu", "casa.pt")

function ponteBase(
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
        fichas: FICHAS,
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
      feedChannel: async () => MEU_FEED,
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


/** The same bridge as the bell, with Ana blocked on this device and her direct link in the list. */
function ponte(emitRef: { current: ((message: unknown) => void) | null }): EnclaveBridge {
  const base = ponteBase(async () => [], emitRef) as unknown as {
    channels: Record<string, unknown>
    social: Record<string, unknown>
  }
  base.channels.list = async () => [LAGAR, CONVERSA]
  base.channels.members = async () => [EU, ANA]
  base.social.blocked = vi.fn(async () => [{ address: ANA, at: 1 }])
  base.social.block = vi.fn(async () => ({ ok: true }))
  base.social.unblock = vi.fn(async () => ({ ok: true }))
  base.social.openDirect = vi.fn(async () => CONVERSA)
  return base as unknown as EnclaveBridge
}

/**
 * A pending request from someone I blocked does not ask for a response anywhere: it
 * does not count in the Friends badge, does not appear in the bell, does not put
 * the card with "Accept" in the direct conversation. Filtered at the source (`openRequests`).
 */
describe("bloqueado com pedido pendente", () => {
  async function montar(): Promise<ReturnType<typeof userEvent.setup>> {
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    render(<App bridge={ponte(emitRef)} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    // The blocked list comes from the bridge after the vault opens.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    await act(async () => {
      emitRef.current?.({ channel: CONVERSA, seq: 1, sender: ANA, payload: { t: "friend.request", sentAt: 100 } })
    })
    return userEvent.setup()
  }

  it("o sino não o mostra nem o conta", async () => {
    const user = await montar()
    expect(screen.queryByRole("button", { name: strings.notifCenter.bellWithCount(1) })).toBeNull()
    await user.click(screen.getByRole("button", { name: strings.notifCenter.bell }))
    expect(document.querySelectorAll(".notif-list li")).toHaveLength(0)
  })

  it("o crachá de Recebidos não o conta", async () => {
    const user = await montar()
    await user.click(screen.getByRole("button", { name: strings.rail.people }))
    await screen.findByRole("navigation", { name: strings.people.tabsLabel })
    expect(screen.queryByLabelText(strings.people.pendingCount(1))).toBeNull()
  })

  it('a directa não traz o cartão com "Aceitar", e fica trancada', async () => {
    const user = await montar()
    await user.click(screen.getByRole("button", { name: strings.rail.people }))
    const coluna = await screen.findByRole("complementary", { name: strings.people.asideLabel })
    const linha = coluna.querySelector(".direct-row") as HTMLElement
    await user.click(within(linha).getAllByRole("button")[0] as HTMLElement)
    expect(await screen.findByText(strings.people.escritaBloqueado)).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.people.accept })).toBeNull()
    // Blocking is not talking: no "Call" or "Video" in the header.
    expect(screen.queryByRole("button", { name: strings.chat.call })).toBeNull()
    expect(screen.queryByRole("button", { name: strings.chat.video })).toBeNull()
  })
})

/** The friendship link with which the page opened, after the gate. */
describe("o link de amizade de arranque", () => {
  function ponteSimples(shownFriendsOf = vi.fn(async () => ({ shown: ["@zoe:casa.pt"], updatedAt: 1 }))): EnclaveBridge {
    const base = ponteBase(async () => []) as unknown as { social: Record<string, unknown> }
    base.social.shownFriendsOf = shownFriendsOf
    return base as unknown as EnclaveBridge
  }

  it("uma conta de outro servidor dá o aviso, e não abre folha com um botão que falha", async () => {
    const forget = vi.fn()
    render(<App bridge={ponteSimples()} startupFriend={{ address: "@rui:outro.pt", invalid: false, forget }} />)
    expect(await screen.findByText(strings.people.friendLinkOtherServer)).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(forget).toHaveBeenCalled()
  })

  it("do mesmo servidor abre a página; a quem não é amigo não se pede nem se mostra a lista dele", async () => {
    const shownFriendsOf = vi.fn(async () => ({ shown: ["@zoe:casa.pt"], updatedAt: 1 }))
    render(<App bridge={ponteSimples(shownFriendsOf)} startupFriend={{ address: "@rui:casa.pt", invalid: false, forget: vi.fn() }} />)
    const pagina = await paginaDaPessoa()
    expect(within(pagina).getByRole("button", { name: strings.userMenu.friend })).toBeTruthy()
    // The tab exists, and says only that the list is for friends: there is no list.
    await userEvent.setup().click(within(pagina).getByRole("tab", { name: new RegExp(strings.personProfile.friendsTab) }))
    const nome = within(pagina).getByRole("heading", { level: 1 }).textContent ?? ""
    expect(within(pagina).getByText(strings.personProfile.friendsOnlyFriends(nome))).toBeTruthy()
    expect(within(pagina).queryByRole("list", { name: new RegExp(strings.personProfile.friendsTab) })).toBeNull()
    expect(shownFriendsOf).not.toHaveBeenCalled()
  })
})

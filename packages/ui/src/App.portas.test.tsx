import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { comLacosDoNucleo } from "./testes/lacosDoNucleo.js"
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

afterEach(() => {
  cleanup()
  canais = [LAGAR, ADEGA]
})

const EU = "@eu:casa.pt"
const LAGAR = "!lagar:casa.pt"
const ADEGA = "!adega:casa.pt"
const QUEM = "@ana:casa.pt"
const DIRECTA = moradaDeTeste("directa ana eu", "casa.pt")

/** Where the test delivers messages, the way the core would deliver them. */
const emitir: { current: ((message: unknown) => void) | null } = { current: null }
/** The channels the bridge lists. Each test can set the direct. */
let canais: string[] = [LAGAR, ADEGA]

/**
 * The friendship and invite gates, seen from the whole shell.
 *
 * Components have their own tests. This measures CONNECTIONS: that each gate
 * opens the unique site, with the right channel, and reaches the core through
 * the same function.
 */
function ponte(espias: { invite: ReturnType<typeof vi.fn>; friendRequest: ReturnType<typeof vi.fn> }): EnclaveBridge {
  return comLacosDoNucleo({
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
      list: async () => canais,
      create: async () => ({ ok: true }),
      invite: espias.invite,
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
      repairInvite: vi.fn(),
      openDirect: vi.fn(async () => DIRECTA),
      friendRequest: espias.friendRequest,
      deadWelcomes: async () => [],
      deafChannels: async () => [],
      feedChannel: async () => MURAL_EU,
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => ({}),
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    on: {
      message: (handler: (message: unknown) => void) => {
        emitir.current = handler
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
    call: { on: () => () => {}, setMuted: () => {} },
  } as unknown as EnclaveBridge, EU)
}


function espias(): { invite: ReturnType<typeof vi.fn>; friendRequest: ReturnType<typeof vi.fn> } {
  return { invite: vi.fn(async () => ({ ok: true })), friendRequest: vi.fn(async () => ({ ok: true })) }
}

describe("convidar: uma folha, o canal do sítio do clique", () => {
  it("o menu de um canal convida para ESSE canal, e não para o aberto", async () => {
    const user = userEvent.setup()
    const ponteiros = espias()
    render(<App bridge={ponte(ponteiros)} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    const linha = [...document.querySelectorAll(".channel-row")].find((row) => /adega/.test(row.textContent ?? ""))
    fireEvent.contextMenu(linha?.querySelector("button") as HTMLElement)

    await user.click(screen.getByRole("menuitem", { name: strings.menu.invite }))
    const folha = screen.getByRole("dialog")
    expect(within(folha).getByRole("heading").textContent).toContain("adega")
    await user.type(within(folha).getByLabelText(strings.prompts.personLabel), QUEM)
    await user.click(within(folha).getByRole("button", { name: strings.convidar.enderecoAccao }))
    expect(ponteiros.invite).toHaveBeenCalledWith(ADEGA, QUEM)
  })

  it('o menu do canal já não tem "Meter no canal" à parte: é um modo da folha', async () => {
    render(<App bridge={ponte(espias())} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    const linha = [...document.querySelectorAll(".channel-row")].find((row) => /lagar/.test(row.textContent ?? ""))
    fireEvent.contextMenu(linha?.querySelector("button") as HTMLElement)
    expect(screen.getAllByRole("menuitem").filter((item) => /Meter/.test(item.textContent ?? ""))).toHaveLength(0)
  })
})

describe('pedir amizade por endereço colado em "Encontrar": abre a página de perfil', () => {
  it("o endereço abre o perfil, e o pedido sai do botão de lá, com a nota", async () => {
    const user = userEvent.setup()
    const ponteiros = espias()
    render(<App bridge={ponte(ponteiros)} />)
    await user.click(await screen.findByRole("button", { name: strings.rail.people }))
    await user.click(await screen.findByRole("button", { name: strings.people.tab.encontrar }))
    await user.type(screen.getByLabelText(strings.people.pasteLabel), QUEM)
    await user.click(screen.getByRole("button", { name: strings.people.pasteOpen }))

    // Nothing was requested yet: paste just opened the profile.
    expect(ponteiros.friendRequest).not.toHaveBeenCalled()
    const perfil = await paginaDaPessoa()
    await user.type(within(perfil).getByLabelText(strings.userMenu.noteLabel), "do lagar")
    await user.click(within(perfil).getByRole("button", { name: strings.userMenu.friend }))
    await vi.waitFor(() => expect(ponteiros.friendRequest).toHaveBeenCalledWith(DIRECTA, "do lagar"))
  })
})

/**
 * A direct is NOT friendship, and the profile must know that.
 *
 * Requesting friendship opens the direct before friendship exists. The sheet
 * read "Friends" for someone who only had a direct (`friends` counts any
 * direct), the request card never appeared, and after requesting the button
 * switched to "Friends" right away.
 */
describe("o perfil lê a relação pelo laço, e não pela directa", () => {
  async function perfilDaAna(): Promise<HTMLElement> {
    const user = userEvent.setup()
    canais = [LAGAR, ADEGA, DIRECTA]
    render(<App bridge={ponte(espias())} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    await act(async () => {
      emitir.current?.({ channel: DIRECTA, seq: 1, sender: QUEM, payload: { t: "friend.request", sentAt: 1 } })
    })
    await user.click(screen.getByRole("button", { name: strings.rail.people }))
    await user.click(await screen.findByRole("button", { name: strings.people.tab.encontrar }))
    await user.type(screen.getByLabelText(strings.people.pasteLabel), QUEM)
    await user.click(screen.getByRole("button", { name: strings.people.pasteOpen }))
    return paginaDaPessoa()
  }

  it('com uma directa e o pedido dela, a folha mostra o cartão do pedido e não "Amigos"', async () => {
    const perfil = await perfilDaAna()
    expect(perfil.querySelector(".pedido-card")).toBeTruthy()
    expect(within(perfil).getByRole("button", { name: strings.people.accept })).toBeTruthy()
    expect(within(perfil).queryByRole("button", { name: strings.userMenu.friendsNow })).toBeNull()
    // No friendship, no call.
    expect(within(perfil).queryByRole("button", { name: strings.userMenu.call })).toBeNull()
  })

  it('o "⋯" da página não repete os botões dela', async () => {
    const user = userEvent.setup()
    const perfil = await perfilDaAna()
    await user.click(within(perfil).getByRole("button", { name: /^Mais acções/ }))
    const itens = screen.getAllByRole("menuitem").map((item) => item.textContent)
    for (const daPagina of [
      strings.userMenu.dm,
      strings.userMenu.call,
      strings.userMenu.friend,
      strings.userMenu.acceptFriend,
      strings.userMenu.profile,
    ]) {
      expect(itens).not.toContain(daPagina)
    }
    // Inviting is not a button on the page: it lives in the menu, once only.
    expect(itens.filter((item) => item === strings.userMenu.inviteToRoom)).toHaveLength(1)
    expect(itens).toContain(strings.social.copyAuthor)
  })
})

import { moradaDeTeste } from "../testes/moradas.js"
import type { FichaDoCanal } from "@enclave/client-core"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ChannelRoom, EnclaveBridge, PostExtras } from "./bridge.js"
import { App } from "./App.js"
import { electronFalso } from "./hooks/electronFalso.js"
import { DM_CLOSED_KEY } from "./lib/directs.js"
import { shortAddress } from "./lib/format.js"
import { strings } from "./strings.js"
import { comLacosDoNucleo } from "./testes/lacosDoNucleo.js"
import type { FriendTie } from "@enclave/protocol"

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

const ME = "@me:casa.pt"

const DM_A_B = moradaDeTeste("directa a b", "casa.pt")
const DM_ANA = moradaDeTeste("directa ana me", "casa.pt")
const DM_BRUNO = moradaDeTeste("directa bruno me", "casa.pt")
const MURAL_DA_ANA = moradaDeTeste("mural ana", "casa.pt")
/** The card of each channel (1.0 "Arca", slice 6b), for the false bridge to give to the interface. */
const FICHAS = (): Record<string, FichaDoCanal> => ({
  [DM_A_B]: { tipo: "directa" },
  [DM_ANA]: { tipo: "directa", par: "@ana:casa.pt" },
  [DM_BRUNO]: { tipo: "directa", par: "@bruno:casa.pt" },
  [MURAL_DA_ANA]: { tipo: "mural", dono: "@ana:casa.pt" },
  [FEED]: { tipo: "mural", dono: "@me:casa.pt" },
})
const FEED = moradaDeTeste("mural me", "casa.pt")

/**
 * A bridge that unlocks silently and lets the test publish: `social.post`
 * echoes the post back through the message event with `seq: -1`, exactly as
 * `session.send` does — our own message never round-trips through MLS.
 */
function makeBridge(
  emitRef?: { current: ((message: unknown) => void) | null },
  channelsRef?: { current: ((payload: unknown) => void) | null },
): EnclaveBridge {
  let onMessage: ((message: unknown) => void) | null = null
  const acceptFollower = vi.fn().mockResolvedValue({ ok: true })
  const acceptFriend = vi.fn().mockResolvedValue({ ok: true })
  return comLacosDoNucleo({
    vault: {
      status: async () => ({ exists: true, supportsOsProtection: true }),
      unlock: async () => ({ ok: true }),
      create: async () => ({ ok: true }),
      lock: async () => ({ ok: true }),
      destroy: async () => ({ ok: true }),
    },
    identity: {
      load: async () => ({ address: ME, accountId: "me" }),
      create: async () => ({ address: ME, accountId: "me" }),
    },
    session: {
      connect: async () => ({ ok: true }),
      capabilities: async () => ["mls", "presence"],
      setVisible: async () => ({ ok: true }),
    },
    channels: {
        fichas: FICHAS,
      list: async () => [FEED],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: vi.fn(async () => ({ ok: true })),
      declineChannelInvite: vi.fn(async () => ({ ok: true })),
      send: async () => ({ ok: true }),
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [ME],
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
      post: async (caption: string, tags: string[], extras?: PostExtras) => {
        onMessage?.({
          channel: FEED,
          seq: -1,
          sender: ME,
          payload: {
            t: "post",
            id: crypto.randomUUID(),
            postedAt: Date.now(),
            caption,
            tags,
            media: extras?.media ?? [],
            links: extras?.links ?? [],
          },
        })
        return { ok: true }
      },
      acceptFollower,
      acceptFriend,
      declineFriend: vi.fn().mockResolvedValue({ ok: true }),
      unfriend: vi.fn().mockResolvedValue({ ok: true }),
      repairInvite: async () => ({ invited: true }),
      deadWelcomes: async () => [],
      /*
        The deafness detector, which the profile page reads to decide whether it can
        offer "Request publications". Empty: on this bench nothing is deaf,
        so the button does not appear, which is the right way to fail, because
        behind it is a destructive path. See `feedDaPessoa` in `App.tsx`.
      */
      deafChannels: async () => [],
      feedChannel: async () => FEED,
    },
    profile: {
      /* A person's name, not "Me".
         The rail got a destination called "Me" on 20/8/2026, and a local profile
         with that name put TWO buttons with the same accessible name on the
         same screen: the rail one and the publication author one. Every search by
         name in this file became ambiguous after the first publication.
         A proper name is also what a profile actually has. */
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => ({}),
    },
    notifications: {
      list: async () => [],
      save: async () => ({ ok: true }),
    },
    on: {
      message: (handler: (message: unknown) => void) => {
        onMessage = handler
        if (emitRef) emitRef.current = handler
        return () => {
          onMessage = null
        }
      },
      epoch: () => () => {},
      status: () => () => {},
      connection: () => () => {},
      channels: (handler: (payload: unknown) => void) => {
        if (channelsRef) channelsRef.current = handler
        return () => {}
      },
      presence: () => () => {},
      typing: () => () => {},
      buzz: () => () => {},
      callActivity: () => () => {},
    },
    // `setMuted` because the shell takes the microphone choice to the core at
    // startup, before any call exists: that is why someone who reloaded the page muted
    // does not enter the next call speaking.
    call: { on: () => () => {}, setMuted: () => {} },
  } as unknown as EnclaveBridge, ME)
}

describe("Shell — publicar no Social consta do perfil", () => {
  it("um post publicado aparece no feed e na grelha do perfil", async () => {
    const user = userEvent.setup()
    render(<App bridge={makeBridge()} />)

    // Silent unlock goes to the shell; the rail is the signal that it arrived.
    await user.click(await screen.findByRole("button", { name: strings.rail.social }))
    expect(document.title).toBe("Orwell")

    await user.type(screen.getByPlaceholderText(strings.social.placeholder), "primeira publicação #estreia")
    await user.click(screen.getByRole("button", { name: strings.social.publish }))

    // In the feed, with the clickable tag.
    expect(await screen.findByText("primeira publicação #estreia")).toBeTruthy()
    expect(screen.getByRole("button", { name: "#estreia" })).toBeTruthy()

    // In the profile: count and grid cell with the opening words.
    await user.click(screen.getByRole("button", { name: strings.rail.profile }))
    expect(await screen.findByText("primeira publicação #estreia")).toBeTruthy()
    expect(document.querySelector(".profile-count")?.textContent).toBe(`1 ${strings.profile.postSingular}`)
    expect(screen.queryByText(strings.profile.emptyTitle)).toBeNull()
  })

  it("o rascunho sobrevive a uma ida ao perfil e volta", async () => {
    const user = userEvent.setup()
    render(<App bridge={makeBridge()} />)

    await user.click(await screen.findByRole("button", { name: strings.rail.social }))
    await user.type(screen.getByPlaceholderText(strings.social.placeholder), "meio escrito")

    await user.click(screen.getByRole("button", { name: strings.rail.profile }))
    await user.click(screen.getByRole("button", { name: strings.rail.social }))

    expect(screen.getByPlaceholderText(strings.social.placeholder)).toHaveProperty("value", "meio escrito")
  })

  it('"Nova publicação" no perfil vazio leva ao composer do Social, focado', async () => {
    const user = userEvent.setup()
    const bridge = makeBridge()
    render(<App bridge={bridge} />)

    await user.click(await screen.findByRole("button", { name: strings.rail.profile }))
    // The sidebar also says "New publication"; the target is the empty state button.
    const empty = await screen.findByText(strings.profile.emptyTitle)
    const emptyState = empty.closest(".empty-state") as HTMLElement
    await user.click(within(emptyState).getByRole("button", { name: strings.profile.newPost }))

    const textarea = screen.getByPlaceholderText(strings.social.placeholder)
    expect(document.activeElement).toBe(textarea)
  })
})

/**
 * Profiles are visited: clicking the name of the publisher shows the person.
 *
 * The test is done in the whole shell not in Social alone, because what we
 * want to guarantee is the connection: the feed knows who was clicked, the shell knows who
 * that person is (from what arrived encrypted) and knows what they published, and none of that
 * asks anything of the server.
 */
describe("Shell — visitar o perfil de outra pessoa", () => {
  const ANA = "@ana:casa.pt"
  const FEED_ANA = MURAL_DA_ANA

  /** Ana's profile and a publication of hers, as they would arrive on the wire. */
  async function chegaAAna(emit: (message: unknown) => void): Promise<void> {
    await act(async () => {
      emit({
        channel: FEED_ANA,
        seq: 1,
        sender: ANA,
        payload: { t: "profile", displayName: "Ana", bio: "revela rolos em casa", updatedAt: 1 },
      })
      emit({
        channel: FEED_ANA,
        seq: 2,
        sender: ANA,
        payload: { t: "post", id: "p-ana", postedAt: Date.now(), caption: "serra ao amanhecer" },
      })
    })
  }

  it("clicar no autor abre o perfil dele, com o que ele publicou", async () => {
    const user = userEvent.setup()
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    render(<App bridge={makeBridge(emitRef)} />)

    await user.click(await screen.findByRole("button", { name: strings.rail.social }))
    await chegaAAna(emitRef.current as (message: unknown) => void)

    await user.click(await screen.findByRole("button", { name: "Ana" }))

    const folha = await paginaDaPessoa()
    expect(within(folha).getByText("revela rolos em casa")).toBeTruthy()
    expect(within(folha).getByRole("button", { name: /serra ao amanhecer/ })).toBeTruthy()
    // And nothing to edit what belongs to someone else.
    expect(within(folha).queryByText(strings.profile.editProfile)).toBeNull()
  })

  /**
   * The page takes the place of the destination, and going back returns it as it was.
   *
   * The destination stays mounted and hidden underneath: the draft written in the feed
   * survives the round trip. Going back has three doors, and all three lead to the same
   * place: the back arrow, Escape, and the browser back button.
   */
  it('a página substitui o destino, e a seta, o Escape e o "voltar" do browser devolvem-no', async () => {
    const user = userEvent.setup()
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    render(<App bridge={makeBridge(emitRef)} />)

    await user.click(await screen.findByRole("button", { name: strings.rail.social }))
    await chegaAAna(emitRef.current as (message: unknown) => void)
    await user.type(screen.getByPlaceholderText(strings.social.placeholder), "rascunho a meio")

    const abrir = async (): Promise<HTMLElement> => {
      await user.click(await screen.findByRole("button", { name: "Ana" }))
      return paginaDaPessoa()
    }
    const destinoVisivel = (): boolean =>
      (document.querySelector<HTMLElement>(".vista-guardada")?.style.display ?? "") !== "none"

    // A seta.
    let pagina = await abrir()
    expect(destinoVisivel()).toBe(false)
    expect(document.activeElement).toBe(within(pagina).getByRole("heading", { level: 1, name: "Ana" }))
    await user.click(within(pagina).getByRole("button", { name: strings.personProfile.backFromPage }))
    expect(document.querySelector(".pagina-da-pessoa")).toBeNull()
    expect(destinoVisivel()).toBe(true)
    expect((screen.getByPlaceholderText(strings.social.placeholder) as HTMLTextAreaElement).value).toBe(
      "rascunho a meio",
    )

    // O Escape.
    pagina = await abrir()
    await user.keyboard("{Escape}")
    expect(document.querySelector(".pagina-da-pessoa")).toBeNull()

    // The browser back button.
    await abrir()
    act(() => window.history.back())
    await vi.waitFor(() => expect(document.querySelector(".pagina-da-pessoa")).toBeNull())
    expect(destinoVisivel()).toBe(true)
  })

  it("ir a outro destino pelo carril fecha a página", async () => {
    const user = userEvent.setup()
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    render(<App bridge={makeBridge(emitRef)} />)

    await user.click(await screen.findByRole("button", { name: strings.rail.social }))
    await chegaAAna(emitRef.current as (message: unknown) => void)
    await user.click(await screen.findByRole("button", { name: "Ana" }))
    await paginaDaPessoa()

    // The same destination also counts: clicking the rail goes to the feed.
    await user.click(screen.getByRole("button", { name: strings.rail.social }))
    expect(document.querySelector(".pagina-da-pessoa")).toBeNull()
  })

  it('abrir uma publicação na página entra no histórico: o "voltar" do browser fecha-a primeiro', async () => {
    const user = userEvent.setup()
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    render(<App bridge={makeBridge(emitRef)} />)

    await user.click(await screen.findByRole("button", { name: strings.rail.social }))
    await chegaAAna(emitRef.current as (message: unknown) => void)
    await user.click(await screen.findByRole("button", { name: "Ana" }))
    const pagina = await paginaDaPessoa()

    await user.click(within(pagina).getByRole("button", { name: /serra ao amanhecer/ }))
    expect(within(pagina).getByRole("button", { name: strings.personProfile.back })).toBeTruthy()

    act(() => window.history.back())
    await vi.waitFor(() =>
      expect(within(pagina).getByRole("heading", { level: 1, name: "Ana" })).toBeTruthy(),
    )
    expect(document.querySelector(".pagina-da-pessoa")).not.toBeNull()
  })

  it("de quem nunca se cruzou connosco, diz o que não sabe em vez de o fingir", async () => {
    const user = userEvent.setup()
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    render(<App bridge={makeBridge(emitRef)} />)

    await user.click(await screen.findByRole("button", { name: strings.rail.social }))
    // Just the publication: no profile of this person reached this device, and
    // there is no way to fetch it, asking the server who this address is
    // is the question the app exists so it cannot answer.
    await act(async () => {
      emitRef.current?.({
        channel: FEED_ANA,
        seq: 1,
        sender: ANA,
        payload: { t: "post", id: "p-ana", postedAt: Date.now(), caption: "sem perfil nenhum" },
      })
    })

    // Without a profile, the remaining name is the first word of the address, "Ana", never
    // the full address. It was "No name" from 27 October to 4 November
    // 2026; the owner ordered it changed, because "No name" does not distinguish anyone.
    await user.click(await screen.findByRole("button", { name: "Ana" }))

    const folha = await paginaDaPessoa()
    expect(within(folha).getByText(strings.personProfile.unknown)).toBeTruthy()
  })

  it("clicar no nosso próprio nome vai ao ecrã do perfil, que é onde se edita", async () => {
    const user = userEvent.setup()
    render(<App bridge={makeBridge()} />)

    await user.click(await screen.findByRole("button", { name: strings.rail.social }))
    await user.type(screen.getByPlaceholderText(strings.social.placeholder), "coisa minha")
    await user.click(screen.getByRole("button", { name: strings.social.publish }))

    await user.click(await screen.findByRole("button", { name: "Vera" }))

    // The screen, not the sheet: it is the only place with editing, and this way the
    // sheet of someone else never needs to know what to do with an edit button.
    expect(screen.queryByRole("dialog")).toBeNull()
    // The button of the screen itself, next to the name, not the sidebar one,
    // which says the same and is always there.
    const nome = await screen.findByText("Vera", { selector: ".profile-name-row h2" })
    expect(within(nome.closest(".profile-name-row") as HTMLElement).getByText(strings.profile.editProfile)).toBeTruthy()
  })
})

/**
 * Phase 1e: the profile the same across all devices in the account, on the interface side.
 *
 * A device just paired to someone whose profile has not yet arrived starts with
 * an empty name: the interface says once that the profile arrives when both
 * devices are connected, and shows it as soon as the core adopts it (`on.perfil`).
 */
describe("Shell — o perfil que chega de outro aparelho", () => {
  it("sem perfil à entrada diz-o uma vez, e o perfil adoptado aparece sem recarregar", async () => {
    const user = userEvent.setup()
    const bridge = makeBridge()
    let avisar: ((evento: { profile: { displayName: string; donations: never[] } }) => void) | null = null
    bridge.profile.get = async () => ({ displayName: "", donations: [] })
    bridge.on.perfil = (handler) => {
      avisar = handler
      return () => {}
    }
    render(<App bridge={bridge} />)

    expect(await screen.findByText(strings.pairing.profileMissing)).toBeTruthy()
    await waitFor(() => expect(avisar).not.toBeNull())
    await act(async () => {
      avisar?.({ profile: { displayName: "Vera do PC", donations: [] } })
    })
    await user.click(screen.getByRole("button", { name: strings.rail.profile }))
    expect(await screen.findByText("Vera do PC", { selector: ".profile-name-row h2" })).toBeTruthy()
    expect(screen.getAllByText(strings.pairing.profileMissing)).toHaveLength(1)
  })
})

describe("Shell — amizade mútua", () => {
  /**
   * The shell does not return the invite slot, and that is what this proves.
   *
   * This test required the opposite: a live accept had to seat that person in our
   * feed. The missing half of the path is what condemned that design, an accept
   * almost always arrives with the app closed, and nothing passes through here then.
   * With half in the shell and half in core reconciliation, the two diverged at the
   * first change; and the rule for what counts as an invite slot is the same as the
   * fold, which the core reads from the vault and this shell would only have in memory.
   *
   * Now it is all in the core: live in `#onFriendPayload`, and what came before
   * in `syncFriendships`, both covered in `session.test.ts` and proven with
   * two real accounts in `scripts/e2e-amizade.mjs`.
   */
  it("uma aceitação recebida não faz a casca assentar ninguém — isso é do núcleo", async () => {
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    const bridge = makeBridge(emitRef)
    render(<App bridge={bridge} />)

    // Wait for the shell (the rail is the signal that silent unlock ended).
    await screen.findByRole("button", { name: strings.rail.social })

    const accept = {
      channel: DM_A_B,
      seq: 7,
      sender: "@ana:casa.pt",
      payload: { t: "friend.accept", acceptedAt: Date.now() },
    }
    await act(async () => {
      emitRef.current?.(accept)
      emitRef.current?.({ ...accept, seq: 8 })
    })

    const social = bridge.social as unknown as { acceptFollower: ReturnType<typeof vi.fn> }
    expect(social.acceptFollower).not.toHaveBeenCalled()
  })
})

describe("Shell — centro de notificações", () => {
  it("sala nova (não aberta por mim) acende o sino; abrir marca como lida e salta para lá", async () => {
    const user = userEvent.setup()
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    const channelsRef: { current: ((payload: unknown) => void) | null } = { current: null }
    const bridge = makeBridge(emitRef, channelsRef)
    render(<App bridge={bridge} />)

    await screen.findByRole("button", { name: strings.rail.social })

    // First channel event = initial seed (no notifications); the second
    // brings a room that this device has not opened.
    await act(async () => {
      channelsRef.current?.({ channels: [FEED] })
    })
    await act(async () => {
      channelsRef.current?.({ channels: [FEED, "!convivio:casa.pt"] })
    })

    const bell = await screen.findByRole("button", { name: strings.notifCenter.bellWithCount(1) })
    expect(bell.textContent).toContain("1")

    await user.click(bell)
    await user.click(
      screen.getByRole("button", { name: new RegExp(strings.notifCenter.roomAdded("convivio")) }),
    )

    // Marked as read: the badge disappears.
    expect(screen.getByRole("button", { name: strings.notifCenter.bellWithCount(0) }).textContent).not.toContain("1")
  })

  /**
   * Phase 1d: a crossed request with inverted arrival order shows a single
   * state, "friends", in the bell and in Friends.
   *
   * The owner's report: both requested in the same second, and saw "accepted" and
   * "pending" at the same time. Here Ana's accept arrives live BEFORE her
   * request (which comes later, from recovery), and our request already left the
   * capped list. The old UI fold read `messages` in this order,
   * ignored the accept and stayed in "request-received": the bell offered "Accept"
   * and Received showed 1. The core, which folds by server order, says
   * "friends", and the UI now reads only from it.
   */
  it('um cruzado com o aceite antes do pedido: só "amigos", no sino e em Amigos', async () => {
    const user = userEvent.setup()
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    const bridge = makeBridge(emitRef)
    const ANA = "@ana:casa.pt"
    const DM = DM_ANA
    // The core's response, not a fold of messages from this desk.
    let avisar: ((evento: { ties: FriendTie[] }) => void) | null = null
    bridge.social.friendTies = async () => []
    bridge.on.amizades = (handler) => {
      avisar = handler
      return () => {}
    }
    render(<App bridge={bridge} />)
    await screen.findByRole("button", { name: strings.rail.social })

    await act(async () => {
      emitRef.current?.({ channel: DM, seq: 8, sender: ANA, payload: { t: "friend.accept", acceptedAt: Date.now() } })
      emitRef.current?.({ channel: DM, seq: 7, sender: ANA, payload: { t: "friend.request", sentAt: Date.now() } })
      avisar?.({ ties: [{ peer: ANA, channel: DM, link: "amigos", at: 0, severed: false }] })
    })

    // The bell has both records (the accept and the request), and the request
    // with nothing left to respond to.
    await user.click(await screen.findByRole("button", { name: strings.notifCenter.bellWithCount(2) }))
    const sino = screen.getByRole("dialog", { name: strings.notifCenter.title })
    expect(within(sino).queryByRole("button", { name: strings.people.accept })).toBeNull()
    // No profile, by the address rule (was "No name" until November 4, 2026).
    expect(within(sino).getByText(strings.notifCenter.friendRequestClosed("Ana"))).toBeTruthy()

    // In Friends, no request in Received. The bell is a window since
    // November 3, 2026: it closes before going to the rail.
    await user.keyboard("{Escape}")
    await user.click(screen.getByRole("button", { name: strings.rail.people }))
    expect(screen.queryByLabelText(strings.people.pendingCount(1))).toBeNull()
    expect(screen.queryByRole("button", { name: strings.people.accept })).toBeNull()
  })

  it("um pedido de amizade recebido aparece no painel", async () => {
    const user = userEvent.setup()
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    const bridge = makeBridge(emitRef)
    render(<App bridge={bridge} />)
    await screen.findByRole("button", { name: strings.rail.social })

    await act(async () => {
      emitRef.current?.({
        channel: DM_A_B,
        seq: 3,
        sender: "@ana:casa.pt",
        payload: { t: "friend.request", sentAt: Date.now() },
      })
    })

    // `find` not `get`: the bell entry passes through the vault before counting,
    // and under load that round trip does not always fit in the same tick. Waiting for the
    // bell with the right count is the question we want to ask; reading it
    // first was a race that only lost when the machine was busy.
    await user.click(await screen.findByRole("button", { name: strings.notifCenter.bellWithCount(1) }))
    expect(screen.getByRole("dialog", { name: strings.notifCenter.title })).toBeTruthy()
    expect(screen.getAllByText(/quer ser teu amigo/).length).toBeGreaterThan(0)
  })

  /**
   * Accept from the bell, through the whole shell and not from a single screen.
   *
   * Proves both halves of what was asked at once: the notification button
   * calls the SAME function as the Friends screen, not its own path that
   * would diverge at the first change, and the request only disappears after that
   * function has answered, because what makes it disappear is the `friend.accept`
   * that it returns to the thread, not screen optimism.
   */
  it("aceitar pelo sino chama a aceitação do núcleo e fecha o pedido nos dois sítios", async () => {
    const user = userEvent.setup()
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    const bridge = makeBridge(emitRef)
    const social = bridge.social as unknown as {
      acceptFriend: ReturnType<typeof vi.fn>
      acceptFollower: ReturnType<typeof vi.fn>
    }
    // The way the core does it: the accept goes to the thread, and its echo comes back
    // through the same gate where messages come in. That echo closes the request.
    social.acceptFriend.mockImplementation(async (channel: string) => {
      emitRef.current?.({ channel, seq: -1, sender: ME, payload: { t: "friend.accept", acceptedAt: Date.now() } })
      return { ok: true }
    })

    render(<App bridge={bridge} />)
    await screen.findByRole("button", { name: strings.rail.social })

    await act(async () => {
      emitRef.current?.({
        channel: DM_A_B,
        seq: 3,
        sender: "@ana:casa.pt",
        payload: { t: "friend.request", sentAt: Date.now() },
      })
    })

    // `find` not `get`: the bell entry passes through the vault before counting,
    // and under load that round trip does not always fit in the same tick. Waiting for the
    // bell with the right count is the question we want to ask; reading it
    // first was a race that only lost when the machine was busy.
    await user.click(await screen.findByRole("button", { name: strings.notifCenter.bellWithCount(1) }))
    await act(async () => {
      await user.click(screen.getByRole("button", { name: strings.people.accept }))
    })

    expect(social.acceptFriend).toHaveBeenCalledExactlyOnceWith(DM_A_B, "@ana:casa.pt")
    // And the button is gone: the request stopped being open, in the bell and in
    // Friends at the same time, because it is the same fold that feeds both.
    expect(screen.queryByRole("button", { name: strings.people.accept })).toBeNull()
  })
})

/**
 * The Social feed aggregates the feeds OF OTHERS, not just your own.
 *
 * The test that existed published and saw its own publication, which never
 * broke, and so would not have caught a feed that showed only your own
 * channel. The actual report was the opposite: "what I publish appears in my feed
 * but does not appear in others and vice versa". This fixes the UI side of that:
 * a publication that arrives on someone else's wall must appear in Social like any other.
 */
describe("Shell — o feed do Social agrega os feeds dos outros", () => {
  it("uma publicação recebida no feed de outra pessoa aparece no Social", async () => {
    const user = userEvent.setup()
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    render(<App bridge={makeBridge(emitRef)} />)

    await user.click(await screen.findByRole("button", { name: strings.rail.social }))

    await act(async () => {
      emitRef.current?.({
        channel: MURAL_DA_ANA,
        seq: 3,
        sender: "@ana:casa.pt",
        payload: {
          t: "post",
          id: "post-da-ana",
          postedAt: Date.now(),
          caption: "publicação da ana #teste",
          tags: ["teste"],
          media: [],
          links: [],
        },
      })
    })

    expect(await screen.findByText("publicação da ana #teste")).toBeTruthy()
    // And was not confused with my own: the profile counts only mine.
    await user.click(screen.getByRole("button", { name: strings.rail.profile }))
    expect(await screen.findByText(strings.profile.emptyTitle)).toBeTruthy()
  })

  it("as publicações de duas pessoas diferentes coexistem no mesmo feed", async () => {
    const user = userEvent.setup()
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    render(<App bridge={makeBridge(emitRef)} />)

    await user.click(await screen.findByRole("button", { name: strings.rail.social }))

    // Mine, through the real publication path.
    await user.type(screen.getByPlaceholderText(strings.social.placeholder), "a minha publicação")
    await user.click(screen.getByRole("button", { name: strings.social.publish }))
    expect(await screen.findByText("a minha publicação")).toBeTruthy()

    // Hers, arrived through her feed channel.
    await act(async () => {
      emitRef.current?.({
        channel: MURAL_DA_ANA,
        seq: 4,
        sender: "@ana:casa.pt",
        payload: {
          t: "post",
          id: "post-da-ana-2",
          postedAt: Date.now(),
          caption: "a publicação dela",
          tags: [],
          media: [],
          links: [],
        },
      })
    })

    expect(await screen.findByText("a publicação dela")).toBeTruthy()
    expect(screen.getByText("a minha publicação")).toBeTruthy()
  })
})

/**
 * The Friends destination, built on the whole shell.
 *
 * The proof is done here and not in the components alone because what was
 * broken was exactly the link: `FriendsAside`, `listDirects` and
 * `closeDirect` existed, with their own tests, and had no single caller. The
 * screen you saw was the old friends list, with requests in the body and no
 * conversation at all on the side.
 */
describe("Shell — Amigos: conversas na coluna, pedidos na faixa", () => {
  const ANA = "@ana:casa.pt"
  /** The identifier carries both sides. See `dmPeerAddress`. */
  const CONVERSA = DM_ANA

  /** A conversation with Ana, and something said in it. */
  async function chegaAConversa(
    emit: (message: unknown) => void,
    canais: (payload: unknown) => void,
    body = "vemo-nos amanhã",
  ): Promise<void> {
    await act(async () => {
      canais({ channels: [FEED, CONVERSA] })
    })
    await act(async () => {
      emit({ channel: CONVERSA, seq: 1, sender: ANA, payload: { t: "profile", displayName: "Ana", updatedAt: 1 } })
      emit({ channel: CONVERSA, seq: 2, sender: ANA, payload: { t: "message", body, sentAt: Date.now() } })
    })
  }

  function montar(): { emit: (message: unknown) => void; canais: (payload: unknown) => void } {
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    const channelsRef: { current: ((payload: unknown) => void) | null } = { current: null }
    render(<App bridge={makeBridge(emitRef, channelsRef)} />)
    return {
      emit: (message) => emitRef.current?.(message),
      canais: (payload) => channelsRef.current?.(payload),
    }
  }

  /**
   * The conversation column, already built and with Ana's conversation in it.
   *
   * The wait is INSIDE the column, on purpose: a conversation between two people is
   * a friendship by construction (see `friendsOf`), so Ana also appears
   * in the body's friends list, and a global `findByText` found both.
   */
  async function colunaComAna(): Promise<HTMLElement> {
    const coluna = await screen.findByRole("complementary", { name: strings.people.asideLabel })
    await within(coluna).findByText("Ana")
    return coluna
  }

  it("a conversa aparece na coluna de Amigos e abre no meio, sem sair do destino", async () => {
    const user = userEvent.setup()
    const { emit, canais } = montar()
    await screen.findByRole("button", { name: strings.rail.people })
    await chegaAConversa(emit, canais)

    await user.click(screen.getByRole("button", { name: strings.rail.people }))

    // In the column: the person and the start of what was said.
    const coluna = await colunaComAna()
    expect(within(coluna).getByText("Ana")).toBeTruthy()
    expect(within(coluna).getByText("vemo-nos amanhã")).toBeTruthy()

    await user.click(within(coluna).getByText("Ana"))

    // The conversation fills the middle, and the banner stays up over it, which is the
    // difference between switching pages and opening a conversation.
    expect(await screen.findByRole("navigation", { name: strings.people.tabsLabel })).toBeTruthy()
    // And we did not leave Friends: the destination button is still lit.
    expect(screen.getByRole("button", { name: strings.rail.people }).className).toContain("active")
  })

  /**
   * Web addresses in a direct conversation are clickable, and by text partition,    * never by interpreted HTML. Friends shows the conversation through the same
   * screen that the channels destination uses, so through the same `RichText`: that
   * is what this assertion fixes, so nobody gives it a second implementation.
   */
  it("os endereços web na conversa são links seguros", async () => {
    const user = userEvent.setup()
    const { emit, canais } = montar()
    await screen.findByRole("button", { name: strings.rail.people })
    await chegaAConversa(emit, canais, "olha isto https://example.com/artigo")

    await user.click(screen.getByRole("button", { name: strings.rail.people }))
    const coluna = await colunaComAna()
    await user.click(within(coluna).getByText("Ana"))

    const link = await screen.findByRole("link", { name: "https://example.com/artigo" })
    expect(link.getAttribute("href")).toBe("https://example.com/artigo")
    // Without `noopener` the target page gains access to this window; without
    // `noreferrer` the site learns where the person came from.
    expect(link.getAttribute("rel")).toBe("noopener noreferrer")
    expect(link.getAttribute("target")).toBe("_blank")
  })

  it("o botão direito numa conversa dá abrir, perfil e fechar — e fechar não apaga", async () => {
    const user = userEvent.setup()
    const { emit, canais } = montar()
    await screen.findByRole("button", { name: strings.rail.people })
    await chegaAConversa(emit, canais)

    await user.click(screen.getByRole("button", { name: strings.rail.people }))
    const coluna = await colunaComAna()
    await user.pointer({ keys: "[MouseRight]", target: within(coluna).getByText("Ana") })

    const menu = await screen.findByRole("menu")
    const rotulos = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent)
    expect(rotulos).toContain(strings.menu.open)
    expect(rotulos).toContain(strings.userMenu.profile)
    expect(rotulos).toContain(strings.people.directClose)
    // Nothing that breaks the encryption group: the conversation does not erase from here.
    expect(rotulos).not.toContain(strings.menu.remove)
    expect(rotulos).not.toContain(strings.menu.leave)

    // Closing removes the line from the list, and nothing else.
    await user.click(within(menu).getByRole("menuitem", { name: strings.people.directClose }))
    const depois = await screen.findByRole("complementary", { name: strings.people.asideLabel })
    expect(within(depois).queryByText("Ana")).toBeNull()
    expect(within(depois).getByText(strings.people.directsEmpty)).toBeTruthy()
  })

  it('fechar uma conversa não pergunta, e o "Reabrir" do aviso trá-la de volta', async () => {
    const user = userEvent.setup()
    const { emit, canais } = montar()
    await screen.findByRole("button", { name: strings.rail.people })
    await chegaAConversa(emit, canais)

    await user.click(screen.getByRole("button", { name: strings.rail.people }))
    const coluna = await colunaComAna()
    await user.pointer({ keys: "[MouseRight]", target: within(coluna).getByText("Ana") })
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: strings.people.directClose }))

    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(await screen.findByText(strings.people.directClosed)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: strings.people.directReopen }))

    const depois = await screen.findByRole("complementary", { name: strings.people.asideLabel })
    expect(await within(depois).findByText("Ana")).toBeTruthy()
  })

  it('"Visitar perfil" no menu da conversa abre a página do perfil', async () => {
    // The missing path: the page was built and wired, and the entry
    // to it was never written in any menu.
    const user = userEvent.setup()
    const { emit, canais } = montar()
    await screen.findByRole("button", { name: strings.rail.people })
    await chegaAConversa(emit, canais)

    await user.click(screen.getByRole("button", { name: strings.rail.people }))
    const coluna = await colunaComAna()
    await user.pointer({ keys: "[MouseRight]", target: within(coluna).getByText("Ana") })
    await user.click(await screen.findByRole("menuitem", { name: strings.userMenu.profile }))

    const folha = await paginaDaPessoa()
    expect(within(folha).getByRole("button", { name: strings.personProfile.message })).toBeTruthy()
  })

  /**
   * The owner's request, word for word: "It should not be possible to make admin
   * in the private conversation between two users".
   *
   * Proven in the shell and not just in the pure function because what matters is what
   * reaches the screen: in a two-person conversation, the menu of whoever is there
   * cannot offer any admin role.
   */
  it("numa conversa de duas pessoas não se torna administrador ninguém", async () => {
    const user = userEvent.setup()
    const { emit, canais } = montar()
    await screen.findByRole("button", { name: strings.rail.people })
    await chegaAConversa(emit, canais)

    await user.click(screen.getByRole("button", { name: strings.rail.people }))
    const coluna = await colunaComAna()
    await user.pointer({ keys: "[MouseRight]", target: within(coluna).getByText("Ana") })
    await user.click(await screen.findByRole("menuitem", { name: strings.userMenu.profile }))

    // The profile page, opened from inside the conversation: no roles section and
    // no admin label on a channel where both people can do everything.
    const folha = await paginaDaPessoa()
    expect(within(folha).queryByText(strings.memberRoles.admin)).toBeNull()
    expect(folha.querySelector(".member-roles")).toBeNull()
  })

  /**
   * The channel invite lands in the direct conversation of whoever sent it, and
   * is answered from there.
   *
   * It is where the person is reading. An invite that arrives somewhere they
   * do not visit is an invite that does not arrive, and the Friends page is where they will
   * look, because that is where friendships are managed.
   */
  it("um convite chega à conversa em Amigos, com o botão de entrar", async () => {
    const user = userEvent.setup()
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    const channelsRef: { current: ((payload: unknown) => void) | null } = { current: null }
    const bridge = makeBridge(emitRef, channelsRef)
    render(<App bridge={bridge} />)
    await screen.findByRole("button", { name: strings.rail.people })

    await act(async () => {
      channelsRef.current?.({ channels: [FEED, CONVERSA] })
    })
    await act(async () => {
      emitRef.current?.({
        channel: CONVERSA,
        seq: 1,
        sender: ANA,
        payload: { t: "profile", displayName: "Ana", updatedAt: 1 },
      })
      emitRef.current?.({
        channel: CONVERSA,
        seq: 2,
        sender: ANA,
        payload: {
          t: "message",
          body: 'Convido-te para "Lagar do Zé".',
          sentAt: Date.now(),
          invite: { channel: "!lagar:casa.pt", name: "Lagar do Zé", at: Date.now() },
        },
      })
    })

    await user.click(screen.getByRole("button", { name: strings.rail.people }))
    const coluna = await colunaComAna()
    // In the column, the invite counts as something said: brings the conversation up and shows
    // the message, which is what an older client would also read.
    expect(within(coluna).getByText('Convido-te para "Lagar do Zé".')).toBeTruthy()

    await user.click(within(coluna).getByText("Ana"))

    // And in the conversation, the card with the reply next to where the invite arrived.
    expect(await screen.findByText(strings.convite.titulo('"Lagar do Zé"'))).toBeTruthy()
    await user.click(screen.getByRole("button", { name: strings.convite.aceitar }))

    const channels = bridge.channels as unknown as { acceptChannelInvite: ReturnType<typeof vi.fn> }
    expect(channels.acceptChannelInvite).toHaveBeenCalledWith(CONVERSA, "!lagar:casa.pt")
  })

  /**
   * Accepting is not entering, and the UI cannot pretend it is.
   *
   * Nobody enters an encrypted group alone: the device of whoever invited admits them,
   * and that device might be offline. It is the same truth that Friends already
   * say about an accepted friendship with the other person away, and it is said here
   * in the same words.
   */
  it("aceitar diz que falta ser admitido, em vez de fingir que já está", async () => {
    const user = userEvent.setup()
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    const channelsRef: { current: ((payload: unknown) => void) | null } = { current: null }
    render(<App bridge={makeBridge(emitRef, channelsRef)} />)
    await screen.findByRole("button", { name: strings.rail.people })

    await act(async () => {
      channelsRef.current?.({ channels: [FEED, CONVERSA] })
    })
    await act(async () => {
      emitRef.current?.({
        channel: CONVERSA,
        seq: 1,
        sender: ANA,
        payload: { t: "profile", displayName: "Ana", updatedAt: 1 },
      })
      emitRef.current?.({
        channel: CONVERSA,
        seq: 2,
        sender: ANA,
        payload: {
          t: "message",
          body: 'Convido-te para "Lagar do Zé".',
          sentAt: Date.now(),
          invite: { channel: "!lagar:casa.pt", name: "Lagar do Zé", at: Date.now() },
        },
      })
    })

    await user.click(screen.getByRole("button", { name: strings.rail.people }))
    const coluna = await colunaComAna()
    await user.click(within(coluna).getByText("Ana"))
    await user.click(await screen.findByRole("button", { name: strings.convite.aceitar }))

    expect(await screen.findByText(strings.convite.aceiteFalta("Ana"))).toBeTruthy()
  })

  /**
   * Your own invite does not accept itself.
   *
   * It would be admitting ourselves by proxy, and the card offering it was a button
   * that does nothing, which is worse than no button. What stays is the status line,
   * which says who we are waiting for.
   */
  it("o convite que MANDÁMOS não traz botões, só o estado", async () => {
    const user = userEvent.setup()
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    const channelsRef: { current: ((payload: unknown) => void) | null } = { current: null }
    render(<App bridge={makeBridge(emitRef, channelsRef)} />)
    await screen.findByRole("button", { name: strings.rail.people })

    await act(async () => {
      channelsRef.current?.({ channels: [FEED, CONVERSA] })
    })
    await act(async () => {
      emitRef.current?.({
        channel: CONVERSA,
        seq: 1,
        sender: ANA,
        payload: { t: "profile", displayName: "Ana", updatedAt: 1 },
      })
      emitRef.current?.({
        channel: CONVERSA,
        seq: 2,
        sender: ME,
        payload: {
          t: "message",
          body: 'Convido-te para "Lagar do Zé".',
          sentAt: Date.now(),
          invite: { channel: "!lagar:casa.pt", name: "Lagar do Zé", at: Date.now() },
        },
      })
    })

    await user.click(screen.getByRole("button", { name: strings.rail.people }))
    const coluna = await colunaComAna()
    await user.click(within(coluna).getByText("Ana"))

    expect(await screen.findByText(strings.convite.aguarda("Ana"))).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.convite.aceitar })).toBeNull()
    expect(screen.queryByRole("button", { name: strings.convite.recusar })).toBeNull()
  })

  /**
   * The friendship request is answered where it arrived, and by the SAME function.
   *
   * It was already answered in the Friends screen and in the bell; the conversation
   * is the third place, and not a third path, if it got its own path, the three would
   * diverge at the first change, and what diverges here is who ends up with which keys.
   */
  it("um pedido de amizade responde-se na conversa onde chegou", async () => {
    const user = userEvent.setup()
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    const channelsRef: { current: ((payload: unknown) => void) | null } = { current: null }
    const bridge = makeBridge(emitRef, channelsRef)
    render(<App bridge={bridge} />)
    await screen.findByRole("button", { name: strings.rail.people })

    await act(async () => {
      channelsRef.current?.({ channels: [FEED, CONVERSA] })
    })
    await act(async () => {
      emitRef.current?.({
        channel: CONVERSA,
        seq: 1,
        sender: ANA,
        payload: { t: "profile", displayName: "Ana", updatedAt: 1 },
      })
      emitRef.current?.({ channel: CONVERSA, seq: 2, sender: ANA, payload: { t: "friend.request", sentAt: Date.now() } })
    })

    await user.click(screen.getByRole("button", { name: strings.rail.people }))
    const coluna = await colunaComAna()
    // No body means no preview: the line puts a label in its place,
    // instead of appearing blank, which reads as a break.
    expect(within(coluna).getByText(strings.people.directFriendRequest)).toBeTruthy()

    await user.click(within(coluna).getByText("Ana"))
    expect(await screen.findByText(strings.people.wantsToBeFriends("Ana"))).toBeTruthy()
    await user.click(screen.getByRole("button", { name: strings.people.accept }))

    const social = bridge.social as unknown as { acceptFriend: ReturnType<typeof vi.fn> }
    expect(social.acceptFriend).toHaveBeenCalledWith(CONVERSA, ANA)
  })

  /**
   * THE FRIENDSHIP REQUEST CARD, taken from the messages list.
   *
   * Owner's report: *"I want the card in the messages"*. It was already answered in the
   * conversation, but the card was a LINE of it, stuck where the request arrived, and
   * just swapping two sentences pushed the buttons off screen. The person
   * read what was written to them with no way to answer.
   *
   * It became a conversation card, standing over it. And there is ONE only: it left the
   * `Timeline` when it came here, instead of adding a second, two would give
   * two "Accept" buttons on the same screen, and that is what the last attempt produced.
   */
  describe("o pedido de amizade, na conversa", () => {
    /**
     * Ana requests friendship, and speaks next: six messages above the request.
     *
     * The timestamps are NOW not small numbers, and the reason is not aesthetic:
     * closing a conversation saves the moment in `localStorage`, which survives from one
     * test to the next in this file. With `sentAt: 1000`, the conversation counted
     * as closed and did not even appear in the column.
     */
    async function pedidoEConversaDaAna(
      emit: (message: unknown) => void,
      canais: (payload: unknown) => void,
    ): Promise<void> {
      const agora = Date.now()
      await act(async () => {
        canais({ channels: [FEED, CONVERSA] })
      })
      await act(async () => {
        emit({ channel: CONVERSA, seq: 1, sender: ANA, payload: { t: "profile", displayName: "Ana", updatedAt: 1 } })
        emit({ channel: CONVERSA, seq: 2, sender: ANA, payload: { t: "friend.request", sentAt: agora } })
        for (let i = 0; i < 6; i++) {
          emit({
            channel: CONVERSA,
            seq: 3 + i,
            sender: ANA,
            payload: { t: "message", body: `assunto ${i}`, sentAt: agora + 1 + i },
          })
        }
      })
    }

    /**
     * The same shell, echoing back what the core returns when it responds.
     *
     * The card does not leave because someone sent it away: it leaves when the
     * fold stops counting it as the `friend.accept` (or `friend.decline`) comes
     * back over the wire. This is the difference between validated and optimistic,
     * and that is what we measure here.
     */
    function montarComEco(): { emit: (message: unknown) => void; canais: (payload: unknown) => void } {
      const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
      const channelsRef: { current: ((payload: unknown) => void) | null } = { current: null }
      const bridge = makeBridge(emitRef, channelsRef)
      const social = bridge.social as unknown as {
        acceptFriend: ReturnType<typeof vi.fn>
        declineFriend: ReturnType<typeof vi.fn>
      }
      social.acceptFriend.mockImplementation(async (channel: string) => {
        emitRef.current?.({ channel, seq: -1, sender: ME, payload: { t: "friend.accept", acceptedAt: Date.now() } })
        return { ok: true }
      })
      social.declineFriend.mockImplementation(async (channel: string) => {
        emitRef.current?.({ channel, seq: -1, sender: ME, payload: { t: "friend.decline" } })
        return { ok: true }
      })
      render(<App bridge={bridge} />)
      return {
        emit: (message) => emitRef.current?.(message),
        canais: (payload) => channelsRef.current?.(payload),
      }
    }

    /** Opens Ana's conversation, with her request and the conversation above it. */
    async function abrirConversaComPedido(
      montagem: { emit: (message: unknown) => void; canais: (payload: unknown) => void },
      user: ReturnType<typeof userEvent.setup>,
    ): Promise<void> {
      await screen.findByRole("button", { name: strings.rail.people })
      await pedidoEConversaDaAna(montagem.emit, montagem.canais)
      await user.click(screen.getByRole("button", { name: strings.rail.people }))
      const coluna = await colunaComAna()
      await user.click(within(coluna).getByText("Ana"))
      await screen.findByText(strings.people.wantsToBeFriends("Ana"))
    }

    it("o cartão fica de pé por cima da conversa, e não numa linha dela", async () => {
      const user = userEvent.setup()
      await abrirConversaComPedido(montarComEco(), user)

      // The six sentences are actually there in the conversation: without them this
      // would measure an empty conversation, which is the case where the defect never
      // showed up. Inside the `.timeline` on purpose, the last sentence also appears
      // in the column, as a preview of Ana's row.
      const conversa = document.querySelector(".timeline") as HTMLElement
      expect(within(conversa).getByText("assunto 5")).toBeTruthy()

      const cartao = screen.getByText(strings.people.wantsToBeFriends("Ana")).closest(".pedido-card")
      expect(cartao).toBeTruthy()
      // Outside the scrolling list. This keeps the buttons visible no matter how much
      // gets written below.
      expect(cartao?.closest(".timeline")).toBeNull()
      expect(screen.getByRole("button", { name: strings.people.accept })).toBeTruthy()
      expect(screen.getByRole("button", { name: strings.people.decline })).toBeTruthy()
    })

    it('há um cartão só, e portanto um botão "Aceitar" só', async () => {
      const user = userEvent.setup()
      await abrirConversaComPedido(montarComEco(), user)

      // The previous attempt added a second card instead of moving the first one, and
      // the result was two identical buttons on the same screen.
      expect(screen.getAllByRole("button", { name: strings.people.accept })).toHaveLength(1)
      expect(screen.getAllByText(strings.people.wantsToBeFriends("Ana"))).toHaveLength(1)
    })

    it("aceitar da conversa faz o cartão desaparecer, e a conversa fica", async () => {
      const user = userEvent.setup()
      await abrirConversaComPedido(montarComEco(), user)

      await act(async () => {
        await user.click(screen.getByRole("button", { name: strings.people.accept }))
      })

      expect(screen.queryByText(strings.people.wantsToBeFriends("Ana"))).toBeNull()
      expect(screen.queryByRole("button", { name: strings.people.accept })).toBeNull()
      // The conversation was not with him: replying to a request does not close what
      // you were reading.
      const conversa = document.querySelector(".timeline") as HTMLElement
      expect(within(conversa).getByText("assunto 5")).toBeTruthy()
    })

    it("recusar da conversa faz o mesmo, e não dá lugar nenhum a ninguém", async () => {
      const user = userEvent.setup()
      await abrirConversaComPedido(montarComEco(), user)

      await act(async () => {
        await user.click(screen.getByRole("button", { name: strings.people.decline }))
      })

      expect(screen.queryByText(strings.people.wantsToBeFriends("Ana"))).toBeNull()
      expect(screen.queryByRole("button", { name: strings.people.accept })).toBeNull()
    })

    /**
     * From the requester's side: card yes, buttons no.
     *
     * With no card at all, the person who requested friendship opens the
     * conversation and finds no sign they did it. With buttons, they would be
     * replying to their own request.
     */
    it("quem pediu vê que pediu, e não tem nada para carregar", async () => {
      const user = userEvent.setup()
      const { emit, canais } = montarComEco()
      await screen.findByRole("button", { name: strings.rail.people })

      await act(async () => {
        canais({ channels: [FEED, CONVERSA] })
      })
      await act(async () => {
        emit({ channel: CONVERSA, seq: 1, sender: ANA, payload: { t: "profile", displayName: "Ana", updatedAt: 1 } })
        // Timestamp of now, for the same reason as `pedidoEConversaDaAna`: a
        // conversation closed in an earlier test does not come back with small timestamps.
        emit({ channel: CONVERSA, seq: -1, sender: ME, payload: { t: "friend.request", sentAt: Date.now() } })
      })

      await user.click(screen.getByRole("button", { name: strings.rail.people }))
      const coluna = await colunaComAna()
      await user.click(within(coluna).getByText("Ana"))

      expect(await screen.findByText(strings.people.requestSent("Ana"))).toBeTruthy()
      expect(screen.queryByRole("button", { name: strings.people.accept })).toBeNull()
      expect(screen.queryByRole("button", { name: strings.people.decline })).toBeNull()
    })
  })

  it("os pedidos vivem na faixa, com contador, e não no corpo", async () => {
    const user = userEvent.setup()
    const { emit, canais } = montar()
    await screen.findByRole("button", { name: strings.rail.people })
    await chegaAConversa(emit, canais)

    await act(async () => {
      emit({
        channel: DM_BRUNO,
        seq: 9,
        sender: "@bruno:casa.pt",
        payload: { t: "friend.request", sentAt: Date.now() },
      })
    })

    await user.click(screen.getByRole("button", { name: strings.rail.people }))

    // The counter on the banner counts, and it is what confirms the requests left
    // the body: we know there is one without going anywhere.
    const contador = await screen.findByLabelText(strings.people.pendingCount(1))
    expect(contador.textContent).toBe("1")
    // And the Friends body does not show them.
    expect(screen.queryByRole("button", { name: strings.people.accept })).toBeNull()

    // The separator brings them forward.
    await user.click(screen.getByRole("button", { name: new RegExp(strings.people.tab.recebidos) }))
    expect(await screen.findByRole("button", { name: strings.people.accept })).toBeTruthy()
  })
})

/**
 * Renaming a category removes the restriction with it.
 *
 * A category is two things: the name written in each room, and the declaration
 * that says who sees it. The action rewrote only the first, and the second fell
 * behind, the rooms appeared with a new undeclared name, and undeclared means
 * visible to everyone. The restriction vanished without anyone removing it, and
 * the action that would remove it had nothing to do with visibility.
 */
describe("Shell — renomear uma categoria não lhe perde a restrição", () => {
  const CANAL = "!convivio:casa.pt"

  afterEach(() => vi.restoreAllMocks())

  /** The shell with a channel that has a room in a declared category. */
  function montarComCategorias(
    declaradas: { category: string; position: number; roles: string[] }[],
    salas: ChannelRoom[] = [
      { room: "avisos", name: "avisos", category: "Antiga", kind: "text", position: 1 },
    ],
  ): {
    setCategory: ReturnType<typeof vi.fn>
    setRoom: ReturnType<typeof vi.fn>
    canais: (payload: unknown) => void
  } {
    const channelsRef: { current: ((payload: unknown) => void) | null } = { current: null }
    const bridge = makeBridge(undefined, channelsRef)
    const setCategory = vi.fn().mockResolvedValue({ ok: true })
    const setRoom = vi.fn().mockResolvedValue({ ok: true })
    // Only in this channel: the feed shares the same bridge and has no rooms.
    bridge.channels.rooms = (canal: string) => (canal === CANAL ? salas : [])
    bridge.channels.closedRooms = () => []
    bridge.channels.categories = (canal: string) => (canal === CANAL ? declaradas : [])
    // The admin sees all categories, restricted ones included, and the admin is
    // the one with the menu that opens this action.
    bridge.channels.mayEdit = () => true
    bridge.channels.setCategory = setCategory
    bridge.channels.setRoom = setRoom
    render(<App bridge={bridge} />)
    return { setCategory, setRoom, canais: (payload) => channelsRef.current?.(payload) }
  }

  /** The channel open, and the category menu in front. */
  /**
   * Opens the category menu, taps rename, and writes the new name in the
   * `Prompt` at home. It was a `window.prompt`, which this test replaces.
   */
  async function menuDaCategoria(canais: (payload: unknown) => void, nome = "Nova"): Promise<void> {
    const user = userEvent.setup()
    await screen.findByRole("button", { name: strings.rail.chat })
    await act(async () => {
      canais({ channels: [FEED, CANAL] })
    })
    await user.click(screen.getByRole("button", { name: strings.rail.chat }))
    // Exact name: the handle that folds the tree also says "convivio", and a
    // pattern caught both.
    await user.click(await screen.findByRole("button", { name: "convivio" }))
    await user.pointer({ keys: "[MouseRight]", target: await screen.findByText("Antiga") })
    await user.click(await screen.findByRole("menuitem", { name: strings.menu.renameCategory }))
    const campo = await screen.findByLabelText(strings.prompts.nameLabel)
    // The `Prompt` brings the current name as written: change it without rewriting it.
    expect((campo as HTMLInputElement).value).toBe("Antiga")
    await user.clear(campo)
    await user.type(campo, nome)
    await user.click(screen.getByRole("button", { name: strings.prompts.confirm }))
  }

  it("publica a categoria nova com os papéis e a posição da antiga", async () => {
    const { setCategory, setRoom, canais } = montarComCategorias([{ category: "Antiga", position: 7, roles: ["mod"] }])
    await menuDaCategoria(canais)

    // The declaration travels intact: the same roles and the same position. Without
    // the position, the category would jump to the head of the list when renamed.
    expect(setCategory).toHaveBeenCalledWith(CANAL, { category: "Nova", position: 7, roles: ["mod"] })
    // And the rooms really did change name, which is the other half of the action.
    expect(setRoom).toHaveBeenCalledWith(CANAL, expect.objectContaining({ room: "avisos", category: "Nova" }))
    // The old one gets a tombstone, otherwise an empty declared group would linger.
    expect(setCategory).toHaveBeenCalledWith(CANAL, { category: "Antiga", removed: true })
  })

  it("numa fusão, a declaração do destino manda e não é esmagada", async () => {
    const { setCategory, canais } = montarComCategorias([
      { category: "Antiga", position: 7, roles: ["mod"] },
      { category: "Nova", position: 2, roles: ["convidado"] },
    ])
    await menuDaCategoria(canais)

    // Nothing publishes about the destination: whoever was there chose who sees it,
    // and the category that dissolves does not decide for the one that remains.
    const publicadas = setCategory.mock.calls.map((chamada) => chamada[1] as { category: string })
    expect(publicadas.some((declaracao) => declaracao.category === "Nova")).toBe(false)
    expect(setCategory).toHaveBeenCalledWith(CANAL, { category: "Antiga", removed: true })
  })

  it("juntar com uma categoria que já tem salas pergunta antes, com o verbo", async () => {
    const { setRoom, canais } = montarComCategorias(
      [],
      [
        { room: "avisos", name: "avisos", category: "Antiga", kind: "text", position: 1 },
        { room: "actas", name: "actas", category: "Nova", kind: "text", position: 2 },
      ],
    )
    await menuDaCategoria(canais)

    const pergunta = await screen.findByRole("alertdialog", { name: strings.rooms.mergeCategoryTitle })
    // Nothing moves before the "yes".
    expect(setRoom).not.toHaveBeenCalled()
    await userEvent.setup().click(within(pergunta).getByRole("button", { name: strings.rooms.mergeCategoryAction }))
    await waitFor(() =>
      expect(setRoom).toHaveBeenCalledWith(CANAL, expect.objectContaining({ room: "avisos", category: "Nova" })),
    )
  })

  /*
    Deleting a category undoes itself, so it does not ask. The notice brings the
    "Undo", and undoing restores both halves: the declaration (with the roles and
    position) and the name in each room.
  */
  it('apagar a categoria não pergunta, e o "Desfazer" do aviso repõe-na inteira', async () => {
    const user = userEvent.setup()
    const { setCategory, setRoom, canais } = montarComCategorias([{ category: "Antiga", position: 7, roles: ["mod"] }])
    await screen.findByRole("button", { name: strings.rail.chat })
    await act(async () => {
      canais({ channels: [FEED, CANAL] })
    })
    await user.click(screen.getByRole("button", { name: strings.rail.chat }))
    await user.click(await screen.findByRole("button", { name: "convivio" }))
    await user.pointer({ keys: "[MouseRight]", target: await screen.findByText("Antiga") })
    await user.click(await screen.findByRole("menuitem", { name: strings.menu.deleteCategory }))

    expect(screen.queryByRole("alertdialog")).toBeNull()
    await waitFor(() =>
      expect(setRoom).toHaveBeenCalledWith(CANAL, expect.objectContaining({ room: "avisos", category: "" })),
    )
    const desfazer = await screen.findByRole("button", { name: strings.rooms.categoryUndo })
    setRoom.mockClear()
    await user.click(desfazer)

    await waitFor(() =>
      expect(setRoom).toHaveBeenCalledWith(CANAL, expect.objectContaining({ room: "avisos", category: "Antiga" })),
    )
    expect(setCategory).toHaveBeenCalledWith(CANAL, { category: "Antiga", position: 7, roles: ["mod"] })
    expect(await screen.findByText(strings.rooms.categoryRestored("Antiga"))).toBeTruthy()
  })

  /*
    Report from the owner in 0.8.0: "deleting a category does not delete, even
    as admin". The empty category (with no rooms) never reached the tombstone:
    the action exited first, because there were no rooms to rewrite.
  */
  it('apagar uma categoria vazia publica a lápide, e o "Desfazer" repõe a declaração', async () => {
    const user = userEvent.setup()
    const { setCategory, setRoom, canais } = montarComCategorias([{ category: "Vazia", position: 3, roles: [] }])
    await screen.findByRole("button", { name: strings.rail.chat })
    await act(async () => {
      canais({ channels: [FEED, CANAL] })
    })
    await user.click(screen.getByRole("button", { name: strings.rail.chat }))
    await user.click(await screen.findByRole("button", { name: "convivio" }))
    await user.pointer({ keys: "[MouseRight]", target: await screen.findByText("Vazia") })
    await user.click(await screen.findByRole("menuitem", { name: strings.menu.deleteCategory }))

    await waitFor(() => expect(setCategory).toHaveBeenCalledWith(CANAL, { category: "Vazia", removed: true }))
    expect(setRoom).not.toHaveBeenCalled()
    expect(await screen.findByText(strings.rooms.categoryDeleted("Vazia", 0))).toBeTruthy()

    await user.click(await screen.findByRole("button", { name: strings.rooms.categoryUndo }))
    await waitFor(() => expect(setCategory).toHaveBeenCalledWith(CANAL, { category: "Vazia", position: 3, roles: [] }))
    expect(await screen.findByText(strings.rooms.categoryRestoredEmpty("Vazia"))).toBeTruthy()
  })

  it('fechar uma sala não pergunta, e o aviso traz "Mostrar de novo"', async () => {
    const user = userEvent.setup()
    const { setRoom, canais } = montarComCategorias([])
    await screen.findByRole("button", { name: strings.rail.chat })
    await act(async () => {
      canais({ channels: [FEED, CANAL] })
    })
    await user.click(screen.getByRole("button", { name: strings.rail.chat }))
    await user.click(await screen.findByRole("button", { name: "convivio" }))
    await user.pointer({ keys: "[MouseRight]", target: await screen.findByText("avisos") })
    await user.click(await screen.findByRole("menuitem", { name: strings.menu.closeRoom }))

    expect(screen.queryByRole("alertdialog")).toBeNull()
    await waitFor(() =>
      expect(setRoom).toHaveBeenCalledWith(CANAL, expect.objectContaining({ room: "avisos", closed: true })),
    )
    await user.click(await screen.findByRole("button", { name: strings.rooms.showAgain }))
    await waitFor(() =>
      expect(setRoom).toHaveBeenCalledWith(CANAL, expect.objectContaining({ room: "avisos", closed: false })),
    )
  })
})

/**
 * The "Founder" label in a two-person conversation: it does not exist, and it
 * does not exist on BOTH sides.
 *
 * The symptom we fix here was seeing the same conversation two ways. The
 * `room.created` publishes before the second person is seated, so only the vault
 * of whoever opened the conversation stores it: one side read "Founder" next to
 * the name, the other read the address. This proves both sides at once,  * `founder` returning someone and `founder` returning `null`, because a guard
 * that only worked for one side would leave the inconsistency standing.
 */
describe("Shell — numa conversa directa não há fundador para etiquetar", () => {
  const ANA = "@ana:casa.pt"
  const CONVERSA = DM_ANA

  /**
   * The conversation open, with both people in the members list.
   *
   * `founder` is the only prop that changes between the two sides, so it is the
   * argument: everything else is the same conversation seen by the same code.
   */
  async function conversaAbertaCom(founder: string | null): Promise<void> {
    const user = userEvent.setup()
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    const channelsRef: { current: ((payload: unknown) => void) | null } = { current: null }
    const bridge = makeBridge(emitRef, channelsRef)
    bridge.channels.members = async () => [ME, ANA]
    bridge.channels.founder = () => founder
    // `admins` empty on purpose: what we are proving is the label of who FOUNDED,
    // and an appointment on top would mix the two causes.
    bridge.channels.admins = () => []
    render(<App bridge={bridge} />)

    await screen.findByRole("button", { name: strings.rail.people })
    await act(async () => {
      channelsRef.current?.({ channels: [FEED, CONVERSA] })
    })
    await act(async () => {
      emitRef.current?.({
        channel: CONVERSA,
        seq: 1,
        sender: ANA,
        payload: { t: "profile", displayName: "Ana", updatedAt: 1 },
      })
      emitRef.current?.({
        channel: CONVERSA,
        seq: 2,
        sender: ANA,
        payload: { t: "message", body: "vemo-nos amanhã", sentAt: Date.now() },
      })
    })

    await user.click(screen.getByRole("button", { name: strings.rail.people }))
    const coluna = await screen.findByRole("complementary", { name: strings.people.asideLabel })
    await within(coluna).findByText("Ana")
    await user.click(within(coluna).getByText("Ana"))
  }

  /** The members list of the open conversation, already with both people in it. */
  async function listaDeMembros(): Promise<HTMLElement> {
    const lista = document.querySelector(".member-list") as HTMLElement
    // The copy ID button left the line on October 28, 2026; the "⋯" is what remains next to the name.
    await within(lista).findByRole("button", { name: strings.people.rowMore("Ana") })
    return lista
  }

  it('do lado de quem a abriu, a lista não mostra "Fundador" nem o endereço', async () => {
    await conversaAbertaCom(ME)

    const lista = await listaDeMembros()
    expect(within(lista).queryByText(strings.roomProperties.roleFounder)).toBeNull()
    // The address moved below the name (owner's order, October 27, 2026).
    expect(within(lista).queryByText(shortAddress(ME))).toBeNull()
    expect(lista.querySelector(".member-sub")).toBeNull()
  })

  it("do outro lado, onde não há fundador registado, lê-se exactamente o mesmo", async () => {
    await conversaAbertaCom(null)

    const lista = await listaDeMembros()
    expect(within(lista).queryByText(strings.roomProperties.roleFounder)).toBeNull()
    // The address moved below the name (owner's order, October 27, 2026).
    expect(within(lista).queryByText(shortAddress(ME))).toBeNull()
    expect(lista.querySelector(".member-sub")).toBeNull()
  })
})

/**
 * Friends has ONE column on the left, not two.
 *
 * It had two, and the first was empty: a header repeating the word the banner
 * already says, a body with nothing inside, 236px of frame before the
 * conversations.
 *
 * These tests guard both halves of the decision. The bar goes away, that is
 * the easy half. The account card does NOT go away with it, that is the half
 * you lose in a distraction: the bell and "how you appear" do not exist anywhere
 * else in the app, and removing the bar outright made Friends the only
 * destination without them.
 *
 * Width is not measured here: jsdom has no layout. See
 * `scripts/medir-destinos.mjs`, which measures all five destinations at 1280
 * and 390.
 */
describe("Shell — Amigos não desenha a barra dos canais", () => {
  /** At the destination, and waiting for the conversations column to be mounted. */
  async function emAmigos(): Promise<void> {
    const user = userEvent.setup()
    render(<App bridge={makeBridge()} />)
    await user.click(await screen.findByRole("button", { name: strings.rail.people }))
    await screen.findByRole("complementary", { name: strings.people.asideLabel })
  }

  it("a barra dos canais não se monta, e a palavra deixa de estar escrita duas vezes", async () => {
    await emAmigos()
    expect(document.querySelector(".sidebar")).toBeNull()
    // Once, and the destination banner says it, see `FriendsBar`. The title shows
    // how many friends there are ("Friends (0)"): count the word with the number.
    const ditas = [...document.querySelectorAll("body *")].filter((el) => {
      const texto = el.textContent?.trim() ?? ""
      return el.children.length === 0 && (texto === strings.people.title || /^Amigos \(\d+\)$/.test(texto))
    })
    expect(ditas).toHaveLength(1)
    expect(ditas[0]?.classList.contains("people-bar-title")).toBe(true)
  })

  it("a faixa da conta ficou, e ficou dentro da coluna das conversas", async () => {
    await emAmigos()
    const coluna = document.querySelector(".people-aside")
    // Each control in its place: what the bar carried to the bottom was not lost.
    expect(coluna?.querySelector(".me-faixa .me-identity")).toBeTruthy()
    expect(coluna?.querySelector(".me-bell")).toBeTruthy()
    expect(coluna?.querySelector(".me-audio")).toBeTruthy()
    expect(coluna?.querySelector(".me-definicoes")).toBeTruthy()
    // And only once across the whole screen: two banners end up disagreeing with each other.
    expect(document.querySelectorAll(".me-identity")).toHaveLength(1)
  })

  it("a roda dentada da faixa abre as definições, pelo mesmo caminho da barra de ícones", async () => {
    await emAmigos()
    const user = userEvent.setup()
    const roda = document.querySelector<HTMLButtonElement>(".people-aside .me-definicoes")
    expect(roda).toBeTruthy()
    await user.click(roda!)
    expect(screen.getByRole("button", { name: strings.rail.settings, current: "page" })).toBeTruthy()
  })

  it("nos outros destinos a barra continua onde sempre esteve", async () => {
    const user = userEvent.setup()
    render(<App bridge={makeBridge()} />)
    await screen.findByRole("button", { name: strings.rail.social })
    for (const destino of [strings.rail.profile, strings.rail.chat, strings.rail.social, strings.rail.settings]) {
      await user.click(screen.getByRole("button", { name: destino }))
      expect(document.querySelector(".sidebar")).toBeTruthy()
      expect(document.querySelector(".sidebar .me-identity")).toBeTruthy()
    }
  })
})

/**
 * Screen sharing across the whole shell: from the button to the selector.
 *
 * The test happens here, not in the components alone, because what was missing
 * was exactly the CONNECTION. `ecra:fontes`, `ecra:escolher`, `ecra:permissao`
 * and `ecra:abrirDefinicoes` existed, were tested on the main process side, and
 * had not a single caller, the same defect pattern as `FriendsAside` above in
 * this file, and as the desktop bridge that kept audio preferences and never
 * passed them to the engine.
 *
 * The path measured is the whole thing: the hook mounted on the shell, the
 * action crossing the conversation screen to the call panel, and the sheet drawn
 * at the shell level to survive changing conversations. Any one of the three
 * disconnected and this turns red.
 */
describe("Shell — a partilha de ecrã da aplicação instalada", () => {
  /*
    jsdom has no media pipeline: `HTMLMediaElement.play` throws, and the video
    box in the call panel takes the whole shell to the error boundary. It is the
    same line other call tests have, for the same reason.
  */
  beforeAll(() => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
  })

  /*
    Closed conversations live in `localStorage`, and `localStorage` does not die
    between tests in the same file. A test above closes Ana's conversation, on
    purpose, that is what it measures, and without this line the conversation
    does not show in the column here, with the failure pointing the wrong way.
    Only this key: clearing the whole store would delete choices other tests
    plant.
    */
  beforeEach(() => {
    localStorage.removeItem(DM_CLOSED_KEY)
  })

  const ANA = "@ana:casa.pt"
  const CONVERSA = DM_ANA
  const FONTES = [
    { id: "screen:0:0", nome: "Ecrã 1", miniatura: "data:image/png;base64,M", ecraInteiro: true },
    { id: "window:12:0", nome: "Editor", miniatura: "data:image/png;base64,M", ecraInteiro: false },
  ]

  /**
   * The conversation with Ana, open, with a call in progress.
   *
   * In a direct conversation the call lives in the header: in a channel it belongs to
   * a voice room, and you enter it from the list. See `ChatScreen`.
   */
  async function emChamadaComAna(falso: ReturnType<typeof electronFalso>): Promise<void> {
    const user = userEvent.setup()
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    const channelsRef: { current: ((payload: unknown) => void) | null } = { current: null }
    const base = makeBridge(emitRef, channelsRef)
    // The call engine and screen sharing come from Electron faking it, which
    // fails the way Electron fails. See `hooks/electronFalso.ts`.
    const bridge = { ...base, call: falso.bridge.call, ecra: falso.bridge.ecra } as EnclaveBridge
    render(<App bridge={bridge} />)

    await screen.findByRole("button", { name: strings.rail.people })
    await act(async () => {
      channelsRef.current?.({ channels: [FEED, CONVERSA] })
    })
    await act(async () => {
      emitRef.current?.({
        channel: CONVERSA,
        seq: 1,
        sender: ANA,
        payload: { t: "profile", displayName: "Ana", updatedAt: 1 },
      })
    })

    await user.click(screen.getByRole("button", { name: strings.rail.people }))
    const coluna = await screen.findByRole("complementary", { name: strings.people.asideLabel })
    await within(coluna).findByText("Ana")
    await user.click(within(coluna).getByText("Ana"))

    await user.click(await screen.findByRole("button", { name: new RegExp(strings.chat.call) }))
    await screen.findByText(strings.call.waiting)
  }

  const botaoDeEcra = (): HTMLElement | null => document.querySelector<HTMLElement>('.call-controls [data-ecra="1"]')

  it("o botão do painel abre o selector, e a escolha fecha-o e responde ao pedido", async () => {
    const user = userEvent.setup()
    const falso = electronFalso({ fontes: FONTES })
    await emChamadaComAna(falso)

    await user.click(botaoDeEcra()!)

    expect(await screen.findByText(strings.ecra.escolherTitulo)).toBeTruthy()
    const linhas = [...document.querySelectorAll<HTMLElement>(".ecra-fonte")]
    expect(linhas.map((linha) => linha.textContent)).toEqual(["Ecrã 1", "Editor"])

    await user.click(linhas[1]!)

    await vi.waitFor(() => expect(screen.queryByText(strings.ecra.escolherTitulo)).toBeNull())
    // The Chromium request got answered: this is what separates a working selector
    // from a button stuck thinking for two minutes.
    expect(falso.pendentes()).toBe(0)
  })

  it("com a permissão do macOS negada, a concha explica em vez de não fazer nada", async () => {
    const user = userEvent.setup()
    const falso = electronFalso({ fontes: FONTES, permissao: { estado: "denied", podeExplicar: true } })
    await emChamadaComAna(falso)

    await user.click(botaoDeEcra()!)

    expect(await screen.findByText(strings.ecra.permissaoTitulo)).toBeTruthy()
    // And no capture behind the gate.
    expect(falso.capturas()).toBe(0)
    expect(screen.queryByText(strings.ecra.escolherTitulo)).toBeNull()
  })
})

/**
 * The direct conversation only opens after friendship exists.
 *
 * The owner's rule, word for word: "only after the target accepts the request
 * is it possible to exchange private messages, not before that". What we had
 * was the opposite, and not from a missed condition, from no condition at all:
 * `requestFriend` opens the direct conversation BEFORE the request goes out, and
 * the input bar had no guards. The request card drew on top of a working box.
 *
 * Measured live on September 10, 2026, with two accounts in two browsers
 * against the dev server: both wrote, both read, with the request unanswered.
 * And they wrote again after it was REJECTED.
 *
 * The rule lives in `escritaNaDirecta` and has its own tests. This measures
 * the connection, that the shell reads the rule and the screen obeys it,  * because a correct rule nobody checks is the same as having no rule.
 */
describe("Shell — a caixa de escrita de uma conversa directa", () => {
  const ANA = "@ana:casa.pt"
  const CONVERSA = DM_ANA

  /** Open the conversation with Ana after these messages arrive for her. */
  async function conversaComAna(mensagens: { sender: string; payload: unknown }[]): Promise<EnclaveBridge> {
    const user = userEvent.setup()
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    const channelsRef: { current: ((payload: unknown) => void) | null } = { current: null }
    const bridge = makeBridge(emitRef, channelsRef)
    bridge.channels.members = async () => [ME, ANA]
    // The gates of friendship: the direct conversation already exists, and the request goes through it.
    bridge.social.openDirect = vi.fn(async () => CONVERSA)
    bridge.social.friendRequest = vi.fn(async () => ({ ok: true }))
    render(<App bridge={bridge} />)

    await screen.findByRole("button", { name: strings.rail.people })
    await act(async () => {
      channelsRef.current?.({ channels: [FEED, CONVERSA] })
    })
    await act(async () => {
      emitRef.current?.({
        channel: CONVERSA,
        seq: 1,
        sender: ANA,
        payload: { t: "profile", displayName: "Ana", updatedAt: 1 },
      })
      mensagens.forEach((mensagem, indice) => {
        emitRef.current?.({ channel: CONVERSA, seq: indice + 2, ...mensagem })
      })
    })

    await user.click(screen.getByRole("button", { name: strings.rail.people }))
    const coluna = await screen.findByRole("complementary", { name: strings.people.asideLabel })
    await within(coluna).findByText("Ana")
    await user.click(within(coluna).getByText("Ana"))
    return bridge
  }

  /** The input box, if one exists. */
  const caixaDeEscrita = (): Element | null => document.querySelector(".chat-composer")

  it("está trancada enquanto o pedido que fizemos não tiver resposta", async () => {
    await conversaComAna([{ sender: ME, payload: { t: "friend.request", sentAt: 100 } }])

    expect(caixaDeEscrita()).toBeNull()
    expect(screen.getByText(strings.people.escritaEspera)).toBeTruthy()
  })

  it("está trancada enquanto não respondermos ao pedido que nos fizeram", async () => {
    // The other side of the same lock. Without it, the conversation would be one person
    // talking alone to someone who cannot reply.
    await conversaComAna([{ sender: ANA, payload: { t: "friend.request", sentAt: 100 } }])

    expect(caixaDeEscrita()).toBeNull()
    expect(screen.getByText(strings.people.escritaAceitaPrimeiro)).toBeTruthy()
  })

  it("abre no instante em que o pedido é aceite", async () => {
    await conversaComAna([
      { sender: ANA, payload: { t: "friend.request", sentAt: 100 } },
      { sender: ME, payload: { t: "friend.accept", sentAt: 200 } },
    ])

    expect(caixaDeEscrita()).toBeTruthy()
  })

  it("volta a trancar-se depois de uma recusa, que é o caso que ninguém tinha visto", async () => {
    /*
      Rejecting resets the connection to "none" and the request card disappears
      from both sides. Until now only that disappeared: the conversation stayed
      in the list for both, with the input box working and nothing on screen
      saying rejection happened. The rejected person kept writing, and messages
      arrived.
    */
    await conversaComAna([
      { sender: ME, payload: { t: "friend.request", sentAt: 100 } },
      { sender: ANA, payload: { t: "friend.decline", sentAt: 200 } },
    ])

    expect(caixaDeEscrita()).toBeNull()
    expect(screen.getByText(strings.people.escritaSemAmizade)).toBeTruthy()
  })

  it("sem amizade, a barra traz o botão de pedir, e pede pela directa", async () => {
    // The direct with a non-friend was a dead end: the text said "request friendship"
    // and there was no button there. The button calls the same function as the menu and profile.
    const user = userEvent.setup()
    const bridge = await conversaComAna([
      { sender: ME, payload: { t: "friend.request", sentAt: 100 } },
      { sender: ANA, payload: { t: "friend.decline", sentAt: 200 } },
    ])
    const barra = document.querySelector(".chat-escrita-trancada") as HTMLElement
    await user.click(within(barra).getByRole("button", { name: strings.userMenu.friend }))
    await vi.waitFor(() => expect(bridge.social.friendRequest).toHaveBeenCalledWith(CONVERSA, undefined))
  })

  it("enquanto se espera resposta, a barra não oferece pedir outra vez", async () => {
    await conversaComAna([{ sender: ME, payload: { t: "friend.request", sentAt: 100 } }])
    const barra = document.querySelector(".chat-escrita-trancada") as HTMLElement
    expect(within(barra).queryByRole("button")).toBeNull()
  })

  it("e as mensagens que já lá estavam continuam a ler-se", async () => {
    // The lock is about writing, not reading. Deleting what was already said would
    // rewrite the past because of a rule about the future.
    await conversaComAna([
      { sender: ANA, payload: { t: "message", body: "vemo-nos amanhã", sentAt: 100 } },
      { sender: ME, payload: { t: "friend.request", sentAt: 200 } },
    ])

    expect(screen.getByText("vemo-nos amanhã")).toBeTruthy()
    expect(caixaDeEscrita()).toBeNull()
  })
})

/**
 * Channels that only show up after joining also bring what the vault has.
 *
 * Measured in WebKit, with the vault unlocked silently: the first connection
 * dropped before the core reset groups, the list came empty, and history
 * seeded ONCE, with that list. Reconnect restored the channels, and they
 * opened empty with data in the vault. A reload showed everything.
 */
describe("Shell — semear os canais que chegam depois da entrada", () => {
  it("lista vazia à entrada, canais depois da reconexão: a lista e o histórico aparecem", async () => {
    const user = userEvent.setup()
    const LAGAR = "!lagar:casa.pt"
    const bridge = makeBridge()
    const listas = [[], [FEED, LAGAR]]
    let chamadas = 0
    bridge.channels.list = async () => listas[Math.min(chamadas++, 1)] as string[]
    bridge.channels.history = async (canal: string) =>
      canal === LAGAR
        ? [{ seq: 1, sender: "@ana:casa.pt", at: 1, payload: { t: "message", body: "guardada no cofre", sentAt: 1 } }]
        : []
    let ligacao: ((raw: unknown) => void) | null = null
    bridge.on.connection = ((handler: (raw: unknown) => void) => {
      ligacao = handler
      return () => {}
    }) as EnclaveBridge["on"]["connection"]
    // The first connection dropped before `auth.ok`.
    bridge.session.connect = async () => {
      throw new Error("socket closed")
    }
    render(<App bridge={bridge} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    expect(document.querySelector(".channel-row")).toBeNull()

    await act(async () => {
      ligacao?.({ state: "online" })
    })
    await user.click(screen.getByRole("button", { name: strings.rail.chat }))
    const linha = await vi.waitFor(() => {
      const achada = [...document.querySelectorAll(".channel-row")].find((row) => /lagar/.test(row.textContent ?? ""))
      if (!achada) throw new Error("ainda sem a linha do lagar")
      return achada
    })
    await user.click(linha.querySelector("button") as HTMLElement)
    expect(await screen.findByText("guardada no cofre")).toBeTruthy()
  })
})

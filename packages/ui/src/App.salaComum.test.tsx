import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ConnectionState, EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { APRESENTADOS_KEY } from "./hooks/usePrefs.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

afterEach(cleanup)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
/** The public channel that THIS server announces. See `lib/oficial.ts`. */
const COMUM = "!orwell:casa.pt"
/** A normal channel, which is the other side of the same measurement. */
const LAGAR = "!lagar:casa.pt"

/**
 * The public room is open, and the interface had only one place that said so.
 *
 * The fact: the public room is open to any account on this server by design.
 * It is written in `gateway.ts`, inside `channel.groupinfo.take`, "the code
 * is the room's own policy, which is open to any account on this server by
 * design", and anyone who arrives enters on their own, without invite and
 * without anyone admitting them.
 *
 * The bug: the only place the app said this was the welcome card, which you
 * dismiss with one click and never see again (`useApresentacao` remembers who
 * read it on this device). After that, the public channel is indistinguishable
 * from a private one: the same lock saying "only members can read" above the
 * text box, the same list of names beside it, the same footer of invites
 * teaching that the only way to join is to be invited. Anyone writing there
 * does not know they are in a public place.
 *
 * These tests pin the entire CONNECTION: the server announces the public
 * channel, the shell reads it from `hello.ok`, and the screen tells the truth
 * in the two places a person looks. The sentences themselves are pinned in
 * `MemberPanel.test.tsx`; what we measure here is that they reach the screen
 * for real, and only in the right channel.
 *
 * The welcome card is DISMISSED in `beforeEach` on purpose: this is how the app
 * looks for everyone except in the first minute, and this was the state no one
 * had measured.
 */

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
      // The single source of truth: what the server announced in `hello.ok`.
      commonRoom: async () => COMUM,
    },
    channels: {
      list: async () => [COMUM, LAGAR],
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

/** Connect. This is `online` that makes the shell ask what the public channel is. */
async function ligar(state: ConnectionState = "online"): Promise<void> {
  await act(async () => {
    onConnection?.({ state })
    await Promise.resolve()
  })
}

/**
 * Open the app already connected, and go to a channel.
 *
 * Two `act` cycles after `online`: reading the public channel is a promise, and
 * the state it sets only reaches the screen in the next render.
 */
async function abrirCanal(nome: RegExp): Promise<void> {
  const user = userEvent.setup()
  render(<App bridge={ponte()} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  await ligar()
  await act(async () => {
    await Promise.resolve()
  })

  const linha = [...document.querySelectorAll(".channel-row")].find((row) => nome.test(row.textContent ?? ""))
  await user.click(linha?.querySelector("button") as HTMLElement)
}

beforeEach(() => {
  // Without this, the public channel welcome card appears and the measurement
  // only counts for the first minute of an account's life. The bug is exactly
  // what happens AFTER it closes.
  localStorage.setItem(APRESENTADOS_KEY, JSON.stringify([COMUM]))
})

describe("o canal comum diz que é aberto, e diz-lo sempre", () => {
  /*
    The lock and the "Open" in the header are gone, at the owner's request (0.8.0).
    The public channel still says it is open in the member list.
  */
  it('o cabeçalho já não tem o cadeado nem o "Aberto"', async () => {
    await abrirCanal(/orwell/)
    expect(document.querySelector(".topbar .sealed")).toBeNull()
    expect(screen.queryByText("Aberto")).toBeNull()
  })

  it("a lista de pessoas diz que a porta está aberta, que é a pergunta que ela responde", async () => {
    await abrirCanal(/orwell/)
    expect(await screen.findByText(strings.members.openChannel)).toBeTruthy()
  })

  it("num canal normal o cabeçalho também não tem cadeado", async () => {
    await abrirCanal(/lagar/)
    expect(document.querySelector(".topbar .sealed")).toBeNull()
  })

  it("e a lista de um canal normal não anuncia porta aberta nenhuma", async () => {
    await abrirCanal(/lagar/)
    expect(screen.queryByText(strings.members.openChannel)).toBeNull()
  })

  it("continua a dizê-lo depois de o cartão de boas-vindas ter sido lido e fechado", async () => {
    // Proof this is not the card again with different clothes: `beforeEach` marks
    // the channel as already presented, and the card does not appear.
    await abrirCanal(/orwell/)
    expect(screen.queryByText(strings.oficial.apresentacaoBody)).toBeNull()
    expect(await screen.findByText(strings.members.openChannel)).toBeTruthy()
  })
})

describe("e não o diz antes de o saber", () => {
  it("enquanto a ligação não abrir, o canal comum é um canal como os outros", async () => {
    const user = userEvent.setup()
    render(<App bridge={ponte()} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    // Without `online`, no one asked what the public channel is: `commonRoom` is
    // `null`, and `ehCanalOficial` says no to everything. Showing the badge too
    // late is a delay; showing it too early would be a lie.
    const linha = [...document.querySelectorAll(".channel-row")].find((row) =>
      /orwell/.test(row.textContent ?? ""),
    )
    await user.click(linha?.querySelector("button") as HTMLElement)
    expect(screen.queryByText(strings.members.openChannel)).toBeNull()
  })
})

describe('"Entrar no canal Orwell", para quem está de fora (3/11/2026)', () => {
  /** The top bridge, with the channel list and the choice that fits. */
  function ponteCom(canais: string[], escolher?: (entrar: boolean) => Promise<{ ok: boolean }>): EnclaveBridge {
    const base = ponte()
    base.channels.list = async () => canais
    if (escolher) base.session.escolherSalaComum = escolher
    return base
  }

  async function abrir(bridge: EnclaveBridge): Promise<void> {
    render(<App bridge={bridge} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    await ligar()
    await act(async () => {
      await Promise.resolve()
    })
  }

  it("fora do canal comum, o botão está na coluna e entra com a escolha", async () => {
    const escolher = vi.fn(async () => ({ ok: true }))
    await abrir(ponteCom([LAGAR], escolher))
    const botao = await screen.findByRole("button", { name: strings.sidebar.entrarNoCanalOficial })
    await userEvent.setup().click(botao)
    expect(escolher).toHaveBeenCalledWith(true)
  })

  it("dentro do canal comum, não há botão", async () => {
    await abrir(ponteCom([COMUM, LAGAR], vi.fn(async () => ({ ok: true }))))
    await screen.findAllByText(/lagar/)
    expect(screen.queryByRole("button", { name: strings.sidebar.entrarNoCanalOficial })).toBeNull()
  })

  it("um anfitrião sem a escolha não mostra o botão", async () => {
    await abrir(ponteCom([LAGAR]))
    await screen.findAllByText(/lagar/)
    expect(screen.queryByRole("button", { name: strings.sidebar.entrarNoCanalOficial })).toBeNull()
  })
})

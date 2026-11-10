import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { StoredChatMessage } from "@enclave/client-core"
import type { ChannelRoom, EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

afterEach(cleanup)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const CANAL = "!lagar:casa.pt"
const QUANDO = 1_700_000_000_000

/**
 * "General chat history disappears for me when a new user joins"
 * (owner report, 3/11/2026, in the new accounts wave on the common channel).
 *
 * Each entry to the common channel makes each connected member republish their profile, and
 * whoever has authority rank and the rooms. The core gives each of these payloads
 * to the interface as `message`, and the conversation memory has a hard cap PER CHANNEL
 * (`MEMORY_HARD_CAP`). Counted against the cap, the profiles pushed out the
 * older messages from the conversation, which only came back on reload (the vault
 * has them). What is not conversation cannot spend the conversation's space.
 */
function guardada(seq: number, body: string): StoredChatMessage {
  return {
    seq,
    sender: ANA,
    at: QUANDO + seq * 60_000,
    payload: { t: "message", id: `m-${seq}`, sentAt: QUANDO + seq * 60_000, body },
  }
}

function ponte(cofre: StoredChatMessage[], ouvinte: { atual: ((m: unknown) => void) | null }): EnclaveBridge {
  const salas: ChannelRoom[] = []
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
      list: async () => [CANAL],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: vi.fn(async () => ({ ok: true })),
      declineChannelInvite: vi.fn(async () => ({ ok: true })),
      send: async () => ({ ok: true }),
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [EU, ANA],
      history: async () => cofre,
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      rooms: () => salas,
      meta: () => null,
      editMessage: async () => ({ ok: true }),
      deleteMessage: async () => ({ ok: true }),
    },
    invites: {
      create: async () => "enclave://join/x/y#z",
      redeem: async () => ({ ok: true }),
      list: async () => [],
      revoke: async () => ({ ok: true }),
    },
    social: {
      post: async () => ({ ok: true }),
      acceptFollower: vi.fn(async () => ({ ok: true })),
      acceptFriend: vi.fn(async () => ({ ok: true })),
      declineFriend: vi.fn(async () => ({ ok: true })),
      unfriend: vi.fn(async () => ({ ok: true })),
      repairInvite: async () => ({ invited: true }),
      deadWelcomes: async () => [],
      feedChannel: async () => MURAL_EU,
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      // How the vault stores it: the timestamp outside, the profile in `payload`.
      // Without it the name does not resolve and the result line shows the address,
      // which is true but not what you ask for in a results list.
      directory: async () => ({
        [ANA]: { at: QUANDO, payload: { t: "profile", displayName: "Ana", donations: [], updatedAt: QUANDO } },
      }),
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    on: {
      message: (tratador: (m: unknown) => void) => {
        ouvinte.atual = tratador
        return () => {
          ouvinte.atual = null
        }
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
  } as unknown as EnclaveBridge
}

/** The app open on the channel, with the vault already seeded. */
async function noCanal(cofre: StoredChatMessage[], ouvinte: { atual: ((m: unknown) => void) | null }): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  render(<App bridge={ponte(cofre, ouvinte)} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  await user.click(screen.getByRole("button", { name: strings.rail.chat }))
  await act(async () => {
    await Promise.resolve()
  })
  return user
}

describe("o histórico no ecrã quando entra gente no canal", () => {
  it("os perfis republicados não empurram a conversa para fora do ecrã", async () => {
    const ouvinte: { atual: ((m: unknown) => void) | null } = { atual: null }
    const cofre = Array.from({ length: 200 }, (_, i) => guardada(i + 1, `conversa antiga número ${i + 1}`))
    await noCanal(cofre, ouvinte)
    expect(await screen.findByText("conversa antiga número 200")).toBeTruthy()
    expect(screen.getByText("conversa antiga número 1")).toBeTruthy()

    // A wave of entries: three hundred republished profiles (fifteen entries,
    // twenty connected members), and the rooms and authority of whoever runs them.
    await act(async () => {
      for (let i = 0; i < 300; i++) {
        ouvinte.atual?.({
          channel: CANAL,
          seq: 1_000 + i,
          sender: `@membro${i % 20}:casa.pt`,
          payload: { t: "profile", displayName: `Membro ${i % 20}`, donations: [], updatedAt: QUANDO + i },
        })
      }
      await Promise.resolve()
    })

    expect(screen.getByText("conversa antiga número 1")).toBeTruthy()
    expect(screen.getByText("conversa antiga número 200")).toBeTruthy()
  })

  /*
    The same cap, on the names side: a profile that arrived live lived only in
    the conversation list, and left it with the conversation that came next. The name
    went back to "No name" with the name in the vault, until reload.
  */
  it("o nome de quem entrou não se perde com a conversa que vem depois", async () => {
    const ouvinte: { atual: ((m: unknown) => void) | null } = { atual: null }
    await noCanal([guardada(1, "olá")], ouvinte)
    expect(await screen.findByText("olá")).toBeTruthy()
    const NOVO = "@novo:casa.pt"
    await act(async () => {
      ouvinte.atual?.({ channel: CANAL, seq: 10, sender: NOVO, payload: { t: "profile", displayName: "Bartolomeu", donations: [], updatedAt: QUANDO } })
      for (let i = 0; i < 450; i++) {
        ouvinte.atual?.({ channel: CANAL, seq: 11 + i, sender: ANA, payload: { t: "message", id: `m-vaga-${i}`, sentAt: QUANDO + i, body: `vaga ${i}` } })
      }
      ouvinte.atual?.({ channel: CANAL, seq: 999, sender: NOVO, payload: { t: "message", id: "m-do-novo", sentAt: QUANDO + 1e6, body: "cheguei" } })
      await Promise.resolve()
    })
    const linha = screen.getByText("cheguei").closest(".message")
    expect(linha?.textContent).toContain("Bartolomeu")
  })

  it("nem as salas e os cargos que se repetem a cada entrada", async () => {
    const ouvinte: { atual: ((m: unknown) => void) | null } = { atual: null }
    const cofre = Array.from({ length: 200 }, (_, i) => guardada(i + 1, `conversa antiga número ${i + 1}`))
    await noCanal(cofre, ouvinte)
    expect(await screen.findByText("conversa antiga número 1")).toBeTruthy()

    // Whoever runs and whoever alternates tell the rooms again at each growth.
    await act(async () => {
      for (let i = 0; i < 300; i++) {
        ouvinte.atual?.({
          channel: CANAL,
          seq: 2_000 + i,
          sender: ANA,
          payload: { t: "channel.meta", room: "apresentacoes", name: "apresentações", kind: "text", updatedAt: QUANDO + i },
        })
      }
      await Promise.resolve()
    })
    expect(screen.getByText("conversa antiga número 1")).toBeTruthy()

    // And the new conversation still fits: the cap is on the conversation.
    await act(async () => {
      ouvinte.atual?.({ channel: CANAL, seq: 5_000, sender: ANA, payload: { t: "message", id: "m-nova", sentAt: QUANDO + 9e6, body: "chegou agora" } })
      await Promise.resolve()
    })
    expect(screen.getByText("chegou agora")).toBeTruthy()
  })
})

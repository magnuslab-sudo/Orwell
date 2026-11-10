import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, within } from "@testing-library/react"
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
const ESTALEIRO = "estaleiro"

/**
 * Searching in a conversation, from the screen's perspective.
 *
 * What binds here is the whole promise, and it has three parts that only
 * together mean anything:
 *
 * 1. **Search reaches the VAULT, not just what is on screen.** The shell seeds
 *    the two hundred most recent messages from each channel; the rest of the
 *    history loads into memory on demand. So the target of these tests is stored
 *    BEHIND those two hundred. if search read the conversation list, it would
 *    not find it, and the suite would pass while testing only half the feature.
 *
 * 2. **Once found, jump to it.** Even to another room in the same channel:
 *    the vault history is for the whole channel and the on-screen conversation
 *    is for one room.
 *
 * 3. **And anything already out of the vault gets reported.** Without this, a
 *    search that fails is indistinguishable from a message that never existed.
 *
 * None of this is measured with `toHaveBeenCalled`: it is measured by the text
 * on screen, the room that is now open, and the line that lights up.
 */

const QUANDO = 1_700_000_000_000

/** A vault entry, the way `channels.history` returns it. */
function guardada(seq: number, body: string, room = ""): StoredChatMessage {
  return {
    seq,
    sender: ANA,
    at: QUANDO + seq * 60_000,
    payload: { t: "message", id: `m-${seq}`, sentAt: QUANDO + seq * 60_000, body, room },
  }
}

/**
 * A vault with the needle far back.
 *
 * Two hundred fifty messages: seeding brings the last two hundred, and the
 * first fifty-with the needle among them-stay out of memory. This distance
 * is what makes the difference between searching the vault and searching
 * the screen.
 */
function cofreFundo(): StoredChatMessage[] {
  const entradas = [guardada(1, "as inscrições do estaleiro fecham na sexta", ESTALEIRO)]
  for (let i = 2; i <= 250; i++) entradas.push(guardada(i, `conversa do dia número ${i}`))
  return entradas
}

const SALAS: ChannelRoom[] = [
  { room: ESTALEIRO, name: "Estaleiro", category: "", kind: "text", position: 1 },
]

function ponte(cofre: StoredChatMessage[], salas: ChannelRoom[] = SALAS): EnclaveBridge {
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

/** The app open on the channel, with the vault already seeded. */
async function noCanal(cofre: StoredChatMessage[], salas?: ChannelRoom[]): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  render(<App bridge={ponte(cofre, salas)} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  await user.click(screen.getByRole("button", { name: strings.rail.chat }))
  await act(async () => {
    await Promise.resolve()
  })
  return user
}

/** Abrir a folha e escrever. */
async function procurar(user: ReturnType<typeof userEvent.setup>, termo: string): Promise<HTMLElement> {
  await user.click(await screen.findByRole("button", { name: strings.chat.searchToggle }))
  const folha = await screen.findByRole("dialog", { name: strings.chat.searchToggle })
  await user.type(within(folha).getByPlaceholderText(strings.chat.searchPlaceholder), termo)
  return folha
}

describe("procurar na conversa, visto do ecrã", () => {
  it("encontra uma mensagem que já não está na conversa em memória", async () => {
    const user = await noCanal(cofreFundo())

    // The needle is two hundred fifty messages away: outside what seeding
    // brought, and so outside the screen.
    expect(screen.queryByText(/inscrições do estaleiro/)).toBeNull()

    const folha = await procurar(user, "inscrições")

    const resultado = within(folha).getByRole("button", { name: new RegExp(strings.chat.searchJump) })
    expect(resultado.textContent).toContain("as inscrições do estaleiro fecham na sexta")
    // Who said it, by profile name not by address.
    expect(within(folha).getByText("Ana")).toBeTruthy()
    // And where it came from, because it is not the open room.
    expect(within(folha).getByText(strings.chat.searchInRoom("Estaleiro"))).toBeTruthy()
  })

  it("carregar no resultado abre a sala certa e acende a mensagem", async () => {
    const user = await noCanal(cofreFundo())
    const folha = await procurar(user, "inscrições")

    await user.click(within(folha).getByRole("button", { name: new RegExp(strings.chat.searchJump) }))

    // The sheet steps back: it was on top of the conversation.
    expect(screen.queryByRole("dialog", { name: strings.chat.searchToggle })).toBeNull()
    // The message is on screen, in the room where it was said, and highlighted.
    const linha = await screen.findByText("as inscrições do estaleiro fecham na sexta")
    expect(linha.closest(".message")?.classList.contains("destacada")).toBe(true)
    // And the rest of the default room's conversation stayed behind: switched
    // rooms, and did not join the two.
    expect(screen.queryByText("conversa do dia número 250")).toBeNull()
  })

  it("diz que o mais antigo já saiu deste aparelho quando o cofre está no tecto", async () => {
    const cheio = Array.from({ length: 400 }, (_, i) => guardada(i + 1, `linha número ${i + 1}`))
    const user = await noCanal(cheio)

    const folha = await procurar(user, "linha")

    expect(within(folha).getByText(strings.chat.searchCeiling)).toBeTruthy()
  })

  it("com folga no cofre não inventa o aviso", async () => {
    const user = await noCanal([guardada(1, "uma linha só")])

    const folha = await procurar(user, "linha")

    expect(within(folha).queryByText(strings.chat.searchCeiling)).toBeNull()
  })

  it("não encontrar diz onde se procurou, em vez de calar", async () => {
    const user = await noCanal([guardada(1, "uma linha só")])

    const folha = await procurar(user, "agulha")

    expect(within(folha).getByText(strings.chat.searchEmpty("agulha"))).toBeTruthy()
    expect(within(folha).getByText(strings.chat.searchScanned(1))).toBeTruthy()
  })

  /**
   * What you search for is what the message says NOW.
   *
   * The edit is in the vault as an `edit` next to the original message, and it
   * is the fold of the conversation that joins them. Without it, search was the
   * only door in the product through which the old text of an edited message
   * would appear again-and it would appear as if it were the current text.
   */
  it("uma mensagem corrigida encontra-se pelo texto novo, e não pelo antigo", async () => {
    const user = await noCanal([
      guardada(1, "o encontro é na quinta"),
      {
        seq: 2,
        sender: ANA,
        at: QUANDO + 120_000,
        payload: { t: "edit", target: "m-1", body: "o encontro é na sexta", editedAt: QUANDO + 120_000 },
      },
    ])

    const folha = await procurar(user, "quinta")
    expect(within(folha).getByText(strings.chat.searchEmpty("quinta"))).toBeTruthy()

    await user.clear(within(folha).getByPlaceholderText(strings.chat.searchPlaceholder))
    await user.type(within(folha).getByPlaceholderText(strings.chat.searchPlaceholder), "sexta")

    expect(
      within(folha).getByRole("button", { name: new RegExp(strings.chat.searchJump) }).textContent,
    ).toContain("o encontro é na sexta")
  })

  /**
   * A deleted room does not leave orphan results.
   *
   * What was said in a room that no longer exists stays in the vault with the
   * label it always had, and reads in the default room-that is the rule the
   * conversation already applies, and search must give the same answer. Without
   * it, the result said "in Deleted" to someone in the default room looking at
   * it, and the jump sent them to a room that is nowhere: empty conversation,
   * sidebar with nothing selected, and no explanation.
   */
  it("uma mensagem de uma sala eliminada lê-se na sala por omissão, e o salto leva lá", async () => {
    const user = await noCanal([guardada(1, "a agulha da sala demolida", "demolida")], SALAS)

    const folha = await procurar(user, "agulha")

    /*
      It reads where we are, so there is NO room to announce-and that is how
      it stands, not by the absence of a particular name. The first version of
      this test searched for "in Deleted" and passed with translation off:
      without it the name resolved to the default room, and the line said "in
      general" to someone in general. Absent is absent.
    */
    expect(folha.querySelector(".procura-sala")).toBeNull()

    await user.click(within(folha).getByRole("button", { name: new RegExp(strings.chat.searchJump) }))

    const linha = await screen.findByText("a agulha da sala demolida")
    expect(linha.closest(".message")?.classList.contains("destacada")).toBe(true)
  })

  it("um termo com parênteses procura-se, e não deita nada abaixo", async () => {
    const user = await noCanal([guardada(1, "o valor (com IVA) são 300")])

    const folha = await procurar(user, "(com IVA)")

    expect(
      within(folha).getByRole("button", { name: new RegExp(strings.chat.searchJump) }).textContent,
    ).toContain("o valor (com IVA) são 300")
  })
})

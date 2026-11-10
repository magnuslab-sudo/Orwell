import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge, PinnedMessage } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

afterEach(cleanup)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const CANAL = "!lagar:casa.pt"
const SALA = ""

/**
 * Pinning messages, from the screen's perspective.
 *
 * Here we do not measure whether the bridge was called, we measure what a
 * person sees: the entry that appears (or does not) in the right-click menu, the
 * banner showing how many are pinned, and what the sheet shows when opened. A
 * `toHaveBeenCalled` would say the code ran; none of that answers the question
 * that matters, which is whether someone without the role can reach the gesture.
 *
 * The real guard is not here and this file does not pretend it is: it lives in
 * the core, and its second half in the receiver, see `session.fixar.test.ts`.
 * What binds here is the other half of the house rule: **what you cannot do does
 * not appear grayed out, does not appear at all.**
 */

/** The message clock: fixed, so dates do not change during the run. */
const QUANDO = 1_700_000_000_000

interface Opcoes {
  podeFixar: boolean
  fixadas?: PinnedMessage[]
}

/**
 * A bridge with memory, so the screen can respond to what is done to it.
 *
 * `pin` stores and re-emits the `channel.meta`, which is what the real session
 * does: our own send never loops through the server, and enters this side's
 * message list. That echo is what makes the screen ask again for pinned
 * messages, without it, the test measured a screen that never knew anything
 * happened.
 */
function ponteComFixadas(
  opcoes: Opcoes,
  emitRef: { current: ((message: unknown) => void) | null },
): EnclaveBridge {
  let onMessage: ((message: unknown) => void) | null = null
  const fixadas: PinnedMessage[] = [...(opcoes.fixadas ?? [])]

  const ecoDaSala = (): void => {
    onMessage?.({
      channel: CANAL,
      seq: -1,
      sender: EU,
      payload: {
        t: "channel.meta",
        room: SALA,
        name: "geral",
        category: "",
        kind: "text",
        position: -1,
        closed: false,
        removed: false,
        updatedAt: Date.now(),
      },
    })
  }

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
      history: async () => [],
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      rooms: () => [],
      meta: () => null,
      editMessage: async () => ({ ok: true }),
      deleteMessage: async () => ({ ok: true }),
      // What this file exists to exercise.
      mayPin: () => opcoes.podeFixar,
      pins: () => [...fixadas],
      pin: async (_canal: string, _sala: string, mensagem: PinnedMessage extends never ? never : {
        id: string
        sender: string
        body: string
        sentAt: number
      }) => {
        fixadas.push({ ...mensagem, pinnedAt: Date.now(), pinnedBy: EU })
        ecoDaSala()
        return { ok: true }
      },
      unpin: async (_canal: string, _sala: string, id: string) => {
        const indice = fixadas.findIndex((fixada) => fixada.id === id)
        if (indice >= 0) fixadas.splice(indice, 1)
        ecoDaSala()
        return { ok: true }
      },
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
      directory: async () => ({ [ANA]: { displayName: "Ana", donations: [] } }),
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    on: {
      message: (handler: (message: unknown) => void) => {
        onMessage = handler
        emitRef.current = handler
        return () => {
          onMessage = null
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

/** The app open in the channel, with a message from Ana in the conversation. */
async function noCanal(opcoes: Opcoes): Promise<{ user: ReturnType<typeof userEvent.setup> }> {
  const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
  const user = userEvent.setup()
  render(<App bridge={ponteComFixadas(opcoes, emitRef)} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  await user.click(screen.getByRole("button", { name: strings.rail.chat }))

  await act(async () => {
    emitRef.current?.({
      channel: CANAL,
      seq: 1,
      sender: ANA,
      payload: { t: "message", id: "m-inscricoes-1", sentAt: QUANDO, body: "As inscrições fecham na sexta." },
    })
    await Promise.resolve()
  })
  return { user }
}

describe("fixar uma mensagem, visto do ecrã", () => {
  it("quem tem o cargo abre o menu na mensagem de OUTRA pessoa e fixa-a", async () => {
    const { user } = await noCanal({ podeFixar: true })

    // Before pinning, nothing in the header: a button that opened an empty list
    // was a promise left unfulfilled in every conversation.
    expect(screen.queryByRole("button", { name: strings.chat.pinnedToggle })).toBeNull()

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("As inscrições fecham na sexta.") })
    await user.click(await screen.findByText(strings.chat.messagePin))

    // What the person sees next: the count in the header.
    const botao = await screen.findByRole("button", { name: strings.chat.pinnedToggle })
    expect(botao.textContent).toContain("1")

    // And the message in it, with who said it.
    await user.click(botao)
    const folha = screen.getByRole("dialog", { name: strings.chat.pinnedTitle })
    expect(within(folha).getByText("As inscrições fecham na sexta.")).toBeTruthy()
    // And who put it there. This is the field that republishing would have
    // rewritten if it were inferred from the sender instead of traveling in the pin.
    expect(within(folha).getByText(strings.chat.pinnedBy("Vera"))).toBeTruthy()
  })

  it("e desafixa-a a partir da folha, que se fecha por ficar sem nada", async () => {
    const { user } = await noCanal({
      podeFixar: true,
      fixadas: [
        {
          id: "m-inscricoes-1",
          sender: ANA,
          body: "As inscrições fecham na sexta.",
          sentAt: QUANDO,
          pinnedAt: QUANDO,
          pinnedBy: EU,
        },
      ],
    })

    await user.click(screen.getByRole("button", { name: strings.chat.pinnedToggle }))
    const folha = screen.getByRole("dialog", { name: strings.chat.pinnedTitle })
    await user.click(within(folha).getByText(strings.chat.messageUnpin))

    // With nothing pinned, the header returns to what it was. (It was "Invite..." that
    // served as proof; it left the header on October 26, 2026.)
    expect(await screen.findByRole("button", { name: strings.chat.membersToggle })).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.chat.pinnedToggle })).toBeNull()
  })

  it("uma mensagem alheia sem identificador só oferece copiar, e nunca fixar", async () => {
    // No identifier means no pinning, and if it is from someone else there is no
    // editing or deleting. Only "Copy text" remains, which is available for all
    // messages with text: the house menu always starts there.
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    const user = userEvent.setup()
    render(<App bridge={ponteComFixadas({ podeFixar: true }, emitRef)} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    await user.click(screen.getByRole("button", { name: strings.rail.chat }))

    await act(async () => {
      emitRef.current?.({
        channel: CANAL,
        seq: 1,
        sender: ANA,
        payload: { t: "message", sentAt: QUANDO, body: "uma mensagem sem identificador" },
      })
      await Promise.resolve()
    })

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("uma mensagem sem identificador") })

    expect(screen.getByRole("menuitem", { name: strings.chat.copyText })).toBeTruthy()
    expect(screen.queryByText(strings.chat.messagePin)).toBeNull()
  })

  it("uma mensagem já fixada oferece DESAFIXAR no menu, e não fixar outra vez", async () => {
    const { user } = await noCanal({
      podeFixar: true,
      fixadas: [
        {
          id: "m-inscricoes-1",
          sender: ANA,
          body: "As inscrições fecham na sexta.",
          sentAt: QUANDO,
          pinnedAt: QUANDO,
          pinnedBy: EU,
        },
      ],
    })

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("As inscrições fecham na sexta.") })

    expect(await screen.findByText(strings.chat.messageUnpin)).toBeTruthy()
    expect(screen.queryByText(strings.chat.messagePin)).toBeNull()
  })
})

/**
 * The house rule: what you cannot do does not appear grayed out, does not
 * appear.
 *
 * And its companion half, the one people forget: **what you CAN READ keeps
 * being readable.** Pinning is a responsibility; seeing what is pinned is not
 * one, the message is in everyone's conversation, and hiding it from the top
 * from someone who cannot touch it would be hiding something already in front
 * of them.
 */
describe("fixar uma mensagem: quem não tem o cargo", () => {
  it("não tem por onde fixar — nem a entrada de menu, nem o botão direito", async () => {
    const { user } = await noCanal({ podeFixar: false })

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("As inscrições fecham na sexta.") })

    // Neither the entry nor any menu: the message is from someone else, and with
    // no pinning there is nothing to do to it. The right-click button goes back to
    // the system one, which is what someone wants to copy text.
    expect(screen.queryByText(strings.chat.messagePin)).toBeNull()
    expect(screen.queryByText(strings.chat.messageDelete)).toBeNull()
  })

  it("mas continua a VER o que está fixado, e sem botão para desafixar", async () => {
    const { user } = await noCanal({
      podeFixar: false,
      fixadas: [
        {
          id: "m-inscricoes-1",
          sender: ANA,
          body: "As inscrições fecham na sexta.",
          sentAt: QUANDO,
          pinnedAt: QUANDO,
          pinnedBy: ANA,
        },
      ],
    })

    await user.click(screen.getByRole("button", { name: strings.chat.pinnedToggle }))
    const folha = screen.getByRole("dialog", { name: strings.chat.pinnedTitle })

    expect(within(folha).getByText("As inscrições fecham na sexta.")).toBeTruthy()
    expect(within(folha).queryByText(strings.chat.messageUnpin)).toBeNull()
  })
})

/**
 * What the sheet shows when the original message no longer exists on this side.
 *
 * This happens to someone who entered the channel after the message was sent,  * persistent secrecy locks that epoch for them forever, and to someone who
 * already saw it dumped from the history, which has a cap. The copy is what
 * remains, and it is what makes "pinned" something that still wants to mean
 * something.
 */
describe("quem não tem a mensagem original", () => {
  it("lê na mesma o que está fixado, pela cópia que viajou com a fixação", async () => {
    const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
    const user = userEvent.setup()
    render(
      <App
        bridge={ponteComFixadas(
          {
            podeFixar: false,
            fixadas: [
              {
                id: "m-de-janeiro",
                sender: ANA,
                body: "O código do portão é 4417.",
                sentAt: QUANDO,
                pinnedAt: QUANDO,
                pinnedBy: ANA,
              },
            ],
          },
          emitRef,
        )}
      />,
    )
    await screen.findByRole("button", { name: strings.rail.chat })
    await user.click(screen.getByRole("button", { name: strings.rail.chat }))

    // The conversation is empty: nothing has been sent, which is what anyone arriving sees.
    await user.click(await screen.findByRole("button", { name: strings.chat.pinnedToggle }))
    const folha = screen.getByRole("dialog", { name: strings.chat.pinnedTitle })

    expect(within(folha).getByText("O código do portão é 4417.")).toBeTruthy()
    // And the stated limit where it reads, not discovered later.
    expect(within(folha).getByText(strings.chat.pinnedNote)).toBeTruthy()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "./bridge.js"
import type { StoredChatMessage } from "@enclave/client-core"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

/**
 * Replying, from the whole screen: the menu, the bar above the box, sending
 * with and without mention, the reply that stays in the room as a draft, and
 * the click on the quote that goes to the original (and fetches it from the
 * vault).
 */

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")
const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const CANAL = "!lagar:casa.pt"
const QUANDO = 1_700_000_000_000

afterEach(cleanup)
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

type Envio = [channel: string, body: string, room?: string, extras?: Record<string, unknown>]

function ponte(
  emitRef: { current: ((message: unknown) => void) | null },
  ligarRef: { current: ((estado: unknown) => void) | null },
  envios: Envio[],
  historico: StoredChatMessage[] = [],
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
      list: async () => [CANAL],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: vi.fn(async () => ({ ok: true })),
      declineChannelInvite: vi.fn(async () => ({ ok: true })),
      send: async (...envio: Envio) => {
        envios.push(envio)
        return { ok: true }
      },
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [EU, ANA],
      history: async () => historico,
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      rooms: () => [
        { room: "", name: "geral", category: "", kind: "text", position: 0 },
        { room: "obras", name: "obras", category: "", kind: "text", position: 1 },
      ],
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
      directory: async () => ({ [ANA]: { displayName: "Ana", donations: [] } }),
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    on: {
      message: (handler: (message: unknown) => void) => {
        emitRef.current = handler
        return () => {}
      },
      epoch: () => () => {},
      status: () => () => {},
      connection: (handler: (estado: unknown) => void) => {
        ligarRef.current = handler
        return () => {}
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

const DA_ANA = { t: "message", id: "pergunta-da-ana", sentAt: QUANDO, body: "Quem vem amanhã ao lagar?" }

async function noCanal(historico: StoredChatMessage[] = []): Promise<{
  user: ReturnType<typeof userEvent.setup>
  envios: Envio[]
  emitir: (message: unknown) => Promise<void>
}> {
  const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
  const ligarRef: { current: ((estado: unknown) => void) | null } = { current: null }
  const envios: Envio[] = []
  const user = userEvent.setup()
  render(<App bridge={ponte(emitRef, ligarRef, envios, historico)} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  await user.click(screen.getByRole("button", { name: strings.rail.chat }))
  // Online: without this the message stays in the outbox "waiting for connection".
  await act(async () => {
    ligarRef.current?.({ state: "online" })
    await Promise.resolve()
  })
  const emitir = async (message: unknown): Promise<void> => {
    await act(async () => {
      emitRef.current?.(message)
      await Promise.resolve()
    })
  }
  return { user, envios, emitir }
}

/** The text box. By the form not the help text, which changes with the connection. */
const caixa = (): HTMLInputElement => document.querySelector<HTMLInputElement>(".chat-composer .composer-line input:not([type])")!

async function responderPeloMenu(user: ReturnType<typeof userEvent.setup>, texto: string): Promise<void> {
  await user.pointer({ keys: "[MouseRight]", target: await screen.findByText(texto) })
  await user.click(await screen.findByRole("menuitem", { name: strings.respostas.responder }))
}

function abrirSala(nome: string): HTMLElement {
  const linha = [...document.querySelectorAll<HTMLElement>(".room-row")].find((row) => row.textContent?.includes(nome))
  if (!linha) throw new Error(`não há sala ${nome}`)
  return linha.querySelector<HTMLElement>("button") ?? linha
}

describe("responder, no ecrã inteiro", () => {
  it("pelo menu: a barra aparece, a resposta sai com o replyTo e a menção, e a barra fecha", async () => {
    const { user, envios, emitir } = await noCanal()
    await emitir({ channel: CANAL, seq: 1, sender: ANA, payload: DA_ANA })
    await responderPeloMenu(user, "Quem vem amanhã ao lagar?")

    const barra = document.querySelector(".composer-resposta")!
    expect(barra.textContent).toContain("A responder a")
    expect(barra.textContent).toContain("Ana")
    expect(document.activeElement).toBe(caixa())

    await user.type(caixa(), "Eu vou.{Enter}")
    await waitFor(() => expect(envios).toHaveLength(1))
    expect(envios[0]![1]).toBe("Eu vou.")
    expect(envios[0]![3]).toEqual({ replyTo: "pergunta-da-ana", mentions: [ANA] })
    expect(document.querySelector(".composer-resposta")).toBeNull()
  })

  it("com «@ Mencionar» desligado, a resposta não menciona ninguém", async () => {
    const { user, envios, emitir } = await noCanal()
    await emitir({ channel: CANAL, seq: 1, sender: ANA, payload: DA_ANA })
    await responderPeloMenu(user, "Quem vem amanhã ao lagar?")
    await user.click(screen.getByRole("button", { name: /@ Mencionar/ }))
    await user.type(caixa(), "Eu também.{Enter}")
    await waitFor(() => expect(envios).toHaveLength(1))
    expect(envios[0]![3]).toEqual({ replyTo: "pergunta-da-ana" })
  })

  it("Esc cancela a resposta", async () => {
    const { user, emitir } = await noCanal()
    await emitir({ channel: CANAL, seq: 1, sender: ANA, payload: DA_ANA })
    await responderPeloMenu(user, "Quem vem amanhã ao lagar?")
    await user.keyboard("{Escape}")
    expect(document.querySelector(".composer-resposta")).toBeNull()
  })

  it("a resposta pendente fica na sala onde começou, como um rascunho", async () => {
    const { user, emitir } = await noCanal()
    await emitir({ channel: CANAL, seq: 1, sender: ANA, payload: DA_ANA })
    await responderPeloMenu(user, "Quem vem amanhã ao lagar?")

    await user.click(abrirSala("obras"))
    await waitFor(() => expect(document.querySelector(".composer-resposta")).toBeNull())

    await user.click(abrirSala("geral"))
    await waitFor(() => expect(document.querySelector(".composer-resposta")?.textContent).toContain("Ana"))
  })

  it("carregar na citação leva ao original e acende-o", async () => {
    const { user, emitir } = await noCanal()
    await emitir({ channel: CANAL, seq: 1, sender: ANA, payload: DA_ANA })
    await emitir({
      channel: CANAL,
      seq: 2,
      sender: ANA,
      payload: { t: "message", id: "a-resposta-1", sentAt: QUANDO + 1000, body: "Respondo a mim.", replyTo: "pergunta-da-ana" },
    })
    await user.click(screen.getByRole("button", { name: "Ir para a mensagem de Ana" }))
    await waitFor(() =>
      expect(document.querySelector('.message.destacada')?.getAttribute("data-mensagem")).toBe("pergunta-da-ana"),
    )
  })

  it("um original fora da memória vem do cofre ao carregar na citação", async () => {
    // The original is the oldest vault entry, and seeding brings only the 200 most recent.
    const enchimento: StoredChatMessage[] = Array.from({ length: 200 }, (_, i) => ({
      seq: i + 2,
      sender: EU,
      payload: { t: "message", id: `enchimento-${String(i).padStart(4, "0")}`, sentAt: QUANDO + (i + 2) * 1000, body: `linha ${i}` },
    })) as unknown as StoredChatMessage[]
    const original = { seq: 1, sender: ANA, payload: DA_ANA } as unknown as StoredChatMessage
    const { user, emitir } = await noCanal([original, ...enchimento])
    await screen.findByText("linha 199")
    await emitir({
      channel: CANAL,
      seq: 300,
      sender: ANA,
      payload: { t: "message", id: "a-resposta-2", sentAt: QUANDO + 999_000, body: "Lembram-se disto?", replyTo: "pergunta-da-ana" },
    })
    await user.click(await screen.findByRole("button", { name: strings.respostas.porCarregar }))
    await waitFor(() =>
      expect(document.querySelector('.message.destacada')?.getAttribute("data-mensagem")).toBe("pergunta-da-ana"),
    )
    // And the quote now shows the original.
    expect(screen.getByRole("button", { name: "Ir para a mensagem de Ana" }).textContent).toContain("Quem vem amanhã")
  })

  it("um original apagado diz que foi apagado", async () => {
    const { emitir } = await noCanal()
    await emitir({ channel: CANAL, seq: 1, sender: ANA, payload: DA_ANA })
    await emitir({ channel: CANAL, seq: 2, sender: ANA, payload: { t: "redact", id: "lapide-0001", target: "pergunta-da-ana", redactedAt: QUANDO } })
    await emitir({
      channel: CANAL,
      seq: 3,
      sender: ANA,
      payload: { t: "message", id: "a-resposta-3", sentAt: QUANDO + 5000, body: "Sobre o que apaguei.", replyTo: "pergunta-da-ana" },
    })
    const linha = (await screen.findByText("Sobre o que apaguei.")).closest(".message") as HTMLElement
    expect(within(linha).getByText(strings.respostas.apagada)).toBeTruthy()
  })
})

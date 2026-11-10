import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ConnectionState, EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { APRESENTADOS_KEY } from "./hooks/usePrefs.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"
import novidades from "../../../docs/novidades.json"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

afterEach(cleanup)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
/** The public channel that THIS server announces. See `lib/oficial.ts`. */
const COMUM = "!orwell:casa.pt"
/** A normal channel, with a room of the same name. */
const LAGAR = "!lagar:casa.pt"

/**
 * The "announcements" room in the official channel shows what is new in each
 * version, and nothing else. Owner request on October 29, 2026: "include this
 * page in a text room in the Orwell channel". The page comes from the bundle
 * (`NotasDeVersao.tsx`).
 *
 * What we pin: the view appears in that room of that channel and nowhere else;
 * there is no text input bar there; the latest version comes first.
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
      /* The same rooms in both channels: the name is not enough, the channel decides.
         The voice room with the same name proves only the text one counts. */
      rooms: () => [
        { room: "anuncios", name: "Anúncios", category: "", kind: "text", position: 0 },
        { room: "conversa", name: "conversa", category: "", kind: "text", position: 1 },
        { room: "voz", name: "anúncios", category: "", kind: "voice", position: 2 },
      ],
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
  localStorage.setItem(APRESENTADOS_KEY, JSON.stringify([COMUM]))
})

/** Open the channel and the room by name. */
async function abrir(canal: RegExp, sala: RegExp): Promise<void> {
  const user = userEvent.setup()
  render(<App bridge={ponte()} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  await ligar()
  await act(async () => {
    await Promise.resolve()
  })
  const linha = [...document.querySelectorAll(".channel-row")].find((row) => canal.test(row.textContent ?? ""))
  await user.click(linha?.querySelector("button") as HTMLElement)
  const daSala = [...document.querySelectorAll<HTMLElement>(".room-row")].find((row) => sala.test(row.textContent ?? ""))
  // Without the room in the list, the "does not appear" tests passed without opening anything.
  expect(daSala).toBeTruthy()
  await act(async () => {
    ;(daSala?.querySelector("button") ?? daSala)?.click()
    await Promise.resolve()
  })
}

const vista = (): HTMLElement | null => document.querySelector<HTMLElement>(".notas-de-versao")

describe('a sala "anúncios" do canal oficial', () => {
  it("mostra as novidades no lugar da conversa", async () => {
    await abrir(/orwell/i, /^\s*Anúncios/)
    expect(screen.getByRole("region", { name: strings.novidades.titulo })).toBe(vista())
    expect(document.querySelector(".timeline")).toBeNull()
    const titulo = vista()?.shadowRoot?.querySelector("h1")
    expect(titulo?.textContent).toBe("Release notes")
    expect(vista()?.shadowRoot?.querySelector(".subtitulo")?.textContent).toMatch(/^Orwell version \S+ \d+\.\d+$/)
  })

  it("não tem barra de escrita: só para ler", async () => {
    await abrir(/orwell/i, /^\s*Anúncios/)
    expect(document.querySelector(".chat-composer")).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.getByText(strings.novidades.soLeitura)).toBeTruthy()
  })

  it("põe a versão mais recente em cima", async () => {
    await abrir(/orwell/i, /^\s*Anúncios/)
    const numeros = [...(vista()?.shadowRoot?.querySelectorAll(".versao .numero") ?? [])].map((no) => no.textContent)
    expect(numeros[0]).toBe(novidades[0]?.versao)
    expect(numeros).toEqual(novidades.map((entrada) => entrada.versao))
  })
})

describe("e em mais sítio nenhum", () => {
  it("noutra sala do canal oficial há conversa e barra de escrita", async () => {
    await abrir(/orwell/i, /conversa/)
    expect(vista()).toBeNull()
    expect(document.querySelector(".chat-composer")).not.toBeNull()
  })

  it('a sala "anúncios" de outro canal é conversa normal', async () => {
    await abrir(/lagar/i, /^\s*Anúncios/)
    expect(vista()).toBeNull()
    expect(document.querySelector(".chat-composer")).not.toBeNull()
  })
})

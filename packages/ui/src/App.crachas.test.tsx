import { moradaDeTeste } from "../testes/moradas.js"
import type { FichaDoCanal } from "@enclave/client-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { esquecerMarcasDeEntrada, LAST_READ_KEY } from "./hooks/useUnreads.js"
import { esquecerLidasPorSala } from "./lib/porLerPorSala.js"
import { PREFS_KEY } from "./hooks/usePrefs.js"
import { strings } from "./strings.js"
import { comLacosDoNucleo } from "./testes/lacosDoNucleo.js"

afterEach(cleanup)

const EU = "@eu:casa.pt"

/** The card of each channel (1.0 "Arca", slice 6b), for the false bridge to give to the interface. */
const FICHAS = (): Record<string, FichaDoCanal> => ({
  [DIRECTA]: { tipo: "directa", par: "@ana:casa.pt" },
  [MEU_FEED]: { tipo: "mural", dono: "@eu:casa.pt" },
})
const ANA = "@ana:casa.pt"
/** Where the user is when the app opens: the first channel in the list. */
const LAGAR = "!lagar:casa.pt"
/** The side channel, where things have to happen to be visible. */
const ADEGA = "!adega:casa.pt"
const DIRECTA = moradaDeTeste("directa ana eu", "casa.pt")
const MEU_FEED = moradaDeTeste("mural eu", "casa.pt")

/**
 * The rail badges, seen from the user's perspective.
 *
 * We don't measure here whether a function was called: we measure whether the
 * number appears above the right icon, whether it goes away when the user
 * attends to it, and, most importantly, whether it STAYS OFF when nothing is
 * directed to this account. A counter always lit is worse than no counter at
 * all: it teaches the user to ignore it, and takes the next one down with it.
 *
 * The count itself has its own pure tests in `lib/porAtender.test.ts` and in
 * `screens/social/comentariosPorAtender.test.ts`. What matters here is the
 * LINK: that the shell sums what it should, and that the bar draws what the
 * shell sums.
 */

let onMessage: ((message: unknown) => void) | null = null

function ponte(): EnclaveBridge {
  onMessage = null
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
        fichas: FICHAS,
      list: async () => [LAGAR, ADEGA, DIRECTA, MEU_FEED],
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
      // The Press has a second text room, to read it by room.
      rooms: (channel: string) =>
        channel === LAGAR
          ? [
              { room: "", name: "geral", category: "", kind: "text", position: -1 },
              { room: "vinha", name: "vinha", category: "", kind: "text", position: 0 },
            ]
          : [],
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
      feedChannel: async () => MEU_FEED,
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => ({}),
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    on: {
      message: (handler: (message: unknown) => void) => {
        onMessage = handler
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
  } as unknown as EnclaveBridge, EU)
}

let seq = 0
async function chega(message: {
  channel: string
  sender: string
  payload: Record<string, unknown>
}): Promise<void> {
  seq += 1
  await act(async () => {
    onMessage?.({ ...message, seq })
    await Promise.resolve()
  })
}

/** The message clock, always ahead of this visit's read mark. */
const agora = (): number => Date.now() + 60_000

/** The number above a rail icon, or nothing if there's no badge. */
function cracha(destino: string): string | null {
  const botao = screen.getByRole("button", { name: destino })
  return botao.querySelector(".rail-count")?.textContent ?? null
}

/** The quiet dot: "there are unread things here, but none for you." */
function temPonto(destino: string): boolean {
  const botao = screen.getByRole("button", { name: destino })
  return botao.querySelector(".rail-dot") !== null
}

async function abrir(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  render(<App bridge={ponte()} />)
  await screen.findByRole("button", { name: strings.rail.social })
  return user
}

beforeEach(() => {
  localStorage.removeItem(LAST_READ_KEY)
  esquecerMarcasDeEntrada()
  esquecerLidasPorSala()
  localStorage.removeItem(PREFS_KEY)
  seq = 0
})

/*
 * The old rule said "messages in a side channel don't put a number": only
 * mention lit Communities, and the rest was a quiet dot. The owner replaced it
 * on 27 October 2026: Communities now sums unread messages in rooms, just like
 * Friends sums private conversations.
 */
describe("Carril — Comunidades soma as mensagens por ler nos canais", () => {
  it("mensagens num canal ao lado põem o número por cima do ícone", async () => {
    await abrir()
    for (const texto of ["bom dia", "alguém sabe da chave", "eu sei"]) {
      await chega({ channel: ADEGA, sender: ANA, payload: { t: "message", body: texto, sentAt: agora() } })
    }
    expect(cracha(strings.rail.chat)).toBe("3")
    // The quiet dot is gone: with the number, it was the same news told twice.
    expect(temPonto(strings.rail.chat)).toBe(false)
  })

  it("abrir o canal apaga o número", async () => {
    const user = await abrir()
    await chega({
      channel: ADEGA,
      sender: ANA,
      payload: { t: "message", id: "m1", body: `${EU} vens?`, mentions: [EU], sentAt: agora() },
    })
    expect(cracha(strings.rail.chat)).toBe("1")

    // Attending means going there. The channel line is in the bar, with the short name.
    const linha = [...document.querySelectorAll(".channel-row")].find((row) =>
      row.textContent?.includes("adega"),
    ) as HTMLElement
    await user.click(within(linha).getByRole("button", { name: /adega/ }))

    expect(cracha(strings.rail.chat)).toBeNull()
  })

  it("a menção conta uma vez, e não duas", async () => {
    await abrir()
    await chega({ channel: ADEGA, sender: ANA, payload: { t: "message", id: "a", body: "bom dia", sentAt: agora() } })
    await chega({
      channel: ADEGA,
      sender: ANA,
      payload: { t: "message", id: "b", body: "vens?", mentions: [EU], sentAt: agora() },
    })
    expect(cracha(strings.rail.chat)).toBe("2")
  })

  it("uma conversa privada não acende Comunidades: não é lá que ela se atende", async () => {
    await abrir()
    await chega({ channel: DIRECTA, sender: ANA, payload: { t: "message", body: "olá", sentAt: agora() } })
    expect(cracha(strings.rail.chat)).toBeNull()
    expect(temPonto(strings.rail.chat)).toBe(false)
    expect(cracha(strings.rail.people)).toBe("1")
  })

  it("as minhas mensagens não contam", async () => {
    await abrir()
    await chega({ channel: ADEGA, sender: EU, payload: { t: "message", body: "eu", sentAt: agora() } })
    expect(cracha(strings.rail.chat)).toBeNull()
  })
})

describe("Carril e barra — o por ler de uma sala do canal aberto", () => {
  /** The line of a room in the sidebar, by name. */
  function linhaDaSala(nome: string): HTMLElement | undefined {
    return [...document.querySelectorAll<HTMLElement>(".room-row")].find(
      (linha) => linha.querySelector(".room-name")?.textContent === nome,
    )
  }

  it("o que chega a outra sala do canal aberto acende a sala e o carril, e abrir a sala apaga os dois", async () => {
    const user = await abrir()
    await screen.findByText("vinha")
    await chega({ channel: LAGAR, sender: ANA, payload: { t: "message", id: "v1", body: "a uva", room: "vinha", sentAt: agora() } })
    await chega({ channel: LAGAR, sender: ANA, payload: { t: "message", id: "v2", body: "já", room: "vinha", sentAt: agora() } })
    expect(linhaDaSala("vinha")?.querySelector(".room-unread")?.textContent).toBe("2")
    expect(cracha(strings.rail.chat)).toBe("2")

    await user.click(within(linhaDaSala("vinha")!).getByRole("button", { name: /vinha/ }))
    expect(linhaDaSala("vinha")?.querySelector(".room-unread")).toBeFalsy()
    expect(cracha(strings.rail.chat)).toBeNull()
  })

  it("o que chega à sala aberta não acende nada", async () => {
    await abrir()
    await screen.findByText("vinha")
    await chega({ channel: LAGAR, sender: ANA, payload: { t: "message", id: "g1", body: "olá", sentAt: agora() } })
    expect(cracha(strings.rail.chat)).toBeNull()
    expect(document.querySelectorAll(".room-unread")).toHaveLength(0)
  })
})

/**
 * Muted: no number on the rail or on the line, and mention still lights up
 * (owner request from 27 October 2026).
 */
describe("Carril e barra — o que está silenciado não acende", () => {
  function silenciar(...chaves: string[]): void {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ silenciados: chaves, chosen: true }))
  }
  function linhaDoCanal(nome: string): HTMLElement {
    return [...document.querySelectorAll<HTMLElement>(".channel-row")].find((row) => row.textContent?.includes(nome))!
  }

  it("um canal silenciado não põe número; a linha esbate e leva o sino riscado", async () => {
    silenciar(ADEGA)
    await abrir()
    await chega({ channel: ADEGA, sender: ANA, payload: { t: "message", id: "a", body: "bom dia", sentAt: agora() } })
    expect(cracha(strings.rail.chat)).toBeNull()
    expect(linhaDoCanal("adega").querySelector(".badge")).toBeNull()
    expect(linhaDoCanal("adega").classList.contains("silenciado")).toBe(true)
    expect(within(linhaDoCanal("adega")).getByRole("img", { name: strings.silencio.marca })).toBeTruthy()
  })

  it("uma menção num canal silenciado continua a acender", async () => {
    silenciar(ADEGA)
    await abrir()
    await chega({ channel: ADEGA, sender: ANA, payload: { t: "message", id: "a", body: "bom dia", sentAt: agora() } })
    await chega({
      channel: ADEGA,
      sender: ANA,
      payload: { t: "message", id: "b", body: "vens?", mentions: [EU], sentAt: agora() },
    })
    expect(cracha(strings.rail.chat)).toBe("1")
    expect(linhaDoCanal("adega").querySelector(".badge")?.textContent).toBe("1")
  })

  it("uma sala silenciada do canal aberto não acende, e as outras sim", async () => {
    silenciar(`${LAGAR}/vinha`)
    await abrir()
    await screen.findByText("vinha")
    await chega({ channel: LAGAR, sender: ANA, payload: { t: "message", id: "v1", body: "a uva", room: "vinha", sentAt: agora() } })
    await chega({ channel: ADEGA, sender: ANA, payload: { t: "message", id: "a1", body: "olá", sentAt: agora() } })
    expect(cracha(strings.rail.chat)).toBe("1")
    const vinha = [...document.querySelectorAll<HTMLElement>(".room-row")].find(
      (linha) => linha.querySelector(".room-name")?.textContent === "vinha",
    )!
    expect(vinha.querySelector(".room-unread")).toBeNull()
    expect(vinha.classList.contains("silenciado")).toBe(true)
  })

  it("uma conversa privada silenciada não conta em Amigos", async () => {
    silenciar(DIRECTA)
    await abrir()
    await chega({ channel: DIRECTA, sender: ANA, payload: { t: "message", body: "olá", sentAt: agora() } })
    expect(cracha(strings.rail.people)).toBeNull()
  })

  it("silenciar pelo menu da sala apaga o número logo, e ativar devolve-o", async () => {
    // By room, not by channel: right-click on the channel also opens it, and
    // opening marked it read, which proved nothing about mute.
    const user = await abrir()
    await screen.findByText("vinha")
    await chega({ channel: LAGAR, sender: ANA, payload: { t: "message", id: "v1", body: "a uva", room: "vinha", sentAt: agora() } })
    expect(cracha(strings.rail.chat)).toBe("1")
    const vinha = (): HTMLElement =>
      [...document.querySelectorAll<HTMLElement>(".room-row")].find(
        (linha) => linha.querySelector(".room-name")?.textContent === "vinha",
      )!
    await user.pointer({ keys: "[MouseRight]", target: vinha() })
    await user.click(await screen.findByRole("menuitem", { name: strings.silencio.silenciar }))
    expect(cracha(strings.rail.chat)).toBeNull()
    expect(within(vinha()).getByRole("img", { name: strings.silencio.marca })).toBeTruthy()

    await user.pointer({ keys: "[MouseRight]", target: vinha() })
    await user.click(await screen.findByRole("menuitem", { name: strings.silencio.ativar }))
    expect(cracha(strings.rail.chat)).toBe("1")
  })
})

describe("Carril — Contactos conta quem está à espera de resposta", () => {
  it("um pedido de amizade por responder aparece por cima do ícone", async () => {
    await abrir()
    await chega({
      channel: DIRECTA,
      sender: ANA,
      payload: { t: "friend.request", sentAt: agora(), note: "somos do mesmo lagar" },
    })
    expect(cracha(strings.rail.people)).toBe("1")
  })

  it("as mensagens privadas somam-se ao pedido: é tudo gente à espera", async () => {
    await abrir()
    await chega({ channel: DIRECTA, sender: ANA, payload: { t: "friend.request", sentAt: agora() } })
    await chega({ channel: DIRECTA, sender: ANA, payload: { t: "message", body: "então?", sentAt: agora() } })
    expect(cracha(strings.rail.people)).toBe("2")
  })
})

describe("Carril — Social conta quem falou debaixo do que eu escrevi", () => {
  /** A post of mine and a comment from Ana below it. */
  async function comentamMe(): Promise<void> {
    await chega({
      channel: MEU_FEED,
      sender: EU,
      payload: { t: "post", id: "p1", postedAt: agora(), caption: "a vindima", media: [], links: [], tags: [] },
    })
    await chega({
      channel: MEU_FEED,
      sender: ANA,
      payload: { t: "post.comment", id: "c1", target: "p1", body: "que inveja", postedAt: agora() },
    })
  }

  it("um comentário numa publicação minha acende o número", async () => {
    await abrir()
    await comentamMe()
    expect(cracha(strings.rail.social)).toBe("1")
  })

  it("ir ao Social atende-o, e o número some", async () => {
    const user = await abrir()
    await comentamMe()
    await user.click(screen.getByRole("button", { name: new RegExp(`^${strings.rail.social}`) }))
    expect(cracha(strings.rail.social)).toBeNull()
  })

  it("um gosto não acende nada: não há nada para responder a um polegar", async () => {
    await abrir()
    await chega({
      channel: MEU_FEED,
      sender: EU,
      payload: { t: "post", id: "p1", postedAt: agora(), caption: "a vindima", media: [], links: [], tags: [] },
    })
    await chega({
      channel: MEU_FEED,
      sender: ANA,
      payload: { t: "post.reaction", id: "r1", target: "p1", emoji: "👍", at: agora() },
    })
    expect(cracha(strings.rail.social)).toBeNull()
  })

  /**
   * The rebroadcast trap, seen from the screen.
   *
   * `republishPosts` retells the entire feed on each new entry. If the badge
   * counted by arrival order, accepting a friend request would light Social
   * with a number pulled from posts from months ago.
   */
  it("o mural dito outra vez a quem acabou de entrar não acende nada", async () => {
    const user = await abrir()
    await comentamMe()
    await user.click(screen.getByRole("button", { name: new RegExp(`^${strings.rail.social}`) }))
    expect(cracha(strings.rail.social)).toBeNull()

    // Someone enters the feed: the posts are retold, with the original `id` and
    // `postedAt` and a new arrival order.
    await chega({
      channel: MEU_FEED,
      sender: EU,
      payload: { t: "post", id: "p1", postedAt: agora(), caption: "a vindima", media: [], links: [], tags: [] },
    })
    expect(cracha(strings.rail.social)).toBeNull()
  })
})

/**
 * The profile has no badge, and it's a written decision.
 *
 * There's nothing there that someone else could put on hold: comments on my
 * posts are counted once, in Social. A number made up just so the icon isn't
 * alone taught the user to ignore the other three.
 */
describe("Carril — o Perfil não conta nada", () => {
  it("nada do que chegue põe um número por cima do perfil", async () => {
    await abrir()
    await chega({
      channel: MEU_FEED,
      sender: EU,
      payload: { t: "post", id: "p1", postedAt: agora(), caption: "a vindima", media: [], links: [], tags: [] },
    })
    await chega({
      channel: MEU_FEED,
      sender: ANA,
      payload: { t: "post.comment", id: "c1", target: "p1", body: "que inveja", postedAt: agora() },
    })
    await chega({
      channel: ADEGA,
      sender: ANA,
      payload: { t: "message", id: "m1", body: "olha", mentions: [EU], sentAt: agora() },
    })
    await chega({ channel: DIRECTA, sender: ANA, payload: { t: "friend.request", sentAt: agora() } })

    expect(cracha(strings.rail.profile)).toBeNull()
    expect(cracha(strings.rail.settings)).toBeNull()
    // And the other three lit at the same time, to show that the profile's silence
    // is not a lack of events.
    expect(cracha(strings.rail.chat)).toBe("1")
    expect(cracha(strings.rail.social)).toBe("1")
    expect(cracha(strings.rail.people)).toBe("1")
  })
})

/**
 * What someone not looking at the screen hears.
 *
 * The name of the destination doesn't change with what arrived there:
 * "Channels" is called Channels whether the badge is lit or dark, and it's the
 * description that carries the number. A button that changed names based on
 * what arrived was a button you couldn't name to someone else, and it broke
 * every script and test that reaches the rail by name.
 */
describe("Carril — o número dito por palavras a quem não vê o ecrã", () => {
  it("sem nada por atender o botão não tem descrição nenhuma", async () => {
    await abrir()
    const botao = screen.getByRole("button", { name: strings.rail.chat })
    expect(botao.getAttribute("aria-describedby")).toBeNull()
  })

  it("com coisas por atender, a descrição do botão di-lo", async () => {
    await abrir()
    await chega({
      channel: ADEGA,
      sender: ANA,
      payload: { t: "message", id: "m1", body: "olha", mentions: [EU], sentAt: agora() },
    })
    expect(
      screen.getByRole("button", { name: strings.rail.chat, description: strings.rail.porAtender(1) }),
    ).toBeTruthy()
  })

  it("acima de nove o crachá encolhe para caber, e as palavras dizem o número inteiro", async () => {
    await abrir()
    for (let n = 0; n < 12; n++) {
      await chega({
        channel: ADEGA,
        sender: ANA,
        payload: { t: "message", id: `m${n}`, body: "olha", mentions: [EU], sentAt: agora() + n },
      })
    }
    // "9+" is a forty-pixel limit, not something you'd want to say to someone
    // who's listening.
    expect(cracha(strings.rail.chat)).toBe("9+")
    expect(
      screen.getByRole("button", { name: strings.rail.chat, description: strings.rail.porAtender(12) }),
    ).toBeTruthy()
  })
})

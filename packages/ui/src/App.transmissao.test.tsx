import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

/**
 * The transmission signal in a voice room we are NOT in (phase 1i).
 *
 * Until now only our call's room showed it, because there it comes from
 * media connections. In other rooms the sidebar only has the presence
 * announcement, and the bridge now reads what the person transmits from it
 * (`transmite`, from `screen` and `aTocar` in `voice.join`).
 */

vi.mock("./lib/sounds.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./lib/sounds.js")>()
  return { ...real, playSound: vi.fn(() => true) }
})
vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

afterEach(cleanup)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const BRUNO = "@bruno:casa.pt"
const LAGAR = "!lagar:casa.pt"

type Actividade = { channel: string; from: string; joined: boolean; room: string; transmite?: "ecra" | "musica" | "ecra+musica" }
let onCallActivity: ((event: Actividade) => void) | null = null

function ponte(): EnclaveBridge {
  onCallActivity = null
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
      list: async () => [LAGAR],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: vi.fn(async () => ({ ok: true })),
      declineChannelInvite: vi.fn(async () => ({ ok: true })),
      send: async () => ({ ok: true }),
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [EU, ANA, BRUNO],
      history: async () => [],
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      rooms: () => [{ room: "voz", name: "voz", category: "", kind: "voice", position: 0 }],
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
      connection: () => () => {},
      channels: () => () => {},
      presence: () => () => {},
      typing: () => () => {},
      buzz: () => () => {},
      callActivity: (handler: never) => {
        onCallActivity = handler as never
        return () => {}
      },
    },
    call: {
      on: () => () => {},
      setMuted: () => {},
      setCameraOff: () => {},
      join: async () => ({ ok: true }),
      leave: async () => ({ ok: true }),
      tectoDePartilha: 6,
      podePartilharEcra: false,
    },
  } as unknown as EnclaveBridge
}


async function abrirOCanal(): Promise<void> {
  render(<App bridge={ponte()} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  const linha = [...document.querySelectorAll(".channel-row")].find((row) => /lagar/.test(row.textContent ?? ""))
  await act(async () => {
    ;(linha?.querySelector("button") as HTMLElement).click()
    await Promise.resolve()
  })
}

async function anuncio(evento: Omit<Actividade, "channel" | "room">): Promise<void> {
  await act(async () => {
    onCallActivity?.({ channel: LAGAR, room: "voz", ...evento })
    await Promise.resolve()
  })
}

describe("o sinal de transmissão numa sala onde não estamos", () => {
  it("acende pelo anúncio, muda com ele, e apaga quando o anúncio deixa de o dizer", async () => {
    await abrirOCanal()
    await anuncio({ from: ANA, joined: true, transmite: "ecra" })
    expect(await screen.findByRole("img", { name: strings.transmissao.ecra })).toBeTruthy()

    await anuncio({ from: ANA, joined: true, transmite: "ecra+musica" })
    expect(await screen.findByRole("img", { name: strings.transmissao.ambos })).toBeTruthy()

    await anuncio({ from: ANA, joined: true })
    expect(screen.queryByRole("img", { name: strings.transmissao.ambos })).toBeNull()
    expect(screen.queryByRole("img", { name: strings.transmissao.ecra })).toBeNull()
  })

  it("quem sai leva o sinal; quem fica sem transmitir não tem sinal", async () => {
    await abrirOCanal()
    await anuncio({ from: ANA, joined: true, transmite: "musica" })
    await anuncio({ from: BRUNO, joined: true })
    expect(screen.getAllByRole("img", { name: strings.transmissao.musica })).toHaveLength(1)
    await anuncio({ from: ANA, joined: false })
    expect(screen.queryByRole("img", { name: strings.transmissao.musica })).toBeNull()
  })
})

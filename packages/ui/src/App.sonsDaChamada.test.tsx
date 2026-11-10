import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { playSound } from "./lib/sounds.js"
import { motor } from "./sons/motor.js"
import { FIM_DA_TRANSMISSAO_MS } from "./sons/chamada.js"
import { strings } from "./strings.js"
import { DEFAULT_PREFS, writePrefs } from "./hooks/usePrefs.js"
import { moradaDeTeste } from "../testes/moradas.js"

/**
 * The moments of the call from the Discord parity call (November 3, 2026),
 * measured in the shell.
 *
 * The rules have their own tests (`sons/chamada.test.ts`, `sons/motor.test.ts`,
 * `lib/sounds.test.ts`). This measures the connection: what the bridge delivers
 * reaches the watchers, and what they ask reaches the engine, once.
 */

vi.mock("./lib/sounds.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./lib/sounds.js")>()
  return { ...real, playSound: vi.fn(() => true) }
})

vi.mock("./sons/motor.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./sons/motor.js")>()
  return {
    ...real,
    motor: {
      tocar: vi.fn(() => "tocou"),
      tocarChamada: vi.fn(() => "tocou"),
      pararChamada: vi.fn(),
      chamadaATocar: vi.fn(() => null),
      chamar: vi.fn(() => "tocou"),
      pararDeChamar: vi.fn(),
      aChamar: vi.fn(() => null),
      ouvir: vi.fn(() => true),
      armar: () => () => {},
      ligarAmbiente: vi.fn(),
    },
  }
})

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

let desvioDoRelogio = 0
const relogioReal = Date.now.bind(Date)
vi.spyOn(Date, "now").mockImplementation(() => relogioReal() + desvioDoRelogio)

afterEach(() => {
  cleanup()
  desvioDoRelogio = 0
  localStorage.clear()
})
beforeEach(() => {
  vi.mocked(motor.tocar).mockClear()
  vi.mocked(playSound).mockClear()
})

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const LAGAR = "!lagar:casa.pt"
const DM = moradaDeTeste("directa ana eu", "casa.pt")

type Tratador = (event: never) => void
let tratadores: Record<string, Tratador> = {}

function ponte(): EnclaveBridge {
  tratadores = {}
  const guardar = (nome: string) => (handler: Tratador) => {
    tratadores[nome] = handler
    return () => {}
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
      fichas: () => ({ [DM]: { tipo: "directa", par: ANA } }),
      list: async () => [LAGAR],
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
      rooms: () => [
        { room: "voz", name: "voz", category: "", kind: "voice", position: 0 },
        { room: "outra", name: "outra", category: "", kind: "voice", position: 1 },
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
      feedChannel: async () => moradaDeTeste("mural eu", "casa.pt"),
      // Ana is from the community: the private chat with her has "Join call".
      syncCommunity: async () => [ANA],
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
      connection: guardar("connection"),
      channels: guardar("channels"),
      presence: () => () => {},
      typing: () => () => {},
      buzz: () => () => {},
      callActivity: guardar("callActivity"),
    },
    call: {
      on: (nome: string, handler: Tratador) => guardar(`call:${nome}`)(handler),
      setMuted: () => {},
      setCameraOff: () => {},
      join: async () => ({ ok: true }),
      leave: async () => ({ ok: true }),
      stopScreenShare: async () => ({ ok: true }),
      tectoDePartilha: 6,
      podePartilharEcra: false,
    },
  } as unknown as EnclaveBridge
}

/** Deliver a bridge event, inside `act`. */
async function chega(nome: string, evento: unknown): Promise<void> {
  await act(async () => {
    tratadores[nome]?.(evento as never)
    await Promise.resolve()
  })
}

/** Open the app, connect to the server, and enter the voice room of the channel. */
async function naSalaDeVoz(caminho: "sfu" | "malha: servidor sem sfu" = "sfu"): Promise<void> {
  render(<App bridge={ponte()} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  await chega("connection", { state: "online" })
  const linha = [...document.querySelectorAll(".channel-row")].find((row) => /lagar/.test(row.textContent ?? ""))
  await act(async () => {
    ;(linha?.querySelector("button") as HTMLElement).click()
    await Promise.resolve()
  })
  const entrar = [...document.querySelectorAll<HTMLElement>(".room-row")].find((row) => /voz/i.test(row.textContent ?? ""))
  await act(async () => {
    ;(entrar?.querySelector("button") ?? entrar)?.click()
    await Promise.resolve()
  })
  await chega("call:diagnostic", { code: "call-caminho", detail: caminho })
  // After the settlement window, what changes in the room is news.
  desvioDoRelogio = 10_000
  vi.mocked(motor.tocar).mockClear()
  vi.mocked(playSound).mockClear()
}

const tipos = (): string[] => vi.mocked(motor.tocar).mock.calls.map(([acontecimento]) => acontecimento.tipo)

const par = (address: string, sobre: Record<string, unknown> = {}) => ({
  address,
  connected: true,
  stream: null,
  video: false,
  encrypted: true,
  micMuted: false,
  screen: null,
  ecraOferecido: false,
  aVerONossoEcra: false,
  ...sobre,
})

/** A fake shared screen: the stage only asks it for the tracks. */
const ECRA = { id: "ecra", getAudioTracks: () => [], getVideoTracks: () => [], getTracks: () => [] }

const esperar = (ms: number): Promise<void> => act(() => new Promise<void>((feito) => setTimeout(feito, ms)))

describe("movido por quem modera", () => {
  it("toca o som de ser movido, uma vez, e a entrada na sala nova não toca por cima", async () => {
    await naSalaDeVoz()
    await chega("call:moved", { channel: LAGAR, room: "outra", by: ANA })
    expect(tipos()).toEqual(["movido"])
    // Our announcement in the new room, back from the server.
    await chega("callActivity", { channel: LAGAR, from: EU, joined: true, room: "outra" })
    expect(vi.mocked(playSound).mock.calls.map(([kind]) => kind)).not.toContain("voice-join")
  })
})

describe("a ligação de voz perdida", () => {
  it("o socket cai numa chamada por SFU: toca uma vez, e o núcleo largar a chamada a seguir não toca outra", async () => {
    await naSalaDeVoz("sfu")
    await chega("connection", { state: "connecting" })
    await chega("connection", { state: "offline" })
    expect(tipos()).toEqual(["voz-perdida"])
    await chega("connection", { state: "online" })
    await chega("call:error", { detail: "the call dropped and did not come back" })
    await chega("call:ended", { channel: LAGAR })
    expect(tipos()).toEqual(["voz-perdida"])
  })

  it("numa chamada de malha, o socket cair não leva a voz: não toca", async () => {
    await naSalaDeVoz("malha: servidor sem sfu")
    await chega("connection", { state: "connecting" })
    expect(tipos()).toEqual([])
  })

  it("o núcleo largar a chamada sem queda antes toca", async () => {
    await naSalaDeVoz()
    await chega("call:error", { detail: "the call dropped and did not come back" })
    expect(tipos()).toEqual(["voz-perdida"])
  })

  it("quem modera tirar-me da chamada toca; sair por gesto não", async () => {
    await naSalaDeVoz()
    await chega("call:ended", { channel: LAGAR })
    expect(tipos()).toEqual([])
    await chega("call:desligado", { channel: LAGAR, by: ANA })
    expect(tipos()).toEqual(["voz-perdida"])
  })

  it("fora de uma chamada, o socket cair não toca", async () => {
    render(<App bridge={ponte()} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    await chega("connection", { state: "online" })
    await chega("call:diagnostic", { code: "call-caminho", detail: "sfu" })
    await chega("connection", { state: "connecting" })
    expect(tipos()).toEqual([])
  })
})

describe("a transmissão", () => {
  it("a de outra pessoa da sala começa e acaba", async () => {
    await naSalaDeVoz()
    await chega("call:participants", { participants: [par(ANA)] })
    await chega("call:participants", { participants: [par(ANA, { ecraOferecido: true })] })
    await chega("call:participants", { participants: [par(ANA)] })
    expect(tipos()).toEqual(["transmissao-iniciada", "transmissao-terminada"])
  })

  it('"Silenciar tudo" cala a dos outros', async () => {
    await naSalaDeVoz()
    writePrefs({ ...DEFAULT_PREFS, soundOff: true })
    await chega("call:participants", { participants: [par(ANA)] })
    await chega("call:participants", { participants: [par(ANA, { ecraOferecido: true })] })
    expect(tipos()).toEqual([])
  })

  it("a minha começa, quem a vê e deixa de ver toca, e o fim toca depois da espera", async () => {
    await naSalaDeVoz()
    await chega("call:participants", { participants: [par(ANA)] })
    await chega("call:screen", { stream: ECRA })
    await chega("call:participants", { participants: [par(ANA, { aVerONossoEcra: true })] })
    desvioDoRelogio += 5000
    await chega("call:participants", { participants: [par(ANA)] })
    await chega("call:screen", { stream: null })
    expect(tipos()).toEqual(["transmissao-iniciada", "espectador-entrou", "espectador-saiu"])
    await esperar(FIM_DA_TRANSMISSAO_MS + 50)
    expect(tipos()).toEqual(["transmissao-iniciada", "espectador-entrou", "espectador-saiu", "transmissao-terminada"])
  })

  it("sair da chamada a partilhar não toca o fim da transmissão", async () => {
    await naSalaDeVoz()
    await chega("call:screen", { stream: ECRA })
    vi.mocked(motor.tocar).mockClear()
    // The core order: the screen drops first, the call ends next.
    await chega("call:screen", { stream: null })
    await chega("call:ended", { channel: LAGAR })
    await esperar(FIM_DA_TRANSMISSAO_MS + 50)
    expect(tipos()).toEqual([])
  })
})

describe("a chamada a sair", () => {
  /** Connect to Ana through the private conversation, in Friends, as a person. */
  async function ligarAAna(): Promise<void> {
    render(<App bridge={ponte()} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    await chega("connection", { state: "online" })
    await chega("channels", { channels: [LAGAR, DM] })
    desvioDoRelogio = 10_000
    await act(async () => {
      screen.getByRole("button", { name: strings.rail.people }).click()
      await Promise.resolve()
    })
    const linha = await vi.waitFor(() => {
      const encontrada = document.querySelector<HTMLElement>(".direct-row")
      if (!encontrada) throw new Error("sem a conversa privada")
      return encontrada
    })
    fireEvent.contextMenu(linha)
    await act(async () => {
      screen.getByRole("menuitem", { name: strings.menu.joinCall }).click()
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    vi.mocked(motor.chamar).mockClear()
    vi.mocked(motor.pararDeChamar).mockClear()
    vi.mocked(motor.aChamar).mockReturnValue(null)
  })

  it("ligar numa privada vazia toca o toque a sair, e pára quando a Ana atende", async () => {
    await ligarAAna()
    expect(vi.mocked(motor.chamar).mock.calls).toEqual([[DM]])
    vi.mocked(motor.aChamar).mockReturnValue(DM)
    // My own listing is not someone answering.
    await chega("callActivity", { channel: DM, from: EU, joined: true, room: "" })
    expect(motor.pararDeChamar).not.toHaveBeenCalled()
    await chega("callActivity", { channel: DM, from: ANA, joined: true, room: "" })
    expect(vi.mocked(motor.pararDeChamar).mock.calls).toContainEqual([DM])
  })

  it("desistir (sair da chamada) pára o toque", async () => {
    await ligarAAna()
    vi.mocked(motor.aChamar).mockReturnValue(DM)
    await chega("call:ended", { channel: DM })
    expect(vi.mocked(motor.pararDeChamar).mock.calls).toContainEqual([DM])
  })

  it("entrar quando a Ana já está a ligar é atender: não toca", async () => {
    render(<App bridge={ponte()} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    await chega("connection", { state: "online" })
    await chega("channels", { channels: [LAGAR, DM] })
    desvioDoRelogio = 10_000
    await chega("callActivity", { channel: DM, from: ANA, joined: true, room: "" })
    await act(async () => {
      screen.getByRole("button", { name: strings.rail.people }).click()
      await Promise.resolve()
    })
    const linha = await vi.waitFor(() => {
      const encontrada = document.querySelector<HTMLElement>(".direct-row")
      if (!encontrada) throw new Error("sem a conversa privada")
      return encontrada
    })
    fireEvent.contextMenu(linha)
    await act(async () => {
      screen.getByRole("menuitem", { name: strings.menu.joinCall }).click()
      await Promise.resolve()
    })
    expect(motor.chamar).not.toHaveBeenCalled()
  })

  it("numa sala de voz de uma comunidade, não toca", async () => {
    await naSalaDeVoz()
    expect(motor.chamar).not.toHaveBeenCalled()
  })
})

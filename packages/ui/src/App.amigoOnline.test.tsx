import { moradaDeTeste } from "../testes/moradas.js"
import type { FichaDoCanal } from "@enclave/client-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { readPrefs, writePrefs } from "./hooks/usePrefs.js"
import { INTERVALO_DO_AVISO_MS } from "./lib/amigosOnline.js"
import { registerSystemNoticeHost, type SystemNotice } from "./lib/notifications.js"
import { motor } from "./sons/motor.js"
import { strings } from "./strings.js"

/**
 * The MSN-style alerts, measured in the shell (owner and community request, November 2,
 * 2026, item 6). The pure rules have tests in `lib/amigosOnline.test.ts`; this measures
 * the connection: the server presence, the system alert with the face and name, the banner
 * when there is no system alert, the sound, and the click to open the private chat.
 */

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

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const BRUNO = "@bruno:casa.pt"
const CARLA = "@carla:casa.pt"
const LAGAR = "!lagar:casa.pt"
const MEU_FEED = moradaDeTeste("mural eu", "casa.pt")
const DM = moradaDeTeste("directa ana eu", "casa.pt")
const CARA = "data:image/png;base64,iVBORw0KGgo="
const FICHAS = (): Record<string, FichaDoCanal> => ({
  [DM]: { tipo: "directa", par: ANA },
  [MEU_FEED]: { tipo: "mural", dono: EU },
})

let onPresence: ((event: { address: string; online: boolean }) => void) | null = null
let onConnection: ((payload: { state: string }) => void) | null = null
let onChannels: ((payload: { channels: string[] }) => void) | null = null
let onMessage: ((message: { channel: string; sender: string; seq: number; payload: Record<string, unknown> }) => void) | null =
  null
let openDirect: ReturnType<typeof vi.fn>
let onEpoch: ((payload: { channel: string }) => void) | null = null
let onCallActivity:
  | ((event: { channel: string; from: string; joined: boolean; room: string; transmite?: "ecra" | "musica" | "ecra+musica" }) => void)
  | null = null
let callJoin: ReturnType<typeof vi.fn>
let guardar: ReturnType<typeof vi.fn>
/** Who is in the Lagar community. Changes during community tests. */
let membrosDoLagar: string[] = [EU, BRUNO]

function ponte(): EnclaveBridge {
  openDirect = vi.fn(async () => DM)
  callJoin = vi.fn(async () => ({ ok: true }))
  guardar = vi.fn(async () => ({ ok: true }))
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
      capabilities: async () => ["mls", "presence"],
      setVisible: async () => ({ ok: true }),
    },
    channels: {
      fichas: FICHAS,
      list: async () => [LAGAR, DM, MEU_FEED],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      send: async () => ({ ok: true }),
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      // On my bulletin board are Ana and Carla, and Bruno is not: they are friends in fact.
      members: async (canal: string) => (canal === LAGAR ? membrosDoLagar : [EU, ANA, CARLA]),
      history: async () => [],
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      rooms: (canal: string) =>
        canal === LAGAR ? [{ room: "lounge", name: "Lounge", kind: "voice", position: 0 }] : [],
    },
    invites: {
      create: async () => "enclave://join/x/y#z",
      redeem: async () => ({ ok: true }),
      list: async () => [],
      revoke: async () => ({ ok: true }),
    },
    social: {
      post: async () => ({ ok: true }),
      repairInvite: async () => ({ invited: true }),
      deadWelcomes: async () => [],
      feedChannel: async () => MEU_FEED,
      openDirect,
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => ({
        [ANA]: { payload: { t: "profile", displayName: "Ana", avatar: { inline: CARA } } },
        [BRUNO]: { payload: { t: "profile", displayName: "Bruno" } },
        [CARLA]: { payload: { t: "profile", displayName: "Carla" } },
      }),
    },
    notifications: { list: async () => [], save: guardar },
    on: {
      message: (handler: never) => {
        onMessage = handler as never
        return () => {}
      },
      epoch: (handler: never) => {
        onEpoch = handler as never
        return () => {}
      },
      status: () => () => {},
      connection: (handler: never) => {
        onConnection = handler as never
        return () => {}
      },
      channels: (handler: never) => {
        onChannels = handler as never
        return () => {}
      },
      presence: (handler: never) => {
        onPresence = handler as never
        return () => {}
      },
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
      join: callJoin,
      leave: async () => ({ ok: true }),
      tectoDePartilha: 6,
      podePartilharEcra: false,
    },
  } as unknown as EnclaveBridge
}

/** The app clock, set forward by hand: opening the connection counts seconds. */
let agora = 1_800_000_000_000
const relogio = vi.spyOn(Date, "now").mockImplementation(() => agora)

afterEach(() => {
  cleanup()
  registerSystemNoticeHost(null)
})
beforeEach(() => {
  localStorage.clear()
  membrosDoLagar = [EU, BRUNO]
  agora = 1_800_000_000_000
  relogio.mockImplementation(() => agora)
  vi.mocked(motor.tocar).mockClear()
})

async function abrirELigar(): Promise<void> {
  render(<App bridge={ponte()} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  await act(async () => {
    onConnection?.({ state: "online" })
    onChannels?.({ channels: [LAGAR, DM, MEU_FEED] })
    await Promise.resolve()
  })
}

/** A server presence, `depoisMs` from the current instant. */
async function presenca(address: string, online: boolean, depoisMs = 0): Promise<void> {
  agora += depoisMs
  await act(async () => {
    onPresence?.({ address, online })
    await Promise.resolve()
  })
}

/** The phrase from the most recent card, or `null` without a card. */
const tituloDoCard = (): string | null => {
  const titulos = document.querySelectorAll(".aviso-amigo-titulo")
  return titulos[titulos.length - 1]?.textContent ?? null
}

const sonsDoAmigo = (): number =>
  vi.mocked(motor.tocar).mock.calls.filter(([acontecimento]) => acontecimento.tipo === "amigo-online").length

/** An alert host like the desktop app's, which only logs. */
function anfitriao(janelaAFrente = false): { mostrados: { notice: SystemNotice; open: () => void }[] } {
  const mostrados: { notice: SystemNotice; open: () => void }[] = []
  registerSystemNoticeHost({ windowInFront: () => janelaAFrente, show: (notice, open) => mostrados.push({ notice, open }) })
  return { mostrados }
}

function comAvisosDoSistema(preview = true): void {
  writePrefs({ ...readPrefs(), notifications: true, notifyPreview: preview })
}

describe("um amigo fica online", () => {
  it("sem avisos do sistema: o card à MSN dentro da app, o som, e o botão abre a conversa", async () => {
    await abrirELigar()
    await presenca(ANA, true, 30_000)
    await waitFor(() => expect(tituloDoCard()).toBe(strings.notifications.amigoOnline("Ana")))
    // Ana's face, and the screen reader announces the phrase.
    expect(document.querySelector(".aviso-amigo-cara img")?.getAttribute("src")).toBe(CARA)
    expect(screen.getByRole("status").textContent).toBe("Ana está online")
    expect(sonsDoAmigo()).toBe(1)
    await act(async () => {
      screen.getByRole("button", { name: strings.notifications.abrirConversa }).click()
      await Promise.resolve()
    })
    expect(openDirect).toHaveBeenCalledWith(ANA)
  })

  it("o card sai sozinho em 2 s, sem a pessoa o fechar", async () => {
    await abrirELigar()
    await presenca(ANA, true, 30_000)
    await waitFor(() => expect(tituloDoCard()).toBe(strings.notifications.amigoOnline("Ana")))
    await waitFor(() => expect(document.querySelector(".aviso-amigo")).toBeNull(), { timeout: 3000 })
  })

  it('com "Mostrar o conteúdo" desligado: o aviso do sistema é discreto, e não há card com o nome', async () => {
    comAvisosDoSistema(false)
    const { mostrados } = anfitriao(true)
    await abrirELigar()
    await presenca(ANA, true, 30_000)
    expect(mostrados[0]?.notice.body).toBe(strings.notifications.amigoOnlineDiscreto)
    expect(document.querySelector(".aviso-amigo")).toBeNull()
    expect(document.body.textContent).not.toContain("Ana está online")
  })

  it("com avisos do sistema: o aviso leva a cara e o nome, e não há balão a repetir", async () => {
    comAvisosDoSistema()
    const { mostrados } = anfitriao()
    await abrirELigar()
    await presenca(ANA, true, 30_000)
    expect(mostrados).toHaveLength(1)
    expect(mostrados[0]?.notice.body).toBe(strings.notifications.amigoOnline("Ana"))
    expect(mostrados[0]?.notice.icon).toBe(CARA)
    expect(mostrados[0]?.notice.countable).toBe(false)
    // Closes by itself in 2 s: owner's order, November 2, 2026.
    expect(mostrados[0]?.notice.expiraEmMs).toBe(2000)
    expect(screen.queryByText(strings.notifications.amigoOnline("Ana"))).toBeNull()
    expect(sonsDoAmigo()).toBe(1)
    await act(async () => {
      mostrados[0]?.open()
      await Promise.resolve()
    })
    expect(openDirect).toHaveBeenCalledWith(ANA)
  })

  it('com "Mostrar o conteúdo" desligado, o aviso do sistema não leva nome nem cara', async () => {
    comAvisosDoSistema(false)
    const { mostrados } = anfitriao()
    await abrirELigar()
    await presenca(ANA, true, 30_000)
    expect(mostrados[0]?.notice.body).toBe(strings.notifications.amigoOnlineDiscreto)
    expect(mostrados[0]?.notice.icon).toBeUndefined()
  })

  it("quem já estava online quando a pessoa entra não avisa", async () => {
    comAvisosDoSistema()
    const { mostrados } = anfitriao()
    await abrirELigar()
    await presenca(ANA, true, 500)
    // After the opening, Ana announces herself again: still not yet arrived.
    await presenca(ANA, true, 30_000)
    expect(mostrados).toHaveLength(0)
    expect(sonsDoAmigo()).toBe(0)
  })

  it("uma vez por amigo a cada 30 minutos", async () => {
    comAvisosDoSistema()
    const { mostrados } = anfitriao()
    await abrirELigar()
    await presenca(ANA, true, 30_000)
    await presenca(ANA, false, 60_000)
    await presenca(ANA, true, 60_000)
    expect(mostrados).toHaveLength(1)
    await presenca(ANA, false, INTERVALO_DO_AVISO_MS)
    await presenca(ANA, true, 1000)
    expect(mostrados).toHaveLength(2)
  })

  it("quem não é amigo não avisa", async () => {
    comAvisosDoSistema()
    const { mostrados } = anfitriao()
    await abrirELigar()
    await presenca(BRUNO, true, 30_000)
    expect(mostrados).toHaveLength(0)
  })

  it('"Ocupado", a pausa, o silenciado e o interruptor calam', async () => {
    comAvisosDoSistema()
    const { mostrados } = anfitriao()
    for (const patch of [
      { activity: "ocupado" as const },
      { pausaAte: agora + 3_600_000 },
      { silenciados: [DM] },
      { avisarAmigosOnline: false },
    ]) {
      cleanup()
      localStorage.clear()
      writePrefs({ ...readPrefs(), notifications: true, notifyPreview: true, ...patch })
      await abrirELigar()
      await presenca(ANA, true, 30_000)
      await presenca(ANA, false, 1000)
    }
    expect(mostrados).toHaveLength(0)
    expect(sonsDoAmigo()).toBe(0)
  })
})

/*
  The other half of point 6: the system alert also comes out with the window in
  front. Before, `windowInFront` silenced everything.
*/
describe("os avisos do sistema com a janela à frente", () => {
  it("uma mensagem privada fora da conversa aberta avisa com a janela à frente", async () => {
    comAvisosDoSistema()
    const { mostrados } = anfitriao(true)
    await abrirELigar()
    await act(async () => {
      onMessage?.({ channel: DM, sender: ANA, seq: 1, payload: { t: "message", id: "m1", sentAt: agora, body: "olá" } })
      await Promise.resolve()
    })
    expect(mostrados.map((m) => m.notice.channel)).toEqual([DM])
  })
})

/*
  The other friend alerts (owner's request, November 3, 2026): the same
  card, the same rules. The pure rules are in `lib/avisosDeAmigos.test.ts`.
*/

/** A voice announcement from the server, at `depoisMs` from now. */
async function voz(
  from: string,
  joined: boolean,
  extra: { channel?: string; room?: string; transmite?: "ecra" | "musica" | "ecra+musica" } = {},
  depoisMs = 0,
): Promise<void> {
  agora += depoisMs
  await act(async () => {
    onCallActivity?.({ channel: extra.channel ?? LAGAR, room: extra.room ?? "lounge", from, joined, ...extra })
    await Promise.resolve()
  })
}

const corpos = (mostrados: { notice: SystemNotice }[]): string[] => mostrados.map((m) => m.notice.body)

describe("um amigo entra numa sala de voz", () => {
  it('o card diz a sala, a comunidade por baixo, e "Juntar-me" entra nessa sala', async () => {
    await abrirELigar()
    await voz(ANA, true, {}, 30_000)
    await waitFor(() => expect(tituloDoCard()).toBe(strings.notifications.amigoNaVoz("Ana", "Lounge")))
    expect(document.querySelector(".aviso-amigo-onde")?.textContent).toBeTruthy()
    expect(sonsDoAmigo()).toBe(1)
    await act(async () => {
      screen.getByRole("button", { name: strings.notifications.juntarMe }).click()
      await Promise.resolve()
    })
    expect(callJoin).toHaveBeenCalledWith(LAGAR, { room: "lounge" })
  })

  it("o anúncio repetido de quem já lá está não avisa outra vez, e a abertura da ligação também não", async () => {
    comAvisosDoSistema()
    const { mostrados } = anfitriao()
    await abrirELigar()
    // It was already there when the connection opened.
    await voz(CARLA, true, {}, 500)
    await voz(CARLA, true, {}, 30_000)
    await voz(ANA, true, {}, 1000)
    await voz(ANA, true, {}, 5000)
    expect(corpos(mostrados)).toEqual([strings.notifications.amigoNaVoz("Ana", "Lounge")])
  })

  it("quem não é amigo não avisa, e quem está numa conversa privada também não (a chamada já toca)", async () => {
    comAvisosDoSistema()
    const { mostrados } = anfitriao()
    await abrirELigar()
    await voz(BRUNO, true, {}, 30_000)
    await voz(ANA, true, { channel: DM, room: "" }, 1000)
    expect(corpos(mostrados).filter((corpo) => corpo.includes("sala de voz"))).toEqual([])
  })

  it("não avisa de quem entra na sala onde já estou", async () => {
    await abrirELigar()
    await voz(ANA, true, {}, 30_000)
    await waitFor(() => expect(tituloDoCard()).toBe(strings.notifications.amigoNaVoz("Ana", "Lounge")))
    await act(async () => {
      screen.getByRole("button", { name: strings.notifications.juntarMe }).click()
      await Promise.resolve()
    })
    comAvisosDoSistema()
    const { mostrados } = anfitriao()
    await voz(CARLA, true, {}, 1000)
    expect(mostrados).toHaveLength(0)
  })

  it("uma vez por amigo a cada 30 minutos, e o interruptor desligado cala", async () => {
    comAvisosDoSistema()
    const { mostrados } = anfitriao()
    await abrirELigar()
    await voz(ANA, true, {}, 30_000)
    await voz(ANA, false, {}, 1000)
    await voz(ANA, true, {}, 1000)
    expect(mostrados).toHaveLength(1)
    await voz(ANA, false, {}, INTERVALO_DO_AVISO_MS)
    await voz(ANA, true, {}, 1000)
    expect(mostrados).toHaveLength(2)

    cleanup()
    localStorage.clear()
    writePrefs({ ...readPrefs(), notifications: true, notifyPreview: true, avisarAmigosNaVoz: false })
    const outro = anfitriao()
    await abrirELigar()
    await voz(ANA, true, {}, 30_000)
    expect(outro.mostrados).toHaveLength(0)
  })
})

describe("um amigo começa a partilhar o ecrã", () => {
  it('chega a quem está fora da sala: o card diz o ecrã e o botão "Ver" entra na sala', async () => {
    comAvisosDoSistema()
    const { mostrados } = anfitriao()
    await abrirELigar()
    await voz(CARLA, true, {}, 30_000)
    await voz(CARLA, true, { transmite: "ecra" }, 2000)
    expect(corpos(mostrados)).toEqual([
      strings.notifications.amigoNaVoz("Carla", "Lounge"),
      strings.notifications.amigoNoEcra("Carla", "Lounge"),
    ])
    await act(async () => {
      mostrados[1]?.open()
      await Promise.resolve()
    })
    expect(callJoin).toHaveBeenCalledWith(LAGAR, { room: "lounge" })
  })

  it('dentro da app, o botão diz "Ver"; e entrar já a partilhar dá um card só, o do ecrã', async () => {
    await abrirELigar()
    await voz(ANA, true, { transmite: "ecra+musica" }, 30_000)
    await waitFor(() => expect(tituloDoCard()).toBe(strings.notifications.amigoNoEcra("Ana", "Lounge")))
    expect(document.querySelectorAll(".aviso-amigo")).toHaveLength(1)
    expect(screen.getByRole("button", { name: strings.notifications.ver })).toBeTruthy()
  })

  it("o interruptor desligado cala, e só a música não é ecrã", async () => {
    writePrefs({ ...readPrefs(), notifications: true, notifyPreview: true, avisarAmigosNoEcra: false })
    const { mostrados } = anfitriao()
    await abrirELigar()
    await voz(ANA, true, {}, 30_000)
    await voz(ANA, true, { transmite: "ecra" }, 1000)
    await voz(CARLA, true, { transmite: "musica" }, 1000)
    expect(corpos(mostrados).filter((corpo) => corpo.includes("ecrã"))).toEqual([])
  })
})

describe("um amigo entra numa comunidade minha", () => {
  async function entraNoLagar(quem: string, depoisMs = 30_000): Promise<void> {
    agora += depoisMs
    membrosDoLagar = [...membrosDoLagar, quem]
    await act(async () => {
      onEpoch?.({ channel: LAGAR })
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('o card diz a comunidade, e "Abrir" abre-a', async () => {
    await abrirELigar()
    await entraNoLagar(ANA)
    await waitFor(() => expect(tituloDoCard()).toMatch(/^Ana entrou no canal /))
    expect(screen.getByRole("button", { name: strings.notifications.abrir })).toBeTruthy()
  })

  it("quem já lá estava não avisa; quem não é amigo também não; o interruptor desligado cala", async () => {
    comAvisosDoSistema()
    const { mostrados } = anfitriao()
    membrosDoLagar = [EU, BRUNO, CARLA]
    await abrirELigar()
    // An epoch with no new people, and Bruno is not a friend.
    await act(async () => {
      onEpoch?.({ channel: LAGAR })
      await Promise.resolve()
    })
    expect(mostrados).toHaveLength(0)

    cleanup()
    localStorage.clear()
    membrosDoLagar = [EU, BRUNO]
    writePrefs({ ...readPrefs(), notifications: true, notifyPreview: true, avisarAmigosNaComunidade: false })
    const outro = anfitriao()
    await abrirELigar()
    await entraNoLagar(ANA)
    expect(outro.mostrados).toHaveLength(0)
  })

  it("uma vez por amigo a cada 30 minutos", async () => {
    comAvisosDoSistema()
    const { mostrados } = anfitriao()
    await abrirELigar()
    await entraNoLagar(ANA)
    membrosDoLagar = [EU, BRUNO]
    await act(async () => {
      onEpoch?.({ channel: LAGAR })
      await Promise.resolve()
    })
    await entraNoLagar(ANA, 60_000)
    expect(mostrados).toHaveLength(1)
  })
})

describe("a chamada perdida", () => {
  const perdidas = (): unknown[] =>
    guardar.mock.calls
      .map(([entradas]) => entradas as { kind: string; actor?: string }[])
      .at(-1)
      ?.filter((entrada) => entrada.kind === "missed-call") ?? []

  it("a Ana liga e desiste sem ninguém atender: entra no sino", async () => {
    await abrirELigar()
    await voz(ANA, true, { channel: DM, room: "" }, 30_000)
    await voz(ANA, false, { channel: DM, room: "" }, 5000)
    await waitFor(() => expect(perdidas()).toEqual([expect.objectContaining({ actor: ANA, channel: DM })]))
  })

  it("atendida noutro aparelho da conta não é perdida", async () => {
    await abrirELigar()
    await voz(ANA, true, { channel: DM, room: "" }, 30_000)
    await voz(EU, true, { channel: DM, room: "" }, 2000)
    await voz(ANA, false, { channel: DM, room: "" }, 5000)
    expect(perdidas()).toEqual([])
  })

  it("quem ligou desliga-se sem ninguém atender: perdida", async () => {
    await abrirELigar()
    await voz(ANA, true, { channel: DM, room: "" }, 30_000)
    await presenca(ANA, false, 5000)
    await waitFor(() => expect(perdidas()).toHaveLength(1))
  })
})

import { moradaDeTeste } from "../testes/moradas.js"
import type { FichaDoCanal } from "@enclave/client-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { formatInviteLink } from "@enclave/client-core"
import type { EnclaveBridge } from "./bridge.js"
import { App, INTERVALO_DO_PULSO_MS, SILENCIO_DO_PULSO_MS } from "./App.js"
import { PRIMEIROS_PASSOS_KEY } from "./hooks/usePrimeirosPassos.js"
import { strings } from "./strings.js"

/**
 * Phase 4 (fluidity), seen from the whole shell:
 *
 *  - the "No connection" banner connects on click and when the network or tab
 *    returns;
 *  - someone writing offline sees the message waiting, and it goes out when
 *    it comes back;
 *  - a followed link stays in the sidebar, "waiting for entry", until the
 *    channel arrives, and can be canceled;
 *  - someone who just created the account sees how to reach someone.
 */

afterEach(cleanup)
beforeEach(() => localStorage.clear())

const ME = "@me:casa.pt"

const DM_ANA = moradaDeTeste("directa ana me", "casa.pt")
/** The card of each channel (1.0 "Arca", slice 6b), for the false bridge to give to the interface. */
const FICHAS = (): Record<string, FichaDoCanal> => ({
  [DM_ANA]: { tipo: "directa", par: "@ana:casa.pt" },
  [FEED]: { tipo: "mural", dono: "@me:casa.pt" },
})
const FEED = moradaDeTeste("mural me", "casa.pt")
const CANAL = "!sala-nova:casa.pt"
const GERAL = "!geral:casa.pt"
const CODIGO = "AbCdEfGhIjKlMnOpQrStUvWxYz012345"

interface Bancada {
  bridge: EnclaveBridge
  redeem: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  ligar: () => void
  cair: () => void
  canais: (lista: string[]) => void
}

function bancada(
  opcoes: { cofre?: "abre" | "pede-palavra" | "nao-existe"; aplicacaoInstalada?: boolean; destroy?: () => Promise<{ ok: boolean }> } = {},
): Bancada {
  const cofre = opcoes.cofre ?? "abre"
  const redeem = vi.fn(async () => ({ ok: true }))
  const connect = vi.fn(async () => ({ ok: true }))
  const send = vi.fn(async () => ({ ok: true }))
  let aoLigar: ((payload: unknown) => void) | null = null
  let aosCanais: ((payload: unknown) => void) | null = null
  const bridge = {
    vault: {
      status: async () => ({ exists: cofre !== "nao-existe", supportsOsProtection: true }),
      unlock: async () => {
        if (cofre === "pede-palavra") throw new Error("wrong passphrase, or the vault is damaged")
        return { ok: true }
      },
      create: async () => ({ ok: true }),
      lock: async () => ({ ok: true }),
      destroy: opcoes.destroy ?? (async () => ({ ok: true })),
    },
    identity: {
      load: async () => ({ address: ME, accountId: "me" }),
      create: async () => ({ address: ME, accountId: "me" }),
    },
    session: {
      connect,
      capabilities: async () => ["mls", "presence"],
      setVisible: async () => ({ ok: true }),
    },
    channels: {
        fichas: FICHAS,
      list: async () => [FEED],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: async () => ({ ok: true }),
      declineChannelInvite: async () => ({ ok: true }),
      send,
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [ME],
      history: async () => [],
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
    },
    invites: {
      create: async () => formatInviteLink("casa.pt", CANAL, CODIGO),
      redeem,
      list: async () => [],
      revoke: async () => ({ ok: true }),
    },
    social: {
      post: async () => ({ ok: true }),
      acceptFollower: async () => ({ ok: true }),
      acceptFriend: async () => ({ ok: true }),
      declineFriend: async () => ({ ok: true }),
      unfriend: async () => ({ ok: true }),
      repairInvite: async () => ({ invited: true }),
      deadWelcomes: async () => [],
      feedChannel: async () => FEED,
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
        aoLigar = handler
        return () => {}
      },
      channels: (handler: (payload: unknown) => void) => {
        aosCanais = handler
        return () => {}
      },
      presence: () => () => {},
      typing: () => () => {},
      buzz: () => () => {},
      callActivity: () => () => {},
    },
    call: { on: () => () => {}, setMuted: () => {} },
    ...(opcoes.aplicacaoInstalada
      ? { actualizacao: { verificar: async () => null, dispensar: async () => {}, abrir: async () => {} } }
      : {}),
  } as unknown as EnclaveBridge
  return {
    bridge,
    redeem,
    connect,
    send,
    ligar: () => act(() => aoLigar?.({ state: "online" })),
    cair: () => act(() => aoLigar?.({ state: "reconnecting" })),
    canais: (lista) => act(() => aosCanais?.({ channels: lista })),
  }
}


/** The password step in Setup, and the confirmation step. */
async function escolherFrase(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await waitFor(() => expect(document.querySelector('input[name="new-password"]')).not.toBeNull())
  await user.type(document.querySelector('input[name="new-password"]') as HTMLInputElement, "uma frase comprida{Enter}")
  await waitFor(() => expect(document.querySelector('input[name="confirm-password"]')).not.toBeNull())
  await user.type(document.querySelector('input[name="confirm-password"]') as HTMLInputElement, "uma frase comprida")
}

async function dentro(): Promise<void> {
  await screen.findByRole("button", { name: strings.rail.social })
}

describe('a faixa "Sem ligação" com acção', () => {
  it('"Ligar agora" pede a ligação à ponte, e a faixa diz há quanto tempo caiu', async () => {
    const user = userEvent.setup()
    const { bridge, connect, ligar, cair } = bancada()
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    cair()
    const antes = connect.mock.calls.length

    const faixa = await screen.findByText(strings.connection.semLigacaoHa("menos de 1 min"), { exact: false })
    expect(faixa).toBeTruthy()
    await user.click(screen.getAllByRole("button", { name: strings.connection.ligarAgora })[0]!)
    expect(connect.mock.calls.length).toBe(antes + 1)
  })

  it("a rede a voltar e o separador a ficar visível ligam já; ligada, não se mexe em nada", async () => {
    const { bridge, connect, ligar, cair } = bancada()
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    const ligada = connect.mock.calls.length
    act(() => {
      window.dispatchEvent(new Event("online"))
    })
    // Connected: a `connect` here would close a socket that is working.
    expect(connect.mock.calls.length).toBe(ligada)

    cair()
    await act(async () => {
      window.dispatchEvent(new Event("online"))
      await Promise.resolve()
    })
    expect(connect.mock.calls.length).toBe(ligada + 1)

    // The first attempt is done (and the connection stays down): the tab becoming
    // visible tries again.
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
      await Promise.resolve()
    })
    expect(connect.mock.calls.length).toBe(ligada + 2)
  })

  it("rede e separador no mesmo instante, ou um duplo clique, dão UMA tentativa enquanto ela corre", async () => {
    const { bridge, connect, ligar, cair } = bancada()
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    cair()
    // An attempt that takes time: the promise stays pending until told to stop.
    let acabar: () => void = () => {}
    connect.mockImplementation(() => new Promise((r) => (acabar = () => r({ ok: true }))))
    const antes = connect.mock.calls.length

    act(() => {
      window.dispatchEvent(new Event("online"))
      document.dispatchEvent(new Event("visibilitychange"))
    })
    const botao = screen.getAllByRole("button", { name: strings.connection.ligarAgora })[0]!
    fireEvent.click(botao)
    fireEvent.click(botao)
    expect(connect.mock.calls.length).toBe(antes + 1)

    await act(async () => {
      acabar()
      await Promise.resolve()
      await Promise.resolve()
    })
    fireEvent.click(botao)
    expect(connect.mock.calls.length).toBe(antes + 2)
  })
})

describe("a ligação meio aberta (1.3.6)", () => {
  /** The test bench bridge, with the connection check counting. */
  function comVerificacao(): Bancada & { verificar: ReturnType<typeof vi.fn> } {
    const banco = bancada()
    const verificar = vi.fn(async () => true)
    ;(banco.bridge.session as { verificarLigacao?: () => Promise<boolean> }).verificarLigacao = verificar
    return { ...banco, verificar }
  }

  function visibilidade(estado: "visible" | "hidden"): void {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => estado })
  }

  afterEach(() => {
    visibilidade("visible")
    vi.useRealTimers()
  })

  it("ligada, o separador a voltar, a rede a voltar e a página a sair da cache verificam a ligação, sem a substituir", async () => {
    const { bridge, connect, ligar, verificar } = comVerificacao()
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    const ligada = connect.mock.calls.length
    const antes = verificar.mock.calls.length

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
      await Promise.resolve()
    })
    expect(verificar.mock.calls.length).toBe(antes + 1)

    await act(async () => {
      window.dispatchEvent(new Event("online"))
      await Promise.resolve()
    })
    expect(verificar.mock.calls.length).toBe(antes + 2)

    const voltou = new Event("pageshow") as Event & { persisted?: boolean }
    Object.defineProperty(voltou, "persisted", { value: true })
    await act(async () => {
      window.dispatchEvent(voltou)
      await Promise.resolve()
    })
    expect(verificar.mock.calls.length).toBe(antes + 3)
    // None of these replaces the socket: that would close a socket that may be fine.
    expect(connect.mock.calls.length).toBe(ligada)
  })

  it("enquanto se vê, verifica de tempos a tempos; escondida, não gasta bateria nem rede", async () => {
    const { bridge, ligar, verificar } = comVerificacao()
    render(<App bridge={bridge} />)
    await dentro()
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] })
    ligar()
    const antes = verificar.mock.calls.length

    await act(async () => {
      vi.advanceTimersByTime(INTERVALO_DO_PULSO_MS + 10)
    })
    expect(verificar.mock.calls.length).toBe(antes + 1)
    // Since 1.3.7 the pulse only asks after one minute of socket silence.
    expect(verificar.mock.calls.at(-1)).toEqual([{ silencioMinimoMs: SILENCIO_DO_PULSO_MS }])

    visibilidade("hidden")
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    const escondida = verificar.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(INTERVALO_DO_PULSO_MS * 4)
    })
    expect(verificar.mock.calls.length).toBe(escondida)
  })

  it("sem ligação não se verifica: liga-se, como antes", async () => {
    const { bridge, connect, ligar, cair, verificar } = comVerificacao()
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    cair()
    const antes = connect.mock.calls.length
    const verificadas = verificar.mock.calls.length
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
      await Promise.resolve()
    })
    expect(connect.mock.calls.length).toBe(antes + 1)
    expect(verificar.mock.calls.length).toBe(verificadas)
  })
})

describe("a volta ao primeiro plano (1.3.7)", () => {
  function visibilidade(estado: "visible" | "hidden"): void {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => estado })
  }

  afterEach(() => {
    visibilidade("visible")
    vi.useRealTimers()
  })

  it("com `retomar` na ponte, a volta diz à sessão quanto tempo esteve escondida e se o aparelho suspende", async () => {
    const banco = bancada()
    const retomar = vi.fn(() => "nada")
    const verificar = vi.fn(async () => true)
    Object.assign(banco.bridge.session as object, { retomar, verificarLigacao: verificar })
    const nada = (): void => {}
    const toque = vi.fn(
      (consulta: string) =>
        ({ matches: consulta === "(pointer: coarse)", media: consulta, addEventListener: nada, removeEventListener: nada, addListener: nada, removeListener: nada }) as unknown as MediaQueryList,
    )
    const original = window.matchMedia
    window.matchMedia = toque as unknown as typeof window.matchMedia
    try {
      render(<App bridge={banco.bridge} />)
      await dentro()
      banco.ligar()
      vi.useFakeTimers({ toFake: ["Date"] })
      visibilidade("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
      vi.advanceTimersByTime(45_000)
      visibilidade("visible")
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"))
        await Promise.resolve()
      })
      expect(retomar).toHaveBeenCalledTimes(1)
      const [opcoes] = retomar.mock.calls[0] as unknown as [{ escondidaMs: number; suspende: boolean }]
      expect(opcoes.escondidaMs).toBeGreaterThanOrEqual(45_000)
      expect(opcoes.suspende).toBe(true)
      // The check is no longer called directly by the return: the session decides.
      expect(verificar).not.toHaveBeenCalled()
    } finally {
      window.matchMedia = original
    }
  })
})

describe("escrever sem ligação", () => {
  it('a mensagem aparece à espera, com "Descartar", e sai quando a ligação volta', async () => {
    const user = userEvent.setup()
    const { bridge, send, ligar, cair, canais } = bancada()
    bridge.channels.list = async () => [FEED, GERAL]
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    canais([FEED, GERAL])
    cair()

    const caixa = await screen.findByPlaceholderText(strings.connection.composerEspera)
    await user.type(caixa, "escrita no comboio{Enter}")
    expect(await screen.findByText(strings.chat.aEsperaDeLigacaoNota)).toBeTruthy()
    expect(screen.getByText("escrita no comboio")).toBeTruthy()
    expect(send).not.toHaveBeenCalled()

    ligar()
    await waitFor(() => expect(send).toHaveBeenCalledWith(GERAL, "escrita no comboio", undefined, undefined))
  })
})

describe("à espera de entrada", () => {
  it("um link seguido fica na barra lateral até o canal chegar, e aí dá lugar ao canal", async () => {
    const user = userEvent.setup()
    const { bridge, ligar, canais } = bancada()
    render(<App bridge={bridge} />)
    await dentro()
    ligar()

    await user.click(screen.getByRole("button", { name: strings.sidebar.joinWithLink }))
    const janela = screen.getByRole("dialog")
    await user.type(within(janela).getByRole("textbox"), formatInviteLink("casa.pt", CANAL, CODIGO))
    await user.click(within(janela).getByRole("button", { name: strings.prompts.confirm }))

    // The usual toast stays, and the line remains.
    expect(await screen.findByText(strings.chat.joinPending)).toBeTruthy()
    expect(screen.getByText(strings.sidebar.aEsperaDeEntrada)).toBeTruthy()
    expect(screen.getByText("sala-nova")).toBeTruthy()

    canais([FEED, CANAL])
    await waitFor(() => expect(screen.queryByText(strings.sidebar.aEsperaDeEntrada)).toBeNull())
  })

  it('"Cancelar" tira a linha e diz que o canal ainda pode aparecer', async () => {
    const user = userEvent.setup()
    const { bridge, ligar } = bancada()
    render(<App bridge={bridge} />)
    await dentro()
    ligar()

    await user.click(screen.getByRole("button", { name: strings.sidebar.joinWithLink }))
    const janela = screen.getByRole("dialog")
    await user.type(within(janela).getByRole("textbox"), formatInviteLink("casa.pt", CANAL, CODIGO))
    fireEvent.submit(within(janela).getByRole("textbox").closest("form")!)
    await screen.findByText(strings.sidebar.aEsperaDeEntrada)

    await user.click(screen.getByRole("button", { name: strings.sidebar.cancelarEspera("sala-nova") }))
    expect(screen.queryByText(strings.sidebar.aEsperaDeEntrada)).toBeNull()
    expect(await screen.findByText(strings.sidebar.esperaCancelada)).toBeTruthy()
  })
})

describe("a primeira vez", () => {
  it("depois de criar a conta, o cartão dá os três caminhos; fechar tira-o de vez", async () => {
    const user = userEvent.setup()
    const { bridge, ligar } = bancada({ cofre: "nao-existe" })
    render(<App bridge={bridge} />)

    // Setup opens with the other device question (phase 8.1).
    await user.click(await screen.findByRole("button", { name: strings.gate.outroAparelhoNao }))
    await user.type(await screen.findByPlaceholderText(strings.gate.namePlaceholder), "Vera{Enter}")
    await user.click(await screen.findByRole("button", { name: strings.gate.skipPhoto }))
    // F3 of the session memory: a new account is always born with a password, also
    // in a host with a key vault. The phrase and the confirmation.
    await escolherFrase(user)
    await user.click(await screen.findByRole("button", { name: strings.gate.create }))
    await dentro()
    ligar()

    expect(await screen.findByText(strings.primeirosPassos.titulo)).toBeTruthy()
    const cartao = (): HTMLElement => screen.getByRole("region", { name: strings.primeirosPassos.titulo })
    expect(within(cartao()).getByRole("button", { name: strings.primeirosPassos.copiar })).toBeTruthy()
    await user.click(within(cartao()).getByRole("button", { name: strings.primeirosPassos.link }))
    expect(within(screen.getByRole("dialog")).getByText(strings.prompts.joinTitle)).toBeTruthy()
    await user.keyboard("{Escape}")

    await user.click(within(cartao()).getByRole("button", { name: strings.primeirosPassos.amigo }))
    expect(within(screen.getByRole("dialog")).getByText(strings.prompts.friendTitle)).toBeTruthy()
    await user.keyboard("{Escape}")

    await user.click(screen.getByRole("button", { name: strings.primeirosPassos.fechar }))
    expect(screen.queryByText(strings.primeirosPassos.titulo)).toBeNull()
    expect(localStorage.getItem(PRIMEIROS_PASSOS_KEY)).toBeNull()
  })

  it("quem desbloqueia uma conta que já existia não vê o cartão", async () => {
    const { bridge, ligar } = bancada()
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    expect(screen.queryByText(strings.primeirosPassos.titulo)).toBeNull()
  })

  it("o primeiro canal tira o cartão", async () => {
    const user = userEvent.setup()
    const { bridge, ligar, canais } = bancada({ cofre: "nao-existe" })
    render(<App bridge={bridge} />)
    await user.click(await screen.findByRole("button", { name: strings.gate.outroAparelhoNao }))
    await user.type(await screen.findByPlaceholderText(strings.gate.namePlaceholder), "Vera{Enter}")
    await user.click(await screen.findByRole("button", { name: strings.gate.skipPhoto }))
    // F3 of the session memory: a new account is always born with a password, also
    // in a host with a key vault. The phrase and the confirmation.
    await escolherFrase(user)
    await user.click(await screen.findByRole("button", { name: strings.gate.create }))
    await dentro()
    ligar()
    await screen.findByText(strings.primeirosPassos.titulo)

    canais([FEED, GERAL])
    await waitFor(() => expect(screen.queryByText(strings.primeirosPassos.titulo)).toBeNull())
  })
})

describe("à espera de entrada: um convite aceite", () => {
  const ANA = "@ana:casa.pt"
  const DM = DM_ANA
  const CLUBE = "!clube:casa.pt"

  /** Ana's invite and our yes, in the direct conversation history. */
  /** An invite + yes pair, at the given time. */
  function par(at: number, seq: number): unknown[] {
    return [
      { seq, sender: ANA, at, payload: { t: "message", invite: { channel: CLUBE, name: "Clube", at } } },
      { seq: seq + 1, sender: ME, at: at + 1, payload: { t: "message", inviteReply: { channel: CLUBE, accepted: true, at: at + 1 } } },
    ]
  }

  function comConviteAceite(bridge: EnclaveBridge, lista: string[]): void {
    const agora = Date.now()
    bridge.channels.list = async () => lista
    bridge.channels.history = async (canal: string) =>
      canal === DM ? (par(agora - 2000, 1) as never) : []
  }

  it("sem o canal, a linha aparece com o nome do convite", async () => {
    const { bridge, ligar } = bancada()
    comConviteAceite(bridge, [FEED, DM])
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    expect(await screen.findByText("Clube")).toBeTruthy()
    expect(screen.getByText(strings.sidebar.aEsperaDeEntrada)).toBeTruthy()
  })

  it("o canal chegou, a pessoa saiu dele, e recarregou: a linha não volta", async () => {
    const primeira = bancada()
    comConviteAceite(primeira.bridge, [FEED, DM, CLUBE])
    const { unmount } = render(<App bridge={primeira.bridge} />)
    await dentro()
    primeira.ligar()
    await waitFor(() => expect(JSON.parse(localStorage.getItem("enclave.esperasFeitas") ?? "{}")).toHaveProperty([CLUBE]))
    unmount()

    // Reload outside the channel: the fold still shows "accepted", but the store says it already waited.
    const segunda = bancada()
    comConviteAceite(segunda.bridge, [FEED, DM])
    render(<App bridge={segunda.bridge} />)
    await dentro()
    segunda.ligar()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(screen.queryByText(strings.sidebar.aEsperaDeEntrada)).toBeNull()
  })
})

describe("à espera de entrada: um convite novo para um canal de onde se saiu", () => {
  it("aceitar, entrar, sair, e aceitar outro convite mais tarde: a linha volta", async () => {
    const ANA = "@ana:casa.pt"
    const DM = DM_ANA
    const CLUBE = "!clube:casa.pt"
    const agora = Date.now()
    const par = (at: number, seq: number): unknown[] => [
      { seq, sender: ANA, at, payload: { t: "message", invite: { channel: CLUBE, name: "Clube", at } } },
      { seq: seq + 1, sender: ME, at: at + 1, payload: { t: "message", inviteReply: { channel: CLUBE, accepted: true, at: at + 1 } } },
    ]

    const primeira = bancada()
    primeira.bridge.channels.list = async () => [FEED, DM, CLUBE]
    primeira.bridge.channels.history = async (canal: string) => (canal === DM ? (par(agora - 2000, 1) as never) : [])
    const { unmount } = render(<App bridge={primeira.bridge} />)
    await dentro()
    primeira.ligar()
    await waitFor(() => expect(localStorage.getItem("enclave.esperasFeitas")).toContain(CLUBE))
    unmount()

    // Weeks later, outside the channel, a new invite (timestamp greater than the mark), accepted.
    const segunda = bancada()
    segunda.bridge.channels.list = async () => [FEED, DM]
    segunda.bridge.channels.history = async (canal: string) =>
      canal === DM ? ([...par(agora - 2000, 1), ...par(Date.now() + 60_000, 3)] as never) : []
    render(<App bridge={segunda.bridge} />)
    await dentro()
    segunda.ligar()
    expect(await screen.findByText(strings.sidebar.aEsperaDeEntrada)).toBeTruthy()
  })
})

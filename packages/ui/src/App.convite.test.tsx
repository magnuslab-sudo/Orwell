import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { formatInviteLink, formatShortInviteLink } from "@enclave/client-core"
import { moradaDeSala, parseServerName } from "@enclave/protocol"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import type { StartupInvite } from "./lib/conviteDeArranque.js"
import { en } from "./linguas/en.js"
import { pt } from "./linguas/pt.js"
import { strings } from "./strings.js"

afterEach(cleanup)

/**
 * The invite link, from the gate to the channel.
 *
 * The rules locked in here are for security, not comfort:
 *
 *  - a link NEVER enters on its own: without a yes, `redeem` is not called;
 *  - declining removes the invite from what the host saved, and does not redeem;
 *  - an invite from another server is not redeemed, whether from startup or pasted;
 *  - the two forms of the link, the new and the old, enter by the same path.
 */

const ME = "@me:casa.pt"
const FEED = "!feed-me:casa.pt"
const CANAL = "!sala-nova:casa.pt"
const CODIGO = "AbCdEfGhIjKlMnOpQrStUvWxYz012345"

/** An invite from 1.0: the code is 16 characters in base32, to fit in the short link. */
const CODIGO_NOVO = "0123456789abcdef"
const CURTA = formatShortInviteLink("casa.pt", "ab23cd45", CODIGO_NOVO)
const LONGA_DA_CURTA = formatInviteLink("casa.pt", CANAL, CODIGO_NOVO)

interface Bancada {
  bridge: EnclaveBridge
  redeem: ReturnType<typeof vi.fn>
  resolve: ReturnType<typeof vi.fn>
  ligar: () => void
  canais: (lista: string[]) => void
}

function bancada(
  opcoes: {
    cofre?: "abre" | "pede-palavra" | "nao-existe"
    aplicacaoInstalada?: boolean
    destroy?: () => Promise<{ ok: boolean }>
    resolve?: (link: string) => Promise<string>
    /** The seal of the open invite (slice 5c). Without this, the bridge has no `name`. */
    nome?: (link: string) => Promise<{ canal: string; quem?: string } | null>
  } = {},
): Bancada {
  const cofre = opcoes.cofre ?? "abre"
  const redeem = vi.fn(async () => ({ ok: true }))
  const resolve = vi.fn(opcoes.resolve ?? (async () => LONGA_DA_CURTA))
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
      connect: async () => ({ ok: true }),
      capabilities: async () => ["mls", "presence"],
      setVisible: async () => ({ ok: true }),
    },
    channels: {
      list: async () => [FEED],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: async () => ({ ok: true }),
      declineChannelInvite: async () => ({ ok: true }),
      send: async () => ({ ok: true }),
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
      resolve,
      ...(opcoes.nome ? { nome: opcoes.nome } : {}),
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
    resolve,
    ligar: () => act(() => aoLigar?.({ state: "online" })),
    canais: (lista) => act(() => aosCanais?.({ channels: lista })),
  }
}

function conviteDeArranque(parcial: Partial<StartupInvite> = {}): StartupInvite & { forget: ReturnType<typeof vi.fn> } {
  return {
    invite: { server: "casa.pt", channel: CANAL, code: CODIGO },
    invalid: false,
    forget: vi.fn(),
    ...parcial,
  } as StartupInvite & { forget: ReturnType<typeof vi.fn> }
}

/** The shell is up when the rail appears. */
async function dentro(): Promise<void> {
  await screen.findByRole("button", { name: strings.rail.social })
}

describe("o link de convite com que a página abriu", () => {
  it("no portão, diz numa linha que há um convite à espera, e não pergunta nada", async () => {
    const { bridge, redeem } = bancada({ cofre: "pede-palavra" })
    render(<App bridge={bridge} startupInvite={conviteDeArranque()} />)

    expect(await screen.findByText(strings.invite.gateWaiting)).toBeTruthy()
    expect(screen.queryByText(strings.invite.arrivedTitle)).toBeNull()
    expect(redeem).not.toHaveBeenCalled()
  })

  it("a mesma linha aparece a quem ainda não tem conta", async () => {
    const { bridge } = bancada({ cofre: "nao-existe" })
    render(<App bridge={bridge} startupInvite={conviteDeArranque()} />)
    expect(await screen.findByText(strings.invite.gateWaiting)).toBeTruthy()
  })

  it("sem convite, o portão não diz nada sobre convites", async () => {
    const { bridge } = bancada({ cofre: "pede-palavra" })
    render(<App bridge={bridge} />)
    await screen.findByText(strings.gate.unlockTitle)
    expect(screen.queryByText(strings.invite.gateWaiting)).toBeNull()
  })

  it("NUNCA entra sozinho: lá dentro e ligado, pergunta, e sem resposta não redime", async () => {
    const { bridge, redeem, ligar } = bancada()
    const convite = conviteDeArranque()
    render(<App bridge={bridge} startupInvite={convite} />)
    await dentro()

    // Offline does not ask yet: accepting sends a request, and there was no way.
    expect(screen.queryByText(strings.invite.arrivedTitle)).toBeNull()
    ligar()

    expect(await screen.findByText(strings.invite.arrivedTitle)).toBeTruthy()
    // The channel and server, as they came in the link.
    expect(screen.getByText(strings.invite.arrivedBody("sala-nova", "casa.pt"))).toBeTruthy()
    expect(redeem).not.toHaveBeenCalled()
    expect(convite.forget).not.toHaveBeenCalled()
  })

  it("Entrar redime o link canónico, apaga o guardado, e o canal abre quando aparece", async () => {
    const user = userEvent.setup()
    const { bridge, redeem, ligar, canais } = bancada()
    const convite = conviteDeArranque()
    render(<App bridge={bridge} startupInvite={convite} />)
    await dentro()
    ligar()

    await user.click(await screen.findByRole("button", { name: strings.invite.arrivedAccept }))

    expect(redeem).toHaveBeenCalledExactlyOnceWith(formatInviteLink("casa.pt", CANAL, CODIGO))
    expect(convite.forget).toHaveBeenCalledOnce()
    expect(screen.queryByText(strings.invite.arrivedTitle)).toBeNull()

    canais([FEED, CANAL])
    expect(await screen.findByText(strings.chat.joined("sala-nova"))).toBeTruthy()
  })

  it("Agora não não redime, e apaga o convite do que o anfitrião guardou", async () => {
    const user = userEvent.setup()
    const { bridge, redeem, ligar } = bancada()
    const convite = conviteDeArranque()
    render(<App bridge={bridge} startupInvite={convite} />)
    await dentro()
    ligar()

    await user.click(await screen.findByRole("button", { name: strings.invite.arrivedDecline }))

    expect(redeem).not.toHaveBeenCalled()
    expect(convite.forget).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByText(strings.invite.arrivedTitle)).toBeNull())
  })

  it("fechar a janela com Escape vale o mesmo que recusar", async () => {
    const user = userEvent.setup()
    const { bridge, redeem, ligar } = bancada()
    const convite = conviteDeArranque()
    render(<App bridge={bridge} startupInvite={convite} />)
    await dentro()
    ligar()
    await screen.findByText(strings.invite.arrivedTitle)

    await user.keyboard("{Escape}")

    expect(redeem).not.toHaveBeenCalled()
    expect(convite.forget).toHaveBeenCalledOnce()
  })

  it("um convite de OUTRO servidor diz logo porque não serve: sem botão de entrar, e não se redime", async () => {
    const user = userEvent.setup()
    const { bridge, redeem, ligar } = bancada()
    const convite = conviteDeArranque({ invite: { server: "outro.pt", channel: "!x:outro.pt", code: CODIGO } })
    render(<App bridge={bridge} startupInvite={convite} />)
    await dentro()
    ligar()

    // The phrase is in the window body when it opens, not in an error after a click.
    expect(await screen.findByText(strings.invite.otherServer("outro.pt", "casa.pt"))).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.invite.arrivedAccept })).toBeNull()
    expect(convite.forget).not.toHaveBeenCalled()

    const janela = screen.getByRole("dialog")
    await user.click(within(janela).getByRole("button", { name: strings.common.close }))

    expect(redeem).not.toHaveBeenCalled()
    expect(convite.forget).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByText(strings.invite.arrivedTitle)).toBeNull())
  })

  it('com uma morada opaca (1.0), o aviso diz "neste canal" e nunca mostra a morada', async () => {
    const { bridge, ligar } = bancada()
    const opaca = moradaDeSala(parseServerName("casa.pt"))
    const convite = conviteDeArranque({ invite: { server: "casa.pt", channel: opaca, code: CODIGO } })
    bridge.channels.list = async () => [FEED, opaca]
    render(<App bridge={bridge} startupInvite={convite} />)
    await dentro()
    ligar()

    expect(await screen.findByText(strings.invite.alreadyInOpaco)).toBeTruthy()
    // The alert has no address (the sidebar of the workbench shows it, because
    // no one published the channel name here: that is not from this test).
    expect(screen.queryByText(new RegExp(`Já estás em .*${opaca.slice(1, 12)}`))).toBeNull()
  })

  it("quem já está no canal é levado lá sem pergunta nenhuma, e sem pedido", async () => {
    const { bridge, redeem, ligar } = bancada()
    const convite = conviteDeArranque({ invite: { server: "casa.pt", channel: FEED.replace("!feed-me", "!ja-ca-estou"), code: CODIGO } })
    // The workbench channel list now has that channel.
    bridge.channels.list = async () => [FEED, "!ja-ca-estou:casa.pt"]
    render(<App bridge={bridge} startupInvite={convite} />)
    await dentro()
    ligar()

    expect(await screen.findByText(strings.invite.alreadyIn("ja-ca-estou"))).toBeTruthy()
    expect(screen.queryByText(strings.invite.arrivedTitle)).toBeNull()
    expect(redeem).not.toHaveBeenCalled()
    expect(convite.forget).toHaveBeenCalledOnce()
  })

  /*
    The channel name is text from whoever sent the link. The ornament enters here without
    going through the parser on purpose: what is shown has to be safe even if
    what arrives is not.
  */
  it("uma marca de direcção no nome do canal não chega ao ecrã", async () => {
    const { bridge, ligar } = bancada()
    // U+202E reverses reading: "\u202Elareg" draws as "geral".
    render(<App bridge={bridge} startupInvite={conviteDeArranque({ invite: { server: "casa.pt", channel: "!\u202Elareg\u2066:casa.pt", code: CODIGO } })} />)
    await dentro()
    ligar()

    const corpo = (await screen.findByText(strings.invite.arrivedTitle)).closest("[role=dialog]") as HTMLElement
    expect(corpo.textContent).not.toMatch(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/)
    expect(corpo.textContent).toContain(strings.invite.arrivedBody("lareg", "casa.pt"))
  })

  it("um nome de duzentos mil caracteres não é o diálogo inteiro", async () => {
    const { bridge, ligar } = bancada()
    render(<App bridge={bridge} startupInvite={conviteDeArranque({ invite: { server: "casa.pt", channel: `!${"x".repeat(200_000)}:casa.pt`, code: CODIGO } })} />)
    await dentro()
    ligar()

    const corpo = (await screen.findByText(strings.invite.arrivedTitle)).closest("[role=dialog]") as HTMLElement
    expect(corpo.textContent?.length).toBeLessThan(800)
    expect(corpo.textContent).toContain("~xxx")
  })

  it("o servidor também é limpo antes de ser mostrado, no diálogo e no brinde", async () => {
    const { bridge, ligar } = bancada()
    render(<App bridge={bridge} startupInvite={conviteDeArranque({ invite: { server: `casa.pt\u202E%2Etp.${"y".repeat(500)}`, channel: "!x:y", code: CODIGO } })} />)
    await dentro()
    ligar()

    const corpo = (await screen.findByText(strings.invite.arrivedTitle)).closest("[role=dialog]") as HTMLElement
    expect(corpo.textContent).not.toContain("\u202E")
    expect(corpo.textContent?.length).toBeLessThan(800)
  })

  it("a frase diz que o nome pode ser falso, nas duas línguas", () => {
    expect(pt.invite.arrivedBody("X", "Y")).toMatch(/^Convite para "X", em Y/)
    expect(pt.invite.arrivedBody("X", "Y")).toContain("O nome pode ser falso")
    // `en` is partial by type (falls back to Portuguese); reads directly, and the
    // missing phrase has to be red and not an `undefined` that passes.
    const ingles = en.invite?.arrivedBody?.("X", "Y") ?? ""
    expect(ingles).toMatch(/^Invitation to "X", on Y/)
    expect(ingles).toContain("The name can be false")
  })

  it("se o canal que aparece não é o que o link dizia, isso é dito, uma vez", async () => {
    const user = userEvent.setup()
    const { bridge, ligar, canais } = bancada()
    render(<App bridge={bridge} startupInvite={conviteDeArranque()} />)
    await dentro()
    ligar()
    canais([FEED])
    await user.click(await screen.findByRole("button", { name: strings.invite.arrivedAccept }))

    // The link said "sala-nova"; the host puts them in "despejos-2026".
    canais([FEED, "!despejos-2026:casa.pt"])
    expect(await screen.findByText(strings.invite.arrivedMismatch("despejos-2026", "sala-nova"))).toBeTruthy()

    canais([FEED, "!despejos-2026:casa.pt", "!mais-um:casa.pt"])
    expect(screen.getAllByText(/despejos-2026/).filter((no) => no.textContent?.includes("sala-nova"))).toHaveLength(1)
    expect(screen.queryByText(strings.invite.arrivedMismatch("mais-um", "sala-nova"))).toBeNull()
  })

  it("a quem acabou de criar conta, o primeiro evento de canais é o que traz o canal: o aviso sai na mesma", async () => {
    // No channel events before the request (what happens to a new account):
    // the snapshot has to be taken when the request goes out, not depend on a
    // prior event that never happened. Caught live.
    const user = userEvent.setup()
    const { bridge, ligar, canais } = bancada()
    render(<App bridge={bridge} startupInvite={conviteDeArranque()} />)
    await dentro()
    ligar()
    await user.click(await screen.findByRole("button", { name: strings.invite.arrivedAccept }))
    canais([FEED, "!despejos-2026:casa.pt"])
    expect(await screen.findByText(strings.invite.arrivedMismatch("despejos-2026", "sala-nova"))).toBeTruthy()
  })

  it("sem pedido por link à espera, um canal novo não acende aviso nenhum", async () => {
    const { bridge, ligar, canais } = bancada()
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    canais([FEED])
    canais([FEED, "!despejos-2026:casa.pt"])
    expect(screen.queryByText(/o nome que ele dizia/)).toBeNull()
  })

  it("um link que não se deixou ler é dito no portão e cá dentro, e arruma-se", async () => {
    const { bridge, redeem } = bancada()
    const convite = conviteDeArranque({ invite: null, invalid: true })
    render(<App bridge={bridge} startupInvite={convite} />)
    await dentro()

    expect(await screen.findByText(strings.invite.gateInvalid)).toBeTruthy()
    expect(convite.forget).toHaveBeenCalled()
    expect(redeem).not.toHaveBeenCalled()
  })
})

/** The account deletion sheet, open at the gate: type the password and press the button. */
async function apagarComAPalavra(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const folha = await screen.findByRole("alertdialog", { name: strings.settings.destroyTitle })
  await user.type(within(folha).getByLabelText(strings.settings.destroyConfirmLabel), strings.settings.destroyConfirmWord)
  await user.click(within(folha).getByRole("button", { name: strings.settings.destroyConfirm }))
}

describe("apagar a conta leva o convite atrás", () => {
  it("no portão: quem perdeu a palavra-passe e recomeça não herda o convite", async () => {
    const user = userEvent.setup()
    const destroy = vi.fn(async () => ({ ok: true }))
    const { bridge } = bancada({ cofre: "pede-palavra", destroy })
    const convite = conviteDeArranque()
    render(<App bridge={bridge} startupInvite={convite} />)
    expect(await screen.findByText(strings.invite.gateWaiting)).toBeTruthy()

    // The gate makes a silent attempt before showing the footer: we wait for it.
    await user.click(await screen.findByRole("button", { name: strings.gate.lostAccountAction }))
    await apagarComAPalavra(user)

    await waitFor(() => expect(destroy).toHaveBeenCalledOnce())
    await waitFor(() => expect(convite.forget).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByText(strings.invite.gateWaiting)).toBeNull())
  })

  it("se apagar falha, a conta fica de pé e o convite com ela", async () => {
    const user = userEvent.setup()
    const destroy = vi.fn(async () => {
      throw new Error("could not reach the homeserver")
    })
    const { bridge } = bancada({ cofre: "pede-palavra", destroy })
    const convite = conviteDeArranque()
    render(<App bridge={bridge} startupInvite={convite} />)
    await screen.findByText(strings.invite.gateWaiting)

    // The gate makes a silent attempt before showing the footer: we wait for it.
    await user.click(await screen.findByRole("button", { name: strings.gate.lostAccountAction }))
    await apagarComAPalavra(user)

    await waitFor(() => expect(destroy).toHaveBeenCalledOnce())
    expect(convite.forget).not.toHaveBeenCalled()
    expect(screen.getByText(strings.invite.gateWaiting)).toBeTruthy()
  })

  it("bloquear não lhe toca: quem desbloqueia é a mesma pessoa", async () => {
    const user = userEvent.setup()
    const { bridge, ligar } = bancada()
    const lock = vi.spyOn(bridge.vault, "lock")
    const convite = conviteDeArranque()
    render(<App bridge={bridge} startupInvite={convite} />)
    await dentro()

    await user.click(screen.getByRole("button", { name: strings.rail.settings }))
    // "Block now" lives in Account, which is the section that opens first.
    await user.click(await screen.findByRole("button", { name: strings.settings.lockNow }))
    await waitFor(() => expect(lock).toHaveBeenCalledOnce())

    // The `Shell` restarted, the vault unlocked by itself again, and the invite
    // still waits for whoever opened it.
    await dentro()
    ligar()
    expect(await screen.findByText(strings.invite.arrivedTitle)).toBeTruthy()
    expect(convite.forget).not.toHaveBeenCalled()
  })
})

/** Paste a link in "Enter with a link" and confirm. */
async function colar(link: string, opcoes: Parameters<typeof bancada>[0] = {}): Promise<Bancada> {
  const user = userEvent.setup()
  const b = bancada(opcoes)
  render(<App bridge={b.bridge} />)
  await dentro()
  await user.click(await screen.findByRole("button", { name: strings.rail.chat }))
  await user.click(await screen.findByRole("button", { name: strings.sidebar.joinWithLink }))
  await user.type(await screen.findByPlaceholderText(strings.prompts.joinPlaceholder), link)
  await user.click(screen.getByRole("button", { name: strings.prompts.confirm }))
  return b
}

describe("Entrar com um link, colado", () => {

  it("o https novo entra", async () => {
    const { redeem } = await colar(formatInviteLink("casa.pt", CANAL, CODIGO))
    expect(redeem).toHaveBeenCalledExactlyOnceWith(formatInviteLink("casa.pt", CANAL, CODIGO))
  })

  it("o enclave:// antigo continua a entrar, pelo mesmo caminho", async () => {
    const { redeem, canais } = await colar(`enclave://join/casa.pt/${encodeURIComponent(CANAL)}#${CODIGO}`)
    expect(redeem).toHaveBeenCalledExactlyOnceWith(formatInviteLink("casa.pt", CANAL, CODIGO))
    canais([FEED, CANAL])
    expect(await screen.findByText(strings.chat.joined("sala-nova"))).toBeTruthy()
  })

  it("de outro servidor não se redime, e a janela fica aberta para se perceber porquê", async () => {
    const { redeem } = await colar(formatInviteLink("outro.pt", "!x:outro.pt", CODIGO))
    expect(redeem).not.toHaveBeenCalled()
    expect(await screen.findByText(strings.invite.otherServer("outro.pt", "casa.pt"))).toBeTruthy()
    expect(screen.getByRole("heading", { name: strings.prompts.joinTitle })).toBeTruthy()
  })

  it("com o código na query não é um link nosso", async () => {
    const { redeem } = await colar(`https://casa.pt/app/convite?k=${CODIGO}#${encodeURIComponent(CANAL)}/${CODIGO}`)
    expect(redeem).not.toHaveBeenCalled()
    expect(await screen.findByText(strings.prompts.joinInvalid)).toBeTruthy()
  })
})

describe('a ligação curta de convite (1.0 "Arca", fatia 5b-2)', () => {
  it("no portão, a curta também diz que há um convite à espera, e não pergunta nada ao servidor", async () => {
    const { bridge, resolve } = bancada({ cofre: "pede-palavra" })
    render(<App bridge={bridge} startupInvite={conviteDeArranque({ invite: null, curta: CURTA })} />)
    expect(await screen.findByText(strings.invite.gateWaiting)).toBeTruthy()
    expect(resolve).not.toHaveBeenCalled()
  })

  it("lá dentro e ligado, resolve a curta, pergunta com o canal, e Entrar redime a longa", async () => {
    const user = userEvent.setup()
    const { bridge, redeem, resolve, ligar, canais } = bancada()
    const convite = conviteDeArranque({ invite: null, curta: CURTA })
    render(<App bridge={bridge} startupInvite={convite} />)
    await dentro()
    expect(resolve).not.toHaveBeenCalled()
    ligar()

    expect(await screen.findByText(strings.invite.arrivedTitle)).toBeTruthy()
    expect(resolve).toHaveBeenCalledExactlyOnceWith(CURTA)
    expect(screen.getByText(strings.invite.arrivedBody("sala-nova", "casa.pt"))).toBeTruthy()
    expect(redeem).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: strings.invite.arrivedAccept }))
    expect(redeem).toHaveBeenCalledExactlyOnceWith(LONGA_DA_CURTA)
    expect(convite.forget).toHaveBeenCalledOnce()
    canais([FEED, CANAL])
    expect(await screen.findByText(strings.chat.joined("sala-nova"))).toBeTruthy()
  })

  it("uma curta com o código trocado diz a frase e arruma-se, sem pedido nenhum", async () => {
    const { bridge, redeem, ligar } = bancada({
      resolve: async () => {
        throw new Error("this invite link is wrong")
      },
    })
    const convite = conviteDeArranque({ invite: null, curta: CURTA })
    render(<App bridge={bridge} startupInvite={convite} />)
    await dentro()
    ligar()

    expect(await screen.findByText(/Esta ligação está errada\. Pede uma nova a quem te convidou\./)).toBeTruthy()
    await waitFor(() => expect(convite.forget).toHaveBeenCalledOnce())
    expect(screen.queryByText(strings.invite.arrivedTitle)).toBeNull()
    expect(redeem).not.toHaveBeenCalled()
  })

  it("uma curta de outro servidor não se pergunta ao nosso", async () => {
    const { bridge, resolve, ligar } = bancada()
    const convite = conviteDeArranque({ invite: null, curta: formatShortInviteLink("outro.pt", "ab23cd45", CODIGO_NOVO) })
    render(<App bridge={bridge} startupInvite={convite} />)
    await dentro()
    ligar()
    expect(await screen.findByText(strings.invite.otherServer("outro.pt", "casa.pt"))).toBeTruthy()
    expect(resolve).not.toHaveBeenCalled()
    await waitFor(() => expect(convite.forget).toHaveBeenCalledOnce())
  })

  it("colada, resolve-se e redime a longa", async () => {
    const { redeem, resolve } = await colar(CURTA)
    await waitFor(() => expect(redeem).toHaveBeenCalledExactlyOnceWith(LONGA_DA_CURTA))
    expect(resolve).toHaveBeenCalledExactlyOnceWith(CURTA)
    await waitFor(() => expect(screen.queryByRole("heading", { name: strings.prompts.joinTitle })).toBeNull())
  })

  it("colada com o código trocado: a frase, a janela aberta, e nenhum pedido", async () => {
    const { redeem } = await colar(CURTA, {
      resolve: async () => {
        throw new Error("this invite link is wrong")
      },
    })
    expect(await screen.findByText(/Esta ligação está errada\./)).toBeTruthy()
    expect(redeem).not.toHaveBeenCalled()
    expect(screen.getByRole("heading", { name: strings.prompts.joinTitle })).toBeTruthy()
  })

  it('colada com o tecto do servidor cheio: "Espera um minuto", com o número do erro', async () => {
    const { redeem } = await colar(CURTA, {
      resolve: async () => {
        throw new Error("too many invite lookups")
      },
    })
    expect(await screen.findByText(/Espera um minuto e tenta outra vez\./)).toBeTruthy()
    expect(screen.getByText(/Erro 359/)).toBeTruthy()
    expect(redeem).not.toHaveBeenCalled()
  })

  it("colada de outro servidor não se pergunta ao nosso", async () => {
    const { resolve, redeem } = await colar(formatShortInviteLink("outro.pt", "ab23cd45", CODIGO_NOVO))
    expect(await screen.findByText(strings.invite.otherServer("outro.pt", "casa.pt"))).toBeTruthy()
    expect(resolve).not.toHaveBeenCalled()
    expect(redeem).not.toHaveBeenCalled()
  })
})

describe("as frases novas existem nas duas línguas, lidas de cada uma", () => {
  /*
    `en.ts` falls back to Portuguese silently when it lacks a sheet. So this
    reads `en` DIRECTLY and not via `strings`: a missing phrase must be a red
    test, not a half-translated security dialog.
  */
  const NOVAS = ["gateWaiting", "gateInvalid", "arrivedTitle", "arrivedNote", "arrivedAccept", "arrivedDecline", "linkCare", "desktopNote"] as const
  const NOVAS_COM_ARGUMENTOS = ["arrivedBody", "arrivedMismatch", "otherServer", "alreadyIn"] as const

  it.each(NOVAS)("invite.%s", (chave) => {
    const ingles = (en.invite as Record<string, unknown>)[chave]
    expect(typeof ingles).toBe("string")
    expect(ingles).not.toBe("")
    expect(ingles).not.toBe(pt.invite[chave])
  })

  it.each(NOVAS_COM_ARGUMENTOS)("invite.%s", (chave) => {
    const ingles = (en.invite as Record<string, unknown>)[chave] as ((a: string, b: string) => string) | undefined
    expect(typeof ingles).toBe("function")
    const frase = ingles?.("canal-x", "servidor-y") ?? ""
    expect(frase).toContain("canal-x")
    expect(frase).not.toBe((pt.invite[chave] as (a: string, b: string) => string)("canal-x", "servidor-y"))
  })

  it("o exemplo do campo é a ligação curta, nas duas, e não diz o nome do protocolo", () => {
    for (const lingua of [pt, en]) {
      const exemplo = (lingua.prompts as { joinPlaceholder?: string }).joinPlaceholder
      // The form copied today (slice 5c): `/c#…`, not the long one.
      expect(exemplo).toMatch(/^https:\/\/[^/]+\/c#/)
      expect(exemplo?.toLowerCase()).not.toContain("enclave")
    }
  })
})

describe('o nome do canal na pergunta do convite (1.0 "Arca", fatia 5c)', () => {
  /** An opaque address from 1.0: it doesn't say the name of anything. */
  const OPACA = moradaDeSala(parseServerName("casa.pt"))
  const LONGA_OPACA = formatInviteLink("casa.pt", OPACA, CODIGO_NOVO)
  const pedacoDaMorada = OPACA.slice(1, 12)

  async function corpoDaPergunta(): Promise<HTMLElement> {
    return (await screen.findByText(strings.invite.arrivedTitle)).closest("[role=dialog]") as HTMLElement
  }

  it("com selo, diz o nome do canal e o de quem convida, e nunca a morada", async () => {
    const nome = vi.fn(async () => ({ canal: "Clube de Leitura", quem: "Ana" }))
    const { bridge, ligar, redeem } = bancada({ nome })
    render(<App bridge={bridge} startupInvite={conviteDeArranque({ invite: { server: "casa.pt", channel: OPACA, code: CODIGO_NOVO } })} />)
    await dentro()
    ligar()

    const corpo = await corpoDaPergunta()
    expect(corpo.textContent).toContain(strings.invite.arrivedBody("Clube de Leitura", "casa.pt", "Ana"))
    expect(corpo.textContent).not.toContain(pedacoDaMorada)
    // We ask for the long canonical form once, and asking doesn't redeem anything.
    expect(nome).toHaveBeenCalledExactlyOnceWith(LONGA_OPACA)
    expect(redeem).not.toHaveBeenCalled()
  })

  it('sem selo que abra, diz "um canal", e não a morada', async () => {
    const { bridge, ligar } = bancada({ nome: async () => null })
    render(<App bridge={bridge} startupInvite={conviteDeArranque({ invite: { server: "casa.pt", channel: OPACA, code: CODIGO_NOVO } })} />)
    await dentro()
    ligar()

    const corpo = await corpoDaPergunta()
    expect(corpo.textContent).toContain(strings.invite.arrivedBodyUnnamed("casa.pt"))
    expect(corpo.textContent).not.toContain(pedacoDaMorada)
  })

  it('uma ponte que falha ou não tem `nome` também dá "um canal", e a pergunta abre na mesma', async () => {
    for (const opcoes of [{ nome: async () => Promise.reject(new Error("x")) }, {}]) {
      const { bridge, ligar } = bancada(opcoes)
      render(<App bridge={bridge} startupInvite={conviteDeArranque({ invite: { server: "casa.pt", channel: OPACA, code: CODIGO_NOVO } })} />)
      await dentro()
      ligar()
      expect((await corpoDaPergunta()).textContent).toContain(strings.invite.arrivedBodyUnnamed("casa.pt"))
      cleanup()
    }
  })

  it("uma morada com nome (de antes da 1.0) e sem selo continua a dizer o nome dela", async () => {
    const { bridge, ligar } = bancada({ nome: async () => null })
    render(<App bridge={bridge} startupInvite={conviteDeArranque()} />)
    await dentro()
    ligar()
    expect((await corpoDaPergunta()).textContent).toContain(strings.invite.arrivedBody("sala-nova", "casa.pt"))
  })

  it("a ligação curta: resolvida, a pergunta diz o nome do selo", async () => {
    const nome = vi.fn(async () => ({ canal: "Geral" }))
    const { bridge, ligar } = bancada({ resolve: async () => LONGA_OPACA, nome })
    render(<App bridge={bridge} startupInvite={conviteDeArranque({ invite: null, curta: CURTA })} />)
    await dentro()
    ligar()

    const corpo = await corpoDaPergunta()
    expect(corpo.textContent).toContain(strings.invite.arrivedBody("Geral", "casa.pt"))
    expect(corpo.textContent).not.toContain(pedacoDaMorada)
    expect(nome).toHaveBeenCalledExactlyOnceWith(LONGA_OPACA)
  })

  it("o nome do selo também é limpo: sem marcas de direcção e com tecto", async () => {
    const { bridge, ligar } = bancada({ nome: async () => ({ canal: `\u202Elareg${"x".repeat(5000)}`, quem: "\u202EanA" }) })
    render(<App bridge={bridge} startupInvite={conviteDeArranque({ invite: { server: "casa.pt", channel: OPACA, code: CODIGO_NOVO } })} />)
    await dentro()
    ligar()

    const corpo = await corpoDaPergunta()
    expect(corpo.textContent).not.toMatch(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/)
    expect(corpo.textContent?.length).toBeLessThan(800)
    expect(corpo.textContent).toContain("anA")
  })

  /** The screen text and labels: where an address would be seen. */
  function ecra(): string {
    const rotulos = [...document.querySelectorAll("[aria-label],[title]")].map(
      (el) => `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`,
    )
    return `${document.body.textContent ?? ""} ${rotulos.join(" ")}`
  }

  it("defeito A: à espera de entrar, a barra lateral diz o nome do selo, e nunca a morada", async () => {
    const user = userEvent.setup()
    const { bridge, ligar } = bancada({ nome: async () => ({ canal: "Clube de Leitura", quem: "Ana" }) })
    render(<App bridge={bridge} startupInvite={conviteDeArranque({ invite: { server: "casa.pt", channel: OPACA, code: CODIGO_NOVO } })} />)
    await dentro()
    ligar()
    await user.click(await screen.findByRole("button", { name: strings.invite.arrivedAccept }))

    expect(await screen.findByRole("button", { name: strings.sidebar.cancelarEspera("Clube de Leitura") })).toBeTruthy()
    expect(ecra()).not.toContain(pedacoDaMorada)
  })

  it('defeito A: sem selo nem nome publicado, a linha à espera diz "Canal do convite", e nunca a morada', async () => {
    const user = userEvent.setup()
    const { bridge, ligar } = bancada({ nome: async () => null })
    render(<App bridge={bridge} startupInvite={conviteDeArranque({ invite: { server: "casa.pt", channel: OPACA, code: CODIGO_NOVO } })} />)
    await dentro()
    ligar()
    await user.click(await screen.findByRole("button", { name: strings.invite.arrivedAccept }))

    expect(await screen.findByRole("button", { name: strings.sidebar.cancelarEsperaSemNome })).toBeTruthy()
    expect(ecra()).not.toContain(pedacoDaMorada)
  })

  it('defeito B: ao entrar, o aviso diz o nome do selo, ou "Entraste no canal.", e nunca a morada', async () => {
    for (const [selo, frase] of [
      [{ canal: "Clube de Leitura", quem: "Ana" }, strings.chat.joined("Clube de Leitura")],
      [null, strings.chat.joinedOpaco],
    ] as const) {
      const user = userEvent.setup()
      const { bridge, ligar, canais } = bancada({ nome: async () => selo })
      render(<App bridge={bridge} startupInvite={conviteDeArranque({ invite: { server: "casa.pt", channel: OPACA, code: CODIGO_NOVO } })} />)
      await dentro()
      ligar()
      await user.click(await screen.findByRole("button", { name: strings.invite.arrivedAccept }))

      canais([FEED, OPACA])
      expect(await screen.findByText(frase)).toBeTruthy()
      // The alert doesn't carry the address (the sidebar shows the channel that
      // arrived by address, because no one published the name here: not this test's concern).
      expect(screen.queryByText(new RegExp(`Entraste em .*${pedacoDaMorada}`))).toBeNull()
      cleanup()
    }
  })

  it("as frases sem nome da espera e da entrada, nas duas línguas", () => {
    expect(pt.chat.joinedOpaco).toBe("Entraste no canal.")
    expect(en.chat?.joinedOpaco).toBe("You joined the channel.")
    expect(pt.sidebar.canalDoConvite).toBe("Canal do convite")
    expect(en.sidebar?.canalDoConvite).toBe("Channel from the invite")
  })

  it("a frase sem nome, nas duas línguas, e com o nome de quem convida", () => {
    expect(pt.invite.arrivedBodyUnnamed("Y")).toMatch(/^Convite para um canal, em Y\./)
    const ingles = en.invite?.arrivedBodyUnnamed?.("Y") ?? ""
    expect(ingles).toMatch(/^Invitation to a channel, on Y\./)
    expect(pt.invite.arrivedBody("X", "Y", "Ana")).toMatch(/^Convite de Ana para "X", em Y\./)
    expect(en.invite?.arrivedBody?.("X", "Y", "Ana") ?? "").toMatch(/^Invitation from Ana to "X", on Y\./)
  })
})

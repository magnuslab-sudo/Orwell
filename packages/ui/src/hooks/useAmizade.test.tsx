import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react"
import type { FriendTie } from "@enclave/protocol"
import type { EnclaveBridge } from "../bridge.js"
import type { Friendships } from "../lib/friendship.js"
import { strings } from "../strings.js"
import { estadoDaAmizade, useAmizade } from "./useAmizade.js"
import { ConfirmarProvider } from "./useConfirmar.js"
import { moradaDeTeste } from "../../testes/moradas.js"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const ANA = "@ana:s"
const EU = "@eu:s"
const DM = moradaDeTeste("directa ana eu", "s")

function laco(over: Partial<FriendTie>): FriendTie {
  return { peer: ANA, channel: DM, link: "nenhum", at: 1, severed: false, ...over }
}

function dobra(...ties: FriendTie[]): Friendships {
  return { open: [], sent: [], severed: new Set(), ties: new Map(ties.map((tie) => [tie.peer, tie])) }
}

function ponte(): {
  bridge: EnclaveBridge
  social: {
    openDirect: ReturnType<typeof vi.fn>
    friendRequest: ReturnType<typeof vi.fn>
    acceptFriend: ReturnType<typeof vi.fn>
    declineFriend: ReturnType<typeof vi.fn>
    unfriend: ReturnType<typeof vi.fn>
  }
} {
  const social = {
    openDirect: vi.fn(async () => DM),
    friendRequest: vi.fn(async () => ({ ok: true })),
    acceptFriend: vi.fn(async () => ({ ok: true })),
    declineFriend: vi.fn(async () => ({ ok: true })),
    unfriend: vi.fn(async () => ({ ok: true })),
  }
  return { bridge: { social } as unknown as EnclaveBridge, social }
}

function montar(friendships: Friendships, ligados: string[] = []) {
  const { bridge, social } = ponte()
  const aviso = vi.fn()
  const hook = renderHook(() =>
    useAmizade({
      bridge,
      friendships,
      aviso,
      nomeDe: () => "Ana",
      estaLigado: (who) => ligados.includes(who),
    }),
    // The undo question comes from `Confirmar` at home, which lives here.
    { wrapper: ConfirmarProvider },
  )
  return { hook, social, aviso }
}

describe("estadoDaAmizade", () => {
  it("lê os cinco estados do botão único", () => {
    expect(estadoDaAmizade(EU, EU, undefined, false)).toBe("eu")
    expect(estadoDaAmizade(ANA, EU, undefined, true)).toBe("amigos")
    expect(estadoDaAmizade(ANA, EU, laco({ link: "amigos" }), false)).toBe("amigos")
    expect(estadoDaAmizade(ANA, EU, laco({ link: "pedido-recebido" }), false)).toBe("pedido-recebido")
    // A cross request responds as received: accepting closes it on both sides.
    expect(estadoDaAmizade(ANA, EU, laco({ link: "cruzado" }), false)).toBe("pedido-recebido")
    expect(estadoDaAmizade(ANA, EU, laco({ link: "pedido-enviado" }), false)).toBe("pedido-enviado")
    expect(estadoDaAmizade(ANA, EU, undefined, false)).toBe("nenhum")
  })

  it("o laço vem primeiro: um pedido em pé nunca se lê como amizade", () => {
    // The cryptographic fact only counts when the link says nothing.
    expect(estadoDaAmizade(ANA, EU, laco({ link: "pedido-recebido" }), true)).toBe("pedido-recebido")
    expect(estadoDaAmizade(ANA, EU, laco({ link: "pedido-enviado" }), true)).toBe("pedido-enviado")
    // And a broken link does not become friendship again by the fact that still remains.
    expect(estadoDaAmizade(ANA, EU, laco({ link: "nenhum", severed: true }), true)).toBe("nenhum")
  })
})

describe("useAmizade: um caminho por gesto, o canal resolvido por dentro", () => {
  it("pedir sem laço abre a directa e pede por ela, com a nota", async () => {
    const { hook, social, aviso } = montar(dobra())
    act(() => {
      void hook.result.current.pedir(ANA, "  do lagar  ")
    })
    await waitFor(() => expect(social.friendRequest).toHaveBeenCalledWith(DM, "do lagar"))
    expect(social.openDirect).toHaveBeenCalledWith(ANA)
    expect(aviso).toHaveBeenCalledWith(strings.userMenu.friendSent)
  })

  it("pedir sem nota não manda nota vazia", async () => {
    const { hook, social } = montar(dobra())
    act(() => {
      void hook.result.current.pedir(ANA, "   ")
    })
    await waitFor(() => expect(social.friendRequest).toHaveBeenCalledWith(DM, undefined))
  })

  it("pedir também pára um duplo clique, e diz se o pedido saiu", async () => {
    const { hook, social } = montar(dobra())
    let primeiro: Promise<boolean> = Promise.resolve(false)
    let segundo: Promise<boolean> = Promise.resolve(true)
    act(() => {
      primeiro = hook.result.current.pedir(ANA)
      segundo = hook.result.current.pedir(ANA)
    })
    await expect(segundo).resolves.toBe(false)
    await expect(primeiro).resolves.toBe(true)
    expect(social.friendRequest).toHaveBeenCalledOnce()
  })

  it("pedir NUNCA vai por um canal partilhado: lá chegava a todos os membros", async () => {
    const { hook, social } = montar(dobra(laco({ channel: "!lagar:s", link: "nenhum" })))
    act(() => {
      void hook.result.current.pedir(ANA)
    })
    await waitFor(() => expect(social.friendRequest).toHaveBeenCalledOnce())
    expect(social.friendRequest.mock.calls[0]?.[0]).toBe(DM)
  })

  it("aceitar vai pelo canal onde a ligação falou, sem abrir directa nenhuma", async () => {
    const { hook, social, aviso } = montar(dobra(laco({ link: "pedido-recebido" })), [ANA])
    act(() => hook.result.current.aceitar(ANA))
    await waitFor(() => expect(social.acceptFriend).toHaveBeenCalledWith(DM, ANA))
    expect(social.openDirect).not.toHaveBeenCalled()
    await waitFor(() => expect(aviso).toHaveBeenCalledWith(strings.people.acceptedMutual("Ana")))
  })

  it("com quem pediu desligado, diz o que falta em vez de fingir que está feito", async () => {
    const { hook, aviso } = montar(dobra(laco({ link: "pedido-recebido" })))
    act(() => hook.result.current.aceitar(ANA))
    await waitFor(() => expect(aviso).toHaveBeenCalledWith(strings.people.acceptedPending("Ana")))
  })

  it("recusar fecha o pedido pelo mesmo canal", async () => {
    const { hook, social, aviso } = montar(dobra(laco({ link: "pedido-recebido" })))
    act(() => hook.result.current.recusar(ANA))
    await waitFor(() => expect(social.declineFriend).toHaveBeenCalledWith(DM))
    expect(aviso).toHaveBeenCalledWith(strings.people.declined)
  })

  it("enquanto uma resposta corre, um segundo clique não manda nada", async () => {
    const { hook, social } = montar(dobra(laco({ link: "pedido-recebido" })))
    let soltar: () => void = () => {}
    social.acceptFriend.mockImplementation(
      () =>
        new Promise((resolver) => {
          soltar = () => resolver({ ok: true })
        }),
    )
    act(() => {
      hook.result.current.aceitar(ANA)
      // Accept and reject in the same instant is the race that this prevents.
      hook.result.current.recusar(ANA)
    })
    await waitFor(() => expect(hook.result.current.respondendo).toBe(ANA))
    expect(social.declineFriend).not.toHaveBeenCalled()
    await act(async () => soltar())
    await waitFor(() => expect(hook.result.current.respondendo).toBeNull())
    expect(social.acceptFriend).toHaveBeenCalledOnce()
  })

  it("desfazer pergunta antes, e sem sim não faz nada", async () => {
    const { hook, social } = montar(dobra(laco({ link: "amigos" })))
    act(() => hook.result.current.desfazer(ANA))
    const primeira = await screen.findByRole("alertdialog", { name: strings.people.unfriendTitle("Ana") })
    fireEvent.click(within(primeira).getByRole("button", { name: strings.confirmar.cancelar }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(social.unfriend).not.toHaveBeenCalled()

    act(() => hook.result.current.desfazer(ANA))
    const segunda = await screen.findByRole("alertdialog", { name: strings.people.unfriendTitle("Ana") })
    fireEvent.click(within(segunda).getByRole("button", { name: strings.people.unfriend }))
    await waitFor(() => expect(social.unfriend).toHaveBeenCalledWith(ANA))
  })

  it("uma falha diz-se, e não se engole", async () => {
    const { hook, social, aviso } = montar(dobra(laco({ link: "pedido-recebido" })))
    social.acceptFriend.mockRejectedValue(new Error("boom"))
    act(() => hook.result.current.aceitar(ANA))
    await waitFor(() => expect(aviso).toHaveBeenCalledWith(expect.any(String), "error"))
    expect(hook.result.current.respondendo).toBeNull()
  })
})

describe("useAmizade — cancelar, bloquear e desbloquear", () => {
  function montarComBloqueio(friendships: Friendships) {
    const { bridge, social } = ponte()
    const extra = {
      cancelFriendRequest: vi.fn(async () => ({ ok: true })),
      block: vi.fn(async () => ({ ok: true })),
      unblock: vi.fn(async () => ({ ok: true })),
      blocked: vi.fn(async () => [{ address: "@rui:s", at: 1 }]),
    }
    Object.assign(social, extra)
    const aviso = vi.fn()
    const hook = renderHook(
      () => useAmizade({ bridge, friendships, aviso, nomeDe: () => "Ana", estaLigado: () => false }),
      { wrapper: ConfirmarProvider },
    )
    return { hook, social: { ...social, ...extra }, aviso }
  }

  it("cancelar chama a ponte com quem, sem perguntar, e avisa", async () => {
    const { hook, social, aviso } = montarComBloqueio(dobra(laco({ link: "pedido-enviado" })))
    expect(hook.result.current.podeCancelar).toBe(true)
    act(() => hook.result.current.cancelar(ANA))
    await waitFor(() => expect(social.cancelFriendRequest).toHaveBeenCalledWith(ANA))
    await waitFor(() => expect(aviso).toHaveBeenCalledWith(strings.people.cancelled))
  })

  it("lê os bloqueados da ponte ao montar", async () => {
    const { hook } = montarComBloqueio(dobra())
    await waitFor(() => expect(hook.result.current.estaBloqueado("@rui:s")).toBe(true))
    expect(hook.result.current.bloqueados).toEqual([{ address: "@rui:s", at: 1 }])
  })

  it("bloquear pergunta com o verbo destrutivo, e só bloqueia depois do sim", async () => {
    const { hook, social } = montarComBloqueio(dobra())
    act(() => hook.result.current.bloquear(ANA))
    const pergunta = await screen.findByRole("alertdialog", { name: strings.people.blockTitle("Ana") })
    expect(within(pergunta).getByText(strings.people.blockBody)).toBeTruthy()
    expect(social.block).not.toHaveBeenCalled()
    fireEvent.click(within(pergunta).getByRole("button", { name: strings.people.block }))
    await waitFor(() => expect(social.block).toHaveBeenCalledWith(ANA))
    // And re-read the list: the bridge is the truth.
    await waitFor(() => expect(social.blocked).toHaveBeenCalledTimes(2))
  })

  it("desbloquear não pergunta", async () => {
    const { hook, social } = montarComBloqueio(dobra())
    act(() => hook.result.current.desbloquear("@rui:s"))
    await waitFor(() => expect(social.unblock).toHaveBeenCalledWith("@rui:s"))
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("sem as portas na ponte, não se oferece nada", () => {
    const { hook } = montar(dobra())
    expect(hook.result.current.podeBloquear).toBe(false)
    expect(hook.result.current.podeCancelar).toBe(false)
  })
})

describe("useAmizade — a lista de bloqueados que falha", () => {
  it("uma leitura que falha tenta outra vez, e a lista chega", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { bridge, social } = ponte()
      let vezes = 0
      Object.assign(social, {
        block: vi.fn(async () => ({ ok: true })),
        unblock: vi.fn(async () => ({ ok: true })),
        blocked: vi.fn(async () => {
          vezes += 1
          if (vezes === 1) throw new Error("cofre a abrir")
          return [{ address: "@rui:s", at: 1 }]
        }),
      })
      const hook = renderHook(
        () => useAmizade({ bridge, friendships: dobra(), aviso: vi.fn(), nomeDe: () => "Ana", estaLigado: () => false }),
        { wrapper: ConfirmarProvider },
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3500)
      })
      await waitFor(() => expect(hook.result.current.estaBloqueado("@rui:s")).toBe(true))
      expect(vezes).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("useAmizade — cancelar optimista", () => {
  it("depois de cancelar, o laço conta como cancelado até chegar um pedido novo", async () => {
    const tie = laco({ link: "pedido-enviado", at: 5 })
    const { bridge, social } = ponte()
    Object.assign(social, { cancelFriendRequest: vi.fn(async () => ({ ok: true })) })
    const hook = renderHook(
      () => useAmizade({ bridge, friendships: dobra(tie), aviso: vi.fn(), nomeDe: () => "Ana", estaLigado: () => false }),
      { wrapper: ConfirmarProvider },
    )
    expect(hook.result.current.cancelouJa(tie)).toBe(false)
    act(() => hook.result.current.cancelar(ANA))
    await waitFor(() => expect(hook.result.current.cancelouJa(tie)).toBe(true))
    // A new request has another `at`: the count starts again.
    expect(hook.result.current.cancelouJa(laco({ link: "pedido-enviado", at: 9 }))).toBe(false)
  })
})

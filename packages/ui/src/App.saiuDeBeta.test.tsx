import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

afterEach(cleanup)

/**
 * The gate with a beta vault (1.0 "Arca", slice 5b-1).
 *
 * The rest of the bridge is from `App.bloqueio.test.tsx`, just for the shell
 * to mount; what is measured is the vault. The `status` reads the state of
 * `disco`, for `destroy` to change it the way the real disk changes: Setup asks
 * again if there is a vault, and must hear there is not.
 */
function ponteDoCofre(versao: "beta" | "orwv2" | undefined) {
  const disco = { existe: true }
  const vault = {
    status: vi.fn(async () => ({
      exists: disco.existe,
      supportsOsProtection: true,
      ...(disco.existe && versao ? { versao } : {}),
    })),
    // A vault that asks for a password: the silent attempt fails, and
    // `Unlock` shows the field. In a beta vault this can never happen.
    unlock: vi.fn(async (): Promise<{ ok: boolean }> => {
      throw new Error("wrong passphrase")
    }),
    create: vi.fn(async () => ({ ok: true })),
    lock: vi.fn(async () => ({ ok: true })),
    export: vi.fn(async () => ({ data: "" })),
    import: vi.fn(async () => ({ ok: true })),
    destroy: vi.fn(async () => {
      disco.existe = false
      return { ok: true }
    }),
  }
  const nada = async () => ({ ok: true })
  const bridge = {
    vault,
    identity: {
      load: vi.fn(async () => ({ address: "@eu:casa.pt", accountId: "eu" })),
      create: vi.fn(async () => ({ address: "@eu:casa.pt", accountId: "eu" })),
    },
    session: { connect: nada, capabilities: async () => ["mls"], setVisible: nada },
    channels: {
      list: async () => [],
      create: nada,
      invite: nada,
      channelInvites: async () => [],
      acceptChannelInvite: nada,
      declineChannelInvite: nada,
      send: nada,
      typing: nada,
      buzz: nada,
      members: async () => [],
      history: async () => [],
      forget: nada,
      safetyNumber: async () => null,
    },
    invites: { create: async () => "x", redeem: nada, list: async () => [], revoke: nada },
    social: {
      post: nada,
      acceptFollower: nada,
      acceptFriend: nada,
      declineFriend: nada,
      unfriend: nada,
      repairInvite: async () => ({ invited: true }),
      deadWelcomes: async () => [],
      deafChannels: async () => [],
      feedChannel: async () => MURAL_EU,
    },
    profile: { get: async () => ({ displayName: "Vera", donations: [] }), set: nada, directory: async () => ({}) },
    notifications: { list: async () => [], save: nada },
    on: {
      message: () => () => {},
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
  return { bridge, vault }
}

/** Lets the startup promises run (`status` and the silent attempt, if there were one). */
async function assentar(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

describe("o portão com um cofre do beta", () => {
  it('mostra "O Orwell saiu de beta.", sem campo de palavra-passe, e nunca tenta desbloquear', async () => {
    const { bridge, vault } = ponteDoCofre("beta")
    render(<App bridge={bridge} />)
    expect(await screen.findByRole("heading", { name: strings.saiuDeBeta.titulo })).toBeTruthy()
    await assentar()
    expect(screen.getByText(strings.saiuDeBeta.texto)).toBeTruthy()
    expect(document.querySelector('input[type="password"]')).toBeNull()
    expect(screen.queryByRole("heading", { name: strings.gate.unlockTitle })).toBeNull()
    // Neither the silent attempt from `Unlock`, nor an export: the vault does not open.
    expect(vault.unlock).not.toHaveBeenCalled()
    expect(vault.export).not.toHaveBeenCalled()
    expect(vault.destroy).not.toHaveBeenCalled()
  })

  it('"Criar conta nova" apaga o cofre e abre o Setup, sem nunca o abrir', async () => {
    const { bridge, vault } = ponteDoCofre("beta")
    render(<App bridge={bridge} />)
    const botao = await screen.findByRole("button", { name: strings.saiuDeBeta.criarContaNova })
    await userEvent.setup().click(botao)
    // The new Setup, from the first question.
    expect(await screen.findByRole("heading", { name: strings.gate.outroAparelhoPergunta })).toBeTruthy()
    expect(vault.destroy).toHaveBeenCalledTimes(1)
    expect(vault.unlock).not.toHaveBeenCalled()
    // Fresh setup, not the warning about "there is already a vault on this device".
    expect(screen.queryByText(strings.gate.vaultExists)).toBeNull()
  })

  it('se o apagar falhar, o portão mostra o erro com "Tentar outra vez"', async () => {
    const { bridge, vault } = ponteDoCofre("beta")
    vault.destroy.mockRejectedValueOnce(new Error("disco preso"))
    render(<App bridge={bridge} />)
    await userEvent.setup().click(await screen.findByRole("button", { name: strings.saiuDeBeta.criarContaNova }))
    expect(await screen.findByText(strings.errors.boot)).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.common.retry })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: strings.gate.outroAparelhoPergunta })).toBeNull()
    expect(vault.unlock).not.toHaveBeenCalled()
  })

  it("com um cofre da 1.0 (orwv2) o portão é o de sempre", async () => {
    const { bridge } = ponteDoCofre("orwv2")
    render(<App bridge={bridge} />)
    expect(await screen.findByRole("heading", { name: strings.gate.unlockTitle })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: strings.saiuDeBeta.titulo })).toBeNull()
  })

  it("uma ponte que não diz a `versao` dá o portão de sempre", async () => {
    const { bridge } = ponteDoCofre(undefined)
    render(<App bridge={bridge} />)
    expect(await screen.findByRole("heading", { name: strings.gate.unlockTitle })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: strings.saiuDeBeta.titulo })).toBeNull()
  })
})

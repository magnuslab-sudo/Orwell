import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge, Sucessao } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")
const DM_ANA_EU = moradaDeTeste("directa ana eu", "casa.pt")

afterEach(cleanup)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const BRUNO = "@bruno:casa.pt"
const DORA = "@dora:casa.pt"
const CANAL = "!lagar:casa.pt"

/**
 * "Merge accounts" (phase 8.2), from the side of whoever receives the notice.
 *
 * Ana became Dora. This screen is for someone who was Ana's friend and can
 * invite in the channel where she was: Ana leaves the member list, and the
 * bell offers, once, "Add?" and "Invite?". Nothing happens without the tap.
 */

interface Espioes {
  mapa: Record<string, Sucessao>
  adicionar: ReturnType<typeof vi.fn>
  convidar: ReturnType<typeof vi.fn>
  marcar: ReturnType<typeof vi.fn>
}

function ponte(emitRef: { current: ((message: unknown) => void) | null }, espioes: Espioes): EnclaveBridge {
  const opcoes: { souFundador?: boolean; cargos?: never[]; poderes?: Record<string, string[]>; apelidos?: Record<string, string> } = {
    souFundador: true,
  }
  const cargosDe: Record<string, string[]> = {}
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
      send: async () => ({ ok: true }),
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [EU, ANA, BRUNO],
      mayInvite: () => true,
      history: async () => [],
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      rooms: () => [],
      meta: () => null,
      setMeta: async () => ({ ok: true }),
      mayEdit: () => true,
      founder: () => (opcoes.souFundador ? EU : "@dona:casa.pt"),
      admins: () => [],
      roles: () => opcoes.cargos ?? [],
      rolesFor: (_canal: string, quem: string) => cargosDe[quem] ?? [],
      setRoles: async () => ({ ok: true }),
      defineRole: async () => ({ ok: true }),
      deleteRole: async () => ({ ok: true }),
      mayManageRoles: () => opcoes.souFundador === true,
      mayModerate: (_canal: string, quem: string) => opcoes.poderes?.[quem]?.includes("moderar") ?? false,
      nicknames: () => opcoes.apelidos ?? {},
      setNickname: async () => ({ ok: true }),
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
      sucessoes: async () => espioes.mapa,
      adicionarSucessora: espioes.adicionar,
      convidarSucessora: espioes.convidar,
      marcarSucessao: espioes.marcar,
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => ({
        [ANA]: { displayName: "Ana", donations: [] },
        [BRUNO]: { displayName: "Bruno", donations: [] },
        [DORA]: { displayName: "Dora", donations: [] },
      }),
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    on: {
      message: (handler: (message: unknown) => void) => {
        emitRef.current = handler
        return () => {
          emitRef.current = null
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
      sucessoes: () => () => {},
    },
    call: { on: () => () => {}, setMuted: () => {} },
  } as unknown as EnclaveBridge
}


async function abrir(): Promise<{ user: ReturnType<typeof userEvent.setup>; espioes: Espioes }> {
  const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
  const espioes: Espioes = {
    mapa: { [ANA]: { para: DORA, at: 1, seq: 4, canais: [DM_ANA_EU, CANAL], eraAmigo: true, feitos: [] } },
    adicionar: vi.fn(async () => ({ ok: true })),
    convidar: vi.fn(async () => ({ ok: true })),
    marcar: vi.fn(async () => ({ ok: true })),
  }
  const user = userEvent.setup()
  render(<App bridge={ponte(emitRef, espioes)} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  await user.click(screen.getByRole("button", { name: strings.rail.chat }))
  // The names arrive through profiles, like on the network.
  for (const [seq, [quem, nome]] of ([[ANA, "Ana"], [BRUNO, "Bruno"], [DORA, "Dora"]] as const).entries()) {
    await act(async () => {
      emitRef.current?.({ channel: CANAL, seq: seq + 1, sender: quem, payload: { t: "profile", displayName: nome, updatedAt: 1 } })
      await Promise.resolve()
    })
  }
  return { user, espioes }
}

describe("fase 8.2: quem recebe o aviso de sucessão", () => {
  it("a Ana sai da lista de membros, e o Bruno fica", async () => {
    await abrir()
    const lista = document.querySelector(".member-list") as HTMLElement
    expect(await within(lista).findByText("Bruno")).toBeTruthy()
    expect(within(lista).queryByText("Ana")).toBeNull()
  })

  it('o sino oferece "Adicionar?" e "Convidar?", e cada toque vai à ponte', async () => {
    const { user, espioes } = await abrir()
    const sino = await screen.findByRole("button", { name: strings.notifCenter.bellWithCount(2) })
    await user.click(sino)
    const painel = await screen.findByRole("dialog", { name: strings.notifCenter.title })
    expect(within(painel).getAllByText(strings.notifCenter.sucessao("Ana", "Dora"))).toHaveLength(2)
    expect(within(painel).getByText(strings.notifCenter.sucessaoAdicionar("Dora"))).toBeTruthy()
    await user.click(within(painel).getByRole("button", { name: strings.notifCenter.adicionar }))
    expect(espioes.adicionar).toHaveBeenCalledWith(ANA)
    await user.click(within(painel).getByRole("button", { name: strings.notifCenter.convidar }))
    await waitFor(() => expect(espioes.convidar).toHaveBeenCalledWith(ANA, CANAL))
  })

  it('"Agora não" fecha a oferta sem pedir nada a ninguém', async () => {
    const { user, espioes } = await abrir()
    await user.click(await screen.findByRole("button", { name: strings.notifCenter.bellWithCount(2) }))
    const painel = await screen.findByRole("dialog", { name: strings.notifCenter.title })
    await user.click(within(painel).getAllByRole("button", { name: strings.notifCenter.agoraNao })[0]!)
    expect(espioes.marcar).toHaveBeenCalledWith(ANA, "amigo")
    expect(espioes.adicionar).not.toHaveBeenCalled()
  })
})

import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

afterEach(cleanup)

const EU = "@eu:casa.pt"
const BRUNO = "@bruno:casa.pt"
const CANAL = "!lagar:casa.pt"

/**
 * Other people's profiles across the account's devices, on the UI side.
 * A sibling device reported a new name (account channel): the core saves it to
 * the directory and notifies (`on.perfis`). The new name appears without
 * reloading, because the UI re-reads the directory.
 */
function ponte(diretorio: { atual: Record<string, unknown> }, aviso: { atual: ((evento: { enderecos: string[] }) => void) | null }): EnclaveBridge {
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
      members: async () => [EU, BRUNO],
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
      sucessoes: async () => ({}),
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => structuredClone(diretorio.atual),
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
      callActivity: () => () => {},
      sucessoes: () => () => {},
      perfis: (handler: (evento: { enderecos: string[] }) => void) => {
        aviso.atual = handler
        return () => {
          aviso.atual = null
        }
      },
    },
    call: { on: () => () => {}, setMuted: () => {} },
  } as unknown as EnclaveBridge
}



describe("perfis entre aparelhos: a interface relê o diretório", () => {
  it("o nome que um aparelho irmão contou aparece na lista de membros sem recarregar", async () => {
    const diretorio = { atual: { [BRUNO]: { at: 1, payload: { t: "profile", displayName: "Bruno", donations: [], updatedAt: 1 } } } as Record<string, unknown> }
    const aviso: { atual: ((evento: { enderecos: string[] }) => void) | null } = { atual: null }
    const user = userEvent.setup()
    render(<App bridge={ponte(diretorio, aviso)} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    await user.click(screen.getByRole("button", { name: strings.rail.chat }))
    const lista = (await waitFor(() => {
      const elemento = document.querySelector(".member-list")
      if (!elemento) throw new Error("sem lista de membros")
      return elemento
    })) as HTMLElement
    expect(await within(lista).findByText("Bruno")).toBeTruthy()

    diretorio.atual = { [BRUNO]: { at: 2, payload: { t: "profile", displayName: "Bruno Silva", donations: [], updatedAt: 2 }, parcial: true } }
    await waitFor(() => expect(aviso.atual).not.toBeNull())
    await act(async () => {
      aviso.atual?.({ enderecos: [BRUNO] })
    })
    expect(await within(lista).findByText("Bruno Silva")).toBeTruthy()
  })
})

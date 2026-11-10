import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { StoredChatMessage } from "@enclave/client-core"
import type { EnclaveBridge, HistoricoDosIrmaos } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

afterEach(cleanup)

const EU = "@eu:casa.pt"
const BRUNO = "@bruno:casa.pt"
const CANAL = "!lagar:casa.pt"

/**
 * The history that comes from a sibling device (1.0 "Arca"), from the interface
 * side. The core merges it into the vault and notifies (`on.historico`) with the channels
 * that changed; the interface rereads them, shows old messages without
 * reloading, and the bar says how much is left.
 */
function ponte(
  historico: { atual: StoredChatMessage[] },
  aviso: { atual: ((evento: HistoricoDosIrmaos) => void) | null },
  agora: HistoricoDosIrmaos,
): EnclaveBridge {
  const diretorio = { atual: {} as Record<string, unknown> }
  const ouvintes = new Set<(evento: HistoricoDosIrmaos) => void>()
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
      history: async () => structuredClone(historico.atual),
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
      // Two subscriptions: the shell's (which rereads the channels) and the bar's.
      historico: (handler: (evento: HistoricoDosIrmaos) => void) => {
        ouvintes.add(handler)
        aviso.atual = (evento) => {
          for (const ouvinte of ouvintes) ouvinte(evento)
        }
        return () => {
          ouvintes.delete(handler)
        }
      },
    },
    sincronia: { estado: async () => [], lugarEm: async () => null, historico: async () => agora },
    call: { on: () => () => {}, setMuted: () => {} },
  } as unknown as EnclaveBridge
}



const mensagem = (seq: number, corpo: string): StoredChatMessage =>
  ({ seq, sender: BRUNO, at: seq, payload: { t: "message", id: `m${seq}`, sentAt: seq, body: corpo, attachments: [], mentions: [] } }) as StoredChatMessage

describe("o histórico entre aparelhos na interface", () => {
  it("a barra diz quanto falta, e as mensagens antigas aparecem sem recarregar", async () => {
    const historico = { atual: [mensagem(10, "a de agora")] }
    const aviso: { atual: ((evento: HistoricoDosIrmaos) => void) | null } = { atual: null }
    const inicio: HistoricoDosIrmaos = { aTrazer: true, feitas: 0, total: 1200, media: null, canais: [], inicial: true }
    const user = userEvent.setup()
    render(<App bridge={ponte(historico, aviso, inicio)} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    await user.click(screen.getByRole("button", { name: strings.rail.chat }))
    expect(await screen.findByText("a de agora")).toBeTruthy()
    expect(await screen.findByText(strings.sincronia.historico(0, 1200))).toBeTruthy()

    historico.atual = [mensagem(3, "a antiga"), mensagem(10, "a de agora")]
    await waitFor(() => expect(aviso.atual).not.toBeNull())
    await act(async () => {
      aviso.atual?.({ aTrazer: true, feitas: 340, total: 1200, media: null, canais: [CANAL], inicial: true })
    })
    expect(await screen.findByText("a antiga")).toBeTruthy()
    expect(screen.getByText(strings.sincronia.historico(340, 1200))).toBeTruthy()

    await act(async () => {
      aviso.atual?.({ aTrazer: false, feitas: 0, total: 0, media: null, canais: [], inicial: false })
    })
    await waitFor(() => expect(screen.queryByText(/A trazer/)).toBeNull())
  })
})

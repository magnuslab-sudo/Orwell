import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { compararCargos } from "@enclave/protocol"
import type { ChannelRole, EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

afterEach(cleanup)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const BRUNO = "@bruno:casa.pt"
const CANAL = "!lagar:casa.pt"

/**
 * The order of roles seen from the full screen (4/11/2026, owner request: "the
 * founder/admin should be able to reorder the order in which roles are
 * shown").
 *
 * The bridge acts as core: `roles` returns in channel order (`compararCargos`,
 * like `rolesOf`), and `reorderRoles` rewrites the `rank` and `position` like
 * `Session.reorderRoles`. "Another client" means changing the `rank` beneath the interface
 * and letting the message arrive, which is how a foreign `role.define` arrives.
 */

interface Estado {
  cargos: ChannelRole[]
  cargosDe: Record<string, string[]>
  souFundador: boolean
  permissoes: boolean
}

function ponte(estado: Estado, emitRef: { current: ((message: unknown) => void) | null }, ordenou: ReturnType<typeof vi.fn>): EnclaveBridge {
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
      history: async () => [],
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      rooms: () => [],
      meta: () => null,
      setMeta: async () => ({ ok: true }),
      mayEdit: () => true,
      founder: () => (estado.souFundador ? EU : "@dona:casa.pt"),
      admins: () => [],
      roles: () => [...estado.cargos].sort(compararCargos),
      rolesFor: (_canal: string, quem: string) => estado.cargosDe[quem] ?? [],
      setRoles: async () => ({ ok: true }),
      defineRole: async () => ({ ok: true }),
      deleteRole: async () => ({ ok: true }),
      reorderRoles: async (canal: string, ordem: string[]) => {
        ordenou(canal, ordem)
        estado.cargos = estado.cargos.map((cargo) => ({
          ...cargo,
          rank: ordem.length - ordem.indexOf(cargo.role),
          position: ordem.indexOf(cargo.role),
        }))
        return { ok: true }
      },
      // The founder manages; the "chief" (me, without founding) manages by delegation.
      mayManageRoles: () => true,
      ...(estado.permissoes
        ? {
            permissoes: {
              todos: () => ({ powers: [], definido: false }),
              em: () => [],
              mayManageRole: () => estado.souFundador,
              delegacao: () => true,
              sobreposicoes: () => [],
              maySetSobreposicoes: () => false,
              setSobreposicoes: async () => ({ ok: true }),
            },
          }
        : {}),
      nicknames: () => ({}),
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
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => ({
        [ANA]: { displayName: "Ana", donations: [] },
        [BRUNO]: { displayName: "Bruno", donations: [] },
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
    },
    call: { on: () => () => {}, setMuted: () => {} },
  } as unknown as EnclaveBridge
}

function estadoInicial(extra: Partial<Estado> = {}): Estado {
  return {
    cargos: [
      { role: "chefe", name: "Chefe", powers: [], rank: 2, position: 0 },
      { role: "guia", name: "Guia", powers: [], rank: 1, position: 1 },
    ],
    // Bruno got the Guide before the Chief: the sub-line follows the channel order, not the assignment order.
    cargosDe: { [ANA]: ["guia"], [BRUNO]: ["guia", "chefe"] },
    souFundador: true,
    permissoes: false,
    ...extra,
  }
}

async function abrir(estado: Estado): Promise<{
  user: ReturnType<typeof userEvent.setup>
  emitir: (message: unknown) => Promise<void>
  ordenou: ReturnType<typeof vi.fn>
}> {
  const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
  const ordenou = vi.fn()
  const user = userEvent.setup()
  render(<App bridge={ponte(estado, emitRef, ordenou)} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  await user.click(screen.getByRole("button", { name: strings.rail.chat }))
  let seq = 1
  const emitir = async (message: unknown): Promise<void> => {
    await act(async () => {
      emitRef.current?.(message)
      await Promise.resolve()
    })
  }
  // Ana and Bruno are writing now: they are here, and the list sorts them by role.
  for (const [quem, nome] of [[ANA, "Ana"], [BRUNO, "Bruno"]] as const) {
    await emitir({ channel: CANAL, seq: seq++, sender: quem, payload: { t: "profile", displayName: nome, updatedAt: 1 } })
    await emitir({ channel: CANAL, seq: seq++, sender: quem, payload: { t: "message", id: `m-${nome}`, sentAt: Date.now(), body: `olá de ${nome}` } })
  }
  return { user, emitir, ordenou }
}

const grupos = (): string[] =>
  [...document.querySelectorAll(".member-list .member-group:not(.offline) > .member-group-head")].map((h) => h.textContent ?? "")

async function abaCargos(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  const linha = document.querySelector(".channel-row") as HTMLElement
  await user.pointer({ keys: "[MouseRight]", target: linha })
  await user.click(await screen.findByText(strings.menu.properties))
  await user.click(await screen.findByRole("tab", { name: strings.roomProperties.seccoes.cargos }))
  return screen.getByRole("tabpanel", { name: strings.roomProperties.seccoes.cargos })
}

describe("a ordem dos cargos, do editor à lista de membros", () => {
  it("a lista de membros agrupa pela ordem do canal, e a sub-linha nomeia o cargo mais alto primeiro", async () => {
    await abrir(estadoInicial())
    await vi.waitFor(() => expect(grupos()).toEqual([strings.members.groupHeading("Chefe", 1), strings.members.groupHeading("Guia", 1)]))
    const bruno = [...document.querySelectorAll(".member-row")].find((linha) => linha.textContent?.includes("Bruno")) as HTMLElement
    expect(within(bruno).getByText("Chefe, Guia")).toBeTruthy()
  })

  it("o fundador desce o Chefe pelas setas: o núcleo recebe a ordem e a lista de membros reagrupa", async () => {
    const estado = estadoInicial()
    const { user, ordenou } = await abrir(estado)
    const painel = await abaCargos(user)
    await user.click(within(painel).getByRole("button", { name: strings.cargosEPermissoes.descer("Chefe") }))
    expect(ordenou).toHaveBeenCalledWith(CANAL, ["guia", "chefe"])
    expect(within(painel).getByRole("status").textContent).toBe(strings.cargosEPermissoes.posicaoNova("Chefe", 2, 2))
    await user.keyboard("{Escape}")
    await vi.waitFor(() => expect(grupos()).toEqual([strings.members.groupHeading("Guia", 2)]))
    const bruno = [...document.querySelectorAll(".member-row")].find((linha) => linha.textContent?.includes("Bruno")) as HTMLElement
    expect(within(bruno).getByText("Guia, Chefe")).toBeTruthy()
  })

  it("outro cliente: a ordem muda noutro aparelho, chega como mensagem, e a lista segue-a", async () => {
    const estado = estadoInicial({ cargosDe: { [ANA]: ["guia"], [BRUNO]: ["chefe"] } })
    const { emitir } = await abrir(estado)
    await vi.waitFor(() => expect(grupos()).toEqual([strings.members.groupHeading("Chefe", 1), strings.members.groupHeading("Guia", 1)]))
    // The `role.define` of whoever ordered it, already in this device's vault; the message is the notification.
    estado.cargos = [
      { role: "chefe", name: "Chefe", powers: [], rank: 1, position: 1 },
      { role: "guia", name: "Guia", powers: [], rank: 2, position: 0 },
    ]
    await emitir({ channel: CANAL, seq: 99, sender: "@dona:casa.pt", payload: { t: "message", id: "m-aviso", sentAt: Date.now(), body: "ordenei" } })
    await vi.waitFor(() => expect(grupos()).toEqual([strings.members.groupHeading("Guia", 1), strings.members.groupHeading("Chefe", 1)]))
  })

  it("com o modelo de permissões ao lado, o fundador vê UMA lista arrastável dos cargos", async () => {
    const { user } = await abrir(estadoInicial({ permissoes: true }))
    const painel = await abaCargos(user)
    expect(within(painel).getAllByRole("button", { name: strings.cargosEPermissoes.descer("Chefe") })).toHaveLength(1)
    expect(within(painel).queryByRole("heading", { name: strings.cargosEPermissoes.ordemTitulo })).toBeNull()
  })

  it("quem gere por delegação não ordena: sem setas, sem arrasto, e a ordem continua à vista", async () => {
    const { user } = await abrir(estadoInicial({ permissoes: true, souFundador: false }))
    const painel = await abaCargos(user)
    expect(within(painel).queryByRole("button", { name: strings.cargosEPermissoes.descer("Chefe") })).toBeNull()
    expect(painel.querySelector("[draggable='true']")).toBeNull()
    expect(within(painel).getByRole("heading", { name: strings.cargosEPermissoes.ordemTitulo })).toBeTruthy()
  })
})

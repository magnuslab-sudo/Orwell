import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

afterEach(cleanup)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const CANAL = "!lagar:casa.pt"

/** The message clock: fixed, so dates do not change during the run. */
const QUANDO = 1_700_000_000_000

/**
 * Phase 3 ("moderate"), seen from the screen.
 *
 * Measures what one person sees and what reaches the bridge. The real guard lives in
 * the core (`session.moderar.test.ts`) and in the folds (`dobras.test.ts`).
 */

interface Espioes {
  setRoles: ReturnType<typeof vi.fn>
  deleteMessage: ReturnType<typeof vi.fn>
  setNickname: ReturnType<typeof vi.fn>
}

interface Opcoes {
  /** The powers each person has on this channel. Absent means none. */
  poderes?: Record<string, string[]>
  souFundador?: boolean
  cargos?: { role: string; name: string; powers: string[] }[]
  cargosDe?: Record<string, string[]>
  apelidos?: Record<string, string>
}

function ponte(
  opcoes: Opcoes,
  emitRef: { current: ((message: unknown) => void) | null },
  espioes: Espioes,
): EnclaveBridge {
  const cargosDe = { ...(opcoes.cargosDe ?? {}) }
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
      members: async () => [EU, ANA],
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
      setRoles: async (canal: string, quem: string, papeis: string[]) => {
        espioes.setRoles(canal, quem, papeis)
        cargosDe[quem] = papeis
        return { ok: true }
      },
      defineRole: async () => ({ ok: true }),
      deleteRole: async () => ({ ok: true }),
      mayManageRoles: () => opcoes.souFundador === true,
      mayModerate: (_canal: string, quem: string) => opcoes.poderes?.[quem]?.includes("moderar") ?? false,
      nicknames: () => opcoes.apelidos ?? {},
      setNickname: async (canal: string, quem: string, apelido: string) => {
        espioes.setNickname(canal, quem, apelido)
        return { ok: true }
      },
      editMessage: async () => ({ ok: true }),
      deleteMessage: async (canal: string, alvo: string) => {
        espioes.deleteMessage(canal, alvo)
        return { ok: true }
      },
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
      directory: async () => ({ [ANA]: { displayName: "Ana", donations: [] } }),
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

async function abrir(opcoes: Opcoes): Promise<{
  user: ReturnType<typeof userEvent.setup>
  emitir: (message: unknown) => Promise<void>
  espioes: Espioes
}> {
  const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
  const espioes = { setRoles: vi.fn(), deleteMessage: vi.fn(), setNickname: vi.fn() }
  const user = userEvent.setup()
  render(<App bridge={ponte(opcoes, emitRef, espioes)} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  await user.click(screen.getByRole("button", { name: strings.rail.chat }))
  const emitir = async (message: unknown): Promise<void> => {
    await act(async () => {
      emitRef.current?.(message)
      await Promise.resolve()
    })
  }
  // Ana's name arrives via her profile, like on the network.
  await emitir({ channel: CANAL, seq: 1, sender: ANA, payload: { t: "profile", displayName: "Ana", updatedAt: 1 } })
  return { user, emitir, espioes }
}

describe('fase 3: o separador "Membros" do editor de cargos está ligado', () => {
  it("o fundador abre um cargo, vê os membros e dá-o à Ana", async () => {
    const { user, espioes } = await abrir({
      souFundador: true,
      cargos: [{ role: "administracao", name: "Administração", powers: ["moderar", "fixar"] }],
    })

    const linha = document.querySelector(".channel-row") as HTMLElement
    await user.pointer({ keys: "[MouseRight]", target: linha })
    await user.click(await screen.findByText(strings.menu.properties))
    // Since 3/11/2026 roles live in their own section. See `seccoesDoCanal.ts`.
    await user.click(await screen.findByRole("tab", { name: strings.roomProperties.seccoes.cargos }))

    await user.click(await screen.findByTitle(strings.roles.editTitle("Administração")))
    // The "Members" of the role, inside the panel: the sections column has another.
    await user.click(within(screen.getByRole("tabpanel", { name: strings.roomProperties.seccoes.cargos })).getByRole("tab", { name: strings.cargos.tabMembers }))
    // The gate to the profile is what you saw before the thread. Now you see the list.
    expect(screen.queryByText(strings.cargos.membersElsewhere)).toBeNull()

    await user.click(screen.getByText(strings.cargos.addMembers))
    await user.click(await screen.findByTitle(strings.cargos.addMemberTitle("Ana")))
    expect(espioes.setRoles).toHaveBeenCalledWith(CANAL, ANA, ["administracao"])
  })

  it("o fundador lê o aviso do cargo embutido", async () => {
    const { user } = await abrir({ souFundador: true, cargos: [] })
    const linha = document.querySelector(".channel-row") as HTMLElement
    await user.pointer({ keys: "[MouseRight]", target: linha })
    await user.click(await screen.findByText(strings.menu.properties))
    // Only the founder reads it: `souFundador` now reaches the editor.
    expect(await screen.findByText(strings.cargos.adminWarning)).toBeTruthy()
  })
})

const BRUNO = "@bruno:casa.pt"

describe("fase 3: eliminar mensagens por moderação", () => {
  it("quem modera elimina a mensagem da Ana, depois do aviso", async () => {
    const { user, emitir, espioes } = await abrir({ poderes: { [EU]: ["moderar"] } })
    await emitir({
      channel: CANAL,
      seq: 2,
      sender: ANA,
      payload: { t: "message", id: "m-ana-1", sentAt: QUANDO, body: "uma frase feia" },
    })
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("uma frase feia") })
    await user.click(await screen.findByText(strings.chat.messageModerate))
    const aviso = await screen.findByRole("alertdialog", { name: strings.chat.messageModerateTitle("Ana") })
    expect(within(aviso).getByText(strings.chat.messageModerateConfirm)).toBeTruthy()
    await user.click(within(aviso).getByRole("button", { name: strings.chat.messageModerate }))
    expect(espioes.deleteMessage).toHaveBeenCalledWith(CANAL, "m-ana-1")
  })

  it("sem o poder, a mensagem de outra pessoa não oferece eliminar", async () => {
    const { user, emitir } = await abrir({})
    await emitir({
      channel: CANAL,
      seq: 2,
      sender: ANA,
      payload: { t: "message", id: "m-ana-1", sentAt: QUANDO, body: "uma frase feia" },
    })
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("uma frase feia") })
    await screen.findByText(strings.chat.copyText)
    expect(screen.queryByText(strings.chat.messageModerate)).toBeNull()
  })

  it("a lápide de quem modera esconde o texto e deixa a linha; a de quem não modera não conta", async () => {
    const { emitir } = await abrir({ poderes: { [BRUNO]: ["moderar"] } })
    await emitir({ channel: CANAL, seq: 2, sender: ANA, payload: { t: "message", id: "m-a", sentAt: QUANDO, body: "primeira" } })
    await emitir({ channel: CANAL, seq: 3, sender: ANA, payload: { t: "message", id: "m-b", sentAt: QUANDO + 1, body: "segunda" } })
    await emitir({ channel: CANAL, seq: 4, sender: BRUNO, payload: { t: "redact", id: "r-1", target: "m-a", redactedAt: QUANDO + 2 } })
    await emitir({ channel: CANAL, seq: 5, sender: EU, payload: { t: "redact", id: "r-2", target: "m-b", redactedAt: QUANDO + 3 } })

    expect(screen.queryByText("primeira")).toBeNull()
    expect(await screen.findByText(strings.chat.messageModerated)).toBeTruthy()
    // My report over Ana's message does not count: I do not moderate.
    expect(screen.getByText("segunda")).toBeTruthy()
  })
})

describe("fase 3: apelidos por canal", () => {
  it("o apelido aparece à frente do nome, na mensagem e na lista de membros", async () => {
    const { emitir } = await abrir({ apelidos: { [ANA]: "Aninhas" } })
    await emitir({ channel: CANAL, seq: 2, sender: ANA, payload: { t: "message", id: "m-ana-01", sentAt: QUANDO, body: "bom dia" } })
    const linha = (await screen.findByText("bom dia")).closest("article") as HTMLElement
    expect(within(linha).getByText("Aninhas")).toBeTruthy()
    expect(within(linha).getByText("Ana")).toBeTruthy()
    const lista = document.querySelector(".member-list") as HTMLElement
    expect(await within(lista).findByText("Aninhas")).toBeTruthy()
  })

  it("quem modera muda o apelido da Ana pelo menu da pessoa", async () => {
    const { user, espioes } = await abrir({ poderes: { [EU]: ["moderar"] } })
    const lista = document.querySelector(".member-list") as HTMLElement
    await user.pointer({ keys: "[MouseRight]", target: await within(lista).findByText("Ana") })
    await user.click(await screen.findByText(strings.userMenu.nickname))
    const campo = await screen.findByLabelText(strings.userMenu.nicknameLabel)
    await user.type(campo, "Ana R.")
    await user.keyboard("{Enter}")
    expect(espioes.setNickname).toHaveBeenCalledWith(CANAL, ANA, "Ana R.")
  })
})

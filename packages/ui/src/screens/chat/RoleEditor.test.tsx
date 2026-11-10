import { PODERES_CUMPRIDOS, ROLE_COLOURS, type Power } from "@enclave/protocol"

/** The editor offers the permissions this version honors (1.2), not the full `POWERS` vocabulary. */
const POWERS = PODERES_CUMPRIDOS
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { strings } from "../../strings.js"
import { RoleEditor } from "./RoleEditor.js"

afterEach(cleanup)

const noop = (): void => {}

/**
 * No bridge. Members, when the test wants them, come in as a prop: whoever mounts
 * the sheet reads them from the core (`rolesFor`) and saves them (`setRoles`).
 */
function editor(overrides: Partial<React.ComponentProps<typeof RoleEditor>> = {}): React.JSX.Element {
  return <RoleEditor roles={[]} onCreateRole={noop} onEditRole={noop} onDeleteRole={noop} {...overrides} />
}

const papeis = [
  { role: "moderador", name: "Moderador", powers: ["expulsar", "renomear"] as const },
  { role: "convidado", name: "Convidado", powers: [] as const },
].map((papel) => ({ ...papel, powers: [...papel.powers] }))

type Utilizador = ReturnType<typeof userEvent.setup>

/** Go to a role tab, by the name that appears. */
async function irPara(user: Utilizador, nome: string): Promise<void> {
  await user.click(screen.getByRole("tab", { name: nome }))
}

/** The permission group, by subject. By attribute: "Members" is also the name of a tab. */
function grupo(container: HTMLElement, qual: string): HTMLElement {
  const encontrado = container.querySelector<HTMLElement>(`[data-grupo="${qual}"]`)
  if (!encontrado) throw new Error(`sem o grupo ${qual}`)
  return encontrado
}

/**
 * The distinction this editor exists to make, on the list cards.
 *
 * Only `expulsar` has cryptographic weight: it removes the sheet from the MLS tree, advances
 * the epoch, and whoever leaves cannot read what comes next. The others are
 * convention that honest clients follow.
 */
describe("RoleEditor — a lista de cargos", () => {
  it("separa o que a cifra garante do que os clientes apenas combinam", () => {
    render(editor({ roles: papeis }))

    const moderador = screen.getByText("Moderador").closest("li")
    expect(moderador?.textContent).toContain("Garantido: expulsar")
    expect(moderador?.textContent).toContain("Regra da app: mudar o nome")
    expect(moderador?.textContent).not.toContain("Regra da app: expulsar")
  })

  it("um cargo sem responsabilidades diz que só dá acesso, e não promete gestão", () => {
    render(editor({ roles: papeis }))

    const convidado = screen.getByText("Convidado").closest("li")
    expect(convidado?.textContent).toContain("Só acesso ao canal")
    expect(convidado?.textContent).not.toContain("Garantido")
    expect(convidado?.textContent).not.toContain("Regra da app")
  })

  it("a nota sobre o que a cifra garante fica sempre, mesmo sem cargos nenhuns", () => {
    render(editor({ roles: [] }))
    expect(screen.getByText(/Quem é expulso deixa de ler o canal/)).toBeTruthy()
  })

  it("acabar com o canal não se lê na mesma frase que mudar o nome", () => {
    const arquivista = [{ role: "arquivista", name: "Arquivista", powers: ["eliminar", "renomear"] as Power[] }]
    render(editor({ roles: arquivista }))

    const cartao = screen.getByText("Arquivista").closest("li")
    expect(cartao?.textContent).toContain("Definitivo: acabar com o canal.")
    expect(cartao?.textContent).toContain("Regra da app: mudar o nome.")
    expect(cartao?.textContent).not.toContain("Regra da app: acabar com o canal")
  })

  it("e o rodapé diz as duas coisas: o que a cifra garante, e o que não tem volta", () => {
    render(editor({ roles: papeis }))

    expect(screen.getByText(/Quem é expulso deixa de ler o canal/)).toBeTruthy()
    expect(screen.getByText(/Acabar com o canal é definitivo/)).toBeTruthy()
  })

  /**
   * The built-in role, at the head of the list.
   *
   * The bridge does not bring it, but it exists in all channels and grants the most.
   * Without it, the list would lie about who can do what.
   */
  it("o cargo administrador aparece à cabeça, com tudo, mesmo que a ponte não o traga", () => {
    const { container } = render(editor({ roles: papeis }))

    const nomes = [...container.querySelectorAll(".role-card .role-name")].map((no) => no.textContent)
    expect(nomes[0]).toBe(strings.cargos.adminName)
    const admin = screen.getByText(strings.cargos.adminName).closest("li")
    expect(admin?.textContent).toContain("Garantido: expulsar")
    expect(admin?.textContent).toContain("acabar com o canal")
    // Cannot be deleted: only viewed.
    expect(screen.queryByTitle(strings.roles.deleteTitle(strings.cargos.adminName))).toBeNull()
  })

  it("o fundador lê o aviso do cargo administrador; os outros não", () => {
    const { unmount } = render(editor({ roles: papeis, souFundador: true }))
    expect(screen.getByText(strings.cargos.adminWarning)).toBeTruthy()
    unmount()

    render(editor({ roles: papeis }))
    expect(screen.queryByText(strings.cargos.adminWarning)).toBeNull()
  })
})

/**
 * The three tabs, the way Discord organizes a role (owner request, 27 October 2026).
 * They replace the form that ran below the list.
 */
describe("RoleEditor — os separadores do cargo aberto", () => {
  it("abrir um cargo mostra três separadores, e começa na Aparência", async () => {
    const user = userEvent.setup()
    render(editor({ roles: papeis }))
    await user.click(screen.getByTitle(strings.roles.editTitle("Moderador")))

    const separadores = screen.getAllByRole("tab")
    expect(separadores.map((cada) => cada.textContent)).toEqual(["Aparência", "Permissões", "Membros"])
    expect(screen.getByRole("tab", { name: "Aparência" }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("tabpanel").getAttribute("data-separador")).toBe("aparencia")
    expect(screen.getByLabelText(strings.roles.nameLabel)).toBeTruthy()
    // Permissions do not show up in this tab.
    expect(screen.queryAllByRole("switch")).toHaveLength(0)
  })

  it("cada separador mostra a sua parte, e só a sua", async () => {
    const user = userEvent.setup()
    render(editor({ roles: papeis }))
    await user.click(screen.getByTitle(strings.roles.editTitle("Moderador")))

    await irPara(user, "Permissões")
    expect(screen.getByRole("tab", { name: "Permissões" }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getAllByRole("switch").length).toBe(POWERS.length)
    expect(screen.queryByLabelText(strings.roles.nameLabel)).toBeNull()

    await irPara(user, "Membros")
    expect(screen.queryAllByRole("switch")).toHaveLength(0)
    expect(screen.getByText(strings.cargos.membersElsewhere)).toBeTruthy()
  })

  it("as setas do teclado mudam de separador, e o foco vai com elas", async () => {
    const user = userEvent.setup()
    render(editor({ roles: papeis }))
    await user.click(screen.getByTitle(strings.roles.editTitle("Moderador")))

    screen.getByRole("tab", { name: "Aparência" }).focus()
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("tab", { name: "Permissões" }).getAttribute("aria-selected")).toBe("true")
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Permissões" }))
    await user.keyboard("{ArrowLeft}{ArrowLeft}")
    expect(screen.getByRole("tab", { name: "Membros" }).getAttribute("aria-selected")).toBe("true")
  })

  it("o que se muda num separador não se perde ao ir a outro", async () => {
    const user = userEvent.setup()
    const onEditRole = vi.fn()
    render(editor({ roles: papeis, onEditRole }))
    await user.click(screen.getByTitle(strings.roles.editTitle("Moderador")))

    const nome = screen.getByLabelText(strings.roles.nameLabel)
    await user.clear(nome)
    await user.type(nome, "Guarda")
    await irPara(user, "Permissões")
    await user.click(screen.getByRole("switch", { name: "convidar" }))
    await irPara(user, "Aparência")
    expect((screen.getByLabelText(strings.roles.nameLabel) as HTMLInputElement).value).toBe("Guarda")

    await user.click(screen.getByText("Guardar"))
    expect(onEditRole).toHaveBeenCalledWith("moderador", "Guarda", ["expulsar", "convidar", "renomear"], undefined)
  })

  it("aberto um cargo, a lista encolhe para o lado e marca o que está aberto", async () => {
    const user = userEvent.setup()
    render(editor({ roles: papeis }))
    await user.click(screen.getByTitle(strings.roles.editTitle("Moderador")))

    const lista = screen.getByRole("navigation", { name: strings.cargos.listLabel })
    const moderador = within(lista).getByText("Moderador").closest("button")
    expect(moderador?.getAttribute("aria-current")).toBe("true")
    // Another role opens from the list, no going back.
    await user.click(within(lista).getByText("Convidado"))
    expect(within(lista).getByText("Convidado").closest("button")?.getAttribute("aria-current")).toBe("true")
    expect((screen.getByLabelText(strings.roles.nameLabel) as HTMLInputElement).value).toBe("Convidado")
  })
})

/**
 * The color of a role, in the Appearance tab.
 *
 * Color comes from a closed palette because the label ends in a sub-line of
 * 11px on dark background. What these tests keep is what the palette does not
 * solve alone: that the choice reads as words and not just dots, that
 * "no color" stays a choice, and that the preview shows what the member
 * list will show.
 */
describe("RoleEditor — a cor do cargo", () => {
  it("cada cor diz o nome por extenso: aqui a informação é a cor", async () => {
    const user = userEvent.setup()
    render(editor({ roles: [] }))
    await user.click(screen.getByText(strings.roles.add))

    for (const cor of ROLE_COLOURS) {
      expect(screen.getByText(strings.roles.colourNames[cor] ?? cor)).toBeTruthy()
    }
  })

  it("sem cor é uma escolha na fila, e é a que vem marcada de origem", async () => {
    const user = userEvent.setup()
    render(editor({ roles: [] }))
    await user.click(screen.getByText(strings.roles.add))

    const semCor = screen.getByText(strings.roles.colourNone)
    expect(semCor.getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByTitle("Cor Menta").getAttribute("aria-pressed")).toBe("false")
  })

  it("um cargo criado com cor leva-a; a cor pinta o nome e não o substitui", async () => {
    const user = userEvent.setup()
    const onCreateRole = vi.fn()
    render(editor({ roles: [], onCreateRole }))

    await user.click(screen.getByText(strings.roles.add))
    await user.type(screen.getByLabelText(strings.roles.nameLabel), "Guarda")
    await user.click(screen.getByTitle("Cor Menta"))
    await user.click(screen.getByText(strings.roles.create))

    expect(onCreateRole).toHaveBeenCalledWith("Guarda", [], "menta")
  })

  /**
   * The preview uses the classes from the member list, so it colors itself
   * by the same variable: the group header and the person's sub-line.
   */
  it("a pré-visualização mostra o nome pintado como na lista de membros", async () => {
    const user = userEvent.setup()
    const { container } = render(editor({ roles: [] }))
    await user.click(screen.getByText(strings.roles.add))
    await user.type(screen.getByLabelText(strings.roles.nameLabel), "Guarda")

    const amostra = container.querySelector(".cargos-amostra-lista")
    const sub = amostra?.querySelector(".member-sub.member-role")
    const cabeca = amostra?.querySelector(".member-group-head")
    expect(sub?.textContent).toBe("Guarda")
    expect(cabeca?.textContent).toBe(strings.members.groupHeading("Guarda", 1))
    expect(amostra?.querySelector(".member-name")?.textContent).toBe(strings.cargos.previewPerson)
    // No color, no variable: falls back to the list's default color.
    expect(sub?.getAttribute("style")).toBeNull()

    await user.click(screen.getByTitle("Cor Menta"))
    expect(sub?.getAttribute("style")).toContain("--role-tint")
    expect(cabeca?.getAttribute("style")).toContain("--role-tint")
  })

  it("na lista, a cor entra por variável e o nome continua a ser o nome", () => {
    const { container } = render(
      editor({
        roles: [
          { role: "guarda", name: "Guarda", powers: [], colour: "menta" },
          { role: "convidado", name: "Convidado", powers: [] },
        ],
      }),
    )

    const nomes = [...container.querySelectorAll(".role-name")]
    const guarda = nomes.find((no) => no.textContent === "Guarda")
    const convidado = nomes.find((no) => no.textContent === "Convidado")
    expect(guarda?.getAttribute("style")).toContain("--role-tint")
    expect(convidado?.getAttribute("style")).toBeNull()
  })

  it("uma cor que esta versão não conhece lê-se como ausência de cor", () => {
    const { container } = render(editor({ roles: [{ role: "chefe", name: "Chefe", powers: [], colour: "cobalto" }] }))
    const nome = [...container.querySelectorAll(".role-name")].find((no) => no.textContent === "Chefe")
    expect(nome).toBeTruthy()
    expect(nome?.getAttribute("style")).toBeNull()
  })
})

/**
 * Permissions, broken down into toggles (owner request: "permissions must be broken down
 * so they can be assigned to roles").
 *
 * Groups are from Discord, with the cipher one at the top and its mark. The
 * "no undo" nature becomes a mark in the delete row.
 */
describe("RoleEditor — as permissões", () => {
  it("os grupos cobrem as responsabilidades todas, e nenhuma aparece em dois", async () => {
    const user = userEvent.setup()
    render(editor({ roles: [] }))
    await user.click(screen.getByText(strings.roles.add))
    await irPara(user, "Permissões")

    const nomes = screen.getAllByRole("switch").map((cada) => cada.closest(".role-power")?.getAttribute("data-poder"))
    expect(new Set(nomes).size).toBe(nomes.length)
    for (const poder of POWERS) expect(nomes).toContain(poder)
  })

  it("a cifra à cabeça com a sua marca, e o resto por assunto, como no Discord", async () => {
    const user = userEvent.setup()
    const { container } = render(editor({ roles: [] }))
    await user.click(screen.getByText(strings.roles.add))
    await irPara(user, "Permissões")

    const legendas = [...container.querySelectorAll(".cargos-grupo legend")].map((no) => no.textContent)
    expect(legendas).toEqual(["Garantido", "Gerir canal", "Membros", "Mensagens", "Voz"])

    const cifra = grupo(container, "cifra")
    expect(cifra.className).toContain("sealed")
    expect(cifra.textContent).toContain("expulsar")
    expect(cifra.textContent).not.toContain("convidar")
    expect(cifra.textContent).toContain(strings.roles.sealedNote)

    expect(grupo(container, "gerir").textContent).toContain("mudar o nome")
    expect(grupo(container, "gerir").textContent).toContain("acabar com o canal")
    expect(grupo(container, "membros").textContent).toContain("convidar")
    expect(grupo(container, "membros").textContent).not.toContain("expulsar")
    expect(grupo(container, "mensagens").textContent).toContain("fixar mensagens")
    expect(grupo(container, "mensagens").textContent).toContain("atender tickets")
    expect(grupo(container, "mensagens").textContent).toContain("moderar")
    expect(grupo(container, "voz").textContent).toContain("mover")
  })

  it("cada responsabilidade diz numa frase o que dá", async () => {
    const user = userEvent.setup()
    const { container } = render(editor({ roles: [] }))
    await user.click(screen.getByText(strings.roles.add))
    await irPara(user, "Permissões")

    for (const poder of POWERS) {
      const linha = container.querySelector(`[data-poder="${poder}"]`)
      expect(linha?.querySelector(".cargo-poder-frase")?.textContent).toBe(strings.cargos.powerHelp[poder])
    }
  })

  /**
   * The three checkboxes by nature gave way to groups by subject, and
   * "end the channel" sits next to "change the name". The mark in the row is what
   * keeps the two from reading as the same thing.
   */
  it("acabar com o canal leva a marca de definitivo; mudar o nome não", async () => {
    const user = userEvent.setup()
    const { container } = render(editor({ roles: [] }))
    await user.click(screen.getByText(strings.roles.add))
    await irPara(user, "Permissões")

    const eliminar = container.querySelector('[data-poder="eliminar"]')
    const renomear = container.querySelector('[data-poder="renomear"]')
    expect(eliminar?.className).toContain("final")
    expect(eliminar?.querySelector(".cargo-marca")?.textContent).toBe(strings.roles.irreversibleGroup)
    expect(renomear?.className).not.toContain("final")
    expect(renomear?.querySelector(".cargo-marca")).toBeNull()
  })

  it("fixar mensagens é uma responsabilidade que se dá a um cargo, e é combinada", async () => {
    const user = userEvent.setup()
    const onCreateRole = vi.fn()
    const { container } = render(editor({ roles: [], onCreateRole }))

    await user.click(screen.getByText(strings.roles.add))
    await user.type(screen.getByLabelText(strings.roles.nameLabel), "Avisos")
    await irPara(user, "Permissões")
    expect(grupo(container, "cifra").textContent).not.toContain("fixar")
    await user.click(screen.getByRole("switch", { name: "fixar mensagens" }))
    await user.click(screen.getByText(strings.roles.create))

    expect(onCreateRole).toHaveBeenCalledWith("Avisos", ["fixar"], undefined)
  })

  it("o cargo administrador mostra tudo ligado, e nada se muda", async () => {
    const user = userEvent.setup()
    render(editor({ roles: papeis, souFundador: true }))
    await user.click(screen.getByTitle(strings.cargos.openTitle(strings.cargos.adminName)))
    await irPara(user, "Permissões")

    const interruptores = screen.getAllByRole("switch")
    expect(interruptores).toHaveLength(POWERS.length)
    for (const cada of interruptores) {
      expect(cada.getAttribute("aria-checked")).toBe("true")
      expect((cada as HTMLButtonElement).disabled).toBe(true)
    }
    expect(screen.getByText(strings.cargos.adminWarning)).toBeTruthy()
    // Store the name and color (2/11/2026), but cannot delete.
    expect(screen.queryByTitle(strings.roles.deleteTitle(strings.cargos.adminName))).toBeNull()
  })
})

/**
 * Role names can change (2/11/2026, owner request: "the founder must be able
 * to change the role name"): in place, in the list, and also the built-in role,
 * which was read-only until now.
 */
describe("RoleEditor — mudar o nome de um cargo", () => {
  it('na lista, "Mudar o nome" troca o nome por um campo, e Enter guarda com o resto igual', async () => {
    const user = userEvent.setup()
    const onEditRole = vi.fn()
    render(editor({ roles: [{ role: "guarda", name: "Guarda", powers: ["fixar"], colour: "menta" }], onEditRole }))

    await user.click(screen.getByTitle(strings.roles.renameTitle("Guarda")))
    const campo = screen.getByLabelText(strings.roles.renameLabel("Guarda"))
    await user.clear(campo)
    await user.type(campo, "Vigia{Enter}")

    expect(onEditRole).toHaveBeenCalledWith("guarda", "Vigia", ["fixar"], "menta")
    expect(screen.queryByLabelText(strings.roles.renameLabel("Guarda"))).toBeNull()
  })

  it("Escape desiste, e um nome vazio ou igual não se guarda", async () => {
    const user = userEvent.setup()
    const onEditRole = vi.fn()
    render(editor({ roles: [{ role: "guarda", name: "Guarda", powers: [] }], onEditRole }))

    await user.click(screen.getByTitle(strings.roles.renameTitle("Guarda")))
    await user.type(screen.getByLabelText(strings.roles.renameLabel("Guarda")), " novo{Escape}")
    await user.click(screen.getByTitle(strings.roles.renameTitle("Guarda")))
    await user.clear(screen.getByLabelText(strings.roles.renameLabel("Guarda")))
    await user.keyboard("{Enter}")
    await user.click(screen.getByTitle(strings.roles.renameTitle("Guarda")))
    await user.keyboard("{Enter}")

    expect(onEditRole).not.toHaveBeenCalled()
  })

  it("o Enter do campo não submete o formulário à volta (as propriedades do canal)", async () => {
    const user = userEvent.setup()
    const submeter = vi.fn((evento: React.FormEvent) => evento.preventDefault())
    render(
      <form onSubmit={submeter}>
        {editor({ roles: [{ role: "guarda", name: "Guarda", powers: [] }] })}
      </form>,
    )
    await user.click(screen.getByTitle(strings.roles.renameTitle("Guarda")))
    await user.type(screen.getByLabelText(strings.roles.renameLabel("Guarda")), "s{Enter}")
    expect(submeter).not.toHaveBeenCalled()
  })

  it("o cargo embutido muda de nome no sítio, e mostra o nome que já tem", async () => {
    const user = userEvent.setup()
    const onEditRole = vi.fn()
    render(editor({ admin: { name: "Guardiões", colour: "ambar" }, onEditRole }))
    expect(screen.getByText("Guardiões")).toBeTruthy()
    expect(screen.queryByText(strings.cargos.adminName)).toBeNull()

    await user.click(screen.getByTitle(strings.roles.renameTitle("Guardiões")))
    const campo = screen.getByLabelText(strings.roles.renameLabel("Guardiões"))
    await user.clear(campo)
    await user.type(campo, "Direcção{Enter}")
    expect(onEditRole).toHaveBeenCalledWith("admin", "Direcção", POWERS, "ambar")
  })
})

/**
 * The Members tab: who has this role.
 *
 * Since 27 October 2026 it replaces the rule "this screen does not say who has
 * the roles". The person's profile still grants and removes; here is the second
 * gate, through the same bridge. If the member list is not delivered, the tab
 * points to the profile instead of showing an empty list.
 */
describe("RoleEditor — os membros de um cargo", () => {
  const membros = [
    { address: "@ana:x", name: "Ana", roles: ["moderador"] },
    { address: "@rui:x", name: "Rui", roles: [] },
    { address: "@eva:x", name: "Eva", roles: ["convidado"] },
  ]

  it("sem a lista dos membros, aponta o perfil da pessoa", async () => {
    const user = userEvent.setup()
    render(editor({ roles: papeis }))
    // On the closed list, the usual message.
    expect(screen.getByText(strings.roles.assignElsewhere)).toBeTruthy()
    expect(screen.queryByRole("combobox")).toBeNull()

    await user.click(screen.getByTitle(strings.roles.editTitle("Moderador")))
    await irPara(user, "Membros")
    expect(screen.getByText(strings.cargos.membersElsewhere)).toBeTruthy()
  })

  it("sem cargos nenhuns não aponta caminho nenhum: não há o que dar", () => {
    render(editor({ roles: [] }))
    expect(screen.queryByText(strings.roles.assignElsewhere)).toBeNull()
  })

  it("um cargo por criar ainda não se dá a ninguém", async () => {
    const user = userEvent.setup()
    render(editor({ roles: [], membros, onSetMemberRole: noop }))
    await user.click(screen.getByText(strings.roles.add))
    await irPara(user, "Membros")
    expect(screen.getByText(strings.cargos.membersNew)).toBeTruthy()
  })

  it("mostra quem tem o cargo, e tirar chama a ponte com o endereço e o cargo", async () => {
    const user = userEvent.setup()
    const onSetMemberRole = vi.fn()
    render(editor({ roles: papeis, membros, onSetMemberRole }))
    await user.click(screen.getByTitle(strings.roles.editTitle("Moderador")))
    await irPara(user, "Membros")

    expect(screen.getByText(strings.cargos.membersCount(1))).toBeTruthy()
    const painel = screen.getByRole("tabpanel")
    expect(within(painel).getByText("Ana")).toBeTruthy()
    expect(within(painel).queryByText("Rui")).toBeNull()

    await user.click(screen.getByTitle(strings.cargos.removeMemberTitle("Ana")))
    expect(onSetMemberRole).toHaveBeenCalledWith("@ana:x", "moderador", false)
  })

  it("adicionar membros mostra quem ainda não o tem, e dá o cargo", async () => {
    const user = userEvent.setup()
    const onSetMemberRole = vi.fn()
    render(editor({ roles: papeis, membros, onSetMemberRole }))
    await user.click(screen.getByTitle(strings.roles.editTitle("Moderador")))
    await irPara(user, "Membros")

    await user.click(screen.getByText(strings.cargos.addMembers))
    expect(screen.getByTitle(strings.cargos.addMemberTitle("Rui"))).toBeTruthy()
    expect(screen.getByTitle(strings.cargos.addMemberTitle("Eva"))).toBeTruthy()
    expect(screen.queryByTitle(strings.cargos.addMemberTitle("Ana"))).toBeNull()

    await user.click(screen.getByTitle(strings.cargos.addMemberTitle("Rui")))
    expect(onSetMemberRole).toHaveBeenCalledWith("@rui:x", "moderador", true)
  })

  it("com a lista dos membros, a lista dos cargos mostra quantos tem cada um", async () => {
    const user = userEvent.setup()
    render(editor({ roles: papeis, membros, onSetMemberRole: noop }))
    await user.click(screen.getByTitle(strings.roles.editTitle("Moderador")))

    const lista = screen.getByRole("navigation", { name: strings.cargos.listLabel })
    expect(within(lista).getByText("Moderador").closest("button")?.querySelector(".cargos-item-conta")?.textContent).toBe("1")
  })

  it("o administrador nomeia-se no menu da pessoa, e não aqui", async () => {
    const user = userEvent.setup()
    render(editor({ roles: papeis, membros, onSetMemberRole: noop }))
    await user.click(screen.getByTitle(strings.cargos.openTitle(strings.cargos.adminName)))
    await irPara(user, "Membros")
    expect(screen.getByText(strings.cargos.membersAdmin)).toBeTruthy()
  })
})

describe("RoleEditor — criar e apagar cargos", () => {
  it("um cargo criado sem escolher nada é o cargo que dá só acesso", async () => {
    const user = userEvent.setup()
    const onCreateRole = vi.fn()
    render(editor({ roles: [], onCreateRole }))

    await user.click(screen.getByText(strings.roles.add))
    await user.type(screen.getByLabelText(strings.roles.nameLabel), "Convidado")
    await user.click(screen.getByText(strings.roles.create))

    expect(onCreateRole).toHaveBeenCalledWith("Convidado", [], undefined)
  })

  it("leva as responsabilidades escolhidas, e um cargo sem nome não se cria", async () => {
    const user = userEvent.setup()
    const onCreateRole = vi.fn()
    render(editor({ roles: [], onCreateRole }))

    await user.click(screen.getByText(strings.roles.add))
    await irPara(user, "Permissões")
    await user.click(screen.getByText(strings.roles.create))
    expect(onCreateRole).not.toHaveBeenCalled()
    // Go back to Appearance, where the name is missing.
    expect(screen.getByRole("tab", { name: "Aparência" }).getAttribute("aria-selected")).toBe("true")

    await user.type(screen.getByLabelText(strings.roles.nameLabel), "Moderador")
    await irPara(user, "Permissões")
    await user.click(screen.getByRole("switch", { name: "expulsar" }))
    await user.click(screen.getByRole("switch", { name: "mover" }))
    await user.click(screen.getByText(strings.roles.create))
    expect(onCreateRole).toHaveBeenCalledWith("Moderador", ["expulsar", "mover"], undefined)
  })

  it("apagar um cargo chama quem apaga, com o identificador e não com o nome", async () => {
    const user = userEvent.setup()
    const onDeleteRole = vi.fn()
    render(editor({ roles: [{ role: "moderador", name: "Moderador", powers: ["expulsar"] }], onDeleteRole }))

    await user.click(screen.getByTitle(strings.roles.deleteTitle("Moderador")))
    expect(onDeleteRole).toHaveBeenCalledWith("moderador")
  })

  it("apaga-se também de dentro do cargo aberto, e a folha volta à lista", async () => {
    const user = userEvent.setup()
    const onDeleteRole = vi.fn()
    render(editor({ roles: papeis, onDeleteRole }))

    await user.click(screen.getByTitle(strings.roles.editTitle("Moderador")))
    await user.click(screen.getByTitle(strings.roles.deleteTitle("Moderador")))
    expect(onDeleteRole).toHaveBeenCalledWith("moderador")
    expect(screen.queryAllByRole("tab")).toHaveLength(0)
  })

  /**
   * No button here can submit the form outside.
   *
   * This editor lives inside the properties sheet, which is a `<form>`. A button
   * without `type` inside a form is a submit button.
   */
  it("nenhum botão é de submeter, em nenhum separador", async () => {
    const user = userEvent.setup()
    const { container } = render(
      editor({ roles: [{ role: "moderador", name: "Moderador", powers: [] }], membros: [], onSetMemberRole: noop }),
    )
    const verificar = (): void => {
      for (const botao of container.querySelectorAll("button")) expect(botao.getAttribute("type")).toBe("button")
    }
    verificar()
    await user.click(screen.getByTitle(strings.roles.editTitle("Moderador")))
    for (const nome of ["Aparência", "Permissões", "Membros"]) {
      await irPara(user, nome)
      verificar()
    }
  })
})

/**
 * Edit an existing role.
 *
 * What cannot fail here: the ID does not change. It is what ties the role
 * to whoever has it.
 */
describe("RoleEditor — editar um cargo", () => {
  it("editar abre o cargo com o que ele já é", async () => {
    const user = userEvent.setup()
    render(editor({ roles: papeis }))

    await user.click(screen.getByTitle(strings.roles.editTitle("Moderador")))
    expect((screen.getByLabelText(strings.roles.nameLabel) as HTMLInputElement).value).toBe("Moderador")
    await irPara(user, "Permissões")
    expect(screen.getByRole("switch", { name: "expulsar" }).getAttribute("aria-checked")).toBe("true")
    expect(screen.getByRole("switch", { name: "convidar" }).getAttribute("aria-checked")).toBe("false")
  })

  it("guardar leva o identificador antigo, e nunca um novo", async () => {
    const user = userEvent.setup()
    const onEditRole = vi.fn()
    const onCreateRole = vi.fn()
    render(editor({ roles: papeis, onEditRole, onCreateRole }))

    await user.click(screen.getByTitle(strings.roles.editTitle("Moderador")))
    const nome = screen.getByLabelText(strings.roles.nameLabel)
    await user.clear(nome)
    await user.type(nome, "Guarda")
    await user.click(screen.getByText("Guardar"))

    expect(onEditRole).toHaveBeenCalledWith("moderador", "Guarda", ["expulsar", "renomear"], undefined)
    expect(onCreateRole).not.toHaveBeenCalled()
  })

  it("o cargo embutido admin muda o nome e a cor, e nunca as permissões", async () => {
    const user = userEvent.setup()
    const onEditRole = vi.fn()
    render(editor({ roles: [{ role: "admin", name: "Administração", powers: ["expulsar"] }], onEditRole }))
    expect(screen.queryByTitle(strings.roles.editTitle("Administração"))).toBeNull()
    // And does not appear twice: coming from the bridge, we do not add another.
    expect(screen.queryByText(strings.cargos.adminName)).toBeNull()

    await user.click(screen.getByTitle(strings.cargos.openTitle("Administração")))
    const nome = screen.getByLabelText(strings.roles.nameLabel) as HTMLInputElement
    expect(nome.readOnly).toBe(false)
    expect(screen.getByText(strings.cargos.adminAppearance)).toBeTruthy()
    await user.clear(nome)
    await user.type(nome, "Guardiões")
    await user.click(screen.getByTitle("Cor Âmbar"))
    await user.click(screen.getByText(strings.roles.save))
    expect(onEditRole).toHaveBeenCalledWith("admin", "Guardiões", ["expulsar"], "ambar")
    expect(screen.queryAllByRole("tab")).toHaveLength(0)
  })

  it("editar abre com a cor que o cargo já tem, e guardar não a perde", async () => {
    const user = userEvent.setup()
    const onEditRole = vi.fn()
    render(editor({ roles: [{ role: "guarda", name: "Guarda", powers: [], colour: "menta" }], onEditRole }))

    await user.click(screen.getByTitle(strings.roles.editTitle("Guarda")))
    expect(screen.getByTitle("Cor Menta").getAttribute("aria-pressed")).toBe("true")

    await user.click(screen.getByText("Guardar"))
    expect(onEditRole).toHaveBeenCalledWith("guarda", "Guarda", [], "menta")
  })

  it("despintar um cargo é um gesto, e não a falta de um", async () => {
    const user = userEvent.setup()
    const onEditRole = vi.fn()
    render(editor({ roles: [{ role: "guarda", name: "Guarda", powers: [], colour: "menta" }], onEditRole }))

    await user.click(screen.getByTitle(strings.roles.editTitle("Guarda")))
    await user.click(screen.getByText(strings.roles.colourNone))
    await user.click(screen.getByText("Guardar"))

    expect(onEditRole).toHaveBeenCalledWith("guarda", "Guarda", [], undefined)
  })

  it("cancelar fecha o cargo sem guardar nada", async () => {
    const user = userEvent.setup()
    const onEditRole = vi.fn()
    render(editor({ roles: papeis, onEditRole }))

    await user.click(screen.getByTitle(strings.roles.editTitle("Moderador")))
    await user.type(screen.getByLabelText(strings.roles.nameLabel), "x")
    await user.click(screen.getByText(strings.prompts.cancel))
    expect(onEditRole).not.toHaveBeenCalled()
    expect(screen.queryAllByRole("tab")).toHaveLength(0)
  })
})

/**
 * The order of roles in the editor (4/11/2026, owner request: "the
 * founder/admin must be able to reorder the roles as they are presented").
 * The gesture is the same as in the model section: `OrdemDosCargos`.
 */
describe("RoleEditor — a ordem dos cargos", () => {
  const tres = [
    { role: "porteiro", name: "Porteiro", powers: [] as Power[], rank: 1, position: 2 },
    { role: "chefe", name: "Chefe", powers: [] as Power[], rank: 3, position: 0 },
    { role: "guia", name: "Guia", powers: [] as Power[], rank: 2, position: 1 },
  ]
  const t = (): typeof strings.cargosEPermissoes => strings.cargosEPermissoes
  const nomes = (): string[] =>
    [...document.querySelectorAll(".role-editor > ul > .role-card .role-name")].map((nome) => nome.textContent ?? "")

  it("mostra os cargos pela ordem do canal (o rank), com a administração fixa no topo", () => {
    render(editor({ roles: tres, onReorder: vi.fn() }))
    expect(nomes()).toEqual([strings.cargos.adminName, "Chefe", "Guia", "Porteiro"])
    const admin = document.querySelector(".role-card[data-embutido='sim']")
    expect(admin?.getAttribute("draggable")).toBeNull()
    expect(within(admin as HTMLElement).queryByRole("button", { name: t().subir(strings.cargos.adminName) })).toBeNull()
  })

  it("muda a ordem pelas setas, e o leitor de ecrã ouve o lugar novo", async () => {
    const onReorder = vi.fn()
    const user = userEvent.setup()
    render(editor({ roles: tres, onReorder }))
    expect((screen.getByRole("button", { name: t().subir("Chefe") }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole("button", { name: t().descer("Chefe") }))
    expect(onReorder).toHaveBeenCalledWith(["guia", "chefe", "porteiro"])
    expect(screen.getByRole("status").textContent).toBe(t().posicaoNova("Chefe", 2, 3))
    // The arrow keeps focus on the line that moved.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: t().descer("Chefe") }))
  })

  it("no fundo, o foco passa para a outra seta", async () => {
    const user = userEvent.setup()
    render(editor({ roles: tres, onReorder: () => new Promise(() => {}) }))
    await user.click(screen.getByRole("button", { name: t().descer("Guia") }))
    expect(nomes()).toEqual([strings.cargos.adminName, "Chefe", "Porteiro", "Guia"])
    expect(document.activeElement).toBe(screen.getByRole("button", { name: t().subir("Guia") }))
  })

  it("muda a ordem por arrasto", () => {
    const onReorder = vi.fn()
    render(editor({ roles: tres, onReorder }))
    const cartoes = [...document.querySelectorAll(".role-editor > ul > .role-card")].slice(1)
    expect(cartoes.every((cartao) => cartao.getAttribute("draggable") === "true")).toBe(true)
    fireEvent.dragStart(cartoes[2]!, { dataTransfer: { setData: () => {}, effectAllowed: "" } })
    fireEvent.dragOver(cartoes[0]!)
    fireEvent.drop(cartoes[0]!)
    expect(onReorder).toHaveBeenCalledWith(["porteiro", "chefe", "guia"])
    expect(screen.getByRole("status").textContent).toBe(t().posicaoNova("Porteiro", 1, 3))
  })

  it("a lista fica na ordem pedida até o núcleo responder, e um segundo gesto espera pelo primeiro", async () => {
    const pedidos: { ordem: string[]; acabar: () => void }[] = []
    const onReorder = vi.fn((ordem: string[]) => new Promise<void>((acabar) => pedidos.push({ ordem, acabar })))
    const user = userEvent.setup()
    render(editor({ roles: tres, onReorder }))
    await user.click(screen.getByRole("button", { name: t().descer("Chefe") }))
    await user.click(screen.getByRole("button", { name: t().descer("Chefe") }))
    expect(nomes()).toEqual([strings.cargos.adminName, "Guia", "Porteiro", "Chefe"])
    // Only the first one left: two crossed `reorderRoles` could leave half of each.
    expect(pedidos.map((p) => p.ordem)).toEqual([["guia", "chefe", "porteiro"]])
    await act(async () => pedidos[0]?.acabar())
    expect(pedidos.map((p) => p.ordem)).toEqual([["guia", "chefe", "porteiro"], ["guia", "porteiro", "chefe"]])
  })

  it("sem poder ordenar (quem gere por delegação), não há setas nem arrasto", () => {
    render(editor({ roles: tres }))
    expect(nomes()).toEqual([strings.cargos.adminName, "Chefe", "Guia", "Porteiro"])
    expect(screen.queryByRole("button", { name: t().subir("Guia") })).toBeNull()
    expect(document.querySelector(".role-card[draggable='true']")).toBeNull()
    expect(screen.queryByText(t().ordemComoMudar, { exact: false })).toBeNull()
  })
})

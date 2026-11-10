import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ChannelRole } from "../../bridge.js"
import { strings } from "../../strings.js"
import { CategoryProperties } from "./CategoryProperties.js"

afterEach(cleanup)

/**
 * The sheet for viewing a category.
 *
 * What matters here is what gets lost easily: **empty means
 * everyone** (not "nobody", which is how newcomers read it), the payload order
 * cannot depend on the order you clicked the boxes, and a role deleted
 * after being chosen cannot leave the sheet with nothing to clear. And above
 * all, the sheet SAYS this organizes and does not protect before letting you
 * choose, the text is the product, not decoration.
 *
 * The three choices are the new thing, and what they DID NOT change is what matters most here:
 * "Everyone" still publishes the empty list, which is the invariant the whole
 * sidebar reads. It just stopped being the absence of a choice.
 *
 * Text comes from `strings.categoryProperties.<chave>` and is never copied
 * by hand: wording changes, and a literal transcribed today breaks the next day without
 * anything being wrong with the code.
 *
 * What we do NOT test here, and on purpose: the `position` of the category. The sheet
 * never touches it, it delivers the roles to whoever opened it, and it is whoever opened it (`App.tsx`)
 * who builds the full statement before publishing it. Proving that here would
 * assert about code that is not in this file.
 */

function papel(role: string, name = ""): ChannelRole {
  return { role, name, powers: [] }
}

const PAPEIS = [papel("direccao", "Direcção"), papel("socios", "Sócios"), papel("staff", "Staff")]

function folha(overrides: Partial<React.ComponentProps<typeof CategoryProperties>> = {}): React.JSX.Element {
  return (
    <CategoryProperties
      categoria="Direcção"
      roles={PAPEIS}
      initial={[]}
      salas={3}
      onSubmit={async () => {}}
      onCancel={() => {}}
      {...overrides}
    />
  )
}

/** The role list is born from the radio: without this choice there are no boxes. */
async function escolherPapeis(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByLabelText(strings.categoryProperties.rolesOption))
}

describe("CategoryProperties — as três escolhas", () => {
  it('uma categoria sem restrição abre em "Todos", e não em caixas vazias', () => {
    render(folha({ initial: [] }))
    expect((screen.getByLabelText(strings.categoryProperties.everyoneOption) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(strings.categoryProperties.everyone)).toBeTruthy()
  })

  it('"Todos" publica a lista vazia — a invariante que a barra lateral lê', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    render(folha({ initial: ["socios"], onSubmit }))

    await user.click(screen.getByLabelText(strings.categoryProperties.everyoneOption))
    await user.click(screen.getByText(strings.categoryProperties.save))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith([])
  })

  it('"Só quem administra" publica o papel embutido, que não é papel declarado nenhum', async () => {
    // `admin` never comes in `roles`, `rolesOf` leaves it out on purpose, so
    // it does not collide with any role someone might create. And it is not a
    // magic value other clients have to learn: the list is not empty, so it
    // restricts, and whoever administers passes anyway.
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    render(folha({ onSubmit }))

    await user.click(screen.getByLabelText(strings.categoryProperties.adminsOption))
    await user.click(screen.getByText(strings.categoryProperties.save))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(["admin"])
    expect(PAPEIS.map((p) => p.role)).not.toContain("admin")
  })

  it("uma categoria já restrita à administração reabre nessa escolha", () => {
    render(folha({ initial: ["admin"] }))
    expect((screen.getByLabelText(strings.categoryProperties.adminsOption) as HTMLInputElement).checked).toBe(true)
    // And no unsaved changes: reopening cannot look like you changed something.
    expect((screen.getByText(strings.categoryProperties.save) as HTMLButtonElement).disabled).toBe(true)
  })

  it('uma categoria restrita a papéis reabre em "Papéis específicos", com eles marcados', () => {
    render(folha({ initial: ["socios"] }))
    expect((screen.getByLabelText(strings.categoryProperties.rolesOption) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText("Sócios") as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText("Direcção") as HTMLInputElement).checked).toBe(false)
  })

  it("a contagem das salas fala de administração quando é a administração que restringe", async () => {
    const user = userEvent.setup()
    render(folha({ salas: 3 }))
    await user.click(screen.getByLabelText(strings.categoryProperties.adminsOption))
    expect(screen.getByText(strings.categoryProperties.hidesFromNonAdmins(3))).toBeTruthy()
    // And not the role phrase, which would point to an empty list.
    expect(screen.queryByText(strings.categoryProperties.hides(3))).toBeNull()
  })

  it("as caixas dos papéis só existem na escolha que as usa", async () => {
    // On a 390px sheet, three role boxes plus the creation form pushed the
    // save button off screen for users who just wanted "Everyone".
    const user = userEvent.setup()
    render(folha())
    expect(screen.queryByLabelText("Sócios")).toBeNull()
    await escolherPapeis(user)
    expect(screen.getByLabelText("Sócios")).toBeTruthy()
  })
})

describe("CategoryProperties — escolher papéis", () => {
  it("desenha uma caixa por papel declarado, pelo nome legível", async () => {
    const user = userEvent.setup()
    render(folha())
    await escolherPapeis(user)
    for (const p of PAPEIS) expect(screen.getByLabelText(p.name)).toBeTruthy()
  })

  it("cai no identificador quando o papel não tem nome", async () => {
    // A role with no name exists (the editor lets you create it), and a box
    // with no label at all was impossible to pick blind.
    const user = userEvent.setup()
    render(folha({ roles: [papel("direccao")] }))
    await escolherPapeis(user)
    expect(screen.getByLabelText("direccao")).toBeTruthy()
  })

  it("guardar publica os papéis escolhidos", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    render(folha({ onSubmit }))

    await escolherPapeis(user)
    await user.click(screen.getByLabelText("Sócios"))
    await user.click(screen.getByText(strings.categoryProperties.save))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(["socios"])
  })

  it("a ordem publicada vem da lista declarada, não da ordem dos cliques", async () => {
    // Two identical choices must publish the same payload. By `Set` insertion
    // order, marking Staff before Director gave a different list, and someone
    // comparing two payloads would see a change where none happened.
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    render(folha({ onSubmit }))

    await escolherPapeis(user)
    await user.click(screen.getByLabelText("Staff"))
    await user.click(screen.getByLabelText("Direcção"))
    await user.click(screen.getByText(strings.categoryProperties.save))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(["direccao", "staff"])
  })

  it('"Papéis específicos" sem nenhum marcado não se guarda', async () => {
    // It would publish an empty list, which is "everyone", and "everyone" has
    // its own button. The radio saying one thing and the wire saying another is
    // the bug this stops.
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    render(folha({ initial: ["socios"], onSubmit }))

    await user.click(screen.getByLabelText("Sócios"))
    expect((screen.getByText(strings.categoryProperties.save) as HTMLButtonElement).disabled).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("sem alterações não há nada a guardar, e desfazer a escolha volta a esse estado", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    render(folha({ initial: ["socios"], onSubmit }))

    const guardar = screen.getByText(strings.categoryProperties.save) as HTMLButtonElement
    expect(guardar.disabled).toBe(true)
    await user.click(screen.getByLabelText("Direcção"))
    expect(guardar.disabled).toBe(false)
    await user.click(screen.getByLabelText("Direcção"))
    expect(guardar.disabled).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("a ordem em que os papéis vieram do fio não conta como alteração", () => {
    // `initial` comes published by who published it, and its order does not
    // need to match the declared list. Comparing by index would open the sheet
    // saying there are unsaved changes with no one touching anything.
    render(folha({ initial: ["socios", "direccao"] }))
    expect((screen.getByText(strings.categoryProperties.save) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe("CategoryProperties — o papel apagado depois de escolhido", () => {
  it("com papéis vivos ao lado, a folha abre acesa e guardar limpa o fantasma", async () => {
    // The deleted role stays in the category payload and does not appear in any
    // box: invisible and still restricts. The sheet opens with the button ON
    // on purpose, what publishes differs from what is published, and that is
    // the only door to remove the ghost.
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    render(folha({ initial: ["fantasma", "socios"], roles: PAPEIS, onSubmit }))

    const guardar = screen.getByText(strings.categoryProperties.save) as HTMLButtonElement
    expect(guardar.disabled).toBe(false)
    await user.click(guardar)
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(["socios"])
  })

  it('só com fantasmas, a porta é "Todos" — e continua a haver porta', async () => {
    // With no live role to mark, and "Specific roles" empty does not save. The
    // way out is the choice above, in view and telling you what it does, a
    // better door than a button on with no explanation.
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    render(folha({ initial: ["fantasma"], onSubmit }))

    expect((screen.getByText(strings.categoryProperties.save) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByLabelText(strings.categoryProperties.everyoneOption))
    await user.click(screen.getByText(strings.categoryProperties.save))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith([])
  })
})

describe("CategoryProperties — criar um papel sem sair daqui", () => {
  it("cria, e o papel novo entra marcado", async () => {
    // It was created FOR this category: making you search the list next would
    // be half the detour this came to remove.
    const user = userEvent.setup()
    const onCreateRole = vi.fn(async () => "guardas")
    const onSubmit = vi.fn(async () => {})
    const { rerender } = render(folha({ onCreateRole, onSubmit }))

    await escolherPapeis(user)
    await user.type(screen.getByLabelText(strings.roles.nameLabel), "Guardas")
    await user.click(screen.getByText(strings.roles.create))
    expect(onCreateRole).toHaveBeenCalledExactlyOnceWith("Guardas")

    // The host answers with the new list, as it does in the app.
    rerender(folha({ onCreateRole, onSubmit, roles: [...PAPEIS, papel("guardas", "Guardas")] }))
    expect((screen.getByLabelText("Guardas") as HTMLInputElement).checked).toBe(true)
    await user.click(screen.getByText(strings.categoryProperties.save))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(["guardas"])
  })

  it("o Enter no nome do papel cria o papel — não guarda a categoria", async () => {
    // The field lives inside the sheet form, and Enter in a text field submits
    // the form around it: without the guard, writing the name and pressing Enter
    // closed the sheet and published the category.
    const user = userEvent.setup()
    const onCreateRole = vi.fn(async () => "guardas")
    const onSubmit = vi.fn(async () => {})
    render(folha({ onCreateRole, onSubmit }))

    await escolherPapeis(user)
    await user.type(screen.getByLabelText(strings.roles.nameLabel), "Guardas{Enter}")
    expect(onCreateRole).toHaveBeenCalledExactlyOnceWith("Guardas")
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("um papel sem nome não se cria", async () => {
    const user = userEvent.setup()
    const onCreateRole = vi.fn(async () => "x")
    render(folha({ onCreateRole }))

    await escolherPapeis(user)
    expect((screen.getByText(strings.roles.create) as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByLabelText(strings.roles.nameLabel), "   {Enter}")
    expect(onCreateRole).not.toHaveBeenCalled()
  })

  it("uma criação recusada mostra a razão e não fecha nada", async () => {
    const user = userEvent.setup()
    const onCreateRole = vi.fn(async () => {
      throw new Error("só quem administra este canal pode criar papéis")
    })
    render(folha({ onCreateRole }))

    await escolherPapeis(user)
    await user.type(screen.getByLabelText(strings.roles.nameLabel), "Guardas")
    await user.click(screen.getByText(strings.roles.create))
    expect(await screen.findByText("só quem administra este canal pode criar papéis")).toBeTruthy()
  })

  it("quem não pode gerir papéis não vê o formulário — e é reencaminhado", async () => {
    // House rule: what you cannot do does not appear grayed out, it does not
    // appear. The sentence that stays is the one that sets the channel properties,
    // which for that person continues to be true.
    const user = userEvent.setup()
    render(folha({ roles: [] }))
    await escolherPapeis(user)
    expect(screen.queryByLabelText(strings.roles.nameLabel)).toBeNull()
    expect(screen.getByText(strings.categoryProperties.noRoles)).toBeTruthy()
  })

  it("sem papéis declarados mas com poder para os criar, o formulário é a resposta", async () => {
    const user = userEvent.setup()
    render(folha({ roles: [], onCreateRole: async () => "x" }))
    await escolherPapeis(user)
    expect(screen.getByText(strings.categoryProperties.noRolesYet)).toBeTruthy()
    expect(screen.getByLabelText(strings.roles.nameLabel)).toBeTruthy()
  })
})

describe("CategoryProperties — o que a folha diz e o que ela publica", () => {
  it("diz que isto arruma e não protege, e di-lo ANTES das escolhas", () => {
    // A warning you read after deciding is not a warning. The order in the DOM is
    // the order in which you read it, and that is what matters here.
    const { container } = render(folha())
    const aviso = screen.getByText(strings.categoryProperties.note)
    const escolhas = container.querySelector("fieldset")
    expect(escolhas).toBeTruthy()
    expect(aviso.compareDocumentPosition(escolhas!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("com papéis escolhidos, a nota conta as salas por `hides`", async () => {
    // By reference to the function and never to the text: what matters is that the
    // count the sheet shows is what the function returns for the number of rooms
    // it received, whatever the wording of the day.
    const user = userEvent.setup()
    render(folha({ salas: 3 }))
    await escolherPapeis(user)
    await user.click(screen.getByLabelText("Direcção"))
    expect(screen.getByText(strings.categoryProperties.hides(3))).toBeTruthy()
    expect(screen.queryByText(strings.categoryProperties.everyone)).toBeNull()
  })

  it("a categoria vazia também é contada pela mesma função", async () => {
    // A category starts with no rooms: this is the normal case for someone who just
    // created it and wants to restrict it right away, and the sentence must account
    // for it.
    const user = userEvent.setup()
    render(folha({ salas: 0 }))
    await escolherPapeis(user)
    await user.click(screen.getByLabelText("Direcção"))
    expect(screen.getByText(strings.categoryProperties.hides(0))).toBeTruthy()
  })

  it("submeter duas vezes publica uma vez só", async () => {
    // The button closes itself as it publishes, but the `Modal` is a `<form>` and
    // Enter submits without going through a button. The `busy` guard prevents two
    // declarations of the same category in flight at the same time.
    const user = userEvent.setup()
    // A publish that never resolves: leaves the sheet busy so you see the second
    // request hit the guard.
    const onSubmit = vi.fn(() => new Promise<void>(() => {}))
    const { container } = render(folha({ onSubmit }))

    await user.click(screen.getByLabelText(strings.categoryProperties.adminsOption))
    const formulario = container.querySelector("form")
    expect(formulario).toBeTruthy()
    fireEvent.submit(formulario!)
    fireEvent.submit(formulario!)
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it("a publicação em curso diz-se no botão", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(() => new Promise<void>(() => {}))
    render(folha({ onSubmit }))

    await user.click(screen.getByLabelText(strings.categoryProperties.adminsOption))
    await user.click(screen.getByText(strings.categoryProperties.save))
    expect(screen.getByText(strings.categoryProperties.saving)).toBeTruthy()
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it("uma publicação recusada mostra a razão e devolve o botão", async () => {
    // Without this the sheet stayed stuck on "Saving..." forever and the person
    // left convinced they had saved.
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {
      throw new Error("o anfitrião recusou")
    })
    render(folha({ onSubmit }))

    await user.click(screen.getByLabelText(strings.categoryProperties.adminsOption))
    await user.click(screen.getByText(strings.categoryProperties.save))
    expect(await screen.findByText("o anfitrião recusou")).toBeTruthy()
    expect((screen.getByText(strings.categoryProperties.save) as HTMLButtonElement).disabled).toBe(false)
  })

  it("cancelar não publica nada", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    const onCancel = vi.fn()
    render(folha({ onSubmit, onCancel }))

    await user.click(screen.getByLabelText(strings.categoryProperties.adminsOption))
    await user.click(screen.getByText(strings.prompts.cancel))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("as notas de quem administra e da sala por omissão estão sempre à vista", () => {
    // Both answer the question the sheet raises when restricting: "what if I hide
    // myself?" and "where do messages with no room end up?".
    render(folha())
    expect(screen.getByText(strings.categoryProperties.adminNote)).toBeTruthy()
    expect(screen.getByText(strings.categoryProperties.defaultRoomNote)).toBeTruthy()
  })
})

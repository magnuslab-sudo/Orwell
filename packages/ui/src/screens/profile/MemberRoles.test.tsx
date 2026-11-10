import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { strings } from "../../strings.js"
import { MemberRoles } from "./MemberRoles.js"

afterEach(cleanup)

const noop = (): void => {}

const papeis = [
  { role: "moderador", name: "Moderador", powers: ["expulsar", "renomear"] as const },
  { role: "convidado", name: "Convidado", powers: [] as const },
].map((papel) => ({ ...papel, powers: [...papel.powers] }))

function seccao(overrides: Partial<React.ComponentProps<typeof MemberRoles>> = {}): React.JSX.Element {
  return (
    <MemberRoles
      channelLabel="Geral"
      declared={papeis}
      mine={[]}
      mayManage={false}
      founder={false}
      admin={false}
      onToggle={noop}
      {...overrides}
    />
  )
}

/**
 * A role belongs to a channel, and the title must say so.
 *
 * "Roles: Moderator" on someone's profile would say they are a moderator
 * everywhere. It is false, and it is why the channel appears in the title and
 * not in a note.
 */
describe("MemberRoles — os papéis são sempre de um canal", () => {
  it("o título nomeia o canal, e nomeia-o pelo nome que a barra lateral mostra", () => {
    render(seccao({ mine: ["moderador"] }))
    expect(screen.getByText(strings.memberRoles.title("Geral"))).toBeTruthy()
  })
})

/**
 * Seeing is not a privilege.
 *
 * Knowing that Ana is a Moderator is what makes the role useful, and anyone
 * with a role must be able to discover what it gives them. An earlier version
 * closed this section to admins and closed with it the reading; it is reverted.
 */
describe("MemberRoles — quem vê", () => {
  it("quem não gere papéis vê à mesma o que a pessoa tem, e o que isso lhe dá", () => {
    render(seccao({ mine: ["moderador"], mayManage: false }))

    expect(screen.getByText("Moderador")).toBeTruthy()
    expect(screen.getByText(/Garantido: expulsar/)).toBeTruthy()
    expect(screen.getByText(/Regra da app: mudar o nome/)).toBeTruthy()
  })

  it("quem não gere não vê caixas: ver é de todos, alterar não", () => {
    render(seccao({ mine: ["moderador"], mayManage: false }))
    expect(screen.queryByRole("switch")).toBeNull()
  })

  it("a quem não gere mostra-se o que a pessoa tem, e não o inventário do canal", () => {
    render(seccao({ mine: ["moderador"], mayManage: false }))
    // "Guest" exists in the channel, but this person does not have it: halfway
    // through someone's profile, the full list of channel labels is noise.
    expect(screen.queryByText("Convidado")).toBeNull()
  })

  it("sem papéis, sem fundação e sem administração, não há secção nenhuma", () => {
    const { container } = render(seccao({ mine: [], mayManage: false }))
    expect(container.querySelector(".member-roles")).toBeNull()
  })
})

/**
 * The one who changes comes from the core.
 *
 * `mayManageRoles`, not a new rule written on screen: managing roles is
 * deliberately outside the four responsibilities, because if it were one of
 * them it would take just one power to nominate yourself all the others.
 */
describe("MemberRoles — quem altera", () => {
  it("quem gere vê a lista toda do canal, marcada no que a pessoa já tem", () => {
    render(seccao({ mine: ["moderador"], mayManage: true }))

    expect(screen.getByRole("switch", { name: "Moderador" }).getAttribute("aria-checked")).toBe("true")
    expect(screen.getByRole("switch", { name: "Convidado" }).getAttribute("aria-checked")).toBe("false")
  })

  it("ligar o interruptor dá o papel, com o identificador e não com o nome", async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(seccao({ mine: [], mayManage: true, onToggle }))

    await user.click(screen.getByRole("switch", { name: "Moderador" }))
    expect(onToggle).toHaveBeenCalledExactlyOnceWith("moderador", true)
  })

  /**
   * Removing was a gesture that did not exist: the old editor only added. Here
   * the person is one and the list is roles, which makes the toggle the obvious
   * form, and removing no longer needs its own gesture.
   */
  it("desligar tira o papel", async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(seccao({ mine: ["moderador"], mayManage: true, onToggle }))

    await user.click(screen.getByRole("switch", { name: "Moderador" }))
    expect(onToggle).toHaveBeenCalledExactlyOnceWith("moderador", false)
  })

  it("os interruptores chegam-se pelo teclado: o arrasto morreu e não volta", async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(seccao({ mine: [], mayManage: true, onToggle }))

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole("switch", { name: "Moderador" }))
    await user.keyboard(" ")
    expect(onToggle).toHaveBeenCalledExactlyOnceWith("moderador", true)
  })

  it("um canal sem papéis declarados diz onde é que eles se criam", () => {
    render(seccao({ declared: [], mine: [], mayManage: true }))
    expect(screen.getByText(strings.memberRoles.noneDeclared)).toBeTruthy()
  })
})

/**
 * The question this screen asks is "what roles does this person have?".
 *
 * The answer lived in a 13px square at the corner of cards otherwise identical:
 * to know it you had to read the boxes one by one. Two lists with headers answer
 * it at a glance, and what is left becomes explicitly the other question, what
 * can be given.
 *
 * Here we do not measure a call; we measure what the person reads and which list
 * the card is in. A `toHaveBeenCalled` on `onToggle` would say yes even with both
 * lists not yet written.
 */
describe("MemberRoles — o que a pessoa tem, e o que se lhe pode dar", () => {
  /** The role names inside the list with this header. */
  function debaixoDe(letreiro: string): string[] {
    const grupo = screen.getByText(letreiro).closest(".member-roles-grupo")
    return [...(grupo?.querySelectorAll(".role-name") ?? [])].map((no) => no.textContent ?? "")
  }

  it("o letreiro conta os cargos da pessoa, para ninguém ter de contar caixas", () => {
    render(seccao({ mine: ["moderador"], mayManage: true }))
    expect(screen.getByText("Tem 1 cargo")).toBeTruthy()
  })

  it("e concorda em número quando são mais do que um", () => {
    render(seccao({ mine: ["moderador", "convidado"], mayManage: true }))
    expect(screen.getByText("Tem 2 cargos")).toBeTruthy()
  })

  it("o que a pessoa tem e o que pode receber estão em listas separadas", () => {
    render(seccao({ mine: ["moderador"], mayManage: true }))

    expect(debaixoDe("Tem 1 cargo")).toEqual(["Moderador"])
    expect(debaixoDe(strings.memberRoles.available)).toEqual(["Convidado"])
  })

  it("marcar passa o cargo de uma lista para a outra: o gesto vê-se onde importa", () => {
    /*
      Controlled by `mine`, which is how the app uses it: the core answers,
      `mine` changes, and the list redraws. That is why it redraws with the new
      prop instead of clicking, clicking here would measure `onToggle`, which
      already has its test, not what the person now sees.
    */
    const { rerender } = render(seccao({ mine: [], mayManage: true }))
    expect(screen.getByText(strings.memberRoles.none)).toBeTruthy()
    expect(debaixoDe(strings.memberRoles.available)).toEqual(["Moderador", "Convidado"])

    rerender(seccao({ mine: ["moderador"], mayManage: true }))
    expect(debaixoDe("Tem 1 cargo")).toEqual(["Moderador"])
    expect(debaixoDe(strings.memberRoles.available)).toEqual(["Convidado"])
    expect(screen.queryByText(strings.memberRoles.none)).toBeNull()
  })

  it("quem não tem cargo nenhum ouve-o por palavras, e não por uma lista vazia", () => {
    render(seccao({ mine: [], mayManage: true }))
    expect(screen.getByText(strings.memberRoles.none)).toBeTruthy()
    expect(screen.queryByText(/^Tem /)).toBeNull()
  })

  it("a quem não pode dar cargos não se promete uma escolha que não há", () => {
    render(seccao({ mine: ["moderador"], mayManage: false }))

    expect(screen.getByText("Tem 1 cargo")).toBeTruthy()
    expect(screen.queryByText(strings.memberRoles.available)).toBeNull()
    // And does not see the channel inventory halfway through someone's profile.
    expect(screen.queryByText("Convidado")).toBeNull()
  })

  it("e a quem funda o canal também não, porque aquele lugar não se mexe", () => {
    render(seccao({ mine: ["moderador"], mayManage: true, founder: true }))

    expect(screen.getByText("Tem 1 cargo")).toBeTruthy()
    expect(screen.queryByText(strings.memberRoles.available)).toBeNull()
    expect(screen.getByText(strings.memberRoles.founderLocked)).toBeTruthy()
  })

  it("o cartão diz no próprio elemento se a pessoa tem o cargo", () => {
    /*
      `data-tem` is what the style sheet reads to lift the card and paint its
      bar the role's color. Here we prove the state reaches the element; that it
      translates to different pixels is measured with a browser, in
      `scripts/medir-cargos.mjs`, because jsdom applies no CSS.
    */
    const { container } = render(seccao({ mine: ["moderador"], mayManage: true }))
    const cartoes = [...container.querySelectorAll(".role-card")].map((cartao) => [
      cartao.querySelector(".role-name")?.textContent,
      cartao.getAttribute("data-tem"),
    ])
    expect(cartoes).toEqual([
      ["Moderador", "sim"],
      ["Convidado", "nao"],
    ])
  })
})

/**
 * Founding and administering are not declared roles.
 *
 * They are not in the channel's list and do not tick a box. Omitting them would
 * make this section lie about what the person can do.
 */
describe("MemberRoles — o que não é um papel declarado", () => {
  it("quem fundou o canal é dito, e não se lhe mexe mesmo a quem gere", () => {
    render(seccao({ founder: true, mayManage: true, mine: ["moderador"] }))

    expect(screen.getByText(strings.memberRoles.founder)).toBeTruthy()
    // The core refuses: `assignRoles` does not remove whoever founded. Offering the
    // boxes would promise a gesture that always returns an error.
    expect(screen.queryByRole("switch")).toBeNull()
    expect(screen.getByText(strings.memberRoles.founderLocked)).toBeTruthy()
  })

  it("o papel embutido de administrador diz-se, mesmo não estando na lista", () => {
    // `roles()` does not return the built-in `admin`, and `rolesFor()` does: without
    // this line, an admin appeared here as having no role at all.
    render(seccao({ admin: true, mine: ["admin"], mayManage: false }))
    expect(screen.getByText(strings.memberRoles.admin)).toBeTruthy()
  })
})

/**
 * The distinction that follows roles wherever they are read.
 *
 * Of the four responsibilities, only `expulsar` has cryptographic weight. Here
 * it weighs as much as in the editor: it is where someone discovers what their
 * role gives them, and what it only seems to give.
 */
describe("MemberRoles — o que a cifra garante", () => {
  it("um papel sem responsabilidades diz que só dá acesso", () => {
    render(seccao({ mine: ["convidado"], mayManage: false }))

    const cartao = screen.getByText("Convidado").closest("li")
    expect(cartao?.textContent).toContain("Só acesso ao canal")
    expect(cartao?.textContent).not.toContain("Garantido")
  })

  it("a nota sobre o que a cifra garante viaja com os papéis", () => {
    render(seccao({ mine: ["moderador"], mayManage: false }))
    expect(screen.getByText(/Quem é expulso deixa de ler o canal/)).toBeTruthy()
  })
})

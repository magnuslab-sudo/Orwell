import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { strings } from "../../strings.js"
import { RoomProperties } from "./RoomProperties.js"
import { IDS_DAS_SECCOES_DO_CANAL, seccaoDoCanalValida, seccoesVisiveis } from "./seccoesDoCanal.js"

afterEach(cleanup)

/** The channel properties by sections (3/11/2026, parity plan §5.3). */

const s = (): typeof strings.roomProperties.seccoes => strings.roomProperties.seccoes

function montar(extra: Partial<React.ComponentProps<typeof RoomProperties>> = {}) {
  const onSubmit = vi.fn(async () => {})
  const onCancel = vi.fn()
  render(
    <RoomProperties
      channel="!contio:orwell.test"
      initial={{ name: "Contio" }}
      onSubmit={onSubmit}
      onCancel={onCancel}
      roles={[{ role: "guarda", name: "Guarda", powers: ["expulsar"] }]}
      mayManageRoles
      onCreateRole={() => {}}
      onEditRole={() => {}}
      onDeleteRole={() => {}}
      seccaoAfk={<p>secção afk</p>}
      {...extra}
    />,
  )
  return { onSubmit, onCancel }
}

describe("as secções que se vêem", () => {
  it("quem administra vê as sete, pela ordem do pedido", () => {
    expect(seccoesVisiveis({ mayEdit: true, gereCargos: true, temSalas: true, ehFundador: false })).toEqual(IDS_DAS_SECCOES_DO_CANAL)
  })

  it("quem só lê vê só Geral, e a folha fica sem coluna", () => {
    expect(seccoesVisiveis({ mayEdit: false, gereCargos: false, temSalas: true, ehFundador: false })).toEqual(["geral"])
    montar({ mayEdit: false, mayManageRoles: false })
    expect(screen.queryByRole("tablist")).toBeNull()
    expect(screen.getByText(strings.roomProperties.readOnly)).toBeTruthy()
  })

  it("o fundador vê a Moderação, onde estão as denúncias, mesmo sem poder editar", () => {
    expect(seccoesVisiveis({ mayEdit: false, gereCargos: false, temSalas: false, ehFundador: true })).toEqual(["geral", "moderacao"])
  })

  it("as denúncias do fundador só se montam com a aba Moderação aberta", async () => {
    montar({ mayEdit: false, mayManageRoles: false, souFundador: true, seccaoDenuncias: <p>as denúncias</p> })
    expect(screen.queryByText("as denúncias")).toBeNull()
    await userEvent.click(screen.getByRole("tab", { name: s().moderacao }))
    expect(screen.getByText("as denúncias")).toBeTruthy()
    // Those who cannot edit do not see the line for what does not yet exist.
    expect(screen.queryByText(strings.roomProperties.moderacaoBreve)).toBeNull()
  })

  it("quem não é fundador não vê as denúncias, mesmo com a secção montada", async () => {
    montar({ souFundador: false, seccaoDenuncias: <p>as denúncias</p> })
    await userEvent.click(screen.getByRole("tab", { name: s().moderacao }))
    expect(screen.queryByText("as denúncias")).toBeNull()
  })

  it("sem poder gerir cargos, a aba Cargos não aparece, nem cinzenta", () => {
    montar({ mayManageRoles: false })
    expect(screen.queryByRole("tab", { name: s().cargos })).toBeNull()
    expect(screen.getByRole("tab", { name: s().geral })).toBeTruthy()
  })

  it("uma secção pedida que não se vê cai em Geral", () => {
    expect(seccaoDoCanalValida("cargos", ["geral", "salas"])).toBe("geral")
    expect(seccaoDoCanalValida(undefined, ["geral"])).toBe("geral")
  })
})

describe("mudar de secção", () => {
  it("abre em Geral, com o nome, e a coluna diz qual está aberta", () => {
    montar()
    const lista = screen.getByRole("tablist", { name: strings.roomProperties.seccoesLabel })
    expect(within(lista).getAllByRole("tab")).toHaveLength(7)
    expect(screen.getByRole("tab", { name: s().geral }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("tabpanel").textContent).toContain(strings.roomProperties.lead)
  })

  it("abrir Cargos mostra o editor de cargos, e Guardar sai do pé", async () => {
    montar()
    expect(screen.getByRole("button", { name: strings.roomProperties.save })).toBeTruthy()
    await userEvent.click(screen.getByRole("tab", { name: s().cargos }))
    const painel = screen.getByRole("tabpanel")
    expect(within(painel).getByText("Guarda")).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.roomProperties.save })).toBeNull()
  })

  it("o nome escrito em Geral fica, depois de ir a outra secção e voltar", async () => {
    const { onSubmit } = montar()
    const nome = screen.getByRole("textbox", { name: strings.roomProperties.nameLabel })
    await userEvent.clear(nome)
    await userEvent.type(nome, "Contio novo")
    await userEvent.click(screen.getByRole("tab", { name: s().salas }))
    expect(screen.getByRole("tabpanel").textContent).toContain("secção afk")
    await userEvent.click(screen.getByRole("tab", { name: s().geral }))
    expect((screen.getByRole("textbox", { name: strings.roomProperties.nameLabel }) as HTMLInputElement).value).toBe("Contio novo")
    await userEvent.click(screen.getByRole("button", { name: strings.roomProperties.save }))
    expect(onSubmit).toHaveBeenCalledWith({ name: "Contio novo" })
  })

  it("as secções sem conteúdo dizem o que lá vai haver", async () => {
    montar()
    for (const [aba, frase] of [
      [s().membros, strings.roomProperties.membrosBreve],
      [s().convites, strings.roomProperties.convitesBreve],
      [s().moderacao, strings.roomProperties.moderacaoBreve],
      [s().eventos, strings.roomProperties.eventosBreve],
    ] as const) {
      await userEvent.click(screen.getByRole("tab", { name: aba }))
      expect(screen.getByRole("tabpanel").textContent).toBe(frase)
    }
  })

  it("as setas andam pelas secções, e o foco vai com elas", async () => {
    montar()
    const geral = screen.getByRole("tab", { name: s().geral })
    geral.focus()
    await userEvent.keyboard("{ArrowDown}")
    const salas = screen.getByRole("tab", { name: s().salas })
    expect(salas.getAttribute("aria-selected")).toBe("true")
    expect(document.activeElement).toBe(salas)
    await userEvent.keyboard("{End}")
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: s().eventos }))
    await userEvent.keyboard("{ArrowDown}")
    expect(document.activeElement).toBe(geral)
    await userEvent.keyboard("{ArrowUp}")
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: s().eventos }))
    // Only the open one is in Tab order.
    expect(screen.getAllByRole("tab").filter((aba) => aba.tabIndex === 0)).toHaveLength(1)
  })

  it("abre na secção pedida", () => {
    montar({ seccaoInicial: "cargos" })
    expect(screen.getByRole("tab", { name: s().cargos }).getAttribute("aria-selected")).toBe("true")
  })

  it("Esc fecha a folha, sem nada por guardar", () => {
    const { onCancel } = montar()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onCancel).toHaveBeenCalled()
  })
})

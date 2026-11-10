import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ActivityMenu } from "./ActivityMenu.js"
import { strings } from "../../strings.js"
import { en } from "../../linguas/en.js"
import { pt } from "../../linguas/pt.js"

afterEach(cleanup)

/**
 * The "How you appear" menu, on the account card.
 *
 * Owner's order on October 27 2026: "status is not edited in the profile, it is
 * edited on the card: online, busy, away". Away becomes a hand choice, next to
 * the others.
 */
describe("ActivityMenu", () => {
  it("tem Online, Ocupado, Ausente e Invisível, por esta ordem", () => {
    render(<ActivityMenu activity="online" at={{ x: 0, y: 0 }} onChoose={vi.fn()} onEditStatus={vi.fn()} onClose={vi.fn()} />)
    const nomes = screen.getAllByRole("menuitemradio").map((botao) => botao.textContent)
    expect(nomes).toEqual([strings.activity.online, strings.activity.busy, strings.activity.away, strings.activity.invisible])
    expect(pt.activity.away).toBe("Ausente")
    expect(en.activity?.away).toBe("Away")
  })

  it('escolher Ausente devolve "ausente", e o ponto do menu é o amarelo', () => {
    const onChoose = vi.fn()
    render(<ActivityMenu activity="online" at={{ x: 0, y: 0 }} onChoose={onChoose} onEditStatus={vi.fn()} onClose={vi.fn()} />)
    const ausente = screen.getByRole("menuitemradio", { name: strings.activity.away })
    expect(ausente.querySelector(".dot.away")).not.toBeNull()
    fireEvent.click(ausente)
    expect(onChoose).toHaveBeenCalledWith("ausente")
  })

  it("marca Ausente como a escolha actual", () => {
    render(<ActivityMenu activity="ausente" at={{ x: 0, y: 0 }} onChoose={vi.fn()} onEditStatus={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole("menuitemradio", { name: strings.activity.away }).getAttribute("aria-checked")).toBe("true")
  })

  it('"Personalizado…" continua a abrir o texto do estado', () => {
    const onEditStatus = vi.fn()
    render(<ActivityMenu activity="online" at={{ x: 0, y: 0 }} onChoose={vi.fn()} onEditStatus={onEditStatus} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole("menuitem", { name: strings.activity.custom }))
    expect(onEditStatus).toHaveBeenCalledTimes(1)
  })
})

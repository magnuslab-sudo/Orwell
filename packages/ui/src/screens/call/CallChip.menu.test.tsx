import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { strings } from "../../strings.js"
import { CallChip } from "./CallChip.js"

afterEach(cleanup)

/** The person menu on the call card (phase 3): right-click and "⋯". */
describe("o menu da pessoa no cartão", () => {
  it('abre com o clique direito e com o "⋯"', () => {
    const aberturas: { x: number; y: number }[] = []
    const { container } = render(<CallChip label="Ana" profile={undefined} texto="ligada" onMenu={(at) => aberturas.push(at)} />)
    fireEvent.contextMenu(container.querySelector(".call-chip") as HTMLElement, { clientX: 10, clientY: 20 })
    expect(aberturas).toEqual([{ x: 10, y: 20 }])
    fireEvent.click(screen.getByRole("button", { name: strings.call.personMenu("Ana") }))
    expect(aberturas).toHaveLength(2)
  })

  it('sem onMenu, nem "⋯" nem menu', () => {
    render(<CallChip label="Ana" profile={undefined} texto="ligada" />)
    expect(screen.queryByRole("button", { name: strings.call.personMenu("Ana") })).toBeNull()
  })
})

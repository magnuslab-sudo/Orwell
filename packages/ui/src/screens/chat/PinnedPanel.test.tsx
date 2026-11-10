import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { PinnedMessage, Profile } from "../../bridge.js"
import { strings } from "../../strings.js"
import { PinnedPanel } from "./PinnedPanel.js"

afterEach(cleanup)

const noop = (): void => {}

function panel(overrides: Partial<React.ComponentProps<typeof PinnedPanel>>): React.JSX.Element {
  return (
    <PinnedPanel
      pins={[]}
      directory={new Map<string, Profile>()}
      nameFor={(address) => address}
      podeDesafixar={false}
      corpoDe={() => undefined}
      onDesafixar={noop}
      onClose={noop}
      {...overrides}
    />
  )
}

const fixada: PinnedMessage = {
  id: "m1",
  sender: "@ana:s",
  pinnedBy: "@ana:s",
  sentAt: 1,
  pinnedAt: 2,
  body: "a cópia que viaja com a fixação",
}

/**
 * The empty sheet said "Nothing pinned in this room." and nothing else, to the
 * two people who can open it. The one who can pin would leave without knowing
 * how to do it; the one who cannot would stay unable, and reading the path would
 * be worse.
 */
describe("a folha das fixadas, quando não há nenhuma", () => {
  it("a quem pode fixar, diz por onde se fixa", () => {
    render(panel({ podeDesafixar: true }))

    const dito = screen.getByText(strings.chat.pinnedEmptyCanPin)
    expect(dito).toBeTruthy()
    // The exact name of the menu entry, not a paraphrase: whoever looks for it must
    // find the same word they read here.
    expect(dito.textContent).toContain(strings.chat.messagePin)
  })

  it("a quem não pode, não descreve uma porta que não existe", () => {
    render(panel({ podeDesafixar: false }))

    expect(screen.getByText(strings.chat.pinnedEmpty)).toBeTruthy()
    expect(screen.queryByText(strings.chat.pinnedEmptyCanPin)).toBeNull()
  })

  it("e havendo fixadas, nenhuma das duas frases aparece", () => {
    render(panel({ podeDesafixar: true, pins: [fixada] }))

    expect(screen.getByText("a cópia que viaja com a fixação")).toBeTruthy()
    expect(screen.queryByText(strings.chat.pinnedEmpty)).toBeNull()
    expect(screen.queryByText(strings.chat.pinnedEmptyCanPin)).toBeNull()
  })
})

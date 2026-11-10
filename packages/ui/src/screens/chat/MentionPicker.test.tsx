import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { MentionPicker } from "./MentionPicker.js"

afterEach(cleanup)

const noop = (): void => {}
const ana = { address: "@ana:s", name: "Ana" }

/** The ring in the at-mention suggestions: the same rule as for other faces. */
describe("MentionPicker — o anel de cada sugestão", () => {
  it("sem `presenceFor`, sem anel", () => {
    const { container } = render(<MentionPicker candidatos={[ana]} escolhido={0} onEscolher={noop} onApontar={noop} />)
    expect(container.querySelector(".mention-option .avatar-wrap")).not.toBeNull()
    expect(container.querySelector(".mention-option [data-anel]")).toBeNull()
  })

  it("com `presenceFor`, a cor do estado", () => {
    const { container } = render(
      <MentionPicker
        candidatos={[ana]}
        escolhido={0}
        presenceFor={() => "away"}
        emChamada={() => true}
        onEscolher={noop}
        onApontar={noop}
      />,
    )
    const anel = container.querySelector<HTMLElement>(".mention-option [data-anel]")!
    expect(anel.dataset["anel"]).toBe("ausente")
    expect(anel.hasAttribute("data-em-chamada")).toBe(true)
  })
})

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { strings } from "../../strings.js"
import { BuzzButton } from "./BuzzButton.js"

afterEach(cleanup)

/**
 * The nudge button, and mostly the `type="button"` it brings.
 *
 * The sweep in `botoesEmFormulario.test.ts` scans the source looking for
 * buttons without type inside forms, but only links a button to `<form>` when
 * both are in the same file. This button is alone in its file, and the `<form>`
 * around it is from `Composer.tsx` (line 232; button enters at 406), that is,
 * removing its `type` today would fail no tests, and the first to know would be
 * whoever nudges in the middle of a sentence and sees it sent by accident. This
 * file closes that gap.
 */

describe("BuzzButton", () => {
  it("declara `type=\"button\"`, porque o formulário que o rodeia vive noutro ficheiro", () => {
    render(<BuzzButton onBuzz={() => {}} cooldown={0} />)
    // `getByRole("button")` would find it anyway if it were a submit: what we
    // check is the attribute, which is the only thing that separates a nudge from
    // sending the sentence halfway through.
    expect(screen.getByRole("button").getAttribute("type")).toBe("button")
  })

  it("livre, mostra o ícone e o rótulo lido em voz alta, e o clique chega", async () => {
    const user = userEvent.setup()
    const onBuzz = vi.fn()
    render(<BuzzButton onBuzz={onBuzz} cooldown={0} />)

    const botao = screen.getByRole("button")
    expect(botao.getAttribute("title")).toBe(strings.chat.buzzTitle)
    expect(screen.getByText(strings.chat.buzz)).toBeTruthy()

    await user.click(botao)
    expect(onBuzz).toHaveBeenCalledOnce()
  })

  it("à espera, conta quanto falta e não deixa passar o clique", async () => {
    // The count is the only thing that explains why the button stopped
    // responding, a silent button looks like a bug, and whoever presses it again
    // doesn't know if the first one went through.
    const user = userEvent.setup()
    const onBuzz = vi.fn()
    render(<BuzzButton onBuzz={onBuzz} cooldown={5} />)

    const botao = screen.getByRole("button")
    expect(screen.getByText(strings.chat.buzzCounting(5))).toBeTruthy()
    expect(botao.getAttribute("title")).toBe(strings.chat.buzzWait(5))

    await user.click(botao)
    expect(onBuzz).not.toHaveBeenCalled()
  })

  it("o eco acende-se no clique: é o recibo de quem nunca vê o abanão", () => {
    // The person nudging shakes the OTHER person's screen. Without the echo,
    // on this end there's a sound and nothing else, and a gesture that only makes
    // noise looks like a failed gesture.
    render(<BuzzButton onBuzz={() => {}} cooldown={0} />)
    const botao = screen.getByRole("button")
    expect(botao.className).toBe("composer-buzz")
    fireEvent.click(botao)
    expect(botao.className).toBe("composer-buzz buzzed")
  })
})

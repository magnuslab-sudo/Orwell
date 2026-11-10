import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { strings } from "../../strings.js"
import { OutroSeparador } from "./OutroSeparador.js"

/**
 * The screen for someone who is not the owner of the account in this browser.
 *
 * What matters to lock down: it says what is happening, offers ONE way out, and
 * does not let you tap twice while the request is in flight.
 */
afterEach(() => {
  cleanup()
})

describe("o ecrã de outro separador", () => {
  it("diz que a conta está aberta noutro separador e oferece usar este", () => {
    const onUsar = vi.fn()
    render(<OutroSeparador aPedir={false} onUsar={onUsar} />)
    expect(screen.getByText(strings.separadores.titulo)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: strings.separadores.usar }))
    expect(onUsar).toHaveBeenCalledTimes(1)
  })

  it("a pedir, o botão diz que está a pedir e não aceita outro clique", () => {
    const onUsar = vi.fn()
    render(<OutroSeparador aPedir onUsar={onUsar} />)
    const botao = screen.getByRole("button", { name: strings.separadores.aPedir })
    expect((botao as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(botao)
    expect(onUsar).not.toHaveBeenCalled()
  })
})

describe("o ecrã de outro separador, quando o outro não responde", () => {
  it("pergunta por extenso e só o segundo botão toma à força", () => {
    const onUsar = vi.fn()
    const onForcar = vi.fn()
    render(<OutroSeparador aPedir={false} semResposta onUsar={onUsar} onForcar={onForcar} />)
    expect(screen.getByRole("alert").textContent).toBe(strings.separadores.semResposta)
    expect(screen.queryByRole("button", { name: strings.separadores.usar })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: strings.separadores.forcar }))
    expect(onForcar).toHaveBeenCalledTimes(1)
    expect(onUsar).not.toHaveBeenCalled()
  })

  it("diz que há um convite ou um link de emparelhamento à espera neste separador", () => {
    render(<OutroSeparador aPedir={false} temConvite temEmparelhamento onUsar={() => {}} />)
    expect(screen.getByText(strings.separadores.temConvite)).toBeTruthy()
    expect(screen.getByText(strings.separadores.temEmparelhamento)).toBeTruthy()
  })

  it("sem convite nem emparelhamento não diz nada sobre eles", () => {
    render(<OutroSeparador aPedir={false} onUsar={() => {}} />)
    expect(screen.queryByText(strings.separadores.temConvite)).toBeNull()
  })
})

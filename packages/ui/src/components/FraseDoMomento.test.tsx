import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { readPrefs } from "../hooks/usePrefs.js"
import { definirLingua, strings } from "../strings.js"
import { FraseDoMomento } from "./FraseDoMomento.js"

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  definirLingua("pt")
})

describe("FraseDoMomento: uma vez cada, com um toque para fechar", () => {
  it('diz a frase e o "Entendi"', () => {
    render(<FraseDoMomento id="conta" />)
    expect(screen.getByText(strings.frasesDoMomento.conta)).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.frasesDoMomento.entendi })).toBeTruthy()
  })

  it('"Entendi" fecha-a, guarda-a como vista, e ela não volta', async () => {
    const pessoa = userEvent.setup()
    const { unmount } = render(<FraseDoMomento id="canal" />)
    await pessoa.click(screen.getByRole("button", { name: strings.frasesDoMomento.entendi }))
    expect(screen.queryByText(strings.frasesDoMomento.canal)).toBeNull()
    expect(readPrefs().frasesVistas).toEqual(["canal"])

    unmount()
    render(<FraseDoMomento id="canal" />)
    expect(screen.queryByText(strings.frasesDoMomento.canal)).toBeNull()
  })

  it("fechar uma não fecha as outras", async () => {
    const pessoa = userEvent.setup()
    render(
      <>
        <FraseDoMomento id="conta" />
        <FraseDoMomento id="canal" />
      </>,
    )
    await pessoa.click(screen.getAllByRole("button", { name: strings.frasesDoMomento.entendi })[0]!)
    expect(screen.queryByText(strings.frasesDoMomento.conta)).toBeNull()
    expect(screen.getByText(strings.frasesDoMomento.canal)).toBeTruthy()
  })

  it("em inglês", () => {
    definirLingua("en")
    render(<FraseDoMomento id="conta" />)
    expect(screen.getByText("Your account is a key on this device. Nobody can reset it. Keep your password safe.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Got it" })).toBeTruthy()
  })
})

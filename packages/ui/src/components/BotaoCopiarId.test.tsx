import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BotaoCopiarId } from "./BotaoCopiarId.js"
import { ToastProvider } from "./Toast.js"
import { en } from "../linguas/en.js"
import { pt } from "../linguas/pt.js"
import { nomeEmFalta } from "../lib/format.js"
import { strings } from "../strings.js"

afterEach(cleanup)

/**
 * "I do not want ids exposed" (owner order on 27 October 2026). The id
 * copies via this button, next to the name, and is never read.
 */
describe("BotaoCopiarId", () => {
  it("as palavras, nas duas línguas", () => {
    expect(pt.copiarId.de("Ana")).toBe("Copiar id de Ana")
    expect(pt.copiarId.proprio).toBe("Copiar o teu id")
    expect(pt.copiarId.copiado).toBe("id copiado")
    expect(en.copiarId?.copiado).toBe("id copied")
  })

  it("não mostra o id; o nome acessível e o balão nomeiam de quem é", () => {
    render(<BotaoCopiarId id="@ana-bela-casa-rio:orwell.pt" rotulo={strings.copiarId.de("Ana")} />)
    const botao = screen.getByRole("button", { name: strings.copiarId.de("Ana") })
    expect(botao.getAttribute("title")).toBe(strings.copiarId.de("Ana"))
    expect(botao.textContent).toBe("")
    expect(document.body.textContent).not.toContain("orwell.pt")
  })

  it('copia o id inteiro e diz "id copiado"', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, "writeText")
    render(
      <ToastProvider>
        <BotaoCopiarId id="@ana-bela-casa-rio:orwell.pt" rotulo={strings.copiarId.de("Ana")} />
      </ToastProvider>,
    )
    await user.click(screen.getByRole("button"))
    expect(writeText).toHaveBeenCalledWith("@ana-bela-casa-rio:orwell.pt")
    expect(await screen.findByText(strings.copiarId.copiado)).toBeTruthy()
  })

  it("numa linha clicável, copiar não abre a linha", () => {
    const abrir = vi.fn()
    render(
      <div onClick={abrir}>
        <BotaoCopiarId id="@ana:s" rotulo={strings.copiarId.de("Ana")} />
      </div>,
    )
    fireEvent.click(screen.getByRole("button"))
    expect(abrir).not.toHaveBeenCalled()
  })
})

/*
  Until 4 November 2026 the name was "Unnamed" for everyone. Changed to
  the first word of the address (owner order); the full proof is in
  `lib/nomeEmFalta.test.ts`. The full id remains the business of this button.
*/
describe("nomeEmFalta", () => {
  it("é a primeira palavra do endereço, e nunca o id inteiro", () => {
    expect(nomeEmFalta("@garbicis-xapsensis-giprete-birmyris:orwell.pt")).toBe("Garbicis")
    expect(nomeEmFalta()).toBe(strings.profile.noName)
  })
})

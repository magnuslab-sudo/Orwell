import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { translateError } from "../strings.js"
import { TextoDeErro } from "./TextoDeErro.js"

describe("TextoDeErro", () => {
  it("põe o código a negrito e deixa a frase por baixo, com a quebra no texto", () => {
    const { container } = render(
      <p className="error">
        <TextoDeErro texto={translateError("vault is locked")} />
      </p>,
    )
    expect(container.querySelector("strong")?.textContent).toBe("Erro 101")
    // `textContent` is still the full string: that is what screen readers read, and
    // `white-space: pre-line` draws the break.
    expect(container.querySelector("p")?.textContent).toBe("Erro 101\nO cofre está bloqueado.")
  })

  it("um aviso do catálogo, sem código, não leva negrito nenhum", () => {
    const { container } = render(<TextoDeErro texto={"Uma frase.\nE outra linha que não é código."} />)
    expect(container.querySelector("strong")).toBeNull()
    expect(container.textContent).toBe("Uma frase.\nE outra linha que não é código.")
  })

  it("o desconhecido leva o 900, a frase fixa, e a mensagem em cru mais pequena por baixo", () => {
    const { container } = render(<TextoDeErro texto={translateError("nunca visto")} />)
    expect(container.querySelector("strong")?.textContent).toBe("Erro 900")
    expect(container.querySelector("small.erro-em-cru")?.textContent).toBe("nunca visto")
    expect(container.textContent).toBe("Erro 900\nAconteceu um erro que a app não conhece.\nnunca visto")
  })

  it("um erro com código conhecido não tem linha em cru", () => {
    const { container } = render(<TextoDeErro texto={translateError("the call is full")} />)
    expect(container.querySelector("strong")?.textContent).toBe("Erro 425")
    expect(container.querySelector("small")).toBeNull()
  })
})

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { VerifyModal } from "./VerifyModal.js"

afterEach(cleanup)

describe("VerifyModal", () => {
  it("mostra o número de segurança em grupos, com o nome e o endereço", () => {
    render(
      <VerifyModal
        name="Alice"
        address="@abc:localhost:8448"
        number="A2B3 C4D5 E6F7 G8H2 J3K4"
        onClose={() => {}}
      />,
    )

    expect(screen.getByText("Verificar segurança")).toBeTruthy()
    expect(screen.getByText("Alice")).toBeTruthy()
    expect(screen.getByText("@abc:localhost:8448")).toBeTruthy()

    const groups = [...screen.getByTestId("safety-number").querySelectorAll("span")].map((node) => node.textContent)
    expect(groups).toEqual(["A2B3", "C4D5", "E6F7", "G8H2", "J3K4"])
    expect(screen.getByText(/Compara este número/)).toBeTruthy()
  })

  it("sem chave mostra o estado de erro e nenhum número", () => {
    render(<VerifyModal name="Alice" address="@abc:s" number={null} onClose={() => {}} />)
    expect(screen.getByText("Não foi possível verificar esta pessoa agora.")).toBeTruthy()
    expect(screen.queryByTestId("safety-number")).toBeNull()
  })
})

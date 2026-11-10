import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { useAtalhosDeFormatacao } from "./useAtalhosDeFormatacao.js"

afterEach(cleanup)

/**
 * A controlled text input, like the real ones.
 *
 * Controlled on purpose: that is where all the difficulty sits. The text lives
 * above, React redraws the box with the new value, and the selection the person
 * had vanishes in that redraw. An uncontrolled box would pass this test without
 * proving anything.
 */
function Caixa({ inicial = "", area = false }: { inicial?: string; area?: boolean }): React.JSX.Element {
  const [valor, setValor] = useState(inicial)
  const aoTeclar = useAtalhosDeFormatacao(valor, setValor)
  const comuns = {
    value: valor,
    onChange: (event: { target: { value: string } }) => setValor(event.target.value),
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      aoTeclar(event)
    },
    "aria-label": "escrita",
  }
  return area ? <textarea {...comuns} /> : <input {...comuns} />
}

/** Mark letters in the box, like dragging the mouse over them. */
function marcar(campo: HTMLInputElement | HTMLTextAreaElement, inicio: number, fim: number): void {
  campo.focus()
  campo.setSelectionRange(inicio, fim)
}

describe("useAtalhosDeFormatacao", () => {
  it("Cmd+B envolve o que está marcado", () => {
    render(<Caixa inicial="isto é urgente" />)
    const campo = screen.getByLabelText("escrita") as HTMLInputElement
    marcar(campo, 7, 14)
    fireEvent.keyDown(campo, { key: "b", metaKey: true })
    expect(campo.value).toBe("isto é **urgente**")
  })

  it("e a selecção continua sobre as mesmas letras, para o gesto seguinte", () => {
    // What makes a second Cmd+B undo the first without touching the mouse. Without
    // this, the controlled box would put the cursor at the end on every shortcut.
    render(<Caixa inicial="isto é urgente" />)
    const campo = screen.getByLabelText("escrita") as HTMLInputElement
    marcar(campo, 7, 14)
    fireEvent.keyDown(campo, { key: "b", metaKey: true })
    expect(campo.value.slice(campo.selectionStart!, campo.selectionEnd!)).toBe("urgente")
  })

  it("carregar duas vezes desfaz, e o texto volta ao que era", () => {
    render(<Caixa inicial="isto é urgente" />)
    const campo = screen.getByLabelText("escrita") as HTMLInputElement
    marcar(campo, 7, 14)
    fireEvent.keyDown(campo, { key: "b", metaKey: true })
    fireEvent.keyDown(campo, { key: "b", metaKey: true })
    expect(campo.value).toBe("isto é urgente")
  })

  it("os quatro atalhos escrevem os quatro marcadores", () => {
    const casos: [Record<string, unknown>, string][] = [
      [{ key: "b", ctrlKey: true }, "**palavra**"],
      [{ key: "i", ctrlKey: true }, "*palavra*"],
      [{ key: "X", ctrlKey: true, shiftKey: true }, "~~palavra~~"],
      [{ key: "E", ctrlKey: true, shiftKey: true }, "||palavra||"],
    ]
    for (const [tecla, esperado] of casos) {
      cleanup()
      render(<Caixa inicial="palavra" />)
      const campo = screen.getByLabelText("escrita") as HTMLInputElement
      marcar(campo, 0, 7)
      fireEvent.keyDown(campo, tecla)
      expect(campo.value, JSON.stringify(tecla)).toBe(esperado)
    }
  })

  it("sem nada marcado, abre o par e põe o cursor lá dentro", () => {
    render(<Caixa inicial="olá " />)
    const campo = screen.getByLabelText("escrita") as HTMLInputElement
    marcar(campo, 4, 4)
    fireEvent.keyDown(campo, { key: "b", metaKey: true })
    expect(campo.value).toBe("olá ****")
    expect([campo.selectionStart, campo.selectionEnd]).toEqual([6, 6])
  })

  it("funciona igual numa caixa de várias linhas, que é a das publicações", () => {
    render(<Caixa inicial="o fim" area />)
    const campo = screen.getByLabelText("escrita") as HTMLTextAreaElement
    marcar(campo, 2, 5)
    fireEvent.keyDown(campo, { key: "E", metaKey: true, shiftKey: true })
    expect(campo.value).toBe("o ||fim||")
  })

  it("uma tecla que não é atalho não é reclamada, e escreve-se na mesma", () => {
    // The guarantee that makes this bearable inside a box: without a modifier, the
    // keyboard belongs to whoever is typing. The hook says it did not handle it,
    // and the caller is free to handle it (that is how Enter still sends).
    render(<Caixa inicial="abc" />)
    const campo = screen.getByLabelText("escrita") as HTMLInputElement
    marcar(campo, 0, 3)
    fireEvent.keyDown(campo, { key: "b" })
    expect(campo.value).toBe("abc")
    fireEvent.keyDown(campo, { key: "Enter" })
    expect(campo.value).toBe("abc")
  })

  it("diz a quem chama se tratou da tecla ou não", () => {
    const tratados: boolean[] = []
    function Espia(): React.JSX.Element {
      const [valor, setValor] = useState("abc")
      const aoTeclar = useAtalhosDeFormatacao(valor, setValor)
      return (
        <input
          aria-label="espia"
          value={valor}
          onChange={(event) => setValor(event.target.value)}
          onKeyDown={(event) => tratados.push(aoTeclar(event))}
        />
      )
    }
    render(<Espia />)
    const campo = screen.getByLabelText("espia") as HTMLInputElement
    marcar(campo, 0, 3)
    fireEvent.keyDown(campo, { key: "b", metaKey: true })
    fireEvent.keyDown(campo, { key: "Enter" })
    expect(tratados).toEqual([true, false])
  })
})

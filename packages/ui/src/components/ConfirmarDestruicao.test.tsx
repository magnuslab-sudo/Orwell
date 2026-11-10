import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { strings } from "../strings.js"
import { ApagarConta, ConfirmarDestruicao } from "./ConfirmarDestruicao.js"

afterEach(cleanup)

/**
 * The typed-word sheet: delete account and kick out.
 *
 * The point is the ritual (the verb only activates with the word), the loose
 * comparison, the error that stays on screen, and that the three paths to
 * delete an account only differ in the channels phrase.
 */
function montar(fazer: () => Promise<void> | void = vi.fn()): { onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn()
  render(
    <ConfirmarDestruicao
      titulo="Expulsar Ana do canal"
      avisos={["Isto não tem volta."]}
      rotuloDoCampo='Escreve "Ana" para confirmar'
      palavra="Ana"
      verbo="Expulsar"
      fazer={fazer}
      onClose={onClose}
    />,
  )
  return { onClose }
}

const escrever = (texto: string): void => {
  fireEvent.change(screen.getByLabelText('Escreve "Ana" para confirmar'), { target: { value: texto } })
}
const verbo = (): HTMLButtonElement => screen.getByRole("button", { name: "Expulsar" }) as HTMLButtonElement

describe("ConfirmarDestruicao", () => {
  it("é um alertdialog, e o verbo só se arma com a palavra", () => {
    montar()
    expect(screen.getByRole("alertdialog", { name: "Expulsar Ana do canal" })).toBeTruthy()
    expect(verbo().disabled).toBe(true)
    escrever("An")
    expect(verbo().disabled).toBe(true)
    // Loose by design: capitals and spaces around it do not count.
    escrever("  ana ")
    expect(verbo().disabled).toBe(false)
    expect(verbo().className).toContain("danger")
  })

  it("o foco começa no campo da palavra", () => {
    montar()
    expect(document.activeElement).toBe(screen.getByLabelText('Escreve "Ana" para confirmar'))
  })

  it("Cancelar e Escape fecham sem fazer nada", () => {
    const fazer = vi.fn()
    const { onClose } = montar(fazer)
    fireEvent.click(screen.getByRole("button", { name: strings.confirmar.cancelar }))
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(fazer).not.toHaveBeenCalled()
  })

  it("uma falha fica na folha, com a razão, e o botão passa a tentar outra vez", async () => {
    montar(async () => {
      throw new Error("could not reach the homeserver")
    })
    escrever("Ana")
    fireEvent.click(verbo())
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.settings.destroyRetry })).toBeTruthy()
    // A palavra continua escrita.
    expect((screen.getByLabelText('Escreve "Ana" para confirmar') as HTMLInputElement).value).toBe("Ana")
  })

  it("com tudo bem, faz o gesto uma vez", async () => {
    const fazer = vi.fn(async () => {})
    montar(fazer)
    escrever("Ana")
    fireEvent.submit(verbo().closest("form") as HTMLFormElement)
    await waitFor(() => expect(fazer).toHaveBeenCalledOnce())
  })
})

describe("ApagarConta: um ritual nas três portas", () => {
  it.each([
    ["configuracoes", () => strings.settings.destroySteps],
    ["portao", () => strings.settings.destroyStepsGate],
    ["importar", () => strings.settings.destroyStepsImport],
  ] as const)("na porta %s, só a frase dos canais muda", (porta, frase) => {
    render(<ApagarConta porta={porta} fazer={vi.fn()} onClose={vi.fn()} />)
    const folha = screen.getByRole("alertdialog", { name: strings.settings.destroyTitle })
    expect(folha.textContent).toContain(strings.settings.destroyBody)
    expect(folha.textContent).toContain(strings.settings.destroyDetail)
    expect(folha.textContent).toContain(frase())
    expect(screen.getByLabelText(strings.settings.destroyConfirmLabel)).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.settings.destroyConfirm })).toBeTruthy()
  })
})

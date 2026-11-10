import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react"
import { strings } from "../strings.js"
import { ConfirmarProvider, useConfirmar } from "./useConfirmar.js"

afterEach(cleanup)

/**
 * The hook that lets you ask without state: `await confirmar({...})`.
 *
 * Binds the promise (yes only the verb), the queue (two questions do not
 * trample each other), the "no" of whoever unmounts with a question open, and
 * the hard fail of whoever asks without `ConfirmarProvider`.
 */
function montar(): { confirmar: ReturnType<typeof useConfirmar>; desmontar: () => void } {
  const { result, unmount } = renderHook(() => useConfirmar(), { wrapper: ConfirmarProvider })
  return { confirmar: result.current, desmontar: unmount }
}

describe("useConfirmar", () => {
  it("responde true com o verbo", async () => {
    const { confirmar } = montar()
    let resposta: Promise<boolean> | undefined
    act(() => {
      resposta = confirmar({ titulo: "Apagar a publicação?", verbo: "Apagar", destructive: true })
    })
    const dialogo = await screen.findByRole("alertdialog", { name: "Apagar a publicação?" })
    fireEvent.click(within(dialogo).getByRole("button", { name: "Apagar" }))
    await expect(resposta).resolves.toBe(true)
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("responde false com Cancelar e com Escape", async () => {
    const { confirmar } = montar()
    let primeira: Promise<boolean> | undefined
    act(() => {
      primeira = confirmar({ titulo: "Um?", verbo: "Sim" })
    })
    fireEvent.click(await screen.findByRole("button", { name: strings.confirmar.cancelar }))
    await expect(primeira).resolves.toBe(false)

    let segunda: Promise<boolean> | undefined
    act(() => {
      segunda = confirmar({ titulo: "Dois?", verbo: "Sim" })
    })
    await screen.findByRole("alertdialog", { name: "Dois?" })
    fireEvent.keyDown(document, { key: "Escape" })
    await expect(segunda).resolves.toBe(false)
  })

  it("duas perguntas fazem fila, e a segunda aparece depois da primeira", async () => {
    const { confirmar } = montar()
    let a: Promise<boolean> | undefined
    let b: Promise<boolean> | undefined
    act(() => {
      a = confirmar({ titulo: "Primeira?", verbo: "Sim" })
      b = confirmar({ titulo: "Segunda?", verbo: "Sim" })
    })
    expect(await screen.findByRole("alertdialog", { name: "Primeira?" })).toBeTruthy()
    expect(screen.queryByRole("alertdialog", { name: "Segunda?" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Sim" }))
    await expect(a).resolves.toBe(true)
    const segunda = await screen.findByRole("alertdialog", { name: "Segunda?" })
    fireEvent.click(within(segunda).getByRole("button", { name: strings.confirmar.cancelar }))
    await expect(b).resolves.toBe(false)
  })

  it("um duplo clique no verbo responde uma vez só", async () => {
    const { confirmar } = montar()
    let resposta: Promise<boolean> | undefined
    act(() => {
      resposta = confirmar({ titulo: "Uma vez?", verbo: "Sim" })
    })
    const verbo = await screen.findByRole("button", { name: "Sim" })
    fireEvent.click(verbo)
    fireEvent.click(verbo)
    await expect(resposta).resolves.toBe(true)
  })

  it("quem desmonta com a pergunta aberta responde não: nada se faz sem um sim", async () => {
    const { confirmar, desmontar } = montar()
    let resposta: Promise<boolean> | undefined
    act(() => {
      resposta = confirmar({ titulo: "Fica?", verbo: "Sim" })
    })
    await screen.findByRole("alertdialog")
    desmontar()
    await expect(resposta).resolves.toBe(false)
  })

  it("sem ConfirmarProvider, perguntar falha alto, e só quando se pergunta", async () => {
    const { result } = renderHook(() => useConfirmar())
    // Drawing does not fail: a screen mounted alone in a test stays up.
    expect(typeof result.current).toBe("function")
    await expect(result.current({ titulo: "?", verbo: "Sim" })).rejects.toThrow(/ConfirmarProvider/)
  })

  it("é o diálogo da casa, e nunca o nativo", async () => {
    const nativo = window.confirm
    let chamadas = 0
    window.confirm = () => {
      chamadas += 1
      return true
    }
    try {
      render(
        <ConfirmarProvider>
          <Perguntador />
        </ConfirmarProvider>,
      )
      fireEvent.click(screen.getByRole("button", { name: "perguntar" }))
      await screen.findByRole("alertdialog")
      expect(chamadas).toBe(0)
    } finally {
      window.confirm = nativo
    }
  })
})

function Perguntador(): React.JSX.Element {
  const confirmar = useConfirmar()
  return (
    <button type="button" onClick={() => void confirmar({ titulo: "Apagar?", verbo: "Apagar" })}>
      perguntar
    </button>
  )
}

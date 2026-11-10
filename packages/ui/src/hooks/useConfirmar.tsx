import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { Confirmar, type PedidoDeConfirmacao } from "../components/Confirmar.js"

type Perguntar = (pedido: PedidoDeConfirmacao) => Promise<boolean>

const ConfirmarContext = createContext<Perguntar | null>(null)

interface PerguntaEmCurso {
  id: number
  pedido: PedidoDeConfirmacao
}

/**
 * Who shows the questions, above the shell.
 *
 * One place only, like the warnings: whoever asks stores no state, just waits
 * for the answer. Two questions at once make a queue, and the second shows when
 * the first is answered. A question left unanswered when this unmounts answers
 * "no": nothing happens without a "yes".
 */
export function ConfirmarProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [fila, setFila] = useState<PerguntaEmCurso[]>([])
  const contador = useRef(0)
  const pendentes = useRef(new Map<number, (sim: boolean) => void>())

  const perguntar = useCallback<Perguntar>(
    (pedido) =>
      new Promise<boolean>((resolve) => {
        const id = ++contador.current
        pendentes.current.set(id, resolve)
        setFila((actual) => [...actual, { id, pedido }])
      }),
    [],
  )

  // Answer once and only once: a double click on the verb does not do the gesture twice.
  const responder = useCallback((id: number, sim: boolean): void => {
    const resolve = pendentes.current.get(id)
    if (!resolve) return
    pendentes.current.delete(id)
    setFila((actual) => actual.filter((pergunta) => pergunta.id !== id))
    resolve(sim)
  }, [])

  useEffect(() => {
    const porResponder = pendentes.current
    return () => {
      porResponder.forEach((resolve) => resolve(false))
      porResponder.clear()
    }
  }, [])

  const actual = fila[0]
  return (
    <ConfirmarContext.Provider value={perguntar}>
      {children}
      {actual && (
        <Confirmar
          key={actual.id}
          {...actual.pedido}
          onConfirmar={() => responder(actual.id, true)}
          onCancelar={() => responder(actual.id, false)}
        />
      )}
    </ConfirmarContext.Provider>
  )
}

/**
 * Ask before an irreversible action: `await confirmar({...})` returns `true`
 * only if the user tapped the verb.
 *
 * Outside a `ConfirmarProvider` the prompt fails loudly, and only when it runs:
 * a screen mounted alone in a test still renders, but a destructive action
 * never proceeds silently just because no one asked.
 */
export function useConfirmar(): Perguntar {
  const perguntar = useContext(ConfirmarContext)
  return useCallback<Perguntar>(
    (pedido) =>
      perguntar ? perguntar(pedido) : Promise.reject(new Error("useConfirmar precisa de um ConfirmarProvider por cima")),
    [perguntar],
  )
}

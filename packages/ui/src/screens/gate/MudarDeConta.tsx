import { useCallback, useContext, useEffect, useId, useState } from "react"
import type { ContaNaLista } from "@enclave/client-core"
import type { EnclaveBridge } from "../../bridge.js"
import { useBridge } from "../../App.js"
import { Button } from "../../components/Button.js"
import { Modal } from "../../components/Modal.js"
import { ToastContext } from "../../components/Toast.js"
import { strings, traduzirErro } from "../../strings.js"

/**
 * "Switch account" (owner request on November 3, 2026).
 *
 * A device can have multiple accounts, each with its own vault and remembered
 * session. Switching closes the open account (without forgetting its session)
 * and makes another active; the interface reloads and the gate opens it: on its
 * own, if its session is remembered, or with the password. Adding opens the
 * usual registration in a new empty account.
 *
 * The reload is intentional: the entire application (channels, friends, calls)
 * starts from the open account, and beginning from scratch is the only way to
 * keep nothing from the previous account on screen. This is what "Delete account"
 * and "Merge accounts" already do.
 */

/** Reload the interface. An object, so tests can swap it (jsdom does not let you spy on `reload`). */
export const pagina = { recarregar: (): void => window.location.reload() }

/** The accounts on this device, read on mount; `null` without a bridge that knows them. */
export function useContasDoAparelho(bridge: EnclaveBridge): ContaNaLista[] | null {
  const [contas, setContas] = useState<ContaNaLista[] | null>(null)
  useEffect(() => {
    if (!bridge.contas) return
    let vivo = true
    void bridge.contas
      .listar()
      .then(({ contas: lidas }) => {
        if (vivo) setContas(lidas)
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [bridge])
  return contas
}

/** The other accounts on this device that have a vault: the ones that can be opened. */
export function outrasContas(contas: readonly ContaNaLista[] | null): ContaNaLista[] {
  return (contas ?? []).filter((conta) => !conta.activa && conta.temCofre)
}

export function FolhaMudarDeConta({
  onClose,
  podeAcrescentar = true,
}: {
  onClose: () => void
  /** On a just-added empty account, adding another makes no sense. */
  podeAcrescentar?: boolean
}): React.JSX.Element {
  const bridge = useBridge()
  const toast = useContext(ToastContext)
  const heading = useId()
  const contas = useContasDoAparelho(bridge)
  const [aMudar, setAMudar] = useState(false)
  const outras = outrasContas(contas)

  const fazer = useCallback(
    (accao: () => Promise<unknown>) => {
      if (aMudar) return
      setAMudar(true)
      void accao()
        .then(() => pagina.recarregar())
        .catch((erro: Error) => {
          setAMudar(false)
          toast?.(traduzirErro(erro), "error")
        })
    },
    [aMudar, toast],
  )

  return (
    <Modal className="sheet narrow" labelledBy={heading} onClose={onClose}>
      <header className="sheet-header">
        <h2 id={heading}>{strings.contas.titulo}</h2>
        <Button variant="ghost" type="button" onClick={onClose}>
          {strings.common.close}
        </Button>
      </header>
      <div className="sheet-body">
        <p className="field-note">{strings.contas.lead}</p>
        {contas !== null && outras.length === 0 && <p className="field-note">{strings.contas.nenhumaOutra}</p>}
        {outras.map((conta) => (
          <div key={conta.id} className="mudar-de-conta-linha">
            <Button
              variant="ghost"
              type="button"
              className="wide"
              disabled={aMudar}
              onClick={() => fazer(() => bridge.contas?.mudar(conta.id) ?? Promise.resolve())}
            >
              {conta.nome || strings.contas.semNome}
            </Button>
            <p className="field-note">{conta.memorizada ? strings.contas.abreSozinha : strings.contas.pedeFrase}</p>
          </div>
        ))}
        {podeAcrescentar && (
          <>
            <Button
              variant="ghost"
              type="button"
              className="wide"
              disabled={aMudar}
              onClick={() => fazer(() => bridge.contas?.acrescentar() ?? Promise.resolve())}
            >
              {strings.contas.acrescentar}
            </Button>
            <p className="field-note">{strings.contas.acrescentarNota}</p>
          </>
        )}
      </div>
    </Modal>
  )
}

/**
 * The link in the gate and registration footer. Only appears when there is
 * ANOTHER account with a vault on this device: for someone with one account,
 * the gate stays the same.
 */
export function LigacaoMudarDeConta({
  rotulo = strings.contas.mudar,
  podeAcrescentar = true,
  disabled = false,
}: {
  rotulo?: string
  podeAcrescentar?: boolean
  disabled?: boolean
}): React.JSX.Element | null {
  const bridge = useBridge()
  const contas = useContasDoAparelho(bridge)
  const [aberta, setAberta] = useState(false)
  if (outrasContas(contas).length === 0) return null
  return (
    <>
      <p>
        <button type="button" className="gate-link" disabled={disabled} onClick={() => setAberta(true)}>
          {rotulo}
        </button>
      </p>
      {aberta && <FolhaMudarDeConta podeAcrescentar={podeAcrescentar} onClose={() => setAberta(false)} />}
    </>
  )
}

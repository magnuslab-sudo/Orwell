import { useContext, useId, useState } from "react"
import { useBridge } from "../../App.js"
import { Button } from "../../components/Button.js"
import { ToastContext } from "../../components/Toast.js"
import { Modal } from "../../components/Modal.js"
import { strings, traduzirErro } from "../../strings.js"
import { ImportAccount } from "./ImportAccount.js"
import { pagina } from "./MudarDeConta.js"

/**
 * "Sign in with another account", from the gate (phase 2 of the 0.9
 * settings plan).
 *
 * Import and pairing put the other account IN PLACE of this one. Anyone who
 * wants both on this device has the third option, "Add another account"
 * (owner request on November 3, 2026, see `MudarDeConta.tsx`): this account
 * stays, closed, and the login opens a new account next to it.
 *
 * **Choose first, delete at the end.** The first version of this sheet deleted
 * the account on this device BEFORE choosing the file. A file that then failed
 * (wrong password, wrong file, corrupted file) left the user with no account:
 * the one here no longer existed and the other did not come in. The order now
 * is the one that loses nothing to a mistake:
 *
 * - **Import**: `ImportAccount` with `replacing`. Chooses the file and rejects
 *   right away what does not have the shape of an account; asks for the file's
 *   password; asks "delete", with the password typed (`ApagarConta`); and only
 *   then imports. The core's `importVault` decrypts the file before writing a
 *   byte, and writes over the vault at once: if the password fails, the account
 *   on this device stays as it was.
 * - **Pair**: `Unlock` opens `Emparelhar` with `substituirConta`. The link and
 *   new key are chosen with the account on this device intact, and "delete" is
 *   asked at the key's "Continue". But the act of deleting is last: pairing runs
 *   in a provisional vault, memory-only (`vault.createProvisional`, core 1j),
 *   and the provisional only goes to disk, over the account on this device,
 *   after the new account loads and connects (`pairing.done`). A pairing that
 *   fails halfway deleted nothing. See
 *   `docs/planos/nucleo-1j-cofre-provisorio-relatorio.md`.
 *
 * Closing the sheet, at any step, deleted nothing: go back to the gate.
 */
type Passo = "escolher" | "importar"

export function EntrarComOutraConta({
  onDone,
  onEmparelhar,
  onClose,
}: {
  /** A conta importada abriu. */
  onDone: (address: string) => void
  /** Proceed to pairing. Nothing has been deleted yet. */
  onEmparelhar: () => void
  onClose: () => void
}): React.JSX.Element {
  const heading = useId()
  const bridge = useBridge()
  const toast = useContext(ToastContext)
  const [passo, setPasso] = useState<Passo>("escolher")
  const aImportar = passo === "importar"

  return (
    <Modal className="sheet narrow" labelledBy={heading} onClose={onClose}>
      <header className="sheet-header">
        <h2 id={heading}>{aImportar ? strings.gate.otherAccountImport : strings.gate.otherAccountTitle}</h2>
        <Button variant="ghost" type="button" onClick={onClose}>
          {strings.common.close}
        </Button>
      </header>

      {aImportar ? (
        <div className="sheet-body">
          <p className="field-note">{strings.gate.importLead}</p>
          {/* `replacing`: there is an account on this device, and
              `ImportAccount` itself asks "delete" before importing. */}
          <ImportAccount replacing onDone={onDone} />
        </div>
      ) : (
        <div className="sheet-body">
          <p className="field-note">{strings.outraConta.lead}</p>
          <Button variant="ghost" type="button" className="wide" onClick={() => setPasso("importar")}>
            {strings.gate.otherAccountImport}
          </Button>
          <p className="field-note warn">{strings.settings.destroyStepsImport}</p>
          <Button variant="ghost" type="button" className="wide" onClick={onEmparelhar}>
            {strings.gate.otherAccountPair}
          </Button>
          <p className="field-note warn">{strings.settings.destroyStepsPair}</p>
          {bridge.contas && (
            <>
              <Button
                variant="ghost"
                type="button"
                className="wide"
                onClick={() => {
                  void bridge.contas
                    ?.acrescentar()
                    .then(() => pagina.recarregar())
                    .catch((erro: Error) => toast?.(traduzirErro(erro), "error"))
                }}
              >
                {strings.contas.acrescentar}
              </Button>
              <p className="field-note">{strings.contas.acrescentarNota}</p>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}

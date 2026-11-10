import { useId } from "react"
import { Button } from "../../components/Button.js"
import { Modal } from "../../components/Modal.js"
import { strings } from "../../strings.js"

/**
 * What shows when macOS stops asking.
 *
 * The distinction that decides everything is `not-determined` against `denied`.
 * In the first case the system still opens its dialog on first try, and a sheet
 * of ours on top would be the application explaining what the system is asking
 * at the same time. In the second case the system opens nothing at all: capture
 * fails silently, and what the person sees is a button that does nothing.
 * `permissaoDeEcra` in the main process decides which of these two this is.
 *
 * **The sheet does not close when Settings opens, and that is the main decision
 * of this file.** The system panel opens on top, permission is granted there, and
 * the person comes back. On that return the restart warning is needed, closing
 * the sheet when clicking the button would erase it exactly when it becomes the
 * only thing that matters.
 */
export function ScreenPermission({
  onAbrirDefinicoes,
  onClose,
}: {
  onAbrirDefinicoes: () => void
  onClose: () => void
}): React.JSX.Element {
  const titulo = useId()

  return (
    <Modal className="sheet narrow" labelledBy={titulo} onClose={onClose}>
      <header className="sheet-header">
        <h2 id={titulo}>{strings.ecra.permissaoTitulo}</h2>
        <Button variant="ghost" type="button" onClick={onClose}>
          {strings.common.close}
        </Button>
      </header>

      <div className="sheet-body">
        <p className="field-note">{strings.ecra.permissaoCorpo}</p>
        {/* The warning stands out, not in small print after the rest: it is the
            sentence that decides whether the person can share today or concludes
            the product is broken. */}
        <p className="field-note warn">{strings.ecra.permissaoReiniciar}</p>
      </div>

      <div className="sheet-actions">
        <Button variant="ghost" type="button" onClick={onClose}>
          {strings.common.cancel}
        </Button>
        {/* An `x-apple.systempreferences:` address on the other side, not written
            instructions: "Settings > Privacy and Security > Screen Recording" are
            three names that changed translation between system versions. See
            `DEFINICOES_DE_GRAVACAO_DE_ECRA`. */}
        <Button variant="primary" type="button" onClick={onAbrirDefinicoes}>
          {strings.ecra.permissaoAbrir}
        </Button>
      </div>
    </Modal>
  )
}

import { useId } from "react"
import { Button } from "./Button.js"
import { Modal } from "./Modal.js"
import { strings } from "../strings.js"

/**
 * What to ask: title, body, and the button verb.
 *
 * The verb is required, and that's the point of this component. An "OK" button
 * confirms without saying what; "Delete channel" forces you to read what will
 * happen right where you tap.
 */
export interface PedidoDeConfirmacao {
  /** The question, short: "Delete "Direction"?". */
  titulo: string
  /** What happens, and what does not. Optional for obvious questions. */
  corpo?: string
  /** The action, as an infinitive or as it appears in menus: "Delete", "Leave channel". */
  verbo: string
  /** Red only for irreversible actions. See the rules in the canonical menus. */
  destructive?: boolean
}

/**
 * The home confirmation dialog, replacing `window.confirm`.
 *
 * The native version had three flaws: it doesn't follow the theme, the button
 * says "OK" not the verb, and in Electron it blocks the entire renderer while
 * open. This is the usual `Modal` with `role="alertdialog"`: Escape and
 * clicking outside cancel, Tab cycles within, and focus returns to the opener.
 *
 * **Focus starts on Cancel by design.** The `Modal` focuses the first focusable
 * element, and Cancel comes first. A stray Enter, coming from the action that
 * opened the prompt, cancels instead of destroying.
 */
export function Confirmar({
  titulo,
  corpo,
  verbo,
  destructive = false,
  onConfirmar,
  onCancelar,
}: PedidoDeConfirmacao & {
  onConfirmar: () => void
  onCancelar: () => void
}): React.JSX.Element {
  const titulado = useId()
  const descrito = useId()
  return (
    <Modal
      className="prompt confirmar"
      role="alertdialog"
      labelledBy={titulado}
      {...(corpo ? { describedBy: descrito } : {})}
      onClose={onCancelar}
    >
      <h2 id={titulado}>{titulo}</h2>
      {corpo && (
        <p id={descrito} className="confirmar-corpo">
          {corpo}
        </p>
      )}
      <div className="prompt-actions">
        <Button variant="ghost" type="button" onClick={onCancelar}>
          {strings.confirmar.cancelar}
        </Button>
        <Button variant={destructive ? "danger" : "primary"} type="button" onClick={onConfirmar}>
          {verbo}
        </Button>
      </div>
    </Modal>
  )
}

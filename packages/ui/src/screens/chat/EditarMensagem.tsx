import { useId, useState } from "react"
import { Button } from "../../components/Button.js"
import { Field } from "../../components/Field.js"
import { Modal } from "../../components/Modal.js"
import { strings } from "../../strings.js"

/**
 * Fix a sentence already sent.
 *
 * A dialog, not the input bar. The bar holds the draft of a sentence to be
 * sent, and writing over it to fix something else means losing what was half
 * written, and restoring it later if the fix is cancelled is extra state for
 * something done once a day.
 *
 * No time window, by owner decision on August 12, 2026, and with the edited
 * mark always visible in the conversation. The two go together: what you gain
 * from fixing a typo cannot be paid for with a conversation that changes under
 * someone who has already read it without noticing.
 *
 * Saving the same text sends nothing: an edit that fixes nothing would only
 * serve to put "(edited)" next to an unchanged sentence.
 */
export function EditarMensagem({
  texto,
  onGuardar,
  onClose,
}: {
  texto: string
  onGuardar: (texto: string) => void
  onClose: () => void
}): React.JSX.Element {
  const heading = useId()
  const [valor, setValor] = useState(texto)
  const mudou = valor.trim().length > 0 && valor !== texto

  return (
    <Modal
      className="sheet narrow"
      labelledBy={heading}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        if (mudou) onGuardar(valor)
      }}
    >
      <header className="sheet-header">
        <h2 id={heading}>{strings.chat.messageEdit}</h2>
        <Button variant="ghost" type="button" onClick={onClose}>
          {strings.common.close}
        </Button>
      </header>

      <div className="sheet-body">
        <Field label={strings.chat.messageEditLabel}>
          <input value={valor} onChange={(event) => setValor(event.target.value)} autoFocus autoComplete="off" />
        </Field>
        {/* Said before saving, not discovered after: the conversation will show
            this was changed, and anyone who already read it read the earlier version. */}
        <p className="field-note">{strings.chat.messageEditNote}</p>
      </div>

      <div className="sheet-actions">
        <Button variant="ghost" type="button" onClick={onClose}>
          {strings.common.cancel}
        </Button>
        <Button variant="primary" type="submit" disabled={!mudou}>
          {strings.chat.messageEditSave}
        </Button>
      </div>
    </Modal>
  )
}

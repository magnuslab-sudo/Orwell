import { useId, useState } from "react"
import { Button } from "../../components/Button.js"
import { Field } from "../../components/Field.js"
import { Modal } from "../../components/Modal.js"
import { strings, traduzirErro } from "../../strings.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"

/**
 * Create a category, empty, and waiting for rooms.
 *
 * This used to open the create rooms sheet, with the category field in focus,
 * and the stated reason was that a category does not exist alone: it is born
 * with the first room that declares it. That was true in the data model and
 * remained the wrong reason to do what was being done, the interface does not
 * have to expose the data model. Creating an organization and creating
 * something to organize are two gestures, and whoever wants the first is not
 * obliged to do the second.
 *
 * What the model now has to make this work is in `channel.category`: a record
 * that says the category exists and in what order it reads. Rooms still declare
 * it by writing its name, that is what fills it, and this record is only what
 * keeps it standing while it is empty.
 */
export function NewCategory({
  onSubmit,
  onCancel,
}: {
  onSubmit: (nome: string) => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const heading = useId()
  const [nome, setNome] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    // Without this the browser navigates and reloads the page in the middle of
    // publishing. See `RoomProperties`, where it took an afternoon to discover.
    event.preventDefault()
    if (busy) return
    const limpo = nome.trim()
    if (!limpo) {
      setError(strings.newCategory.nameRequired)
      return
    }
    setBusy(true)
    setError(null)
    void onSubmit(limpo).catch((cause: Error) => {
      setBusy(false)
      setError(traduzirErro(cause))
    })
  }

  return (
    <Modal className="sheet narrow" labelledBy={heading} onClose={onCancel} onSubmit={submit}>
      <header className="sheet-header">
        <h2 id={heading}>{strings.newCategory.title}</h2>
      </header>
      <p className="sheet-lead">{strings.newCategory.lead}</p>

      <div className="sheet-body">
        <Field label={strings.newCategory.nameLabel}>
          <input
            value={nome}
            onChange={(event) => setNome(event.target.value)}
            maxLength={64}
            placeholder={strings.newCategory.namePlaceholder}
            autoFocus
          />
        </Field>
        <p className="hint">{strings.newCategory.note}</p>
        {error && (
          <p className="error">
            <TextoDeErro texto={error} />
          </p>
        )}
      </div>

      <footer className="sheet-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>
          {strings.prompts.cancel}
        </Button>
        <Button variant="primary" type="submit" disabled={busy || !nome.trim()}>
          {busy ? strings.newCategory.creating : strings.newCategory.create}
        </Button>
      </footer>
    </Modal>
  )
}

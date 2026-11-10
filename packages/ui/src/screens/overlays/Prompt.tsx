import { useId, useState } from "react"
import { Button } from "../../components/Button.js"
import { Field } from "../../components/Field.js"
import { Modal } from "../../components/Modal.js"
import { strings } from "../../strings.js"

export function Prompt({
  title,
  label,
  placeholder,
  hint,
  initialValue = "",
  confirmLabel,
  onSubmit,
  onCancel,
}: {
  title: string
  label: string
  placeholder: string
  hint?: string
  /** The starting value, to change a name without typing it again. */
  initialValue?: string
  /** The button verb, when "Confirm" does not say what happens. */
  confirmLabel?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  const heading = useId()

  return (
    <Modal
      className="prompt"
      labelledBy={heading}
      onClose={onCancel}
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = value.trim()
        if (trimmed) onSubmit(trimmed)
      }}
    >
      <h2 id={heading}>{title}</h2>
      <Field label={label}>
        <input
          value={value}
          placeholder={placeholder}
          autoFocus
          onFocus={(event) => event.target.select()}
          onChange={(event) => setValue(event.target.value)}
        />
      </Field>
      {hint && <p className="field-note">{hint}</p>}
      <div className="prompt-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>
          {strings.prompts.cancel}
        </Button>
        <Button variant="primary" type="submit" disabled={value.trim().length === 0}>
          {confirmLabel ?? strings.prompts.confirm}
        </Button>
      </div>
    </Modal>
  )
}

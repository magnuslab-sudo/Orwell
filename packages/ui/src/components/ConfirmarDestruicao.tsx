import { useId, useState } from "react"
import { Button } from "./Button.js"
import { Field } from "./Field.js"
import { Modal } from "./Modal.js"
import { TextoDeErro } from "./TextoDeErro.js"
import { strings, traduzirErro } from "../strings.js"

/**
 * Confirmation with a typed word, for the two actions that have no undo for
 * anyone: delete account and remove someone from a channel.
 *
 * Typing the word is not ceremony for its own sake. A dialog you can tap
 * without reading is no barrier against habit, and these are the acts where a
 * mistake costs most. Everything else that is irreversible uses `Confirmar`,
 * which is the same sheet without the field: the same card, Cancel on the left
 * and the verb in red on the right.
 *
 * The comparison is loose by design, without capitals and without spaces
 * around it: failing on an accented capital would be friction with no safety
 * gain.
 *
 * **The error stays on screen, not in a toast that vanishes.** When `do` fails,
 * nothing was destroyed, and that's the most important news the sheet has to
 * give. The word stays typed, and the button now says it will try again.
 */
export function ConfirmarDestruicao({
  titulo,
  avisos,
  rotuloDoCampo,
  palavra,
  verbo,
  verboDepoisDeFalhar = strings.settings.destroyRetry,
  fazer,
  onClose,
}: {
  titulo: string
  /** What happens, in paragraphs. The first is the strong warning. */
  avisos: readonly string[]
  rotuloDoCampo: string
  palavra: string
  verbo: string
  verboDepoisDeFalhar?: string
  /** The action. A rejected promise leaves the sheet open, with the reason. */
  fazer: () => Promise<void> | void
  onClose: () => void
}): React.JSX.Element {
  const titulado = useId()
  const descrito = useId()
  const [escrito, setEscrito] = useState("")
  const [ocupado, setOcupado] = useState(false)
  const [falha, setFalha] = useState<string | null>(null)
  const armado = escrito.trim().toLowerCase() === palavra.trim().toLowerCase()

  const executar = (): void => {
    if (!armado || ocupado) return
    setOcupado(true)
    setFalha(null)
    void Promise.resolve()
      .then(fazer)
      .then(() => setOcupado(false))
      .catch((erro: Error) => {
        setOcupado(false)
        setFalha(traduzirErro(erro))
      })
  }

  const [primeiro, ...resto] = avisos
  return (
    <Modal
      className="prompt confirmar"
      role="alertdialog"
      labelledBy={titulado}
      describedBy={descrito}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        executar()
      }}
    >
      <h2 id={titulado}>{titulo}</h2>
      <div id={descrito} className="confirmar-avisos">
        {primeiro && <p className="field-note warn">{primeiro}</p>}
        {resto.map((aviso) => (
          <p key={aviso} className="confirmar-corpo">
            {aviso}
          </p>
        ))}
      </div>
      {falha !== null && (
        <p className="field-note warn" role="alert">
          <TextoDeErro texto={falha} />
        </p>
      )}
      <Field label={rotuloDoCampo}>
        <input
          value={escrito}
          onChange={(event) => setEscrito(event.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </Field>
      <div className="prompt-actions">
        <Button variant="ghost" type="button" onClick={onClose}>
          {strings.confirmar.cancelar}
        </Button>
        <Button variant="danger" type="submit" disabled={!armado || ocupado}>
          {falha === null ? verbo : verboDepoisDeFalhar}
        </Button>
      </div>
    </Modal>
  )
}

/**
 * Delete account on this device: the same sheet across all three paths.
 *
 * Settings, the gate ("Lost your account? Create a new one."), and Setup with
 * an existing vault. And at the gate, the two paths for "Sign in with another
 * account" (import and pair), each with its own phrase. There were three rituals
 * (a typed word, two `window.confirm` prompts in a row, two others), for the
 * same action and the same loss. Now it's one, and only the phrase about
 * channels changes: with the vault open the account leaves them before deleting;
 * with it closed there are no keys to do that, and the phrase states the cost
 * upfront.
 */
export function ApagarConta({
  porta,
  fazer,
  onClose,
}: {
  /** `join`: "Join to another account", in Devices (phase 8.2). */
  porta: "configuracoes" | "portao" | "importar" | "emparelhar" | "juntar"
  fazer: () => Promise<void> | void
  onClose: () => void
}): React.JSX.Element {
  const canais =
    porta === "configuracoes"
      ? strings.settings.destroySteps
      : porta === "portao"
        ? strings.settings.destroyStepsGate
        : porta === "importar"
          ? strings.settings.destroyStepsImport
          : porta === "juntar"
            ? strings.settings.destroyStepsJoin
            : strings.settings.destroyStepsPair
  return (
    <ConfirmarDestruicao
      titulo={strings.settings.destroyTitle}
      avisos={[strings.settings.destroyBody, strings.settings.destroyDetail, canais]}
      rotuloDoCampo={strings.settings.destroyConfirmLabel}
      palavra={strings.settings.destroyConfirmWord}
      verbo={strings.settings.destroyConfirm}
      fazer={fazer}
      onClose={onClose}
    />
  )
}

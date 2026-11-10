import { useId, useState } from "react"
import { Button } from "../../components/Button.js"
import { Field } from "../../components/Field.js"
import { Modal } from "../../components/Modal.js"
import { strings, traduzirErro } from "../../strings.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import type { Votacao } from "../../lib/votacoes.js"

/**
 * How many options fit, and how much space each gets.
 *
 * The same numbers from the `Poll` schema in the protocol, and they cannot
 * differ: an option longer than the schema accepts is a poll that the `catch`
 * throws away on the other side, and the writer would never know why. This is
 * where we refuse it, because this is where there is a person to tell.
 */
const OPCOES_MAX = 10
const OPCAO_MAX_LETRAS = 120
const PERGUNTA_MAX_LETRAS = 300

/** Two: a question with one answer is not a question. */
const OPCOES_INICIAIS = ["", ""]

/**
 * Create a poll, in a chat or on a board.
 *
 * The same form in both places: what comes out of here is the same structure,
 * and the caller decides whether it travels inside a message or a post.
 *
 * **The note at the end is not decoration, and it is why this form exists
 * instead of a text box.** It says the two things the creator must know before
 * creating, and both are design decisions, not accidents:
 *
 * 1. **Votes are visible.** In an end-to-end encrypted channel, everyone there
 *    decrypts everything the channel says. A vote that travels the same path is
 *    secret from the server and from no one else. Promising a secret vote was
 *    promising what encryption does not give.
 * 2. **There is no deadline.** There is no shared clock, a message timestamp is
 *    the sender's assertion, and without an arbiter a deadline would close at
 *    different times on each screen, accepting on one device a vote that another
 *    refused.
 *
 * The button only wakes up with a question and two written options, and that
 * is why the poll that comes out of here is always one the schema accepts.
 */
export function NovaVotacao({
  onSubmit,
  onCancel,
}: {
  onSubmit: (votacao: Votacao) => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const heading = useId()
  const [pergunta, setPergunta] = useState("")
  const [opcoes, setOpcoes] = useState<string[]>(OPCOES_INICIAIS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** The ones that are actually written. This list travels, not the fields. */
  const escritas = opcoes.map((opcao) => opcao.trim()).filter((opcao) => opcao !== "")
  const pronta = pergunta.trim() !== "" && escritas.length >= 2

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    // Without this the browser navigates and reloads the page mid-send. See
    // `NewRoom`, where the same line cost an afternoon.
    event.preventDefault()
    if (busy || !pronta) return
    setBusy(true)
    setError(null)
    void onSubmit({ question: pergunta.trim(), options: escritas }).catch((cause: Error) => {
      setBusy(false)
      setError(traduzirErro(cause))
    })
  }

  return (
    <Modal className="sheet narrow" labelledBy={heading} onClose={onCancel} onSubmit={submit}>
      <header className="sheet-header">
        <h2 id={heading}>{strings.votacao.titulo}</h2>
      </header>

      <div className="sheet-body">
        <Field label={strings.votacao.perguntaLabel}>
          <input
            value={pergunta}
            onChange={(event) => setPergunta(event.target.value)}
            maxLength={PERGUNTA_MAX_LETRAS}
            placeholder={strings.votacao.perguntaPlaceholder}
            autoFocus
          />
        </Field>

        <ul className="nova-votacao-opcoes">
          {opcoes.map((opcao, indice) => (
            <li key={indice} className="nova-votacao-opcao">
              <Field label={strings.votacao.opcaoLabel(indice + 1)}>
                <input
                  value={opcao}
                  onChange={(event) =>
                    setOpcoes((atuais) => atuais.map((item, i) => (i === indice ? event.target.value : item)))
                  }
                  maxLength={OPCAO_MAX_LETRAS}
                  placeholder={strings.votacao.opcaoPlaceholder}
                />
              </Field>
              {/* Remove only exists above the two: below that there is no poll,
                  and a button that always refuses is worse than none. */}
              {opcoes.length > OPCOES_INICIAIS.length && (
                <Button
                  type="button"
                  variant="ghost"
                  ariaLabel={strings.votacao.retirarOpcao(indice + 1)}
                  title={strings.votacao.retirarOpcao(indice + 1)}
                  onClick={() => setOpcoes((atuais) => atuais.filter((_, i) => i !== indice))}
                >
                  ×
                </Button>
              )}
            </li>
          ))}
        </ul>

        {opcoes.length < OPCOES_MAX ? (
          <Button type="button" variant="ghost" onClick={() => setOpcoes((atuais) => [...atuais, ""])}>
            {strings.votacao.acrescentar}
          </Button>
        ) : (
          /* The cap stated in words, instead of the button disappearing without
             explanation: an option that vanishes makes people doubt what they saw. */
          <p className="hint">{strings.votacao.opcoesCheias(OPCOES_MAX)}</p>
        )}

        <p className="nova-votacao-nota">{strings.votacao.nota}</p>
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
        <Button variant="primary" type="submit" disabled={busy || !pronta}>
          {strings.votacao.confirmar}
        </Button>
      </footer>
    </Modal>
  )
}

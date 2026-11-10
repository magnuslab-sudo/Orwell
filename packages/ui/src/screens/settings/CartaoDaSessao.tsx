import { useCallback, useEffect, useState } from "react"
import { useBridge } from "../../App.js"
import { Button } from "../../components/Button.js"
import { Field } from "../../components/Field.js"
import { Interruptor } from "../../components/Interruptor.js"
import { useToast } from "../../components/Toast.js"
import { TEMPOS_DE_BLOQUEIO, type BloqueioAutomatico } from "../../hooks/usePrefs.js"
import { strings, traduzirErro } from "../../strings.js"
import { CampoDeIdentidade } from "../gate/CampoDeIdentidade.js"
import { fraseDoCampo } from "../gate/fraseDoCampo.js"
import { CaixaMemorizar, type EstadoDoPortao } from "../gate/MemorizarSessao.js"
import { FolhaMudarDeConta } from "../gate/MudarDeConta.js"

/**
 * The "Session" card, under Account (F1 of the session memory).
 *
 * Three states, by this device's vault (F0):
 *
 * - **vault `os`** (desktop keychain only): no password, and "Sign out" would lock
 *   for the gate to open by itself afterwards. Sign out did nothing. Hides itself,
 *   with "Expire session", and a line explains why. "Set password" (F3) converts
 *   the vault, and from then on it is a vault like any other.
 * - **remembered session**: "Expire session" disappears (owner decision 3), with
 *   the line explaining why. "Sign out" forgets the session and locks.
 * - **no memory**: as it has always been.
 */
export function CartaoDaSessao({
  onLock,
  bloqueioAutomatico,
  onBloqueioAutomatico,
  onSessaoMudou,
}: {
  /** The vault is already locked when this runs; the shell goes back to the gate. */
  onLock: () => void
  bloqueioAutomatico: BloqueioAutomatico
  onBloqueioAutomatico: (minutos: BloqueioAutomatico) => void
  /** The state changed here (remember session on or off). See `useSessaoSemExpirar`. */
  onSessaoMudou?: (() => void) | undefined
}): React.JSX.Element {
  const bridge = useBridge()
  const toast = useToast()
  const [estado, setEstado] = useState<EstadoDoPortao | null>(null)
  const [aMudar, setAMudar] = useState(false)
  const [mudarDeConta, setMudarDeConta] = useState(false)
  /** The "Set password" form (F3), open. */
  const [aDefinir, setADefinir] = useState(false)
  const [erroDaFrase, setErroDaFrase] = useState<string | null>(null)
  const [aGravar, setAGravar] = useState(false)
  /** "Remember session" when setting: on, as at the gate (decision 1). */
  const [memorizarAoDefinir, setMemorizarAoDefinir] = useState(true)

  const ler = useCallback(() => {
    void Promise.resolve()
      .then(() => bridge.vault.status())
      .then((lido) => setEstado(lido ?? null))
      .catch(() => {})
  }, [bridge])
  useEffect(ler, [ler])

  const terminar = (): void => {
    void bridge.vault
      ?.lock()
      .then(onLock)
      .catch((error: Error) => toast(traduzirErro(error), "error"))
  }

  const mudarMemoria = (ligar: boolean): void => {
    if (!bridge.vault?.memorizar || aMudar) return
    setAMudar(true)
    void bridge.vault
      .memorizar(ligar)
      .then(() => onSessaoMudou?.())
      .catch((error: Error) => toast(traduzirErro(error), "error"))
      .finally(() => {
        setAMudar(false)
        ler()
      })
  }

  /*
    Reads the FIELDS, not the React state: the password manager also writes here
    (it sets `new-password` for itself), sometimes without any event. See
    `fraseDoCampo` and `preenchimentoDoGestor.test.tsx`.
  */
  const definir = (formulario: HTMLFormElement): void => {
    if (aGravar || !bridge.vault?.definirPalavraPasse) return
    const frase = fraseDoCampo(formulario, "new-password", "")
    const confirmacao = fraseDoCampo(formulario, "confirm-password", "")
    if (frase.length < 8) {
      setErroDaFrase(strings.gate.passphraseShort)
      return
    }
    if (frase !== confirmacao) {
      setErroDaFrase(strings.gate.passphraseMismatch)
      return
    }
    setErroDaFrase(null)
    setAGravar(true)
    const memorizarDepois = memorizarAoDefinir && estado?.memoriaDisponivel === true && Boolean(bridge.vault.memorizar)
    void bridge.vault
      .definirPalavraPasse(frase)
      .then(async () => {
        toast(strings.settings.palavraPasseDefinida)
        setADefinir(false)
        if (memorizarDepois) {
          await bridge.vault.memorizar?.(true).catch(() => toast(strings.gate.memorizarFalhou, "error"))
        }
        onSessaoMudou?.()
      })
      .catch((error: Error) => setErroDaFrase(traduzirErro(error)))
      .finally(() => {
        setAGravar(false)
        ler()
      })
  }

  const semPalavraPasse = estado?.protection === "os"
  const memorizada = estado?.sessaoMemorizada === true
  const sabeMemorizar = Boolean(bridge.vault?.memorizar) && estado?.memoriaDisponivel !== undefined

  return (
    <section className="card settings-card">
      <h2>{strings.definicoesNovas.sessao}</h2>
      {semPalavraPasse ? (
        <>
          <p className="field-note">{strings.settings.semPalavraPasse}</p>
          {bridge.vault?.definirPalavraPasse &&
            (aDefinir ? (
              <form
                className="definir-palavra-passe"
                onSubmit={(event) => {
                  event.preventDefault()
                  definir(event.currentTarget)
                }}
              >
                {/* The same name that the gate will use when asking to fill it. See `CampoDeIdentidade`. */}
                <CampoDeIdentidade />
                <Field label={strings.gate.devicePassphrase}>
                  <input type="password" name="new-password" autoComplete="new-password" autoFocus />
                </Field>
                <Field label={strings.gate.confirmPassphrase}>
                  <input type="password" name="confirm-password" autoComplete="new-password" />
                </Field>
                {estado?.memoriaDisponivel && bridge.vault.memorizar && (
                  <CaixaMemorizar ligada={memorizarAoDefinir} onMudar={setMemorizarAoDefinir} />
                )}
                {erroDaFrase && (
                  <p className="error" role="alert">
                    {erroDaFrase}
                  </p>
                )}
                <p className="field-note">{strings.settings.definirPalavraPasseNota}</p>
                <Button variant="primary" type="submit" disabled={aGravar}>
                  {strings.settings.definirPalavraPasse}
                </Button>
              </form>
            ) : (
              <Button variant="ghost" type="button" onClick={() => setADefinir(true)}>
                {strings.settings.definirPalavraPasse}
              </Button>
            ))}
        </>
      ) : (
        <>
          <Button variant="ghost" onClick={terminar}>
            {strings.settings.lockNow}
          </Button>
          {sabeMemorizar &&
            (estado?.memoriaDisponivel ? (
              <>
                <Interruptor
                  ligado={memorizada}
                  disabled={aMudar}
                  rotulo={strings.settings.memorizarSessao}
                  onMudar={mudarMemoria}
                />
                {memorizada && <p className="field-note">{strings.settings.memorizarSessaoNota}</p>}
              </>
            ) : (
              <p className="field-note">{strings.settings.memorizarSessaoIndisponivel}</p>
            ))}
          {memorizada ? (
            <p className="field-note">{strings.settings.sessaoNaoExpira}</p>
          ) : (
            <div className="choice">
              <p className="field-label">{strings.definicoesNovas.bloquearSozinho}</p>
              <div className="choice-row">
                {TEMPOS_DE_BLOQUEIO.map((minutos) => (
                  <button
                    key={minutos}
                    className={bloqueioAutomatico === minutos ? "chip on" : "chip"}
                    aria-pressed={bloqueioAutomatico === minutos}
                    onClick={() => onBloqueioAutomatico(minutos)}
                  >
                    {strings.definicoesNovas.tempoDeBloqueio(minutos)}
                  </button>
                ))}
              </div>
              <p className="field-note">{strings.definicoesNovas.bloquearSozinhoNota}</p>
            </div>
          )}
        </>
      )}
      {/* "Switch account": this account closes and stays on this device, with its session. */}
      {bridge.contas && (
        <Button variant="ghost" type="button" onClick={() => setMudarDeConta(true)}>
          {strings.contas.mudar}
        </Button>
      )}
      {mudarDeConta && <FolhaMudarDeConta onClose={() => setMudarDeConta(false)} />}
    </section>
  )
}

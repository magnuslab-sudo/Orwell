import { useCallback, useEffect, useRef, useState } from "react"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { parsePairLink, PRAZO_DO_ESTADO_MS } from "@enclave/client-core"
import { useBridge } from "../../App.js"
import type { PairEvento } from "../../bridge.js"
import { Button } from "../../components/Button.js"
import { ApagarConta } from "../../components/ConfirmarDestruicao.js"
import { Field } from "../../components/Field.js"
import { CampoDeIdentidade } from "./CampoDeIdentidade.js"
import { CaixaMemorizar, useMemorizarDepoisDeAbrir } from "./MemorizarSessao.js"
import { fraseDoCampo } from "./fraseDoCampo.js"
import { OrwellWordmark } from "../../components/Logo.js"
import { PalavrasDoSas } from "../../components/PalavrasDoSas.js"
import { strings, translateError, translatePairingError, traduzirErro } from "../../strings.js"
import { LeitorQr } from "../../components/LeitorQr.js"

/**
 * The mobile gate: join THIS device to an account that lives on the computer.
 *
 * Three pages, one question each, like `Setup`:
 *
 *  1. **The link.** Read by the camera (`LeitorQr`) or pasted. The QR just saves
 *     typing; what authenticates comes next.
 *  2. **This device's key.** A password (or the system keychain) for the vault that
 *     will store the conversations here. It's the same question as `Setup`, because
 *     it's the same vault.
 *  3. **The pairing.** Connect to the box, swap keys, and six words appear in large
 *     letters. The person confirms here AND on the computer. Only then does the
 *     certificate arrive; this device loads the identity, connects, and tells the
 *     computer it's ready.
 *  4. **The status** (phase 5), between certificate and entry: "getting your status",
 *     with the deadline in sight. If it doesn't arrive by deadline, you enter anyway
 *     and the end says so. A 0.5.7 computer doesn't send it, and the step doesn't
 *     appear.
 *
 * At the end, once, the two contract phrases: what this device sees from now on, and
 * that it doesn't have the account key. See `strings.pairing`.
 *
 * What this screen NEVER gets: the account's private key. What stays in the vault is
 * the public key, the certificate and this device's key, written by the core before
 * the `certificado` event reaches here.
 *
 * **With an account replacing** (`substituirConta`), the vault for this attempt is
 * PROVISIONAL (`vault.createProvisional`): it lives in memory, and the disk holds
 * the account here until the end. Only at `pairing.done`, after the new account has
 * loaded and connected, does the provisional go to disk over the old one. A pairing
 * that fails before then (expired link, network, "They're not" from the other side)
 * didn't delete anything: `pairing.cancel` drops the provisional, and the gate opens
 * the account here again.
 */
type Passo = "link" | "chave" | "emparelhar"

type Fase =
  | { que: "a-ligar" }
  | { que: "a-espera" }
  | { que: "sas"; palavras: string; confirmado: boolean }
  | { que: "estado"; ate: number }
  | { que: "a-entrar" }
  | { que: "concluido"; address: string; semEstado: boolean }
  | { que: "falhou"; razao: string }

export function Emparelhar({
  linkInicial,
  substituirConta = false,
  onDone,
  onBack,
}: {
  /** The link the page opened with, if it opened with one. */
  linkInicial?: string | null
  /**
   * There's an account on this device, and this pairing puts another in its place
   * ("Sign in with another account", in the gate). The "delete" prompt is asked at
   * the key's "Continue", but the account here only leaves the disk when the new one
   * is in: until then, the vault for this attempt is provisional. See the header and
   * `EntrarComOutraConta`.
   */
  substituirConta?: boolean
  onDone: (address: string) => void
  onBack: () => void
}): React.JSX.Element {
  const bridge = useBridge()
  const [passo, setPasso] = useState<Passo>(linkInicial ? "chave" : "link")
  const [link, setLink] = useState(linkInicial ?? "")
  const [aLer, setALer] = useState(false)
  const [erroDoLink, setErroDoLink] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState("")
  const [confirm, setConfirm] = useState("")
  // F3 of session memory: a new account is ALWAYS born with a password.
  // The vault from keychain only (`os`) stopped being offered: with it,
  // "Sign out" didn't sign anyone out. The ones that already exist convert to
  // Account > Session > "Set password".
  const useOs = false
  /** The platform has a place to memorize the session (F1). See `MemorizarSessao.tsx`. */
  const [memoriaDisponivel, setMemoriaDisponivel] = useState(false)
  /** "Memorize the session", on by default (owner's decision 1). */
  const [memorizar, setMemorizar] = useState(true)
  const memorizarDepoisDeAbrir = useMemorizarDepoisDeAbrir(bridge)
  // Read when the certificate arrives, inside an effect with other dependencies.
  const memorizarNoFim = useRef(false)
  memorizarNoFim.current = !useOs && memoriaDisponivel && memorizar
  const [erroDaChave, setErroDaChave] = useState<string | null>(null)
  const [fase, setFase] = useState<Fase>({ que: "a-ligar" })
  /** The vault was already created in this attempt: if it fails, delete before retry. */
  const cofreCriado = useRef(false)
  /**
   * The user already typed "delete" on this screen (`substituirConta`). A second
   * attempt does not ask again; the account on this device stays on disk as is,
   * until an attempt completes.
   */
  const apagarAceite = useRef(false)
  /** The new key passphrase, waiting for "delete" to be typed to proceed. */
  const [aApagar, setAApagar] = useState<string | null>(null)

  useEffect(() => {
    void bridge.vault
      .status()
      .then(({ memoriaDisponivel: memoria }) => {
        setMemoriaDisponivel(Boolean(memoria && bridge.vault.memorizar))
      })
      .catch(() => {})
  }, [bridge])

  const aceitarLink = (texto: string): void => {
    const lido = parsePairLink(texto)
    if (!lido) {
      setErroDoLink(strings.pairing.linkInvalid)
      return
    }
    setErroDoLink(null)
    setLink(texto.trim())
    setALer(false)
    setPasso("chave")
  }

  /**
   * Validates what is in the FIELDS, not what React thinks is there.
   *
   * The system manager also writes here (the `new-password` is for them), and
   * can do so without firing any event. If someone creates a vault with the
   * passphrase that React knew about, rather than what ended up in the field,    * they have no way to open it. See `fraseDoCampo`.
   */
  const validarChave = (frase: string, confirmacao: string): boolean => {
    if (useOs) return true
    if (frase.length < 8) {
      setErroDaChave(strings.gate.passphraseShort)
      return false
    }
    if (frase !== confirmacao) {
      setErroDaChave(strings.gate.passphraseMismatch)
      return false
    }
    setErroDaChave(null)
    return true
  }

  /** Listens to the core while on the third page. */
  useEffect(() => {
    if (passo !== "emparelhar" || !bridge.on.pair) return
    const desligar = bridge.on.pair((evento: PairEvento) => {
      switch (evento.fase) {
        case "ligado":
          setFase({ que: "a-espera" })
          return
        case "sas":
          setFase({ que: "sas", palavras: evento.palavras, confirmado: false })
          return
        case "estado":
          setFase({ que: "estado", ate: Date.now() + PRAZO_DO_ESTADO_MS })
          return
        case "certificado": {
          const semEstado = evento.estado === "em-falta"
          setFase({ que: "a-entrar" })
          void (async () => {
            const identity = await bridge.identity.load()
            await bridge.session.connect()
            await bridge.pairing?.done()
            // From here on the vault has an account: it stops being the empty vault
            // from this attempt and no one can destroy it on exit.
            cofreCriado.current = false
            // Only now is it stored: with a provisional vault, the vault key for this
            // device only becomes this one at `done`.
            await memorizarDepoisDeAbrir(memorizarNoFim.current)
            setFase({ que: "concluido", address: identity.address, semEstado })
          })().catch((erro: Error) => setFase({ que: "falhou", razao: traduzirErro(erro) }))
          return
        }
        case "falhou":
          setFase({ que: "falhou", razao: translatePairingError(evento.razao) })
          return
        case "aguarda":
        case "concluido":
          return
      }
    })
    return desligar
  }, [passo, bridge])

  /** The seconds remaining until the state deadline, to the second. */
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    if (fase.que !== "estado") return
    const relogio = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(relogio)
  }, [fase.que])

  const comecar = (formulario: HTMLFormElement | null): void => {
    const frase = fraseDoCampo(formulario, "new-password", passphrase)
    const confirmacao = fraseDoCampo(formulario, "confirm-password", confirm)
    if (!validarChave(frase, confirmacao)) return
    if (frase !== passphrase) setPassphrase(frase)
    // With an account being replaced, the "delete" confirmation happens NOW, before
    // pairing starts. Actual deletion only at the end (`pairing.done`).
    // Closing the sheet leaves the user on this page, with the account on this device intact.
    if (substituirConta && !apagarAceite.current) {
      setAApagar(frase)
      return
    }
    iniciar(frase)
  }

  const iniciar = (frase: string): void => {
    setPasso("emparelhar")
    setFase({ que: "a-ligar" })
    if (!bridge.pairing) {
      setFase({ que: "falhou", razao: translateError("this version of the app cannot do that") })
      return
    }
    const pairing = bridge.pairing
    const criarProvisorio = bridge.vault.createProvisional
    if (substituirConta && !criarProvisorio) {
      // Without a provisional vault, the only path was to delete the account on this device before the
      // link. We do not do this: better not to pair than to end up without an account.
      setFase({ que: "falhou", razao: translateError("this version of the app cannot do that") })
      return
    }
    void (async () => {
      // `frase` not `passphrase`: the state from this round is still the old one.
      if (substituirConta && criarProvisorio) {
        await criarProvisorio(useOs ? null : frase)
      } else {
        const { exists } = await bridge.vault.status()
        if (!exists) {
          await bridge.vault.create(useOs ? null : frase)
          cofreCriado.current = true
        }
      }
      await pairing.join(link)
    })().catch((erro: Error) => setFase({ que: "falhou", razao: translatePairingError(erro.message, erro.cause) }))
  }

  /**
   * Abandon this attempt without a trace.
   *
   * The vault is created BEFORE pairing starts (a password is needed to write
   * what comes), and a pairing that does not complete leaves it empty: with no
   * identity inside. Tomorrow's gate finds it, asks for the password, and
   * `loadIdentity` throws. So cancel and destroy on all exit paths, not just on
   * "try again".
   *
   * After the certificate the vault already has an account and `cofreCriado` is
   * false: exiting here does not touch it.
   *
   * With an account being replaced there is nothing to destroy: the attempt's
   * vault is provisional, and it is `pairing.cancel` that abandons it without
   * touching disk.
   */
  const abandonar = useCallback(async (): Promise<void> => {
    await bridge.pairing?.cancel().catch(() => {})
    if (cofreCriado.current) {
      await bridge.vault.destroy().catch(() => {})
      cofreCriado.current = false
    }
  }, [bridge])

  /** The "Back" button, on any page: abandons the attempt and then exits. */
  const sair = (): void => {
    void abandonar().then(onBack, onBack)
  }

  // And the same on unmount, which is how to exit from outside: close the tab,
  // reload, the shell switching screens. By ref so the effect does not run again
  // when the function rebuilds.
  const abandonarRef = useRef(abandonar)
  abandonarRef.current = abandonar
  useEffect(() => {
    return () => {
      void abandonarRef.current()
    }
  }, [])

  const tentarDeNovo = (): void => {
    void (async () => {
      await abandonar()
      setFase({ que: "a-ligar" })
      setPasso("link")
    })()
  }

  const responderSas = (iguais: boolean): void => {
    if (fase.que !== "sas") return
    if (iguais) {
      setFase({ ...fase, confirmado: true })
      void bridge.pairing?.confirm().catch((erro: Error) => setFase({ que: "falhou", razao: translatePairingError(erro.message, erro.cause) }))
    } else {
      void bridge.pairing?.refuse().catch(() => {})
      setFase({ que: "falhou", razao: translatePairingError("palavras-diferentes") })
    }
  }

  return (
    <div className="gate">
      <div className="gate-card gate-setup emparelhar">
        <header className="setup-head">
          <OrwellWordmark size={22} />
        </header>

        {passo === "link" && (
          <div className="setup-pane">
            <h1>{strings.pairing.joinTitle}</h1>
            <p className="gate-lead">{strings.pairing.joinLead}</p>
            {aLer ? (
              <LeitorQr onLido={aceitarLink} onCancelar={() => setALer(false)} />
            ) : (
              <Button variant="primary" type="button" onClick={() => setALer(true)}>
                {strings.pairing.scan}
              </Button>
            )}
            <form
              className="emparelhar-colar"
              onSubmit={(event) => {
                event.preventDefault()
                aceitarLink(link)
              }}
            >
              <Field label={strings.pairing.pasteLabel}>
                <input
                  value={link}
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={erroDoLink ? true : undefined}
                  onChange={(event) => {
                    setLink(event.target.value)
                    setErroDoLink(null)
                  }}
                />
              </Field>
              {erroDoLink && (
                <p className="error" role="alert">
                  {erroDoLink}
                </p>
              )}
              <div className="setup-actions">
                <Button variant="ghost" type="button" onClick={sair}>
                  {strings.gate.back}
                </Button>
                <Button variant="primary" type="submit" disabled={link.trim().length === 0}>
                  {strings.pairing.pasteAction}
                </Button>
              </div>
            </form>
          </div>
        )}

        {passo === "chave" && (
          <form
            className="setup-pane"
            onSubmit={(event) => {
              event.preventDefault()
              comecar(event.currentTarget)
            }}
          >
            <h1>{strings.pairing.keyTitle}</h1>
            <p className="gate-lead">{strings.pairing.keyLead}</p>
            {!useOs && (
              <>
                {/* The same name that `Unlock` will ask the manager to fill in, and it is
                    because they are the same that the manager recognizes an entry instead
                    of creating a new one. See `CampoDeIdentidade`. */}
                <CampoDeIdentidade />
                <Field label={strings.gate.devicePassphrase}>
                  <input
                    type="password"
                    name="new-password"
                    value={passphrase}
                    autoFocus
                    autoComplete="new-password"
                    placeholder={strings.gate.passphrasePlaceholder}
                    onChange={(event) => {
                      setPassphrase(event.target.value)
                      setErroDaChave(null)
                    }}
                  />
                </Field>
                <Field label={strings.gate.confirmPassphrase}>
                  <input
                    type="password"
                    name="confirm-password"
                    value={confirm}
                    autoComplete="new-password"
                    onChange={(event) => {
                      setConfirm(event.target.value)
                      setErroDaChave(null)
                    }}
                  />
                </Field>
                {memoriaDisponivel && <CaixaMemorizar ligada={memorizar} onMudar={setMemorizar} />}
              </>
            )}
            {erroDaChave && (
              <p className="error" role="alert">
                {erroDaChave}
              </p>
            )}
            <p className="gate-warning">{useOs ? strings.gate.warning : strings.gate.passphraseNote}</p>
            {substituirConta && !apagarAceite.current && (
              <p className="field-note warn">{strings.outraConta.pairKeyNote}</p>
            )}
            <div className="setup-actions">
              <Button variant="ghost" type="button" onClick={() => setPasso("link")}>
                {strings.gate.back}
              </Button>
              {/* No lock from the state: the field may have been filled by the
                  manager without firing any event, and a dead button next to
                  a full field makes no sense to anyone. The validator is
                  `validarChave`, which reads the field. See `fraseDoCampo`. */}
              <Button variant="primary" type="submit">
                {strings.gate.next}
              </Button>
            </div>
          </form>
        )}

        {passo === "emparelhar" && (
          <div className="setup-pane" aria-live="polite">
            {fase.que === "a-ligar" && (
              <>
                <h1>{strings.pairing.joinTitle}</h1>
                <p className="gate-lead">{strings.pairing.connecting}</p>
              </>
            )}
            {fase.que === "a-espera" && (
              <>
                <h1>{strings.pairing.joinTitle}</h1>
                <p className="gate-lead">{strings.pairing.waitingHost}</p>
              </>
            )}
            {fase.que === "sas" && (
              <>
                <h1>{strings.pairing.sasTitle}</h1>
                <p className="gate-lead">{strings.pairing.sasLead}</p>
                <PalavrasDoSas palavras={fase.palavras} />
                <p className="field-note">{strings.pairing.sasHistoricoAqui}</p>
                {fase.confirmado ? (
                  <p className="field-note" role="status">
                    {strings.pairing.sasConfirmedHere}
                  </p>
                ) : (
                  <div className="setup-actions sas-actions">
                    <Button variant="ghost" type="button" onClick={() => responderSas(false)}>
                      {strings.pairing.sasDifferent}
                    </Button>
                    <Button variant="primary" type="button" onClick={() => responderSas(true)}>
                      {strings.pairing.sasSame}
                    </Button>
                  </div>
                )}
              </>
            )}
            {fase.que === "estado" && (
              <>
                <h1>{strings.pairing.joinTitle}</h1>
                <p className="gate-lead">{strings.pairing.receivingState}</p>
                <p className="field-note">{strings.pairing.receivingStateLead}</p>
                <p className="field-note" role="timer">
                  {/* `agora` may be from before the step started: the deadline never goes past the integer. */}
                  {strings.pairing.stateDeadline(
                    Math.min(PRAZO_DO_ESTADO_MS / 1000, Math.max(0, Math.ceil((fase.ate - agora) / 1000))),
                  )}
                </p>
              </>
            )}
            {fase.que === "a-entrar" && (
              <>
                <h1>{strings.pairing.joinTitle}</h1>
                <p className="gate-lead">{strings.pairing.joining}</p>
              </>
            )}
            {fase.que === "concluido" && (
              <>
                <h1>{strings.pairing.doneTitle}</h1>
                <p className="gate-lead">{strings.pairing.doneBody}</p>
                {fase.semEstado && (
                  <p className="field-note warn" role="status">
                    {strings.pairing.stateMissing}
                  </p>
                )}
                <p className="gate-warning">{strings.pairing.doneGuestNote}</p>
                <div className="setup-actions">
                  <Button variant="primary" type="button" onClick={() => onDone(fase.address)}>
                    {strings.pairing.doneAction}
                  </Button>
                </div>
              </>
            )}
            {fase.que === "falhou" && (
              <>
                <h1>{strings.pairing.failedTitle}</h1>
                <p className="error" role="alert">
                  <TextoDeErro texto={fase.razao} />
                </p>
                <div className="setup-actions">
                  <Button variant="ghost" type="button" onClick={sair}>
                    {strings.gate.back}
                  </Button>
                  <Button variant="primary" type="button" onClick={tentarDeNovo}>
                    {strings.common.retry}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {aApagar !== null && (
        <ApagarConta
          porta="emparelhar"
          onClose={() => setAApagar(null)}
          fazer={async () => {
            // Nothing is deleted here: the "delete" is the authorization, and the action is
            // `pairing.done`, with the new account already inside. See the header.
            apagarAceite.current = true
            const frase = aApagar
            setAApagar(null)
            iniciar(frase)
          }}
        />
      )}
    </div>
  )
}

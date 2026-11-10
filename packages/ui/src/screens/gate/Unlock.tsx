import { useCallback, useEffect, useRef, useState } from "react"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { useBridge } from "../../App.js"
import { Button } from "../../components/Button.js"
import { ApagarConta } from "../../components/ConfirmarDestruicao.js"
import { Field } from "../../components/Field.js"
import { CampoDeIdentidade } from "./CampoDeIdentidade.js"
import { Emparelhar } from "./Emparelhar.js"
import { EntrarComOutraConta } from "./EntrarComOutraConta.js"
import { fraseDoCampo } from "./fraseDoCampo.js"
import { CaixaMemorizar, podeMemorizar, useEstadoDoCofre, useMemorizarDepoisDeAbrir } from "./MemorizarSessao.js"
import { LigacaoMudarDeConta, pagina } from "./MudarDeConta.js"
import { strings, traduzirErro } from "../../strings.js"
import { Splash } from "./Splash.js"

export function Unlock({
  onDone,
  onStartOver,
  semTentativaSilenciosa = false,
}: {
  /** The second is the connection that failed on entry, if it failed: the app opens anyway. */
  onDone: (address: string, ligacaoFalhou?: Error) => void
  /**
   * The vault on this device no longer exists: ask the host again what is on
   * disk, which is what the app uses to create the account.
   */
  onStartOver: () => void
  /**
   * Do not open by itself. After `device-revoked` (the device was removed from
   * the account on another device): with the system keychain, the silent attempt
   * opened, connected, got the same refusal and came back here, in a loop. The
   * gate stays still, with the text above, and the user decides.
   */
  semTentativaSilenciosa?: boolean
}): React.JSX.Element {
  const bridge = useBridge()
  const [passphrase, setPassphrase] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(!semTentativaSilenciosa)
  const [needsPassphrase, setNeedsPassphrase] = useState(semTentativaSilenciosa)
  const [aApagar, setAApagar] = useState(false)
  const [outraConta, setOutraConta] = useState(false)
  /** The pairing for "Sign in with another account", opened on top of the gate. */
  const [aEmparelhar, setAEmparelhar] = useState(false)
  /** The vault and the platform (F0): protection of this vault and where to store it. */
  const estado = useEstadoDoCofre(bridge)
  const caixa = podeMemorizar(bridge, estado)
  /** "Memorize the session", on by default (owner's decision 1). */
  const [memorizar, setMemorizar] = useState(true)
  const memorizarDepoisDeAbrir = useMemorizarDepoisDeAbrir(bridge)
  // Read at the moment of `attempt`, which is a `useCallback` without these dependencies.
  const memorizarAgora = useRef(false)
  memorizarAgora.current = caixa && memorizar

  const attempt = useCallback(
    (secret: string | null) => {
      setBusy(true)
      setError(null)
      void (async () => {
        let address: string
        try {
          await bridge.vault.unlock(secret)
          // With the text written and the box connected: memorize, before everything else.
          // A failure is reported and does not prevent sign in.
          if (secret !== null) await memorizarDepoisDeAbrir(memorizarAgora.current)
          address = (await bridge.identity.load()).address
        } catch (caught) {
          // Only a failure to OPEN the vault belongs here. The first attempt is
          // the silent one, using the system keychain; if that is not how this
          // vault was protected, ask — do not show an error.
          if (secret === null) setNeedsPassphrase(true)
          else setError(traduzirErro(caught))
          setBusy(false)
          return
        }

        /**
         * The vault is open. Go in, connected or not.
         *
         * Connecting used to sit inside the same try, so a homeserver that was
         * down — or a laptop with no network — turned a perfectly good unlock
         * into a passphrase prompt for a keychain vault that has no passphrase
         * to type. The account became unreachable offline, including every
         * message already stored on this device, and the only way out was to
         * wait for the server. A failed connection is what the banner and the
         * session's own reconnect loop are for.
         */
        /*
          Sign in anyway, but the failure does not stay quiet: it goes to whoever
          opens the app, shown in the connection banner. Swallowed here, an early
          connection that dropped before `auth.ok` opened an app with no channels
          and no sign of why.
        */
        let falha: Error | undefined
        await bridge.session.connect().catch((caught: Error) => {
          falha = caught
        })
        if (falha) onDone(address, falha)
        else onDone(address)
      })()
    },
    [onDone],
  )

  /**
   * Discard the vault on this device and start over.
   *
   * It is the only way out for those who forgot the password, and it is
   * destructive by design: the account lives here and nowhere else. Asks with
   * the same Settings sheet, password included (`ApagarConta`). These were two
   * `window.confirm` calls in a row, which on Electron blocked the window and
   * passed with two Enter presses without reading anything.
   *
   * A failure stays on the sheet, not at the gate: that is where the decision
   * was made.
   *
   * `vault.destroy` tries to leave channels before deleting, and with the vault
   * closed it has no keys to do so: no groups in memory or in the vault, so there
   * is nothing to leave and nothing throws. That is exactly the price the second
   * sentence of the warning announces.
   */
  const startOver = useCallback(async () => {
    await bridge.vault.destroy()
    // With another account on this device, the deleted one left the list and the active
    // one became the other: reload opens that. With one account only, sign up, as always.
    const restantes = bridge.contas ? (await bridge.contas.listar().catch(() => null))?.contas : null
    if (restantes?.some((conta) => conta.temCofre)) pagina.recarregar()
    else onStartOver()
  }, [onStartOver])

  // Exactly one silent attempt, even under StrictMode's double-mounted
  // effects: a second concurrent unlock+connect only races the first.
  const attempted = useRef(false)
  useEffect(() => {
    if (attempted.current || semTentativaSilenciosa) return
    attempted.current = true
    attempt(null)
  }, [])

  /*
    Leave pairing without a new account: if the one here is still on disk (the
    user went back before "delete"), go back to the gate; if already deleted,
    the gate has nothing to open, and ask the host what is on disk, like in
    "Create new". The disk says, not a flag in memory: `Pair` deletes the empty
    vault from the attempt on exit.
  */
  const sairDoEmparelhamento = useCallback(() => {
    void bridge.vault
      .status()
      .then(({ exists }) => (exists ? setAEmparelhar(false) : onStartOver()))
      .catch(() => onStartOver())
  }, [bridge, onStartOver])

  if (aEmparelhar) {
    return <Emparelhar substituirConta onDone={(address) => onDone(address)} onBack={sairDoEmparelhamento} />
  }

  if (busy && !needsPassphrase) return <Splash />

  /*
    Finding 9 (F0): a revoked device with an `os` vault, only from the system
    keychain. There is no password to write, and the field for it was useless.
    The text from 748 stays (above, in `App`) and "Start over".
  */
  if (semTentativaSilenciosa && estado?.protection === "os") {
    return (
      <div className="gate">
        <div className="gate-pilha">
          <div className="gate-card">
            <h1>{strings.gate.unlockTitle}</h1>
            <p className="gate-lead">{strings.gate.revogadoSemFrase}</p>
            <Button variant="primary" type="button" onClick={() => setAApagar(true)}>
              {strings.gate.comecarDeNovo}
            </Button>
          </div>
          {aApagar && <ApagarConta porta="portao" fazer={startOver} onClose={() => setAApagar(false)} />}
        </div>
      </div>
    )
  }

  return (
    <div className="gate">
      <div className="gate-pilha">
        {/*
          A real form, not a loose box with a button beside it.
          
          This is what Face ID delivers, and it is not a figure of speech: the
          vault from SYSTEM (Keychain on iOS, Manager on Android) is what
          `THREAT-MODEL.md` already names as the right place for the password,
          and on iPhone filling it from there goes through the face. In other
          words: the requested feature delivered by the system vault, without us
          inventing our own encryption or storing any key anywhere.
          
          A manager only offers to fill what it knows as a sign-in form: `<form>`,
          an identity field and a password marked as CURRENT. Until now the app
          asked to SAVE (Setup uses `new-password`) and never asked to fill, which
          is the most obvious gap the survey found.
          */}
        <form
          className="gate-card"
          onSubmit={(event) => {
            event.preventDefault()
            if (busy) return
            // What the FIELD has, not what React thinks it has: the system manager is who
            // we now invite to write here, and it can fill without firing any event. See
            // `fraseDoCampo`.
            attempt(fraseDoCampo(event.currentTarget, "password", passphrase))
          }}
        >
          <h1>{strings.gate.unlockTitle}</h1>
          <p className="gate-lead">{strings.gate.unlockLead}</p>
          {/* The key for the manager record. See `CampoDeIdentidade`. */}
          <CampoDeIdentidade />
          <Field label={strings.gate.passphrase}>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              autoFocus
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </Field>
          {caixa && <CaixaMemorizar ligada={memorizar} onMudar={setMemorizar} />}
          {error && (
            <p className="error">
              <TextoDeErro texto={error} />
            </p>
          )}
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? (
              <>
                {/* The spinning ring: the word alone looked like a stuck button. */}
                <span className="anel-ocupado" aria-hidden="true" />
                {strings.gate.opening}
              </>
            ) : (
              strings.gate.open
            )}
          </Button>
          {/*
            What is happening while nothing visible happens.

            Derivation takes between one and seven seconds on a phone, and until
            now it ran on the main thread: the screen froze, not a pixel changed,
            and looked the same as a stuck app. Now it runs in a Worker, the
            screen responds, and this is what it says.
          */}
          {busy && (
            <p className="field-note" role="status">
              {strings.gate.openingNote}
            </p>
          )}
        </form>
        {/* Two exits, one per line. The second is for those with an account who want
            ANOTHER on this device: by file or by pairing. */}
        <div className="gate-rodape">
          <p>
            {strings.gate.lostAccount}{" "}
            <button type="button" className="gate-link" disabled={busy} onClick={() => setAApagar(true)}>
              {strings.gate.lostAccountAction}
            </button>
          </p>
          <p>
            <button type="button" className="gate-link" disabled={busy} onClick={() => setOutraConta(true)}>
              {strings.gate.otherAccount}
            </button>
          </p>
          {/* Only with another account on this device: for those with one, the gate stays the same. */}
          <LigacaoMudarDeConta disabled={busy} />
          {/* No "How it works" here (owner, 28 October 2026: "remove the how it works
              from login"). The page stays in sign up (`Setup`) and in settings;
              the entry gate has only what is to enter. */}
        </div>
        {aApagar && <ApagarConta porta="portao" fazer={startOver} onClose={() => setAApagar(false)} />}
        {outraConta && (
          <EntrarComOutraConta
            onDone={(address) => onDone(address)}
            onEmparelhar={() => {
              setOutraConta(false)
              setAEmparelhar(true)
            }}
            onClose={() => setOutraConta(false)}
          />
        )}
      </div>
    </div>
  )
}

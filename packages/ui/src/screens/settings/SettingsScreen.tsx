import { temAnfitriaoDeAvisos } from "../../lib/notifications.js"
import { useEffect, useId, useRef, useState } from "react"
import { copiarTexto } from "../../lib/copiar.js"
import { useBridge } from "../../App.js"
import type { ConnectionState } from "../../bridge.js"
import { Button } from "../../components/Button.js"
import { ApagarConta } from "../../components/ConfirmarDestruicao.js"
import { ConnectionBanner } from "../../components/ConnectionBanner.js"
import { Interruptor } from "../../components/Interruptor.js"
import { CartaoDaSessao } from "./CartaoDaSessao.js"
import { EstadoDaSincronia } from "./EstadoDaSincronia.js"
import { SincronizarConta } from "./SincronizarConta.js"
import { Bloqueados } from "./Bloqueados.js"
import { PausaDasNotificacoes } from "./PausaDasNotificacoes.js"
import { PreviaDaCamara } from "./PreviaDaCamara.js"
import { Field } from "../../components/Field.js"
import { Modal } from "../../components/Modal.js"
import { useToast } from "../../components/Toast.js"
import { usePreferenciaDeLingua } from "../../hooks/useLingua.js"
import { useCamaras } from "../../hooks/useCamaras.js"
import { useMicrofones } from "../../hooks/useMicrofones.js"
import { readPrefs, REGRAS_DE_PEDIDOS, usePrefs } from "../../hooks/usePrefs.js"
import { CopyIcon, SetaParaTrasIcon } from "../../icons.js"
import { diagnosticsSnapshot, formatDiagnostics } from "../../lib/diagnostics.js"
import { connectionLabel } from "../../lib/format.js"
import { prefsDeMediaParaONucleo } from "../../lib/mediaPrefs.js"
import { VERSAO_DA_APP } from "../../lib/versao.js"
import { SeccaoDeSons } from "../../sons/SeccaoDeSons.js"
import { Aparelhos } from "./Aparelhos.js"
import { AtalhosDeVoz } from "./AtalhosDeVoz.js"
import { fraseDoCampo } from "../gate/fraseDoCampo.js"
import { LINGUAS, strings, traduzirErro } from "../../strings.js"
import { ConfiguracoesDeVoz } from "./ConfiguracoesDeVoz.js"
import { SensibilidadeDoMicrofone } from "./SensibilidadeDoMicrofone.js"
import { FolhaComoFunciona } from "./ComoFunciona.js"
import { seccaoValida, seccoes, type Seccao } from "./seccoes.js"

/** The public Orwell repository (AGPL-3.0, section 13). */
const CODIGO_FONTE = "https://github.com/magnuslab-sudo/orwell"

/**
 * Settings, and the honesty they force.
 *
 * Half of what a settings screen normally offers cannot exist here, and saying
 * why is more useful than hiding the absence: there is no server-side account
 * to change, no password to reset, and no push service to notify you when the
 * app is closed. Each of those is a consequence of the design, not a gap.
 *
 * **One section at a time, chosen from a menu on the left**, like Discord.
 * This used to be a continuous scroll with six stacked cards, and nobody
 * reached the sixth: finding the microphone gain meant scrolling past the
 * accent color, the address, and the warnings. With the menu, each section
 * starts at the top of the screen and the path to it is one word. The sections
 * and the reason for their order are in `seccoes.ts`.
 *
 * The paragraphs explaining each toggle below it are gone from here. "Mute
 * microphone" already says what it does; the line explaining it was noise that
 * pushed the next toggle off screen. What remains are the ones that say STATUS
 *, permission denied by the browser, microphones with no name yet, the warning
 * that the account lives on one device only, because these are facts the user
 * cannot guess from the label.
 */
export function SettingsScreen({
  address,
  connection,
  connectionDetail,
  onLock,
  onSessaoMudou,
  micMuted,
  soundOff,
  onToggleMic,
  onToggleSound,
  onEditProfile,
  seccao: pedida,
  onSeccao,
  bloqueados = [],
  nomeDe,
  onDesbloquear,
  microfoneDaChamada = null,
}: {
  address: string | null
  connection: ConnectionState
  connectionDetail: string | null
  /** The vault is already locked when this fires; the shell returns to the gate. */
  onLock: () => void
  /** "Remember session" changed on the "Session" card: whoever expires the session re-reads the state. */
  onSessaoMudou?: (() => void) | undefined
  /**
   * Microphone and sound come from above, not from `usePrefs()` here.
   *
   * The other options in this section are preferences and nothing else: they
   * write to disk and are read when someone requests a track. These two do not
   *, changing them must reach the engine via `bridge.call.setMuted`, right
   * now, or the user taps the toggle during a call and keeps being heard.
   *
   * The `usePrefs()` of this screen does not know the bridge, so a toggle
   * written with it would be a second path to the same state, that is how two
   * buttons that disagree with each other are born. What arrives here is the
   * same pair that the sidebar card and the call panel use.
   */
  micMuted: boolean
  soundOff: boolean
  onToggleMic: () => void
  onToggleSound: () => void
  /**
   * Opens the profile editor. The Account section had the address and little
   * else, and someone who came here to change their name could not find where.
   * When absent, it draws nothing.
   */
  onEditProfile?: (() => void) | undefined
  /**
   * Which section to show. It comes from above, and that is what breaks the
   * column.
   *
   * The menu used to live inside here, in its own column, and the app's
   * sidebar already showed "Settings" with an empty body next to it. Two
   * columns for the same thing, one of them empty. The menu moved to the
   * sidebar, which is the column that exists for that, and this screen became
   * just the panel.
   *
   * A string, not `Seccao`: an old id (`aspecto`, `voz`…) falls back to
   * Account. See `seccaoValida`.
   */
  seccao?: string | undefined
  /**
   * Pick another section. Only the phone uses it: there the sidebar menu lives
   * in a drawer, and the screen opens with the list of sections (1.3.6).
   * Without it, the screen shows the requested section, as on a wide screen.
   */
  onSeccao?: ((seccao: Seccao) => void) | undefined
  /** Who is blocked on this device. Comes from `useAmizade`, like the gesture. */
  bloqueados?: readonly { address: string; at: number }[] | undefined
  nomeDe?: ((address: string) => string) | undefined
  /** Without it, the "Blocked" section has no button to call and does not draw. */
  onDesbloquear?: ((address: string) => void) | undefined
  /**
   * The call's microphone, when there is a live call.
   *
   * Microphone tests (the meter and recording) use this track instead of
   * opening the microphone again. A second capture from the same device can
   * stop or change the call's: that was the owner's report, "you drop the call
   * when you go to settings, or you stop hearing the others".
   */
  microfoneDaChamada?: MediaStream | null | undefined
}): React.JSX.Element {
  const bridge = useBridge()
  const toast = useToast()
  const seccao = seccaoValida(pedida)
  /*
    The phone: the list of sections first, and the section after (1.3.6). See
    `useMenuNaGaveta`. `naLista` only counts where the menu lives in the drawer;
    on a wide screen the screen always shows the section.
  */
  const menuNaGaveta = useMenuNaGaveta() && onSeccao !== undefined
  const [naLista, setNaLista] = useState(true)
  const {
    prefs,
    setNotifications,
    setNotifyPreview,
    setSounds,
    setSoundVolume,
    setOutputVolume,
    setMediaPref: guardarMediaPref,
    setAtalhosDeVoz,
    setPreferencia,
  } = usePrefs()

  /*
    The language: stored here, and carried to the other devices in the account
    via the account channel (phase 5, `lib/preferenciasDaConta.ts`). `preferencia`
    and not the language to display, because they are different things and both
    appear on screen: someone on "Automatic" in an English system sees English,
    and what is marked is "Automatic". See `hooks/useLingua.ts`.
  */
  const { preferencia, escolher: escolherLingua } = usePreferenciaDeLingua()

  /**
   * Save the preference AND carry it to the engine, in the same gesture.
   *
   * The toggle used to write to disk and stop there. What carried the choice
   * to the engine was an effect tied to the SCREEN changing, and that is why
   * tweaking the noise suppressor mid-call did nothing. The user tweaked it,
   * heard the same thing, and rightly concluded that the toggle was broken.
   *
   * `applyMediaPrefs` is the usual path, and it applies to the live track
   * when there is one. A new path here would be a second truth about the same
   * microphone, which is how two buttons that disagree with each other are born.
   */
  const setMediaPref: typeof guardarMediaPref = (patch) => {
    guardarMediaPref(patch)
    // The list of keys lives in one place only. See `prefsDeMediaParaONucleo`, and
    // the bug that created it: sending less than all of them erases the rest.
    bridge.applyMediaPrefs?.(prefsDeMediaParaONucleo({ ...readPrefs(), ...patch }))
  }

  // Enumerated while this screen is open: this is where the list is used, and
  // it re-reads itself when someone plugs or unplugs headphones.
  const { microfones, nomeados: microfonesNomeados } = useMicrofones(true)
  // Cameras, only in the section where the list is shown.
  const { camaras, nomeadas: camarasNomeadas, reler: relerCamaras } = useCamaras(seccao === "media")

  // The browser's permission is a second, independent switch: ours can be on
  // while the browser's says no, and pretending otherwise produces a toggle
  // that silently does nothing.
  const supported = typeof Notification !== "undefined"
  // On the desktop app the main process shows warnings, and browser permission
  // does not matter: see `temAnfitriaoDeAvisos`.
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    temAnfitriaoDeAvisos() ? "granted" : supported ? Notification.permission : "unsupported",
  )
  const notificationsOn = prefs.notifications && permission === "granted"

  /**
   * The system notifications toggle. Turning it on asks for browser permission
   * if not granted yet: the browser only lets you ask from a gesture, and the
   * gesture is this one.
   */
  const mudarNotificacoes = (ligar: boolean): void => {
    if (!ligar) {
      setNotifications(false)
      return
    }
    if (permission === "granted") {
      setNotifications(true)
      return
    }
    void Notification.requestPermission().then((result) => {
      setPermission(result)
      if (result === "granted") setNotifications(true)
    })
  }

  /**
   * The session log, for a person reporting a problem.
   *
   * Read on render rather than subscribed to: this is a snapshot somebody
   * takes when something has already gone wrong, not a live view — and a live
   * view would re-render the settings screen on every arriving message.
   */
  const entryCount = diagnosticsSnapshot().length

  /** The log text, the same for copying and sending. No messages: see `diagnostics.ts`. */
  const textoDoRegisto = (): string =>
    formatDiagnostics(diagnosticsSnapshot(), {
      note: strings.settings.diagnosticsNote,
      address,
      connection: connectionDetail ? `${connection} — ${connectionDetail}` : connection,
    })

  const copyDiagnostics = (): void => {
    void copiarTexto(textoDoRegisto())
      .then(() => toast(strings.settings.diagnosticsCopied))
      .catch(() => toast(strings.common.copyFailed, "error"))
  }

  /**
   * "Send log" (phase 4): the same text, to the account server. One send at a
   * time: the button stays idle until the server answers, and two clicks in a
   * row do not waste two of the ten per hour.
   */
  const [aEnviar, setAEnviar] = useState(false)
  const enviarRegisto = (): void => {
    if (!bridge.relato || aEnviar) return
    setAEnviar(true)
    void bridge.relato
      .enviar({ texto: textoDoRegisto(), versao: VERSAO_DA_APP })
      .then(() => toast(strings.definicoesNovas.registoEnviado))
      .catch((error: Error) => toast(traduzirErro(error), "error"))
      .finally(() => setAEnviar(false))
  }

  const [confirmingDestroy, setConfirmingDestroy] = useState(false)
  /** The "How it works" page, opened on top of settings. */
  const [comoFunciona, setComoFunciona] = useState(false)
  /** Only OS-protected vaults (desktop) need this: the keychain cannot travel. */
  const [exportPassphrase, setExportPassphrase] = useState<string | null>(null)
  /**
   * Does this device have the account key? `null` while unknown, and on a host
   * that does not know how to pair: then it shows what has always been shown.
   */
  const [temChaveDeConta, setTemChaveDeConta] = useState<boolean | null>(null)
  useEffect(() => {
    if (!bridge.pairing) return
    let vivo = true
    void bridge.pairing
      .status()
      .then(({ temChaveDeConta: tem }) => {
        if (vivo) setTemChaveDeConta(tem)
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [bridge])

  const download = (data: string): void => {
    const blob = new Blob([data], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "conta.enclave"
    anchor.click()
    URL.revokeObjectURL(url)
    toast(strings.settings.exported)
  }

  /**
   * One export at a time.
   *
   * Exporting derives the key with Argon2id, and this button has TWO triggers
   * that do not exclude each other: Enter from the field and the click. Enter
   * with auto-repeat, or Enter then click, would start two derivations at once
   *, and with one shared worker, the second would wait the 60-second cap
   * before falling back to the main thread. Measured: 61 490 ms
   * (`scripts/prova-kdf-fronteira.mjs`). `kdf.ts` stopped killing a worker with
   * pending requests; this guard is the other half, and it prevents the work
   * from being done twice.
   */
  const aExportar = useRef(false)

  const exportAccount = (passphrase?: string): void => {
    if (aExportar.current) return
    aExportar.current = true
    void bridge.vault
      .export(passphrase)
      .then(({ data }) => {
        setExportPassphrase(null)
        download(data)
      })
      .catch((error: Error) => {
        // The desktop keychain cannot travel: ask for a passphrase to re-seal.
        if (error.message === "an export passphrase is required") setExportPassphrase("")
        else toast(traduzirErro(error), "error")
      })
      .finally(() => {
        aExportar.current = false
      })
  }

  if (menuNaGaveta && naLista) {
    return (
      <main className="main">
        <ConnectionBanner state={connection} detail={connectionDetail} />
        <header className="topbar">
          <h1>{strings.settings.title}</h1>
        </header>
        <nav className="settings-scroll settings-seccoes" aria-label={strings.settings.seccoesDoEcra}>
          {seccoes().map((entrada) => (
            <button
              key={entrada.id}
              type="button"
              className="settings-seccoes-item"
              onClick={() => {
                onSeccao?.(entrada.id)
                setNaLista(false)
              }}
            >
              {entrada.label}
            </button>
          ))}
        </nav>
      </main>
    )
  }

  return (
    <main className="main">
      <ConnectionBanner state={connection} detail={connectionDetail} />
      <header className="topbar">
        {menuNaGaveta && (
          <button
            type="button"
            className="settings-voltar"
            title={strings.settings.voltarAsSeccoes}
            aria-label={strings.settings.voltarAsSeccoes}
            onClick={() => setNaLista(true)}
          >
            <SetaParaTrasIcon size={18} />
          </button>
        )}
        <h1>{strings.settings.title}</h1>
      </header>

      <div className="settings-scroll">
        {seccao === "conta" && (
          <>
            <section className="card settings-card">
              <h2>{strings.settings.account}</h2>
              {onEditProfile && (
                <Button variant="primary" type="button" onClick={onEditProfile}>
                  {strings.settings.editProfile}
                </Button>
              )}
              {/* Button only: the id is not shown (owner's decision, October 27, 2026). It
                  remains what you give to anyone who wants to add you. */}
              <Button
                variant="ghost"
                disabled={!address}
                onClick={() => {
                  if (!address) return
                  void copiarTexto(address)
                    .then(() => toast(strings.copiarId.copiado))
                    .catch(() => toast(strings.common.copyFailed, "error"))
                }}
              >
                <CopyIcon size={15} />
                {strings.copiarId.proprio}
              </Button>
            </section>

            {/*
              The session: close the vault now, or by itself after a time with
              no use (mockup, Account › Session). Closing the vault is a session
              gesture, and the session belongs to the account. It used to be in
              "This Device", next to the button that deletes the account, which
              is the last place you want to reach by mistake. Self-closing is
              handled by `useBloqueioAutomatico`, in `App.tsx`.
              */}
            <CartaoDaSessao
              onLock={onLock}
              bloqueioAutomatico={prefs.bloqueioAutomatico}
              onBloqueioAutomatico={(minutos) => setPreferencia({ bloqueioAutomatico: minutos })}
              onSessaoMudou={onSessaoMudou}
            />

            {/*
              The language. A choice about this device, that does not change
              anything others see. It used to be in Appearance, which is gone;
              now it is in Account, which is where you look for what is about
              the app user.
              
              "Automatic" is the first pill because it is the factory state, and
              language names are each in their own language. See `strings.ts`.
              */}
            <section className="card settings-card">
              <h2>{strings.settings.language}</h2>
              <div className="choice-row">
                <button
                  className={preferencia === "auto" ? "chip on" : "chip"}
                  aria-pressed={preferencia === "auto"}
                  onClick={() => escolherLingua("auto")}
                >
                  {strings.settings.languageAuto}
                </button>
                {LINGUAS.map((entrada) => (
                  <button
                    key={entrada.codigo}
                    className={preferencia === entrada.codigo ? "chip on" : "chip"}
                    aria-pressed={preferencia === entrada.codigo}
                    onClick={() => escolherLingua(entrada.codigo)}
                  >
                    {entrada.nome}
                  </button>
                ))}
              </div>
              <p className="field-note">{strings.settings.languageNote}</p>
            </section>
          </>
        )}

        {seccao === "avisos" && (
          <section className="card settings-card">
            <h2>{strings.settings.notifications}</h2>
            {/*
              One toggle, not two buttons that swapped places. The states that
              the browser enforces still appear spelled out: no support means no
              toggle at all; blocked, the toggle stays idle and the text says
              where to unblock it.
            */}
            {permission === "unsupported" ? (
              <p className="field-note warn">{strings.settings.notifUnsupported}</p>
            ) : (
              <>
                <Interruptor
                  ligado={notificationsOn}
                  disabled={permission === "denied"}
                  rotulo={strings.settings.notifSystem}
                  onMudar={mudarNotificacoes}
                />
                {permission === "denied" && <p className="field-note warn">{strings.settings.notifBlocked}</p>}
                {notificationsOn && (
                  <Interruptor
                    ligado={prefs.notifyPreview}
                    rotulo={strings.settings.notifPreview}
                    onMudar={setNotifyPreview}
                  />
                )}
              </>
            )}

            {/* MSN-style warnings (item 6, and the others since November 3, 2026).
                Outside browser permission: without it the warning shows inside
                the app, with sound. One toggle per type. */}
            <h3 className="settings-subtitulo">{strings.settings.avisosDeAmigos}</h3>
            <Interruptor
              ligado={prefs.avisarAmigosOnline}
              rotulo={strings.settings.avisarAmigosOnline}
              onMudar={(avisarAmigosOnline) => setPreferencia({ avisarAmigosOnline })}
            />
            <Interruptor
              ligado={prefs.avisarAmigosNaVoz}
              rotulo={strings.settings.avisarAmigosNaVoz}
              onMudar={(avisarAmigosNaVoz) => setPreferencia({ avisarAmigosNaVoz })}
            />
            <Interruptor
              ligado={prefs.avisarAmigosNoEcra}
              rotulo={strings.settings.avisarAmigosNoEcra}
              onMudar={(avisarAmigosNoEcra) => setPreferencia({ avisarAmigosNoEcra })}
            />
            <Interruptor
              ligado={prefs.avisarAmigosNaComunidade}
              rotulo={strings.settings.avisarAmigosNaComunidade}
              onMudar={(avisarAmigosNaComunidade) => setPreferencia({ avisarAmigosNaComunidade })}
            />
            <p className="field-note">{strings.settings.avisarAmigosOnlineNota}</p>

            {/* Pause covers both system warnings and sounds, so it sits between
                them and shows even without browser permission. */}
            <PausaDasNotificacoes pausaAte={prefs.pausaAte} onMudar={(pausaAte) => setPreferencia({ pausaAte })} />

            {/* Sounds: a separate toggle from system warnings. Does not need
                browser permission and never leaves this page. See
                `sons/SeccaoDeSons.tsx`. */}
            <SeccaoDeSons
              ligado={prefs.sounds}
              volume={prefs.soundVolume}
              onLigado={setSounds}
              onVolume={setSoundVolume}
            />
          </section>
        )}

        {/*
          Microphone and camera.
          
          Everything here happens on the speaker's machine, before a single
          byte leaves. That is why it can be enabled without hesitation, almost
          everything else that improves audio involves sending the voice to a
          server.
          */}
        {seccao === "media" && (
          <>
            <section className="card settings-card">
              <h2>{strings.settings.media}</h2>

              {/* First whether the microphone is on, then how it sounds: the options
                  below deal with a voice that is already going out, and it makes
                  no sense to tune it before you say whether it goes out. */}
              <div className="choice">
                <label className="checkbox">
                  <input type="checkbox" checked={micMuted} onChange={onToggleMic} />
                  {strings.settings.micMuted}
                </label>

                <label className="checkbox">
                  <input type="checkbox" checked={soundOff} onChange={onToggleSound} />
                  {strings.settings.soundOff}
                </label>
              </div>

              {/*
                Which microphone to open, and the problem that devices have no
                name.
                
                The list always exists; the NAMES only after someone grants
                microphone access once. Before that, showing "Microphone 1,
                Microphone 2" was offering a choice you cannot make, so what
                appears is the explanation of what is missing, and the list comes
                when it is useful. See `useMicrofones`.
                */}
              <div className="choice">
                <p className="field-label">{strings.settings.inputDevice}</p>
                {microfonesNomeados ? (
                  <select
                    className="field"
                    value={prefs.inputDeviceId}
                    aria-label={strings.settings.inputDevice}
                    onChange={(event) => setMediaPref({ inputDeviceId: event.target.value })}
                  >
                    <option value="">{strings.call.inputDeviceDefault}</option>
                    {microfones.map((microfone) => (
                      <option key={microfone.deviceId} value={microfone.deviceId}>
                        {microfone.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="field-note">
                    {microfones.length === 0 ? strings.call.inputDevicesNone : strings.call.inputDevicesLocked}
                  </p>
                )}
              </div>

              {/* Fixed gain: a choice for someone who knows their microphone is low.
                  100% is no processing at all. */}
              <div className="choice">
                <p className="field-label">{strings.settings.inputGain}</p>
                <div className="sound-row">
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={10}
                    value={Math.round(prefs.inputGain * 100)}
                    aria-label={strings.settings.inputGain}
                    onChange={(event) => setMediaPref({ inputGain: Number(event.target.value) / 100 })}
                  />
                  <span className="sound-value">{Math.round(prefs.inputGain * 100)}%</span>
                </div>
              </div>

              {/* And the other side: how loud everyone is heard. Above 100% the sound
                  goes through an audio graph with a limiter, which is what lets
                  you go past the media element's cap without tearing anything. */}
              <div className="choice">
                <p className="field-label">{strings.settings.outputVolume}</p>
                <div className="sound-row">
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={10}
                    value={Math.round(prefs.outputVolume * 100)}
                    aria-label={strings.settings.outputVolume}
                    onChange={(event) => setOutputVolume(Number(event.target.value) / 100)}
                  />
                  <span className="sound-value">{Math.round(prefs.outputVolume * 100)}%</span>
                </div>
              </div>

              {/* Each entry into a call starts muted. The muting happens in `App.tsx`
                  when you join; this just stores the choice. */}
              <Interruptor
                ligado={prefs.entrarSilenciado}
                rotulo={strings.definicoesNovas.entrarSilenciado}
                onMudar={(entrarSilenciado) => setPreferencia({ entrarSilenciado })}
              />
            </section>

            {/*
              Noise reduction and the test. "Cancel echo" goes in there, under
              the profiles: it is the only one of the browser options that stayed,
              because only the browser cancels echo. The other three ("Reduce
              background noise", "Level the volume", "Filter rumble") did worse
              than what the profile already does; they left the screen and the
              stored preference still reaches the engine as before.
            */}
            <ConfiguracoesDeVoz emChamada={microfoneDaChamada !== null}>
              <Interruptor
                ligado={prefs.echoCancellation}
                rotulo={strings.settings.echoCancellation}
                onMudar={(ligado) => setMediaPref({ echoCancellation: ligado })}
              />
              <p className="field-note">{strings.settings.echoCancellationNota}</p>
            </ConfiguracoesDeVoz>

            {/* Microphone sensitivity: automatic, or the manual line with the live
                meter. Per device, via the same path as other media choices
                (`setMediaPref`), which applies it right away to the live chain. */}
            <SensibilidadeDoMicrofone
              automatica={prefs.sensibilidadeAutomatica}
              limiar={prefs.limiarDoMicrofone}
              emChamada={microfoneDaChamada !== null}
              onMudar={setMediaPref}
            />

            <section className="card settings-card">
              <h2>{strings.settings.camara}</h2>
              {/* Which camera to open, with the same rules as the microphone: the list
                  only when names are readable. Reaches the engine via the same
                  path as other media choices (`prefsDeMediaParaONucleo`). */}
              <div className="choice">
                <p className="field-label">{strings.definicoesNovas.camaraAparelho}</p>
                {camarasNomeadas ? (
                  <select
                    className="field"
                    value={prefs.videoDeviceId}
                    aria-label={strings.definicoesNovas.camaraAparelho}
                    onChange={(event) => setMediaPref({ videoDeviceId: event.target.value })}
                  >
                    <option value="">{strings.definicoesNovas.camaraDoSistema}</option>
                    {camaras.map((camara) => (
                      <option key={camara.deviceId} value={camara.deviceId}>
                        {camara.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="field-note">
                    {camaras.length === 0 ? strings.definicoesNovas.camarasNenhuma : strings.definicoesNovas.camarasSemNome}
                  </p>
                )}
              </div>
              <div className="choice">
                <p className="field-label">{strings.settings.videoQuality}</p>
                <div className="kind-choice">
                  {(["auto", "360p", "720p", "1080p"] as const).map((nivel) => (
                    <Button
                      key={nivel}
                      variant={prefs.videoQuality === nivel ? "primary" : "ghost"}
                      onClick={() => setMediaPref({ videoQuality: nivel })}
                    >
                      {nivel === "auto" ? strings.settings.videoAuto : nivel}
                    </Button>
                  ))}
                </div>
              </div>
              <Interruptor
                ligado={prefs.espelharCamara}
                rotulo={strings.definicoesNovas.espelhar}
                onMudar={(espelharCamara) => setPreferencia({ espelharCamara })}
              />
              <p className="field-note">{strings.definicoesNovas.espelharNota}</p>
              <PreviaDaCamara deviceId={prefs.videoDeviceId} emChamada={microfoneDaChamada !== null} aoAbrir={relerCamaras} />
            </section>

            {/*
              The game overlay, desktop app only: the browser has no window
              above another app. The main process shows and hides it
              (`apps/client/src/main/overlay-controlador.ts`); we only store
              the choice here, which `App.tsx` passes to us.
            */}
            {bridge.overlay && (
              <section className="card settings-card" aria-label={strings.overlayDeJogo.titulo}>
                <h2>{strings.overlayDeJogo.titulo}</h2>
                <Interruptor
                  ligado={prefs.overlayDeJogoLigada}
                  rotulo={strings.overlayDeJogo.ligar}
                  onMudar={(overlayDeJogoLigada) => setPreferencia({ overlayDeJogoLigada })}
                />
                <p className="field-note">{strings.overlayDeJogo.nota}</p>
                <p className="field-note">{strings.overlayDeJogo.ecraInteiro}</p>
                <div className="choice">
                  <p className="field-label">{strings.overlayDeJogo.opacidade}</p>
                  <div className="sound-row">
                    <input
                      type="range"
                      min={20}
                      max={100}
                      step={5}
                      value={Math.round(prefs.opacidadeDaOverlay * 100)}
                      aria-label={strings.overlayDeJogo.opacidade}
                      disabled={!prefs.overlayDeJogoLigada}
                      onChange={(event) => setPreferencia({ opacidadeDaOverlay: Number(event.target.value) / 100 })}
                    />
                    <span className="sound-value">{Math.round(prefs.opacidadeDaOverlay * 100)}%</span>
                  </div>
                </div>
                <p className="field-note">{strings.overlayDeJogo.atalhoNota}</p>
                <div>
                  <Button variant="ghost" disabled={!prefs.overlayDeJogoLigada} onClick={() => bridge.overlay?.repor()}>
                    {strings.overlayDeJogo.repor}
                  </Button>
                </div>
              </section>
            )}

            <AtalhosDeVoz mapa={prefs.atalhosDeVoz} onMudar={setAtalhosDeVoz} atalhosGlobais={bridge.atalhosGlobais} />
          </>
        )}

        {seccao === "privacidade" && (
          <>
            {/*
              Who can find me (phase 4). Both choices belong to the user and
              travel with the account (`lib/privacidadeDaConta.ts`). The
              request rules apply on the receiver's side (`lib/privacidade.ts`);
              hidden presence shows as "Offline" (`App.tsx`).
            */}
            <section className="card settings-card">
              <h2>{strings.definicoesNovas.quemMeEncontra}</h2>
              <div className="choice">
                <p className="field-label">{strings.definicoesNovas.pedidosDeAmizade}</p>
                <div className="choice-row">
                  {REGRAS_DE_PEDIDOS.map((regra) => (
                    <button
                      key={regra}
                      className={prefs.pedidosDeAmizade === regra ? "chip on" : "chip"}
                      aria-pressed={prefs.pedidosDeAmizade === regra}
                      onClick={() => setPreferencia({ pedidosDeAmizade: regra })}
                    >
                      {strings.definicoesNovas.regraDosPedidos(regra)}
                    </button>
                  ))}
                </div>
              </div>
              <Interruptor
                ligado={prefs.mostrarOnline}
                rotulo={strings.definicoesNovas.mostrarOnline}
                onMudar={(mostrarOnline) => setPreferencia({ mostrarOnline })}
              />
              <p className="field-note">{strings.definicoesNovas.mostrarOnlineNota}</p>
            </section>
            {onDesbloquear && <Bloqueados lista={bloqueados} nomeDe={nomeDe} onDesbloquear={onDesbloquear} />}
          </>
        )}

        {seccao === "aparelhos" && (
          <>
            <Aparelhos />

            {/*
              This device, below the account's device list: backup and account
              deletion on this device are actions on one of those devices, and
              they used to have their own section that nobody connected to the
              other. The danger zone stays at the end, out of the way.
            */}
            <section className="card settings-card">
              <h2>{strings.settings.device}</h2>
              {/*
                Export only exists where there is an account to export.

                On a paired device the file comes out without the account
                private key: whoever imported it would get a clone of this
                DEVICE's key (unable to add, remove or recover anything) and a
                bonus message saying they had the account in hand. Here we say
                where the backup happens, which is the same state the device
                list already reads.
              */}
              {temChaveDeConta === false ? (
                <>
                  <p className="field-note warn">{strings.pairing.noAccountKey}</p>
                  <p className="field-note">{strings.settings.exportNeedsAccountKey}</p>
                </>
              ) : (
                <Button variant="ghost" onClick={() => exportAccount()}>
                  {strings.settings.exportAction}
                </Button>
              )}
              {/* This stays: not an explanation of the button, but the fact that the user
                  has no way to guess it from any label. The phrasing changed the
                  day an account could have multiple devices: export does not add
                  one, it moves the account elsewhere. */}
              <p className="field-note warn">{strings.settings.importReplacesDevice}</p>
              {exportPassphrase !== null && (
                /*
                  The text comes from the FIELD, and here is where it hurts most:
                  a manager that fills in without firing events creates a file
                  born with text the user never saw, and a backup that won't open
                  unless discovered the day it is needed. See `fraseDoCampo`.
                */
                <form
                  className="export-pass"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const frase = fraseDoCampo(event.currentTarget, "export-password", exportPassphrase)
                    if (frase.length < 8) return
                    exportAccount(frase)
                  }}
                >
                  <Field label={strings.settings.exportPassLabel}>
                    <input
                      type="password"
                      name="export-password"
                      autoComplete="new-password"
                      value={exportPassphrase}
                      autoFocus
                      onChange={(event) => setExportPassphrase(event.target.value)}
                    />
                  </Field>
                  <Button variant="primary" type="submit">
                    {strings.settings.exportAction}
                  </Button>
                </form>
              )}
            </section>

            {/* The danger zone is a separate card, with pink title and solid button: it
                lived at the end of the "This device" card, with just one line
                above it, and the owner said it was "too smooth" (October 27,
                2026). A button that deletes the account must not look like the
                others. */}
            <section className="card settings-card zona-de-perigo" aria-labelledby="zona-de-perigo-titulo">
              <h2 id="zona-de-perigo-titulo" className="zona-de-perigo-titulo">
                {strings.settings.zonaDePerigo}
              </h2>
              <p className="field-note">{strings.settings.destroyBody}</p>
              <Button variant="danger" onClick={() => setConfirmingDestroy(true)}>
                {strings.settings.destroyAction}
              </Button>
            </section>
          </>
        )}

        {seccao === "ajuda" && (
          <>
            {/* Repair comes first: this is where users with a channel that won't open
                arrive, and copying the log without being able to do anything was
                only half the answer. Each channel's state (S5) goes below. */}
            <section className="card settings-card">
              <h2>{strings.settings.ajuda}</h2>
              <SincronizarConta connection={connection} />
              <EstadoDaSincronia nomeDe={nomeDe} />
            </section>

            <section className="card settings-card">
              <h2>{strings.settings.diagnostics}</h2>
              <p className="field-note">
                {entryCount === 0 ? strings.settings.diagnosticsEmpty : strings.settings.diagnosticsCount(entryCount)}
              </p>
              <div className="choice-row">
                <Button variant="ghost" onClick={copyDiagnostics}>
                  <CopyIcon size={15} />
                  {strings.settings.diagnosticsCopy}
                </Button>
                {/* Only where the bridge can send: an old `preload` does not bring it. */}
                {bridge.relato && (
                  <Button variant="ghost" onClick={enviarRegisto} disabled={aEnviar || entryCount === 0}>
                    {aEnviar ? strings.definicoesNovas.aEnviarRegisto : strings.definicoesNovas.enviarRegisto}
                  </Button>
                )}
              </div>
              {bridge.relato && <p className="field-note">{strings.definicoesNovas.enviarRegistoNota}</p>}
            </section>

            {/* "How it works" at the end: someone with a problem finds repair first. The
                page opens in a sheet, the same one the gate opens without an
                account. See `ComoFunciona`. */}
            <section className="card settings-card">
              <h2>{strings.comoFunciona.titulo}</h2>
              <p className="field-note">{strings.comoFunciona.cartaoLead}</p>
              <Button variant="ghost" onClick={() => setComoFunciona(true)}>
                {strings.comoFunciona.ver}
              </Button>
            </section>

            {/* The version and link to source code: AGPL-3.0 (section 13) requires that
                anyone using Orwell over the network can get it. */}
            <section className="card settings-card">
              <h2>{strings.settings.sobreVersao(VERSAO_DA_APP)}</h2>
              <p className="field-note">
                {strings.settings.codigoAberto}{" "}
                <a className="linkified" href={CODIGO_FONTE} target="_blank" rel="noopener noreferrer">
                  {strings.settings.codigoFonte}
                </a>
              </p>
            </section>
          </>
        )}
      </div>

      {confirmingDestroy && <DestroyModal onClose={() => setConfirmingDestroy(false)} />}
      {comoFunciona && <FolhaComoFunciona onClose={() => setComoFunciona(false)} />}

      <footer className="statusbar">{connectionLabel(connection)}</footer>
    </main>
  )
}

/**
 * The final confirmation before the gesture nobody undoes: the shared sheet
 * `ApagarConta`, the same one from the gate and Setup.
 *
 * The reload after throws away, with the page, everything that was decrypted
 * in memory. A failure (leaving channels is network) stays in the sheet, and
 * the account stays up: see `ConfirmarDestruicao`.
 */
/**
 * The breakpoint at which the section menu moves to the sidebar drawer. It is
 * the same as `.sidebar` in `screens.css` (`max-width: 840px`).
 */
const LARGO_DO_MENU_NA_GAVETA = "(max-width: 840px)"

function lerMenuNaGaveta(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia(LARGO_DO_MENU_NA_GAVETA).matches
  } catch {
    return false
  }
}

/**
 * Is the section menu in the drawer? Then the screen shows the list itself.
 * Without `matchMedia` (the tests, by default) the answer is "no": wide screen.
 */
function useMenuNaGaveta(): boolean {
  const [naGaveta, setNaGaveta] = useState(lerMenuNaGaveta)
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const consulta = window.matchMedia(LARGO_DO_MENU_NA_GAVETA)
    const mudou = (): void => setNaGaveta(consulta.matches)
    mudou()
    consulta.addEventListener("change", mudou)
    return () => consulta.removeEventListener("change", mudou)
  }, [])
  return naGaveta
}

function DestroyModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const bridge = useBridge()
  return (
    <ApagarConta
      porta="configuracoes"
      onClose={onClose}
      fazer={async () => {
        await bridge.vault.destroy()
        // Back to Setup, with a full reload: nothing decrypted survives.
        window.location.reload()
      }}
    />
  )
}

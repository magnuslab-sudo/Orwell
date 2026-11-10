import { useEffect, useState, type ReactNode } from "react"
import { PERFIS_DE_AUDIO, type EstadoDoAudio, type MedidaDoAudio, type PerfilDeAudio } from "@enclave/client-core"
import { useBridge } from "../../App.js"
import { useToast } from "../../components/Toast.js"
import { DB_ACENDE } from "../../lib/medidorDeDb.js"
import { strings, traduzirErro } from "../../strings.js"

/**
 * Settings › Microphone and camera: noise reduction and microphone test.
 *
 * Everything that moves here goes to `call.audio` (see
 * `packages/client-core/src/audio/README.md`), which applies right away, even mid-call,
 * and saves to the account (`audio.perfil`, `audio.etapas`, `audio.forca`). The state
 * drawn is what the engine says, by the `audio` event: there is no second memory here.
 *
 * A host without `call.audio` (an old bridge) shows a sentence and nothing else: a screen
 * of toggles that change nothing is worse than having no screen.
 *
 * **Profiles only, not stages.** This used to have its own section, "Voice", with one
 * toggle per stage and a strength slider, beside a microphone section with three browser
 * toggles that did the same thing worse. Now there are four profiles, which is the choice
 * you understand without knowing what a "gate" is; the engine keeps storing and applying
 * stages and strength as before (`audio.etapas`, `audio.forca`), they just stop having
 * a toggle.
 *
 * **One meter only.** Until 0.9 the section had two: this one, and `MedidorDeEntrada`
 * in the microphone card, which opened the raw device and told in words if it picked up.
 * Now there is this one, because it shows what comes out of the chain, which is what
 * others hear. The conclusion sentences came from there, and with them the patience before
 * saying "nothing picked up" and the close after one minute.
 */

/** After this the preview closes by itself: the microphone light does not stay on. */
const TECTO_MS = 60_000

/**
 * How often to update the sentence. One hundred fifty milliseconds: speech has pauses
 * of tenths of a second, and wide sampling can always fall on them and never hear a syllable.
 */
const RITMO_MS = 150

/**
 * How much silence before saying nothing is picked up. Five seconds: someone starting
 * the test takes a moment to start speaking, and the app does not report a problem
 * that does not yet exist.
 */
const PACIENCIA_MS = 5_000

/**
 * Above this, the input counts as picked up. This is where the call wave starts to light up
 * (`DB_ACENDE`, −50 dBFS), with 5 dB of headroom so a laptop with a fan does not declare itself as voice.
 */
const APANHA_DB = DB_ACENDE + 5

type Conclusao = "parado" | "a escutar" | "apanha" | "silencio" | "esgotado"

export function ConfiguracoesDeVoz({
  emChamada = false,
  children,
}: {
  /**
   * There is a live call. The meter and "Hear myself" use its chain, and do not
   * open the microphone again; the user is told, so they do not find it strange to hear themselves
   * over the call.
   */
  emChamada?: boolean | undefined
  /**
   * What goes in the noise reduction card, below the profiles: "Cancel echo",
   * which is a browser preference, not an engine one, so it comes from whoever stores
   * preferences (`SettingsScreen`).
   */
  children?: ReactNode
} = {}): React.JSX.Element {
  const bridge = useBridge()
  const toast = useToast()
  // `?.` also on `call`: this card now lives in the microphone section, which opens on
  // hosts (and tests) without any call bridge at all.
  const audio = (bridge.call as Partial<typeof bridge.call> | undefined)?.audio
  const [estado, setEstado] = useState<EstadoDoAudio | null>(() => audio?.estado() ?? null)
  const [medida, setMedida] = useState<MedidaDoAudio | null>(null)
  /** What is said in words. Changes a handful of times, not ten per second. */
  const [conclusao, setConclusao] = useState<Conclusao>("parado")
  /** The microphone is open: there is a call, or the preview is on. */
  const aberto = Boolean(audio && estado && (estado.previa || emChamada))

  useEffect(() => {
    if (!audio) return
    setEstado(audio.estado())
    return bridge.call.on("audio", setEstado)
  }, [audio, bridge.call])

  /*
    The meter: ten readings per second, which is the rate at which the worklet sends
    measurements. Only while this screen is open.
  */
  useEffect(() => {
    if (!audio) return
    const ler = (): void => setMedida(audio.medir())
    ler()
    const relogio = window.setInterval(ler, 100)
    return () => window.clearInterval(relogio)
  }, [audio])

  /*
    The conclusion reads the same number that the input meter shows.

    The preview closes after one minute. In a call it does not: the microphone
    is the call's microphone, and leaving the call closes it.
  */
  useEffect(() => {
    if (!audio || !aberto) {
      setConclusao((antes) => (antes === "esgotado" ? antes : "parado"))
      return
    }
    setConclusao("a escutar")
    const desde = Date.now()
    let apanhou = false
    const relogio = window.setInterval(() => {
      if (audio.medir().entradaDb >= APANHA_DB) {
        apanhou = true
        setConclusao("apanha")
      } else if (!apanhou && Date.now() - desde > PACIENCIA_MS) {
        setConclusao("silencio")
      }
      if (!emChamada && Date.now() - desde > TECTO_MS) {
        window.clearInterval(relogio)
        setConclusao("esgotado")
        void audio.previa(false).catch((erro: unknown) => toast(traduzirErro(erro), "error"))
      }
    }, RITMO_MS)
    return () => window.clearInterval(relogio)
  }, [audio, aberto, emChamada, toast])

  // The preview does not survive leaving the screen: no one listens to themselves without knowing.
  useEffect(() => {
    if (!audio) return
    return () => {
      if (audio.estado().previa) void audio.previa(false).catch(() => {})
    }
  }, [audio])

  if (!audio || !estado) {
    return (
      <section className="card settings-card voz-cadeia">
        <h2>{strings.settings.voz.perfil}</h2>
        <p className="field-note">{strings.settings.voz.indisponivel}</p>
        {children}
      </section>
    )
  }

  const falhou = (erro: unknown): void => toast(traduzirErro(erro), "error")
  const t = strings.settings.voz
  const frase = {
    parado: strings.settings.entradaParada,
    "a escutar": strings.settings.entradaAEscutar,
    apanha: strings.settings.entradaApanha,
    silencio: strings.settings.entradaSemSinal,
    esgotado: strings.settings.entradaEsgotado,
  }[conclusao]

  return (
    <>
      <section className="card settings-card voz-cadeia">
        <h2>{t.perfil}</h2>

        <div className="choice voz-perfis">
          <div className="voz-perfis-lista" role="radiogroup" aria-label={t.perfil}>
            {PERFIS_DE_AUDIO.map((perfil: PerfilDeAudio) => (
              <label key={perfil} className={estado.perfil === perfil ? "voz-perfil escolhido" : "voz-perfil"}>
                <input
                  type="radio"
                  name="voz-perfil"
                  value={perfil}
                  checked={estado.perfil === perfil}
                  onChange={() => void audio.definirPerfil(perfil).catch(falhou)}
                />
                <span className="voz-perfil-nome">{t.perfis[perfil].nome}</span>
                <span className="voz-perfil-frase">{t.perfis[perfil].frase}</span>
              </label>
            ))}
          </div>
        </div>

        {children}
        {/* The engine status line (model running, loading, native) was removed on
            October 27, 2026 by order of the owner: it is information about who
            makes the app, not who uses it. The status remains in diagnostics. */}
      </section>

      <section className="card settings-card voz-teste">
        <h2>{t.teste}</h2>
        {emChamada && <p className="field-note">{strings.settings.testeNaChamada}</p>}
        <div className="voz-medidores" aria-live="off">
          <Medidor rotulo={t.entrada} db={medida?.entradaDb ?? -120} />
          <Medidor rotulo={t.saida} db={medida?.saidaDb ?? -120} />
          <Medidor rotulo={t.ruido} db={medida?.ruidoEstimadoDb ?? -120} discreto />
        </div>
        {/*
          The conclusion in text, for those who do not see the bars. `polite` so it
          does not interrupt what is being read.
        */}
        <p className="field-note voz-conclusao" aria-live="polite">
          {frase}
        </p>
        <div className="voz-ouvir">
          <button
            type="button"
            className={estado.previa ? "chip on" : "chip"}
            aria-pressed={estado.previa}
            onClick={() => void audio.previa(!estado.previa).catch(falhou)}
          >
            {t.ouvirMe}
          </button>
          <p className="field-note">{t.ouvirMeNota}</p>
        </div>
      </section>
    </>
  )
}

/** The floor and the cap of the meter, in dBFS. Below -60 is silence to the eye. */
const CHAO_DB = -60

/**
 * A level bar: the length is the level in dBFS, from -60 to 0.
 *
 * `role="meter"` with the value and the text, so the screen reader announces the same
 * number that is visible.
 */
function Medidor({ rotulo, db, discreto = false }: { rotulo: string; db: number; discreto?: boolean }): React.JSX.Element {
  const arredondado = Math.max(CHAO_DB, Math.round(db))
  const fraccao = Math.min(1, Math.max(0, (arredondado - CHAO_DB) / -CHAO_DB))
  const texto = db <= -119 ? "—" : strings.settings.voz.dbfs(arredondado)
  return (
    <div className={discreto ? "voz-medidor discreto" : "voz-medidor"}>
      <span className="voz-medidor-rotulo">{rotulo}</span>
      <span
        className="voz-medidor-pista"
        role="meter"
        aria-label={rotulo}
        aria-valuemin={CHAO_DB}
        aria-valuemax={0}
        aria-valuenow={arredondado}
        aria-valuetext={texto}
      >
        <span className="voz-medidor-nivel" style={{ transform: `scaleX(${fraccao})` }} />
      </span>
      <span className="voz-medidor-valor">{texto}</span>
    </div>
  )
}

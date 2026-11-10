import { useEffect, useState } from "react"
import { useBridge } from "../../App.js"
import { Interruptor } from "../../components/Interruptor.js"
import { LIMIAR_MAXIMO, LIMIAR_MINIMO } from "../../hooks/usePrefs.js"
import { strings, traduzirErro } from "../../strings.js"

/**
 * Settings › Voice › "Microphone Sensitivity" (owner, November 2, 2026:
 * "we need an option with audio threshold"). This is Discord's "Input
 * Sensitivity".
 *
 * "Automatic", on by default, is the usual gate. Off, a line appears (from
 * -80 to 0 dB, step 1) above a live meter: the part of the level above the
 * line lights green, below stays grey. The microphone only transmits above the
 * line, and closed it outputs silence (see `client-core/src/audio/README.md`).
 *
 * The meter reads `call.audio.medir().portaoDb`, which is the level at the
 * exact point where the gate compares with the line: the bar and the gate
 * speak to the same number. For that it needs a standing chain. In a call it is
 * the call's; outside it, `call.audio.medidor(true)` opens the microphone ONLY
 * while this card is visible and in manual, and releases it on exit.
 *
 * The choice belongs to this device (`Prefs`), and reaches the engine via the
 * path of other media preferences (`onMudar` is the `setMediaPref` from
 * Settings). Changing the line recreates nothing: it goes in the worklet config
 * message.
 */

/** How often the meter is read. This is the rate at which the worklet sends measurements. */
const RITMO_MS = 100

export function SensibilidadeDoMicrofone({
  automatica,
  limiar,
  emChamada = false,
  onMudar,
}: {
  automatica: boolean
  limiar: number
  emChamada?: boolean | undefined
  onMudar: (patch: { sensibilidadeAutomatica?: boolean; limiarDoMicrofone?: number }) => void
}): React.JSX.Element | null {
  const bridge = useBridge()
  const audio = (bridge.call as Partial<typeof bridge.call> | undefined)?.audio
  const [nivel, setNivel] = useState(-120)
  const [aberto, setAberto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const t = strings.settings.sensibilidade

  /*
    The microphone for the meter: manual only, only with this card mounted. In
    a call it opens nothing (measures the call chain); leaving it, asks again,
    and the outside chain is born.
  */
  useEffect(() => {
    if (!audio || automatica || typeof audio.medidor !== "function") return
    let vivo = true
    setErro(null)
    setAberto(false)
    audio.medidor(true).then(
      () => vivo && setAberto(true),
      (causa: unknown) => vivo && setErro(traduzirErro(causa)),
    )
    return () => {
      vivo = false
      void audio.medidor(false).catch(() => {})
    }
  }, [audio, automatica, emChamada])

  useEffect(() => {
    if (!audio || automatica) return
    const ler = (): void => setNivel(audio.medir().portaoDb ?? -120)
    ler()
    const relogio = window.setInterval(ler, RITMO_MS)
    return () => window.clearInterval(relogio)
  }, [audio, automatica])

  if (!audio) return null

  const amplitude = LIMIAR_MAXIMO - LIMIAR_MINIMO
  const fraccao = (db: number): number => Math.min(1, Math.max(0, (db - LIMIAR_MINIMO) / amplitude))
  const linha = fraccao(limiar)
  const agora = fraccao(nivel)
  // Grey up to the line (or to the level, if it stays below); green from the line to the level.
  const cinzento = Math.min(agora, linha)
  const verde = linha >= 1 ? 0 : Math.max(0, agora - linha) / (1 - linha)
  const nivelArredondado = Math.max(LIMIAR_MINIMO, Math.round(nivel))
  const textoDoNivel = nivel <= -119 ? "—" : t.db(nivelArredondado)

  return (
    <section className="card settings-card sensibilidade" aria-label={t.titulo}>
      <h2>{t.titulo}</h2>
      <Interruptor
        ligado={automatica}
        rotulo={t.automatica}
        onMudar={(ligado) => onMudar({ sensibilidadeAutomatica: ligado })}
      />
      {automatica ? (
        <p className="field-note">{t.automaticaNota}</p>
      ) : (
        <>
          <p className="field-note">{t.nota}</p>
          <div className="sensibilidade-linha">
            <div className="sensibilidade-pista">
              {/* The meter sits behind the bar, like in Discord. */}
              <span
                className="sensibilidade-medidor"
                role="meter"
                aria-label={t.nivel}
                aria-valuemin={LIMIAR_MINIMO}
                aria-valuemax={LIMIAR_MAXIMO}
                aria-valuenow={nivelArredondado}
                aria-valuetext={textoDoNivel}
              >
                <span className="sensibilidade-abaixo" style={{ transform: `scaleX(${cinzento})` }} />
                <span
                  className="sensibilidade-acima"
                  style={{ left: `${linha * 100}%`, right: 0, transform: `scaleX(${verde})` }}
                />
              </span>
              <input
                type="range"
                className="sensibilidade-barra"
                min={LIMIAR_MINIMO}
                max={LIMIAR_MAXIMO}
                step={1}
                value={limiar}
                aria-label={t.linha}
                aria-valuetext={t.db(limiar)}
                onChange={(evento) => onMudar({ limiarDoMicrofone: Number(evento.target.value) })}
              />
            </div>
            <span className="sound-value">{t.db(limiar)}</span>
          </div>
          {erro ? (
            <p className="field-note sensibilidade-erro" role="alert">
              {erro}
            </p>
          ) : (
            !aberto && !emChamada && <p className="field-note">{t.aAbrir}</p>
          )}
          <p className="field-note">{t.carregarParaFalar}</p>
        </>
      )}
    </section>
  )
}

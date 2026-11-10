import { useEffect, useReducer } from "react"
import { Button } from "../../components/Button.js"
import { DURACOES_DA_PAUSA, estaEmPausa, fimDaPausa } from "../../hooks/usePrefs.js"
import { strings } from "../../strings.js"

/** The time in 24 h format (`08:05`). Same in both languages, and independent of the system. */
function horaDe(quando: Date): string {
  return `${String(quando.getHours()).padStart(2, "0")}:${String(quando.getMinutes()).padStart(2, "0")}`
}

/**
 * "Pause", in Settings › Notifications (phase 4).
 *
 * Not paused, three buttons: 1 h, 8 h, Until tomorrow. Paused, the phrase with the
 * end time and "Resume". The sound engine mutes itself (`caladoPelaPausa`) and the
 * system notice verdict (`systemNoticeVerdictOf`); this screen only stores
 * the end time.
 */
export function PausaDasNotificacoes({
  pausaAte,
  onMudar,
}: {
  pausaAte: number
  /** The new end time. 0 means resume. */
  onMudar: (pausaAte: number) => void
}): React.JSX.Element {
  /*
    The pause ends by itself, at the set time. Without this timer, someone who left
    settings open would see "Paused until 14:30" at 15:00, with sounds already
    playing. A redraw at the right time works: the state is the stored time.
  */
  const [, redesenhar] = useReducer((n: number) => n + 1, 0)
  const emPausa = estaEmPausa({ pausaAte })
  useEffect(() => {
    if (!emPausa) return
    // `setTimeout` does not accept more than ~24.8 days; a pause never reaches it.
    const id = setTimeout(redesenhar, Math.min(pausaAte - Date.now() + 50, 2 ** 31 - 1))
    return () => clearTimeout(id)
  }, [emPausa, pausaAte])

  const fim = new Date(pausaAte)
  const amanha = fim.toDateString() !== new Date().toDateString()

  return (
    <div className="choice">
      <p className="field-label">{strings.definicoesNovas.pausar}</p>
      {emPausa ? (
        <>
          <p className="field-note" role="status">
            {strings.definicoesNovas.emPausaAte(horaDe(fim), amanha)}
          </p>
          <Button variant="ghost" onClick={() => onMudar(0)}>
            {strings.definicoesNovas.retomar}
          </Button>
        </>
      ) : (
        <>
          <div className="choice-row">
            {DURACOES_DA_PAUSA.map((duracao) => (
              <button key={duracao} className="chip" onClick={() => onMudar(fimDaPausa(duracao))}>
                {strings.definicoesNovas.duracaoDaPausa(duracao)}
              </button>
            ))}
          </div>
          <p className="field-note">{strings.definicoesNovas.pausarNota}</p>
        </>
      )}
    </div>
  )
}

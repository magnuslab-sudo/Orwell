import type { SincroniaDoCanal } from "../bridge.js"
import { strings } from "../strings.js"

/**
 * The thin "Receiving channel…" bar (S5, §2.5): only while the channel arrives for
 * a late joiner, showing what is still missing from each type. Disappears on its own when the
 * core says it is done (`aReceber` false). Not a warning: no button, no code, and does not cover the chat.
 */
export function BarraDeSincronia({ estado }: { estado: SincroniaDoCanal | undefined }): React.JSX.Element | null {
  if (!estado?.aReceber) return null
  const esperados = estado.progresso.reduce((soma, parte) => soma + parte.esperados, 0)
  const recebidos = estado.progresso.reduce((soma, parte) => soma + parte.recebidos, 0)
  const nomes = strings.sincronia.tipos as Record<string, string>
  const partes = estado.progresso
    .filter((parte) => parte.recebidos < parte.esperados)
    .map((parte) => strings.sincronia.parte(nomes[parte.tipo] ?? parte.tipo, parte.recebidos, parte.esperados))
  return (
    <div className="barra-sincronia" role="status" aria-live="polite">
      <span className="barra-sincronia-texto">{strings.sincronia.aReceber}</span>
      {partes.length > 0 && <span className="barra-sincronia-partes">{partes.join(" · ")}</span>}
      {esperados > 0 && (
        <progress className="barra-sincronia-progresso" max={esperados} value={recebidos} aria-label={strings.sincronia.aReceber} />
      )}
    </div>
  )
}

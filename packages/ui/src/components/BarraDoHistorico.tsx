import { useEffect, useState } from "react"
import { useBridge } from "../App.js"
import type { HistoricoDosIrmaos } from "../bridge.js"
import { strings } from "../strings.js"

/**
 * History from a sibling device on the same account (1.0 "Arca"): reads the
 * state on mount and follows the `historico` event from the bridge. Without the new bridge
 * (a host on another version), nothing.
 */
export function useHistoricoDosIrmaos(): HistoricoDosIrmaos | null {
  const bridge = useBridge()
  const [estado, setEstado] = useState<HistoricoDosIrmaos | null>(null)
  useEffect(() => {
    let vivo = true
    void bridge.sincronia
      ?.historico?.()
      .then((agora) => {
        if (vivo) setEstado((antes) => antes ?? agora)
      })
      .catch(() => {})
    const largar = bridge.on.historico?.((novo) => setEstado(novo))
    return () => {
      vivo = false
      largar?.()
    }
  }, [bridge])
  return estado
}

/**
 * The thin "Bringing history: 340 of 1200 messages." bar. Only on a freshly paired device,
 * or when what is missing is large: small sync between already paired devices runs
 * without a bar. After messages come files, which arrive at the end and in the
 * background. No button and covers nothing: the app works during sync.
 */
export function BarraDoHistorico({ estado }: { estado: HistoricoDosIrmaos | null }): React.JSX.Element | null {
  if (!estado?.aTrazer || (!estado.inicial && estado.total < 50)) return null
  const nasMensagens = estado.feitas < estado.total
  const media = estado.media
  if (!nasMensagens && (!media || media.total === 0)) return null
  const texto = nasMensagens
    ? strings.sincronia.historico(estado.feitas, estado.total)
    : strings.sincronia.historicoMedia(media?.feitas ?? 0, media?.total ?? 0)
  return (
    <div className="barra-sincronia barra-historico" role="status" aria-live="polite">
      <span className="barra-sincronia-texto">{texto}</span>
      <progress
        className="barra-sincronia-progresso"
        max={nasMensagens ? estado.total : (media?.total ?? 1)}
        value={nasMensagens ? estado.feitas : (media?.feitas ?? 0)}
        aria-label={texto}
      />
    </div>
  )
}

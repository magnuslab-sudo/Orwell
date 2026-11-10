import { useEffect, useState } from "react"
import { useBridge } from "../../App.js"
import type { SincroniaDoCanal } from "../../bridge.js"
import { feedOwnerOf, formatTime, isDirect, isFeed, nomeEmFalta, shortName } from "../../lib/format.js"
import { strings } from "../../strings.js"

/**
 * In Diagnostics, one line per channel with the sync status (S5, §2.5):
 * in sync, receiving what is missing, no response, or not yet compared; and the time
 * of the last comparison with another member. Direct conversations are excluded:
 * they have their own path (the friend book), and do not sync this way.
 *
 * Without `sync` on the bridge, nothing draws.
 */
export function EstadoDaSincronia({ nomeDe }: { nomeDe?: ((address: string) => string) | undefined } = {}): React.JSX.Element | null {
  const bridge = useBridge()
  const [lista, setLista] = useState<SincroniaDoCanal[] | null>(null)

  useEffect(() => {
    const sincronia = bridge.sincronia
    if (!sincronia) return
    let vivo = true
    void sincronia
      .estado()
      .then((todos) => {
        if (vivo) setLista(todos)
      })
      .catch(() => {})
    const largar = bridge.on.sincronia?.((novo) => {
      setLista((agora) => (agora ? [...agora.filter((e) => e.channel !== novo.channel), novo] : agora))
    })
    return () => {
      vivo = false
      largar?.()
    }
  }, [bridge])

  if (!bridge.sincronia || lista === null) return null
  // A feed belongs to its owner, as everywhere else in the interface; a channel, by published name.
  const nome = (canal: string): string =>
    isFeed(canal)
      ? strings.sincronia.feedDe((nomeDe ?? nomeEmFalta)(feedOwnerOf(canal)))
      : bridge.channels.meta(canal)?.name || shortName(canal)
  const canais = lista.filter((e) => !isDirect(e.channel)).sort((a, b) => nome(a.channel).localeCompare(nome(b.channel)))

  return (
    <div className="estado-sincronia">
      <h3>{strings.sincronia.titulo}</h3>
      <p className="field-note">{strings.sincronia.nota}</p>
      {canais.length === 0 ? (
        <p className="field-note">{strings.sincronia.vazio}</p>
      ) : (
        <ul className="estado-sincronia-lista">
          {canais.map((e) => (
            <li key={e.channel} className={`estado-sincronia-linha ${e.estado}`} data-canal={e.channel}>
              <span className="estado-sincronia-nome">{nome(e.channel)}</span>
              <span className="estado-sincronia-estado">{strings.sincronia.estados[e.estado]}</span>
              {e.ultimaComparacao !== null && (
                <span className="estado-sincronia-hora">{strings.sincronia.ultima(formatTime(e.ultimaComparacao))}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

import { usePrefs } from "../hooks/usePrefs.js"
import { strings } from "../strings.js"

/**
 * The phrases for the three situations the plan lists (phase 6, layer 1). The name
 * is what lands in `Prefs.frasesVistas`, so it does not change after dismissal.
 */
export type FraseId = "conta" | "canal"

/**
 * A phrase at the right moment, shown once (phase 6, layer 1).
 *
 * The "How it works" section explains everything to those who open it, and almost nobody
 * opens it. This is the other half: the right phrase where the doubt starts (creating the
 * account, entering the first channel), and nothing more. The one for the first call went
 * out on October 27, 2026 by order of the owner. A tap on "Got it" closes it forever on
 * this device. A phrase that returns every time stops being read the second time.
 *
 * The text comes from `strings.frasesDoMomento`, by the same name.
 */
export function FraseDoMomento({ id }: { id: FraseId }): React.JSX.Element | null {
  const { prefs, marcarFraseVista } = usePrefs()
  if (prefs.frasesVistas.includes(id)) return null
  return (
    <div className="frase-do-momento" data-frase={id}>
      <p>{strings.frasesDoMomento[id]}</p>
      <button type="button" className="gate-link" onClick={() => marcarFraseVista(id)}>
        {strings.frasesDoMomento.entendi}
      </button>
    </div>
  )
}

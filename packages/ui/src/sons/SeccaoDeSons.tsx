import { Button } from "../components/Button.js"
import { strings } from "../strings.js"
import { TIPOS_DE_SOM, type TipoDeSom } from "./familia.js"
import { motor } from "./motor.js"
import { usePreferenciasDeSom } from "./preferencias.js"

/**
 * The "Sounds" section in Settings › Notifications.
 *
 * Separated from system alerts on purpose: requires no browser permission,
 * works with the window in focus, and never leaves the page.
 *
 * The main switch and volume are the usual preferences (`sounds` and
 * `soundVolume`, in `usePrefs`), so they come from outside: whoever chose
 * before doesn't lose the choice. Everything else lives in `sons/preferencias.ts`.
 * All state stays on this device.
 */
export function SeccaoDeSons({
  ligado,
  volume,
  onLigado,
  onVolume,
}: {
  ligado: boolean
  volume: number
  onLigado: (ligado: boolean) => void
  onVolume: (volume: number) => void
}): React.JSX.Element {
  const { preferencias, mudar } = usePreferenciasDeSom()
  const nomeDe = (tipo: TipoDeSom): string => strings.settings.somTipos[tipo]

  return (
    <div className="choice sound-choice">
      <label className="checkbox">
        <input
          type="checkbox"
          checked={ligado}
          onChange={(event) => {
            onLigado(event.target.checked)
            // Turning on answers the question right away: "what does this sound like?".
            // The click is a gesture, so the browser lets audio start.
            if (event.target.checked) motor.ouvir("directa", volume)
          }}
        />
        {strings.settings.sounds}
      </label>
      {ligado && (
        <>
          <div className="sound-row">
            <input
              type="range"
              min={0}
              max={100}
              step={10}
              value={volume}
              aria-label={strings.settings.soundVolume}
              onChange={(event) => onVolume(Number(event.target.value))}
            />
            <span className="sound-value">{volume}%</span>
            <Button variant="ghost" onClick={() => motor.ouvir("directa", volume)}>
              {strings.settings.soundSample}
            </Button>
          </div>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={preferencias.vibrar}
              onChange={(event) => mudar({ vibrar: event.target.checked })}
            />
            {strings.settings.somVibrar}
          </label>

          {/* One sound per event, collapsed by default: that's eleven rows almost nobody
              changes, and expanded would push everything else out of view. */}
          <details>
            <summary className="sound-types-title">{strings.settings.somPorTipo}</summary>
            <ul className="sound-types">
              {TIPOS_DE_SOM.map((tipo) => (
                <li key={tipo} className="sound-type">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={preferencias.porTipo[tipo]}
                      onChange={(event) => {
                        mudar({ tipo: [tipo, event.target.checked] })
                        // Like the main switch: turning on responds with whichever sound was
                        // left on. Without this, turning on a type made no sound, and it
                        // looked like it hadn't turned on (owner report, 4/11/2026).
                        if (event.target.checked) motor.ouvir(tipo, volume)
                      }}
                    />
                    {nomeDe(tipo)}
                  </label>
                  <Button
                    variant="ghost"
                    ariaLabel={strings.settings.somOuvirTipo(nomeDe(tipo))}
                    onClick={() => motor.ouvir(tipo, volume)}
                  >
                    {strings.settings.soundSample}
                  </Button>
                </li>
              ))}
            </ul>
          </details>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={preferencias.chamadaComOcupado}
              onChange={(event) => mudar({ chamadaComOcupado: event.target.checked })}
            />
            {strings.settings.somChamadaComOcupado}
          </label>
          <p className="field-note">{strings.settings.somNota}</p>
        </>
      )}
    </div>
  )
}

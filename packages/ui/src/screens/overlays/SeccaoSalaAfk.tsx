import { MINUTOS_AFK, MINUTOS_AFK_POR_OMISSAO } from "@enclave/protocol"
import { useId, useState } from "react"
import type { ChannelRoom } from "../../bridge.js"
import { Button } from "../../components/Button.js"
import { Field } from "../../components/Field.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { strings, traduzirErro } from "../../strings.js"

/**
 * Choose the channel's AFK room and timeout (2/11/2026).
 *
 * Lives inside channel properties, but saves itself: the AFK room is a
 * `channel.meta` of the room, not the `space.meta` of the channel that the
 * rest of the panel publishes. A "Save" button just for this stops saving the
 * channel name from republishing rooms, and vice versa.
 *
 * Only shows to those who can edit the channel. Real enforcement is in the core.
 */
export function SeccaoSalaAfk({
  salasDeVoz,
  actual,
  onGuardar,
}: {
  /** The open voice rooms of the channel. */
  salasDeVoz: readonly ChannelRoom[]
  /** The current AFK room, if any. */
  actual: { room: string; minutos: number } | null
  /** Null room means "none": unsets the current one. */
  onGuardar: (room: string | null, minutos: number) => Promise<void>
}): React.JSX.Element {
  const titulo = useId()
  const [sala, setSala] = useState(actual?.room ?? "")
  const [minutos, setMinutos] = useState(actual?.minutos ?? MINUTOS_AFK_POR_OMISSAO)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mudou = sala !== (actual?.room ?? "") || (sala !== "" && minutos !== (actual?.minutos ?? MINUTOS_AFK_POR_OMISSAO))
  // A timeout that this version does not offer (written by another) stays chosen.
  const tempos = MINUTOS_AFK.includes(minutos as (typeof MINUTOS_AFK)[number]) ? [...MINUTOS_AFK] : [...MINUTOS_AFK, minutos]

  return (
    <section className="sheet-grupo seccao-sala-afk" aria-labelledby={titulo}>
      <h3 id={titulo}>{strings.salaAfk.seccaoTitulo}</h3>
      <p className="hint">{strings.salaAfk.seccaoLead}</p>
      {salasDeVoz.length === 0 ? (
        <p className="hint">{strings.salaAfk.semSalasDeVoz}</p>
      ) : (
        <>
          <Field label={strings.salaAfk.salaLabel}>
            <select value={sala} onChange={(evento) => setSala(evento.target.value)}>
              <option value="">{strings.salaAfk.nenhuma}</option>
              {salasDeVoz.map((cada) => (
                <option key={cada.room} value={cada.room}>
                  {cada.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={strings.salaAfk.tempoLabel}>
            <select value={minutos} disabled={sala === ""} onChange={(evento) => setMinutos(Number(evento.target.value))}>
              {tempos.map((cada) => (
                <option key={cada} value={cada}>
                  {strings.salaAfk.minutos(cada)}
                </option>
              ))}
            </select>
          </Field>
          <Button
            type="button"
            variant="ghost"
            disabled={busy || !mudou}
            onClick={() => {
              setBusy(true)
              setError(null)
              void onGuardar(sala === "" ? null : sala, minutos)
                .then(() => setBusy(false))
                .catch((causa: Error) => {
                  setBusy(false)
                  setError(traduzirErro(causa))
                })
            }}
          >
            {strings.salaAfk.guardar}
          </Button>
          {error && (
            <p className="error">
              <TextoDeErro texto={error} />
            </p>
          )}
        </>
      )}
    </section>
  )
}

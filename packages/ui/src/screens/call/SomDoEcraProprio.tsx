import { useEffect, useState } from "react"
import type { EstadoDoSomDoEcra } from "@enclave/client-core"
import type { EnclaveBridge } from "../../bridge.js"
import { SpeakerIcon } from "../../icons.js"
import { strings } from "../../strings.js"

/**
 * OUR screen audio, for the sharer: the indicator and the gesture.
 *
 * System audio is everything the computer plays. The sharer must see it is
 * going out, and must be able to mute it without stopping the share. Muting is
 * `enabled = false` on the track (see `Call.setSomDoEcraCalado`): it doesn't
 * renegotiate anything, in the mesh or in the SFU.
 *
 * Read from the engine via the `screen-sound` event. An engine without the
 * event (a test double, an old bridge) has no screen audio, and this draws
 * nothing.
 */
type ChamadaComSom = EnclaveBridge["call"] & {
  somDoEcra?: EstadoDoSomDoEcra
  setSomDoEcraCalado?: (calado: boolean) => void
}

export function useSomDoEcraProprio(call: EnclaveBridge["call"]): EstadoDoSomDoEcra {
  const chamada = call as ChamadaComSom
  const [estado, setEstado] = useState<EstadoDoSomDoEcra>(chamada.somDoEcra ?? null)
  useEffect(() => {
    setEstado(chamada.somDoEcra ?? null)
    if (typeof chamada.on !== "function") return
    return chamada.on("screen-sound", (evento) => setEstado(evento.estado))
  }, [chamada])
  return estado
}

/** The indicator, above the bar: it is going out, or it is muted. */
export function SinalDoSomDoEcra({ estado }: { estado: EstadoDoSomDoEcra }): React.JSX.Element | null {
  if (estado === null) return null
  return (
    <p className={estado === "calado" ? "call-som-do-ecra calado" : "call-som-do-ecra"} role="status">
      <SpeakerIcon size={14} />{" "}
      {estado === "calado" ? strings.call.screenSoundMutedSelf : strings.call.screenSoundSharing}
    </p>
  )
}

/** The gesture, on the bar, next to "Stop sharing". */
export function BotaoDoSomDoEcra({
  call,
  estado,
}: {
  call: EnclaveBridge["call"]
  estado: EstadoDoSomDoEcra
}): React.JSX.Element | null {
  const chamada = call as ChamadaComSom
  if (estado === null || typeof chamada.setSomDoEcraCalado !== "function") return null
  const calado = estado === "calado"
  const accao = calado ? strings.call.screenSoundUnmute : strings.call.screenSoundMute
  return (
    <button
      type="button"
      data-som-do-ecra="1"
      className={calado ? "call-btn off" : "call-btn on"}
      data-tip={accao}
      aria-label={accao}
      aria-pressed={!calado}
      onClick={() => chamada.setSomDoEcraCalado?.(!calado)}
    >
      <SpeakerIcon size={20} />
    </button>
  )
}

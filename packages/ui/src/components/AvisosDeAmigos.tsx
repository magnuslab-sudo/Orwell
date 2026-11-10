import { createContext, useContext, useEffect, useRef, useState } from "react"
import type { AvisoDeAmigo, AvisoNaPilha } from "../hooks/useAvisosDeAmigos.js"
import { PersonIcon } from "../icons.js"
import { AVISO_DO_AMIGO_MS } from "../lib/notifications.js"
import { strings } from "../strings.js"

/**
 * Friend cards in the MSN style, in the bottom right corner, below the notifications.
 *
 * A provider separate from `Shell`, like the notifications (`ToastProvider`): a card
 * entering and leaving cannot redraw the entire application.
 */
export type EmpurrarAvisoDeAmigo = (aviso: AvisoDeAmigo) => void

export const AvisosDeAmigosContext = createContext<EmpurrarAvisoDeAmigo | null>(null)

/** Outside a provider (tests of a single screen) there is no stack, and the request is lost. */
export function useAvisoDeAmigo(): EmpurrarAvisoDeAmigo {
  return useContext(AvisosDeAmigosContext) ?? semPilha
}

const semPilha: EmpurrarAvisoDeAmigo = () => {}

/** At most three cards showing. The others count in a line. */
export const CARDS_VISIVEIS = 3

/**
 * The stack. The newest lands at the bottom, near the corner, like in MSN.
 *
 * **The screen reader.** The stack is inside the notification region
 * (`.toast-stack`, `aria-live="polite"`) but turns itself off
 * (`aria-live="off"`): otherwise the whole card would be read, button included. The speaker is
 * a `role="status"` region that always exists and receives only the message from the
 * newest card: "Ana is online". A region created with text already inside is
 * announced by some readers and not by others; one that was already there, by all.
 * So it is born empty with the first card, gets the message in the next step,
 * and stays: it only appears after the first card so it is not one more `status`
 * on screens that never use it.
 */
export function PilhaDeAvisosDeAmigos({
  avisos,
  onFechar,
  onPausar,
  onRetomar,
}: {
  avisos: readonly AvisoNaPilha[]
  onFechar: (id: number) => void
  onPausar: (id: number) => void
  onRetomar: (id: number) => void
}): React.JSX.Element {
  const visiveis = avisos.slice(-CARDS_VISIVEIS)
  const deFora = avisos.slice(0, Math.max(0, avisos.length - CARDS_VISIVEIS))
  const ultimo = avisos[avisos.length - 1]
  const [regiao, setRegiao] = useState(false)
  const [dito, setDito] = useState("")
  const frase = ultimo?.texto ?? ""
  useEffect(() => {
    if (frase) setRegiao(true)
  }, [frase])
  useEffect(() => {
    if (regiao) setDito(frase)
  }, [regiao, frase, ultimo?.id])
  return (
    <div className="avisos-amigos" aria-live="off">
      {regiao && (
        <p className="sr-only" role="status">
          {dito}
        </p>
      )}
      {deFora.length > 0 && (
        <p className="avisos-amigos-mais">
          {deFora.every((aviso) => aviso.tipo === "online")
            ? strings.notifications.maisAmigosOnline(deFora.length)
            : strings.notifications.maisAvisos(deFora.length)}
        </p>
      )}
      {visiveis.map((aviso) => (
        <CardDeAmigo key={aviso.id} aviso={aviso} onFechar={onFechar} onPausar={onPausar} onRetomar={onRetomar} />
      ))}
    </div>
  )
}

/**
 * A card. The timer stops with the cursor OR focus inside, and only resumes when both
 * leave: the same rule as notifications with action (`ToastComAccao`, WCAG 2.2.1).
 * The button never steals focus: someone typing keeps typing. You get there
 * with Tab, and Esc closes the card.
 */
function CardDeAmigo({
  aviso,
  onFechar,
  onPausar,
  onRetomar,
}: {
  aviso: AvisoNaPilha
  onFechar: (id: number) => void
  onPausar: (id: number) => void
  onRetomar: (id: number) => void
}): React.JSX.Element {
  const dentro = useRef({ rato: false, foco: false })
  const [semCara, setSemCara] = useState(false)
  const mudar = (qual: "rato" | "foco", agora: boolean): void => {
    const antes = dentro.current.rato || dentro.current.foco
    dentro.current[qual] = agora
    const depois = dentro.current.rato || dentro.current.foco
    if (!antes && depois) onPausar(aviso.id)
    if (antes && !depois) onRetomar(aviso.id)
  }
  // A face that fails to load (corrupt data) falls back to initials.
  useEffect(() => setSemCara(false), [aviso.cara])
  return (
    <div
      className={aviso.parado ? "aviso-amigo parado" : "aviso-amigo"}
      data-tipo={aviso.tipo}
      style={{ "--vida-do-aviso": `${AVISO_DO_AMIGO_MS}ms` } as React.CSSProperties}
      onMouseEnter={() => mudar("rato", true)}
      onMouseLeave={() => mudar("rato", false)}
      onFocus={() => mudar("foco", true)}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        if (!document.hasFocus()) return
        mudar("foco", false)
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.stopPropagation()
        onFechar(aviso.id)
      }}
    >
      <span className="aviso-amigo-cara" aria-hidden="true">
        {aviso.cara && !semCara ? (
          <img src={aviso.cara} alt="" onError={() => setSemCara(true)} />
        ) : aviso.iniciais ? (
          <span className="aviso-amigo-iniciais">{aviso.iniciais}</span>
        ) : (
          <PersonIcon size={22} />
        )}
      </span>
      <span className="aviso-amigo-corpo">
        <span className="aviso-amigo-titulo">{aviso.texto}</span>
        {aviso.onde && <span className="aviso-amigo-onde">{aviso.onde}</span>}
        <span className="aviso-amigo-quando">{strings.notifications.agoraMesmo}</span>
      </span>
      <button
        type="button"
        className="aviso-amigo-accao"
        onClick={() => {
          onFechar(aviso.id)
          aviso.fazer()
        }}
      >
        {aviso.rotulo}
      </button>
      <span className="aviso-amigo-vida" aria-hidden="true">
        <span />
      </span>
    </div>
  )
}

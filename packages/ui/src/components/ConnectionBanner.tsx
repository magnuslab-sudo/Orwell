import { createContext, useContext, useEffect, useState } from "react"
import type { ConnectionState } from "../bridge.js"
import { strings, translateError } from "../strings.js"
import { TextoDeErro } from "./TextoDeErro.js"

/**
 * What the banner needs from the shell and doesn't come in props for each screen.
 *
 * Context not props because the banner appears on five screens (chats, feed,
 * profile, people, settings) and none of them has anything to do with
 * connecting: passing the button from hand to hand across all five would make
 * five screens aware of something only the shell knows how to do.
 *
 * Without a provider, the banner is the old one: says there is no connection
 * and nothing else. That's what screen tests build, and a host that doesn't
 * know how to connect by hand.
 */
export interface LigacaoDaFaixa {
  /** Try now, without waiting for the next backoff step from the core. */
  ligarAgora: () => void
  /** When the connection dropped, in milliseconds. `null` before the first connection. */
  caiuEm: number | null
}

export const LigacaoContext = createContext<LigacaoDaFaixa | null>(null)

/** One minute at a time is enough: the banner shows minutes, never seconds. */
const PASSO_DO_RELOGIO_MS = 30_000

/** How long without connection, in words and rounded to the minute. */
export function tempoSemLigacao(caiuEm: number, agora: number): string {
  return strings.connection.duracao(Math.max(0, Math.floor((agora - caiuEm) / 60_000)))
}

/**
 * The quiet admission that the socket is down.
 *
 * Rendered at the top of the main column whenever the connection is anything
 * but online. The session keeps its own reconnect schedule; this reports it,
 * plus whatever detail the session attached to the state change.
 *
 * The detail is always an error: the reason for the drop, which the core gives
 * as a key ("the connection dropped", "the server refused the login"), or an
 * error the shell already translated (the first connection that failed). A key
 * shows as code and phrase, like other errors. A message the table doesn't know
 * is "Error 900", with the message raw underneath: it used to come raw, without
 * code, and looked the same as a state.
 *
 * And it has an action. The core's backoff goes up to 32 seconds between
 * retries, and someone who just came back to Wi-Fi does not have to wait:
 * "Connect now" tries right away. The "2 min ago" is there so you know if you
 * missed anything, and whether it's worth waiting or doing something else.
 */
export function ConnectionBanner({
  state,
  detail,
}: {
  state: ConnectionState
  detail: string | null
}): React.JSX.Element | null {
  const ligacao = useContext(LigacaoContext)
  const caiuEm = state === "online" ? null : (ligacao?.caiuEm ?? null)
  const [agora, setAgora] = useState(() => Date.now())

  // The clock only ticks while there is a drop to measure.
  useEffect(() => {
    if (caiuEm === null) return
    setAgora(Date.now())
    const timer = setInterval(() => setAgora(Date.now()), PASSO_DO_RELOGIO_MS)
    return () => clearInterval(timer)
  }, [caiuEm])

  if (state === "online") return null
  // Already translated by the shell: starts with the code line ("Error 202").
  const jaTraduzido = detail !== null && /^\S+ \d{3}\n/.test(detail)
  const aLigar = state === "connecting"
  return (
    <div className="connection-banner" role="status">
      <span>{caiuEm !== null ? strings.connection.semLigacaoHa(tempoSemLigacao(caiuEm, agora)) : strings.connection.banner}</span>
      {detail && (
        <span className="detail">
          <TextoDeErro texto={jaTraduzido ? detail : translateError(detail)} />
        </span>
      )}
      {ligacao && (
        <button
          type="button"
          className="connection-banner-ligar"
          disabled={aLigar}
          // The phrase that left the banner because it doesn't fit at 375px: the button
          // is there so you do not wait, and without it the app retries anyway.
          title={strings.connection.tentaSozinha}
          onClick={ligacao.ligarAgora}
        >
          {aLigar ? strings.connection.aLigar : strings.connection.ligarAgora}
        </button>
      )}
    </div>
  )
}

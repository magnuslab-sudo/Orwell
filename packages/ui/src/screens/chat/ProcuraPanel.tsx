import { useEffect, useRef } from "react"
import { Avatar } from "../../components/Avatar.js"
import type { Profile } from "../../bridge.js"
import type { EstadoDaProcura } from "../../hooks/useProcura.js"
import { excerto, realces, type Achado } from "../../lib/procura.js"
import { formatRelative, formatStamp } from "../../lib/format.js"
import { CloseIcon } from "../../icons.js"
import { strings } from "../../strings.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"

/**
 * How many results show up on screen at once.
 *
 * This is not a performance measure: the scan returns all four hundred in 1.25 ms
 * and rendering them would cost far more than finding them. It is a measure of
 * readability. A list of three hundred lines cannot be read through, and someone
 * who searched for one letter does not want to read the entire channel again,  * they want to type one more letter. The footer says how many exist in total,
 * which is the information that lets them refine instead of scroll.
 */
const TECTO_DA_LISTA = 50

/** How much of a long message fits in one result line. */
const LARGURA_DO_EXCERTO = 160

/**
 * What was found in this conversation.
 *
 * A sheet anchored to the header button, dismissed like a menu (click outside
 * or Escape) and never modal: searching requires no response. Same design and
 * same mechanics as `PinnedPanel`, on purpose, both hang from the same place
 * and anyone who knows how to use one knows how to use the other.
 *
 * **Everything drawn here is data, and stays data.** The text of a message goes
 * through the highlight in pieces and reaches the screen as children of an
 * element, never as markup. It is the same decision as `RichText` and the
 * conversation line; it repeats here because highlighting is exactly where you
 * want to break it.
 */
export function ProcuraPanel({
  ancora,
  estado,
  directory,
  nameFor,
  presenceFor,
  emChamada,
  nomeDaSala,
  salaAberta,
  onAbrir,
  onClose,
}: {
  /**
   * What counts as "inside this" for the click-outside. See `PinnedPanel`: without
   * this the button that opens the sheet would close it on `mousedown` and reopen
   * it on `click`, and it would look broken.
   */
  ancora?: React.RefObject<HTMLElement | null> | undefined
  estado: EstadoDaProcura
  directory: Map<string, Profile>
  nameFor: (address: string) => string
  /**
   * The state of each person, for the face ring. Absent: faces have no ring,
   * because this screen does not know the state and grey would say "offline".
   */
  presenceFor?: ((address: string) => "active" | "away" | "busy" | "idle") | undefined
  /** Whoever is in a call or a voice room: the ring pulses. */
  emChamada?: ((address: string) => boolean) | undefined
  /** The human-readable name of a room in the channel. The identifier is not shown. */
  nomeDaSala: (room: string) => string
  /** The room that is open now: a result from it does not repeat where it is. */
  salaAberta: string
  onAbrir: (achado: Achado) => void
  onClose: () => void
}): React.JSX.Element {
  const folha = useRef<HTMLDivElement>(null)
  const caixa = useRef<HTMLInputElement>(null)

  // Ready to type as soon as it opens. A search sheet that forces a click on the
  // input box wastes the gesture the person already made to get here.
  useEffect(() => caixa.current?.focus(), [])

  useEffect(() => {
    const dispensar = (event: MouseEvent): void => {
      if (!(event.target instanceof Node)) return
      const dentro = ancora?.current ?? folha.current
      if (dentro?.contains(event.target)) return
      onClose()
    }
    const teclado = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("mousedown", dispensar, true)
    window.addEventListener("keydown", teclado)
    return () => {
      window.removeEventListener("mousedown", dispensar, true)
      window.removeEventListener("keydown", teclado)
    }
  }, [onClose, ancora])

  const { termo, definirTermo, resultados, noTecto, procuradas, aLer } = estado
  const mostrados = resultados.slice(0, TECTO_DA_LISTA)
  const procurou = termo.trim() !== ""

  return (
    <div ref={folha} className="procura-panel" role="dialog" aria-label={strings.chat.searchToggle}>
      <header className="procura-head">
        <input
          ref={caixa}
          type="search"
          className="procura-caixa"
          placeholder={strings.chat.searchPlaceholder}
          aria-label={strings.chat.searchToggle}
          value={termo}
          onChange={(event) => definirTermo(event.target.value)}
        />
        {termo !== "" && (
          <button
            type="button"
            className="procura-limpar"
            aria-label={strings.chat.searchClear}
            title={strings.chat.searchClear}
            onClick={() => {
              definirTermo("")
              caixa.current?.focus()
            }}
          >
            <CloseIcon size={14} />
          </button>
        )}
      </header>

      {/* This device's cap, stated in words and stated always when one exists.
          See `searchCeiling`, where it explains why it cannot wait for a
          failed search. */}
      {noTecto && <p className="procura-tecto">{strings.chat.searchCeiling}</p>}

      {!procurou && <p className="procura-vazia">{aLer ? strings.chat.searchReading : strings.chat.searchHint}</p>}

      {procurou && resultados.length === 0 && (
        <p className="procura-vazia">
          {strings.chat.searchEmpty(termo.trim())}
          <span className="procura-onde">{strings.chat.searchScanned(procuradas)}</span>
        </p>
      )}

      {mostrados.length > 0 && (
        <>
          <p className="procura-conta">{strings.chat.searchCount(resultados.length)}</p>
          <ul className="procura-lista">
            {mostrados.map((achado) => (
              <li key={achado.id}>
                {/*
                  The entire line is the button, not a button inside the line:
                  the target of a result is the result. The label spoken aloud
                  says what tapping it does, because the message text does not,                   it is content, not a label.
                  */}
                <button
                  type="button"
                  className="procura-linha"
                  aria-label={`${strings.chat.searchJump}: ${achado.body}`}
                  onClick={() => onAbrir(achado)}
                >
                  <Avatar
                    profile={directory.get(achado.sender)}
                    fallback={achado.sender[1] ?? "?"}
                    presence={presenceFor?.(achado.sender)}
                    emChamada={emChamada?.(achado.sender)}
                  />
                  <span className="procura-corpo">
                    <span className="procura-quem">
                      <NomeDePessoa nome={nameFor(achado.sender)} endereco={achado.sender} />
                      <time title={formatStamp(achado.at)}>{formatRelative(achado.at)}</time>
                      {achado.room !== salaAberta && (
                        <span className="procura-sala">{strings.chat.searchInRoom(nomeDaSala(achado.room))}</span>
                      )}
                    </span>
                    <span className="procura-texto">
                      {/*
                        Nodes, never a markup string. `highlights` returns the
                        text split into pieces and what happens here is choosing
                        the tag for each one; the text itself is a child of an
                        element, so React writes it as text. A message with `<b>`
                        inside it reads with the `<b>` in plain sight, which is
                        what it is.
                      */}
                      {realces(excerto(achado.body, termo, LARGURA_DO_EXCERTO), termo).map((pedaco, indice) =>
                        pedaco.marcado ? <mark key={indice}>{pedaco.texto}</mark> : <span key={indice}>{pedaco.texto}</span>,
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {resultados.length > mostrados.length && (
            <p className="procura-mais">{strings.chat.searchMore(mostrados.length, resultados.length)}</p>
          )}
        </>
      )}
    </div>
  )
}

import { Avatar } from "../../components/Avatar.js"
import type { Profile } from "../../bridge.js"
import { MENCAO_TODOS, type MentionCandidate } from "../../lib/mentions.js"
import { strings } from "../../strings.js"

/**
 * The people suggested when typing an at-mention.
 *
 * Deliberately dumb: it cannot filter, it does not know keys and it does not
 * know what a channel is. It receives an already ordered list and says which one
 * is selected. All the logic lives in `lib/mentions.ts` and in the input box,  * which is where the keyboard must be handled, because that is where it arrives
 * first.
 *
 * **Opens upward.** The input box is stuck to the bottom of the screen, and a
 * list that dropped from it would end up outside the window, which is where
 * suggestions for a field in the footer go when nobody thinks about it.
 *
 * `onMouseDown` and not `onClick`: the mouse pressing down takes focus from the
 * input field before the click arrives, and the menu would close by losing focus
 * exactly when you were picking someone. Stopping the `mousedown` keeps the
 * cursor where it was.
 */
export function MentionPicker({
  candidatos,
  escolhido,
  directory,
  presenceFor,
  emChamada,
  onEscolher,
  onApontar,
}: {
  candidatos: readonly MentionCandidate[]
  /** Index of what is selected. Enter takes this one. */
  escolhido: number
  /** For each person's face. Whoever does not have one gets the initial. */
  directory?: Map<string, Profile> | undefined
  /**
   * The state of each person, for the face ring. Absent: faces have no ring,
   * because this screen does not know the state and grey would say "offline".
   */
  presenceFor?: ((address: string) => "active" | "away" | "busy" | "idle") | undefined
  /** Whoever is in a call or a voice room: the ring pulses. */
  emChamada?: ((address: string) => boolean) | undefined
  onEscolher: (candidato: MentionCandidate) => void
  onApontar: (indice: number) => void
}): React.JSX.Element | null {
  if (candidatos.length === 0) return null

  return (
    <ul className="mention-picker" role="listbox">
      {candidatos.map((candidato, indice) => (
        <li key={candidato.address}>
          <button
            type="button"
            role="option"
            aria-selected={indice === escolhido}
            className={indice === escolhido ? "mention-option escolhido" : "mention-option"}
            onMouseDown={(event) => {
              event.preventDefault()
              onEscolher(candidato)
            }}
            onMouseEnter={() => onApontar(indice)}
          >
            {/* Hidden from who listens: without a published profile, the face is the name's
                initial, and a screen reader would say "A, Ana". The image adds
                nothing to the name that comes next. */}
            {candidato.address === MENCAO_TODOS ? (
              // `@all` is not a person: no face, and with what it does written next to it.
              <>
                <span className="mention-name">@{candidato.name}</span>
                <span className="mention-hint">{strings.chat.mencionarTodos}</span>
              </>
            ) : (
              <>
                <span aria-hidden="true">
                  <Avatar
                    profile={directory?.get(candidato.address)}
                    fallback={candidato.name.slice(0, 1)}
                    presence={presenceFor?.(candidato.address)}
                    emChamada={emChamada?.(candidato.address)}
                  />
                </span>
                <span className="mention-name">{candidato.name}</span>
              </>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
